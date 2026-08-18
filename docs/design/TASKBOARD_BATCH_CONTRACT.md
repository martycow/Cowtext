# Task-Board Batch — frozen contract (2026-08-18)

Marty's 7-item batch (Barn tooltips · undo/redo · rail hierarchy · task-file
convention · SCRUM board · Producer agent · token info). Primary agent is the
dispatcher + lead; three lanes build against this file. Zones at the bottom.

## 1. Task-file convention (item 4)

Four well-known files, searched in this order of directories: project root,
`docs/`, `docs/tasks/` (first hit wins per name):
`TASKS.md` (ready / in progress / ready for testing) · `SPRINT.md` (current
scope) · `BACKLOG.md` (future research) · `ROADMAP.md` (long plan, phases).
Missing files are fine — the board shows the column with a "create" hint.

## 2. Task parsing (Rust, tolerant, read-mostly)

A task is either:
- **Table row**: any markdown pipe-table whose header row contains a
  name-like column (`name|task|title`). Column mapping is header-driven,
  case-insensitive, first match: name; `tags`; `priority|prio`;
  `description|desc|details`; `phase`; `agent|assignee|owner`;
  `status|state`. Unknown columns ignored. Tags split on `,`/whitespace.
- **Checklist line**: `- [ ] text` / `- [x] text` (any indent). Name = text
  up to the first ` — `/` - `/`.` boundary or whole line; `#tag` words become
  tags; `@name` becomes agent; `(P0..P3)` or `P0..P3` token becomes priority.

`TaskItem` wire shape (camelCase over IPC):
```
{ id: "<relPath>#<line>", relPath, line (1-based), source: "table"|"checklist",
  name, description, tags: string[], priority: string|null, phase: string|null,
  agent: string|null, done: bool, status: string|null }
```

## 3. New Rust commands (38 → 42) — module `src-tauri/src/tasks.rs`

| Command | Args (JS camelCase) | Returns |
|---|---|---|
| `tasks_scan` | `root` | `{ files: [{relPath, exists, taskCount}] (always 4, convention order), tasks: TaskItem[] }` |
| `task_toggle` | `root, relPath, line, done` | updated `TaskItem` — checklist lines only; error `"Not a checklist task: <relPath>#<line>"` for table rows |
| `task_append` | `root, relPath, text` | new `TaskItem` — appends `- [ ] <text>` as the last line of the file (creating the file with a `# <Name>` header if absent; only the four convention relPaths are writable — anything else → `"Not a task file: <relPath>"`) |
| `task_move` | `root, fromRelPath, line, toRelPath` | moved `TaskItem` — removes the WHOLE line from the source and appends it to the target (checklist lines verbatim; table rows are converted to a checklist line `- [ ] <name> — <description>` since target tables may not exist). Both files re-read + written via `write_atomic`; on any failure nothing is half-moved (write target first, then source; roll target back if source write fails) |

Line-based surgery only; all writes atomic; stale `line` (text no longer a
task at that line) → error `"Task moved on disk — rescan"`. All four commands
confine paths to the four convention files.

## 4. Producer (item 6) — reserved default agent

- `agents.rs`: `agent_rename`/`agent_delete`/`agent_convert` REJECT the file
  `producer.md` (`"Reserved agent: producer"`) — same class as CLAUDE.md.
  `agent_create("Producer")` stays allowed (that IS materialization).
- Frontend (agents store): `PRODUCER_FILE = "producer.md"`. The rail's agent
  list ALWAYS shows Producer first — real doc when `.claude/agents/producer.md`
  exists, else a virtual row ("Producer — default agent, click to create")
  whose click materializes it via `createAgent("Producer")` with a default
  duties body ("Coordinates the project; owns unassigned tasks."). Board
  agent filter always lists Producer; tasks with `agent === null` belong to
  Producer.

## 5. Undo / redo (item 2) — graph store only

- History in `src/store/graph.ts`: bounded stacks (cap 100) of
  `{ nodes, edges, compileTargets }` snapshots. Every mutating action that
  calls `scheduleSave()` pushes the PRE-mutation snapshot once (helper
  `pushHistory()`); undo pushes current → redo stack, restores, `scheduleSave()`.
  New store API (frozen): `undo(): void`, `redo(): void`, `canUndo: boolean`,
  `canRedo: boolean` (booleans updated on every push/undo/redo).
- File operations (rename/convert/delete-on-disk) are NOT undone — graph
  structure only; a restored node pointing at a renamed file simply shows
  "missing file". Documented in code + manual.
- UI: TopBar undo/redo icon buttons (disabled state from canUndo/canRedo)
  + `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` handled at the Workspace level,
  skipped while focus is in an input/textarea/CodeMirror.

## 6. Rail hierarchy (item 3)

`FileRail` renders `contextFiles` as a directory tree: top-level files first
(root docs like CLAUDE.md), then directories alphabetically, collapsible
(chevron, state in a local Set, default expanded), files indented per depth.
Pure presentation — `FileRow` unchanged inside, still gets the flat `file`.

## 7. Tasks board UI (item 5) — `src/tasks/`

- `src/tasks/api.ts` — ONLY holder of the 4 new invokes.
- `src/store/tasks.ts` — `useTasksStore`: `{ root, loading, error, files,
  tasks, load(root), toggle(item, done), append(relPath, text),
  move(item, toRelPath), agentFilter: string|null ("<all>" = null),
  setAgentFilter }`. Auto-refresh: subscribes to `fs://change` relPaths that
  match the four convention files (listener piggybacks the existing
  `initEventListener` third listener — a small exported hook
  `onTaskFileChange(relPath)` called from events.ts).
- `TasksBoard.tsx` — REUSABLE component `({ agentFilter?: string|null })`:
  four columns (TASKS · SPRINT · BACKLOG · ROADMAP) in a horizontal scroll
  row; column header = file name + count + "＋" quick-add input; card =
  name, tag chips (mono micro), priority badge (P0 danger / P1 amber /
  P2-P3 neutral), phase chip, agent chip (mini avatar when the agent
  exists; "Producer" when null), done checkbox for checklist items,
  "Move to…" menu (ContextMenu) with the other three columns; description
  collapses under the name (click card toggles). Filter bar on top: agent
  select (All · Producer · every agent file) + free-text filter.
- `TasksModal.tsx` — modal shell (PresetsModal idiom, `w-[1040px]
  max-w-[94vw]`) hosting `<TasksBoard/>`; TopBar button **Tasks**
  (lucide `KanbanSquare` or `ListTodo`) between Compile and Presets.
  The component stays reusable for a future per-agent embed.

## 8. Token info (item 7) — estimates now, live later

- `src/store/tokens.ts` — pure helpers (no store):
  `CONTEXT_WINDOW_TOKENS = 200_000`,
  `tokensForBytes(b) = Math.ceil(b/4)`,
  `pinnedContextTokens(nodes, files)` (pinned nodes' sizeBytes; comment:
  effective-imports closure arrives with Block B),
  `agentContextTokens(doc, nodes, edges, files)` = duties body chars/4 +
  direct outgoing imports/references target files' tokens (agent-backed
  node matched by filePath).
- UI: TopBar chip `≈N tok pinned` (title: "estimate, chars/4 · window
  ~200k"); AgentEditor identity header gains `≈N tok context` (same
  estimator); agents rail row title includes the estimate.
- **Recorded limitation:** real "tokens left / spent per agent" needs the
  Claude runtime telemetry (`--output-format stream-json`, Work Order
  Block F). Until then everything shown is an estimate and labeled so.

## 9. Barn hover bubbles (item 1) — `src/scene/`

Pointer-move hit test over interactive scene objects (cow, calves, node
props/cabinets, dev desk, door). On hover ≥150 ms show a bubble near the
object (reuse the existing filename-bubble drawing style): cow → "The cow —
your Claude agent at work"; calf → "Calf — subagent <seed>"; node prop →
"<title> — <role> node (<filePath>)"; desk → "The developer — that's you";
door → "Barn door — agents come and go". Bubble hides on pointer-out;
calm mode: no fade animation, instant show/hide. No layout changes, no new
assets, pure Graphics/Text.

## 10. Lanes & zones (disjoint)

- **L1 tech-general (Rust)**: `src-tauri/src/tasks.rs` (+`tasks/tests.rs`),
  `agents.rs` (+tests, producer guards only), `lib.rs` (4 entries). Nothing else.
- **L2 primary agent (stores)**: `src/store/{graph,tasks,tokens,agents}.ts`,
  `src/store/events.ts` (task-file hook), `src/tasks/api.ts`.
- **L3 tech-ui (UI)**: `src/tasks/{TasksBoard,TasksModal}.tsx`,
  `src/App.tsx` (rail tree, TopBar buttons/chip, keybindings, modal mount),
  `src/agents/AgentEditor.tsx` (token line), `src/agents/RailSections.tsx`
  (Producer row + token title). Codes against §5/§7/§8 store APIs frozen here.
- **L4 tech-barn (scene)**: `src/scene/` only (new `hover.ts` + wiring in
  `BarnScene.tsx`; `types.ts` if needed).

Gates for every lane: `npx tsc --noEmit`, `npm run lint` (0 errors),
`cargo clippy -- -D warnings`, `cargo test` (from src-tauri). No new deps.
No commits — dispatcher commits after integration.
