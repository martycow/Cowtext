---
name: cowtext-terminology
description: Canonical Cowtext vocabulary — module map, the 42 invoke commands, the two Tauri events, and the terms every agent must use consistently. Load before writing code, docs, or reports so names stay byte-exact. Full definitions live in docs/TERMINOLOGY_REFERENCE.md.
---

# Cowtext canonical terminology

Source of truth: `docs/TERMINOLOGY.md` (canon) and `docs/TERMINOLOGY_REFERENCE.md`
(full definitions, design terms, tech stack). Use these names exactly; never invent
synonyms for existing terms.

## Module map

| Module | Owns |
|---|---|
| `src-tauri/src/lib.rs` | Builder chain, plugin registration, `generate_handler!` list (42) |
| `src-tauri/src/project.rs` | `.md` scan, graph read/write, `write_atomic`, `resolve_within_root` |
| `src-tauri/src/compile.rs` | claude/agents/cursor adapters, validation, topological order, write allowlist |
| `src-tauri/src/assemble.rs` | `claude -p` queue (FIFO, max 2), Runner trait, `set_claude_override` |
| `src-tauri/src/hooks.rs` + `hooks_server.rs` | Hooks trust boundary; axum on `127.0.0.1:4923` |
| `src-tauri/src/settings.rs`, `preset.rs`, `handoff.rs` | App settings, presets (never-clobber), `HANDOFF.md` |
| `src/store/` | Zustand: `useProjectStore`, `useGraphStore`, `useEventsStore`, `useSettingsStore` |
| `src/canvas/`, `src/inspector/`, `src/compile/` | React Flow view, inspector + EventLog + HooksModal, CompileModal + LCS diff |
| `src/scene/` | Pixi barn + `sfx.ts` (howler confined here) |
| `src/settings/`, `src/preset/`, `src/handoff/` | SettingsModal, preset & handoff UI |

## Invoke commands (42) — byte-exact names

project: `scan_project`, `read_graph`, `write_graph`, `read_md_file`, `write_md_file`, `rename_node_file`, `reveal_path`, `probe_project_dirs`
· compile: `compile_preview`, `compile_write`
· assemble: `assemble_node`, `refine_node`, `summarize_node`, `assemble_status`, `assemble_cancel`
· hooks: `hooks_preview`, `hooks_write`, `hooks_status`
· settings: `read_app_settings`, `write_app_settings`
· preset: `preset_save`, `preset_list`, `preset_read`, `preset_export`, `preset_apply`
· handoff: `handoff_generate`, `handoff_write`
· agents: `agents_scan`, `agent_create`, `agent_save`, `agent_rename`, `agent_delete`, `skill_create`, `skill_save`, `skill_rename`, `skill_delete`, `agents_meta_write`, `agent_convert`
· tasks: `tasks_scan`, `task_toggle`, `task_append`, `task_move`

Adding one = three coordinated edits (fn + `generate_handler!` entry + TS `invoke`
name). camelCase in JS ⇄ snake_case in Rust.

## Events

- `barn://event` — `BarnEvent { kind, filePath?, sessionId, ts }`: hooks_server → emit
  → `useEventsStore.pushEvent` → canvas pulse + barn.
- `assemble://status` — `AssembleProgress { nodeId, mode, status, error }`: assemble.rs
  → emit → `useGraphStore.setAssembleStatus`.
- One-way pipeline: Rust emits → store → both views react. React Flow and PixiJS
  never import each other.

## Canon terms (use exactly these)

- **Memory Node** — graph node backed by a real `.md` file; the file on disk is the
  content source of truth. Roles: `persona`, `rules`, `architecture`, `workflow`,
  `task`, `reference`, `glossary`.
- **Edge kinds** — `imports` (inline), `references` (soft link), `conditional`
  (glob/NL condition), `sequence` (ordering only).
- **Pinned / effective-pinned** — always-in-context flag; effective set = pinned +
  transitive `imports` closure. **readOrder** — manual tie-break inside Kahn's
  topological order, pops by `(readOrder, id)`.
- **BarnGraph** — `graph.json` shape (`version: 1`); any schema change bumps
  `version` and adds a migration.
- **Compile** — one graph → `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/*.mdc`; never
  writes without diff-preview approval. **GENERATED header** — line 1 of every
  compiled file; its absence marks a file handwritten. **Write allowlist** —
  `compile_write` accepts only compile-output shapes. **Errors XOR files** —
  `compile_preview` returns validation errors or preview files, never both.
- **Assemble / Refine / Summarize** — brief → full file via headless `claude -p`
  (stdin prompt, `--output-format json`).
- **Trust boundary** — any write into a user project's `.claude/settings.json`;
  always behind a confirmation diff.
- **The Barn** — Pixi 8 iso scene (2:1 tiles, Barnlight-29 palette); cow = agent,
  calves = subagents. **Demo mode** — DemoPlayer through the real store, DEMO badge.
  **Calm mode** — one toggle: no sound + reduced motion.
- **"Blue is you, amber is the cow"** — scarf blue = user-initiated, hay amber =
  agent activity; never mixed on one control.
- **Ports** — 1420 Vite dev (strictPort, pinned in two files); 4923 hooks server.
- **Capabilities** — Tauri deny-by-default; new plugin permissions go in
  `src-tauri/capabilities/default.json`.

"FEATURES n.n" references resolve to the Feature inventory section of
`docs/tasks/BACKLOG.md`.
