# WO01 BLOCK F CONTRACT — Phase 7: Agents MVP (T7–T10)

**Status: FROZEN 2026-08-18.** Authored by tech-lead from Work Order 01, Block F
(`docs/INPUT_PROMPT.md` T7–T10 + Guardrails). Once lanes start, nothing in §2–§10 changes
without a ratification note appended to §11.

Verified against the code at `d717dc3` before freezing:
`lib.rs:34` `generate_handler!` lists **43** commands · `lib.rs:23-31` `.setup` manages
`AssembleQueue`, `HandoffRunner`, `WatcherState`, then `settings::init` + `hooks_server::start` ·
`assemble.rs:396` `ClaudeRunner` with `OnceLock` binary resolution, `assemble.rs:416`
`pub(crate) fn where_probe` (`.exe` preferred over `.cmd`), `assemble.rs:481` `-p` +
`--output-format json` with the **prompt piped over stdin** and `creation_flags(0x08000000)`
(CREATE_NO_WINDOW) · `assemble.rs:29` `CLAUDE_OVERRIDE` + `set_claude_override` ·
`hooks_server.rs:78` `app.emit(BARN_EVENT, &event)` emit idiom · `events.ts:169`
`initEventListener` idempotent-wiring idiom · `agents.ts:311` Zustand store idiom
(`busy`/`opError`, `null = success` action returns) · `agents/api.ts` one-file-owns-the-invokes
convention · `identity.ts:101` `calfLook(seed)` · `calf.ts:112` `CAP = 4`, `calf.ts:123`
`CALF_SPOTS` · `hover.ts:184` calves discovered as *leftover* children of `layout.objects` ·
`BarnScene.tsx:107` `resizeTo: host` · `App.tsx:1180-1183`
`<ReviewBanner/> <Workspace/> <EventLog/>` column · `Inspector.tsx:1498` branch order ·
`capabilities/default.json` already grants `dialog:allow-open`.

---

## 1. Scope

Block F only, one fleet run:

1. **T7 Spawn** — "Add agent" picks an agent file (optional), a name and a folder; Rust spawns
   a real Claude Code child in that folder; telemetry flows into the app.
2. **T8 Roster bar** — bottom strip, one card per session: avatar, name, status dot
   (`idle | working | waiting`), current tool while working.
3. **T9 Agent panel** — clicking a card opens a right-panel branch: read-only transcript
   stream, **real** token usage, a Queue prompt box with Send.
4. **T10 Kill / Restart** — Kill terminates the whole child process tree; Restart re-spawns in
   the same worktree, continuing the same Claude conversation.
5. **Barn tie-in (thin)** — one existing calf sprite per live session, placed/despawned with
   the session, hover bubble reports its status. No new animation work.

Out of scope, do not build (Phase 8 / WO scope guard): budgets, steering, multi-provider,
worker pools, cost estimation, an interactive PTY terminal (§2.3), agent-to-graph correlation
(§9.4), any new npm/cargo dependency, any binary asset, any `capabilities/default.json` edit,
any change to `assemble.rs` behaviour, `hooks_server.rs`, `compile.rs`, or `graph.json`.

**Invoke contract 43 → 50** (§4). **One new Tauri event** (§5). **Zero new dependencies**
(§2.3). Rust tests grow from the 88 baseline by ≥ 8.

---

## 2. The runtime channel — the frozen decision

### 2.1 Verification status: NOT verified online

The work order says *"verify current CLI flags in official docs before implementing"*. In this
session tech-lead had **no WebFetch and no network tool available**, so the Claude Code CLI
reference could **not** be fetched. This is recorded, not hidden. The design is therefore
**defensive**: every CLI flag lives in one Rust const block, and a runtime probe checks the
installed binary before the first spawn.

```rust
// src-tauri/src/sessions.rs — the ONLY place CLI flags are written.
/// Headless telemetry turn. `-p` reads the prompt from STDIN (never argv — see
/// assemble.rs's ClaudeRunner header: Rust rejects newline args to .cmd/.bat,
/// CVE-2024-24576 hardening, and every prompt here is multi-line).
const HEADLESS_ARGS: &[&str] = &["-p", "--output-format", "stream-json", "--verbose"];
/// Continue an existing conversation: RESUME_FLAG + <claude session id>.
const RESUME_FLAG: &str = "--resume";
/// Flags the probe must find in `claude --help` before we trust the above.
const REQUIRED_FLAGS: &[&str] = &["-p", "--output-format", "--verbose", "--resume"];
/// Substring the probe must find so we know stream-json is a valid format value.
const REQUIRED_FORMAT: &str = "stream-json";
```

**Working directory is set with `Command::current_dir(cwd)`, never with a `-C`/`--cwd` flag** —
one fewer flag to be wrong about, and it is what already works everywhere else in the codebase.

**Probe** (`fn probe_cli() -> Result<(), String>`, cached in a `OnceLock<Result<(), String>>`,
run lazily before the first spawn, never at app start): run the resolved claude binary with
`--help` (CREATE_NO_WINDOW on Windows, 10 s timeout). Then:

- probe process fails to run at all → the probe result is `Ok(())` (**optimistic**): a missing
  `--help` must not block a working binary. The spawn error will be the real diagnosis.
- probe runs and its output is missing any of `REQUIRED_FLAGS` / `REQUIRED_FORMAT` → probe
  result is `Err("this claude CLI does not advertise <flag> — Cowtext agent sessions need
  `claude -p --output-format stream-json --verbose`; update Claude Code or set an explicit
  binary in Settings")`. `agent_session_spawn` returns that string; nothing is spawned.

Flags therefore change in exactly one const block if the CLI moves, and a stale CLI produces
one legible sentence instead of a silent dead session.

### 2.2 The MVP channel: one session = one persistent conversation, advanced by headless turns

- **Spawn** = *boot turn*: `claude <HEADLESS_ARGS>` in `cwd`, prompt on stdin (§6.3).
  The `system`/`init` line carries `session_id` → captured as the session's `claudeSessionId`.
- **Send** = *next turn*: `claude <HEADLESS_ARGS> --resume <claudeSessionId>`, prompt on stdin.
- One child process per turn; the child exits when the turn ends. A session is a *logical*
  entity in the Rust registry (id, cwd, claudeSessionId, current child pid), not a long-lived
  process.
- stdout is read **line by line** (`BufReader::lines`) and each JSONL line is mapped to an
  `agent://event` **as it arrives** — this is what makes the T8 "status flips within 1 s"
  acceptance structurally true. Never `wait_with_output()` here.

### 2.3 portable-pty: DEFERRED — flagged deviation, and there are ZERO new dependencies

`portable-pty` is the Work Order's one approved Block F dependency. **Approval is permission,
not obligation, and this contract declines it for Block F.** Reasons, on the record:

1. T9's acceptance — *"sent prompt visibly reaches the agent and the reply streams back"* — is
   fully satisfied by the `--resume` turn loop, with **better** data (structured tool names and
   real token usage) than a raw PTY byte stream can give.
2. A PTY channel is a second process lifecycle, a second parser (ANSI/VT), a second kill path
   and a second reconnect story, all landing in lane R's single Rust file in the same block.
   That is how seams rot.
3. Items 7 of Marty's list (real tokens per agent) is only obtainable from `stream-json`.

**Consequence: `src-tauri/Cargo.toml` and `Cargo.lock` are NOT modified in Block F. No lane
adds any dependency, cargo or npm.** The seam stays open: `sessions.rs` routes every turn
through one private `async fn run_turn(...)`, so a future PTY channel is an alternate
implementation behind that call, not a rewrite. Deferred to Block F+1 (see §11 D1).

---

## 3. Guardrail: 1 agent = 1 worktree (enforced in Rust)

- `agent_session_spawn` canonicalizes `cwd` and **rejects** it when any **alive** session
  already holds the same canonical path (comparison: canonicalized, `\`→`/`, case-insensitive
  on Windows, case-sensitive elsewhere). Error: `"another agent is already running in that
  folder"`. A dead/exited session does **not** hold its folder.
- `agent_session_spawn` **requires** `worktree_check(cwd).isRepo == true`. Error:
  `"<path> is not a git repository"`. `isWorktree == false` (i.e. a repo's main working copy)
  is **allowed** — the WO guardrail is "never two agents in one working copy", which the
  dup-cwd rule enforces; the Add-agent dialog nudges toward a worktree but does not block.
- `MAX_SESSIONS = 4` alive sessions, enforced in Rust *and* mirrored as a const in the store.
  Error: `"agent limit reached (4)"`. 4 = `CalfHerd`'s `CAP`, so the barn can always show them
  all; the T8 acceptance needs 3.

---

## 4. Command contract — 43 → 50 (byte-exact)

Seven new `#[tauri::command]`s. Each is three coordinated edits: fn in
`src-tauri/src/sessions.rs` (or `worktree.rs`), an entry in `lib.rs::generate_handler!`, and a
wrapper in `src/sessions/api.ts` — **the only file in the frontend allowed to `invoke` these**.
JS args camelCase, Rust snake_case.

```ts
// src/sessions/api.ts  (lane R owns this file)
import { invoke } from "@tauri-apps/api/core";

export interface WorktreeInfo {
  path: string;            // canonicalized, forward slashes
  isRepo: boolean;
  isWorktree: boolean;     // true iff git-dir !== git-common-dir (a linked worktree)
  branch: string | null;   // null when detached HEAD or not a repo
}

export interface SessionInfo {
  id: string;                       // Cowtext-side id, opaque — never parsed by the frontend
  name: string;
  agentFileName: string | null;     // e.g. "tech-ui.md", relative to <root>/.claude/agents/
  cwd: string;                      // canonicalized, forward slashes
  root: string;
  alive: boolean;
  claudeSessionId: string | null;   // captured from the stream's system/init line
}

export function worktreeCheck(path: string): Promise<WorktreeInfo>;
//   invoke("worktree_check", { path })
export function worktreeAdd(repoPath: string, newPath: string, branch: string): Promise<WorktreeInfo>;
//   invoke("worktree_add", { repoPath, newPath, branch })
export function agentSessionSpawn(root: string, agentFileName: string | null, name: string, cwd: string): Promise<SessionInfo>;
//   invoke("agent_session_spawn", { root, agentFileName, name, cwd })
export function agentSessionSend(id: string, prompt: string): Promise<void>;
//   invoke("agent_session_send", { id, prompt })
export function agentSessionKill(id: string): Promise<void>;
//   invoke("agent_session_kill", { id })
export function agentSessionRestart(id: string): Promise<SessionInfo>;
//   invoke("agent_session_restart", { id })
export function agentSessionList(): Promise<SessionInfo[]>;
//   invoke("agent_session_list", {})
```

Rust signatures (frozen):

```rust
#[tauri::command] pub fn worktree_check(path: String) -> Result<WorktreeInfo, String>;
#[tauri::command] pub fn worktree_add(repo_path: String, new_path: String, branch: String) -> Result<WorktreeInfo, String>;
#[tauri::command] pub async fn agent_session_spawn(app: AppHandle, state: State<'_, SessionRegistry>,
    root: String, agent_file_name: Option<String>, name: String, cwd: String) -> Result<SessionInfo, String>;
#[tauri::command] pub async fn agent_session_send(state: State<'_, SessionRegistry>, id: String, prompt: String) -> Result<(), String>;
#[tauri::command] pub async fn agent_session_kill(state: State<'_, SessionRegistry>, id: String) -> Result<(), String>;
#[tauri::command] pub async fn agent_session_restart(app: AppHandle, state: State<'_, SessionRegistry>, id: String) -> Result<SessionInfo, String>;
#[tauri::command] pub fn agent_session_list(state: State<'_, SessionRegistry>) -> Result<Vec<SessionInfo>, String>;
```

`generate_handler!` gains, in this order, after `tasks::task_update`:
`worktree::worktree_check, worktree::worktree_add, sessions::agent_session_spawn,
sessions::agent_session_send, sessions::agent_session_kill, sessions::agent_session_restart,
sessions::agent_session_list` → **50 commands**.

### 4.1 Semantics, frozen

- **`worktree_check`** — **AMENDED 2026-08-20, see §12 D8.** One `git -C <path> rev-parse
  --is-inside-work-tree --absolute-git-dir --git-common-dir` invocation (the `--abbrev-ref HEAD`
  flag from the original byte-exact set is **dropped**), followed by a second, independent
  `git -C <path> symbolic-ref --short HEAD` for the branch name. Non-zero exit from the
  three-flag call → `Ok(WorktreeInfo { isRepo: false, isWorktree: false, branch: None, .. })`
  (**not** an `Err` — "this folder isn't a repo" is an answer, not a failure). `git` missing
  entirely → `Err("git not found on PATH")`. `isWorktree = absolute-git-dir != git-common-dir`
  (path compare, normalized). `branch` comes from the second `symbolic-ref` call: non-zero exit
  (detached HEAD, **or** an unborn HEAD on a repo with zero commits) → `None`. The error string
  and the `WorktreeInfo` wire shape are **UNCHANGED** by this amendment — only the number and
  shape of the underlying `git` invocations changed.
- **`worktree_add`** — refuses when: `repo_path` is not a repo, `new_path` exists and is a
  non-empty directory, `new_path` is inside `repo_path/.git`, or `branch` is empty / contains
  whitespace or any of `~^:?*[\`. Runs
  `git -C <repo_path> worktree add <new_path> -b <branch>`; if that fails with stderr matching
  `already exists` (branch already present) it retries once as
  `git -C <repo_path> worktree add <new_path> <branch>`. Returns `worktree_check(new_path)`.
  On failure: `Err` with a ≤ 200-char single-line stderr tail (reuse the `stderr_tail` idiom of
  `assemble.rs:540`; duplicate the 8-line helper in `worktree.rs` rather than exporting it).
- **`agent_session_spawn`** — validates (§3), builds the boot prompt (§6.3), registers the
  session, starts the boot turn, returns immediately. **All progress after registration travels
  as `agent://event`; the command never blocks on the turn.** (Same "Err only at enqueue time"
  invariant as `assemble.rs`.)
- **`agent_session_send`** — `Err("no such agent session")` for an unknown id,
  `Err("that agent session has exited")` when `!alive`, `Err("agent is busy")` when a turn is
  already running (the frontend queue, §7, is what prevents this in practice). Otherwise starts
  the next turn and returns.
- **`agent_session_kill`** — kills the process tree (§6.5), marks `alive = false`, emits
  `kind:"exit"`. Idempotent: killing an already-dead session is `Ok(())`.
- **`agent_session_restart`** — kill (if alive) → re-register with the **same id**, same
  `cwd`/`name`/`agentFileName`/`root` → start a turn: `--resume <claudeSessionId>` with
  `RESTART_PROMPT` when a claude session id was captured, otherwise a fresh boot turn. Clears
  the Rust-side "busy" flag. Returns the refreshed `SessionInfo`.
- **`agent_session_list`** — every registered session, alive or not, in registration order.
  Exists so a webview reload (F5 / HMR) can re-adopt live children instead of orphaning them
  (§11 D2).

---

## 5. Wire shape — event `agent://event` (byte-exact)

```rust
// src-tauri/src/sessions.rs
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus { Idle, Working, Waiting }

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AgentEventKind { Status, Tool, Text, Usage, Exit, Error }

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// input + output + cache_creation + cache_read, as reported by the CLI.
    pub total_tokens: u64,
    /// RESERVED — always `None` in Block F (the CLI does not report a window
    /// size and Cowtext will not invent one). Frozen in the type now so the
    /// TS mirror never changes shape later.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: String,                 // Cowtext session id — ALWAYS present
    pub kind: AgentEventKind,
    #[serde(skip_serializing_if = "Option::is_none")] pub status: Option<SessionStatus>,
    #[serde(skip_serializing_if = "Option::is_none")] pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub usage: Option<Usage>,
    pub ts: u64,                    // unix millis, assigned by Rust at emit
}
```

TS mirror lives in `src/store/sessions.ts` (lane R), 1:1:

```ts
export type SessionStatus = "idle" | "working" | "waiting";
export type AgentEventKind = "status" | "tool" | "text" | "usage" | "exit" | "error";
export interface Usage { inputTokens: number; outputTokens: number; totalTokens: number; contextWindow?: number }
export interface AgentEvent {
  id: string; kind: AgentEventKind;
  status?: SessionStatus; tool?: string; text?: string; usage?: Usage; ts: number;
}
```

Emit channel const: `const AGENT_EVENT: &str = "agent://event";` — `app.emit(AGENT_EVENT, &e)`,
exactly the `hooks_server.rs:78` idiom.

### 5.1 stream-json → `agent://event` mapping table (frozen)

Every stdout line is parsed as JSON. **Unknown `type` values are ignored silently; a line that
is not JSON at all becomes `kind:"text"` verbatim** (so a CLI that prints a plain warning is
never invisible). Field lookups are all tolerant (`.get(..).and_then(..)`); a missing field
never panics and never drops the rest of the line.

| stream-json line | Emitted `agent://event` | Side effect in the registry |
|---|---|---|
| `{"type":"system","subtype":"init","session_id":S,...}` | `{kind:"status", status:"working"}` | `claudeSessionId = S` (first non-empty wins per turn) |
| `{"type":"system",...}` (other subtypes) | — (ignored) | — |
| `{"type":"assistant","message":{"content":[{"type":"text","text":T}]}}` | one `{kind:"text", text:T}` per text block, trailing whitespace trimmed, empty skipped | — |
| `…content:[{"type":"tool_use","name":N}]` | `{kind:"tool", tool:N, status:"working"}` | `currentTool = N` |
| `{"type":"assistant","message":{"usage":U}}` | `{kind:"usage", usage:map(U)}` **only if** U has a non-zero total | per-turn usage snapshot |
| `{"type":"user","message":{"content":[{"type":"tool_result",…}]}}` | — (ignored) | `currentTool = None` |
| `{"type":"result","subtype":"success","result":R,"usage":U}` | `{kind:"text", text:R}` (when R non-empty), then `{kind:"usage", usage:map(U)}`, then `{kind:"status", status:"idle"}` | turn ends, `busy = false`, `currentTool = None` |
| `{"type":"result", …}` with `subtype != "success"` **or** `is_error == true` | `{kind:"error", text:<subtype + result/error text>}` then `{kind:"status", status:"waiting"}` | turn ends, `busy = false` |
| `{"type":"stream_event"…}` / `content_block_delta` / anything else | — (ignored) | — |
| line is not valid JSON | `{kind:"text", text:<line>}` | — |
| child exits, code 0, a `result` line was seen | — (the `result` mapping already emitted `idle`) | — |
| child exits, non-zero **or** no `result` line seen | `{kind:"error", text:"claude exited (<code>): <stderr tail ≤200 chars>"}` then `{kind:"status", status:"waiting"}` | `busy = false` |
| `agent_session_kill` | `{kind:"exit", text:"killed"}` | `alive = false` |

`map(U)`: `inputTokens = input_tokens`, `outputTokens = output_tokens`,
`totalTokens = input_tokens + output_tokens + cache_creation_input_tokens +
cache_read_input_tokens` (each missing field reads as 0), `contextWindow` omitted.

**Status semantics, frozen and honest:**
- `working` — a turn is running (from the turn's first byte until its `result`/exit).
- `idle` — no turn running, last turn ended cleanly. Ready for a prompt.
- `waiting` — the last turn ended **abnormally** (non-success subtype, `is_error`, non-zero
  exit, or no `result` line). The agent needs a human. This is the only trigger; Cowtext does
  not guess at permission prompts it cannot observe headlessly.

---

## 6. Rust design — `src-tauri/src/sessions.rs` + `worktree.rs` (lane R)

### 6.1 Registry

```rust
pub struct SessionRegistry { inner: Arc<Mutex<HashMap<String, SessionEntry>>>, next: AtomicU64 }
struct SessionEntry {
    info: SessionInfo,                 // id, name, agent_file_name, cwd, root, alive, claude_session_id
    busy: bool,
    /// pid of the turn child currently running, for tree-kill. None between turns.
    child_pid: Option<u32>,
    /// Bumped on kill/restart; a turn task whose captured generation is stale
    /// stops emitting. This is what stops a killed turn from painting status
    /// onto the restarted session (same idiom as watcher.rs's generation guard).
    generation: u64,
    boot_prompt: String,               // kept for restart-without-session-id
}
```

- Managed in `lib.rs::run().setup`: `app.manage(sessions::SessionRegistry::default());`
  alongside the existing three `app.manage` calls.
- `std::sync::Mutex`, short critical sections only (never held across `.await`) — the
  `AssembleQueue` idiom. Never `unwrap()` a poisoned lock in a task; `let Ok(g) = … else { return; }`.
- Ids: `format!("as{}", next.fetch_add(1, Ordering::Relaxed))` → `as0`, `as1`, … Opaque to the
  frontend; never parsed, never displayed.

### 6.2 Turn execution (`async fn run_turn`)

1. Snapshot `(program, args, cwd, prompt, generation)` under the lock, set `busy = true`,
   release the lock.
2. Resolve the binary exactly as `assemble.rs` does — settings override first, then the cached
   `where`/`which` probe (§8.1 explains the two-line visibility change this needs). Same
   `cmd /C claude` Windows fallback, same `creation_flags(0x0800_0000)`.
3. `cmd.args(HEADLESS_ARGS)` (+ `RESUME_FLAG, id` when resuming), `.current_dir(cwd)`,
   stdin/stdout/stderr all `piped()`.
4. Record `child.id()` into `child_pid`. Write the prompt to stdin from a **separate spawned
   task**, then shutdown stdin — deadlock avoidance, verbatim rationale from
   `assemble.rs:499-505`.
5. Read stdout with `tokio::io::BufReader::new(stdout).lines()`; map + emit per line (§5.1).
   Read stderr concurrently into a rolling ≤ 200-char tail.
6. On exit: apply the exit rows of §5.1, clear `busy`/`child_pid`.
7. Every emit is gated on `generation == entry.generation`; a stale turn emits nothing.

### 6.3 Prompts (frozen consts, `sessions.rs`)

```rust
const BOOT_PROMPT_HEAD: &str = "You are the Cowtext agent \"{name}\" working in {cwd}.";
const BOOT_PROMPT_TAIL: &str = "Reply with ONE short line confirming you are ready. \
Do not modify any file until you are asked to.";
const RESTART_PROMPT: &str = "Session restarted by Cowtext. Reply with ONE short line \
confirming you are ready to continue.";
const AGENT_FILE_MAX_BYTES: usize = 8 * 1024;
```

When `agent_file_name` is `Some(f)`: read `<root>/.claude/agents/<f>` through
`project::resolve_within_root` (path-escape guard — the file name is a single component, `/`
`\` and `..` are rejected), truncate to `AGENT_FILE_MAX_BYTES` at a char boundary, and place it
between head and tail under a line `Your role definition follows:`. An unreadable agent file is
**not** fatal: it is skipped and one `{kind:"error", text:"agent file … could not be read"}` is
emitted before the boot turn starts. This body **is** the "same compiled context" T10 restores.

### 6.4 Spawn ordering (matters)

Register the entry (so `agent_session_list` and the dup-cwd guard see it) → return
`SessionInfo` from the command → *then* start the boot turn from a spawned task. The frontend
therefore always has the session in its list before the first event for it arrives. An event
for an unknown id is still dropped defensively in the store (§7).

### 6.5 Killing the process tree — the choice, documented

`claude` spawns a Node process tree; `Child::kill()` reaps only the direct child and leaves
orphans, which fails T10's acceptance ("no orphan processes after Kill, verify via process
list").

- **Windows: `taskkill /PID <pid> /T /F`**, spawned with `CREATE_NO_WINDOW`, 5 s timeout, then
  `child.start_kill()` as a belt-and-braces fallback. Chosen over Win32 **job objects** because
  job objects require the `windows`/`winapi` crate — an unapproved dependency (§2.3 keeps
  Block F at zero new deps). `taskkill` ships with every supported Windows. If it is missing or
  fails, the fallback still kills the direct child and the failure text is emitted as
  `kind:"error"` — never a silent partial kill.
- **Unix: process group.** `std::os::unix::process::CommandExt::process_group(0)` at spawn
  (stable, std-only), then `Command::new("kill").arg("-TERM").arg(format!("-{pid}"))`, and
  `child.start_kill()` as fallback. No `libc` dependency.
- Both paths run behind `#[cfg]`, are the **only** place a process is killed, and are exercised
  by a unit test against a long-running dummy child (`cmd /C ping -n 30 127.0.0.1` on Windows,
  `sleep 30` elsewhere) that asserts the pid is gone afterwards.

### 6.6 App exit

In `lib.rs`, after `.run(...)` is restructured to `.build(...)? .run(|app, event| …)` **only if
that restructure is trivially clean**; otherwise a `WindowEvent::Destroyed`/`ExitRequested`
handler registered in `.setup`. Whichever hook is used, it calls
`sessions::kill_all(&registry)` so quitting Cowtext never leaves agent children behind. If
neither hook can be wired without touching more of `lib.rs` than the handler list plus one
`app.manage` line, lane R stops and reports rather than refactoring the builder chain.

---

## 7. Frontend store — `src/store/sessions.ts` (lane R owns; lanes U and B code against it)

**Frozen API.** Lane U and lane B must not stub, redeclare, or extend these names.

```ts
export const TRANSCRIPT_CAP = 500;   // ring buffer, newest last
export const MAX_SESSIONS = 4;       // mirrors the Rust cap and CalfHerd's CAP

export interface TranscriptLine {
  kind: "text" | "tool" | "status" | "error" | "exit";
  text: string;
  ts: number;
}
export interface UsageTotals {
  inputTokens: number; outputTokens: number; totalTokens: number; turns: number;
}
export interface Session {
  id: string;
  name: string;
  agentFileName: string | null;
  cwd: string;
  root: string;
  status: SessionStatus;          // "idle" | "working" | "waiting"
  currentTool: string | null;
  alive: boolean;
  transcript: TranscriptLine[];   // cap TRANSCRIPT_CAP
  usage: UsageTotals;             // accumulated across turns
  queue: string[];                // prompts typed while busy, drained on idle
  lastError: string | null;
  startedMs: number;
}
export interface SessionsState {
  sessions: Session[];
  selectedId: string | null;
  busy: boolean;                  // a command is in flight
  opError: string | null;         // last operation error, cleared on the next op

  spawn(root: string, agentFileName: string | null, name: string, cwd: string): Promise<string | null>;
  send(id: string, prompt: string): Promise<string | null>;
  kill(id: string): Promise<string | null>;
  restart(id: string): Promise<string | null>;
  dismiss(id: string): void;              // removes an exited session; no-op while alive
  selectSession(id: string | null): void;
  applyEvent(e: AgentEvent): void;        // THE single entry point for agent://event
  hydrate(): Promise<void>;               // agent_session_list → adopt live sessions after a reload
}
export const useSessionsStore = create<SessionsState>(...);

/** Wires listen("agent://event") → applyEvent. Idempotent (StrictMode-safe),
 *  same shape as initEventListener in store/events.ts. Called once from App.tsx. */
export function initSessionsListener(): Promise<() => void>;
```

Frozen behaviour:

- `applyEvent` on an unknown id → no-op (never creates a session).
- `kind:"status"` → `status`; on `"idle"` also `currentTool = null` and, if `queue.length > 0`,
  shift the head and `void send(id, head)`. **This drain is the only place the queue moves**,
  and it is why a lost event can only ever delay a queued prompt, never duplicate one.
- `kind:"tool"` → `currentTool = tool`, push a transcript line `"⚙ <tool>"`.
- `kind:"text"` → push a transcript line (`kind:"text"`).
- `kind:"usage"` → `usage.inputTokens += …`, `outputTokens += …`, `totalTokens += …`,
  `turns += 1`.
- `kind:"error"` → `lastError = text`, push a transcript line (`kind:"error"`).
- `kind:"exit"` → `alive = false`, `status = "idle"`, `currentTool = null`, `queue = []`,
  push a transcript line (`kind:"exit"`).
- `send(id, prompt)` — trims; empty → `null` (no-op). If the session's `status !== "idle"` or
  `queue.length > 0`, it **only** appends to `queue` and returns `null` (no invoke). Otherwise
  it invokes `agent_session_send` and optimistically sets `status = "working"`; a rejected
  invoke rolls that back to `"idle"` **unless a real event already moved it** (the optimistic-
  freeze idiom from `Inspector.tsx:104-118`).
- `spawn` refuses locally when `sessions.filter(s => s.alive).length >= MAX_SESSIONS`, and
  auto-selects the new session (`selectedId = info.id`).
- `restart(id)` keeps the transcript (appends a `status` line `"— restarted —"`), clears
  `queue` and `lastError`, sets `alive = true`, `status = "working"`.
- `hydrate()` replaces `sessions` with the Rust list, preserving nothing else (transcripts do
  not survive a reload — documented, acceptable).
- Store imports allowed: `./sessions` → `../sessions/api` + `@tauri-apps/api/event` only.
  **No React import. `src/store/events.ts` is NOT modified** — this store owns its own listener.

---

## 8. UI contract (lane U)

### 8.1 Roster bar — placement decision against the current `App.tsx`

`<RosterBar />` is a new **flex-none strip inserted between `<Workspace/>` and `<EventLog/>`**
in `App.tsx:1180-1183`, rendered only while `root !== null`. It does **not** replace or move
`EventLog`'s header row: the event feed is the hook/telemetry channel and the roster is the
process channel; merging them would put two unrelated lifecycles behind one collapse toggle.

- Height `h-[38px]`, `border-t border-border-subtle bg-surface-1`, `flex items-center gap-2 px-3`.
- `overflow-x-auto` row of cards; each card `h-[30px] w-[172px] flex-none`, `rounded border`,
  `bg-surface-2`, selected card `border-accent-border bg-accent-surface`.
- Card content, left to right: `<AgentAvatar seed={session.name} size={11} />` · name
  (`truncate text-xs`) · status dot (`h-1.5 w-1.5 rounded-pill`) · current tool
  (`font-mono text-micro text-content-muted truncate`, only while `working`).
- Status colours (design-tokens law "blue is you, amber is the cow"):
  `idle` = `bg-content-muted` · `working` = `bg-amber` + `animate-blink` (steps timing, like
  `LoadingFallback`) · `waiting` = `bg-accent` (it wants **you**). Reduced-motion/calm: no
  pulse, solid amber. An exited session's card renders at `opacity-60` with a `dismiss` X.
- Left of the cards: **"Add agent"** button (`Plus` icon, `h-control-sm`), disabled with a
  title when `alive >= MAX_SESSIONS`.
- Click a card → `selectSession(id)`.

### 8.2 Agent panel — new Inspector branch

`src/sessions/AgentPanel.tsx`, rendered by `Inspector.tsx` as the **first** branch:
`selectedId !== null` wins over node / edge / multi / task / agents-selection. Rationale: a
roster click is an explicit, unambiguous user act; without priority it would be silently
swallowed by whatever the canvas had selected. The panel header carries an `X` that calls
`selectSession(null)`, returning the Inspector to exactly the branch it showed before.

`Workspace` additionally renders the Inspector in **barn** view when `selectedId !== null`
(today it renders only for `canvas`/`tasks`) — otherwise the panel is unreachable from the barn.
`BarnScene` uses `resizeTo: host` (`BarnScene.tsx:107`), so the Pixi canvas re-fits for free.

Panel contents, top to bottom:

1. Header: avatar (44) · name · status pill · `X`.
2. Meta line: `cwd` (`font-mono text-2xs`, `dir="rtl"` truncation like the recents rows) and
   the agent file name when set.
3. **Usage line — real tokens**: `↑{inputTokens} ↓{outputTokens} · {totalTokens} tok · {turns} turns`,
   `font-mono text-2xs text-content-muted`, `title="reported by claude, not an estimate"`.
   When `turns === 0`: `no usage yet`. This line must never say "≈" — the `PinnedTokenChip`
   estimate keeps its `≈`; these are real numbers and the difference is the point.
4. **Transcript**: read-only `min-h-0 flex-1 overflow-y-auto font-mono text-2xs`, one row per
   `TranscriptLine`, tool rows tinted amber, error rows `text-danger-text`, status rows muted.
   Autoscroll pinned to bottom using the `EventLog.tsx:161-164` effect verbatim in spirit
   (scroll on `transcript.length` change). No CodeMirror, no ANSI parsing, no HTML injection —
   plain text nodes only.
5. **Queue box**: `<textarea>` + `Send` button. Enter sends, Shift+Enter newlines. Disabled when
   `!alive`. While `status !== "idle"` the button label stays `Send` and the helper text under
   it reads `queued: N` when `queue.length > 0`.
6. **Kill / Restart**: `Restart` is a plain button; **`Kill` is confirm-armed** — first click
   turns it into `Confirm kill?` (danger styling), auto-disarming after 4 s or when the panel
   closes, the same two-click discipline as `ReviewBanner`'s "Dismiss all".

### 8.3 Add-agent dialog — `src/sessions/AddAgentDialog.tsx`

Fields, in order:

1. **Agent file** — a `<select>` over `useAgentsStore.getState().agents` (read-only use of that
   store; lane U must not write to it) plus a `(none)` option. Default `(none)`.
2. **Name** — text, defaults to the picked agent's stem, trimmed, 1–40 chars, required.
3. **Folder** — `open({ directory: true, title: "Agent working folder" })` from
   `@tauri-apps/plugin-dialog` (permission already granted). On pick, immediately call
   `worktreeCheck(path)` and show one of:
   - `isRepo && isWorktree` → green line `worktree · <branch>`;
   - `isRepo && !isWorktree` → amber line `repo main working copy — a separate worktree is
     recommended` + a **`Create worktree…`** button which asks for a new folder (second picker)
     and a branch name, calls `worktreeAdd`, and on success re-points the Folder field at the
     new path;
   - `!isRepo` → danger line `not a git repository` and **Add is disabled**.
4. Local pre-check against the guardrail: if any alive session already has that `cwd`, show
   `an agent is already running there` and disable Add. (Rust re-checks; the UI check only
   avoids a pointless round trip.)

Modal chrome, focus trap, Esc-to-close and backdrop follow `HooksModal`/`ReviewModal`; no new
UI primitive is introduced.

---

## 9. Barn tie-in (lane B) — thin, no new animation

### 9.1 `src/scene/agentHerd.ts` (new)

```ts
export interface AgentSpriteInput {
  id: string; name: string; status: SessionStatus; currentTool: string | null;
}
export class AgentHerd {
  constructor(layer: Container);
  /** Diff against the live set: add sprites for new ids, remove for gone ids,
   *  update status/tool for the rest. Idempotent; safe to call every frame. */
  sync(list: AgentSpriteInput[]): void;
  tick(dtMs: number, reduced: boolean): void;
  /** Hover label for one of this herd's containers, or null if not ours. */
  labelFor(view: Container): string | null;
  destroy(): void;
}
```

- Sprites are **existing** visuals: `makeCalf(calfLook(session.name))` from `calf.ts` /
  `identity.ts`. Same seed ⇒ same look as the session's `AgentAvatar` in the roster (both seed
  on `session.name`) — that identity match is the whole point and is an acceptance item.
- Cap = 4, consistent with `CalfHerd.CAP` and `MAX_SESSIONS`. Over-cap sessions are simply not
  drawn (never evict — eviction flickers, `calf.ts:158`).
- **Tiles:** four fixed spots, chosen by lane B and justified in the module header, provably
  disjoint from `CALF_SPOTS`, `COW_HOME_TILE`, `DEV_DESK_TILE`, `SIDE_DESK_TILE`,
  `BARN_DOOR_TILE` and `sceneGraph`'s auto prop slots. Same "fixed list, not a live free-tile
  query" reasoning as `calf.ts`'s header.
- **Status visuals, zero new animation:** `working` → the existing bubble from `props.ts`
  showing the tool name (or `…`); `waiting` → bubble `?`; `idle` → no bubble. Alpha/tint only,
  no new tweens. `reducedMotion()` respected exactly as elsewhere. **No sfx call is added in
  Block F** — session lifecycle is not yet in `SOUND_DESIGN`'s cue table, and inventing a cue
  here would break the "all gating lives inside sfx.ts" discipline.
- Store access: `BarnScene.tsx` subscribes to `useSessionsStore` (read-only) and calls
  `herd.sync(...)` when the list identity changes, plus `herd.tick(...)` inside the existing
  ticker callback — mirroring exactly how `useGraphStore`/`useEventsStore` are already consumed
  there. `agentHerd.ts` itself imports only Pixi + `calf.ts`/`identity.ts`/`iso.ts`/`props.ts`/
  `motion.ts` and the `Session` **types** from the store. No React, no howler, no React Flow.

### 9.2 `hover.ts` must stop mislabelling agents

`hover.ts:184` discovers calves as *leftover* children of `layout.objects`. Agent sprites live
in the same layer and would be labelled `Calf — subagent #n`. Lane B fixes this in `hover.ts`:
`HoverSyncCtx` gains `agents: AgentHerd`, and the leftover scan consults
`agents.labelFor(child)` **first** — a hit produces the agent label and skips the calf ordinal
counter entirely.

Label format, frozen: `"<name> — working: Edit"` / `"<name> — waiting"` / `"<name> — idle"`
(truncated by the existing `truncateHoverLabel`, 56 chars).

### 9.3 Spawn/despawn

Sprite appears when a session becomes `alive` and disappears when `alive` goes false or the
session is dismissed — driven entirely by `sync()` diffing, no event subscription in the scene.

### 9.4 Known non-goal (record, do not build)

Agent sessions running in a worktree that has Cowtext hooks installed will **also** POST to the
hooks server on :4923, so the cow will animate from agent activity in addition to the agent's
own animal. That is acceptable flavour for Block F. Correlating a `barn://event.sessionId` with
an agent session's `claudeSessionId` (they are the same identifier) is **deferred** — it is the
natural Block F+1 upgrade and must not be attempted here.

---

## 10. File-zone grid — zero overlap

| Lane | Agent | Files (exclusive) |
|---|---|---|
| **R** | tech-general | `src-tauri/src/sessions.rs` *(new)* · `src-tauri/src/sessions/tests.rs` *(new)* · `src-tauri/src/worktree.rs` *(new)* · `src-tauri/src/worktree/tests.rs` *(new)* · `src-tauri/src/lib.rs` · `src-tauri/src/assemble.rs` **(visibility-only, §10.1)** · `src/sessions/api.ts` *(new)* · `src/store/sessions.ts` *(new)* |
| **U** | tech-ui | `src/sessions/RosterBar.tsx` *(new)* · `src/sessions/AgentPanel.tsx` *(new)* · `src/sessions/AddAgentDialog.tsx` *(new)* · `src/App.tsx` · `src/inspector/Inspector.tsx` |
| **B** | tech-barn | `src/scene/agentHerd.ts` *(new)* · `src/scene/BarnScene.tsx` · `src/scene/hover.ts` |

Wire-file location decision: `src/sessions/api.ts`, matching the existing feature-folder
convention (`src/agents/api.ts`, `src/fs/api.ts`, `src/assemble/api.ts`). The folder is shared
but the **files are not**: every `.ts` in `src/sessions/` is lane R's, every `.tsx` is lane U's.

Nobody touches: `src/store/events.ts`, `src/store/agents.ts`, `src/store/graph.ts`,
`src/store/settings.ts`, `src/scene/calf.ts`, `src/scene/mapper.ts`, `src/identity/**`,
`src-tauri/src/hooks_server.rs`, `src-tauri/src/project.rs`, `src-tauri/src/compile.rs`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/capabilities/**`, `tauri.conf.json`,
`docs/**` (TERMINOLOGY and task docs are project-manager's at session close).

### 10.1 The one shared-file exception

Lane R may change **visibility only** in `assemble.rs`: make the existing binary resolution
reachable, e.g.

```rust
pub(crate) fn claude_override() -> Option<PathBuf>   // was private
pub(crate) fn resolve_claude() -> Option<PathBuf>    // was private
```

No behaviour change, no new function bodies, no signature change, `assemble.rs`'s tests must
still pass unmodified. Reimplementing binary resolution in `sessions.rs` is **forbidden** — two
copies of the Windows `.cmd`/`.exe` rules is exactly the kind of drift this contract exists to
prevent.

### 10.2 Sequencing

Lane R lands `src/store/sessions.ts` + `src/sessions/api.ts` **first** (they compile with no
backend), so lanes U and B can run `npx tsc --noEmit` against real exports rather than stubs.
Gates run once, after all three lanes land.

---

## 11. Acceptance gates

Green before the dispatcher commits:

1. `npx tsc --noEmit` clean · `npm run lint` (0 errors; the 1 known warning may remain).
   `strict: true`, **no `any`**, no unused locals/params.
2. From `src-tauri/`: `cargo clippy -- -D warnings` clean · `cargo test` **≥ 96** passing
   (88 baseline + ≥ 8 new), 0 failures. Required new tests: stream-json mapping table (one case
   per row of §5.1, driven by fixture JSONL strings through the pure mapper fn — **the mapper
   must be a pure `fn map_line(&str) -> Vec<AgentEvent>`-shaped function so it is testable
   without spawning anything**), non-JSON line → text, dup-cwd rejection, `MAX_SESSIONS`
   rejection, `worktree_check` output parsing (repo / non-repo / linked worktree / detached),
   `worktree_add` argument validation, tree-kill of a long-running dummy child.
3. `lib.rs::generate_handler!` lists **exactly 50** commands, and each new one has all three
   edits (fn, handler entry, `src/sessions/api.ts` wrapper by that exact name).
4. **No dependency change**: `git diff --stat` shows no `Cargo.toml`, `Cargo.lock`,
   `package.json`, `package-lock.json` change. No `capabilities/default.json` change.
5. T7 (manual, Marty runs `tauri dev` — lanes never do): Add agent → pick a worktree → a card
   appears, its status goes `working` then `idle` within seconds, and the transcript shows the
   agent's ready line. Non-repo folder is refused with a legible message.
6. T8: three sessions at once; each status flips within 1 s of the underlying stream line; the
   roster scrolls and the UI does not jank; each card's avatar matches its barn animal.
7. T9: typing a prompt and pressing Send makes it reach the agent and the reply stream back
   into the transcript; a prompt typed while `working` shows `queued: 1` and is sent
   automatically when the session returns to `idle`; the usage line shows real, growing token
   totals.
8. T10: Kill leaves **no** `claude`/`node` descendants (verify with
   `Get-CimInstance Win32_Process | Where ParentProcessId -eq <pid>` or Task Manager's process
   tree); Restart brings the session back in the same folder within 3 s and the agent still
   remembers the conversation (ask it something from before the restart).
9. Barn: with 2 sessions live, two animals stand in the barn; hovering one shows
   `"<name> — working: <Tool>"`, not `Calf — subagent #n`; killing one despawns its animal.
10. Reload the webview (F5) with a session alive → `hydrate()` re-adopts it; Kill then still
    works. Quitting the app leaves no orphan `claude` process.

---

## 12. Ratifications & deviations

- **D1 — `portable-pty` DECLINED for Block F (flagged deviation).** The WO's approved dependency
  is not taken; the interactive channel is deferred to Block F+1. T9's acceptance is met by the
  `--resume` turn loop (§2.2), which additionally delivers structured tool names and real token
  usage that a raw PTY cannot. Block F ships **zero** new dependencies. Seam preserved via the
  single `run_turn` chokepoint. Needs Marty's nod only if he wants the raw terminal *now*.
- **D2 — one extra command beyond the WO's six: `agent_session_list` (50, not 49).** Without it
  a webview reload (F5/HMR) permanently orphans live children, which directly contradicts
  T10's "no orphan processes". Ratified by tech-lead.
- **D3 — `agent_session_spawn` returns the full `SessionInfo`, not just `{ sessionId }`.** The
  store needs the canonicalized `cwd` (for the dup-cwd guard's UI mirror) and `alive` without a
  second round trip. Additive to the WO's shape; `id` is present and is the WO's `sessionId`.
- **D4 — CLI flags UNVERIFIED against official docs** (no network tool in this session, §2.1).
  Mitigated by the single const block plus the `claude --help` runtime probe. **If lane R has
  WebFetch, it must fetch `https://docs.anthropic.com/en/docs/claude-code/cli-reference` and the
  headless/SDK page, correct `HEADLESS_ARGS`/`REQUIRED_FLAGS`/§5.1 to match, and append the
  correction here as D4a** — that is a pre-authorized amendment, not a contract breach.
- **D5 — `waiting` has an observable definition** (§5.1): abnormal turn end. Cowtext does not
  fake a "waiting for permission" state it cannot see headlessly.
- **D6 — the prompt queue lives in the frontend store, not in Rust** (§7). One turn at a time;
  Rust rejects a concurrent send. One queue, one owner, no drift. Cost: a dropped `status:idle`
  event delays a queued prompt until the next status event — acceptable, and preferable to two
  queues disagreeing.
- **D7 — `contextWindow` is frozen into the wire type but never populated** in Block F. The type
  is stable from day one; no invented numbers.
- **Open risk 1:** stream-json shapes are matched tolerantly, but a future CLI could rename
  `type`/`subtype`. Symptom would be a session stuck at `working` with an empty transcript;
  the mitigation is the non-JSON/unknown-line passthrough plus the exit-path `waiting` rule, so
  the user always sees *something*.
- **Open risk 2:** `taskkill /T /F` is a hard kill — an agent mid-write can leave a partial file
  in its worktree. Accepted for an MVP Kill button; a graceful stop belongs to Phase 8.
- **Open risk 3:** transcripts do not survive a reload (§7 `hydrate`). Recorded, not fixed.
- **D8 — `worktree_check`'s byte-exact flag set (§4.1) is amended, ratified 2026-08-20 (lane
  `git-truth`, WO12).** Root cause, verified by reading `worktree.rs`, not guessed: the original
  composite invocation included `--abbrev-ref HEAD`. `git rev-parse` exits 128 for the **whole**
  invocation when any one of its arguments fails to resolve, and `--abbrev-ref HEAD` fails on an
  unborn HEAD — so **every commitless repository read as "not a git repository"**, including
  every repo Cowtext's own `git_init` had just created (it deliberately makes no first commit;
  §4.1 "no commit, no remote, no config, no first `add`"). Symptom: Add-agent's Spawn flow
  (`sessions.rs`, "\<path\> is not a git repository") rejected a folder the app's own Git wizard
  had just shown a green `repo` badge for — `git.rs`'s `git_status` gets it right because it
  issues `--is-inside-work-tree` alone, which is why the contradiction was visible in-app.
  **Fix, `worktree.rs` only:** drop `--abbrev-ref HEAD` from the composite `rev-parse` call
  (now three flags, not four); add a second, independent `git -C <path> symbolic-ref --short
  HEAD` call for the branch name, `None` on any non-zero exit (detached HEAD, or the same
  unborn-HEAD case, now scoped to just `branch` instead of the whole answer). `git.rs`'s own
  `probe_status` (`git_status`'s branch field, via `rev-parse --abbrev-ref HEAD`) has the same
  latent bug but is explicitly **out of scope** for this fix — ratified as `worktree.rs`-only,
  not touched. The error string and the `WorktreeInfo` wire shape (§4/§4.1) are **unchanged**;
  only the underlying `git` invocation(s) changed. See §4.1 for the amended flag set.
- **D1a — the `.gitignore` preset chip's checkbox square (`GitWizard.tsx`) was dead**, ratified
  2026-08-20 (lane `git-truth`, WO12). Root cause: `CheckSquare` rendered a `<button
  role="checkbox">` nested inside the preset chip's own `<button>`; neither handler called
  `stopPropagation`, so a click on the inner square fired `togglePreset` twice in one event (the
  functional set-toggle net-cancelled), and the markup was invalid HTML (`<button>` inside
  `<button>`). Fix: `CheckSquare` gained an `interactive?: boolean` prop (default `true`); when
  `false` it renders a `<span role="presentation">` with identical geometry and no handler of its
  own, and the preset chip's outer `<button>` alone carries `role="checkbox"` +
  `aria-checked` + the single `onClick`. The "I've reviewed this diff" call site is unchanged
  (a labelable `<button>` inside a `<label>` does not double-fire).
- **D1b — no default-branch choice at `git init`**, ratified 2026-08-20 (lane `git-truth`,
  WO12). `git_init` gains a second parameter, `branch: Option<String>` (Rust) /
  `branch: string | null` (TS) — an arity change, transparent to `generate_handler!`, no `lib.rs`
  edit, no invoke-count change. Validated with `worktree::validate_branch` (bumped
  `pub(crate)`, shared with `worktree_add`'s rule set; gained three checks: a leading `-`, a `..`
  anywhere, a trailing `.lock`) **before** any filesystem mutation. Not `git init -b <name>`
  (needs git ≥ 2.28); instead a version-safe two-step: probe whether the directory is already a
  repo (read-only `rev-parse --is-inside-work-tree`); only when it was **not** already a repo,
  run `init` then `symbolic-ref HEAD refs/heads/<name>`. Re-running `git_init` on an existing
  repo skips both steps entirely — `branch` is validated but never acted on, so the wizard can
  never silently move an existing repo's HEAD. `GitWizard.tsx` offers a `main` / `master` /
  `custom` segmented control, defaulting to `main`, disabling Init while a custom name is empty
  or fails the same client-side rule mirror (`isValidBranchName`) as `validate_branch`.
