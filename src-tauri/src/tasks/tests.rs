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
    assert_eq!(t.priority.as_deref(), Some("P1"));
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
    assert_eq!(t.priority.as_deref(), Some("P1"));
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
    assert_eq!(scan.files.len(), 4);
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
    assert_eq!(scan.files.len(), 4);
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

#[test]
fn task_append_creates_missing_file_with_header() {
    let dir = temp_project("append-new");
    let root = dir.to_string_lossy().into_owned();

    let item = task_append(root, "TASKS.md".to_string(), "brand new task".to_string()).unwrap();
    assert_eq!(item.name, "brand new task");
    assert!(!item.done);

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, "# TASKS\n\n- [ ] brand new task\n");
    assert_eq!(item.line, 3);
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

#[test]
fn task_append_rejects_non_convention_path() {
    let dir = temp_project("append-bad-path");
    let root = dir.to_string_lossy().into_owned();
    let err = task_append(root, "docs/random/NOTES.md".to_string(), "x".to_string()).unwrap_err();
    assert_eq!(err, "Not a task file: docs/random/NOTES.md");
    let _ = fs::remove_dir_all(&dir);
}

// ---- task_move -------------------------------------------------------------

#[test]
fn task_move_checklist_verbatim() {
    let dir = temp_project("move-checklist");
    fs::write(dir.join("TASKS.md"), "- [ ] move me #keep\n").unwrap();
    fs::write(dir.join("SPRINT.md"), "# SPRINT\n\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let moved = task_move(root, "TASKS.md".to_string(), 1, "SPRINT.md".to_string()).unwrap();
    assert_eq!(moved.name, "move me #keep");
    assert_eq!(moved.tags, vec!["keep".to_string()]);
    assert_eq!(moved.rel_path, "SPRINT.md");

    let from_on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(from_on_disk, "");
    let to_on_disk = fs::read_to_string(dir.join("SPRINT.md")).unwrap();
    assert_eq!(to_on_disk, "# SPRINT\n\n- [ ] move me #keep\n");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_move_table_row_converted_to_checklist() {
    let dir = temp_project("move-table");
    fs::write(
        dir.join("BACKLOG.md"),
        "| Name | Desc |\n| --- | --- |\n| Big idea | do research |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let moved = task_move(root, "BACKLOG.md".to_string(), 3, "TASKS.md".to_string()).unwrap();
    assert_eq!(moved.source, TaskSource::Checklist);
    assert_eq!(moved.name, "Big idea");
    assert_eq!(moved.description.as_deref(), Some("do research"));

    let to_on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(to_on_disk, "# TASKS\n\n- [ ] Big idea — do research\n");
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
    assert_eq!(updated.priority.as_deref(), Some("P1"));

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        "| Name | Notes | Priority |\n| --- | --- | --- |\n| New Name |   keep me exactly  | P1 |\n"
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
