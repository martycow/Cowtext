use super::*;
use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind, RenameMode};
use std::cell::Cell;
use std::path::Path;

#[test]
fn kind_merge_precedence_table() {
    use FsChangeKind::{Create, Modify, Remove};
    // Create + Modify = Create (either order).
    assert_eq!(merge_kind(Create, Modify), Create);
    assert_eq!(merge_kind(Modify, Create), Create);
    // * + Remove = Remove.
    assert_eq!(merge_kind(Create, Remove), Remove);
    assert_eq!(merge_kind(Modify, Remove), Remove);
    assert_eq!(merge_kind(Remove, Remove), Remove);
    // Remove + (Create|Modify) = Modify.
    assert_eq!(merge_kind(Remove, Create), Modify);
    assert_eq!(merge_kind(Remove, Modify), Modify);
    // Otherwise the newer kind wins.
    assert_eq!(merge_kind(Create, Create), Create);
    assert_eq!(merge_kind(Modify, Modify), Modify);
}

#[test]
fn rel_path_normalizes_to_forward_slashes() {
    let root = Path::new("C:\\proj");
    let path = Path::new("C:\\proj\\docs\\deep\\notes.md");
    assert_eq!(
        rel_path_of(root, path).as_deref(),
        Some("docs/deep/notes.md")
    );

    // A path outside root yields None.
    let outside = Path::new("C:\\other\\notes.md");
    assert_eq!(rel_path_of(root, outside), None);
}

#[test]
fn classify_filters_via_is_scannable_md_and_maps_kind() {
    let root = Path::new("C:\\proj");

    // Relevant .md under root, ordinary create.
    let ok = classify(
        root,
        Path::new("C:\\proj\\docs\\notes.md"),
        &EventKind::Create(CreateKind::File),
    );
    assert_eq!(ok, Some(("docs/notes.md".to_string(), FsChangeKind::Create)));

    // Skip-dir rejected by is_scannable_md even though it's a real event.
    let skipped = classify(
        root,
        Path::new("C:\\proj\\node_modules\\a\\b.md"),
        &EventKind::Modify(ModifyKind::Any),
    );
    assert_eq!(skipped, None);

    // Dot-dir outside the .claude/agents special case rejected.
    let dotdir = classify(
        root,
        Path::new("C:\\proj\\.claude\\settings.md"),
        &EventKind::Modify(ModifyKind::Any),
    );
    assert_eq!(dotdir, None);

    // .claude/agents/*.md is the one dot-dir exception.
    let agent = classify(
        root,
        Path::new("C:\\proj\\.claude\\agents\\tech-lead.md"),
        &EventKind::Remove(RemoveKind::File),
    );
    assert_eq!(
        agent,
        Some((".claude/agents/tech-lead.md".to_string(), FsChangeKind::Remove))
    );

    // Non-.md file, otherwise relevant, rejected.
    let non_md = classify(
        root,
        Path::new("C:\\proj\\src\\main.rs"),
        &EventKind::Create(CreateKind::File),
    );
    assert_eq!(non_md, None);

    // Access events are ignored regardless of path.
    let access = classify(
        root,
        Path::new("C:\\proj\\docs\\notes.md"),
        &EventKind::Access(AccessKind::Read),
    );
    assert_eq!(access, None);
}

#[test]
fn windows_rename_from_maps_to_remove_not_modify() {
    // notify-8.2.0's Windows (ReadDirectoryChangesW) backend reports
    // FILE_ACTION_RENAMED_OLD_NAME as Modify(Name(From)) carrying only the
    // vanished old path (src/windows.rs:425-436). Left on the old catch-all
    // this mapped to Modify, which made applyFsChange treat the vanished
    // path as "still there, just edited" — a ghost node that never clears
    // because the store never rescans.
    assert_eq!(
        map_event_kind(&EventKind::Modify(ModifyKind::Name(RenameMode::From))),
        Some(FsChangeKind::Remove)
    );
}

#[test]
fn windows_rename_to_maps_to_create() {
    // The paired FILE_ACTION_RENAMED_NEW_NAME event carries only the path
    // that now exists — treat it the same as a fresh Create so an unknown
    // relPath is inserted rather than silently falling through as an
    // untargeted Modify.
    assert_eq!(
        map_event_kind(&EventKind::Modify(ModifyKind::Name(RenameMode::To))),
        Some(FsChangeKind::Create)
    );
}

#[test]
fn classify_maps_windows_rename_halves_through_the_full_pipeline() {
    let root = Path::new("C:\\proj");

    let from = classify(
        root,
        Path::new("C:\\proj\\docs\\old-name.md"),
        &EventKind::Modify(ModifyKind::Name(RenameMode::From)),
    );
    assert_eq!(
        from,
        Some(("docs/old-name.md".to_string(), FsChangeKind::Remove))
    );

    let to = classify(
        root,
        Path::new("C:\\proj\\docs\\new-name.md"),
        &EventKind::Modify(ModifyKind::Name(RenameMode::To)),
    );
    assert_eq!(
        to,
        Some(("docs/new-name.md".to_string(), FsChangeKind::Create))
    );
}

#[test]
fn stale_generation_is_dropped() {
    // The debounce task captured generation 0; a later restart bumped the
    // state to generation 1 — the flush must recognize itself as stale.
    assert!(!is_current_generation(Some(1), 0));
    assert!(is_current_generation(Some(1), 1));
    // No watcher at all (state cleared) is also stale for any generation.
    assert!(!is_current_generation(None, 0));
}

#[test]
fn merge_pending_keeps_first_insertion_time_and_merges_kind() {
    let mut pending: HashMap<String, (FsChangeKind, Instant)> = HashMap::new();
    merge_pending(&mut pending, "a.md".into(), FsChangeKind::Create);
    let first_ts = pending.get("a.md").unwrap().1;
    merge_pending(&mut pending, "a.md".into(), FsChangeKind::Modify);
    let entry = pending.get("a.md").unwrap();
    assert_eq!(entry.0, FsChangeKind::Create); // Create + Modify = Create
    assert_eq!(entry.1, first_ts); // insertion time untouched by merges
    assert_eq!(pending.len(), 1);
}

#[test]
fn flush_rechecks_generation_on_every_entry_not_once_for_the_whole_batch() {
    // Simulates `restart()` racing an in-flight flush: the first read of
    // the current generation still sees this task's own generation (0) —
    // the flush had already started before the race — every read after
    // that sees the bumped generation (1) written by `restart()`. The old
    // code read the generation exactly once before the loop, so it would
    // have emitted every entry in the batch regardless of when the race
    // landed; re-checking per entry must stop after the first one.
    let calls = Cell::new(0u32);
    let current_generation = || {
        let n = calls.get();
        calls.set(n + 1);
        if n == 0 {
            Some(0)
        } else {
            Some(1)
        }
    };

    let mut pending: HashMap<String, (FsChangeKind, Instant)> = HashMap::new();
    merge_pending(&mut pending, "a.md".into(), FsChangeKind::Modify);
    merge_pending(&mut pending, "b.md".into(), FsChangeKind::Modify);
    merge_pending(&mut pending, "c.md".into(), FsChangeKind::Modify);

    let mut emitted: Vec<String> = Vec::new();
    flush_with(
        Path::new("C:\\proj"),
        &mut pending,
        0, // this debounce task's captured generation
        current_generation,
        |_| false,
        |change| emitted.push(change.rel_path),
    );

    // Exactly one entry (whichever HashMap iteration visited first) made
    // it out before the simulated generation bump was observed.
    assert_eq!(emitted.len(), 1);
    // The rest were still drained from `pending` — just never emitted —
    // so a stale batch can't wedge the debounce loop.
    assert!(pending.is_empty());
    assert_eq!(calls.get(), 3);
}

#[test]
fn flush_with_emits_every_entry_when_generation_stays_current() {
    let mut pending: HashMap<String, (FsChangeKind, Instant)> = HashMap::new();
    merge_pending(&mut pending, "a.md".into(), FsChangeKind::Remove);
    merge_pending(&mut pending, "b.md".into(), FsChangeKind::Remove);

    let mut emitted: Vec<String> = Vec::new();
    flush_with(
        Path::new("C:\\proj"),
        &mut pending,
        7,
        || Some(7),
        |_| false,
        |change| {
            // Remove always carries None/None regardless of what's on disk.
            assert_eq!(change.modified_ms, None);
            assert_eq!(change.size_bytes, None);
            assert!(!change.self_write);
            emitted.push(change.rel_path);
        },
    );

    emitted.sort();
    assert_eq!(emitted, vec!["a.md".to_string(), "b.md".to_string()]);
}

// --- Self-write registry (WO01 Block C §T4) --------------------------------

#[test]
fn flush_with_tags_self_write_true_when_registry_reports_it() {
    let mut pending: HashMap<String, (FsChangeKind, Instant)> = HashMap::new();
    merge_pending(&mut pending, "a.md".into(), FsChangeKind::Remove);

    let mut tagged = None;
    flush_with(
        Path::new("C:\\proj"),
        &mut pending,
        1,
        || Some(1),
        |_path| true, // registry says: yes, this was our own write
        |change| tagged = Some(change.self_write),
    );

    assert_eq!(tagged, Some(true));
}

#[test]
fn flush_with_tags_self_write_false_for_untouched_registry() {
    let mut pending: HashMap<String, (FsChangeKind, Instant)> = HashMap::new();
    merge_pending(&mut pending, "a.md".into(), FsChangeKind::Remove);

    let mut tagged = None;
    flush_with(
        Path::new("C:\\proj"),
        &mut pending,
        1,
        || Some(1),
        |_path| false, // registry has no entry — a genuine external edit
        |change| tagged = Some(change.self_write),
    );

    assert_eq!(tagged, Some(false));
}

#[test]
fn note_and_take_self_write_round_trip_within_ttl() {
    let path = PathBuf::from(format!("C:\\proj\\note-round-trip-{}.md", std::process::id()));
    note_self_write(&path);
    // Written just now — well within the TTL — and the registry lookup
    // resolves it exactly by that same absolute path.
    assert!(take_self_write(&path));
}

#[test]
fn take_self_write_is_false_for_a_path_never_registered() {
    // An external edit to a path Cowtext never wrote must never be tagged.
    let path = PathBuf::from(format!(
        "C:\\proj\\external-only-{}.md",
        std::process::id()
    ));
    assert!(!take_self_write(&path));
}

#[test]
fn expired_self_write_entry_is_not_tagged() {
    let path = PathBuf::from(format!("C:\\proj\\expired-{}.md", std::process::id()));
    {
        let mut reg = self_write_registry().lock().unwrap();
        // Recorded well past SELF_WRITE_TTL_MS (2500ms) ago — simulated via
        // Instant subtraction rather than an actual multi-second sleep.
        reg.insert(path.clone(), Instant::now() - Duration::from_millis(3000));
    }
    assert!(!take_self_write(&path));
}

#[test]
fn take_self_write_consumes_entry_so_a_later_external_edit_is_not_suppressed() {
    let path = PathBuf::from(format!("C:\\proj\\consume-{}.md", std::process::id()));
    note_self_write(&path);

    // First flush after our own write: tagged self-write, and consumed.
    assert!(take_self_write(&path));
    // A second, later flush for the same path — e.g. a real external edit
    // that landed right after — must NOT still read as self-write just
    // because an old entry happens to still be sitting in the map.
    assert!(!take_self_write(&path));
}

#[test]
fn prune_expired_removes_stale_entries_but_keeps_fresh_ones() {
    let mut reg: HashMap<PathBuf, Instant> = HashMap::new();
    let now = Instant::now();
    reg.insert(PathBuf::from("C:\\proj\\stale.md"), now - Duration::from_millis(3000));
    reg.insert(PathBuf::from("C:\\proj\\fresh.md"), now);

    prune_expired(&mut reg, now);

    assert_eq!(reg.len(), 1);
    assert!(reg.contains_key(&PathBuf::from("C:\\proj\\fresh.md")));
}

#[test]
fn note_self_write_prunes_other_expired_entries_on_insert_so_the_registry_never_leaks() {
    let stale_path = PathBuf::from(format!("C:\\proj\\leak-check-stale-{}.md", std::process::id()));
    {
        let mut reg = self_write_registry().lock().unwrap();
        reg.insert(stale_path.clone(), Instant::now() - Duration::from_millis(3000));
    }

    // A completely unrelated write elsewhere still triggers the prune.
    let other_path = PathBuf::from(format!("C:\\proj\\leak-check-other-{}.md", std::process::id()));
    note_self_write(&other_path);

    let reg = self_write_registry().lock().unwrap();
    assert!(
        !reg.contains_key(&stale_path),
        "expired entry must be pruned on every insert, not just on check"
    );
    assert!(reg.contains_key(&other_path));
}
