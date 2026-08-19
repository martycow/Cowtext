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

// ── Graph v3 schema (WO03) ─────────────────────────────────────────────

/// A realistic v2 `graph.json` fixture: two nodes exercising every v2
/// field (pinned, scenePos, lastVerified, a conditional edge's `condition`,
/// a references edge's `note`), non-default `compileTargets`. Used by the
/// migration/serialization tests below.
fn v2_fixture() -> String {
    json!({
        "version": 2,
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

#[test]
fn all_node_roles_round_trip_with_exact_wire_names() {
    let expected = [
        (NodeRole::Agent, "agent"),
        (NodeRole::Rules, "rules"),
        (NodeRole::Architecture, "architecture"),
        (NodeRole::Workflow, "workflow"),
        (NodeRole::Task, "task"),
        (NodeRole::Reference, "reference"),
        (NodeRole::Glossary, "glossary"),
        (NodeRole::Command, "command"),
        (NodeRole::Invariant, "invariant"),
        (NodeRole::Trap, "trap"),
        (NodeRole::Skill, "skill"),
        (NodeRole::Snippet, "snippet"),
        (NodeRole::Style, "style"),
    ];
    assert_eq!(expected.len(), NODE_ROLES.len(), "NODE_ROLES must list every variant");
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
        (EdgeKind::Conditional, "conditional"),
        (EdgeKind::Sequence, "sequence"),
        (EdgeKind::Overrides, "overrides"),
        (EdgeKind::Supersedes, "supersedes"),
        (EdgeKind::ConflictsWith, "conflicts-with"),
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
fn is_structural_matches_contract_split() {
    assert!(EdgeKind::Imports.is_structural());
    assert!(EdgeKind::Sequence.is_structural());
    assert!(EdgeKind::Overrides.is_structural());
    assert!(!EdgeKind::References.is_structural());
    assert!(!EdgeKind::Conditional.is_structural());
    assert!(!EdgeKind::Supersedes.is_structural());
    assert!(!EdgeKind::ConflictsWith.is_structural());
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
    let raw = json!({ "version": 3, "nodes": [], "edges": [] }).to_string();
    let g = migrate_graph(&raw).unwrap();
    assert_eq!(g.compile_targets, vec![CompileTarget::Claude]);

    // Present-but-empty stays empty — copilot/gemini never sneak in as a
    // default, and an intentionally-cleared list isn't resurrected.
    let raw = json!({ "version": 3, "nodes": [], "edges": [], "compileTargets": [] }).to_string();
    let g = migrate_graph(&raw).unwrap();
    assert_eq!(g.compile_targets, Vec::<CompileTarget>::new());
}

#[test]
fn v1_persona_migrates_through_v2_to_v3_in_one_read() {
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
    // v3 defaults are present-but-empty, not errors.
    assert!(g.nodes[0].tags.is_empty());
    assert_eq!(g.nodes[0].owner, None);
    assert_eq!(g.nodes[0].meta, None);
}

#[test]
fn v2_graph_migrates_to_v3_with_omitted_defaults() {
    let g = migrate_graph(&v2_fixture()).unwrap();
    assert_eq!(g.version, GRAPH_VERSION);
    assert_eq!(g.nodes.len(), 2);
    assert_eq!(g.edges.len(), 2);
    for n in &g.nodes {
        assert!(n.tags.is_empty(), "tags should default empty for {}", n.id);
        assert_eq!(n.owner, None, "owner should default None for {}", n.id);
        assert_eq!(n.meta, None, "meta should default None for {}", n.id);
    }
    for e in &g.edges {
        assert_eq!(e.color, None, "color should default None for {}", e.id);
    }
}

#[test]
fn migration_is_lossless_for_a_v2_fixture() {
    let g = migrate_graph(&v2_fixture()).unwrap();

    assert_eq!(g.project_name, "demo");
    let n1 = g.nodes.iter().find(|n| n.id == "n1").unwrap();
    assert_eq!(n1.title, "Tech Lead");
    assert_eq!(n1.role, NodeRole::Agent);
    assert_eq!(n1.brief, "Coordinates the fleet");
    assert_eq!(n1.file_path, ".claude/agents/tech-lead.md");
    assert_eq!(n1.read_order, 1);
    assert!(n1.pinned);
    assert_eq!(n1.position, Position { x: 80, y: 120 });
    assert_eq!(n1.scene_pos, Some(ScenePos { tx: 3, ty: 4 }));
    assert_eq!(n1.last_verified.as_deref(), Some("2026-08-01"));

    let n2 = g.nodes.iter().find(|n| n.id == "n2").unwrap();
    assert_eq!(n2.role, NodeRole::Rules);
    assert!(!n2.pinned);
    assert_eq!(n2.scene_pos, None);
    assert_eq!(n2.last_verified, None);

    let e1 = g.edges.iter().find(|e| e.id == "e1").unwrap();
    assert_eq!(e1.kind, EdgeKind::References);
    assert_eq!(e1.note.as_deref(), Some("read this first"));
    assert_eq!(e1.condition, None);

    let e2 = g.edges.iter().find(|e| e.id == "e2").unwrap();
    assert_eq!(e2.kind, EdgeKind::Conditional);
    assert_eq!(e2.condition.as_deref(), Some("src/net/**"));

    assert_eq!(
        g.compile_targets,
        vec![CompileTarget::Claude, CompileTarget::Cursor]
    );
}

#[test]
fn migration_is_idempotent_double_migrate_equals_single_migrate() {
    let once = migrate_graph(&v2_fixture()).unwrap();
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
    assert!(migrate_graph(&json!({ "version": 3, "edges": [] }).to_string()).is_err());
    assert!(migrate_graph(&json!({ "version": 3, "nodes": [] }).to_string()).is_err());
    assert!(migrate_graph(&json!({ "version": 3, "nodes": "nope", "edges": [] }).to_string()).is_err());
}

#[test]
fn serialize_omits_v3_fields_at_default_so_a_migrated_v2_graph_does_not_churn() {
    let g = migrate_graph(&v2_fixture()).unwrap();
    let out = serialize_graph(&g);
    assert!(!out.contains("\"tags\""));
    assert!(!out.contains("\"owner\""));
    assert!(!out.contains("\"meta\""));
    assert!(!out.contains("\"color\""));
}

#[test]
fn serialize_includes_v3_fields_when_set_with_sorted_meta_keys() {
    let mut meta = BTreeMap::new();
    meta.insert("zeta".to_string(), Value::from(1));
    meta.insert("alpha".to_string(), Value::from(2));
    meta.insert("mid".to_string(), Value::from(3));

    let g = BarnGraph {
        version: GRAPH_VERSION,
        project_name: "demo".to_string(),
        nodes: vec![MemoryNode {
            id: "n1".to_string(),
            title: "Node".to_string(),
            role: NodeRole::Skill,
            brief: String::new(),
            file_path: "context/n.md".to_string(),
            read_order: 1,
            pinned: false,
            position: Position { x: 0, y: 0 },
            scene_pos: None,
            last_verified: None,
            tags: vec!["a".to_string(), "b".to_string()],
            owner: Some("marty".to_string()),
            meta: Some(meta),
        }],
        edges: vec![MemoryEdge {
            id: "e1".to_string(),
            source: "n1".to_string(),
            target: "n1".to_string(),
            kind: EdgeKind::Overrides,
            condition: None,
            note: None,
            color: Some("#ffcc00".to_string()),
        }],
        compile_targets: vec![CompileTarget::Claude],
    };

    let out = serialize_graph(&g);
    assert!(out.contains("\"tags\": [\n        \"a\",\n        \"b\"\n      ]"));
    assert!(out.contains("\"owner\": \"marty\""));
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
fn serialize_sorts_nodes_and_edges_by_id() {
    let node = |id: &str| MemoryNode {
        id: id.to_string(),
        title: id.to_string(),
        role: NodeRole::Reference,
        brief: String::new(),
        file_path: format!("context/{id}.md"),
        read_order: 1,
        pinned: false,
        position: Position { x: 0, y: 0 },
        scene_pos: None,
        last_verified: None,
        tags: Vec::new(),
        owner: None,
        meta: None,
    };
    let edge = |id: &str| MemoryEdge {
        id: id.to_string(),
        source: "z".to_string(),
        target: "a".to_string(),
        kind: EdgeKind::References,
        condition: None,
        note: None,
        color: None,
    };
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
    let node = |id: &str| MemoryNode {
        id: id.to_string(),
        title: id.to_string(),
        role: NodeRole::Reference,
        brief: String::new(),
        file_path: format!("context/{id}.md"),
        read_order: 1,
        pinned: false,
        position: Position { x: 0, y: 0 },
        scene_pos: None,
        last_verified: None,
        tags: Vec::new(),
        owner: None,
        meta: None,
    };
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
    let g = migrate_graph(&v2_fixture()).unwrap();
    let out = serialize_graph(&g);
    assert!(!out.contains('\r'));
    assert!(out.ends_with('\n'));
    assert!(!out.ends_with("\n\n"));
}

/// WO03 audit D6: `migrate_graph` must not hard-fail on a graph the app
/// itself considers valid — an unrecognized node role, an unrecognized
/// edge kind, an unrecognized compile target, and a fractional coordinate
/// (all things `compile.rs`'s tolerant parser and the TS store already
/// accept) must all survive `migrate_graph` and a subsequent
/// `serialize_graph`, per the documented coercion rules on `migrate_graph`.
#[test]
fn migrate_graph_tolerates_unrecognized_values_and_fractional_coordinates() {
    let raw = json!({
        "version": 3,
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

    // Unknown role coerced to the neutral default, not rejected.
    assert_eq!(g.nodes[0].role, NodeRole::Reference);
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