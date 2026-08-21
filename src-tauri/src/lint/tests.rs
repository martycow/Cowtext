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
        role: NodeRole::Architecture,
        brief: String::new(),
        file_path: file_path.to_string(),
        read_order: 0,
        root_load: None,
        position: Position { x: 0, y: 0 },
        scene_pos: None,
        last_verified: None,
        tags: Vec::new(),
        owner: None,
        deprecated: None,
        needs_review: false,
        meta: None,
    }
}

fn always(mut n: MemoryNode) -> MemoryNode {
    n.root_load = Some(RootLoad::Always);
    n
}

fn deprecate(mut n: MemoryNode, replaced_by: &str) -> MemoryNode {
    n.deprecated = Some(Deprecated {
        replaced_by: replaced_by.to_string(),
        since: None,
        reason: None,
    });
    n
}

fn edge(id: &str, source: &str, target: &str, kind: EdgeKind) -> MemoryEdge {
    MemoryEdge {
        id: id.to_string(),
        source: source.to_string(),
        target: target.to_string(),
        kind,
        guard: None,
        note: None,
        color: None,
        waypoints: Vec::new(),
    }
}

fn glob_guard(mut e: MemoryEdge, globs: &[&str]) -> MemoryEdge {
    e.guard = Some(EdgeGuard::Glob {
        globs: globs.iter().map(|s| s.to_string()).collect(),
    });
    e
}

fn desc_guard(mut e: MemoryEdge, text: &str) -> MemoryEdge {
    e.guard = Some(EdgeGuard::Description { text: text.to_string() });
    e
}

fn graph(nodes: Vec<MemoryNode>, edges: Vec<MemoryEdge>) -> BarnGraph {
    BarnGraph {
        version: 5,
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

    // "a" is root_load: always so it is not itself flagged orphan-node —
    // under v5, an unpinned node nothing points at genuinely never reaches
    // an agent, which is exactly what orphan-node exists to catch.
    let g = graph(
        vec![always(node("a", "Alpha", "context/a.md")), node("b", "Beta", "context/b.md")],
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

    // contradicts is explicitly non-structural: this "back-and-forth" shape
    // must never be mistaken for a Kahn cycle.
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::Contradicts)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::Cycle));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn guarded_imports_edge_never_enters_the_cycle_graph() {
    // WO13 §9: a guarded `imports` edge is conditional content and must not
    // participate in Kahn's algorithm — this is the same shape that would
    // be a genuine imports cycle if the guard were ignored.
    let root = temp_project("cycle-guarded-imports");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");

    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![
            glob_guard(edge("e1", "a", "b", EdgeKind::Imports), &["src/**"]),
            edge("e2", "b", "a", EdgeKind::Imports),
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

// ── Contradicts (WO13 rename of conflicts-with) ─────────────────────────

#[test]
fn contradicts_edge_reported() {
    let root = temp_project("contradicts");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::Contradicts)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::Contradicts)
        .expect("contradicts item");
    assert_eq!(hit.severity, Severity::Warning);
    assert_eq!(hit.edge_ids, vec!["e1".to_string()]);
    assert_eq!(hit.node_ids, vec!["a".to_string(), "b".to_string()]);
    assert!(hit.message.contains("Alpha"));
    assert!(hit.message.contains("Beta"));
    assert!(hit.message.contains("contradicts"));

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

// ── structural-edge-into-deprecated ──────────────────────────────────────

#[test]
fn structural_edge_into_deprecated_node_is_an_error_naming_the_replacement() {
    let root = temp_project("struct-into-deprecated");
    touch(&root.join("context/old.md"), "old");
    touch(&root.join("context/new.md"), "new");
    let old = deprecate(node("old", "Old Rules", "context/old.md"), "new");
    let g = graph(
        vec![old, node("new", "New Rules", "context/new.md")],
        vec![edge("e1", "new", "old", EdgeKind::Imports)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::StructuralEdgeIntoDeprecated)
        .expect("structural-edge-into-deprecated item");
    assert_eq!(hit.severity, Severity::Error);
    assert_eq!(hit.edge_ids, vec!["e1".to_string()]);
    assert!(hit.message.contains("New Rules"));
    assert!(hit.message.contains("Old Rules"));
    assert!(hit.fix.is_some());
    assert!(matches!(hit.fix.as_ref().unwrap(), LintFix::DropEdge { edge_id } if edge_id == "e1"));
    // Amendment 3 (D15): "one report per edge, not two." A structural edge
    // into a deprecated target is owned by structural-edge-into-deprecated
    // alone — edge-legality-warning must not ALSO fire on the same edge.
    assert!(
        !codes(&items).contains(&LintCode::EdgeLegalityWarning),
        "structural + legality must not double-report the same edge: {items:?}"
    );

    let _ = fs::remove_dir_all(&root);
}

// D15 / Amendment 3: the three other structural kinds get the same
// suppression as `imports` above — `sequence` and `overrides` are also
// owned solely by `structural-edge-into-deprecated`.

#[test]
fn sequence_into_a_deprecated_node_does_not_double_report() {
    let root = temp_project("sequence-into-deprecated-no-double-report");
    touch(&root.join("context/old.md"), "old");
    touch(&root.join("context/new.md"), "new");
    let old = deprecate(node("old", "Old", "context/old.md"), "new");
    let g = graph(
        vec![old, node("new", "New", "context/new.md")],
        vec![edge("e1", "new", "old", EdgeKind::Sequence)],
    );

    let items = lint_graph(&root, &g);
    assert!(codes(&items).contains(&LintCode::StructuralEdgeIntoDeprecated));
    assert!(!codes(&items).contains(&LintCode::EdgeLegalityWarning));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn overrides_into_a_deprecated_node_does_not_double_report() {
    let root = temp_project("overrides-into-deprecated-no-double-report");
    touch(&root.join("context/old.md"), "old");
    touch(&root.join("context/new.md"), "new");
    let old = deprecate(node("old", "Old", "context/old.md"), "new");
    let g = graph(
        vec![old, node("new", "New", "context/new.md")],
        vec![edge("e1", "new", "old", EdgeKind::Overrides)],
    );

    let items = lint_graph(&root, &g);
    assert!(codes(&items).contains(&LintCode::StructuralEdgeIntoDeprecated));
    assert!(!codes(&items).contains(&LintCode::EdgeLegalityWarning));

    let _ = fs::remove_dir_all(&root);
}

/// D15 / Amendment 3: `references` and `contradicts` have no structural
/// check watching them, so `edge-legality-warning` remains their ONLY
/// report for an edge into a deprecated target.
#[test]
fn contradicts_into_a_deprecated_node_is_the_sole_report() {
    let root = temp_project("contradicts-into-deprecated-sole-report");
    touch(&root.join("context/old.md"), "old");
    touch(&root.join("context/new.md"), "new");
    let old = deprecate(node("old", "Old", "context/old.md"), "new");
    let g = graph(
        vec![old, node("new", "New", "context/new.md")],
        vec![edge("e1", "new", "old", EdgeKind::Contradicts)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::StructuralEdgeIntoDeprecated));
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::EdgeLegalityWarning)
        .expect("edge-legality-warning is the sole report for a contradicts edge");
    assert_eq!(hit.severity, Severity::Error);
    assert_eq!(hit.message, "That node is marked out of date and won't reach the agent.");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn non_structural_edge_into_deprecated_node_is_not_flagged() {
    let root = temp_project("nonstruct-into-deprecated");
    touch(&root.join("context/old.md"), "old");
    touch(&root.join("context/new.md"), "new");
    let old = deprecate(node("old", "Old Rules", "context/old.md"), "new");
    let g = graph(
        vec![old, node("new", "New Rules", "context/new.md")],
        vec![edge("e1", "new", "old", EdgeKind::References)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::StructuralEdgeIntoDeprecated));

    let _ = fs::remove_dir_all(&root);
}

// ── command-may-be-env ───────────────────────────────────────────────────

#[test]
fn command_without_arguments_token_may_be_env() {
    let root = temp_project("command-may-be-env");
    touch(&root.join("context/build.md"), "npm run build\nnpm test\n");
    let mut n = node("build", "Build", "context/build.md");
    n.role = NodeRole::Command;
    let g = graph(vec![n], vec![]);

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::CommandMayBeEnv)
        .expect("command-may-be-env item");
    assert_eq!(hit.severity, Severity::Warning);
    assert!(matches!(
        hit.fix.as_ref().unwrap(),
        LintFix::RetypeNode { node_id, role } if node_id == "build" && *role == NodeRole::Env
    ));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn command_with_arguments_token_is_not_flagged() {
    let root = temp_project("command-with-arguments");
    touch(&root.join("context/deploy.md"), "Deploy $ARGUMENTS to prod.\n");
    let mut n = node("deploy", "Deploy", "context/deploy.md");
    n.role = NodeRole::Command;
    let g = graph(vec![n], vec![]);

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::CommandMayBeEnv));

    let _ = fs::remove_dir_all(&root);
}

// ── edge-legality-warning ────────────────────────────────────────────────

#[test]
fn imports_into_architecture_warns_with_the_matching_reason() {
    let root = temp_project("legality-imports-architecture");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let mut arch = node("b", "Beta", "context/b.md");
    arch.role = NodeRole::Architecture;
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), arch],
        vec![edge("e1", "a", "b", EdgeKind::Imports)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::EdgeLegalityWarning)
        .expect("edge-legality-warning item");
    assert_eq!(hit.severity, Severity::Warning);
    assert!(hit.message.contains("Inlining puts this in every request"));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn overrides_across_groups_warns_cross_group() {
    let root = temp_project("legality-overrides-cross-group");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let mut rule = node("a", "A Rule", "context/a.md");
    rule.role = NodeRole::Rule;
    let mut workflow = node("b", "A Workflow", "context/b.md");
    workflow.role = NodeRole::Workflow;
    let g = graph(
        vec![rule, workflow],
        vec![edge("e1", "a", "b", EdgeKind::Overrides)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::EdgeLegalityWarning)
        .expect("edge-legality-warning item for cross-group overrides");
    assert!(hit.message.contains("same plane"));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn overrides_within_the_same_group_does_not_warn_cross_group() {
    let root = temp_project("legality-overrides-same-group");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let mut rule_a = node("a", "Rule A", "context/a.md");
    rule_a.role = NodeRole::Rule;
    let mut rule_b = node("b", "Rule B", "context/b.md");
    rule_b.role = NodeRole::Invariant; // still "constraints" group
    let g = graph(
        vec![rule_a, rule_b],
        vec![edge("e1", "a", "b", EdgeKind::Overrides)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::EdgeLegalityWarning));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn allow_rule_never_produces_a_legality_warning() {
    let root = temp_project("legality-allow");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let mut example = node("a", "An Example", "context/a.md");
    example.role = NodeRole::Example;
    let mut rule = node("b", "A Rule", "context/b.md");
    rule.role = NodeRole::Rule;
    let g = graph(
        vec![example, rule],
        vec![edge("e1", "a", "b", EdgeKind::References)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::EdgeLegalityWarning));

    let _ = fs::remove_dir_all(&root);
}

// ── D8: deny-legality edges fire at Error, same code, verbatim reason ────
//
// `src/store/graph.ts`'s `addEdge`/`updateEdge` refuse a deny-legality edge
// at draw/edit time (D7), but `import_apply`/`preset_apply` write
// `graph.json` directly and never re-enter that gate, and undo/redo can
// resurrect one whose target was deprecated after the edge was drawn. A
// deny edge surviving into a loaded graph is therefore a real defect, not a
// drawing-time near-miss.

#[test]
fn imports_into_command_role_is_denied_and_reported_as_an_error() {
    let root = temp_project("legality-deny-command");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/cmd.md"), "cmd");
    let mut cmd = node("cmd", "Deploy", "context/cmd.md");
    cmd.role = NodeRole::Command;
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), cmd],
        vec![edge("e1", "a", "cmd", EdgeKind::Imports)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::EdgeLegalityWarning)
        .expect("edge-legality-warning item for a denied edge");
    assert_eq!(hit.severity, Severity::Error);
    assert_eq!(
        hit.message,
        "Commands run when you call them — inlining one removes the point of it. Use references."
    );
    assert!(hit.fix.is_none());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn imports_into_a_deprecated_node_is_denied_and_reported_as_an_error() {
    let root = temp_project("legality-deny-deprecated");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/old.md"), "old");
    let old = deprecate(node("old", "Old", "context/old.md"), "a");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), old],
        vec![edge("e1", "a", "old", EdgeKind::References)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::EdgeLegalityWarning)
        .expect("edge-legality-warning item for an edge into a deprecated node");
    assert_eq!(hit.severity, Severity::Error);
    assert_eq!(hit.message, "That node is marked out of date and won't reach the agent.");

    let _ = fs::remove_dir_all(&root);
}

// ── D12: a suggested AddImports fix is suppressed when it would itself be
//    denied — a fix the user clicks that silently does nothing is worse
//    than no fix button. ────────────────────────────────────────────────

#[test]
fn override_not_co_resident_into_a_command_node_ships_no_fix() {
    // rule 3 makes a command node's resolved policy on-invoke regardless of
    // edges, so it can NEVER be co-resident with anything — this error
    // always fires. Its suggested fix would be `AddImports { a, cmd }`,
    // which `edgeRules.ts`/`updateEdge`'s own gate denies outright (imports
    // into a command node) — so the fix must be absent, not merely present
    // and inert.
    let root = temp_project("override-fix-denied-command");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/cmd.md"), "cmd");
    let mut cmd = node("cmd", "Deploy", "context/cmd.md");
    cmd.role = NodeRole::Command;
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), cmd],
        vec![edge("e1", "a", "cmd", EdgeKind::Overrides)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::OverrideNotCoResident)
        .expect("override-not-co-resident item");
    assert!(hit.fix.is_none(), "a denied AddImports must not be offered as a fix");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn override_not_co_resident_into_an_ordinary_node_still_ships_a_fix() {
    // Same shape, but the target is an ordinary role — AddImports is
    // genuinely applicable here, so the fix must still be offered.
    let root = temp_project("override-fix-ordinary");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::Overrides)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::OverrideNotCoResident)
        .expect("override-not-co-resident item");
    assert!(matches!(
        hit.fix.as_ref().unwrap(),
        LintFix::AddImports { source, target } if source == "a" && target == "b"
    ));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn sequence_not_co_resident_into_a_deprecated_node_ships_no_fix() {
    let root = temp_project("sequence-fix-denied-deprecated");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/old.md"), "old");
    // Role deliberately NOT `architecture`: that role has its own
    // imports-specific `warn` rule (§7.3 row 4) which, per the frozen
    // specificity formula, OUTSCORES the state-based `@deprecated` `deny`
    // rule (score 3 vs 1) — a real, TS-mirrored consequence of the table,
    // not a bug (see `imports_into_a_deprecated_node_is_denied_and_reported_
    // as_an_error`, which isolates that case with a `references` edge
    // instead). `workflow` has no competing imports-specific rule, so only
    // the `@deprecated` row matches here — unambiguous deny.
    let mut old = deprecate(node("old", "Old", "context/old.md"), "a");
    old.role = NodeRole::Workflow;
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), old],
        vec![edge("e1", "a", "old", EdgeKind::Sequence)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::SequenceNotCoResident)
        .expect("sequence-not-co-resident item");
    assert!(hit.fix.is_none());

    let _ = fs::remove_dir_all(&root);
}

// ── Load-policy checks (share one AlwaysClosure) ─────────────────────────

#[test]
fn sequence_between_non_co_resident_nodes_warns() {
    let root = temp_project("sequence-not-co-resident");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::Sequence)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::SequenceNotCoResident)
        .expect("sequence-not-co-resident item");
    assert_eq!(hit.severity, Severity::Warning);
    assert!(matches!(
        hit.fix.as_ref().unwrap(),
        LintFix::AddImports { source, target } if source == "a" && target == "b"
    ));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn sequence_between_co_resident_always_nodes_is_clean() {
    let root = temp_project("sequence-co-resident");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let g = graph(
        vec![
            always(node("a", "Alpha", "context/a.md")),
            always(node("b", "Beta", "context/b.md")),
        ],
        vec![edge("e1", "a", "b", EdgeKind::Sequence)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::SequenceNotCoResident));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn override_between_non_co_resident_nodes_is_an_error() {
    let root = temp_project("override-not-co-resident");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::Overrides)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::OverrideNotCoResident)
        .expect("override-not-co-resident item");
    assert_eq!(hit.severity, Severity::Error);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn duplicate_unguarded_imports_into_an_always_node_are_flagged_info() {
    let root = temp_project("duplicate-imports");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    touch(&root.join("context/c.md"), "c");
    let g = graph(
        vec![
            always(node("a", "Alpha", "context/a.md")),
            always(node("b", "Beta", "context/b.md")),
            node("c", "Gamma", "context/c.md"),
        ],
        vec![
            edge("e1", "a", "c", EdgeKind::Imports),
            edge("e2", "b", "c", EdgeKind::Imports),
        ],
    );

    let items = lint_graph(&root, &g);
    let hits: Vec<&LintItem> = items.iter().filter(|i| i.code == LintCode::DuplicateImports).collect();
    assert_eq!(hits.len(), 1, "only the second (higher-id) edge is flagged: {hits:?}");
    assert_eq!(hits[0].severity, Severity::Info);
    assert_eq!(hits[0].edge_ids, vec!["e2".to_string()]);
    assert!(matches!(
        hits[0].fix.as_ref().unwrap(),
        LintFix::DropEdge { edge_id } if edge_id == "e2"
    ));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn single_unguarded_import_into_an_always_node_is_not_a_duplicate() {
    let root = temp_project("single-import-clean");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/c.md"), "c");
    let g = graph(
        vec![
            always(node("a", "Alpha", "context/a.md")),
            node("c", "Gamma", "context/c.md"),
        ],
        vec![edge("e1", "a", "c", EdgeKind::Imports)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::DuplicateImports));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn orphan_node_with_no_incoming_edges_is_flagged() {
    let root = temp_project("orphan-node");
    touch(&root.join("context/a.md"), "a");
    let g = graph(vec![node("a", "Alpha", "context/a.md")], vec![]);

    let items = lint_graph(&root, &g);
    let hit = items.iter().find(|i| i.code == LintCode::OrphanNode).expect("orphan-node item");
    assert_eq!(hit.severity, Severity::Warning);
    assert_eq!(hit.node_ids, vec!["a".to_string()]);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn unreachable_import_from_a_non_closure_source_is_flagged() {
    let root = temp_project("unreachable-import");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    // Neither node is `always`, so `b` is never pulled into the closure —
    // the unguarded `imports` edge into it is unreachable, not "always".
    let g = graph(
        vec![node("a", "Alpha", "context/a.md"), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::Imports)],
    );

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::UnreachableImport)
        .expect("unreachable-import item");
    assert_eq!(hit.severity, Severity::Warning);
    assert_eq!(hit.node_ids, vec!["b".to_string()]);
    assert!(hit.message.contains("Alpha"));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn referenced_node_is_neither_orphan_nor_unreachable() {
    let root = temp_project("referenced-clean");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    // "a" is root_load: always so only "b"'s status is under test —
    // otherwise "a" itself (unpinned, nothing points at it) would
    // legitimately trip orphan-node too.
    let g = graph(
        vec![always(node("a", "Alpha", "context/a.md")), node("b", "Beta", "context/b.md")],
        vec![edge("e1", "a", "b", EdgeKind::References)],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::OrphanNode));
    assert!(!codes(&items).contains(&LintCode::UnreachableImport));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn glob_guarded_import_target_is_not_orphan_or_unreachable() {
    let root = temp_project("glob-guarded-clean");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    // "a" is root_load: always so only "b"'s status is under test — see the
    // matching comment in `referenced_node_is_neither_orphan_nor_unreachable`.
    let g = graph(
        vec![always(node("a", "Alpha", "context/a.md")), node("b", "Beta", "context/b.md")],
        vec![glob_guard(edge("e1", "a", "b", EdgeKind::Imports), &["src/**"])],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::OrphanNode));
    assert!(!codes(&items).contains(&LintCode::UnreachableImport));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn description_guarded_import_target_is_not_orphan_or_unreachable() {
    let root = temp_project("desc-guarded-clean");
    touch(&root.join("context/a.md"), "a");
    touch(&root.join("context/b.md"), "b");
    // "a" is root_load: always so only "b"'s status is under test — see the
    // matching comment in `referenced_node_is_neither_orphan_nor_unreachable`.
    let g = graph(
        vec![always(node("a", "Alpha", "context/a.md")), node("b", "Beta", "context/b.md")],
        vec![desc_guard(edge("e1", "a", "b", EdgeKind::Imports), "touching auth")],
    );

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::OrphanNode));
    assert!(!codes(&items).contains(&LintCode::UnreachableImport));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn command_and_skill_role_nodes_are_exempt_from_orphan_and_unreachable() {
    // Amendment 1 rule 1: command/skill nodes have a fixed destination
    // (on-invoke / on-demand) regardless of edges — they are never orphan
    // or unreachable in the lint sense.
    let root = temp_project("command-skill-exempt");
    touch(&root.join("context/cmd.md"), "cmd");
    touch(&root.join("context/skill.md"), "skill");
    let mut cmd = node("cmd", "Cmd", "context/cmd.md");
    cmd.role = NodeRole::Command;
    let mut skill = node("skill", "Skill", "context/skill.md");
    skill.role = NodeRole::Skill;
    let g = graph(vec![cmd, skill], vec![]);

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::OrphanNode));
    assert!(!codes(&items).contains(&LintCode::UnreachableImport));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn deprecated_node_is_exempt_from_orphan_and_unreachable() {
    let root = temp_project("deprecated-exempt");
    touch(&root.join("context/a.md"), "a");
    let n = deprecate(node("a", "Alpha", "context/a.md"), "b");
    let g = graph(vec![n], vec![]);

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::OrphanNode));
    assert!(!codes(&items).contains(&LintCode::UnreachableImport));

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn always_budget_exceeded_warns_and_names_top_contributors() {
    let root = temp_project("always-budget-exceeded");
    // ALWAYS_BUDGET_TOKENS is 10_000, chars/4 heuristic: >40_000 bytes trips it.
    let big = "x".repeat(45_000);
    touch(&root.join("context/a.md"), &big);
    let g = graph(vec![always(node("a", "Alpha", "context/a.md"))], vec![]);

    let items = lint_graph(&root, &g);
    let hit = items
        .iter()
        .find(|i| i.code == LintCode::AlwaysBudgetExceeded)
        .expect("always-budget-exceeded item");
    assert_eq!(hit.severity, Severity::Warning);
    assert!(hit.message.contains("Alpha"));
    assert_eq!(hit.node_ids, vec!["a".to_string()]);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn small_always_context_does_not_trip_the_budget_check() {
    let root = temp_project("always-budget-clean");
    touch(&root.join("context/a.md"), "small content");
    let g = graph(vec![always(node("a", "Alpha", "context/a.md"))], vec![]);

    let items = lint_graph(&root, &g);
    assert!(!codes(&items).contains(&LintCode::AlwaysBudgetExceeded));

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
        fix: None,
    };
    let json = serde_json::to_string(&item).unwrap();
    assert!(json.contains("\"code\":\"missing-file\""));
    assert!(json.contains("\"severity\":\"error\""));
    assert!(json.contains("\"nodeIds\":[\"a\"]"));
    assert!(!json.contains("edgeIds"));
    assert!(!json.contains("filePath"));
    assert!(!json.contains("\"fix\""));
}

#[test]
fn severity_info_serializes_lowercase() {
    assert_eq!(serde_json::to_string(&Severity::Info).unwrap(), "\"info\"");
}

#[test]
fn lint_fix_serializes_tagged_camel_case() {
    let fix = LintFix::DropEdge { edge_id: "e1".to_string() };
    let json = serde_json::to_string(&fix).unwrap();
    assert_eq!(json, "{\"kind\":\"dropEdge\",\"edgeId\":\"e1\"}");

    let fix = LintFix::RetypeNode { node_id: "n1".to_string(), role: NodeRole::Env };
    let json = serde_json::to_string(&fix).unwrap();
    assert_eq!(json, "{\"kind\":\"retypeNode\",\"nodeId\":\"n1\",\"role\":\"env\"}");

    let fix = LintFix::AddImports { source: "a".to_string(), target: "b".to_string() };
    let json = serde_json::to_string(&fix).unwrap();
    assert_eq!(json, "{\"kind\":\"addImports\",\"source\":\"a\",\"target\":\"b\"}");
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
//
// NOTE (WO13): `compile_preview` gained a third `overlay: Vec<ApprovedFile>`
// argument (WO13_CONTRACT.md §10.1, lane R1) — this differential harness
// passes `Vec::new()` since no fixture here previews an unwritten draft.

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
    let preview = compile_preview(root.to_string_lossy().into_owned(), graph_json, Vec::new()).unwrap();
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

// ── Shared corpus (WO13_CONTRACT.md §7.3, Amendment 3; WO13_AUDIT.md D15) ──
//
// tests/fixtures/edge_legality_cases.json is tech-lead-owned and asserted
// from BOTH this file and src/config/edgeRules.test.ts — the same
// mechanism §8.3 already uses for resolve_load_cases.json. Standing fix for
// the "a Rust/TS mirror pair agreed with each other while both diverged
// from the spec" failure class (D15, after D5's `always_closure` seeds):
// pin both sides against the contract's own text, never against each
// other.

mod edge_legality_corpus {
    use super::*;
    use serde::Deserialize;

    const FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/edge_legality_cases.json"
    ));

    #[derive(Deserialize)]
    struct ExpectedLegality {
        legality: String,
        reason: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EdgeLegalityCase {
        name: String,
        source_role: NodeRole,
        kind: EdgeKind,
        target_role: NodeRole,
        target_deprecated: bool,
        expected: ExpectedLegality,
    }

    #[derive(Deserialize)]
    struct EdgeLegalityCorpus {
        cases: Vec<EdgeLegalityCase>,
    }

    fn parse_legality(s: &str) -> Legality {
        match s {
            "allow" => Legality::Allow,
            "warn" => Legality::Warn,
            "deny" => Legality::Deny,
            other => panic!("unknown legality in corpus: {other:?}"),
        }
    }

    #[test]
    fn every_corpus_case_matches_legality_for() {
        let corpus: EdgeLegalityCorpus =
            serde_json::from_str(FIXTURE).expect("edge_legality_cases.json must parse");
        assert!(
            corpus.cases.len() >= 25,
            "corpus must cover every production rule at least twice (deprecated + non-deprecated)"
        );
        for c in &corpus.cases {
            let (legality, reason) =
                legality_for(c.source_role, c.kind, c.target_role, c.target_deprecated);
            assert_eq!(
                legality,
                parse_legality(&c.expected.legality),
                "case {:?}: legality mismatch",
                c.name
            );
            assert_eq!(reason, c.expected.reason, "case {:?}: reason mismatch", c.name);
        }
    }
}
