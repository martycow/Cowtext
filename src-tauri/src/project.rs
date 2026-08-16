//! Project scanning: open a folder, list its markdown files.
//! All FS access lives here on the Rust side — the webview only ever
//! passes paths it received from us or from the native dialog.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

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
}
