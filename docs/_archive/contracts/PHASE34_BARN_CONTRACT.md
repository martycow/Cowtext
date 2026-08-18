# Phase 3+4 + Barn Prototype — Frozen Build Contract

Fleet session 2026-08-16. Code Lead. Covers plan §6 (Assemble), §7 (Live monitor),
and an **authorized early §8 slice** (Barn prototype, placeholder graphics only).
This contract is frozen: any deviation requires a Code Lead revision note in this file
*before* the deviating code is written. Style follows the Phase-2 contract
(`src/compile/api.ts` + `types.ts` mirroring `compile.rs` — imitate that discipline).

Ground rules that bind every section: TS `strict`, no `any`; `cargo clippy --all-targets
-- -D warnings` clean; every new Rust command = 3 coordinated edits (fn, `generate_handler![]`,
`invoke("exact_snake_case_name")`); args camelCase in JS / snake_case in Rust; all FS writes
go through `project::resolve_within_root` + `write_atomic`; `package.json` is FROZEN.

---

## 1. Rust commands

New modules: `src-tauri/src/assemble.rs`, `src-tauri/src/hooks.rs` (settings writer),
`src-tauri/src/hooks_server.rs` (axum). All registered in `lib.rs::generate_handler![]`.
Error convention (unchanged from Phase 2): commands `Err(String)` **only** for
infrastructure failure; domain outcomes travel in the Ok payload or in events.

### 1.1 Assemble queue (§6)

One managed state `AssembleQueue` (`tauri::State`), FIFO, **max 2 concurrent**
`claude -p` child processes, driven by tokio tasks.

```rust
#[tauri::command] async fn assemble_node(app: AppHandle, state: State<'_, AssembleQueue>,
    root: String, graph_json: String, node_id: String) -> Result<(), String>
#[tauri::command] async fn refine_node(app, state, root: String, graph_json: String,
    node_id: String, instruction: String) -> Result<(), String>
#[tauri::command] async fn summarize_node(app, state, root: String, graph_json: String,
    node_id: String) -> Result<(), String>
#[tauri::command] fn assemble_status(state: State<'_, AssembleQueue>)
    -> Result<Vec<AssembleJobInfo>, String>
#[tauri::command] fn assemble_cancel(state: State<'_, AssembleQueue>, node_id: String)
    -> Result<bool, String>   // true = a queued (not yet running) job was removed
```

JS invoke names/args: `invoke("assemble_node", { root, graphJson, nodeId })`,
`refine_node` adds `instruction`, `assemble_status` takes `{}`, `assemble_cancel`
takes `{ nodeId }`.

Enqueue-time `Err` strings (exact prefixes): `"Not a directory: {root}"` (via
`checked_root`), `"Unknown node: {node_id}"`, `"Node already queued: {node_id}"`,
`"graph.json: {serde error}"`. Everything after enqueue is reported via events, never Err.

```rust
#[derive(Serialize, Clone)] #[serde(rename_all = "camelCase")]
pub struct AssembleJobInfo { pub node_id: String, pub mode: AssembleMode,
    pub status: JobStatus }        // JobStatus: Queued | Running
#[derive(Serialize, Clone)] #[serde(rename_all = "camelCase")]
pub enum AssembleMode { Assemble, Refine, Summarize }   // serialized "assemble" | ...
```

Progress event — Rust emits `app.emit("assemble://status", p)` on every transition:

```rust
#[derive(Serialize, Clone)] #[serde(rename_all = "camelCase")]
pub struct AssembleProgress { pub node_id: String,
    pub status: String,            // "queued" | "running" | "assembled" | "error"
    pub error: Option<String> }    // set only when status == "error"
```

**Prompt build** (per §6): project name, node role + title, brief, titles+briefs of
1-hop neighbors, target ≤ 60 lines. Refine appends the user instruction; Summarize
sends the current file content with a compress instruction instead of the brief.

**Child process** — Windows-safe spawn, in this order: resolve `claude.cmd` via
`where claude` at first use (cache it); if resolution fails, fall back to
`cmd /C claude ...`. Never spawn bare `"claude"` (CreateProcess won't find a `.cmd`).
Args: `-p "<prompt>" --output-format json`. Parse stdout as JSON, take the `result`
string field. Non-zero exit, unparseable JSON, or missing `result` → status
`"error"` with a one-line reason (include stderr tail ≤ 200 chars).

**Write discipline** — the result is written ONLY to the enqueued node's `filePath`,
resolved via `resolve_within_root(root, file_path)`; path must end `.md` (case-insensitive)
or the job errors with `"Refusing to write non-markdown file: {file_path}"`. Written with
`write_atomic`. No other write target exists in this module — same allowlist spirit as
`compile_write`.

### 1.2 Hooks writer (§7 — TRUST BOUNDARY)

Target file is exactly `<root>/.claude/settings.json`, nothing else, ever.

```rust
#[tauri::command] fn hooks_preview(root: String) -> Result<HooksPreview, String>
#[tauri::command] fn hooks_write(root: String, content: String) -> Result<(), String>
```

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct HooksPreview { pub rel_path: String,        // always ".claude/settings.json"
    pub old_content: Option<String>,                   // None = file absent
    pub new_content: String, pub unchanged: bool }
```

`hooks_preview` reads any existing settings.json, **merges** the plan-§7 hooks block
(PostToolUse matcher `Read|Edit|Write|Grep|Glob`, UserPromptSubmit, Stop — each
`curl -s -m 1 -X POST --data-binary @- http://127.0.0.1:4923/event || true`) into the
existing JSON preserving all unrelated keys, and returns old/new. Existing file that is
not valid JSON → `Err("settings.json is not valid JSON: {e}")` — never clobber it.

`hooks_write` writes the exact `content` bytes the user approved. Guards: content must
parse as a JSON object (else `Err("Refusing to write invalid JSON")`); path fixed to
`.claude/settings.json` under `checked_root`; `write_atomic`. **The frontend MUST have
shown the HooksPreview diff and received an explicit click before calling `hooks_write`.
No auto-write path may exist.** (CLAUDE.md hard rule.)

### 1.3 Hooks server (§7)

`hooks_server::start(app: AppHandle)` — called once from `lib.rs::run()` inside
`.setup(|app| { hooks_server::start(app.handle().clone()); Ok(()) })`. Spawns a tokio
task running axum bound to `127.0.0.1:4923`, single route `POST /event`. Bind failure
(port taken) logs `eprintln!` and returns — the app must still start. Handler: read body,
parse leniently (any parse failure → 200 with empty body anyway; hooks must never see
errors), normalize (§2), `app.emit("barn://event", event)`, respond 200. No other routes,
no CORS, loopback only.

## 2. BarnEvent — normalized shape + mapping

Tauri event name: **`"barn://event"`** (Rust emit; frontend `listen`). Wire shape
(Rust struct serde camelCase, mirrored 1:1 in `src/store/events.ts`):

```ts
interface BarnEvent {
  kind: "prompt" | "read" | "edit" | "write" | "grep" | "glob"
      | "stop" | "subagent_stop" | "other";
  filePath?: string;    // verbatim from hook (may be absolute); omitted if absent
  toolName?: string;    // set when kind === "other" (raw tool_name), else omitted
  sessionId: string;    // hook session_id, "" if absent
  ts: number;           // unix millis, assigned by Rust at receipt
}
```

Mapping from hook JSON (`hook_event_name`, `tool_name`, `tool_input.file_path`,
`session_id`): `UserPromptSubmit` → `prompt` · `Stop` → `stop` · `SubagentStop` →
`subagent_stop` · `PostToolUse` by `tool_name`: `Read`→`read`, `Edit`|`MultiEdit`→`edit`,
`Write`→`write`, `Grep`→`grep`, `Glob`→`glob`, anything else → `other` (+`toolName`).
`filePath` comes from `tool_input.file_path`, falling back to `tool_input.path`
(Grep/Glob use `path`). **Events with missing or unresolvable paths are still emitted**
— the log feed shows everything; only node mapping is skipped (frontend concern).

## 3. Frontend store contract

Stores are plain Zustand modules. **No store imports any React component**, React Flow,
or Pixi. Both views read stores; stores never read views.

### 3.1 `src/store/graph.ts` — additions only (Multifunctional Coder)

```ts
export type AssembleStatus = "idle" | "queued" | "running" | "assembled" | "error";
// added to GraphState (TRANSIENT — never serialized into graph.json, no version bump):
assembleStatus: Record<string, AssembleStatus>;   // nodeId → status; absent = "idle"
assembleErrors: Record<string, string>;           // nodeId → last error line
setAssembleStatus: (nodeId: string, status: AssembleStatus, error?: string) => void;
```

`serializeGraph` / `migrateGraph` are untouched. Deleting a node clears its entries.

### 3.2 NEW `src/store/events.ts` (Multifunctional Coder)

```ts
export interface BarnEvent { /* exactly §2 */ }
export interface EventsState {
  events: BarnEvent[];                 // ring buffer, newest last, MAX = 200
  demoMode: boolean;                   // true while the barn demo player feeds events
  pushEvent: (e: BarnEvent) => void;   // trims to MAX; single entry point (hooks AND demo)
  clear: () => void;
  setDemoMode: (on: boolean) => void;
}
export function resolveNodeId(filePath: string): string | null;
// normalizes \ → /, strips the project root prefix if present, then matches
// case-insensitively against useGraphStore nodes' filePath; null = unknown (still logged)
export function initEventListener(): Promise<() => void>;
// idempotent; wires @tauri-apps/api/event listen("barn://event") → pushEvent,
// and listen("assemble://status") → useGraphStore.setAssembleStatus.
```

`initEventListener()` is called once from app wiring (App.tsx — Multifunctional Coder's
lane). Phase-4 "ugly" feedback (canvas node pulse on read/edit + event log panel) lives in
`src/canvas/` + a new inspector/log panel — same owner, reads these stores only.

### 3.3 NEW `src/assemble/` (Multifunctional Coder) — mirrors `src/compile/` style

`types.ts`: `AssembleJobInfo`, `AssembleProgress` mirroring Rust. `api.ts`: exactly the
five `invoke` wrappers of §1.1, nothing else.

## 4. Barn prototype boundary (authorized §8 slice)

- **Everything under `src/scene/` only.** Suggested: `BarnScene.tsx` (the single React
  export `<BarnScene/>` hosting a Pixi 8 `Application`, async `init`, proper destroy on
  unmount), `iso.ts` (tile math), `props.ts` (node props), `cow.ts`, `demo.ts`.
- Reads **ONLY** `useGraphStore` + `useEventsStore` (via `getState()`/`subscribe` inside
  the ticker — no per-frame React renders). Never imports React Flow, `src/canvas/`,
  `src/compile/`, `src/inspector/`.
- **Placeholder graphics drawn programmatically with Pixi `Graphics`.** NO binary or
  base64 assets in source (hard rule). Palette hexes may be copied from
  `docs/design/ART_DIRECTION.md` (Barnlight-29) as named constants.
- Iso projection: 2:1, base tile **32×16** (`screenX = (tx − ty) * 16`,
  `screenY = (tx + ty) * 8`), fixed grid (12×12 is fine). Node props placed from
  `scenePos` when present, else auto-layout (deterministic from node id order).
  Role → prop shape per plan §8 (cabinet / bookshelf / corkboard — flat-colored boxes OK).
- Cow: a Graphics blob (milk `#F4EFE7` + scarf `#4C9BE8`) that walks **tile-to-tile**
  (stepwise, interruptible, events queue) to the prop of `resolveNodeId(e.filePath)` on
  `read`/`edit`/`write` events; unknown-path events get no walk.
- **Built-in demo-mode player** (`demo.ts`): feeds a scripted BarnEvent sequence through
  `useEventsStore.pushEvent` (with `setDemoMode(true)`) on a timer, so the barn can be
  demoed before hooks are live. Toggleable from within the scene component.
- **Must NOT edit `App.tsx`** or any file outside `src/scene/`. Integration notes
  (what to import, where to mount, store expectations) go to
  `docs/design/BARN_PROTOTYPE.md` — nowhere else.

## 5. File-ownership grid — NOBODY crosses lanes

| Lane | Owner | Files |
|---|---|---|
| Rust | **Core Coder** | `src-tauri/**` including `Cargo.toml`, `capabilities/default.json`, `lib.rs` handler list |
| App UI | **Multifunctional Coder** | `src/store/**`, `src/assemble/**` (new), `src/canvas/**`, `src/inspector/**`, `src/App.tsx` |
| Barn | **Barn Coder** | `src/scene/**` only |

No one edits another lane's files — cross-lane needs go through the Code Lead as a
contract revision. `package.json` / `package-lock.json` are **frozen for everyone**
(pixi.js@8 is already installed). Docs: each coder writes only the doc files this
contract names. Nobody commits to git.

## 6. Dependencies

New Cargo deps allowed: **`axum`** (hook receiver) and **`tokio` (features = ["full"])**
(server + queue + `tokio::process` for the claude children). Timestamps use
`std::time::SystemTime` — no chrono. Nothing else lands in `Cargo.toml` without a
written reason appended to this section. Frontend: zero new npm packages;
`@tauri-apps/api` `event.listen` and Pixi 8 are already present. Capabilities: Tauri
event listen is covered by `core:default` — no `capabilities/default.json` change is
expected; if a runtime "command exists but does nothing" appears, suspect capabilities
first and fix there, not by rewriting the command.

## 7. Definition of done (per lane)

- Core: `cargo clippy --all-targets -- -D warnings` + `cargo test` green; unit tests for
  prompt build, hook JSON → BarnEvent mapping, settings.json merge, path guards.
- Multifunctional: `npm run build` green (strict, noUnusedLocals); invoke names match §1
  byte-for-byte; hooks diff modal blocks `hooks_write` until approval.
- Barn: `npm run build` green with `src/scene/**` included; demo mode runs without a
  backend; `docs/design/BARN_PROTOTYPE.md` written.

## 8. Revisions (post-audit, 2026-08-16 — Code Lead audit authority)

- **§1.1 child process, arg form**: the prompt is piped over **stdin**, not passed as
  an argv argument (`claude -p --output-format json` with `Stdio::piped` stdin).
  Reason: Rust std/tokio reject `.cmd`/`.bat` arguments containing newlines
  (CVE-2024-24576 hardening) and every prompt is multi-line, so the contract's
  original `-p "<prompt>"` form errors at spawn on Windows npm installs. The
  resolver now also prefers a `.exe` hit from `where claude` over a `.cmd` shim.
- **§1.1 AssembleProgress**: an undeclared `#[serde(skip_serializing_if)]` on `error`
  was removed; the field is serialized as `null` when absent, matching the frozen
  struct and the TS mirror (`error: string | null`).
- **§3.2 scene resolution**: `resolveProp` now delegates to the store's
  `resolveNodeId` (the Barn Coder's declared suffix-match deviation is retired);
  suffix matching remains only as the DEMO_NODES fallback when the graph is empty.
