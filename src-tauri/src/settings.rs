// App-level settings persistence. Frontend owns the JSON shape; Rust stores bytes.
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("settings.json"))
        .map_err(|e| format!("app_config_dir: {e}"))
}

fn read_inner(app: &AppHandle) -> Result<Option<String>, String> {
    let p = settings_path(app)?;
    if !p.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| format!("{}: {e}", p.display()))
}

#[tauri::command]
pub fn read_app_settings(app: AppHandle) -> Result<Option<String>, String> {
    read_inner(&app)
}

#[tauri::command]
pub fn write_app_settings(app: AppHandle, content: String) -> Result<(), String> {
    let p = settings_path(&app)?;
    crate::project::write_atomic(&p, &content)?;
    apply_claude_override(&content);
    Ok(())
}

/// Parse claudeBinaryPath out of the settings JSON and hand it to assemble.rs.
/// Tolerant: bad JSON or missing field clears the override.
fn apply_claude_override(json: &str) {
    let path = serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("claudeBinaryPath")?.as_str().map(str::to_owned))
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .map(resolve_override);
    crate::assemble::set_claude_override(path);
}

/// A bare command name (no path separator) cannot spawn a `.cmd` install on
/// Windows — CreateProcess appends only `.exe` — so resolve it through the
/// same `where` probe as auto-detect (`.exe` preferred over `.cmd`).
/// Resolved once per settings write, not per job. `where` finding nothing
/// falls back to the verbatim name so a bad value still surfaces as the
/// normal spawn error. Absolute/relative paths pass through unchanged.
#[cfg(windows)]
fn resolve_override(s: String) -> PathBuf {
    if !s.contains(['/', '\\']) {
        if let Some(found) = crate::assemble::where_probe(&s) {
            return found;
        }
    }
    PathBuf::from(s)
}

#[cfg(not(windows))]
fn resolve_override(s: String) -> PathBuf {
    PathBuf::from(s)
}

/// Called once from lib.rs setup — applies a persisted override at startup.
pub fn init(app: &AppHandle) {
    if let Ok(Some(json)) = read_inner(app) {
        apply_claude_override(&json);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::resolve_override;
    use std::path::PathBuf;

    #[test]
    fn bare_name_override_resolves_via_where() {
        // `cmd` exists on every Windows box; a bare name must come back as
        // a real path, not travel verbatim into CreateProcess.
        let p = resolve_override("cmd".to_string());
        assert!(p.is_absolute(), "expected an absolute path, got {p:?}");
    }

    #[test]
    fn path_like_override_passes_through_verbatim() {
        let raw = "C:\\tools\\claude.cmd".to_string();
        assert_eq!(resolve_override(raw.clone()), PathBuf::from(raw));
    }

    #[test]
    fn unresolvable_bare_name_falls_back_verbatim() {
        let raw = format!("cowtext-no-such-program-{}", std::process::id());
        assert_eq!(resolve_override(raw.clone()), PathBuf::from(raw));
    }
}
