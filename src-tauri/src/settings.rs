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

// ── WO06 D9 fix: global default session token ceiling ──────────────────
//
// WO06 shipped per-session token ceilings (contract §5) with an atomic
// hard-stop, but the frontend-side global-default deliverable (§5.1, lane
// U3) never landed — WO06_AUDIT.md D9: a tree-wide grep for
// `sessionTokenCeiling` returned zero hits, so every agent session launched
// completely unbounded unless a caller remembered to pass an explicit
// per-task ceiling, every single time. This tool spends real money via
// `claude -p`, so "no budget by default" is not a safety net.
//
// Fix: `settings.rs` reads the same field the frontend was always meant to
// own (`AppSettings.sessionTokenCeiling: number`, contract §8) and
// `sessions.rs` inherits it whenever a spawn carries no explicit per-task
// ceiling (`sessions.rs::resolve_ceiling`). The field name and JSON shape
// are unchanged from the frozen contract — only *who reads it* changes,
// so the UI lane's eventual settings control needs no coordination beyond
// matching this exact key.

/// The global default cap applied to every agent session that is not
/// spawned with an explicit per-task ceiling. `0`, exactly like the wire
/// convention `sessions.rs` already uses for `tokenCeiling`, means "no
/// cap" — the one way a user opts the *whole app* into unbounded sessions,
/// not just one task (a per-task `tokenCeiling: 0` still opts out one
/// session at a time regardless of this default; see
/// `sessions.rs::resolve_ceiling`).
///
/// Chosen default: **not** `0` (unlimited). Reasoning: the failure mode of
/// an unexpected cap — a session stops, says exactly why (contract §5.4's
/// `budget` event), and offers a one-click Restart — is far cheaper than
/// the failure mode of no cap: unbounded spend with no warning, silently,
/// forever, until a human happens to look. `200_000` is not an arbitrary
/// round number: it is the exact context-window assumption already baked
/// into the product (`CONTEXT_WINDOW_TOKENS`, `src/store/tokens.ts`) *and*
/// the exact number the frozen contract itself used as its own worked
/// example of a sane per-task ceiling (`WO06_CONTRACT.md` §3.2's
/// `"tokenCeiling": 200000`). A session that has cumulatively spent one
/// full context-window's worth of tokens without anyone setting a budget
/// is exactly the point a safety net should trip — low enough to catch a
/// runaway loop long before it does real financial damage, high enough
/// that ordinary multi-turn work (well under one window per session in
/// practice) is never interrupted by a default nobody chose. A user who
/// wants the old, unbounded behavior sets this to `0` in Settings, or sets
/// an explicit per-task ceiling of `0` for one session at a time.
pub const DEFAULT_SESSION_TOKEN_CEILING: u64 = 200_000;

/// Reads `sessionTokenCeiling` out of the persisted settings JSON. Always
/// resolves to a concrete value — never `None` — because `0` already means
/// "unlimited" on this field's wire convention, so there is no separate
/// "absent" state to represent.
///
/// Tolerant on every axis, by design (an old `settings.json` predating
/// this field, or one with a corrupted/foreign value, must load and behave
/// exactly like a fresh one — never error, never panic): a missing file, a
/// missing key, unparseable JSON, or a non-numeric/negative value all fall
/// back to [`DEFAULT_SESSION_TOKEN_CEILING`]. The filesystem/`AppHandle`
/// half is intentionally a thin, untested wrapper (same posture as
/// `init`/`apply_claude_override` above) around the pure, directly-tested
/// [`parse_global_ceiling`].
pub fn global_token_ceiling(app: &AppHandle) -> u64 {
    match read_inner(app) {
        Ok(Some(json)) => parse_global_ceiling(&json),
        _ => DEFAULT_SESSION_TOKEN_CEILING,
    }
}

/// Pure core of [`global_token_ceiling`]: JSON string in, resolved ceiling
/// out. Accepts an integer or an integral float (`200000.0`) for
/// `sessionTokenCeiling` — a defensive widening over the strict "frontend
/// always writes an integer" assumption, since this value is also read
/// Rust-side now. Anything else (missing key, string, negative, NaN,
/// fractional, malformed JSON entirely) is the default, not an error.
fn parse_global_ceiling(json: &str) -> u64 {
    let Some(value) = serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("sessionTokenCeiling").cloned())
    else {
        return DEFAULT_SESSION_TOKEN_CEILING;
    };
    value
        .as_u64()
        .or_else(|| value.as_f64().filter(|f| f.is_finite() && *f >= 0.0 && f.fract() == 0.0).map(|f| f as u64))
        .unwrap_or(DEFAULT_SESSION_TOKEN_CEILING)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn bare_name_override_resolves_via_where() {
        // `cmd` exists on every Windows box; a bare name must come back as
        // a real path, not travel verbatim into CreateProcess.
        let p = resolve_override("cmd".to_string());
        assert!(p.is_absolute(), "expected an absolute path, got {p:?}");
    }

    #[cfg(windows)]
    #[test]
    fn path_like_override_passes_through_verbatim() {
        let raw = "C:\\tools\\claude.cmd".to_string();
        assert_eq!(resolve_override(raw.clone()), PathBuf::from(raw));
    }

    #[cfg(windows)]
    #[test]
    fn unresolvable_bare_name_falls_back_verbatim() {
        let raw = format!("cowtext-no-such-program-{}", std::process::id());
        assert_eq!(resolve_override(raw.clone()), PathBuf::from(raw));
    }

    // ── parse_global_ceiling (WO06 D9) ──────────────────────────────────

    #[test]
    fn parse_global_ceiling_reads_an_explicit_value() {
        assert_eq!(parse_global_ceiling(r#"{"sessionTokenCeiling":50000}"#), 50_000);
    }

    #[test]
    fn parse_global_ceiling_zero_is_the_explicit_unlimited_opt_out() {
        assert_eq!(parse_global_ceiling(r#"{"sessionTokenCeiling":0}"#), 0);
    }

    #[test]
    fn parse_global_ceiling_missing_key_falls_back_to_the_default() {
        // Simulates an old settings.json written before this field existed —
        // must load fine, not error, and yield the documented default.
        let old_settings_json = r#"{"version":1,"masterVolume":0.6,"barnSounds":true}"#;
        assert_eq!(parse_global_ceiling(old_settings_json), DEFAULT_SESSION_TOKEN_CEILING);
    }

    #[test]
    fn parse_global_ceiling_malformed_json_falls_back_to_the_default() {
        assert_eq!(parse_global_ceiling("not json at all"), DEFAULT_SESSION_TOKEN_CEILING);
    }

    #[test]
    fn parse_global_ceiling_empty_string_falls_back_to_the_default() {
        assert_eq!(parse_global_ceiling(""), DEFAULT_SESSION_TOKEN_CEILING);
    }

    #[test]
    fn parse_global_ceiling_non_numeric_value_falls_back_to_the_default() {
        assert_eq!(parse_global_ceiling(r#"{"sessionTokenCeiling":"a lot"}"#), DEFAULT_SESSION_TOKEN_CEILING);
    }

    #[test]
    fn parse_global_ceiling_negative_value_falls_back_to_the_default() {
        assert_eq!(parse_global_ceiling(r#"{"sessionTokenCeiling":-5}"#), DEFAULT_SESSION_TOKEN_CEILING);
    }

    #[test]
    fn parse_global_ceiling_accepts_an_integral_float() {
        assert_eq!(parse_global_ceiling(r#"{"sessionTokenCeiling":75000.0}"#), 75_000);
    }

    #[test]
    fn parse_global_ceiling_rejects_a_fractional_float() {
        assert_eq!(parse_global_ceiling(r#"{"sessionTokenCeiling":1000.5}"#), DEFAULT_SESSION_TOKEN_CEILING);
    }

    #[test]
    fn parse_global_ceiling_null_falls_back_to_the_default() {
        assert_eq!(parse_global_ceiling(r#"{"sessionTokenCeiling":null}"#), DEFAULT_SESSION_TOKEN_CEILING);
    }
}
