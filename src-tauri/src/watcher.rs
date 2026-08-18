//! Real-time file watcher (WO01 Block A §4): watches the current project
//! root recursively via `notify`, hand-rolls a ~300ms debounce, and emits
//! `fs://change` so the frontend can brighten a node without ever rescanning.
//!
//! Lifecycle is a documented side-effect of `scan_project` (§4.2, §9.4/§9.3
//! in the contract) — there is deliberately no `watch_start`/`watch_stop`
//! command. [`restart`] drops the previous watcher (`Drop` = stop), bumps a
//! `generation` counter, and installs the new one. The debounce task
//! captures its generation at spawn time and drops a flush without emitting
//! once the state's current generation has moved on — that is what stops a
//! stale watcher for project A from painting nodes in project B during a
//! project switch.
//!
//! No self-write suppression here (Block C prerequisite, not built): a
//! Cowtext-initiated write also emits `fs://change`. Harmless for the
//! Activity lens the node genuinely changed.

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use crate::project::is_scannable_md;

/// Tauri event channel the frontend listens on (contract §4.1 / §5.1).
const FS_CHANGE_EVENT: &str = "fs://change";

/// Hand-rolled debounce window (contract §4.3). No debouncer crate — those
/// are separate crates and are not approved (see Cargo.toml comment).
const DEBOUNCE_MS: u64 = 300;
/// Starvation guard: flush early once this many paths are pending.
const MAX_PENDING: usize = 64;
/// Starvation guard: flush early once the oldest pending entry is this old.
const MAX_PENDING_AGE_MS: u64 = 1000;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FsChangeKind {
    Modify,
    Create,
    Remove,
}

/// Wire shape, mirrored 1:1 in `src/store/project.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    /// Forward slashes, relative to root — same string `scan_project` emits.
    pub rel_path: String,
    /// null on remove or metadata failure; NEVER skipped.
    pub modified_ms: Option<u64>,
    /// null on remove or metadata failure; NEVER skipped.
    pub size_bytes: Option<u64>,
    pub kind: FsChangeKind,
}

/// One project's active watcher: the notify handle (dropping it stops the
/// OS-level watch) plus the debounce task and the generation it was spawned
/// with.
pub struct ActiveWatcher {
    generation: u64,
    _watcher: RecommendedWatcher,
    task: tauri::async_runtime::JoinHandle<()>,
}

/// Managed Tauri state — one project watched at a time, always the current
/// root. Never `unwrap()` the mutex: a poisoned lock just means "skip this
/// restart", not a crash.
#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<ActiveWatcher>>);

/// Drop the previous watcher (if any, aborting its debounce task too), bump
/// the generation, and install a new recursive watch on `root`. Setup
/// failure is logged to stderr and swallowed — the caller (`scan_project`)
/// must still return its files (same discipline as `hooks_server::start`).
pub fn restart(app: &AppHandle, state: &tauri::State<'_, WatcherState>, root: &str) {
    let Ok(mut guard) = state.0.lock() else {
        eprintln!("cowtext: watcher state mutex poisoned — skipping restart");
        return;
    };

    let next_generation = guard.as_ref().map(|w| w.generation + 1).unwrap_or(0);
    if let Some(prev) = guard.take() {
        prev.task.abort();
        // `prev._watcher` drops here too — that stops the OS-level watch.
    }

    let root_path = PathBuf::from(root);
    let (tx, rx) = mpsc::unbounded_channel::<(String, FsChangeKind)>();

    let cb_root = root_path.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        for path in &event.paths {
            if let Some((rel_path, kind)) = classify(&cb_root, path, &event.kind) {
                let _ = tx.send((rel_path, kind));
            }
        }
    });

    let mut watcher = match watcher {
        Ok(w) => w,
        Err(e) => {
            eprintln!("cowtext: watcher setup failed for {root}: {e}");
            return;
        }
    };
    if let Err(e) = watcher.watch(&root_path, RecursiveMode::Recursive) {
        eprintln!("cowtext: watcher.watch failed for {root}: {e}");
        return;
    }

    let task = tauri::async_runtime::spawn(debounce_loop(
        app.clone(),
        root_path,
        rx,
        next_generation,
    ));

    *guard = Some(ActiveWatcher {
        generation: next_generation,
        _watcher: watcher,
        task,
    });
}

/// Per-event filter + kind mapping, factored out of the notify callback so
/// it can be unit tested without spinning up a real watcher.
fn classify(root: &Path, path: &Path, kind: &EventKind) -> Option<(String, FsChangeKind)> {
    let mapped = map_event_kind(kind)?;
    if !is_scannable_md(root, path) {
        return None;
    }
    let rel_path = rel_path_of(root, path)?;
    Some((rel_path, mapped))
}

/// `notify::EventKind` → `FsChangeKind` (contract §4.3). `Access` is
/// ignored; everything not explicitly Create/Remove/Access is Modify —
/// *except* the two single-path rename halves the Windows
/// `ReadDirectoryChangesW` backend reports (notify-8.2.0
/// `src/windows.rs:425-436`): `FILE_ACTION_RENAMED_OLD_NAME` becomes
/// `Modify(Name(RenameMode::From))` carrying only the vanished old path, and
/// `FILE_ACTION_RENAMED_NEW_NAME` becomes `Modify(Name(RenameMode::To))`
/// carrying only the path that now exists. Left under the catch-all these
/// both mapped to `Modify`, so the old path was never dropped from
/// `useProjectStore.files` — a ghost entry that kept `modifiedMs` bumped to
/// "now" forever, since `applyFsChange` never rescans. Mapped explicitly to
/// the Remove/Create the store already folds correctly.
/// `RenameMode::Both` (both paths in one event, seen on other platforms) is
/// intentionally left on the Modify fallback below — splitting it correctly
/// needs path-indexed handling, and no defect against that shape has been
/// observed on the Windows backend this app ships on.
fn map_event_kind(kind: &EventKind) -> Option<FsChangeKind> {
    match kind {
        EventKind::Create(_) => Some(FsChangeKind::Create),
        EventKind::Remove(_) => Some(FsChangeKind::Remove),
        EventKind::Access(_) => None,
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => Some(FsChangeKind::Remove),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => Some(FsChangeKind::Create),
        _ => Some(FsChangeKind::Modify),
    }
}

/// `path` relative to `root`, forward slashes. `None` if `path` isn't under
/// `root` at all.
fn rel_path_of(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    Some(rel.to_string_lossy().replace('\\', "/"))
}

/// Kind-merge precedence (contract §4.3): `Create+Modify=Create` ·
/// `*+Remove=Remove` · `Remove+(Create|Modify)=Modify` · otherwise the
/// newer kind wins.
fn merge_kind(old: FsChangeKind, new: FsChangeKind) -> FsChangeKind {
    use FsChangeKind::{Create, Modify, Remove};
    match (old, new) {
        (Create, Modify) | (Modify, Create) => Create,
        (_, Remove) => Remove,
        (Remove, Create) | (Remove, Modify) => Modify,
        _ => new,
    }
}

/// Is `mine` still the state's current generation? Factored out so the
/// stale-drop behaviour is unit-testable without a real `AppHandle`.
fn is_current_generation(current: Option<u64>, mine: u64) -> bool {
    current == Some(mine)
}

fn merge_pending(
    pending: &mut HashMap<String, (FsChangeKind, Instant)>,
    rel_path: String,
    kind: FsChangeKind,
) {
    match pending.get_mut(&rel_path) {
        Some(entry) => entry.0 = merge_kind(entry.0, kind),
        None => {
            pending.insert(rel_path, (kind, Instant::now()));
        }
    }
}

fn oldest_over(pending: &HashMap<String, (FsChangeKind, Instant)>, max_age: Duration) -> bool {
    pending.values().any(|(_, t)| t.elapsed() > max_age)
}

/// Debounce loop: one per `ActiveWatcher`, running until its task is
/// aborted by the next `restart` or the notify sender is dropped.
async fn debounce_loop(
    app: AppHandle,
    root: PathBuf,
    mut rx: mpsc::UnboundedReceiver<(String, FsChangeKind)>,
    generation: u64,
) {
    let mut pending: HashMap<String, (FsChangeKind, Instant)> = HashMap::new();
    loop {
        match tokio::time::timeout(Duration::from_millis(DEBOUNCE_MS), rx.recv()).await {
            Ok(Some((rel_path, kind))) => {
                merge_pending(&mut pending, rel_path, kind);
                if pending.len() >= MAX_PENDING
                    || oldest_over(&pending, Duration::from_millis(MAX_PENDING_AGE_MS))
                {
                    flush(&app, &root, &mut pending, generation);
                }
            }
            Ok(None) => {
                // Sender dropped — the watcher (and its channel) is gone.
                flush(&app, &root, &mut pending, generation);
                return;
            }
            Err(_) => {
                // 300ms elapsed with nothing new — flush what we have.
                flush(&app, &root, &mut pending, generation);
            }
        }
    }
}

/// Current generation recorded in `WatcherState`, or `None` if there is no
/// active watcher (e.g. mid-restart) or the mutex is poisoned. Factored out
/// so [`flush`] can re-read it fresh on every iteration rather than once.
fn current_generation(app: &AppHandle) -> Option<u64> {
    app.state::<WatcherState>()
        .0
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|w| w.generation))
}

/// Reads fresh `fs::metadata` per path and emits one `fs://change` per
/// changed path. The generation is re-checked **per entry**, not once for
/// the whole batch: `restart()` can bump `WatcherState`'s generation and
/// abort this task's `JoinHandle` from another OS thread while this loop is
/// already running — `JoinHandle::abort()` only takes effect at the task's
/// next `.await` point, and this loop has none, so an in-flight flush
/// cannot be preempted mid-batch. Hoisting a single `is_current` boolean
/// before the loop let such an in-flight flush finish emitting the *entire*
/// pending batch under a stale generation whenever `restart()` raced it,
/// briefly leaking old-project `fs://change` events into the newly-opened
/// project. Re-locking on every iteration closes that window: as soon as
/// `restart()` has written the bumped generation, the very next iteration
/// observes it and stops emitting (already-drained entries are still
/// dropped from `pending`, just without emitting).
fn flush(
    app: &AppHandle,
    root: &Path,
    pending: &mut HashMap<String, (FsChangeKind, Instant)>,
    generation: u64,
) {
    flush_with(
        root,
        pending,
        generation,
        || current_generation(app),
        |change| {
            let _ = app.emit(FS_CHANGE_EVENT, &change);
        },
    );
}

/// Core of [`flush`], generic over how the current generation is read and
/// how a change is emitted — factored out so the per-entry re-check (the
/// fix documented on [`flush`]) is unit-testable without a real
/// `AppHandle`: a test closure can change its answer between calls to
/// simulate `restart()` racing an in-flight batch.
fn flush_with(
    root: &Path,
    pending: &mut HashMap<String, (FsChangeKind, Instant)>,
    generation: u64,
    mut current_generation: impl FnMut() -> Option<u64>,
    mut emit: impl FnMut(FsChange),
) {
    if pending.is_empty() {
        return;
    }

    for (rel_path, (kind, _)) in pending.drain() {
        if !is_current_generation(current_generation(), generation) {
            continue;
        }
        let (modified_ms, size_bytes) = if kind == FsChangeKind::Remove {
            (None, None)
        } else {
            match fs::metadata(root.join(&rel_path)) {
                Ok(meta) => (
                    meta.modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64),
                    Some(meta.len()),
                ),
                Err(_) => (None, None),
            }
        };
        emit(FsChange {
            rel_path,
            modified_ms,
            size_bytes,
            kind,
        });
    }
}
