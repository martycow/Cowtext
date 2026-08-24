# Cowtext — Canonical Terminology

> Canon only: module names, invoke commands, events, and the terms every agent must use
> consistently. Full definitions live in [`TERMINOLOGY_REFERENCE.md`](TERMINOLOGY_REFERENCE.md).
> Maintained by hand, **≤ 120 lines**; live counts come from the truth block in `CLAUDE.md`.

## Modules

| Module | Owns |
|---|---|
| `src-tauri/src/lib.rs` (+ `main.rs` shim) | `tauri::Builder` chain, plugin registration, `generate_handler!` command list (81); `main.rs` is `cowtext_lib::run()` + `windows_subsystem = "windows"` (unchanged) |
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
| `src-tauri/src/fsbatch.rs`, `toolchain.rs` | Batch FS apply with all-or-nothing rollback and inverse batch for Undo (`fs_apply_batch`) · AI-CLI detection: PATH probe + `--version` per compile target, on demand (`detect_ai_tools`) |
| `src/store/` | **13** Zustand stores (this row listed 7 until 2026-08-24): `useProjectStore`, `useProjectSelectionStore`, `useGraphStore`, `useEventsStore`, `useSettingsStore`, `useToastsStore`, `useToolchainStore` (AI-CLI scan, one probe at a time), `useUiStore` (cross-surface intents: agent-wizard prefill, hooks-modal open), `useAgentsStore`, `useSessionsStore`, `useTasksStore`, `useTaskLinksStore`, `useReviewStore`. `tokens.ts` sits here too but is a pure module, not a store |
| `src/resources/`, `scripts/truth.mjs` | Bundled product data (models, agent presets, stacks, principles, built-in `skills/`) + `PROVIDER_SUPPORT_SENTENCE` · the release-truth generator: checks T1–T14, and with `--write` regenerates `AGENTS.md`, `.agents/skills/*` and the CLAUDE.md truth block |
| `src/canvas/` | React Flow view: `MemoryNodeCard`, `MemoryEdge`, `KindPicker`, `RoleGlyphs`, plus five pure modules — `portSlots` (pins/slots), `edgePath` (router), `edgeEdit` (waypoints), `labelSlots` (label collisions), `edgeVerb`/`edgeColor` (label + palette) |
| `src/inspector/` | Inspector panel, `InspectorSection` (collapsible components), `EventLog`, `HooksModal`, AssembleSection |
| `src/compile/`, `src/settings/`, `src/preset/`, `src/handoff/`, `src/project/` | Feature UI: CompileModal (the LCS differ is **`src/ui/diff.ts`**, not `src/compile/diff.ts` — that path never existed and is still wrong in `vite.config.ts:47,58`, whose `utils-diff` chunk therefore never fires) · SettingsModal · preset & handoff modals with clipboard variants · `ProjectWizard` (new / convert / edit) + `TitleScreen` (brand, recents, toolchain panel) |
| `src-tauri/src/frontmatter.rs` | Frontmatter parser/emitter: read-patch-write round-trip with byte-identity invariant, line-level EOL tracking, no regex/YAML crate |
| `src-tauri/src/agents.rs` | Agent/skill CRUD, file creation, rename, delete, metadata write; validation (component/path guards), sidecar schema, `AGENT_FS` mutex for .claude/agents/ + .claude/skills/ write safety |
| `src-tauri/src/git.rs` | Git probe/init/`.gitignore` write, shells out to system `git`, `gitAvailable` fallback when git not on PATH |
| `src/git/` | GitWizard modal, `.gitignore` composer with presets, line-ending preservation, diff-preview gate |
| `src/identity/` | Identity hash (fnv1a32), avatar grid + accent/patch derivation, calf appearance generation |
| `src/agents/` | Agent/Skill manager UI: `AgentAvatar`, `AgentEditor`, `SkillEditor`, `ModelPicker`, `ToolPicker`, `RailSections`, plus `api`/`avatarApi`/`builtinSkills`/`modelCatalog`/`toolCatalog`/`types`. (Corrected 2026-08-24: this row named `AgentList` and `AgentsModal`, neither of which exists — the modal was dissolved into the rail in WO13.) |
| `src/scene/` | Pixi barn: `BarnScene.tsx`, `cow.ts`, `calf.ts`, `mapper.ts`, `demo.ts`, `palette.ts`, `iso.ts`, `sfx.ts` (howler confined here) |

## Invoke commands (81)

Adding one takes three coordinated edits: the `#[tauri::command]` fn, its
`generate_handler![...]` entry, the byte-exact `invoke` name in TS. camelCase in JS ⇄ snake_case in Rust.
**This table is not gated.** T3/T4 (`scripts/truth.mjs:416-447`) compare `generate_handler!` against the TS `invoke(...)` call sites and never read a markdown list — so this table and the copy in `.claude/skills/cowtext-terminology/SKILL.md` can drift silently, and the skill's copy was found 3 commands short on 2026-08-24 with the gate fully green. Re-derive the list; do not trust it.

| Group | Commands |
|---|---|
| project | `scan_project`, `read_graph`, `write_graph`, `read_md_file`, `write_md_file`, `rename_node_file`, `reveal_path`, `probe_project_dirs` |
| fs | `fs_apply_batch` |
| git | `git_status`, `git_init`, `gitignore_write` |
| agents | `agents_scan`, `agent_create`, `agent_save`, `agent_rename`, `agent_delete`, `agent_convert`, `agent_memory_ensure`, `agent_avatar_set`, `agent_avatar_read`, `agent_avatar_clear`, `agent_memory_status`, `skill_create`, `skill_save`, `skill_rename`, `skill_delete`, `skills_materialize`, `agents_meta_write` |
| compile | `compile_preview`, `compile_write` |
| import / lint | `import_scan`, `import_apply`, `lint_run` |
| assemble | `assemble_node`, `assemble_preview`, `refine_node`, `summarize_node`, `assemble_status`, `assemble_cancel` |
| hooks | `hooks_preview`, `hooks_write`, `hooks_status`, `hooks_addr` |
| settings | `read_app_settings`, `write_app_settings`, `stack_icon_import`, `stack_icon_read`, `stack_icon_delete` |
| preset | `preset_save`, `preset_list`, `preset_read`, `preset_export`, `preset_apply` |
| handoff | `handoff_generate`, `handoff_write`, `handoff_node_propose` |
| tasks | `tasks_scan`, `task_toggle`, `task_append`, `task_move`, `task_update`, `task_id_ensure`, `task_depends_add`, `task_depends_remove` |
| tasklinks / taskctx | `tasklinks_read`, `tasklink_set`, `tasklink_delete`, `task_context_preview`, `task_context_write` |
| project-meta | `project_meta_read`, `project_meta_write`, `project_init` |
| worktree | `worktree_check`, `worktree_add` |
| toolchain | `detect_ai_tools` |
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
| Built-in skill | A skill Cowtext bundles (`src/resources/skills/<id>/SKILL.md`) in one of three states: **virtual** — bundled, nothing on disk, costs the project nothing; **materialized** — written to `.claude/skills/<id>/SKILL.md` by `skills_materialize` and byte-equal to the bundle; **modified** — on disk and different, so it moves to the Project group with a `modified from built-in` badge and a Reset-to-built-in action. Compile writes `virtual` built-ins that are included, never a `modified` one |
| Sidecar agents.json | Per-project persisted metadata (v1 schema) for agents: nicknames, priority/influence/avatarSeed, skills-attach state, drafts, orphan retention |
| Named Calf | Subagent sprite in the barn with stable identity across sessions via fnv1a32 hash of sessionId + ordinal, displaying unique coat pattern + accent role + tiny prop |
| Roster bar | Bottom strip showing all live agent sessions (avatars, names, status dots, current tool); click a card to open agent panel with transcript stream and real token usage |
| Identity hash | fnv1a32(seed) → avatar patch grid (8×8 mirrored), accent role (7 options via h2 % 7), calf patch bits (2–7 via popcount), visual identity tied to agent/calf name/type |
| Node role | One of 14 (v5): `agent`, `rule`, `invariant`, `trap`, `architecture`, `decision`, `workflow`, `command`, `skill`, `env`, `tool`, `glossary`, `example`, `style`. (v4 renames: `rules`→`rule`, `task`→`workflow`, `reference`→`architecture`, `snippet`→`example`; new: `decision`, `env`, `tool`) |
| Edge kinds | 5 (v5): **Structural** (cycle validation + topological order): `imports` (inline), `sequence` (order only), `overrides` (target-before-source). **Advisory** (linter only): `references` (soft link), `contradicts` (symmetric; v4 `conflicts-with`). (v5 replaces `conditional`→`imports` + typed `guard`, `supersedes`→node `deprecated` field) |
| Pinned / effective-pinned | Always-in-context flag; effective set = pinned + transitive `imports` closure — **excludes `overrides`** (affects compile order, not pinned set) |
| readOrder | Manual tie-break inside topological order (Kahn, pops by `(readOrder, id)`) |
| v5 fields: rootLoad · deprecated · needsReview · guard | Node: `rootLoad?: "always"` (replaces v4 `pinned: bool`; absent ⇒ on-demand) · `deprecated?: { replacedBy, since?, reason? }` · `needsReview?: true` (migration rewrote the role, or the node was superseded). Edge: `guard?` typed `{ type: "glob", globs }` or `{ type: "description", text }` (replaces v4 free-text `condition`; illegal on `contradicts`). Full definitions in TERMINOLOGY_REFERENCE.md |
| resolveLoad | Function unifying three prior implementations (`effective_pinned`, taskctx walk, tokens.ts logic) into one authoritative load-policy decider: given a node, returns whether it loads in root context or on-demand |
| BarnGraph | `graph.json` shape: **`version: 5`** (v1→v2 = persona→agent; v2→v3 = roles 7→13, edges 4→7, tags/owner/meta, edge color; v3→v4 = edge `waypoints`; v4→v5 = roles 13→14, edges 7→5, node `rootLoad`/`deprecated`/`needsReview`, edge `guard`), `projectName`, `nodes`, `edges`, `compileTargets`; schema change ⇒ version bump + migration |
| Wire anatomy | **Waypoints** = per-edge hand-edited route (v4), flow-space corners the wire passes through; absent ⇒ automatic route, connector stubs never editable. **Contact finger / pin** = one 4px bar on a connector; count = that port's connection count (floor 1, cap 9) on the 8px `SLOT_PITCH`, height = `portHeight` (44px at five — frozen WO09 value). **Edge tone** = `selected` (accent, lifted above every wire) > `related` (touches the selected node) > rest (kind colour or palette override) |
| Project sidecar | `.cowtext/project.json` v1: name/brief/type/requirements/hardRules/audience/architecture/constraints, rendered into the pinned `context/project.md` so it reaches the agent through compile |
| Inspector section | Collapsible titled component (collapse state persisted in `AppSettings.collapsedSections`) |
| Compile | One graph → five targets; never writes without diff-preview approval |
| GENERATED header | First line of compiled files; absence marks handwritten; `compile_write` refuses without it |
| Provider support sentence | The one honest claim about provider support, used verbatim and never paraphrased: "Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code." UI imports `PROVIDER_SUPPORT_SENTENCE` (`src/resources/index.ts`), markdown carries the literal; `npm run truth` T12 fails when a required surface is missing it. Capability detail: `docs/design/PROVIDER_SUPPORT_MATRIX.md` |
| Truth block | The generated lines in `CLAUDE.md` between `<!-- truth:begin -->` and `<!-- truth:end -->` — invoke count, Rust and Vitest test counts, schema version, compile targets, release-gate pointer. Written only by `npm run truth:write`; **the only place release numbers live**, so Status prose carries none |
| Assemble / Refine / Summarize | Brief → full via `claude -p` (stdin, `--output-format json`) |
| Brief | One-line node description Assemble expands; presets preserve briefs not content |
| Hooks | **Four** events, not the three this row listed until 2026-08-24: `PostToolUse` (matched), `UserPromptSubmit`, `Stop`, `SubagentStop` — `src-tauri/src/hooks.rs:41-46`. curl entries; always behind a confirmation diff |
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
| Agent avatar / memory status | Avatar = custom image at `.cowtext/avatars/<stem>.<ext>` (magic-byte validated, ≤ 512 KB, identicon fallback). Memory status = read-only probe of `.claude/agent-memory/<stem>/MEMORY.md` (exists, healthy UTF-8, non-empty) |
| One writer per file | Doctrine: any UI surface that writes a file which a store-level save queue also writes MUST route through that queue. `write_md_file` rejects agent paths. |
| Toast | Time-bounded notification (default 4s info/success, 7s warning, sticky danger): `useToastsStore.push`, `ToastHost` stack, role/aria per severity (danger/warning=alert/assertive, info/success=status/polite) |

"FEATURES n.n" resolves to the Feature inventory section of `docs/tasks/BACKLOG.md`.
