# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# COWTEXT — desktop context-graph editor (Tauri 2 + React + PixiJS)

A desktop app where an AI-agent context is a visual graph of Memory Nodes — each node is a real `.md` file in the user's project. Wire nodes together, **Compile** to generate `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` from one source of truth, **Assemble** to expand one-line briefs into full files via headless `claude -p`. On top sits a 16-bit isometric PixiJS barn scene driven live by Claude Code hooks.

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
- All project documentation `.md` lives in `docs/`. Only `CLAUDE.md` and `README.md` stay at the repo root. Never drop notes, plans, or reports elsewhere.
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

- `docs/` layout: `TERMINOLOGY.md` is the canon (module map, 27 invoke commands, events, key terms — keep ≤ 120 lines); full definitions live in `TERMINOLOGY_REFERENCE.md`. `tasks/` holds exactly TASKS / BACKLOG / BUGS / ROADMAP (milestones and the sprint log are sections inside ROADMAP.md; the feature inventory is a section inside BACKLOG.md). `design/` = design specs, `testing/` = manual test scripts, `fleet/` = ROSTER.md + ACTIVITY_LOG.md (three most recent sessions only).
- `docs/_archive/` is history: files get there only via `git mv` (contracts/, research/, superseded/) — never delete docs, archive them.
- The agent fleet is 6+1 agents in `.claude/agents/` (tech-lead, tech-general, tech-ui, tech-barn, tester, project-manager + product-analyst outside the default fleet), dispatched by the `/ultracode` skill; domain knowledge is preloaded via the skills in `.claude/skills/` (cowtext-terminology, design-tokens, art-direction, sound-design, manual-format). Roster and lanes: `docs/fleet/ROSTER.md`.

## Status

ALL SEVEN PHASES (0–6) CODE-COMPLETE AND ACCEPTED — Phases 0–2 accepted incrementally (Phase 2: 2026-08-16), Phase 3–6 acceptance walks passed 2026-08-18; milestones M0–M6 all reached. **Current version v0.1.0** (first public cut, declared 2026-08-18) gates: production CSP green, code-split 1,334→207 kB, ESLint 10 + lint script, all seven phases built. **In-flight: WO01 Block A (canvas lenses + watcher; 2026-08-18)** — Lane A (tech-general): Rust watcher (notify = 8, hand-rolled 300ms debounce, generation counter + starvation guards, EventKind mapping), `src-tauri/src/watcher.rs` + tests (6 new), Rust-side stores (`settings.ts` LensMode/lens, `events.ts` LENS_LIVE_WINDOW_MS/lensLiveTs, `project.ts` FsChange + applyFsChange), third `listen("fs://change")` in events.ts, TERMINOLOGY.md updated (100 lines, within ≤120 canon). Lane B (tech-ui): `src/canvas/lens.ts` (Activity/Weight/Live brightness formulas), `LensControl.tsx` (4-segment radio, 30s ticker, Activity-only legend), `MemoryNodeCard.tsx` (lens compute + custom props), wrapped in GraphCanvas. **Two defects found and BOTH FIXED in the fix round (rename-halves mapping + flush TOCTOU; cargo test 169/169, re-gate green):** MAJOR Windows notify rename leaves ghost entries (external rename → OLD path mapped to Modify never Remove → stale node with false "just modified" timestamp), MINOR TOCTOU race in flush generation guard (project switch mid-flush leaks old-project events, sub-millisecond window). Block A manual: `docs/testing/WO01_BLOCK_A_TEST_MANUAL.md` (29 steps, 15 min; defect repros documented as known-fails). Block A gates green: `npm run build` PASS, lint 0 errors, clippy clean, `cargo test` 164 passed (+6 new watcher tests, baseline 158), invoke still 38. **Protocol: stop for Marty review** — approve defects as v0.1.0-known-issues or defer; if approved, Block B begins (Compile lens integration). Post-v0.1.0 open: real sprites (Marty-side), CSP runtime check on production build, UX batch + Agents Suite manual walks, git tag for cut, WO01 Blocks B–F (canvas/compile/handoff/barn/activity lens integration + testing).

Update this line at the end of every session.
