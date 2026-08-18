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

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentsScan {
    pub agents: Vec<AgentDoc>,
    pub skills: Vec<SkillDoc>,
    pub meta_json: Option<String>,
    pub skipped: Vec<String>,
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

/// The reserved default-agent file (TASKBOARD_BATCH_CONTRACT.md §4) — same
/// protection class as `CLAUDE.md`. `agent_create("Producer")` is the only
/// sanctioned way to materialize it; rename/delete/convert never touch it.
const PRODUCER_FILE_NAME: &str = "producer.md";

fn is_producer_file(name: &str) -> bool {
    name.trim().to_ascii_lowercase() == PRODUCER_FILE_NAME
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

fn agent_template(slug: &str) -> String {
    format!(
        "---\nname: {slug}\ndescription: \nmodel: sonnet\ntools: Read, Grep, Glob\nskills: []\n---\n\n# {slug}\n\n## Duties\n\n## Boundaries\n"
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
pub fn agent_create(root: String, name: String) -> Result<AgentDoc, String> {
    validate_component(&name)?;
    let root_path = checked_root(&root)?;
    let slug = crate::preset::slugify(&name)?;
    let file_name = format!("{slug}.md");
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

#[tauri::command]
pub fn agent_save(
    root: String,
    file_name: String,
    fields: Option<FmFields>,
    body: Option<String>,
    raw_content: Option<String>,
) -> Result<(), String> {
    validate_md_component(&file_name)?;
    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &format!(".claude/agents/{file_name}"))?;
    save_doc(&path, format!("No such agent: {file_name}"), fields, body, raw_content)
}

#[tauri::command]
pub fn agent_rename(root: String, file_name: String, new_name: String) -> Result<String, String> {
    validate_md_component(&file_name)?;
    validate_component(&new_name)?;
    if is_producer_file(&file_name) {
        return Err("Reserved agent: producer".to_string());
    }
    let root_path = checked_root(&root)?;
    let slug = crate::preset::slugify(&new_name)?;
    let new_file_name = format!("{slug}.md");
    if is_producer_file(&new_file_name) {
        return Err("Reserved agent: producer".to_string());
    }
    let src = resolve_within_root(&root_path, &format!(".claude/agents/{file_name}"))?;
    let dest = resolve_within_root(&root_path, &format!(".claude/agents/{new_file_name}"))?;

    if dest.exists() && !same_entry(&src, &dest) {
        return Err(format!("An agent named \"{new_file_name}\" already exists"));
    }
    fs::rename(&src, &dest).map_err(|e| format!("{file_name}: {e}"))?;
    rename_patch_name(&dest, &slug);
    Ok(new_file_name)
}

#[tauri::command]
pub fn agent_delete(root: String, file_name: String) -> Result<(), String> {
    validate_md_component(&file_name)?;
    if is_producer_file(&file_name) {
        return Err("Reserved agent: producer".to_string());
    }
    let root_path = checked_root(&root)?;
    let path = resolve_within_root(&root_path, &format!(".claude/agents/{file_name}"))?;
    if !path.is_file() {
        return Err(format!("No such agent: {file_name}"));
    }
    fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub fn skill_create(root: String, name: String) -> Result<SkillDoc, String> {
    validate_component(&name)?;
    let root_path = checked_root(&root)?;
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
    let path = resolve_within_root(&root_path, &format!(".claude/skills/{dir_name}/SKILL.md"))?;
    save_doc(&path, format!("No such skill: {dir_name}"), fields, body, raw_content)
}

#[tauri::command]
pub fn skill_rename(root: String, dir_name: String, new_name: String) -> Result<String, String> {
    validate_component(&dir_name)?;
    validate_component(&new_name)?;
    let root_path = checked_root(&root)?;
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
    if is_producer_file(&file_name) {
        return Err("Reserved agent: producer".to_string());
    }
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
