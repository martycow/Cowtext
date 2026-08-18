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

ALL SEVEN PHASES (0–6) CODE-COMPLETE AND ACCEPTED — Phases 0–2 accepted incrementally (Phase 2: 2026-08-16), Phase 3–6 acceptance walks passed 2026-08-18; milestones M0–M6 all reached. Current version **v0.0.0010** = the 2026-08-18 UX v3 pass on Marty's feedback (primary-agent session): ports fixed to true side-centers (the port CSS carried `position: relative` overriding React Flow's absolute placement — root cause of the misplaced connectors; now explicit `absolute + top:50% + translateY(-50%)`); cards shortened (minHeight 97→80, py-1.5) with the read-order badge moved OUT of the header row to a 30px bold-xl corner marker overhanging the top-right edge; Relations grid sortable (port = inputs-then-outputs / name / kind segmented control) and its rows highlight-on-hover echo the neighbour card (soft accent ring) and edge (selected stroke) on the canvas via new `useHighlightStore`; three-way selection sync — the file-rail row of the selected node is accent-tinted with an inset accent bar and scrolled into view; Inspector identity bar (glyph + bold title + mini order badge in the same accent language) always names the node being edited; hovering a mapped file-rail row highlights the node plus its whole neighbourhood (touching edges + far-end nodes) on the canvas (highlight store now holds id sets). Prior v0.0.0009 = the v2 pass: connector revert to ONE funnel input (left) + ONE funnel output (right) per card, `src/canvas/edgePath.ts` no-spaghetti routing (forward cubic; clearance-lane detours), direct file rename (editable Inspector File field + all "Rename file…" entries focus it), Relations grid, 26px badge. Prior v0.0.0008 = the UX batch landing: 4 new invoke commands (rename_node_file, reveal_path, probe_project_dirs, hooks_status; 23→27 total), 3 frozen-contract lanes, `docs/testing/UXBATCH_TEST_MANUAL.md` (revised in-place for v2), 3 major audit defects found and all fixed, pending Marty's manual acceptance walk. Prior: v0.0.0007 = 2026-08-17 ship-prep (`cb770d4`): production CSP + relaxed devCsp, code-split 1,334→207 kB, ESLint 10. Gates green: build, lint (0 errors/1 warning), clippy `-D warnings`, cargo test 98/98, invoke contract 27 commands. **Next version: v0.1.0** (first public cut) — remaining: real sprites (Aseprite originals per `docs/design/ART_DIRECTION.md`, Marty-side, BACKLOG P1), CSP runtime check under production build (TASKS), UX batch manual acceptance walk (TASKS), then the tagged cut. 2026-08-18 docs+fleet session (earlier): docs/ reorganized (13 files archived to `docs/_archive/`; FEATURES→BACKLOG, MILESTONES+SPRINTS→ROADMAP; TERMINOLOGY split into canon+REFERENCE, invoke count corrected 14→23); 6+1 fleet in `.claude/agents/` + 5 skills + `/ultracode` dispatcher; 8 deferred ideas from UX batch now in BACKLOG (i18n, music, launcher, edge-color, dockable-panel, sub-agent-mgmt + 2 already there).

Update this line at the end of every session.
