//! Project scanning + per-project persistence.
//! All FS access lives here on the Rust side — the webview only ever
//! passes paths it received from us or from the native dialog.
//!
//! Two invariants this module owns:
//! - **Path guard**: every relative path from the webview is resolved with
//!   [`resolve_within_root`]; anything absolute or escaping the project root
//!   is rejected before it touches the filesystem.
//! - **Atomic writes**: [`write_atomic`] writes a temp file in the target
//!   directory and renames it into place, so a crash never leaves a
//!   half-written `graph.json` or node file.

#[cfg(test)]
mod tests;

use crate::watcher::note_self_write;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Relative path of the graph file inside a project.
const GRAPH_REL_PATH: &str = ".cowtext/graph.json";

/// Directories never worth scanning. Keeps the walk fast and the list honest.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MdFile {
    /// Path relative to the project root, forward slashes.
    pub rel_path: String,
    pub size_bytes: u64,
    /// Unix millis; None if the platform won't say.
    pub modified_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScan {
    pub root: String,
    pub files: Vec<MdFile>,
}

/// Scan `root` recursively for `.md` files. Hidden directories and the
/// usual build/dependency directories are skipped. Thin `#[tauri::command]`
/// wrapper: does the scan via [`scan_root`], then — on success only —
/// restarts the file watcher for `root` (WO01 Block A §4.2). `AppHandle`
/// and `State` are injected by Tauri; the JS call site is unchanged.
#[tauri::command]
pub fn scan_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::watcher::WatcherState>,
    root: String,
) -> Result<ProjectScan, String> {
    let scan = scan_root(root.clone())?;
    crate::watcher::restart(&app, &state, &root);
    Ok(scan)
}

/// Does the actual recursive `.md` scan. Split out of `scan_project` so
/// tests (and any future non-command caller) don't need a Tauri `AppHandle`.
pub(crate) fn scan_root(root: String) -> Result<ProjectScan, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {root}"));
    }

    let mut files = Vec::new();
    walk(&root_path, &root_path, &mut files)?;
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

    Ok(ProjectScan { root, files })
}

pub(crate) fn walk(root: &Path, dir: &Path, out: &mut Vec<MdFile>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if path.is_dir() {
            // Special case, root only: `.claude/agents/*.md` are real
            // Memory Nodes (agent-role nodes may be backed by them) and
            // belong in the scan like any other `.md` file. Nothing else
            // under `.claude/` (settings.json, skills/) is scanned — the
            // dot-directory skip below still applies to everything else.
            if dir == root && name == ".claude" {
                collect_agent_md(root, &path.join("agents"), out);
                continue;
            }
            let skip = name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref());
            if !skip {
                // A subdirectory that vanishes mid-scan is not an error.
                let _ = walk(root, &path, out);
            }
        } else if name.to_lowercase().ends_with(".md") {
            let meta = entry.metadata().ok();
            out.push(MdFile {
                rel_path: path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
                size_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                modified_ms: meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64),
            });
        }
    }
    Ok(())
}

/// Non-recursive listing of `agents_dir`'s `*.md` files (mirrors
/// `agents::agents_scan`'s own walk), pushed into the project scan with
/// `rel_path`s like `.claude/agents/foo.md`. A missing `agents_dir` (no
/// `.claude/agents/` yet) contributes nothing — not an error.
fn collect_agent_md(root: &Path, agents_dir: &Path, out: &mut Vec<MdFile>) {
    let Ok(entries) = fs::read_dir(agents_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.to_lowercase().ends_with(".md") {
            continue;
        }
        let meta = entry.metadata().ok();
        out.push(MdFile {
            rel_path: path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/"),
            size_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified_ms: meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64),
        });
    }
}

/// Single source of truth for "is this `.md` path relevant to the project
/// scan / the watcher" (WO01 Block A §4.3). Must stay in lockstep with
/// [`walk`]'s own skip rules — the parity test in `project/tests.rs` holds
/// them together. `path` is expected to be `root`-relative or under `root`;
/// paths outside `root` are never relevant.
pub(crate) fn is_scannable_md(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        return false;
    };
    let Some(name) = rel.file_name() else {
        return false;
    };
    if !name.to_string_lossy().to_lowercase().ends_with(".md") {
        return false;
    }

    // Directory components strictly between root and the file name.
    let dirs: Vec<String> = rel
        .parent()
        .into_iter()
        .flat_map(|p| p.components())
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();

    // Root-only, non-recursive special case: `.claude/agents/*.md` mirrors
    // `collect_agent_md`. Anything deeper (`.claude/agents/sub/x.md`) is
    // NOT covered — falls through to the dot-dir rejection below.
    if dirs.len() == 2 && dirs[0] == ".claude" && dirs[1] == "agents" {
        return true;
    }

    for d in &dirs {
        if d.starts_with('.') || SKIP_DIRS.contains(&d.as_str()) {
            return false;
        }
    }
    true
}

/// Resolve `rel` against `root`, rejecting anything that could escape it.
/// Purely lexical: no `..`, no absolute paths, no drive prefixes. The file
/// itself does not need to exist (writes create it).
pub(crate) fn resolve_within_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.trim().is_empty() {
        return Err("Empty path".into());
    }
    let rel_path = Path::new(rel);
    let mut out = PathBuf::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Path escapes project root: {rel}"));
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("Path resolves to nothing: {rel}"));
    }
    Ok(root.join(out))
}

/// Write `content` atomically: temp file in the same directory, then rename.
/// Creates missing parent directories. LF content is passed through
/// verbatim. Registers `path` in the watcher's self-write registry
/// ([`note_self_write`], WO01 Block C §T4) on success — this is the single
/// call site every writer in the codebase goes through, so `fs://change`
/// events for our own writes come out tagged `selfWrite: true` without
/// every caller having to remember to tag itself.
pub(crate) fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("No parent directory: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    let tmp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id()
    ));
    fs::write(&tmp, content).map_err(|e| format!("{}: {e}", tmp.display()))?;
    // On Windows, rename fails if the target exists; remove it first.
    // The temp file is complete at this point, so the worst crash outcome
    // is "old file gone, finished temp file present" — never a torn write.
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", tmp.display()))?;
    note_self_write(path);
    Ok(())
}

pub(crate) fn checked_root(root: &str) -> Result<PathBuf, String> {
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {root}"));
    }
    Ok(root_path)
}

// WO03 Lane A infrastructure: this schema/migration/serialization surface
// has no caller yet inside this crate — it exists for Lanes B (compile.rs),
// C (cowtext-cli), D (import.rs), and E (lint.rs) to consume once their
// modules land (none of which are this lane's to touch or pre-wire). Until
// then it is exercised only by this module's own tests, so the plain
// (non-`--tests`) `cargo clippy -- -D warnings` gate sees it as dead code.
// The allow is scoped to this submodule only, re-exported flat below so
// callers still see `crate::project::MemoryNode` etc.
#[allow(dead_code)]
mod graph_v3 {
    use super::*;

    // ── Graph v3 schema (WO03) ──────────────────────────────────────────
    // Canonical Rust model of `graph.json`, for Rust-only consumers that never
    // go through the webview — the CLI (`cowtext-cli`, WO03 Lane C), importer
    // (`import.rs`, Lane D), and linter (`lint.rs`, Lane E). `read_graph` /
    // `write_graph` below stay raw string pass-through: `src/store/graph.ts`
    // still owns serialization for the live app; this model mirrors it
    // field-for-field (same names, same wire order, same default-omission
    // rules) so the two never drift.
    //
    // Schema history: v1's node role `persona` was renamed to `agent` in v2
    // (same semantics — an agent-role node may be backed by a real
    // `.claude/agents/*.md` file). v3 (WO03) widens the node role and edge
    // kind vocabularies and adds `tags` / `owner` / `meta` to nodes, `color`
    // to edges, and two new compile targets (`copilot`, `gemini`). v4 (WO10)
    // adds `waypoints` to edges — the hand-edited orthogonal route.

    /// Current `graph.json` schema version. Bumping this needs a migration
    /// step in [`migrate_graph`] and the matching entry in `src/store/graph.ts`'s
    /// `migrateGraph`.
    pub const GRAPH_VERSION: u32 = 4;

    /// Node role — 13 values (WO03_CONTRACT.md §"Graph v3 schema": 7
    /// existing + 6 new; ratified at 13 in `docs/design/WO03_AUDIT.md`
    /// §4.5).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "lowercase")]
    pub enum NodeRole {
        /// May be backed by a real `.claude/agents/*.md` file (v1 name: `persona`).
        Agent,
        Rules,
        Architecture,
        Workflow,
        Task,
        Reference,
        Glossary,
        Command,
        Invariant,
        Trap,
        Skill,
        Snippet,
        Style,
    }

    /// Every [`NodeRole`] value, in the contract's enumeration order. Used by
    /// round-trip tests and available to any future exhaustive-role consumer.
    pub const NODE_ROLES: [NodeRole; 13] = [
        NodeRole::Agent,
        NodeRole::Rules,
        NodeRole::Architecture,
        NodeRole::Workflow,
        NodeRole::Task,
        NodeRole::Reference,
        NodeRole::Glossary,
        NodeRole::Command,
        NodeRole::Invariant,
        NodeRole::Trap,
        NodeRole::Skill,
        NodeRole::Snippet,
        NodeRole::Style,
    ];

    /// Edge kind. `overrides` is STRUCTURAL (participates in Kahn's algorithm
    /// / cycle validation / topological ordering exactly like `imports`);
    /// `supersedes` and `conflicts-with` are NON-structural (linter-only,
    /// WO03 Lane E) — see [`EdgeKind::is_structural`].
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "kebab-case")]
    pub enum EdgeKind {
        Imports,
        References,
        Conditional,
        Sequence,
        Overrides,
        Supersedes,
        ConflictsWith,
    }

    /// Every [`EdgeKind`] value, in the contract's enumeration order.
    pub const EDGE_KINDS: [EdgeKind; 7] = [
        EdgeKind::Imports,
        EdgeKind::References,
        EdgeKind::Conditional,
        EdgeKind::Sequence,
        EdgeKind::Overrides,
        EdgeKind::Supersedes,
        EdgeKind::ConflictsWith,
    ];

    impl EdgeKind {
        /// True for edge kinds that participate in Kahn's algorithm / cycle
        /// validation / topological ordering — `imports` and `sequence`
        /// (unchanged since v1) plus the new `overrides`. False for edge kinds
        /// that exist only for the linter (`references`, `conditional`,
        /// `supersedes`, `conflicts-with`) and never affect compile order.
        /// Lanes B (`compile.rs`) and E (`lint.rs`) call this rather than
        /// re-deriving the structural/non-structural split.
        pub fn is_structural(self) -> bool {
            matches!(self, EdgeKind::Imports | EdgeKind::Sequence | EdgeKind::Overrides)
        }
    }

    /// Compile target. `copilot` / `gemini` are new in v3 and OFF by default —
    /// [`default_compile_targets`] (used only when the key is absent) never
    /// includes them.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "lowercase")]
    pub enum CompileTarget {
        Claude,
        Agents,
        Cursor,
        Copilot,
        Gemini,
    }

    fn default_compile_targets() -> Vec<CompileTarget> {
        vec![CompileTarget::Claude]
    }

    /// `{ x, y }` canvas position. Always integers on disk — the webview
    /// rounds before serializing (`Math.round`), so `i64` (not `f64`) keeps
    /// Rust and JS number formatting identical (`80`, never `80.0`).
    /// Deserialize accepts fractional input and rounds it (WO03 audit D6:
    /// a hand-edited or historical `"x": 80.5` must not hard-fail
    /// `migrate_graph` — the app itself only rounds on the way out,
    /// `graph.ts`'s `stableNode`/canvas drag handlers, never on the way in).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
    pub struct Position {
        pub x: i64,
        pub y: i64,
    }

    impl<'de> Deserialize<'de> for Position {
        fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where
            D: serde::Deserializer<'de>,
        {
            #[derive(Deserialize)]
            struct Raw {
                x: f64,
                y: f64,
            }
            let raw = Raw::deserialize(deserializer)?;
            Ok(Position {
                x: raw.x.round() as i64,
                y: raw.y.round() as i64,
            })
        }
    }

    /// `{ tx, ty }` isometric tile coordinate for the barn scene. Same
    /// fractional-input tolerance as [`Position`] (WO03 audit D6).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
    pub struct ScenePos {
        pub tx: i64,
        pub ty: i64,
    }

    impl<'de> Deserialize<'de> for ScenePos {
        fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where
            D: serde::Deserializer<'de>,
        {
            #[derive(Deserialize)]
            struct Raw {
                tx: f64,
                ty: f64,
            }
            let raw = Raw::deserialize(deserializer)?;
            Ok(ScenePos {
                tx: raw.tx.round() as i64,
                ty: raw.ty.round() as i64,
            })
        }
    }

    /// `condition`/`note` treat an empty string the same as absent (matches
    /// `stableEdge` in `src/store/graph.ts`): an edge that once had one and
    /// lost it serializes without the key rather than as `""`.
    fn is_empty_string_opt(o: &Option<String>) -> bool {
        match o {
            None => true,
            Some(s) => s.is_empty(),
        }
    }

    /// `meta` treats an empty map the same as absent, so a node that never
    /// used the extension map never grows a stray `"meta": {}`.
    fn is_none_or_empty_map(m: &Option<BTreeMap<String, Value>>) -> bool {
        match m {
            None => true,
            Some(map) => map.is_empty(),
        }
    }

    /// A Memory Node (v3 shape). Field declaration order here IS the wire
    /// order — see [`serialize_graph`]. Mirrors `MemoryNode` in
    /// `src/store/graph.ts`.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MemoryNode {
        pub id: String,
        pub title: String,
        pub role: NodeRole,
        #[serde(default)]
        pub brief: String,
        pub file_path: String,
        #[serde(default)]
        pub read_order: i64,
        #[serde(default)]
        pub pinned: bool,
        #[serde(default)]
        pub position: Position,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub scene_pos: Option<ScenePos>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub last_verified: Option<String>,
        /// v3: free-form labels; default empty, omitted from output at default
        /// (contract: "new fields must be OMITTED when at default value").
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub tags: Vec<String>,
        /// v3: optional owner/assignee.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub owner: Option<String>,
        /// v3: reserved extension map. Keys serialize sorted — `BTreeMap`
        /// (and `serde_json::Value`'s own default non-`preserve_order` `Map`,
        /// used for nested object values) are both alphabetical — so output
        /// stays deterministic without a v4 bump for new scalar-only usage.
        #[serde(default, skip_serializing_if = "is_none_or_empty_map")]
        pub meta: Option<BTreeMap<String, Value>>,
    }

    /// A Memory Edge (v3 shape). Field declaration order here IS the wire
    /// order. Mirrors `MemoryEdge` in `src/store/graph.ts`.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MemoryEdge {
        pub id: String,
        pub source: String,
        pub target: String,
        pub kind: EdgeKind,
        /// Glob or natural-language condition (`conditional` edges only).
        #[serde(default, skip_serializing_if = "is_empty_string_opt")]
        pub condition: Option<String>,
        /// Human hint rendered on the edge label.
        #[serde(default, skip_serializing_if = "is_empty_string_opt")]
        pub note: Option<String>,
        /// v3: edge colour override (backlog "edge colour persistence" row).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub color: Option<String>,
        /// v4 (WO10): hand-edited route — flow-space points the router must
        /// pass through, in order, between source and target. Empty ⇒ the
        /// automatic orthogonal route (`src/canvas/edgePath.ts`). Omitted
        /// from output at default, per the "new fields must be OMITTED when
        /// at default value" contract rule.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub waypoints: Vec<Position>,
    }

    /// `graph.json` shape (v3). Mirrors `BarnGraph` in `src/store/graph.ts`.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BarnGraph {
        pub version: u32,
        #[serde(default)]
        pub project_name: String,
        pub nodes: Vec<MemoryNode>,
        pub edges: Vec<MemoryEdge>,
        #[serde(default = "default_compile_targets")]
        pub compile_targets: Vec<CompileTarget>,
    }

    /// The 13 [`NodeRole`] wire values, as raw strings, used only by
    /// [`migrate_graph`] tolerance pre-pass (WO03 audit D6), kept apart
    /// from [`NODE_ROLES`] (typed values) so that pre-pass stays a plain
    /// string comparison over raw JSON.
    const KNOWN_NODE_ROLE_STRS: [&str; 13] = [
        "agent", "rules", "architecture", "workflow", "task", "reference", "glossary", "command",
        "invariant", "trap", "skill", "snippet", "style",
    ];
    /// The 7 [`EdgeKind`] wire values, as raw strings, same purpose as
    /// [`KNOWN_NODE_ROLE_STRS`].
    const KNOWN_EDGE_KIND_STRS: [&str; 7] = [
        "imports", "references", "conditional", "sequence", "overrides", "supersedes",
        "conflicts-with",
    ];
    /// The 5 [`CompileTarget`] wire values, as raw strings, same purpose as
    /// [`KNOWN_NODE_ROLE_STRS`].
    const KNOWN_COMPILE_TARGET_STRS: [&str; 5] = ["claude", "agents", "cursor", "copilot", "gemini"];

    /// Migration harness (mirrors `migrateGraph` in `src/store/graph.ts`).
    /// Accepts v1..v4 `graph.json` bytes and returns the current (v4)
    /// shape in one read — a v1 graph migrates v1→v2→v3→v4 without an
    /// intermediate write. v1→v2: `persona` role renamed to `agent` (same
    /// semantics). v2→v3: pure default-filling (new node/edge fields absent
    /// ⇒ their v3 defaults; v2's 7 roles and 4 edge kinds are already valid
    /// v3 values, so nothing else changes there). v3→v4: pure
    /// default-filling again — the only new field is the edge's
    /// `waypoints`, absent ⇒ empty ⇒ the automatic route. Both
    /// default-filling steps need no code here: `#[serde(default)]` on
    /// every new field does the work, which is why this function's body
    /// only ever grows a step when a rename or a reshape lands.
    /// Idempotent: migrating an
    /// already-current graph only re-normalizes to the typed shape (e.g. a stale
    /// non-current `version` value is corrected). `Err` for unparseable JSON,
    /// an out-of-range version, or a missing/non-array `nodes`/`edges` —
    /// mirrors the TS function's strictness there (no silent default to `[]`).
    ///
    /// WO03 audit D6 — unrecognized role/kind/target strings are coerced,
    /// not rejected. The app itself tolerates them (`compile.rs`'s
    /// `RoleIn`/`EdgeKindIn`/`TargetIn` parse anything unrecognized into an
    /// `Other`/`Unknown` fallback; the TS store casts without validating),
    /// so a hand-edited `graph.json` with a typo in `role` loads, renders,
    /// and compiles fine in the app; it must not then hard-fail
    /// `migrate_graph` (and by extension `lint_run` / `import_apply` /
    /// `cowtext-cli`) for an infrastructure reason. Unlike `compile.rs`,
    /// [`NodeRole`]/[`EdgeKind`]/[`CompileTarget`] are deliberately CLOSED
    /// enums here (no `#[serde(other)]` fallback variant): `import.rs`'s
    /// `edge_kind_slug` and `lint.rs`'s `edge_kind_name` both exhaustively
    /// match `EdgeKind` with no wildcard arm, outside this lane's zone;
    /// widening the enum would require touching those files too. So
    /// instead of preserving an unrecognized string, this coerces it to a
    /// neutral default before typed deserialization: an unknown node role
    /// becomes `reference` (matches `src/preset/types.ts`'s `asRole`
    /// fallback), an unknown edge kind becomes `references`
    /// (non-structural, same no-op-for-ordering class as `compile.rs`'s
    /// `EdgeKindIn::Unknown`), and an unknown compile target is dropped
    /// from the array. This is a deliberate, audit-flagged exception to
    /// "preserve unknown values on round-trip" — the trade is documented
    /// rather than silently made.
    pub fn migrate_graph(raw: &str) -> Result<BarnGraph, String> {
        let mut value: Value = serde_json::from_str(raw).map_err(|e| format!("graph.json: {e}"))?;

        let version = value
            .get("version")
            .and_then(Value::as_u64)
            .ok_or_else(|| "graph.json: missing or non-numeric version".to_string())?;
        if version < 1 || version > u64::from(GRAPH_VERSION) {
            return Err(format!("Unsupported graph.json version: {version}"));
        }

        if !matches!(value.get("nodes"), Some(Value::Array(_)))
            || !matches!(value.get("edges"), Some(Value::Array(_)))
        {
            return Err("graph.json is missing nodes/edges arrays".to_string());
        }

        // v1 → v2: "persona" role renamed to "agent"; D6: any other
        // unrecognized role coerced to "reference" (see doc comment above).
        if let Some(nodes) = value.get_mut("nodes").and_then(Value::as_array_mut) {
            for node in nodes {
                match node.get("role").and_then(Value::as_str) {
                    Some("persona") => node["role"] = Value::String("agent".to_string()),
                    Some(r) if !KNOWN_NODE_ROLE_STRS.contains(&r) => {
                        node["role"] = Value::String("reference".to_string());
                    }
                    _ => {}
                }
            }
        }

        // D6: unrecognized edge kind coerced to "references" (non-structural).
        if let Some(edges) = value.get_mut("edges").and_then(Value::as_array_mut) {
            for edge in edges {
                if let Some(k) = edge.get("kind").and_then(Value::as_str) {
                    if !KNOWN_EDGE_KIND_STRS.contains(&k) {
                        edge["kind"] = Value::String("references".to_string());
                    }
                }
            }
        }

        // D6: unrecognized compile target dropped from the array.
        if let Some(Value::Array(targets)) = value.get_mut("compileTargets") {
            targets.retain(|t| t.as_str().is_some_and(|s| KNOWN_COMPILE_TARGET_STRS.contains(&s)));
        }

        let mut graph: BarnGraph =
            serde_json::from_value(value).map_err(|e| format!("graph.json: {e}"))?;
        graph.version = GRAPH_VERSION;
        Ok(graph)
    }

    /// Deterministic serialization: nodes/edges sorted by id
    /// (`String::cmp` — byte order, WO03 audit D5), fixed field order
    /// (struct declaration order), 2-space indent, LF line endings,
    /// trailing newline, new-at-default fields omitted. Mirrors
    /// `serializeGraph` in `src/store/graph.ts` byte-for-byte, INCLUDING
    /// sort order: `graph.ts` sorts with a byte-order `compareIds` helper,
    /// not `localeCompare` — the two disagree on ids containing `-`
    /// (every id does, `` `${base36}-${rand}` ``), which used to make this
    /// doc comment's "mirrors" claim false and churn `nodes`/`edges` order
    /// in the git diff on every alternating Rust/TS write. See
    /// `serialize_sorts_hyphenated_ids_in_byte_order_matching_graph_ts`
    /// below for the fixture pinning the previously-disagreeing pair.
    pub fn serialize_graph(graph: &BarnGraph) -> String {
        let mut nodes = graph.nodes.clone();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));
        let mut edges = graph.edges.clone();
        edges.sort_by(|a, b| a.id.cmp(&b.id));
        let stable = BarnGraph {
            version: GRAPH_VERSION,
            project_name: graph.project_name.clone(),
            nodes,
            edges,
            compile_targets: graph.compile_targets.clone(),
        };
        let mut out = serde_json::to_string_pretty(&stable).expect("BarnGraph always serializes");
        out.push('\n');
        out
    }
}
#[allow(unused_imports)]
pub use graph_v3::*;

/// Read `.cowtext/graph.json`. `Ok(None)` when the project has no graph yet.
#[tauri::command]
pub fn read_graph(root: String) -> Result<Option<String>, String> {
    let path = checked_root(&root)?.join(GRAPH_REL_PATH);
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Write `.cowtext/graph.json` atomically. The webview is responsible for
/// stable serialization (fixed field order, LF, trailing newline).
#[tauri::command]
pub fn write_graph(root: String, content: String) -> Result<(), String> {
    let path = checked_root(&root)?.join(GRAPH_REL_PATH);
    write_atomic(&path, &content)
}

/// Read a markdown (or any text) file under the project root.
#[tauri::command]
pub fn read_md_file(root: String, rel_path: String) -> Result<String, String> {
    let path = resolve_within_root(&checked_root(&root)?, &rel_path)?;
    fs::read_to_string(&path).map_err(|e| format!("{rel_path}: {e}"))
}

/// Write a text file under the project root, atomically, creating parent
/// directories as needed (e.g. `context/` for a brand-new node).
///
/// One writer per file (WO11_CONTRACT.md §12.3 item 4, §12.8 doctrine): an
/// agent file's only sanctioned writer is `agent_save`'s save queue, which
/// re-reads and hands back the fresh `AgentDoc` on every write — a second,
/// uncoordinated writer through this command is a stale-read/lost-update
/// across human time (the Markdown tab can hold a buffer open for minutes),
/// not a race a lock could fix. Enforced here, at the one chokepoint every
/// path must go through, as a runtime rejection rather than a documented-only
/// rule: this codebase has twice shipped a documented-only invariant that
/// then failed in practice (WO10's `sameRelPath`, and this).
#[tauri::command]
pub fn write_md_file(root: String, rel_path: String, content: String) -> Result<(), String> {
    // hooks_write is the only sanctioned path into the trust boundary.
    if rel_path.replace('\\', "/").eq_ignore_ascii_case(".claude/settings.json") {
        return Err("Use Install hooks to edit .claude/settings.json".to_string());
    }
    // agent_save is the only sanctioned path into `.claude/agents/*.md`.
    // Same normalization idiom used throughout `agents.rs` (e.g.
    // `agent_convert`'s `.claude/` guard) and by `is_rename_protected`
    // below: forward-slash, lowercase, then a prefix/suffix check — never a
    // bare `==`/`split("/")` comparison (this codebase's standing rule,
    // after seven prior defects of exactly that shape).
    let normalized = rel_path.replace('\\', "/").to_ascii_lowercase();
    if normalized.starts_with(".claude/agents/") && normalized.ends_with(".md") {
        return Err("Use agent_save to write an agent file".to_string());
    }
    let path = resolve_within_root(&checked_root(&root)?, &rel_path)?;
    write_atomic(&path, &content)
}

/// Files/directories the app must never rename or clobber — generated
/// outputs and tool-owned trees. `rel_path` is normalized to forward
/// slashes and lowercased before comparison.
pub(crate) fn is_rename_protected(rel_path: &str) -> bool {
    let normalized = rel_path.replace('\\', "/").to_ascii_lowercase();
    normalized == "claude.md"
        || normalized == "agents.md"
        || normalized.starts_with(".claude/")
        || normalized.starts_with(".cursor/")
        || normalized.starts_with(".cowtext/")
}

/// Rename a node's .md file inside the project root. Never clobbers.
/// Returns the normalized (forward-slash) new relative path — the exact
/// string `scan_project` would emit — so the store can store it verbatim.
#[tauri::command]
pub fn rename_node_file(
    root: String,
    rel_path: String,
    new_rel_path: String,
) -> Result<String, String> {
    let root_path = checked_root(&root)?;
    let src = resolve_within_root(&root_path, &rel_path)?;
    let dest = resolve_within_root(&root_path, &new_rel_path)?;

    if !new_rel_path.to_ascii_lowercase().ends_with(".md") {
        return Err(format!("Destination must be a .md file: {new_rel_path}"));
    }

    if is_rename_protected(&rel_path) || is_rename_protected(&new_rel_path) {
        return Err(format!(
            "Refusing to rename a generated or tool-owned file: {rel_path}"
        ));
    }

    if !src.is_file() {
        return Err(format!("Not a file: {rel_path}"));
    }

    if src == dest {
        return Err("Source and destination are the same".to_string());
    }

    if dest.exists() {
        return Err(format!("Already exists: {new_rel_path}"));
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{new_rel_path}: {e}"))?;
    }
    fs::rename(&src, &dest).map_err(|e| format!("{rel_path}: {e}"))?;

    Ok(dest
        .strip_prefix(&root_path)
        .unwrap_or(&dest)
        .to_string_lossy()
        .replace('\\', "/"))
}

/// Show a project file (or the project folder itself) in the OS file
/// manager. `rel_path == None` (or empty) reveals `root`. If the resolved
/// path is missing, walk up to the nearest existing ancestor still inside
/// `root` and reveal that instead.
#[tauri::command]
pub fn reveal_path(
    app: tauri::AppHandle,
    root: String,
    rel_path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let root_path = checked_root(&root)?;
    let target = match rel_path.as_deref() {
        Some(p) if !p.trim().is_empty() => resolve_within_root(&root_path, p)?,
        _ => root_path.clone(),
    };

    let mut candidate = target.as_path();
    while !candidate.exists() {
        match candidate.parent() {
            Some(parent) if parent.starts_with(&root_path) => candidate = parent,
            _ => {
                return Err(format!(
                    "Nothing to reveal: {}",
                    rel_path.as_deref().unwrap_or("")
                ))
            }
        }
    }

    app.opener()
        .reveal_item_in_dir(candidate)
        .map_err(|e| e.to_string())
}

/// Existence probe for the recent-projects list. Same order as the input;
/// individual entries never error.
#[tauri::command]
pub fn probe_project_dirs(paths: Vec<String>) -> Result<Vec<bool>, String> {
    Ok(paths.iter().map(|p| Path::new(p).is_dir()).collect())
}