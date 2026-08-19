use super::*;
use std::path::PathBuf;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-tasklinks-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn root_string(dir: &std::path::Path) -> String {
    dir.to_string_lossy().to_string()
}

fn link(task_id: &str) -> TaskLink {
    TaskLink {
        task_id: task_id.to_string(),
        ..Default::default()
    }
}

fn write_raw(dir: &std::path::Path, content: &str) {
    let path = dir.join(TASKLINKS_REL_PATH);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, content).unwrap();
}

fn read_raw(dir: &std::path::Path) -> String {
    std::fs::read_to_string(dir.join(TASKLINKS_REL_PATH)).unwrap()
}

// ── Stage-0 placeholder, kept ───────────────────────────────────────────

#[test]
fn tasklinks_module_compiles() {}

// ── Tolerant read (§3.2 L6) ─────────────────────────────────────────────

#[test]
fn read_missing_file_is_empty_not_an_error() {
    let dir = temp_project("missing");
    let doc = tasklinks_read(root_string(&dir)).expect("missing file must not error");
    assert_eq!(doc, TaskLinks { version: 1, links: vec![] });
}

#[test]
fn read_corrupt_json_degrades_to_empty() {
    let dir = temp_project("corrupt");
    write_raw(&dir, "{ this is not valid json at all");
    let doc = tasklinks_read(root_string(&dir)).expect("corrupt json must degrade, not error");
    assert_eq!(doc, TaskLinks { version: 1, links: vec![] });
}

#[test]
fn read_shape_mismatch_degrades_to_empty() {
    let dir = temp_project("shape-mismatch");
    // Valid JSON, supported version, but `links` is not an array.
    write_raw(&dir, r#"{"version":1,"links":"nope"}"#);
    let doc = tasklinks_read(root_string(&dir)).expect("shape mismatch must degrade, not error");
    assert_eq!(doc, TaskLinks { version: 1, links: vec![] });
}

#[test]
fn read_future_version_is_a_hard_error() {
    let dir = temp_project("future-version");
    write_raw(&dir, r#"{"version":2,"links":[]}"#);
    let err = tasklinks_read(root_string(&dir)).expect_err("version 2 must be rejected");
    assert!(err.contains('2'), "error should mention the offending version: {err}");
}

#[test]
fn unknown_fields_are_dropped_on_rewrite() {
    let dir = temp_project("unknown-fields");
    write_raw(
        &dir,
        r#"{"version":1,"links":[{"taskId":"t-aaaaaa","nodeIds":[],"sessionIds":[],"bogus":"field"}]}"#,
    );
    // A read alone doesn't touch disk; force a rewrite through the command.
    let doc = tasklink_set(root_string(&dir), link("t-aaaaaa")).unwrap();
    assert_eq!(doc.links.len(), 1);
    let raw = read_raw(&dir);
    assert!(!raw.contains("bogus"), "unknown field must not survive a rewrite:\n{raw}");
}

// ── Round-trip / determinism (§3.2 L2, Gate 7) ──────────────────────────

#[test]
fn round_trip_write_read_write_is_byte_identical() {
    let dir = temp_project("round-trip");
    tasklink_set(root_string(&dir), link("t-a1b2c3")).unwrap();
    let first = read_raw(&dir);

    // Reading and writing back the exact same document must not change a
    // single byte on disk.
    let doc = tasklinks_read(root_string(&dir)).unwrap();
    write_tasklinks(&dir, &doc).unwrap();
    let second = read_raw(&dir);

    assert_eq!(first, second);
}

#[test]
fn serialize_tasklinks_produces_deterministic_bytes() {
    let doc = TaskLinks {
        version: 1,
        links: vec![TaskLink {
            task_id: "t-a1b2c3".to_string(),
            node_ids: vec!["m2".to_string(), "m1".to_string()],
            session_ids: vec![],
            parent_task_id: None,
            token_ceiling: None,
        }],
    };
    let a = serialize_tasklinks(&doc);
    let b = serialize_tasklinks(&doc);
    assert_eq!(a, b);
    assert!(a.ends_with('\n') && !a.ends_with("\n\n"));
    assert!(!a.contains('\r'), "must be LF only");
    // nodeIds must have been sorted byte-order despite being given reversed.
    assert!(a.find("\"m1\"").unwrap() < a.find("\"m2\"").unwrap());
}

#[test]
fn node_ids_in_reverse_order_reserialize_sorted() {
    let dir = temp_project("reverse-order");
    write_raw(
        &dir,
        r#"{"version":1,"links":[{"taskId":"t-aaaaaa","nodeIds":["m2","m1"],"sessionIds":["s2","s1"]}]}"#,
    );
    let doc = tasklinks_read(root_string(&dir)).unwrap();
    assert_eq!(doc.links[0].node_ids, vec!["m1".to_string(), "m2".to_string()]);
    assert_eq!(doc.links[0].session_ids, vec!["s1".to_string(), "s2".to_string()]);
}

#[test]
fn node_and_session_ids_are_deduped() {
    let dir = temp_project("dedup");
    let mut l = link("t-aaaaaa");
    l.node_ids = vec!["m1".to_string(), "m1".to_string(), "m2".to_string()];
    l.session_ids = vec!["s1".to_string(), "s1".to_string()];
    let doc = tasklink_set(root_string(&dir), l).unwrap();
    assert_eq!(doc.links[0].node_ids, vec!["m1".to_string(), "m2".to_string()]);
    assert_eq!(doc.links[0].session_ids, vec!["s1".to_string()]);
}

// ── Upsert / delete (Gate 7) ─────────────────────────────────────────────

#[test]
fn upsert_replaces_existing_entry_and_preserves_every_other() {
    let dir = temp_project("upsert");
    tasklink_set(root_string(&dir), link("t-aaaaaa")).unwrap();
    tasklink_set(root_string(&dir), link("t-bbbbbb")).unwrap();

    let mut updated = link("t-aaaaaa");
    updated.node_ids = vec!["m9".to_string()];
    let doc = tasklink_set(root_string(&dir), updated).unwrap();

    assert_eq!(doc.links.len(), 2);
    let a = doc.links.iter().find(|l| l.task_id == "t-aaaaaa").unwrap();
    assert_eq!(a.node_ids, vec!["m9".to_string()]);
    assert!(doc.links.iter().any(|l| l.task_id == "t-bbbbbb"));
}

#[test]
fn delete_unknown_id_is_a_noop() {
    let dir = temp_project("delete-noop");
    tasklink_set(root_string(&dir), link("t-aaaaaa")).unwrap();
    let doc = tasklink_delete(root_string(&dir), "t-zzzzzz".to_string()).unwrap();
    assert_eq!(doc.links.len(), 1);
    assert_eq!(doc.links[0].task_id, "t-aaaaaa");
}

#[test]
fn delete_removes_the_named_entry_only() {
    let dir = temp_project("delete");
    tasklink_set(root_string(&dir), link("t-aaaaaa")).unwrap();
    tasklink_set(root_string(&dir), link("t-bbbbbb")).unwrap();
    let doc = tasklink_delete(root_string(&dir), "t-aaaaaa".to_string()).unwrap();
    assert_eq!(doc.links.len(), 1);
    assert_eq!(doc.links[0].task_id, "t-bbbbbb");
}

#[test]
fn tasklink_set_rejects_empty_task_id() {
    let dir = temp_project("empty-id");
    let err = tasklink_set(root_string(&dir), link("")).expect_err("empty taskId must be rejected");
    assert!(err.contains("taskId"));
}

// ── Ancestry chain / cycle guard (§3.2 L4, §4.1) ─────────────────────────

#[test]
fn ancestor_chain_resolves_the_full_chain_nearest_first() {
    let doc = TaskLinks {
        version: 1,
        links: vec![
            TaskLink {
                task_id: "t-a".to_string(),
                parent_task_id: Some("t-b".to_string()),
                ..Default::default()
            },
            TaskLink {
                task_id: "t-b".to_string(),
                parent_task_id: Some("t-c".to_string()),
                ..Default::default()
            },
            TaskLink {
                task_id: "t-c".to_string(),
                ..Default::default()
            },
        ],
    };
    let chain = ancestor_chain(&doc, "t-a").unwrap();
    assert_eq!(chain, vec!["t-b".to_string(), "t-c".to_string()]);
}

#[test]
fn ancestor_chain_is_empty_when_no_parent_recorded() {
    let doc = TaskLinks {
        version: 1,
        links: vec![link("t-a")],
    };
    assert_eq!(ancestor_chain(&doc, "t-a").unwrap(), Vec::<String>::new());
}

#[test]
fn ancestor_chain_ok_when_task_id_has_no_entry_at_all() {
    let doc = TaskLinks { version: 1, links: vec![] };
    assert_eq!(ancestor_chain(&doc, "t-ghost").unwrap(), Vec::<String>::new());
}

#[test]
fn tasklink_set_rejects_self_parent_as_a_cycle() {
    let dir = temp_project("self-cycle");
    let mut l = link("t-aaaaaa");
    l.parent_task_id = Some("t-aaaaaa".to_string());
    let err = tasklink_set(root_string(&dir), l).expect_err("self-parent must be rejected");
    assert!(err.contains("cycle"), "error should name the problem: {err}");
    // Rejected upsert must not have touched disk at all.
    assert!(!dir.join(TASKLINKS_REL_PATH).exists());
}

#[test]
fn tasklink_set_rejects_a_multi_hop_cycle_and_leaves_file_unchanged() {
    let dir = temp_project("multi-hop-cycle");
    let mut a = link("t-aaaaaa");
    a.parent_task_id = Some("t-bbbbbb".to_string());
    tasklink_set(root_string(&dir), a).unwrap();
    let before = read_raw(&dir);

    let mut b = link("t-bbbbbb");
    b.parent_task_id = Some("t-aaaaaa".to_string());
    let err = tasklink_set(root_string(&dir), b).expect_err("a<->b cycle must be rejected");
    assert!(err.contains("cycle"));

    let after = read_raw(&dir);
    assert_eq!(before, after, "a rejected upsert must not mutate the file");
}

#[test]
fn tasklink_set_accepts_a_valid_multi_level_ancestry() {
    let dir = temp_project("valid-ancestry");
    tasklink_set(root_string(&dir), link("t-cccccc")).unwrap();
    let mut b = link("t-bbbbbb");
    b.parent_task_id = Some("t-cccccc".to_string());
    tasklink_set(root_string(&dir), b).unwrap();
    let mut a = link("t-aaaaaa");
    a.parent_task_id = Some("t-bbbbbb".to_string());
    let doc = tasklink_set(root_string(&dir), a).unwrap();
    assert_eq!(doc.links.len(), 3);
}

// ── Ancestry depth boundary (audit F4) ───────────────────────────────────

#[test]
fn ancestor_chain_resolves_a_valid_depth_eight_chain_without_erroring() {
    // A 9-node chain (t-000008 -> t-000007 -> ... -> t-000000, root) is
    // exactly MAX_ANCESTRY_DEPTH (8) real hops. Pre-fix, `ancestor_chain`
    // consumed all 8 loop iterations just reaching t-000000 and never got
    // a 9th to confirm it has no further parent, so this valid chain fell
    // through to the same `Err` a genuine cycle produces.
    let mut links = vec![TaskLink {
        task_id: "t-000000".to_string(),
        ..Default::default()
    }];
    for i in 1..=8u32 {
        links.push(TaskLink {
            task_id: format!("t-{i:06}"),
            parent_task_id: Some(format!("t-{:06}", i - 1)),
            ..Default::default()
        });
    }
    let doc = TaskLinks { version: 1, links };
    let chain = ancestor_chain(&doc, "t-000008").expect("a valid 8-hop chain must resolve, not error");
    assert_eq!(chain.len(), 8, "all 8 ancestors must be returned: {chain:?}");
    assert_eq!(chain.last(), Some(&"t-000000".to_string()));
}

#[test]
fn ancestor_chain_still_rejects_a_chain_deeper_than_eight_hops() {
    // A 10-node chain is 9 real hops — one past the documented cap — and
    // must still fail closed, proving the F4 fix only moved the boundary
    // to the documented depth, not removed it.
    let mut links = vec![TaskLink {
        task_id: "t-000000".to_string(),
        ..Default::default()
    }];
    for i in 1..=9u32 {
        links.push(TaskLink {
            task_id: format!("t-{i:06}"),
            parent_task_id: Some(format!("t-{:06}", i - 1)),
            ..Default::default()
        });
    }
    let doc = TaskLinks { version: 1, links };
    assert!(
        ancestor_chain(&doc, "t-000009").is_err(),
        "a 9-hop, non-cyclic chain must still be rejected as exceeding the depth cap"
    );
}

#[test]
fn tasklink_set_accepts_an_eight_hop_ancestry_chain_end_to_end() {
    let dir = temp_project("eight-hop-chain");
    tasklink_set(root_string(&dir), link("t-000000")).unwrap();
    for i in 1..=8u32 {
        let mut l = link(&format!("t-{i:06}"));
        l.parent_task_id = Some(format!("t-{:06}", i - 1));
        let result = tasklink_set(root_string(&dir), l);
        assert!(result.is_ok(), "hop {i} of a valid 8-hop chain must be accepted: {result:?}");
    }
}

#[test]
fn tasklink_set_rejects_a_nine_hop_ancestry_chain_end_to_end() {
    // Mirror of the accept-side test above: the 9th hop (one past the
    // documented depth cap of 8) must be refused, and the refusal must
    // leave the file exactly as the first 8, already-accepted hops left it.
    let dir = temp_project("nine-hop-chain");
    tasklink_set(root_string(&dir), link("t-000000")).unwrap();
    for i in 1..=8u32 {
        let mut l = link(&format!("t-{i:06}"));
        l.parent_task_id = Some(format!("t-{:06}", i - 1));
        tasklink_set(root_string(&dir), l).unwrap();
    }
    let before = read_raw(&dir);

    let mut l9 = link("t-000009");
    l9.parent_task_id = Some("t-000008".to_string());
    let err = tasklink_set(root_string(&dir), l9)
        .expect_err("the 9th hop, one past the depth cap, must be rejected");
    assert!(err.contains("cycle"), "error should name the problem: {err}");

    let after = read_raw(&dir);
    assert_eq!(before, after, "a rejected upsert must not mutate the file");
}

// ── Atomicity ─────────────────────────────────────────────────────────

#[test]
fn write_leaves_no_stray_temp_file_behind() {
    let dir = temp_project("atomic");
    tasklink_set(root_string(&dir), link("t-aaaaaa")).unwrap();
    let cowtext_dir = dir.join(".cowtext");
    let stray: Vec<_> = std::fs::read_dir(&cowtext_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|name| name.contains(".tmp-"))
        .collect();
    assert!(stray.is_empty(), "temp file(s) left behind: {stray:?}");
    assert!(dir.join(TASKLINKS_REL_PATH).is_file());
}

#[test]
fn write_survives_repeated_calls_idempotently() {
    let dir = temp_project("idempotent");
    tasklink_set(root_string(&dir), link("t-aaaaaa")).unwrap();
    let first = read_raw(&dir);
    tasklink_delete(root_string(&dir), "t-ghost".to_string()).unwrap();
    let second = read_raw(&dir);
    assert_eq!(first, second, "a no-op delete must not change the bytes on disk");
}

// ── audit O6: no-op delete must not conjure a sidecar ────────────────────

#[test]
fn delete_unknown_id_in_a_project_with_no_sidecar_creates_no_file() {
    let dir = temp_project("delete-noop-no-sidecar");
    assert!(!dir.join(TASKLINKS_REL_PATH).exists());

    let doc = tasklink_delete(root_string(&dir), "t-zzzzzz".to_string()).unwrap();

    assert_eq!(doc, TaskLinks { version: 1, links: vec![] });
    assert!(
        !dir.join(TASKLINKS_REL_PATH).exists(),
        "a no-op delete on a project that has never used task linkage must not create a sidecar"
    );
}

#[test]
fn delete_on_an_existing_sidecar_still_writes_even_when_it_removes_nothing() {
    // The no-write skip is conditioned on "removed nothing AND the file
    // did not already exist" — a no-op delete against an *existing*
    // sidecar must still behave exactly as before (covered already by
    // `write_survives_repeated_calls_idempotently`, restated here as an
    // explicit existence check for the O6 boundary).
    let dir = temp_project("delete-noop-existing-sidecar");
    tasklink_set(root_string(&dir), link("t-aaaaaa")).unwrap();
    assert!(dir.join(TASKLINKS_REL_PATH).exists());

    let doc = tasklink_delete(root_string(&dir), "t-zzzzzz".to_string()).unwrap();

    assert_eq!(doc.links.len(), 1);
    assert!(dir.join(TASKLINKS_REL_PATH).exists());
}

// ── audit O7: tasklink_set enforces the §3.1 R5 id grammar ──────────────

#[test]
fn tasklink_set_rejects_a_malformed_task_id_grammar() {
    let dir = temp_project("bad-grammar");
    for bad in ["as0", "t-abc", "t-ABCDEF", "t-abcde!", "not-a-task-id", "t-1234567"] {
        let err =
            tasklink_set(root_string(&dir), link(bad)).expect_err(&format!("{bad} must be rejected by the grammar guard"));
        assert!(err.contains("taskId") || err.contains("grammar"), "{bad}: {err}");
    }
    assert!(
        !dir.join(TASKLINKS_REL_PATH).exists(),
        "every rejected upsert must leave no trace on disk"
    );
}

#[test]
fn tasklink_set_still_accepts_every_valid_grammar_shape() {
    let dir = temp_project("good-grammar");
    for good in ["t-aaaaaa", "t-000000", "t-a1b2c3", "t-zzzzzz"] {
        let doc = tasklink_set(root_string(&dir), link(good))
            .unwrap_or_else(|e| panic!("{good} is grammar-valid and must be accepted: {e}"));
        assert!(doc.links.iter().any(|l| l.task_id == good));
    }
}

// ── audit O5 (partial): concurrent writes must never corrupt the file ────

#[test]
fn concurrent_tasklink_set_calls_never_corrupt_the_file() {
    // `project::write_atomic` names its temp file from the destination
    // path plus this *process's* id only — not per-call-unique — so two
    // concurrent writers of the same sidecar share one temp file. Without
    // this module's write lock, overlapping `tasklink_set` calls could
    // interleave their writes and leave a genuinely corrupt (non-JSON, or
    // spliced) `tasklinks.json` on disk, or silently lose one thread's
    // entry entirely. This fires eight concurrent upserts of *distinct*
    // taskIds and asserts the result is valid JSON with every entry
    // present — proving the write path is not corrupted and concurrent
    // upserts of different entries are never lost.
    let dir = temp_project("concurrent-writes");
    let root = root_string(&dir);
    let handles: Vec<_> = (0..8u32)
        .map(|i| {
            let root = root.clone();
            std::thread::spawn(move || {
                let mut l = link(&format!("t-{i:06}"));
                l.node_ids = vec![format!("m{i}")];
                tasklink_set(root, l)
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap().expect("every concurrent call must succeed");
    }

    let raw = read_raw(&dir);
    let parsed: TaskLinks =
        serde_json::from_str(&raw).expect("concurrent writes must never leave a corrupt (non-JSON) tasklinks.json");
    assert_eq!(parsed.links.len(), 8, "every concurrent upsert must be present, none lost: {parsed:?}");
}
