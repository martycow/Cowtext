//! Task-file convention (TASKBOARD_BATCH_CONTRACT.md §1-4): a tolerant,
//! read-mostly markdown task parser over four well-known files —
//! `TASKS.md`, `SPRINT.md`, `BACKLOG.md`, `ROADMAP.md` — searched in this
//! directory order: project root, `docs/`, `docs/tasks/` (first hit per
//! name wins).
//!
//! A "task" is either a markdown pipe-table row (header-driven column
//! mapping) or a checklist line (`- [ ] text` / `- [x] text`). The parser
//! never errors on weird markdown — lines that don't match either shape
//! are simply not tasks. All writes are line-based surgery through
//! [`project::write_atomic`], confined to the four convention files.

#[cfg(test)]
mod tests;

use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// The four convention file names, in board-column order — also the order
/// `tasks_scan` reports them in.
const CONVENTION_NAMES: [&str; 4] = ["TASKS.md", "SPRINT.md", "BACKLOG.md", "ROADMAP.md"];

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
    pub agent: Option<String>,
    pub done: bool,
    pub status: Option<String>,
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
/// the 12 recognized convention locations.
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

#[derive(Default)]
struct ColumnMap {
    name: Option<usize>,
    tags: Option<usize>,
    priority: Option<usize>,
    description: Option<usize>,
    phase: Option<usize>,
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

fn build_table_task(rel_path: &str, line_no: usize, cells: &[String], map: &ColumnMap) -> Option<TaskItem> {
    let name = cell_at(cells, map.name)?;
    let tags = cell_at(cells, map.tags).map(|s| split_tags(&s)).unwrap_or_default();
    Some(TaskItem {
        id: format!("{rel_path}#{line_no}"),
        rel_path: rel_path.to_string(),
        line: line_no,
        source: TaskSource::Table,
        name,
        description: cell_at(cells, map.description),
        tags,
        priority: cell_at(cells, map.priority),
        phase: cell_at(cells, map.phase),
        agent: cell_at(cells, map.agent),
        done: false,
        status: cell_at(cells, map.status),
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
/// (first wins), and a `P0`..`P3` priority token, optionally parenthesized
/// (first wins). Punctuation immediately around a token is stripped.
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
            if cleaned.len() == 2 {
                let bytes = cleaned.as_bytes();
                let (p, d) = (bytes[0], bytes[1]);
                if (p == b'P' || p == b'p') && (b'0'..=b'3').contains(&d) {
                    priority = Some(format!("P{}", d as char));
                }
            }
        }
    }
    (tags, agent, priority)
}

fn parse_checklist_line(rel_path: &str, line_no: usize, line: &str) -> Option<TaskItem> {
    let trimmed = line.trim_start();
    let rest = trimmed.strip_prefix("- [")?;
    let mut chars = rest.chars();
    let check_char = chars.next()?;
    let after = chars.as_str().strip_prefix(']')?;
    let done = match check_char {
        'x' | 'X' => true,
        ' ' => false,
        _ => return None,
    };
    let text = after.trim();
    if text.is_empty() {
        return None;
    }
    let (name, description) = split_name_desc(text);
    let (tags, agent, priority) = extract_tokens(text);
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
        agent,
        done,
        status: None,
    })
}

// ---------------------------------------------------------------------
// Combined scan
// ---------------------------------------------------------------------

/// Single left-to-right pass over `content`'s lines: a header row
/// immediately followed by a separator row (with a name-like column)
/// starts a table that consumes subsequent pipe rows as data rows; every
/// other line is tried as a checklist line. Never errors — non-matching
/// lines simply contribute nothing.
pub(crate) fn parse_tasks(rel_path: &str, content: &str) -> Vec<TaskItem> {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
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
                        if let Some(item) = build_table_task(rel_path, j + 1, &cells, &map) {
                            out.push(item);
                        }
                        j += 1;
                    }
                    i = j;
                    continue;
                }
            }
        }
        if let Some(item) = parse_checklist_line(rel_path, i + 1, lines[i]) {
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

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

/// Scans the four convention files (contract §3). Always reports exactly
/// 4 entries in convention order; a missing file reports its default
/// (root-level) location with `exists: false` and no tasks. Unreadable
/// files are treated as empty — tolerant, never errors past a bad `root`.
#[tauri::command]
pub fn tasks_scan(root: String) -> Result<TasksScan, String> {
    let root_path = checked_root(&root)?;
    let mut files = Vec::with_capacity(CONVENTION_NAMES.len());
    let mut tasks = Vec::new();

    for name in CONVENTION_NAMES {
        let found = convention_candidates(name)
            .into_iter()
            .find(|cand| root_path.join(cand).is_file());

        match found {
            Some(rel) => {
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
                rel_path: name.to_string(),
                exists: false,
                task_count: 0,
            }),
        }
    }

    Ok(TasksScan { files, tasks })
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

    parse_checklist_line(&rel_path, line, &lines[idx])
        .ok_or_else(|| "Task moved on disk — rescan".to_string())
}

/// Appends `- [ ] <text>` as the file's last line (contract §3), creating
/// the file with a `# <Name>` header if it doesn't exist yet. Only the four
/// convention paths are writable.
#[tauri::command]
pub fn task_append(root: String, rel_path: String, text: String) -> Result<TaskItem, String> {
    ensure_convention_path(&rel_path)?;
    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &rel_path)?;

    let existing = fs::read_to_string(&path).unwrap_or_default();
    let raw_line = format!("- [ ] {text}");
    let (content, line_no) = append_raw_line(&existing, &rel_path, &raw_line);
    write_atomic(&path, &content)?;

    parse_checklist_line(&rel_path, line_no, &raw_line)
        .ok_or_else(|| "Failed to parse appended task".to_string())
}

/// Moves the WHOLE line at `fromRelPath#line` to the end of `toRelPath`
/// (contract §3). Checklist lines move verbatim; table rows are converted
/// to a checklist line. Target is written first, then source; on a source
/// write failure the target is rolled back to its pre-move content (or
/// removed, if it didn't exist before) so nothing is half-moved.
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

    let from_lines: Vec<&str> = from_content.split('\n').collect();
    let moved_line_text = match item.source {
        TaskSource::Checklist => from_lines.get(line - 1).copied().unwrap_or("").to_string(),
        TaskSource::Table => format!(
            "- [ ] {}{}",
            item.name,
            item.description
                .as_deref()
                .map(|d| format!(" — {d}"))
                .unwrap_or_default()
        ),
    };

    let to_existed = to_path.is_file();
    let to_existing = if to_existed {
        fs::read_to_string(&to_path).map_err(|e| format!("{to_rel_path}: {e}"))?
    } else {
        String::new()
    };
    let (to_content, new_line_no) = append_raw_line(&to_existing, &to_rel_path, &moved_line_text);

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

    parse_checklist_line(&to_rel_path, new_line_no, &moved_line_text)
        .ok_or_else(|| "Failed to parse moved task".to_string())
}
