use super::*;
use crate::project::{CompileTarget, NodeRole, Position};
use std::fs;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-lint-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn touch(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn node(id: &str, title: &str, file_path: &str) -> MemoryNode {
    MemoryNode {
        id: id.to_string(),
        title: title.to_string(),
        role: NodeRole::Reference,
        brief: String::new(),
        file_path: file_path.to_string(),
        read_order: 0,
        pinned: false,
        position: Position { x: 0, y: 0 },
        scene_pos: None,
        last_verified: None,
        tags: Vec::new(),
        owner: None,
        meta: None,
    }
}

fn edge(id: &str, source: &str, target: &str, kind: EdgeKind) -> MemoryEdge {
    MemoryEdge {
        id: id.to_string(),
        source: source.to_string(),
        target: target.to_string(),
        kind,
        condition: None,
        note: None,
        color: None,
    }
}

fn graph(nodes: Vec<MemoryNode>, edges: Vec<MemoryEdge>) -> BarnGraph {
    BarnGraph {
        version: 3,
        project_name: "Test".to_string(),
        nodes,
        edges,
        compile_targets: vec![CompileTarget::Claude],
    }
}

fn codes(items: &[LintItem]) -> Vec<LintCode> {
    items.iter().map(|i| i.code).collect()
}

// ── Clean graph ──────────────────────────────────────────────────────────

#[test]
fn clean_graph_returns_zero_items() {
    let root = temp_project("clean");
    touch(&root.join("context/a.md"), "Some perfectly ordinary node content.");
    touch(&root.join("context/b.md"), "Some other, unrelated node content.");

    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::References)],
    );

    let items = lint_graph(&root, &g);
    assert!(items.is_empty(), "expected zero items, got {items:?}");

    let _ = fs::remove_dir_all(&root);
}

// ── Cycle ────────────────────────────────────────────────────────────────

#[test]
fn cycle_detected_via_sequence_edges() {
    let root = temp_project("cycle-sequence");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");

    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![
            edge("e1", "a", "b", EdgeKind::Sequence),
            edge("e2", "b", "a", EdgeKind::Sequence),
        ],
    );

    let items = lint_graph(&root, &g);
    let cycle = items.iter().find(|i| i.code == LintCode::Cycle).expect("cycle item");
    assert_eq!(cycle.severity, Severity::Error);
    assert!(cycle.node_ids.contains(&"a".to_string()));
    assert!(cycle.node_ids.contains(&"b".to_string()));
    // Ordered path: first node repeated as the last element.
    assert_eq!(cycle.node_ids.first(), cycle.node_ids.last());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn cycle_detected_through_overrides_edges() {
    let root = temp_project("cycle-overrides");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");

    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![
            edge("e1", "a", "b", EdgeKind::Overrides),
            edge("e2", "b", "a", EdgeKind::Overrides),
        ],
    );

    let items = lint_graph(&root, &g);
    assert!(codes(&items).contains(&LintCode::Cycle));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn non_structural_edges_never_report_a_false_cycle() {
    let root = temp_project("cycle-nonstructural");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");

    // conflicts-with is explicitly non-structural: this "back-and-forth"
    // shape must never be mistaken for a Kahn cycle.
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![
            edge("e1", "a", "b", EdgeKind::ConflictsWith),
            edge("e2", "b", "a", EdgeKind::ConflictsWith),
        ],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::Cycle));

    let _ = fs::remove_dir_all(&root);
}

// ── Missing file / dangling edge ────────────────────────────────────────

#[test]
fn missing_file_reported() {
    let root = temp_project("missing-file");
    // Node file deliberately never created.
    let g = graph(vec![node("a", "Alpha", "context/missing.md")], vec![]);

    let items = lint_graph(&root, &g);
    let hit = items.iter().find(|i| i.code == LintCode::MissingFile).expect("missing-file item");
    assert_eq!(hit.severity, Severity::Error);
    assert_eq!(hit.node_ids, vec!["a".to_string()]);
    assert_eq!(hit.file_path.as_deref(), Some("context/missing.md"));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn dangling_edge_reported_for_missing_source_and_target() {
    let root = temp_project("dangling");
    touch(&root.join("context/a.md"), "a");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md")],
        vec![edge("e1", "a", "ghost", EdgeKind::References)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::DanglingEdge)
        .expect("dangling-edge item");
    assert_eq!(hit.severity, Severity::Error);
    assert_eq!(hit.edge_ids, vec!["e1".to_string()]);
    assert!(hit.message.contains("ghost"));

    let _ = fs::remove_dir_all(&root);
}

// ── Conflicts-with ───────────────────────────────────────────────────────

#[test]
fn conflicts_with_edge_reported() {
    let root = temp_project("conflicts");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::ConflictsWith)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::ConflictsWith)
        .expect("conflicts-with item");
    assert_eq!(hit.severity, Severity::Warning);
    assert_eq!(hit.edge_ids, vec!["e1".to_string()]);
    assert_eq!(hit.node_ids, vec!["a".to_string(), "b".to_string()]);
    assert!(hit.message.contains("Alpha"));
    assert!(hit.message.contains("Beta"));

    let _ = fs::remove_dir_all(&root);
}

// ── Duplicate title ──────────────────────────────────────────────────────

#[test]
fn duplicate_titles_grouped_into_one_item() {
    let root = temp_project("dup-title");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let g = graph(
        vec![
            node("a", "Coding Rules", "context/a.md"),
            node("b", "  coding rules  ", "context/b.md"),
        ],
        vec![],
    );

    let items = lint_graph(&root, &g);
    let hits: Vec<&LintItem> = items.iter().filter(|i| i.code == LintCode::DuplicateTitle).collect();
    assert_eq!(hits.len(), 1, "expected one grouped item, got {hits:?}");
    assert_eq!(hits[0].severity, Severity::Warning);
    assert_eq!(hits[0].node_ids, vec!["a".to_string(), "b".to_string()]);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn distinct_titles_are_not_flagged() {
    let root = temp_project("dup-title-clean");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::DuplicateTitle));

    let _ = fs::remove_dir_all(&root);
}

// ── Near-duplicate content ───────────────────────────────────────────────

#[test]
fn near_duplicate_content_flagged_across_normalized_whitespace_and_case() {
    let root = temp_project("near-dup");
    let long_text = "This is a fairly long block of node content used to verify \
        near-duplicate detection works even when whitespace and casing differ.";
    touch(&root.join("context/a.md"), long_text);
    touch(
        &root.join("context/b.md"),
        &long_text.to_uppercase().replace(' ', "   \n"),
    );
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::NearDuplicateContent)
        .expect("near-duplicate-content item");
    assert_eq!(hit.severity, Severity::Warning);
    assert_eq!(hit.node_ids, vec!["a".to_string(), "b".to_string()]);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn short_matching_content_is_not_flagged_as_near_duplicate() {
    let root = temp_project("near-dup-short");
    touch(&root.join("context/a.md"), "short");
    touch(&root.join("context/b.md"), "short");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::NearDuplicateContent));

    let _ = fs::remove_dir_all(&root);
}

// ── README duplication ───────────────────────────────────────────────────

#[test]
fn readme_duplication_flagged_above_overlap_threshold() {
    let root = temp_project("readme-dup");
    let readme = "Line one of the readme.\nLine two of the readme.\nLine three of the readme.\nLine four is unique to readme.\n";
    touch(&root.join("README.md"), readme);
    touch(
        &root.join("context/copy.md"),
        "Line one of the readme.\nLine two of the readme.\nLine three of the readme.\n",
    );
    let g = graph(vec![node("a", "Copycat", "context/copy.md")], vec![]);

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::ReadmeDuplication)
        .expect("readme-duplication item");
    assert_eq!(hit.severity, Severity::Warning);
    assert_eq!(hit.node_ids, vec!["a".to_string()]);
    assert_eq!(hit.file_path.as_deref(), Some("context/copy.md"));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn content_mostly_unlike_readme_is_not_flagged() {
    let root = temp_project("readme-dup-clean");
    touch(
        &root.join("README.md"),
        "Line one of the readme.\nLine two of the readme.\nLine three of the readme.\n",
    );
    touch(
        &root.join("context/original.md"),
        "Something completely different.\nNothing shared here at all.\nStill unrelated content.\n",
    );
    let g = graph(vec![node("a", "Original", "context/original.md")], vec![]);

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::ReadmeDuplication));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn no_readme_means_no_readme_duplication_check() {
    let root = temp_project("no-readme");
    touch(&root.join("context/a.md"), "Line one.\nLine two.\nLine three.\n");
    let g = graph(vec![node("a", "Alpha", "context/a.md")], vec![]);

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::ReadmeDuplication));

    let _ = fs::remove_dir_all(&root);
}

// ── Stale lastVerified ───────────────────────────────────────────────────

#[test]
fn stale_last_verified_flagged_for_old_date() {
    let root = temp_project("stale");
    touch(&root.join("context/a.md"), "a");
    let mut n = node("a", "Alpha", "context/a.md");
    n.last_verified = Some("2000-01-01".to_string());
    let g = graph(vec![n], vec![]);

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::StaleLastVerified)
        .expect("stale-last-verified item");
    assert_eq!(hit.severity, Severity::Warning);
    assert_eq!(hit.node_ids, vec!["a".to_string()]);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn recent_or_future_last_verified_is_not_flagged() {
    let root = temp_project("stale-clean");
    touch(&root.join("context/a.md"), "a");
    let mut n = node("a", "Alpha", "context/a.md");
    n.last_verified = Some("2999-01-01".to_string());
    let g = graph(vec![n], vec![]);

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::StaleLastVerified));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn unparseable_last_verified_is_skipped_not_panicked() {
    let root = temp_project("stale-bad-date");
    touch(&root.join("context/a.md"), "a");
    let mut n = node("a", "Alpha", "context/a.md");
    n.last_verified = Some("not-a-date".to_string());
    let g = graph(vec![n], vec![]);

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::StaleLastVerified));

    let _ = fs::remove_dir_all(&root);
}

// ── Superseded but pinned ────────────────────────────────────────────────

#[test]
fn superseded_but_still_pinned_is_flagged() {
    let root = temp_project("superseded-pinned");
    touch(&root.join("context/old.md"), "old");
    touch(&root.join("context/new.md"), "new");
    let mut old = node("old", "Old Rules", "context/old.md");
    old.pinned = true;
    let g = graph(
        vec![old, node("new", "New Rules", "context/new.md")],
        vec![edge("e1", "new", "old", EdgeKind::Supersedes)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::SupersededButPinned)
        .expect("superseded-but-pinned item");
    assert_eq!(hit.severity, Severity::Warning);
    assert_eq!(hit.node_ids, vec!["old".to_string()]);
    assert_eq!(hit.edge_ids, vec!["e1".to_string()]);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn superseded_and_unpinned_is_not_flagged() {
    let root = temp_project("superseded-unpinned");
    touch(&root.join("context/old.md"), "old");
    touch(&root.join("context/new.md"), "new");
    let g = graph(
        vec![node("old", "Old Rules", "context/old.md"), node("new", "New Rules", "context/new.md")],
        vec![edge("e1", "new", "old", EdgeKind::Supersedes)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::SupersededButPinned));

    let _ = fs::remove_dir_all(&root);
}

// ── lint_run command wrapper ─────────────────────────────────────────────

#[test]
fn lint_run_returns_empty_problems_when_no_graph_file_exists() {
    let root = temp_project("no-graph");
    let problems = lint_run(root.to_string_lossy().into_owned()).unwrap();
    assert!(problems.items.is_empty());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn lint_run_reads_and_lints_the_real_graph_file() {
    let root = temp_project("run-real");
    // Node file deliberately absent so lint_run surfaces a missing-file item.
    let g = graph(vec![node("a", "Alpha", "context/missing.md")], vec![]);
    touch(&root.join(".cowtext/graph.json"), &crate::project::serialize_graph(&g));

    let problems = lint_run(root.to_string_lossy().into_owned()).unwrap();
    assert!(codes(&problems.items).contains(&LintCode::MissingFile));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn lint_run_rejects_a_non_directory_root() {
    assert!(lint_run("Z:/definitely/not/a/dir".into()).is_err());
}

// ── Wire shape sanity ─────────────────────────────────────────────────────

#[test]
fn lint_item_serializes_camel_case_and_omits_empty_fields() {
    let item = LintItem {
        code: LintCode::MissingFile,
        severity: Severity::Error,
        message: "boom".to_string(),
        node_ids: vec!["a".to_string()],
        edge_ids: Vec::new(),
        file_path: None,
    };
    let json = serde_json::to_string(&item).unwrap();
    assert!(json.contains("\"code\":\"missing-file\""));
    assert!(json.contains("\"severity\":\"error\""));
    assert!(json.contains("\"nodeIds\":[\"a\"]"));
    assert!(!json.contains("edgeIds"));
    assert!(!json.contains("filePath"));
}

// ── D9 (tech-lead audit, fix round): pin lint's cycle detector against ──
// ── compile.rs's independent one ─────────────────────────────────────────
//
// Two Kahn-cycle implementations exist by design (contract forbids
// lint.rs importing/modifying compile.rs's internals; see the
// wo03-lane-e-linter memory) — the tech-lead audit ratified keeping them
// separate rather than unifying via a generic trait over two ~60-line
// functions, or forcing compile.rs's tolerant parse shape onto lint's
// strict model. What must never happen silently is the two drifting apart
// on whether a graph has a cycle, or which nodes it touches — the
// `overrides` direction was guessed independently in this lane and only
// later confirmed (by reading Lane B's memory) to match compile.rs. This
// corpus is the trip-wire for that class of bug: every fixture runs
// through both `lint_graph` and `crate::compile::compile_preview`,
// asserting exact agreement — same cycle-or-not, and when a cycle exists,
// the identical ordered node-id path (both implementations use the same
// smallest-id-first `find_cycle` walk over the same input, so an exact
// match, not just a same-set match, is the correct — and strictest —
// assertion here).

use crate::compile::{compile_preview, ValidationError};

/// Runs one fixture through both implementations. Every referenced node
/// file is created on disk with real content first, so neither
/// implementation reports a spurious missing-file error that could be
/// mistaken for cycle-detection disagreement. Returns each side's cycle
/// path as an ordered id vector (first id repeated last, per both
/// modules' documented convention), or `None` when no cycle was reported.
fn run_both_cycle_detectors(tag: &str, g: &BarnGraph) -> (Option<Vec<String>>, Option<Vec<String>>) {
    let root = temp_project(tag);
    for n in &g.nodes {
        touch(&root.join(&n.file_path), &format!("# {}", n.title));
    }

    let lint_cycle = lint_graph(&root, g)
        .iter()
        .find(|i| i.code == LintCode::Cycle)
        .map(|i| i.node_ids.clone());

    let graph_json = crate::project::serialize_graph(g);
    let preview = compile_preview(root.to_string_lossy().into_owned(), graph_json).unwrap();
    let compile_cycle = preview.errors.iter().find_map(|e| match e {
        ValidationError::Cycle { nodes } => Some(nodes.iter().map(|n| n.id.clone()).collect()),
        _ => None,
    });

    let _ = fs::remove_dir_all(&root);
    (lint_cycle, compile_cycle)
}

#[test]
fn differential_acyclic_graph_agrees_no_cycle() {
    // a --sequence--> b (a before b); c --imports--> b (b before c).
    // Total order a, b, c — no cycle.
    let g = graph(
        vec![
            node("a", "Alpha", "context/a.md"),
            node("b", "Beta", "context/b.md"),
            node("c", "Gamma", "context/c.md"),
        ],
        vec![
            edge("e1", "a", "b", EdgeKind::Sequence),
            edge("e2", "c", "b", EdgeKind::Imports),
        ],
    );
    let (lint_cycle, compile_cycle) = run_both_cycle_detectors("diff-acyclic", &g);
    assert_eq!(lint_cycle, None, "lint reported a cycle on an acyclic graph");
    assert_eq!(compile_cycle, None, "compile reported a cycle on an acyclic graph");
}

#[test]
fn differential_imports_cycle_agrees() {
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![
            edge("e1", "a", "b", EdgeKind::Imports),
            edge("e2", "b", "a", EdgeKind::Imports),
        ],
    );
    let (lint_cycle, compile_cycle) = run_both_cycle_detectors("diff-imports", &g);
    let lint_cycle = lint_cycle.expect("lint should detect the imports cycle");
    let compile_cycle = compile_cycle.expect("compile should detect the imports cycle");
    assert_eq!(lint_cycle, compile_cycle, "cycle paths diverge for a pure-imports cycle");
}

#[test]
fn differential_overrides_cycle_agrees() {
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![
            edge("e1", "a", "b", EdgeKind::Overrides),
            edge("e2", "b", "a", EdgeKind::Overrides),
        ],
    );
    let (lint_cycle, compile_cycle) = run_both_cycle_detectors("diff-overrides", &g);
    let lint_cycle = lint_cycle.expect("lint should detect the overrides cycle");
    let compile_cycle = compile_cycle.expect("compile should detect the overrides cycle");
    assert_eq!(lint_cycle, compile_cycle, "cycle paths diverge for a pure-overrides cycle");
}

#[test]
fn differential_mixed_imports_overrides_sequence_cycle_agrees() {
    // e1 a --sequence--> b:   arrow a->b   (a before b)
    // e2 c --imports--> b:    arrow b->c   (b before c; b is what c imports)
    // e3 a --overrides--> c:  arrow c->a   (c before a; c is the base a overrides)
    // Chain a->b->c->a: a genuine 3-cycle spanning all three structural
    // edge kinds at once (verified by hand-tracing both Kahn passes before
    // writing this fixture — see the lane report).
    let g = graph(
        vec![
            node("a", "Alpha", "context/a.md"),
            node("b", "Beta", "context/b.md"),
            node("c", "Gamma", "context/c.md"),
        ],
        vec![
            edge("e1", "a", "b", EdgeKind::Sequence),
            edge("e2", "c", "b", EdgeKind::Imports),
            edge("e3", "a", "c", EdgeKind::Overrides),
        ],
    );
    let (lint_cycle, compile_cycle) = run_both_cycle_detectors("diff-mixed", &g);
    let lint_cycle = lint_cycle.expect("lint should detect the mixed-kind cycle");
    let compile_cycle = compile_cycle.expect("compile should detect the mixed-kind cycle");
    assert_eq!(lint_cycle, compile_cycle, "cycle paths diverge for a mixed-kind cycle");
    assert_eq!(lint_cycle, vec!["a", "b", "c", "a"]);
}

#[test]
fn differential_dangling_edge_never_manufactures_a_false_cycle() {
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![
            edge("e1", "a", "b", EdgeKind::Sequence),
            // Dangling: "ghost" is not a real node id. Excluded from the
            // structural graph in both implementations before cycle
            // detection runs — if that exclusion broke in either one, this
            // could be mistaken for the missing "b before a" edge that
            // would close a real 2-cycle with e1.
            edge("e2", "b", "ghost", EdgeKind::Sequence),
        ],
    );
    let (lint_cycle, compile_cycle) = run_both_cycle_detectors("diff-dangling", &g);
    assert_eq!(lint_cycle, None, "lint manufactured a cycle from a dangling edge");
    assert_eq!(compile_cycle, None, "compile manufactured a cycle from a dangling edge");
}
