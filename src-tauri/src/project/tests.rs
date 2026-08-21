use super::*;
use serde_json::json;

fn touch(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

#[test]
fn finds_md_skips_hidden_and_dep_dirs() {
    let dir = std::env::temp_dir().join(format!("cowtext-scan-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);

    touch(&dir.join("README.md"), "# hi");
    touch(&dir.join("docs/plan.MD"), "# case-insensitive");
    touch(&dir.join("docs/deep/notes.md"), "# nested");
    touch(&dir.join("src/main.rs"), "fn main() {}");
    touch(&dir.join(".git/junk.md"), "skipped");
    touch(&dir.join("node_modules/pkg/readme.md"), "skipped");

    let scan = scan_root(dir.to_string_lossy().into_owned()).unwrap();
    let paths: Vec<&str> = scan.files.iter().map(|f| f.rel_path.as_str()).collect();
    assert_eq!(paths, ["README.md", "docs/deep/notes.md", "docs/plan.MD"]);
    assert!(scan.files.iter().all(|f| f.size_bytes > 0));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_non_directory() {
    assert!(scan_root("Z:/definitely/not/a/dir".into()).is_err());
}

#[test]
fn scan_includes_claude_agents_but_excludes_the_rest_of_claude() {
    let dir = std::env::temp_dir().join(format!("cowtext-scan-agents-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);

    touch(&dir.join("README.md"), "# hi");
    touch(&dir.join(".claude/agents/tech-lead.md"), "---\nname: tech-lead\n---\n");
    touch(&dir.join(".claude/agents/tech-ui.MD"), "case-insensitive");
    touch(&dir.join(".claude/settings.json"), "{}");
    touch(&dir.join(".claude/skills/design-tokens/SKILL.md"), "# skill");
    touch(&dir.join(".claude/skills/design-tokens/notes.md"), "# skill notes");

    let scan = scan_root(dir.to_string_lossy().into_owned()).unwrap();
    let paths: Vec<&str> = scan.files.iter().map(|f| f.rel_path.as_str()).collect();
    assert_eq!(
        paths,
        [".claude/agents/tech-lead.md", ".claude/agents/tech-ui.MD", "README.md"]
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn scan_tolerates_claude_with_no_agents_dir() {
    let dir = std::env::temp_dir().join(format!("cowtext-scan-noagents-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    touch(&dir.join(".claude/settings.json"), "{}");

    let scan = scan_root(dir.to_string_lossy().into_owned()).unwrap();
    assert!(scan.files.is_empty());

    let _ = fs::remove_dir_all(&dir);
}

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn path_guard_accepts_normal_relative_paths() {
    let root = Path::new("C:/proj");
    let ok = resolve_within_root(root, "context/rules.md").unwrap();
    assert_eq!(ok, root.join("context").join("rules.md"));
    // `.` components are dropped, not rejected.
    let ok = resolve_within_root(root, "./docs/plan.md").unwrap();
    assert_eq!(ok, root.join("docs").join("plan.md"));
}

#[test]
fn path_guard_rejects_escapes() {
    let root = Path::new("C:/proj");
    for bad in [
        "../outside.md",
        "context/../../outside.md",
        "..",
        "C:/windows/system32/evil.md",
        "C:\\other\\evil.md",
        "/etc/passwd",
        "\\\\server\\share\\evil.md",
        "",
        "   ",
        ".",
    ] {
        assert!(
            resolve_within_root(root, bad).is_err(),
            "should have rejected {bad:?}"
        );
    }
}

#[test]
fn md_commands_respect_the_guard() {
    let dir = temp_project("guard");
    let root = dir.to_string_lossy().into_owned();
    assert!(write_md_file(root.clone(), "../evil.md".into(), "x".into()).is_err());
    assert!(read_md_file(root, "../../evil.md".into()).is_err());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_md_file_rejects_claude_settings_json() {
    let dir = temp_project("settings-guard");
    let root = dir.to_string_lossy().into_owned();
    for bad in [
        ".claude/settings.json",
        ".CLAUDE/Settings.JSON",
        ".claude\\settings.json",
    ] {
        let err = write_md_file(root.clone(), bad.into(), "{}".into()).unwrap_err();
        assert_eq!(err, "Use Install hooks to edit .claude/settings.json");
    }
    assert!(!dir.join(".claude/settings.json").exists());
    let _ = fs::remove_dir_all(&dir);
}

// ---- WO11 §12.3 item 4 / §12.7 (R2): write_md_file rejects agent paths ----
// (Amendment 3 — the Markdown tab was a second, uncoordinated writer to
// `.claude/agents/*.md`, racing agent_save's autosave queue across human
// time. One writer per file: agent_save owns those, enforced here as a
// runtime rejection, not a documented-only rule.)

#[test]
fn write_md_file_rejects_agent_paths() {
    let dir = temp_project("agent-path-guard");
    let root = dir.to_string_lossy().into_owned();
    for bad in [
        ".claude/agents/x.md",
        ".claude\\agents\\x.md",
        ".CLAUDE/AGENTS/X.MD",
    ] {
        let err = write_md_file(root.clone(), bad.into(), "# hi".into()).unwrap_err();
        assert_eq!(err, "Use agent_save to write an agent file");
    }
    assert!(!dir.join(".claude/agents/x.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_md_file_still_allows_skills_and_ordinary_md_files() {
    // The carve-out: skills keep the explicit-Save path (agents.rs's
    // AGENT_FS-guarded skill_save is a different writer, not this one), and
    // ordinary context nodes / CLAUDE.md are entirely unaffected by the new
    // arm — it must match `.claude/agents/` specifically, not `.claude/`
    // generally.
    let dir = temp_project("agent-path-guard-carveout");
    let root = dir.to_string_lossy().into_owned();

    write_md_file(root.clone(), ".claude/skills/demo/SKILL.md".into(), "# demo".into()).unwrap();
    assert!(dir.join(".claude/skills/demo/SKILL.md").is_file());

    write_md_file(root.clone(), "context/notes.md".into(), "# notes".into()).unwrap();
    assert!(dir.join("context/notes.md").is_file());

    write_md_file(root, "CLAUDE.md".into(), "# CLAUDE".into()).unwrap();
    assert!(dir.join("CLAUDE.md").is_file());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn graph_round_trip() {
    let dir = temp_project("graph");
    let root = dir.to_string_lossy().into_owned();

    // No graph yet → None, not an error.
    assert_eq!(read_graph(root.clone()).unwrap(), None);

    let content = "{\n  \"version\": 1,\n  \"nodes\": []\n}\n";
    write_graph(root.clone(), content.into()).unwrap();
    assert_eq!(read_graph(root.clone()).unwrap().as_deref(), Some(content));

    // Overwrite (the atomic remove+rename path) preserves the new bytes.
    let updated = "{\n  \"version\": 1,\n  \"nodes\": [{\"id\": \"a\"}]\n}\n";
    write_graph(root.clone(), updated.into()).unwrap();
    assert_eq!(read_graph(root.clone()).unwrap().as_deref(), Some(updated));

    // No temp files left behind.
    let leftovers: Vec<_> = fs::read_dir(dir.join(".cowtext"))
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
        .collect();
    assert!(leftovers.is_empty());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn md_round_trip_creates_parent_dirs() {
    let dir = temp_project("md");
    let root = dir.to_string_lossy().into_owned();
    write_md_file(root.clone(), "context/new-node.md".into(), "# Hi\n".into()).unwrap();
    assert_eq!(
        read_md_file(root, "context/new-node.md".into()).unwrap(),
        "# Hi\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_happy_path_returns_normalized_path() {
    let dir = temp_project("rename-happy");
    let root = dir.to_string_lossy().into_owned();
    write_md_file(root.clone(), "context/old-name.md".into(), "# Hi\n".into()).unwrap();

    let new_path = rename_node_file(
        root.clone(),
        "context/old-name.md".into(),
        "context/new-name.md".into(),
    )
    .unwrap();
    assert_eq!(new_path, "context/new-name.md");
    assert!(!dir.join("context/old-name.md").exists());
    assert_eq!(
        read_md_file(root, "context/new-name.md".into()).unwrap(),
        "# Hi\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_clobber_refused_both_files_intact() {
    let dir = temp_project("rename-clobber");
    let root = dir.to_string_lossy().into_owned();
    write_md_file(root.clone(), "a.md".into(), "aaa".into()).unwrap();
    write_md_file(root.clone(), "b.md".into(), "bbb".into()).unwrap();

    let err = rename_node_file(root.clone(), "a.md".into(), "b.md".into()).unwrap_err();
    assert!(err.starts_with("Already exists: "));
    assert_eq!(read_md_file(root.clone(), "a.md".into()).unwrap(), "aaa");
    assert_eq!(read_md_file(root, "b.md".into()).unwrap(), "bbb");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_rejects_dotdot_on_either_arg() {
    let dir = temp_project("rename-dotdot");
    let root = dir.to_string_lossy().into_owned();
    write_md_file(root.clone(), "a.md".into(), "aaa".into()).unwrap();

    assert!(rename_node_file(root.clone(), "../a.md".into(), "b.md".into()).is_err());
    assert!(rename_node_file(root.clone(), "a.md".into(), "../b.md".into()).is_err());
    assert!(dir.join("a.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_rejects_claude_md() {
    let dir = temp_project("rename-protected");
    let root = dir.to_string_lossy().into_owned();
    write_md_file(root.clone(), "CLAUDE.md".into(), "# claude".into()).unwrap();

    let err = rename_node_file(root.clone(), "CLAUDE.md".into(), "renamed.md".into()).unwrap_err();
    assert!(err.starts_with("Refusing to rename a generated or tool-owned file"));
    assert!(dir.join("CLAUDE.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_rejects_missing_source() {
    let dir = temp_project("rename-missing");
    let root = dir.to_string_lossy().into_owned();

    let err = rename_node_file(root, "nope.md".into(), "new.md".into()).unwrap_err();
    assert!(err.starts_with("Not a file: "));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_into_new_subdirectory_creates_it() {
    let dir = temp_project("rename-subdir");
    let root = dir.to_string_lossy().into_owned();
    write_md_file(root.clone(), "loose.md".into(), "# loose".into()).unwrap();

    let new_path = rename_node_file(
        root.clone(),
        "loose.md".into(),
        "nested/deeper/loose.md".into(),
    )
    .unwrap();
    assert_eq!(new_path, "nested/deeper/loose.md");
    assert!(dir.join("nested/deeper/loose.md").is_file());
    let _ = fs::remove_dir_all(&dir);
}

/// Parity test (WO01 Block A §4.3): `walk()` and `is_scannable_md` must
/// agree, or the watcher and the scanner would disagree about which files
/// exist. Every `rel_path` `walk()` returns must satisfy `is_scannable_md`,
/// and a fixture list of paths `walk()` would never emit must all be
/// rejected by `is_scannable_md` too.
#[test]
fn is_scannable_md_agrees_with_walk() {
    let dir = temp_project("scannable-parity");

    touch(&dir.join("README.md"), "# hi");
    touch(&dir.join("docs/deep/notes.md"), "# nested");
    touch(&dir.join(".claude/agents/tech-lead.md"), "---\nname: tech-lead\n---\n");
    touch(&dir.join(".claude/agents/tech-ui.MD"), "case-insensitive");
    touch(&dir.join(".git/junk.md"), "skipped");
    touch(&dir.join("node_modules/pkg/readme.md"), "skipped");
    touch(&dir.join(".claude/settings.md"), "skipped");
    touch(&dir.join(".claude/skills/s/SKILL.md"), "skipped");
    touch(&dir.join("target/x.md"), "skipped");
    touch(&dir.join(".hidden/x.md"), "skipped");
    touch(&dir.join(".claude/agents/sub/x.md"), "skipped, non-recursive");

    let mut files = Vec::new();
    walk(&dir, &dir, &mut files).unwrap();
    assert!(!files.is_empty());
    for f in &files {
        assert!(
            is_scannable_md(&dir, &dir.join(&f.rel_path)),
            "walk() returned {} but is_scannable_md rejected it",
            f.rel_path
        );
    }

    let negative_fixtures = [
        ".git/x.md",
        "node_modules/a/b.md",
        ".claude/settings.md",
        ".claude/skills/s/SKILL.md",
        "target/x.md",
        ".hidden/x.md",
        ".claude/agents/sub/x.md",
    ];
    for rel in negative_fixtures {
        assert!(
            !is_scannable_md(&dir, &dir.join(rel)),
            "{rel} should not be scannable"
        );
    }

    let _ = fs::remove_dir_all(&dir);
}

// ── Graph v5 schema (WO13) ─────────────────────────────────────────────

/// A realistic v4 `graph.json` fixture: two nodes exercising every v4
/// field (pinned, scenePos, lastVerified, a conditional edge's `condition`,
/// a references edge's `note`), non-default `compileTargets`. Used by the
/// migration/serialization tests below. (Renamed from the WO03-era
/// `v2_fixture` — the shape moved from v2 to v4 without changing meaning
/// as v3/v4 landed pure default-filling; WO13 is the first migration since
/// that reshapes fields, so this fixture now stands in for "any pre-v5
/// input".)
fn v4_fixture() -> String {
    json!({
        "version": 4,
        "projectName": "demo",
        "nodes": [
            {
                "id": "n1",
                "title": "Tech Lead",
                "role": "agent",
                "brief": "Coordinates the fleet",
                "filePath": ".claude/agents/tech-lead.md",
                "readOrder": 1,
                "pinned": true,
                "position": { "x": 80, "y": 120 },
                "scenePos": { "tx": 3, "ty": 4 },
                "lastVerified": "2026-08-01"
            },
            {
                "id": "n2",
                "title": "Rules",
                "role": "rules",
                "brief": "",
                "filePath": "context/rules.md",
                "readOrder": 2,
                "pinned": false,
                "position": { "x": 240, "y": 120 }
            }
        ],
        "edges": [
            {
                "id": "e1",
                "source": "n1",
                "target": "n2",
                "kind": "references",
                "note": "read this first"
            },
            {
                "id": "e2",
                "source": "n2",
                "target": "n1",
                "kind": "conditional",
                "condition": "src/net/**"
            }
        ],
        "compileTargets": ["claude", "cursor"]
    })
    .to_string()
}

/// Bare-bones v5 node literal, only the fields every test needs, so each
/// test below only overrides what it's testing. Mirrors [`MemoryNode`]'s
/// field declaration order.
fn bare_node(id: &str, role: NodeRole) -> MemoryNode {
    MemoryNode {
        id: id.to_string(),
        title: id.to_string(),
        role,
        brief: String::new(),
        file_path: format!("context/{id}.md"),
        read_order: 1,
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

/// Bare-bones v5 edge literal. Mirrors [`MemoryEdge`]'s field declaration
/// order.
fn bare_edge(id: &str, source: &str, target: &str, kind: EdgeKind) -> MemoryEdge {
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

#[test]
fn all_node_roles_round_trip_with_exact_wire_names() {
    let expected = [
        (NodeRole::Agent, "agent"),
        (NodeRole::Rule, "rule"),
        (NodeRole::Invariant, "invariant"),
        (NodeRole::Trap, "trap"),
        (NodeRole::Architecture, "architecture"),
        (NodeRole::Decision, "decision"),
        (NodeRole::Workflow, "workflow"),
        (NodeRole::Command, "command"),
        (NodeRole::Skill, "skill"),
        (NodeRole::Env, "env"),
        (NodeRole::Tool, "tool"),
        (NodeRole::Glossary, "glossary"),
        (NodeRole::Example, "example"),
        (NodeRole::Style, "style"),
    ];
    assert_eq!(expected.len(), NODE_ROLES.len(), "NODE_ROLES must list every variant");
    assert_eq!(expected.len(), 14, "WO13_CONTRACT.md §6.1: 14 roles");
    for (role, wire) in expected {
        let s = serde_json::to_string(&role).unwrap();
        assert_eq!(s, format!("\"{wire}\""));
        let back: NodeRole = serde_json::from_str(&s).unwrap();
        assert_eq!(back, role);
    }
}

#[test]
fn all_edge_kinds_round_trip_with_exact_wire_names() {
    let expected = [
        (EdgeKind::Imports, "imports"),
        (EdgeKind::References, "references"),
        (EdgeKind::Overrides, "overrides"),
        (EdgeKind::Sequence, "sequence"),
        (EdgeKind::Contradicts, "contradicts"),
    ];
    assert_eq!(expected.len(), EDGE_KINDS.len(), "EDGE_KINDS must list every variant");
    for (kind, wire) in expected {
        let s = serde_json::to_string(&kind).unwrap();
        assert_eq!(s, format!("\"{wire}\""));
        let back: EdgeKind = serde_json::from_str(&s).unwrap();
        assert_eq!(back, kind);
    }
}

#[test]
fn edge_guard_tag_and_field_order_match_the_frozen_wire_shape() {
    let glob = EdgeGuard::Glob { globs: vec!["src/api/**".to_string()] };
    assert_eq!(
        serde_json::to_string(&glob).unwrap(),
        r#"{"type":"glob","globs":["src/api/**"]}"#
    );
    let desc = EdgeGuard::Description { text: "you are debugging".to_string() };
    assert_eq!(
        serde_json::to_string(&desc).unwrap(),
        r#"{"type":"description","text":"you are debugging"}"#
    );
}

#[test]
fn is_structural_matches_contract_split() {
    assert!(EdgeKind::Imports.is_structural());
    assert!(EdgeKind::Sequence.is_structural());
    assert!(EdgeKind::Overrides.is_structural());
    assert!(!EdgeKind::References.is_structural());
    assert!(!EdgeKind::Contradicts.is_structural());
}

/// WO13_CONTRACT.md §9: `affects_output` is a DIFFERENT predicate from
/// `is_structural` — everything except `contradicts`.
#[test]
fn affects_output_excludes_only_contradicts() {
    assert!(EdgeKind::Imports.affects_output());
    assert!(EdgeKind::References.affects_output());
    assert!(EdgeKind::Overrides.affects_output());
    assert!(EdgeKind::Sequence.affects_output());
    assert!(!EdgeKind::Contradicts.affects_output());
}

/// WO13_CONTRACT.md §9: a guarded structural edge must NOT participate in
/// Kahn's algorithm / topological order — the WO13 replacement for the old
/// `conditional` kind's exclusion.
#[test]
fn edge_participates_in_order_excludes_guarded_structural_edges() {
    assert!(edge_participates_in_order(EdgeKind::Imports, false));
    assert!(!edge_participates_in_order(EdgeKind::Imports, true));
    assert!(edge_participates_in_order(EdgeKind::Sequence, false));
    assert!(!edge_participates_in_order(EdgeKind::Sequence, true));
    assert!(edge_participates_in_order(EdgeKind::Overrides, false));
    assert!(!edge_participates_in_order(EdgeKind::Overrides, true));
    // Non-structural kinds never participate, guarded or not.
    assert!(!edge_participates_in_order(EdgeKind::References, false));
    assert!(!edge_participates_in_order(EdgeKind::Contradicts, false));
}

#[test]
fn compile_targets_round_trip_and_new_ones_default_off() {
    for (target, wire) in [
        (CompileTarget::Claude, "claude"),
        (CompileTarget::Agents, "agents"),
        (CompileTarget::Cursor, "cursor"),
        (CompileTarget::Copilot, "copilot"),
        (CompileTarget::Gemini, "gemini"),
    ] {
        let s = serde_json::to_string(&target).unwrap();
        assert_eq!(s, format!("\"{wire}\""));
        let back: CompileTarget = serde_json::from_str(&s).unwrap();
        assert_eq!(back, target);
    }

    // Missing key ⇒ ["claude"] (matches TS's `migrateGraph` fallback).
    let raw = json!({ "version": 4, "nodes": [], "edges": [] }).to_string();
    let g = migrate_graph(&raw).unwrap();
    assert_eq!(g.compile_targets, vec![CompileTarget::Claude]);

    // Present-but-empty stays empty — copilot/gemini never sneak in as a
    // default, and an intentionally-cleared list isn't resurrected.
    let raw = json!({ "version": 4, "nodes": [], "edges": [], "compileTargets": [] }).to_string();
    let g = migrate_graph(&raw).unwrap();
    assert_eq!(g.compile_targets, Vec::<CompileTarget>::new());
}

#[test]
fn v1_persona_migrates_to_v5_in_one_read() {
    let raw = json!({
        "version": 1,
        "projectName": "demo",
        "nodes": [{
            "id": "n1",
            "title": "Old Persona",
            "role": "persona",
            "brief": "",
            "filePath": "context/old.md",
            "readOrder": 1,
            "pinned": false,
            "position": { "x": 0, "y": 0 }
        }],
        "edges": [],
        "compileTargets": ["claude"]
    })
    .to_string();

    let g = migrate_graph(&raw).unwrap();
    assert_eq!(g.version, GRAPH_VERSION);
    assert_eq!(g.nodes[0].role, NodeRole::Agent);
    assert_eq!(g.nodes[0].root_load, None);
    assert!(!g.nodes[0].needs_review);
    assert!(g.nodes[0].tags.is_empty());
    assert_eq!(g.nodes[0].owner, None);
    assert_eq!(g.nodes[0].meta, None);
}

#[test]
fn v4_graph_migrates_to_v5_with_omitted_defaults() {
    let g = migrate_graph(&v4_fixture()).unwrap();
    assert_eq!(g.version, GRAPH_VERSION);
    assert_eq!(g.nodes.len(), 2);
    assert_eq!(g.edges.len(), 2);
    for n in &g.nodes {
        assert!(n.tags.is_empty(), "tags should default empty for {}", n.id);
        assert_eq!(n.owner, None, "owner should default None for {}", n.id);
        assert_eq!(n.meta, None, "meta should default None for {}", n.id);
        assert_eq!(n.deprecated, None, "deprecated should default None for {}", n.id);
    }
    for e in &g.edges {
        assert_eq!(e.color, None, "color should default None for {}", e.id);
        assert!(
            e.waypoints.is_empty(),
            "waypoints should default empty for {}",
            e.id
        );
    }
}

/// A pre-v5 graph carrying no `waypoints` migrates to v5 with the field
/// present-but-empty, and one that already carries one (hand-edited, or
/// written by a newer build that a downgrade then read) keeps it verbatim.
/// The route is layout, not semantics — losing it silently would be worse
/// than a load error, so this pins that it survives WO13's reshape too.
#[test]
fn pre_v5_graph_migrates_to_v5_preserving_edge_waypoints() {
    // `edge` is built without the key at all when `waypoints` is None, so
    // the "absent" case exercises serde's `default`, not a null coercion.
    let base = |waypoints: Option<serde_json::Value>| {
        let mut edge = json!({ "id": "e1", "source": "a", "target": "b", "kind": "imports" });
        if let Some(w) = waypoints {
            edge.as_object_mut().unwrap().insert("waypoints".to_string(), w);
        }
        json!({
            "version": 4,
            "projectName": "demo",
            "nodes": [
                { "id": "a", "title": "A", "role": "rules", "brief": "", "filePath": "context/a.md",
                  "readOrder": 1, "pinned": false, "position": { "x": 0, "y": 0 } },
                { "id": "b", "title": "B", "role": "task", "brief": "", "filePath": "context/b.md",
                  "readOrder": 2, "pinned": false, "position": { "x": 400, "y": 0 } }
            ],
            "edges": [edge],
            "compileTargets": ["claude"]
        })
        .to_string()
    };

    // Absent ⇒ empty ⇒ the automatic route.
    let g = migrate_graph(&base(None)).unwrap();
    assert_eq!(g.version, GRAPH_VERSION);
    assert!(g.edges[0].waypoints.is_empty());

    // Present ⇒ carried through unchanged, in order.
    let g =
        migrate_graph(&base(Some(json!([{ "x": 120, "y": 40 }, { "x": 120, "y": 200 }])))).unwrap();
    assert_eq!(g.version, GRAPH_VERSION);
    assert_eq!(
        g.edges[0].waypoints,
        vec![Position { x: 120, y: 40 }, Position { x: 120, y: 200 }]
    );

    // Idempotent: re-migrating the v5 serialization is a no-op.
    let once = serialize_graph(&g);
    let twice = serialize_graph(&migrate_graph(&once).unwrap());
    assert_eq!(once, twice);
    assert!(
        once.contains("\"waypoints\""),
        "a non-empty route must survive serialization: {once}"
    );
}

#[test]
fn migration_is_lossless_for_a_v4_fixture() {
    let g = migrate_graph(&v4_fixture()).unwrap();

    assert_eq!(g.project_name, "demo");
    let n1 = g.nodes.iter().find(|n| n.id == "n1").unwrap();
    assert_eq!(n1.title, "Tech Lead");
    assert_eq!(n1.role, NodeRole::Agent);
    assert_eq!(n1.brief, "Coordinates the fleet");
    assert_eq!(n1.file_path, ".claude/agents/tech-lead.md");
    assert_eq!(n1.read_order, 1);
    // pinned: true ⇒ rootLoad: always.
    assert_eq!(n1.root_load, Some(RootLoad::Always));
    assert_eq!(n1.position, Position { x: 80, y: 120 });
    assert_eq!(n1.scene_pos, Some(ScenePos { tx: 3, ty: 4 }));
    assert_eq!(n1.last_verified.as_deref(), Some("2026-08-01"));

    let n2 = g.nodes.iter().find(|n| n.id == "n2").unwrap();
    // role rename: "rules" -> "rule", no review flag.
    assert_eq!(n2.role, NodeRole::Rule);
    assert!(!n2.needs_review);
    assert_eq!(n2.root_load, None);
    assert_eq!(n2.scene_pos, None);
    assert_eq!(n2.last_verified, None);

    let e1 = g.edges.iter().find(|e| e.id == "e1").unwrap();
    assert_eq!(e1.kind, EdgeKind::References);
    assert_eq!(e1.note.as_deref(), Some("read this first"));
    assert_eq!(e1.guard, None);

    // conditional -> imports + glob guard ("src/net/**" has no whitespace
    // and contains "/" and "*").
    let e2 = g.edges.iter().find(|e| e.id == "e2").unwrap();
    assert_eq!(e2.kind, EdgeKind::Imports);
    assert_eq!(
        e2.guard,
        Some(EdgeGuard::Glob { globs: vec!["src/net/**".to_string()] })
    );

    assert_eq!(
        g.compile_targets,
        vec![CompileTarget::Claude, CompileTarget::Cursor]
    );
}

#[test]
fn migration_is_idempotent_double_migrate_equals_single_migrate() {
    let once = migrate_graph(&v4_fixture()).unwrap();
    let reserialized = serialize_graph(&once);
    let twice = migrate_graph(&reserialized).unwrap();
    assert_eq!(once, twice);
    // Serializing the twice-migrated graph again must be byte-identical to
    // the first serialization — no further churn on a second pass.
    assert_eq!(serialize_graph(&twice), reserialized);
}

#[test]
fn migration_rejects_out_of_range_version() {
    let raw = json!({ "version": 0, "nodes": [], "edges": [] }).to_string();
    assert!(migrate_graph(&raw).is_err());
    let raw = json!({ "version": GRAPH_VERSION + 1, "nodes": [], "edges": [] }).to_string();
    assert!(migrate_graph(&raw).is_err());
}

#[test]
fn migration_requires_nodes_and_edges_arrays() {
    assert!(migrate_graph(&json!({ "version": 4, "edges": [] }).to_string()).is_err());
    assert!(migrate_graph(&json!({ "version": 4, "nodes": [] }).to_string()).is_err());
    assert!(migrate_graph(&json!({ "version": 4, "nodes": "nope", "edges": [] }).to_string()).is_err());
}

#[test]
fn serialize_omits_v5_fields_at_default_so_a_migrated_v4_graph_does_not_churn() {
    let g = migrate_graph(&v4_fixture()).unwrap();
    let out = serialize_graph(&g);
    assert!(!out.contains("\"tags\""));
    assert!(!out.contains("\"owner\""));
    assert!(!out.contains("\"meta\""));
    assert!(!out.contains("\"color\""));
    assert!(!out.contains("\"deprecated\""));
    assert!(!out.contains("\"needsReview\""));
}

#[test]
fn serialize_includes_v5_fields_when_set_with_sorted_meta_keys() {
    let mut meta = BTreeMap::new();
    meta.insert("zeta".to_string(), Value::from(1));
    meta.insert("alpha".to_string(), Value::from(2));
    meta.insert("mid".to_string(), Value::from(3));

    let mut node = bare_node("n1", NodeRole::Skill);
    node.title = "Node".to_string();
    node.root_load = Some(RootLoad::Always);
    node.tags = vec!["a".to_string(), "b".to_string()];
    node.owner = Some("marty".to_string());
    node.deprecated = Some(Deprecated {
        replaced_by: "n2".to_string(),
        since: Some("2026-08-21".to_string()),
        reason: Some("superseded".to_string()),
    });
    node.needs_review = true;
    node.meta = Some(meta);

    let mut edge = bare_edge("e1", "n1", "n1", EdgeKind::Overrides);
    edge.color = Some("#ffcc00".to_string());
    edge.waypoints = vec![Position { x: 10, y: 20 }, Position { x: 10, y: 40 }];

    let g = BarnGraph {
        version: GRAPH_VERSION,
        project_name: "demo".to_string(),
        nodes: vec![node],
        edges: vec![edge],
        compile_targets: vec![CompileTarget::Claude],
    };

    let out = serialize_graph(&g);
    assert!(out.contains("\"rootLoad\": \"always\""));
    assert!(out.contains("\"tags\": [\n        \"a\",\n        \"b\"\n      ]"));
    assert!(out.contains("\"owner\": \"marty\""));
    // Deprecated inner order, frozen: replacedBy, since?, reason?.
    let dep_pos = out.find("\"deprecated\"").unwrap();
    let replaced_pos = out.find("\"replacedBy\"").unwrap();
    let since_pos = out.find("\"since\"").unwrap();
    let reason_pos = out.find("\"reason\"").unwrap();
    assert!(dep_pos < replaced_pos && replaced_pos < since_pos && since_pos < reason_pos);
    assert!(out.contains("\"needsReview\": true"));
    // Sorted regardless of insertion order.
    let meta_pos = out.find("\"meta\"").unwrap();
    let alpha_pos = out.find("\"alpha\"").unwrap();
    let mid_pos = out.find("\"mid\"").unwrap();
    let zeta_pos = out.find("\"zeta\"").unwrap();
    assert!(meta_pos < alpha_pos && alpha_pos < mid_pos && mid_pos < zeta_pos);
    assert!(out.contains("\"color\": \"#ffcc00\""));

    // Round-trips through migrate_graph too (not just parses as JSON).
    let back = migrate_graph(&out).unwrap();
    assert_eq!(back, g);
}

#[test]
fn needs_review_false_and_owner_empty_string_are_both_omitted() {
    let mut node = bare_node("n1", NodeRole::Architecture);
    node.owner = Some(String::new());
    node.needs_review = false;
    let g = BarnGraph {
        version: GRAPH_VERSION,
        project_name: String::new(),
        nodes: vec![node],
        edges: Vec::new(),
        compile_targets: vec![CompileTarget::Claude],
    };
    let out = serialize_graph(&g);
    assert!(!out.contains("\"owner\""));
    assert!(!out.contains("\"needsReview\""));
}

#[test]
fn serialize_sorts_nodes_and_edges_by_id() {
    let node = |id: &str| bare_node(id, NodeRole::Architecture);
    let edge = |id: &str| bare_edge(id, "z", "a", EdgeKind::References);
    let g = BarnGraph {
        version: GRAPH_VERSION,
        project_name: String::new(),
        nodes: vec![node("z"), node("a"), node("m")],
        edges: vec![edge("z"), edge("a"), edge("m")],
        compile_targets: vec![CompileTarget::Claude],
    };
    let out = serialize_graph(&g);
    let ids: Vec<&str> = out.match_indices("\"id\": \"").map(|(i, _)| {
        let start = i + "\"id\": \"".len();
        let end = out[start..].find('"').unwrap() + start;
        &out[start..end]
    }).collect();
    assert_eq!(ids, ["a", "m", "z", "a", "m", "z"]);
}

/// WO03 audit D5: `serialize_graph` must sort by BYTE order (`String::cmp`),
/// never by anything ICU/locale-aware, because it must stay byte-identical
/// to `graph.ts`'s `serializeGraph` (its `compareIds` helper — deliberately
/// not `localeCompare`, same audit finding). Real `makeId()` ids are
/// `` `${base36}-${rand}` `` — every id contains a `-`, which is exactly
/// where byte order and ICU collation can disagree (`"-"` sorts before
/// letters in byte order; ICU with punctuation weakened would not). This
/// pins the adversarial pair from the audit so a regression to any
/// locale-aware comparator is caught immediately.
#[test]
fn serialize_sorts_hyphenated_ids_in_byte_order_matching_graph_ts() {
    let node = |id: &str| bare_node(id, NodeRole::Architecture);
    // Byte order: '-' (0x2D) < 'd' (0x64), so "m1abc-x9" < "m1abcd-y9".
    // An ICU/locale collation with punctuation weakened would instead
    // compare "x" vs "d" past the ignored hyphen and reverse the order.
    let g = BarnGraph {
        version: GRAPH_VERSION,
        project_name: String::new(),
        nodes: vec![node("m1abcd-y9"), node("m1abc-x9")],
        edges: Vec::new(),
        compile_targets: vec![CompileTarget::Claude],
    };
    let out = serialize_graph(&g);
    let first = out.find("\"m1abc-x9\"").unwrap();
    let second = out.find("\"m1abcd-y9\"").unwrap();
    assert!(first < second, "expected byte-order sort: {out}");
}

#[test]
fn serialize_uses_lf_and_a_single_trailing_newline() {
    let g = migrate_graph(&v4_fixture()).unwrap();
    let out = serialize_graph(&g);
    assert!(!out.contains('\r'));
    assert!(out.ends_with('\n'));
    assert!(!out.ends_with("\n\n"));
}

/// WO03 audit D6, carried into v5: `migrate_graph` must not hard-fail on a
/// graph the app itself considers valid — an unrecognized node role, an
/// unrecognized edge kind, an unrecognized compile target, and a
/// fractional coordinate must all survive `migrate_graph` and a subsequent
/// `serialize_graph`. The v5 fallback for an unrecognized role changed
/// from v4's `reference` to `architecture` (+ `needsReview`), because
/// `reference` no longer exists (§5.1 pass 5).
#[test]
fn migrate_graph_tolerates_unrecognized_values_and_fractional_coordinates() {
    let raw = json!({
        "version": 4,
        "projectName": "demo",
        "nodes": [{
            "id": "n1",
            "title": "Typo'd role",
            "role": "referance",
            "brief": "",
            "filePath": "context/n1.md",
            "readOrder": 1,
            "pinned": false,
            "position": { "x": 80.5, "y": 120.4 }
        }],
        "edges": [{
            "id": "e1",
            "source": "n1",
            "target": "n1",
            "kind": "supersecedes"
        }],
        "compileTargets": ["claude", "not-a-real-target", "gemini"]
    })
    .to_string();

    let g = migrate_graph(&raw).expect("must not hard-fail on a graph the app itself accepts");

    // Unknown role coerced to the v5 neutral default, flagged for review.
    assert_eq!(g.nodes[0].role, NodeRole::Architecture);
    assert!(g.nodes[0].needs_review);
    // Fractional coordinates rounded, not rejected (80.5 rounds to 81 —
    // Rust's `f64::round` rounds half away from zero).
    assert_eq!(g.nodes[0].position, Position { x: 81, y: 120 });
    // Unknown edge kind coerced to the non-structural default.
    assert_eq!(g.edges[0].kind, EdgeKind::References);
    // Unknown compile target dropped; known ones survive in order.
    assert_eq!(
        g.compile_targets,
        vec![CompileTarget::Claude, CompileTarget::Gemini]
    );

    // The coerced graph re-serializes cleanly and re-migrates to the same
    // typed shape (idempotent even after a coercion pass).
    let out = serialize_graph(&g);
    let back = migrate_graph(&out).unwrap();
    assert_eq!(g, back);
}

#[test]
fn is_glob_condition_matches_compiles_predicate() {
    assert!(is_glob_condition("src/api/**"));
    assert!(is_glob_condition("*.md"));
    assert!(is_glob_condition("a?b"));
    assert!(is_glob_condition("[abc]"));
    assert!(!is_glob_condition("you are debugging a flaky test"));
    assert!(!is_glob_condition("plain-text-no-glob-chars"));
    // Whitespace disqualifies even with a glob char present.
    assert!(!is_glob_condition("src/api/** please"));
    assert!(!is_glob_condition(""));
}

// ── §5.5 supersedes → deprecated ────────────────────────────────────────

#[test]
fn supersedes_edge_deprecates_target_and_is_deleted() {
    let raw = json!({
        "version": 4,
        "nodes": [
            { "id": "a", "title": "A", "role": "architecture", "brief": "", "filePath": "context/a.md",
              "readOrder": 1, "pinned": false, "position": { "x": 0, "y": 0 } },
            { "id": "b", "title": "B", "role": "snippet", "brief": "", "filePath": "context/b.md",
              "readOrder": 2, "pinned": false, "position": { "x": 0, "y": 0 } }
        ],
        "edges": [
            { "id": "e1", "source": "a", "target": "b", "kind": "supersedes" }
        ],
        "compileTargets": ["claude"]
    }).to_string();

    let g = migrate_graph(&raw).unwrap();
    assert!(g.edges.is_empty(), "the supersedes edge must be deleted");
    let b = g.nodes.iter().find(|n| n.id == "b").unwrap();
    assert_eq!(b.role, NodeRole::Example);
    assert_eq!(b.deprecated, Some(Deprecated { replaced_by: "a".to_string(), since: None, reason: None }));
    assert!(b.needs_review);
}

/// §5.5: if a node is superseded twice, the LOWEST-id edge wins,
/// regardless of array order.
#[test]
fn double_supersedes_lowest_edge_id_wins() {
    let raw = json!({
        "version": 4,
        "nodes": [
            { "id": "a", "title": "A", "role": "architecture", "brief": "", "filePath": "context/a.md",
              "readOrder": 1, "pinned": false, "position": { "x": 0, "y": 0 } },
            { "id": "b", "title": "B", "role": "architecture", "brief": "", "filePath": "context/b.md",
              "readOrder": 2, "pinned": false, "position": { "x": 0, "y": 0 } },
            { "id": "c", "title": "C", "role": "architecture", "brief": "", "filePath": "context/c.md",
              "readOrder": 3, "pinned": false, "position": { "x": 0, "y": 0 } }
        ],
        "edges": [
            { "id": "e9-later", "source": "b", "target": "c", "kind": "supersedes" },
            { "id": "e1-first", "source": "a", "target": "c", "kind": "supersedes" }
        ],
        "compileTargets": ["claude"]
    }).to_string();

    let g = migrate_graph(&raw).unwrap();
    let c = g.nodes.iter().find(|n| n.id == "c").unwrap();
    assert_eq!(c.deprecated.as_ref().unwrap().replaced_by, "a");
}

// ── §5.6 contradicts normalization + dedupe ─────────────────────────────

#[test]
fn contradicts_reciprocal_pair_collapses_to_lowest_id_and_drops_decorations() {
    let raw = json!({
        "version": 4,
        "nodes": [
            { "id": "a", "title": "A", "role": "glossary", "brief": "", "filePath": "context/a.md",
              "readOrder": 1, "pinned": false, "position": { "x": 0, "y": 0 } },
            { "id": "b", "title": "B", "role": "skill", "brief": "", "filePath": "context/b.md",
              "readOrder": 2, "pinned": false, "position": { "x": 0, "y": 0 } }
        ],
        "edges": [
            { "id": "e08-x", "source": "a", "target": "b", "kind": "conflicts-with" },
            { "id": "e09-x", "source": "b", "target": "a", "kind": "conflicts-with",
              "waypoints": [{ "x": 10, "y": 20 }] }
        ],
        "compileTargets": ["claude"]
    }).to_string();

    let g = migrate_graph(&raw).unwrap();
    assert_eq!(g.edges.len(), 1, "the reciprocal pair collapses to one edge");
    let e = &g.edges[0];
    assert_eq!(e.id, "e08-x", "lowest byte-order id wins");
    assert_eq!(e.kind, EdgeKind::Contradicts);
    assert_eq!(e.source, "a");
    assert_eq!(e.target, "b");
    assert!(e.waypoints.is_empty(), "the discarded edge's decorations are gone, not merged");
}

#[test]
fn contradicts_normalizes_source_target_to_byte_order() {
    let raw = json!({
        "version": 5,
        "nodes": [
            { "id": "n07-x", "title": "A", "role": "glossary", "brief": "", "filePath": "context/a.md",
              "readOrder": 1, "position": { "x": 0, "y": 0 } },
            { "id": "n11-x", "title": "B", "role": "skill", "brief": "", "filePath": "context/b.md",
              "readOrder": 2, "position": { "x": 0, "y": 0 } }
        ],
        "edges": [
            { "id": "e1", "source": "n11-x", "target": "n07-x", "kind": "contradicts" }
        ],
        "compileTargets": ["claude"]
    }).to_string();

    let g = migrate_graph(&raw).unwrap();
    assert_eq!(g.edges[0].source, "n07-x");
    assert_eq!(g.edges[0].target, "n11-x");

    // Idempotent: re-migrating the already-normalized output is a no-op.
    let out = serialize_graph(&g);
    let back = migrate_graph(&out).unwrap();
    assert_eq!(g, back);
}

#[test]
fn guard_is_stripped_from_a_contradicts_edge() {
    let raw = json!({
        "version": 5,
        "nodes": [
            { "id": "a", "title": "A", "role": "glossary", "brief": "", "filePath": "context/a.md",
              "readOrder": 1, "position": { "x": 0, "y": 0 } },
            { "id": "b", "title": "B", "role": "skill", "brief": "", "filePath": "context/b.md",
              "readOrder": 2, "position": { "x": 0, "y": 0 } }
        ],
        "edges": [
            { "id": "e1", "source": "a", "target": "b", "kind": "contradicts",
              "guard": { "type": "description", "text": "illegal here" } }
        ],
        "compileTargets": ["claude"]
    }).to_string();

    let g = migrate_graph(&raw).unwrap();
    assert_eq!(g.edges[0].guard, None);
}

// ── §5.8 pre-v5 backup on write_graph ───────────────────────────────────

#[test]
fn write_graph_backs_up_a_pre_v5_graph_exactly_once() {
    let dir = temp_project("v4-bak");
    let root = dir.to_string_lossy().into_owned();
    let bak_path = dir.join(".cowtext/graph.v4.bak.json");

    let v4 = json!({ "version": 4, "nodes": [], "edges": [] }).to_string();
    write_graph(root.clone(), v4.clone()).unwrap();
    // First write: no pre-existing file yet, so nothing to back up.
    assert!(!bak_path.is_file());

    let v5 = json!({ "version": 5, "nodes": [], "edges": [] }).to_string();
    write_graph(root.clone(), v5.clone()).unwrap();
    // Second write: overwrote a pre-v5 file, so the backup is taken.
    assert!(bak_path.is_file());
    assert_eq!(fs::read_to_string(&bak_path).unwrap(), v4);

    let v5b = json!({ "version": 5, "nodes": [], "edges": [], "projectName": "x" }).to_string();
    write_graph(root.clone(), v5b).unwrap();
    // Third write: the backup already exists — never overwritten.
    assert_eq!(fs::read_to_string(&bak_path).unwrap(), v4);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_graph_does_not_back_up_an_already_v5_graph() {
    let dir = temp_project("v5-no-bak");
    let root = dir.to_string_lossy().into_owned();
    let bak_path = dir.join(".cowtext/graph.v4.bak.json");

    let v5 = json!({ "version": 5, "nodes": [], "edges": [] }).to_string();
    write_graph(root.clone(), v5).unwrap();
    let v5b = json!({ "version": 5, "nodes": [], "edges": [], "projectName": "x" }).to_string();
    write_graph(root, v5b).unwrap();
    assert!(!bak_path.is_file());

    let _ = fs::remove_dir_all(&dir);
}

// ── §18.2 fixture parity — the byte-identical gate against tech-lead's
// hand-authored corpus, asserted from BOTH cargo test and Vitest. ────────

const FIXTURE_V4_IN: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/graph_v4_in.json"));
const FIXTURE_V5_OUT: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/graph_v5_out.json"));

#[test]
fn migrate_and_serialize_the_v4_fixture_matches_the_v5_fixture_byte_for_byte() {
    let g = migrate_graph(FIXTURE_V4_IN).unwrap();
    let out = serialize_graph(&g);
    assert_eq!(out, FIXTURE_V5_OUT, "must byte-match tech-lead's fixture exactly");
}

#[test]
fn migrating_the_v5_fixture_again_is_idempotent() {
    let g = migrate_graph(FIXTURE_V5_OUT).unwrap();
    let out = serialize_graph(&g);
    assert_eq!(out, FIXTURE_V5_OUT);
}

#[test]
fn fixture_migration_preserves_node_count_and_drops_exactly_two_edges() {
    let before = migrate_graph(FIXTURE_V4_IN).unwrap();
    assert_eq!(before.nodes.len(), 13, "no node lost or gained");
    assert_eq!(before.edges.len(), 7, "9 in, 7 out (two documented deletions)");
    let ids: std::collections::BTreeSet<&str> = before.edges.iter().map(|e| e.id.as_str()).collect();
    assert!(!ids.contains("e07-x"), "supersedes-converted edge must be gone");
    assert!(!ids.contains("e09-x"), "reciprocal-collapsed edge must be gone");
}