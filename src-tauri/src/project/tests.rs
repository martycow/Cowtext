use super::*;

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

    let scan = scan_project(dir.to_string_lossy().into_owned()).unwrap();
    let paths: Vec<&str> = scan.files.iter().map(|f| f.rel_path.as_str()).collect();
    assert_eq!(paths, ["README.md", "docs/deep/notes.md", "docs/plan.MD"]);
    assert!(scan.files.iter().all(|f| f.size_bytes > 0));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_non_directory() {
    assert!(scan_project("Z:/definitely/not/a/dir".into()).is_err());
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