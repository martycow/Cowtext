use super::*;
use std::path::PathBuf;

fn temp_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("cowtext-tasks-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

// ---- parser: table header mapping incl. alias columns ----------------------

#[test]
fn parses_table_with_alias_columns() {
    let content = "\
| Task | Prio | Desc | Assignee | State | Tags |
| --- | --- | --- | --- | --- | --- |
| Ship it | P1 | wire the thing up | tech-general | in progress | backend, urgent |
";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 1);
    let t = &tasks[0];
    assert_eq!(t.source, TaskSource::Table);
    assert_eq!(t.name, "Ship it");
    // WO02 §2.4: legacy "P1" cell text normalizes to the "high" bucket.
    assert_eq!(t.priority.as_deref(), Some("high"));
    assert_eq!(t.description.as_deref(), Some("wire the thing up"));
    assert_eq!(t.agent.as_deref(), Some("tech-general"));
    assert_eq!(t.status.as_deref(), Some("in-production"));
    assert_eq!(t.tags, vec!["backend".to_string(), "urgent".to_string()]);
    assert_eq!(t.line, 3);
    assert_eq!(t.id, "TASKS.md#3");
}

// ---- parser: table tags split on comma/whitespace ---------------------------

#[test]
fn table_tags_split_on_comma_and_whitespace() {
    let content = "\
| Name | Tags |
| --- | --- |
| Foo | a, b  c ,,d |
";
    let tasks = parse_tasks("BACKLOG.md", content);
    assert_eq!(tasks.len(), 1);
    assert_eq!(
        tasks[0].tags,
        vec!["a".to_string(), "b".to_string(), "c".to_string(), "d".to_string()]
    );
}

// ---- parser: checklist tag/agent/priority extraction + done state ----------

#[test]
fn checklist_extracts_tag_agent_priority_and_done_state() {
    let content = "- [x] Fix the bug #backend #urgent @tech-general (P1)\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 1);
    let t = &tasks[0];
    assert!(t.done);
    assert_eq!(t.source, TaskSource::Checklist);
    assert_eq!(t.tags, vec!["backend".to_string(), "urgent".to_string()]);
    assert_eq!(t.agent.as_deref(), Some("tech-general"));
    // WO02 §2.4: legacy bare "P1" token normalizes to the "high" bucket.
    assert_eq!(t.priority.as_deref(), Some("high"));
}

#[test]
fn checklist_not_done_when_box_is_blank() {
    let content = "  - [ ] a plain task\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 1);
    assert!(!tasks[0].done);
    assert_eq!(tasks[0].name, "a plain task");
}

// ---- parser: checklist name/description boundary split ---------------------

#[test]
fn checklist_name_split_on_dash_boundary() {
    let content = "- [ ] Ship it - wire the thing up\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks[0].name, "Ship it");
    assert_eq!(tasks[0].description.as_deref(), Some("wire the thing up"));
}

#[test]
fn checklist_whole_line_as_name_when_no_boundary() {
    let content = "- [ ] Ship it soon\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks[0].name, "Ship it soon");
    assert_eq!(tasks[0].description, None);
}

// ---- parser: tolerant of unrelated markdown --------------------------------

#[test]
fn parse_tasks_ignores_unrelated_markdown() {
    let content = "# Heading\n\nSome *prose* here.\n\n> a blockquote\n\n```\ncode block\n```\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert!(tasks.is_empty());
}

// ---- tasks_scan: discovery order --------------------------------------------

#[test]
fn tasks_scan_discovery_order_root_before_docs_before_docs_tasks() {
    let dir = temp_project("scan-order");
    fs::write(dir.join("TASKS.md"), "- [ ] root wins\n").unwrap();
    fs::create_dir_all(dir.join("docs")).unwrap();
    fs::write(dir.join("docs/TASKS.md"), "- [ ] docs loses\n").unwrap();

    fs::create_dir_all(dir.join("docs/tasks")).unwrap();
    fs::write(dir.join("docs/SPRINT.md"), "- [ ] docs sprint\n").unwrap();
    fs::write(dir.join("docs/tasks/SPRINT.md"), "- [ ] deep sprint loses\n").unwrap();

    let scan = tasks_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert_eq!(scan.files.len(), 5);
    assert_eq!(scan.files[0].rel_path, "TASKS.md");
    assert!(scan.files[0].exists);
    assert_eq!(scan.files[1].rel_path, "docs/SPRINT.md");
    assert!(scan.files[1].exists);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn tasks_scan_missing_files_report_default_root_location() {
    let dir = temp_project("scan-missing");
    let scan = tasks_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert_eq!(scan.files.len(), 5);
    for (f, name) in scan.files.iter().zip(CONVENTION_NAMES.iter()) {
        assert!(!f.exists);
        assert_eq!(f.task_count, 0);
        assert_eq!(&f.rel_path, name);
    }
    assert!(scan.tasks.is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn tasks_scan_rejects_bad_root() {
    assert!(tasks_scan("Z:/definitely/not/a/dir".into()).is_err());
}

// ---- task_toggle -------------------------------------------------------------

#[test]
fn task_toggle_checklist_line_flips_done() {
    let dir = temp_project("toggle-ok");
    fs::write(dir.join("TASKS.md"), "- [ ] flip me\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let updated = task_toggle(root.clone(), "TASKS.md".to_string(), 1, true).unwrap();
    assert!(updated.done);
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, "- [x] flip me\n");

    let reverted = task_toggle(root, "TASKS.md".to_string(), 1, false).unwrap();
    assert!(!reverted.done);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_toggle_rejects_table_row() {
    let dir = temp_project("toggle-table");
    fs::write(dir.join("TASKS.md"), "| Name |\n| --- |\n| a table task |\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_toggle(root, "TASKS.md".to_string(), 3, true).unwrap_err();
    assert_eq!(err, "Not a checklist task: TASKS.md#3");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_toggle_stale_line_errors() {
    let dir = temp_project("toggle-stale");
    fs::write(dir.join("TASKS.md"), "- [ ] only one line\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_toggle(root, "TASKS.md".to_string(), 99, true).unwrap_err();
    assert_eq!(err, "Task moved on disk — rescan");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_toggle_rejects_non_convention_path() {
    let dir = temp_project("toggle-bad-path");
    fs::write(dir.join("NOTES.md"), "- [ ] not a convention file\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_toggle(root, "NOTES.md".to_string(), 1, true).unwrap_err();
    assert_eq!(err, "Not a task file: NOTES.md");
    let _ = fs::remove_dir_all(&dir);
}

// ---- task_append ---------------------------------------------------------

// WO02 §2.3 case 3: a missing file gets the canonical table, not a
// checklist line — this supersedes the pre-WO02 header+checklist shape.
#[test]
fn task_append_creates_missing_file_with_canonical_table() {
    let dir = temp_project("append-new");
    let root = dir.to_string_lossy().into_owned();

    let item = task_append(root, "TASKS.md".to_string(), "brand new task".to_string()).unwrap();
    assert_eq!(item.name, "brand new task");
    assert_eq!(item.source, TaskSource::Table);
    assert_eq!(item.status.as_deref(), Some("new"));
    assert!(!item.done);

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        "# TASKS\n\n\
         | Name | Status | Priority | Tags | Agent | Description |\n\
         |---|---|---|---|---|---|\n\
         | brand new task | new |  |  |  |  |\n"
    );
    assert_eq!(item.line, 5);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_append_to_existing_file_appends_last_line() {
    let dir = temp_project("append-existing");
    fs::write(dir.join("SPRINT.md"), "# SPRINT\n\n- [ ] first\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_append(root, "SPRINT.md".to_string(), "second".to_string()).unwrap();
    assert_eq!(item.line, 4);
    let on_disk = fs::read_to_string(dir.join("SPRINT.md")).unwrap();
    assert_eq!(on_disk, "# SPRINT\n\n- [ ] first\n- [ ] second\n");
    let _ = fs::remove_dir_all(&dir);
}

// WO02 §2.3 case 1: a name-mapped table already exists — the new row lands
// right after the last data row, not at EOF, with the same cell count and
// pipe style, and the Priority cell carries the normalized bucket.
#[test]
fn task_append_into_existing_table_inserts_row_after_last_data_row() {
    let dir = temp_project("append-table-existing");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Status | Priority |\n\
         | --- | --- | --- |\n\
         | Row A | new | low |\n\
         | Row B | new | medium |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_append(root, "TASKS.md".to_string(), "New Task !high".to_string()).unwrap();
    assert_eq!(item.source, TaskSource::Table);
    assert_eq!(item.priority.as_deref(), Some("high"));
    assert_eq!(item.status.as_deref(), Some("new"));
    assert_eq!(item.line, 5);

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        "| Name | Status | Priority |\n\
         | --- | --- | --- |\n\
         | Row A | new | low |\n\
         | Row B | new | medium |\n\
         | New Task !high | new | high |\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

// WO02 §2.3 case 1: columns the appended row doesn't map to (here `Notes`)
// get a single space, and pre-existing rows' cells — mapped or not — stay
// byte-exact.
#[test]
fn task_append_into_existing_table_preserves_unmapped_columns_byte_exact() {
    let dir = temp_project("append-table-unmapped");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Notes | Priority |\n\
         | --- | --- | --- |\n\
         | Row A |   keep me exact  | low |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_append(root, "TASKS.md".to_string(), "Row B".to_string()).unwrap();
    assert_eq!(item.name, "Row B");
    assert_eq!(item.line, 4);

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        "| Name | Notes | Priority |\n\
         | --- | --- | --- |\n\
         | Row A |   keep me exact  | low |\n\
         | Row B | | |\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

// WO02 §2.3 item #14: BUGS.md is the 5th convention file — scanned and
// writable exactly like the other four.
#[test]
fn bugs_md_scanned_and_writable() {
    let dir = temp_project("bugs-md");
    fs::write(dir.join("BUGS.md"), "- [ ] squash it\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root.clone()).unwrap();
    assert_eq!(scan.files.len(), 5);
    assert_eq!(scan.files[4].rel_path, "BUGS.md");
    assert!(scan.files[4].exists);
    assert_eq!(scan.files[4].task_count, 1);

    let item = task_append(root, "BUGS.md".to_string(), "new bug".to_string()).unwrap();
    assert_eq!(item.name, "new bug");
    assert_eq!(item.line, 2);
    let on_disk = fs::read_to_string(dir.join("BUGS.md")).unwrap();
    assert_eq!(on_disk, "- [ ] squash it\n- [ ] new bug\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_append_rejects_non_convention_path() {
    let dir = temp_project("append-bad-path");
    let root = dir.to_string_lossy().into_owned();
    let err = task_append(root, "docs/random/NOTES.md".to_string(), "x".to_string()).unwrap_err();
    assert_eq!(err, "Not a task file: docs/random/NOTES.md");
    let _ = fs::remove_dir_all(&dir);
}

// ---- task_move -------------------------------------------------------------

// WO02 §2.3: target-form-aware — a checklist-only target still gets a
// checklist line (the composed-fields shape, always unchecked/"new"). Uses
// a "canonical" source line free of embedded #tag/@agent/Pn text, same
// caveat as `task_update_checklist_roundtrip_unchanged_for_canonical_line`:
// `split_name_desc` doesn't strip metadata tokens out of name/description,
// so a source line that already embeds one would double it up once
// `compose_checklist_text` re-appends it from the separately-extracted field.
#[test]
fn task_move_into_checklist_only_target_appends_checklist_line() {
    let dir = temp_project("move-checklist");
    fs::write(dir.join("TASKS.md"), "- [ ] move me\n").unwrap();
    fs::write(dir.join("SPRINT.md"), "- [ ] already here\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let moved = task_move(root, "TASKS.md".to_string(), 1, "SPRINT.md".to_string()).unwrap();
    assert_eq!(moved.source, TaskSource::Checklist);
    assert_eq!(moved.name, "move me");
    assert_eq!(moved.rel_path, "SPRINT.md");
    assert!(!moved.done);

    let from_on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(from_on_disk, "");
    let to_on_disk = fs::read_to_string(dir.join("SPRINT.md")).unwrap();
    assert_eq!(to_on_disk, "- [ ] already here\n- [ ] move me\n");
    let _ = fs::remove_dir_all(&dir);
}

// WO02 §2.3: a table row's tags/agent/priority (separate columns, so no
// embedded-token double-up risk) survive a move into a checklist-only
// target, composed via `compose_checklist_text` as `!<bucket>`.
#[test]
fn task_move_table_row_into_checklist_target_preserves_tags_agent_priority() {
    let dir = temp_project("move-table-fields");
    fs::write(
        dir.join("BACKLOG.md"),
        "| Name | Tags | Agent | Priority |\n\
         | --- | --- | --- | --- |\n\
         | Big idea | research, ux | tech-ui | P1 |\n",
    )
    .unwrap();
    fs::write(dir.join("SPRINT.md"), "- [ ] already here\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let moved = task_move(root, "BACKLOG.md".to_string(), 3, "SPRINT.md".to_string()).unwrap();
    assert_eq!(moved.source, TaskSource::Checklist);
    // No dash/period boundary in the composed line, so (as elsewhere in
    // this parser) `name` still carries the trailing token text verbatim —
    // `tags`/`agent`/`priority` are extracted separately regardless.
    assert_eq!(moved.name, "Big idea #research #ux @tech-ui !high");
    assert_eq!(moved.tags, vec!["research".to_string(), "ux".to_string()]);
    assert_eq!(moved.agent.as_deref(), Some("tech-ui"));
    assert_eq!(moved.priority.as_deref(), Some("high"));

    let to_on_disk = fs::read_to_string(dir.join("SPRINT.md")).unwrap();
    assert_eq!(
        to_on_disk,
        "- [ ] already here\n- [ ] Big idea #research #ux @tech-ui !high\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

// WO02 §2.3 case 1: moving into a target that already has a name-mapped
// table inserts a row after its last data row, same as `task_append`.
#[test]
fn task_move_into_existing_table_target_inserts_row() {
    let dir = temp_project("move-into-table");
    fs::write(dir.join("TASKS.md"), "- [ ] Ship it #api\n").unwrap();
    fs::write(
        dir.join("BACKLOG.md"),
        "| Name | Tags |\n| --- | --- |\n| Old | keep |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let moved = task_move(root, "TASKS.md".to_string(), 1, "BACKLOG.md".to_string()).unwrap();
    assert_eq!(moved.source, TaskSource::Table);
    assert_eq!(moved.tags, vec!["api".to_string()]);
    assert_eq!(moved.line, 4);

    let from_on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(from_on_disk, "");
    let to_on_disk = fs::read_to_string(dir.join("BACKLOG.md")).unwrap();
    assert_eq!(
        to_on_disk,
        "| Name | Tags |\n| --- | --- |\n| Old | keep |\n| Ship it #api | api |\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

// WO02 §2.3 case 3: a missing/taskless target gets a fresh canonical
// table — this supersedes the pre-WO02 table-row-to-checklist conversion.
#[test]
fn task_move_table_row_into_empty_target_creates_canonical_table() {
    let dir = temp_project("move-table");
    fs::write(
        dir.join("BACKLOG.md"),
        "| Name | Desc |\n| --- | --- |\n| Big idea | do research |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let moved = task_move(root, "BACKLOG.md".to_string(), 3, "TASKS.md".to_string()).unwrap();
    assert_eq!(moved.source, TaskSource::Table);
    assert_eq!(moved.name, "Big idea");
    assert_eq!(moved.description.as_deref(), Some("do research"));
    assert_eq!(moved.status.as_deref(), Some("new"));

    let to_on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        to_on_disk,
        "# TASKS\n\n\
         | Name | Status | Priority | Tags | Agent | Description |\n\
         |---|---|---|---|---|---|\n\
         | Big idea | new |  |  |  | do research |\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_move_stale_line_errors() {
    let dir = temp_project("move-stale");
    fs::write(dir.join("TASKS.md"), "- [ ] only line\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_move(root, "TASKS.md".to_string(), 42, "SPRINT.md".to_string()).unwrap_err();
    assert_eq!(err, "Task moved on disk — rescan");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_move_same_file_is_rejected() {
    let dir = temp_project("move-same-file");
    fs::write(dir.join("TASKS.md"), "- [ ] a task\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_move(root, "TASKS.md".to_string(), 1, "TASKS.md".to_string()).unwrap_err();
    assert_eq!(err, "Cannot move a task to the same file");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_move_rejects_non_convention_target() {
    let dir = temp_project("move-bad-target");
    fs::write(dir.join("TASKS.md"), "- [ ] a task\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_move(root, "TASKS.md".to_string(), 1, "NOTES.md".to_string()).unwrap_err();
    assert_eq!(err, "Not a task file: NOTES.md");
    // Source is untouched — nothing half-moved.
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, "- [ ] a task\n");
    let _ = fs::remove_dir_all(&dir);
}

// ---- Rev 2 parser: checklist marker variants -> status/done ----------------

#[test]
fn checklist_marker_variants_map_to_status_and_done() {
    let content = "- [ ] a\n- [>] b\n- [?] c\n- [x] d\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 4);
    assert_eq!(tasks[0].status.as_deref(), Some("new"));
    assert!(!tasks[0].done);
    assert_eq!(tasks[1].status.as_deref(), Some("in-production"));
    assert!(!tasks[1].done);
    assert_eq!(tasks[2].status.as_deref(), Some("in-testing"));
    assert!(!tasks[2].done);
    assert_eq!(tasks[3].status.as_deref(), Some("done"));
    assert!(tasks[3].done);
}

// ---- Rev 2 parser: table status cell synonym mapping ------------------------

#[test]
fn table_status_cell_synonym_mapping() {
    let content = "\
| Name | Status |
| --- | --- |
| A | todo |
| B | wip |
| C | review |
| D | closed |
| E | unrecognized |
";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 5);
    assert_eq!(tasks[0].status.as_deref(), Some("new"));
    assert_eq!(tasks[1].status.as_deref(), Some("in-production"));
    assert_eq!(tasks[2].status.as_deref(), Some("in-testing"));
    assert_eq!(tasks[3].status.as_deref(), Some("done"));
    assert!(tasks[3].done);
    assert_eq!(tasks[4].status.as_deref(), Some("new"));
}

// ---- WO02 §2.4: priority buckets --------------------------------------------

#[test]
fn bucket_for_priority_input_normalizes_all_aliases() {
    assert_eq!(bucket_for_priority_input("low"), Some("low"));
    assert_eq!(bucket_for_priority_input("L"), Some("low"));
    assert_eq!(bucket_for_priority_input("P3"), Some("low"));
    assert_eq!(bucket_for_priority_input("  Medium  "), Some("medium"));
    assert_eq!(bucket_for_priority_input("med"), Some("medium"));
    assert_eq!(bucket_for_priority_input("normal"), Some("medium"));
    assert_eq!(bucket_for_priority_input("p2"), Some("medium"));
    assert_eq!(bucket_for_priority_input("HIGH"), Some("high"));
    assert_eq!(bucket_for_priority_input("h"), Some("high"));
    assert_eq!(bucket_for_priority_input("P1"), Some("high"));
    assert_eq!(bucket_for_priority_input("critical"), Some("critical"));
    assert_eq!(bucket_for_priority_input("Crit"), Some("critical"));
    assert_eq!(bucket_for_priority_input("blocker"), Some("critical"));
    assert_eq!(bucket_for_priority_input("Urgent"), Some("critical"));
    assert_eq!(bucket_for_priority_input("p0"), Some("critical"));
    assert_eq!(bucket_for_priority_input(""), None);
    assert_eq!(bucket_for_priority_input("whenever"), None);
    assert_eq!(bucket_for_priority_input("p4"), None);
}

#[test]
fn checklist_priority_bang_token_recognizes_buckets_case_insensitive_and_legacy_p_code() {
    let content = "\
- [ ] a !low
- [ ] b !MEDIUM
- [ ] c !High
- [ ] d !critical
- [ ] e P0
- [ ] f !bogus
";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 6);
    assert_eq!(tasks[0].priority.as_deref(), Some("low"));
    assert_eq!(tasks[1].priority.as_deref(), Some("medium"));
    assert_eq!(tasks[2].priority.as_deref(), Some("high"));
    assert_eq!(tasks[3].priority.as_deref(), Some("critical"));
    assert_eq!(tasks[4].priority.as_deref(), Some("critical")); // legacy P0
    assert_eq!(tasks[5].priority, None); // unrecognized — never invented
}

#[test]
fn task_update_checklist_priority_writes_bucket_or_raw() {
    let dir = temp_project("update-priority-recognized");
    fs::write(dir.join("TASKS.md"), "- [ ] Task one\n").unwrap();
    let root = dir.to_string_lossy().into_owned();
    let patch = TaskPatch {
        name: Some("Task one".to_string()),
        priority: Some("p1".to_string()),
        ..Default::default()
    };
    let updated = task_update(root, "TASKS.md".to_string(), 1, patch).unwrap();
    assert_eq!(updated.priority.as_deref(), Some("high"));
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, "- [ ] Task one !high\n");
    let _ = fs::remove_dir_all(&dir);

    let dir = temp_project("update-priority-raw");
    fs::write(dir.join("TASKS.md"), "- [ ] Task two\n").unwrap();
    let root = dir.to_string_lossy().into_owned();
    let patch = TaskPatch {
        name: Some("Task two".to_string()),
        priority: Some("urgent-note".to_string()),
        ..Default::default()
    };
    // "urgent-note" doesn't normalize (it's not one of the recognized
    // aliases once "-" becomes a space) — the raw trimmed value is written
    // bare, nothing invented or dropped from the on-disk bytes. (A bare
    // trailing token like this isn't recognizable as a priority token on
    // the next scan — same "canonical fixture" caveat as the checklist
    // round-trip test above — so this test checks the write side only.)
    task_update(root, "TASKS.md".to_string(), 1, patch).unwrap();
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, "- [ ] Task two urgent-note\n");
    let _ = fs::remove_dir_all(&dir);
}

// ---- Rev 2 parser: section attribution --------------------------------------

#[test]
fn section_attribution_tracks_headings_mid_file() {
    let content = "\
- [ ] before any heading

## Sprint 1

- [ ] in sprint one

## Sprint 2

- [ ] in sprint two
";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 3);
    assert_eq!(tasks[0].section, None);
    assert_eq!(tasks[1].section.as_deref(), Some("Sprint 1"));
    assert_eq!(tasks[2].section.as_deref(), Some("Sprint 2"));
}

#[test]
fn section_ignores_level_one_heading() {
    let content = "\
# Title

- [ ] no section yet

## Real Section

- [ ] has section
";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0].section, None);
    assert_eq!(tasks[1].section.as_deref(), Some("Real Section"));
}

// ---- Rev 2 parser: `when` extraction ----------------------------------------

#[test]
fn when_extraction_date_quarter_phase_and_absent() {
    let content = "\
- [ ] due 2026-09-01
- [ ] target Q3
- [ ] milestone Phase 2
- [ ] no date here
";
    let tasks = parse_tasks("ROADMAP.md", content);
    assert_eq!(tasks.len(), 4);
    assert_eq!(tasks[0].when.as_deref(), Some("2026-09-01"));
    assert_eq!(tasks[1].when.as_deref(), Some("Q3"));
    assert_eq!(tasks[2].when.as_deref(), Some("Phase 2"));
    assert_eq!(tasks[3].when, None);
}

// ---- task_update: checklist regeneration round-trip -------------------------

// A "canonical" fixture for round-trip purposes: description text carries
// no `#tag`/`@agent`/`Pn`-shaped words of its own, so re-deriving a patch
// from the parsed fields and writing it back doesn't double up tokens that
// `split_name_desc` (unchanged, pre-Rev-2 behavior) leaves embedded in
// `description` verbatim when they trail a dash boundary.
#[test]
fn task_update_checklist_roundtrip_unchanged_for_canonical_line() {
    let dir = temp_project("update-roundtrip");
    let raw = "- [ ] Ship it — wire the thing up\n";
    fs::write(dir.join("TASKS.md"), raw).unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = parse_tasks("TASKS.md", raw).remove(0);
    let patch = TaskPatch {
        name: Some(item.name.clone()),
        description: item.description.clone(),
        tags: Some(item.tags.clone()),
        priority: item.priority.clone(),
        phase: None,
        agent: item.agent.clone(),
        status: item.status.clone(),
        done: Some(item.done),
    };
    let updated = task_update(root, "TASKS.md".to_string(), 1, patch).unwrap();
    assert_eq!(updated.name, "Ship it");
    assert_eq!(updated.status.as_deref(), Some("new"));
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, raw);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_update_checklist_marker_change_only_flips_marker() {
    let dir = temp_project("update-marker-flip");
    let raw = "- [ ] Ship it — wire the thing up\n";
    fs::write(dir.join("TASKS.md"), raw).unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = parse_tasks("TASKS.md", raw).remove(0);
    let patch = TaskPatch {
        name: Some(item.name.clone()),
        description: item.description.clone(),
        tags: Some(item.tags.clone()),
        priority: item.priority.clone(),
        phase: None,
        agent: item.agent.clone(),
        status: Some("in-production".to_string()),
        done: None,
    };
    let updated = task_update(root, "TASKS.md".to_string(), 1, patch).unwrap();
    assert_eq!(updated.status.as_deref(), Some("in-production"));
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, "- [>] Ship it — wire the thing up\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_update_checklist_clears_optional_fields_when_absent() {
    let dir = temp_project("update-clear-optional");
    let raw = "- [ ] Full task — desc here #tag1 @agent1 P1\n";
    fs::write(dir.join("TASKS.md"), raw).unwrap();
    let root = dir.to_string_lossy().into_owned();

    let patch = TaskPatch {
        name: Some("Full task".to_string()),
        ..Default::default()
    };
    let updated = task_update(root, "TASKS.md".to_string(), 1, patch).unwrap();
    assert_eq!(updated.description, None);
    assert!(updated.tags.is_empty());
    assert_eq!(updated.agent, None);
    assert_eq!(updated.priority, None);
    assert_eq!(updated.status.as_deref(), Some("new"));
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, "- [ ] Full task\n");
    let _ = fs::remove_dir_all(&dir);
}

// ---- task_update: table row cell replacement --------------------------------

#[test]
fn task_update_table_row_preserves_unmapped_cells_byte_exact() {
    let dir = temp_project("update-table-unmapped");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Notes | Priority |\n| --- | --- | --- |\n| Old Name |   keep me exactly  | P2 |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let patch = TaskPatch {
        name: Some("New Name".to_string()),
        priority: Some("P1".to_string()),
        ..Default::default()
    };
    let updated = task_update(root, "TASKS.md".to_string(), 3, patch).unwrap();
    assert_eq!(updated.name, "New Name");
    // WO02 §2.4: the legacy "P1" input normalizes to the "high" bucket on write.
    assert_eq!(updated.priority.as_deref(), Some("high"));

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        "| Name | Notes | Priority |\n| --- | --- | --- |\n| New Name |   keep me exactly  | high |\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_update_table_status_cell_writes_bucket_and_recomputes() {
    let dir = temp_project("update-table-status");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Status |\n| --- | --- |\n| A | todo |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let patch = TaskPatch {
        name: Some("A".to_string()),
        status: Some("in testing".to_string()),
        ..Default::default()
    };
    let updated = task_update(root, "TASKS.md".to_string(), 3, patch).unwrap();
    assert_eq!(updated.status.as_deref(), Some("in-testing"));

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, "| Name | Status |\n| --- | --- |\n| A | in-testing |\n");
    let _ = fs::remove_dir_all(&dir);
}

// ---- task_update: guards -----------------------------------------------------

#[test]
fn task_update_stale_line_errors() {
    let dir = temp_project("update-stale");
    fs::write(dir.join("TASKS.md"), "- [ ] only one line\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let patch = TaskPatch {
        name: Some("whatever".to_string()),
        ..Default::default()
    };
    let err = task_update(root, "TASKS.md".to_string(), 99, patch).unwrap_err();
    assert_eq!(err, "Task moved on disk — rescan");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_update_cleared_name_errors() {
    let dir = temp_project("update-cleared-name");
    let raw = "- [ ] keep name\n";
    fs::write(dir.join("TASKS.md"), raw).unwrap();
    let root = dir.to_string_lossy().into_owned();

    let patch = TaskPatch::default();
    let err = task_update(root, "TASKS.md".to_string(), 1, patch).unwrap_err();
    assert_eq!(err, "Task name cannot be empty");
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, raw);
    let _ = fs::remove_dir_all(&dir);
}
