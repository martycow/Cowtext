//! Presets: save/list/read/export/apply `.cowtext-preset.json` files
//! (contract §8.1–8.2). Presets are app-level (they seed *new* projects) and
//! live in `app_config_dir/presets/`.
//!
//! Invariants this module owns:
//! - **Bytes verbatim**: Rust validates minimally (parse, `kind`,
//!   `version`, `nodes` array) and stores the frontend's serialization
//!   untouched — graph/preset serialization ownership stays in the webview,
//!   mirroring graph.json handling.
//! - **Never-clobber apply**: `preset_apply` refuses a project that already
//!   has a non-empty graph.json (an empty `nodes: []` file is tolerated —
//!   the UI's "empty graph" gate), skips existing stub files atomically
//!   (`create_new`, no TOCTOU), and writes graph.json last so a mid-way
//!   failure leaves no usable graph and the apply retryable.

#[cfg(test)]
mod tests;

use crate::project::{checked_root, resolve_within_root, write_atomic};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Canonical preset file extension (contract §8.1).
const PRESET_EXT: &str = ".cowtext-preset.json";

/// Mirrors `project::GRAPH_REL_PATH` (private there; project.rs is frozen).
const GRAPH_REL_PATH: &str = ".cowtext/graph.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub name: String,
    pub path: String,
    pub saved_at: String,
    pub node_count: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubFile {
    pub rel_path: String,
    pub content: String,
}

/// Minimal validated view of a preset file. Rust never re-serializes the
/// preset — this exists only for listing and gatekeeping.
struct PresetMeta {
    name: String,
    saved_at: String,
    node_count: usize,
}

fn validate_preset(json: &str) -> Result<PresetMeta, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("preset is not valid JSON: {e}"))?;
    if v.get("kind").and_then(|k| k.as_str()) != Some("cowtext-preset") {
        return Err("Not a Cowtext preset (kind mismatch)".to_string());
    }
    if v.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Err("Unsupported preset version (expected 1)".to_string());
    }
    let nodes = v
        .get("nodes")
        .and_then(|n| n.as_array())
        .ok_or_else(|| "Preset has no nodes array".to_string())?;
    Ok(PresetMeta {
        name: v
            .get("name")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
        saved_at: v
            .get("savedAt")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
        node_count: nodes.len(),
    })
}

/// Slug per contract §3: lowercase, `[a-z0-9-]` only, whitespace/`_` → `-`,
/// runs collapsed, edges trimmed. Empty result → Err.
fn slugify(name: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut prev_dash = true; // suppresses leading dashes
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if (c.is_whitespace() || c == '-' || c == '_') && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        return Err(format!("Preset name has no usable characters: {name:?}"));
    }
    Ok(out)
}

fn presets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("presets"))
        .map_err(|e| format!("app_config_dir: {e}"))
}

/// Pure body of `preset_save` — testable without an AppHandle.
fn save_inner(dir: &Path, name: &str, preset_json: &str) -> Result<String, String> {
    validate_preset(preset_json)?;
    let slug = slugify(name)?;
    let path = dir.join(format!("{slug}{PRESET_EXT}"));
    // Same-name overwrite is deliberate: presets are app-local, not a
    // trust boundary (contract §3).
    write_atomic(&path, preset_json)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Pure body of `preset_list`. Missing dir → empty; unreadable or invalid
/// preset files are skipped, never an error.
fn list_inner(dir: &Path) -> Result<Vec<PresetInfo>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !path.is_file() || !file_name.ends_with(PRESET_EXT) {
            continue;
        }
        let Ok(json) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(meta) = validate_preset(&json) else {
            continue;
        };
        let name = if meta.name.is_empty() {
            file_name.trim_end_matches(PRESET_EXT).to_string()
        } else {
            meta.name
        };
        out.push(PresetInfo {
            name,
            path: path.to_string_lossy().into_owned(),
            saved_at: meta.saved_at,
            node_count: meta.node_count,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
pub fn preset_save(app: AppHandle, name: String, preset_json: String) -> Result<String, String> {
    save_inner(&presets_dir(&app)?, &name, &preset_json)
}

#[tauri::command]
pub fn preset_list(app: AppHandle) -> Result<Vec<PresetInfo>, String> {
    list_inner(&presets_dir(&app)?)
}

/// `path` is absolute, from an OS open-dialog — the one sanctioned source
/// of absolute paths (CLAUDE.md FS rule).
#[tauri::command]
pub fn preset_read(path: String) -> Result<String, String> {
    let json = fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    validate_preset(&json)?;
    Ok(json)
}

/// `path` is absolute, from an OS save-dialog. Appends the canonical
/// extension when the chosen name lacks it — but refuses to overwrite an
/// existing file at the APPENDED path: the dialog's overwrite prompt only
/// covered the literal typed name, so silently writing elsewhere could
/// clobber a file the user never confirmed.
#[tauri::command]
pub fn preset_export(path: String, preset_json: String) -> Result<(), String> {
    validate_preset(&preset_json)?;
    let path = if path.to_lowercase().ends_with(PRESET_EXT) {
        path
    } else {
        let appended = format!("{path}{PRESET_EXT}");
        if Path::new(&appended).exists() {
            return Err(format!(
                "{appended} already exists — pick the full file name in the save dialog to overwrite it"
            ));
        }
        appended
    };
    write_atomic(Path::new(&path), &preset_json)
}

#[tauri::command]
pub fn preset_apply(
    root: String,
    graph_json: String,
    stubs: Vec<StubFile>,
) -> Result<Vec<String>, String> {
    let root_path = checked_root(&root)?;
    // Existence guard FIRST: applying onto a project that already has a
    // real graph is never allowed. A graph.json whose `nodes` array is
    // EMPTY is tolerated — it matches the UI's "empty graph" Apply gate
    // (a project whose last node was deleted still has the file on disk).
    // Unparseable or non-empty graphs stay fail-closed.
    let graph_path = root_path.join(GRAPH_REL_PATH);
    if graph_path.exists() && !graph_is_empty(&graph_path) {
        return Err("project already has a graph (.cowtext/graph.json)".to_string());
    }
    // Validate every stub path before writing anything, so a bad path can
    // never leave a half-applied preset.
    let mut resolved: Vec<(PathBuf, &StubFile)> = Vec::with_capacity(stubs.len());
    for s in &stubs {
        if !s.rel_path.to_lowercase().ends_with(".md") {
            return Err(format!(
                "Refusing to write non-markdown stub: {}",
                s.rel_path
            ));
        }
        resolved.push((resolve_within_root(&root_path, &s.rel_path)?, s));
    }
    let mut written = Vec::new();
    for (path, s) in &resolved {
        // Atomic never-clobber: `create_new` checks and claims the path in
        // one syscall, so a file appearing between a separate exists() probe
        // and the write can never be destroyed (no TOCTOU window).
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        match fs::File::create_new(path) {
            Ok(mut f) => {
                use std::io::Write;
                f.write_all(s.content.as_bytes())
                    .map_err(|e| format!("{}: {e}", path.display()))?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                continue; // never-clobber: skipped, excluded from the return list
            }
            Err(e) => return Err(format!("{}: {e}", path.display())),
        }
        written.push(s.rel_path.replace('\\', "/"));
    }
    // graph.json last: a failure above leaves no graph, so the apply stays
    // retryable.
    write_atomic(&graph_path, &graph_json)?;
    written.push(GRAPH_REL_PATH.to_string());
    Ok(written)
}

/// True only when the file parses as JSON with an empty `nodes` array.
fn graph_is_empty(graph_path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(graph_path) else {
        return false;
    };
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => v
            .get("nodes")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|a| a.is_empty()),
        Err(_) => false,
    }
}
