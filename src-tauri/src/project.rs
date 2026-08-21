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
pub fn scan_root(root: String) -> Result<ProjectScan, String> {
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

// WO03 Lane A infrastructure, now the WO13 Stage 0 v5 schema seam: this
// schema/migration/serialization surface is consumed today by compile.rs,
// import.rs, lint.rs, taskctx.rs, cowtext-cli and cowtext-mcp — none of
// which are this lane's to touch. WO13 Stage 0 renames/widens NodeRole and
// EdgeKind and reshapes MemoryNode/MemoryEdge (v4 → v5, WO13_CONTRACT.md
// §4); those four downstream modules therefore fail to compile until their
// owning lanes (R1: compile.rs/resolve_load.rs; R2: import.rs/lint.rs; R3:
// taskctx.rs) land their own edits — an accepted, contract-anticipated
// consequence of the multi-lane handoff (§17 "Known required edits inside
// already-assigned zones"; the identical pattern this module's own WO03
// history hit with the dead_code trap below). The `#[allow(dead_code)]`
// wrapper stays for the same original reason (infra landing ahead of a
// consumer that has not yet re-synced against it).
#[allow(dead_code)]
mod graph_v5 {
    use super::*;

    // ── Graph v5 schema (WO13) ──────────────────────────────────────────
    // Canonical Rust model of `graph.json`, for Rust-only consumers that never
    // go through the webview — the CLI (`cowtext-cli`), MCP server
    // (`cowtext-mcp`), importer (`import.rs`), and linter (`lint.rs`).
    // `read_graph` / `write_graph` below stay raw string pass-through:
    // `src/store/graph.ts` still owns serialization for the live app; this
    // model mirrors it field-for-field (same names, same wire order, same
    // default-omission rules) so the two never drift.
    //
    // Schema history: v1's node role `persona` was renamed to `agent` in v2
    // (same semantics — an agent-role node may be backed by a real
    // `.claude/agents/*.md` file). v3 (WO03) widened the node role and edge
    // kind vocabularies and added `tags` / `owner` / `meta` to nodes, `color`
    // to edges, and two new compile targets (`copilot`, `gemini`). v4 (WO10)
    // added `waypoints` to edges. v5 (WO13) is a taxonomy overhaul, not pure
    // default-filling: `pinned: bool` becomes `rootLoad?: "always"`,
    // `condition: string` on a `conditional` edge becomes a typed `guard`,
    // the node role vocabulary is fully re-cut (14 roles, 5 groups), the
    // edge kind vocabulary shrinks to 5 (`conditional`/`supersedes`/
    // `conflicts-with` are gone; `contradicts` is new), and nodes gain
    // `deprecated` / `needsReview`. See [`migrate_graph`] for the full
    // ordered pass list (WO13_CONTRACT.md §5.1).

    /// Current `graph.json` schema version. Bumping this needs a migration
    /// step in [`migrate_graph`] and the matching entry in `src/store/graph.ts`'s
    /// `migrateGraph`.
    pub const GRAPH_VERSION: u32 = 5;

    /// Node role — 14 values, 5 groups (1 identity + 3 constraints + 2
    /// structure + 5 process + 3 knowledge; WO13_CONTRACT.md §6.1). `Agent`
    /// sits outside the four pickable groups (§6.1: dropping it would orphan
    /// every `.claude/agents/*.md` node) — declaration order below IS the
    /// contract's enumeration order and must stay in lockstep with
    /// [`NODE_ROLES`] and TS's `NODE_ROLES` in `src/store/graph.ts`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "lowercase")]
    pub enum NodeRole {
        /// May be backed by a real `.claude/agents/*.md` file (v1 name: `persona`).
        Agent,
        /// v5 rename of v4's `rules` (§6.2).
        Rule,
        Invariant,
        Trap,
        Architecture,
        /// New in v5, no v4 predecessor.
        Decision,
        Workflow,
        Command,
        Skill,
        /// New in v5, no v4 predecessor.
        Env,
        /// New in v5, no v4 predecessor.
        Tool,
        Glossary,
        /// v5 rename of v4's `snippet` (§6.2).
        Example,
        Style,
    }

    /// Every [`NodeRole`] value, in the contract's enumeration order.
    pub const NODE_ROLES: [NodeRole; 14] = [
        NodeRole::Agent,
        NodeRole::Rule,
        NodeRole::Invariant,
        NodeRole::Trap,
        NodeRole::Architecture,
        NodeRole::Decision,
        NodeRole::Workflow,
        NodeRole::Command,
        NodeRole::Skill,
        NodeRole::Env,
        NodeRole::Tool,
        NodeRole::Glossary,
        NodeRole::Example,
        NodeRole::Style,
    ];

    /// Edge kind — 5 values (WO13_CONTRACT.md §7.1). `conditional` is gone
    /// (a `conditional` edge is now `imports` + a typed [`EdgeGuard`]);
    /// `supersedes` is gone (a `supersedes` edge now deprecates its target
    /// and is deleted by migration); `conflicts-with` is renamed
    /// `contradicts`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "kebab-case")]
    pub enum EdgeKind {
        Imports,
        References,
        Overrides,
        Sequence,
        Contradicts,
    }

    /// Every [`EdgeKind`] value, in the contract's enumeration order.
    pub const EDGE_KINDS: [EdgeKind; 5] = [
        EdgeKind::Imports,
        EdgeKind::References,
        EdgeKind::Overrides,
        EdgeKind::Sequence,
        EdgeKind::Contradicts,
    ];

    impl EdgeKind {
        /// True for edge kinds that participate in Kahn's algorithm / cycle
        /// validation / topological ordering — `imports`, `sequence` and
        /// `overrides`. UNCHANGED MEANING across v3/v4/v5 (WO13_CONTRACT.md
        /// §9: this predicate answers "participates in ordering", not the
        /// edge spec's "structural" == "affects compiled output" sense —
        /// that sense is [`EdgeKind::affects_output`]). False for
        /// `references` and `contradicts`, which never affect compile order.
        pub fn is_structural(self) -> bool {
            matches!(self, EdgeKind::Imports | EdgeKind::Sequence | EdgeKind::Overrides)
        }

        /// The edge spec's own sense of "structural": does this kind ever
        /// change what lands in a compiled file? Everything except
        /// `contradicts` (WO13_CONTRACT.md §9) — deliberately a DIFFERENT
        /// predicate from [`is_structural`](Self::is_structural), which
        /// answers Kahn-participation only. Conflating the two would put
        /// every `references` `@path` pointer into the topological order,
        /// inventing cycles on graphs that have none.
        pub fn affects_output(self) -> bool {
            !matches!(self, EdgeKind::Contradicts)
        }
    }

    /// Ordering participation for a CONCRETE edge (WO13_CONTRACT.md §9). A
    /// guarded `imports` edge is conditional content, exactly as the old
    /// `conditional` kind was, and must NOT enter Kahn's algorithm — doing
    /// so would change `total_order` and therefore the order of
    /// `## Always read` and of `.cursor/rules/*.mdc`. `compile.rs`'s
    /// `total_order` and `lint.rs`'s `check_cycle` both key on this instead
    /// of `EdgeKind::is_structural` alone (R1/R2 wiring, not this lane's).
    pub fn edge_participates_in_order(kind: EdgeKind, guarded: bool) -> bool {
        kind.is_structural() && !guarded
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

    /// `note`/`color`/`owner` treat an empty string the same as absent
    /// (matches `stableEdge`/`stableNode` in `src/store/graph.ts`): a
    /// field that once had a value and lost it serializes without the key
    /// rather than as `""`.
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

    /// `rootLoad` (v5): the only legal value is `Always`; "on-demand" is
    /// expressed by absence (`Option::None`) — a single-variant optional
    /// enum makes the two-serializer parity landmine unrepresentable
    /// (WO13_CONTRACT.md §4.1).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "lowercase")]
    pub enum RootLoad {
        Always,
    }

    /// `deprecated` (v5). Field declaration order here IS the wire order —
    /// `replacedBy`, `since?`, `reason?` — frozen (§4.1). `since` is a
    /// `YYYY-MM-DD` string; migration NEVER stamps it (§5.5) — only a
    /// user-initiated deprecation in the UI does, and only the TS side
    /// computes the date (Rust never calls `now()` for it), or the two
    /// serializers would disagree on bytes for the same graph.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Deprecated {
        pub replaced_by: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub since: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub reason: Option<String>,
    }

    /// `guard` (v5): the typed replacement for the old free-text
    /// `condition` string on a `conditional` edge. `#[serde(tag = "type")]`
    /// emits the tag first, matching the TS object-literal field order
    /// (§4.2: "Inner key order, frozen: `type` first, then `globs` (glob)
    /// or `text` (description)"). A glob guard with an empty `globs` array
    /// is invalid and normalized away by migration; the UI must never be
    /// able to construct one.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(tag = "type", rename_all = "lowercase")]
    pub enum EdgeGuard {
        Glob { globs: Vec<String> },
        Description { text: String },
    }

    /// A Memory Node (v5 shape). Field declaration order here IS the wire
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
        /// v5: replaces `pinned: bool`. Slot 7 — exactly where `pinned`
        /// was. Absent ⇒ on-demand.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub root_load: Option<RootLoad>,
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
        /// v3: optional owner/assignee. `""` is treated the same as absent
        /// (v5, §4.1 row 12 — was plain `Option::is_none` pre-v5).
        #[serde(default, skip_serializing_if = "is_empty_string_opt")]
        pub owner: Option<String>,
        /// v5: set by a `supersedes` edge during migration, or by a
        /// user-initiated deprecation in the UI (TS-side only stamps
        /// `since`; migration never does — §5.5).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub deprecated: Option<Deprecated>,
        /// v5: `true` ⇒ absent; `false` ⇒ omitted (§4.1 row 14 — "`false` ⇒
        /// absent"). Set only where a migration pass actually rewrote a
        /// value (§5.2) or by explicit user action; never re-fires on an
        /// unchanged value.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        pub needs_review: bool,
        /// v3: reserved extension map. Keys serialize sorted — `BTreeMap`
        /// (and `serde_json::Value`'s own default non-`preserve_order` `Map`,
        /// used for nested object values) are both alphabetical — so output
        /// stays deterministic without a v4 bump for new scalar-only usage.
        #[serde(default, skip_serializing_if = "is_none_or_empty_map")]
        pub meta: Option<BTreeMap<String, Value>>,
    }

    /// A Memory Edge (v5 shape). Field declaration order here IS the wire
    /// order. Mirrors `MemoryEdge` in `src/store/graph.ts`.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct MemoryEdge {
        pub id: String,
        pub source: String,
        pub target: String,
        pub kind: EdgeKind,
        /// v5: replaces `condition: Option<String>`. Slot 5 — exactly where
        /// `condition` was. Legal on every kind except `contradicts`
        /// (migration strips it there — §5.1 pass 12).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub guard: Option<EdgeGuard>,
        /// Human hint rendered on the edge label.
        #[serde(default, skip_serializing_if = "is_empty_string_opt")]
        pub note: Option<String>,
        /// v3: edge colour override (backlog "edge colour persistence" row).
        #[serde(default, skip_serializing_if = "is_empty_string_opt")]
        pub color: Option<String>,
        /// v4 (WO10): hand-edited route — flow-space points the router must
        /// pass through, in order, between source and target. Empty ⇒ the
        /// automatic orthogonal route (`src/canvas/edgePath.ts`). Omitted
        /// from output at default, per the "new fields must be OMITTED when
        /// at default value" contract rule.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub waypoints: Vec<Position>,
    }

    /// `graph.json` shape (v5). Mirrors `BarnGraph` in `src/store/graph.ts`.
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

    /// The 14 [`NodeRole`] wire values, as raw strings, used only by
    /// [`migrate_graph`]'s tolerance pre-pass (§5.1 pass 5), kept apart
    /// from [`NODE_ROLES`] (typed values) so that pre-pass stays a plain
    /// string comparison over raw JSON.
    const KNOWN_NODE_ROLE_STRS: [&str; 14] = [
        "agent", "rule", "invariant", "trap", "architecture", "decision", "workflow", "command",
        "skill", "env", "tool", "glossary", "example", "style",
    ];
    /// The 5 [`EdgeKind`] wire values, as raw strings, same purpose as
    /// [`KNOWN_NODE_ROLE_STRS`].
    const KNOWN_EDGE_KIND_STRS: [&str; 5] =
        ["imports", "references", "overrides", "sequence", "contradicts"];
    /// The 5 [`CompileTarget`] wire values, as raw strings, same purpose as
    /// [`KNOWN_NODE_ROLE_STRS`].
    const KNOWN_COMPILE_TARGET_STRS: [&str; 5] = ["claude", "agents", "cursor", "copilot", "gemini"];

    /// A condition is a glob iff it has no whitespace and at least one of
    /// `*`, `?`, `[`, `/`; otherwise it is natural language (§5.4). The
    /// SAME predicate `compile.rs` used to keep as a private `is_glob` —
    /// moved here (Stage 0, WO13_CONTRACT.md §5.4) so [`migrate_graph`] and
    /// `compile.rs` share one definition instead of two that could drift.
    /// R1 deletes `compile.rs`'s private copy and re-points it here.
    pub fn is_glob_condition(condition: &str) -> bool {
        !condition.chars().any(char::is_whitespace)
            && condition.chars().any(|c| matches!(c, '*' | '?' | '[' | '/'))
    }

    /// Pass 3+4+5 (§5.1): node role rewrite. Mutates `node["role"]` in place
    /// and stamps `node["needsReview"] = true` exactly where §5.2 says to.
    /// Order matters: `persona` → `agent` (pass 3) must run before the v4→v5
    /// rename table (pass 4) or `agent` would never be reached from
    /// `persona` directly (harmless here since `agent` isn't renamed, but
    /// the ordering is the frozen contract, not an accident of this
    /// implementation); the rename table must run before the unknown-role
    /// catch-all (pass 5) or every renamed v4 role would first be seen as
    /// unknown.
    fn migrate_node_role(node: &mut Value) {
        // Pass 3: v1's "persona" → "agent" (unchanged semantics).
        if node.get("role").and_then(Value::as_str) == Some("persona") {
            node["role"] = Value::String("agent".to_string());
        }
        // Pass 4: v4 → v5 rename table (§6.2). Only the four that actually
        // change are listed; every other v4 role name is already a valid
        // v5 role name and needs no rewrite.
        let renamed: Option<(&str, bool)> = match node.get("role").and_then(Value::as_str) {
            Some("rules") => Some(("rule", false)),
            Some("task") => Some(("workflow", true)),
            Some("reference") => Some(("architecture", true)),
            Some("snippet") => Some(("example", false)),
            _ => None,
        };
        if let Some((new_role, flag_review)) = renamed {
            node["role"] = Value::String(new_role.to_string());
            if flag_review {
                node["needsReview"] = Value::Bool(true);
            }
        }
        // Pass 5: still not a known v5 role ⇒ neutral fallback + review flag.
        let known = matches!(
            node.get("role").and_then(Value::as_str),
            Some(r) if KNOWN_NODE_ROLE_STRS.contains(&r)
        );
        if !known {
            node["role"] = Value::String("architecture".to_string());
            node["needsReview"] = Value::Bool(true);
        }
    }

    /// Pass 6+7 (§5.1): `pinned: bool` → `rootLoad?: "always"`. `pinned` is
    /// deleted unconditionally (idempotence law (a): the key it's keyed on
    /// no longer exists after this runs). Pass 7 then discards any
    /// `rootLoad` value other than `"always"` — defensive tolerance for a
    /// hand-edited or downstream-written stray value; it never touches what
    /// pass 6 itself just set, since pass 6 only ever writes `"always"` or
    /// nothing.
    fn migrate_node_root_load(node: &mut Value) {
        let pinned = node.get("pinned").and_then(Value::as_bool).unwrap_or(false);
        if pinned {
            node["rootLoad"] = Value::String("always".to_string());
        }
        if let Some(obj) = node.as_object_mut() {
            obj.remove("pinned");
        }
        let valid_root_load = node.get("rootLoad").and_then(Value::as_str) == Some("always");
        if node.get("rootLoad").is_some() && !valid_root_load {
            if let Some(obj) = node.as_object_mut() {
                obj.remove("rootLoad");
            }
        }
    }

    /// Pass 8 (§5.1, §5.4): `conditional` edges become `imports` + a typed
    /// [`EdgeGuard`], classified by [`is_glob_condition`] — the SAME
    /// predicate `compile.rs`'s `emit_cursor`/`on_demand_bullets` use. The
    /// `condition` key is deleted unconditionally, on every edge, not just
    /// former-`conditional` ones (idempotence law (a) — and a defensive
    /// clean-up of any stray `condition` a hand edit might have left on a
    /// different kind). An absent or empty `condition` produces a bare,
    /// unguarded `imports` edge — no guard at all.
    fn migrate_edge_conditional(edge: &mut Value) {
        if edge.get("kind").and_then(Value::as_str) == Some("conditional") {
            let condition = edge
                .get("condition")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            edge["kind"] = Value::String("imports".to_string());
            if let Some(c) = condition {
                edge["guard"] = if is_glob_condition(&c) {
                    serde_json::json!({ "type": "glob", "globs": [c] })
                } else {
                    serde_json::json!({ "type": "description", "text": c })
                };
            }
        }
        if let Some(obj) = edge.as_object_mut() {
            obj.remove("condition");
        }
    }

    /// Pass 9 (§5.1, §5.5): `supersedes` edges deprecate their target and
    /// are deleted. Processed in BYTE ORDER of edge id (not array order) so
    /// "the lowest-id edge wins when a node is superseded twice" is
    /// deterministic regardless of input ordering. `since`/`reason` are
    /// never set here — migration never stamps a date (§5.5); only a
    /// user-initiated deprecation in the TS-side UI does.
    fn migrate_supersedes(value: &mut Value) {
        let mut supersedes: Vec<(String, String, String)> = Vec::new();
        if let Some(edges) = value.get("edges").and_then(Value::as_array) {
            for e in edges {
                if e.get("kind").and_then(Value::as_str) == Some("supersedes") {
                    if let (Some(id), Some(source), Some(target)) = (
                        e.get("id").and_then(Value::as_str),
                        e.get("source").and_then(Value::as_str),
                        e.get("target").and_then(Value::as_str),
                    ) {
                        supersedes.push((id.to_string(), source.to_string(), target.to_string()));
                    }
                }
            }
        }
        // Byte order of edge id — `String`'s `Ord` is byte order (WO03 D5's
        // established rule throughout this module).
        supersedes.sort_by(|a, b| a.0.cmp(&b.0));

        if let Some(nodes) = value.get_mut("nodes").and_then(Value::as_array_mut) {
            for (_, source, target) in &supersedes {
                for node in nodes.iter_mut() {
                    if node.get("id").and_then(Value::as_str) == Some(target.as_str()) {
                        if node.get("deprecated").is_none() {
                            node["deprecated"] = serde_json::json!({ "replacedBy": source });
                        }
                        node["needsReview"] = Value::Bool(true);
                    }
                }
            }
        }
        if let Some(edges) = value.get_mut("edges").and_then(Value::as_array_mut) {
            edges.retain(|e| e.get("kind").and_then(Value::as_str) != Some("supersedes"));
        }
    }

    /// Pass 10+11 (§5.1): `conflicts-with` → `contradicts`, then any edge
    /// kind still not one of the 5 v5 values falls back to `references`
    /// (non-structural, same no-op-for-ordering class as before).
    fn migrate_edge_kind_rename(edge: &mut Value) {
        if edge.get("kind").and_then(Value::as_str) == Some("conflicts-with") {
            edge["kind"] = Value::String("contradicts".to_string());
        }
        let known = matches!(
            edge.get("kind").and_then(Value::as_str),
            Some(k) if KNOWN_EDGE_KIND_STRS.contains(&k)
        );
        if !known {
            edge["kind"] = Value::String("references".to_string());
        }
    }

    /// Pass 12 (§5.1): `guard` is illegal on `contradicts` (edge spec A2) —
    /// strip it. Nothing else is deleted; a `contradicts` edge keeps its
    /// `note`/`color`/`waypoints`.
    fn strip_illegal_guard(edge: &mut Value) {
        if edge.get("kind").and_then(Value::as_str) == Some("contradicts") {
            if let Some(obj) = edge.as_object_mut() {
                obj.remove("guard");
            }
        }
    }

    /// Pass 13 (§5.1, §5.6): `contradicts` normalization + dedupe. Step 1:
    /// canonicalize every `contradicts` edge to `source < target` byte-wise
    /// (a fixed point — re-running never swaps twice). Step 2: group by the
    /// canonical `(source, target)` pair; keep only the lowest-id edge in
    /// byte order, deleting every other edge in the group OUTRIGHT —
    /// including its `note`/`color`/`waypoints` (the frozen, lossy
    /// behaviour §5.6 calls out, exercised by the `e09-x` fixture case).
    /// Both steps are fixed points, so a second pass is a no-op.
    fn migrate_contradicts(value: &mut Value) {
        let Some(edges) = value.get_mut("edges").and_then(Value::as_array_mut) else {
            return;
        };
        for e in edges.iter_mut() {
            if e.get("kind").and_then(Value::as_str) != Some("contradicts") {
                continue;
            }
            let source = e.get("source").and_then(Value::as_str).unwrap_or("").to_string();
            let target = e.get("target").and_then(Value::as_str).unwrap_or("").to_string();
            if source > target {
                e["source"] = Value::String(target);
                e["target"] = Value::String(source);
            }
        }

        let mut winner: BTreeMap<(String, String), String> = BTreeMap::new();
        for e in edges.iter() {
            if e.get("kind").and_then(Value::as_str) != Some("contradicts") {
                continue;
            }
            let key = (
                e.get("source").and_then(Value::as_str).unwrap_or("").to_string(),
                e.get("target").and_then(Value::as_str).unwrap_or("").to_string(),
            );
            let id = e.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            winner
                .entry(key)
                .and_modify(|cur| {
                    if id < *cur {
                        *cur = id.clone();
                    }
                })
                .or_insert(id);
        }
        edges.retain(|e| {
            if e.get("kind").and_then(Value::as_str) != Some("contradicts") {
                return true;
            }
            let key = (
                e.get("source").and_then(Value::as_str).unwrap_or("").to_string(),
                e.get("target").and_then(Value::as_str).unwrap_or("").to_string(),
            );
            let id = e.get("id").and_then(Value::as_str).unwrap_or("");
            winner.get(&key).is_some_and(|w| w == id)
        });
    }

    /// Migration harness (mirrors `migrateGraph` in `src/store/graph.ts`).
    /// NOT a version chain (WO13_CONTRACT.md §5): a set of `serde_json::Value`
    /// pre-passes keyed on string values, run unconditionally on every load
    /// regardless of the input's `version`, in the exact order of §5.1's
    /// table — v1's `persona`→`agent` rename included, so a v1 graph
    /// migrates to v5 in one read with no intermediate write. Idempotence
    /// law: every pass is either (a) keyed on a value/key that no longer
    /// exists after it runs, or (b) a projection onto a canonical form (a
    /// fixed point by construction) — see each pass's own doc comment.
    /// `Err` for unparseable JSON, an out-of-range version, or a
    /// missing/non-array `nodes`/`edges` — mirrors the TS function's
    /// strictness there (no silent default to `[]`).
    ///
    /// WO03 audit D6's tolerance posture carries forward unchanged: unlike
    /// `compile.rs`'s `RoleIn`/`EdgeKindIn`/`TargetIn`, [`NodeRole`]/
    /// [`EdgeKind`]/[`CompileTarget`] are deliberately CLOSED enums here (no
    /// `#[serde(other)]` fallback variant) — `import.rs`'s `edge_kind_slug`
    /// and `lint.rs`'s `edge_kind_name` both exhaustively match `EdgeKind`
    /// with no wildcard arm, outside this lane's zone. So an unrecognized
    /// role/kind/target is coerced to a neutral default before typed
    /// deserialization rather than preserved — the v5 fallback for an
    /// unrecognized role is `architecture` (+ `needsReview`), not v4's
    /// `reference` (§5.1 pass 5 note: `reference` no longer exists).
    pub fn migrate_graph(raw: &str) -> Result<BarnGraph, String> {
        let mut value: Value = serde_json::from_str(raw).map_err(|e| format!("graph.json: {e}"))?;

        // Pass 1: version range check.
        let version = value
            .get("version")
            .and_then(Value::as_u64)
            .ok_or_else(|| "graph.json: missing or non-numeric version".to_string())?;
        if version < 1 || version > u64::from(GRAPH_VERSION) {
            return Err(format!("Unsupported graph.json version: {version}"));
        }

        // Pass 2: nodes/edges present and arrays.
        if !matches!(value.get("nodes"), Some(Value::Array(_)))
            || !matches!(value.get("edges"), Some(Value::Array(_)))
        {
            return Err("graph.json is missing nodes/edges arrays".to_string());
        }

        // Passes 3-5 (role), then 6-7 (pinned → rootLoad).
        if let Some(nodes) = value.get_mut("nodes").and_then(Value::as_array_mut) {
            for node in nodes.iter_mut() {
                migrate_node_role(node);
                migrate_node_root_load(node);
            }
        }

        // Pass 8 (conditional → imports+guard) must run before 9's removal
        // pass touches the edges array shape, and well before 10/11 or a
        // `conditional` edge would be flattened to `references`, losing its
        // condition.
        if let Some(edges) = value.get_mut("edges").and_then(Value::as_array_mut) {
            for edge in edges.iter_mut() {
                migrate_edge_conditional(edge);
            }
        }
        // Pass 9 (supersedes → deprecate + delete) must run before 10/11 or
        // an unconverted `supersedes` edge falls into 11's `references`
        // catch-all, losing the deprecation entirely.
        migrate_supersedes(&mut value);
        // Passes 10-11 (conflicts-with → contradicts; unknown → references),
        // then 12 (strip illegal guard on contradicts).
        if let Some(edges) = value.get_mut("edges").and_then(Value::as_array_mut) {
            for edge in edges.iter_mut() {
                migrate_edge_kind_rename(edge);
                strip_illegal_guard(edge);
            }
        }
        // Pass 13: contradicts normalization + dedupe.
        migrate_contradicts(&mut value);

        // Pass 14: unrecognized compile target dropped from the array
        // (unchanged from v4).
        if let Some(Value::Array(targets)) = value.get_mut("compileTargets") {
            targets.retain(|t| t.as_str().is_some_and(|s| KNOWN_COMPILE_TARGET_STRS.contains(&s)));
        }

        // Pass 15: typed deserialization; stamp version = 5.
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
pub use graph_v5::*;

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

/// Relative path of the one-time pre-v5 backup (WO13_CONTRACT.md §5.8).
const GRAPH_V4_BAK_REL_PATH: &str = ".cowtext/graph.v4.bak.json";

/// Write `.cowtext/graph.json` atomically. The webview is responsible for
/// stable serialization (fixed field order, LF, trailing newline).
///
/// WO13 §5.8: migration is irreversible (`migrate_graph` hard-rejects
/// `version > GRAPH_VERSION`), so before the FIRST write that would
/// overwrite a pre-v5 (`version <= 4`) `graph.json`, this takes exactly one
/// backup at `.cowtext/graph.v4.bak.json` — the pre-migration bytes,
/// verbatim. Deliberately placed here, not in `read_graph`: this is the only
/// place that holds the pre-migration bytes on disk immediately before
/// overwriting them, and it is already the sole writer. Never overwrites an
/// existing backup. A failed backup write is a hard `Err` — the
/// irreversible write does not proceed (the `?` below aborts before
/// `write_atomic(&path, ...)` runs).
#[tauri::command]
pub fn write_graph(root: String, content: String) -> Result<(), String> {
    let root_path = checked_root(&root)?;
    let path = root_path.join(GRAPH_REL_PATH);
    let bak = root_path.join(GRAPH_V4_BAK_REL_PATH);
    if path.is_file() && !bak.is_file() {
        let old = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let is_pre_v5 = serde_json::from_str::<Value>(&old)
            .ok()
            .and_then(|v| v.get("version").and_then(Value::as_u64).map(|n| n <= 4))
            .unwrap_or(false);
        if is_pre_v5 {
            write_atomic(&bak, &old)?;
        }
    }
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