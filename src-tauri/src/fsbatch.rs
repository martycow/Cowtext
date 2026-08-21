//! `fs_apply_batch` — WO13's one new command (74 → 75, WO13_CONTRACT.md §12.1).
//! All-or-nothing multi-file write/delete with an inverse-batch undo token.
//!
//! Semantics, frozen by the contract:
//! 1. Resolve every `rel_path` through `resolve_within_root`; reject the
//!    whole batch on any failure before touching anything.
//! 2. One-writer guard: reject the whole batch if any entry names
//!    `.claude/settings.json` (`hooks_write` owns it), `.claude/agents/*.md`
//!    (`agent_save` owns it), or anything under `.claude/skills/`
//!    (`skill_create`/`skill_save`/`skill_rename`/`skill_delete` own it,
//!    §10.6, F12).
//! 3. Accept an entry only if it ends in `.md`, or matches the one non-`.md`
//!    shape compile owns (`.cursor/rules/*.mdc`) — see [`is_batch_acceptable`]
//!    for why this is a deliberate re-derivation, not a call into
//!    `compile::classify_output`.
//! 4. Snapshot every target's prior state (content, or "absent") in list
//!    order.
//! 5. Apply in list order: `Some(content)` writes atomically; `None` removes
//!    the file (a missing file is a no-op, not an error).
//! 6. On any failure, restore every already-applied entry from its snapshot
//!    in reverse order, then return `Err` naming the failing path (and the
//!    restore-failure path too, if a restore also fails).
//! 7. Return the inverse batch, in the same order as `entries` — applying it
//!    undoes the call.
//!
//! Duplicate `rel_path` entries (after path resolution) are rejected: the
//! inverse would be ambiguous.

#[cfg(test)]
mod tests;

use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// One entry in a batch. `content: None` means "delete this path"; the
/// command's return value is the INVERSE of the batch that was applied
/// (`Some(prior_content)` or `None` if the path did not exist), so applying
/// the returned value undoes the call (§12.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchEntry {
    pub rel_path: String,
    /// `None` = delete this path.
    #[serde(default)]
    pub content: Option<String>,
}

/// Forward-slash, lowercase — this codebase's standing normalization idiom
/// for path-shape guards (`project.rs::is_rename_protected`,
/// `write_md_file`'s agent guard, `assemble.rs::is_agent_target`).
fn normalized(rel: &str) -> String {
    rel.replace('\\', "/").to_ascii_lowercase()
}

/// The one-writer guard (§12.1 rule 2, F12). Returns the refusal reason when
/// `rel` names a path another command exclusively owns.
fn one_writer_violation(rel: &str) -> Option<&'static str> {
    let n = normalized(rel);
    if n == ".claude/settings.json" {
        return Some("Use Install hooks to edit .claude/settings.json");
    }
    if n.starts_with(".claude/agents/") && n.ends_with(".md") {
        return Some("Use agent_save to write an agent file");
    }
    // F12: `.claude/skills/foo/SKILL.md` ends in `.md`, so rule 3's plain
    // suffix test would otherwise admit it — this clause is what refuses it.
    if n.starts_with(".claude/skills/") {
        return Some("Skill files are managed by the skill commands (skill_create/skill_save/skill_rename/skill_delete)");
    }
    None
}

/// §12.1 rule 3: "Accept an entry only if `compile::classify_output(rel).is_some()`
/// **or** the path ends in `.md`." Not a general write primitive.
///
/// WO13_AUDIT.md D9 (fix-round Stage 0): calls the ONE `classify_output`
/// (`compile.rs`, now `pub(crate)`) directly instead of the flagged partial
/// re-derivation (`is_cursor_mdc_output`) this function used to carry —
/// deleted, per tech-lead's ruling: "fix the class, not the instances."
/// The `|| ends_with(".md")` half stays; it is §12.1 rule 3 itself, not
/// duplication of `classify_output`.
fn is_batch_acceptable(rel: &str) -> bool {
    rel.to_ascii_lowercase().ends_with(".md") || crate::compile::classify_output(rel).is_some()
}

/// Prior content of `path`, or `None` if it does not exist. A file that
/// exists but cannot be read (permissions, non-UTF-8 bytes) is a hard `Err`
/// naming `rel` — surfaced before any write in the batch has happened.
fn snapshot(path: &Path, rel: &str) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| format!("{rel}: {e}"))
}

/// Apply one entry: `Some(content)` writes atomically, `None` removes the
/// file (a missing file is a no-op, not an error — §12.1 rule 5).
fn apply_one(path: &Path, content: &Option<String>) -> Result<(), String> {
    match content {
        Some(c) => write_atomic(path, c),
        None => {
            if path.is_file() {
                fs::remove_file(path).map_err(|e| e.to_string())
            } else {
                Ok(())
            }
        }
    }
}

#[tauri::command]
pub fn fs_apply_batch(root: String, entries: Vec<BatchEntry>) -> Result<Vec<BatchEntry>, String> {
    let root_path = checked_root(&root)?;

    // Pass 1: resolve + guard + acceptance-test every entry before touching
    // anything — in the contract's own numbered order (§12.1 rules 1-3).
    let mut resolved: Vec<(PathBuf, &BatchEntry)> = Vec::with_capacity(entries.len());
    for e in &entries {
        let path = resolve_within_root(&root_path, &e.rel_path)?;
        if let Some(reason) = one_writer_violation(&e.rel_path) {
            return Err(format!("{}: {reason}", e.rel_path));
        }
        if !is_batch_acceptable(&e.rel_path) {
            return Err(format!(
                "Refusing to write outside markdown/compile outputs: {}",
                e.rel_path
            ));
        }
        resolved.push((path, e));
    }

    // Duplicate detection on the RESOLVED path — two differently-spelled
    // `rel_path`s naming the same file are just as ambiguous for an inverse
    // batch as an exact string duplicate.
    let mut seen: HashSet<&Path> = HashSet::with_capacity(resolved.len());
    for (path, e) in &resolved {
        if !seen.insert(path.as_path()) {
            return Err(format!("Duplicate path in batch: {}", e.rel_path));
        }
    }

    // Pass 2: snapshot prior state, in list order (§12.1 rule 4). No write
    // has happened yet, so a snapshot failure aborts the whole call cleanly.
    let mut snapshots: Vec<Option<String>> = Vec::with_capacity(resolved.len());
    for (path, e) in &resolved {
        snapshots.push(snapshot(path, &e.rel_path)?);
    }

    // Pass 3: apply in list order; roll back everything already applied on
    // the first failure (§12.1 rules 5-6).
    for (i, (path, e)) in resolved.iter().enumerate() {
        if let Err(reason) = apply_one(path, &e.content) {
            if let Err(rollback_reason) = rollback(&resolved[..i], &snapshots[..i]) {
                return Err(format!(
                    "{}: {reason} (restore also failed — {rollback_reason})",
                    e.rel_path
                ));
            }
            return Err(format!("{}: {reason}", e.rel_path));
        }
    }

    // Pass 4: the inverse batch, same order as `entries` (§12.1 rule 7).
    let inverse = resolved
        .into_iter()
        .zip(snapshots)
        .map(|((_, e), prior)| BatchEntry {
            rel_path: e.rel_path.clone(),
            content: prior,
        })
        .collect();
    Ok(inverse)
}

/// Restore every entry in `applied`/`snaps` (same length, same order) from
/// its snapshot, in REVERSE order (§12.1 rule 6). `Err` names the first path
/// whose restore itself failed; the caller folds that into the original
/// failure's message so the error names both.
fn rollback(applied: &[(PathBuf, &BatchEntry)], snaps: &[Option<String>]) -> Result<(), String> {
    for j in (0..applied.len()).rev() {
        let (path, e) = &applied[j];
        if let Err(reason) = apply_one(path, &snaps[j]) {
            return Err(format!("{}: {reason}", e.rel_path));
        }
    }
    Ok(())
}
