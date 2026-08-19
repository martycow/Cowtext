//! `.cowtext/tasklinks.json` — v1 sidecar mapping a stable task id (§3.1 of
//! `WO06_CONTRACT.md`) to the Memory Nodes it needs, the sessions that have
//! run it, and its goal-ancestry parent.
//!
//! **Written only by Rust — no TypeScript writer, ever (contract §3.2 L1).**
//! This structurally removes the WO03-D5 class of bug (Rust `String::cmp`
//! vs TS `localeCompare` producing sort churn on a git-tracked file):
//! there is no second writer to disagree with the first.
//!
//! `.cowtext/` is a dot-directory, so `project::is_scannable_md` never
//! matches it and no `fs://change` fires for this file (§3.2 L7) — every
//! mutation must reach the frontend through the mutating command's own
//! return value, never through the watcher.
//!
//! Wire types were frozen at WO06 Stage 0 (every build lane depends on
//! their exact shape); this module (Lane T2, contract §10 lane G2's
//! sidecar slice) fills in the command bodies: tolerant read, upsert with
//! ancestry-cycle rejection, delete, and the deterministic serializer.

#[cfg(test)]
mod tests;

use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// `TaskLinks.version` — bumped only on an incompatible sidecar shape
/// change. A file whose `version` is greater than this is a hard `Err`
/// (§3.2 L6), matching the graph loader's forward-compat posture.
pub const TASKLINKS_VERSION: u32 = 1;

/// Sidecar path, relative to the project root.
pub const TASKLINKS_REL_PATH: &str = ".cowtext/tasklinks.json";

/// One task's links (contract §3.2). `node_ids` are the subgraph injection
/// seeds (§4.1); `session_ids` hold `claudeSessionId` UUIDs — **never**
/// Cowtext's in-memory `as<N>` session id (§3.2 L3), which is reassigned
/// from zero on every app start and would be meaningless in a file that
/// outlives the process.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskLink {
    /// The stable `t-xxxxxx` id this entry is keyed on (§3.1 R5).
    pub task_id: String,
    /// Subgraph injection seeds — Memory Node ids.
    pub node_ids: Vec<String>,
    /// `claudeSessionId` values, never `as<N>` ids (see module doc).
    pub session_ids: Vec<String>,
    /// Goal ancestry (Paperclip-style), not a scheduling dependency
    /// (§3.2 L4). Distinct from `TaskItem.depends_on` (`needs:`), which
    /// lives in `tasks.rs` and contributes nothing to subgraph closure
    /// (contract §4.1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_task_id: Option<String>,
    /// Absent or `0` ⇒ no per-task ceiling; the global default applies
    /// (contract §5.1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_ceiling: Option<u64>,
}

/// The whole sidecar document. A missing file reads as
/// `{version: 1, links: []}` (§3.2 L6); `links` is sorted by `taskId` in
/// byte order on every write (§3.2 L2). Both behaviours are Lane G2's.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskLinks {
    pub version: u32,
    pub links: Vec<TaskLink>,
}

// ── Ancestry (contract §3.2 L4, §4.1) ───────────────────────────────────

/// Max ancestry hops [`ancestor_chain`] will follow before refusing a
/// write (contract §3.2 L4: "depth is capped at 8"). A genuine cycle is
/// almost always caught in far fewer hops — as soon as an id repeats —
/// but the cap also refuses a pathologically deep-but-acyclic chain on the
/// same footing: `taskctx.rs`'s subgraph closure (§4.1) reports both
/// failure shapes as `TaskContextError::ParentCycle`, so `tasklink_set`
/// refuses to persist a link this module could not later resolve cleanly.
pub(crate) const MAX_ANCESTRY_DEPTH: usize = 8;

/// Walks `parentTaskId` starting at `task_id` (nearest ancestor first),
/// resolving each hop against `links`. Stops cleanly — `Ok` — when a task
/// has no `parentTaskId`, or its `parentTaskId` names no entry in `links`
/// ("unresolved": nothing further to walk, not an error). Returns `Err`
/// with the offending path (`task_id` through the repeated id, appended
/// last — the same convention `compile.rs`'s `ValidationError::Cycle`
/// uses) the moment a hop would revisit an id already on the path, or once
/// [`MAX_ANCESTRY_DEPTH`] real hops are walked without the chain
/// terminating.
///
/// Bound is `0..=MAX_ANCESTRY_DEPTH` (audit F4, fixed). A chain of exactly
/// [`MAX_ANCESTRY_DEPTH`] hops needs that many iterations to *reach* its
/// final ancestor, plus one further iteration to *confirm* that ancestor
/// has no parent of its own. The previous exclusive `0..MAX_ANCESTRY_DEPTH`
/// range spent its last iteration reaching the final ancestor and never
/// got a next one to confirm termination, so a valid, non-cyclic depth-8
/// chain fell through to the same `Err` a real cycle produces — one hop
/// short of the documented cap.
pub(crate) fn ancestor_chain(links: &TaskLinks, task_id: &str) -> Result<Vec<String>, Vec<String>> {
    let mut path = vec![task_id.to_string()];
    let mut current = task_id.to_string();
    for _ in 0..=MAX_ANCESTRY_DEPTH {
        let next = links
            .links
            .iter()
            .find(|l| l.task_id == current)
            .and_then(|l| l.parent_task_id.clone());
        let Some(parent_id) = next else {
            // path[0] is task_id itself; callers want ancestors only.
            return Ok(path[1..].to_vec());
        };
        if path.contains(&parent_id) {
            path.push(parent_id);
            return Err(path);
        }
        path.push(parent_id.clone());
        current = parent_id;
    }
    Err(path)
}

// ── Determinism (contract §3.2 L2) ──────────────────────────────────────

/// Upsert-by-`taskId`: replaces the existing entry in place if present
/// (preserving its position pre-sort), else appends. `tasklink_set`'s
/// "collision" behaviour — setting a link for a `taskId` that already has
/// one is a replace, never a second entry with the same key.
fn upsert(links: &mut Vec<TaskLink>, link: TaskLink) {
    if let Some(existing) = links.iter_mut().find(|l| l.task_id == link.task_id) {
        *existing = link;
    } else {
        links.push(link);
    }
}

/// Canonicalizes a document in place before every write (and before every
/// read returns to a caller): `version` pinned to [`TASKLINKS_VERSION`],
/// each entry's `nodeIds`/`sessionIds` sorted byte-order and deduped,
/// `links` sorted by `taskId` byte-order, and — defensive, for a
/// hand-edited or corrupt file that slipped a duplicate `taskId` past
/// deserialization — a duplicate collapsed to its first (sorted)
/// occurrence. This is what makes gate 7's "nodeIds in reverse order
/// re-serializes sorted" hold on every command, not just `tasklink_set`.
fn normalize(doc: &mut TaskLinks) {
    doc.version = TASKLINKS_VERSION;
    for link in &mut doc.links {
        link.node_ids.sort();
        link.node_ids.dedup();
        link.session_ids.sort();
        link.session_ids.dedup();
    }
    doc.links.sort_by(|a, b| a.task_id.cmp(&b.task_id));
    doc.links.dedup_by(|a, b| a.task_id == b.task_id);
}

/// `serde_json::to_string_pretty` + one trailing `\n`, matching
/// `project::graph_v3::serialize_graph`'s convention exactly (contract
/// §3.2 L2) so the sidecar diffs as cleanly as `graph.json` does.
fn serialize_tasklinks(doc: &TaskLinks) -> String {
    let mut stable = doc.clone();
    normalize(&mut stable);
    let mut out = serde_json::to_string_pretty(&stable).expect("TaskLinks always serializes");
    out.push('\n');
    out
}

// ── Tolerant read / atomic write (contract §3.2 L6, L2) ────────────────

fn empty_tasklinks() -> TaskLinks {
    TaskLinks {
        version: TASKLINKS_VERSION,
        links: Vec::new(),
    }
}

/// Missing file, or a file that is not valid JSON at all, degrades to
/// `{version: 1, links: []}` — never a crash, never a panic (§3.2 L6 +
/// this lane's "corrupt sidecar degrades gracefully" instruction). A file
/// that IS valid JSON but names a `version` newer than this binary
/// understands is a hard `Err` (forward-compat guard, same posture as the
/// graph loader) — checked before any attempt to interpret its shape, so
/// a v2+ file is never partially trusted. A file that parses as JSON,
/// claims a supported version, but doesn't match the expected shape
/// (e.g. `links` is not an array) also degrades to empty rather than
/// erroring — the same "corrupt sidecar" class, just caught one step
/// later. Unknown fields anywhere in the document are silently dropped
/// (no `deny_unknown_fields`), which is what removes them on the next
/// rewrite (§3.2 L6).
fn read_tasklinks(root: &Path) -> Result<TaskLinks, String> {
    let path = root.join(TASKLINKS_REL_PATH);
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Ok(empty_tasklinks()),
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(empty_tasklinks()),
    };
    let version = value
        .get("version")
        .and_then(Value::as_u64)
        .unwrap_or(u64::from(TASKLINKS_VERSION));
    if version > u64::from(TASKLINKS_VERSION) {
        return Err(format!("Unsupported tasklinks.json version: {version}"));
    }
    let mut doc: TaskLinks = serde_json::from_value(value).unwrap_or_else(|_| empty_tasklinks());
    normalize(&mut doc);
    Ok(doc)
}

/// Path resolution goes through [`resolve_within_root`] even though
/// [`TASKLINKS_REL_PATH`] is a fixed constant, not caller-supplied input —
/// one path-guarded call site for every sidecar write, matching how every
/// other FS write in this codebase is required to reach disk.
fn write_tasklinks(root: &Path, doc: &TaskLinks) -> Result<(), String> {
    let path = resolve_within_root(root, TASKLINKS_REL_PATH)?;
    write_atomic(&path, &serialize_tasklinks(doc))
}

// ── Grammar guard (contract §3.1 R5, audit O7) ──────────────────────────

/// Mirrors `taskctx.rs`'s private `is_valid_task_id` byte-for-byte. That
/// function cannot be called from here — `taskctx.rs` is a different build
/// lane's file zone — so the check is duplicated rather than shared.
/// `tasklink_set` used to guard only non-empty; a link written for a
/// malformed id was silently unusable, because `task_context_preview`
/// rejects the exact same string with `UnknownTask` before ever consulting
/// the sidecar. Failing at the door here is cheaper than two commands
/// later, and this module owns the sidecar's only writer (module doc, L1).
fn is_valid_task_id(id: &str) -> bool {
    match id.strip_prefix("t-") {
        Some(rest) => rest.len() == 6 && rest.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase()),
        None => false,
    }
}

// ── Concurrency guard (audit O5, partial — see doc comment) ─────────────

/// Serializes the read-modify-write critical section of every mutating
/// command in this module.
///
/// `tasklink_set` / `tasklink_delete` are plain (non-`async`) commands, so
/// Tauri dispatches concurrent invocations onto its blocking thread pool —
/// two calls fired without an intervening `await` on the JS side (audit
/// O5's failure scenario: an un-awaited `recordSession` immediately
/// followed by `setCeiling`) can run on two OS threads at once. Without
/// this lock that is worse than an ordinary lost update: `project::
/// write_atomic`'s temp file is named from the destination path plus this
/// *process's* id only (`.tasklinks.json.tmp-<pid>`, not per-call-unique),
/// so two concurrent writers of the same sidecar share one temp file and
/// can genuinely corrupt it — not just drop a field. This lock makes every
/// `tasklink_set` / `tasklink_delete` call's full read-modify-write-through
/// `write_atomic` sequence atomic with respect to every other such call in
/// this process, which removes that corruption risk and guarantees
/// concurrent upserts of *different* `taskId`s are never lost (regression:
/// `concurrent_tasklink_set_calls_never_corrupt_the_file`).
///
/// **This is only the server-side half of O5.** `src/store/tasklinks.ts`'s
/// mutators (`setCeiling`, `setParent`, `recordSession`, …) each build a
/// full replacement `TaskLink` from a `get()` snapshot captured before an
/// unrelated pending call's promise resolves. That payload is already
/// wrong by the time it reaches this process — no amount of server-side
/// serialization recovers a field the caller's argument never carried, and
/// `tasklink_set`'s wire contract (§7) is a whole-entry upsert (`upsert`,
/// this file), not a per-field patch. Fixing that half means serializing
/// the store's mutations behind a promise chain, or re-reading `linkFor`
/// from the last adopted doc inside the mutation instead of before the
/// `await` — both in `src/store/tasklinks.ts` and the un-awaited call site
/// at `src/taskctx/TaskContextModal.tsx:363` — outside this lane's zone
/// (U2-linkage's, per `WO06_AUDIT.md` O5), and not attempted here.
fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

// ── Commands (contract §7, commands 58-60) ──────────────────────────────

#[tauri::command]
pub fn tasklinks_read(root: String) -> Result<TaskLinks, String> {
    let root = checked_root(&root)?;
    read_tasklinks(&root)
}

/// Upsert one entry (§3.2, command 59). Rejects a `taskId` that fails the
/// §3.1 R5 grammar, or an ancestry cycle (self-parent included), or a
/// chain exceeding [`MAX_ANCESTRY_DEPTH`] — all *before* touching disk, so
/// a rejected upsert leaves the file exactly as it was. The cycle check
/// runs against the document as it WOULD be after this upsert, so a link
/// that would close a cycle through an existing entry is caught too, not
/// just a direct self-reference. The read-modify-write itself is
/// serialized against every other call in this process ([`write_lock`]).
#[tauri::command]
pub fn tasklink_set(root: String, link: TaskLink) -> Result<TaskLinks, String> {
    let root = checked_root(&root)?;
    if link.task_id.trim().is_empty() {
        return Err("tasklink_set: taskId must not be empty".to_string());
    }
    if !is_valid_task_id(&link.task_id) {
        return Err(format!(
            "tasklink_set: taskId does not match the required grammar ^t-[0-9a-z]{{6}}$: {}",
            link.task_id
        ));
    }

    let Ok(_guard) = write_lock().lock() else {
        return Err("tasklink_set: write lock poisoned".to_string());
    };

    let mut doc = read_tasklinks(&root)?;

    let mut probe = doc.clone();
    upsert(&mut probe.links, link.clone());
    if link.parent_task_id.is_some() {
        if let Err(path) = ancestor_chain(&probe, &link.task_id) {
            return Err(format!(
                "tasklink_set: ancestry cycle for {}: {}",
                link.task_id,
                path.join(" -> ")
            ));
        }
    }

    upsert(&mut doc.links, link);
    normalize(&mut doc);
    write_tasklinks(&root, &doc)?;
    Ok(doc)
}

/// Delete one entry by id (command 60). Deleting an id with no entry is a
/// no-op success: if the sidecar already existed, the returned (and
/// re-persisted, idempotently) document is unchanged; if it did **not**
/// already exist, nothing is written — a no-op delete must never conjure a
/// git-visible `.cowtext/tasklinks.json` out of nowhere (audit O6, fixed).
/// The read-modify-write is serialized against every other call in this
/// process ([`write_lock`]).
#[tauri::command]
pub fn tasklink_delete(root: String, task_id: String) -> Result<TaskLinks, String> {
    let root = checked_root(&root)?;

    let Ok(_guard) = write_lock().lock() else {
        return Err("tasklink_delete: write lock poisoned".to_string());
    };

    let file_existed = root.join(TASKLINKS_REL_PATH).exists();
    let mut doc = read_tasklinks(&root)?;
    let before = doc.links.len();
    doc.links.retain(|l| l.task_id != task_id);
    let removed_something = doc.links.len() != before;
    normalize(&mut doc);

    if removed_something || file_existed {
        write_tasklinks(&root, &doc)?;
    }
    Ok(doc)
}
