//! Hooks writer — the `.claude/settings.json` trust boundary (plan §7).
//!
//! The only file this module ever touches is `<root>/.claude/settings.json`.
//! `hooks_preview` merges the Cowtext hook block into whatever is already
//! there, preserving every unrelated key; `hooks_write` writes exactly the
//! bytes the user approved in the diff modal. The frontend MUST have shown
//! the preview diff and received an explicit click before calling
//! `hooks_write` — no auto-write path exists here.

#[cfg(test)]
mod tests;

use crate::project::{checked_root, write_atomic};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;

/// The one and only target file, relative to the project root.
const SETTINGS_REL_PATH: &str = ".claude/settings.json";

/// The hook command from plan §7. `|| true` guarantees hooks never block
/// Claude Code when the app is closed.
const HOOK_COMMAND: &str =
    "curl -s -m 1 -X POST --data-binary @- http://127.0.0.1:4923/event || true";

/// Substring that identifies an already-installed Cowtext hook entry.
const HOOK_MARKER: &str = "127.0.0.1:4923/event";

const POST_TOOL_USE_MATCHER: &str = "Read|Edit|Write|Grep|Glob";

/// The three hook events Cowtext installs: (event name, matcher).
const HOOK_EVENTS: [(&str, Option<&str>); 3] = [
    ("PostToolUse", Some(POST_TOOL_USE_MATCHER)),
    ("UserPromptSubmit", None),
    ("Stop", None),
];

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HooksPreview {
    /// Always ".claude/settings.json".
    pub rel_path: String,
    /// None = file absent.
    pub old_content: Option<String>,
    pub new_content: String,
    pub unchanged: bool,
}

/// Read any existing settings.json, merge the plan-§7 hooks block into it
/// preserving all unrelated keys, and return old/new for the diff modal.
#[tauri::command]
pub fn hooks_preview(root: String) -> Result<HooksPreview, String> {
    let path = checked_root(&root)?.join(SETTINGS_REL_PATH);
    let old_content = if path.is_file() {
        Some(fs::read_to_string(&path).map_err(|e| format!("{SETTINGS_REL_PATH}: {e}"))?)
    } else {
        None
    };
    let new_content = merge_hooks(old_content.as_deref())?;
    let unchanged = old_content.as_deref() == Some(new_content.as_str());
    Ok(HooksPreview {
        rel_path: SETTINGS_REL_PATH.to_string(),
        old_content,
        new_content,
        unchanged,
    })
}

/// Write the exact bytes the user approved. Guards: must parse as a JSON
/// object; path fixed to `.claude/settings.json`; atomic write.
#[tauri::command]
pub fn hooks_write(root: String, content: String) -> Result<(), String> {
    match serde_json::from_str::<Value>(&content) {
        Ok(Value::Object(_)) => {}
        _ => return Err("Refusing to write invalid JSON".to_string()),
    }
    let path = checked_root(&root)?.join(SETTINGS_REL_PATH);
    write_atomic(&path, &content)
}

/// Merge the Cowtext hook block into `existing` (None = file absent).
/// Every key we don't own passes through untouched. If all three hook
/// entries are already installed, the existing content is returned
/// verbatim so the preview shows no diff. A file that exists but is not
/// valid JSON is NEVER clobbered — that is an `Err`.
fn merge_hooks(existing: Option<&str>) -> Result<String, String> {
    let mut root: Value = match existing {
        None => json!({}),
        Some(s) => {
            serde_json::from_str(s).map_err(|e| format!("settings.json is not valid JSON: {e}"))?
        }
    };
    let Value::Object(top) = &mut root else {
        return Err("settings.json is not valid JSON: top level is not an object".to_string());
    };
    let hooks = top
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(hooks) = hooks else {
        return Err("settings.json: \"hooks\" is not an object — refusing to overwrite".to_string());
    };

    let mut changed = false;
    for (event, matcher) in HOOK_EVENTS {
        let arr = hooks
            .entry(event)
            .or_insert_with(|| Value::Array(Vec::new()));
        let Value::Array(arr) = arr else {
            return Err(format!(
                "settings.json: \"hooks.{event}\" is not an array — refusing to overwrite"
            ));
        };
        let installed = event_already_installed(arr);
        if !installed {
            arr.push(hook_entry(matcher));
            changed = true;
        }
    }

    if !changed {
        if let Some(s) = existing {
            // Already fully installed: keep the user's bytes exactly.
            return Ok(s.to_string());
        }
    }
    let mut out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    out.push('\n');
    Ok(out)
}

/// True when `arr` (an event's hook-entry array) already carries a Cowtext
/// entry. Shared by `merge_hooks` and `hooks_status` so the two paths
/// cannot drift.
fn event_already_installed(arr: &[Value]) -> bool {
    arr.iter().any(|entry| entry.to_string().contains(HOOK_MARKER))
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    /// All three Cowtext hook entries present in .claude/settings.json.
    pub installed: bool,
    /// .claude/settings.json exists on disk.
    pub file_exists: bool,
    /// The file parsed as a JSON object with a usable `hooks` object.
    /// false ⇒ `installed` is meaningless; the UI must say so, not lie.
    pub readable: bool,
}

/// Passive, read-only probe. Never writes, never errors on malformed JSON —
/// `Err` is reserved for infrastructure failure (bad root, IO read error).
#[tauri::command]
pub fn hooks_status(root: String) -> Result<HooksStatus, String> {
    let path = checked_root(&root)?.join(SETTINGS_REL_PATH);
    if !path.is_file() {
        return Ok(HooksStatus {
            installed: false,
            file_exists: false,
            readable: true,
        });
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("{SETTINGS_REL_PATH}: {e}"))?;

    let parsed: Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => {
            return Ok(HooksStatus {
                installed: false,
                file_exists: true,
                readable: false,
            })
        }
    };
    let Value::Object(top) = &parsed else {
        return Ok(HooksStatus {
            installed: false,
            file_exists: true,
            readable: false,
        });
    };
    let hooks = match top.get("hooks") {
        None => {
            // No hooks key at all: readable, just nothing installed yet.
            return Ok(HooksStatus {
                installed: false,
                file_exists: true,
                readable: true,
            });
        }
        Some(Value::Object(h)) => h,
        Some(_) => {
            return Ok(HooksStatus {
                installed: false,
                file_exists: true,
                readable: false,
            })
        }
    };

    let installed = HOOK_EVENTS.iter().all(|(event, _)| {
        matches!(hooks.get(*event), Some(Value::Array(arr)) if event_already_installed(arr))
    });

    Ok(HooksStatus {
        installed,
        file_exists: true,
        readable: true,
    })
}

fn hook_entry(matcher: Option<&str>) -> Value {
    let mut entry = Map::new();
    if let Some(m) = matcher {
        entry.insert("matcher".to_string(), json!(m));
    }
    entry.insert(
        "hooks".to_string(),
        json!([{ "type": "command", "command": HOOK_COMMAND }]),
    );
    Value::Object(entry)
}
