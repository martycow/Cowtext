# Cowtext — Canonical Terminology

> Canon only: module names, invoke commands, events, and the terms every agent must use
> consistently. Full definitions, design terms, and the tech-stack sheet live in
> [`TERMINOLOGY_REFERENCE.md`](TERMINOLOGY_REFERENCE.md). Maintained by hand.

## Modules

| Module | Owns |
|---|---|
| `src-tauri/src/lib.rs` | `tauri::Builder` chain, plugin registration, `generate_handler!` command list (23) |
| `src-tauri/src/main.rs` | Thin shim → `cowtext_lib::run()`; `windows_subsystem = "windows"` |
| `src-tauri/src/project.rs` | `.md` scan, graph read/write, `write_atomic`, `resolve_within_root`, `checked_root` |
| `src-tauri/src/compile.rs` | Three adapters (claude/agents/cursor), validation, topological order, write allowlist |
| `src-tauri/src/assemble.rs` | `claude -p` queue (FIFO, max 2), Runner trait seam, `set_claude_override` |
| `src-tauri/src/hooks.rs` | Hooks preview/write into user `.claude/settings.json` (trust boundary) |
| `src-tauri/src/hooks_server.rs` | axum on `127.0.0.1:4923`, `POST /event` → `BarnEvent` → emit |
| `src-tauri/src/settings.rs` | App settings persistence via `app_config_dir` (atomic, frontend owns shape) |
| `src-tauri/src/preset.rs` | Preset save/list/read/export/apply (never-clobber) |
| `src-tauri/src/handoff.rs` | `HANDOFF.md` generation via ClaudeRunner, GENERATED header |
| `src/store/` | Zustand stores: `useProjectStore`, `useGraphStore` (graph.ts), `useEventsStore` (events.ts), `useSettingsStore` (settings.ts) |
| `src/canvas/` | React Flow view: `MemoryNodeCard`, `MemoryEdge`, `KindPicker`, `RoleGlyphs` |
| `src/inspector/` | Inspector panel, `EventLog`, `HooksModal`, AssembleSection |
| `src/compile/` | CompileModal, invoke wrappers, hand-rolled LCS diff (`diff.ts`) |
| `src/scene/` | Pixi barn: `BarnScene.tsx`, `cow.ts`, `mapper.ts`, `demo.ts`, `palette.ts`, `iso.ts`, `sfx.ts` (howler confined here) |
| `src/settings/` | `SettingsModal.tsx` |
| `src/preset/`, `src/handoff/` | Preset & handoff UI, clipboard variants |

## Invoke commands (27)

Adding one takes three coordinated edits: the `#[tauri::command]` fn, its
`generate_handler![...]` entry, the byte-exact `invoke` name in TS. camelCase in JS ⇄ snake_case in Rust.

| Group | Commands |
|---|---|
| project | `scan_project`, `read_graph`, `write_graph`, `read_md_file`, `write_md_file`, `rename_node_file`, `reveal_path`, `probe_project_dirs` |
| compile | `compile_preview`, `compile_write` |
| assemble | `assemble_node`, `refine_node`, `summarize_node`, `assemble_status`, `assemble_cancel` |
| hooks | `hooks_preview`, `hooks_write`, `hooks_status` |
| settings | `read_app_settings`, `write_app_settings` |
| preset | `preset_save`, `preset_list`, `preset_read`, `preset_export`, `preset_apply` |
| handoff | `handoff_generate`, `handoff_write` |

## Events

| Event | Payload | Flow |
|---|---|---|
| `barn://event` | `BarnEvent { kind, filePath?, sessionId, ts }` | hooks_server → emit → `useEventsStore.pushEvent` → canvas pulse + barn animation |
| `assemble://status` | `AssembleProgress { nodeId, mode, status, error }` | assemble.rs → emit → `useGraphStore.setAssembleStatus` |

One-way pipeline: Rust emits → Tauri `emit` → Zustand store → both views react.
React Flow and PixiJS never import each other.

## Key terms (canon)

| Term | One-liner |
|---|---|
| Memory Node | Graph node backed by a real `.md` file; file on disk is content source of truth |
| Node role | One of seven: `persona`, `rules`, `architecture`, `workflow`, `task`, `reference`, `glossary` |
| Edge kinds | `imports` (inline), `references` (soft link), `conditional` (glob/NL condition), `sequence` (order only) |
| Pinned / effective-pinned | Always-in-context flag; effective set = pinned + transitive `imports` closure |
| readOrder | Manual tie-break inside topological order (Kahn, pops by `(readOrder, id)`) |
| BarnGraph | `graph.json` shape: `version: 1`, `projectName`, `nodes`, `edges`, `compileTargets`; schema change ⇒ version bump + migration |
| Compile | One graph → `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/*.mdc`; never writes without diff-preview approval |
| Compile target | `"claude" \| "agents" \| "cursor"` in `graph.json`; cursor off by default |
| GENERATED header | First line of every compiled file; absence marks a file handwritten; `compile_write` refuses content without it |
| Write allowlist | `compile_write` accepts only compile-output shapes — never a general write primitive |
| Errors XOR files | `compile_preview` returns validation errors or preview files, never both |
| Assemble / Refine / Summarize | Brief → full file via headless `claude -p` (stdin prompt, `--output-format json`); variants re-run with instruction / compress |
| Brief | One-line node description that Assemble expands; presets keep briefs, not content |
| Hooks (trust boundary) | `PostToolUse`/`UserPromptSubmit`/`Stop` curl entries written into the user project's `.claude/settings.json` — always behind a confirmation diff |
| BarnEvent | Normalized live event from Claude Code hooks; drives event log, canvas pulse, barn |
| resolveNodeId | events-store helper mapping `filePath` → node (normalize, root-strip, case-insensitive) |
| The Barn | Pixi 8 isometric scene (2:1 tiles, Barnlight-29 palette); cow = the agent, calves = subagents |
| Demo mode | `DemoPlayer` loops fake BarnEvents through the real store; DEMO badge, filtered from live |
| Calm mode | One toggle: no sound + reduced motion; day-one requirement |
| SFX cue | Named sound fired via `play()` in `sfx.ts`; all gating (mute/calm/ducking/cooldown/voice pool) lives inside `play()` |
| Preset | Graph structure + briefs (no content); apply never clobbers existing files |
| Handoff | `claude -p` fills a session-summary template → `HANDOFF.md` + Chat/Code/Design clipboard variants |
| App settings | `app_config_dir/settings.json`: volumes, mute, calm, `claudeBinaryPath` (live override via `set_claude_override`) |
| Path guard / FS boundary | All FS goes through Rust; webview-supplied paths resolved within root, `..`/absolute rejected |
| Atomic write | Temp file + rename into place; both write commands use it |
| Trust boundary | Any write into a user project's `.claude/settings.json` — confirmation diff, never silent |
| Ports | 1420 = Vite dev (strictPort, pinned in two files); 4923 = hooks server |
| "Blue is you, amber is the cow" | Scarf blue = user-initiated; hay amber = agent activity; never mixed on one control |
| Capabilities | Tauri deny-by-default; new plugin permissions go in `src-tauri/capabilities/default.json` |

Cross-references like "FEATURES n.n" resolve to the Feature inventory section of
`docs/tasks/BACKLOG.md` (formerly `docs/FEATURES.md`, archived).
