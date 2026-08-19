//! Linter v1 (WO03 Lane E): unifies compile's graph-integrity checks
//! (cycle, missing file, dangling edge) with new conflict / duplication /
//! staleness checks into one read-only [`Problems`] payload for the
//! frontend Problems panel (Lane F) and, later, `cowtext-cli lint` (Lane C).
//!
//! `lint_run` is READ-ONLY: it never writes a file and never mutates the
//! graph (`docs/design/WO03_CONTRACT.md` "MUST NOT BREAK"). All filesystem
//! access goes through `project.rs`'s path guards
//! ([`checked_root`]/[`resolve_within_root`]) — the webview never hands us
//! a raw path we trust unchecked.
//!
//! Cycle/missing-file/dangling-edge are **re-derived** here from
//! `project.rs`'s canonical model rather than imported from `compile.rs`
//! (contract: lint.rs may not touch compile.rs). The Kahn's-algorithm +
//! cycle-recovery pass below (`check_cycle`/`find_cycle`) is structurally
//! the same two-function shape as `compile.rs`'s `total_order`/
//! `find_cycle` — that is real, acknowledged duplication (see the lane
//! report), not an oversight; `EdgeKind::is_structural` is the one piece
//! Lanes B and E share instead of re-deriving.

#[cfg(test)]
mod tests;

use crate::project::{
    checked_root, migrate_graph, read_graph, resolve_within_root, BarnGraph, EdgeKind,
    MemoryEdge, MemoryNode,
};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};
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

// ── Wire shape (Lane F builds the Problems panel against this) ─────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

/// Stable, machine-readable check identity. Kebab-case on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LintCode {
    Cycle,
    MissingFile,
    DanglingEdge,
    ConflictsWith,
    DuplicateTitle,
    NearDuplicateContent,
    ReadmeDuplication,
    StaleLastVerified,
    SupersededButPinned,
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
/// of [`lint_run`] so a future non-Tauri caller (`cowtext-cli lint`, Lane
/// C) can call it directly without a webview.
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
    check_conflicts_with(graph, &live_edges, &mut items);
    check_duplicate_titles(graph, &mut items);
    check_near_duplicate_content(root, graph, &mut items);
    check_readme_duplication(root, graph, &mut items);
    check_stale_last_verified(graph, &mut items);
    check_superseded_but_pinned(graph, &live_edges, &mut items);

    items
}

// ── Graph-integrity checks (re-derived from compile.rs's shape) ────────

fn edge_kind_name(kind: EdgeKind) -> &'static str {
    match kind {
        EdgeKind::Imports => "imports",
        EdgeKind::References => "references",
        EdgeKind::Conditional => "conditional",
        EdgeKind::Sequence => "sequence",
        EdgeKind::Overrides => "overrides",
        EdgeKind::Supersedes => "supersedes",
        EdgeKind::ConflictsWith => "conflicts-with",
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
/// before source, same direction as `imports`. That convention has not
/// yet landed in `compile.rs`'s own Kahn pass (WO03 Lane B); flagged in
/// the lane report for reconciliation, not silently assumed identical.
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
        if !e.kind.is_structural() {
            continue;
        }
        let s = id_to_idx[e.source.as_str()];
        let t = id_to_idx[e.target.as_str()];
        let (u, v) = match e.kind {
            EdgeKind::Sequence => (s, t),
            EdgeKind::Imports | EdgeKind::Overrides => (t, s),
            _ => unreachable!("non-structural kinds filtered by is_structural above"),
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

/// Explicit `conflicts-with` edges, one item per edge.
fn check_conflicts_with(graph: &BarnGraph, live_edges: &[&MemoryEdge], items: &mut Vec<LintItem>) {
    let id_to_title: HashMap<&str, &str> = graph
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.title.as_str()))
        .collect();
    for e in live_edges {
        if e.kind != EdgeKind::ConflictsWith {
            continue;
        }
        let source_title = id_to_title.get(e.source.as_str()).copied().unwrap_or(&e.source);
        let target_title = id_to_title.get(e.target.as_str()).copied().unwrap_or(&e.target);
        items.push(LintItem {
            code: LintCode::ConflictsWith,
            severity: Severity::Warning,
            message: format!(
                "\"{source_title}\" conflicts with \"{target_title}\" (explicit conflicts-with edge)"
            ),
            node_ids: vec![e.source.clone(), e.target.clone()],
            edge_ids: vec![e.id.clone()],
            file_path: None,
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
            });
        }
    }
}

/// Nodes that are the *target* of a `supersedes` edge (the old node a newer
/// one replaces) yet still `pinned: true` — a real correctness smell, since
/// a superseded node normally shouldn't still be forced into every compile.
/// One item per qualifying `supersedes` edge.
fn check_superseded_but_pinned(
    graph: &BarnGraph,
    live_edges: &[&MemoryEdge],
    items: &mut Vec<LintItem>,
) {
    let id_to_node: HashMap<&str, &MemoryNode> =
        graph.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    for e in live_edges {
        if e.kind != EdgeKind::Supersedes {
            continue;
        }
        let Some(target) = id_to_node.get(e.target.as_str()) else {
            continue;
        };
        if !target.pinned {
            continue;
        }
        let source_title = id_to_node
            .get(e.source.as_str())
            .map(|n| n.title.as_str())
            .unwrap_or(e.source.as_str());
        items.push(LintItem {
            code: LintCode::SupersededButPinned,
            severity: Severity::Warning,
            message: format!(
                "\"{}\" is superseded by \"{source_title}\" but is still pinned",
                target.title
            ),
            node_ids: vec![target.id.clone()],
            edge_ids: vec![e.id.clone()],
            file_path: None,
        });
    }
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
