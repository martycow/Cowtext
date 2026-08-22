//! Hook receiver (plan §7): axum on [`BIND_ADDR`], single route
//! `POST /event`. Normalizes Claude Code hook JSON to [`BarnEvent`] and
//! re-emits it on the Tauri event bus as `"barn://event"`.
//!
//! [`BIND_ADDR`] is the single source of truth for the hooks port (WO15
//! D-2): `hooks.rs` renders the curl command and the installed-hook marker
//! from it, and the UI reads it over the [`hooks_addr`] command. No other
//! module may hard-code the port — the WO15 gate greps `src-tauri/src` for
//! the literal and expects the const below plus test files, nothing else.
//!
//! Hooks must never see errors: any body — including garbage — gets a 200
//! with an empty response. A failed bind (port taken) logs and gives up;
//! the app still starts, only the live monitor is dark.

#[cfg(test)]
mod tests;

use axum::{body::Bytes, extract::State, routing::post, Router};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// Tauri event channel the frontend listens on.
const BARN_EVENT: &str = "barn://event";

pub(crate) const BIND_ADDR: (&str, u16) = ("127.0.0.1", 4923);

/// `"<host>:<port>"` — the one string every other module renders from.
/// The exact content is pinned in `hooks_server/tests.rs`, deliberately not
/// repeated here: a doc comment carrying the literal would be a second copy
/// of the number the gate above exists to forbid.
pub(crate) fn bind_addr_string() -> String {
    format!("{}:{}", BIND_ADDR.0, BIND_ADDR.1)
}

/// The hooks receiver's bind address, for the Settings/Hooks UI (WO15 D-2).
#[tauri::command]
pub fn hooks_addr() -> String {
    bind_addr_string()
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BarnKind {
    Prompt,
    Read,
    Edit,
    Write,
    Grep,
    Glob,
    Stop,
    SubagentStop,
    Other,
}

/// Wire shape, mirrored 1:1 in `src/store/events.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BarnEvent {
    pub kind: BarnKind,
    /// Verbatim from the hook (may be absolute); omitted if absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    /// Set when `kind == Other` (raw tool_name), else omitted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// Hook session_id, "" if absent.
    pub session_id: String,
    /// Unix millis, assigned at receipt.
    pub ts: u64,
}

/// Start the receiver. Called once from `lib.rs::run()` inside `.setup`.
/// Bind failure logs and returns — the app must still start.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(BIND_ADDR).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!(
                    "cowtext: hooks server could not bind {} ({e}) — live monitor disabled",
                    bind_addr_string()
                );
                return;
            }
        };
        let router = Router::new()
            .route("/event", post(receive))
            .with_state(app);
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("cowtext: hooks server stopped: {e}");
        }
    });
}

/// Always 200 with an empty body — hooks must never see errors.
async fn receive(State(app): State<AppHandle>, body: Bytes) {
    if let Some(event) = normalize(&body, now_millis()) {
        let _ = app.emit(BARN_EVENT, &event);
    }
}

/// Normalize hook JSON to a BarnEvent. `None` only when the body is not a
/// JSON object at all; events with missing fields are still produced —
/// the log feed shows everything.
///
/// Mapping: `UserPromptSubmit` → prompt · `Stop` → stop · `SubagentStop` →
/// subagent_stop · `PostToolUse` by tool_name: Read→read, Edit|MultiEdit→edit,
/// Write→write, Grep→grep, Glob→glob, anything else → other (+toolName).
/// `filePath` from `tool_input.file_path`, falling back to `tool_input.path`.
fn normalize(body: &[u8], ts: u64) -> Option<BarnEvent> {
    let v: Value = serde_json::from_slice(body).ok()?;
    if !v.is_object() {
        return None;
    }
    let event_name = v
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let raw_tool = v.get("tool_name").and_then(Value::as_str);
    let session_id = v
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let file_path = v
        .pointer("/tool_input/file_path")
        .and_then(Value::as_str)
        .or_else(|| v.pointer("/tool_input/path").and_then(Value::as_str))
        .map(str::to_string);

    let (kind, tool_name) = match event_name {
        "UserPromptSubmit" => (BarnKind::Prompt, None),
        "Stop" => (BarnKind::Stop, None),
        "SubagentStop" => (BarnKind::SubagentStop, None),
        "PostToolUse" => match raw_tool.unwrap_or("") {
            "Read" => (BarnKind::Read, None),
            "Edit" | "MultiEdit" => (BarnKind::Edit, None),
            "Write" => (BarnKind::Write, None),
            "Grep" => (BarnKind::Grep, None),
            "Glob" => (BarnKind::Glob, None),
            other => (
                BarnKind::Other,
                (!other.is_empty()).then(|| other.to_string()),
            ),
        },
        _ => (BarnKind::Other, raw_tool.map(str::to_string)),
    };

    Some(BarnEvent {
        kind,
        file_path,
        tool_name,
        session_id,
        ts,
    })
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
