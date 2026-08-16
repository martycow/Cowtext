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

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn finds_md_skips_hidden_and_dep_dirs() {
        let dir = std::env::temp_dir().join(format!("cowtext-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        touch(&dir.join("README.md"), "# hi");
        touch(&dir.join("docs/plan.MD"), "# case-insensitive");
        touch(&dir.join("docs/deep/notes.md"), "# nested");
        touch(&dir.join("src/main.rs"), "fn main() {}");
        touch(&dir.join(".git/junk.md"), "skipped");
        touch(&dir.join("node_modules/pkg/readme.md"), "skipped");

        let scan = scan_project(dir.to_string_lossy().into_owned()).unwrap();
        let paths: Vec<&str> = scan.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert_eq!(paths, ["README.md", "docs/deep/notes.md", "docs/plan.MD"]);
        assert!(scan.files.iter().all(|f| f.size_bytes > 0));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_non_directory() {
        assert!(scan_project("Z:/definitely/not/a/dir".into()).is_err());
    }

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cowtext-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn path_guard_accepts_normal_relative_paths() {
        let root = Path::new("C:/proj");
        let ok = resolve_within_root(root, "context/rules.md").unwrap();
        assert_eq!(ok, root.join("context").join("rules.md"));
        // `.` components are dropped, not rejected.
        let ok = resolve_within_root(root, "./docs/plan.md").unwrap();
        assert_eq!(ok, root.join("docs").join("plan.md"));
    }

    #[test]
    fn path_guard_rejects_escapes() {
        let root = Path::new("C:/proj");
        for bad in [
            "../outside.md",
            "context/../../outside.md",
            "..",
            "C:/windows/system32/evil.md",
            "C:\\other\\evil.md",
            "/etc/passwd",
            "\\\\server\\share\\evil.md",
            "",
            "   ",
            ".",
        ] {
            assert!(
                resolve_within_root(root, bad).is_err(),
                "should have rejected {bad:?}"
            );
        }
    }

    #[test]
    fn md_commands_respect_the_guard() {
        let dir = temp_project("guard");
        let root = dir.to_string_lossy().into_owned();
        assert!(write_md_file(root.clone(), "../evil.md".into(), "x".into()).is_err());
        assert!(read_md_file(root, "../../evil.md".into()).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn graph_round_trip() {
        let dir = temp_project("graph");
        let root = dir.to_string_lossy().into_owned();

        // No graph yet → None, not an error.
        assert_eq!(read_graph(root.clone()).unwrap(), None);

        let content = "{\n  \"version\": 1,\n  \"nodes\": []\n}\n";
        write_graph(root.clone(), content.into()).unwrap();
        assert_eq!(read_graph(root.clone()).unwrap().as_deref(), Some(content));

        // Overwrite (the atomic remove+rename path) preserves the new bytes.
        let updated = "{\n  \"version\": 1,\n  \"nodes\": [{\"id\": \"a\"}]\n}\n";
        write_graph(root.clone(), updated.into()).unwrap();
        assert_eq!(read_graph(root.clone()).unwrap().as_deref(), Some(updated));

        // No temp files left behind.
        let leftovers: Vec<_> = fs::read_dir(dir.join(".cowtext"))
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn md_round_trip_creates_parent_dirs() {
        let dir = temp_project("md");
        let root = dir.to_string_lossy().into_owned();
        write_md_file(root.clone(), "context/new-node.md".into(), "# Hi\n".into()).unwrap();
        assert_eq!(
            read_md_file(root, "context/new-node.md".into()).unwrap(),
            "# Hi\n"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
