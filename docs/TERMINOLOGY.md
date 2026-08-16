# Cowtext — Terminology & Technology Sheet

> **Maintained by hand — update when introducing a new term or dependency.**

Single reference sheet for every term, technology, and library used by the Cowtext
project. Sources: `CLAUDE.md`, `docs/FEATURES.md`, `docs/design/DESIGN_SPEC.md`,
`docs/DESIGN_PROMPT.md`, the plan (`D:\Moo.exe\_Documents\Cowtext\COWTEXT_VIBECODE_PLAN.md`,
cited below as "Plan §n"), `package.json`, `src-tauri/Cargo.toml`, and the source tree.
Alphabetical within each group. "Planned" = specced but not yet in the codebase
(Phase 0 accepted; Phase 1 graph-canvas work is in the tree).

---

## Product terms

| Term | Definition | Where it lives |
|---|---|---|
| Adopt as node | Turn an existing `.md` file — or an unknown path seen in the live feed — into a Memory Node with one click (`adoptFile` in the graph store). | Plan §9 P1; FEATURES 2.3, 6.7; `src/store/graph.ts` |
| Assemble | Expand a node's one-line `brief` into a full `.md` file via headless `claude -p` child processes (queued, max 2 concurrent). Never blind-overwrites: diffs against the existing file first. | Plan §6; Phase 3 |
| Barn | The signature PixiJS scene: 16-bit SNES-style isometric barn (2:1 tiles, 32×16 base) where the cow physically walks to props and reads memory files live. Toggles with the graph canvas (Canvas ⇄ Barn). | Plan §8; Phase 5 |
| BarnEvent | Normalized live event `{ kind, filePath?, sessionId, ts }` produced by the hooks server from Claude Code hook JSON, emitted to the webview as `barn://event`. Drives both canvas pulses and barn animations. | Plan §7; Phase 4 |
| BarnGraph | Top-level shape of `graph.json`: `version: 1`, `projectName`, `nodes`, `edges`, `compileTargets`. Serialized with stable field order, sorted ids, LF + trailing newline (`serializeGraph`); loaded through the `migrateGraph` harness. | Plan §4; `src/store/graph.ts` |
| Brief | One-line description stored on a Memory Node; the input Assemble expands into a full file. Presets keep briefs but not content. | Plan §4, §6 |
| Calf | Smaller cow sprite representing a Claude subagent; spawns from the barn door, despawns on SubagentStop. | Plan §8 |
| Calm mode | One toggle, two effects: no sound + reduced motion. Exists from day one of the barn, not later. | Plan §8; DESIGN_SPEC |
| Compile | One graph → N tool files: `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` generated from the single source of truth. Never writes without diff-preview approval. | Plan §5; Phase 2 |
| Compile adapter | Per-target generator (`claude`, `agents`, `cursor`) mapping the graph to one output format; lives in `src-tauri/src/compile.rs` (planned). Pluggable adapters (Copilot, Windsurf…) are backlog. | Plan §5; FEATURES §4 |
| Compile target | One of `"claude" \| "agents" \| "cursor"`, stored per project in `graph.json` (`compileTargets`); `cursor` is off by default in the target picker. | Plan §4, §5 |
| Cow (the) | Small cow with a blue scarf — the Moo.exe mascot — representing the Claude agent in the barn. Amber is its colour in the tool layer. | Plan §8; DESIGN_PROMPT |
| Cowtext | The product (working name): a desktop context-graph editor where an AI agent's context is a visual graph of Memory Nodes. Made by **Moo.exe**. | Plan §1 |
| Diff preview | Modal showing exactly what a write will change before it happens. Mandatory for compile output and for hook installation — Approve is the only path out. | Plan §5; DESIGN_SPEC |
| Edge kind: `imports` | Hard include — target's content is inlined into the source's compiled output; always in context. Drawn 1.75px solid with a filled arrow. | Plan §4; DESIGN_SPEC; `src/canvas/MemoryEdge.tsx` |
| Edge kind: `references` | Soft link — "see \<file\> when relevant"; mentioned by path, never inlined; agent reads on demand. Drawn 1.5px dashed with an open-circle marker. | Plan §4; DESIGN_SPEC; `src/canvas/MemoryEdge.tsx` |
| Edge kind: `conditional` | Include/point only when a condition matches — a glob (`src/net/**`) or natural language. Drawn dotted with a mono condition chip at the midpoint (the chip is the cue, not colour). | Plan §4; DESIGN_SPEC; `src/canvas/MemoryEdge.tsx` |
| Edge kind: `sequence` | Pure ordering — target must be read after source; affects `readOrder` only. Drawn 1.5px solid with an open chevron and a numbered step dot. | Plan §4; DESIGN_SPEC; `src/canvas/MemoryEdge.tsx` |
| Edge kind picker | Popover shown when a connection is drawn between two nodes: choose one of the four kinds (plus a condition input for `conditional`) or cancel — no edge exists until confirmed (`pending` connection in the store). | `src/canvas/KindPicker.tsx`; `src/store/graph.ts` |
| Handoff | Button that has `claude -p` fill a template (current state / decisions / open threads / next actions) from the graph + recent event log → `HANDOFF.md` plus clipboard variants for Claude Chat / Code / Design. | Plan §9 P6; FEATURES §8 |
| Live monitor | The hooks pipeline as a feature: real agent activity lights up nodes on the canvas (Phase 4, "ugly version") and drives the barn (Phase 5). Unknown paths still show in the event log. | Plan §7; FEATURES §6 |
| Memory Node | A node in the graph backed by a real `.md` file in the user's project. Fields: `id`, `title`, `role`, `brief`, `filePath`, `readOrder`, `pinned`, `position`, optional `scenePos`. The file on disk is the content source of truth; creating a node stubs the file immediately. | Plan §4; `src/store/graph.ts`, `src/canvas/MemoryNodeCard.tsx` |
| Node role | One of seven per node: `persona`, `rules`, `architecture`, `workflow`, `task`, `reference`, `glossary` (`NodeRole` / `NODE_ROLES`). Drives the 8×8 glyph, role colour, and which barn prop represents the node (cabinet / bookshelf / corkboard…). | Plan §4, §8; DESIGN_SPEC; `src/store/graph.ts` |
| Phase | The build order (0–6, then a `7+` backlog). Hard rule: never implement a feature before its phase. Currently: Phase 0 accepted, Phase 1 next. | Plan §9; FEATURES |
| Pinned | Node flag: always-in-context (compiled into the output in `readOrder`) vs on-demand. Pinning is an agent-facing guarantee, so its indicator is amber, not blue. | Plan §4; DESIGN_SPEC |
| Preset | Saved graph structure + briefs (no file content); "New project from preset" stubs the files. Exportable as a single `.cowtext-preset.json`. | Plan §9 P6; FEATURES §8 |
| readOrder | A node's position in compiled output. Resolved topologically first (across `imports`/`sequence`); manual order breaks ties. Shown as a badge on the card. | Plan §4; DESIGN_SPEC |
| Refine | Per-node Assemble variant: re-run generation with an extra user instruction. | Plan §6 |
| Resolved-context preview | The exact bytes the agent will see — imports expanded inline, with a total token count. One of the two "product, not polish" differentiators (with the usage heatmap). | FEATURES 4.6 |
| Summarize | Per-node Assemble variant: compress an existing long file. | Plan §6 |
| Usage heatmap | Reads per node across sessions → unpin/prune suggestions. Shows what the agent *actually* reads vs what you told it to read. | FEATURES 6.9 |
| Warmth | Theme temperature variant set via `data-warmth` on `<html>`: `neutral` / `warm` (recommended default) / `brown`. Swaps only the surface/border/text ramps; accents are shared. | DESIGN_SPEC; `src/styles/tokens.css` |

## Architecture terms

| Term | Definition | Where it lives |
|---|---|---|
| Capabilities | Tauri's deny-by-default native permission system. Any plugin permission beyond `core:default` / `opener:default` must be listed in `src-tauri/capabilities/default.json` or the call silently fails at runtime. | `src-tauri/capabilities/default.json`; CLAUDE.md |
| Atomic write | `write_atomic`: writes a temp file in the target directory, then renames into place (remove-first on Windows) — a crash never leaves a torn `graph.json` or node file. Both write commands use it. | `src-tauri/src/project.rs` |
| Command (Tauri) | A `#[tauri::command]` Rust fn callable from JS. Adding one takes three coordinated edits: the fn, its `generate_handler![...]` entry, and the matching `invoke` call in TS. Five exist today: `scan_project`, `read_graph`, `write_graph`, `read_md_file`, `write_md_file`. | `src-tauri/src/lib.rs`, `project.rs` |
| CSP | Content-Security-Policy; currently `null` in `tauri.conf.json`. Tightening it is backlog 9.8 — why fonts are self-hosted, never CDN-linked. | `src-tauri/tauri.conf.json`; FEATURES 9.8 |
| Event pipeline | The one-way flow: Rust emits → Tauri `emit` (`barn://event`) → Zustand store → both views react. React Flow and PixiJS never import each other. | CLAUDE.md; Plan §2 |
| FS boundary | All filesystem access goes through Rust commands; the webview never touches paths directly — it only passes back paths it got from Rust or the native dialog. | CLAUDE.md; `src-tauri/src/project.rs` |
| Graph persistence | Store mutations mark the graph `dirty`, a 700ms debounce serializes it and invokes `write_graph` (atomic). Save state: `idle` / `dirty` / `saving` / `saved` / `error` (`SaveState`). | `src/store/graph.ts` |
| Hooks (Claude Code) | `PostToolUse` / `UserPromptSubmit` / `Stop` entries Cowtext writes into a user project's `.claude/settings.json`; each `curl -s -m 1 -X POST`s hook JSON to the hooks server. `\|\| true` guarantees hooks never block Claude Code when the app is closed. | Plan §7; Phase 4 |
| Hooks server | Planned axum HTTP server in `src-tauri/src/hooks_server.rs`, bound to `127.0.0.1:4923`, `POST /event`. Parses hook JSON (`hook_event_name`, `tool_name`, `tool_input.file_path`, `session_id`) → `BarnEvent` → `app.emit`. | Plan §7; Phase 4 |
| invoke | `invoke("command_name", { args })` from `@tauri-apps/api/core` — the frontend's only way to call Rust. Args are camelCase in JS, snake_case in Rust; Tauri converts. | `src/store/project.ts` |
| IPC | The two-process split: frontend (`src/`, webview) ↔ backend (`src-tauri/src/`, Rust) over Tauri's inter-process channel — `invoke` inbound, `emit` outbound. | CLAUDE.md |
| Port 1420 | Vite dev port, pinned with `strictPort: true` in *both* `vite.config.ts` and `tauri.conf.json` — if occupied, `tauri dev` fails rather than drifting. Change both together. | CLAUDE.md; `vite.config.ts` |
| Port 4923 | Localhost port of the hooks server (`127.0.0.1:4923`). Port-conflict handling (pick a free port, inject into the hook command) is FEATURES 6.6. | Plan §7 |
| Path guard | `resolve_within_root`: every webview-supplied relative path is resolved lexically against the project root — absolute paths, `..`, drive prefixes, and UNC paths are rejected before touching the filesystem. | `src-tauri/src/project.rs` |
| scan_project | Rust command that recursively scans a folder for `.md` files, skipping hidden dirs and `SKIP_DIRS` (`.git`, `node_modules`, `target`, `dist`, …); returns `ProjectScan { root, files }` with sizes and mtimes. | `src-tauri/src/project.rs` |
| Store (Zustand) | The single state source both views subscribe to. Two stores today: `useProjectStore` (open folder + `.md` scan, `src/store/project.ts`) and `useGraphStore` (nodes, edges, selection, pending connection, persistence — `src/store/graph.ts`). | `src/store/`; Plan §3 |
| Trust boundary | Writing hooks into a user project's `.claude/settings.json`. Always shown as a confirmation diff — never silent. | CLAUDE.md; FEATURES 6.1 |
| `windows_subsystem = "windows"` | Attribute in `main.rs` that suppresses the console window in release builds; use `npm run tauri dev` to see `println!` and panics. | `src-tauri/src/main.rs`; CLAUDE.md |

## Frontend tech

| Term | Definition | Where it lives |
|---|---|---|
| @fontsource (×3) | Self-hosted font packages: `@fontsource/ibm-plex-sans`, `@fontsource/jetbrains-mono`, `@fontsource/silkscreen`. Bundled — no CDN font links, ever (offline rendering + survives CSP tightening). | `package.json`; DESIGN_SPEC |
| @tauri-apps/api 2 | JS bindings to the Tauri core (`invoke`, events). | `package.json` |
| @tauri-apps/cli 2 | Dev CLI behind `npm run tauri dev` / `tauri build`. | `package.json` (dev) |
| @tauri-apps/plugin-dialog 2 | Native dialogs; used for the "Open project folder" directory picker. | `package.json`; `src/store/project.ts` |
| @tauri-apps/plugin-opener 2 | Opens paths/URLs with the OS default handler (scaffold default). | `package.json` |
| CodeMirror 6 | Raw markdown editor for the inspector panel. Installed as `@codemirror/state` / `view` / `language` / `commands` / `lang-markdown` + `@lezer/highlight`; the inspector UI itself is in-progress Phase 1 work. | `package.json`; FEATURES 3.1 |
| dagre / elk *(planned, P6)* | Auto-layout engine for the "tidy" button. Choice not yet made. | FEATURES 2.11 |
| howler.js *(planned, P5)* | Barn SFX: sound sprites, volume ducking. | Plan §2 |
| lucide-react | Stroke icon set (24 grid, 1.5px at 16px) for all app chrome. Role glyphs are in-repo SVG regardless. Approved by Marty 2026-08-15. | `package.json`; DESIGN_SPEC |
| PixiJS 8 *(planned, P5)* | WebGL 2D renderer for the barn scene. Explicitly no Three.js, no real 3D — 16-bit isometric is a 2D problem. | Plan §2 |
| React 19.1 | UI framework. Plan §2 said React 18; the scaffold installed 19.1 and it was kept — check ecosystem integration notes against 19 before trusting plan-era guidance. | `package.json`; CLAUDE.md |
| React Flow (@xyflow/react) 12 | Node-graph canvas. Custom node/edge components live in `src/canvas/` (`MemoryNodeCard`, `MemoryEdge`, `KindPicker`, `RoleGlyphs`); view types in `src/canvas/types.ts` map from the store's domain model — React Flow never owns the state. | `package.json`; `src/canvas/` |
| Tailwind CSS 3.4 | Utility-first styling, themed from the design tokens; with `postcss` + `autoprefixer`. | `package.json`; `tailwind.config.js` |
| TypeScript ~5.8 | `strict: true`, no `any`; `noUnusedLocals` / `noUnusedParameters` are on, so unused variables break the build. `tsc` is the only frontend check today. | `tsconfig.json`; CLAUDE.md |
| Vite 7 | Dev server (`:1420`, strictPort) and bundler. `src-tauri/**` is excluded from its watcher — Rust rebuilds via cargo, not HMR. | `vite.config.ts` |
| Vitest *(planned, P4)* | Store unit tests + one end-to-end smoke test. | FEATURES 9.6 |
| Zustand 5 | State store library — one store, two views (React Flow canvas + Pixi scene) subscribe. | `package.json`; Plan §2 |

## Rust tech

| Term | Definition | Where it lives |
|---|---|---|
| axum *(planned, P4)* | HTTP framework for the hooks server on `127.0.0.1:4923`. | Plan §2, §7 |
| cargo clippy | Lint gate: `cargo clippy -- -D warnings` must pass (warnings are errors). | CLAUDE.md |
| cowtext_lib | The crate's lib name (`crate-type = ["staticlib", "cdylib", "rlib"]`); suffixed `_lib` to avoid a bin-name clash on Windows. `main.rs` is a thin shim calling `cowtext_lib::run()`. | `src-tauri/Cargo.toml`, `main.rs` |
| notify *(planned, P2)* | FS-watch crate for external-change detection (reload or conflict banner when dirty). | Plan §2; FEATURES 3.5 |
| serde / serde_json | Serialization; `#[serde(rename_all = "camelCase")]` on command return types gives JS its casing. | `Cargo.toml`; `project.rs` |
| tauri 2 | The app shell: tiny binary, native FS, in-process localhost server, plugin system. `tauri::Builder` chain in `lib.rs::run()` registers plugins + the `invoke_handler`. | `Cargo.toml`; `src-tauri/src/lib.rs` |
| tauri-build | Build-dependency that generates the Tauri glue at compile time. | `Cargo.toml`; `build.rs` |
| tauri-plugin-dialog / -opener 2 | Rust halves of the dialog and opener plugins, registered in the builder chain. | `Cargo.toml`; `lib.rs` |
| tokio *(planned, P3–4)* | Async runtime for the event pipeline and the `claude -p` child-process queue. | Plan §2 |

## Design terms

| Term | Definition | Where it lives |
|---|---|---|
| "Blue is you, amber is the cow" | The one rule that decides the rest: scarf blue (`--accent` #4C9BE8) marks everything the *user* initiates; hay amber (`--amber` #E8A33D) marks everything the *agent* does on its own. Two accents, never mixed on one control. | DESIGN_SPEC |
| Border-first elevation | In a 95%-dark app shadows are nearly invisible — surface step + border do the work. If it doesn't overlap something, it gets no shadow. Five levels: `elev-0` (flush) → `elev-4` (modal, palette). | DESIGN_SPEC |
| Compact density | Default density: 28px rows/controls (Comfortable = 34px) — the window lives next to a terminal all day. Top bar 44px, inspector 392px, node card 244px fixed. | DESIGN_SPEC |
| Design tokens | Semantic CSS variables (`--surface-1`, not `gray-900`) for every colour, radius, elevation, and motion value. Values source of truth: `docs/design/tokens.css` + `docs/design/tailwind.config.js`; app copy in `src/styles/tokens.css`. | `docs/design/`; `src/styles/tokens.css` |
| Focus ring | `0 0 0 2px var(--surface-1), 0 0 0 4px var(--accent)` — inner ring punches a gap so it reads on any background. `:focus-visible` only; never removed. | DESIGN_SPEC |
| Live-read pulse | Amber node state while the agent reads it: pulsing 2px amber ring (1600ms), amber stripe replacing the role stripe, blinking amber square. Reduced-motion drops the animation, keeps the static amber markers. | DESIGN_SPEC |
| Moving vs static amber | Static amber = warning; **moving** amber = live agent activity. | DESIGN_SPEC |
| Node states | Rest / Hover / Selected (2px accent ring) / Live-reading (amber) / Assembling (accent progress) / Assembled (success flash, 600ms) / Stale-error (badge; red stripe on error). | DESIGN_SPEC |
| Pixel march | The loading indicator: a 4-step amber pixel march (8px squares, staggered blink) with a Silkscreen caption ("the cow is reading"). Never a spinner. | DESIGN_SPEC |
| Radius ramp | 2/3/4/6/8px — one step sharper than web-normal; pill only for toggle tracks and status dots; nothing rounder than 8px. | DESIGN_SPEC |
| Role colours | Redundant coding: the 8×8 glyph is the primary identifier; lightness staggered so the seven-role set survives deuteranopia and greyscale. Roles own hue — edges are neutral by rule. | DESIGN_SPEC; `tokens.css` |
| Role glyphs | Seven hand-authored 8×8 pixel glyphs, `shape-rendering: crispEdges`, recreated in-repo (`src/canvas/RoleGlyphs.tsx`, pixel maps → SVG) — no icon dependency. The only non-stroke iconography in the app. Design-project originals in `Cowtext Spec.dc.html`. | DESIGN_SPEC; `src/canvas/RoleGlyphs.tsx` |
| Rules of the line | The allowed/banned list for pixel charm: allowed in role glyphs, full-page empty states, the pixel march, the LIVE tag/HUD, sharp handles; banned as UI fonts, panel textures, chrome mascots, wood/hay fills, bevels. | DESIGN_SPEC |
| Silkscreen rule | The pixel font is the barn's voice, with exactly three sanctioned uses: LIVE/READING tags, the barn HUD, the logo. Never for UI text. | DESIGN_SPEC |
| Surface ramp | `--surface-canvas` → `--surface-0…3` + `--surface-inset` (recessed wells: editor, diff). Warm dark greys pulled toward hay; borders are the primary elevation tool. | `tokens.css`; DESIGN_SPEC |
| Typography stack | IBM Plex Sans for all UI; JetBrains Mono for anything the filesystem or the model produced (paths, tokens, diffs, chips); Silkscreen per its rule. Default size 13px. | DESIGN_SPEC |

## File artifacts

| Term | Definition | Where it lives |
|---|---|---|
| `.claude/settings.json` | The *user project's* Claude Code config, where Cowtext installs its hooks — always behind a confirmation diff (trust boundary). | Plan §7; user project |
| `.cowtext/` | Per-project data directory inside the *user's* project, git-friendly (committed by default). Will also hold `presets/`, `history/`, `prompts/`. | Plan §3; FEATURES |
| `.cowtext/graph.json` | The graph — source of truth for *structure* (nodes, edges, targets). Any schema change bumps `version` and adds a migration. Stable serialization (sorted keys, LF) planned for clean git diffs. | Plan §3, §4; CLAUDE.md |
| `.cowtext-preset.json` | Single-file preset export/import format (structure + briefs, no content). | FEATURES 8.6 |
| `.cursor/rules/*.mdc` | Cursor compile output: pinned → `alwaysApply: true`, conditional glob → `globs:` front-matter. Off by default in the target picker. | Plan §5 |
| `AGENTS.md` | Compile output of the `agents` adapter: same content as `CLAUDE.md` but plain markdown links; nested per directory where a conditional glob maps cleanly. | Plan §5 |
| `CLAUDE.md` (generated) | Compile output of the `claude` adapter in a user project: pinned nodes in `readOrder` as `@context/<file>.md` imports; references/conditionals become "when working on X, read Y" lines. | Plan §5 |
| `CLAUDE.md` (this repo) | Cowtext's own project instructions for Claude Code sessions — hard rules, commands, architecture, status line updated every session. Not generated. | repo root |
| `context/*.md` | The Memory Node files themselves — content source of truth, default location (configurable). The claude adapter pins them as `@context/*.md`. | Plan §3; user project |
| GENERATED header | Line 1 of every compiled file: `<!-- GENERATED BY COWTEXT — edit the graph or context/*.md, not this file -->`. Never editable; tamper detection (body hash) planned. | Plan §5; FEATURES 4.4, 4.8 |
| `HANDOFF.md` | Output of the Handoff button — session summary a next agent/chat can pick up. | Plan §9 P6 |
| `COWTEXT_VIBECODE_PLAN.md` | The full authoritative product spec (outside this repo, in `D:\Moo.exe\_Documents\Cowtext\`). §2 stack, §4 data model, §5 adapters, §8 scene, §9 phases. | `_Documents`; CLAUDE.md |
| `docs/design/tokens.css` + `tailwind.config.js` | Paste-ready design implementation files — the source of truth for token *values*; DESIGN_SPEC records the decisions around them. | `docs/design/` |
