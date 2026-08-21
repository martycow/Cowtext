use super::*;
use serde_json::json;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-preset-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A structurally valid preset with `n` nodes.
fn preset_json(name: &str, n: usize) -> String {
    let nodes: Vec<serde_json::Value> = (0..n)
        .map(|i| {
            json!({
                "id": format!("n{i}"),
                "title": format!("Node {i}"),
                "role": "reference",
                "brief": "",
                "filePath": format!("context/node-{i}.md"),
                "readOrder": i + 1,
                "pinned": false,
                "position": { "x": 0, "y": 0 }
            })
        })
        .collect();
    format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "version": 1,
            "kind": "cowtext-preset",
            "name": name,
            "savedAt": "2026-08-17T12:00:00Z",
            "nodes": nodes,
            "edges": [],
            "compileTargets": ["claude"]
        }))
        .unwrap()
    )
}

// ── slugify ───────────────────────────────────────────────────────────

#[test]
fn slugify_normalizes_names() {
    assert_eq!(slugify("Cedar default").unwrap(), "cedar-default");
    assert_eq!(slugify("  A  B__C--D  ").unwrap(), "a-b-c-d");
    assert_eq!(slugify("Ünïcode! (v2)").unwrap(), "ncode-v2");
    assert_eq!(slugify("UPPER123").unwrap(), "upper123");
}

#[test]
fn slugify_rejects_empty_slugs() {
    assert!(slugify("").is_err());
    assert!(slugify("  --- !!! ").is_err());
}

// ── save / list / read ────────────────────────────────────────────────

#[test]
fn save_then_list_round_trip() {
    let dir = temp_dir("roundtrip");
    let path = save_inner(&dir, "Cedar Default", &preset_json("Cedar Default", 3)).unwrap();
    assert!(path.ends_with("cedar-default.cowtext-preset.json"));

    let list = list_inner(&dir).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Cedar Default");
    assert_eq!(list[0].node_count, 3);
    assert_eq!(list[0].saved_at, "2026-08-17T12:00:00Z");
    assert_eq!(list[0].path, path);
}

#[test]
fn save_stores_frontend_bytes_verbatim() {
    // Rust must never re-serialize a preset — the webview owns the shape
    // (and the shape excludes node content / lastVerified by construction).
    let dir = temp_dir("verbatim");
    let json = preset_json("Bytes", 1);
    let path = save_inner(&dir, "Bytes", &json).unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), json);
}

#[test]
fn save_and_read_reject_invalid_presets() {
    let dir = temp_dir("reject");
    // Wrong kind.
    let wrong_kind = preset_json("X", 0).replace("cowtext-preset", "not-a-preset");
    assert!(save_inner(&dir, "x", &wrong_kind)
        .unwrap_err()
        .contains("kind"));
    // Wrong version — 1..5 are all accepted (persona→agent role rename, the
    // WO03 v3 schema bump, the WO10 v4 edge-waypoints bump, then the WO13
    // v5 rootLoad/guard/deprecated bump), so this must be a version outside
    // that range.
    let wrong_version = preset_json("X", 0).replace("\"version\": 1", "\"version\": 6");
    assert!(save_inner(&dir, "x", &wrong_version)
        .unwrap_err()
        .contains("version"));
    // preset_read applies the same gate.
    let bad_path = dir.join("bad.cowtext-preset.json");
    std::fs::write(&bad_path, &wrong_kind).unwrap();
    assert!(preset_read(bad_path.to_string_lossy().into_owned()).is_err());
}

#[test]
fn save_and_read_accept_version_2_presets() {
    // v1 presets may still arrive from disk; v2 presets (post persona→agent
    // rename) must round-trip identically — bytes stored verbatim either way.
    let dir = temp_dir("v2");
    let v2 = preset_json("V2", 2).replace("\"version\": 1", "\"version\": 2");
    let path = save_inner(&dir, "V2", &v2).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), v2);
    assert_eq!(preset_read(path).unwrap(), v2);
    assert_eq!(list_inner(&dir).unwrap()[0].node_count, 2);
}

#[test]
fn save_and_read_accept_version_5_presets() {
    // WO13_CONTRACT.md §5.7: v5 presets (rootLoad/guard/deprecated/
    // needsReview, in lockstep with graph v5) must be accepted and stored
    // byte-verbatim, exactly like every earlier version — Rust never
    // inspects the node/edge shape beyond `kind`/`version`/`nodes`.
    let dir = temp_dir("v5");
    let v5 = preset_json("V5", 2)
        .replace("\"version\": 1", "\"version\": 5")
        .replacen(
            "\"pinned\": false",
            "\"rootLoad\": \"always\", \"needsReview\": true",
            1,
        );
    let path = save_inner(&dir, "V5", &v5).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), v5);
    assert_eq!(preset_read(path).unwrap(), v5);
    assert_eq!(list_inner(&dir).unwrap()[0].node_count, 2);
}

#[test]
fn preset_v2_is_accepted_and_a_v3_resave_round_trips_cleanly() {
    // WO03 §7: preset_read/preset_apply auto-upgrade a v2 preset
    // transparently (never reject it at the version gate) and a re-save at
    // the new version round-trips cleanly. Rust never re-serializes a
    // preset — the "auto-upgrade" the frontend performs is: read a v2
    // preset (this Rust gate must accept it, same as it always has), then
    // save the upgraded v3 shape (this Rust gate must also accept it, and
    // store/read it back byte-for-byte).
    let dir = temp_dir("v2-to-v3");

    let v2 = preset_json("Legacy", 2).replace("\"version\": 1", "\"version\": 2");
    let read_back = {
        let path = save_inner(&dir, "Legacy", &v2).unwrap();
        preset_read(path).unwrap()
    };
    assert_eq!(read_back, v2);

    // Simulate the frontend's upgrade: same structure, `version: 3`, one
    // v3-only node field present (`tags`) to prove v3 content — not just
    // the bare version number — passes the gate too.
    let v3 = preset_json("Legacy", 2)
        .replace("\"version\": 1", "\"version\": 3")
        .replacen("\"pinned\": false", "\"pinned\": false, \"tags\": [\"a\"]", 1);
    let path = save_inner(&dir, "Legacy", &v3).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), v3);
    assert_eq!(preset_read(path.clone()).unwrap(), v3);
    let list = list_inner(&dir).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].node_count, 2);
    assert_eq!(list[0].path, path);
}

#[test]
fn list_skips_invalid_files_and_tolerates_missing_dir() {
    let dir = temp_dir("skip");
    assert!(list_inner(&dir.join("does-not-exist")).unwrap().is_empty());

    save_inner(&dir, "Good", &preset_json("Good", 2)).unwrap();
    std::fs::write(dir.join("broken.cowtext-preset.json"), "{ nope").unwrap();
    std::fs::write(dir.join("not-a-preset.txt"), "ignored").unwrap();
    let list = list_inner(&dir).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Good");
}

// ── export ────────────────────────────────────────────────────────────

#[test]
fn export_appends_extension_when_missing() {
    let dir = temp_dir("export");
    let bare = dir.join("my-preset");
    preset_export(
        bare.to_string_lossy().into_owned(),
        preset_json("My preset", 1),
    )
    .unwrap();
    assert!(dir.join("my-preset.cowtext-preset.json").is_file());

    // Already-suffixed names are left alone.
    let full = dir.join("named.cowtext-preset.json");
    preset_export(full.to_string_lossy().into_owned(), preset_json("N", 1)).unwrap();
    assert!(full.is_file());
}

#[test]
fn export_refuses_overwriting_the_appended_target() {
    // The OS dialog's overwrite prompt covered only the literal typed name;
    // appending the extension must never silently clobber a different file.
    let dir = temp_dir("export-exists");
    let existing = dir.join("backup.cowtext-preset.json");
    std::fs::write(&existing, "original\n").unwrap();
    let err = preset_export(
        dir.join("backup").to_string_lossy().into_owned(),
        preset_json("B", 1),
    )
    .unwrap_err();
    assert!(err.contains("already exists"));
    assert_eq!(std::fs::read_to_string(existing).unwrap(), "original\n");
}

// ── apply ─────────────────────────────────────────────────────────────

fn stub(rel: &str) -> StubFile {
    StubFile {
        rel_path: rel.to_string(),
        content: "# Stub\n\n".to_string(),
    }
}

#[test]
fn apply_refuses_existing_graph() {
    let dir = temp_dir("guard");
    std::fs::create_dir_all(dir.join(".cowtext")).unwrap();
    std::fs::write(dir.join(".cowtext/graph.json"), "{}").unwrap();
    let err = preset_apply(
        dir.to_string_lossy().into_owned(),
        "{}\n".to_string(),
        vec![stub("context/a.md")],
    )
    .unwrap_err();
    assert!(err.contains("already has a graph"));
    // Never-clobber: the existing graph survives untouched.
    assert_eq!(
        std::fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap(),
        "{}"
    );
}

#[test]
fn apply_tolerates_an_empty_but_present_graph_json() {
    // Deleting a project's last node leaves graph.json with `nodes: []` on
    // disk while the UI still offers Apply — the guard must match the UI.
    let dir = temp_dir("empty-graph");
    std::fs::create_dir_all(dir.join(".cowtext")).unwrap();
    std::fs::write(
        dir.join(".cowtext/graph.json"),
        "{\"version\":1,\"nodes\":[],\"edges\":[]}\n",
    )
    .unwrap();
    let written = preset_apply(
        dir.to_string_lossy().into_owned(),
        "{\"version\":1}\n".to_string(),
        vec![stub("context/a.md")],
    )
    .unwrap();
    assert_eq!(written, vec!["context/a.md", ".cowtext/graph.json"]);
    assert_eq!(
        std::fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap(),
        "{\"version\":1}\n"
    );
}

#[test]
fn apply_stays_fail_closed_for_non_empty_or_unparseable_graphs() {
    let dir = temp_dir("nonempty-graph");
    std::fs::create_dir_all(dir.join(".cowtext")).unwrap();
    std::fs::write(dir.join(".cowtext/graph.json"), "{\"nodes\":[{\"id\":\"a\"}]}").unwrap();
    assert!(
        preset_apply(dir.to_string_lossy().into_owned(), "{}\n".to_string(), vec![])
            .unwrap_err()
            .contains("already has a graph")
    );

    let dir2 = temp_dir("bad-graph");
    std::fs::create_dir_all(dir2.join(".cowtext")).unwrap();
    std::fs::write(dir2.join(".cowtext/graph.json"), "{ nope").unwrap();
    assert!(
        preset_apply(dir2.to_string_lossy().into_owned(), "{}\n".to_string(), vec![])
            .unwrap_err()
            .contains("already has a graph")
    );
}

#[test]
fn apply_skips_existing_stubs_and_reports_only_written_paths() {
    let dir = temp_dir("skip-stub");
    std::fs::create_dir_all(dir.join("context")).unwrap();
    std::fs::write(dir.join("context/a.md"), "user content\n").unwrap();

    let written = preset_apply(
        dir.to_string_lossy().into_owned(),
        "{\"version\":1}\n".to_string(),
        vec![stub("context/a.md"), stub("context/b.md")],
    )
    .unwrap();
    assert_eq!(written, vec!["context/b.md", ".cowtext/graph.json"]);
    // The pre-existing file kept its bytes.
    assert_eq!(
        std::fs::read_to_string(dir.join("context/a.md")).unwrap(),
        "user content\n"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("context/b.md")).unwrap(),
        "# Stub\n\n"
    );
    assert!(dir.join(".cowtext/graph.json").is_file());
}

#[test]
fn apply_rejects_path_traversal_before_writing_anything() {
    let dir = temp_dir("traversal");
    let err = preset_apply(
        dir.to_string_lossy().into_owned(),
        "{}\n".to_string(),
        vec![stub("context/ok.md"), stub("../escape.md")],
    )
    .unwrap_err();
    assert!(err.contains("escapes project root"));
    // Validation happens before any write: no stub, no graph.
    assert!(!dir.join("context/ok.md").exists());
    assert!(!dir.join(".cowtext/graph.json").exists());
}

#[test]
fn apply_rejects_non_markdown_stub_and_stays_retryable() {
    let dir = temp_dir("non-md");
    let err = preset_apply(
        dir.to_string_lossy().into_owned(),
        "{}\n".to_string(),
        vec![stub("context/ok.md"), stub("context/evil.exe")],
    )
    .unwrap_err();
    assert!(err.contains("non-markdown"));
    assert!(!dir.join("context/ok.md").exists());
    assert!(!dir.join(".cowtext/graph.json").exists());
    // Retry with the bad stub removed succeeds.
    let written = preset_apply(
        dir.to_string_lossy().into_owned(),
        "{}\n".to_string(),
        vec![stub("context/ok.md")],
    )
    .unwrap();
    assert_eq!(written, vec!["context/ok.md", ".cowtext/graph.json"]);
}

#[test]
fn apply_writes_graph_bytes_verbatim() {
    let dir = temp_dir("graph-bytes");
    let graph = "{\n  \"version\": 1\n}\n".to_string();
    preset_apply(dir.to_string_lossy().into_owned(), graph.clone(), vec![]).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.join(".cowtext/graph.json")).unwrap(),
        graph
    );
}
