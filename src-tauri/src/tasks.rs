//! Task-file convention (TASKBOARD_BATCH_CONTRACT.md §1-4, Rev 2 §R2-R3;
//! WO02 §2.3/§2.4/§7.8/§7.11): a tolerant, read-mostly markdown task parser
//! over five well-known files — `TASKS.md`, `SPRINT.md`, `BACKLOG.md`,
//! `ROADMAP.md`, `BUGS.md` — searched in this directory order: project
//! root, `docs/`, `docs/tasks/` (first hit per name wins).
//!
//! A "task" is either a markdown pipe-table row (header-driven column
//! mapping) or a checklist line (`- [ ] text` / `- [x] text` / `- [>] text`
//! / `- [?] text`). The parser never errors on weird markdown — lines that
//! don't match either shape are simply not tasks. All writes are line-based
//! surgery through [`project::write_atomic`], confined to the five
//! convention files.
//!
//! Rev 2 adds a normalized status bucket (`"new"` | `"in-production"` |
//! `"in-testing"` | `"done"`) shared by both checklist markers and table
//! status cells, two scan-only fields (`section`, `when`), and the
//! [`task_update`] command that regenerates a line canonically from a full
//! editable field set.
//!
//! WO02 adds a normalized priority bucket (`"low"` | `"medium"` | `"high"`
//! | `"critical"`, see [`bucket_for_priority_input`]) shared by checklist
//! `!bucket` / legacy `P0`-`P3` tokens and table priority cells, and makes
//! [`task_append`]/[`task_move`] target-form-aware: a name-mapped pipe
//! table gets a new row, a checklist-only file gets a new checklist line,
//! and an empty/missing/taskless file gets a fresh canonical table (see
//! [`write_task_text`]).

#[cfg(test)]
mod tests;

use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap, HashMap, HashSet, VecDeque};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// The five convention file names, in board-column order — also the order
/// `tasks_scan` reports them in. **Positional coupling (WO02 §7.11)**: TS's
/// `TASK_FILE_NAMES` in `src/store/tasks.ts` must match this array
/// element-wise, in order. `BUGS.md` was appended last (item #14); do not
/// reorder either array.
const CONVENTION_NAMES: [&str; 5] =
    ["TASKS.md", "SPRINT.md", "BACKLOG.md", "ROADMAP.md", "BUGS.md"];

/// Directories searched for a convention file, in priority order. `""`
/// means the project root itself.
const CONVENTION_DIRS: [&str; 3] = ["", "docs/", "docs/tasks/"];

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskSource {
    Table,
    Checklist,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub id: String,
    pub rel_path: String,
    /// 1-based line number inside the file.
    pub line: usize,
    pub source: TaskSource,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub priority: Option<String>,
    pub phase: Option<String>,
    /// Header-driven "Task Type" cell (F6 §6): recognized synonyms `Task
    /// Type`|`Type`|`Kind`, mapped exactly like `phase` — table-only,
    /// `None` for checklist tasks and for tables whose header doesn't map
    /// one. Never invented, never normalized — the raw trimmed cell text.
    pub task_type: Option<String>,
    pub agent: Option<String>,
    pub done: bool,
    /// Normalized status bucket: `"new"` | `"in-production"` |
    /// `"in-testing"` | `"done"` (contract §R2).
    pub status: Option<String>,
    /// Scan-only: text of the nearest preceding `##`+ heading in the same
    /// file, `None` if there isn't one before this task.
    pub section: Option<String>,
    /// Scan-only: first ISO date / `Q1`..`Q4` / `Phase <n>` token found
    /// anywhere in the raw line, `None` if there isn't one.
    pub when: Option<String>,
    /// Stable task id lifted out of the Tags cell (WO06 §3.1). `None` until
    /// minted via [`task_id_ensure`].
    pub task_id: Option<String>,
    /// Stable ids this task depends on, lifted from `needs:` tokens. Order
    /// as written (WO06 §3.1).
    pub depends_on: Vec<String>,
    /// SCAN-ONLY: any dependency resolves to a task whose status != "done",
    /// or this task's own id participates in a reported cycle. ALWAYS
    /// `false` from the single-file commands (toggle/update/append/move/
    /// id_ensure/depends_add/depends_remove) — they cannot see the other
    /// four files. Only [`tasks_scan`] computes it (WO06 §3.3 D1/D2).
    pub blocked: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskFileInfo {
    pub rel_path: String,
    pub exists: bool,
    pub task_count: usize,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TasksScan {
    pub files: Vec<TaskFileInfo>,
    pub tasks: Vec<TaskItem>,
    pub dag: TaskDag,
}

/// One task-id's dependency that resolves to no known task (WO06 §3.3 D1):
/// reported, never fatal, and never blocking on its own — a typo must not
/// deadlock the board. `task_id` is always a *stable* id (§3.1 R5 grammar);
/// a task with no `id:` of its own is never represented here (O1 — §3.1 R6
/// forbids substituting the volatile `"<relPath>#<line>"` locator for it),
/// even though its own `depends_on` may still contain an unresolved target.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedDep {
    pub task_id: String,
    pub depends_on: String,
}

/// The task dependency DAG, derived at scan time over every task's already-
/// lifted `task_id`/`depends_on` (WO06 §3.3). Never persisted — dependencies
/// live in the markdown and nowhere else (D5).
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskDag {
    /// Each entry is a task-id cycle path with the first id repeated last —
    /// same convention as `compile.rs`'s `ValidationError::Cycle` (D4).
    /// Mirrors `compile.rs`/`lint.rs`'s own cycle detectors, which likewise
    /// report at most one concrete cycle per pass, found by the identical
    /// deterministic (smallest-id-first) walk — this is NOT one entry per
    /// disjoint cycle in the graph.
    pub cycles: Vec<Vec<String>>,
    pub duplicate_ids: Vec<String>,
    pub unresolved: Vec<UnresolvedDep>,
}

/// The full editable field set for [`task_update`] (contract §R3). All
/// fields are `Option`; both an explicit JSON `null` and an absent key
/// deserialize to `None`, and `None` means "clear this field" for every
/// field except `name` (an update that would leave the name empty errors
/// instead). `status`/`done` together decide the checklist marker /
/// normalized status bucket — see [`derive_status_bucket`].
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub priority: Option<String>,
    pub phase: Option<String>,
    /// See [`TaskItem::task_type`] — same table-only, no-normalization field.
    pub task_type: Option<String>,
    pub agent: Option<String>,
    pub status: Option<String>,
    pub done: Option<bool>,
}

// ---------------------------------------------------------------------
// Convention-path helpers
// ---------------------------------------------------------------------

/// The three relative paths a convention `name` could live at, in
/// search-priority order (mirrors [`CONVENTION_DIRS`]).
fn convention_candidates(name: &str) -> [String; 3] {
    CONVENTION_DIRS.map(|dir| format!("{dir}{name}"))
}

/// True when `rel_path` (after `\`->`/` normalization) is exactly one of
/// the 15 recognized convention locations (5 names × 3 directories).
fn is_convention_relpath(rel_path: &str) -> bool {
    let normalized = rel_path.replace('\\', "/");
    CONVENTION_NAMES
        .iter()
        .any(|name| convention_candidates(name).iter().any(|c| c == &normalized))
}

fn ensure_convention_path(rel_path: &str) -> Result<(), String> {
    if is_convention_relpath(rel_path) {
        Ok(())
    } else {
        Err(format!("Not a task file: {rel_path}"))
    }
}

/// `"TASKS.md"` -> `"TASKS"`, used for the `# <Name>` header on file
/// creation. `rel_path` is expected to already be a validated convention
/// path, so this always has a `.md` stem to strip.
fn convention_stem(rel_path: &str) -> String {
    Path::new(rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| rel_path.to_string())
}

// ---------------------------------------------------------------------
// Status bucket helpers (contract §R2/§R3)
// ---------------------------------------------------------------------

/// Normalizes arbitrary status text (a table cell, or a `task_update`
/// patch value) to one of the four canonical buckets. Dashes are treated
/// as spaces so the canonical kebab-case bucket strings ("in-production")
/// round-trip through this same function. Unrecognized/empty text falls
/// back to `"new"`.
///
/// WO15 D-6 relabels the third bucket "In review" in the UI while leaving
/// the stored id (`in-testing`) and the text `task_update` writes to disk
/// (`in testing`) alone — file-format compatibility. So `"in review"` and
/// the bare `"review"` are accepted here as input aliases; the dash→space
/// pass above means `"in-review"` arrives as `"in review"` and needs no
/// separate arm.
fn bucket_for_status_input(raw: &str) -> &'static str {
    let normalized = raw.trim().to_ascii_lowercase().replace('-', " ");
    let normalized: String = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    match normalized.as_str() {
        "new" | "todo" => "new",
        "in progress" | "in production" | "wip" | "doing" => "in-production",
        "testing" | "in testing" | "in review" | "review" => "in-testing",
        "done" | "closed" => "done",
        _ => "new",
    }
}

/// Canonical priority buckets (WO02 §2.4). `None` = no priority /
/// unrecognized — tolerant, never invents a bucket for text it doesn't
/// recognize. Normalization: trim, ASCII-lowercase, `-`/`_` -> space,
/// collapse whitespace, so `"P0"`, `"p-0"`, `"blocker"` and `"critical"`
/// all land on the same bucket.
fn bucket_for_priority_input(raw: &str) -> Option<&'static str> {
    let normalized = raw.trim().to_ascii_lowercase().replace(['-', '_'], " ");
    let normalized: String = normalized.split_whitespace().collect::<Vec<_>>().join(" ");
    match normalized.as_str() {
        "low" | "l" | "p3" => Some("low"),
        "medium" | "med" | "normal" | "m" | "p2" => Some("medium"),
        "high" | "h" | "p1" => Some("high"),
        "critical" | "crit" | "blocker" | "urgent" | "p0" => Some("critical"),
        _ => None,
    }
}

/// Checklist marker char for a normalized bucket.
fn marker_for_bucket(bucket: &str) -> char {
    match bucket {
        "done" => 'x',
        "in-production" => '>',
        "in-testing" => '?',
        _ => ' ',
    }
}

/// `task_update` bucket derivation: an explicit `status` wins (normalized
/// through [`bucket_for_status_input`]); otherwise an explicit `done: true`
/// means `"done"`; otherwise (both absent/cleared) the default is `"new"`.
fn derive_status_bucket(status: Option<&str>, done: Option<bool>) -> &'static str {
    if let Some(s) = status {
        return bucket_for_status_input(s);
    }
    if done == Some(true) {
        "done"
    } else {
        "new"
    }
}

// ---------------------------------------------------------------------
// Heading / section tracking
// ---------------------------------------------------------------------

/// `(level, text)` for an ATX heading line (`#`.. `######`), trailing `#`s
/// and surrounding whitespace stripped from `text`. `None` for non-heading
/// lines, including `#withoutspace` (not a valid ATX heading).
fn heading_level_and_text(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim();
    if !trimmed.starts_with('#') {
        return None;
    }
    let level = trimmed.chars().take_while(|&c| c == '#').count();
    let rest = &trimmed[level..];
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let text = rest.trim().trim_end_matches('#').trim().to_string();
    Some((level, text))
}

/// Scans `lines[..before_line_no - 1]` (i.e. every line strictly before
/// the 1-based `before_line_no`) for the last `##`+ heading, contract
/// §R2/§R3's `section` field.
fn nearest_section(lines: &[&str], before_line_no: usize) -> Option<String> {
    let end = before_line_no.saturating_sub(1).min(lines.len());
    let mut section: Option<String> = None;
    for line in &lines[..end] {
        if let Some((level, text)) = heading_level_and_text(line) {
            if level >= 2 {
                section = if text.is_empty() { None } else { Some(text) };
            }
        }
    }
    section
}

// ---------------------------------------------------------------------
// `when` extraction (contract §R2/§R3)
// ---------------------------------------------------------------------

/// First `\d{4}-\d{2}-\d{2}` substring, byte-offset + matched text.
fn find_iso_date(line: &str) -> Option<(usize, String)> {
    let bytes = line.as_bytes();
    let n = bytes.len();
    if n < 10 {
        return None;
    }
    for i in 0..=(n - 10) {
        let s = &bytes[i..i + 10];
        let digit = |b: u8| b.is_ascii_digit();
        if digit(s[0])
            && digit(s[1])
            && digit(s[2])
            && digit(s[3])
            && s[4] == b'-'
            && digit(s[5])
            && digit(s[6])
            && s[7] == b'-'
            && digit(s[8])
            && digit(s[9])
        {
            return Some((i, line[i..i + 10].to_string()));
        }
    }
    None
}

/// First `Q1`..`Q4` token (word-boundary guarded so `Q1` inside a longer
/// identifier doesn't match), byte-offset + matched text.
fn find_quarter(line: &str) -> Option<(usize, String)> {
    let bytes = line.as_bytes();
    let n = bytes.len();
    for i in 0..n {
        if bytes[i] == b'Q' && i + 1 < n && (b'1'..=b'4').contains(&bytes[i + 1]) {
            let before_ok = i == 0 || !(bytes[i - 1] as char).is_alphanumeric();
            let after_idx = i + 2;
            let after_ok = after_idx >= n || !(bytes[after_idx] as char).is_alphanumeric();
            if before_ok && after_ok {
                return Some((i, line[i..i + 2].to_string()));
            }
        }
    }
    None
}

/// First `Phase <n>` token (case-insensitive on the word "phase", digits
/// required after at least one space), byte-offset + matched text in the
/// original casing. Lowercasing is ASCII-only so byte offsets stay valid
/// against `line`.
fn find_phase(line: &str) -> Option<(usize, String)> {
    let lower = line.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let pat = b"phase";
    let n = bytes.len();
    let m = pat.len();
    if n < m {
        return None;
    }
    for i in 0..=(n - m) {
        if &bytes[i..i + m] != pat {
            continue;
        }
        let before_ok = i == 0 || !(bytes[i - 1] as char).is_alphanumeric();
        if !before_ok {
            continue;
        }
        let mut j = i + m;
        let ws_start = j;
        while j < n && bytes[j] == b' ' {
            j += 1;
        }
        if j == ws_start {
            continue;
        }
        let digit_start = j;
        while j < n && bytes[j].is_ascii_digit() {
            j += 1;
        }
        if j == digit_start {
            continue;
        }
        return Some((i, line[i..j].to_string()));
    }
    None
}

/// The earliest-starting match among an ISO date, a `Q1..Q4` token, or a
/// `Phase <n>` token anywhere in the raw line.
fn extract_when(line: &str) -> Option<String> {
    [find_iso_date(line), find_quarter(line), find_phase(line)]
        .into_iter()
        .flatten()
        .min_by_key(|(idx, _)| *idx)
        .map(|(_, text)| text)
}

// ---------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------

/// Splits a candidate markdown table row into trimmed cells. `None` if the
/// line plainly isn't a pipe row (blank, or no `|` at all).
fn pipe_cells(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.contains('|') {
        return None;
    }
    let trimmed = trimmed.strip_prefix('|').unwrap_or(trimmed);
    let trimmed = trimmed.strip_suffix('|').unwrap_or(trimmed);
    let cells: Vec<String> = trimmed.split('|').map(|c| c.trim().to_string()).collect();
    if cells.is_empty() {
        None
    } else {
        Some(cells)
    }
}

/// A markdown table separator row: every cell is non-empty, made only of
/// `-`/`:`, and contains at least one `-` (so a lone `:` cell doesn't
/// falsely qualify).
fn is_separator_row(line: &str) -> bool {
    match pipe_cells(line) {
        Some(cells) => cells.iter().all(|c| {
            !c.is_empty() && c.contains('-') && c.chars().all(|ch| ch == '-' || ch == ':')
        }),
        None => false,
    }
}

#[derive(Default, Clone)]
struct ColumnMap {
    name: Option<usize>,
    tags: Option<usize>,
    priority: Option<usize>,
    description: Option<usize>,
    phase: Option<usize>,
    /// F6 §6: `"task type"` | `"type"` | `"kind"`. Distinct from `phase` —
    /// this is the shipped skill's own column, not a WO02-era one.
    task_type: Option<usize>,
    agent: Option<usize>,
    status: Option<usize>,
}

/// Header-driven, case-insensitive column mapping (contract §2). When two
/// header cells would map to the same kind, the first (leftmost) wins —
/// `is_none()` guards below give that for free.
fn map_columns(cells: &[String]) -> ColumnMap {
    let mut map = ColumnMap::default();
    for (idx, cell) in cells.iter().enumerate() {
        let lower = cell.trim().to_ascii_lowercase();
        match lower.as_str() {
            "name" | "task" | "title" if map.name.is_none() => map.name = Some(idx),
            // F6 §6: the whole trimmed cell must equal one of these three —
            // "task" alone (bare) still maps to NAME above, never here.
            "task type" | "type" | "kind" if map.task_type.is_none() => map.task_type = Some(idx),
            "tags" if map.tags.is_none() => map.tags = Some(idx),
            "priority" | "prio" if map.priority.is_none() => map.priority = Some(idx),
            "description" | "desc" | "details" if map.description.is_none() => {
                map.description = Some(idx)
            }
            "phase" if map.phase.is_none() => map.phase = Some(idx),
            "agent" | "assignee" | "owner" if map.agent.is_none() => map.agent = Some(idx),
            "status" | "state" if map.status.is_none() => map.status = Some(idx),
            _ => {}
        }
    }
    map
}

fn cell_at(cells: &[String], idx: Option<usize>) -> Option<String> {
    let idx = idx?;
    let v = cells.get(idx)?.trim();
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

/// Tags split on `,`/whitespace (contract §2).
fn split_tags(raw: &str) -> Vec<String> {
    raw.split(|c: char| c == ',' || c.is_whitespace())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

// ---------------------------------------------------------------------
// Reserved tag namespace — stable ids + dependencies (WO06 §3.1)
// ---------------------------------------------------------------------

/// Id grammar (§3.1 R5): `^t-[0-9a-z]{6}$`. Nothing else is an id — this is
/// the single gate that decides whether an `id:`/`needs:`-shaped tag is
/// honored as a reserved token or left as an ordinary user tag.
fn is_valid_task_id_str(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 8
        && bytes[0] == b't'
        && bytes[1] == b'-'
        && bytes[2..].iter().all(|&b| b.is_ascii_digit() || b.is_ascii_lowercase())
}

/// Lifts `id:`/`needs:` reserved tokens (§3.1 R1/R2) out of a raw tag list.
/// Returns `(remaining_user_tags, task_id, depends_on)`. Only a token whose
/// suffix matches the strict id grammar is recognized as reserved — an
/// `id:`/`needs:`-prefixed word that ISN'T a well-formed id is left as an
/// ordinary user tag (R5: "nothing else is an id"). At most one `id:` is
/// honored (first-wins, matching this file's convention-path search); every
/// well-formed `id:`/`needs:` token disappears from the returned tags
/// regardless (R2: "`TaskItem.tags` never contains a reserved token").
/// `depends_on` keeps write order (duplicates included — write-time
/// dedup is a separate concern from read-time lifting).
fn lift_reserved_tokens(tags: Vec<String>) -> (Vec<String>, Option<String>, Vec<String>) {
    let mut out_tags = Vec::with_capacity(tags.len());
    let mut task_id: Option<String> = None;
    let mut depends_on = Vec::new();
    for tag in tags {
        if let Some(id) = tag.strip_prefix("id:") {
            if is_valid_task_id_str(id) {
                if task_id.is_none() {
                    task_id = Some(id.to_string());
                }
                continue;
            }
        } else if let Some(dep) = tag.strip_prefix("needs:") {
            if is_valid_task_id_str(dep) {
                depends_on.push(dep.to_string());
                continue;
            }
        }
        out_tags.push(tag);
    }
    (out_tags, task_id, depends_on)
}

/// Composes the write-time tags cell/tag-run content in the frozen order
/// (§3.1 R4): `id:` first, then each `needs:` sorted byte-order, then
/// `user_tags` in their existing order. Reserved tokens are re-emitted from
/// `task_id`/`depends_on` — the already-parsed source — never from a patch.
fn compose_reserved_and_user_tags(
    task_id: Option<&str>,
    depends_on: &[String],
    user_tags: &[String],
) -> Vec<String> {
    let mut out = Vec::with_capacity(1 + depends_on.len() + user_tags.len());
    if let Some(id) = task_id {
        out.push(format!("id:{id}"));
    }
    let mut needs: Vec<&String> = depends_on.iter().collect();
    needs.sort();
    for d in needs {
        out.push(format!("needs:{d}"));
    }
    out.extend(user_tags.iter().cloned());
    out
}

/// `patch.tags`, trimmed and empty-filtered (mirrors the pre-WO06 write
/// rule for both regenerate functions), defaulting to empty when the patch
/// clears/omits tags.
fn cleaned_patch_tags(patch: &TaskPatch) -> Vec<String> {
    patch
        .tags
        .as_ref()
        .map(|tags| tags.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect())
        .unwrap_or_default()
}

fn build_table_task(
    rel_path: &str,
    line_no: usize,
    raw_line: &str,
    cells: &[String],
    map: &ColumnMap,
    section: Option<String>,
) -> Option<TaskItem> {
    let name = cell_at(cells, map.name)?;
    let raw_tags = cell_at(cells, map.tags).map(|s| split_tags(&s)).unwrap_or_default();
    let (tags, task_id, depends_on) = lift_reserved_tokens(raw_tags);
    let bucket = bucket_for_status_input(cell_at(cells, map.status).as_deref().unwrap_or(""));
    // WO02 §2.4: bucket when the cell text normalizes, otherwise the raw
    // trimmed cell text — tolerant, never drops an unrecognized value.
    let priority = cell_at(cells, map.priority)
        .map(|p| bucket_for_priority_input(&p).map(str::to_string).unwrap_or(p));
    Some(TaskItem {
        id: format!("{rel_path}#{line_no}"),
        rel_path: rel_path.to_string(),
        line: line_no,
        source: TaskSource::Table,
        name,
        description: cell_at(cells, map.description),
        tags,
        priority,
        phase: cell_at(cells, map.phase),
        task_type: cell_at(cells, map.task_type),
        agent: cell_at(cells, map.agent),
        done: bucket == "done",
        status: Some(bucket.to_string()),
        section,
        when: extract_when(raw_line),
        task_id,
        depends_on,
        blocked: false,
    })
}

// ---------------------------------------------------------------------
// Checklist parsing
// ---------------------------------------------------------------------

/// Name = text up to the first ` — ` / ` - ` / `.` boundary, description =
/// whatever trails it. Falls back to the whole text as the name (no
/// description) when no boundary is found, or when the boundary would
/// leave an empty name (line starts with the boundary itself).
fn split_name_desc(text: &str) -> (String, Option<String>) {
    let mut best: Option<(usize, usize)> = None; // (byte index, boundary length)
    if let Some(i) = text.find(" — ") {
        best = Some((i, " — ".len()));
    }
    if let Some(i) = text.find(" - ") {
        if best.is_none_or(|(bi, _)| i < bi) {
            best = Some((i, " - ".len()));
        }
    }
    if let Some(i) = text.find('.') {
        if best.is_none_or(|(bi, _)| i < bi) {
            best = Some((i, 1));
        }
    }
    if let Some((idx, blen)) = best {
        let name = text[..idx].trim();
        if !name.is_empty() {
            let desc = text[idx + blen..].trim();
            return (
                name.to_string(),
                if desc.is_empty() { None } else { Some(desc.to_string()) },
            );
        }
    }
    (text.trim().to_string(), None)
}

/// Scans whitespace-separated words for `#tag` (repeatable), `@agent`
/// (first wins), and a priority token (first wins): a `!low`/`!medium`/
/// `!high`/`!critical` token (WO02 §2.4, case-insensitive) or the legacy
/// bare `P0`..`P3` token, optionally parenthesized — both are normalized
/// through [`bucket_for_priority_input`], so the returned priority is
/// always a canonical bucket or `None`. Punctuation immediately around a
/// token is stripped.
fn extract_tokens(text: &str) -> (Vec<String>, Option<String>, Option<String>) {
    let mut tags = Vec::new();
    let mut agent: Option<String> = None;
    let mut priority: Option<String> = None;

    for raw_word in text.split_whitespace() {
        if let Some(tag) = raw_word.strip_prefix('#') {
            let cleaned = tag.trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_');
            if !cleaned.is_empty() {
                tags.push(cleaned.to_string());
            }
            continue;
        }
        if agent.is_none() {
            if let Some(name) = raw_word.strip_prefix('@') {
                let cleaned = name.trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_');
                if !cleaned.is_empty() {
                    agent = Some(cleaned.to_string());
                }
                continue;
            }
        }
        if priority.is_none() {
            let cleaned = raw_word.trim_matches(|c: char| matches!(c, '(' | ')' | ',' | '.' | ';' | ':'));
            if let Some(rest) = cleaned.strip_prefix('!') {
                if let Some(bucket) = bucket_for_priority_input(rest) {
                    priority = Some(bucket.to_string());
                }
            } else if cleaned.len() == 2 {
                let bytes = cleaned.as_bytes();
                let (p, d) = (bytes[0], bytes[1]);
                if (p == b'P' || p == b'p') && (b'0'..=b'3').contains(&d) {
                    if let Some(bucket) = bucket_for_priority_input(cleaned) {
                        priority = Some(bucket.to_string());
                    }
                }
            }
        }
    }
    (tags, agent, priority)
}

/// Checklist marker char -> `(done, status bucket)`. `None` for any char
/// other than the four recognized markers (contract §R2): `' '` = new,
/// `'>'` = in-production, `'?'` = in-testing, `'x'`/`'X'` = done.
fn marker_status(check_char: char) -> Option<(bool, &'static str)> {
    match check_char {
        'x' | 'X' => Some((true, "done")),
        ' ' => Some((false, "new")),
        '>' => Some((false, "in-production")),
        '?' => Some((false, "in-testing")),
        _ => None,
    }
}

/// Strips well-formed `#id:`/`#needs:` words out of a checklist item's free
/// text, BEFORE `split_name_desc`/`extract_tokens` ever see it (D7 fix).
/// Without this, a token minted by [`task_id_ensure`] — or hand-typed by a
/// user — is indistinguishable from prose to `split_name_desc`'s
/// dash/period boundary search: on a line with no boundary it becomes part
/// of `name`, on a line with an earlier `.` it becomes part of
/// `description`; either way `regenerate_checklist_line`/
/// `compose_checklist_text` then re-emit the SAME token from the
/// separately-tracked `task_id`/`depends_on` field, duplicating it on every
/// subsequent write (and, via [`task_move`]'s reparse-then-recompose path,
/// on every subsequent move too). Mirrors [`lift_reserved_tokens`]'s
/// grammar gate and first-wins `id:` rule exactly (R2/R5), just applied to
/// whitespace-separated words in raw text instead of an already-split tag
/// list. Returns the original `text` unchanged (not just equal — the very
/// same allocation-free borrow) when nothing was stripped, so a line with
/// no reserved token gets byte-identical treatment to before this fix.
fn strip_reserved_tokens(text: &str) -> (String, Option<String>, Vec<String>) {
    let mut task_id: Option<String> = None;
    let mut depends_on = Vec::new();
    let mut stripped_any = false;
    let mut words: Vec<&str> = Vec::new();
    for word in text.split_whitespace() {
        if let Some(tag) = word.strip_prefix('#') {
            if let Some(id) = tag.strip_prefix("id:") {
                if is_valid_task_id_str(id) {
                    if task_id.is_none() {
                        task_id = Some(id.to_string());
                    }
                    stripped_any = true;
                    continue;
                }
            } else if let Some(dep) = tag.strip_prefix("needs:") {
                if is_valid_task_id_str(dep) {
                    depends_on.push(dep.to_string());
                    stripped_any = true;
                    continue;
                }
            }
        }
        words.push(word);
    }
    let clean = if stripped_any { words.join(" ") } else { text.to_string() };
    (clean, task_id, depends_on)
}

fn parse_checklist_line(
    rel_path: &str,
    line_no: usize,
    line: &str,
    section: Option<String>,
) -> Option<TaskItem> {
    let trimmed = line.trim_start();
    let rest = trimmed.strip_prefix("- [")?;
    let mut chars = rest.chars();
    let check_char = chars.next()?;
    let after = chars.as_str().strip_prefix(']')?;
    let (done, status_bucket) = marker_status(check_char)?;
    let text = after.trim();
    if text.is_empty() {
        return None;
    }
    // D7: reserved tokens are lifted out of the prose surface BEFORE the
    // name/description boundary search and the ordinary-tag scan, not just
    // out of the returned `tags` list — see `strip_reserved_tokens`.
    let (clean_text, task_id, depends_on) = strip_reserved_tokens(text);
    let (name, description) = split_name_desc(&clean_text);
    let (tags, agent, priority) = extract_tokens(&clean_text);
    Some(TaskItem {
        id: format!("{rel_path}#{line_no}"),
        rel_path: rel_path.to_string(),
        line: line_no,
        source: TaskSource::Checklist,
        name,
        description,
        tags,
        priority,
        phase: None,
        task_type: None,
        agent,
        done,
        status: Some(status_bucket.to_string()),
        section,
        when: extract_when(line),
        task_id,
        depends_on,
        blocked: false,
    })
}

// ---------------------------------------------------------------------
// Combined scan
// ---------------------------------------------------------------------

/// Single left-to-right pass over `content`'s lines: an ATX heading line
/// updates the running "nearest `##`+ section" tracker; a header row
/// immediately followed by a separator row (with a name-like column)
/// starts a table that consumes subsequent pipe rows as data rows; every
/// other line is tried as a checklist line. Never errors — non-matching
/// lines simply contribute nothing.
pub(crate) fn parse_tasks(rel_path: &str, content: &str) -> Vec<TaskItem> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut out = Vec::new();
    let mut i = 0;
    let mut section: Option<String> = None;
    while i < lines.len() {
        if let Some((level, text)) = heading_level_and_text(lines[i]) {
            if level >= 2 {
                section = if text.is_empty() { None } else { Some(text) };
            }
            i += 1;
            continue;
        }
        if let Some(header_cells) = pipe_cells(lines[i]) {
            if i + 1 < lines.len() && is_separator_row(lines[i + 1]) {
                let map = map_columns(&header_cells);
                if map.name.is_some() {
                    let mut j = i + 2;
                    while j < lines.len() {
                        let Some(cells) = pipe_cells(lines[j]) else {
                            break;
                        };
                        if is_separator_row(lines[j]) {
                            break;
                        }
                        if let Some(item) =
                            build_table_task(rel_path, j + 1, lines[j], &cells, &map, section.clone())
                        {
                            out.push(item);
                        }
                        j += 1;
                    }
                    i = j;
                    continue;
                }
            }
        }
        if let Some(item) = parse_checklist_line(rel_path, i + 1, lines[i], section.clone()) {
            out.push(item);
        }
        i += 1;
    }
    out
}

// ---------------------------------------------------------------------
// Line surgery helpers
// ---------------------------------------------------------------------

/// Appends `raw_line` as the file's last content line, returning the new
/// content and the 1-based line number `raw_line` landed on. Creates a
/// `# <Name>` header when `existing` is empty (brand-new file).
fn append_raw_line(existing: &str, rel_path_for_header: &str, raw_line: &str) -> (String, usize) {
    let mut content = existing.to_string();
    if content.is_empty() {
        let stem = convention_stem(rel_path_for_header);
        content = format!("# {stem}\n\n");
    } else if !content.ends_with('\n') {
        content.push('\n');
    }
    let line_no = content.matches('\n').count() + 1;
    content.push_str(raw_line);
    content.push('\n');
    (content, line_no)
}

/// Removes the whole 1-based `line` from `content`. A `line` past the end
/// is a no-op (the stale-line guard in the commands below is what actually
/// protects this).
fn remove_line(content: &str, line: usize) -> String {
    let mut lines: Vec<&str> = content.split('\n').collect();
    let idx = line - 1;
    if idx < lines.len() {
        lines.remove(idx);
    }
    lines.join("\n")
}

/// Flips the `[ ]`/`[x]` char of a checklist line. Byte offset == char
/// offset here because everything up to and including `- [` is ASCII
/// (indentation is spaces/tabs).
fn toggle_checklist_text(line: &str, done: bool) -> String {
    let target = if done { 'x' } else { ' ' };
    let Some(pos) = line.find("- [") else {
        return line.to_string();
    };
    let idx = pos + 3;
    line.chars()
        .enumerate()
        .map(|(i, c)| if i == idx { target } else { c })
        .collect()
}

/// Leading whitespace run of `line` (spaces/tabs), used to preserve indent
/// when regenerating a checklist line.
fn leading_whitespace(line: &str) -> String {
    line.chars().take_while(|c| *c == ' ' || *c == '\t').collect()
}

/// Regenerates a checklist line canonically (contract §R3):
/// `- [m] Name — description #id:… #needs:… #tag… @agent P1`. Phase is not
/// encoded here — it's a table-only field. `name` is assumed already
/// validated non-empty. `task_id`/`depends_on` come from the *current*
/// parsed item, never from `patch` (WO06 §3.1 R4 — `TaskPatch` cannot carry
/// reserved tokens at all, see [`task_update`]'s validation), so they
/// survive a full-field rewrite even when `patch.tags` clears every user
/// tag.
fn regenerate_checklist_line(
    indent: &str,
    name: &str,
    patch: &TaskPatch,
    task_id: Option<&str>,
    depends_on: &[String],
) -> String {
    let bucket = derive_status_bucket(patch.status.as_deref(), patch.done);
    let marker = marker_for_bucket(bucket);
    let mut line = format!("{indent}- [{marker}] {name}");

    if let Some(desc) = patch.description.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        line.push_str(" — ");
        line.push_str(desc);
    }
    let user_tags = cleaned_patch_tags(patch);
    for tag in compose_reserved_and_user_tags(task_id, depends_on, &user_tags) {
        line.push_str(" #");
        line.push_str(&tag);
    }
    if let Some(agent) = patch.agent.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        line.push_str(" @");
        line.push_str(agent);
    }
    if let Some(priority) = patch.priority.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        line.push(' ');
        // WO02 §2.4: `!<bucket>` when it normalizes, else the raw trimmed
        // value bare (today's shape) so nothing is lost.
        match bucket_for_priority_input(priority) {
            Some(bucket) => {
                line.push('!');
                line.push_str(bucket);
            }
            None => line.push_str(priority),
        }
    }
    line
}

/// Splits a table row into `(has_leading_pipe, has_trailing_pipe, raw
/// cells)` where cells keep their original (untrimmed) text — the basis
/// for a byte-exact reconstruction of unmapped cells. Mirrors
/// [`pipe_cells`]'s prefix/suffix stripping so indices line up with a
/// [`ColumnMap`] built from the same row's header.
fn table_row_cells_raw(line: &str) -> Option<(bool, bool, Vec<String>)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.contains('|') {
        return None;
    }
    let leading = trimmed.starts_with('|');
    let mut body = trimmed;
    if leading {
        body = &body[1..];
    }
    let trailing = body.ends_with('|');
    if trailing {
        body = &body[..body.len() - 1];
    }
    let cells: Vec<String> = body.split('|').map(|c| c.to_string()).collect();
    Some((leading, trailing, cells))
}

/// Locates the table (if any) whose data rows include the 0-based
/// `row_idx`, returning its header's column map. Mirrors the table
/// detection in [`parse_tasks`] exactly.
fn table_at(lines: &[&str], row_idx: usize) -> Option<ColumnMap> {
    let mut i = 0;
    while i < lines.len() {
        if let Some(header_cells) = pipe_cells(lines[i]) {
            if i + 1 < lines.len() && is_separator_row(lines[i + 1]) {
                let map = map_columns(&header_cells);
                if map.name.is_some() {
                    let mut j = i + 2;
                    while j < lines.len() {
                        if pipe_cells(lines[j]).is_none() {
                            break;
                        }
                        if is_separator_row(lines[j]) {
                            break;
                        }
                        if j == row_idx {
                            return Some(map);
                        }
                        j += 1;
                    }
                    i = j;
                    continue;
                }
            }
        }
        i += 1;
    }
    None
}

/// Overwrites `cells[idx]` (when `idx` maps and is in range) with
/// `" value "`, or a single space when `value` is `None`/empty (a cleared
/// field).
fn set_cell(cells: &mut [String], idx: Option<usize>, value: Option<&str>) {
    let Some(idx) = idx else { return };
    if idx >= cells.len() {
        return;
    }
    let v = value.unwrap_or("").trim();
    cells[idx] = if v.is_empty() { " ".to_string() } else { format!(" {v} ") };
}

/// Regenerates a table row: only header-mapped cells are replaced (contract
/// §R3), unmapped cells and the row's leading/trailing pipe style are
/// preserved byte-exact. `name` is assumed already validated non-empty.
/// `task_id`/`depends_on` come from the *current* parsed item (WO06 §3.1
/// R4), composed into the Tags cell ahead of `patch`'s user tags — see
/// [`regenerate_checklist_line`] for the same rule on the checklist side.
fn regenerate_table_row(
    lines: &[String],
    row_idx: usize,
    name: &str,
    patch: &TaskPatch,
    task_id: Option<&str>,
    depends_on: &[String],
) -> Result<String, String> {
    let str_lines: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let map = table_at(&str_lines, row_idx).ok_or_else(|| "Task moved on disk — rescan".to_string())?;
    let (leading, trailing, mut cells) =
        table_row_cells_raw(&lines[row_idx]).ok_or_else(|| "Task moved on disk — rescan".to_string())?;

    let bucket = derive_status_bucket(patch.status.as_deref(), patch.done);
    let user_tags = cleaned_patch_tags(patch);
    let composed_tags = compose_reserved_and_user_tags(task_id, depends_on, &user_tags);
    let tags_joined = if composed_tags.is_empty() { None } else { Some(composed_tags.join(", ")) };

    // WO02 §2.4: bucket when the patch value normalizes, else the raw
    // trimmed value.
    let priority_value = patch.priority.as_deref().map(|p| {
        let trimmed = p.trim();
        bucket_for_priority_input(trimmed).map(str::to_string).unwrap_or_else(|| trimmed.to_string())
    });

    set_cell(&mut cells, map.name, Some(name));
    set_cell(&mut cells, map.description, patch.description.as_deref());
    set_cell(&mut cells, map.tags, tags_joined.as_deref());
    set_cell(&mut cells, map.priority, priority_value.as_deref());
    set_cell(&mut cells, map.phase, patch.phase.as_deref());
    set_cell(&mut cells, map.task_type, patch.task_type.as_deref());
    set_cell(&mut cells, map.agent, patch.agent.as_deref());
    set_cell(&mut cells, map.status, Some(bucket));

    let mut out = String::new();
    if leading {
        out.push('|');
    }
    out.push_str(&cells.join("|"));
    if trailing {
        out.push('|');
    }
    Ok(out)
}

// ---------------------------------------------------------------------
// Target-form-aware append/move (WO02 §2.3)
// ---------------------------------------------------------------------

/// Pads `value` (or empty text) with a single leading/trailing space —
/// `" value "`, or `"  "` (two spaces) when `value` is `None`/empty. Used
/// only for building a brand-new row from scratch ([`canonical_table_row`]);
/// unlike [`set_cell`] (which collapses an empty field to a single space
/// when *editing* an existing cell), a fresh row's empty cells always carry
/// both padding spaces, matching WO02 §2.3's literal canonical-table
/// example byte-for-byte.
fn pad_cell(value: Option<&str>) -> String {
    format!(" {} ", value.unwrap_or("").trim())
}

/// Builds one canonical-table data row (WO02 §2.3/§7.8 column order: Name,
/// Status, Priority, Tags, Agent, Description). `task_append` always passes
/// `status = "new"` — there is still no append-with-status primitive
/// (WO02); `task_move` (WO06 O3) passes the source item's own bucket
/// through instead of hardcoding it.
#[allow(clippy::too_many_arguments)]
fn canonical_table_row(
    name: &str,
    description: Option<&str>,
    priority: Option<&str>,
    tags: &[String],
    agent: Option<&str>,
    status: &str,
) -> String {
    let tags_joined = if tags.is_empty() { None } else { Some(tags.join(", ")) };
    format!(
        "|{}|{}|{}|{}|{}|{}|",
        pad_cell(Some(name)),
        pad_cell(Some(status)),
        pad_cell(priority),
        pad_cell(tags_joined.as_deref()),
        pad_cell(agent),
        pad_cell(description),
    )
}

/// Creates the canonical table block (WO02 §2.3 case 3): a brand-new `#
/// <STEM>` file when `existing` is empty, or the same header+separator+row
/// block appended after a blank line when `existing` has content but no
/// tasks. Returns the new full content and the 1-based line the new row
/// landed on.
#[allow(clippy::too_many_arguments)]
fn create_canonical_table(
    existing: &str,
    rel_path_for_header: &str,
    name: &str,
    description: Option<&str>,
    priority: Option<&str>,
    tags: &[String],
    agent: Option<&str>,
    status: &str,
) -> (String, usize) {
    const HEADER: &str = "| Name | Status | Priority | Tags | Agent | Description |";
    const SEP: &str = "|---|---|---|---|---|---|";
    let row = canonical_table_row(name, description, priority, tags, agent, status);

    let mut content = existing.to_string();
    if content.is_empty() {
        let stem = convention_stem(rel_path_for_header);
        content = format!("# {stem}\n\n");
    } else {
        // Normalize to exactly one blank line before the table, regardless
        // of how many (if any) blank lines the file already trails with.
        let trimmed = content.trim_end_matches('\n');
        content = format!("{trimmed}\n\n");
    }
    let row_line_no = content.matches('\n').count() + 3; // header, sep, then the row
    content.push_str(HEADER);
    content.push('\n');
    content.push_str(SEP);
    content.push('\n');
    content.push_str(&row);
    content.push('\n');
    (content, row_line_no)
}

/// Locates the **last** pipe table in `lines` whose header maps a `name`
/// column (mirrors the table detection in [`parse_tasks`]/[`table_at`]).
/// Returns `(column map, 0-based index to insert a new row after, leading
/// pipe, trailing pipe, cell count)` — the pipe style and cell count are
/// sampled from the table's last data row, or from the header row when the
/// table has none yet (so the very first inserted row still matches the
/// table's own shape).
fn last_named_table(lines: &[&str]) -> Option<(ColumnMap, usize, bool, bool, usize)> {
    let mut i = 0;
    let mut found = None;
    while i < lines.len() {
        if let Some(header_cells) = pipe_cells(lines[i]) {
            if i + 1 < lines.len() && is_separator_row(lines[i + 1]) {
                let map = map_columns(&header_cells);
                if map.name.is_some() {
                    let mut j = i + 2;
                    let mut last_data_idx: Option<usize> = None;
                    while j < lines.len() {
                        if pipe_cells(lines[j]).is_none() || is_separator_row(lines[j]) {
                            break;
                        }
                        last_data_idx = Some(j);
                        j += 1;
                    }
                    let anchor = last_data_idx.unwrap_or(i + 1);
                    let shape_line = last_data_idx.map_or(lines[i], |idx| lines[idx]);
                    if let Some((leading, trailing, cells)) = table_row_cells_raw(shape_line) {
                        found = Some((map, anchor, leading, trailing, cells.len()));
                    }
                    i = j;
                    continue;
                }
            }
        }
        i += 1;
    }
    found
}

/// Builds a new data row to insert into an existing table (WO02 §2.3 case
/// 1): mapped columns are filled from the parsed fields, every other cell
/// (unmapped, or a mapped field with no value) is a single space — mirrors
/// [`set_cell`]'s existing "cleared field" convention. `status` is the
/// literal `"new"` from `task_append`, or the source item's own bucket from
/// `task_move` (WO06 O3 — a moved row must not be forced back to `"new"`).
#[allow(clippy::too_many_arguments)]
fn build_table_append_row(
    map: &ColumnMap,
    leading: bool,
    trailing: bool,
    cell_count: usize,
    name: &str,
    description: Option<&str>,
    tags: &[String],
    agent: Option<&str>,
    priority: Option<&str>,
    status: &str,
    task_type: Option<&str>,
) -> String {
    let mut cells = vec![" ".to_string(); cell_count];
    let tags_joined = if tags.is_empty() { None } else { Some(tags.join(", ")) };
    set_cell(&mut cells, map.name, Some(name));
    set_cell(&mut cells, map.description, description);
    set_cell(&mut cells, map.tags, tags_joined.as_deref());
    set_cell(&mut cells, map.agent, agent);
    set_cell(&mut cells, map.priority, priority);
    set_cell(&mut cells, map.status, Some(status));
    set_cell(&mut cells, map.task_type, task_type);

    let mut out = String::new();
    if leading {
        out.push('|');
    }
    out.push_str(&cells.join("|"));
    if trailing {
        out.push('|');
    }
    out
}

/// Core of [`task_append`]'s target-form-aware write (WO02 §2.3). `text` is
/// parsed with the existing checklist extractors ([`split_name_desc`] +
/// [`extract_tokens`]); the three-way rule then decides the destination
/// shape:
///
/// 1. The last name-mapped pipe table in `existing` (if any) gets a new row
///    inserted right after its last data row.
/// 2. Else, if `existing` has at least one checklist task, `- [ ] <text>`
///    is appended at EOF (today's behaviour, unchanged).
/// 3. Else, a fresh canonical table is created ([`create_canonical_table`]).
///
/// Returns the new full content and the 1-based line the item landed on.
///
/// `task_append` never mints an id and takes no dependency-graph edge from
/// free text (§3.1 "No auto-mint") — any `#id:t-xxxxxx`/`#needs:t-xxxxxx`-
/// shaped word a user happens to type into the table-row-building path is
/// silently dropped rather than accidentally becoming a real reserved
/// token. This does not extend to the checklist-append branch below, which
/// (like every token shape today, not just the new reserved ones) copies
/// `text` verbatim — an extant, unmodified behavior, not a WO06 regression.
fn write_task_text(existing: &str, rel_path_for_header: &str, text: &str) -> (String, usize) {
    let (name, description) = split_name_desc(text);
    let (raw_tags, agent, priority) = extract_tokens(text);
    let (tags, _dropped_id, _dropped_deps) = lift_reserved_tokens(raw_tags);

    let lines: Vec<&str> = existing.split('\n').collect();
    if let Some((map, anchor, leading, trailing, cell_count)) = last_named_table(&lines) {
        let row = build_table_append_row(
            &map,
            leading,
            trailing,
            cell_count,
            &name,
            description.as_deref(),
            &tags,
            agent.as_deref(),
            priority.as_deref(),
            "new",
            // F6: free text has no established Task Type token grammar —
            // `task_append` never invents one, mirroring the "no auto-mint"
            // rule already documented above for ids/deps.
            None,
        );
        let mut new_lines: Vec<String> = existing.split('\n').map(|s| s.to_string()).collect();
        let insert_at = anchor + 1;
        new_lines.insert(insert_at, row);
        return (new_lines.join("\n"), insert_at + 1);
    }

    let existing_tasks = parse_tasks(rel_path_for_header, existing);
    if !existing_tasks.is_empty() {
        let raw_line = format!("- [ ] {text}");
        return append_raw_line(existing, rel_path_for_header, &raw_line);
    }

    create_canonical_table(
        existing,
        rel_path_for_header,
        &name,
        description.as_deref(),
        priority.as_deref(),
        &tags,
        agent.as_deref(),
        "new",
    )
}

/// Composes `Name — description #tag… @agent !priority`/`Pn` from discrete
/// fields — the checklist-target shape for [`write_task_fields`]'s case 2.
/// Priority is emitted `!<bucket>` when it normalizes, else bare (mirrors
/// [`regenerate_checklist_line`]'s write rule, WO02 §2.4).
fn compose_checklist_text(
    name: &str,
    description: Option<&str>,
    tags: &[String],
    agent: Option<&str>,
    priority: Option<&str>,
) -> String {
    let mut text = name.to_string();
    if let Some(desc) = description.filter(|d| !d.is_empty()) {
        text.push_str(" — ");
        text.push_str(desc);
    }
    for tag in tags {
        text.push_str(" #");
        text.push_str(tag);
    }
    if let Some(agent) = agent.filter(|a| !a.is_empty()) {
        text.push_str(" @");
        text.push_str(agent);
    }
    if let Some(priority) = priority.filter(|p| !p.is_empty()) {
        text.push(' ');
        match bucket_for_priority_input(priority) {
            Some(bucket) => {
                text.push('!');
                text.push_str(bucket);
            }
            None => text.push_str(priority),
        }
    }
    text
}

/// Core of [`task_move`]'s target-form-aware write (WO02 §2.3): the same
/// three-way branching as [`write_task_text`], but takes the source item's
/// already-parsed fields directly instead of re-parsing free text — both
/// checklist- and table-sourced items already have them (from [`parse_tasks`]),
/// so tags/agent/priority survive a move regardless of the source's shape.
/// The checklist-target case (2) composes a fresh line via
/// [`compose_checklist_text`]. **WO06 O3**: `status` is the source item's
/// own bucket (not hardcoded `"new"` — a moved `done` row must arrive
/// `done`), and `task_id`/`depends_on` are re-composed into the tags ahead
/// of `tags` in every branch (§3.1 R4 — otherwise moving a linked task
/// silently orphans its tasklinks entry). **F6**: `task_type` follows the
/// same rule — the source item's own value, so moving a task between two
/// Task-Type-columned tables preserves it, same as `agent`/`priority`.
#[allow(clippy::too_many_arguments)]
fn write_task_fields(
    existing: &str,
    rel_path_for_header: &str,
    name: &str,
    description: Option<&str>,
    tags: &[String],
    agent: Option<&str>,
    priority: Option<&str>,
    status: &str,
    task_id: Option<&str>,
    depends_on: &[String],
    task_type: Option<&str>,
) -> (String, usize) {
    let composed_tags = compose_reserved_and_user_tags(task_id, depends_on, tags);
    let lines: Vec<&str> = existing.split('\n').collect();
    if let Some((map, anchor, leading, trailing, cell_count)) = last_named_table(&lines) {
        let row = build_table_append_row(
            &map, leading, trailing, cell_count, name, description, &composed_tags, agent, priority, status,
            task_type,
        );
        let mut new_lines: Vec<String> = existing.split('\n').map(|s| s.to_string()).collect();
        let insert_at = anchor + 1;
        new_lines.insert(insert_at, row);
        return (new_lines.join("\n"), insert_at + 1);
    }

    let existing_tasks = parse_tasks(rel_path_for_header, existing);
    if !existing_tasks.is_empty() {
        let text = compose_checklist_text(name, description, &composed_tags, agent, priority);
        let marker = marker_for_bucket(status);
        let raw_line = format!("- [{marker}] {text}");
        return append_raw_line(existing, rel_path_for_header, &raw_line);
    }

    create_canonical_table(existing, rel_path_for_header, name, description, priority, &composed_tags, agent, status)
}

// ---------------------------------------------------------------------
// Whole-board scan (WO06 §3.1/§3.3) — id collisions, the dependency DAG,
// and the surgical tag-only write path shared by task_id_ensure /
// task_depends_add / task_depends_remove.
// ---------------------------------------------------------------------

/// Reads and parses every convention file that currently exists,
/// concatenated in [`CONVENTION_NAMES`] order. Shared by [`tasks_scan`]
/// (which also needs per-file [`TaskFileInfo`], computed separately) and
/// the id/dependency mutation commands, which only need the flat list — for
/// the whole-board id index and cycle check.
fn scan_all_task_items(root_path: &Path) -> Vec<TaskItem> {
    let mut tasks = Vec::new();
    for name in CONVENTION_NAMES {
        if let Some(rel) = convention_candidates(name).into_iter().find(|c| root_path.join(c).is_file()) {
            let content = fs::read_to_string(root_path.join(&rel)).unwrap_or_default();
            tasks.extend(parse_tasks(&rel, &content));
        }
    }
    tasks
}

/// Every distinct `id:` value already present across all five convention
/// files (§3.1 minting rule #4's collision scan).
fn all_existing_task_ids(root_path: &Path) -> HashSet<String> {
    scan_all_task_items(root_path).into_iter().filter_map(|t| t.task_id).collect()
}

/// FNV-1a, 64-bit — the whole minting scheme's only "hash", chosen because
/// it needs no dependency (§3.1 minting rule #3 forbids one).
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Base36, lower-case, zero-padded to 6 chars — id grammar `t-[0-9a-z]{6}`
/// (§3.1 R5).
fn base36_6(mut n: u64) -> String {
    const ALPHABET: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = [b'0'; 6];
    for slot in out.iter_mut().rev() {
        *slot = ALPHABET[(n % 36) as usize];
        n /= 36;
    }
    String::from_utf8(out.to_vec()).expect("ALPHABET is ASCII")
}

/// Monotonic counter mixed into every mint attempt so two candidates
/// generated inside the same process, even at the same OS-clock nanosecond,
/// never collide with each other (§3.1 minting rule #3).
static MINT_COUNTER: AtomicU64 = AtomicU64::new(0);

/// One mint candidate (§3.1 minting rule #3): `h = fnv1a64(now_nanos ^
/// process_counter ^ rel_path_bytes ^ line)`, `h % 36^6`, base36 zero-padded
/// to 6 chars, prefixed `t-`. `attempt` folds into the mix too (rule #4: up
/// to 16 retries on a collision), so a retry always produces a different
/// candidate even within the same nanosecond.
fn mint_task_id(rel_path: &str, line: usize, attempt: u64) -> String {
    let now_nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let counter = MINT_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut buf = Vec::with_capacity(rel_path.len() + 32);
    buf.extend_from_slice(&now_nanos.to_le_bytes());
    buf.extend_from_slice(&counter.to_le_bytes());
    buf.extend_from_slice(&attempt.to_le_bytes());
    buf.extend_from_slice(rel_path.as_bytes());
    buf.extend_from_slice(&(line as u64).to_le_bytes());
    let h = fnv1a64(&buf);
    format!("t-{}", base36_6(h % 36u64.pow(6)))
}

/// `(is_whitespace, text)` runs covering the whole line — the basis for
/// [`splice_checklist_tags`]'s byte-exact non-tag preservation. Only
/// space/tab count as whitespace here (matches [`leading_whitespace`]).
fn word_segments(line: &str) -> Vec<(bool, &str)> {
    let bytes = line.as_bytes();
    let n = bytes.len();
    let is_ws = |b: u8| b == b' ' || b == b'\t';
    let mut segs = Vec::new();
    let mut i = 0;
    while i < n {
        let ws = is_ws(bytes[i]);
        let start = i;
        while i < n && is_ws(bytes[i]) == ws {
            i += 1;
        }
        segs.push((ws, &line[start..i]));
    }
    segs
}

/// Splices the `#tag` word-run of a checklist line to exactly `new_tags`
/// (each rendered `#<tag>`), preserving every other word and every run of
/// whitespace byte-exact. The new run lands where the first old tag word
/// was; when the line had no tag words at all, the new run is appended at
/// the end. Used by [`task_id_ensure`]/[`task_depends_add`]/
/// [`task_depends_remove`] via [`write_reserved_tags`] — the only three
/// writers required to touch nothing but the tag run (§3.1 minting rule
/// #5).
fn splice_checklist_tags(line: &str, new_tags: &[String]) -> String {
    let segs = word_segments(line);
    let tag_positions: Vec<usize> = segs
        .iter()
        .enumerate()
        .filter(|(_, (ws, text))| !ws && text.starts_with('#'))
        .map(|(i, _)| i)
        .collect();
    let new_words: Vec<String> = new_tags.iter().map(|t| format!("#{t}")).collect();

    if tag_positions.is_empty() {
        if new_words.is_empty() {
            return line.to_string();
        }
        let mut out = line.to_string();
        for w in &new_words {
            out.push(' ');
            out.push_str(w);
        }
        return out;
    }

    let first = tag_positions[0];
    let mut remove = vec![false; segs.len()];
    for &idx in &tag_positions {
        remove[idx] = true;
        if idx > 0 && segs[idx - 1].0 {
            remove[idx - 1] = true;
        }
    }

    let mut out = String::new();
    let mut inserted = false;
    for (i, (_, text)) in segs.iter().enumerate() {
        if remove[i] {
            if i == first && !new_words.is_empty() {
                if !out.is_empty() && !out.ends_with(' ') && !out.ends_with('\t') {
                    out.push(' ');
                }
                out.push_str(&new_words.join(" "));
                inserted = true;
            }
            continue;
        }
        out.push_str(text);
    }
    if !inserted && !new_words.is_empty() {
        for w in &new_words {
            out.push(' ');
            out.push_str(w);
        }
    }
    out
}

/// Rewrites ONLY the Tags cell (table) / `#tag` word-run (checklist) of the
/// line at `idx`, composing it from `task_id`/`depends_on`/`user_tags` in
/// the frozen order (§3.1 R4). Every other byte of the line — including
/// every unmapped table cell — is untouched. Table rows require a mapped
/// Tags column; the caller is expected to have already checked that (§3.1
/// minting rule #2) — here, a missing mapping just means [`set_cell`]
/// silently keeps the row unchanged, which would hide a real bug, so this
/// still re-derives the map itself and treats a stale/moved row as the
/// usual rescan error.
fn write_reserved_tags(
    lines: &[String],
    idx: usize,
    source: &TaskSource,
    task_id: Option<&str>,
    depends_on: &[String],
    user_tags: &[String],
) -> Result<String, String> {
    let composed = compose_reserved_and_user_tags(task_id, depends_on, user_tags);
    match source {
        TaskSource::Checklist => Ok(splice_checklist_tags(&lines[idx], &composed)),
        TaskSource::Table => {
            let str_lines: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
            let map = table_at(&str_lines, idx).ok_or_else(|| "Task moved on disk — rescan".to_string())?;
            let (leading, trailing, mut cells) =
                table_row_cells_raw(&lines[idx]).ok_or_else(|| "Task moved on disk — rescan".to_string())?;
            let joined = if composed.is_empty() { None } else { Some(composed.join(", ")) };
            set_cell(&mut cells, map.tags, joined.as_deref());
            let mut out = String::new();
            if leading {
                out.push('|');
            }
            out.push_str(&cells.join("|"));
            if trailing {
                out.push('|');
            }
            Ok(out)
        }
    }
}

/// BFS from `target`, following each task's own `depends_on` edges
/// (resolved through unique, non-duplicated ids only), looking for
/// `own_id`. `None` if unreachable. `Some(path)` otherwise: the concrete
/// cycle that adding `own_id needs:target` would close, `own_id` first and
/// last (D4's convention). Neighbor expansion is sorted byte-order so the
/// result is deterministic even when more than one path exists (same
/// "smallest-id-first, stable tie-break" discipline as [`find_task_cycle`]).
fn would_create_cycle(board: &[TaskItem], own_id: &str, target: &str) -> Option<Vec<String>> {
    let mut rep_of: BTreeMap<&str, usize> = BTreeMap::new();
    for (i, t) in board.iter().enumerate() {
        if let Some(id) = t.task_id.as_deref() {
            rep_of.entry(id).or_insert(i);
        }
    }

    let mut visited: BTreeSet<&str> = BTreeSet::new();
    let mut queue: VecDeque<&str> = VecDeque::new();
    let mut parent: BTreeMap<&str, &str> = BTreeMap::new();
    visited.insert(target);
    queue.push_back(target);

    while let Some(cur) = queue.pop_front() {
        if cur == own_id {
            let mut path: Vec<&str> = vec![cur];
            let mut node = cur;
            while let Some(&p) = parent.get(node) {
                path.push(p);
                node = p;
            }
            path.reverse();
            let mut cycle: Vec<String> = vec![own_id.to_string()];
            cycle.extend(path.into_iter().map(str::to_string));
            return Some(cycle);
        }
        if let Some(&idx) = rep_of.get(cur) {
            let mut deps: Vec<&str> = board[idx].depends_on.iter().map(String::as_str).collect();
            deps.sort();
            for d in deps {
                if rep_of.contains_key(d) && visited.insert(d) {
                    parent.insert(d, cur);
                    queue.push_back(d);
                }
            }
        }
    }
    None
}

/// Kahn's algorithm over the task-dependency graph — same technique as
/// `compile.rs`'s `total_order`/`find_cycle` and `lint.rs`'s `check_cycle`
/// (D4: "the identical deterministic walk"), applied to a third type
/// (`TaskItem`) over a third relation ("needs", not "imports"/"sequence").
/// An edge `i needs j` puts `j` before `i` — same "target established
/// first" direction `compile.rs` uses for `imports`/`overrides`. Tie-break
/// is pure byte-order on the id string (task ids have no `readOrder`
/// analogue). Returns `None` when the graph is acyclic, else one concrete
/// cycle (first id repeated last), found by walking predecessors from the
/// smallest-id residual node — mirrors `compile.rs`'s `find_cycle` and,
/// like it and `lint.rs`'s sibling, reports at most one cycle per call even
/// when the graph contains several disjoint ones (not something either
/// prior implementation does either — see the memory note filed for this
/// lane before generalizing).
fn find_task_cycle(node_ids: &[&str], out_edges: &BTreeMap<&str, Vec<&str>>) -> Option<Vec<String>> {
    let n = node_ids.len();
    let idx_of: HashMap<&str, usize> = node_ids.iter().enumerate().map(|(i, &id)| (id, i)).collect();
    let mut indeg = vec![0usize; n];
    let mut succ: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut pred: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, &id) in node_ids.iter().enumerate() {
        if let Some(deps) = out_edges.get(id) {
            for &d in deps {
                let j = idx_of[d];
                succ[j].push(i);
                pred[i].push(j);
                indeg[i] += 1;
            }
        }
    }

    let mut ready: BinaryHeap<Reverse<(String, usize)>> = BinaryHeap::new();
    for i in 0..n {
        if indeg[i] == 0 {
            ready.push(Reverse((node_ids[i].to_string(), i)));
        }
    }
    let mut order = Vec::with_capacity(n);
    while let Some(Reverse((_, i))) = ready.pop() {
        order.push(i);
        for &v in &succ[i] {
            indeg[v] -= 1;
            if indeg[v] == 0 {
                ready.push(Reverse((node_ids[v].to_string(), v)));
            }
        }
    }
    if order.len() == n {
        return None;
    }

    let mut in_residual = vec![true; n];
    for &i in &order {
        in_residual[i] = false;
    }
    let start = (0..n).filter(|&i| in_residual[i]).min_by(|&a, &b| node_ids[a].cmp(node_ids[b])).expect(
        "residual is non-empty when a cycle exists",
    );
    let mut path = vec![start];
    loop {
        let cur = *path.last().expect("path never empty");
        let prev = pred[cur]
            .iter()
            .copied()
            .filter(|&p| in_residual[p])
            .min_by(|&a, &b| node_ids[a].cmp(node_ids[b]))
            .expect("residual nodes keep a residual predecessor");
        if let Some(hit) = path.iter().position(|&x| x == prev) {
            let mut cycle = vec![prev];
            cycle.extend(path[hit + 1..].iter().rev().copied());
            cycle.push(prev);
            return Some(cycle.into_iter().map(|i| node_ids[i].to_string()).collect());
        }
        path.push(prev);
    }
}

/// Builds the task DAG report (§3.3) and, aligned by index, a `blocked`
/// flag per input task. Duplicated ids (§3.1: "reported, never repaired")
/// use the first-scan-order occurrence as the graph's representative for
/// that id — same first-wins convention this file already uses for
/// convention-path resolution; the duplicate is still reported in
/// `duplicate_ids` and any *other* task's `needs:` on that id is rejected
/// by [`task_depends_add`] outright, so this representative choice is never
/// load-bearing for a *new* edge, only for `blocked`/cycle reporting on
/// pre-existing files.
fn compute_dag(tasks: &[TaskItem]) -> (TaskDag, Vec<bool>) {
    let mut by_id: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (i, t) in tasks.iter().enumerate() {
        if let Some(id) = t.task_id.as_deref() {
            by_id.entry(id).or_default().push(i);
        }
    }
    let duplicate_ids: Vec<String> =
        by_id.iter().filter(|(_, idxs)| idxs.len() > 1).map(|(id, _)| id.to_string()).collect();
    let rep_of: BTreeMap<&str, usize> = by_id.iter().map(|(id, idxs)| (*id, idxs[0])).collect();

    let mut unresolved: Vec<UnresolvedDep> = Vec::new();
    let mut out_edges: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (&id, &rep_idx) in &rep_of {
        let mut outs: Vec<&str> = Vec::new();
        for dep in &tasks[rep_idx].depends_on {
            if by_id.contains_key(dep.as_str()) {
                outs.push(dep.as_str());
            } else {
                unresolved.push(UnresolvedDep { task_id: id.to_string(), depends_on: dep.clone() });
            }
        }
        outs.sort();
        outs.dedup();
        out_edges.insert(id, outs);
    }
    // Tasks with no id of their own were never a `rep_of` key above, so
    // their own `depends_on` was never checked for unresolved targets. O1
    // (§3.1 R6): `UnresolvedDep.task_id` is documented as the stable id,
    // and `TaskItem.id` (the volatile `"<relPath>#<line>"` locator) must
    // never be substituted into it — so an id-less task's unresolved
    // `needs:` is simply omitted here rather than reported under a locator
    // masquerading as a stable id. It is still visible on the task itself
    // via `TaskItem.depends_on`; only the board-wide `dag.unresolved`
    // summary — which the UI renders as "<taskId> needs <dependsOn>" —
    // requires a real id to key on.
    unresolved.sort_by(|a, b| (a.task_id.as_str(), a.depends_on.as_str()).cmp(&(b.task_id.as_str(), b.depends_on.as_str())));

    let node_ids: Vec<&str> = rep_of.keys().copied().collect(); // BTreeMap: already byte-sorted
    let cycles: Vec<Vec<String>> = find_task_cycle(&node_ids, &out_edges).into_iter().collect();
    let cycle_ids: HashSet<&str> = cycles.iter().flatten().map(String::as_str).collect();

    let mut blocked = vec![false; tasks.len()];
    for (i, t) in tasks.iter().enumerate() {
        let mut is_blocked = false;
        for dep in &t.depends_on {
            if let Some(&rep_idx) = rep_of.get(dep.as_str()) {
                let dep_status = tasks[rep_idx].status.as_deref().unwrap_or("new");
                if dep_status != "done" {
                    is_blocked = true;
                }
            }
            // Unresolved dependency: does NOT block (D1) — a typo must not
            // deadlock the board.
        }
        if let Some(id) = t.task_id.as_deref() {
            if cycle_ids.contains(id) {
                is_blocked = true; // D2: every task in a reported cycle is blocked.
            }
        }
        blocked[i] = is_blocked;
    }

    (TaskDag { cycles, duplicate_ids, unresolved }, blocked)
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

/// Scans the five convention files (contract §3; WO02 §2.3 adds
/// `BUGS.md`). Always reports exactly 5 entries in convention order.
/// Unreadable files are treated as empty — tolerant, never errors past a
/// bad `root`. Also computes the task DAG (WO06 §3.3) and stamps every
/// returned [`TaskItem`]'s `blocked` field — the one place that happens,
/// since only a whole-board scan can see cross-file dependencies.
///
/// **O2 fix**: a missing file no longer reports a bare root-level
/// `relPath`. It reports `<home><name>`, where `home` is the directory of
/// the existing convention file whose name comes first in
/// [`CONVENTION_NAMES`] order (deterministic, no majority vote), or
/// `"docs/tasks/"` — Cowtext's own documented layout — when no convention
/// file exists at all.
#[tauri::command]
pub fn tasks_scan(root: String) -> Result<TasksScan, String> {
    let root_path = checked_root(&root)?;

    // First pass: where does each convention file actually live, if it
    // exists at all? Needed up front because O2's `home` choice depends on
    // ALL five names' existence, not just the ones seen so far.
    let found_dirs: Vec<Option<&str>> = CONVENTION_NAMES
        .iter()
        .map(|name| {
            CONVENTION_DIRS.iter().find(|dir| root_path.join(format!("{dir}{name}")).is_file()).copied()
        })
        .collect();
    let home = found_dirs.iter().copied().flatten().next().unwrap_or("docs/tasks/");

    let mut files = Vec::with_capacity(CONVENTION_NAMES.len());
    let mut tasks = Vec::new();

    for (name, found_dir) in CONVENTION_NAMES.iter().zip(found_dirs.iter()) {
        match found_dir {
            Some(dir) => {
                let rel = format!("{dir}{name}");
                let path = root_path.join(&rel);
                let content = fs::read_to_string(&path).unwrap_or_default();
                let mut file_tasks = parse_tasks(&rel, &content);
                files.push(TaskFileInfo {
                    rel_path: rel,
                    exists: true,
                    task_count: file_tasks.len(),
                });
                tasks.append(&mut file_tasks);
            }
            None => files.push(TaskFileInfo {
                rel_path: format!("{home}{name}"),
                exists: false,
                task_count: 0,
            }),
        }
    }

    let (dag, blocked_flags) = compute_dag(&tasks);
    let tasks: Vec<TaskItem> =
        tasks.into_iter().zip(blocked_flags).map(|(t, blocked)| TaskItem { blocked, ..t }).collect();

    Ok(TasksScan { files, tasks, dag })
}

/// Toggles a checklist task's done state (contract §3). Errors with the
/// stale-line guard if `line` no longer parses as a task, or with "Not a
/// checklist task" if it parses as a table row instead.
#[tauri::command]
pub fn task_toggle(root: String, rel_path: String, line: usize, done: bool) -> Result<TaskItem, String> {
    ensure_convention_path(&rel_path)?;
    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &rel_path)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("{rel_path}: {e}"))?;

    let current = parse_tasks(&rel_path, &content)
        .into_iter()
        .find(|t| t.line == line)
        .ok_or_else(|| "Task moved on disk — rescan".to_string())?;
    if current.source != TaskSource::Checklist {
        return Err(format!("Not a checklist task: {rel_path}#{line}"));
    }

    let mut lines: Vec<String> = content.split('\n').map(|s| s.to_string()).collect();
    let idx = line - 1;
    lines[idx] = toggle_checklist_text(&lines[idx], done);
    write_atomic(&path, &lines.join("\n"))?;

    let borrowed: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let section = nearest_section(&borrowed, line);
    parse_checklist_line(&rel_path, line, &lines[idx], section)
        .ok_or_else(|| "Task moved on disk — rescan".to_string())
}

/// Appends a task using the target-form-aware three-way rule (WO02 §2.3,
/// [`write_task_text`]): a row into the file's last name-mapped pipe table,
/// a `- [ ] <text>` checklist line when the file only has checklist tasks
/// (today's behaviour, unchanged), or a fresh canonical table when the file
/// is empty/missing/taskless. Only the five convention paths are writable.
#[tauri::command]
pub fn task_append(root: String, rel_path: String, text: String) -> Result<TaskItem, String> {
    ensure_convention_path(&rel_path)?;
    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &rel_path)?;

    let existing = fs::read_to_string(&path).unwrap_or_default();
    let (content, line_no) = write_task_text(&existing, &rel_path, &text);
    write_atomic(&path, &content)?;

    parse_tasks(&rel_path, &content)
        .into_iter()
        .find(|t| t.line == line_no)
        .ok_or_else(|| "Failed to parse appended task".to_string())
}

/// Moves the WHOLE item at `fromRelPath#line` into `toRelPath`, writing it
/// using the same target-form-aware three-way rule as [`task_append`]
/// ([`write_task_fields`]) — table row, checklist line, or fresh canonical
/// table depending on what the target already has. The moved item's fields
/// (name/description/tags/agent/priority) come from the source's already-
/// parsed [`TaskItem`], so they survive regardless of whether the source
/// was a table row or a checklist line. Target is written first, then
/// source; on a source write failure the target is rolled back to its
/// pre-move content (or removed, if it didn't exist before) so nothing is
/// half-moved.
#[tauri::command]
pub fn task_move(
    root: String,
    from_rel_path: String,
    line: usize,
    to_rel_path: String,
) -> Result<TaskItem, String> {
    ensure_convention_path(&from_rel_path)?;
    ensure_convention_path(&to_rel_path)?;
    if from_rel_path.replace('\\', "/") == to_rel_path.replace('\\', "/") {
        return Err("Cannot move a task to the same file".to_string());
    }

    let root_path = checked_root(&root)?;
    let from_path = resolve_within_root(&root_path, &from_rel_path)?;
    let to_path = resolve_within_root(&root_path, &to_rel_path)?;

    let from_content = fs::read_to_string(&from_path).map_err(|e| format!("{from_rel_path}: {e}"))?;
    let item = parse_tasks(&from_rel_path, &from_content)
        .into_iter()
        .find(|t| t.line == line)
        .ok_or_else(|| "Task moved on disk — rescan".to_string())?;

    let to_existed = to_path.is_file();
    let to_existing = if to_existed {
        fs::read_to_string(&to_path).map_err(|e| format!("{to_rel_path}: {e}"))?
    } else {
        String::new()
    };
    let (to_content, new_line_no) = write_task_fields(
        &to_existing,
        &to_rel_path,
        &item.name,
        item.description.as_deref(),
        &item.tags,
        item.agent.as_deref(),
        item.priority.as_deref(),
        item.status.as_deref().unwrap_or("new"),
        item.task_id.as_deref(),
        &item.depends_on,
        item.task_type.as_deref(),
    );

    // Write target first.
    write_atomic(&to_path, &to_content)?;

    // Then remove from source; roll target back if that fails so nothing
    // is left half-moved.
    let new_from_content = remove_line(&from_content, line);
    if let Err(e) = write_atomic(&from_path, &new_from_content) {
        let rollback = if to_existed {
            write_atomic(&to_path, &to_existing)
        } else {
            fs::remove_file(&to_path).map_err(|err| format!("{}: {err}", to_path.display()))
        };
        return Err(match rollback {
            Ok(()) => e,
            Err(rollback_err) => {
                format!("{e}; additionally failed to roll back {to_rel_path}: {rollback_err}")
            }
        });
    }

    parse_tasks(&to_rel_path, &to_content)
        .into_iter()
        .find(|t| t.line == new_line_no)
        .ok_or_else(|| "Failed to parse moved task".to_string())
}

/// Updates a task in place from a full editable field set (contract §R3).
/// Checklist lines are regenerated canonically
/// (`- [m] Name — description #tag… @agent P1`, phase omitted — table-only
/// field); table rows get per-cell replacement via the header's column
/// map, unmapped cells preserved byte-exact. `patch.name` clearing to
/// empty is an error; every other field treats `None` (JSON `null` or an
/// absent key) as "clear". Stale-line guard identical to [`task_toggle`].
/// **WO06 §3.1 R3**: `patch.tags` may never carry a reserved `id:`/`needs:`
/// token — rejected up front, before any file IO, so a UI bug can never
/// smuggle one in. Reserved tokens are always re-emitted from the current
/// parsed item, never from `patch` (R4). Returns the updated item with
/// `section`/`when` recomputed.
#[tauri::command]
pub fn task_update(root: String, rel_path: String, line: usize, patch: TaskPatch) -> Result<TaskItem, String> {
    ensure_convention_path(&rel_path)?;
    if let Some(tags) = &patch.tags {
        for tag in tags {
            if tag.starts_with("id:") || tag.starts_with("needs:") {
                return Err(format!("reserved tag prefix in patch.tags: {tag}"));
            }
        }
    }
    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &rel_path)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("{rel_path}: {e}"))?;

    let current = parse_tasks(&rel_path, &content)
        .into_iter()
        .find(|t| t.line == line)
        .ok_or_else(|| "Task moved on disk — rescan".to_string())?;

    let name = patch
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Task name cannot be empty".to_string())?;

    let mut lines: Vec<String> = content.split('\n').map(|s| s.to_string()).collect();
    let idx = line - 1;

    let new_line = match current.source {
        TaskSource::Checklist => {
            let indent = leading_whitespace(&lines[idx]);
            regenerate_checklist_line(&indent, name, &patch, current.task_id.as_deref(), &current.depends_on)
        }
        TaskSource::Table => {
            regenerate_table_row(&lines, idx, name, &patch, current.task_id.as_deref(), &current.depends_on)?
        }
    };
    lines[idx] = new_line;
    let new_content = lines.join("\n");
    write_atomic(&path, &new_content)?;

    match current.source {
        TaskSource::Checklist => {
            let updated_lines: Vec<&str> = new_content.split('\n').collect();
            let section = nearest_section(&updated_lines, line);
            parse_checklist_line(&rel_path, line, updated_lines[idx], section)
                .ok_or_else(|| "Failed to parse updated task".to_string())
        }
        TaskSource::Table => parse_tasks(&rel_path, &new_content)
            .into_iter()
            .find(|t| t.line == line)
            .ok_or_else(|| "Failed to parse updated task".to_string()),
    }
}

// ── WO06 task DAG commands (Lane G1) ────────────────────────────────────

/// Re-parses the just-rewritten line at `idx` and returns it, dispatching
/// on `source` exactly like every other single-line mutation command in
/// this file ([`task_toggle`]/[`task_update`]).
fn reparse_single_line(rel_path: &str, new_content: &str, idx: usize, line: usize, source: &TaskSource) -> Result<TaskItem, String> {
    match source {
        TaskSource::Checklist => {
            let updated_lines: Vec<&str> = new_content.split('\n').collect();
            let section = nearest_section(&updated_lines, line);
            parse_checklist_line(rel_path, line, updated_lines[idx], section)
                .ok_or_else(|| "Failed to parse updated task".to_string())
        }
        TaskSource::Table => parse_tasks(rel_path, new_content)
            .into_iter()
            .find(|t| t.line == line)
            .ok_or_else(|| "Failed to parse updated task".to_string()),
    }
}

/// A table row's header must map a Tags column before any reserved token
/// can be written into it (§3.1 minting rule #2) — there is no column to
/// invent one into, and restructuring a user's table would violate
/// byte-exact cell preservation elsewhere in this file.
fn require_tags_column(lines: &[String], idx: usize, rel_path: &str, line: usize, source: &TaskSource) -> Result<(), String> {
    if *source != TaskSource::Table {
        return Ok(());
    }
    let str_lines: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let map = table_at(&str_lines, idx).ok_or_else(|| "Task moved on disk — rescan".to_string())?;
    if map.tags.is_none() {
        return Err(format!(
            "{rel_path}#{line}: this table has no Tags column — add one, or move the task to a canonical grid"
        ));
    }
    Ok(())
}

/// Mints a stable task id for the task at `relPath#line` (§3.1). Idempotent
/// — a task that already has an `id:` token is returned unchanged, no
/// write. Table rows whose header maps no Tags column are rejected rather
/// than silently doing nothing. The write touches only the Tags cell / tag
/// run (`write_reserved_tags`) — every other byte of the line, and every
/// other cell of a table row, is untouched.
#[tauri::command]
pub fn task_id_ensure(root: String, rel_path: String, line: usize) -> Result<TaskItem, String> {
    ensure_convention_path(&rel_path)?;
    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &rel_path)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("{rel_path}: {e}"))?;

    let current = parse_tasks(&rel_path, &content)
        .into_iter()
        .find(|t| t.line == line)
        .ok_or_else(|| "Task moved on disk — rescan".to_string())?;

    if current.task_id.is_some() {
        return Ok(current);
    }

    let mut lines: Vec<String> = content.split('\n').map(|s| s.to_string()).collect();
    let idx = line - 1;
    require_tags_column(&lines, idx, &rel_path, line, &current.source)?;

    let existing_ids = all_existing_task_ids(&root_path);
    let mut minted: Option<String> = None;
    for attempt in 0..16u64 {
        let candidate = mint_task_id(&rel_path, line, attempt);
        if !existing_ids.contains(&candidate) {
            minted = Some(candidate);
            break;
        }
    }
    let minted = minted.ok_or_else(|| "could not mint a unique task id".to_string())?;

    let new_line =
        write_reserved_tags(&lines, idx, &current.source, Some(&minted), &current.depends_on, &current.tags)?;
    lines[idx] = new_line;
    let new_content = lines.join("\n");
    write_atomic(&path, &new_content)?;

    reparse_single_line(&rel_path, &new_content, idx, line, &current.source)
}

/// Adds a `needs:<dependsOn>` edge to the task at `relPath#line` (§3.3 D3).
/// Rejects, with four distinct messages: a self-dependency, an id that
/// matches no task on the board, an id that is assigned to more than one
/// task (ambiguous target), or an edge that would close a dependency cycle
/// (error message carries the concrete would-be cycle path, same
/// first-repeated-last convention as `dag.cycles`). Adding an edge that is
/// already present is an idempotent no-op success. The write touches only
/// the Tags cell / tag run, same as [`task_id_ensure`].
#[tauri::command]
pub fn task_depends_add(root: String, rel_path: String, line: usize, depends_on: String) -> Result<TaskItem, String> {
    ensure_convention_path(&rel_path)?;
    let depends_on = depends_on.trim().to_string();
    if !is_valid_task_id_str(&depends_on) {
        return Err(format!("{depends_on}: not a valid task id"));
    }

    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &rel_path)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("{rel_path}: {e}"))?;

    let current = parse_tasks(&rel_path, &content)
        .into_iter()
        .find(|t| t.line == line)
        .ok_or_else(|| "Task moved on disk — rescan".to_string())?;

    if current.task_id.as_deref() == Some(depends_on.as_str()) {
        return Err(format!("a task cannot depend on itself: {depends_on}"));
    }
    if current.depends_on.iter().any(|d| d == &depends_on) {
        return Ok(current);
    }

    let board = scan_all_task_items(&root_path);
    let mut occurrences: HashMap<&str, usize> = HashMap::new();
    for t in &board {
        if let Some(id) = t.task_id.as_deref() {
            *occurrences.entry(id).or_insert(0) += 1;
        }
    }
    match occurrences.get(depends_on.as_str()).copied() {
        None | Some(0) => return Err(format!("{depends_on}: no task has this id")),
        Some(1) => {}
        Some(_) => {
            return Err(format!(
                "{depends_on}: this id is assigned to more than one task — resolve the duplicate first"
            ))
        }
    }

    if let Some(own_id) = current.task_id.as_deref() {
        if let Some(cycle_path) = would_create_cycle(&board, own_id, &depends_on) {
            return Err(format!("adding needs:{depends_on} would create a cycle: {}", cycle_path.join(" -> ")));
        }
    }

    let mut lines: Vec<String> = content.split('\n').map(|s| s.to_string()).collect();
    let idx = line - 1;
    require_tags_column(&lines, idx, &rel_path, line, &current.source)?;

    let mut new_depends_on = current.depends_on.clone();
    new_depends_on.push(depends_on);
    let new_line =
        write_reserved_tags(&lines, idx, &current.source, current.task_id.as_deref(), &new_depends_on, &current.tags)?;
    lines[idx] = new_line;
    let new_content = lines.join("\n");
    write_atomic(&path, &new_content)?;

    reparse_single_line(&rel_path, &new_content, idx, line, &current.source)
}

/// Removes a `needs:<dependsOn>` edge from the task at `relPath#line`.
/// Removing an edge that isn't present is a no-op success (contract §7).
/// Never rejects on cycle/self/unknown/duplicate grounds — removing an edge
/// cannot create a cycle, and a dangling/duplicated target is exactly the
/// kind of stale reference this command should still be able to clean up.
#[tauri::command]
pub fn task_depends_remove(root: String, rel_path: String, line: usize, depends_on: String) -> Result<TaskItem, String> {
    ensure_convention_path(&rel_path)?;
    let depends_on = depends_on.trim().to_string();

    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &rel_path)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("{rel_path}: {e}"))?;

    let current = parse_tasks(&rel_path, &content)
        .into_iter()
        .find(|t| t.line == line)
        .ok_or_else(|| "Task moved on disk — rescan".to_string())?;

    if !current.depends_on.iter().any(|d| d == &depends_on) {
        return Ok(current);
    }

    let new_depends_on: Vec<String> = current.depends_on.iter().filter(|d| **d != depends_on).cloned().collect();

    let mut lines: Vec<String> = content.split('\n').map(|s| s.to_string()).collect();
    let idx = line - 1;
    let new_line =
        write_reserved_tags(&lines, idx, &current.source, current.task_id.as_deref(), &new_depends_on, &current.tags)?;
    lines[idx] = new_line;
    let new_content = lines.join("\n");
    write_atomic(&path, &new_content)?;

    reparse_single_line(&rel_path, &new_content, idx, line, &current.source)
}
