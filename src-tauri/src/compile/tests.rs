use super::*;
use serde_json::json;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-compile-{tag}-{}", std::process::id()));
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

fn node(id: &str, title: &str, file_path: &str, read_order: i64, pinned: bool) -> serde_json::Value {
    node_role(id, title, file_path, read_order, pinned, "rules")
}

fn node_role(
    id: &str,
    title: &str,
    file_path: &str,
    read_order: i64,
    pinned: bool,
    role: &str,
) -> serde_json::Value {
    json!({
        "id": id, "title": title, "role": role, "brief": "",
        "filePath": file_path, "readOrder": read_order, "pinned": pinned,
        "position": { "x": 0, "y": 0 }
    })
}

fn edge(id: &str, source: &str, target: &str, kind: &str, condition: Option<&str>) -> serde_json::Value {
    let mut e = json!({ "id": id, "source": source, "target": target, "kind": kind });
    if let Some(c) = condition {
        e["condition"] = json!(c);
    }
    e
}

fn graph_json(
    name: &str,
    nodes: &[serde_json::Value],
    edges: &[serde_json::Value],
    targets: &[&str],
) -> String {
    json!({
        "version": 1, "projectName": name,
        "nodes": nodes, "edges": edges, "compileTargets": targets
    })
    .to_string()
}

fn preview(root: &Path, graph: &str) -> CompilePreview {
    compile_preview(root.to_string_lossy().into_owned(), graph.to_string()).unwrap()
}

/// The §1.6 example graph: 2 pinned + 1 references + 1 conditional glob.
fn golden_graph(targets: &[&str]) -> String {
    graph_json(
        "TestProj",
        &[
            node("a", "Persona", "context/persona.md", 1, true),
            node("b", "Rules", "context/rules.md", 2, true),
            node("c", "Networking notes", "context/net-notes.md", 3, false),
            node("d", "Net rules", "context/net-rules.md", 4, false),
        ],
        &[
            edge("e1", "a", "c", "references", None),
            edge("e2", "a", "d", "conditional", Some("src/net/**")),
        ],
        targets,
    )
}

fn golden_files(dir: &Path) {
    touch(&dir.join("context/persona.md"), "persona body\n");
    touch(&dir.join("context/rules.md"), "rules body\n");
    touch(&dir.join("context/net-notes.md"), "notes body\n");
    touch(&dir.join("context/net-rules.md"), "net rules body\n");
}

#[test]
fn cycle_detected_with_path() {
    let dir = temp_project("cycle");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/b.md"), "b\n");
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 1, true),
            node("b", "B", "context/b.md", 2, true),
        ],
        &[
            edge("e1", "a", "b", "sequence", None),
            edge("e2", "b", "a", "sequence", None),
        ],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.files.is_empty());
    assert_eq!(p.errors.len(), 1);
    match &p.errors[0] {
        ValidationError::Cycle { nodes } => {
            assert_eq!(nodes.len(), 3);
            assert_eq!(nodes.first().unwrap().id, nodes.last().unwrap().id);
        }
        other => panic!("expected a cycle error, got {other:?}"),
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn imports_and_sequence_ordering() {
    let dir = temp_project("order");
    for f in ["a", "b", "c"] {
        touch(&dir.join(format!("context/{f}.md")), "x\n");
    }
    // readOrder 3/1/2; imports A→C means C must appear before A.
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 3, true),
            node("b", "B", "context/b.md", 1, true),
            node("c", "C", "context/c.md", 2, true),
        ],
        &[edge("e1", "a", "c", "imports", None)],
        &["claude"],
    );
    let p1 = preview(&dir, &g);
    let p2 = preview(&dir, &g);
    assert!(p1.errors.is_empty());
    let at_lines: Vec<&str> = p1.files[0]
        .new_content
        .lines()
        .filter(|l| l.starts_with('@'))
        .collect();
    assert_eq!(at_lines, ["@context/b.md", "@context/c.md", "@context/a.md"]);
    assert_eq!(p1.files[0].new_content, p2.files[0].new_content);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_order_breaks_ties() {
    let dir = temp_project("ties");
    for f in ["a", "b", "c"] {
        touch(&dir.join(format!("context/{f}.md")), "x\n");
    }
    // No edges: pure readOrder; equal readOrder falls back to id order.
    let g = graph_json(
        "P",
        &[
            node("c", "C", "context/c.md", 2, true),
            node("a", "A", "context/a.md", 2, true),
            node("b", "B", "context/b.md", 1, true),
        ],
        &[],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let at_lines: Vec<&str> = p.files[0]
        .new_content
        .lines()
        .filter(|l| l.starts_with('@'))
        .collect();
    assert_eq!(at_lines, ["@context/b.md", "@context/a.md", "@context/c.md"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn missing_file_reported() {
    let dir = temp_project("missing");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/gone.md", 1, true)],
        &[],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.files.is_empty());
    assert_eq!(p.errors.len(), 1);
    match &p.errors[0] {
        ValidationError::MissingFile { node_id, file_path, .. } => {
            assert_eq!(node_id, "a");
            assert_eq!(file_path, "context/gone.md");
        }
        other => panic!("expected a missing-file error, got {other:?}"),
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dangling_edge_reported() {
    let dir = temp_project("dangling");
    touch(&dir.join("context/a.md"), "a\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true)],
        &[edge("e1", "a", "ghost", "references", None)],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.files.is_empty());
    assert_eq!(p.errors.len(), 1);
    match &p.errors[0] {
        ValidationError::DanglingEdge { edge_id, edge_kind, missing_end } => {
            assert_eq!(edge_id, "e1");
            assert_eq!(edge_kind, "references");
            assert_eq!(missing_end, "ghost");
        }
        other => panic!("expected a dangling-edge error, got {other:?}"),
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn golden_claude_output() {
    let dir = temp_project("golden-claude");
    golden_files(&dir);
    let p = preview(&dir, &golden_graph(&["claude"]));
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 1);
    let f = &p.files[0];
    assert_eq!(f.rel_path, "CLAUDE.md");
    assert_eq!(f.target, "claude");
    let golden = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # TestProj — agent context\n\
         \n\
         ## Always read\n\
         \n\
         @context/persona.md\n\
         @context/rules.md\n\
         \n\
         ## Read when relevant\n\
         \n\
         - When working on **Persona**, read @context/net-notes.md.\n\
         - When touching `src/net/**`, read @context/net-rules.md.\n"
    );
    assert_eq!(f.new_content, golden);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn golden_agents_output() {
    let dir = temp_project("golden-agents");
    golden_files(&dir);
    let p = preview(&dir, &golden_graph(&["agents"]));
    assert!(p.errors.is_empty());
    let f = &p.files[0];
    assert_eq!(f.rel_path, "AGENTS.md");
    assert_eq!(f.target, "agents");
    let golden = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # TestProj — agent context\n\
         \n\
         ## Always read\n\
         \n\
         - [Persona](context/persona.md)\n\
         - [Rules](context/rules.md)\n\
         \n\
         ## Read when relevant\n\
         \n\
         - When working on **Persona**, read [Networking notes](context/net-notes.md).\n\
         - When touching `src/net/**`, read [Net rules](context/net-rules.md).\n"
    );
    assert_eq!(f.new_content, golden);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn nested_agents_for_clean_glob() {
    let dir = temp_project("nested");
    golden_files(&dir);
    let g = graph_json(
        "P",
        &[
            node("a", "Persona", "context/persona.md", 1, true),
            node("c", "Networking notes", "context/net-notes.md", 2, false),
            node("d", "Net rules", "context/net-rules.md", 3, false),
        ],
        &[
            edge("e1", "a", "d", "conditional", Some("src/net/**")),
            edge("e2", "a", "c", "conditional", Some("src/io/**/*")),
        ],
        &["agents"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    // Root AGENTS.md + one nested file; `src/io/**/*` is not clean.
    assert_eq!(p.files.len(), 2);
    assert!(p.files[0].new_content.contains(
        "- When touching `src/net/**`, read [Net rules](context/net-rules.md)."
    ));
    let nested = &p.files[1];
    assert_eq!(nested.rel_path, "src/net/AGENTS.md");
    assert_eq!(nested.target, "agents");
    let golden = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # P — context for src/net\n\
         \n\
         - Read [Net rules](../../context/net-rules.md).\n"
    );
    assert_eq!(nested.new_content, golden);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dirty_glob_dirs_stay_root_bullets() {
    let dir = temp_project("dirty-globs");
    golden_files(&dir);
    // Aliasing (`./**`, `src/./**`, `src//**`), escaping (`../lib/**`,
    // `C:/x/**`), and backslash dirs must not spawn nested AGENTS.md —
    // and must not turn the preview into an infrastructure Err.
    let conditions = [
        "./**",
        "../lib/**",
        "src/./**",
        "src//**",
        "C:/x/**",
        "src\\net/**",
    ];
    let edges: Vec<serde_json::Value> = conditions
        .iter()
        .enumerate()
        .map(|(i, c)| edge(&format!("e{i}"), "a", "d", "conditional", Some(c)))
        .collect();
    let g = graph_json(
        "P",
        &[
            node("a", "Persona", "context/persona.md", 1, true),
            node("d", "Net rules", "context/net-rules.md", 2, false),
        ],
        &edges,
        &["agents"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    // Root AGENTS.md only — no nested file for any dirty glob.
    assert_eq!(p.files.len(), 1);
    assert_eq!(p.files[0].rel_path, "AGENTS.md");
    for c in conditions {
        assert!(
            p.files[0]
                .new_content
                .contains(&format!("- When touching `{c}`,")),
            "missing root bullet for {c}"
        );
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn cursor_frontmatter_escapes_yaml() {
    let dir = temp_project("cursor-yaml");
    touch(&dir.join("context/net.md"), "net body\n");
    touch(&dir.join("context/notes.md"), "notes body\n");
    let g = graph_json(
        "P",
        &[
            node("a", "Networking: overview", "context/net.md", 1, true),
            node("b", "Notes: \"hi\"", "context/notes.md", 2, false),
        ],
        &[edge("e1", "a", "b", "conditional", Some("[ab]/x/**"))],
        &["cursor"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let by_path: HashMap<&str, &PreviewFile> =
        p.files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    // `: ` in a plain scalar is invalid YAML → double-quoted.
    assert!(by_path[".cursor/rules/net.mdc"]
        .new_content
        .starts_with("---\ndescription: \"Networking: overview\"\nalwaysApply: true\n---\n"));
    // Once quoting triggers, embedded quotes are escaped; leading `[`
    // in a glob would open a flow sequence in plain style → quoted.
    assert!(by_path[".cursor/rules/notes.mdc"].new_content.starts_with(
        "---\ndescription: \"Notes: \\\"hi\\\"\"\nglobs: \"[ab]/x/**\"\n---\n"
    ));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn yaml_scalar_plain_and_quoted() {
    // Common cases stay plain — output identical to the spec goldens.
    for plain in ["Persona", "Net rules", "src/net/**", "src/a/**,src/b/**"] {
        assert_eq!(yaml_scalar(plain), plain);
    }
    assert_eq!(yaml_scalar(""), "\"\"");
    assert_eq!(yaml_scalar("true"), "\"true\"");
    assert_eq!(yaml_scalar("123"), "\"123\"");
    assert_eq!(yaml_scalar("#leading"), "\"#leading\"");
    assert_eq!(yaml_scalar("trailing:"), "\"trailing:\"");
    assert_eq!(yaml_scalar("a\nb"), "\"a\\nb\"");
    // Interior quotes/backslashes are legal in plain style; they are
    // escaped only when something else forces double-quoting.
    assert_eq!(yaml_scalar("back\\slash"), "back\\slash");
    assert_eq!(yaml_scalar("say \"hi\""), "say \"hi\"");
    assert_eq!(yaml_scalar(": say \"hi\"\\"), "\": say \\\"hi\\\"\\\\\"");
}

#[test]
fn golden_cursor_frontmatter() {
    let dir = temp_project("cursor");
    touch(&dir.join("context/persona.md"), "persona body\n");
    touch(&dir.join("context/net-rules.md"), "net body\n");
    touch(&dir.join("context/mixed.md"), "mixed body\n");
    let g = graph_json(
        "P",
        &[
            node("a", "Persona", "context/persona.md", 1, true),
            node("d", "Net rules", "context/net-rules.md", 2, false),
            node("m", "Mixed", "context/mixed.md", 3, true),
        ],
        &[
            edge("e1", "a", "d", "conditional", Some("src/net/**")),
            edge("e2", "a", "m", "conditional", Some("src/x/**")),
        ],
        &["cursor"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let by_path: HashMap<&str, &PreviewFile> =
        p.files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    assert_eq!(p.files.len(), 3);
    assert_eq!(
        by_path[".cursor/rules/persona.mdc"].new_content,
        format!(
            "---\ndescription: Persona\nalwaysApply: true\n---\n{GENERATED_HEADER}\n\npersona body\n"
        )
    );
    assert_eq!(
        by_path[".cursor/rules/net-rules.mdc"].new_content,
        format!(
            "---\ndescription: Net rules\nglobs: src/net/**\n---\n{GENERATED_HEADER}\n\nnet body\n"
        )
    );
    // Pinned wins over globs: alwaysApply, no globs line.
    assert_eq!(
        by_path[".cursor/rules/mixed.mdc"].new_content,
        format!(
            "---\ndescription: Mixed\nalwaysApply: true\n---\n{GENERATED_HEADER}\n\nmixed body\n"
        )
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn header_present_in_every_output() {
    let dir = temp_project("headers");
    golden_files(&dir);
    let p = preview(
        &dir,
        &golden_graph(&["claude", "agents", "cursor", "copilot", "gemini"]),
    );
    assert!(p.errors.is_empty());
    assert!(!p.files.is_empty());
    for f in &p.files {
        assert!(has_header(&f.new_content), "no header in {}", f.rel_path);
        if f.rel_path.ends_with(".md") {
            assert_eq!(
                f.new_content.lines().next().unwrap(),
                GENERATED_HEADER,
                "header not line 1 in {}",
                f.rel_path
            );
        }
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn handwritten_flag() {
    let dir = temp_project("handwritten");
    touch(&dir.join("context/a.md"), "a\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true)],
        &[],
        &["claude"],
    );

    // Absent file → not handwritten, no old content.
    let p = preview(&dir, &g);
    let generated = p.files[0].new_content.clone();
    assert!(!p.files[0].handwritten);
    assert!(p.files[0].old_content.is_none());

    // Non-empty file without the header → handwritten.
    touch(&dir.join("CLAUDE.md"), "my hand-rolled notes\n");
    let p = preview(&dir, &g);
    assert!(p.files[0].handwritten);
    assert!(!p.files[0].unchanged);

    // File carrying the header → not handwritten.
    touch(&dir.join("CLAUDE.md"), &format!("{GENERATED_HEADER}\nold compile\n"));
    let p = preview(&dir, &g);
    assert!(!p.files[0].handwritten);

    // Byte-identical file → unchanged.
    touch(&dir.join("CLAUDE.md"), &generated);
    let p = preview(&dir, &g);
    assert!(!p.files[0].handwritten);
    assert!(p.files[0].unchanged);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn unknown_fields_and_kinds_tolerated() {
    let dir = temp_project("tolerant");
    touch(&dir.join("context/a.md"), "a\n");
    let g = json!({
        "version": 1,
        "projectName": "P",
        "nodes": [{
            "id": "a", "title": "A", "role": "rules", "brief": "",
            "filePath": "context/a.md", "readOrder": 1, "pinned": true,
            "position": { "x": 0, "y": 0 },
            "lastVerified": "2026-08-16",
            "scenePos": { "tx": 1, "ty": 2 },
            "junk": [1, 2, 3]
        }],
        "edges": [{ "id": "e1", "source": "a", "target": "a", "kind": "futurekind" }],
        "compileTargets": ["claude", "windsurf"]
    })
    .to_string();
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 1);
    assert_eq!(p.files[0].rel_path, "CLAUDE.md");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn compile_write_allowlist() {
    let dir = temp_project("write");
    let root = dir.to_string_lossy().into_owned();
    let ok = format!("{GENERATED_HEADER}\nbody\n");
    let af = |rel: &str, content: &str| ApprovedFile {
        rel_path: rel.to_string(),
        content: content.to_string(),
    };

    for bad in ["src/evil.md", "../CLAUDE.md", ".cursor/rules/a/b.mdc"] {
        assert!(
            compile_write(root.clone(), vec![af(bad, &ok)]).is_err(),
            "should have rejected {bad}"
        );
    }
    assert!(
        compile_write(root.clone(), vec![af("CLAUDE.md", "no header here\n")]).is_err(),
        "should have rejected headerless content"
    );

    let written = compile_write(
        root.clone(),
        vec![
            af("CLAUDE.md", &ok),
            af("src/net/AGENTS.md", &ok),
            af(".cursor/rules/x.mdc", &ok),
        ],
    )
    .unwrap();
    assert_eq!(written, ["CLAUDE.md", "src/net/AGENTS.md", ".cursor/rules/x.mdc"]);
    for rel in &written {
        assert_eq!(fs::read_to_string(dir.join(rel)).unwrap(), ok);
    }
    let _ = fs::remove_dir_all(&dir);
}

// ── Agent context blocks ────────────────────────────────────────────────

fn find_file<'a>(p: &'a CompilePreview, rel: &str) -> Option<&'a PreviewFile> {
    p.files.iter().find(|f| f.rel_path == rel)
}

#[test]
fn agent_block_appended_when_absent_independent_of_compile_targets() {
    let dir = temp_project("agent-append");
    touch(&dir.join(".claude/agents/tech-ui.md"), "---\nname: tech-ui\n---\n\nDuties.\n");
    touch(&dir.join("context/rules.md"), "rules\n");
    let g = graph_json(
        "P",
        &[
            node_role("a", "tech-ui", ".claude/agents/tech-ui.md", 1, false, "agent"),
            node("b", "Rules", "context/rules.md", 2, false),
        ],
        &[edge("e1", "a", "b", "imports", None)],
        &[], // no compile targets selected — the block is independent
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 1, "no claude/agents/cursor targets requested");
    let f = find_file(&p, ".claude/agents/tech-ui.md").unwrap();
    assert_eq!(f.target, "agent");
    assert!(!f.handwritten);
    assert!(!f.unchanged);
    let expected = format!(
        "---\nname: tech-ui\n---\n\nDuties.\n\n{AGENT_BLOCK_START}\n@context/rules.md\n{AGENT_BLOCK_END}\n"
    );
    assert_eq!(f.new_content, expected);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_block_replaced_in_place_surrounding_bytes_identical() {
    let dir = temp_project("agent-replace");
    let before = format!(
        "---\nname: tech-ui\n---\n\nHand-written intro.\n\n{AGENT_BLOCK_START}\n@context/old.md\n{AGENT_BLOCK_END}\n\nHand-written outro.\n"
    );
    touch(&dir.join(".claude/agents/tech-ui.md"), &before);
    touch(&dir.join("context/new.md"), "new\n");
    let g = graph_json(
        "P",
        &[
            node_role("a", "tech-ui", ".claude/agents/tech-ui.md", 1, false, "agent"),
            node("b", "New", "context/new.md", 2, false),
        ],
        &[edge("e1", "a", "b", "references", None)],
        &[],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let f = find_file(&p, ".claude/agents/tech-ui.md").unwrap();
    let expected = format!(
        "---\nname: tech-ui\n---\n\nHand-written intro.\n\n{AGENT_BLOCK_START}\n@context/new.md\n{AGENT_BLOCK_END}\n\nHand-written outro.\n"
    );
    assert_eq!(f.new_content, expected);
    // Prefix and suffix around the block are byte-identical to the original.
    assert!(before.starts_with("---\nname: tech-ui\n---\n\nHand-written intro.\n\n"));
    assert!(f.new_content.ends_with("\n\nHand-written outro.\n"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_block_orders_targets_by_read_order_then_id() {
    let dir = temp_project("agent-order");
    touch(&dir.join(".claude/agents/lead.md"), "---\nname: lead\n---\n\nBody.\n");
    touch(&dir.join("context/z.md"), "z\n");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/m.md"), "m\n");
    let g = graph_json(
        "P",
        &[
            node_role("agent1", "lead", ".claude/agents/lead.md", 1, false, "agent"),
            node("z", "Z", "context/z.md", 5, false),
            node("a", "A", "context/a.md", 5, false),
            node("m", "M", "context/m.md", 1, false),
        ],
        &[
            edge("e1", "agent1", "z", "imports", None),
            edge("e2", "agent1", "a", "references", None),
            edge("e3", "agent1", "m", "imports", None),
        ],
        &[],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let f = find_file(&p, ".claude/agents/lead.md").unwrap();
    let lines: Vec<&str> = f.new_content.lines().filter(|l| l.starts_with('@')).collect();
    // m (readOrder 1) first, then a/z (both readOrder 5, tie-broken by id).
    assert_eq!(lines, ["@context/m.md", "@context/a.md", "@context/z.md"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_node_without_imports_or_references_edges_emits_nothing() {
    let dir = temp_project("agent-no-edges");
    touch(&dir.join(".claude/agents/solo.md"), "---\nname: solo\n---\n\nBody.\n");
    touch(&dir.join("context/rules.md"), "rules\n");
    // No edges at all.
    let g1 = graph_json(
        "P",
        &[
            node_role("a", "solo", ".claude/agents/solo.md", 1, false, "agent"),
            node("b", "Rules", "context/rules.md", 2, false),
        ],
        &[],
        &[],
    );
    let p1 = preview(&dir, &g1);
    assert!(p1.errors.is_empty());
    assert!(find_file(&p1, ".claude/agents/solo.md").is_none());

    // A `sequence` edge doesn't count — only imports/references do.
    let g2 = graph_json(
        "P",
        &[
            node_role("a", "solo", ".claude/agents/solo.md", 1, false, "agent"),
            node("b", "Rules", "context/rules.md", 2, false),
        ],
        &[edge("e1", "a", "b", "sequence", None)],
        &[],
    );
    let p2 = preview(&dir, &g2);
    assert!(p2.errors.is_empty());
    assert!(find_file(&p2, ".claude/agents/solo.md").is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_output_disallows_nested_subdirectory() {
    let dir = temp_project("agent-write-nested");
    let root = dir.to_string_lossy().into_owned();
    let content = format!("---\nname: x\n---\n\n{AGENT_BLOCK_START}\n@a.md\n{AGENT_BLOCK_END}\n");
    let err = compile_write(
        root,
        vec![ApprovedFile {
            rel_path: ".claude/agents/sub/dir.md".to_string(),
            content,
        }],
    )
    .unwrap_err();
    assert!(err.contains("Refusing to write outside compile outputs"));
    assert!(!dir.join(".claude/agents/sub/dir.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_output_requires_context_block_markers_not_generated_header() {
    let dir = temp_project("agent-write-markers");
    let root = dir.to_string_lossy().into_owned();

    // No markers at all → refused, even with the GENERATED header present.
    let no_markers = format!("{GENERATED_HEADER}\n---\nname: x\n---\n\nBody.\n");
    let err = compile_write(
        root.clone(),
        vec![ApprovedFile {
            rel_path: ".claude/agents/x.md".to_string(),
            content: no_markers,
        }],
    )
    .unwrap_err();
    assert!(err.contains("Missing Cowtext context block markers"));
    assert!(!dir.join(".claude/agents/x.md").exists());

    // Markers present, GENERATED header absent → accepted (agent files are
    // exempt from the header requirement).
    let with_markers = format!(
        "---\nname: x\n---\n\n{AGENT_BLOCK_START}\n@a.md\n{AGENT_BLOCK_END}\n"
    );
    let written = compile_write(
        root,
        vec![ApprovedFile {
            rel_path: ".claude/agents/x.md".to_string(),
            content: with_markers.clone(),
        }],
    )
    .unwrap();
    assert_eq!(written, [".claude/agents/x.md"]);
    assert_eq!(fs::read_to_string(dir.join(".claude/agents/x.md")).unwrap(), with_markers);
    let _ = fs::remove_dir_all(&dir);
}

// ── WO03: new compile targets + `overrides`/`supersedes`/`conflicts-with` ──

#[test]
fn golden_copilot_output() {
    let dir = temp_project("golden-copilot");
    golden_files(&dir);
    let p = preview(&dir, &golden_graph(&["copilot"]));
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 1);
    let f = &p.files[0];
    assert_eq!(f.rel_path, ".github/copilot-instructions.md");
    assert_eq!(f.target, "copilot");
    // Same structure as `agents` (markdown links, not `@path` imports).
    let golden = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # TestProj — agent context\n\
         \n\
         ## Always read\n\
         \n\
         - [Persona](context/persona.md)\n\
         - [Rules](context/rules.md)\n\
         \n\
         ## Read when relevant\n\
         \n\
         - When working on **Persona**, read [Networking notes](context/net-notes.md).\n\
         - When touching `src/net/**`, read [Net rules](context/net-rules.md).\n"
    );
    assert_eq!(f.new_content, golden);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn golden_gemini_output() {
    let dir = temp_project("golden-gemini");
    golden_files(&dir);
    let p = preview(&dir, &golden_graph(&["gemini"]));
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 1);
    let f = &p.files[0];
    assert_eq!(f.rel_path, "GEMINI.md");
    assert_eq!(f.target, "gemini");
    // Same structure as `claude` (`@path` inline imports).
    let golden = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # TestProj — agent context\n\
         \n\
         ## Always read\n\
         \n\
         @context/persona.md\n\
         @context/rules.md\n\
         \n\
         ## Read when relevant\n\
         \n\
         - When working on **Persona**, read @context/net-notes.md.\n\
         - When touching `src/net/**`, read @context/net-rules.md.\n"
    );
    assert_eq!(f.new_content, golden);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn all_five_targets_at_once() {
    let dir = temp_project("all-five");
    golden_files(&dir);
    let p = preview(
        &dir,
        &golden_graph(&["claude", "agents", "cursor", "copilot", "gemini"]),
    );
    assert!(p.errors.is_empty());
    let by_path: HashMap<&str, &PreviewFile> =
        p.files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    assert!(by_path.contains_key("CLAUDE.md"));
    assert!(by_path.contains_key("AGENTS.md"));
    assert!(by_path.contains_key(".github/copilot-instructions.md"));
    assert!(by_path.contains_key("GEMINI.md"));
    assert!(by_path.keys().any(|k| k.starts_with(".cursor/rules/")));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn copilot_and_gemini_allowlist_rejects_near_misses() {
    let dir = temp_project("new-target-write");
    let root = dir.to_string_lossy().into_owned();
    let ok = format!("{GENERATED_HEADER}\nbody\n");
    let af = |rel: &str, content: &str| ApprovedFile {
        rel_path: rel.to_string(),
        content: content.to_string(),
    };

    for bad in [
        ".github/copilot-instructions.txt",
        "sub/GEMINI.md",
        ".github/nested/copilot-instructions.md",
        "github/copilot-instructions.md",
        "GEMINI.MD",
    ] {
        assert!(
            compile_write(root.clone(), vec![af(bad, &ok)]).is_err(),
            "should have rejected {bad}"
        );
    }

    let written = compile_write(
        root.clone(),
        vec![
            af(".github/copilot-instructions.md", &ok),
            af("GEMINI.md", &ok),
        ],
    )
    .unwrap();
    assert_eq!(written, [".github/copilot-instructions.md", "GEMINI.md"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overrides_edge_participates_like_imports_in_ordering() {
    let dir = temp_project("overrides-order");
    for f in ["a", "b"] {
        touch(&dir.join(format!("context/{f}.md")), "x\n");
    }
    // readOrder a=1, b=2 but "a overrides b" ⇒ b (the overridden node) is
    // read first — the contract mandates the same direction as `imports`.
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 1, true),
            node("b", "B", "context/b.md", 2, true),
        ],
        &[edge("e1", "a", "b", "overrides", None)],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let at_lines: Vec<&str> = p.files[0]
        .new_content
        .lines()
        .filter(|l| l.starts_with('@'))
        .collect();
    assert_eq!(at_lines, ["@context/b.md", "@context/a.md"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overrides_cycle_detected_with_path() {
    let dir = temp_project("overrides-cycle");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/b.md"), "b\n");
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 1, true),
            node("b", "B", "context/b.md", 2, true),
        ],
        &[
            edge("e1", "a", "b", "overrides", None),
            edge("e2", "b", "a", "overrides", None),
        ],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.files.is_empty());
    assert_eq!(p.errors.len(), 1);
    match &p.errors[0] {
        ValidationError::Cycle { nodes } => {
            assert_eq!(nodes.len(), 3);
            assert_eq!(nodes.first().unwrap().id, nodes.last().unwrap().id);
        }
        other => panic!("expected a cycle error, got {other:?}"),
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn mixed_imports_and_overrides_cycle_detected() {
    // Cycle formed by mixing `imports` and `overrides` edges — both are
    // structural with the same (target-before-source) direction, so a
    // cycle spanning both kinds must be caught exactly like a same-kind one.
    let dir = temp_project("mixed-cycle");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/b.md"), "b\n");
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 1, true),
            node("b", "B", "context/b.md", 2, true),
        ],
        &[
            edge("e1", "a", "b", "imports", None),
            edge("e2", "b", "a", "overrides", None),
        ],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.files.is_empty());
    assert_eq!(p.errors.len(), 1);
    assert!(matches!(p.errors[0], ValidationError::Cycle { .. }));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn supersedes_and_conflicts_with_edges_are_non_structural() {
    let dir = temp_project("non-structural");
    for f in ["a", "b"] {
        touch(&dir.join(format!("context/{f}.md")), "x\n");
    }
    // A "cycle" shape built entirely from supersedes + conflicts-with edges
    // must NOT be reported (they never enter the constraint graph) and must
    // NOT affect ordering — pure readOrder decides.
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 1, true),
            node("b", "B", "context/b.md", 2, true),
        ],
        &[
            edge("e1", "a", "b", "supersedes", None),
            edge("e2", "b", "a", "conflicts-with", None),
        ],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(
        p.errors.is_empty(),
        "non-structural edges must not trigger cycle validation: {:?}",
        p.errors
    );
    let at_lines: Vec<&str> = p.files[0]
        .new_content
        .lines()
        .filter(|l| l.starts_with('@'))
        .collect();
    assert_eq!(
        at_lines,
        ["@context/a.md", "@context/b.md"],
        "order must follow pure readOrder, unaffected by non-structural edges"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn edge_kind_in_is_structural_matches_project_edge_kind() {
    // Every recognized wire spelling must delegate to (not re-derive) the
    // canonical predicate — this is the "go through `is_structural()`"
    // contract requirement made explicit and independently checkable.
    let cases: &[(&str, bool)] = &[
        ("imports", true),
        ("sequence", true),
        ("overrides", true),
        ("references", false),
        ("conditional", false),
        ("supersedes", false),
        ("conflicts-with", false),
    ];
    for &(name, expected) in cases {
        let e: EdgeIn = serde_json::from_value(json!({
            "id": "e", "source": "a", "target": "b", "kind": name
        }))
        .unwrap();
        assert_eq!(e.kind.is_structural(), expected, "kind = {name}");
    }
}

/// The single most important test in this lane: a v3-shaped graph carrying
/// every new WO03 field (tags/owner/meta on nodes, color on edges, version
/// 3) that has no *new-variant* data (no `overrides`/`supersedes`/
/// `conflicts-with` edges, no new roles, no copilot/gemini targets) must
/// still produce byte-identical `claude`/`agents`/`cursor` output to the
/// pre-WO03 golden graph — proving the new schema surface doesn't leak into
/// legacy adapters. `GraphIn`/`NodeIn`/`EdgeIn` simply don't model the new
/// fields, so they parse and are ignored by construction; this test is the
/// executable proof of that, pinned against the same literal goldens the
/// pre-WO03 tests use.
#[test]
fn v3_additions_do_not_change_legacy_target_output() {
    let dir = temp_project("v3-legacy-regression");
    golden_files(&dir);
    let g = json!({
        "version": 3,
        "projectName": "TestProj",
        "nodes": [
            {
                "id": "a", "title": "Persona", "role": "agent",
                "filePath": "context/persona.md", "readOrder": 1, "pinned": true,
                "tags": ["core"], "owner": "marty", "meta": { "k": "v" }
            },
            {
                "id": "b", "title": "Rules", "role": "rules",
                "filePath": "context/rules.md", "readOrder": 2, "pinned": true
            },
            {
                "id": "c", "title": "Networking notes", "role": "reference",
                "filePath": "context/net-notes.md", "readOrder": 3, "pinned": false
            },
            {
                "id": "d", "title": "Net rules", "role": "rules",
                "filePath": "context/net-rules.md", "readOrder": 4, "pinned": false
            }
        ],
        "edges": [
            { "id": "e1", "source": "a", "target": "c", "kind": "references", "color": "#ff0000" },
            { "id": "e2", "source": "a", "target": "d", "kind": "conditional", "condition": "src/net/**" }
        ],
        "compileTargets": ["claude", "agents", "cursor"]
    })
    .to_string();
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty(), "{:?}", p.errors);
    let by_path: HashMap<&str, &PreviewFile> =
        p.files.iter().map(|f| (f.rel_path.as_str(), f)).collect();

    let golden_claude = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # TestProj — agent context\n\
         \n\
         ## Always read\n\
         \n\
         @context/persona.md\n\
         @context/rules.md\n\
         \n\
         ## Read when relevant\n\
         \n\
         - When working on **Persona**, read @context/net-notes.md.\n\
         - When touching `src/net/**`, read @context/net-rules.md.\n"
    );
    assert_eq!(by_path["CLAUDE.md"].new_content, golden_claude);

    let golden_agents = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # TestProj — agent context\n\
         \n\
         ## Always read\n\
         \n\
         - [Persona](context/persona.md)\n\
         - [Rules](context/rules.md)\n\
         \n\
         ## Read when relevant\n\
         \n\
         - When working on **Persona**, read [Networking notes](context/net-notes.md).\n\
         - When touching `src/net/**`, read [Net rules](context/net-rules.md).\n"
    );
    assert_eq!(by_path["AGENTS.md"].new_content, golden_agents);

    // The clean-folder-glob conditional (`src/net/**`, targeting "d") also
    // spawns a nested AGENTS.md — same as pre-WO03 (`nested_agents_for_clean_glob`).
    let golden_nested_agents = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # TestProj — context for src/net\n\
         \n\
         - Read [Net rules](../../context/net-rules.md).\n"
    );
    assert_eq!(
        by_path["src/net/AGENTS.md"].new_content,
        golden_nested_agents
    );

    assert_eq!(
        by_path[".cursor/rules/persona.mdc"].new_content,
        format!("---\ndescription: Persona\nalwaysApply: true\n---\n{GENERATED_HEADER}\n\npersona body\n")
    );
    assert_eq!(
        by_path[".cursor/rules/rules.mdc"].new_content,
        format!("---\ndescription: Rules\nalwaysApply: true\n---\n{GENERATED_HEADER}\n\nrules body\n")
    );
    assert_eq!(
        by_path[".cursor/rules/net-rules.mdc"].new_content,
        format!("---\ndescription: Net rules\nglobs: src/net/**\n---\n{GENERATED_HEADER}\n\nnet rules body\n")
    );
    // "c" (Networking notes) is only `references`-linked, never pinned nor a
    // glob target — no cursor rule file, same as before WO03.
    assert!(!by_path.contains_key(".cursor/rules/net-notes.mdc"));
    assert_eq!(p.files.len(), 6); // CLAUDE.md, AGENTS.md, nested AGENTS.md, 3× .mdc

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn legacy_persona_role_in_v1_graph_also_emits_agent_block() {
    let dir = temp_project("agent-legacy-persona");
    touch(&dir.join(".claude/agents/legacy.md"), "---\nname: legacy\n---\n\nBody.\n");
    touch(&dir.join("context/rules.md"), "rules\n");
    // graph_json always stamps "version": 1 — the pre-rename shape.
    let g = graph_json(
        "P",
        &[
            node_role("a", "legacy", ".claude/agents/legacy.md", 1, false, "persona"),
            node("b", "Rules", "context/rules.md", 2, false),
        ],
        &[edge("e1", "a", "b", "imports", None)],
        &[],
    );
    assert!(g.contains("\"version\":1"));
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let f = find_file(&p, ".claude/agents/legacy.md").unwrap();
    assert!(f.new_content.contains("@context/rules.md"));
    let _ = fs::remove_dir_all(&dir);
}
