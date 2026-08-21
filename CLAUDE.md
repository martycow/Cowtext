# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# COWTEXT — desktop context-graph editor (Tauri 2 + React + PixiJS)

**Cowtext is a context compiler for AI coding agents** (positioning per the 2026-08-19 v2 replan; orchestration is a feature, not the pitch). An AI-agent context is a visual graph of Memory Nodes — each node is a real `.md` file in the user's project. Wire nodes together, **Compile** to generate `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` from one source of truth, **Assemble** to expand one-line briefs into full files via headless `claude -p`. On top sits a 16-bit isometric PixiJS barn scene driven live by Claude Code hooks.

## Hard rules

- Stack is fixed (§2). Do not add libraries without asking.
- Work strictly within the current phase (§9). Do not implement future phases early.
- React Flow and PixiJS both read from the Zustand store; they never import each other. Rust emits events → Tauri `emit` → store → both views react.
- All FS access goes through Rust commands; the webview never touches paths directly.
- Generated files (`CLAUDE.md`, `AGENTS.md` in user projects) always carry the GENERATED header.
- Rust: `cargo clippy -- -D warnings` must pass. TS: `strict: true`, no `any`.
- Compile never writes without diff-preview approval. Writing hooks into a user project's `.claude/settings.json` always shows a confirmation diff — that is a trust boundary.
- Any schema change to `graph.json` bumps `version` and adds a migration.
- Sprites/SFX are assets, not code: never generate base64 blobs into source files.
- All project documentation `.md` lives in `docs/`. Only `CLAUDE.md` and `README.md` stay at the repo root. Never drop notes, plans, or reports elsewhere. Fleet config under `.claude/` (agents, skills, memory, commands) is machine configuration, not documentation, and is exempt. Scratch notes go in the session scratchpad, outside the repo. The `docs-guard` hook enforces this on Edit/Write **and** Bash — if it blocks you, fix the path or say the rule is wrong; never route the write around it.
- If stuck > 3 attempts on the same bug: stop, write down the failing assumption, ask Marty.

## Commands

```powershell
npm run tauri dev      # run the app (Vite on :1420, then cargo run)
npm run tauri build    # production bundle
npm run build          # tsc typecheck + vite build (frontend only)
npm run lint           # ESLint 10 flat config (eslint.config.js)
cargo clippy -- -D warnings   # from src-tauri/
```

Frontend checks are `tsc` (strict; `noUnusedLocals`/`noUnusedParameters` on, so unused variables break the build) plus ESLint (`no-explicit-any` is an error; react-hooks pinned to classic rules-of-hooks + exhaustive-deps — the full React-Compiler rule set in eslint-plugin-react-hooks v7 is deliberately NOT enabled, see comment in `eslint.config.js`). No frontend test runner yet.

## Architecture

Two processes over Tauri IPC. Frontend (`src/`) calls Rust via `invoke("command_name", { args })`; backend (`src-tauri/src/`) has a thin `main.rs` shim calling `lib.rs::run()`, where the `tauri::Builder` chain registers plugins and the `invoke_handler` command list.

Adding a Rust command takes three coordinated edits: the `#[tauri::command]` fn in `lib.rs`, its entry in `tauri::generate_handler![...]`, and the `invoke` call by that exact fn name in TypeScript. Args are camelCase in JS, snake_case in Rust; Tauri converts.

Native capabilities are deny-by-default. Any plugin permission beyond `core:default` / `opener:default` must be added to `src-tauri/capabilities/default.json` or the call is rejected at runtime — a common cause of "the command exists but does nothing".

Target layout (§3) — build toward this, don't create empty dirs ahead of the phase that needs them:

```
src-tauri/src/  hooks_server.rs (axum :4923 POST /event) · project.rs (scan .md, graph.json) · compile.rs (adapters)
src/            store/graph.ts (Zustand) · canvas/ (React Flow) · inspector/ · scene/ (Pixi) · compile/ · handoff/
```

Per-project data lives inside the *user's* project folder, git-friendly: `.cowtext/graph.json`, `context/*.md`, generated `CLAUDE.md` / `AGENTS.md`.

## Scaffold constraints

- Dev port is pinned to 1420 with `strictPort: true` in both `vite.config.ts` and `tauri.conf.json`. If it's occupied, `tauri dev` fails rather than picking another port — change both files together or free the port.
- `src-tauri/**` is excluded from Vite's watcher; Rust changes rebuild via cargo in `tauri dev`, not HMR.
- `windows_subsystem = "windows"` in `main.rs` suppresses the console in release; use `tauri dev` to see `println!` and panics.
- CSP is defined in `tauri.conf.json` with production-grade `csp` and relaxed `devCsp` for local development.

## Docs & fleet

- `docs/` layout: `TERMINOLOGY.md` is the canon (module map, the invoke commands (75), the four Tauri events, key terms — keep ≤ 120 lines); full definitions live in `TERMINOLOGY_REFERENCE.md`. `tasks/` holds exactly TASKS / BACKLOG / BUGS / ROADMAP (milestones and the sprint log are sections inside ROADMAP.md; the feature inventory is a section inside BACKLOG.md). `design/` = design specs, `testing/` = manual test scripts, `fleet/` = ROSTER.md + ACTIVITY_LOG.md (three most recent sessions only).
- `docs/_archive/` is history: files get there only via `git mv` (contracts/, research/, superseded/) — never delete docs, archive them.
- The agent fleet is 6+1 agents in `.claude/agents/` (tech-lead, tech-general, tech-ui, tech-barn, tester, project-manager + product-analyst outside the default fleet), dispatched by the `/ultracode` skill; domain knowledge is preloaded via the skills in `.claude/skills/` (cowtext-terminology, design-tokens, art-direction, sound-design, manual-format, task-format). Roster and lanes: `docs/fleet/ROSTER.md`.

## Status

**V2 REPLAN IN EFFECT (2026-08-19)** — positioning: *Cowtext is a context compiler for AI coding agents*; four-layer plan (L1 graph / L2 orchestrator / L3 workflows / L4 observability+barn) in ROADMAP.md, strategy per `Cowtext_Strategy_2026.pdf`. All seven phases (0–6) accepted; WO01 closed; WO02 committed `103ac80`; WO03 LANDED; WO06 LANDED; WO09 LANDED; WO10 LANDED; WO11 LANDED 2026-08-20; WO12 LANDED 2026-08-20; **WO13 gates green 2026-08-21** — three refactors (node taxonomy 13→14, edge model 7→5, agent modal structure), graph schema v4→v5 with migration, new emitter `.claude/commands/`, `resolveLoad` collapse, Vitest frontend tests, `fs_apply_batch` with rollback. Invoke **74→75**; **770 Rust tests** (all green: 736 lib + 18 CLI + 16 MCP); **163 frontend Vitest tests** (12 files); `tsc` clean; `eslint` 0 errors. Tech-lead audit found 16 defects (D1–D16, Amendment 4), all fixed; two zone-violation incidents recorded (cross-lane file clobbering, need pre-lane stage-0 manifests); four grid gaps (unassigned files: `src/scene/sfx.ts`, `src/store/events.ts`, `src-tauri/src/bin/*.rs`, `src-tauri/src/handoff.rs`). Standing lesson: **the gate is the authority, not the enumeration** — all three §18.1 exception lists were incomplete, each missing output changes specified elsewhere in the contract; all lanes implemented both halves faithfully. Standing lesson #2: mirror pairs (Rust↔TS) agree with each other but both diverged from spec (two instances); always audit mirrors against contract text, never against twins. True sequence: WO03 ✅ → WO06 ✅ → WO09 ✅ → WO10 ✅ → WO11 ✅ → WO12 ✅ → **WO13 ✅** → WO04 → WO05 → WO07. **Acceptance walk pending**: Marty walks manuals (WO13 + WO12 + WO11 + WO10 + WO09 + WO03 + WO02 + WO01 all open). v0.1.0 cut gate = acceptance walks + real sprites (Marty-side).

Update this line at the end of every session.
