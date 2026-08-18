//! Project scanning + per-project persistence.
//! All FS access lives here on the Rust side — the webview only ever
//! passes paths it received from us or from the native dialog.
//!
//! Two invariants this module owns:
//! - **Path guard**: every relative path from the webview is resolved with
//!   [`resolve_within_root`]; anything absolute or escaping the project root
//!   is rejected before it touches the filesystem.
//! - **Atomic writes**: [`write_atomic`] writes a temp file in the target
//!   directory and renames it into place, so a crash never leaves a
//!   half-written `graph.json` or node file.

#[cfg(test)]
mod tests;

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Relative path of the graph file inside a project.
const GRAPH_REL_PATH: &str = ".cowtext/graph.json";

/// Directories never worth scanning. Keeps the walk fast and the list honest.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".venv",
    "venv",
    "__pycache__",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MdFile {
    /// Path relative to the project root, forward slashes.
    pub rel_path: String,
    pub size_bytes: u64,
    /// Unix millis; None if the platform won't say.
    pub modified_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScan {
    pub root: String,
    pub files: Vec<MdFile>,
}

/// Scan `root` recursively for `.md` files. Hidden directories and the
/// usual build/dependency directories are skipped.
#[tauri::command]
pub fn scan_project(root: String) -> Result<ProjectScan, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {root}"));
    }

    let mut files = Vec::new();
    walk(&root_path, &root_path, &mut files)?;
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

    Ok(ProjectScan { root, files })
}

pub(crate) fn walk(root: &Path, dir: &Path, out: &mut Vec<MdFile>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if path.is_dir() {
            let skip = name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref());
            if !skip {
                // A subdirectory that vanishes mid-scan is not an error.
                let _ = walk(root, &path, out);
            }
        } else if name.to_lowercase().ends_with(".md") {
            let meta = entry.metadata().ok();
            out.push(MdFile {
                rel_path: path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
                size_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                modified_ms: meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64),
            });
        }
    }
    Ok(())
}

/// Resolve `rel` against `root`, rejecting anything that could escape it.
/// Purely lexical: no `..`, no absolute paths, no drive prefixes. The file
/// itself does not need to exist (writes create it).
pub(crate) fn resolve_within_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.trim().is_empty() {
        return Err("Empty path".into());
    }
    let rel_path = Path::new(rel);
    let mut out = PathBuf::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Path escapes project root: {rel}"));
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("Path resolves to nothing: {rel}"));
    }
    Ok(root.join(out))
}

/// Write `content` atomically: temp file in the same directory, then rename.
/// Creates missing parent directories. LF content is passed through verbatim.
pub(crate) fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
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
    // On Windows, rename fails if the target exists; remove it first.
    // The temp file is complete at this point, so the worst crash outcome
    // is "old file gone, finished temp file present" — never a torn write.
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", tmp.display()))?;
    Ok(())
}

pub(crate) fn checked_root(root: &str) -> Result<PathBuf, String> {
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {root}"));
    }
    Ok(root_path)
}

/// Read `.cowtext/graph.json`. `Ok(None)` when the project has no graph yet.
#[tauri::command]
pub fn read_graph(root: String) -> Result<Option<String>, String> {
    let path = checked_root(&root)?.join(GRAPH_REL_PATH);
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// Write `.cowtext/graph.json` atomically. The webview is responsible for
/// stable serialization (fixed field order, LF, trailing newline).
#[tauri::command]
pub fn write_graph(root: String, content: String) -> Result<(), String> {
    let path = checked_root(&root)?.join(GRAPH_REL_PATH);
    write_atomic(&path, &content)
}

/// Read a markdown (or any text) file under the project root.
#[tauri::command]
pub fn read_md_file(root: String, rel_path: String) -> Result<String, String> {
    let path = resolve_within_root(&checked_root(&root)?, &rel_path)?;
    fs::read_to_string(&path).map_err(|e| format!("{rel_path}: {e}"))
}

/// Write a text file under the project root, atomically, creating parent
/// directories as needed (e.g. `context/` for a brand-new node).
#[tauri::command]
pub fn write_md_file(root: String, rel_path: String, content: String) -> Result<(), String> {
    let path = resolve_within_root(&checked_root(&root)?, &rel_path)?;
    write_atomic(&path, &content)
}

/// Files/directories the app must never rename or clobber — generated
/// outputs and tool-owned trees. `rel_path` is normalized to forward
/// slashes and lowercased before comparison.
pub(crate) fn is_rename_protected(rel_path: &str) -> bool {
    let normalized = rel_path.replace('\\', "/").to_ascii_lowercase();
    normalized == "claude.md"
        || normalized == "agents.md"
        || normalized.starts_with(".claude/")
        || normalized.starts_with(".cursor/")
        || normalized.starts_with(".cowtext/")
}

/// Rename a node's .md file inside the project root. Never clobbers.
/// Returns the normalized (forward-slash) new relative path — the exact
/// string `scan_project` would emit — so the store can store it verbatim.
#[tauri::command]
pub fn rename_node_file(
    root: String,
    rel_path: String,
    new_rel_path: String,
) -> Result<String, String> {
    let root_path = checked_root(&root)?;
    let src = resolve_within_root(&root_path, &rel_path)?;
    let dest = resolve_within_root(&root_path, &new_rel_path)?;

    if !new_rel_path.to_ascii_lowercase().ends_with(".md") {
        return Err(format!("Destination must be a .md file: {new_rel_path}"));
    }

    if is_rename_protected(&rel_path) || is_rename_protected(&new_rel_path) {
        return Err(format!(
            "Refusing to rename a generated or tool-owned file: {rel_path}"
        ));
    }

    if !src.is_file() {
        return Err(format!("Not a file: {rel_path}"));
    }

    if src == dest {
        return Err("Source and destination are the same".to_string());
    }

    if dest.exists() {
        return Err(format!("Already exists: {new_rel_path}"));
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{new_rel_path}: {e}"))?;
    }
    fs::rename(&src, &dest).map_err(|e| format!("{rel_path}: {e}"))?;

    Ok(dest
        .strip_prefix(&root_path)
        .unwrap_or(&dest)
        .to_string_lossy()
        .replace('\\', "/"))
}

/// Show a project file (or the project folder itself) in the OS file
/// manager. `rel_path == None` (or empty) reveals `root`. If the resolved
/// path is missing, walk up to the nearest existing ancestor still inside
/// `root` and reveal that instead.
#[tauri::command]
pub fn reveal_path(
    app: tauri::AppHandle,
    root: String,
    rel_path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let root_path = checked_root(&root)?;
    let target = match rel_path.as_deref() {
        Some(p) if !p.trim().is_empty() => resolve_within_root(&root_path, p)?,
        _ => root_path.clone(),
    };

    let mut candidate = target.as_path();
    while !candidate.exists() {
        match candidate.parent() {
            Some(parent) if parent.starts_with(&root_path) => candidate = parent,
            _ => {
                return Err(format!(
                    "Nothing to reveal: {}",
                    rel_path.as_deref().unwrap_or("")
                ))
            }
        }
    }

    app.opener()
        .reveal_item_in_dir(candidate)
        .map_err(|e| e.to_string())
}

/// Existence probe for the recent-projects list. Same order as the input;
/// individual entries never error.
#[tauri::command]
pub fn probe_project_dirs(paths: Vec<String>) -> Result<Vec<bool>, String> {
    Ok(paths.iter().map(|p| Path::new(p).is_dir()).collect())
}