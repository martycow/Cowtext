# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# COWTEXT — desktop context-graph editor (Tauri 2 + React + PixiJS)

A desktop app where an AI-agent context is a visual graph of Memory Nodes — each node is a real `.md` file in the user's project. Wire nodes together, **Compile** to generate `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` from one source of truth, **Assemble** to expand one-line briefs into full files via headless `claude -p`. On top sits a 16-bit isometric PixiJS barn scene driven live by Claude Code hooks.

Full spec: `D:\Moo.exe\_Documents\Cowtext\COWTEXT_VIBECODE_PLAN.md`. Read the relevant section before implementing — the sections referenced below (§2 stack, §4 data model, §5 compile adapters, §8 scene spec, §9 phases) are authoritative.

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
cargo clippy -- -D warnings   # from src-tauri/
```

No linter or test runner is configured yet (`npm run lint` from the plan does not exist — add it when Tailwind/ESLint land). `tsc` is the only frontend check; `noUnusedLocals` and `noUnusedParameters` are on, so unused variables break the build.

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
- CSP is `null` in `tauri.conf.json`. Tighten before shipping.
- `src/App.tsx` and the `greet` command in `lib.rs` are `create-tauri-app` placeholder demo code — replace, don't build around.

## Deviations from the plan

- Plan §2 says React 18; the scaffold installed **React 19.1**. Kept — but check React Flow / Pixi integration notes against 19 before assuming plan-era guidance holds.

## Status

Phase: 0 done (accepted by Marty 2026-08-15) → next is Phase 1 (graph canvas: React Flow, nodes/edges, inspector, `.cowtext/graph.json`). Phase 0 delivered: Tailwind 3 + tokens dark shell (`src/styles/`), open-folder + `.md` scan (`src-tauri/src/project.rs` `scan_project`, Zustand store `src/store/project.ts`), tauri-plugin-dialog for the folder picker, 2 scanner tests. Design source of truth: `docs/design/`. Cold-start <2s not yet measured on a release build. Next: open-folder + `.md` scan, Tailwind dark shell.

Update this line at the end of every session.
