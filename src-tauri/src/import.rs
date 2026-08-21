//! Round-trip importer MVP (WO03 Lane D): parses an existing repo's
//! hand-written agent-context files (`CLAUDE.md`, root/nested `AGENTS.md`,
//! `.cursor/rules/*.mdc`) into a *proposed* graph changeset, so a project
//! that already has one of these files can adopt Cowtext without starting
//! from an empty canvas.
//!
//! Invariants this module owns:
//! - **`import_scan` is READ-ONLY.** It never writes a file, never mutates
//!   `graph.json`. Its only `Err` path is [`checked_root`] rejecting a bad
//!   `root` — every other problem downgrades to a `warnings` entry, never a
//!   blocking error, so "errors XOR changeset" holds via `Result` itself
//!   (`Err` for infra failure, `Ok(ImportChangeset)` always otherwise —
//!   never both, mirroring `compile_preview`'s errors-XOR-files split one
//!   level up, at the `Result` rather than inside the payload; see the lane
//!   report for why).
//! - **`import_apply` never writes or modifies file *content*.** It only
//!   ever creates `graph.json` entries that point at files already on disk
//!   (every approved node's `filePath` is validated with
//!   [`resolve_within_root`] and required to already exist *before* the
//!   graph is touched at all) — never a general write primitive.
//! - **Never-clobber.** A node whose `filePath` already matches an existing
//!   graph node, or an edge whose `(source, target, kind)` already exists,
//!   is a no-op (counted in `skipped`), never an overwrite.
//! - **GENERATED-header detection.** A file carrying
//!   [`crate::compile::GENERATED_HEADER`] was produced by Cowtext itself
//!   and is reported `alreadyManaged` (as is any file whose path already
//!   backs a node in the current graph) — re-importing a compiled project
//!   proposes no duplicate source nodes.
//! - **Compile-output paths never become nodes.** (WO03 audit D2.) Every
//!   one of this importer's three primary file families — `CLAUDE.md`,
//!   any `AGENTS.md`, `.cursor/rules/*.mdc` — is, by definition, a path
//!   [`crate::compile`]'s write allowlist owns and will silently overwrite.
//!   A hand-written `CLAUDE.md` adopted as a node would be replaced by
//!   Compile's own generated index on the very next Compile run. Every
//!   [`ImportProposedNode`] is flagged `compileOwned` when its `filePath`
//!   is one of those shapes ([`is_compile_output_path`], which now calls
//!   `compile.rs`'s `classify_output` directly — WO13_AUDIT.md D9 deleted
//!   the re-derivation this used to carry), and [`import_apply`] independently
//!   refuses (counted in `skipped`, never a hard error) any approved node
//!   with such a path regardless of what the client sent. The file's own
//!   `@`/link edges are still extracted and proposed either way — only the
//!   node for the compile-output file itself is refused, never the targets
//!   it points at.
//!
//! ## Design note: one proposed node per file, not one per markdown section
//!
//! The contract's heuristic list mentions "markdown section structure
//! suggests node boundaries." Taken literally (one graph node per `##`
//! heading) that would require `import_apply` to *write* new `.md` files
//! for each section — which is exactly the operation `import_apply` is
//! forbidden from doing (a bug there is the single most dangerous thing in
//! this lane). So headings are used here only to *classify* the one node a
//! real file produces (title/role/brief), never to multiply it. Section
//! structure that legitimately *does* point at another already-existing
//! file — `@path/to/file.md` inline imports and `[text](path.md)` markdown
//! links — becomes its own proposed node (for the linked file) plus an
//! edge, which is the one way this importer can honestly grow the node
//! count without writing anything.

#[cfg(test)]
mod tests;

use crate::compile::GENERATED_HEADER;
use crate::project::{
    checked_root, migrate_graph, read_graph, resolve_within_root, serialize_graph, write_graph,
    BarnGraph, CompileTarget, EdgeGuard, EdgeKind, MemoryEdge, MemoryNode, NodeRole, Position,
    RootLoad, GRAPH_VERSION,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

/// Directories never worth walking for nested `AGENTS.md` files. Mirrors
/// `project.rs`'s own `SKIP_DIRS` (private there — re-derived here rather
/// than reaching into a module outside this lane's zone, same tradeoff
/// `lint.rs` already made for its own re-derived checks).
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

// ── Wire shapes (camelCase; Lane F builds the review UI against these) ──

/// A proposed Memory Node. `id` is stable only within one scan — never a
/// real graph node id until [`import_apply`] mints one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProposedNode {
    pub id: String,
    pub title: String,
    pub role: NodeRole,
    /// Where this node would live if adopted — the file it was parsed out
    /// of, or (for a discovered `@`/link target) the file it points at.
    pub file_path: String,
    pub brief: String,
    /// The file this proposal was parsed out of, e.g. "CLAUDE.md",
    /// ".cursor/rules/api.mdc" — or, for a discovered link/import target,
    /// the file that referenced it.
    pub source_file: String,
    /// True when a GENERATED-header file, or an existing graph node at the
    /// same `filePath`, means this is "already managed" rather than a
    /// fresh proposal. Still included in `nodes` (never silently dropped)
    /// so the review UI can render it disabled — see `ImportReviewModal`.
    pub already_managed: bool,
    /// DELTA from `src/import/types.ts`'s placeholder: `.mdc` frontmatter's
    /// `alwaysApply: true` maps to this. The contract originally asked for
    /// "alwaysApply ... maps to pinned ... semantics" (WO03_CONTRACT.md); the
    /// v5 taxonomy (WO13) replaces `MemoryNode.pinned: bool` with
    /// `rootLoad?: "always"`, but this field stays a plain proposal-local
    /// boolean (never itself a `MemoryNode` field) — [`apply_inner`] maps
    /// `true` to `root_load: Some(RootLoad::Always)` when the node is
    /// adopted. Always `false` for every non-`.mdc` source.
    #[serde(default)]
    pub pinned: bool,
    /// NEW FIELD (WO03 audit D2 fix): true when `filePath` is a path
    /// [`crate::compile`]'s write allowlist owns (`CLAUDE.md`, any
    /// `AGENTS.md`, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`,
    /// `GEMINI.md`, `.claude/agents/*.md`) — i.e. a file Compile will
    /// silently overwrite on its own schedule, regardless of what content
    /// is there right now. For every one of this importer's three primary
    /// file families this is unconditionally `true` (their whole shape IS
    /// a compile-output shape); it can be `false` for a discovered
    /// `@import`/link target that happens to live outside those shapes
    /// (the overwhelmingly common case for those). The review UI must
    /// default a `compileOwned` row to NOT adopted, same as
    /// `alreadyManaged` — see the lane report for the exact reconciliation
    /// this needs on the TS side. [`import_apply`] refuses these
    /// independently of this flag (never trusts a client-supplied bit for
    /// a safety check); this field exists for the UI's default state and
    /// explanation, not as the enforcement point.
    #[serde(default)]
    pub compile_owned: bool,
}

/// A proposed Memory Edge. `source`/`target` are [`ImportProposedNode::id`]
/// values, scan-local (not real graph node ids) until applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProposedEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: EdgeKind,
    /// WO13 v5: the old `conditional` edge kind is gone — a `.mdc`'s
    /// frontmatter `globs` now proposes an `imports` edge carrying a typed
    /// [`EdgeGuard::Glob`] instead (Cursor's `globs:` value is comma-joined
    /// and split back into the guard's `globs` list, same join direction
    /// `compile.rs::emit_cursor` uses). `None` for every edge this importer
    /// never anchors a glob to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard: Option<EdgeGuard>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportChangeset {
    pub nodes: Vec<ImportProposedNode>,
    pub edges: Vec<ImportProposedEdge>,
    /// Human-readable, ready to render as-is. Advisory only — never blocks
    /// review (e.g. "CLAUDE.md references missing file: docs/x.md").
    pub warnings: Vec<String>,
}

/// `import_apply`'s request body — the approved subset of a changeset.
/// Matches `Pick<ImportChangeset, "nodes" | "edges">` on the TS side.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportApproved {
    pub nodes: Vec<ImportProposedNode>,
    pub edges: Vec<ImportProposedEdge>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportApplyResult {
    pub nodes_added: usize,
    pub edges_added: usize,
    /// Adopted rows that turned out to already exist (already in the
    /// graph, or an edge whose endpoint wasn't itself adopted) — not an
    /// error, just not double-added.
    pub skipped: usize,
}

// ── Commands ─────────────────────────────────────────────────────────

/// Scan `root` for `CLAUDE.md` / `AGENTS.md` (root + nested) /
/// `.cursor/rules/*.mdc` and propose nodes + edges. Read-only: never
/// writes. `Err` only for a bad `root` (mirrors every other `checked_root`
/// caller in this crate) — every other problem degrades to a `warnings`
/// entry.
#[tauri::command]
pub fn import_scan(root: String) -> Result<ImportChangeset, String> {
    let root_path = checked_root(&root)?;
    Ok(scan_inner(&root_path))
}

/// Apply the approved subset of a changeset: create graph nodes/edges only
/// — never file content, never a clobber. See module docs for the full
/// invariant list.
#[tauri::command]
pub fn import_apply(root: String, changeset: ImportApproved) -> Result<ImportApplyResult, String> {
    apply_inner(root, changeset)
}

// ── import_scan core ────────────────────────────────────────────────

/// One file's parse result, pre-edge-resolution: the node it becomes, plus
/// the raw (already root-normalized, not yet existence-checked) targets its
/// `@`/markdown-link references point at.
struct ParsedFile {
    node: ImportProposedNode,
    at_import_targets: Vec<String>,
    link_targets: Vec<String>,
}

/// A not-yet-resolved reference discovered inside a primary file's body.
struct PendingRef {
    source_id: String,
    target_rel: String,
    kind: EdgeKind,
}

fn scan_inner(root: &Path) -> ImportChangeset {
    let existing_paths = existing_graph_node_paths(root);
    let mut nodes: Vec<ImportProposedNode> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut used_ids: HashSet<String> = HashSet::new();
    let mut path_to_id: HashMap<String, String> = HashMap::new();
    let mut id_to_source_file: HashMap<String, String> = HashMap::new();
    let mut anchor_id: Option<String> = None;
    let mut pending: Vec<PendingRef> = Vec::new();

    // 1. CLAUDE.md (root only).
    if let Some(path) = find_case_insensitive(root, "CLAUDE.md") {
        let rel = "CLAUDE.md".to_string();
        let id = fresh_scan_id(&rel, &used_ids);
        used_ids.insert(id.clone());
        match process_markdown_file(
            &path,
            rel.clone(),
            rel.clone(),
            rel.clone(),
            &existing_paths,
            id,
        ) {
            Some(pf) => {
                path_to_id.insert(pf.node.file_path.clone(), pf.node.id.clone());
                id_to_source_file.insert(pf.node.id.clone(), pf.node.source_file.clone());
                anchor_id = Some(pf.node.id.clone());
                for t in pf.at_import_targets {
                    pending.push(PendingRef {
                        source_id: pf.node.id.clone(),
                        target_rel: t,
                        kind: EdgeKind::Imports,
                    });
                }
                for t in pf.link_targets {
                    pending.push(PendingRef {
                        source_id: pf.node.id.clone(),
                        target_rel: t,
                        kind: EdgeKind::References,
                    });
                }
                nodes.push(pf.node);
            }
            None => warnings.push(format!("Could not read {rel} — skipped")),
        }
    }

    // 2. AGENTS.md, root and nested.
    for path in find_agents_files(root) {
        let rel = rel_of(root, &path);
        let dir = parent_dir(&rel);
        let title = if dir.is_empty() {
            "AGENTS.md".to_string()
        } else {
            format!("AGENTS.md ({dir})")
        };
        let id = fresh_scan_id(&rel, &used_ids);
        used_ids.insert(id.clone());
        match process_markdown_file(&path, rel.clone(), title, rel.clone(), &existing_paths, id) {
            Some(pf) => {
                path_to_id.insert(pf.node.file_path.clone(), pf.node.id.clone());
                id_to_source_file.insert(pf.node.id.clone(), pf.node.source_file.clone());
                if anchor_id.is_none() && rel == "AGENTS.md" {
                    anchor_id = Some(pf.node.id.clone());
                }
                for t in pf.at_import_targets {
                    pending.push(PendingRef {
                        source_id: pf.node.id.clone(),
                        target_rel: t,
                        kind: EdgeKind::Imports,
                    });
                }
                for t in pf.link_targets {
                    pending.push(PendingRef {
                        source_id: pf.node.id.clone(),
                        target_rel: t,
                        kind: EdgeKind::References,
                    });
                }
                nodes.push(pf.node);
            }
            None => warnings.push(format!("Could not read {rel} — skipped")),
        }
    }

    // 3. .cursor/rules/*.mdc (flat).
    let mut edges: Vec<ImportProposedEdge> = Vec::new();
    let mut seen_edge_keys: HashSet<(String, String, &'static str)> = HashSet::new();
    for path in find_mdc_files(root) {
        let rel = rel_of(root, &path);
        let id = fresh_scan_id(&rel, &used_ids);
        used_ids.insert(id.clone());
        match process_mdc_file(
            &path,
            rel.clone(),
            rel.clone(),
            &existing_paths,
            id,
            &mut warnings,
        ) {
            Some((pf, condition)) => {
                path_to_id.insert(pf.node.file_path.clone(), pf.node.id.clone());
                id_to_source_file.insert(pf.node.id.clone(), pf.node.source_file.clone());
                for t in pf.at_import_targets.iter().cloned() {
                    pending.push(PendingRef {
                        source_id: pf.node.id.clone(),
                        target_rel: t,
                        kind: EdgeKind::Imports,
                    });
                }
                for t in pf.link_targets.iter().cloned() {
                    pending.push(PendingRef {
                        source_id: pf.node.id.clone(),
                        target_rel: t,
                        kind: EdgeKind::References,
                    });
                }
                // WO03 audit D8, updated for WO13 v5: a globs condition with
                // no CLAUDE.md/root AGENTS.md scanned to anchor it must not
                // be silently dropped — report it so the node can still be
                // adopted, just without a guarded `imports` edge attached.
                // Cursor's `globs:` value is comma-joined; split back into
                // the guard's `globs` vector here.
                match (&anchor_id, condition) {
                    (Some(anchor), Some(cond)) => {
                        let globs: Vec<String> = cond
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                        if globs.is_empty() {
                            warnings.push(format!(
                                "{rel} has an empty globs list — glob condition dropped (the node itself can still be adopted)"
                            ));
                        } else {
                            push_edge(
                                &mut edges,
                                &mut seen_edge_keys,
                                anchor.clone(),
                                pf.node.id.clone(),
                                EdgeKind::Imports,
                                Some(EdgeGuard::Glob { globs }),
                            );
                        }
                    }
                    (None, Some(cond)) => {
                        warnings.push(format!(
                            "{rel} has globs ({cond}) but no CLAUDE.md/AGENTS.md was found to anchor a guarded imports edge to — glob condition dropped (the node itself can still be adopted)"
                        ));
                    }
                    (_, None) => {}
                }
                nodes.push(pf.node);
            }
            None => warnings.push(format!("Could not read {rel} — skipped")),
        }
    }

    // 4. Resolve every pending @/link target: must exist on disk, becomes
    //    its own node (or reuses an already-proposed one), then an edge.
    for p in pending {
        let exists = resolve_within_root(root, &p.target_rel)
            .map(|resolved| resolved.is_file())
            .unwrap_or(false);
        if !exists {
            let label = id_to_source_file
                .get(&p.source_id)
                .cloned()
                .unwrap_or_default();
            warnings.push(format!("{label} references missing file: {}", p.target_rel));
            continue;
        }
        let target_id = if let Some(existing) = path_to_id.get(&p.target_rel) {
            existing.clone()
        } else {
            let source_label = id_to_source_file
                .get(&p.source_id)
                .cloned()
                .unwrap_or_default();
            let id = fresh_scan_id(&p.target_rel, &used_ids);
            used_ids.insert(id.clone());
            let node =
                process_referenced_file(root, &p.target_rel, source_label, &existing_paths, id);
            let node_id = node.id.clone();
            path_to_id.insert(p.target_rel.clone(), node_id.clone());
            id_to_source_file.insert(node_id.clone(), node.source_file.clone());
            nodes.push(node);
            node_id
        };
        push_edge(&mut edges, &mut seen_edge_keys, p.source_id, target_id, p.kind, None);
    }

    ImportChangeset {
        nodes,
        edges,
        warnings,
    }
}

fn push_edge(
    edges: &mut Vec<ImportProposedEdge>,
    seen: &mut HashSet<(String, String, &'static str)>,
    source: String,
    target: String,
    kind: EdgeKind,
    guard: Option<EdgeGuard>,
) {
    let slug = edge_kind_slug(kind);
    if !seen.insert((source.clone(), target.clone(), slug)) {
        return;
    }
    let id = format!("e{}", edges.len() + 1);
    edges.push(ImportProposedEdge {
        id,
        source,
        target,
        kind,
        guard,
    });
}

/// Every existing graph node's `filePath`, for the "already managed"
/// check. Empty (never an error) when there is no graph yet, or it fails
/// to parse — that is `lint_run`'s and `compile_preview`'s job to report,
/// not this read-only scan's.
fn existing_graph_node_paths(root: &Path) -> HashSet<String> {
    let root_str = root.to_string_lossy().into_owned();
    match read_graph(root_str) {
        Ok(Some(raw)) => match migrate_graph(&raw) {
            Ok(g) => g.nodes.into_iter().map(|n| n.file_path).collect(),
            Err(_) => HashSet::new(),
        },
        _ => HashSet::new(),
    }
}

fn process_markdown_file(
    path: &Path,
    rel_path: String,
    title: String,
    source_file: String,
    existing_paths: &HashSet<String>,
    node_id: String,
) -> Option<ParsedFile> {
    let raw = fs::read_to_string(path).ok()?;
    let already_managed = has_generated_header(&raw) || existing_paths.contains(&rel_path);
    // Always true for this function's callers (CLAUDE.md, AGENTS.md) — both
    // families are compile-output shapes by definition — computed via the
    // shared shape check rather than hardcoded so `process_referenced_file`
    // (which reuses this same predicate) stays the single source of truth.
    let compile_owned = is_compile_output_path(&rel_path);
    let headings = collect_headings(&raw);
    // Filename signal, not the full relative path — a path like
    // ".cursor/rules/net.mdc" would otherwise always contain "rules" and
    // spuriously classify every single node as `Rules`.
    let stem = file_stem(&rel_path);
    let haystack = format!("{} {stem}", headings.join(" "));
    let role = infer_role(&haystack);
    let brief = first_prose_line(&raw);
    let dir = parent_dir(&rel_path);
    // D13: `@` tokens resolve relative to the containing file's own
    // directory, exactly like markdown links — Claude Code's actual
    // behavior, and Cowtext's own root-level generated output round-trips
    // identically either way (`dir` is empty at the root, so `join_dir` is
    // a no-op there; see `import/tests.rs`).
    let at_import_targets = extract_at_imports(&raw)
        .into_iter()
        .filter_map(|c| normalize_rel(&join_dir(&dir, c)))
        .collect();
    let link_targets = extract_md_links(&raw)
        .into_iter()
        .filter_map(|c| normalize_rel(&join_dir(&dir, c)))
        .collect();
    Some(ParsedFile {
        node: ImportProposedNode {
            id: node_id,
            title,
            role,
            file_path: rel_path,
            brief,
            source_file,
            already_managed,
            pinned: false,
            compile_owned,
        },
        at_import_targets,
        link_targets,
    })
}

/// Returns the parsed file plus its `globs` condition (if any) separately,
/// since [`ParsedFile`] has no field for it — only a `.mdc`'s own
/// conditional-anchor edge needs it, built by the caller.
fn process_mdc_file(
    path: &Path,
    rel_path: String,
    source_file: String,
    existing_paths: &HashSet<String>,
    node_id: String,
    warnings: &mut Vec<String>,
) -> Option<(ParsedFile, Option<String>)> {
    let raw = fs::read_to_string(path).ok()?;
    let already_managed = has_generated_header(&raw) || existing_paths.contains(&rel_path);
    // Always true here — every `.cursor/rules/*.mdc` path this function is
    // ever called with is a compile-output shape by definition.
    let compile_owned = is_compile_output_path(&rel_path);
    let (fm, body, malformed) = parse_mdc_frontmatter(&raw);
    if malformed {
        warnings.push(format!(
            "{rel_path}: unterminated frontmatter fence — treated as plain markdown"
        ));
    }
    let description = fm.get("description").cloned().unwrap_or_default();
    let pinned = fm
        .get("alwaysApply")
        .map(|v| v.trim() == "true")
        .unwrap_or(false);
    let condition = fm.get("globs").cloned().filter(|s| !s.trim().is_empty());

    let stem = file_stem(&rel_path);
    let title = if description.trim().is_empty() {
        humanize(&stem)
    } else {
        description.clone()
    };

    let headings = collect_headings(&body);
    // Filename signal via `stem`, not the full relative path — see the
    // matching comment in `process_markdown_file`.
    let haystack = format!("{} {description} {stem}", headings.join(" "));
    let role = infer_role(&haystack);
    let brief = if description.trim().is_empty() {
        first_prose_line(&body)
    } else {
        description
    };

    let dir = parent_dir(&rel_path);
    // D13: see the matching comment in `process_markdown_file`.
    let at_import_targets = extract_at_imports(&body)
        .into_iter()
        .filter_map(|c| normalize_rel(&join_dir(&dir, c)))
        .collect();
    let link_targets = extract_md_links(&body)
        .into_iter()
        .filter_map(|c| normalize_rel(&join_dir(&dir, c)))
        .collect();

    Some((
        ParsedFile {
            node: ImportProposedNode {
                id: node_id,
                title,
                role,
                file_path: rel_path,
                brief,
                source_file,
                already_managed,
                pinned,
                compile_owned,
            },
            at_import_targets,
            link_targets,
        },
        condition,
    ))
}

/// A node for a file discovered only via an `@`/link reference from a
/// primary file — never itself one of `CLAUDE.md`/`AGENTS.md`/`*.mdc`, so
/// its role/title are inferred from its own headings alone (no
/// frontmatter, no dedicated file-shape handling).
fn process_referenced_file(
    root: &Path,
    rel_path: &str,
    source_file: String,
    existing_paths: &HashSet<String>,
    node_id: String,
) -> ImportProposedNode {
    let raw = fs::read_to_string(root.join(rel_path)).unwrap_or_default();
    let already_managed = has_generated_header(&raw) || existing_paths.contains(rel_path);
    // Usually false here (a discovered @import/link target is normally an
    // ordinary content file like context/architecture.md) — but a
    // hand-written CLAUDE.md that happens to `@GEMINI.md` or link to
    // another compile-output shape must still be refused the same way.
    let compile_owned = is_compile_output_path(rel_path);
    let headings = collect_headings(&raw);
    let stem = file_stem(rel_path);
    let title = headings.first().cloned().unwrap_or_else(|| humanize(&stem));
    let haystack = format!("{} {stem}", headings.join(" "));
    let role = infer_role(&haystack);
    let brief = first_prose_line(&raw);
    ImportProposedNode {
        id: node_id,
        title,
        role,
        file_path: rel_path.to_string(),
        brief,
        source_file,
        already_managed,
        pinned: false,
        compile_owned,
    }
}

// ── Filesystem discovery ────────────────────────────────────────────

fn find_case_insensitive(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(name)
        {
            return Some(path);
        }
    }
    None
}

fn find_agents_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    walk_agents(root, &mut out);
    out.sort();
    out
}

fn walk_agents(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_dir() {
            let skip = name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref());
            if !skip {
                walk_agents(&path, out);
            }
        } else if name.eq_ignore_ascii_case("AGENTS.md") {
            out.push(path);
        }
    }
}

fn find_mdc_files(root: &Path) -> Vec<PathBuf> {
    let dir = root.join(".cursor").join("rules");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("mdc")))
        .collect();
    out.sort();
    out
}

fn rel_of(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn parent_dir(rel_path: &str) -> String {
    match Path::new(rel_path).parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_string_lossy().replace('\\', "/"),
        _ => String::new(),
    }
}

/// Join a candidate path found inside a file against that file's own
/// containing directory (root-relative, "" for a root-level file) — the
/// standard relative-path resolution both markdown links and `@` imports
/// use (WO03 audit D13: `@` was previously resolved root-relative
/// regardless of which file it was found in; Claude Code resolves it
/// relative to the containing file, same as a markdown link). For a
/// root-level file `dir` is empty and this is a no-op, which is exactly
/// why Cowtext's own generated root-level output — the only place
/// `compile.rs` ever emits an `@` token — round-trips identically under
/// either interpretation; see `import/tests.rs` for the fixture that pins
/// this.
fn join_dir(dir: &str, candidate: String) -> String {
    if dir.is_empty() {
        candidate
    } else {
        format!("{dir}/{candidate}")
    }
}

fn file_stem(rel_path: &str) -> String {
    Path::new(rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| rel_path.to_string())
}

// ── GENERATED-header detection ──────────────────────────────────────

/// Mirrors `compile.rs`'s own `has_header` (private there): true when one
/// of the first 10 trimmed lines is exactly the GENERATED header. Depends
/// on the shared [`GENERATED_HEADER`] constant rather than a hardcoded
/// copy of the string, so this can never silently drift from what
/// `compile.rs` actually writes.
fn has_generated_header(content: &str) -> bool {
    content
        .lines()
        .take(10)
        .any(|l| l.trim() == GENERATED_HEADER)
}

// ── Compile-output-path detection (WO03 audit D2 fix) ───────────────

/// True for every path shape `compile.rs`'s write allowlist
/// (`classify_output`) accepts — `CLAUDE.md`, any path ending in
/// `AGENTS.md`, one component under `.cursor/rules/` with an `.mdc`
/// extension, `.github/copilot-instructions.md`, `GEMINI.md` at the project
/// root, one `.md` component directly under `.claude/agents/`, or
/// (WO13 Amendment 1, §10.5) one `.md` component directly under
/// `.claude/commands/`.
///
/// WO13_AUDIT.md D9 (fix-round Stage 0): calls the ONE `classify_output`
/// (`compile.rs`, now `pub(crate)`) directly instead of the flagged
/// re-derivation this function used to carry. That copy was **stale**: it
/// predated R1's `.claude/commands/` arm, so a changeset naming
/// `.claude/commands/deploy.md` passed this check and was admitted by
/// `import_apply` — the WO03-D2 guard this whole module exists to enforce
/// had a hole. `.is_some()` collapses `classify_output`'s `Some(true)` vs
/// `Some(false)` (surgical-edit vs fully-generated) distinction, which this
/// check never needed — both are equally "compile owns this path."
fn is_compile_output_path(rel: &str) -> bool {
    crate::compile::classify_output(rel).is_some()
}

// ── .mdc frontmatter (hand-rolled, scoped to this module) ──────────────

/// `(fields, body, malformed)`. `malformed` is true only for an opened but
/// never-closed `---` fence; no leading `---` at all is not malformed, just
/// "no frontmatter" (fields empty, body = whole content).
fn parse_mdc_frontmatter(content: &str) -> (HashMap<String, String>, String, bool) {
    let mut chunks = content.split_inclusive('\n');
    let Some(first_chunk) = chunks.next() else {
        return (HashMap::new(), content.to_string(), false);
    };
    if first_chunk.trim_end_matches(['\n', '\r']).trim() != "---" {
        return (HashMap::new(), content.to_string(), false);
    }
    let mut consumed = first_chunk.len();
    let mut map = HashMap::new();
    loop {
        let Some(chunk) = chunks.next() else {
            return (HashMap::new(), content.to_string(), true);
        };
        let line = chunk.trim_end_matches(['\n', '\r']);
        consumed += chunk.len();
        if line.trim() == "---" {
            let body = content.get(consumed..).unwrap_or("").to_string();
            return (map, body, false);
        }
        if let Some((k, v)) = line.split_once(':') {
            map.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
        }
    }
}

// ── Heading / role / brief heuristics ───────────────────────────────

fn collect_headings(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(|l| {
            let t = l.trim_start();
            if !t.starts_with('#') {
                return None;
            }
            let hashes = t.chars().take_while(|&c| c == '#').count();
            if hashes == 0 || hashes > 6 {
                return None;
            }
            let rest = t[hashes..].trim();
            if rest.is_empty() {
                None
            } else {
                Some(rest.to_string())
            }
        })
        .collect()
}

/// First non-empty, non-heading line, trimmed and capped at 160 chars —
/// used as a one-line `brief` when nothing better (an `.mdc` description)
/// is available.
fn first_prose_line(body: &str) -> String {
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        return t.chars().take(160).collect();
    }
    String::new()
}

/// Priority-ordered keyword → role table (first match in `haystack` wins).
/// Deliberately checked against headings/filenames/descriptions only, never
/// full body prose — scanning prose would false-positive constantly (any
/// paragraph that happens to mention "task" in passing). `Architecture` is
/// the catch-all default (WO13_CONTRACT.md §17 "known required edits": the
/// v5 role set drops `reference`, whose old fallback slot this now fills —
/// `project.rs::migrate_graph`'s own unknown-role fallback made the same
/// change, pass 5 of its migration table).
fn infer_role(haystack: &str) -> NodeRole {
    const TABLE: &[(&[&str], NodeRole)] = &[
        (&["hard rule", "invariant", "must not"], NodeRole::Invariant),
        (&["rule"], NodeRole::Rule),
        (&["architecture"], NodeRole::Architecture),
        (&["workflow"], NodeRole::Workflow),
        (&["command"], NodeRole::Command),
        // v5: `task` no longer exists as a role — migration's own v4->v5
        // table maps it to `workflow` (§6.2), so the importer's heuristic
        // follows the same target.
        (&["task"], NodeRole::Workflow),
        (&["glossary", "terminology"], NodeRole::Glossary),
        (&["persona", "agent"], NodeRole::Agent),
        (&["trap", "gotcha", "pitfall", "footgun"], NodeRole::Trap),
        (&["skill"], NodeRole::Skill),
        // v5: `snippet` is renamed `example` (§6.2).
        (&["snippet", "example"], NodeRole::Example),
        (&["style", "convention", "format"], NodeRole::Style),
    ];
    let h = haystack.to_lowercase();
    for &(keywords, role) in TABLE {
        if keywords.iter().any(|k| h.contains(k)) {
            return role;
        }
    }
    NodeRole::Architecture
}

fn humanize(stem: &str) -> String {
    let mut out = String::new();
    let mut capitalize_next = true;
    for c in stem.chars() {
        if c == '-' || c == '_' {
            out.push(' ');
            capitalize_next = true;
        } else if capitalize_next {
            out.extend(c.to_uppercase());
            capitalize_next = false;
        } else {
            out.push(c);
        }
    }
    out
}

// ── @-import / markdown-link extraction ─────────────────────────────

fn is_path_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'/' | b'.' | b'-' | b'_')
}

/// `@path/to/file.md` tokens — the inline-import syntax `compile.rs` writes
/// for `claude`/`gemini` root files (`format!("@{}", n.file_path)`).
fn extract_at_imports(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in body.lines() {
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] != b'@' {
                i += 1;
                continue;
            }
            let start = i + 1;
            let mut j = start;
            while j < bytes.len() && is_path_byte(bytes[j]) {
                j += 1;
            }
            // Trim trailing sentence punctuation ("see @x.md." at the end
            // of a sentence) — a lone trailing '.' is never part of a real
            // path here, so stripping it can only turn a false negative
            // into a correct match, never the reverse.
            let candidate = line[start..j].trim_end_matches('.');
            if !candidate.is_empty() && candidate.to_ascii_lowercase().ends_with(".md") {
                out.push(candidate.to_string());
            }
            i = j.max(start);
        }
    }
    out
}

/// `[text](path.md)` / `[text](path.md "title")` local markdown links.
/// Hand-rolled (no regex crate). Byte-index slicing here is always on a
/// valid UTF-8 boundary: every index used comes from a literal single-byte
/// ASCII delimiter (`[`, `]`, `(`, `)`) or from `str::find`, which only
/// ever returns boundary-valid offsets.
fn extract_md_links(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'[' {
            i += 1;
            continue;
        }
        let Some(close_bracket) = body[i + 1..].find(']') else {
            i += 1;
            continue;
        };
        let bracket_end = i + 1 + close_bracket;
        let after = bracket_end + 1;
        if after >= bytes.len() || bytes[after] != b'(' {
            i += 1;
            continue;
        }
        let Some(close_paren) = body[after + 1..].find(')') else {
            i += 1;
            continue;
        };
        let paren_end = after + 1 + close_paren;
        let inner = &body[after + 1..paren_end];
        let path_part = inner.split_whitespace().next().unwrap_or("");
        let path_part = path_part.trim_matches(|c| c == '<' || c == '>');
        if is_local_md_link(path_part) {
            out.push(strip_fragment(path_part).to_string());
        }
        i = paren_end + 1;
    }
    out
}

fn is_local_md_link(path: &str) -> bool {
    if path.is_empty() || path.starts_with('#') {
        return false;
    }
    if path.contains("://") || path.starts_with("mailto:") {
        return false;
    }
    strip_fragment(path).to_ascii_lowercase().ends_with(".md")
}

fn strip_fragment(path: &str) -> &str {
    match path.find('#') {
        Some(idx) => &path[..idx],
        None => path,
    }
}

/// Lexically resolve `.`/`..` segments. `None` when it would climb above
/// the root it's relative to (never treated as an error — the reference is
/// just dropped, same as any other candidate that turns out not to exist).
fn normalize_rel(path: &str) -> Option<String> {
    let mut stack: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => stack.pop().map(|_| ())?,
            s => stack.push(s),
        }
    }
    if stack.is_empty() {
        return None;
    }
    Some(stack.join("/"))
}

// ── Shared id helpers (scan-local ids and apply-time graph ids alike) ──

fn slugify_component(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = true;
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "node".to_string()
    } else {
        out
    }
}

fn unique_id(base: String, existing: &HashSet<String>) -> String {
    if !existing.contains(&base) {
        return base;
    }
    let mut n = 2u32;
    loop {
        let candidate = format!("{base}-{n}");
        if !existing.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

fn fresh_scan_id(rel_path: &str, used: &HashSet<String>) -> String {
    unique_id(slugify_component(rel_path), used)
}

fn edge_kind_slug(kind: EdgeKind) -> &'static str {
    match kind {
        EdgeKind::Imports => "imports",
        EdgeKind::References => "references",
        EdgeKind::Overrides => "overrides",
        EdgeKind::Sequence => "sequence",
        EdgeKind::Contradicts => "contradicts",
    }
}

// ── import_apply core ────────────────────────────────────────────────

fn apply_inner(root: String, changeset: ImportApproved) -> Result<ImportApplyResult, String> {
    let root_path = checked_root(&root)?;

    // Validate every approved node's filePath BEFORE touching the graph at
    // all (preset_apply's own precedent: "validate every path before
    // writing anything, so a bad request can never leave a half-applied
    // result"). import_apply only ever points a graph entry at a file that
    // genuinely already exists inside the project root.
    for n in &changeset.nodes {
        let resolved = resolve_within_root(&root_path, &n.file_path)?;
        if !resolved.is_file() {
            return Err(format!("Not a file: {}", n.file_path));
        }
    }

    let mut graph = match read_graph(root.clone())? {
        Some(raw) => migrate_graph(&raw)?,
        None => BarnGraph {
            version: GRAPH_VERSION,
            project_name: String::new(),
            nodes: Vec::new(),
            edges: Vec::new(),
            compile_targets: vec![CompileTarget::Claude],
        },
    };

    let mut used_ids: HashSet<String> = graph.nodes.iter().map(|n| n.id.clone()).collect();
    let mut path_to_id: HashMap<String, String> = graph
        .nodes
        .iter()
        .map(|n| (n.file_path.clone(), n.id.clone()))
        .collect();
    let mut used_edge_ids: HashSet<String> = graph.edges.iter().map(|e| e.id.clone()).collect();
    let mut existing_edge_keys: HashSet<(String, String, &'static str)> = graph
        .edges
        .iter()
        .map(|e| (e.source.clone(), e.target.clone(), edge_kind_slug(e.kind)))
        .collect();

    let mut id_map: HashMap<String, String> = HashMap::new();
    let mut nodes_added = 0usize;
    let mut edges_added = 0usize;
    let mut skipped = 0usize;

    for n in &changeset.nodes {
        if is_compile_output_path(&n.file_path) {
            // WO03 audit D2: never let import_apply create a node whose
            // file Compile itself owns and will silently overwrite
            // (CLAUDE.md, any AGENTS.md, .cursor/rules/*.mdc,
            // .github/copilot-instructions.md, GEMINI.md,
            // .claude/agents/*.md) — a hand-written CLAUDE.md adopted as a
            // node must never be replaced by Compile's own 12-line index.
            // Independent of `n.compile_owned` / whatever the client sent:
            // this is the actual security boundary, not merely the UI
            // default. No `id_map` entry is created, so any edge sourced
            // from or targeting this scan-local id falls through to the
            // "missing endpoint" skip below — never silently reattached to
            // something else.
            skipped += 1;
            continue;
        }
        if let Some(real_id) = path_to_id.get(&n.file_path) {
            // Never-clobber: a node already points at this file. The
            // pre-existing node wins; this is a no-op, not an overwrite.
            id_map.insert(n.id.clone(), real_id.clone());
            skipped += 1;
            continue;
        }
        let real_id = unique_id(
            format!("import-{}", slugify_component(&n.file_path)),
            &used_ids,
        );
        used_ids.insert(real_id.clone());
        path_to_id.insert(n.file_path.clone(), real_id.clone());
        id_map.insert(n.id.clone(), real_id.clone());
        graph.nodes.push(MemoryNode {
            id: real_id,
            title: n.title.clone(),
            role: n.role,
            brief: n.brief.clone(),
            file_path: n.file_path.clone(),
            read_order: 0,
            root_load: if n.pinned { Some(RootLoad::Always) } else { None },
            position: Position::default(),
            scene_pos: None,
            last_verified: None,
            tags: Vec::new(),
            owner: None,
            deprecated: None,
            needs_review: false,
            meta: None,
        });
        nodes_added += 1;
    }

    for e in &changeset.edges {
        let source = id_map.get(&e.source).cloned();
        let target = id_map.get(&e.target).cloned();
        let (Some(source), Some(target)) = (source, target) else {
            // References a node outside the approved subset — never
            // invent an endpoint.
            skipped += 1;
            continue;
        };
        let slug = edge_kind_slug(e.kind);
        let key = (source.clone(), target.clone(), slug);
        if existing_edge_keys.contains(&key) {
            skipped += 1;
            continue;
        }
        let edge_id = unique_id(format!("import-{source}-{target}-{slug}"), &used_edge_ids);
        used_edge_ids.insert(edge_id.clone());
        existing_edge_keys.insert(key);
        graph.edges.push(MemoryEdge {
            id: edge_id,
            source,
            target,
            kind: e.kind,
            guard: e.guard.clone(),
            note: None,
            color: None,
            waypoints: Vec::new(),
        });
        edges_added += 1;
    }

    if nodes_added > 0 || edges_added > 0 {
        let content = serialize_graph(&graph);
        write_graph(root, content)?;
    }

    Ok(ImportApplyResult {
        nodes_added,
        edges_added,
        skipped,
    })
}
