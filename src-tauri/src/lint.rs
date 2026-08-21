//! Linter v1+v5 (WO03 Lane E, extended WO13 Lane R2): unifies compile's
//! graph-integrity checks (cycle, missing file, dangling edge) with
//! conflict / duplication / staleness / load-policy checks into one
//! read-only [`Problems`] payload for the frontend Problems panel, the
//! `cowtext-cli lint` exit-code gate and `cowtext-mcp`.
//!
//! `lint_run` is READ-ONLY: it never writes a file and never mutates the
//! graph. All filesystem access goes through `project.rs`'s path guards
//! ([`checked_root`]/[`resolve_within_root`]) — the webview never hands us
//! a raw path we trust unchecked. Every emitted [`LintFix`] is applied
//! through the frontend's EXISTING graph-store actions (`deleteEdges`,
//! `updateNode`, `addEdge`) — lint itself never mutates anything
//! (WO13_CONTRACT.md §11.3).
//!
//! Cycle/missing-file/dangling-edge are **re-derived** here from
//! `project.rs`'s canonical model rather than imported from `compile.rs`
//! (contract: lint.rs may not touch compile.rs). The Kahn's-algorithm +
//! cycle-recovery pass below (`check_cycle`/`find_cycle`) is structurally
//! the same two-function shape as `compile.rs`'s `total_order`/
//! `find_cycle` — that is real, acknowledged duplication (see the lane
//! report), not an oversight.
//!
//! **Load-policy checks share ONE `AlwaysClosure` computation**, computed
//! via `crate::resolve_load::always_closure` — the WO13_CONTRACT.md §8.3
//! shared decider, never a private re-derivation. `edge-legality-warning`
//! is the one exception: `src/config/edgeRules.ts`'s specificity-scored
//! rule table has no Rust mirror anywhere in the tree (no lane owns one),
//! so this module re-derives the SAME frozen §7.3 table as a private,
//! read-only match — the identical cross-language-boundary tradeoff this
//! file already made for its cycle detector, flagged in the lane report as
//! a drift risk worth a future differential test once `edgeRules.ts` lands.

#[cfg(test)]
mod tests;

use crate::project::{
    checked_root, migrate_graph, read_graph, resolve_within_root, BarnGraph, Deprecated, EdgeGuard,
    EdgeKind, MemoryEdge, MemoryNode, NodeRole, RootLoad,
};
use crate::resolve_load::{self, GuardKind, LoadEdgeKind, LoadRole, RoleLock};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

// ── Tunable thresholds (named, never magic numbers) ────────────────────

/// A `lastVerified` date older than this many days is flagged stale.
/// ~6 months: long enough that routine edits don't trip it, short enough
/// that a node can silently rot for a release cycle without a nudge.
const STALE_LAST_VERIFIED_DAYS: i64 = 180;

/// Minimum non-trivial (trimmed, non-empty) line count a node's content
/// must have before the README-duplication check even considers it —
/// guards against flagging one-line stub nodes that trivially share a
/// line ("# Title") with the README.
const README_DUP_MIN_LINES: usize = 3;

/// Fraction of a node's non-trivial lines that must also appear verbatim
/// (after normalization) in README.md for the node to be flagged as
/// "substantially copied from README".
const README_DUP_LINE_OVERLAP: f64 = 0.7;

/// Minimum normalized-content length (chars) before two nodes' content is
/// even considered for the near-duplicate-content check — guards against
/// two near-empty stub files trivially hashing equal.
const NEAR_DUP_MIN_NORMALIZED_LEN: usize = 40;

/// Warning threshold for the always-loaded set's total token estimate
/// (WO13_CONTRACT.md §11.2) — ~5% of the 200k context window, the point at
/// which always-context starts crowding the task itself.
const ALWAYS_BUDGET_TOKENS: u64 = 10_000;

// ── Wire shape (Lane F builds the Problems panel against this) ─────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    /// WO13: third tier, below `Warning` — used only by `duplicate-imports`.
    Info,
}

/// Stable, machine-readable check identity. Kebab-case on the wire.
/// WO13_CONTRACT.md §11.2: `conflicts-with` is renamed `contradicts`;
/// `superseded-but-pinned` is RETIRED (its edge kind, `supersedes`, no
/// longer exists on the v5 wire — a `supersedes` edge is deleted and its
/// target deprecated by migration, see `project.rs::migrate_graph`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LintCode {
    Cycle,
    MissingFile,
    DanglingEdge,
    Contradicts,
    DuplicateTitle,
    NearDuplicateContent,
    ReadmeDuplication,
    StaleLastVerified,
    SequenceNotCoResident,
    OverrideNotCoResident,
    StructuralEdgeIntoDeprecated,
    OrphanNode,
    UnreachableImport,
    AlwaysBudgetExceeded,
    DuplicateImports,
    CommandMayBeEnv,
    EdgeLegalityWarning,
}

/// A small closed enum of graph edits (WO13_CONTRACT.md §11.3), applied by
/// the frontend through the EXISTING graph-store actions
/// (`deleteEdges`/`updateNode`/`addEdge`) — every fix is reversible via
/// existing undo for free, and lint itself never mutates the graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LintFix {
    // The enum-level `rename_all` renames variant NAMES only (the `kind`
    // tag) — it does not reach the fields inside a struct-like variant, so
    // each variant needs its own `rename_all` to get `edgeId`/`nodeId`
    // rather than `edge_id`/`node_id` on the wire.
    #[serde(rename_all = "camelCase")]
    DropEdge { edge_id: String },
    #[serde(rename_all = "camelCase")]
    RetypeNode { node_id: String, role: NodeRole },
    AddImports { source: String, target: String },
}

/// One lint finding. `node_ids`/`edge_ids`/`file_path` are the navigation
/// handles the UI needs to jump to the offender — omitted from the wire
/// when empty/absent rather than serialized as `[]`/`null`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LintItem {
    pub code: LintCode,
    pub severity: Severity,
    /// Human-readable, ready to render as-is.
    pub message: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub node_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub edge_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix: Option<LintFix>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Problems {
    pub items: Vec<LintItem>,
}

// ── Command ──────────────────────────────────────────────────────────

/// Run every lint check against the project's current `graph.json`.
/// `Ok(Problems { items: vec![] })` for a project with no graph yet (there
/// is nothing to lint) — that is not an error. Read-only: never writes.
#[tauri::command]
pub fn lint_run(root: String) -> Result<Problems, String> {
    let root_path = checked_root(&root)?;
    let items = match read_graph(root.clone())? {
        Some(raw) => {
            let graph = migrate_graph(&raw)?;
            lint_graph(&root_path, &graph)
        }
        None => Vec::new(),
    };
    Ok(Problems { items })
}

/// Pure core: every check, run in a fixed, deterministic order. Split out
/// of [`lint_run`] so a future non-Tauri caller (`cowtext-cli lint`,
/// `cowtext-mcp`) can call it directly without a webview.
pub fn lint_graph(root: &Path, graph: &BarnGraph) -> Vec<LintItem> {
    let mut items = Vec::new();
    let id_to_idx: HashMap<&str, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();

    // Dangling edges first — every later check that walks edges works off
    // `live_edges` so a dangling edge is reported once, not re-reported by
    // every downstream check that happens to also touch it.
    let live_edges = check_dangling_edges(graph, &id_to_idx, &mut items);
    check_missing_files(root, graph, &mut items);
    check_cycle(graph, &live_edges, &id_to_idx, &mut items);
    check_contradicts(graph, &live_edges, &mut items);
    check_duplicate_titles(graph, &mut items);
    check_near_duplicate_content(root, graph, &mut items);
    check_readme_duplication(root, graph, &mut items);
    check_stale_last_verified(graph, &mut items);
    check_structural_edge_into_deprecated(graph, &live_edges, &mut items);
    check_command_may_be_env(root, graph, &mut items);
    check_edge_legality_warning(graph, &live_edges, &mut items);

    // Load-policy-dependent checks share ONE `AlwaysClosure` computation
    // via `resolve_load::always_closure` — the §8.3 shared decider, never a
    // private re-derivation (§18.4's "one implementation" gate).
    let (facts_nodes, facts_edges) = project_load_facts(graph, &live_edges);
    let seeds: Vec<&str> = facts_nodes
        .iter()
        .filter(|n| n.root_always && !n.deprecated)
        .map(|n| n.id.as_str())
        .collect();
    let closure = resolve_load::always_closure(&facts_nodes, &facts_edges, &seeds, RoleLock::Apply);
    check_sequence_not_co_resident(graph, &live_edges, &closure, &mut items);
    check_override_not_co_resident(graph, &live_edges, &closure, &mut items);
    check_duplicate_imports(graph, &live_edges, &closure, &mut items);
    check_orphan_and_unreachable_import(graph, &live_edges, &closure, &mut items);
    check_always_budget_exceeded(root, graph, &closure, &mut items);

    items
}

// ── Graph-integrity checks (re-derived from compile.rs's shape) ────────

fn edge_kind_name(kind: EdgeKind) -> &'static str {
    match kind {
        EdgeKind::Imports => "imports",
        EdgeKind::References => "references",
        EdgeKind::Overrides => "overrides",
        EdgeKind::Sequence => "sequence",
        EdgeKind::Contradicts => "contradicts",
    }
}

/// Reports one item per dangling end (an edge with both ends missing
/// reports twice, once per end — mirrors `compile.rs`'s behavior). Returns
/// the edges whose source AND target both resolve, for downstream checks.
fn check_dangling_edges<'a>(
    graph: &'a BarnGraph,
    id_to_idx: &HashMap<&str, usize>,
    items: &mut Vec<LintItem>,
) -> Vec<&'a MemoryEdge> {
    let mut live = Vec::new();
    for e in &graph.edges {
        let mut dangling = false;
        for end in [&e.source, &e.target] {
            if !id_to_idx.contains_key(end.as_str()) {
                dangling = true;
                items.push(LintItem {
                    code: LintCode::DanglingEdge,
                    severity: Severity::Error,
                    message: format!(
                        "Edge \"{}\" ({}) references missing node \"{end}\"",
                        e.id,
                        edge_kind_name(e.kind)
                    ),
                    node_ids: Vec::new(),
                    edge_ids: vec![e.id.clone()],
                    file_path: None,
                    fix: None,
                });
            }
        }
        if !dangling {
            live.push(e);
        }
    }
    live
}

/// Reported in `(readOrder, id)` order, matching `compile.rs`.
fn check_missing_files(root: &Path, graph: &BarnGraph, items: &mut Vec<LintItem>) {
    let mut by_read_order: Vec<&MemoryNode> = graph.nodes.iter().collect();
    by_read_order.sort_by(|a, b| (a.read_order, &a.id).cmp(&(b.read_order, &b.id)));
    for n in by_read_order {
        let missing = match resolve_within_root(root, &n.file_path) {
            Ok(p) => !p.is_file(),
            Err(_) => true,
        };
        if missing {
            items.push(LintItem {
                code: LintCode::MissingFile,
                severity: Severity::Error,
                message: format!("\"{}\" points at a missing file: {}", n.title, n.file_path),
                node_ids: vec![n.id.clone()],
                edge_ids: Vec::new(),
                file_path: Some(n.file_path.clone()),
                fix: None,
            });
        }
    }
}

/// Kahn's algorithm over the structural constraint graph
/// ([`EdgeKind::is_structural`]: `imports`, `sequence`, `overrides`).
/// `sequence`: source before target. `imports`: the imported node must be
/// established first, so target before source. `overrides`: this lane's
/// own convention — the overridden (target) node is the base and must be
/// established before the override (source) is layered on, so target
/// before source, same direction as `imports` (matches `compile.rs`'s
/// `total_order`).
fn check_cycle(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
    id_to_idx: &HashMap<&str, usize>,
    items: &mut Vec<LintItem>,
) {
    let n = graph.nodes.len();
    let mut indeg = vec![0usize; n];
    let mut succ: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut pred: Vec<Vec<usize>> = vec![Vec::new(); n];
    for e in live_edges {
        // WO13 §9: a guarded `imports` edge is conditional content and must
        // NOT enter Kahn's algorithm — `edge_participates_in_order` is the
        // frozen predicate both `compile.rs` and this module key on.
        let guarded = e.guard.is_some();
        if !crate::project::edge_participates_in_order(e.kind, guarded) {
            continue;
        }
        let s = id_to_idx[e.source.as_str()];
        let t = id_to_idx[e.target.as_str()];
        let (u, v) = match e.kind {
            EdgeKind::Sequence => (s, t),
            EdgeKind::Imports | EdgeKind::Overrides => (t, s),
            EdgeKind::References | EdgeKind::Contradicts => {
                unreachable!("non-structural kinds filtered by edge_participates_in_order above")
            }
        };
        succ[u].push(v);
        pred[v].push(u);
        indeg[v] += 1;
    }

    let mut ready = BinaryHeap::new();
    for (i, node) in graph.nodes.iter().enumerate() {
        if indeg[i] == 0 {
            ready.push(Reverse((node.read_order, node.id.clone(), i)));
        }
    }
    let mut order = Vec::with_capacity(n);
    while let Some(Reverse((_, _, i))) = ready.pop() {
        order.push(i);
        for &v in &succ[i] {
            indeg[v] -= 1;
            if indeg[v] == 0 {
                ready.push(Reverse((graph.nodes[v].read_order, graph.nodes[v].id.clone(), v)));
            }
        }
    }

    if order.len() == n {
        return;
    }

    let cycle = find_cycle(&graph.nodes, &pred, &order);
    let node_ids: Vec<String> = cycle.iter().map(|c| c.id.clone()).collect();
    let titles: Vec<&str> = cycle.iter().map(|c| c.title.as_str()).collect();
    items.push(LintItem {
        code: LintCode::Cycle,
        severity: Severity::Error,
        message: format!("Cycle: {}", titles.join(" -> ")),
        node_ids,
        edge_ids: Vec::new(),
        file_path: None,
        fix: None,
    });
}

struct CycleNodeRef {
    id: String,
    title: String,
}

/// Recover one concrete cycle from the residual constraint graph — same
/// algorithm as `compile.rs`'s `find_cycle`: every residual node kept a
/// residual predecessor, so walking predecessors must revisit a node
/// within n steps; the revisited segment, reversed, is a forward cycle.
/// Choices are made by smallest node id so the report is deterministic.
fn find_cycle(nodes: &[MemoryNode], pred: &[Vec<usize>], done: &[usize]) -> Vec<CycleNodeRef> {
    let mut in_residual = vec![true; nodes.len()];
    for &i in done {
        in_residual[i] = false;
    }
    let start = (0..nodes.len())
        .filter(|&i| in_residual[i])
        .min_by(|&a, &b| nodes[a].id.cmp(&nodes[b].id))
        .expect("residual is non-empty when a cycle exists");
    let mut path = vec![start];
    loop {
        let cur = *path.last().expect("path never empty");
        let prev = pred[cur]
            .iter()
            .copied()
            .filter(|&p| in_residual[p])
            .min_by(|&a, &b| nodes[a].id.cmp(&nodes[b].id))
            .expect("residual nodes keep a residual predecessor");
        if let Some(hit) = path.iter().position(|&x| x == prev) {
            let mut cycle = vec![prev];
            cycle.extend(path[hit + 1..].iter().rev().copied());
            cycle.push(prev);
            return cycle
                .into_iter()
                .map(|i| CycleNodeRef {
                    id: nodes[i].id.clone(),
                    title: nodes[i].title.clone(),
                })
                .collect();
        }
        path.push(prev);
    }
}

// ── Conflict checks ─────────────────────────────────────────────────────

/// Explicit `contradicts` edges, one item per edge. WO13 rename of the v3/v4
/// `conflicts-with` check — same shape, new kind/code names.
fn check_contradicts(graph: &BarnGraph, live_edges: &[&MemoryEdge], items: &mut Vec<LintItem>) {
    let id_to_title: HashMap<&str, &str> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.title.as_str()))
        .collect();
    for e in live_edges {
        if e.kind != EdgeKind::Contradicts {
            continue;
        }
        let source_title = id_to_title.get(e.source.as_str()).copied().unwrap_or(&e.source);
        let target_title = id_to_title.get(e.target.as_str()).copied().unwrap_or(&e.target);
        items.push(LintItem {
            code: LintCode::Contradicts,
            severity: Severity::Warning,
            message: format!("\"{source_title}\" contradicts \"{target_title}\""),
            node_ids: vec![e.source.clone(), e.target.clone()],
            edge_ids: vec![e.id.clone()],
            file_path: None,
            fix: None,
        });
    }
}

/// Nodes whose (trimmed, case-folded) titles collide. Empty titles are
/// exempt — many untitled placeholder nodes sharing "" is not a useful
/// signal. One item per duplicate cluster, not per pair.
fn check_duplicate_titles(graph: &BarnGraph, items: &mut Vec<LintItem>) {
    let mut groups: BTreeMap<String, Vec<&MemoryNode>> = BTreeMap::new();
    for n in &graph.nodes {
        let key = n.title.trim().to_lowercase();
        if key.is_empty() {
            continue;
        }
        groups.entry(key).or_default().push(n);
    }
    for nodes in groups.values() {
        if nodes.len() < 2 {
            continue;
        }
        let mut nodes = nodes.clone();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));
        let node_ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
        items.push(LintItem {
            code: LintCode::DuplicateTitle,
            severity: Severity::Warning,
            message: format!(
                "{} nodes share the title \"{}\"",
                nodes.len(),
                nodes[0].title
            ),
            node_ids,
            edge_ids: Vec::new(),
            file_path: None,
            fix: None,
        });
    }
}

/// Whitespace-collapsed, lower-cased content. "Near-duplicate" in this v1
/// check means "identical after normalization" (case/whitespace-insensitive
/// exact match via content hash) — not fuzzy similarity; there is no
/// approximate-similarity crate in this dependency-frozen repo.
fn normalize_content(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn content_hash(normalized: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    hasher.finish()
}

/// Node-vs-node near-duplicate content, grouped by normalized-content hash.
/// Nodes whose file is unreadable/missing are silently skipped here — the
/// missing-file check already reports that.
fn check_near_duplicate_content(root: &Path, graph: &BarnGraph, items: &mut Vec<LintItem>) {
    let mut by_hash: BTreeMap<u64, Vec<&MemoryNode>> = BTreeMap::new();
    for n in &graph.nodes {
        let Ok(path) = resolve_within_root(root, &n.file_path) else {
            continue;
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let normalized = normalize_content(&raw);
        if normalized.len() < NEAR_DUP_MIN_NORMALIZED_LEN {
            continue;
        }
        by_hash.entry(content_hash(&normalized)).or_default().push(n);
    }
    for nodes in by_hash.values() {
        if nodes.len() < 2 {
            continue;
        }
        let mut nodes = nodes.clone();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));
        let node_ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
        let titles: Vec<&str> = nodes.iter().map(|n| n.title.as_str()).collect();
        items.push(LintItem {
            code: LintCode::NearDuplicateContent,
            severity: Severity::Warning,
            message: format!("Near-duplicate content across nodes: {}", titles.join(", ")),
            node_ids,
            edge_ids: Vec::new(),
            file_path: None,
            fix: None,
        });
    }
}

// ── Duplication vs README ───────────────────────────────────────────────

/// Root-level, case-insensitive `README.md` lookup (not recursive — mirrors
/// how a project has exactly one top-level README). `root` is already
/// guard-checked by the caller; this only lists its direct entries.
fn find_readme(root: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if entry.file_name().to_string_lossy().to_lowercase() == "readme.md" {
            return Some(path);
        }
    }
    None
}

fn normalized_lines(raw: &str) -> Vec<String> {
    raw.lines()
        .map(|l| l.trim().to_lowercase())
        .filter(|l| !l.is_empty())
        .collect()
}

/// A node is flagged when >= [`README_DUP_LINE_OVERLAP`] of its non-trivial
/// lines also appear verbatim (post-normalization) in README.md, and it has
/// at least [`README_DUP_MIN_LINES`] such lines. No project README ⇒ no-op.
fn check_readme_duplication(root: &Path, graph: &BarnGraph, items: &mut Vec<LintItem>) {
    let Some(readme_path) = find_readme(root) else {
        return;
    };
    let Ok(readme_raw) = fs::read_to_string(&readme_path) else {
        return;
    };
    let readme_lines: HashSet<String> = normalized_lines(&readme_raw).into_iter().collect();
    if readme_lines.is_empty() {
        return;
    }

    for n in &graph.nodes {
        let Ok(path) = resolve_within_root(root, &n.file_path) else {
            continue;
        };
        if path == readme_path {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let node_lines = normalized_lines(&raw);
        if node_lines.len() < README_DUP_MIN_LINES {
            continue;
        }
        let shared = node_lines.iter().filter(|l| readme_lines.contains(*l)).count();
        let overlap = shared as f64 / node_lines.len() as f64;
        if overlap >= README_DUP_LINE_OVERLAP {
            items.push(LintItem {
                code: LintCode::ReadmeDuplication,
                severity: Severity::Warning,
                message: format!(
                    "\"{}\" is substantially copied from README.md ({:.0}% line overlap)",
                    n.title,
                    overlap * 100.0
                ),
                node_ids: vec![n.id.clone()],
                edge_ids: Vec::new(),
                file_path: Some(n.file_path.clone()),
                fix: None,
            });
        }
    }
}

// ── Staleness checks ─────────────────────────────────────────────────────

fn check_stale_last_verified(graph: &BarnGraph, items: &mut Vec<LintItem>) {
    let today_days = unix_days_now();
    for n in &graph.nodes {
        let Some(lv) = &n.last_verified else {
            continue;
        };
        let Some(lv_days) = parse_iso_date_days(lv) else {
            continue;
        };
        let age = today_days - lv_days;
        if age > STALE_LAST_VERIFIED_DAYS {
            items.push(LintItem {
                code: LintCode::StaleLastVerified,
                severity: Severity::Warning,
                message: format!(
                    "\"{}\" was last verified {age} days ago (> {STALE_LAST_VERIFIED_DAYS})",
                    n.title
                ),
                node_ids: vec![n.id.clone()],
                edge_ids: Vec::new(),
                file_path: None,
                fix: None,
            });
        }
    }
}

// ── Deprecated-node integrity (WO13 §10.3, §11.2) ───────────────────────

/// Any structural edge (`imports`/`sequence`/`overrides`) whose TARGET is a
/// deprecated node is an error — a deprecated node is excluded from every
/// compiled output (§10.3), so a structural edge into one is now
/// meaningless. Names the replacement from `deprecated.replacedBy`.
fn check_structural_edge_into_deprecated(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
    items: &mut Vec<LintItem>,
) {
    let id_to_node: HashMap<&str, &MemoryNode> = graph.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    for e in live_edges {
        if !e.kind.is_structural() {
            continue;
        }
        let Some(target) = id_to_node.get(e.target.as_str()) else {
            continue;
        };
        let Some(dep) = target_deprecated(target) else {
            continue;
        };
        let source_title = id_to_node
            .get(e.source.as_str())
            .map(|n| n.title.as_str())
            .unwrap_or(e.source.as_str());
        let replacement_title = id_to_node
            .get(dep.replaced_by.as_str())
            .map(|n| n.title.as_str())
            .unwrap_or(dep.replaced_by.as_str());
        items.push(LintItem {
            code: LintCode::StructuralEdgeIntoDeprecated,
            severity: Severity::Error,
            message: format!(
                "\"{source_title}\" has a {} edge into \"{}\", which is deprecated — use \"{replacement_title}\" instead",
                edge_kind_name(e.kind),
                target.title
            ),
            node_ids: vec![e.source.clone(), e.target.clone()],
            edge_ids: vec![e.id.clone()],
            file_path: None,
            fix: Some(LintFix::DropEdge { edge_id: e.id.clone() }),
        });
    }
}

fn target_deprecated(n: &MemoryNode) -> Option<&Deprecated> {
    n.deprecated.as_ref()
}

// ── command-may-be-env (WO13 §5.2, F7) ───────────────────────────────────

/// The migrator has no filesystem access (`migrate_graph(raw: &str)`), so it
/// cannot sniff a `command`-role node's body for `$ARGUMENTS` — that check
/// moves here. Fires when a non-deprecated `command` node's body contains no
/// `$ARGUMENTS` token, suggesting it is really build/test commands rather
/// than an invocable prompt.
fn check_command_may_be_env(root: &Path, graph: &BarnGraph, items: &mut Vec<LintItem>) {
    for n in &graph.nodes {
        if n.role != NodeRole::Command || n.deprecated.is_some() {
            continue;
        }
        let Ok(path) = resolve_within_root(root, &n.file_path) else {
            continue;
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        if raw.contains("$ARGUMENTS") {
            continue;
        }
        items.push(LintItem {
            code: LintCode::CommandMayBeEnv,
            severity: Severity::Warning,
            message: "This looks like build/test commands rather than an invocable prompt. Retype as Env?".to_string(),
            node_ids: vec![n.id.clone()],
            edge_ids: Vec::new(),
            file_path: Some(n.file_path.clone()),
            fix: Some(LintFix::RetypeNode { node_id: n.id.clone(), role: NodeRole::Env }),
        });
    }
}

// ── Edge legality (WO13_CONTRACT.md §7.3) ────────────────────────────────
//
// Re-derives the SAME frozen rule table `src/config/edgeRules.ts` (lane T1)
// implements — no Rust module in this tree owns a shared legality matrix,
// and lint.rs cannot import TypeScript. Both implementations are keyed
// against the contract's own frozen §7.3 text, not against each other; see
// this module's doc comment for the acknowledged drift risk.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Legality {
    Allow,
    Warn,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LegalitySource {
    Any,
    Role(NodeRole),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LegalityKind {
    /// No rule in [`EDGE_LEGALITY_RULES`] currently needs a wildcard kind —
    /// the one that did (the old `@deprecated` row, `kind: *`) was hoisted
    /// out by Amendment 3 (D15). Kept, not deleted: it mirrors
    /// `edgeRules.ts`'s still-general `EdgeKind | "*"` union, and
    /// `legality_for`'s matching arm still needs to handle it for any
    /// future rule that reintroduces one.
    #[allow(dead_code)]
    Any,
    Kind(EdgeKind),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LegalityTarget {
    Any,
    /// Amendment 3 (WO13_AUDIT.md D15): roles only. Deprecation is a
    /// PRECONDITION evaluated in [`legality_for`] before this table is even
    /// consulted, never a scored row — the removed `Deprecated` variant
    /// used to score 1, the lowest score in the table, so all eleven other
    /// rules outranked it.
    Role(NodeRole),
}

/// The verbatim reason for every deprecated-target deny (Amendment 3
/// precondition) — named so [`legality_for`] and
/// [`check_edge_legality_warning`]'s D15-suppression logic share one
/// string, never a second copy.
const DEPRECATED_TARGET_REASON: &str = "That node is marked out of date and won't reach the agent.";

struct EdgeLegalityRule {
    source: LegalitySource,
    kind: LegalityKind,
    target: LegalityTarget,
    legality: Legality,
    reason: &'static str,
    /// True only for the one cross-group `overrides` warn rule (§7.3's
    /// closing paragraph) — evaluated only when `node_group(source) !=
    /// node_group(target)`.
    cross_group_only: bool,
}

/// §6.1's role→group table, re-derived here for the ONE rule that needs it
/// (the cross-group `overrides` warning). `nodeTypes.ts` is the canonical
/// TS source; this must stay in lockstep with it by hand since there is no
/// shared fixture corpus for this mapping (unlike `resolveLoad`).
fn node_group(role: NodeRole) -> &'static str {
    match role {
        NodeRole::Agent => "identity",
        NodeRole::Rule | NodeRole::Invariant | NodeRole::Trap => "constraints",
        NodeRole::Architecture | NodeRole::Decision => "structure",
        NodeRole::Workflow | NodeRole::Command | NodeRole::Skill | NodeRole::Env | NodeRole::Tool => {
            "process"
        }
        NodeRole::Glossary | NodeRole::Example | NodeRole::Style => "knowledge",
    }
}

/// §7.3's required rules table, in the frozen order (specificity scoring
/// breaks ties by LATER array index, matching `legalityFor`'s own rule).
/// Amendment 3 (D15): the `@deprecated` row is hoisted out of this table
/// entirely, into [`legality_for`]'s precondition — every rule here now
/// matches ONLY when the target is confirmed non-deprecated.
const EDGE_LEGALITY_RULES: &[EdgeLegalityRule] = &[
    EdgeLegalityRule {
        source: LegalitySource::Any,
        kind: LegalityKind::Kind(EdgeKind::Imports),
        target: LegalityTarget::Role(NodeRole::Command),
        legality: Legality::Deny,
        reason: "Commands run when you call them — inlining one removes the point of it. Use references.",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Any,
        kind: LegalityKind::Kind(EdgeKind::Imports),
        target: LegalityTarget::Role(NodeRole::Skill),
        legality: Legality::Deny,
        reason: "Skills load themselves when relevant. Use references.",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Any,
        kind: LegalityKind::Kind(EdgeKind::Imports),
        target: LegalityTarget::Role(NodeRole::Architecture),
        legality: Legality::Warn,
        reason: "Architecture notes are usually long. Inlining puts this in every request.",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Role(NodeRole::Glossary),
        kind: LegalityKind::Kind(EdgeKind::Overrides),
        target: LegalityTarget::Any,
        legality: Legality::Deny,
        reason: "A glossary defines words; it doesn't outrank rules.",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Role(NodeRole::Example),
        kind: LegalityKind::Kind(EdgeKind::Overrides),
        target: LegalityTarget::Any,
        legality: Legality::Deny,
        reason: "An example illustrates a rule; it doesn't outrank one.",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Role(NodeRole::Workflow),
        kind: LegalityKind::Kind(EdgeKind::References),
        target: LegalityTarget::Role(NodeRole::Command),
        legality: Legality::Allow,
        reason: "",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Role(NodeRole::Example),
        kind: LegalityKind::Kind(EdgeKind::References),
        target: LegalityTarget::Role(NodeRole::Rule),
        legality: Legality::Allow,
        reason: "",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Role(NodeRole::Example),
        kind: LegalityKind::Kind(EdgeKind::References),
        target: LegalityTarget::Role(NodeRole::Invariant),
        legality: Legality::Allow,
        reason: "",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Role(NodeRole::Example),
        kind: LegalityKind::Kind(EdgeKind::References),
        target: LegalityTarget::Role(NodeRole::Style),
        legality: Legality::Allow,
        reason: "",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Role(NodeRole::Decision),
        kind: LegalityKind::Kind(EdgeKind::Contradicts),
        target: LegalityTarget::Role(NodeRole::Decision),
        legality: Legality::Allow,
        reason: "",
        cross_group_only: false,
    },
    EdgeLegalityRule {
        source: LegalitySource::Any,
        kind: LegalityKind::Kind(EdgeKind::Overrides),
        target: LegalityTarget::Any,
        legality: Legality::Warn,
        reason: "These two aren't in the same plane — check this is what you mean.",
        cross_group_only: true,
    },
];

/// §7.3's specificity scoring, Amendment 3 (D15). Deprecation is checked
/// FIRST, as a precondition no rule can override — exactly as
/// `resolve_load`'s rule 2 outranks its role rules (§8.2) and `compile.rs`
/// excludes deprecated nodes from all output unconditionally (§10.3); §7.3
/// was the only place deprecation was still negotiable, and this closes
/// that gap. Only once the target is confirmed non-deprecated does
/// specificity scoring run: `(source!="*"?4:0) + (kind!="*"?2:0) +
/// (target!="*"?1:0)`; highest wins, later array entry wins a tie. Default
/// when nothing matches is `(Allow, "")`.
fn legality_for(source_role: NodeRole, kind: EdgeKind, target_role: NodeRole, target_deprecated: bool) -> (Legality, &'static str) {
    if target_deprecated {
        return (Legality::Deny, DEPRECATED_TARGET_REASON);
    }
    let mut best: Option<(i32, usize)> = None;
    for (i, rule) in EDGE_LEGALITY_RULES.iter().enumerate() {
        let source_match = match rule.source {
            LegalitySource::Any => true,
            LegalitySource::Role(r) => r == source_role,
        };
        if !source_match {
            continue;
        }
        let kind_match = match rule.kind {
            LegalityKind::Any => true,
            LegalityKind::Kind(k) => k == kind,
        };
        if !kind_match {
            continue;
        }
        let target_match = match rule.target {
            LegalityTarget::Any => true,
            LegalityTarget::Role(r) => r == target_role,
        };
        if !target_match {
            continue;
        }
        if rule.cross_group_only && node_group(source_role) == node_group(target_role) {
            continue;
        }
        let score = i32::from(!matches!(rule.source, LegalitySource::Any)) * 4
            + i32::from(!matches!(rule.kind, LegalityKind::Any)) * 2
            + i32::from(!matches!(rule.target, LegalityTarget::Any));
        match best {
            Some((best_score, _)) if score < best_score => {}
            _ => best = Some((score, i)),
        }
    }
    match best {
        Some((_, i)) => (EDGE_LEGALITY_RULES[i].legality, EDGE_LEGALITY_RULES[i].reason),
        None => (Legality::Allow, ""),
    }
}

/// One item per live edge whose winning legality rule is `Warn` or `Deny`
/// (WO13_AUDIT.md D8). `addEdge`/`updateEdge` (`src/store/graph.ts`) refuse
/// a `deny`-legality edge at the one chokepoint every UI code path goes
/// through — but `import_apply`/`preset_apply` write `graph.json` directly
/// and never re-enter that chokepoint (§7.3's claim that they do was struck,
/// Amendment 2 A2-9), and undo/redo restores whole snapshots that can
/// resurrect an edge that became denied after its target was deprecated. A
/// `deny`-legality edge surviving into a LOADED graph is therefore not a
/// drawing-time near-miss — it arrived from a hand-edited file, an old
/// preset, or a migration, and `resolveLoad` will silently ignore it, so
/// the compiled output will not match what the graph claims. That is an
/// `Error`, not a `Warning`. Both severities carry the SAME code
/// (`edge-legality-warning` — not split into a second code, per the
/// contract fix) and the SAME `EdgeRule.reason` verbatim, never paraphrased.
fn check_edge_legality_warning(graph: &BarnGraph, live_edges: &[&MemoryEdge], items: &mut Vec<LintItem>) {
    let id_to_node: HashMap<&str, &MemoryNode> = graph.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    for e in live_edges {
        let Some(source) = id_to_node.get(e.source.as_str()) else {
            continue;
        };
        let Some(target) = id_to_node.get(e.target.as_str()) else {
            continue;
        };
        // Amendment 3 (D15): "one report per edge, not two." A structural
        // edge (imports/sequence/overrides) into a deprecated target is
        // already owned by `check_structural_edge_into_deprecated`, which
        // carries the `DropEdge` fix — reporting it again here would file
        // two contradictory Problems items for one wire that does nothing.
        // The advisory kinds (references/contradicts) have no structural
        // check watching them, so this remains their ONLY report.
        if target.deprecated.is_some() && e.kind.is_structural() {
            continue;
        }
        let (legality, reason) =
            legality_for(source.role, e.kind, target.role, target.deprecated.is_some());
        let severity = match legality {
            Legality::Warn => Severity::Warning,
            Legality::Deny => Severity::Error,
            Legality::Allow => continue,
        };
        items.push(LintItem {
            code: LintCode::EdgeLegalityWarning,
            severity,
            message: reason.to_string(),
            node_ids: vec![e.source.clone(), e.target.clone()],
            edge_ids: vec![e.id.clone()],
            file_path: None,
            fix: None,
        });
    }
}

// ── Load-policy checks (WO13_CONTRACT.md §8, §11) ────────────────────────
//
// All share one `AlwaysClosure` computed by `crate::resolve_load` — see
// `project_load_facts` below and its one call site in `lint_graph`.

/// Project a [`BarnGraph`]'s live edges/nodes into `resolve_load`'s facts
/// shape (§8.3: decoupled from the full role vocabulary and from
/// `project::EdgeGuard`'s contents). Dangling edges are excluded by virtue
/// of `live_edges` already having filtered them out (§8.2: "excluded before
/// resolution, the same way `compile_preview`/`lint_graph` already do").
fn project_load_facts(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
) -> (Vec<resolve_load::NodeFacts>, Vec<resolve_load::EdgeFacts>) {
    let nodes = graph
        .nodes
        .iter()
        .map(|n| resolve_load::NodeFacts {
            id: n.id.clone(),
            role: to_load_role(n.role),
            root_always: n.root_load == Some(RootLoad::Always),
            deprecated: n.deprecated.is_some(),
        })
        .collect();
    let edges = live_edges
        .iter()
        .map(|e| resolve_load::EdgeFacts {
            id: e.id.clone(),
            source: e.source.clone(),
            target: e.target.clone(),
            kind: to_load_edge_kind(e.kind),
            guard: to_guard_kind(&e.guard),
        })
        .collect();
    (nodes, edges)
}

fn to_load_role(role: NodeRole) -> LoadRole {
    match role {
        NodeRole::Command => LoadRole::Command,
        NodeRole::Skill => LoadRole::Skill,
        _ => LoadRole::Other,
    }
}

fn to_load_edge_kind(kind: EdgeKind) -> LoadEdgeKind {
    match kind {
        EdgeKind::Imports => LoadEdgeKind::Imports,
        EdgeKind::References => LoadEdgeKind::References,
        EdgeKind::Overrides | EdgeKind::Sequence | EdgeKind::Contradicts => LoadEdgeKind::Other,
    }
}

fn to_guard_kind(guard: &Option<EdgeGuard>) -> GuardKind {
    match guard {
        None => GuardKind::None,
        Some(EdgeGuard::Glob { .. }) => GuardKind::Glob,
        Some(EdgeGuard::Description { .. }) => GuardKind::Description,
    }
}

/// Co-residency (§11.1): both endpoints resolve to `"always"`, i.e. both are
/// members of the `AlwaysClosure`.
fn co_resident(closure: &BTreeSet<String>, a: &str, b: &str) -> bool {
    closure.contains(a) && closure.contains(b)
}

/// D12 fix (WO13_AUDIT.md): the suggested `AddImports { source, target }`
/// fix is applied through the graph store's `addEdge` (§11.3), which is the
/// SAME chokepoint that refuses a `deny`-legality edge outright (§7.3). An
/// `imports` edge from `source` into `target` is unconditionally denied
/// when `target` is `command`/`skill`-role or deprecated (the first two
/// rows of §7.3's table, plus the `@deprecated` row) — in exactly that
/// shape, `AddImports` is not a fix, it is a button that silently does
/// nothing when clicked. Checked with the SAME `legality_for` this module
/// already uses for `edge-legality-warning`, never a second predicate.
fn add_imports_fix_is_denied(graph: &BarnGraph, source: &str, target: &str) -> bool {
    let Some(source_node) = graph.nodes.iter().find(|n| n.id == source) else {
        return false;
    };
    let Some(target_node) = graph.nodes.iter().find(|n| n.id == target) else {
        return false;
    };
    let (legality, _) = legality_for(
        source_node.role,
        EdgeKind::Imports,
        target_node.role,
        target_node.deprecated.is_some(),
    );
    legality == Legality::Deny
}

/// Bundles the per-caller-fixed shape of a "not co-resident" check
/// (`sequence-not-co-resident` / `override-not-co-resident`) — collapses
/// `check_not_co_resident`'s argument count under clippy's
/// `too_many_arguments` threshold, and keeps the two call sites' frozen
/// code/severity/message text in one place per check.
struct NotCoResidentSpec {
    kind: EdgeKind,
    code: LintCode,
    severity: Severity,
    message: &'static str,
}

fn check_not_co_resident(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
    closure: &BTreeSet<String>,
    spec: &NotCoResidentSpec,
    items: &mut Vec<LintItem>,
) {
    for e in live_edges {
        if e.kind != spec.kind {
            continue;
        }
        if co_resident(closure, &e.source, &e.target) {
            continue;
        }
        let fix = if add_imports_fix_is_denied(graph, &e.source, &e.target) {
            None
        } else {
            Some(LintFix::AddImports { source: e.source.clone(), target: e.target.clone() })
        };
        items.push(LintItem {
            code: spec.code,
            severity: spec.severity,
            message: spec.message.to_string(),
            node_ids: vec![e.source.clone(), e.target.clone()],
            edge_ids: vec![e.id.clone()],
            file_path: None,
            fix,
        });
    }
}

fn check_sequence_not_co_resident(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
    closure: &BTreeSet<String>,
    items: &mut Vec<LintItem>,
) {
    check_not_co_resident(
        graph,
        live_edges,
        closure,
        &NotCoResidentSpec {
            kind: EdgeKind::Sequence,
            code: LintCode::SequenceNotCoResident,
            severity: Severity::Warning,
            message: "These never end up in the same file, so ordering does nothing.",
        },
        items,
    );
}

fn check_override_not_co_resident(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
    closure: &BTreeSet<String>,
    items: &mut Vec<LintItem>,
) {
    check_not_co_resident(
        graph,
        live_edges,
        closure,
        &NotCoResidentSpec {
            kind: EdgeKind::Overrides,
            code: LintCode::OverrideNotCoResident,
            severity: Severity::Error,
            message: "Override has no effect — these two never appear in the same file.",
        },
        items,
    );
}

/// §8.2 rule 6: a target already in the `AlwaysClosure` needs only its
/// lowest-byte-order-id unguarded `imports` edge (from a closure-member
/// source) to stay there — every OTHER such edge into the same target adds
/// nothing. One item per redundant edge, `fix: DropEdge`.
fn check_duplicate_imports(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
    closure: &BTreeSet<String>,
    items: &mut Vec<LintItem>,
) {
    let id_to_title: HashMap<&str, &str> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.title.as_str()))
        .collect();
    let mut by_target: BTreeMap<&str, Vec<&MemoryEdge>> = BTreeMap::new();
    for e in live_edges {
        if e.kind != EdgeKind::Imports || e.guard.is_some() {
            continue;
        }
        if !closure.contains(&e.target) || !closure.contains(&e.source) {
            continue;
        }
        by_target.entry(e.target.as_str()).or_default().push(e);
    }
    for (target, mut edges) in by_target {
        if edges.len() < 2 {
            continue;
        }
        edges.sort_by(|a, b| a.id.cmp(&b.id));
        let title = id_to_title.get(target).copied().unwrap_or(target);
        for e in &edges[1..] {
            items.push(LintItem {
                code: LintCode::DuplicateImports,
                severity: Severity::Info,
                message: format!("\"{title}\" is already in context — this second import adds nothing."),
                node_ids: vec![e.source.clone(), e.target.clone()],
                edge_ids: vec![e.id.clone()],
                file_path: None,
                fix: Some(LintFix::DropEdge { edge_id: e.id.clone() }),
            });
        }
    }
}

/// §8.2 rules 10/11, surfaced as lint. A node outside the `AlwaysClosure`,
/// not deprecated and not a `command`/`skill` role (both excluded from the
/// closure by design and never orphan/unreachable in the lint sense — rule
/// 1's own destination already answers "when does this load"), is flagged:
/// - `referenced` (a live `references` edge into it) or a GUARDED `imports`
///   edge into it (glob or description) ⇒ legitimately on-demand, no lint.
/// - an UNGUARDED `imports` edge into it (necessarily from a
///   closure-excluded source, or rule 6 would have pulled this node in
///   too) ⇒ `unreachable-import`.
/// - nothing points at it at all ⇒ `orphan-node`.
fn check_orphan_and_unreachable_import(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
    closure: &BTreeSet<String>,
    items: &mut Vec<LintItem>,
) {
    let id_to_title: HashMap<&str, &str> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.title.as_str()))
        .collect();
    for n in &graph.nodes {
        if n.deprecated.is_some() || matches!(n.role, NodeRole::Command | NodeRole::Skill) {
            continue;
        }
        if closure.contains(&n.id) {
            continue;
        }
        let referenced = live_edges
            .iter()
            .any(|e| e.kind == EdgeKind::References && e.target == n.id);
        if referenced {
            continue;
        }
        let guarded_import = live_edges
            .iter()
            .any(|e| e.kind == EdgeKind::Imports && e.guard.is_some() && e.target == n.id);
        if guarded_import {
            continue;
        }
        let mut unguarded: Vec<&&MemoryEdge> = live_edges
            .iter()
            .filter(|e| e.kind == EdgeKind::Imports && e.guard.is_none() && e.target == n.id)
            .collect();
        if unguarded.is_empty() {
            items.push(LintItem {
                code: LintCode::OrphanNode,
                severity: Severity::Warning,
                message: "Nothing imports or references this, so it won't reach any agent.".to_string(),
                node_ids: vec![n.id.clone()],
                edge_ids: Vec::new(),
                file_path: None,
                fix: None,
            });
        } else {
            unguarded.sort_by(|a, b| a.id.cmp(&b.id));
            let deciding = unguarded[0];
            let source_title = id_to_title
                .get(deciding.source.as_str())
                .copied()
                .unwrap_or(deciding.source.as_str());
            items.push(LintItem {
                code: LintCode::UnreachableImport,
                severity: Severity::Warning,
                message: format!(
                    "Only \"{source_title}\" imports this, and that node doesn't reach any agent either."
                ),
                node_ids: vec![n.id.clone()],
                edge_ids: vec![deciding.id.clone()],
                file_path: None,
                fix: None,
            });
        }
    }
}

fn tokens_for_bytes(bytes: u64) -> u64 {
    bytes.div_ceil(4)
}

/// Total chars/4 token estimate over every `AlwaysClosure` member's file —
/// same heuristic `src/store/tokens.ts`'s `tokensForBytes` uses, so the
/// number this reports agrees with what the UI shows elsewhere. Warns once
/// per graph, naming the top 3 contributors by size.
fn check_always_budget_exceeded(
    root: &Path,
    graph: &BarnGraph,
    closure: &BTreeSet<String>,
    items: &mut Vec<LintItem>,
) {
    let mut contributors: Vec<(String, String, u64)> = Vec::new();
    let mut total = 0u64;
    for n in &graph.nodes {
        if !closure.contains(&n.id) {
            continue;
        }
        let Ok(path) = resolve_within_root(root, &n.file_path) else {
            continue;
        };
        let Ok(meta) = fs::metadata(&path) else {
            continue;
        };
        let tokens = tokens_for_bytes(meta.len());
        total += tokens;
        contributors.push((n.id.clone(), n.title.clone(), tokens));
    }
    if total <= ALWAYS_BUDGET_TOKENS {
        return;
    }
    contributors.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    let node_ids: Vec<String> = contributors.iter().take(3).map(|c| c.0.clone()).collect();
    let top3: Vec<&str> = contributors.iter().take(3).map(|c| c.1.as_str()).collect();
    items.push(LintItem {
        code: LintCode::AlwaysBudgetExceeded,
        severity: Severity::Warning,
        message: format!(
            "Always-loaded context is ~{total} tokens (over the {ALWAYS_BUDGET_TOKENS}-token guideline) — top contributors: {}",
            top3.join(", ")
        ),
        node_ids,
        edge_ids: Vec::new(),
        file_path: None,
        fix: None,
    });
}

fn unix_days_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_secs() / 86_400) as i64)
        .unwrap_or(0)
}

/// Parses a plain `YYYY-MM-DD` (the only shape `lastVerified` is ever
/// written in — see `project.rs`/`graph.ts`). Anything else, or an
/// out-of-range month/day, returns `None` and the node is silently
/// skipped by the staleness check rather than panicking on a bad date.
fn parse_iso_date_days(s: &str) -> Option<i64> {
    // `splitn(3, ...)` caps at 3 pieces; a 4th `-`-delimited segment (or
    // any other trailing junk) lands inside the day piece and fails to
    // parse as `u32` below, so no separate "too many parts" check is needed.
    let mut parts = s.splitn(3, '-');
    let y: i64 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    let d: u32 = parts.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// Days since 1970-01-01 for a proleptic-Gregorian `y`/`m`/`d`. Howard
/// Hinnant's `days_from_civil` (public domain,
/// http://howardhinnant.github.io/date_algorithms.html) — used in place of
/// a date/time crate since this repo adds no new dependencies and this is
/// the only calculation that would need one.
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (i64::from(m) + 9) % 12; // [0, 11]
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146_097 + doe - 719_468
}
