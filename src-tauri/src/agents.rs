//! Agents & Skills suite — full CRUD over the *open user project*'s
//! `.claude/agents/*.md` and `.claude/skills/<name>/SKILL.md`, plus the
//! `.cowtext/agents.json` sidecar (AGENTS_SUITE_CONTRACT.md §2).
//!
//! Paths are always built server-side from `(root, component)`: every
//! component passes [`validate_component`] before use, and the built path
//! still goes through [`project::resolve_within_root`] — belt and braces.
//! `.claude/` stays protected in `project::is_rename_protected`; these
//! commands are the only sanctioned way in. All writes go through
//! [`project::write_atomic`]; all creates use `fs::File::create_new`
//! (never clobber); all renames refuse when the destination exists.

#[cfg(test)]
mod tests;

use crate::frontmatter::{self, FmFields};
use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDoc {
    pub file_name: String,
    pub fields: FmFields,
    pub body: String,
    pub raw: bool,
    pub parse_error: Option<String>,
    pub content: String,
}

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDoc {
    pub dir_name: String,
    pub fields: FmFields,
    pub body: String,
    pub raw: bool,
    pub parse_error: Option<String>,
    pub content: String,
    /// Recursive, relative, forward slashes, sorted, capped at 100 entries.
    pub extra_files: Vec<String>,
    /// Uncapped total.
    pub extra_file_count: usize,
}

/// Per-agent memory folder (WO02 §2.1): `.claude/agent-memory/<stem>/`, with
/// a never-clobbered `MEMORY.md` index seeded on first creation.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemory {
    /// ".claude/agent-memory/<stem>"  — forward slashes, relative to root.
    pub dir_rel_path: String,
    /// ".claude/agent-memory/<stem>/MEMORY.md"
    pub index_rel_path: String,
    /// true iff THIS call created the directory or the index file.
    pub created: bool,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentsScan {
    pub agents: Vec<AgentDoc>,
    pub skills: Vec<SkillDoc>,
    pub meta_json: Option<String>,
    pub skipped: Vec<String>,
}

/// Result of `agent_avatar_set` (WO11 §4.2): the freshly written avatar,
/// re-read back off disk so `rel_path`/`data_url`/`bytes` are always the
/// bytes actually on disk, never the caller's claim about them.
///
/// WO11 lanes R2 (this file) and R1 (`lib.rs`) land in sequence, R2 first
/// (WO11_CONTRACT.md §6): `agent_avatar_set`/`_read`/`_clear` and
/// `agent_memory_status` below are not yet in `generate_handler!`, so the
/// plain (non-test) reachability graph from `pub fn run()` cannot see them
/// yet — hence the narrow, temporary `#[allow(dead_code)]` on each new item
/// down to `agent_avatar_clear`. Exercised for real by `agents/tests.rs` in
/// the meantime. Remove once R1 registers all four.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentAvatarRef {
    /// ".cowtext/avatars/tech-ui.png" — forward slashes, relative to root.
    pub rel_path: String,
    /// "data:image/png;base64,…"
    pub data_url: String,
    pub bytes: u64,
}

/// Read-only probe of an agent's memory index (WO11 §4.3). Answers the
/// question `project.rs`'s `.md`-only scan structurally cannot: whether
/// `.claude/agent-memory/<stem>/MEMORY.md` exists and is sound, without
/// putting that directory into the project scan (WO11 §8 — out of scope).
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryStatus {
    /// ".claude/agent-memory/tech-ui/"
    pub dir_rel_path: String,
    /// ".claude/agent-memory/tech-ui/MEMORY.md"
    pub index_rel_path: String,
    pub dir_exists: bool,
    pub index_exists: bool,
    pub index_bytes: u64,
    /// `dir_exists && index_exists && index_bytes > 0 && index is valid
    /// UTF-8`. A zero-byte or non-UTF-8 index is unhealthy — the shape
    /// `agent_memory_ensure` exists to fix.
    pub healthy: bool,
}

/// Serializes every command in this module that touches `.claude/agents/`,
/// `.claude/skills/`, or their `.cowtext/`-side avatar/memory-status
/// siblings (WO11_CONTRACT.md §11.2 — Amendment 2, a HIGH TOCTOU fix).
/// `save_doc`'s `path.is_file()` check (below) is a probe, not a lock:
/// `write_atomic` (`project.rs`) is create-or-replace, so an `agent_rename`
/// landing between that probe and the write resurrects the old path as an
/// orphan holding the save's edit, while the real renamed file never
/// receives it (§11.1). This lock removes the window: every mutating
/// command, plus the three read-only ones that could otherwise observe a
/// half-moved directory (`agents_scan`, `agent_avatar_read`,
/// `agent_memory_status`), take it once at the top of the body — after
/// argument validation and `checked_root` — and hold it to return.
///
/// Deliberately **one** lock, never a per-path map: `agent_rename` touches
/// two paths at once (`src`/`dest`), and two locks would need an ordering
/// rule, which is how deadlocks get written. With exactly one lock in
/// existence and nothing else ever acquired while it's held, deadlock is
/// structurally impossible. `save_doc`, `rename_patch_name`,
/// `move_avatar_best_effort` and the avatar helpers stay lock-free and are
/// only ever called *under* a caller's guard — a helper that locks is how a
/// `Mutex<()>` self-deadlocks.
///
/// Scope limit: this is a process-local lock. It serializes every command
/// in this app, including a second Tauri window (windows share one
/// process), but it does **not** protect against an external writer. The
/// only other Cowtext process is `cowtext-cli`, whose `compile --check` and
/// `lint` never write agent files, so that exposure is nil today. Closing
/// the out-of-process case would need OS file locking — a new dependency
/// and a stack change, not this work order.
static AGENT_FS: Mutex<()> = Mutex::new(());

/// Never `.expect()` this lock — recover from poisoning instead. A panic
/// while held would otherwise poison it and turn every later agents/skills
/// command into a panic too: exactly the anti-pattern `assemble.rs`'s
/// twelve `.expect("assemble queue mutex")` sites are the leading suspect
/// for in the still-unresolved F1 whole-app crash (WO11_CONTRACT.md §2.2).
/// Do not add a thirteenth site of it here.
fn agent_fs_guard() -> MutexGuard<'static, ()> {
    AGENT_FS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Every component the webview sends (`fileName` / `dirName` / `name`) must
/// pass this before it touches a path: non-empty after trim, no `/`, `\`,
/// `:`, not `.`/`..`, no ASCII control chars, ≤ 100 chars.
pub(crate) fn validate_component(s: &str) -> Result<(), String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err(format!("Invalid name: {trimmed:?}"));
    }
    if trimmed.chars().count() > 100 {
        return Err(format!("Name is too long (max 100 characters): {trimmed:?}"));
    }
    if trimmed
        .chars()
        .any(|c| c == '/' || c == '\\' || c == ':' || c.is_control())
    {
        return Err(format!("Name contains an invalid character: {trimmed:?}"));
    }
    Ok(())
}

/// Agent file names additionally must end in `.md` (case-insensitive) and
/// have a non-empty stem.
fn validate_md_component(s: &str) -> Result<(), String> {
    validate_component(s)?;
    let trimmed = s.trim();
    if !trimmed.to_ascii_lowercase().ends_with(".md") {
        return Err(format!("Name must end in .md: {trimmed:?}"));
    }
    let stem = &trimmed[..trimmed.len() - 3];
    if stem.trim().is_empty() {
        return Err(format!("Name must have a non-empty stem: {trimmed:?}"));
    }
    Ok(())
}

fn agents_dir(root: &Path) -> PathBuf {
    root.join(".claude").join("agents")
}

fn skills_dir(root: &Path) -> PathBuf {
    root.join(".claude").join("skills")
}

/// True when `a` and `b` name the same on-disk entry. On a case-insensitive
/// filesystem (NTFS), `dest.exists()` alone can't tell "this is the file
/// being renamed, only its casing changed" from "a different file already
/// sits there" — `slugify` always lowercases, so fixing an externally
/// created mixed-case name always produces a `dest` that collides with
/// `src` by this measure. Canonicalizing resolves both to their true on-disk
/// path/casing, so a genuine collision (a distinct existing entry) still
/// compares unequal.
fn same_entry(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

/// Derive `<file_name>`'s stem ("tech-ui.md" -> "tech-ui"), validating both
/// the full component and the stem. Shared by the memory probe and the
/// avatar commands, which key off the same agent-file stem
/// `agent_memory_ensure` already uses for `.claude/agent-memory/<stem>/`.
fn md_stem(file_name: &str) -> Result<String, String> {
    validate_md_component(file_name)?;
    let trimmed = file_name.trim();
    let stem = &trimmed[..trimmed.len() - 3];
    validate_component(stem)?;
    Ok(stem.to_string())
}

// ── Agent avatars (WO11 §4.2) ───────────────────────────────────────────
// Storage is path-derived, not sidecar-keyed: `.cowtext/avatars/<stem>.<ext>`
// where `<stem>` is the agent file name minus `.md`. No schema bump, no
// second writer for `agents.json` — "has an avatar" is answered purely by
// whether that file exists.

const AVATAR_MAX_BYTES: usize = 512 * 1024;
/// Recognized extensions, lowercase, in the order `detect_image_ext` tries
/// their magic bytes.
const AVATAR_EXTS: [&str; 4] = ["png", "jpg", "webp", "gif"];

fn avatars_dir(root: &Path) -> PathBuf {
    root.join(".cowtext").join("avatars")
}

/// Identify an image by its magic bytes, never by extension — the whole
/// point of this check is that a `.txt` renamed to `.png` must still fail.
/// Returns the extension `agent_avatar_set` writes the file under.
fn detect_image_ext(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.len() >= 4 && bytes[0..4] == [0x89, 0x50, 0x4E, 0x47] {
        return Ok("png");
    }
    if bytes.len() >= 3 && bytes[0..3] == [0xFF, 0xD8, 0xFF] {
        return Ok("jpg");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Ok("webp");
    }
    if bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a") {
        return Ok("gif");
    }
    Err("unsupported image format — PNG, JPEG, WebP or GIF".to_string())
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

const BASE64_TABLE: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Hand-rolled standard base64 (with padding) — no crate. Avatars are the
/// only binary payload this crate ever puts on the wire, so a data URL is
/// the whole surface this needs to cover.
fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(BASE64_TABLE[((n >> 18) & 0x3F) as usize] as char);
        out.push(BASE64_TABLE[((n >> 12) & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 {
            BASE64_TABLE[((n >> 6) & 0x3F) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_TABLE[(n & 0x3F) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Byte-safe counterpart of [`write_atomic`] for avatar images: the same
/// temp-file-then-rename discipline, for raw bytes rather than UTF-8 text.
/// Not registered with [`crate::watcher::note_self_write`] — avatar files
/// live under `.cowtext/avatars/`, which `is_scannable_md` never matches, so
/// the watcher can never emit an `fs://change` for one regardless.
fn write_atomic_bytes(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("No parent directory: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    let tmp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id()
    ));
    fs::write(&tmp, content).map_err(|e| format!("{}: {e}", tmp.display()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", tmp.display()))?;
    Ok(())
}

/// Find `stem`'s avatar file, if any, under any recognized extension.
/// Case-insensitive on the stem (Windows) and restricted to
/// [`AVATAR_EXTS`], so a stray non-image file dropped into the avatars
/// directory is never picked up.
fn find_avatar_path(root: &Path, stem: &str) -> Option<PathBuf> {
    let dir = avatars_dir(root);
    let entries = fs::read_dir(&dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !file_stem.eq_ignore_ascii_case(stem) {
            continue;
        }
        let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
            continue;
        };
        if AVATAR_EXTS.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
            return Some(path);
        }
    }
    None
}

/// Remove every avatar file matching `stem` (any recognized extension),
/// best-effort. Used both by `agent_avatar_clear` and by `agent_delete`'s
/// avatar follow-through — an agent must never leave an orphaned avatar.
fn clear_avatar_files(root: &Path, stem: &str) {
    let dir = avatars_dir(root);
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case(stem))
        {
            let _ = fs::remove_file(&path);
        }
    }
}

/// Move `old_stem`'s avatar (if any) to `new_stem`, best-effort — an avatar
/// failure never fails the rename it rides along with. A no-op when there
/// is no avatar, and safe on a same-stem (case-only) rename: the
/// destination-vs-source identity check means the file already sitting
/// under `new_stem` (which, case-insensitively, IS `src` in that case) is
/// never deleted out from under the pending move.
fn move_avatar_best_effort(root: &Path, old_stem: &str, new_stem: &str) {
    let Some(src) = find_avatar_path(root, old_stem) else {
        return;
    };
    let Some(ext) = src.extension().and_then(|s| s.to_str()).map(str::to_string) else {
        return;
    };
    let dest = avatars_dir(root).join(format!("{new_stem}.{ext}"));
    if dest == src {
        return;
    }
    if let Some(existing) = find_avatar_path(root, new_stem) {
        if existing != src {
            let _ = fs::remove_file(&existing);
        }
    }
    let _ = fs::rename(&src, &dest);
}

/// WO13_CONTRACT.md §3.0 (D9 docs verdict): a sub-agent file whose YAML
/// parses but carries no `description` is skipped and never loaded at all —
/// stronger than merely "never delegated". A blank `description: ` here
/// would ship a freshly created agent that Claude Code silently ignores
/// until the user fills it in. The placeholder is deliberately generic
/// (this command has no `description` input to draw on) and is exactly the
/// kind of weak, non-trigger-shaped text the agent modal's own B3 weak-
/// description flag (U3, WO13_CONTRACT.md §14.3) is designed to catch on
/// the rail once the real one is written.
fn agent_template(slug: &str) -> String {
    format!(
        "---\nname: {slug}\ndescription: TODO - describe when this agent should be used, and when not to.\nmodel: sonnet\ntools: Read, Grep, Glob\nskills: []\n---\n\n# {slug}\n\n## Duties\n\n## Boundaries\n"
    )
}

fn skill_template(slug: &str) -> String {
    format!("---\nname: {slug}\ndescription: \n---\n\n# {slug}\n")
}

fn doc_from_content(file_name: String, content: String) -> AgentDoc {
    let doc = frontmatter::parse(&content);
    AgentDoc {
        file_name,
        fields: doc.fields(),
        body: doc.body.clone(),
        raw: doc.raw,
        parse_error: doc.parse_error.clone(),
        content,
    }
}

fn skill_doc_from_content(dir_name: String, content: String, skill_dir: &Path) -> SkillDoc {
    let doc = frontmatter::parse(&content);
    let (extra_files, extra_file_count) = scan_extra_files(skill_dir);
    SkillDoc {
        dir_name,
        fields: doc.fields(),
        body: doc.body.clone(),
        raw: doc.raw,
        parse_error: doc.parse_error.clone(),
        content,
        extra_files,
        extra_file_count,
    }
}

/// Everything in `skill_dir` except `SKILL.md`: recursive, relative,
/// forward-slashed, sorted, capped at 100 entries (count is uncapped).
fn scan_extra_files(skill_dir: &Path) -> (Vec<String>, usize) {
    let mut all = Vec::new();
    walk_extra(skill_dir, skill_dir, &mut all);
    all.sort();
    let count = all.len();
    all.truncate(100);
    (all, count)
}

fn walk_extra(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_extra(root, &path, out);
        } else {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if rel.eq_ignore_ascii_case("SKILL.md") {
                continue;
            }
            out.push(rel);
        }
    }
}

/// Walk `.claude/agents/*.md` and `.claude/skills/*/SKILL.md`. Never fails
/// on a bad individual file: parse errors surface as `raw` docs, unreadable
/// or non-UTF-8 files land in `skipped`. Errors only when `root` itself
/// isn't a directory.
#[tauri::command]
pub fn agents_scan(root: String) -> Result<AgentsScan, String> {
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let mut agents = Vec::new();
    let mut skills = Vec::new();
    let mut skipped = Vec::new();

    let a_dir = agents_dir(&root_path);
    if a_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&a_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if !name.to_ascii_lowercase().ends_with(".md") {
                    continue;
                }
                match fs::read_to_string(&path) {
                    Ok(content) => agents.push(doc_from_content(name, content)),
                    Err(_) => skipped.push(format!("agents/{name}")),
                }
            }
        }
    }
    agents.sort_by(|a, b| a.file_name.cmp(&b.file_name));

    let s_dir = skills_dir(&root_path);
    if s_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&s_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = entry.file_name().to_string_lossy().into_owned();
                let skill_md = path.join("SKILL.md");
                if !skill_md.is_file() {
                    continue; // a dir without SKILL.md is skipped
                }
                match fs::read_to_string(&skill_md) {
                    Ok(content) => skills.push(skill_doc_from_content(dir_name, content, &path)),
                    Err(_) => skipped.push(format!("skills/{dir_name}/SKILL.md")),
                }
            }
        }
    }
    skills.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));

    let meta_path = root_path.join(".cowtext").join("agents.json");
    let meta_json = fs::read_to_string(&meta_path).ok();

    Ok(AgentsScan {
        agents,
        skills,
        meta_json,
        skipped,
    })
}

#[tauri::command]
pub fn agent_create(
    root: String,
    name: String,
    file_name: Option<String>,
) -> Result<AgentDoc, String> {
    validate_component(&name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let slug = crate::preset::slugify(&name)?;
    let file_name = match file_name {
        Some(f) => {
            validate_md_component(&f)?;
            // Trimmed, matching agent_memory_ensure's stem derivation — an
            // untrimmed name would create a file whose stem (and therefore
            // its memory folder) disagrees with what agent_memory_ensure(
            // root, file_name) would later derive from the same string.
            f.trim().to_string()
        }
        None => format!("{slug}.md"),
    };
    let dir = agents_dir(&root_path);
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = resolve_within_root(&root_path, &format!(".claude/agents/{file_name}"))?;

    match fs::File::create_new(&path) {
        Ok(mut f) => {
            use std::io::Write;
            f.write_all(agent_template(&slug).as_bytes())
                .map_err(|e| format!("{}: {e}", path.display()))?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(format!("An agent named \"{file_name}\" already exists"));
        }
        Err(e) => return Err(format!("{}: {e}", path.display())),
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(doc_from_content(file_name, content))
}

/// Ensure `.claude/agent-memory/<stem>/` and its `MEMORY.md` index exist
/// (WO02 §2.1). Idempotent: a pre-existing `MEMORY.md` is never rewritten.
#[tauri::command]
pub fn agent_memory_ensure(root: String, file_name: String) -> Result<AgentMemory, String> {
    validate_md_component(&file_name)?;
    let trimmed = file_name.trim();
    let stem = &trimmed[..trimmed.len() - 3];
    validate_component(stem)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();

    let dir_rel = format!(".claude/agent-memory/{stem}");
    let dir = resolve_within_root(&root_path, &dir_rel)?;
    let dir_existed = dir.is_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;

    let index = dir.join("MEMORY.md");
    let index_rel_path = format!("{dir_rel}/MEMORY.md");
    let mut created = !dir_existed;

    match fs::File::create_new(&index) {
        Ok(mut f) => {
            use std::io::Write;
            let seed = format!(
                "# {stem} memory index\n\n<!-- One line per memory file: - [Title](file.md) — one-line hook -->\n"
            );
            f.write_all(seed.as_bytes())
                .map_err(|e| format!("{}: {e}", index.display()))?;
            created = true;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(format!("{}: {e}", index.display())),
    }

    Ok(AgentMemory {
        dir_rel_path: dir_rel,
        index_rel_path,
        created,
    })
}

/// Read-only probe (WO11 §4.3, D2's fix) — never touches disk beyond a
/// stat/read of the index. `agents_scan`/`useProjectStore.files` can never
/// answer this question (they don't walk `.claude/agent-memory/`, and WO11
/// §8 keeps it that way), so the frontend re-probes here on every selection.
#[tauri::command]
pub fn agent_memory_status(root: String, file_name: String) -> Result<AgentMemoryStatus, String> {
    let stem = md_stem(&file_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();

    let dir_rel_path = format!(".claude/agent-memory/{stem}");
    let dir = resolve_within_root(&root_path, &dir_rel_path)?;
    let index_rel_path = format!("{dir_rel_path}/MEMORY.md");
    let index = dir.join("MEMORY.md");

    let dir_exists = dir.is_dir();
    let index_exists = index.is_file();
    let index_bytes = if index_exists {
        fs::metadata(&index).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    let healthy = dir_exists
        && index_exists
        && index_bytes > 0
        && fs::read(&index)
            .map(|bytes| std::str::from_utf8(&bytes).is_ok())
            .unwrap_or(false);

    Ok(AgentMemoryStatus {
        dir_rel_path,
        index_rel_path,
        dir_exists,
        index_exists,
        index_bytes,
        healthy,
    })
}

/// `source_path` is the one absolute, webview-supplied path any WO11
/// command accepts — it comes from `@tauri-apps/plugin-dialog`'s `open()`,
/// is read once and never stored; only the copy under `.cowtext/avatars/`
/// persists. Format is validated by magic bytes (never by extension) and
/// capped at [`AVATAR_MAX_BYTES`] — no resizing, no re-encoding, no
/// dimension check (WO11 §4.2, ratified: no new image-processing crate).
#[tauri::command]
pub fn agent_avatar_set(
    root: String,
    file_name: String,
    source_path: String,
) -> Result<AgentAvatarRef, String> {
    let stem = md_stem(&file_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();

    // Stat first, reject on length before ever reading the bytes — a
    // multi-GB `source_path` must not be fully allocated into memory just
    // to find out it's over the cap (tester audit #4, WO11 fix round).
    let metadata = fs::metadata(&source_path).map_err(|e| format!("{source_path}: {e}"))?;
    if metadata.len() > AVATAR_MAX_BYTES as u64 {
        return Err("image too large (max 512 KB)".to_string());
    }
    let bytes = fs::read(&source_path).map_err(|e| format!("{source_path}: {e}"))?;
    let ext = detect_image_ext(&bytes)?;

    let dir = resolve_within_root(&root_path, ".cowtext/avatars")?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;

    // Replace any existing avatar for this agent, whatever its extension —
    // an agent can never end up with two.
    clear_avatar_files(&root_path, &stem);

    let rel_path = format!(".cowtext/avatars/{stem}.{ext}");
    let dest = resolve_within_root(&root_path, &rel_path)?;
    write_atomic_bytes(&dest, &bytes)?;

    let data_url = format!("data:{};base64,{}", mime_for_ext(ext), base64_encode(&bytes));
    Ok(AgentAvatarRef {
        rel_path,
        data_url,
        bytes: bytes.len() as u64,
    })
}

/// `Ok(None)` both when there is no avatar and when the file on disk can't
/// be read back — a broken avatar must never stop the rail from rendering
/// (WO11 §4.2). The frontend falls back to the frozen identicon either way.
#[tauri::command]
pub fn agent_avatar_read(root: String, file_name: String) -> Result<Option<String>, String> {
    let stem = md_stem(&file_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let Some(path) = find_avatar_path(&root_path, &stem) else {
        return Ok(None);
    };
    let Ok(bytes) = fs::read(&path) else {
        return Ok(None);
    };
    let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
        return Ok(None);
    };
    Ok(Some(format!(
        "data:{};base64,{}",
        mime_for_ext(ext),
        base64_encode(&bytes)
    )))
}

#[tauri::command]
pub fn agent_avatar_clear(root: String, file_name: String) -> Result<(), String> {
    let stem = md_stem(&file_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    clear_avatar_files(&root_path, &stem);
    Ok(())
}

/// Returns the freshly saved `AgentDoc`, re-read off disk (WO11 §3, ASK #7)
/// — a deviation from the WO02 agents contract, ratified so the frontend's
/// per-keystroke autosave (§5.7) can update its store in place without a
/// full `agentsScan`.
#[tauri::command]
pub fn agent_save(
    root: String,
    file_name: String,
    fields: Option<FmFields>,
    body: Option<String>,
    raw_content: Option<String>,
) -> Result<AgentDoc, String> {
    validate_md_component(&file_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let path = resolve_within_root(&root_path, &format!(".claude/agents/{file_name}"))?;
    save_doc(&path, format!("No such agent: {file_name}"), fields, body, raw_content)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(doc_from_content(file_name, content))
}

#[tauri::command]
pub fn agent_rename(root: String, file_name: String, new_name: String) -> Result<String, String> {
    validate_md_component(&file_name)?;
    validate_component(&new_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let slug = crate::preset::slugify(&new_name)?;
    let new_file_name = format!("{slug}.md");
    let src = resolve_within_root(&root_path, &format!(".claude/agents/{file_name}"))?;
    let dest = resolve_within_root(&root_path, &format!(".claude/agents/{new_file_name}"))?;

    if dest.exists() && !same_entry(&src, &dest) {
        return Err(format!("An agent named \"{new_file_name}\" already exists"));
    }
    fs::rename(&src, &dest).map_err(|e| format!("{file_name}: {e}"))?;
    rename_patch_name(&dest, &slug);

    let trimmed = file_name.trim();
    let old_stem = &trimmed[..trimmed.len() - 3];
    move_avatar_best_effort(&root_path, old_stem, &slug);

    Ok(new_file_name)
}

#[tauri::command]
pub fn agent_delete(root: String, file_name: String) -> Result<(), String> {
    validate_md_component(&file_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let path = resolve_within_root(&root_path, &format!(".claude/agents/{file_name}"))?;
    if !path.is_file() {
        return Err(format!("No such agent: {file_name}"));
    }
    fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))?;

    let trimmed = file_name.trim();
    let stem = &trimmed[..trimmed.len() - 3];
    clear_avatar_files(&root_path, stem);

    Ok(())
}

#[tauri::command]
pub fn skill_create(root: String, name: String) -> Result<SkillDoc, String> {
    validate_component(&name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let slug = crate::preset::slugify(&name)?;
    let dir = resolve_within_root(&root_path, &format!(".claude/skills/{slug}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let path = dir.join("SKILL.md");

    match fs::File::create_new(&path) {
        Ok(mut f) => {
            use std::io::Write;
            f.write_all(skill_template(&slug).as_bytes())
                .map_err(|e| format!("{}: {e}", path.display()))?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(format!("A skill named \"{slug}\" already exists"));
        }
        Err(e) => return Err(format!("{}: {e}", path.display())),
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(skill_doc_from_content(slug, content, &dir))
}

#[tauri::command]
pub fn skill_save(
    root: String,
    dir_name: String,
    fields: Option<FmFields>,
    body: Option<String>,
    raw_content: Option<String>,
) -> Result<(), String> {
    validate_component(&dir_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let path = resolve_within_root(&root_path, &format!(".claude/skills/{dir_name}/SKILL.md"))?;
    save_doc(&path, format!("No such skill: {dir_name}"), fields, body, raw_content)
}

#[tauri::command]
pub fn skill_rename(root: String, dir_name: String, new_name: String) -> Result<String, String> {
    validate_component(&dir_name)?;
    validate_component(&new_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let slug = crate::preset::slugify(&new_name)?;
    let src = resolve_within_root(&root_path, &format!(".claude/skills/{dir_name}"))?;
    let dest = resolve_within_root(&root_path, &format!(".claude/skills/{slug}"))?;

    if dest.exists() && !same_entry(&src, &dest) {
        return Err(format!("A skill named \"{slug}\" already exists"));
    }
    fs::rename(&src, &dest).map_err(|e| format!("{dir_name}: {e}"))?;
    rename_patch_name(&dest.join("SKILL.md"), &slug);
    Ok(slug)
}

#[tauri::command]
pub fn skill_delete(root: String, dir_name: String) -> Result<(), String> {
    validate_component(&dir_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let dir = resolve_within_root(&root_path, &format!(".claude/skills/{dir_name}"))?;
    if !dir.is_dir() {
        return Err(format!("No such skill: {dir_name}"));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))
}

/// Convert a legacy context `.md` file (anywhere under `root`, outside
/// `.claude/`) into a real Claude Code agent file at
/// `.claude/agents/<slugify(new_name)>.md`. Never clobbers the destination.
///
/// Write-then-remove ordering: the destination is created FIRST (never-
/// clobber `create_new`); only once it exists on disk is the source removed.
/// If removing the source fails, the freshly written destination is rolled
/// back — a duplicated pair is never left behind silently, and the caller
/// sees a real error it can retry.
#[tauri::command]
pub fn agent_convert(root: String, rel_path: String, new_name: String) -> Result<AgentDoc, String> {
    validate_component(&new_name)?;
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();

    let src = resolve_within_root(&root_path, &rel_path)?;
    if !src.is_file() {
        return Err(format!("Not a file: {rel_path}"));
    }
    let normalized = rel_path.replace('\\', "/").to_ascii_lowercase();
    if !normalized.ends_with(".md") {
        return Err(format!("Not a markdown file: {rel_path}"));
    }
    if normalized.starts_with(".claude/") {
        return Err(format!("Already an agent/skill file under .claude/: {rel_path}"));
    }

    let slug = crate::preset::slugify(&new_name)?;
    let file_name = format!("{slug}.md");
    let dir = agents_dir(&root_path);
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let dest = dir.join(&file_name);
    if dest.exists() {
        return Err(format!("An agent named \"{file_name}\" already exists"));
    }

    let source_content =
        fs::read_to_string(&src).map_err(|e| format!("{}: {e}", src.display()))?;
    let new_name = new_name.trim();
    // "Has frontmatter" per frontmatter.rs's own grammar: the first line is
    // exactly `---` AND it closed successfully (not `raw`). Anything else —
    // no attempt, or an unterminated/block-style fence — falls back to the
    // fresh-block prepend, same as a plain document.
    let attempted_frontmatter = source_content
        .split('\n')
        .next()
        .unwrap_or("")
        .trim_end_matches(['\r', ' ', '\t'])
        == "---";
    let doc = frontmatter::parse(&source_content);
    let new_content = if attempted_frontmatter && !doc.raw {
        let mut fields = doc.fields();
        fields.name = Some(new_name.to_string());
        frontmatter::patch(&source_content, Some(&fields), None)?
    } else {
        format!("---\nname: {new_name}\ndescription: \n---\n\n{source_content}")
    };

    match fs::File::create_new(&dest) {
        Ok(mut f) => {
            use std::io::Write;
            f.write_all(new_content.as_bytes())
                .map_err(|e| format!("{}: {e}", dest.display()))?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(format!("An agent named \"{file_name}\" already exists"));
        }
        Err(e) => return Err(format!("{}: {e}", dest.display())),
    }

    if let Err(e) = fs::remove_file(&src) {
        let _ = fs::remove_file(&dest);
        return Err(format!(
            "Converted but could not remove the original {rel_path}: {e}"
        ));
    }

    let content = fs::read_to_string(&dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    Ok(doc_from_content(file_name, content))
}

#[tauri::command]
pub fn agents_meta_write(root: String, content: String) -> Result<(), String> {
    let ok = match serde_json::from_str::<serde_json::Value>(&content) {
        Ok(serde_json::Value::Object(obj)) => {
            matches!(obj.get("version"), Some(serde_json::Value::Number(_)))
        }
        _ => false,
    };
    if !ok {
        return Err("Refusing to write invalid agents.json".to_string());
    }
    let root_path = checked_root(&root)?;
    let _guard = agent_fs_guard();
    let path = root_path.join(".cowtext").join("agents.json");
    write_atomic(&path, &content)
}

/// Shared body of `agent_save` / `skill_save` (contract §2.1).
fn save_doc(
    path: &Path,
    missing_msg: String,
    fields: Option<FmFields>,
    body: Option<String>,
    raw_content: Option<String>,
) -> Result<(), String> {
    let has_fields_or_body = fields.is_some() || body.is_some();
    if raw_content.is_some() && has_fields_or_body {
        return Err("Ambiguous save: raw content and fields".to_string());
    }
    if raw_content.is_none() && !has_fields_or_body {
        return Ok(()); // no-op: nothing supplied
    }
    if !path.is_file() {
        return Err(missing_msg);
    }
    if let Some(raw) = raw_content {
        return write_atomic(path, &raw);
    }
    let current = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let patched = frontmatter::patch(&current, fields.as_ref(), body.as_deref())?;
    write_atomic(path, &patched)
}

/// After a rename, patch the `name:` line of the moved file to the new
/// slug. Best-effort: a `raw` doc (or any read/patch failure) is skipped
/// silently — the rename itself already succeeded and its returned name is
/// authoritative (contract §2.1).
fn rename_patch_name(path: &Path, slug: &str) {
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    let doc = frontmatter::parse(&content);
    if doc.raw {
        return;
    }
    let mut f = doc.fields();
    f.name = Some(slug.to_string());
    if let Ok(patched) = frontmatter::patch(&content, Some(&f), None) {
        let _ = write_atomic(path, &patched);
    }
}
