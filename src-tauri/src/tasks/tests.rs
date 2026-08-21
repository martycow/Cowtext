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

// ---- parser: Task Type column (F6) ------------------------------------------

// F6 (a): the shipped skill's own six-column grid — all six map, task_type
// populated.
#[test]
fn parses_task_type_column_all_six_map() {
    let content = "\
| Name | Task Type | Priority | Tags | Status | Description |
| --- | --- | --- | --- | --- | --- |
| Ship it | bug | high | backend | in progress | wire the thing up |
";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 1);
    let t = &tasks[0];
    assert_eq!(t.name, "Ship it");
    assert_eq!(t.task_type.as_deref(), Some("bug"));
    assert_eq!(t.priority.as_deref(), Some("high"));
    assert_eq!(t.tags, vec!["backend".to_string()]);
    assert_eq!(t.status.as_deref(), Some("in-production"));
    assert_eq!(t.description.as_deref(), Some("wire the thing up"));
}

// F6 (b): header synonyms "Type" and "Kind" map to the same slot as
// "Task Type".
#[test]
fn task_type_header_synonyms_map_to_same_slot() {
    for header in ["Task Type", "Type", "Kind"] {
        let content = format!(
            "| Name | {header} |\n| --- | --- |\n| Solo | feature |\n"
        );
        let tasks = parse_tasks("TASKS.md", &content);
        assert_eq!(tasks.len(), 1, "header {header:?}");
        assert_eq!(tasks[0].task_type.as_deref(), Some("feature"), "header {header:?}");
    }
}

// F6 (c): the near-collision guard — "task" alone (bare) still maps to NAME,
// never to task_type. Distinguishes the whole-cell-equality match in
// `map_columns` from a substring/prefix match.
#[test]
fn bare_task_header_maps_to_name_not_task_type() {
    let content = "| Task | Priority |\n| --- | --- |\n| Ship it | high |\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].name, "Ship it");
    assert_eq!(tasks[0].task_type, None);
}

// F6 (g): a table with no Task Type column still parses fine, task_type is
// None, and nothing else is disturbed.
#[test]
fn table_without_task_type_column_parses_with_none() {
    let content = "| Name | Priority |\n| --- | --- |\n| Solo | low |\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].task_type, None);
    assert_eq!(tasks[0].priority.as_deref(), Some("low"));
}

// F6 (f): `create_canonical_table`'s HEADER is frozen — Task Type is an
// OPTIONAL column the skill adds on top, it is never part of this internal
// six-column shape. Asserted as a literal string so nobody widens it later
// (WO02_CONTRACT.md:194).
#[test]
fn canonical_table_header_is_frozen_agent_shape_not_task_type() {
    let dir = temp_project("canonical-header-frozen");
    let root = dir.to_string_lossy().into_owned();

    task_append(root, "TASKS.md".to_string(), "brand new task".to_string()).unwrap();
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    let header_line = on_disk.lines().nth(2).unwrap();
    assert_eq!(header_line, "| Name | Status | Priority | Tags | Agent | Description |");
    let _ = fs::remove_dir_all(&dir);
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

// WO06 O2: an empty project (no convention file exists anywhere) reports
// every missing file under "docs/tasks/" — Cowtext's own documented
// layout — not a bare root-level name. Pre-WO06 this asserted the bare
// name; that was exactly O2's bug (a file created here landed at the repo
// root).
#[test]
fn tasks_scan_missing_files_report_docs_tasks_home_when_nothing_exists() {
    let dir = temp_project("scan-missing");
    let scan = tasks_scan(dir.to_string_lossy().into_owned()).unwrap();
    assert_eq!(scan.files.len(), 5);
    for (f, name) in scan.files.iter().zip(CONVENTION_NAMES.iter()) {
        assert!(!f.exists);
        assert_eq!(f.task_count, 0);
        assert_eq!(f.rel_path, format!("docs/tasks/{name}"));
    }
    assert!(scan.tasks.is_empty());
    let _ = fs::remove_dir_all(&dir);
}

// WO06 O2 / Gate 13: a missing file co-locates with whichever convention
// file already exists, first-in-CONVENTION_NAMES-order — NOT "docs/tasks/"
// unconditionally, and NOT the root.
#[test]
fn tasks_scan_missing_file_co_locates_with_first_existing_convention_file() {
    let dir = temp_project("scan-colocate");
    fs::create_dir_all(dir.join("docs/tasks")).unwrap();
    fs::write(dir.join("docs/tasks/TASKS.md"), "- [ ] a\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root).unwrap();
    // BUGS.md (index 4) is missing; TASKS.md (index 0, first in
    // CONVENTION_NAMES order) is the only file that exists, at docs/tasks/.
    let bugs = scan.files.iter().find(|f| f.rel_path.ends_with("BUGS.md")).unwrap();
    assert!(!bugs.exists);
    assert_eq!(bugs.rel_path, "docs/tasks/BUGS.md");
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

// F6 (e), part 1: appending (free text, via `task_append`) into a table that
// HAS a Task Type column keeps that column present in the new row's shape —
// blank, like every other cell the free-text grammar can't fill (there is no
// `#type:`-shaped token; §"No auto-mint" already governs id/deps the same
// way for this exact code path).
#[test]
fn task_append_into_table_with_task_type_column_leaves_it_blank() {
    let dir = temp_project("append-table-with-task-type");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Task Type | Priority |\n\
         | --- | --- | --- |\n\
         | Row A | bug | low |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_append(root, "TASKS.md".to_string(), "Row B".to_string()).unwrap();
    assert_eq!(item.name, "Row B");
    assert_eq!(item.task_type, None);

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        "| Name | Task Type | Priority |\n\
         | --- | --- | --- |\n\
         | Row A | bug | low |\n\
         | Row B | | |\n"
    );
    let _ = fs::remove_dir_all(&dir);
}

// F6 (e), part 2: a table with no Task Type column is entirely unaffected —
// same row shape as before this feature existed.
#[test]
fn task_append_into_table_without_task_type_column_is_unaffected() {
    let dir = temp_project("append-table-no-task-type");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Priority |\n\
         | --- | --- |\n\
         | Row A | low |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_append(root, "TASKS.md".to_string(), "Row B".to_string()).unwrap();
    assert_eq!(item.task_type, None);

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        "| Name | Priority |\n\
         | --- | --- |\n\
         | Row A | low |\n\
         | Row B | |\n"
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
        task_type: None,
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
        task_type: None,
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

// F6 (d): a task_type-only patch rewrites ONLY the Task Type cell — every
// other cell, including the unmapped Notes column, is byte-identical.
#[test]
fn task_update_task_type_patch_rewrites_only_that_cell() {
    let dir = temp_project("update-task-type-cell");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Task Type | Notes | Priority |\n| --- | --- | --- | --- |\n\
         | Old Name | bug |   keep me exactly  | P2 |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let patch = TaskPatch {
        name: Some("Old Name".to_string()),
        priority: Some("P2".to_string()),
        task_type: Some("feature".to_string()),
        ..Default::default()
    };
    let updated = task_update(root, "TASKS.md".to_string(), 3, patch).unwrap();
    assert_eq!(updated.task_type.as_deref(), Some("feature"));

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        "| Name | Task Type | Notes | Priority |\n| --- | --- | --- | --- |\n\
         | Old Name | feature |   keep me exactly  | medium |\n"
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

// =============================================================================
// WO06 §3.1 — reserved tag namespace: lifting on read
// =============================================================================

#[test]
fn reserved_tokens_lifted_from_table_tags_cell() {
    let content = "| Name | Tags |\n| --- | --- |\n| Task | id:t-abc123, needs:t-def456, backend |\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].task_id.as_deref(), Some("t-abc123"));
    assert_eq!(tasks[0].depends_on, vec!["t-def456".to_string()]);
    assert_eq!(tasks[0].tags, vec!["backend".to_string()]);
}

#[test]
fn reserved_tokens_lifted_from_checklist_hash_tokens() {
    let content = "- [ ] Task #id:t-abc123 #needs:t-def456 #backend\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].task_id.as_deref(), Some("t-abc123"));
    assert_eq!(tasks[0].depends_on, vec!["t-def456".to_string()]);
    assert_eq!(tasks[0].tags, vec!["backend".to_string()]);
}

// R5: "nothing else is an id" — a malformed id:/needs:-shaped word is left
// as an ordinary user tag, not silently dropped.
#[test]
fn malformed_reserved_shaped_token_is_left_as_ordinary_tag() {
    let content = "- [ ] Task #id:not-an-id #needs:also-bad\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks[0].task_id, None);
    assert!(tasks[0].depends_on.is_empty());
    assert_eq!(tasks[0].tags, vec!["id:not-an-id".to_string(), "needs:also-bad".to_string()]);
}

// Gate 10 (task-corpus regression), narrow form: every task parsed from
// content with no reserved-shaped tokens at all reports `taskId: null`,
// `dependsOn: []`, `blocked: false` — the two new fields default empty and
// every existing field is untouched.
#[test]
fn plain_existing_style_tasks_default_task_id_and_depends_on_empty() {
    let content = "| Name | Tags | Priority |\n| --- | --- | --- |\n| Ship it | backend, urgent | P1 |\n";
    let tasks = parse_tasks("TASKS.md", content);
    assert_eq!(tasks[0].task_id, None);
    assert!(tasks[0].depends_on.is_empty());
    assert!(!tasks[0].blocked);
    assert_eq!(tasks[0].tags, vec!["backend".to_string(), "urgent".to_string()]);
}

// Gate 10, the real thing: every task in THIS repo's own five convention
// files parses with `taskId: null`, `dependsOn: []` today — WO06 landing
// must not silently mint or misparse anything already on disk. (If a real
// id ever gets minted into one of these files down the line, this test's
// job is done and it should be narrowed or removed — that is expected
// product evolution, not a regression.)
#[test]
fn real_repo_task_corpus_has_no_reserved_tokens_yet() {
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    let scan = tasks_scan(repo_root.to_string_lossy().into_owned()).unwrap();
    for t in &scan.tasks {
        assert_eq!(t.task_id, None, "unexpected task_id on {}#{}", t.rel_path, t.line);
        assert!(t.depends_on.is_empty(), "unexpected depends_on on {}#{}", t.rel_path, t.line);
    }
}

// =============================================================================
// WO06 §3.1 — task_id_ensure (minting)
// =============================================================================

fn assert_valid_task_id(id: &str) {
    assert_eq!(id.len(), 8, "id {id} should be 8 chars");
    assert!(id.starts_with("t-"), "id {id} should start with t-");
    assert!(
        id[2..].chars().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase()),
        "id {id} suffix should be base36 lower-case"
    );
}

#[test]
fn task_id_ensure_mints_and_is_idempotent() {
    let dir = temp_project("id-ensure-checklist");
    fs::write(dir.join("TASKS.md"), "- [ ] Ship it\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let first = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let id = first.task_id.clone().unwrap();
    assert_valid_task_id(&id);
    let after_first = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(after_first, format!("- [ ] Ship it #id:{id}\n"));

    // Idempotent: already has an id, unchanged, no second write.
    let second = task_id_ensure(root, "TASKS.md".to_string(), 1).unwrap();
    assert_eq!(second.task_id.as_deref(), Some(id.as_str()));
    let after_second = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(after_second, after_first);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_id_ensure_table_row_without_tags_column_errors() {
    let dir = temp_project("id-ensure-no-tags-col");
    fs::write(dir.join("TASKS.md"), "| Name |\n| --- |\n| Task A |\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_id_ensure(root, "TASKS.md".to_string(), 3).unwrap_err();
    assert!(err.contains("no Tags column"), "unexpected error: {err}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_id_ensure_table_row_preserves_unmapped_cells_byte_exact() {
    let dir = temp_project("id-ensure-table-unmapped");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Notes | Tags |\n| --- | --- | --- |\n| Task A |   keep me exactly  | existing |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_id_ensure(root, "TASKS.md".to_string(), 3).unwrap();
    let id = item.task_id.clone().unwrap();
    assert_eq!(item.tags, vec!["existing".to_string()]);
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk,
        format!("| Name | Notes | Tags |\n| --- | --- | --- |\n| Task A |   keep me exactly  | id:{id}, existing |\n")
    );
    let _ = fs::remove_dir_all(&dir);
}

// No pre-existing tag words: the minted id is appended at the true end of
// the checklist line (documented judgment call — not spliced in ahead of
// `@agent`/priority, since there's no tag-run position to splice into).
#[test]
fn task_id_ensure_checklist_appends_at_end_when_no_existing_tags() {
    let dir = temp_project("id-ensure-checklist-no-tags");
    fs::write(dir.join("TASKS.md"), "- [ ] Ship it @tech-general !high\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_id_ensure(root, "TASKS.md".to_string(), 1).unwrap();
    let id = item.task_id.clone().unwrap();
    assert_eq!(item.agent.as_deref(), Some("tech-general"));
    assert_eq!(item.priority.as_deref(), Some("high"));
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, format!("- [ ] Ship it @tech-general !high #id:{id}\n"));
    let _ = fs::remove_dir_all(&dir);
}

// Existing tag words: the minted id splices in at the tag run's position,
// preserving every other word (including the checkbox and `@agent`) byte-
// exact.
#[test]
fn task_id_ensure_checklist_splices_at_existing_tag_run_position() {
    let dir = temp_project("id-ensure-checklist-splice");
    fs::write(dir.join("TASKS.md"), "- [ ] Ship it #backend @tech-general\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_id_ensure(root, "TASKS.md".to_string(), 1).unwrap();
    let id = item.task_id.clone().unwrap();
    assert_eq!(item.tags, vec!["backend".to_string()]);
    assert_eq!(item.agent.as_deref(), Some("tech-general"));
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, format!("- [ ] Ship it #id:{id} #backend @tech-general\n"));
    let _ = fs::remove_dir_all(&dir);
}

// =============================================================================
// WO06 §3.3 D3 — task_depends_add: four distinct rejections + idempotent add
// =============================================================================

#[test]
fn task_depends_add_rejects_malformed_id() {
    let dir = temp_project("depends-add-malformed");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_depends_add(root, "TASKS.md".to_string(), 1, "not-an-id".to_string()).unwrap_err();
    assert_eq!(err, "not-an-id: not a valid task id");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_depends_add_rejects_self_dependency() {
    let dir = temp_project("depends-add-self");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let id = item.task_id.unwrap();
    let err = task_depends_add(root, "TASKS.md".to_string(), 1, id.clone()).unwrap_err();
    assert_eq!(err, format!("a task cannot depend on itself: {id}"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_depends_add_rejects_unknown_id() {
    let dir = temp_project("depends-add-unknown");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let err = task_depends_add(root, "TASKS.md".to_string(), 1, "t-zzzzzz".to_string()).unwrap_err();
    assert_eq!(err, "t-zzzzzz: no task has this id");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_depends_add_rejects_duplicated_id() {
    let dir = temp_project("depends-add-duplicate");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Tags |\n| --- | --- |\n\
         | Row1 | id:t-dupdup |\n\
         | Row2 | id:t-dupdup |\n\
         | Row3 | |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let err = task_depends_add(root, "TASKS.md".to_string(), 5, "t-dupdup".to_string()).unwrap_err();
    assert_eq!(err, "t-dupdup: this id is assigned to more than one task — resolve the duplicate first");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_depends_add_rejects_cycle_with_ordered_path() {
    let dir = temp_project("depends-add-cycle");
    fs::write(dir.join("TASKS.md"), "- [ ] Task A\n- [ ] Task B\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let a = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let a_id = a.task_id.unwrap();
    let b = task_id_ensure(root.clone(), "TASKS.md".to_string(), 2).unwrap();
    let b_id = b.task_id.unwrap();

    // A needs B.
    task_depends_add(root.clone(), "TASKS.md".to_string(), 1, b_id.clone()).unwrap();
    // B needs A would close the cycle.
    let err = task_depends_add(root, "TASKS.md".to_string(), 2, a_id.clone()).unwrap_err();
    assert_eq!(err, format!("adding needs:{a_id} would create a cycle: {b_id} -> {a_id} -> {b_id}"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_depends_add_is_idempotent_when_already_present() {
    let dir = temp_project("depends-add-idempotent");
    fs::write(dir.join("TASKS.md"), "- [ ] Task A\n- [ ] Task B\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let b = task_id_ensure(root.clone(), "TASKS.md".to_string(), 2).unwrap();
    let b_id = b.task_id.unwrap();

    task_depends_add(root.clone(), "TASKS.md".to_string(), 1, b_id.clone()).unwrap();
    let after_first = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    let again = task_depends_add(root, "TASKS.md".to_string(), 1, b_id.clone()).unwrap();
    assert_eq!(again.depends_on, vec![b_id]);
    let after_second = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(after_first, after_second);
    let _ = fs::remove_dir_all(&dir);
}

// =============================================================================
// WO06 §7 — task_depends_remove
// =============================================================================

#[test]
fn task_depends_remove_is_noop_for_absent_dep() {
    let dir = temp_project("depends-remove-noop");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let item = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let before = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    let after = task_depends_remove(root, "TASKS.md".to_string(), 1, "t-zzzzzz".to_string()).unwrap();
    assert_eq!(after.task_id, item.task_id);
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, before);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn task_depends_remove_removes_and_preserves_other_tags() {
    let dir = temp_project("depends-remove-ok");
    fs::write(dir.join("TASKS.md"), "- [ ] Task A #backend\n- [ ] Task B\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let a = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let a_id = a.task_id.unwrap();
    let b = task_id_ensure(root.clone(), "TASKS.md".to_string(), 2).unwrap();
    let b_id = b.task_id.unwrap();
    task_depends_add(root.clone(), "TASKS.md".to_string(), 1, b_id.clone()).unwrap();

    let removed = task_depends_remove(root, "TASKS.md".to_string(), 1, b_id.clone()).unwrap();
    assert!(removed.depends_on.is_empty());
    assert_eq!(removed.tags, vec!["backend".to_string()]);
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, format!("- [ ] Task A #id:{a_id} #backend\n- [ ] Task B #id:{b_id}\n"));
    let _ = fs::remove_dir_all(&dir);
}

// =============================================================================
// WO06 §3.3 — tasks_scan: dag (cycles/duplicates/unresolved) + blocked
// =============================================================================

// Gate 5: a fixture file hand-authored with `A needs:B, B needs:A` still
// scans successfully (never fatal — D2) and reports the cycle in
// `dag.cycles`, with a deterministic node order across 100 repeated runs.
#[test]
fn tasks_scan_reports_hand_authored_cycle_deterministically() {
    let dir = temp_project("scan-cycle");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Tags |\n| --- | --- |\n\
         | Task A | id:t-aaaaaa, needs:t-bbbbbb |\n\
         | Task B | id:t-bbbbbb, needs:t-aaaaaa |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let mut first: Option<Vec<Vec<String>>> = None;
    for _ in 0..100 {
        let scan = tasks_scan(root.clone()).unwrap();
        assert_eq!(scan.dag.cycles.len(), 1);
        let cycle = &scan.dag.cycles[0];
        assert_eq!(cycle.first(), cycle.last());
        assert_eq!(cycle.len(), 3);
        match &first {
            None => first = Some(scan.dag.cycles.clone()),
            Some(prev) => assert_eq!(prev, &scan.dag.cycles, "cycle report not deterministic across runs"),
        }
        for t in &scan.tasks {
            assert!(t.blocked, "{} should be blocked (in cycle)", t.name);
        }
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn tasks_scan_duplicate_ids_reported() {
    let dir = temp_project("scan-duplicate");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Tags |\n| --- | --- |\n| Row1 | id:t-dupdup |\n| Row2 | id:t-dupdup |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root).unwrap();
    assert_eq!(scan.dag.duplicate_ids, vec!["t-dupdup".to_string()]);
    let _ = fs::remove_dir_all(&dir);
}

// D1: an unresolved dependency (typo, or a target that was never minted)
// is reported but never blocks — a typo must not deadlock the board.
#[test]
fn tasks_scan_unresolved_dependency_reported_but_not_blocking() {
    let dir = temp_project("scan-unresolved");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo #id:t-cccccc #needs:t-zzzzzz\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root).unwrap();
    assert_eq!(scan.dag.unresolved.len(), 1);
    assert_eq!(scan.dag.unresolved[0].task_id, "t-cccccc");
    assert_eq!(scan.dag.unresolved[0].depends_on, "t-zzzzzz");
    assert!(scan.dag.cycles.is_empty());
    assert!(!scan.tasks[0].blocked);
    let _ = fs::remove_dir_all(&dir);
}

// O1 fix (§3.1 R6): a task with NO `id:` of its own must never be reported
// in `dag.unresolved` under its volatile `TaskItem.id` locator (that field
// is documented as a stable id and the UI renders it as one) — it is
// simply omitted, even though its own `depends_on` still resolves the
// dangling target correctly.
#[test]
fn tasks_scan_omits_unresolved_dep_for_task_with_no_stable_id() {
    let dir = temp_project("scan-unresolved-idless");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo #needs:t-zzzzzz\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root).unwrap();
    assert!(scan.tasks[0].task_id.is_none(), "fixture must stay id-less");
    assert_eq!(scan.tasks[0].depends_on, vec!["t-zzzzzz".to_string()]);
    assert!(
        scan.dag.unresolved.is_empty(),
        "an id-less task's unresolved needs: must not surface under a locator: {:?}",
        scan.dag.unresolved
    );
    assert!(!scan.tasks[0].blocked, "unresolved never blocks (D1)");
    let _ = fs::remove_dir_all(&dir);
}

// O1: an id-less task's unresolved dep is omitted even alongside a
// same-scan task that DOES carry a stable id — the two must not interact.
#[test]
fn tasks_scan_unresolved_mixes_stable_and_idless_tasks_correctly() {
    let dir = temp_project("scan-unresolved-mixed");
    fs::write(
        dir.join("TASKS.md"),
        "- [ ] Has id #id:t-aaaaaa #needs:t-zzzzzz\n- [ ] No id #needs:t-yyyyyy\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root).unwrap();
    assert_eq!(scan.dag.unresolved.len(), 1, "only the stable-id task's unresolved dep is reported");
    assert_eq!(scan.dag.unresolved[0].task_id, "t-aaaaaa");
    assert_eq!(scan.dag.unresolved[0].depends_on, "t-zzzzzz");
    let _ = fs::remove_dir_all(&dir);
}

// D1: blocked reflects the dependency's live status, flipping to false the
// moment the dependency is marked done.
#[test]
fn tasks_scan_blocked_reflects_dependency_status_and_clears_when_done() {
    let dir = temp_project("scan-blocked-status");
    fs::write(
        dir.join("TASKS.md"),
        "| Name | Status | Tags |\n| --- | --- | --- |\n\
         | Dep | new | id:t-depdep |\n\
         | Main | new | needs:t-depdep |\n",
    )
    .unwrap();
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root.clone()).unwrap();
    let main = scan.tasks.iter().find(|t| t.name == "Main").unwrap();
    assert!(main.blocked);

    // Mark the dependency done, then rescan.
    let patch = TaskPatch { name: Some("Dep".to_string()), status: Some("done".to_string()), ..Default::default() };
    task_update(root.clone(), "TASKS.md".to_string(), 3, patch).unwrap();

    let scan2 = tasks_scan(root).unwrap();
    let main2 = scan2.tasks.iter().find(|t| t.name == "Main").unwrap();
    assert!(!main2.blocked);
    let _ = fs::remove_dir_all(&dir);
}

// =============================================================================
// WO06 §3.1 R3/R4 — TaskPatch validation + reserved-token round-trip
// through a full task_update patch (Gate 11)
// =============================================================================

#[test]
fn task_update_rejects_reserved_prefix_in_patch_tags() {
    let dir = temp_project("update-reserved-rejected");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let patch = TaskPatch {
        name: Some("Solo".to_string()),
        tags: Some(vec!["id:t-aaaaaa".to_string()]),
        ..Default::default()
    };
    let err = task_update(root.clone(), "TASKS.md".to_string(), 1, patch).unwrap_err();
    assert_eq!(err, "reserved tag prefix in patch.tags: id:t-aaaaaa");

    let patch2 = TaskPatch {
        name: Some("Solo".to_string()),
        tags: Some(vec!["needs:t-bbbbbb".to_string()]),
        ..Default::default()
    };
    let err2 = task_update(root, "TASKS.md".to_string(), 1, patch2).unwrap_err();
    assert_eq!(err2, "reserved tag prefix in patch.tags: needs:t-bbbbbb");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn gate11_reserved_tokens_survive_full_ui_patch_table_row() {
    let dir = temp_project("gate11-table");
    fs::write(dir.join("BACKLOG.md"), "| Name | Tags |\n| --- | --- |\n| Dep task | |\n| Main task | |\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let dep = task_id_ensure(root.clone(), "BACKLOG.md".to_string(), 3).unwrap();
    let dep_id = dep.task_id.unwrap();
    let main = task_id_ensure(root.clone(), "BACKLOG.md".to_string(), 4).unwrap();
    let main_id = main.task_id.unwrap();
    let added = task_depends_add(root.clone(), "BACKLOG.md".to_string(), 4, dep_id.clone()).unwrap();
    assert_eq!(added.depends_on, vec![dep_id.clone()]);

    let patch = TaskPatch {
        name: Some("Main task renamed".to_string()),
        tags: Some(vec!["backend".to_string()]),
        ..Default::default()
    };
    let updated = task_update(root, "BACKLOG.md".to_string(), 4, patch).unwrap();
    assert_eq!(updated.task_id.as_deref(), Some(main_id.as_str()));
    assert_eq!(updated.depends_on, vec![dep_id.clone()]);
    assert_eq!(updated.tags, vec!["backend".to_string()]);

    let on_disk = fs::read_to_string(dir.join("BACKLOG.md")).unwrap();
    assert!(
        on_disk.contains(&format!("id:{main_id}, needs:{dep_id}, backend")),
        "on disk: {on_disk}"
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn gate11_reserved_tokens_survive_full_ui_patch_checklist_line() {
    let dir = temp_project("gate11-checklist");
    fs::write(dir.join("TASKS.md"), "- [ ] Dep task\n- [ ] Main task\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let dep = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let dep_id = dep.task_id.unwrap();
    let main = task_id_ensure(root.clone(), "TASKS.md".to_string(), 2).unwrap();
    let main_id = main.task_id.unwrap();
    task_depends_add(root.clone(), "TASKS.md".to_string(), 2, dep_id.clone()).unwrap();

    let patch = TaskPatch {
        name: Some("Main renamed".to_string()),
        tags: Some(vec!["ux".to_string()]),
        agent: Some("tech-ui".to_string()),
        priority: Some("high".to_string()),
        ..Default::default()
    };
    let updated = task_update(root, "TASKS.md".to_string(), 2, patch).unwrap();
    assert_eq!(updated.task_id.as_deref(), Some(main_id.as_str()));
    assert_eq!(updated.depends_on, vec![dep_id.clone()]);
    assert_eq!(updated.tags, vec!["ux".to_string()]);
    assert_eq!(updated.agent.as_deref(), Some("tech-ui"));
    assert_eq!(updated.priority.as_deref(), Some("high"));

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    let expected_line = format!("- [ ] Main renamed #id:{main_id} #needs:{dep_id} #ux @tech-ui !high\n");
    assert!(on_disk.ends_with(&expected_line), "on disk: {on_disk}");
    let _ = fs::remove_dir_all(&dir);
}

// =============================================================================
// D7 fix regression — minting into a boundary-less/early-period checklist
// line must not leak the reserved token into name/description, and a
// mint -> update -> update round-trip must stay stable (no growth).
// =============================================================================

#[test]
fn d7_mint_into_boundary_less_checklist_line_stays_stable_across_updates() {
    let dir = temp_project("d7-boundary-less");
    fs::write(dir.join("TASKS.md"), "- [ ] Wire the hooks server\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let minted = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let id = minted.task_id.clone().unwrap();
    assert_eq!(minted.name, "Wire the hooks server", "D7: minted token must not leak into name");
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, format!("- [ ] Wire the hooks server #id:{id}\n"));

    // UI round-trip #1: TaskPanel prefills from `minted.name` and saves it back.
    let patch = TaskPatch { name: Some(minted.name.clone()), ..Default::default() };
    let updated = task_update(root.clone(), "TASKS.md".to_string(), 1, patch).unwrap();
    assert_eq!(updated.name, "Wire the hooks server");
    assert_eq!(updated.task_id.as_deref(), Some(id.as_str()));
    let on_disk2 = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk2, format!("- [ ] Wire the hooks server #id:{id}\n"), "no duplication after save #1");

    // UI round-trip #2: same again — must stay stable, not grow a second copy.
    let patch2 = TaskPatch { name: Some(updated.name.clone()), ..Default::default() };
    let updated2 = task_update(root, "TASKS.md".to_string(), 1, patch2).unwrap();
    assert_eq!(updated2.name, "Wire the hooks server");
    let on_disk3 = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk3, format!("- [ ] Wire the hooks server #id:{id}\n"), "no duplication after save #2");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn d7_mint_into_checklist_line_with_early_period_keeps_token_out_of_description() {
    let dir = temp_project("d7-early-period");
    fs::write(dir.join("TASKS.md"), "- [ ] v1.2 release notes\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let minted = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let id = minted.task_id.clone().unwrap();
    assert_eq!(minted.name, "v1");
    assert_eq!(
        minted.description.as_deref(),
        Some("2 release notes"),
        "D7: minted token must not leak into description"
    );
    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, format!("- [ ] v1.2 release notes #id:{id}\n"));

    let patch = TaskPatch {
        name: Some(minted.name.clone()),
        description: minted.description.clone(),
        ..Default::default()
    };
    let updated = task_update(root, "TASKS.md".to_string(), 1, patch).unwrap();
    assert_eq!(updated.description.as_deref(), Some("2 release notes"));
    let on_disk2 = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(
        on_disk2,
        format!("- [ ] v1 — 2 release notes #id:{id}\n"),
        "single copy of the token, description clean"
    );
    let _ = fs::remove_dir_all(&dir);
}

// =============================================================================
// WO06 O2 — missing convention file co-locates, never lands at repo root
// =============================================================================

#[test]
fn o2_creates_missing_file_colocated_with_existing_convention_file() {
    let dir = temp_project("o2-colocate");
    fs::create_dir_all(dir.join("docs/tasks")).unwrap();
    fs::write(dir.join("docs/tasks/TASKS.md"), "- [ ] a\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root.clone()).unwrap();
    let bugs_rel = scan.files.iter().find(|f| f.rel_path.ends_with("BUGS.md")).unwrap().rel_path.clone();
    assert_eq!(bugs_rel, "docs/tasks/BUGS.md");

    let item = task_append(root, bugs_rel, "new bug".to_string()).unwrap();
    assert_eq!(item.rel_path, "docs/tasks/BUGS.md");
    let on_disk = fs::read_to_string(dir.join("docs/tasks/BUGS.md")).unwrap();
    assert!(on_disk.contains("new bug"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn o2_creates_missing_file_at_docs_tasks_when_project_is_empty() {
    let dir = temp_project("o2-empty");
    let root = dir.to_string_lossy().into_owned();

    let scan = tasks_scan(root.clone()).unwrap();
    let bugs_rel = scan.files.iter().find(|f| f.rel_path.ends_with("BUGS.md")).unwrap().rel_path.clone();
    assert_eq!(bugs_rel, "docs/tasks/BUGS.md");

    let item = task_append(root, bugs_rel, "first bug".to_string()).unwrap();
    assert_eq!(item.rel_path, "docs/tasks/BUGS.md");
    let on_disk = fs::read_to_string(dir.join("docs/tasks/BUGS.md")).unwrap();
    assert!(on_disk.contains("first bug"));
    let _ = fs::remove_dir_all(&dir);
}

// =============================================================================
// WO06 O3 — task_move preserves status (not hardcoded "new") + reserved
// tokens, across all four source/target shape combinations (Gate 14/11)
// =============================================================================

#[test]
fn o3_done_table_row_moved_into_table_target_preserves_status_and_id() {
    let dir = temp_project("o3-table-table");
    fs::write(dir.join("SPRINT.md"), "| Name | Status | Tags |\n| --- | --- | --- |\n| Old | new | keep |\n").unwrap();
    fs::write(dir.join("BACKLOG.md"), "| Name | Status | Tags |\n| --- | --- | --- |\n| Ship it | done | |\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let minted = task_id_ensure(root.clone(), "BACKLOG.md".to_string(), 3).unwrap();
    let id = minted.task_id.unwrap();

    let moved = task_move(root, "BACKLOG.md".to_string(), 3, "SPRINT.md".to_string()).unwrap();
    assert_eq!(moved.status.as_deref(), Some("done"));
    assert!(moved.done);
    assert_eq!(moved.task_id.as_deref(), Some(id.as_str()));

    let on_disk = fs::read_to_string(dir.join("SPRINT.md")).unwrap();
    assert_eq!(
        on_disk,
        format!("| Name | Status | Tags |\n| --- | --- | --- |\n| Old | new | keep |\n| Ship it | done | id:{id} |\n")
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn o3_done_table_row_moved_into_checklist_target_preserves_status_and_id() {
    let dir = temp_project("o3-table-checklist");
    fs::write(dir.join("BACKLOG.md"), "| Name | Status | Tags |\n| --- | --- | --- |\n| Ship it | done | |\n").unwrap();
    fs::write(dir.join("TASKS.md"), "- [ ] already here\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let minted = task_id_ensure(root.clone(), "BACKLOG.md".to_string(), 3).unwrap();
    let id = minted.task_id.unwrap();

    let moved = task_move(root, "BACKLOG.md".to_string(), 3, "TASKS.md".to_string()).unwrap();
    assert_eq!(moved.status.as_deref(), Some("done"));
    assert!(moved.done);
    assert_eq!(moved.task_id.as_deref(), Some(id.as_str()));

    let on_disk = fs::read_to_string(dir.join("TASKS.md")).unwrap();
    assert_eq!(on_disk, format!("- [ ] already here\n- [x] Ship it #id:{id}\n"));
    let _ = fs::remove_dir_all(&dir);
}

// D7 FIX (was: a checklist source with no dash/period boundary swallowed
// its trailing `#id:…` token into `name` verbatim, since `split_name_desc`
// ran on text that still contained it). `parse_checklist_line` now strips
// well-formed reserved tokens out of the prose BEFORE the boundary search
// (`strip_reserved_tokens`), so `task_move`'s reparse-then-recompose path
// carries a clean `name` and the target line is written once, not doubled.
#[test]
fn o3_checklist_row_moved_into_table_target_preserves_id() {
    let dir = temp_project("o3-checklist-table");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo\n").unwrap();
    fs::write(dir.join("BACKLOG.md"), "| Name | Tags |\n| --- | --- |\n| Old | keep |\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let minted = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let id = minted.task_id.unwrap();
    assert_eq!(minted.name, "Solo", "D7: the minted token must not leak into name");

    let moved = task_move(root, "TASKS.md".to_string(), 1, "BACKLOG.md".to_string()).unwrap();
    assert_eq!(moved.task_id.as_deref(), Some(id.as_str()));
    assert_eq!(moved.name, "Solo");

    let on_disk = fs::read_to_string(dir.join("BACKLOG.md")).unwrap();
    assert_eq!(
        on_disk,
        format!("| Name | Tags |\n| --- | --- |\n| Old | keep |\n| Solo | id:{id} |\n")
    );
    let _ = fs::remove_dir_all(&dir);
}

// D7 FIX (was: the same swallow-into-`name` caveat as above, compounded by
// `compose_checklist_text` re-appending the separately-extracted `task_id`
// as its own `#id:…` token — a checklist-to-checklist move of a freshly-
// minted, no-boundary source used to visibly double the token text).
#[test]
fn o3_checklist_row_moved_into_checklist_target_preserves_id() {
    let dir = temp_project("o3-checklist-checklist");
    fs::write(dir.join("TASKS.md"), "- [ ] Solo2\n").unwrap();
    fs::write(dir.join("SPRINT.md"), "- [ ] already\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let minted = task_id_ensure(root.clone(), "TASKS.md".to_string(), 1).unwrap();
    let id = minted.task_id.unwrap();
    assert_eq!(minted.name, "Solo2", "D7: the minted token must not leak into name");

    let moved = task_move(root, "TASKS.md".to_string(), 1, "SPRINT.md".to_string()).unwrap();
    assert_eq!(moved.task_id.as_deref(), Some(id.as_str()));
    assert_eq!(moved.name, "Solo2");

    let on_disk = fs::read_to_string(dir.join("SPRINT.md")).unwrap();
    assert_eq!(on_disk, format!("- [ ] already\n- [ ] Solo2 #id:{id}\n"));
    let _ = fs::remove_dir_all(&dir);
}

// Gate 14, the literal example: a `done` row moved from TASKS.md to
// BACKLOG.md (both tableless checklist files) arrives `done`, not `new`.
#[test]
fn o3_done_checklist_row_moved_arrives_done() {
    let dir = temp_project("o3-checklist-done");
    fs::write(dir.join("TASKS.md"), "- [x] Finished thing\n").unwrap();
    fs::write(dir.join("BACKLOG.md"), "- [ ] already here\n").unwrap();
    let root = dir.to_string_lossy().into_owned();

    let moved = task_move(root, "TASKS.md".to_string(), 1, "BACKLOG.md".to_string()).unwrap();
    assert_eq!(moved.status.as_deref(), Some("done"));
    assert!(moved.done);
    let on_disk = fs::read_to_string(dir.join("BACKLOG.md")).unwrap();
    assert_eq!(on_disk, "- [ ] already here\n- [x] Finished thing\n");
    let _ = fs::remove_dir_all(&dir);
}
