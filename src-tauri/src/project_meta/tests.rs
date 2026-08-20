use super::*;
use std::fs;
use std::path::PathBuf;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-projmeta-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn sample() -> ProjectMeta {
    ProjectMeta {
        name: "Cowtext".to_string(),
        brief: "A context compiler for AI coding agents.".to_string(),
        project_type: "app".to_string(),
        requirements: vec!["Compile to CLAUDE.md".to_string(), "  ".to_string()],
        hard_rules: vec!["Never write without a diff preview".to_string()],
        target_audience: "Solo developers".to_string(),
        architecture: "Tauri 2 + React".to_string(),
        constraints: vec!["Offline-first".to_string()],
    }
}

#[test]
fn serialize_is_deterministic_and_drops_blank_list_entries() {
    let a = serialize_meta(&sample());
    let b = serialize_meta(&sample());
    assert_eq!(a, b);
    assert!(a.ends_with('\n'));
    assert!(a.contains("\"version\": 1"));
    // The "  " entry is whitespace only and must not survive.
    assert_eq!(a.matches("Compile to CLAUDE.md").count(), 1);
    assert!(!a.contains("\"  \""));
}

#[test]
fn empty_optional_fields_are_omitted_entirely() {
    let bare = ProjectMeta {
        name: "Bare".to_string(),
        ..Default::default()
    };
    let s = serialize_meta(&bare);
    for key in [
        "requirements",
        "hardRules",
        "targetAudience",
        "architecture",
        "constraints",
    ] {
        assert!(!s.contains(key), "{key} should be omitted at default: {s}");
    }
    // Non-optional ones stay, so the file is always self-describing.
    assert!(s.contains("\"name\""));
    assert!(s.contains("\"brief\""));
}

#[test]
fn render_puts_hard_rules_above_the_softer_context() {
    let md = render_project_node(&sample());
    let rules = md.find("## Hard rules").expect("hard rules section");
    let audience = md.find("## Target audience").expect("audience section");
    assert!(rules < audience, "hard rules must come first:\n{md}");
    assert!(md.starts_with("# Cowtext\n"));
    assert!(md.contains("- Compile to CLAUDE.md"));
    // No GENERATED header: this node is the user's to edit.
    assert!(!md.contains("GENERATED"));
}

#[test]
fn render_of_an_empty_meta_is_still_valid_markdown() {
    let md = render_project_node(&ProjectMeta::default());
    assert_eq!(md, "# Project\n");
}

#[test]
fn read_returns_none_for_missing_corrupt_and_future_versions() {
    let dir = temp_dir("read");
    let root = dir.to_string_lossy().into_owned();

    // Missing.
    assert_eq!(project_meta_read(root.clone()).unwrap(), None);

    fs::create_dir_all(dir.join(".cowtext")).unwrap();
    let path = dir.join(PROJECT_META_REL_PATH);

    // Corrupt — must not stop a project from opening.
    fs::write(&path, "{not json").unwrap();
    assert_eq!(project_meta_read(root.clone()).unwrap(), None);

    // A version this build cannot understand.
    fs::write(&path, "{\"version\": 99, \"name\": \"X\"}").unwrap();
    assert_eq!(project_meta_read(root.clone()).unwrap(), None);

    // Valid.
    fs::write(&path, serialize_meta(&sample())).unwrap();
    let got = project_meta_read(root).unwrap().expect("valid meta reads");
    assert_eq!(got.name, "Cowtext");
    assert_eq!(got.requirements, vec!["Compile to CLAUDE.md".to_string()]);
}

#[test]
fn init_scaffolds_then_never_clobbers_the_rendered_node() {
    let dir = temp_dir("init");
    let root = dir.to_string_lossy().into_owned();

    let first = project_init(root.clone(), sample()).unwrap();
    assert!(first.written.contains(&PROJECT_META_REL_PATH.to_string()));
    assert!(first.written.contains(&PROJECT_NODE_REL_PATH.to_string()));
    assert!(first.skipped.is_empty());
    assert!(dir.join(".cowtext").is_dir());
    assert!(dir.join("context").is_dir());
    assert!(dir.join(".claude/agents").is_dir());

    // Hand-edit the rendered node, then re-run: the edit must survive.
    fs::write(dir.join(PROJECT_NODE_REL_PATH), "# Mine\n").unwrap();
    let second = project_init(root, sample()).unwrap();
    assert_eq!(second.skipped, vec![PROJECT_NODE_REL_PATH.to_string()]);
    assert_eq!(
        fs::read_to_string(dir.join(PROJECT_NODE_REL_PATH)).unwrap(),
        "# Mine\n"
    );
}

#[test]
fn write_refreshes_an_existing_node_and_does_not_create_a_missing_one() {
    let dir = temp_dir("write");
    let root = dir.to_string_lossy().into_owned();
    project_init(root.clone(), sample()).unwrap();

    let mut edited = sample();
    edited.brief = "Rewritten brief.".to_string();
    project_meta_write(root.clone(), edited.clone()).unwrap();
    let md = fs::read_to_string(dir.join(PROJECT_NODE_REL_PATH)).unwrap();
    assert!(md.contains("Rewritten brief."), "node must refresh: {md}");
    assert_eq!(
        project_meta_read(root.clone()).unwrap().unwrap().brief,
        "Rewritten brief."
    );

    // The user deleted the node — a property edit must not resurrect it.
    fs::remove_file(dir.join(PROJECT_NODE_REL_PATH)).unwrap();
    project_meta_write(root, edited).unwrap();
    assert!(!dir.join(PROJECT_NODE_REL_PATH).exists());
}

#[test]
fn is_cowtext_project_tracks_the_graph_file() {
    let dir = temp_dir("detect");
    assert!(!is_cowtext_project(&dir));
    fs::create_dir_all(dir.join(".cowtext")).unwrap();
    fs::write(dir.join(".cowtext/graph.json"), "{}").unwrap();
    assert!(is_cowtext_project(&dir));
}

#[test]
fn commands_reject_a_root_that_is_not_a_directory() {
    let dir = temp_dir("badroot");
    let file = dir.join("a-file.txt");
    fs::write(&file, "x").unwrap();
    let as_root = file.to_string_lossy().into_owned();
    assert!(project_meta_read(as_root.clone()).is_err());
    assert!(project_meta_write(as_root.clone(), sample()).is_err());
    assert!(project_init(as_root, sample()).is_err());
}

#[test]
fn init_reports_whether_the_folder_was_already_a_project() {
    let dir = temp_dir("already");
    let root = dir.to_string_lossy().into_owned();
    assert!(!project_init(root.clone(), sample()).unwrap().already_project);

    // A graph is what makes a folder a project; scaffolding alone is not.
    fs::create_dir_all(dir.join(".cowtext")).unwrap();
    fs::write(dir.join(".cowtext/graph.json"), "{}").unwrap();
    assert!(project_init(root, sample()).unwrap().already_project);
}
