//! Agent sessions (WO01 Block F contract): each session is a *logical*
//! entity in [`SessionRegistry`] (id, cwd, `claudeSessionId`, current child
//! pid) — not a long-lived process. Spawn boots one headless `claude -p`
//! turn; Send resumes the same conversation with `--resume <id>`. One child
//! process per turn; every turn runs through the single chokepoint
//! [`run_turn`], so a future interactive/PTY channel (deferred, contract
//! §2.3 D1) is an alternate implementation behind that call, not a rewrite.
//!
//! Guardrails (contract §3) live in [`SessionRegistry::register`]: at most
//! [`MAX_SESSIONS`] alive sessions, and no two alive sessions may share a
//! canonicalized cwd. Both are enforced synchronously against the in-memory
//! registry — no Tauri state needed — so they are unit-testable without a
//! running app; `register` takes an already-computed [`WorktreeInfo`] rather
//! than shelling out to git itself, for the same reason.
//!
//! `stream-json` -> `agent://event` mapping (contract §5.1) is the pure
//! [`map_line`], driven by [`run_turn`] one stdout line at a time. Every
//! registry mutation and every emit inside a turn is gated on its captured
//! `generation` still matching the entry's current generation — the
//! `watcher.rs` generation-guard idiom — so a turn a `kill`/`restart` has
//! superseded goes quiet instead of racing the new one.

#[cfg(test)]
mod tests;

use crate::worktree::WorktreeInfo;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, State};

/// Headless telemetry turn. `-p` reads the prompt from STDIN (never argv —
/// see `assemble.rs`'s `ClaudeRunner` header: Rust rejects newline args to
/// `.cmd`/`.bat`, CVE-2024-24576 hardening, and every prompt here is
/// multi-line). The ONLY place these flags are written (contract §2.1).
const HEADLESS_ARGS: &[&str] = &["-p", "--output-format", "stream-json", "--verbose"];
/// Continue an existing conversation: `RESUME_FLAG <claude session id>`.
const RESUME_FLAG: &str = "--resume";
/// Flags the probe must find in `claude --help` before we trust the above.
const REQUIRED_FLAGS: &[&str] = &["-p", "--output-format", "--verbose", "--resume"];
/// Substring the probe must find so we know `stream-json` is a valid format value.
const REQUIRED_FORMAT: &str = "stream-json";

const BOOT_PROMPT_HEAD: &str = "You are the Cowtext agent \"{name}\" working in {cwd}.";
const BOOT_PROMPT_TAIL: &str = "Reply with ONE short line confirming you are ready. \
Do not modify any file until you are asked to.";
const RESTART_PROMPT: &str = "Session restarted by Cowtext. Reply with ONE short line \
confirming you are ready to continue.";
const AGENT_FILE_MAX_BYTES: usize = 8 * 1024;

/// Hard cap on alive sessions (contract §3) — mirrors `CalfHerd::CAP` and
/// the frontend's `MAX_SESSIONS`.
const MAX_SESSIONS: usize = 4;

/// Tauri event channel for session telemetry (contract §5).
const AGENT_EVENT: &str = "agent://event";

// ── Wire types (camelCase, mirrored 1:1 in src/store/sessions.ts) ──────

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Working,
    Waiting,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AgentEventKind {
    Status,
    Tool,
    Text,
    Usage,
    Exit,
    Error,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// input + output + cache_creation + cache_read, as reported by the CLI.
    pub total_tokens: u64,
    /// RESERVED — always `None` in Block F (contract §12 D7): the CLI does
    /// not report a window size and Cowtext will not invent one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    /// `total_cost_usd` from the terminal `result` line (N5), as reported by
    /// the CLI — this is the conversation's running total, not a per-turn
    /// delta. Deliberately `number | null` on the wire (no
    /// `skip_serializing_if`, unlike `context_window`): the frontend must be
    /// able to distinguish "this CLI build doesn't report cost" (`null`)
    /// from "cost is zero", and an omitted key collapses that distinction on
    /// the TS side (`undefined` vs `null` both read as "absent" through
    /// `?.`). `None` when the result line carries no `total_cost_usd` field —
    /// tolerated, never fatal.
    pub cost_usd: Option<f64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: String,
    pub kind: AgentEventKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SessionStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    pub ts: u64,
}

/// Wire shape, mirrored 1:1 in `src/sessions/api.ts`.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub agent_file_name: Option<String>,
    pub cwd: String,
    pub root: String,
    pub alive: bool,
    pub claude_session_id: Option<String>,
}

// ── Registry ─────────────────────────────────────────────────────────

struct SessionEntry {
    info: SessionInfo,
    busy: bool,
    /// pid of the turn child currently running, for tree-kill. None between turns.
    child_pid: Option<u32>,
    /// Bumped on kill/restart; a turn task whose captured generation is
    /// stale stops mutating the registry and stops emitting.
    generation: u64,
    /// Kept for restart-without-a-captured-session-id.
    boot_prompt: String,
}

/// AppHandle-free half of the registry: the guardrails and bookkeeping
/// (contract §3, §6.1) that unit tests exercise directly. Kept as a
/// separate type from [`SessionRegistry`] — rather than a field tests reach
/// through `SessionRegistry::default()` — because on this toolchain merely
/// materializing a `tauri::AppHandle`-typed value (even `None`, even never
/// read) inside `#[cfg(test)]`-compiled code crashes the whole test binary
/// at load time (`STATUS_ENTRYPOINT_NOT_FOUND`, a pre-existing duplicate
/// `windows-*` crate version hazard in the dependency graph — reproduced
/// against an unrelated, previously-passing test file, not something this
/// module's logic can fix without touching `Cargo.lock`, which is out of
/// scope). Tests therefore only ever construct `RegistryCore`, never
/// `SessionRegistry`.
#[derive(Default)]
struct RegistryCore {
    inner: Arc<Mutex<HashMap<String, SessionEntry>>>,
    next: AtomicU64,
}

impl RegistryCore {
    /// Registers a new session under the guardrails (§3): duplicate alive
    /// cwd, `MAX_SESSIONS`. `check` is the caller's already-computed
    /// `worktree_check(cwd)` — passed in rather than recomputed here so the
    /// guardrails are unit-testable without a git fixture. `Err` never
    /// mutates the registry. Returns the registered info, the boot prompt
    /// for the first turn, and a non-fatal "agent file could not be read"
    /// message when applicable.
    fn register(
        &self,
        check: &WorktreeInfo,
        root: String,
        agent_file_name: Option<String>,
        name: String,
    ) -> Result<(SessionInfo, String, Option<String>), String> {
        if !check.is_repo {
            return Err(format!("{} is not a git repository", check.path));
        }
        let name_trimmed = name.trim();
        if name_trimmed.is_empty() {
            return Err("Name is required".to_string());
        }
        let key = cwd_dup_key(&check.path);

        {
            let guard = self
                .inner
                .lock()
                .map_err(|_| "session registry lock poisoned".to_string())?;
            let alive = guard.values().filter(|e| e.info.alive).count();
            if alive >= MAX_SESSIONS {
                return Err(format!("agent limit reached ({MAX_SESSIONS})"));
            }
            for entry in guard.values() {
                if entry.info.alive && cwd_dup_key(&entry.info.cwd) == key {
                    return Err("another agent is already running in that folder".to_string());
                }
            }
        }

        let (boot_prompt, agent_file_error) =
            build_boot_prompt(&root, agent_file_name.as_deref(), name_trimmed, &check.path);
        let id = format!("as{}", self.next.fetch_add(1, Ordering::Relaxed));
        let info = SessionInfo {
            id: id.clone(),
            name: name_trimmed.to_string(),
            agent_file_name,
            cwd: check.path.clone(),
            root,
            alive: true,
            claude_session_id: None,
        };
        let entry = SessionEntry {
            info: info.clone(),
            busy: true, // the boot turn starts immediately after registration
            child_pid: None,
            generation: 0,
            boot_prompt: boot_prompt.clone(),
        };
        {
            let mut guard = self
                .inner
                .lock()
                .map_err(|_| "session registry lock poisoned".to_string())?;
            guard.insert(id, entry);
        }
        Ok((info, boot_prompt, agent_file_error))
    }

    /// Validates + marks busy synchronously so two near-simultaneous
    /// `send`s can't both pass the busy check (§4.1). `Err` never mutates.
    fn begin_send(&self, id: &str) -> Result<(String, Option<String>, u64), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "session registry lock poisoned".to_string())?;
        let entry = guard
            .get_mut(id)
            .ok_or_else(|| "no such agent session".to_string())?;
        if !entry.info.alive {
            return Err("that agent session has exited".to_string());
        }
        if entry.busy {
            return Err("agent is busy".to_string());
        }
        entry.busy = true;
        Ok((entry.info.cwd.clone(), entry.info.claude_session_id.clone(), entry.generation))
    }

    /// Marks the session dead, bumps its generation (stops any in-flight
    /// turn from mutating/emitting further), and returns its last child pid
    /// (if any) to kill. Idempotent: an already-dead session returns
    /// `Ok(None)` without touching anything.
    fn begin_kill(&self, id: &str) -> Result<Option<u32>, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "session registry lock poisoned".to_string())?;
        let entry = guard
            .get_mut(id)
            .ok_or_else(|| "no such agent session".to_string())?;
        if !entry.info.alive {
            return Ok(None);
        }
        entry.generation += 1;
        entry.info.alive = false;
        entry.busy = false;
        Ok(entry.child_pid.take())
    }

    /// Bumps generation (stopping a still-running turn), marks alive+busy,
    /// and returns everything needed to start the resume-or-boot turn.
    fn begin_restart(&self, id: &str) -> Result<(SessionInfo, Option<u32>, String, u64), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "session registry lock poisoned".to_string())?;
        let entry = guard
            .get_mut(id)
            .ok_or_else(|| "no such agent session".to_string())?;
        let pid = entry.child_pid.take();
        entry.generation += 1;
        entry.info.alive = true;
        entry.busy = true;
        let prompt = match &entry.info.claude_session_id {
            Some(_) => RESTART_PROMPT.to_string(),
            None => entry.boot_prompt.clone(),
        };
        Ok((entry.info.clone(), pid, prompt, entry.generation))
    }

    /// Every registered session, alive or not, in registration order (the
    /// numeric suffix of `as<N>` is monotonic, so sorting on it recovers
    /// registration order without a separate ordered-index field).
    fn list(&self) -> Vec<SessionInfo> {
        let Ok(guard) = self.inner.lock() else {
            return Vec::new();
        };
        let mut items: Vec<SessionInfo> = guard.values().map(|e| e.info.clone()).collect();
        items.sort_by_key(|info| session_ordinal(&info.id));
        items
    }
}

/// Managed Tauri state (`app.manage(SessionRegistry::default())`).
#[derive(Default)]
pub struct SessionRegistry {
    core: RegistryCore,
    /// Stashed on the first command that has one (`spawn`/`restart`) so
    /// `send`/`kill` — whose frozen signatures carry no `AppHandle` — can
    /// still emit `agent://event`.
    app: OnceLock<AppHandle>,
}

fn session_ordinal(id: &str) -> u64 {
    id.strip_prefix("as").and_then(|s| s.parse::<u64>().ok()).unwrap_or(0)
}

/// Dup-cwd comparison key over an already-canonicalized forward-slash path
/// (contract §3): case-insensitive on Windows, case-sensitive elsewhere.
fn cwd_dup_key(canonical_forward_path: &str) -> String {
    #[cfg(windows)]
    {
        canonical_forward_path.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        canonical_forward_path.to_string()
    }
}

/// The agent file name must be a single path component: no `/`, `\`, or
/// `..` (contract §6.3's path-escape guard — `resolve_within_root` alone
/// accepts multi-component relative paths, which is too permissive here).
fn valid_agent_file_component(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && name != ".." && name != "."
}

fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Builds the boot prompt (contract §6.3). Returns the prompt plus a
/// non-fatal "agent file could not be read" message to emit once the
/// session is registered — an unreadable/invalid agent file never blocks
/// the boot turn.
fn build_boot_prompt(
    root: &str,
    agent_file_name: Option<&str>,
    name: &str,
    cwd: &str,
) -> (String, Option<String>) {
    let head = BOOT_PROMPT_HEAD.replace("{name}", name).replace("{cwd}", cwd);
    let mut middle = String::new();
    let mut error = None;
    if let Some(file_name) = agent_file_name {
        if valid_agent_file_component(file_name) {
            let root_path = PathBuf::from(root);
            let rel = format!(".claude/agents/{file_name}");
            let read = crate::project::resolve_within_root(&root_path, &rel)
                .and_then(|p| fs::read_to_string(&p).map_err(|e| e.to_string()));
            match read {
                Ok(content) => {
                    let truncated = truncate_at_char_boundary(&content, AGENT_FILE_MAX_BYTES);
                    middle = format!("\n\nYour role definition follows:\n{truncated}");
                }
                Err(_) => error = Some(format!("agent file {file_name} could not be read")),
            }
        } else {
            error = Some(format!("agent file {file_name} could not be read"));
        }
    }
    let prompt = format!("{head}{middle}\n\n{BOOT_PROMPT_TAIL}");
    (prompt, error)
}

// ── stream-json -> agent://event mapping (contract §5.1, pure) ────────

/// Result of mapping one stdout line. Pure and side-effect-free — the
/// caller ([`run_turn`]) is responsible for applying `claude_session_id`
/// (first non-empty wins — only set if not already known) and clearing
/// `busy` when `turn_ended`.
struct MappedLine {
    events: Vec<AgentEvent>,
    claude_session_id: Option<String>,
    turn_ended: bool,
}

fn text_event(id: &str, text: String, ts: u64) -> AgentEvent {
    AgentEvent { id: id.to_string(), kind: AgentEventKind::Text, status: None, tool: None, text: Some(text), usage: None, ts }
}

fn status_event(id: &str, status: SessionStatus, ts: u64) -> AgentEvent {
    AgentEvent { id: id.to_string(), kind: AgentEventKind::Status, status: Some(status), tool: None, text: None, usage: None, ts }
}

/// `inputTokens = input_tokens`, `outputTokens = output_tokens`,
/// `totalTokens = input + output + cache_creation + cache_read` (each
/// missing field reads as 0). `None` when the total is zero (contract
/// §5.1's "only if U has a non-zero total") — unchanged by N5; `cost_usd` is
/// threaded through separately (it lives on the `result` line itself, not
/// inside the nested `usage` object) and is simply carried along when a
/// `Usage` is emitted at all.
fn map_usage(usage: &serde_json::Value, cost_usd: Option<f64>) -> Option<Usage> {
    let get = |k: &str| usage.get(k).and_then(serde_json::Value::as_u64).unwrap_or(0);
    let input = get("input_tokens");
    let output = get("output_tokens");
    let total = input + output + get("cache_creation_input_tokens") + get("cache_read_input_tokens");
    if total == 0 {
        return None;
    }
    Some(Usage { input_tokens: input, output_tokens: output, total_tokens: total, context_window: None, cost_usd })
}

/// Every stdout line -> zero or more `AgentEvent`s (contract §5.1, byte-exact
/// table). Field lookups are all tolerant (`.get(..).and_then(..)`); a
/// missing field never panics and never drops the rest of the line. A line
/// that is not JSON at all becomes `kind:"text"` verbatim.
fn map_line(id: &str, line: &str, ts: u64) -> MappedLine {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            return MappedLine {
                events: vec![text_event(id, trimmed.to_string(), ts)],
                claude_session_id: None,
                turn_ended: false,
            };
        }
    };

    let mut events = Vec::new();
    let mut claude_session_id = None;
    let mut turn_ended = false;

    let type_ = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match type_ {
        "system" => {
            let subtype = value.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
            if subtype == "init" {
                events.push(status_event(id, SessionStatus::Working, ts));
                let sid = value.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
                if !sid.is_empty() {
                    claude_session_id = Some(sid.to_string());
                }
            }
            // Other subtypes: ignored.
        }
        "assistant" => {
            if let Some(message) = value.get("message") {
                if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                    for block in content {
                        match block.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                            "text" => {
                                let text = block.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
                                if !text.is_empty() {
                                    events.push(text_event(id, text.to_string(), ts));
                                }
                            }
                            "tool_use" => {
                                let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                events.push(AgentEvent {
                                    id: id.to_string(),
                                    kind: AgentEventKind::Tool,
                                    status: Some(SessionStatus::Working),
                                    tool: Some(name.to_string()),
                                    text: None,
                                    usage: None,
                                    ts,
                                });
                            }
                            _ => {}
                        }
                    }
                }
                // NOT mapped to a `kind:"usage"` event, deliberately (defect
                // fix, live-CLI-verified against a throwaway git worktree
                // with `claude -p --output-format stream-json --verbose`):
                // for a single logical turn the CLI emits a non-zero `usage`
                // block on BOTH this streamed `assistant` message AND the
                // terminal `result` line — two different snapshots, not
                // duplicates of each other. store/sessions.ts sums every
                // `usage` event and increments `turns` by one per event, so
                // mapping both would double-count tokens and turns for one
                // turn. The `result` line's usage (below) is the turn's
                // authoritative total, so only it is mapped. Amends contract
                // §5.1 row `{"type":"assistant","message":{"usage":U}}`
                // (frozen table said to map it) — an amendment record
                // (D4a-style) is owed on `docs/design/WO01_BLOCK_F_CONTRACT.md`,
                // outside this lane's zone.
            }
        }
        "user" => {
            // tool_result content: ignored (no event); "currentTool = None"
            // is a frontend-store concern (applyEvent), not Rust state.
        }
        "result" => {
            turn_ended = true;
            let subtype = value.get("subtype").and_then(|v| v.as_str()).unwrap_or("");
            let is_error = value.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
            if subtype == "success" && !is_error {
                let result_text = value.get("result").and_then(|v| v.as_str()).unwrap_or("");
                if !result_text.is_empty() {
                    events.push(text_event(id, result_text.to_string(), ts));
                }
                // N5: `total_cost_usd` lives on the `result` line itself, a
                // sibling of `usage`, not nested inside it — read it here and
                // thread it into `map_usage` so the emitted `Usage` carries
                // both. Absent field -> `None` -> wire `null`, tolerated.
                let cost_usd = value.get("total_cost_usd").and_then(serde_json::Value::as_f64);
                if let Some(usage) = value.get("usage").and_then(|u| map_usage(u, cost_usd)) {
                    events.push(AgentEvent { id: id.to_string(), kind: AgentEventKind::Usage, status: None, tool: None, text: None, usage: Some(usage), ts });
                }
                events.push(status_event(id, SessionStatus::Idle, ts));
            } else {
                let detail = value
                    .get("result")
                    .and_then(|v| v.as_str())
                    .or_else(|| value.get("error").and_then(|v| v.as_str()))
                    .unwrap_or("");
                let text = if detail.is_empty() { subtype.to_string() } else { format!("{subtype}: {detail}") };
                events.push(AgentEvent { id: id.to_string(), kind: AgentEventKind::Error, status: None, tool: None, text: Some(text), usage: None, ts });
                events.push(status_event(id, SessionStatus::Waiting, ts));
            }
        }
        // "stream_event" / content_block_delta / anything else: ignored.
        _ => {}
    }

    MappedLine { events, claude_session_id, turn_ended }
}

// ── Binary resolution + CLI probe ──────────────────────────────────────

static SESSION_CLAUDE_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Resolve the claude binary exactly as `assemble.rs` does: settings
/// override first, then the cached `where`/`which` probe. Both live in
/// `assemble.rs` (§10.1's visibility-only exception) — never reimplemented
/// here, so there is only ever one copy of the Windows `.cmd`/`.exe` rules.
fn claude_program() -> Option<PathBuf> {
    crate::assemble::claude_override()
        .or_else(|| SESSION_CLAUDE_PATH.get_or_init(crate::assemble::resolve_claude).clone())
}

static PROBE_RESULT: OnceLock<Result<(), String>> = OnceLock::new();

/// Cached `claude --help` probe (§2.1), run lazily inside [`run_turn`]
/// before the first turn's spawn — never at app start. Failing to even run
/// the probe is optimistic (`Ok`): a missing `--help` must not block a
/// working binary; the spawn error is the real diagnosis in that case.
async fn probe_cli() -> Result<(), String> {
    if let Some(cached) = PROBE_RESULT.get() {
        return cached.clone();
    }
    let result = run_probe().await;
    let _ = PROBE_RESULT.set(result.clone());
    result
}

fn new_claude_command() -> tokio::process::Command {
    match claude_program() {
        Some(path) => tokio::process::Command::new(path),
        None => {
            #[cfg(windows)]
            {
                let mut c = tokio::process::Command::new("cmd");
                c.arg("/C").arg("claude");
                c
            }
            #[cfg(not(windows))]
            {
                tokio::process::Command::new("claude")
            }
        }
    }
}

async fn run_probe() -> Result<(), String> {
    let mut cmd = new_claude_command();
    cmd.arg("--help")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — inherent on tokio::process::Command
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };
    match tokio::time::timeout(std::time::Duration::from_secs(10), child.wait_with_output()).await {
        Ok(Ok(output)) => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            check_help_output(&combined)
        }
        _ => Ok(()),
    }
}

/// Pure check over `claude --help` text — factored out so it is unit
/// testable without spawning a process.
fn check_help_output(help_text: &str) -> Result<(), String> {
    for flag in REQUIRED_FLAGS {
        if !help_text.contains(flag) {
            return Err(missing_flag_message(flag));
        }
    }
    if !help_text.contains(REQUIRED_FORMAT) {
        return Err(missing_flag_message(REQUIRED_FORMAT));
    }
    Ok(())
}

fn missing_flag_message(flag: &str) -> String {
    format!(
        "this claude CLI does not advertise {flag} — Cowtext agent sessions need \
         `claude -p --output-format stream-json --verbose`; update Claude Code or set an \
         explicit binary in Settings"
    )
}

// ── Turn execution — the one chokepoint (contract §6.2) ────────────────

type Registry = Arc<Mutex<HashMap<String, SessionEntry>>>;

/// True iff `id`'s entry still exists and its live `generation` still
/// matches the one a turn captured at spawn time — the single generation-gate
/// check every mutation/emit inside a turn is built on (contract §6.2 step 7,
/// extended to also gate the child spawn itself, see [`run_turn`]'s
/// probe-race defect fix).
fn generation_current(inner: &Registry, id: &str, generation: u64) -> bool {
    inner.lock().ok().and_then(|g| g.get(id).map(|e| e.generation)) == Some(generation)
}

fn emit_gated(app: &AppHandle, inner: &Registry, id: &str, generation: u64, event: AgentEvent) {
    if !generation_current(inner, id, generation) {
        return;
    }
    let _ = app.emit(AGENT_EVENT, &event);
}

fn clamp_tail(t: &mut String) {
    let chars: Vec<char> = t.chars().collect();
    if chars.len() > 200 {
        let start = chars.len() - 200;
        *t = chars[start..].iter().collect();
    }
}

/// Clears `busy`/`child_pid` (gated on `generation`) and, when `error_msg`
/// is set, emits the exit-path `error` then `status:"waiting"` pair
/// (contract §5.1's abnormal-exit rows).
fn finish_turn(app: &AppHandle, inner: &Registry, id: &str, generation: u64, error_msg: Option<String>) {
    let matched = {
        let mut guard = match inner.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        match guard.get_mut(id) {
            Some(entry) if entry.generation == generation => {
                entry.busy = false;
                entry.child_pid = None;
                true
            }
            _ => false,
        }
    };
    if !matched {
        return;
    }
    if let Some(msg) = error_msg {
        let ts = now_millis();
        let _ = app.emit(AGENT_EVENT, &AgentEvent { id: id.to_string(), kind: AgentEventKind::Error, status: None, tool: None, text: Some(msg), usage: None, ts });
        let _ = app.emit(AGENT_EVENT, &AgentEvent { id: id.to_string(), kind: AgentEventKind::Status, status: Some(SessionStatus::Waiting), tool: None, text: None, usage: None, ts });
    }
}

/// The one chokepoint every turn (boot, send, restart) runs through (§2.3 —
/// the seam a future interactive/PTY channel would sit behind instead of
/// duplicating). Never blocks its caller: always invoked via
/// `tauri::async_runtime::spawn`.
async fn run_turn(
    app: AppHandle,
    inner: Registry,
    id: String,
    cwd: String,
    prompt: String,
    resume_session: Option<String>,
    generation: u64,
) {
    if let Err(probe_err) = probe_cli().await {
        finish_turn(&app, &inner, &id, generation, Some(probe_err));
        return;
    }

    // Defect fix: `probe_cli().await` above is the only await point before
    // `child.id()` is captured into the registry below, and — being the
    // process-wide, once-ever cached probe (`PROBE_RESULT`) — it is only a
    // meaningful window on the very first agent turn of the app's lifetime
    // (up to the probe's own spawn+`--help` round trip, or its full 10 s
    // timeout on a slow/hung binary). A `kill`/`restart` landing in that
    // window bumps `generation` and returns before any `child_pid` was ever
    // recorded, so `kill_tree` is never invoked for it; without this check
    // this task would still go on to spawn the real `claude` child, whose
    // pid then fails the generation-gate below and is silently never
    // recorded — an untracked, unkillable orphan (the exact class of bug
    // T10/acceptance-gate-8 exists to prevent). Bail out here instead:
    // nothing has been spawned yet, so there is nothing to clean up.
    if !generation_current(&inner, &id, generation) {
        return;
    }

    let program = claude_program();
    let mut cmd = new_claude_command();
    for a in HEADLESS_ARGS {
        cmd.arg(a);
    }
    if let Some(sid) = &resume_session {
        cmd.arg(RESUME_FLAG).arg(sid);
    }
    cmd.current_dir(&cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — inherent on tokio::process::Command
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        // A dedicated process group so `kill -TERM -<pid>` (§6.5) reaches
        // the whole claude -> node subtree, not just the direct child.
        cmd.process_group(0);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = match &program {
                Some(p) => format!("failed to spawn claude ({}): {e}", p.display()),
                None => format!("failed to spawn claude: {e}"),
            };
            finish_turn(&app, &inner, &id, generation, Some(msg));
            return;
        }
    };

    if let Some(pid) = child.id() {
        if let Ok(mut guard) = inner.lock() {
            if let Some(entry) = guard.get_mut(&id) {
                if entry.generation == generation {
                    entry.child_pid = Some(pid);
                }
            }
        }
    }

    // Prompt over stdin from a separate task, then shutdown stdin — same
    // deadlock-avoidance rationale as assemble.rs's ClaudeRunner: a prompt
    // larger than the pipe buffer must never block against a full stdout
    // pipe this task is concurrently draining.
    let writer = child.stdin.take().map(|mut stdin| {
        let p = prompt.clone();
        tauri::async_runtime::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(p.as_bytes()).await;
            let _ = stdin.shutdown().await;
        })
    });

    let stderr_tail_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr_task = child.stderr.take().map(|stderr| {
        let tail = stderr_tail_buf.clone();
        tauri::async_runtime::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut t) = tail.lock() {
                    if !t.is_empty() {
                        t.push(' ');
                    }
                    t.push_str(line.trim());
                    clamp_tail(&mut t);
                }
            }
        })
    });

    let mut saw_result = false;
    if let Some(stdout) = child.stdout.take() {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let ts = now_millis();
            let mapped = map_line(&id, &line, ts);
            if mapped.turn_ended {
                saw_result = true;
            }
            if let Some(sid) = mapped.claude_session_id {
                if let Ok(mut guard) = inner.lock() {
                    if let Some(entry) = guard.get_mut(&id) {
                        if entry.generation == generation && entry.info.claude_session_id.is_none() {
                            entry.info.claude_session_id = Some(sid);
                        }
                    }
                }
            }
            for ev in mapped.events {
                emit_gated(&app, &inner, &id, generation, ev);
            }
        }
    }

    let status = child.wait().await.ok();
    if let Some(w) = writer {
        let _ = w.await;
    }
    if let Some(t) = stderr_task {
        let _ = t.await;
    }

    let success = status.as_ref().map(std::process::ExitStatus::success).unwrap_or(false);
    let error_msg = if success && saw_result {
        None
    } else {
        let code_desc = status
            .as_ref()
            .and_then(std::process::ExitStatus::code)
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".to_string());
        let tail = stderr_tail_buf.lock().map(|t| t.clone()).unwrap_or_default();
        Some(if tail.is_empty() { format!("claude exited ({code_desc})") } else { format!("claude exited ({code_desc}): {tail}") })
    };

    finish_turn(&app, &inner, &id, generation, error_msg);
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ── Killing the process tree (contract §6.5) ────────────────────────────

#[cfg(windows)]
fn taskkill_attempts(pid: u32) -> Vec<Vec<String>> {
    vec![
        vec!["/PID".to_string(), pid.to_string(), "/T".to_string(), "/F".to_string()],
        vec!["/PID".to_string(), pid.to_string(), "/F".to_string()],
    ]
}

/// Process-tree kill: `taskkill /PID <pid> /T /F` first, then a direct
/// (non-tree) `taskkill /PID <pid> /F` as a belt-and-braces fallback. The
/// fallback is scoped to the recorded pid rather than a `Child` handle's own
/// `start_kill()` because the `Child` lives inside the `run_turn` task, not
/// in the `agent_session_kill` command; killing by pid achieves the same
/// "never a silent partial kill" guarantee documented in the contract.
#[cfg(windows)]
pub(crate) async fn kill_tree(pid: u32) -> Result<(), String> {
    for attempt in taskkill_attempts(pid) {
        if run_taskkill_async(&attempt).await {
            return Ok(());
        }
    }
    Err(format!("failed to kill process tree for pid {pid}"))
}

#[cfg(windows)]
async fn run_taskkill_async(args: &[String]) -> bool {
    let mut cmd = tokio::process::Command::new("taskkill");
    cmd.args(args)
        .creation_flags(0x0800_0000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    match tokio::time::timeout(std::time::Duration::from_secs(5), cmd.output()).await {
        Ok(Ok(out)) => out.status.success(),
        _ => false,
    }
}

#[cfg(windows)]
fn kill_tree_blocking(pid: u32) {
    use std::os::windows::process::CommandExt;
    for attempt in taskkill_attempts(pid) {
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(&attempt).creation_flags(0x0800_0000);
        if cmd.output().map(|o| o.status.success()).unwrap_or(false) {
            return;
        }
    }
}

#[cfg(not(windows))]
fn kill_attempts(pid: u32) -> Vec<Vec<String>> {
    vec![vec!["-TERM".to_string(), format!("-{pid}")], vec!["-KILL".to_string(), pid.to_string()]]
}

/// Process-tree kill: SIGTERM to the whole process group (negative pid —
/// `run_turn` spawns with `process_group(0)`), then a direct `kill -KILL
/// <pid>` as a fallback. Same pid-scoped-fallback rationale as the Windows
/// path above.
#[cfg(not(windows))]
pub(crate) async fn kill_tree(pid: u32) -> Result<(), String> {
    for attempt in kill_attempts(pid) {
        if run_kill_async(&attempt).await {
            return Ok(());
        }
    }
    Err(format!("failed to kill process tree for pid {pid}"))
}

#[cfg(not(windows))]
async fn run_kill_async(args: &[String]) -> bool {
    let mut cmd = tokio::process::Command::new("kill");
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    match tokio::time::timeout(std::time::Duration::from_secs(5), cmd.output()).await {
        Ok(Ok(out)) => out.status.success(),
        _ => false,
    }
}

#[cfg(not(windows))]
fn kill_tree_blocking(pid: u32) {
    for attempt in kill_attempts(pid) {
        let mut cmd = std::process::Command::new("kill");
        cmd.args(&attempt);
        if cmd.output().map(|o| o.status.success()).unwrap_or(false) {
            return;
        }
    }
}

/// Best-effort kill of every alive session's process tree, for app exit
/// (§6.6). Synchronous/blocking (no reliance on the tokio runtime still
/// being pumped) so it completes before the exit handler returns, rather
/// than racing process shutdown as a fire-and-forget spawned task would.
pub fn kill_all(registry: &SessionRegistry) {
    let pids: Vec<u32> = {
        let Ok(guard) = registry.core.inner.lock() else { return };
        guard.values().filter(|e| e.info.alive).filter_map(|e| e.child_pid).collect()
    };
    for pid in pids {
        kill_tree_blocking(pid);
    }
}

// ── Commands (contract §4) ──────────────────────────────────────────────

#[tauri::command]
pub async fn agent_session_spawn(
    app: AppHandle,
    state: State<'_, SessionRegistry>,
    root: String,
    agent_file_name: Option<String>,
    name: String,
    cwd: String,
) -> Result<SessionInfo, String> {
    let _ = state.app.set(app.clone());
    let check = crate::worktree::worktree_check(cwd)?;
    let (info, boot_prompt, agent_file_error) = state.core.register(&check, root, agent_file_name, name)?;

    if let Some(err) = agent_file_error {
        let ts = now_millis();
        let _ = app.emit(AGENT_EVENT, &AgentEvent { id: info.id.clone(), kind: AgentEventKind::Error, status: None, tool: None, text: Some(err), usage: None, ts });
    }

    let inner = state.core.inner.clone();
    let app2 = app.clone();
    let id2 = info.id.clone();
    let cwd2 = info.cwd.clone();
    tauri::async_runtime::spawn(async move {
        run_turn(app2, inner, id2, cwd2, boot_prompt, None, 0).await;
    });

    Ok(info)
}

#[tauri::command]
pub async fn agent_session_send(state: State<'_, SessionRegistry>, id: String, prompt: String) -> Result<(), String> {
    let (cwd, resume_id, generation) = state.core.begin_send(&id)?;
    let app = state.app.get().cloned().ok_or_else(|| "no such agent session".to_string())?;
    let inner = state.core.inner.clone();
    tauri::async_runtime::spawn(async move {
        run_turn(app, inner, id, cwd, prompt, resume_id, generation).await;
    });
    Ok(())
}

#[tauri::command]
pub async fn agent_session_kill(state: State<'_, SessionRegistry>, id: String) -> Result<(), String> {
    let pid = state.core.begin_kill(&id)?;
    let app = state.app.get().cloned();
    if let Some(pid) = pid {
        if let Err(kill_err) = kill_tree(pid).await {
            if let Some(app) = &app {
                let ts = now_millis();
                let _ = app.emit(AGENT_EVENT, &AgentEvent { id: id.clone(), kind: AgentEventKind::Error, status: None, tool: None, text: Some(kill_err), usage: None, ts });
            }
        }
    }
    if let Some(app) = &app {
        let ts = now_millis();
        let _ = app.emit(AGENT_EVENT, &AgentEvent { id, kind: AgentEventKind::Exit, status: None, tool: None, text: Some("killed".to_string()), usage: None, ts });
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_session_restart(app: AppHandle, state: State<'_, SessionRegistry>, id: String) -> Result<SessionInfo, String> {
    let _ = state.app.set(app.clone());
    let (info, pid, prompt, generation) = state.core.begin_restart(&id)?;
    if let Some(pid) = pid {
        let _ = kill_tree(pid).await; // best-effort; restart proceeds regardless
    }
    let resume_id = info.claude_session_id.clone();
    let inner = state.core.inner.clone();
    let app2 = app.clone();
    let id2 = info.id.clone();
    let cwd2 = info.cwd.clone();
    tauri::async_runtime::spawn(async move {
        run_turn(app2, inner, id2, cwd2, prompt, resume_id, generation).await;
    });
    Ok(info)
}

#[tauri::command]
pub fn agent_session_list(state: State<'_, SessionRegistry>) -> Result<Vec<SessionInfo>, String> {
    Ok(state.core.list())
}
