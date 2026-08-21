# MCP Server — `cowtext-mcp` (F8, WO12)

`cowtext-mcp` is a second bin target in `src-tauri/` (alongside the GUI's
`cowtext` and the CI binary `cowtext-cli`) that exposes a fixed set of
Cowtext's graph/compile/task operations to Claude Code over stdio MCP. It
lets an agent working *in* a Cowtext-managed project read and edit that
project's graph, compiled output, and tasks directly, without going through
the GUI.

## Precedent this follows

Same rule as `cowtext-cli` (`src-tauri/src/bin/cowtext_cli.rs`): **no
`tauri::Builder` is ever constructed.** Every tool delegates to a plain
function in `cowtext_lib` that happens to also be a `#[tauri::command]` —
none of them take an `AppHandle`/`State`, so they run headless exactly like
any other pure Rust call. `src-tauri/Cargo.toml` declares it as a second
`[[bin]]` next to `cowtext-cli`; `default-run = "cowtext"` keeps `cargo run`
pointed at the GUI.

Building either bin still compiles the lib, which embeds
`tauri::generate_context!()` (`frontendDist: "../dist"`) — `dist/` must
exist before `cargo build --bin cowtext-mcp` will succeed.

## Transport

MCP stdio is JSON-RPC 2.0 as **newline-delimited JSON — one message per
line.** This is *not* LSP's `Content-Length` header framing. Implemented
with `serde_json` (already a dependency) plus plain
`std::io::{stdin, stdout, BufRead, Write}`; no tokio, no axum, no MCP crate
— every delegated call is synchronous and the stack is frozen.

Methods handled:

- `initialize` — echoes the client's `protocolVersion` back when it's one
  of `2025-06-18` / `2024-11-05` (what Claude Code negotiates), otherwise
  responds with `2025-06-18`. Result:
  ```json
  { "protocolVersion": "2025-06-18",
    "capabilities": { "tools": { "listChanged": false } },
    "serverInfo": { "name": "cowtext", "version": "0.1.0" } }
  ```
- `notifications/initialized` — a notification; produces **no output**.
- `ping` — responds with `{}`.
- `tools/list` — responds with `{ "tools": [...14 ToolSpec objects...] }`.
- `tools/call` — `params: { name, arguments }`; delegates to [`dispatch`],
  wraps the `Result<Value, String>` uniformly (see below).
- Anything else: a request with an `id` gets JSON-RPC error `-32601`
  ("Method not found"); a notification (no `id`) is silently dropped.

**A message with no `id` member is a notification and never gets a
response** (JSON-RPC 2.0 §4.1) — including `tools/call`, `initialize`,
`ping`, and `tools/list` sent without one; the server treats those as
malformed input and stays silent rather than guessing.

### Result wrapping

Every tool's `Result<T, String>` is wrapped uniformly:

```rust
Ok(v)  => json!({ "content":[{"type":"text","text": serde_json::to_string_pretty(&v)}], "isError": false }),
Err(e) => json!({ "content":[{"type":"text","text": e}], "isError": true }),
```

`isError: true` is the channel for **every** delegated `Err(String)` in
this crate — a graph validation error, a rejected write, an unknown tool
name — because it's a tool error the model can read and retry. JSON-RPC
error objects (`-32601`, `-32700`) are reserved for protocol faults (bad
method, unparseable JSON), never for a data-shaped problem.

### No stdout pollution

**Nothing may `println!` except the one response writer in `main`.**
`windows_subsystem = "windows"` (used by the GUI's `main.rs` to suppress
the console in release) does not apply to bin targets, so `cowtext-mcp`
keeps the default console subsystem — but a stray print anywhere in a
delegated call path would corrupt the JSON-RPC stream a client is reading
line-by-line. All diagnostics go to stderr; stdout is flushed after every
response line.

## Root binding

The project root is bound **once at launch**: `--root <PATH>` argv flag,
falling back to `$COWTEXT_ROOT`, falling back to `env::current_dir()`.
**`root` is omitted from every tool's JSON schema** — this halves schema
noise and makes it structurally impossible for the model to steer a write
at some other directory by passing a different root per call.
`checked_root`/`resolve_within_root` inside each delegated command still
enforce the project-root boundary per call, as a second layer.

## The frozen tool list (14, byte-exact names)

| Tool | Delegates to | Args |
|---|---|---|
| `cowtext_scan` | `project::scan_root` | `{}` |
| `cowtext_graph_read` | `read_graph` → `migrate_graph` (returns the migrated graph — never a stale v1/v2/v3 shape) | `{}` |
| `cowtext_graph_write` | `migrate_graph` (validate) → `serialize_graph` → `write_graph` | `{graph: string}` |
| `cowtext_node_read` | `project::read_md_file` | `{relPath}` |
| `cowtext_node_write` | `project::write_md_file` | `{relPath, content}` |
| `cowtext_compile_preview` | `compile::compile_preview` | `{}` |
| `cowtext_compile_write` | `compile::compile_write` | `{files: [{relPath, content}]}` |
| `cowtext_lint` | `lint::lint_run` | `{}` |
| `cowtext_tasks_scan` | `tasks::tasks_scan` | `{}` |
| `cowtext_task_append` | `tasks::task_append` | `{relPath, text}` |
| `cowtext_task_update` | `tasks::task_update` | `{relPath, line, patch}` (mirrors `TaskPatch`, all fields optional) |
| `cowtext_task_toggle` | `tasks::task_toggle` | `{relPath, line, done}` |
| `cowtext_task_context` | `read_graph` → `migrate_graph` → `taskctx::task_context_preview` | `{taskId}` (pattern `^t-[0-9a-z]{6}$`) — **the single highest-value tool**: hands the model the exact compiled subgraph for one task |
| `cowtext_agents_scan` | `agents::agents_scan` | `{}` |

`cowtext_task_append`'s `relPath` schema is a live JSON-schema `enum` built
from `tasks::tasks_scan(root).files[].relPath` at server-start time —
`tasks_scan` always reports exactly 5 entries (existing or not), so the
schema never hardcodes the convention names and can't drift from
`tasks.rs`'s own `CONVENTION_NAMES`/`CONVENTION_DIRS`.

### Free write-path guards (already enforced by the delegated commands)

- `cowtext_node_write` → `write_md_file` refuses `.claude/settings.json`
  (the trust boundary — only the GUI's Install Hooks diff can write there)
  and `.claude/agents/*.md` (ONE_WRITER doctrine — agent files are only
  writable via `agent_save`'s save queue in the GUI).
- `cowtext_compile_write` → `compile_write` enforces the compile-output
  write allowlist and requires the GENERATED header.
- `cowtext_task_append` / `cowtext_task_update` / `cowtext_task_toggle` are
  gated to the five task convention files (`ensure_convention_path`).

### Excluded, and why

- **`assemble`/`refine`/`summarize`/`handoff_generate`** — they shell out to
  `claude -p`. The MCP client *is* Claude; having a second Claude spend
  tokens writing text for the first is pure waste. They're additionally
  unreachable: `assemble.rs`/`handoff.rs` stay private `mod`s in `lib.rs`.
- **sessions / settings / `preset_save` / `preset_list` / `reveal_path`** —
  `AppHandle`/`State`-bound to the running GUI process; there is no GUI
  process behind an MCP stdio server.
- **`hooks_write`** — the `.claude/settings.json` trust boundary. An MCP
  tool call has no diff-preview UI, so there is no sanctioned way to show
  the confirmation this write always requires. (`hooks_status`, read-only,
  is deliberately not in the frozen 14 either — keep the surface tight.)
- **`agent_delete` / `skill_delete` / `import_apply` / `project_init`** —
  destructive without a preview step.
- **`assemble.rs`'s `build_prompt`** was explicitly not exposed even though
  it doesn't shell out — it belongs to another lane's file zone.

## Build & register

```powershell
cd src-tauri
cargo build --release --bin cowtext-mcp
```

Then point `.mcp.json` (repo root, alongside `.gitignore`) at the built
binary:

```json
{ "mcpServers": { "cowtext": { "type": "stdio",
  "command": "D:\\Moo.exe\\Cowtext\\src-tauri\\target\\release\\cowtext-mcp.exe",
  "args": ["--root", "D:\\Moo.exe\\Cowtext"], "env": {} } } }
```

Run `/mcp` inside Claude Code to verify the server connects. Tools appear
prefixed as `mcp__cowtext__<name>`, e.g. `mcp__cowtext__cowtext_task_context`.

## `lib.rs` visibility

`agents`, `tasks`, and `taskctx` were bumped from private `mod` to
`pub mod` in `src-tauri/src/lib.rs` so their `pub fn`s are visible to this
bin target (a private `mod` makes an item invisible outside the crate root,
E0603) — the same mechanism WO03 Lane C used for
`compile`/`import`/`lint`/`project`. `git`, `hooks`, `handoff`, `preset`,
`worktree`, `project_meta`, and `tasklinks` stay private: no tool in the
frozen 14 needs them, and a smaller blast radius is the point.
`project.rs`'s `scan_root` was widened from `pub(crate)` to `pub` for the
same reason — its own doc comment already sanctioned this ("so tests (and
any future non-command caller) don't need a Tauri `AppHandle`").
`generate_handler!` in `lib.rs` is untouched by this lane.
