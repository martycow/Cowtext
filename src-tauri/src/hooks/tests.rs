use super::*;
use serde_json::Value;
use std::path::PathBuf;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-hooks-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn parsed(content: &str) -> Value {
    serde_json::from_str(content).unwrap()
}

/// All three events present, each with exactly one Cowtext command entry.
fn assert_fully_installed(v: &Value) {
    for (event, matcher) in HOOK_EVENTS {
        let arr = v["hooks"][event].as_array().unwrap_or_else(|| {
            panic!("hooks.{event} missing or not an array");
        });
        let ours: Vec<&Value> = arr
            .iter()
            .filter(|e| e.to_string().contains(HOOK_MARKER))
            .collect();
        assert_eq!(ours.len(), 1, "expected exactly one Cowtext entry in {event}");
        let entry = ours[0];
        assert_eq!(
            entry["hooks"][0]["command"].as_str().unwrap(),
            HOOK_COMMAND
        );
        assert_eq!(entry["hooks"][0]["type"].as_str().unwrap(), "command");
        match matcher {
            Some(m) => assert_eq!(entry["matcher"].as_str().unwrap(), m),
            None => assert!(entry.get("matcher").is_none()),
        }
    }
}

#[test]
fn merge_into_absent_file_installs_all_three_events() {
    let out = merge_hooks(None).unwrap();
    assert!(out.ends_with('\n'));
    assert_fully_installed(&parsed(&out));
}

#[test]
fn merge_preserves_unrelated_keys_and_foreign_hooks() {
    let existing = r#"{
        "permissions": { "allow": ["Bash(npm:*)"] },
        "env": { "FOO": "bar" },
        "hooks": {
            "PostToolUse": [{ "matcher": "Bash",
                "hooks": [{ "type": "command", "command": "echo other-tool" }] }]
        }
    }"#;
    let out = merge_hooks(Some(existing)).unwrap();
    let v = parsed(&out);
    assert_fully_installed(&v);
    // Unrelated keys survive.
    assert_eq!(v["permissions"]["allow"][0].as_str().unwrap(), "Bash(npm:*)");
    assert_eq!(v["env"]["FOO"].as_str().unwrap(), "bar");
    // The foreign PostToolUse entry survives alongside ours.
    let post = v["hooks"]["PostToolUse"].as_array().unwrap();
    assert_eq!(post.len(), 2);
    assert!(post[0].to_string().contains("echo other-tool"));
}

#[test]
fn merge_is_idempotent_and_returns_existing_bytes_verbatim() {
    let first = merge_hooks(None).unwrap();
    let second = merge_hooks(Some(&first)).unwrap();
    assert_eq!(first, second);

    // Even oddly formatted but fully installed content comes back verbatim.
    let compact = parsed(&first).to_string();
    let out = merge_hooks(Some(&compact)).unwrap();
    assert_eq!(out, compact);
}

#[test]
fn merge_rejects_invalid_json() {
    let err = merge_hooks(Some("{ nope")).unwrap_err();
    assert!(err.starts_with("settings.json is not valid JSON: "));
}

#[test]
fn merge_rejects_non_object_top_level() {
    let err = merge_hooks(Some("[1, 2]")).unwrap_err();
    assert!(err.contains("not an object"));
}

#[test]
fn merge_never_clobbers_malformed_hooks_shapes() {
    let err = merge_hooks(Some(r#"{ "hooks": "yes please" }"#)).unwrap_err();
    assert!(err.contains("refusing to overwrite"));
    let err = merge_hooks(Some(r#"{ "hooks": { "Stop": {} } }"#)).unwrap_err();
    assert!(err.contains("hooks.Stop"));
}

#[test]
fn preview_of_empty_project_has_no_old_content() {
    let dir = temp_project("preview");
    let p = hooks_preview(dir.to_string_lossy().into_owned()).unwrap();
    assert_eq!(p.rel_path, ".claude/settings.json");
    assert!(p.old_content.is_none());
    assert!(!p.unchanged);
    assert_fully_installed(&parsed(&p.new_content));
}

#[test]
fn write_then_preview_reports_unchanged() {
    let dir = temp_project("roundtrip");
    let root = dir.to_string_lossy().into_owned();
    let first = hooks_preview(root.clone()).unwrap();
    hooks_write(root.clone(), first.new_content.clone()).unwrap();
    assert!(dir.join(".claude/settings.json").is_file());

    let second = hooks_preview(root).unwrap();
    assert_eq!(second.old_content.as_deref(), Some(first.new_content.as_str()));
    assert_eq!(second.new_content, first.new_content);
    assert!(second.unchanged);
}

#[test]
fn hooks_write_rejects_invalid_or_non_object_json() {
    let dir = temp_project("guard");
    let root = dir.to_string_lossy().into_owned();
    let err = hooks_write(root.clone(), "{ nope".to_string()).unwrap_err();
    assert_eq!(err, "Refusing to write invalid JSON");
    let err = hooks_write(root, "[]".to_string()).unwrap_err();
    assert_eq!(err, "Refusing to write invalid JSON");
    assert!(!dir.join(".claude/settings.json").exists());
}

#[test]
fn hooks_write_rejects_bad_root() {
    let err = hooks_write("Z:/no/such/dir".to_string(), "{}".to_string()).unwrap_err();
    assert!(err.starts_with("Not a directory: "));
}

#[test]
fn status_absent_file() {
    let dir = temp_project("status-absent");
    let status = hooks_status(dir.to_string_lossy().into_owned()).unwrap();
    assert!(!status.installed);
    assert!(!status.file_exists);
    assert!(status.readable);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn status_fully_installed() {
    let dir = temp_project("status-full");
    let root = dir.to_string_lossy().into_owned();
    let preview = hooks_preview(root.clone()).unwrap();
    hooks_write(root.clone(), preview.new_content).unwrap();

    let status = hooks_status(root).unwrap();
    assert!(status.installed);
    assert!(status.file_exists);
    assert!(status.readable);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn status_partially_installed() {
    let dir = temp_project("status-partial");
    let root = dir.to_string_lossy().into_owned();
    let content = format!(
        r#"{{ "hooks": {{ "PostToolUse": [{{ "matcher": "{POST_TOOL_USE_MATCHER}",
            "hooks": [{{ "type": "command", "command": "{HOOK_COMMAND}" }}] }}] }} }}"#
    );
    std::fs::create_dir_all(dir.join(".claude")).unwrap();
    std::fs::write(dir.join(".claude/settings.json"), content).unwrap();

    let status = hooks_status(root).unwrap();
    assert!(!status.installed);
    assert!(status.file_exists);
    assert!(status.readable);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn status_unparsable() {
    let dir = temp_project("status-bad-json");
    let root = dir.to_string_lossy().into_owned();
    std::fs::create_dir_all(dir.join(".claude")).unwrap();
    std::fs::write(dir.join(".claude/settings.json"), "{ nope").unwrap();

    let status = hooks_status(root.clone()).unwrap();
    assert!(!status.installed);
    assert!(status.file_exists);
    assert!(!status.readable);

    // Top-level not an object also counts as unreadable.
    std::fs::write(dir.join(".claude/settings.json"), "[1, 2]").unwrap();
    let status = hooks_status(root.clone()).unwrap();
    assert!(!status.readable);

    // `hooks` present but not an object.
    std::fs::write(
        dir.join(".claude/settings.json"),
        r#"{ "hooks": "nope" }"#,
    )
    .unwrap();
    let status = hooks_status(root).unwrap();
    assert!(!status.readable);

    let _ = std::fs::remove_dir_all(&dir);
}
