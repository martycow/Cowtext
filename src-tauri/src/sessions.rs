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
// F2: the marker convention `map_line`'s "result" branch scans for
// (`find_cowtext_ask`). Appended as its own sentence — the rest of the tail
// is unchanged so every existing `build_boot_prompt` assertion on its
// original wording still holds.
const BOOT_PROMPT_TAIL: &str = "Reply with ONE short line confirming you are ready. \
Do not modify any file until you are asked to. If you need a decision from the user \
before you can continue, end your reply with a line of the form `COWTEXT_ASK: <your question>`.";
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
    /// WO06 §5.4: a token-ceiling hard-stop. Emitted UNGATED (see
    /// `charge`/`Stop`) — no other field on `AgentEvent` changes shape.
    Budget,
    /// F2: the agent ended its reply with a `COWTEXT_ASK: <question>` line
    /// (see `BOOT_PROMPT_TAIL` and `find_cowtext_ask`) — surfaced by the
    /// frontend as a reply-prompt popup. Appended last, never reordered: the
    /// TS `AgentEventKind` union mirrors this enum positionally.
    Question,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// `input + output + cache_creation` — every context token counted
    /// EXACTLY ONCE, on the turn that first sent it. `cache_read` is
    /// deliberately excluded (WO16): it is the same prompt re-presented from
    /// cache on every later turn, so including it made the running total
    /// (and therefore the token ceiling) a function of context size × turn
    /// count. A live session boot turn alone reported ≈48k that way, and a
    /// 60k ceiling stopped the session before its first real instruction;
    /// the 200k default died after ~5 turns of an unchanged conversation.
    /// The tokens themselves are still reported — see `cache_read_tokens`.
    pub total_tokens: u64,
    /// `cache_read_input_tokens` as reported by the CLI: prompt tokens served
    /// from cache this turn. Reported for transparency (the panel shows it)
    /// but NOT part of `total_tokens`, so it never charges the ceiling twice
    /// for the same context. Billed by the API at a fraction of input price.
    pub cache_read_tokens: u64,
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
    // WO06 §5.2 (appended last, §9.3 seam): the folded total across finished
    // turns (and, on a budget `Stop`, the spend at the moment of the stop —
    // see `charge`). `token_ceiling` is the effective, already-normalized
    // ceiling (`Some(0)` from the caller reads as `None`, contract §5.1).
    pub tokens_used: u64,
    pub token_ceiling: Option<u64>,
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
    /// WO06 §5.2: folded total across finished turns. Folded in by
    /// `end_turn` (normal end of turn) or by `charge`'s `Stop` branch
    /// (budget hard-stop, which never runs `end_turn`/`finish_turn`).
    tokens_used: u64,
    /// WO06 §5.2: running max of `observed_usage.totalTokens` seen so far
    /// THIS turn (the "named assumption": non-decreasing within a turn).
    /// Reset to 0 whenever a turn ends, by whichever of the two paths above
    /// ends it.
    turn_tokens: u64,
    /// WO06 §5.1: effective per-session ceiling, already normalized so
    /// `Some(0)` from a caller is stored as `None` (unlimited) — `charge`
    /// never has to re-check for zero.
    token_ceiling: Option<u64>,
    /// WO06 §4.3/§5.1: the task this session was spawned for, if any.
    /// Reserved for future task-scoped session queries — no WO06 G3 command
    /// reads it back out (`SessionInfo` does not carry a `taskId`, §8), so
    /// it is write-only within this work order.
    #[allow(dead_code)]
    task_id: Option<String>,
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
    /// cwd, `MAX_SESSIONS`, and (§4.3) a `taskId` with no compiled task
    /// context. `check` is the caller's already-computed
    /// `worktree_check(cwd)` — passed in rather than recomputed here so the
    /// guardrails are unit-testable without a git fixture. `Err` never
    /// mutates the registry. Returns the registered info, the boot prompt
    /// for the first turn, and a non-fatal "agent file could not be read"
    /// message when applicable.
    ///
    /// `token_ceiling` is the already-resolved effective value (WO06 D9:
    /// `agent_session_spawn` folds the explicit per-task choice and the
    /// global default together via `resolve_ceiling` before calling this —
    /// `register` itself knows nothing about settings.rs or the global
    /// default). `None`/`Some(0)` both mean unlimited (contract §5.1) —
    /// normalized to `None` before it is stored.
    #[allow(clippy::too_many_arguments)] // contract §7.1 froze agent_session_spawn's 3 appended params; this is where they land.
    fn register(
        &self,
        check: &WorktreeInfo,
        root: String,
        agent_file_name: Option<String>,
        name: String,
        task_id: Option<String>,
        task_context: Option<String>,
        token_ceiling: Option<u64>,
    ) -> Result<(SessionInfo, String, Option<String>), String> {
        if !check.is_repo {
            return Err(format!("{} is not a git repository", check.path));
        }
        let name_trimmed = name.trim();
        if name_trimmed.is_empty() {
            return Err("Name is required".to_string());
        }
        let task_context_nonempty = task_context.as_deref().map(str::trim).is_some_and(|s| !s.is_empty());
        if task_id.is_some() && !task_context_nonempty {
            return Err(
                "a task session needs a compiled task context — call task_context_preview first"
                    .to_string(),
            );
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

        let (boot_prompt, agent_file_error) = build_boot_prompt(
            &root,
            agent_file_name.as_deref(),
            name_trimmed,
            &check.path,
            task_id.as_deref(),
            task_context.as_deref(),
        );
        let id = format!("as{}", self.next.fetch_add(1, Ordering::Relaxed));
        let effective_ceiling = token_ceiling.filter(|&c| c > 0);
        let info = SessionInfo {
            id: id.clone(),
            name: name_trimmed.to_string(),
            agent_file_name,
            cwd: check.path.clone(),
            root,
            alive: true,
            claude_session_id: None,
            tokens_used: 0,
            token_ceiling: effective_ceiling,
        };
        let entry = SessionEntry {
            info: info.clone(),
            busy: true, // the boot turn starts immediately after registration
            child_pid: None,
            generation: 0,
            boot_prompt: boot_prompt.clone(),
            tokens_used: 0,
            turn_tokens: 0,
            token_ceiling: effective_ceiling,
            task_id,
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
        // §5.5.2: "restart resets tokens_used to 0 — a restart is a new
        // budget." Without this, a session that stopped at/over its ceiling
        // stays stopped forever: the very next `charge` call would see the
        // same stale `spent >= ceiling` and stop it again before a single
        // token of real output, burning a paid turn on every Restart press.
        entry.tokens_used = 0;
        entry.turn_tokens = 0;
        entry.info.tokens_used = 0;
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

/// Builds the boot prompt (contract §6.3, task-context injection §4.3).
/// Returns the prompt plus a non-fatal "agent file could not be read"
/// message to emit once the session is registered — an unreadable/invalid
/// agent file never blocks the boot turn.
///
/// When both `task_id` and `task_context` are present, the already-compiled
/// task context body is inserted after the agent-file body and before
/// [`BOOT_PROMPT_TAIL`], wrapped in a delimited block and truncated at
/// `taskctx::TASK_CONTEXT_MAX_BYTES` (§4.3) — the frontend pre-compiles this
/// body via `task_context_preview`; nothing here calls `compile_preview`
/// itself (that would pull a `compile.rs`/`taskctx.rs` dependency into this
/// HOT file, which the contract's build-order explicitly avoids, §4.3's
/// "Why the frontend pre-compiles" note).
fn build_boot_prompt(
    root: &str,
    agent_file_name: Option<&str>,
    name: &str,
    cwd: &str,
    task_id: Option<&str>,
    task_context: Option<&str>,
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
    let mut task_block = String::new();
    if let (Some(tid), Some(ctx)) = (task_id, task_context) {
        let max_bytes = crate::taskctx::TASK_CONTEXT_MAX_BYTES;
        let truncated = truncate_at_char_boundary(ctx, max_bytes);
        let body = if truncated.len() < ctx.len() {
            format!(
                "{truncated}\n[truncated at {max_bytes} bytes — open the task context in Cowtext for the full text]"
            )
        } else {
            truncated.to_string()
        };
        task_block = format!(
            "\n\n--- BEGIN TASK CONTEXT (Cowtext, task {tid}) ---\n{body}\n--- END TASK CONTEXT ---"
        );
    }
    let prompt = format!("{head}{middle}{task_block}\n\n{BOOT_PROMPT_TAIL}");
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
    /// The last text this line emitted as a `Text` event, for the caller to
    /// feed back as the next line's `prev_text` (WO16). `None` when the line
    /// emitted no text. See [`map_line`]'s `prev_text` for what it is for.
    last_text: Option<String>,
    /// Usage observed on this line, for budget accounting ONLY. Populated from
    /// BOTH the assistant-message usage block and the terminal `result` line.
    /// Never turned into an `agent://event` — the emitted stream is unchanged
    /// (see `map_line_assistant_usage_never_emits_a_usage_event`).
    observed_usage: Option<Usage>,
}

/// Thread [`map_line`]'s `prev_text` across a turn (WO16). The comparand is
/// the last text emitted SO FAR IN THIS TURN, not the previous line's: a line
/// that emits no text of its own (`rate_limit_event`,
/// `system/thinking_tokens`, a tool_use-only assistant message) must carry the
/// existing value through rather than wipe it. Getting that wrong is not
/// theoretical — it shipped for one live run, where only the turns that
/// happened to have no such line in between deduped correctly. Reset at the
/// turn boundary so a later turn never compares against an older turn's text.
fn carry_text(prev: Option<String>, mapped: &MappedLine) -> Option<String> {
    if mapped.turn_ended {
        None
    } else if mapped.last_text.is_some() {
        mapped.last_text.clone()
    } else {
        prev
    }
}

fn text_event(id: &str, text: String, ts: u64) -> AgentEvent {
    AgentEvent { id: id.to_string(), kind: AgentEventKind::Text, status: None, tool: None, text: Some(text), usage: None, ts }
}

fn status_event(id: &str, status: SessionStatus, ts: u64) -> AgentEvent {
    AgentEvent { id: id.to_string(), kind: AgentEventKind::Status, status: Some(status), tool: None, text: None, usage: None, ts }
}

/// F2 marker scan: does `result_text` (the already-extracted `result` line
/// text) contain a `COWTEXT_ASK: <question>` line (per `BOOT_PROMPT_TAIL`'s
/// convention)? Matching is on each line's TRIMMED form via `starts_with`,
/// so leading whitespace before the marker never hides it. Only the FIRST
/// matching line is returned — a later line is prose, not a second
/// question (contract: "Only the FIRST such line in a turn produces a
/// Question event"). The returned text is trimmed of surrounding
/// whitespace only; any other punctuation (e.g. a trailing period) is part
/// of the question and is preserved verbatim. An empty question after
/// trimming is treated as no marker at all.
fn find_cowtext_ask(result_text: &str) -> Option<String> {
    const MARKER: &str = "COWTEXT_ASK:";
    for line in result_text.lines() {
        if let Some(rest) = line.trim().strip_prefix(MARKER) {
            let question = rest.trim();
            if !question.is_empty() {
                return Some(question.to_string());
            }
        }
    }
    None
}

fn question_event(id: &str, text: String, ts: u64) -> AgentEvent {
    AgentEvent { id: id.to_string(), kind: AgentEventKind::Question, status: None, tool: None, text: Some(text), usage: None, ts }
}

/// Formats a token count with thousands separators (`200000` -> `"200,000"`),
/// matching the `budget` event's example text (contract §5.4). No new
/// dependency: plain digit-grouping over the decimal string.
fn format_thousands(n: u64) -> String {
    let digits = n.to_string();
    let bytes = digits.as_bytes();
    let mut out = String::with_capacity(bytes.len() + bytes.len() / 3);
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (bytes.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(*b as char);
    }
    out
}

/// The `budget` event (contract §5.4): emitted UNGATED by `run_turn` — the
/// `Stop` that produced it already bumped the generation inside `charge`'s
/// own lock, so `emit_gated` would silently swallow it. `line_usage` is the
/// `observed_usage` of the line that crossed the ceiling — its
/// `input`/`output`/`cost` breakdown is carried through for fidelity, but
/// `total_tokens` is deliberately `spent` (the accumulated total that
/// crossed `ceiling`), not that one line's own total, since those two only
/// coincide for a single-line turn.
fn budget_event(id: &str, line_usage: Option<&Usage>, spent: u64, ceiling: u64, ts: u64) -> AgentEvent {
    let usage = Usage {
        input_tokens: line_usage.map(|u| u.input_tokens).unwrap_or(0),
        output_tokens: line_usage.map(|u| u.output_tokens).unwrap_or(0),
        total_tokens: spent,
        cache_read_tokens: line_usage.map(|u| u.cache_read_tokens).unwrap_or(0),
        context_window: None,
        cost_usd: line_usage.and_then(|u| u.cost_usd),
    };
    AgentEvent {
        id: id.to_string(),
        kind: AgentEventKind::Budget,
        status: None,
        tool: None,
        text: Some(format!("token ceiling {} reached — session stopped", format_thousands(ceiling))),
        usage: Some(usage),
        ts,
    }
}

/// `inputTokens = input_tokens`, `outputTokens = output_tokens`,
/// `totalTokens = input + output + cache_creation` (each missing field reads
/// as 0). `None` when the total is zero (contract §5.1's "only if U has a
/// non-zero total") — unchanged by N5; `cost_usd` is threaded through
/// separately (it lives on the `result` line itself, not inside the nested
/// `usage` object) and is simply carried along when a `Usage` is emitted at
/// all.
///
/// WO16 — `cache_read_input_tokens` is NO LONGER summed into the total; it
/// is carried alongside it instead. See [`Usage::total_tokens`] for why:
/// re-reading the same cached prompt every turn is not new spend, and
/// charging it per turn is what made token ceilings unusable.
fn map_usage(usage: &serde_json::Value, cost_usd: Option<f64>) -> Option<Usage> {
    let get = |k: &str| usage.get(k).and_then(serde_json::Value::as_u64).unwrap_or(0);
    let input = get("input_tokens");
    let output = get("output_tokens");
    let total = input + output + get("cache_creation_input_tokens");
    if total == 0 {
        return None;
    }
    Some(Usage {
        input_tokens: input,
        output_tokens: output,
        total_tokens: total,
        cache_read_tokens: get("cache_read_input_tokens"),
        context_window: None,
        cost_usd,
    })
}

/// Every stdout line -> zero or more `AgentEvent`s (contract §5.1, byte-exact
/// table). Field lookups are all tolerant (`.get(..).and_then(..)`); a
/// missing field never panics and never drops the rest of the line. A line
/// that is not JSON at all becomes `kind:"text"` verbatim.
///
/// `prev_text` is the last text emitted SO FAR IN THIS TURN — the caller
/// threads it through, carrying it across lines that emit no text of their
/// own (see `run_turn`). It exists for exactly one job (WO16): the
/// CLI streams the final answer as an `assistant` text block AND repeats it
/// verbatim in the terminal `result` line's `result` field, so every turn's
/// answer was appearing twice in the transcript. When the `result` text is
/// byte-identical to the text already emitted, the duplicate `Text` event is
/// suppressed. It is compared, never assumed: a `result` that genuinely
/// differs (or a turn that streamed no assistant text at all) is still
/// emitted, so the transcript can never lose the answer. The `COWTEXT_ASK`
/// scan runs on the `result` text either way — a deduped line must still be
/// able to ask a question.
fn map_line(id: &str, line: &str, ts: u64, prev_text: Option<&str>) -> MappedLine {
    let trimmed = line.trim_end_matches(['\r', '\n']);
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            return MappedLine {
                events: vec![text_event(id, trimmed.to_string(), ts)],
                claude_session_id: None,
                turn_ended: false,
                observed_usage: None,
                last_text: Some(trimmed.to_string()),
            };
        }
    };

    let mut events = Vec::new();
    let mut claude_session_id = None;
    let mut turn_ended = false;
    let mut observed_usage = None;
    let mut last_text: Option<String> = None;

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
                                    last_text = Some(text.to_string());
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
                // WO06 §5.2: read for budget accounting ONLY — never turned
                // into an event (see the comment block below for why the
                // *emitted* stream still ignores this same field).
                if let Some(u) = message.get("usage") {
                    observed_usage = map_usage(u, None);
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
                    // WO16: the CLI repeats the final assistant text verbatim
                    // here, so emitting it unconditionally showed every answer
                    // twice. Compared, never assumed — a `result` that differs
                    // from what streamed (or a turn that streamed no assistant
                    // text) is still emitted.
                    if prev_text != Some(result_text) {
                        events.push(text_event(id, result_text.to_string(), ts));
                    }
                    last_text = Some(result_text.to_string());
                    // F2: an ADDITIONAL event alongside the Text event above
                    // — the transcript stays complete, this never suppresses
                    // or rewrites it. Deliberately OUTSIDE the dedupe: a
                    // suppressed duplicate must still be able to ask.
                    if let Some(question) = find_cowtext_ask(result_text) {
                        events.push(question_event(id, question, ts));
                    }
                }
                // N5: `total_cost_usd` lives on the `result` line itself, a
                // sibling of `usage`, not nested inside it — read it here and
                // thread it into `map_usage` so the emitted `Usage` carries
                // both. Absent field -> `None` -> wire `null`, tolerated.
                let cost_usd = value.get("total_cost_usd").and_then(serde_json::Value::as_f64);
                let result_usage = value.get("usage").and_then(|u| map_usage(u, cost_usd));
                // WO06 §5.2: the terminal result line is the other of the
                // two lines budget accounting reads (the assistant branch
                // above is the first) — carried whether or not it ends up
                // non-`None` below, same tolerance as the emitted event.
                observed_usage = result_usage.clone();
                if let Some(usage) = result_usage {
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

    MappedLine { events, claude_session_id, turn_ended, observed_usage, last_text }
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

/// AppHandle-free end-of-turn bookkeeping (WO06 §5.2): clears `busy`/
/// `child_pid` and folds this turn's accounted usage
/// (`tokens_used += turn_tokens; turn_tokens = 0`) into the running total,
/// gated on `generation` exactly like every other registry mutation inside
/// a turn. Factored out of [`finish_turn`] — which needs a real
/// `AppHandle` and so cannot be exercised directly by `sessions/tests.rs`
/// (see the `RegistryCore` doc comment) — so the fold itself stays
/// unit-testable. Returns whether the entry matched (i.e. whether
/// `finish_turn`'s caller should proceed to emit the abnormal-exit pair).
fn end_turn(inner: &Registry, id: &str, generation: u64) -> bool {
    let mut guard = match inner.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    match guard.get_mut(id) {
        Some(entry) if entry.generation == generation => {
            entry.busy = false;
            entry.child_pid = None;
            entry.tokens_used += entry.turn_tokens;
            entry.turn_tokens = 0;
            entry.info.tokens_used = entry.tokens_used;
            true
        }
        _ => false,
    }
}

/// Clears `busy`/`child_pid`, folds usage (via [`end_turn`]) and, when
/// `error_msg` is set, emits the exit-path `error` then `status:"waiting"`
/// pair (contract §5.1's abnormal-exit rows).
fn finish_turn(app: &AppHandle, inner: &Registry, id: &str, generation: u64, error_msg: Option<String>) {
    if !end_turn(inner, id, generation) {
        return;
    }
    if let Some(msg) = error_msg {
        let ts = now_millis();
        let _ = app.emit(AGENT_EVENT, &AgentEvent { id: id.to_string(), kind: AgentEventKind::Error, status: None, tool: None, text: Some(msg), usage: None, ts });
        let _ = app.emit(AGENT_EVENT, &AgentEvent { id: id.to_string(), kind: AgentEventKind::Status, status: Some(SessionStatus::Waiting), tool: None, text: None, usage: None, ts });
    }
}

/// WO06 §5.3 — the atomic hard-stop primitive. "Atomic" means concretely:
/// the charge, the ceiling comparison, and (on overrun) the generation bump
/// that fences off every later mutation/emit of this turn all happen inside
/// **one** critical section over the registry mutex, so two racing charges
/// from the same turn can never both observe `spent >= ceiling` and both
/// produce a `Stop` — the second always sees the bumped generation and
/// reads `Stale`.
///
/// Implemented as a free function taking `&Registry` — like
/// `generation_current`/`emit_gated`/`end_turn` above — rather than a
/// `&self` method on [`RegistryCore`], for a concrete reason: [`run_turn`]
/// only ever carries the cloned `Registry` handle (never a whole
/// `RegistryCore`, which also carries the spawn-id counter that a turn task
/// has no business touching). A `&self` wrapper would only ever be called
/// from `#[cfg(test)]` code, which is genuine dead code under a plain
/// `cargo clippy -- -D warnings` (no `--all-targets`) build — the exact
/// "infra ahead of its consumer" trap this crate has hit before. This one
/// function is the entire implementation, exercised directly by both
/// `run_turn` and `sessions/tests.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChargeVerdict {
    Ok,
    Stale,
    Stop { pid: Option<u32>, spent: u64, ceiling: u64 },
}

fn charge(inner: &Registry, id: &str, generation: u64, observed_total: u64) -> ChargeVerdict {
    let mut guard = match inner.lock() {
        // A poisoned lock can mutate nothing — `Stale` (not a fourth
        // variant) is the correct read: no charge was recorded, no stop
        // happened, exactly as if this turn had already gone stale.
        Ok(g) => g,
        Err(_) => return ChargeVerdict::Stale,
    };
    let Some(entry) = guard.get_mut(id) else {
        return ChargeVerdict::Stale;
    };
    if entry.generation != generation {
        return ChargeVerdict::Stale;
    }
    entry.turn_tokens = entry.turn_tokens.max(observed_total);
    let spent = entry.tokens_used + entry.turn_tokens;
    let ceiling = match entry.token_ceiling {
        Some(c) if c > 0 => c,
        _ => return ChargeVerdict::Ok,
    };
    if spent < ceiling {
        return ChargeVerdict::Ok;
    }
    // Overrun: the generation bump below is the fence (see doc comment) —
    // every later `generation_current`/`emit_gated`/`end_turn` check for
    // this turn instantly reads stale, so this is the only `Stop` this
    // session's generation can ever produce.
    entry.generation += 1;
    entry.info.alive = false;
    entry.busy = false;
    let pid = entry.child_pid.take();
    // Fold now: `finish_turn`/`end_turn` never run for a budget stop (§5.3
    // step 3 — `run_turn` returns immediately instead), so this is the only
    // place a `Stop`'s spend is folded into the durable, wire-visible total.
    entry.tokens_used = spent;
    entry.turn_tokens = 0;
    entry.info.tokens_used = spent;
    ChargeVerdict::Stop { pid, spent, ceiling }
}

/// WO06 D9 fix: resolves the ceiling [`RegistryCore::register`] should be
/// given from the caller's explicit per-task value (`agent_session_spawn`'s
/// `token_ceiling` argument) and the app-wide global default
/// (`settings::global_token_ceiling`). Three-way, in priority order:
///
/// 1. `explicit = Some(n)`, any `n` including `0` — an explicit choice was
///    made at spawn time and it always wins outright, never falling back
///    to the global default. `Some(0)` is a *deliberate* per-task opt-out
///    to unbounded (`register`'s own normalization then turns that into
///    "unlimited" exactly as it always has, contract §5.1).
/// 2. `explicit = None` — no explicit choice was made; the session
///    inherits `global_default` (itself `0` = unlimited, on the same
///    convention).
///
/// A free function, not a `RegistryCore` method, so it stays testable with
/// two bare `u64`/`Option<u64>` values — no registry, no lock, no
/// `AppHandle` — matching the style of `generation_current`/`emit_gated`
/// above.
fn resolve_ceiling(explicit: Option<u64>, global_default: u64) -> Option<u64> {
    Some(explicit.unwrap_or(global_default))
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
    // WO16 — the previous line's text, so the terminal `result` line can drop
    // its verbatim repeat of the answer that already streamed. Reset at each
    // turn boundary: a later turn's first line must never be compared against
    // the previous turn's last text (harmless today, one process = one turn,
    // but the persistent-session channel would otherwise inherit a stale
    // comparand).
    let mut prev_text: Option<String> = None;
    if let Some(stdout) = child.stdout.take() {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let ts = now_millis();
            let mapped = map_line(&id, &line, ts, prev_text.as_deref());
            prev_text = carry_text(prev_text, &mapped);
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

            // WO06 §5.3: charge before emitting this line's own events — a
            // budget stop preempts the very line that crossed the ceiling
            // (the `budget`+`exit` pair below stands in for it).
            if let Some(usage) = &mapped.observed_usage {
                if let ChargeVerdict::Stop { pid, spent, ceiling } = charge(&inner, &id, generation, usage.total_tokens) {
                    let stop_ts = now_millis();
                    // Ungated: `charge`'s Stop branch already bumped the
                    // generation inside its own lock, so `emit_gated` would
                    // silently swallow both of these (§5.3 step 1).
                    let _ = app.emit(AGENT_EVENT, &budget_event(&id, Some(usage), spent, ceiling, stop_ts));
                    let _ = app.emit(
                        AGENT_EVENT,
                        &AgentEvent { id: id.clone(), kind: AgentEventKind::Exit, status: None, tool: None, text: Some("budget".to_string()), usage: None, ts: stop_ts },
                    );
                    if let Some(pid) = pid {
                        let _ = kill_tree(pid).await;
                    }
                    return; // no finish_turn: generation-gated, would no-op (§5.3 step 3)
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

// WO06 Stage-0 seam (§7.1): the contract freezes this exact nine-parameter
// signature (three params appended for §4.3/§5.1); narrowing it back under
// 8 would mean bundling unrelated args into a struct the contract does not
// specify. Allowed narrowly rather than reshaping a frozen wire contract.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn agent_session_spawn(
    app: AppHandle,
    state: State<'_, SessionRegistry>,
    root: String,
    agent_file_name: Option<String>,
    name: String,
    cwd: String,
    task_id: Option<String>,        // WO06 §4.3 — the task this session is scoped to, if any.
    task_context: Option<String>,   // WO06 §4.3 — already-compiled subgraph body, from `task_context_preview`.
    // WO06 §5.1 / D9 fix — the caller's EXPLICIT per-task choice only.
    // `None` = no explicit choice was made at spawn time, so the session
    // inherits the app-wide global default (`settings::global_token_ceiling`)
    // instead of launching unbounded (WO06_AUDIT.md D9: that inheritance
    // never shipped). `Some(0)` is a deliberate opt-out to unbounded for
    // this one session, regardless of the global default. `Some(n>0)`
    // always wins outright. See `resolve_ceiling`.
    token_ceiling: Option<u64>,
) -> Result<SessionInfo, String> {
    let _ = state.app.set(app.clone());
    let check = crate::worktree::worktree_check(cwd)?;
    // D9: fold in the global default before `register` — `register` itself
    // stays exactly as WO06 shipped it (an already-resolved "effective"
    // ceiling in, `Some(0)`/`None` normalized to "unlimited"), so none of
    // its existing guardrail/normalization tests needed to change.
    let global_default = crate::settings::global_token_ceiling(&app);
    let effective_ceiling = resolve_ceiling(token_ceiling, global_default);
    let (info, boot_prompt, agent_file_error) =
        state.core.register(&check, root, agent_file_name, name, task_id, task_context, effective_ceiling)?;

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
