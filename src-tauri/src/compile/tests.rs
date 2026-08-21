use super::*;
use serde_json::{json, Value};

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

/// v5 node literal. `always` sets `rootLoad: "always"`; omitted otherwise.
fn node(id: &str, title: &str, file_path: &str, read_order: i64, always: bool) -> Value {
    node_role(id, title, file_path, read_order, always, "rule")
}

fn node_role(
    id: &str,
    title: &str,
    file_path: &str,
    read_order: i64,
    always: bool,
    role: &str,
) -> Value {
    let mut v = json!({
        "id": id, "title": title, "role": role, "brief": "",
        "filePath": file_path, "readOrder": read_order,
        "position": { "x": 0, "y": 0 }
    });
    if always {
        v["rootLoad"] = json!("always");
    }
    v
}

fn node_deprecated(id: &str, title: &str, file_path: &str, read_order: i64, replaced_by: &str) -> Value {
    let mut v = node(id, title, file_path, read_order, false);
    v["deprecated"] = json!({ "replacedBy": replaced_by });
    v
}

fn edge(id: &str, source: &str, target: &str, kind: &str) -> Value {
    json!({ "id": id, "source": source, "target": target, "kind": kind })
}

fn edge_glob(id: &str, source: &str, target: &str, globs: &[&str]) -> Value {
    let mut e = edge(id, source, target, "imports");
    e["guard"] = json!({ "type": "glob", "globs": globs });
    e
}

fn edge_desc(id: &str, source: &str, target: &str, text: &str) -> Value {
    let mut e = edge(id, source, target, "imports");
    e["guard"] = json!({ "type": "description", "text": text });
    e
}

fn graph_json(name: &str, nodes: &[Value], edges: &[Value], targets: &[&str]) -> String {
    json!({
        "version": 5, "projectName": name,
        "nodes": nodes, "edges": edges, "compileTargets": targets
    })
    .to_string()
}

fn preview(root: &Path, graph: &str) -> CompilePreview {
    compile_preview(root.to_string_lossy().into_owned(), graph.to_string(), Vec::new()).unwrap()
}

fn preview_overlay(root: &Path, graph: &str, overlay: Vec<ApprovedFile>) -> CompilePreview {
    compile_preview(root.to_string_lossy().into_owned(), graph.to_string(), overlay).unwrap()
}

fn approved(rel: &str, content: &str) -> ApprovedFile {
    ApprovedFile {
        rel_path: rel.to_string(),
        content: content.to_string(),
    }
}

/// The §1.6-style example graph: 2 root-always + 1 references + 1
/// glob-guarded imports.
fn golden_graph(targets: &[&str]) -> String {
    graph_json(
        "TestProj",
        &[
            node_role("a", "Persona", "context/persona.md", 1, true, "agent"),
            node("b", "Rules", "context/rules.md", 2, true),
            node("c", "Networking notes", "context/net-notes.md", 3, false),
            node("d", "Net rules", "context/net-rules.md", 4, false),
        ],
        &[
            edge("e1", "a", "c", "references"),
            edge_glob("e2", "a", "d", &["src/net/**"]),
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

fn find_file<'a>(p: &'a CompilePreview, rel: &str) -> Option<&'a PreviewFile> {
    p.files.iter().find(|f| f.rel_path == rel)
}

// ── Validation ──────────────────────────────────────────────────────────

#[test]
fn cycle_detected_with_path() {
    let dir = temp_project("cycle");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/b.md"), "b\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("b", "B", "context/b.md", 2, true)],
        &[edge("e1", "a", "b", "sequence"), edge("e2", "b", "a", "sequence")],
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
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 3, true),
            node("b", "B", "context/b.md", 1, true),
            node("c", "C", "context/c.md", 2, true),
        ],
        &[edge("e1", "a", "c", "imports")],
        &["claude"],
    );
    let p1 = preview(&dir, &g);
    let p2 = preview(&dir, &g);
    assert!(p1.errors.is_empty());
    let at_lines: Vec<&str> = p1.files[0].new_content.lines().filter(|l| l.starts_with('@')).collect();
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
    let at_lines: Vec<&str> = p.files[0].new_content.lines().filter(|l| l.starts_with('@')).collect();
    assert_eq!(at_lines, ["@context/b.md", "@context/a.md", "@context/c.md"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn missing_file_reported() {
    let dir = temp_project("missing");
    let g = graph_json("P", &[node("a", "A", "context/gone.md", 1, true)], &[], &["claude"]);
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
        &[edge("e1", "a", "ghost", "references")],
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

// ── Golden root-file output ───────────────────────────────────────────

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
fn description_guard_produces_a_when_bullet() {
    let dir = temp_project("desc-guard");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/trap.md"), "trap\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("t", "Trap", "context/trap.md", 2, false)],
        &[edge_desc("e1", "a", "t", "you are debugging a flaky test")],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let claude = find_file(&p, "CLAUDE.md").unwrap();
    assert!(claude
        .new_content
        .contains("- When you are debugging a flaky test, read @context/trap.md."));
    let _ = fs::remove_dir_all(&dir);
}

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
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn all_five_targets_at_once() {
    let dir = temp_project("all-five");
    golden_files(&dir);
    let p = preview(&dir, &golden_graph(&["claude", "agents", "cursor", "copilot", "gemini"]));
    assert!(p.errors.is_empty());
    let by_path: HashMap<&str, &PreviewFile> = p.files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
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
    for bad in [
        ".github/copilot-instructions.txt",
        "sub/GEMINI.md",
        ".github/nested/copilot-instructions.md",
        "github/copilot-instructions.md",
        "GEMINI.MD",
    ] {
        assert!(
            compile_write(root.clone(), vec![approved(bad, &ok)]).is_err(),
            "should have rejected {bad}"
        );
    }
    let written = compile_write(
        root.clone(),
        vec![approved(".github/copilot-instructions.md", &ok), approved("GEMINI.md", &ok)],
    )
    .unwrap();
    assert_eq!(written, [".github/copilot-instructions.md", "GEMINI.md"]);
    let _ = fs::remove_dir_all(&dir);
}

// ── Nested AGENTS.md ────────────────────────────────────────────────────

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
        &[edge_glob("e1", "a", "d", &["src/net/**"]), edge_glob("e2", "a", "c", &["src/io/**/*"])],
        &["agents"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 2, "root AGENTS.md + one nested file; src/io/**/* is not clean");
    assert!(p.files[0]
        .new_content
        .contains("- When touching `src/net/**`, read [Net rules](context/net-rules.md)."));
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
fn one_glob_guard_with_two_dirs_spawns_two_nested_files() {
    // §10.2: "iterating each entry of a glob guard's globs" — a SINGLE
    // edge whose globs array names two different clean dirs spawns two
    // nested AGENTS.md, both listing the same target.
    let dir = temp_project("nested-multi-glob");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/d.md"), "d\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("d", "D", "context/d.md", 2, false)],
        &[edge_glob("e1", "a", "d", &["src/net/**", "src/api/**"])],
        &["agents"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 3, "root AGENTS.md + two nested files");
    assert!(find_file(&p, "src/net/AGENTS.md").is_some());
    assert!(find_file(&p, "src/api/AGENTS.md").is_some());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dirty_glob_dirs_stay_root_bullets() {
    let dir = temp_project("dirty-globs");
    golden_files(&dir);
    let conditions = ["./**", "../lib/**", "src/./**", "src//**", "C:/x/**", "src\\net/**"];
    let edges: Vec<Value> = conditions
        .iter()
        .enumerate()
        .map(|(i, c)| edge_glob(&format!("e{i}"), "a", "d", &[c]))
        .collect();
    let g = graph_json(
        "P",
        &[node("a", "Persona", "context/persona.md", 1, true), node("d", "Net rules", "context/net-rules.md", 2, false)],
        &edges,
        &["agents"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 1);
    assert_eq!(p.files[0].rel_path, "AGENTS.md");
    for c in conditions {
        assert!(
            p.files[0].new_content.contains(&format!("- When touching `{c}`,")),
            "missing root bullet for {c}"
        );
    }
    let _ = fs::remove_dir_all(&dir);
}

// ── Cursor ──────────────────────────────────────────────────────────────

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
        &[edge_glob("e1", "a", "b", &["[ab]/x/**"])],
        &["cursor"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let by_path: HashMap<&str, &PreviewFile> = p.files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    assert!(by_path[".cursor/rules/net.mdc"]
        .new_content
        .starts_with("---\ndescription: \"Networking: overview\"\nalwaysApply: true\n---\n"));
    assert!(by_path[".cursor/rules/notes.mdc"]
        .new_content
        .starts_with("---\ndescription: \"Notes: \\\"hi\\\"\"\nglobs: \"[ab]/x/**\"\n---\n"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn yaml_scalar_plain_and_quoted() {
    for plain in ["Persona", "Net rules", "src/net/**", "src/a/**,src/b/**"] {
        assert_eq!(yaml_scalar(plain), plain);
    }
    assert_eq!(yaml_scalar(""), "\"\"");
    assert_eq!(yaml_scalar("true"), "\"true\"");
    assert_eq!(yaml_scalar("123"), "\"123\"");
    assert_eq!(yaml_scalar("#leading"), "\"#leading\"");
    assert_eq!(yaml_scalar("trailing:"), "\"trailing:\"");
    assert_eq!(yaml_scalar("a\nb"), "\"a\\nb\"");
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
        &[edge_glob("e1", "a", "d", &["src/net/**"]), edge_glob("e2", "a", "m", &["src/x/**"])],
        &["cursor"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let by_path: HashMap<&str, &PreviewFile> = p.files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    assert_eq!(p.files.len(), 3);
    assert_eq!(
        by_path[".cursor/rules/persona.mdc"].new_content,
        format!("---\ndescription: Persona\nalwaysApply: true\n---\n{GENERATED_HEADER}\n\npersona body\n")
    );
    assert_eq!(
        by_path[".cursor/rules/net-rules.mdc"].new_content,
        format!("---\ndescription: Net rules\nglobs: src/net/**\n---\n{GENERATED_HEADER}\n\nnet body\n")
    );
    // Root-always wins over globs: alwaysApply, no globs line, even though
    // "m" is also the target of a glob-guarded edge.
    assert_eq!(
        by_path[".cursor/rules/mixed.mdc"].new_content,
        format!("---\ndescription: Mixed\nalwaysApply: true\n---\n{GENERATED_HEADER}\n\nmixed body\n")
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn header_present_in_every_output() {
    let dir = temp_project("headers");
    golden_files(&dir);
    let p = preview(&dir, &golden_graph(&["claude", "agents", "cursor", "copilot", "gemini"]));
    assert!(p.errors.is_empty());
    assert!(!p.files.is_empty());
    for f in &p.files {
        assert!(has_header(&f.new_content), "no header in {}", f.rel_path);
        if f.rel_path.ends_with(".md") {
            assert_eq!(f.new_content.lines().next().unwrap(), GENERATED_HEADER, "header not line 1 in {}", f.rel_path);
        }
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn handwritten_flag() {
    let dir = temp_project("handwritten");
    touch(&dir.join("context/a.md"), "a\n");
    let g = graph_json("P", &[node("a", "A", "context/a.md", 1, true)], &[], &["claude"]);

    let p = preview(&dir, &g);
    let generated = p.files[0].new_content.clone();
    assert!(!p.files[0].handwritten);
    assert!(p.files[0].old_content.is_none());

    touch(&dir.join("CLAUDE.md"), "my hand-rolled notes\n");
    let p = preview(&dir, &g);
    assert!(p.files[0].handwritten);
    assert!(!p.files[0].unchanged);

    touch(&dir.join("CLAUDE.md"), &format!("{GENERATED_HEADER}\nold compile\n"));
    let p = preview(&dir, &g);
    assert!(!p.files[0].handwritten);

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
        "version": 5,
        "projectName": "P",
        "nodes": [{
            "id": "a", "title": "A", "role": "rule", "brief": "",
            "filePath": "context/a.md", "readOrder": 1, "rootLoad": "always",
            "position": { "x": 0, "y": 0 },
            "lastVerified": "2026-08-16",
            "scenePos": { "tx": 1, "ty": 2 },
            "tags": ["core"], "owner": "marty", "meta": { "k": "v" },
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

    for bad in [
        "src/evil.md",
        "../CLAUDE.md",
        ".cursor/rules/a/b.mdc",
        ".claude/commands/a/b.md",
        ".claude/skills/foo/SKILL.md",
    ] {
        assert!(
            compile_write(root.clone(), vec![approved(bad, &ok)]).is_err(),
            "should have rejected {bad}"
        );
    }
    assert!(
        compile_write(root.clone(), vec![approved("CLAUDE.md", "no header here\n")]).is_err(),
        "should have rejected headerless content"
    );

    let written = compile_write(
        root.clone(),
        vec![
            approved("CLAUDE.md", &ok),
            approved("src/net/AGENTS.md", &ok),
            approved(".cursor/rules/x.mdc", &ok),
            approved(".claude/commands/y.md", &ok),
        ],
    )
    .unwrap();
    assert_eq!(
        written,
        ["CLAUDE.md", "src/net/AGENTS.md", ".cursor/rules/x.mdc", ".claude/commands/y.md"]
    );
    for rel in &written {
        assert_eq!(fs::read_to_string(dir.join(rel)).unwrap(), ok);
    }
    let _ = fs::remove_dir_all(&dir);
}

// ── Agent context blocks ────────────────────────────────────────────────

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
        &[edge("e1", "a", "b", "imports")],
        &[],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert_eq!(p.files.len(), 1, "no claude/agents/cursor targets requested");
    let f = find_file(&p, ".claude/agents/tech-ui.md").unwrap();
    assert_eq!(f.target, "agent");
    assert!(!f.handwritten);
    assert!(!f.unchanged);
    let expected =
        format!("---\nname: tech-ui\n---\n\nDuties.\n\n{AGENT_BLOCK_START}\n@context/rules.md\n{AGENT_BLOCK_END}\n");
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
        &[edge("e1", "a", "b", "references")],
        &[],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let f = find_file(&p, ".claude/agents/tech-ui.md").unwrap();
    let expected = format!(
        "---\nname: tech-ui\n---\n\nHand-written intro.\n\n{AGENT_BLOCK_START}\n@context/new.md\n{AGENT_BLOCK_END}\n\nHand-written outro.\n"
    );
    assert_eq!(f.new_content, expected);
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
            edge("e1", "agent1", "z", "imports"),
            edge("e2", "agent1", "a", "references"),
            edge("e3", "agent1", "m", "imports"),
        ],
        &[],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let f = find_file(&p, ".claude/agents/lead.md").unwrap();
    let lines: Vec<&str> = f.new_content.lines().filter(|l| l.starts_with('@')).collect();
    assert_eq!(lines, ["@context/m.md", "@context/a.md", "@context/z.md"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_node_without_imports_or_references_edges_emits_nothing() {
    let dir = temp_project("agent-no-edges");
    touch(&dir.join(".claude/agents/solo.md"), "---\nname: solo\n---\n\nBody.\n");
    touch(&dir.join("context/rules.md"), "rules\n");
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

    let g2 = graph_json(
        "P",
        &[
            node_role("a", "solo", ".claude/agents/solo.md", 1, false, "agent"),
            node("b", "Rules", "context/rules.md", 2, false),
        ],
        &[edge("e1", "a", "b", "sequence")],
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
    let err = compile_write(root, vec![approved(".claude/agents/sub/dir.md", &content)]).unwrap_err();
    assert!(err.contains("Refusing to write outside compile outputs"));
    assert!(!dir.join(".claude/agents/sub/dir.md").exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_output_requires_context_block_markers_not_generated_header() {
    let dir = temp_project("agent-write-markers");
    let root = dir.to_string_lossy().into_owned();

    let no_markers = format!("{GENERATED_HEADER}\n---\nname: x\n---\n\nBody.\n");
    let err = compile_write(root.clone(), vec![approved(".claude/agents/x.md", &no_markers)]).unwrap_err();
    assert!(err.contains("Missing Cowtext context block markers"));
    assert!(!dir.join(".claude/agents/x.md").exists());

    let with_markers = format!("---\nname: x\n---\n\n{AGENT_BLOCK_START}\n@a.md\n{AGENT_BLOCK_END}\n");
    let written = compile_write(root, vec![approved(".claude/agents/x.md", &with_markers)]).unwrap();
    assert_eq!(written, [".claude/agents/x.md"]);
    assert_eq!(fs::read_to_string(dir.join(".claude/agents/x.md")).unwrap(), with_markers);
    let _ = fs::remove_dir_all(&dir);
}

// ── Overrides ordering + precedence markers (§10.4) ────────────────────

#[test]
fn overrides_edge_participates_like_imports_in_ordering() {
    let dir = temp_project("overrides-order");
    for f in ["a", "b"] {
        touch(&dir.join(format!("context/{f}.md")), "x\n");
    }
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("b", "B", "context/b.md", 2, true)],
        &[edge("e1", "a", "b", "overrides")],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    // Marker lines start with "<!--", not "@" — this filter keeps the
    // ordering assertion focused, independent of the precedence-marker test
    // below.
    let at_lines: Vec<&str> = p.files[0].new_content.lines().filter(|l| l.starts_with('@')).collect();
    assert_eq!(at_lines, ["@context/b.md", "@context/a.md"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overrides_precedence_marker_co_resident_and_recompile_twice_byte_identical() {
    let dir = temp_project("overrides-marker");
    for f in ["a", "b"] {
        touch(&dir.join(format!("context/{f}.md")), "x\n");
    }
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("b", "B", "context/b.md", 2, true)],
        &[edge("e1", "a", "b", "overrides")],
        &["claude"],
    );
    let p1 = preview(&dir, &g);
    let p2 = preview(&dir, &g);
    assert!(p1.errors.is_empty());
    let golden = format!(
        "{GENERATED_HEADER}\n\
         \n\
         # P — agent context\n\
         \n\
         ## Always read\n\
         \n\
         @context/b.md\n\
         <!-- cowtext:precedence -->Takes precedence over \"B\" below.\n\
         @context/a.md\n"
    );
    assert_eq!(p1.files[0].new_content, golden);
    assert_eq!(p1.files[0].new_content, p2.files[0].new_content, "recompile twice must be byte-identical");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overrides_precedence_marker_absent_when_not_co_resident() {
    let dir = temp_project("overrides-not-co-resident");
    for f in ["a", "b"] {
        touch(&dir.join(format!("context/{f}.md")), "x\n");
    }
    // "a" is root-always; "b" is not (and nothing imports it), so it is
    // never in the Always-read set. No marker — and "b" itself is excluded
    // from "## Always read" entirely.
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("b", "B", "context/b.md", 2, false)],
        &[edge("e1", "a", "b", "overrides")],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert!(!p.files[0].new_content.contains("cowtext:precedence"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overrides_cycle_detected_with_path() {
    let dir = temp_project("overrides-cycle");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/b.md"), "b\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("b", "B", "context/b.md", 2, true)],
        &[edge("e1", "a", "b", "overrides"), edge("e2", "b", "a", "overrides")],
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
    let dir = temp_project("mixed-cycle");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/b.md"), "b\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("b", "B", "context/b.md", 2, true)],
        &[edge("e1", "a", "b", "imports"), edge("e2", "b", "a", "overrides")],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.files.is_empty());
    assert_eq!(p.errors.len(), 1);
    assert!(matches!(p.errors[0], ValidationError::Cycle { .. }));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn contradicts_is_non_structural() {
    let dir = temp_project("non-structural");
    for f in ["a", "b"] {
        touch(&dir.join(format!("context/{f}.md")), "x\n");
    }
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node("b", "B", "context/b.md", 2, true)],
        &[edge("e1", "a", "b", "contradicts")],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty(), "contradicts must never trigger cycle validation: {:?}", p.errors);
    let at_lines: Vec<&str> = p.files[0].new_content.lines().filter(|l| l.starts_with('@')).collect();
    assert_eq!(at_lines, ["@context/a.md", "@context/b.md"], "order must follow pure readOrder");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn guarded_structural_edge_does_not_participate_in_ordering() {
    // §9's single most dangerous invariant, exercised directly: an `imports`
    // edge WITH a guard must not enter Kahn's algorithm — pure readOrder
    // decides, exactly as if the edge did not exist for ordering purposes.
    let dir = temp_project("guarded-no-order");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/b.md"), "b\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, false), node("b", "B", "context/b.md", 2, false)],
        &[edge_glob("e1", "a", "b", &["src/x/**"])],
        &["agents"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    // No cycle possible here either way; the real proof is the fixture-
    // corpus case "a glob guard stops the always closure dead" (§8.2),
    // asserted in resolve_load's own tests. This test only pins that a
    // guarded edge does not blow up ordering.
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn edge_kind_in_participation_matches_project_edge_kind() {
    // Every recognized wire spelling must delegate to (not re-derive) the
    // canonical predicate via `to_project_kind` +
    // `crate::project::edge_participates_in_order` (§9).
    let cases: &[(&str, bool)] = &[
        ("imports", true),
        ("sequence", true),
        ("overrides", true),
        ("references", false),
        ("contradicts", false),
    ];
    for &(name, expected) in cases {
        let e: EdgeIn = serde_json::from_value(json!({ "id": "e", "source": "a", "target": "b", "kind": name })).unwrap();
        assert_eq!(
            crate::project::edge_participates_in_order(to_project_kind(e.kind), false),
            expected,
            "kind = {name}"
        );
    }
}

/// v5 fields not modeled by the tolerant `GraphIn`/`NodeIn`/`EdgeIn` (tags,
/// owner, meta, scenePos, lastVerified) must not leak into output.
#[test]
fn extra_v5_fields_do_not_change_output() {
    let dir = temp_project("extra-fields");
    golden_files(&dir);
    let mut g: Value = serde_json::from_str(&golden_graph(&["claude"])).unwrap();
    g["nodes"][0]["tags"] = json!(["core"]);
    g["nodes"][0]["owner"] = json!("marty");
    g["nodes"][0]["meta"] = json!({ "k": "v" });
    g["nodes"][0]["scenePos"] = json!({ "tx": 1, "ty": 2 });
    g["nodes"][0]["lastVerified"] = json!("2026-08-16");
    let p1 = preview(&dir, &golden_graph(&["claude"]));
    let p2 = preview(&dir, &g.to_string());
    assert_eq!(p1.files[0].new_content, p2.files[0].new_content);
    let _ = fs::remove_dir_all(&dir);
}

// ── Amendment 1: `.claude/commands/` emitter + destination lock (§10.5) ──

#[test]
fn command_role_emits_a_claude_command_file_regardless_of_edges() {
    let dir = temp_project("commands-basic");
    touch(&dir.join("context/deploy.md"), "Run the deploy script.\n$ARGUMENTS\n");
    let g = graph_json(
        "P",
        &[node_role("a", "Deploy", "context/deploy.md", 1, false, "command")],
        &[],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty(), "{:?}", p.errors);
    let f = find_file(&p, ".claude/commands/deploy.md").unwrap();
    assert_eq!(f.target, "claude");
    let golden = format!(
        "---\ndescription: Deploy\n---\n{GENERATED_HEADER}\n\nRun the deploy script.\n$ARGUMENTS\n"
    );
    assert_eq!(f.new_content, golden);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn command_role_gated_on_claude_target_only() {
    let dir = temp_project("commands-gate");
    touch(&dir.join("context/deploy.md"), "body\n");
    let g = graph_json(
        "P",
        &[node_role("a", "Deploy", "context/deploy.md", 1, false, "command")],
        &[],
        &["cursor"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert!(
        !p.files.iter().any(|f| f.rel_path.starts_with(".claude/commands/")),
        "no .claude/ scaffolding for a Cursor-only project"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn command_role_never_appears_in_always_read() {
    let dir = temp_project("commands-not-always");
    touch(&dir.join("context/deploy.md"), "body\n");
    let g = graph_json(
        "P",
        &[node_role("a", "Deploy", "context/deploy.md", 1, true, "command")],
        &[],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let claude = find_file(&p, "CLAUDE.md").unwrap();
    assert!(!claude.new_content.contains("@context/deploy.md"));
    assert!(find_file(&p, ".claude/commands/deploy.md").is_some());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn skill_role_emits_no_file_and_leaves_always_read() {
    let dir = temp_project("skill-no-emitter");
    touch(&dir.join("context/bisect.md"), "body\n");
    let g = graph_json(
        "P",
        &[node_role("a", "Bisect", "context/bisect.md", 1, true, "skill")],
        &[],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert!(p.files.iter().all(|f| !f.rel_path.starts_with(".claude/skills/")));
    assert!(p.files.iter().all(|f| !f.rel_path.starts_with(".claude/commands/")));
    let claude = find_file(&p, "CLAUDE.md").unwrap();
    assert!(!claude.new_content.contains("@context/bisect.md"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn skill_role_keeps_its_edge_driven_bullet() {
    let dir = temp_project("skill-bullet");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/bisect.md"), "body\n");
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 1, true),
            node_role("s", "Bisect", "context/bisect.md", 2, true, "skill"),
        ],
        &[edge("e1", "a", "s", "references")],
        &["claude"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let claude = find_file(&p, "CLAUDE.md").unwrap();
    // Not a standalone "## Always read" line...
    let at_lines: Vec<&str> = claude.new_content.lines().filter(|l| l.starts_with('@')).collect();
    assert!(!at_lines.contains(&"@context/bisect.md"));
    // ...but the edge-driven bullet still names it.
    assert!(claude.new_content.contains("- When working on **A**, read @context/bisect.md."));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn deprecated_node_excluded_from_every_adapter() {
    let dir = temp_project("deprecated-excluded");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("context/old.md"), "old\n");
    let g = graph_json(
        "P",
        &[node("a", "A", "context/a.md", 1, true), node_deprecated("old", "Old", "context/old.md", 2, "a")],
        &[edge("e1", "a", "old", "references")],
        &["claude", "cursor"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let claude = find_file(&p, "CLAUDE.md").unwrap();
    assert!(!claude.new_content.contains("old.md"));
    assert!(find_file(&p, ".cursor/rules/old.mdc").is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn deprecated_command_node_never_emitted() {
    let dir = temp_project("deprecated-command");
    touch(&dir.join("context/deploy.md"), "body\n");
    let g = graph_json(
        "P",
        &[node_deprecated("a", "Deploy", "context/deploy.md", 1, "z")],
        &[],
        &["claude"],
    );
    // role defaults to "rule" via node_deprecated → node(); rebuild with role command.
    let mut v: Value = serde_json::from_str(&g).unwrap();
    v["nodes"][0]["role"] = json!("command");
    let p = preview(&dir, &v.to_string());
    assert!(p.errors.is_empty());
    assert!(find_file(&p, ".claude/commands/deploy.md").is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn agent_context_block_skips_deprecated_target_and_deprecated_agent() {
    let dir = temp_project("deprecated-agent-block");
    touch(&dir.join(".claude/agents/lead.md"), "---\nname: lead\n---\n\nBody.\n");
    touch(&dir.join("context/old.md"), "old\n");
    let g = graph_json(
        "P",
        &[
            node_role("agent1", "lead", ".claude/agents/lead.md", 1, false, "agent"),
            node_deprecated("old", "Old", "context/old.md", 2, "z"),
        ],
        &[edge("e1", "agent1", "old", "imports")],
        &[],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    assert!(find_file(&p, ".claude/agents/lead.md").is_none(), "no target left ⇒ nothing to write");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn emit_cursor_and_emit_commands_use_separate_stem_counters() {
    // F9: two DIFFERENT nodes sharing the file stem "x" — one command-role
    // (commands emitter only), one root-always rule-role with cursor also
    // requested (cursor emitter only). If the counters were shared, the
    // second node's `.mdc` would incorrectly become "x-2.mdc".
    let dir = temp_project("separate-counters");
    touch(&dir.join("context/x.md"), "first\n");
    touch(&dir.join("other/x.md"), "second\n");
    let g = graph_json(
        "P",
        &[
            node_role("a", "First", "context/x.md", 1, false, "command"),
            node("b", "Second", "other/x.md", 2, true),
        ],
        &[],
        &["claude", "cursor"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty(), "{:?}", p.errors);
    assert!(find_file(&p, ".claude/commands/x.md").is_some());
    assert!(find_file(&p, ".cursor/rules/x.mdc").is_some(), "must NOT be renumbered to x-2.mdc");
    assert!(find_file(&p, ".cursor/rules/x-2.mdc").is_none());
    assert!(find_file(&p, ".claude/commands/x-2.md").is_none());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn emit_cursor_ignores_role_lock_command_and_skill_still_get_mdc() {
    // F11 / §8.3: emit_cursor calls resolve_load_ignoring_role_lock, so a
    // root-always command/skill node still gets alwaysApply: true, exactly
    // as it would have before Amendment 1.
    let dir = temp_project("cursor-ignore-role-lock");
    touch(&dir.join("context/cmd.md"), "cmd body\n");
    touch(&dir.join("context/skill.md"), "skill body\n");
    let g = graph_json(
        "P",
        &[
            node_role("c", "Cmd", "context/cmd.md", 1, true, "command"),
            node_role("s", "Skill", "context/skill.md", 2, true, "skill"),
        ],
        &[],
        &["cursor"],
    );
    let p = preview(&dir, &g);
    assert!(p.errors.is_empty());
    let cmd = find_file(&p, ".cursor/rules/cmd.mdc").unwrap();
    assert!(cmd.new_content.contains("alwaysApply: true"));
    let skill = find_file(&p, ".cursor/rules/skill.mdc").unwrap();
    assert!(skill.new_content.contains("alwaysApply: true"));
    let _ = fs::remove_dir_all(&dir);
}

// ── overlay (§10.1) ──────────────────────────────────────────────────────

#[test]
fn overlay_makes_a_draft_node_previewable() {
    let dir = temp_project("overlay-missing");
    let g = graph_json("P", &[node("a", "A", "context/draft.md", 1, true)], &[], &["claude"]);
    // No file on disk at all.
    let p_no_overlay = preview(&dir, &g);
    assert_eq!(p_no_overlay.errors.len(), 1);

    let p = preview_overlay(&dir, &g, vec![approved("context/draft.md", "draft body\n")]);
    assert!(p.errors.is_empty(), "{:?}", p.errors);
    assert!(p.files[0].new_content.contains("@context/draft.md"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overlay_never_affects_old_content_or_unchanged() {
    let dir = temp_project("overlay-old-content");
    touch(&dir.join("context/a.md"), "a\n");
    touch(&dir.join("CLAUDE.md"), "hand-written\n");
    let g = graph_json("P", &[node("a", "A", "context/a.md", 1, true)], &[], &["claude"]);
    let p = preview_overlay(&dir, &g, vec![approved("CLAUDE.md", "SHOULD NOT BE SEEN")]);
    assert!(p.errors.is_empty());
    assert_eq!(p.files[0].old_content.as_deref(), Some("hand-written\n"));
    assert!(p.files[0].handwritten);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn overlay_feeds_cursor_and_commands_body() {
    let dir = temp_project("overlay-body");
    // No files on disk — both the cursor `.mdc` body and the command file
    // body must come entirely from the overlay.
    let g = graph_json(
        "P",
        &[
            node("a", "A", "context/a.md", 1, true),
            node_role("c", "C", "context/c.md", 2, false, "command"),
        ],
        &[],
        &["claude", "cursor"],
    );
    let p = preview_overlay(
        &dir,
        &g,
        vec![approved("context/a.md", "overlay a body\n"), approved("context/c.md", "overlay c body\n")],
    );
    assert!(p.errors.is_empty(), "{:?}", p.errors);
    assert!(find_file(&p, ".cursor/rules/a.mdc").unwrap().new_content.contains("overlay a body"));
    assert!(find_file(&p, ".claude/commands/c.md").unwrap().new_content.contains("overlay c body"));
    let _ = fs::remove_dir_all(&dir);
}

// ── §18.1 THE NON-NEGOTIABLE GATE (owner: R1) ───────────────────────────
//
// Rebuilt per audit D1 + D2 (2026-08-21). D1: the previous version was
// `assert!(content.contains(...))` spot-checks, not the diff the contract's
// procedure requires — four of five file families were never touched by any
// assertion, "nothing is removed" was never asserted at all, and Part B row
// 5 was vacuous by the test's own admission. D2: the enumeration was also
// missing a sixth row (a pinned `command` unguarded-imports a plain node —
// that node loses its `@path` line, same as any row-1 case, but neither
// fixture could exercise it because no pinned `command`/`skill` node had an
// outgoing unguarded `imports` edge). Both are fixed together:
//
// - `tests/fixtures/compiled_baseline_v4_in.json` and
//   `..._v4_rule1_in.json` are the REAL pre-WO13 compiler's output,
//   generated once via an isolated `git worktree add --detach 605760e`
//   (the WO03 commit — the last one to touch `compile.rs` before this
//   session; `git show HEAD:src-tauri/src/compile.rs` at session start was
//   byte-identical to it) — never a hand-traced guess. The worktree ran a
//   throwaway `baseline_dump` bin calling the OLD 2-arg `compile_preview`
//   against the CURRENT fixture files (`graph_v4_in.json`,
//   `graph_v4_rule1_in.json` — the latter already carrying D2's row-6
//   nodes, r06/r07, at generation time) and dumped `{relPath: content}` to
//   stdout. The worktree was removed immediately after; nothing in the
//   shared tree was touched to produce these baselines.
// - Every test below computes the FULL file-set diff (added / removed /
//   changed, by content byte-equality) between that baseline and this
//   (post-WO13) compiler's output on the SAME fixture, migrated, and
//   asserts the diff equals the enumerated exception set exactly — nothing
//   outside it is tolerated, "removed" is asserted to be empty explicitly,
//   and "byte-identical" is verified for the whole file, not a substring.

/// A→B file-set diff over `{relPath: content}` maps, by content equality.
/// Sorted for deterministic assertion failure messages.
#[derive(Debug, PartialEq)]
struct FileSetDiff {
    /// Present in `after`, absent from `before`.
    added: Vec<String>,
    /// Present in `before`, absent from `after`.
    removed: Vec<String>,
    /// Present in both, content differs.
    changed: Vec<String>,
}

fn diff_file_sets(
    before: &BTreeMap<String, String>,
    after: &BTreeMap<String, String>,
) -> FileSetDiff {
    let mut added = Vec::new();
    let mut changed = Vec::new();
    for (path, content) in after {
        match before.get(path) {
            None => added.push(path.clone()),
            Some(old) if old != content => changed.push(path.clone()),
            _ => {}
        }
    }
    let mut removed: Vec<String> =
        before.keys().filter(|p| !after.contains_key(*p)).cloned().collect();
    added.sort();
    removed.sort();
    changed.sort();
    FileSetDiff { added, removed, changed }
}

fn migrate_v4_json(raw: &str) -> String {
    let g = crate::project::migrate_graph(raw).expect("valid v4 fixture must migrate to v5");
    crate::project::serialize_graph(&g)
}

fn touch_all_nodes(dir: &Path, graph_value: &Value) {
    for n in graph_value["nodes"].as_array().unwrap() {
        let rel = n["filePath"].as_str().unwrap();
        let id = n["id"].as_str().unwrap();
        touch(&dir.join(rel), &format!("{id} body\n$ARGUMENTS\n"));
    }
}

/// Compile `graph_json` and return every produced file as `{relPath:
/// content}` — the shape the frozen baselines are stored in.
fn compile_all(dir: &Path, graph_json: &str) -> BTreeMap<String, String> {
    let p = preview(dir, graph_json);
    assert!(p.errors.is_empty(), "{:?}", p.errors);
    p.files.into_iter().map(|f| (f.rel_path, f.new_content)).collect()
}

/// The lines strictly inside a `## Always read` section (heading and
/// framing blanks excluded) — used to prove row 1's *"every other line
/// unchanged and in the same order"*, which a whole-file diff cannot by
/// itself (it can only say the file changed, not how).
fn always_read_section(content: &str) -> Vec<&str> {
    let lines: Vec<&str> = content.lines().collect();
    let Some(start) = lines.iter().position(|l| *l == "## Always read") else {
        return Vec::new();
    };
    let end = lines[start + 1..]
        .iter()
        .position(|l| l.starts_with("## "))
        .map(|i| start + 1 + i)
        .unwrap_or(lines.len());
    lines[start + 1..end]
        .iter()
        .copied()
        .filter(|l| !l.is_empty())
        .collect()
}

const FIXTURE_V4_IN: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/graph_v4_in.json"));
const FIXTURE_V4_RULE1_IN: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tests/fixtures/graph_v4_rule1_in.json"));
/// The REAL pre-WO13 compiler's output on `FIXTURE_V4_IN` (all five
/// targets) — see the module-doc note above for provenance.
const BASELINE_V4_IN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/compiled_baseline_v4_in.json"
));
/// The REAL pre-WO13 compiler's output on `FIXTURE_V4_RULE1_IN`
/// (`claude`+`cursor`, the fixture's own targets), generated AFTER D2's
/// row-6 nodes (`r06-x`/`r07-x`) were added to the fixture.
const BASELINE_V4_RULE1_IN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/fixtures/compiled_baseline_v4_rule1_in.json"
));

fn load_baseline(json: &str) -> BTreeMap<String, String> {
    serde_json::from_str(json).expect("baseline fixture must be a flat {relPath: content} map")
}

/// Asserts `after` equals `before` with exactly one line INSERTED
/// (`expected_line`), at whatever position, with every other line matching
/// at the same relative order — a byte-diff, not a substring probe.
fn assert_single_line_inserted(path: &str, before: &str, after: &str, expected_line: &str) {
    let before_lines: Vec<&str> = before.lines().collect();
    let after_lines: Vec<&str> = after.lines().collect();
    assert_eq!(
        after_lines.len(),
        before_lines.len() + 1,
        "{path}: expected exactly one inserted line"
    );
    let mut bi = 0;
    let mut inserted = false;
    for aline in &after_lines {
        if bi < before_lines.len() && *aline == before_lines[bi] {
            bi += 1;
        } else {
            assert!(!inserted, "{path}: more than one line differs from the baseline");
            assert_eq!(*aline, expected_line, "{path}: the one inserted line has the wrong text");
            inserted = true;
        }
    }
    assert!(inserted, "{path}: no inserted line found");
    assert_eq!(bi, before_lines.len(), "{path}: every baseline line must still appear, in order");
}

#[test]
fn wo13_gate_part_a_full_diff_equals_one_new_command_file_plus_one_documented_gap() {
    let dir = temp_project("wo13-gate-a");
    let v4: Value = serde_json::from_str(FIXTURE_V4_IN).unwrap();
    touch_all_nodes(&dir, &v4);

    let migrated = migrate_v4_json(FIXTURE_V4_IN);
    let mut g: Value = serde_json::from_str(&migrated).unwrap();
    g["compileTargets"] = json!(["claude", "agents", "cursor", "copilot", "gemini"]);
    let after = compile_all(&dir, &g.to_string());
    let before = load_baseline(BASELINE_V4_IN);

    let diff = diff_file_sets(&before, &after);

    // FOUND BY THIS REBUILT GATE, NOT PREDICTED (fix-round report, D1
    // follow-up): `graph_v4_in.json`'s own `e06-x`
    // (`n09-x --overrides--> n02-x`) is co-resident after migration (both
    // root-always) — §10.4/E-C's precedence marker fires. That is CORRECT,
    // NEW WO13 behaviour, but it is ENTIRELY ORTHOGONAL to Amendment 1's
    // rule 1, which is the only thing §18.1 Part A's prose accounts for
    // ("its command node and skill node are both unpinned and neither is a
    // glob target, so [the four root files] are byte-identical"). That
    // prose predates E-C landing in this exact shape and does not mention
    // `e06-x`'s co-residency at all — a genuine §18.1 gap this diff-based
    // gate surfaces that the old spot-check version could not (it never
    // read the whole file, only specific substrings). Reported to
    // tech-lead rather than silently absorbed; asserted here PRECISELY so
    // the assertion still fails the moment anything ELSE about these four
    // files changes.
    let precedence_marker = "<!-- cowtext:precedence -->Takes precedence over \"House rules\" below.";
    let root_files_gaining_the_marker = [
        "CLAUDE.md".to_string(),
        "AGENTS.md".to_string(),
        ".github/copilot-instructions.md".to_string(),
        "GEMINI.md".to_string(),
    ];
    let mut expected_changed = root_files_gaining_the_marker.to_vec();
    expected_changed.sort();

    assert_eq!(
        diff,
        FileSetDiff {
            added: vec![".claude/commands/run-the-suite.md".to_string()],
            removed: Vec::new(),
            changed: expected_changed,
        },
        "Part A's full diff must equal exactly: one new command file, plus the documented \
         §10.4 precedence-marker gap on the four root files — nothing else"
    );
    for path in &root_files_gaining_the_marker {
        assert_single_line_inserted(path, &before[path], &after[path], precedence_marker);
    }
    // Every nested AGENTS.md and every .cursor/rules/*.mdc — the files
    // §10.4's marker never touches — remain in the untouched majority
    // proven byte-identical by `diff.changed` not naming them.
    for stem in ["house-rules", "system-shape", "api-voice", "timestamps-utc"] {
        let path = format!(".cursor/rules/{stem}.mdc");
        assert!(before.contains_key(&path) && after.contains_key(&path), "missing {path}");
    }
    assert!(before.contains_key("src/api/AGENTS.md") && after.contains_key("src/api/AGENTS.md"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn wo13_gate_part_b_full_diff_equals_exactly_the_six_enumerated_rows() {
    let dir = temp_project("wo13-gate-b");
    let v4: Value = serde_json::from_str(FIXTURE_V4_RULE1_IN).unwrap();
    touch_all_nodes(&dir, &v4);

    let migrated = migrate_v4_json(FIXTURE_V4_RULE1_IN);
    let after = compile_all(&dir, &migrated);
    let before = load_baseline(BASELINE_V4_RULE1_IN);

    let diff = diff_file_sets(&before, &after);
    // Row 2: a NEW command file for every command node, regardless of
    // edges or prior pinned state — r02 (was pinned), r04 (glob target),
    // r05 (orphan), r06 (row 6, was pinned + had an outgoing unguarded
    // import). Row 3: no file anywhere for r03 (skill) — absent from
    // `added` by construction. Nothing is ever REMOVED (F11: every `.mdc`
    // survives via ignore-mode) — the only CHANGED file is CLAUDE.md,
    // whose content difference is asserted precisely below (row 1 + row 4).
    assert_eq!(
        diff,
        FileSetDiff {
            added: vec![
                ".claude/commands/r02-ship-it.md".to_string(),
                ".claude/commands/r04-regen-client.md".to_string(),
                ".claude/commands/r05-rotate-key.md".to_string(),
                ".claude/commands/r06-cut-release.md".to_string(),
            ],
            removed: Vec::new(),
            changed: vec!["CLAUDE.md".to_string()],
        },
        "Part B's full diff must equal exactly rows 2+3+5 at the file-set level"
    );

    // Row 1 (+ row 6): the "## Always read" section loses EXACTLY r02
    // (command), r03 (skill), r06 (command) and r07 (row 6 — reachable
    // pre-WO13 only via r06's now-excluded closure membership), with every
    // other line unchanged and in the same relative order — proven by
    // showing `after` is `before` with exactly those four lines deleted,
    // not merely that they're individually absent.
    let before_always = always_read_section(&before["CLAUDE.md"]);
    let after_always = always_read_section(&after["CLAUDE.md"]);
    let removed_lines: Vec<&str> = before_always
        .iter()
        .filter(|l| !after_always.contains(l))
        .copied()
        .collect();
    let mut removed_sorted = removed_lines.clone();
    removed_sorted.sort_unstable();
    assert_eq!(
        removed_sorted,
        vec![
            "@context/r02-ship-it.md",
            "@context/r03-bisecting.md",
            "@context/r06-cut-release.md",
            "@context/r07-release-checklist.md",
        ],
        "row 1/6 must remove exactly this SET of four lines (order asserted separately below — \
         r07 legitimately precedes r06 in total_order: an unguarded `imports` edge is \
         target-before-source, same as every other imports edge in this compiler)"
    );
    // Reconstructing `before_always` with exactly those lines deleted must
    // reproduce `after_always` verbatim — proves order + every other line.
    let reconstructed: Vec<&str> =
        before_always.iter().filter(|l| !removed_lines.contains(l)).copied().collect();
    assert_eq!(reconstructed, after_always, "order of every remaining line must be preserved");

    // Row 4: edge-driven bullets unchanged — the glob bullet for r04 and
    // the references bullet naming r03 both still render (rule 1 never
    // suppresses an edge-driven bullet).
    assert!(after["CLAUDE.md"]
        .contains("- When touching `src/api/**`, read @context/r04-regen-client.md."));
    assert!(after["CLAUDE.md"]
        .contains("- When working on **House rules**, read @context/r03-bisecting.md."));

    // Every `.cursor/rules/*.mdc` is asserted byte-identical to the
    // baseline by the top-level `changed`/`removed` assertion above (F11) —
    // explicit spot confirmation that they're the RIGHT six files, not a
    // coincidentally-empty set.
    for stem in ["r01-house-rules", "r02-ship-it", "r03-bisecting", "r04-regen-client", "r06-cut-release", "r07-release-checklist"] {
        let path = format!(".cursor/rules/{stem}.mdc");
        assert!(before.contains_key(&path) && after.contains_key(&path), "missing {path}");
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn wo13_gate_part_c_deprecation_isolated_from_every_other_variable() {
    // Redesigned per D1: rather than compare against a THIRD pre-WO13
    // baseline (a graph that never existed pre-WO13 in this exact shape),
    // isolate `deprecated` as the sole variable by compiling the SAME v5
    // graph, with THIS (post-WO13) compiler, twice — once as migration
    // actually produces it (n12-x deprecated via the supersedes edge) and
    // once with `deprecated` stripped back off — and diff those two
    // outputs directly. This proves deprecation's effect in isolation
    // (holding the compiler version, the schema and every other node
    // constant) rather than conflating it with the v4→v5 migration itself.
    let dir = temp_project("wo13-gate-c");
    let v4: Value = serde_json::from_str(FIXTURE_V4_IN).unwrap();
    touch_all_nodes(&dir, &v4);

    let migrated = migrate_v4_json(FIXTURE_V4_IN);
    let mut deprecated_g: Value = serde_json::from_str(&migrated).unwrap();
    deprecated_g["compileTargets"] = json!(["claude", "cursor"]);
    let mut not_deprecated_g = deprecated_g.clone();
    for n in not_deprecated_g["nodes"].as_array_mut().unwrap() {
        if n["id"] == "n12-x" {
            n.as_object_mut().unwrap().remove("deprecated");
            n.as_object_mut().unwrap().remove("needsReview");
            // n12-x carries no rootLoad in the fixture; force it "always"
            // so removing `deprecated` actually changes something to diff
            // against — otherwise this test would vacuously pass.
            n["rootLoad"] = json!("always");
        }
    }
    // Mirror the same rootLoad onto the deprecated variant so `rootLoad` is
    // NOT part of what's being isolated — only `deprecated`'s presence is.
    for n in deprecated_g["nodes"].as_array_mut().unwrap() {
        if n["id"] == "n12-x" {
            n["rootLoad"] = json!("always");
        }
    }

    let with_deprecated = compile_all(&dir, &deprecated_g.to_string());
    let without_deprecated = compile_all(&dir, &not_deprecated_g.to_string());

    let diff = diff_file_sets(&with_deprecated, &without_deprecated);
    // Going from deprecated -> not-deprecated must ADD n12's `.mdc` and
    // CHANGE the root files that gain its `@path` line; nothing else in
    // the whole produced file set may move, and nothing may be REMOVED.
    assert_eq!(diff.removed, Vec::<String>::new(), "removing `deprecated` must never delete a file");
    assert_eq!(
        diff.added,
        vec![".cursor/rules/old-error-handler.mdc".to_string()],
        "removing `deprecated` must add exactly n12's own .mdc"
    );
    assert_eq!(
        diff.changed,
        vec!["CLAUDE.md".to_string()],
        "removing `deprecated` must change only the root file gaining n12's line"
    );
    assert!(!with_deprecated["CLAUDE.md"].contains("old-error-handler"));
    assert!(without_deprecated["CLAUDE.md"].contains("@context/old-error-handler.md"));

    let _ = fs::remove_dir_all(&dir);
}

// ── D10 (audit) — the production projection, not the resolve_load test's ──
// ── own parser, must agree with the shared corpus ──────────────────────

/// Pushes every case in `tests/fixtures/resolve_load_cases.json` through
/// THIS module's real `GraphIn`/`NodeIn`/`EdgeIn` deserializer and the real
/// `to_load_facts` projection — the exact code path `compile_preview` uses
/// — rather than `resolve_load/tests.rs`'s own hand-rolled JSON reader.
/// Audit D10(b): "a slip mapping `overrides` → `Imports` in [this
/// projection] would change compiled output and pass the whole corpus
/// green" (because the corpus's OWN test only ever exercised its own
/// parser). This test closes that gap for `compile.rs`'s copy specifically;
/// `taskctx.rs`'s and `lint.rs`'s projections are R3's/R2's own zones and
/// need the equivalent test in their own test files.
#[test]
fn production_projection_matches_resolve_load_corpus() {
    const FIXTURE: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../tests/fixtures/resolve_load_cases.json"
    ));
    let doc: Value = serde_json::from_str(FIXTURE).expect("valid fixture JSON");
    let cases = doc["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty());

    for case in cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>");
        let mode = case["mode"].as_str().unwrap_or("apply");
        let graph_json = case["graph"].to_string();
        let graph: GraphIn =
            serde_json::from_str(&graph_json).unwrap_or_else(|e| panic!("case '{name}': {e}"));

        let id_to_idx: HashMap<&str, usize> = graph
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect();
        // Same dangling-edge exclusion `compile_preview` performs before
        // ever building `live_edges` — the c15 dangling-edge case is
        // therefore exercised at COMPILE.RS's own boundary too, not only
        // resolve_load's internal one.
        let live_edges: Vec<&EdgeIn> = graph
            .edges
            .iter()
            .filter(|e| id_to_idx.contains_key(e.source.as_str()) && id_to_idx.contains_key(e.target.as_str()))
            .collect();

        let (node_facts, edge_facts) = to_load_facts(&graph.nodes, &live_edges);

        let expected = case["expected"].as_object().expect("expected object");
        for (node_id, exp) in expected {
            let got = match mode {
                "apply" => resolve_load::resolve_load(node_id, &node_facts, &edge_facts),
                "ignore" => {
                    resolve_load::resolve_load_ignoring_role_lock(node_id, &node_facts, &edge_facts)
                }
                other => panic!("case '{name}': unknown mode '{other}'"),
            };
            let exp_policy = exp["policy"].as_str().unwrap();
            let exp_reason = exp["reason"].as_str().unwrap();
            let exp_edge = exp.get("decidingEdgeId").and_then(Value::as_str);
            let got_policy = serde_json::to_value(got.policy).unwrap();
            let got_reason = serde_json::to_value(got.reason).unwrap();
            assert_eq!(
                got_policy.as_str().unwrap(),
                exp_policy,
                "case '{name}', node '{node_id}': policy mismatch via compile.rs's OWN projection (reason was {got_reason:?})"
            );
            assert_eq!(
                got_reason.as_str().unwrap(),
                exp_reason,
                "case '{name}', node '{node_id}': reason mismatch via compile.rs's OWN projection"
            );
            assert_eq!(
                got.deciding_edge_id.as_deref(),
                exp_edge,
                "case '{name}', node '{node_id}': decidingEdgeId mismatch via compile.rs's OWN projection"
            );
        }
    }
}
