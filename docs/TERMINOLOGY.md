# Cowtext — Canonical Terminology

> Canon only: module names, invoke commands, events, and the terms every agent must use
> consistently. Full definitions, design terms, and the tech-stack sheet live in
> [`TERMINOLOGY_REFERENCE.md`](TERMINOLOGY_REFERENCE.md). Maintained by hand.

## Modules

| Module | Owns |
|---|---|
| `src-tauri/src/lib.rs` (+ `main.rs` shim) | `tauri::Builder` chain, plugin registration, `generate_handler!` command list (75); `main.rs` is `cowtext_lib::run()` + `windows_subsystem = "windows"` (unchanged) |
| `src-tauri/src/bin/cowtext_cli.rs` | CLI binary: `compile --check` (exit 0 clean / 1 drift / 2 usage), `lint`, `--json` |
| `src-tauri/src/project.rs` | `.md` scan, graph read/write (schema **v5**), `write_atomic`, `resolve_within_root`, `checked_root` |
| `src-tauri/src/project_meta.rs` | `.cowtext/project.json` v1 sidecar, `context/project.md` renderer, `project_init` scaffolder |
| `src-tauri/src/compile.rs` | Five adapters (claude/agents/cursor/copilot/gemini), validation, topological order, write allowlist |
| `src-tauri/src/import.rs`, `lint.rs` | Importer (CLAUDE.md/AGENTS.md/.cursor rules → proposed changeset, never clobbers) · Linter v1 (cycles, duplication, stale, conflicts → Problems) |
| `src-tauri/src/assemble.rs` | `claude -p` queue (FIFO, max 2), Runner trait seam, `set_claude_override` |
| `src-tauri/src/hooks.rs` | Hooks preview/write into user `.claude/settings.json` (trust boundary) |
| `src-tauri/src/hooks_server.rs` | axum on `127.0.0.1:4923`, `POST /event` → `BarnEvent` → emit |
| `src-tauri/src/settings.rs` | App settings persistence via `app_config_dir` (atomic, frontend owns shape) |
| `src-tauri/src/preset.rs` | Preset save/list/read/export/apply (never-clobber) |
| `src-tauri/src/handoff.rs` | `HANDOFF.md` generation via ClaudeRunner, GENERATED header |
| `src-tauri/src/resolve_load.rs` | Load policy: `resolveLoad` decider unifying three prior implementations (effective_pinned, taskctx walk, tokens.ts logic) into one authoritative function |
| `src-tauri/src/fsbatch.rs` | Batch FS apply with all-or-nothing rollback and inverse batch for Undo (`fs_apply_batch` command) |
| `src/store/` | Zustand stores: `useProjectStore`, `useGraphStore` (graph.ts), `useEventsStore` (events.ts), `useSettingsStore` (settings.ts) |
| `src/canvas/` | React Flow view: `MemoryNodeCard`, `MemoryEdge`, `KindPicker`, `RoleGlyphs`, plus five pure modules — `portSlots` (pins/slots), `edgePath` (router), `edgeEdit` (waypoints), `labelSlots` (label collisions), `edgeVerb`/`edgeColor` (label + palette) |
| `src/inspector/` | Inspector panel, `InspectorSection` (collapsible components), `EventLog`, `HooksModal`, AssembleSection |
| `src/compile/`, `src/settings/`, `src/preset/`, `src/handoff/`, `src/project/` | Feature UI: CompileModal + LCS `diff.ts` · SettingsModal · preset & handoff modals with clipboard variants · `ProjectWizard` (new / convert / edit) |
| `src-tauri/src/frontmatter.rs` | Frontmatter parser/emitter: read-patch-write round-trip with byte-identity invariant, line-level EOL tracking, no regex/YAML crate |
| `src-tauri/src/agents.rs` | Agent/skill CRUD, file creation, rename, delete, metadata write; validation (component/path guards), sidecar schema, `AGENT_FS` mutex for .claude/agents/ + .claude/skills/ write safety |
| `src-tauri/src/git.rs` | Git probe/init/`.gitignore` write, shells out to system `git`, `gitAvailable` fallback when git not on PATH |
| `src/git/` | GitWizard modal, `.gitignore` composer with presets, line-ending preservation, diff-preview gate |
| `src/identity/` | Identity hash (fnv1a32), avatar grid + accent/patch derivation, calf appearance generation |
| `src/agents/` | Agent/Skill manager UI: AgentAvatar, AgentList, AgentEditor, SkillEditor, AgentsModal (phase machine, lazy draft logic, orphan cleanup) |
| `src/scene/` | Pixi barn: `BarnScene.tsx`, `cow.ts`, `calf.ts`, `mapper.ts`, `demo.ts`, `palette.ts`, `iso.ts`, `sfx.ts` (howler confined here) |

## Invoke commands (75)

Adding one takes three coordinated edits: the `#[tauri::command]` fn, its
`generate_handler![...]` entry, the byte-exact `invoke` name in TS. camelCase in JS ⇄ snake_case in Rust.

| Group | Commands |
|---|---|
| project | `scan_project`, `read_graph`, `write_graph`, `read_md_file`, `write_md_file`, `rename_node_file`, `reveal_path`, `probe_project_dirs` |
| fs | `fs_apply_batch` |
| git | `git_status`, `git_init`, `gitignore_write` |
| agents | `agents_scan`, `agent_create`, `agent_save`, `agent_rename`, `agent_delete`, `agent_convert`, `agent_memory_ensure`, `agent_avatar_set`, `agent_avatar_read`, `agent_avatar_clear`, `agent_memory_status`, `skill_create`, `skill_save`, `skill_rename`, `skill_delete`, `agents_meta_write` |
| compile | `compile_preview`, `compile_write` |
| import / lint | `import_scan`, `import_apply`, `lint_run` |
| assemble | `assemble_node`, `assemble_preview`, `refine_node`, `summarize_node`, `assemble_status`, `assemble_cancel` |
| hooks | `hooks_preview`, `hooks_write`, `hooks_status` |
| settings | `read_app_settings`, `write_app_settings` |
| preset | `preset_save`, `preset_list`, `preset_read`, `preset_export`, `preset_apply` |
| handoff | `handoff_generate`, `handoff_write`, `handoff_node_propose` |
| tasks | `tasks_scan`, `task_toggle`, `task_append`, `task_move`, `task_update`, `task_id_ensure`, `task_depends_add`, `task_depends_remove` |
| tasklinks / taskctx | `tasklinks_read`, `tasklink_set`, `tasklink_delete`, `task_context_preview`, `task_context_write` |
| project-meta | `project_meta_read`, `project_meta_write`, `project_init` |
| worktree | `worktree_check`, `worktree_add` |
| sessions | `agent_session_spawn`, `agent_session_send`, `agent_session_kill`, `agent_session_restart`, `agent_session_list` |

## Events

| Event | Payload | Flow |
|---|---|---|
| `barn://event` | `BarnEvent { kind, filePath?, sessionId, ts }` | hooks_server → emit → `useEventsStore.pushEvent` → canvas pulse + barn animation |
| `assemble://status` | `AssembleProgress { nodeId, status, phase, startedAt, error }` | assemble.rs → emit → `useGraphStore.setAssembleStatus` |
| `fs://change` | `FsChange { relPath, modifiedMs, sizeBytes, kind }` | watcher.rs → emit → `useProjectStore.applyFsChange` → lens updates |
| `agent://event` | `{ id, kind, status?, tool?, text?, usage?, ts }` | sessions.rs (headless resume-loop) → emit → event stream, inspector transcript, status badges |

One-way pipeline: Rust emits → Tauri `emit` → Zustand store → both views react.
React Flow and PixiJS never import each other.

## Key terms (canon)

| Term | One-liner |
|---|---|
| Memory Node | Graph node backed by a real `.md` file; file on disk is content source of truth |
| Agent file | A `.md` file in `.claude/agents/` defining a Claude Code agent with role/skills/priority/influence/duties |
| Agent session | One headless Claude Code child process spawned by the app (via `agent_session_spawn`), running in a worktree folder, persisting across restarts via sessionId, emitting `agent://event` stream |
| Skill file | A `.md` file under `.claude/skills/*/SKILL.md` defining a reusable knowledge skill with invoke commands |
| Sidecar agents.json | Per-project persisted metadata (v1 schema) for agents: nicknames, priority/influence/avatarSeed, skills-attach state, drafts, orphan retention |
| Named Calf | Subagent sprite in the barn with stable identity across sessions via fnv1a32 hash of sessionId + ordinal, displaying unique coat pattern + accent role + tiny prop |
| Roster bar | Bottom strip showing all live agent sessions (avatars, names, status dots, current tool); click a card to open agent panel with transcript stream and real token usage |
| Identity hash | fnv1a32(seed) → avatar patch grid (8×8 mirrored), accent role (7 options via h2 % 7), calf patch bits (2–7 via popcount), visual identity tied to agent/calf name/type |
| Node role | One of 14 (v5): `agent`, `rule`, `invariant`, `trap`, `architecture`, `decision`, `workflow`, `command`, `skill`, `env`, `tool`, `glossary`, `example`, `style`. (v4 renames: `rules`→`rule`, `task`→`workflow`, `reference`→`architecture`, `snippet`→`example`; new: `decision`, `env`, `tool`) |
| Edge kinds | 5 (v5): **Structural** (cycle validation + topological order): `imports` (inline), `sequence` (order only), `overrides` (target-before-source). **Advisory** (linter only): `references` (soft link), `contradicts` (symmetric; v4 `conflicts-with`). (v5 replaces `conditional`→`imports` + typed `guard`, `supersedes`→node `deprecated` field) |
| Pinned / effective-pinned | Always-in-context flag; effective set = pinned + transitive `imports` closure — **excludes `overrides`** (affects compile order, not pinned set) |
| readOrder | Manual tie-break inside topological order (Kahn, pops by `(readOrder, id)`) |
| rootLoad | v5 node field (replaces v4's `pinned: bool`): `{ "always" }` literal to mark nodes that load in every context; absent ⇒ on-demand. Single-variant optional enum enforces two-state safety (WO13) |
| deprecated | v5 node field: `{ replacedBy, since?, reason? }` structure stamped by migration on superseded nodes (via former v4 `supersedes` edges) or by user-initiated deprecation in the UI; `since` is YYYY-MM-DD string (user/TS side only, never stamped by migration) |
| needsReview | v5 node field: `true` iff migration rewrote the role (v4→v5 renames) or the node was superseded; omitted from output when `false` |
| guard | v5 edge field (replaces v4's free-text `condition`): typed as `{ type: "glob", globs: [...] }` or `{ type: "description", text: ... }`; conditional edges become `imports` + guard during migration; illegal on `contradicts` |
| resolveLoad | Function unifying three prior implementations (`effective_pinned`, taskctx walk, tokens.ts logic) into one authoritative load-policy decider: given a node, returns whether it loads in root context or on-demand |
| BarnGraph | `graph.json` shape: **`version: 5`** (v1→v2 = persona→agent; v2→v3 = roles 7→13, edges 4→7, tags/owner/meta, edge color; v3→v4 = edge `waypoints`; v4→v5 = roles 13→14, edges 7→5, node `rootLoad`/`deprecated`/`needsReview`, edge `guard`), `projectName`, `nodes`, `edges`, `compileTargets`; schema change ⇒ version bump + migration |
| Waypoints | Per-edge hand-edited route (v4): flow-space corners the wire passes through; absent ⇒ the automatic route. Connector stubs are never editable |
| Contact finger / pin | One 4px bar on a connector. Count = that port's connection count (floor 1, cap 9) on the 8px `SLOT_PITCH`; height = `portHeight` (44px at five — the frozen WO09 value) |
| Edge tone | `selected` (accent, lifted above every wire) > `related` (touches the selected node) > rest (kind colour, or the author's palette override) |
| Project sidecar | `.cowtext/project.json` v1: name/brief/type/requirements/hardRules/audience/architecture/constraints, rendered into the pinned `context/project.md` so it reaches the agent through compile |
| Inspector section | Collapsible titled component (collapse state persisted in `AppSettings.collapsedSections`) |
| Compile | One graph → five targets; never writes without diff-preview approval |
| GENERATED header | First line of compiled files; absence marks handwritten; `compile_write` refuses without it |
| Assemble / Refine / Summarize | Brief → full via `claude -p` (stdin, `--output-format json`) |
| Brief | One-line node description Assemble expands; presets preserve briefs not content |
| Hooks | `PostToolUse`/`UserPromptSubmit`/`Stop` curl entries; always behind confirmation diff |
| BarnEvent | Normalized live event driving event log, canvas pulse, barn |
| The Barn | Pixi 8 iso scene (2:1 tiles, Barnlight-29); cow = agent, calves = subagents |
| Calm mode | One toggle: no sound + reduced motion |
| Preset | Graph structure + briefs (no content); apply never clobbers |
| Handoff | Session-summary template → `HANDOFF.md` + clipboard variants |
| App settings | `app_config_dir/settings.json`: volumes, mute, calm, `claudeBinaryPath` override |
| Ports | 1420 = Vite dev; 4923 = hooks server |
| "Blue is you, amber is the cow" | User-initiated (blue) vs agent activity (amber); never mixed |
| Lens | Canvas view: `none` / `activity` (60m recency) / `weight` (file size) / `live` (60s pulse) |
| Watcher | notify-based `.md` change monitor; emits `fs://change` events via Tauri |
| Agent avatar | Custom image for an agent (`.cowtext/avatars/<stem>.<ext>`): magic-byte validated, ≤ 512 KB, identicon fallback |
| Agent memory status | Read-only probe of `.claude/agent-memory/<stem>/MEMORY.md` (exists, healthy UTF-8, non-empty) |
| One writer per file | Doctrine: any UI surface that writes a file which a store-level save queue also writes MUST route through that queue. `write_md_file` rejects agent paths. |
| Toast | Time-bounded notification (default 4s info/success, 7s warning, sticky danger): `useToastsStore.push`, `ToastHost` stack, role/aria per severity (danger/warning=alert/assertive, info/success=status/polite) |

Cross-references like "FEATURES n.n" resolve to the Feature inventory section of
`docs/tasks/BACKLOG.md` (formerly `docs/FEATURES.md`, archived).
