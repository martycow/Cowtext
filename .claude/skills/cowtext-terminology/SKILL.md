---
name: cowtext-terminology
description: Canonical Cowtext vocabulary — module map, the 73 invoke commands, the four Tauri events, and the terms every agent must use consistently. Load before writing code, docs, or reports so names stay byte-exact. Full definitions live in docs/TERMINOLOGY_REFERENCE.md.
---

# Cowtext canonical terminology

Source of truth: `docs/TERMINOLOGY.md` (canon) and `docs/TERMINOLOGY_REFERENCE.md`
(full definitions, design terms, tech stack). Use these names exactly; never invent
synonyms for existing terms.

## Module map

| Module | Owns |
|---|---|
| `src-tauri/src/lib.rs` | Builder chain, plugin registration, `generate_handler!` list (73) |
| `src-tauri/src/project.rs` | `.md` scan, graph read/write, `write_atomic`, `resolve_within_root` |
| `src-tauri/src/compile.rs` | Five adapters (claude/agents/cursor/copilot/gemini), validation, topological order, write allowlist |
| `src-tauri/src/import.rs` | Importer: parse CLAUDE.md/AGENTS.md/.cursor rules → proposed graph changeset; never clobbers files |
| `src-tauri/src/lint.rs` | Linter v1: cycles, duplication, stale (lastVerified), conflict via explicit edges; reports as Problems |
| `src-tauri/src/assemble.rs` | `claude -p` queue (FIFO, max 2), Runner trait, `set_claude_override` |
| `src-tauri/src/hooks.rs` + `hooks_server.rs` | Hooks trust boundary; axum on `127.0.0.1:4923` |
| `src-tauri/src/settings.rs`, `preset.rs`, `handoff.rs` | App settings, presets (never-clobber), `HANDOFF.md` |
| `src-tauri/src/tasks.rs` | Task DAG, stable task ids (reserved `id:` tags), cycle detection, dependency validation |
| `src-tauri/src/tasklinks.rs` | Tasklinks sidecar v1 (`.cowtext/tasklinks.json`): task↔node↔session bindings, ancestry, per-task ceilings |
| `src-tauri/src/taskctx.rs` | Per-task subgraph injection: closure rule, compile-on-launch, deterministic preview |
| `src/store/` | Zustand: `useProjectStore`, `useGraphStore`, `useEventsStore`, `useSettingsStore` |
| `src/canvas/`, `src/inspector/`, `src/compile/` | React Flow view, inspector + EventLog + HooksModal, CompileModal + LCS diff |
| `src/scene/` | Pixi barn + `sfx.ts` (howler confined here) |
| `src/settings/`, `src/preset/`, `src/handoff/` | SettingsModal, preset & handoff UI |

## Invoke commands (73) — byte-exact names

project: `scan_project`, `read_graph`, `write_graph`, `read_md_file`, `write_md_file`, `rename_node_file`, `reveal_path`, `probe_project_dirs`
· git: `git_status`, `git_init`, `gitignore_write`
· compile: `compile_preview`, `compile_write`
· import: `import_scan`, `import_apply`
· lint: `lint_run`
· assemble: `assemble_node`, `refine_node`, `summarize_node`, `assemble_status`, `assemble_cancel`
· hooks: `hooks_preview`, `hooks_write`, `hooks_status`
· settings: `read_app_settings`, `write_app_settings`
· preset: `preset_save`, `preset_list`, `preset_read`, `preset_export`, `preset_apply`
· handoff: `handoff_generate`, `handoff_write`, `handoff_node_propose`
· agents: `agents_scan`, `agent_create`, `agent_save`, `agent_rename`, `agent_delete`, `agent_convert`, `agent_memory_ensure`, `agent_avatar_set`, `agent_avatar_read`, `agent_avatar_clear`, `agent_memory_status`, `skill_create`, `skill_save`, `skill_rename`, `skill_delete`, `agents_meta_write`
· tasks: `tasks_scan`, `task_toggle`, `task_update`, `task_append`, `task_move`, `task_id_ensure`, `task_depends_add`, `task_depends_remove`
· tasklinks: `tasklinks_read`, `tasklink_set`, `tasklink_delete`
· taskctx: `task_context_preview`, `task_context_write`
· worktree: `worktree_check`, `worktree_add`
· sessions: `agent_session_spawn`, `agent_session_send`, `agent_session_kill`, `agent_session_restart`, `agent_session_list`

Adding one = three coordinated edits (fn + `generate_handler!` entry + TS `invoke`
name). camelCase in JS ⇄ snake_case in Rust.

## Events

- `barn://event` — `BarnEvent { kind, filePath?, sessionId, ts }`: hooks_server → emit
  → `useEventsStore.pushEvent` → canvas pulse + barn.
- `assemble://status` — `AssembleProgress { nodeId, mode, status, error }`: assemble.rs
  → emit → `useGraphStore.setAssembleStatus`.
- `fs://change` — `FsChange { relPath, modifiedMs, sizeBytes, kind }`: watcher → emit
  → `useProjectStore.applyFsChange` → lens updates.
- `agent://event` — `{ id, kind, status?, tool?, text?, usage?, ts }`: sessions.rs
  → emit → event stream, inspector transcript, status badges. `kind` includes `"budget"` when token ceiling is reached (WO06).
- One-way pipeline: Rust emits → store → both views react. React Flow and PixiJS
  never import each other.

## Canon terms (use exactly these)

- **Memory Node** — graph node backed by a real `.md` file; the file on disk is the
  content source of truth. Roles: `agent`, `rules`, `architecture`, `workflow`,
  `task`, `reference`, `glossary`, `command`, `invariant`, `trap`, `skill`, `snippet`, `style`.
- **Edge kinds** — **Structural** (cycle validation + topological order): `imports` (inline), `sequence` (order only), `overrides` (target-before-source). **Advisory** (linter only): `references` (soft link), `conditional` (glob/NL condition), `supersedes`, `conflicts-with`.
- **Pinned / effective-pinned** — always-in-context flag; effective set = pinned +
  transitive `imports` closure — **excludes `overrides`** (affects order, not pinned).
- **readOrder** — manual tie-break inside Kahn's topological order, pops by `(readOrder, id)`.
- **BarnGraph** — `graph.json` shape (`version: 3`); v2→v3 adds roles 7→13, edges 4→7, tags/owner/meta/color; any schema change bumps `version` and adds a migration.
- **Compile** — one graph → `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/*.mdc` / `.github/copilot-instructions.md` / `GEMINI.md`; never writes without diff-preview approval. **GENERATED header** — line 1 of every compiled file; its absence marks a file handwritten. **Write allowlist** — `compile_write` accepts only compile-output shapes. **Errors XOR files** — `compile_preview` returns validation errors or preview files, never both.
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
- **Stable task id** — a task's persistent identity `t-[0-9a-z]{6}` lifted from the reserved `id:` tag; minted on-demand via `task_id_ensure`, never auto-minted, survives file edits and task moves. Distinguished from volatile `id` locator `<relPath>#<line>`.
- **TaskLinks sidecar** — `.cowtext/tasklinks.json` v1: per-task entries binding `taskId` to `nodeIds[]` (seeds), `sessionIds[]` (durable UUIDs), optional `parentTaskId` (goal ancestry), optional `tokenCeiling`. Written only by Rust; deterministic (sorted, deduped, `skip_serializing_if`).
- **Task context / subgraph injection** — compiled context for one task alone: THE differentiator. Seed nodes (linked via tasklinks) + ancestry (via parentTaskId, depth ≤8) + globally pinned → transitive `imports` closure → synthesized `BarnGraph` → `compile_preview` on that subgraph → body injected over stdin at session spawn (32 KB cap).
- **Session token ceiling** — per-task optional limit (`tasklinks[taskId].tokenCeiling`); global default fallback (`AppSettings.sessionTokenCeiling`, default 200,000; `0` = unbounded). Enforced by `charge()` which returns `Stop` inside one lock, bumping generation to gate all later emits.

"FEATURES n.n" references resolve to the Feature inventory section of
`docs/tasks/BACKLOG.md`.
