use super::*;
use crate::project::{Deprecated, EdgeGuard};
use std::fs;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-import-{tag}-{}", std::process::id()));
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

fn write_graph_json(root: &Path, graph: &BarnGraph) {
    touch(&root.join(".cowtext/graph.json"), &serialize_graph(graph));
}

fn approved_node(id: &str, file_path: &str) -> ImportProposedNode {
    ImportProposedNode {
        id: id.to_string(),
        title: id.to_string(),
        role: NodeRole::Architecture,
        file_path: file_path.to_string(),
        brief: String::new(),
        source_file: file_path.to_string(),
        already_managed: false,
        pinned: false,
        compile_owned: false,
    }
}

/// A v5 `MemoryNode` fixture with every field explicit, so a schema change
/// breaks this test file at compile time rather than silently mismatching.
fn memory_node(id: &str, title: &str, file_path: &str) -> MemoryNode {
    MemoryNode {
        id: id.to_string(),
        title: title.to_string(),
        role: NodeRole::Architecture,
        brief: String::new(),
        file_path: file_path.to_string(),
        read_order: 0,
        root_load: None,
        position: Position::default(),
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

// ── import_scan: errors XOR changeset ───────────────────────────────

#[test]
fn scan_bad_root_is_err() {
    let bad = std::env::temp_dir().join("cowtext-import-does-not-exist-at-all-xyz");
    let _ = fs::remove_dir_all(&bad);
    let result = import_scan(bad.to_string_lossy().into_owned());
    assert!(result.is_err());
}

#[test]
fn scan_valid_empty_root_is_ok_empty_changeset() {
    let dir = temp_project("empty-root");
    let result = import_scan(dir.to_string_lossy().into_owned());
    let cs = result.expect("valid root scans without error");
    assert!(cs.nodes.is_empty());
    assert!(cs.edges.is_empty());
}

// ── realistic hand-written CLAUDE.md ────────────────────────────────

#[test]
fn scan_realistic_claude_md() {
    let dir = temp_project("claude-md");
    touch(
        &dir.join("CLAUDE.md"),
        "# CLAUDE.md\n\n\
         This file provides guidance for working in this repo.\n\n\
         # Demo Project — a small example app\n\n\
         ## Hard rules\n\n\
         - Never commit secrets.\n\
         - Always run tests before pushing.\n\n\
         ## Commands\n\n\
         `npm test`\n\n\
         ## Architecture\n\n\
         Two layers: frontend and backend.\n\n\
         See @docs/architecture.md for details and [contributing guide](docs/contributing.md).\n",
    );
    touch(
        &dir.join("docs/architecture.md"),
        "# Architecture\n\nDetails here.\n",
    );
    touch(
        &dir.join("docs/contributing.md"),
        "# Contributing\n\nHow to help.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();

    let claude = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "CLAUDE.md")
        .expect("CLAUDE.md node");
    assert_eq!(claude.title, "CLAUDE.md");
    assert_eq!(claude.source_file, "CLAUDE.md");
    assert!(!claude.already_managed);
    // D2 fix: CLAUDE.md is a path Compile owns and will overwrite — flagged
    // regardless of already_managed, which stays false for hand-written
    // content. This is the field the review UI must key its default
    // adopt/skip state on for this row.
    assert!(claude.compile_owned);
    // "Hard rules" heading present -> Invariant, checked ahead of the
    // generic "rule" keyword in the priority table.
    assert_eq!(claude.role, NodeRole::Invariant);
    assert_eq!(
        claude.brief,
        "This file provides guidance for working in this repo."
    );

    let arch = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "docs/architecture.md")
        .expect("@import target node");
    assert_eq!(arch.source_file, "CLAUDE.md");
    assert!(
        !arch.compile_owned,
        "an ordinary referenced doc file is not a compile-output shape"
    );

    let contrib = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "docs/contributing.md")
        .expect("md-link target node");
    assert_eq!(contrib.source_file, "CLAUDE.md");
    assert!(!contrib.compile_owned);

    let imports_edge = cs
        .edges
        .iter()
        .find(|e| e.source == claude.id && e.target == arch.id)
        .expect("imports edge for @docs/architecture.md");
    assert_eq!(imports_edge.kind, EdgeKind::Imports);
    assert!(imports_edge.guard.is_none(), "a plain @import carries no guard");

    let refs_edge = cs
        .edges
        .iter()
        .find(|e| e.source == claude.id && e.target == contrib.id)
        .expect("references edge for [contributing guide](docs/contributing.md)");
    assert_eq!(refs_edge.kind, EdgeKind::References);
}

#[test]
fn scan_reports_dangling_reference_as_warning_not_node() {
    let dir = temp_project("dangling-ref");
    touch(
        &dir.join("CLAUDE.md"),
        "# CLAUDE.md\n\nSee @docs/missing.md.\n",
    );
    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert!(cs.nodes.iter().all(|n| n.file_path != "docs/missing.md"));
    assert!(cs.warnings.iter().any(|w| w.contains("docs/missing.md")));
}

// ── nested AGENTS.md ─────────────────────────────────────────────────

#[test]
fn scan_nested_agents_md() {
    let dir = temp_project("nested-agents");
    touch(&dir.join("AGENTS.md"), "# AGENTS.md\n\nRoot agent notes.\n");
    touch(
        &dir.join("packages/api/AGENTS.md"),
        "# API agent notes\n\nSpecific to packages/api.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();

    let root_node = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "AGENTS.md")
        .expect("root AGENTS.md node");
    assert_eq!(root_node.title, "AGENTS.md");
    assert!(
        root_node.compile_owned,
        "AGENTS.md is a compile-output shape"
    );

    let nested = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "packages/api/AGENTS.md")
        .expect("nested AGENTS.md node");
    assert_eq!(nested.title, "AGENTS.md (packages/api)");
    assert!(
        nested.compile_owned,
        "compile.rs's classify_output matches [.., \"AGENTS.md\"] regardless of directory"
    );
}

// ── .mdc frontmatter: globs -> guarded imports edge ─────────────────────

#[test]
fn scan_mdc_globs_maps_to_guarded_imports_edge() {
    let dir = temp_project("mdc-globs");
    touch(&dir.join("CLAUDE.md"), "# CLAUDE.md\n\nRoot context.\n");
    touch(
        &dir.join(".cursor/rules/net.mdc"),
        "---\ndescription: How the app talks to external services.\nglobs: src/net/**\n---\nNetworking body.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();

    let claude = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "CLAUDE.md")
        .unwrap();
    let net = cs
        .nodes
        .iter()
        .find(|n| n.file_path == ".cursor/rules/net.mdc")
        .expect(".mdc node");
    assert_eq!(net.title, "How the app talks to external services.");
    assert!(!net.pinned);
    assert_eq!(net.role, NodeRole::Architecture);
    assert!(
        net.compile_owned,
        ".cursor/rules/*.mdc is a compile-output shape"
    );

    let guarded_edge = cs
        .edges
        .iter()
        .find(|e| e.source == claude.id && e.target == net.id)
        .expect("guarded imports edge anchored at CLAUDE.md");
    assert_eq!(guarded_edge.kind, EdgeKind::Imports);
    assert_eq!(
        guarded_edge.guard,
        Some(EdgeGuard::Glob { globs: vec!["src/net/**".to_string()] })
    );
}

#[test]
fn scan_mdc_multiple_globs_split_on_comma() {
    let dir = temp_project("mdc-globs-multi");
    touch(&dir.join("CLAUDE.md"), "# CLAUDE.md\n\nRoot context.\n");
    touch(
        &dir.join(".cursor/rules/net.mdc"),
        "---\ndescription: Networking\nglobs: src/net/**, src/api/**\n---\nBody.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    let claude = cs.nodes.iter().find(|n| n.file_path == "CLAUDE.md").unwrap();
    let net = cs
        .nodes
        .iter()
        .find(|n| n.file_path == ".cursor/rules/net.mdc")
        .unwrap();
    let guarded_edge = cs
        .edges
        .iter()
        .find(|e| e.source == claude.id && e.target == net.id)
        .expect("guarded imports edge");
    assert_eq!(
        guarded_edge.guard,
        Some(EdgeGuard::Glob {
            globs: vec!["src/net/**".to_string(), "src/api/**".to_string()]
        })
    );
}

// ── .mdc frontmatter: alwaysApply -> pinned ─────────────────────────────

#[test]
fn scan_mdc_always_apply_maps_to_pinned() {
    let dir = temp_project("mdc-always-apply");
    touch(
        &dir.join(".cursor/rules/base.mdc"),
        "---\ndescription: Base rules applied everywhere\nalwaysApply: true\n---\nAlways active content.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    let base = cs
        .nodes
        .iter()
        .find(|n| n.file_path == ".cursor/rules/base.mdc")
        .expect(".mdc node");
    assert!(base.pinned);
    assert!(base.compile_owned);
    // No CLAUDE.md/AGENTS.md anchor in this fixture, so no guarded edge
    // exists at all — and alwaysApply never produces one anyway.
    assert!(cs.edges.iter().all(|e| e.guard.is_none()));
}

#[test]
fn scan_mdc_unterminated_frontmatter_is_a_warning() {
    let dir = temp_project("mdc-malformed");
    touch(
        &dir.join(".cursor/rules/broken.mdc"),
        "---\ndescription: no closing fence\nstill going\n",
    );
    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert!(cs.warnings.iter().any(|w| w.contains("broken.mdc")));
    // Still proposed as a node (best-effort), just without frontmatter data.
    assert!(cs
        .nodes
        .iter()
        .any(|n| n.file_path == ".cursor/rules/broken.mdc"));
}

// ── GENERATED-header detection ──────────────────────────────────────

#[test]
fn scan_generated_header_file_is_already_managed() {
    let dir = temp_project("generated-header");
    touch(
        &dir.join("CLAUDE.md"),
        &format!("{GENERATED_HEADER}\n\n# Project — agent context\n\n## Always read\n"),
    );
    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    let claude = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "CLAUDE.md")
        .expect("CLAUDE.md node still proposed");
    assert!(claude.already_managed);
    // The two flags are independent and can coexist — a compiled CLAUDE.md
    // is both already-managed (has the header) and compile-owned (path
    // shape); a hand-written one is compile-owned but not already-managed
    // (see `scan_realistic_claude_md`), which was the exact D2 gap.
    assert!(claude.compile_owned);
}

// ── Round-trip: importing a Cowtext-generated project proposes no
//    duplicate source nodes (neither the compiled file itself nor the
//    real context/*.md files it @-imports, which are already graph nodes
//    but carry no GENERATED header of their own — the existing-graph-path
//    check is what catches those). ──────────────────────────────────────

#[test]
fn scan_round_trip_generated_project_proposes_no_duplicates() {
    let dir = temp_project("round-trip");
    touch(
        &dir.join("context/architecture.md"),
        "# Architecture\n\nHand-written source content.\n",
    );
    write_graph_json(
        &dir,
        &BarnGraph {
            version: GRAPH_VERSION,
            project_name: "RoundTrip".to_string(),
            nodes: vec![always(memory_node(
                "architecture",
                "Architecture",
                "context/architecture.md",
            ))],
            edges: Vec::new(),
            compile_targets: vec![CompileTarget::Claude],
        },
    );
    touch(
        &dir.join("CLAUDE.md"),
        &format!(
            "{GENERATED_HEADER}\n\n# RoundTrip — agent context\n\n## Always read\n\n@context/architecture.md\n"
        ),
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert_eq!(
        cs.nodes.len(),
        2,
        "CLAUDE.md itself plus the one @-imported context file"
    );
    assert!(
        cs.nodes.iter().all(|n| n.already_managed),
        "every proposed node must be flagged already-managed"
    );
}

// ── import_apply: never touches file content ────────────────────────

#[test]
fn apply_never_modifies_source_file_bytes_or_mtime() {
    let dir = temp_project("apply-no-write");
    // Not CLAUDE.md/AGENTS.md/*.mdc: this test's whole point is to prove a
    // file that DOES get turned into a node is left byte-for-byte alone —
    // a compile-owned path would be refused before ever reaching a write
    // path, which would make the assertion vacuous. See
    // `apply_refuses_compile_output_path_and_counts_it_skipped` for that.
    let notes_path = dir.join("notes.md");
    touch(
        &notes_path,
        "# Notes\n\nHand-written, must survive byte-for-byte.\n",
    );
    let before_bytes = fs::read(&notes_path).unwrap();
    let before_mtime = fs::metadata(&notes_path).unwrap().modified().unwrap();

    let changeset = ImportApproved {
        nodes: vec![approved_node("n1", "notes.md")],
        edges: vec![],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset).unwrap();
    assert_eq!(result.nodes_added, 1);
    assert_eq!(result.skipped, 0);

    let after_bytes = fs::read(&notes_path).unwrap();
    let after_mtime = fs::metadata(&notes_path).unwrap().modified().unwrap();
    assert_eq!(
        before_bytes, after_bytes,
        "import_apply must never rewrite the source file's content"
    );
    assert_eq!(
        before_mtime, after_mtime,
        "import_apply must never even touch (rewrite) the source file"
    );
}

#[test]
fn apply_creates_graph_json_from_scratch() {
    let dir = temp_project("apply-fresh-graph");
    touch(&dir.join("notes.md"), "# Notes\n\nHello.\n");
    let changeset = ImportApproved {
        nodes: vec![approved_node("n1", "notes.md")],
        edges: vec![],
    };
    import_apply(dir.to_string_lossy().into_owned(), changeset).unwrap();

    let raw = fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap();
    let graph = migrate_graph(&raw).unwrap();
    assert_eq!(graph.nodes.len(), 1);
    assert_eq!(graph.nodes[0].file_path, "notes.md");
}

#[test]
fn apply_maps_pinned_proposal_to_root_load_always() {
    let dir = temp_project("apply-pinned-maps-root-load");
    touch(&dir.join("notes.md"), "# Notes\n\nHello.\n");
    let mut n = approved_node("n1", "notes.md");
    n.pinned = true;
    let changeset = ImportApproved {
        nodes: vec![n],
        edges: vec![],
    };
    import_apply(dir.to_string_lossy().into_owned(), changeset).unwrap();

    let raw = fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap();
    let graph = migrate_graph(&raw).unwrap();
    assert_eq!(graph.nodes[0].root_load, Some(RootLoad::Always));
}

// ── import_apply: never-clobber (existing node at the same filePath) ───

#[test]
fn apply_never_clobbers_existing_node_at_same_file_path() {
    let dir = temp_project("apply-no-clobber");
    touch(&dir.join("notes.md"), "# Notes\n\nHello.\n");
    write_graph_json(
        &dir,
        &BarnGraph {
            version: GRAPH_VERSION,
            project_name: String::new(),
            nodes: vec![memory_node("existing-notes", "Existing", "notes.md")],
            edges: Vec::new(),
            compile_targets: vec![CompileTarget::Claude],
        },
    );

    let changeset = ImportApproved {
        nodes: vec![approved_node("n1", "notes.md")],
        edges: vec![],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset).unwrap();
    assert_eq!(result.nodes_added, 0);
    assert_eq!(result.skipped, 1);

    let raw = fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap();
    let graph = migrate_graph(&raw).unwrap();
    assert_eq!(
        graph.nodes.len(),
        1,
        "no duplicate node for the same filePath"
    );
    assert_eq!(
        graph.nodes[0].id, "existing-notes",
        "the pre-existing node wins, never overwritten"
    );
}

#[test]
fn apply_edge_needs_both_endpoints_in_the_approved_set() {
    let dir = temp_project("apply-edge-missing-endpoint");
    touch(&dir.join("notes.md"), "# Notes\n\nHello.\n");
    let changeset = ImportApproved {
        nodes: vec![approved_node("n1", "notes.md")],
        edges: vec![ImportProposedEdge {
            id: "e1".to_string(),
            source: "n1".to_string(),
            target: "not-in-approved-set".to_string(),
            kind: EdgeKind::Imports,
            guard: None,
        }],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset).unwrap();
    assert_eq!(result.nodes_added, 1);
    assert_eq!(result.edges_added, 0);
    assert_eq!(result.skipped, 1);
}

#[test]
fn apply_carries_the_guard_through_onto_the_graph_edge() {
    let dir = temp_project("apply-guard-carries");
    touch(&dir.join("a.md"), "a");
    touch(&dir.join("b.md"), "b");
    let changeset = ImportApproved {
        nodes: vec![approved_node("n1", "a.md"), approved_node("n2", "b.md")],
        edges: vec![ImportProposedEdge {
            id: "e1".to_string(),
            source: "n1".to_string(),
            target: "n2".to_string(),
            kind: EdgeKind::Imports,
            guard: Some(EdgeGuard::Glob { globs: vec!["src/**".to_string()] }),
        }],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset).unwrap();
    assert_eq!(result.edges_added, 1);

    let raw = fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap();
    let graph = migrate_graph(&raw).unwrap();
    assert_eq!(
        graph.edges[0].guard,
        Some(EdgeGuard::Glob { globs: vec!["src/**".to_string()] })
    );
}

// ── import_apply: refuses compile-output paths (WO03 audit D2) ─────────

#[test]
fn apply_refuses_compile_output_path_and_counts_it_skipped() {
    let dir = temp_project("apply-refuses-compile-output");
    touch(
        &dir.join("CLAUDE.md"),
        "# CLAUDE.md\n\n400 hand-written lines that must never be overwritten.\n",
    );
    let changeset = ImportApproved {
        nodes: vec![approved_node("n1", "CLAUDE.md")],
        edges: vec![],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset)
        .expect("refusing a compile-output path is a non-fatal skip, not an Err");
    assert_eq!(
        result.nodes_added, 0,
        "CLAUDE.md must never become a node — compile owns and overwrites that path"
    );
    assert_eq!(result.skipped, 1);

    // No graph.json at all should have been created for a wholly-refused
    // request — nothing else was added either.
    assert!(!dir.join(".cowtext/graph.json").exists());
}

/// WO13_AUDIT.md D9: the WO03-D2 guard's stale re-derivation did not know
/// about `.claude/commands/` (R1's Amendment 1 arm), so a changeset naming
/// one used to be admitted here — the last line stopping `import_apply`
/// from creating a node whose file compile owns and will silently
/// overwrite (wrapped in a `description:` fence and a GENERATED header,
/// every subsequent compile). Calling `compile.rs::classify_output`
/// directly (rather than a copy that can go stale) closes the hole.
#[test]
fn apply_refuses_claude_commands_compile_output_path() {
    let dir = temp_project("apply-refuses-claude-commands");
    touch(
        &dir.join(".claude/commands/deploy.md"),
        "---\ndescription: Deploy\n---\nRun the deploy script.\n",
    );
    touch(&dir.join("notes.md"), "# Notes\n\nOrdinary file.\n");
    let changeset = ImportApproved {
        nodes: vec![
            approved_node("n1", ".claude/commands/deploy.md"),
            approved_node("n2", "notes.md"),
        ],
        edges: vec![],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset).unwrap();
    assert_eq!(
        result.nodes_added, 1,
        "only notes.md is a legitimate node — .claude/commands/deploy.md must never become one"
    );
    assert_eq!(result.skipped, 1);

    let raw = fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap();
    let graph = migrate_graph(&raw).unwrap();
    assert_eq!(graph.nodes.len(), 1);
    assert_eq!(graph.nodes[0].file_path, "notes.md");
}

/// The scan side of the same guard: a `.claude/commands/*.md` file
/// discovered via a markdown link from CLAUDE.md is proposed as a node
/// (`scan_inner` only walks the three primary families plus their linked
/// targets — nothing walks `.claude/commands/` proactively, so a link is
/// how it becomes reachable here) and PROPOSED with `compileOwned: true`,
/// so the review UI defaults it to not-adopted (same contract
/// `compile_owned` already carries for `CLAUDE.md`/`.mdc`/agent files).
#[test]
fn scan_flags_claude_commands_file_as_compile_owned() {
    let dir = temp_project("scan-flags-claude-commands");
    touch(
        &dir.join("CLAUDE.md"),
        "# CLAUDE.md\n\nSee [deploy command](.claude/commands/deploy.md).\n",
    );
    touch(
        &dir.join(".claude/commands/deploy.md"),
        "---\ndescription: Deploy\n---\nRun the deploy script.\n",
    );
    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    let node = cs
        .nodes
        .iter()
        .find(|n| n.file_path == ".claude/commands/deploy.md")
        .expect(".claude/commands/deploy.md node, linked from CLAUDE.md");
    assert!(node.compile_owned);
}

#[test]
fn apply_refuses_mdc_compile_output_path_even_alongside_a_normal_node() {
    let dir = temp_project("apply-refuses-mdc");
    touch(
        &dir.join(".cursor/rules/net.mdc"),
        "---\ndescription: x\n---\nBody.\n",
    );
    touch(&dir.join("notes.md"), "# Notes\n\nOrdinary file.\n");
    let changeset = ImportApproved {
        nodes: vec![
            approved_node("n1", ".cursor/rules/net.mdc"),
            approved_node("n2", "notes.md"),
        ],
        edges: vec![],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset).unwrap();
    assert_eq!(result.nodes_added, 1, "only notes.md is a legitimate node");
    assert_eq!(result.skipped, 1);

    let raw = fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap();
    let graph = migrate_graph(&raw).unwrap();
    assert_eq!(graph.nodes.len(), 1);
    assert_eq!(graph.nodes[0].file_path, "notes.md");
}

// ── scan_inner still extracts a compile-owned file's @/link edges ──────

#[test]
fn scan_compile_owned_file_still_contributes_its_edges() {
    let dir = temp_project("compile-owned-edges");
    touch(
        &dir.join("CLAUDE.md"),
        "# CLAUDE.md\n\nSee @docs/architecture.md.\n",
    );
    touch(
        &dir.join("docs/architecture.md"),
        "# Architecture\n\nDetails.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    let claude = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "CLAUDE.md")
        .unwrap();
    assert!(
        claude.compile_owned,
        "CLAUDE.md must not itself be adoptable as a node"
    );
    let arch = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "docs/architecture.md")
        .expect("the @import target is still proposed as its own node");
    assert!(!arch.compile_owned);
    assert!(
        cs.edges
            .iter()
            .any(|e| e.source == claude.id && e.target == arch.id && e.kind == EdgeKind::Imports),
        "the edge out of the compile-owned file must still be extracted, per the D2 fix's point 3"
    );
}

// ── D8: .mdc globs with no CLAUDE.md/AGENTS.md anchor ───────────────────

#[test]
fn scan_mdc_globs_without_anchor_warns_instead_of_silently_dropping() {
    let dir = temp_project("mdc-globs-no-anchor");
    // Cursor-only project: no CLAUDE.md, no AGENTS.md anywhere.
    touch(
        &dir.join(".cursor/rules/net.mdc"),
        "---\ndescription: Networking\nglobs: src/net/**\n---\nBody.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert!(cs.edges.iter().all(|e| e.guard.is_none()));
    assert!(
        cs.warnings
            .iter()
            .any(|w| w.contains("net.mdc") && w.contains("glob")),
        "the dropped glob condition must be reported, not silently discarded: {:?}",
        cs.warnings
    );
    // The node itself is still proposed and adoptable — only the guarded
    // edge is lost, not the node.
    assert!(cs
        .nodes
        .iter()
        .any(|n| n.file_path == ".cursor/rules/net.mdc"));
}

// ── D13: `@` imports resolve relative to the containing file ───────────

#[test]
fn scan_nested_at_import_resolves_relative_to_its_own_directory() {
    let dir = temp_project("d13-nested-at-import");
    touch(
        &dir.join("docs/AGENTS.md"),
        "# AGENTS.md\n\nSee @notes.md.\n",
    );
    touch(
        &dir.join("docs/notes.md"),
        "# Docs notes\n\nThe right file.\n",
    );
    // A same-named file at the root, to prove the fix doesn't produce the
    // false-match failure mode D13 called out: the nested `@notes.md`
    // must NOT resolve to this one.
    touch(&dir.join("notes.md"), "# Root notes\n\nThe wrong file.\n");

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    let agents = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "docs/AGENTS.md")
        .unwrap();
    let target = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "docs/notes.md")
        .expect("@notes.md from docs/AGENTS.md must resolve to docs/notes.md");
    assert!(
        cs.nodes.iter().all(|n| n.file_path != "notes.md"),
        "must not falsely match the same-named root-level file"
    );
    assert!(cs
        .edges
        .iter()
        .any(|e| e.source == agents.id && e.target == target.id && e.kind == EdgeKind::Imports));
}

#[test]
fn scan_nested_at_import_normalizes_parent_segments() {
    let dir = temp_project("d13-nested-at-import-dotdot");
    touch(
        &dir.join("docs/AGENTS.md"),
        "# AGENTS.md\n\nSee @../shared.md.\n",
    );
    touch(
        &dir.join("shared.md"),
        "# Shared\n\nRoot-level shared file.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    let agents = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "docs/AGENTS.md")
        .unwrap();
    let shared = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "shared.md")
        .expect("@../shared.md from docs/AGENTS.md must normalize to root-level shared.md");
    assert!(cs
        .edges
        .iter()
        .any(|e| e.source == agents.id && e.target == shared.id && e.kind == EdgeKind::Imports));
}

#[test]
fn scan_nested_at_import_rejects_root_escape() {
    let dir = temp_project("d13-nested-at-import-escape");
    touch(
        &dir.join("docs/AGENTS.md"),
        "# AGENTS.md\n\nSee @../../outside.md.\n",
    );
    // Deliberately no file created at any resolvable location — an escape
    // attempt must be dropped before it ever reaches the exists-check, not
    // produce a bogus node pointing outside the project root.
    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert!(cs.nodes.iter().all(|n| !n.file_path.contains("outside")));
    assert!(cs.edges.is_empty());
}

#[test]
fn scan_root_level_at_import_round_trips_identically_after_d13_fix() {
    // The D13 fix changes resolution from "always root-relative" to
    // "relative to the containing file's directory". For a root-level file
    // `dir` is empty, so `join_dir` is a no-op and the two interpretations
    // coincide — this is what makes Cowtext's own generated output (which
    // `compile.rs` only ever emits `@` tokens into at the project root)
    // round-trip unaffected. Root-relative-looking multi-segment paths
    // (like compile.rs's own `@context/architecture.md`) must still
    // resolve correctly, not be mistaken for something relative to a
    // nonexistent parent.
    let dir = temp_project("d13-root-round-trip");
    touch(
        &dir.join("CLAUDE.md"),
        "# CLAUDE.md\n\n## Always read\n\n@context/architecture.md\n",
    );
    touch(
        &dir.join("context/architecture.md"),
        "# Architecture\n\nRoot-anchored multi-segment target.\n",
    );

    let cs = import_scan(dir.to_string_lossy().into_owned()).unwrap();
    let claude = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "CLAUDE.md")
        .unwrap();
    let arch = cs
        .nodes
        .iter()
        .find(|n| n.file_path == "context/architecture.md")
        .expect(
            "@context/architecture.md from a root-level CLAUDE.md must still resolve root-relative",
        );
    assert!(cs
        .edges
        .iter()
        .any(|e| e.source == claude.id && e.target == arch.id && e.kind == EdgeKind::Imports));
}

// ── path-guard rejection of an escaping path ────────────────────────

#[test]
fn apply_rejects_escaping_file_path() {
    let dir = temp_project("apply-escape");
    let changeset = ImportApproved {
        nodes: vec![approved_node("n1", "../outside.md")],
        edges: vec![],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset);
    assert!(result.is_err());
}

#[test]
fn apply_rejects_file_path_that_does_not_exist() {
    let dir = temp_project("apply-missing-file");
    let changeset = ImportApproved {
        nodes: vec![approved_node("n1", "nope.md")],
        edges: vec![],
    };
    let result = import_apply(dir.to_string_lossy().into_owned(), changeset);
    assert!(result.is_err());
}

#[test]
fn apply_bad_root_is_err() {
    let bad = std::env::temp_dir().join("cowtext-import-apply-does-not-exist-xyz");
    let _ = fs::remove_dir_all(&bad);
    let result = import_apply(
        bad.to_string_lossy().into_owned(),
        ImportApproved {
            nodes: vec![],
            edges: vec![],
        },
    );
    assert!(result.is_err());
}

// ── deprecated-node fixture sanity (v5 field, exercised elsewhere) ──────

#[test]
fn memory_node_fixture_helper_carries_no_deprecation_by_default() {
    let n = memory_node("a", "Alpha", "context/a.md");
    assert!(n.deprecated.is_none());
    assert!(!n.needs_review);
    let dep = Deprecated { replaced_by: "b".to_string(), since: None, reason: None };
    assert_eq!(dep.replaced_by, "b");
}

// ── small internal-helper unit tests ────────────────────────────────

#[test]
fn helper_normalize_rel_resolves_parent_segments_within_root() {
    assert_eq!(
        normalize_rel("src/../CLAUDE.md"),
        Some("CLAUDE.md".to_string())
    );
    assert_eq!(
        normalize_rel("docs/api.md"),
        Some("docs/api.md".to_string())
    );
}

#[test]
fn helper_normalize_rel_rejects_escaping_root() {
    assert_eq!(normalize_rel("../outside.md"), None);
    assert_eq!(normalize_rel("a/../../outside.md"), None);
}

#[test]
fn helper_infer_role_defaults_to_architecture() {
    assert_eq!(infer_role("Setup and testing notes"), NodeRole::Architecture);
}

#[test]
fn helper_infer_role_matches_invariant_before_generic_rule() {
    assert_eq!(infer_role("Hard rules"), NodeRole::Invariant);
}

#[test]
fn helper_infer_role_maps_task_to_workflow_and_snippet_to_example() {
    assert_eq!(infer_role("A task list"), NodeRole::Workflow);
    assert_eq!(infer_role("A code snippet"), NodeRole::Example);
}

#[test]
fn helper_extract_at_imports_ignores_email_like_tokens() {
    let out = extract_at_imports("contact me @nobody, not a file");
    assert!(out.is_empty());
}

#[test]
fn helper_extract_md_links_skips_http_and_anchor_links() {
    let out = extract_md_links("[ext](https://example.com/x.md) [anchor](#top) [ok](docs/x.md)");
    assert_eq!(out, vec!["docs/x.md".to_string()]);
}

#[test]
fn helper_is_compile_output_path_matches_every_compile_write_shape() {
    assert!(is_compile_output_path("CLAUDE.md"));
    assert!(is_compile_output_path("AGENTS.md"));
    assert!(is_compile_output_path("packages/api/AGENTS.md"));
    assert!(is_compile_output_path(".cursor/rules/net.mdc"));
    assert!(is_compile_output_path(".github/copilot-instructions.md"));
    assert!(is_compile_output_path("GEMINI.md"));
    assert!(is_compile_output_path(".claude/agents/tech-lead.md"));
    // WO13_AUDIT.md D9: this shape (R1's Amendment 1 arm) was missing from
    // the old re-derivation, so this test's own name asserted a claim that
    // was false and passed anyway — it enumerated only six of seven
    // `classify_output` shapes. Now calling `classify_output` directly, so
    // a future compile.rs arm can never desync this test again.
    assert!(is_compile_output_path(".claude/commands/deploy.md"));
}

#[test]
fn helper_is_compile_output_path_rejects_everything_else() {
    assert!(!is_compile_output_path("docs/architecture.md"));
    assert!(!is_compile_output_path("context/notes.md"));
    assert!(!is_compile_output_path("README.md"));
    assert!(
        !is_compile_output_path("sub/CLAUDE.md"),
        "CLAUDE.md is root-only"
    );
    assert!(
        !is_compile_output_path("GEMINI.MD"),
        "case-sensitive, matches compile.rs"
    );
    assert!(!is_compile_output_path(".cursor/rules/net.txt"));
    assert!(
        !is_compile_output_path(".cursor/rules/sub/net.mdc"),
        "one component only"
    );
    assert!(!is_compile_output_path(".github/copilot-instructions.txt"));
    assert!(
        !is_compile_output_path(".claude/commands/sub/deploy.md"),
        "one component only, matches compile.rs's classify_output"
    );
    assert!(
        !is_compile_output_path(".claude/skills/demo/SKILL.md"),
        "skills are agents.rs's, never compile's"
    );
}
