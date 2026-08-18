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

ALL SEVEN PHASES (0–6) CODE-COMPLETE AND ACCEPTED — Phases 0–2 accepted incrementally (Phase 2: 2026-08-16), Phase 3–6 acceptance walks passed 2026-08-18; milestones M0–M6 all reached. Current version **v0.1.0** (FIRST PUBLIC CUT, declared by Marty 2026-08-18; version scheme leaves v0.0.NNNN) = the Agents-on-the-graph unification (primary agent + one tech-general Rust lane, on Marty's feedback): the former `persona` role IS now the `agent` role — graph.json bumped v1→v2 with automatic role migration (presets v1/v2 both accepted); the Agents modal is RETIRED — AGENTS/SKILLS sections live in the left rail (mini avatars, create, adopt-to-graph, inline-confirm delete) and the full agent editor renders in the Inspector (agent-backed nodes get AgentNodePanel; off-graph agents/skills get a standalone panel; legacy agent-role nodes get a Convert-to-agent-file banner → new `agent_convert` command, invoke 37→38); scan now includes `.claude/agents/*.md` (rest of `.claude/` still excluded); agent renames route through the agents layer with a rename-listener keeping node filePath/title in sync; Compile emits a managed COWTEXT CONTEXT block into each adopted agent's file from its outgoing imports/references edges (marker-delimited surgical write, diff-previewed; `.claude/agents/*.md` allowlisted with marker-requirement instead of GENERATED header — ratified extension); agent cards wear identity avatars on canvas. Gates green: build, lint (0 errors/1 pre-existing warning), clippy `-D warnings`, cargo test 158/158 (+15), tsc strict. AGENTS_TEST_MANUAL revised in place. Prior **v0.0.0011** = the 2026-08-18 Agents Suite landing (fleet session, tech-lead + 3 tech-general + tech-ui + tech-barn + tester): 10 new invoke commands (agents_scan, agent_*/skill_* CRUD, agents_meta_write; 27→37 total), hand-rolled frontmatter parser with byte-identity round-trip (no regex/YAML crate), stable agent identity via fnv1a32 hash (avatar 8×8 grid + accent role + calf visual props), named calves spawning on SubagentStop with session-stable appearance, sidecar agents.json schema (v1) with metadata persistence + orphan retention. 40 new tests (frontmatter 23 + agents 18 + project 1 = 143/143 total after 2 regression tests added in fix round). Manual written: `docs/testing/AGENTS_TEST_MANUAL.md` (53 steps, 4 audit defects found and ALL fixed: frontmatter re-quote churn, orphan-key precedence race, case-insensitive rename, inline-save phase bypass). Gates green: build, lint (0 errors, 1 pre-existing warning), clippy `-D warnings`, cargo test 143/143, invoke 37/37 verified by grep. Pending manual acceptance. Prior v0.0.0010 = the 2026-08-18 UX v3 pass (primary-agent session on Marty's feedback): port CSS fixes, card heights/badge relocation, Relations grid sortable + highlight-on-hover, three-way selection sync, file-rail accent tinting, `useHighlightStore` for neighbourhood highlighting. Prior v0.0.0009 = v2 pass: connector funnel simplification, no-spaghetti cubic routing, direct file rename, Relations grid debut, 26px badge. Prior v0.0.0008 = UX batch landing (4 new commands, 3 lanes, 3 major audit defects all fixed). Prior v0.0.0007 = 2026-08-17 ship-prep (production CSP + relaxed devCsp, code-split 1,334→207 kB, ESLint 10). **Post-v0.1.0 open items:** real sprites (Marty-side), CSP runtime check under a production build, manual acceptance walks for UX batch + Agents Suite, git tag for the cut. 2026-08-18 early docs+fleet session: docs/ reorganized (13 files archived; FEATURES→BACKLOG, MILESTONES+SPRINTS→ROADMAP; TERMINOLOGY split into canon+REFERENCE, invoke count corrected 14→23); 6+1 fleet in `.claude/agents/` + 5 skills + `/ultracode`; terminology module map now covers lib.rs (37 commands), all Rust/TS modules, events, design/stack/file-artifact terms.

Update this line at the end of every session.
