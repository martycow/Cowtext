# WO02 — Frozen Contract

> Author: tech-lead · Session 2026-08-18 · Source of truth: `docs/INPUT_PROMPT.md`
> (21 raw thoughts, dated 08/18/2026 10:36PM).
> **Frozen once lanes start.** Deviations need a tech-lead ratification line in the
> lane's final report; nothing in this file may be re-interpreted mid-flight.
> Companion: [`WO02_DESIGN_NOTES.md`](WO02_DESIGN_NOTES.md) (items 18/19/20, design only).

---

## 1. Scope

WO02 is a **quick-win + format-discipline** work order on top of a code-complete
v0.1.0 candidate. It adds **1 invoke command** (50 → 51), changes **1 command
signature**, changes **behaviour** of 3 task commands, adds **1 app-settings
field**, and touches **no `graph.json` schema** (see §6 — this is a hard rule of
this work order).

### 1.1 Triage — all 21 items

| # | Thought | Bucket | Lane | Note |
|---|---|---|---|---|
| 1 | Mandatory context files for empty projects, by project type | BACKLOG | — | Depends on #2 (project types don't exist yet) |
| 2 | New-project creation wizard with project types + hierarchy | BACKLOG | — | Largest single feature in the dump; needs its own work order |
| 3 | Per-agent memory files `.claude/agent-memory/<name>/` | **BUILD NOW** | G2 · G3 · U3 | New command `agent_memory_ensure` |
| 4 | Default pre-defined skills, optional in wizard | BACKLOG | — | Rides on #2's wizard |
| 5 | Agent nodes look different on the graph | **BUILD NOW** | U1 | No `graph.json` change — `isAgentFile(filePath)` is the sole discriminator |
| 6 | Agent wizard: calculated default paths in input fields | **BUILD NOW** | G2 · U3 | `agent_create` gains optional `fileName` |
| 7 | FPS toggle in settings | **BUILD NOW** | G3 · U3 · B1 | Split store / settings-UI / scene-HUD |
| 8 | Barn framerate drops on the default scene | **BUILD NOW** | B1 | Investigation deliverable, not a pre-named fix (§7.6) |
| 9 | Every node created through the wizard, incl. double-click | **BUILD NOW** | U1 | Store's `createNode` action is **kept but unwired** (cut, §1.3) |
| 10 | Toolset for reorganizing an existing project into Cowtext hierarchy | BACKLOG | — | Needs #2's hierarchy definition first |
| 11 | Tasks/BACKLOG/BUGS/ROADMAP as pure user-readable grids | **BUILD NOW** | G1 · P1 | Rust append/move become table-aware; docs rewritten by project-manager |
| 12 | Tags as a dropdown with create-new | **BUILD NOW** | G3 · U2 | Selector in store, `TagPicker` in UI |
| 13 | Priorities: Low, Medium, High, CRITICAL | **BUILD NOW** | G1 · G3 · U2 | Canonical buckets `low\|medium\|high\|critical` |
| 14 | BACKLOG/ROADMAP/BUGS off the always-visible right side | **BUILD NOW** | G1 · G3 · U2 | Adds `BUGS.md` as a 5th convention file |
| 15 | Fable 5 missing from model dropdown; what is "inherit"? | **BUILD NOW** | U3 | Catalog + an explanatory note (§7.5) |
| 16 | New nodes at the centre of the current viewport | **BUILD NOW** | U1 | New pure helper `src/canvas/viewport.ts` |
| 17 | Role descriptions barely visible — brighter font | **BUILD NOW** | U1 · U2 | One token swap, three call sites |
| 18 | Think deeper about what roles must exist | **DESIGN** | tech-lead | `WO02_DESIGN_NOTES.md` §1 |
| 19 | Departments per agent, defaults by project type | **DESIGN** | tech-lead | `WO02_DESIGN_NOTES.md` §2 |
| 20 | Edge types incl. CONTROL ("Task Manager CONTROLS TASKS.md") | **DESIGN** | tech-lead | `WO02_DESIGN_NOTES.md` §3 |
| 21 | Codex / Cursor / other tool hooks research | BACKLOG | — | product-analyst research task, not a build task |

### 1.2 Backlog-ready one-liners (project-manager files these)

- **#1** — On opening a project with zero `.md` files, offer to create a mandatory
  context set (rules / architecture / workflow / glossary) chosen by project type. *Blocked on #2.*
- **#2** — New-project wizard: name, root, project type (Video Game · Desktop App ·
  SaaS · Library · Research), and a type-driven folder/file hierarchy scaffolded on confirm.
- **#4** — Ship a set of pre-defined skills (task-format, ultracode-session, …) offered
  as opt-in checkboxes inside the new-project wizard. *Blocked on #2.*
- **#10** — "Reorganize this project" toolset: scan an existing repo, propose a Cowtext
  hierarchy + task-format migration as a diff-preview, write only on approval.
- **#21** — Research hook/telemetry surfaces for Codex, Cursor and other agent tools so
  the Barn can be driven by more than Claude Code hooks. *product-analyst, research doc.*

### 1.3 Cut from BUILD NOW (reasons)

| Cut | From | Reason |
|---|---|---|
| Removing `useGraphStore.createNode` | #9 | Cross-lane ordering hazard (store lane and UI lane must land together or the build breaks) for zero user-visible gain. The action stays, unwired; delete it in a later cleanup. |
| Persisting the Tasks segment choice in `AppSettings` | #14 | A second settings field for a per-session view preference. Local `useState`, resets on remount — deliberate. |
| `CHANGELOG.md` grid conversion | #11 | No `CHANGELOG.md` exists in this repo and it is not a convention file the parser reads. Out of scope; not a silent omission. |
| Agent-card live session status (spawned / running dot) | #5 | Needs `useSessionsStore` on the canvas card — a new cross-store subscription in the hottest-rendering component. Backlog. |
| Departments field on agents | #19 | Design-only this session per the goal statement; sidecar schema bump belongs with the design's acceptance. |
| A 5th `controls` edge kind | #20 | Requires `GRAPH_VERSION` 2 → 3 + migration + compile.rs changes. Explicitly out of this work order (§6). |

---

## 2. Command contract

**Current: 50 commands. After WO02: 51.** Adding one takes three coordinated edits
(the `#[tauri::command]` fn, its `generate_handler![...]` entry, the byte-exact
`invoke` name in TS). camelCase in JS ⇄ snake_case in Rust.

### 2.1 NEW — `agent_memory_ensure` (item #3)

```rust
// src-tauri/src/agents.rs
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemory {
    /// ".claude/agent-memory/<stem>"  — forward slashes, relative to root.
    pub dir_rel_path: String,
    /// ".claude/agent-memory/<stem>/MEMORY.md"
    pub index_rel_path: String,
    /// true iff THIS call created the directory or the index file.
    pub created: bool,
}

#[tauri::command]
pub fn agent_memory_ensure(root: String, file_name: String) -> Result<AgentMemory, String>
```

TypeScript wrapper — **`src/agents/api.ts` is the only file allowed to hold this invoke**:

```ts
export interface AgentMemory {
  dirRelPath: string;
  indexRelPath: string;
  created: boolean;
}
export function agentMemoryEnsure(root: string, fileName: string): Promise<AgentMemory> {
  return invoke<AgentMemory>("agent_memory_ensure", { root, fileName });
}
```

Behaviour, frozen:

1. `validate_md_component(&file_name)?` — same guard as `agent_save`.
2. `stem` = `file_name` minus the trailing `.md` (case-insensitive), then
   `validate_component(stem)?`.
3. `dir = resolve_within_root(&root_path, &format!(".claude/agent-memory/{stem}"))?`
   then `fs::create_dir_all(&dir)`.
4. `index = dir.join("MEMORY.md")`, created with `fs::File::create_new` — **never
   clobbers**; `AlreadyExists` is success with `created` unaffected by that step.
5. `created` = `true` iff the directory did not exist before the call **or** the
   index file was created by this call.
6. Seed content of a freshly created `MEMORY.md` (byte-exact, trailing newline):

```
# <stem> memory index

<!-- One line per memory file: - [Title](file.md) — one-line hook -->
```

7. Errors are `String`, prefixed with the path like every other command in `agents.rs`.

`.claude/agent-memory/` is **not** added to `project.rs`'s scan (the dot-directory
skip already excludes it, and only `.claude/agents/` is special-cased). No change to
`project.rs`. No change to `capabilities/default.json`.

### 2.2 CHANGED signature — `agent_create` (item #6)

```rust
#[tauri::command]
pub fn agent_create(
    root: String,
    name: String,
    file_name: Option<String>,   // NEW, optional
) -> Result<AgentDoc, String>
```

```ts
export function agentCreate(
  root: string,
  name: string,
  fileName?: string | null,
): Promise<AgentDoc> {
  return invoke<AgentDoc>("agent_create", { root, name, fileName: fileName ?? null });
}
```

- `file_name: None` (absent or JSON `null`) ⇒ **today's behaviour, byte-identical**:
  `slugify(name)` + `.md`.
- `file_name: Some(f)` ⇒ `validate_md_component(&f)?`, then that exact name is used.
- The frontmatter `name:` in the template stays `slugify(name)` in **both** cases —
  the file name and the agent's declared name are independent from now on.
- `create_new` / never-clobber and the `AlreadyExists` error message are unchanged.
- Producer: `agent_create("Producer", None)` remains the sanctioned way to materialize
  `producer.md`; no new rejection is added for an explicit `fileName` of `producer.md`.

### 2.3 CHANGED behaviour — `tasks_scan`, `task_append`, `task_move`, `task_update`

Signatures are **unchanged**. Behaviour changes:

**`tasks_scan`** (item #14) — `CONVENTION_NAMES` becomes 5 entries, **appended in
this exact order** (positional coupling, see §5.3):

```rust
const CONVENTION_NAMES: [&str; 5] =
    ["TASKS.md", "SPRINT.md", "BACKLOG.md", "ROADMAP.md", "BUGS.md"];
```

`TasksScan.files` is therefore always **5** entries in that order (the doc comment
"always 4" must be updated). `CONVENTION_DIRS` is unchanged (`""`, `docs/`, `docs/tasks/`).

**`task_append`** (item #11) — target-form-aware, three-way rule:

1. If the file contains at least one pipe table whose header maps a `name` column,
   take the **last** such table and **insert a row immediately after its last data
   row** (not at EOF). The row has the same cell count and the same
   leading/trailing-pipe style as that table's rows; mapped columns are filled,
   unmapped cells are written as a single space `" "`.
2. Else, if the file contains at least one checklist task, append
   `- [ ] <text>` at EOF — **today's behaviour, unchanged**.
3. Else (file empty, missing, or containing no tasks), create the canonical table.
   For a file created from scratch the whole content is:

```
# <STEM>

| Name | Status | Priority | Tags | Agent | Description |
|---|---|---|---|---|---|
| <name> | new |  |  |  | <description> |
```

   For an existing file with no tasks, the same table block is appended after a
   blank line.

The row's field values come from parsing `text` with the **existing** checklist
extractors (`split_name_desc` + `extract_tokens`), so callers keep sending one
composed line and nothing on the TS side changes shape. `Status` is always `new` on
append (there is still no append-with-status primitive).

**`task_move`** (item #11) — the moved item is written into the target using the
**same three-way rule** as `task_append` (table row when the target has a table,
checklist line when it only has checklist tasks, new canonical table otherwise).
Source-line removal, the write-target-first ordering and the rollback path are
unchanged.

**`task_update`** (item #13) — the priority cell/token is written through
`bucket_for_priority_input` (§2.4). Everything else is unchanged, including
byte-exact preservation of unmapped table cells.

### 2.4 Priority buckets (item #13) — Rust

```rust
/// Canonical priority buckets. `None` = no priority / unrecognized.
fn bucket_for_priority_input(raw: &str) -> Option<&'static str>
```

Normalization: trim, ASCII-lowercase, `-`/`_` → space, collapse whitespace. Then:

| Input | Bucket |
|---|---|
| `low`, `l`, `p3` | `"low"` |
| `medium`, `med`, `normal`, `m`, `p2` | `"medium"` |
| `high`, `h`, `p1` | `"high"` |
| `critical`, `crit`, `blocker`, `urgent`, `p0` | `"critical"` |
| anything else, or empty | `None` |

- **Scan (table)**: `TaskItem.priority` = the bucket when recognized, otherwise the
  raw trimmed cell text (tolerant — never invent, never drop).
- **Scan (checklist)**: `extract_tokens` additionally recognizes a `!`-prefixed
  token — `!low` `!medium` `!high` `!critical` (case-insensitive) — mapped through
  the same function. The legacy bare `P0`–`P3` token keeps working and is mapped to
  its bucket. First recognized token wins, as today.
- **Write (checklist)**: `regenerate_checklist_line` emits `!<bucket>` (lowercase)
  when the patch's priority normalizes; when it does not normalize, the raw trimmed
  value is emitted bare (today's shape) so nothing is lost.
- **Write (table)**: `set_cell(map.priority, …)` receives the bucket when it
  normalizes, otherwise the raw trimmed value.

`P0`–`P3` remains readable forever; `low|medium|high|critical` is what Cowtext writes.

---

## 3. Wire shapes

No new Tauri events. `barn://event`, `assemble://status`, `fs://change`,
`agent://event` are all untouched.

| Shape | Change |
|---|---|
| `AgentMemory` | NEW (§2.1) |
| `AgentDoc`, `SkillDoc`, `AgentsScan` | unchanged |
| `TaskItem`, `TaskPatch`, `TaskFileInfo` | unchanged **fields**; `TasksScan.files` length 4 → 5 |
| `BarnGraph` / `MemoryNode` / `MemoryEdge` | **unchanged — frozen, see §6** |
| `AppSettings` | one appended field (§4.1) |
| `.cowtext/agents.json` sidecar (v1) | **unchanged** — departments are design-only |

---

## 4. Store shapes

### 4.1 `src/store/settings.ts` — item #7

`showFps` is appended **last** in the interface, in `DEFAULT_SETTINGS`, in
`mergeSettings`, and in `persistNow`'s payload — the established append-last
pattern. **`version` stays `1`** (tolerant merge means an older file without the
key simply defaults).

```ts
export interface AppSettings {
  // …existing fields, order unchanged…
  managerMode: boolean;
  /** WO02 #7: Barn FPS overlay. Additive, tolerant-merge field — default false. */
  showFps: boolean;   // <- appended last
}

export const DEFAULT_SETTINGS: AppSettings = { /* …, */ managerMode: false, showFps: false };

// mergeSettings, after the managerMode line:
if (typeof r.showFps === "boolean") out.showFps = r.showFps;

// SettingsState:
setShowFps: (b: boolean) => void;   // set + schedulePersist(), same idiom as setManagerMode
```

`persistNow`'s literal must list `showFps` last, after `managerMode`.

### 4.2 `src/store/tasks.ts` — items #12, #13, #14

```ts
// #14 — order MUST match Rust CONVENTION_NAMES exactly (see §5.3).
export const TASK_FILE_NAMES = [
  "TASKS.md", "SPRINT.md", "BACKLOG.md", "ROADMAP.md", "BUGS.md",
] as const;

// #13
export type TaskPriority = "low" | "medium" | "high" | "critical";
export const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "critical"];
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low", medium: "Medium", high: "High", critical: "CRITICAL",
};
/** Mirrors Rust bucket_for_priority_input; null = none/unrecognized. */
export function normalizePriority(raw: string | null): TaskPriority | null;

// #12 — unique tags across every scanned task, case-insensitively deduped
//       (first-seen casing wins), sorted alphabetically (localeCompare).
export function allTags(tasks: TaskItem[]): string[];
```

`isTaskFile` is unchanged in logic but now matches `BUGS.md` through
`TASK_FILE_NAMES`. `TasksState` gains **no** new state — `allTags` and
`normalizePriority` are pure functions the UI calls on the already-subscribed
`tasks` array.

### 4.3 `src/store/agents.ts` — items #3, #6

```ts
createAgent(name: string, opts?: { fileName?: string; withMemory?: boolean }): Promise<string | null>;
/** Idempotent backfill for an existing agent. null = success, else the message. */
ensureMemory(fileName: string): Promise<string | null>;
```

- `createAgent` passes `opts?.fileName ?? null` to `agentCreate`.
- After a successful create, when `opts?.withMemory !== false`, it calls
  `agentMemoryEnsure(root, doc.fileName)`. A memory-folder failure **must not fail
  the create**: it is caught, the agent still lands, and the message goes to
  `opError`. The existing orphan reconciliation and selection behaviour is unchanged.
- `ensureMemory` follows the `busy` / `opError` idiom of the other actions.
- **No new persisted state.** The memory path is derivable from `fileName`; the UI
  computes it (§5.3, U3).

### 4.4 Frozen — no changes this work order

`src/store/graph.ts`, `src/store/project.ts`, `src/store/events.ts`,
`src/store/review.ts`, `src/store/sessions.ts`, `src/store/tokens.ts`.

---

## 5. File-zone ownership grid

**Zones never overlap.** Zones below are stated at *file* level where a directory is
split. An agent that needs a file outside its zone **stops and reports** — it does
not edit it.

| Lane | Agent | Owns (exclusive) | Items |
|---|---|---|---|
| **G1** | tech-general | `src-tauri/src/tasks.rs`, `src-tauri/src/tasks/tests.rs` | 11, 13, 14 |
| **G2** | tech-general | `src-tauri/src/agents.rs`, `src-tauri/src/agents/tests.rs`, `src-tauri/src/lib.rs` | 3, 6 |
| **G3** | tech-general | `src/store/settings.ts`, `src/store/tasks.ts`, `src/store/agents.ts`, `src/tasks/api.ts`, `src/agents/api.ts` | 3, 6, 7, 12, 13, 14 |
| **U1** | tech-ui | `src/canvas/GraphCanvas.tsx`, `src/canvas/MemoryNodeCard.tsx`, `src/canvas/roleMeta.ts`, `src/canvas/viewport.ts` *(new)*, `src/wizard/NodeWizard.tsx` | 5, 9, 16, 17a |
| **U2** | tech-ui | `src/tasks/TasksBoard.tsx`, `src/tasks/NewTaskDialog.tsx`, `src/tasks/TagPicker.tsx` *(new)*, `src/inspector/Inspector.tsx`, `src/App.tsx` | 12, 13, 14, 17b |
| **U3** | tech-ui | `src/agents/modelCatalog.ts`, `src/agents/AgentEditor.tsx`, `src/tasks/NewAgentDialog.tsx`, `src/settings/SettingsModal.tsx` | 3, 6, 7, 15 |
| **B1** | tech-barn | `src/scene/**` (whole directory) | 7, 8 |
| **P1** | project-manager | `docs/tasks/*.md`, `.claude/skills/task-format/SKILL.md`, `docs/TERMINOLOGY.md`, `docs/TERMINOLOGY_REFERENCE.md`, `docs/fleet/*`, the CLAUDE.md Status line | 11 (docs), backlog filing |
| — | tech-lead | `docs/design/WO02_*.md` | 18, 19, 20 |

**Overlap audit** (every shared parent directory, resolved at file level):

- `src/tasks/` → U2 owns `TasksBoard.tsx`, `NewTaskDialog.tsx`, `TagPicker.tsx`;
  U3 owns `NewAgentDialog.tsx`; G3 owns `api.ts`. `NewSkillDialog.tsx` — nobody.
- `src/agents/` → G3 owns `api.ts`; U3 owns `modelCatalog.ts`, `AgentEditor.tsx`.
  `AgentAvatar.tsx`, `AgentList.tsx`, `RailSections.tsx`, `types.ts`, `SkillEditor.tsx` — nobody.
- `src/canvas/` → U1 owns four files. `MemoryEdge.tsx`, `KindPicker.tsx`,
  `RoleGlyphs.tsx`, `LensControl.tsx`, `lens.ts`, `types.ts`, `edgePath.ts` — nobody.
- `src/store/` → G3 owns three files. `graph.ts`, `project.ts`, `events.ts`,
  `review.ts`, `sessions.ts`, `tokens.ts` — nobody (frozen, §4.4).
- `src-tauri/src/` → G1 owns `tasks*`; G2 owns `agents*` + `lib.rs`. Nothing else.
- `docs/` → P1 owns `docs/tasks/` + terminology + fleet; tech-lead owns
  `docs/design/WO02_*.md`. `docs/testing/` — tester only, if a manual is written.

**Build order.** G1/G2/G3 land before U1/U2/U3/B1 are gated: U2 imports
`TASK_PRIORITIES`/`PRIORITY_LABELS`/`allTags`, U3 imports the new `createAgent`
signature, B1 imports `showFps`. Lanes may be *written* in parallel against this
frozen contract; they are *gated* in that order.

---

## 6. Frozen: no `graph.json` schema change

`GRAPH_VERSION` **stays 2**. No node role is added, no edge kind is added, no field
is added to `MemoryNode` or `MemoryEdge`, and `serializeGraph`'s output shape is
unchanged.

- **Item #5** (agent nodes look different) is a pure render change. The
  discriminator is the existing `isAgentFile(node.filePath)` helper — the same one
  `MemoryNodeCard` already uses to pick the avatar. **No `agentId`, no `isAgent`
  flag, no new role.** If a lane believes it needs a persisted field for #5, it
  stops and reports to tech-lead instead of adding one.
- **Item #9** (wizard-only creation) touches call sites, not persisted data.
- **Items #18/#20** (new roles, `controls` edges) *would* require
  `GRAPH_VERSION` 2 → 3 + a migration + `compile.rs` changes; that is precisely why
  they are design-only in this work order. See `WO02_DESIGN_NOTES.md`.

---

## 7. Per-item build spec

### 7.1 #3 — Per-agent memory files (G2 · G3 · U3)

- **G2**: `agent_memory_ensure` per §2.1 + ≥4 tests (fresh create; idempotent second
  call reports `created: false`; existing `MEMORY.md` is never rewritten; a
  path-traversal `fileName` is rejected).
- **G3**: `agentMemoryEnsure` wrapper in `src/agents/api.ts`; `createAgent` +
  `ensureMemory` per §4.3.
- **U3**: `AgentEditor` shows a calculated, read-only `Memory` row —
  `.claude/agent-memory/<stem>/` in `font-mono text-xs text-content-secondary` —
  with a secondary button **"Create memory folder"** calling `ensureMemory`. The
  button reports its result inline in the editor's existing error line; it never
  throws to the console.

### 7.2 #5 — Agent nodes look like agents (U1)

All changes inside `MemoryNodeCard.tsx`, gated on the existing `agentBacked` boolean.
Frozen visual delta:

1. Avatar plate replaces the 11px inline avatar: `<AgentAvatar size={22} />` inside
   `rounded-sm border border-border-strong bg-surface-inset p-[2px]`.
2. The role label line shows the agent's display name (`fields.name` from
   `useAgentsStore`, falling back to the file stem), followed by a `AGENT` micro
   tag in `var(--role-agent)`; the plain role word is dropped for agent cards only.
3. Footer gains, before the token chip: a `model` chip (`fields.model ?? "inherit"`)
   and a `P{priority}` chip from the sidecar meta. Both use the existing footer chip
   class; **at most one status badge** still holds (DESIGN_SPEC).
4. At rest (not selected / highlighted / flashing), the card carries an extra
   1px identity ring as the FIRST boxShadow layer:
   `0 0 0 1px var(--role-agent)`. Selection, highlight, flash and live-pulse rings
   keep priority exactly as today.
5. Card width is unchanged (`w-node`); height may grow.

**Acceptance**: on a graph with one `.claude/agents/*.md` node and six ordinary
nodes, the agent card is identifiable at a glance at zoom 0.5 without reading text.

### 7.3 #6 — Agent wizard, calculated defaults (U3, needs G2 §2.2)

`NewAgentDialog` gains, above Model:

- **Description** — `<input>` bound to frontmatter `description` (currently missing
  entirely), included in the `updateDraft` fields patch.
- **File** — `<input>` whose value auto-slugs from Name (`<slug>.md`) until the user
  edits it, then stops tracking (the `fileNameTouched` idiom from `NodeWizard`).
  A helper line under it shows the full calculated path `.claude/agents/<file>`.
  A case-insensitive collision against the loaded `agents` list shows an inline
  error and disables Create.
- **Memory folder** — a calculated read-only line `.claude/agent-memory/<stem>/`
  plus the amber toggle **"Create memory folder"**, default **on** (amber: it is a
  promise about agent behaviour, not a user action on the UI itself).

Submit calls `createAgent(name.trim(), { fileName, withMemory })`.

### 7.4 #7 — FPS toggle (G3 · U3 · B1)

- **G3**: `showFps` per §4.1.
- **U3**: in `SettingsModal`'s existing **View** section, below Manager mode:
  `<Row label="FPS counter">` + `Toggle` (accent — "blue is you"), helper line:
  *"Shows the Barn's frame rate in the scene overlay. The Barn deliberately drops to
  12 fps while idle, so a low number there is not a bug."*
- **B1**: an `appRef: useRef<Application | null>` set inside the init effect and
  nulled on dispose. A second effect, active only while `showFps && ready`, samples
  `app.ticker.FPS` every 500 ms into React state. Overlay:
  `absolute left-2 top-2 z-[1] font-pixel text-2xs text-[var(--amber)]`, text
  `` `${fps} fps` `` with ` · idle` appended while `app.ticker.maxFPS === 12`.
  **Zero cost when off**: no interval, no state updates, no extra ticker work.

### 7.5 #15 — Model catalog + "inherit" (U3)

`src/agents/modelCatalog.ts`:

```ts
export const MODEL_CATALOG: ModelCompany[] = [
  {
    company: "Anthropic",
    models: [
      "inherit",
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "opus",
      "sonnet",
      "haiku",
    ],
  },
  { company: "OpenAI", models: ["gpt-5", "gpt-5-mini", "o3"] },
  { company: "Google", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
  { company: "Other", models: [] },
];

/** Short explanations rendered under the picker; absent key = no note. */
export const MODEL_NOTES: Record<string, string> = {
  inherit:
    "Runs on whatever model the parent session is using — this agent pins no model of its own.",
  opus: "Alias: the current Opus tier, whatever that resolves to today. A dated id pins a snapshot.",
  sonnet: "Alias: the current Sonnet tier. A dated id pins a snapshot.",
  haiku: "Alias: the current Haiku tier. A dated id pins a snapshot.",
};
```

`companyFor` needs no change (it scans `models` arrays). `ModelPicker` renders
`MODEL_NOTES[value]` as a helper line (`text-2xs leading-snug text-content-muted`)
under the two selects when a note exists, and puts the same text on the option's
`title`. Ordering is deliberate: `inherit` first (it is the safest default), then
the Claude 5 family, then the tier aliases.

**What "inherit" means, for the record**: in Claude Code agent frontmatter, `model:`
selects which model a subagent runs on. `inherit` is not a model — it is the
instruction *"do not pin one; use the model of the session that spawned me."* An
agent that must be cheap or must be strong pins a model; an agent that should follow
whatever the user is paying for that day inherits. This sentence goes into
`docs/TERMINOLOGY_REFERENCE.md` (P1).

### 7.6 #8 — Barn performance investigation (B1)

This is an **investigation deliverable**, not a pre-named fix. Required output in
tech-barn's final report:

1. **Measurement** — frame time on the *default* scene (no project open, so
   `DEMO_NODES` props) at `INITIAL_ZOOM`, at 60 fps target, before any change:
   median and worst-case ms, and the device pixel ratio the measurement ran at.
2. **Named cause** — the single largest contributor, named with file and function.
   Suspects worth timing first, in this order:
   - `resolution: window.devicePixelRatio` × `INITIAL_ZOOM = 2` — framebuffer area
     on a scaled display;
   - `hover.sync({ cow, layout, agents })` running every frame over every prop;
   - `layout.tick` / `herd.tick` / `agents.tick` rebuilding `Graphics` per frame
     rather than mutating transforms;
   - particle pools (`spawnDust`, `spawnZ`) allocating instead of recycling;
   - `layout.rebuildProps` firing on every `useGraphStore` nodes change.
3. **Fixes applied** — only inside `src/scene/**`, only where the fix is safe and
   visually identical (the 16-bit rules in the `art-direction` skill still bind:
   whole-pixel camera, integer zoom ladder, no antialias).
4. **Not fixed / handed back** — anything that would need a file outside
   `src/scene/**`, a new dependency, or a visual compromise. Report it with the
   measured cost; tech-lead decides.

The FPS overlay from #7 is the measuring instrument — build it first.

### 7.7 #9 + #16 — Wizard-only creation, at viewport centre (U1)

New pure module `src/canvas/viewport.ts`:

```ts
export const NODE_CARD_W = 244;
export const NODE_CARD_H = 96;

/** Flow-space top-left for a card centred in the current viewport.
 *  Uses the RF viewport transform + the pane's own size — never client
 *  left/top, so a scrolled or offset page can't skew it. */
export function viewportCenterPosition(
  viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
): { x: number; y: number };
```

`GraphCanvas` changes:

- Every creation entry point opens `NodeWizard`. `createNode` is no longer called
  from the canvas (the `const createNode = useGraphStore(...)` line is removed;
  the store action itself stays — §1.3).
- Toolbar: the split button collapses to one plain **"New node"** button →
  wizard at `viewportCenterPosition(getViewport(), wrapperRect)`. The chevron and
  its dropdown are removed (nothing left to offer). `newNodeMenu` and its
  `ContextMenu` render go with it.
- Pane double-click → wizard at the click point (`screenToFlowPosition`, minus half
  the card).
- Pane context menu: one item **"New node here…"** (icon `Sparkles`) → wizard at
  the click point. The duplicate "New node wizard…" item is removed. "Fit view" and
  "Reveal project…" are unchanged.
- `NodeWizard` **re-derives** its position at Confirm rather than trusting the value
  captured at open: `initialPosition` becomes
  `initialPosition: { x: number; y: number } | (() => { x: number; y: number })`
  — GraphCanvas passes a thunk for the centre entry point and a fixed value for the
  two positional entry points. This is what makes #16 true even when the user pans
  while the wizard is open.

**Acceptance**: pan far off-origin, zoom to 0.5, click "New node", complete the
wizard — the card lands visibly centred in the pane. Double-click at a point lands
the card under the cursor.

### 7.8 #11 — Pure grids (G1 Rust · P1 docs)

**Canonical grid schema** (this is what the parser maps and what the docs must use):

| File | Columns |
|---|---|
| `TASKS.md`, `SPRINT.md`, `BUGS.md` | `Name \| Status \| Priority \| Tags \| Agent \| Created \| Description` |
| `BACKLOG.md` | `Name \| Status \| Priority \| Tags \| Agent \| Description` |
| `ROADMAP.md` | `Name \| Status \| Priority \| Tags \| Agent \| When \| Description` |

Cell rules, frozen:

- **Status** ∈ `new` · `in-production` · `in-testing` · `done` — **exactly the
  bucket string**, so it round-trips through `bucket_for_status_input` and matches
  what `task_update` writes back. *This fixes a live defect:* today's
  `✅ Done — accepted by Marty 2026-08-18` and `🔲 Open` cells normalize to **`new`**,
  so every completed row in `docs/tasks/TASKS.md` currently shows in the board's
  **New** column.
- **Priority** ∈ `low` · `medium` · `high` · `critical`, or empty.
- **Tags**: comma-separated, no `#` prefix, lowercase-kebab.
- **Agent**: agent file stem (e.g. `tech-ui`), or empty = Producer.
- **Created** / **When**: `Created` is an ISO date; `When` is one ISO date, `Q1`–`Q4`
  or `Phase N`. Both are **unmapped** columns — `task_update` preserves them
  byte-exact. `Created` is deliberately absent from `ROADMAP.md`: `when` extraction
  takes the *first* time token in the line, and a Created date would shadow the
  intended target date.
- **Description**: one sentence, ≤ 120 characters, no line breaks, no markdown.

Permitted non-grid content, and nothing else: the leading `# Title` line, and `##`
section headings (which drive the board's swimlanes in `TASKS.md`). No prose
paragraphs, no notes, no schema legends — the format lives in the skill, not in the
data files.

**P1 deliverables**: rewrite the four `docs/tasks/*.md` to the schema above
(preserving every item — long descriptions are *shortened*, never deleted; anything
that will not fit goes to git history, not to the bin), and rewrite
`.claude/skills/task-format/SKILL.md` so grids are the canonical form and checklist
lines are documented as the legacy form the parser still reads. The skill must also
name the fifth convention file (`BUGS.md`) and the new priority vocabulary.

### 7.9 #12 — Tag dropdown (G3 selector · U2 UI)

New `src/tasks/TagPicker.tsx` (U2), used by both `NewTaskDialog` and the Inspector's
`TaskPanel`, replacing `ChipEditor` for tags **only** (`ChipEditor` lives in
`AgentEditor.tsx` — U3's zone — and must not be edited):

- Trigger shows the selected tags as chips.
- Popup lists `allTags(tasks)` with a check state per tag; clicking toggles.
- Bottom row is a text input + **"Add tag"**: on Enter or click, the value is
  trimmed, `#` stripped, inner whitespace → `-`, lowercased, and added to the
  selection. Adding an already-present tag is a no-op, not an error.
- The popup uses the existing `ContextMenu` positioning idiom (button rect →
  x / bottom+4), not a right-click menu.

### 7.10 #13 — Priorities in the UI (U2)

- `PriorityBadge` maps buckets: `critical` → danger chip; `high` → amber chip;
  `medium` → `border-border bg-surface-2 text-content-secondary`; `low` →
  `border-border-subtle text-content-muted`. Label text is `PRIORITY_LABELS[b]`
  (so CRITICAL shouts and the others do not). An unrecognized raw value keeps
  today's neutral chip, displayed verbatim.
- `NewTaskDialog`'s `PRIORITIES` segmented control becomes
  `["none", ...TASK_PRIORITIES]` with `PRIORITY_LABELS`; `composeLine` emits
  `!<bucket>` instead of a bare `P1`.
- Inspector `TaskPanel`'s `PRIORITY_OPTIONS` segmented control uses the same set.

### 7.11 #14 — BACKLOG / ROADMAP / BUGS off the right side (G1 · G3 · U2)

- **G1/G3**: the fifth convention file (§2.3, §4.2).
- **U2**: `TasksBoard`'s fixed 300px right panel is **removed**. Below `FilterBar`
  sits a segmented control — `TASKS · BACKLOG · ROADMAP · BUGS` — using the
  `ViewToggle` idiom (2px padding frame on `surface-2`, active segment `surface-3`,
  24px segments). `TASKS` renders today's swimlane board **full width**; the other
  three render the flat list full width, keeping `showWhen` on for ROADMAP only.
  Selection, `pick()`, status/move menus and the New-task dialog are unchanged.
  Segment state is local `useState`, default `"TASKS"`.
- **U2** also updates `App.tsx`'s `VIEW_TITLES.tasks` to
  `"Browse TASKS / BACKLOG / ROADMAP / BUGS"` — the only App.tsx change in WO02.

**Positional-coupling warning (read before touching either array).**
`NewTaskDialog.relPathFor` resolves a file by `files[TASK_FILE_NAMES.indexOf(choice)]`.
Rust's `CONVENTION_NAMES` order and TS's `TASK_FILE_NAMES` order are therefore a
single contract. `BUGS.md` is appended **last in both**. Reordering either array —
or appending in a different position — silently writes tasks into the wrong file
with no error. G1 and G3 both own one half of this; the frozen order in §2.3/§4.2 is
what keeps them from having to talk.

### 7.12 #17 — Role descriptions brighter (U1 · U2)

`--text-muted` (#8E8477, 4.8:1) → `--text-secondary` (#C0B6A8, 8.7:1) at exactly
three call sites. No new token, no size change.

| File | Site | Lane |
|---|---|---|
| `src/wizard/NodeWizard.tsx` | `RolePicker` card description (`text-2xs … text-content-muted`) | U1 |
| `src/wizard/NodeWizard.tsx` | step-1 description under the picker (`mt-2 text-xs … text-content-muted`) | U1 |
| `src/inspector/Inspector.tsx` | `RoleField` description (`mt-1 text-xs … text-content-muted`) | U2 |

`src/canvas/roleMeta.ts` copy itself is **unchanged** (DESIGN_SPEC canon — do not
reword the first clause). U1 owns that file only to keep the directory zone clean.

---

## 8. Acceptance gates

Every gate must be green before the work order closes.

| # | Gate | Owner |
|---|---|---|
| 1 | `cargo clippy -- -D warnings` clean from `src-tauri/` | G1, G2 |
| 2 | `cargo test` green, with ≥ 12 new tests: ≥ 8 in `tasks/tests.rs` (priority buckets both directions; table-aware append into an existing table; append into a checklist-only file; append into an empty file; move into a table target; `BUGS.md` scanned and writable; unmapped cells preserved byte-exact) and ≥ 4 in `agents/tests.rs` (§7.1) | G1, G2 |
| 3 | `npm run build` (tsc strict, `noUnusedLocals`/`noUnusedParameters`, no `any`) clean | all TS lanes |
| 4 | `npm run lint` clean | all TS lanes |
| 5 | Invoke contract is **51/51**: `generate_handler!` list length, `docs/TERMINOLOGY.md` table, and the `cowtext-terminology` skill all agree | G2 + P1 |
| 6 | `graph.json` untouched: `GRAPH_VERSION === 2`, `git diff src/store/graph.ts` is empty | tech-lead audit |
| 7 | `AppSettings.version === 1`; a `settings.json` written by the previous build loads with no console error and `showFps` defaults to `false` | G3 |
| 8 | Rust `CONVENTION_NAMES` and TS `TASK_FILE_NAMES` are element-wise identical, in order | tech-lead audit |
| 9 | Every entry point that creates a graph node opens the wizard — toolbar, double-click, pane menu — and no path calls `createNode` from the canvas | U1 |
| 10 | After P1's rewrite, opening the Cowtext project shows every `docs/tasks` item in its correct board column (no Done row sitting in **New**) | P1 + tester |
| 11 | The Barn FPS overlay is absent from the DOM when `showFps` is false, and no interval is running | B1 |
| 12 | tech-barn's report names one measured cause for the default-scene frame drop, with before/after numbers for whatever was fixed | B1 |

Two things that are **not** gates and must not be attempted as such: a production
`tauri build` CSP check (already an open v0.1.0 gate, unrelated to this work order),
and Marty's v0.1.0 acceptance walk.

---

## 9. Deviation protocol

A lane that finds this contract wrong — a signature that cannot work, a zone that
forces it into a foreign file, a store field the seam actually needs — **stops,
states the failing assumption, and reports**. It does not improvise across a seam.
tech-lead ratifies or rejects; ratified deviations are recorded in the audit report
with the reason. This matters most for §6: a `graph.json` schema change invented
mid-flight is an automatic reject.

---

## 10. Audit & Revisions

> tech-lead adversarial audit, 2026-08-19, after all lanes landed. Verification was
> by `Read`/`Grep` only — this audit had no shell, so every "run this" item is
> handed to the dispatcher explicitly.

### 10.1 Gate results (the two gates owned by tech-lead)

**Gate 6 — `graph.json` untouched: PASS (semantic), one item handed back.**

Verified by reading `src/store/graph.ts`:

| Check | Result |
|---|---|
| `GRAPH_VERSION` | `2` (graph.ts:86) — unchanged |
| `MemoryNode` fields | `id · title · role · brief · filePath · readOrder · pinned · position · scenePos? · lastVerified?` (graph.ts:41-62) — identical to the pre-lane file |
| `MemoryEdge` fields | `id · source · target · kind · condition? · note?` (graph.ts:73-82) — identical |
| `EdgeKind` | still the four context kinds (graph.ts:64-71); no `controls`/`observes` leaked in from `WO02_DESIGN_NOTES.md` |
| `NodeRole` / `NODE_ROLES` | still seven; no `decision`/`example`/`environment` leaked in |
| `stableNode` / `stableEdge` / `serializeGraph` | field order and emitted shape unchanged (graph.ts:98-135) |
| `parseGraph` | still accepts `version` 1 or 2 with the `persona → agent` migration (graph.ts:145-152) |
| `createNode` action | still present and unwired from the canvas, exactly as §1.3 cut it |

**Handed to the dispatcher**: I cannot run `git diff`. Run
`git diff --stat -- src/store/graph.ts` and confirm it reports **no change**. The
reading above proves the *shape* is unchanged; only the diff proves not one byte moved.
U1's own report claims the diff is empty, which is consistent but is the lane
attesting to its own gate.

**Gate 8 — `CONVENTION_NAMES` ⇄ `TASK_FILE_NAMES` element-wise: PASS.**

```
src-tauri/src/tasks.rs:41-42   ["TASKS.md", "SPRINT.md", "BACKLOG.md", "ROADMAP.md", "BUGS.md"]
src/store/tasks.ts:51-57       ["TASKS.md", "SPRINT.md", "BACKLOG.md", "ROADMAP.md", "BUGS.md"]
```

Identical, in order, `BUGS.md` appended last. The consumer that made this a gate —
`NewTaskDialog.relPathFor` (`src/tasks/NewTaskDialog.tsx:121-123`,
`files[TASK_FILE_NAMES.indexOf(choice)]`) — resolves correctly against the 5-entry
`TasksScan.files`. Both arrays now carry a cross-reference comment naming the other.

### 10.2 Seam verification (all clean)

| Seam | Verdict |
|---|---|
| §2.3 three-way rule as implemented (`write_task_text` / `write_task_fields`, tasks.rs:1027-1141) | Faithful. Table-row insertion goes after the **last data row** (not EOF), pipe style and cell count sampled from that row (`last_named_table`, tasks.rs:947-977); checklist fallback only when the file already has checklist tasks; canonical table otherwise, with correct 1-based line arithmetic in both `create_canonical_table` branches |
| §2.4 priority buckets | Faithful in all five directions: table scan (tasks.rs:450-451), checklist scan (`!bucket` + legacy `P0`–`P3`, tasks.rs:535-549), checklist write (tasks.rs:738-748), table write (tasks.rs:841-849), move recompose (tasks.rs:1091-1099). Bare words are **not** eaten — only `!`-prefixed or 2-char `P` tokens are considered, so a task named "High level refactor" keeps no priority |
| §4.1 `showFps` | Appended last in all four places (interface, defaults, `mergeSettings`, `persistNow`), `version` still `1` |
| §4.3 `createAgent` → `agentMemoryEnsure` failure isolation (store/agents.ts:443-451) | Correct: memory failure is caught, the agent still lands, message goes to `opError`, `createAgent` still returns `null` |
| §2.1 `agent_memory_ensure` (agents.rs:314-349) | Correct, including `created` = dir-or-index and the byte-exact seed; stem slicing is safe because `validate_md_component` guarantees a 3-byte ASCII `.md` suffix |
| §7.7 thunk re-derivation | Real: `GraphCanvas` stores a thunk via `setWizardPos(() => () => …)` reading `getViewport()` + the pane rect at call time (GraphCanvas.tsx:116-122), and `NodeWizard.doConfirm` invokes it at Confirm (NodeWizard.tsx:335). Panning while the wizard is open does land the card in view |
| §7.2 boxShadow layering | Correct: `restShadow` (with the agent identity ring) is the **else** branch — selected / highlighted / flash replace it entirely rather than stacking, and the live glow appends to whichever won (MemoryNodeCard.tsx:108-119) |
| §7.2 store subscriptions | No unstable-selector hazard: `metaOrDefault` returns `meta[k] ?? DEFAULT_META` (a module constant), so the new `useAgentsStore` selectors return stable references and cannot trigger zustand v5's `getSnapshot` loop |
| §7.9 / §7.10 UI | `TagPicker` used by both consumers, `ChipEditor` untouched; `PRIORITY_OPTIONS`/`PRIORITIES` both `["none", ...TASK_PRIORITIES]`; `composeLine` emits ` !low` — matches the Rust `!bucket` parser exactly |
| §7.4 FPS overlay | Gate 11 met by construction: returns `null` and starts no interval unless `showFps && ready` (BarnScene.tsx:96-120) |

### 10.3 Confirmed defects

**D1 — `isTaskFile` never matches; the Tasks board never live-refreshes.
CONFIRMED · MAJOR · pre-existing (WO01), in a WO02-owned file.**

`src/store/tasks.ts:124-125`

```ts
const base = (normalized.split("/").pop() ?? "").toUpperCase();   // "TASKS.MD"
if (!(TASK_FILE_NAMES as readonly string[]).includes(base)) return false;   // "TASKS.md"
```

The basename is upper-cased whole, including the extension, then compared against
entries whose extension is lower-case. `"TASKS.MD" !== "TASKS.md"` — the function
returns `false` for **every** real task file. `onTaskFileChange` (tasks.ts:155-156)
therefore returns early on every `fs://change`, and the debounced reload never fires.

*Failure scenario*: open a project, go to the Tasks tab, and edit
`docs/tasks/TASKS.md` in another editor — or let a Claude Code session write it.
Wait past the 500 ms debounce. The board does not change. Switching tabs away and
back remounts `TasksBoard` and its `load(root)` fires, so the change appears — which
is why this has read as "sometimes slow" rather than "broken".

*Why it matters more after WO02*: #11 makes hand-edited grids the canonical form and
P1's rewrite of `docs/tasks/*.md` is precisely the external-edit case; #14 adds
`BUGS.md` to the board. This is the one integration Marty is most likely to try
during the acceptance walk.

*Fix* (one line, G3's zone): compare case-insensitively —
`TASK_FILE_NAMES.some((n) => n.toUpperCase() === base)`.

**D2 — `TaskItem.description` type lie feeds `null` into a controlled textarea.
CONFIRMED · MINOR · pre-existing, surfaced in two WO02-owned files.**

`src/tasks/api.ts:16` declares `description: string`, but Rust emits
`Option<String>` (`src-tauri/src/tasks.rs:52`), i.e. JSON `null`. At
`src/inspector/Inspector.tsx:1013`, `setDescription(item.description)` then puts
`null` into `<textarea value={…}>`.

*Failure scenario*: select any task with no description — every checklist line
without a ` — ` boundary, and every table row whose table has no Description column
(the canonical `BACKLOG.md` schema has one, but foreign tables often don't). React
logs the "value prop on textarea should not be null" warning and the field flips to
uncontrolled, so the resync effect stops driving it until the first keystroke.

*Fix*: `description: string | null` in `api.ts` (matching the wire) and `?? ""` at
the two consumers.

**D3 — stale doc comments. CONFIRMED · TRIVIAL.**
`src/store/tasks.ts:2-3` still says "the four convention files
(TASKS/SPRINT/BACKLOG/ROADMAP.md)"; `src-tauri/src/tasks.rs:126` still says "one of
the 12 recognized convention locations" (now 15). No behavioural impact.

**D4 — Gate 5 is unsatisfiable as I wrote it. CONFIRMED · MINOR (contract defect,
mine).** Gate 5 requires the invoke count to agree across `generate_handler!`,
`docs/TERMINOLOGY.md`, **and the `cowtext-terminology` skill** — but §5's zone grid
gives P1 `.claude/skills/task-format/SKILL.md` only. Nobody owns
`.claude/skills/cowtext-terminology/SKILL.md`, which still reads "50" in its module
table and lists 50 command names. **Revision**: that file is added to P1's zone;
P1 must add `agent_memory_ensure` to the agents group and change 50 → 51 in both the
skill and `docs/TERMINOLOGY.md`. `agent_memory_ensure` is confirmed present in
`generate_handler!` (`src-tauri/src/lib.rs:48`).

### 10.4 Observations (no action this work order)

- **O1** — With grid-only files, `FlatListPanel` rows render no checkbox (it is
  gated on `task.source === "checklist"`), so BACKLOG / ROADMAP / BUGS items can
  only be completed from the Inspector. Consistent with #11; worth a line in the
  acceptance walk so it doesn't read as a regression.
- **O2** — `NewTaskDialog.relPathFor` resolves a *missing* convention file to its
  root-level default (Rust reports the bare `name` with `exists: false`), so the
  first BUGS task in a project that keeps tasks under `docs/tasks/` creates
  `BUGS.md` at the project root. Pre-existing for all four old files; newly
  reachable for `BUGS.md` now that the segment exposes it.
- **O3** — `task_move` always writes the moved item with status `new` (G1 documented
  this). A Done row moved from `TASKS.md` to `BACKLOG.md` arrives as New. Pre-existing
  shape, now explicit in the doc comment.

### 10.5 Deviation verdicts

**V1 — G1: `task_move` recomposes from the source `TaskItem` instead of copying the
line verbatim. RATIFIED.**
§2.3 froze the *destination* shape rule and said the moved item is written "using the
same three-way rule"; it never froze the source encoding. Recompose is what makes the
rule coherent — verbatim copy would drop a pipe row into a checklist file. It is also
strictly less lossy: tags, agent and priority now survive a table → checklist move,
which the old verbatim path discarded outright. §2.3's `task_move` paragraph is
amended to read "written from the source item's parsed fields using the same
three-way rule".

**V2 — U1: `AgentAvatar` prop type widened `11 | 44` → `11 | 22 | 44`. RATIFIED.**
§7.2 froze `size={22}`, which the existing union made unrepresentable — the contract
created the impossibility, so this is my error, not lane overreach. The change is
additive (one union member, no logic), the file was unowned so no lane lost a zone,
and U1 stopped and reported rather than silently picking `44`. Exactly the §9
behaviour. **Zone revision**: `src/agents/AgentAvatar.tsx` is retroactively assigned
to U1 for this one line.

**V3 — U2: `TagPicker` implements its own popup rather than reusing `ContextMenu`.
RATIFIED.**
§7.9 specified the ContextMenu *positioning idiom* (button rect → x / bottom+4), not
the component. `MenuItem` is a closed union with no text-input variant, so the
create-new row would have required editing `src/ui/menuTypes.ts` and
`src/ui/ContextMenu.tsx` — both unowned, both consumed by roughly ten call sites.
U2 chose the smaller blast radius and flagged it, which is the right instinct. The
implementation does reproduce the viewport-flip / outside-close / Escape behaviour,
so the idiom held. *Follow-up (backlog, not now)*: if a third caller needs an
input-bearing popup, extract a shared popup shell rather than growing a third copy.

**V4 — B1: cap the Barn renderer at `Math.min(window.devicePixelRatio, 2)`?
REJECTED for WO02 · BACKLOG with a measurement gate.**

- The cause is **derived, not measured** — B1 had no GPU available and eliminated the
  other four suspects by code reading. Capping `resolution` degrades fidelity on the
  one surface whose whole value is that it looks right ("whole-pixel camera, integer
  zoom ladder, no antialias" exist for this reason), justified by an untested
  hypothesis. That inverts the burden of proof.
- It would land immediately before Marty's v0.1.0 acceptance walk, on the exact
  surface that walk judges.
- It is now cheap to settle empirically: the #7 FPS overlay shipped in this same work
  order **is** the instrument, and the acceptance walk produces the measurement for
  free.
- **Backlog entry, with its gate**: *"Cap Barn renderer `resolution` at
  `Math.min(devicePixelRatio, 2)` — only after the FPS overlay reads < 50 fps on the
  default scene at DPR > 2, and only with an A/B screenshot pair at zoom 1 and zoom 4
  showing no visible softening."* If the walk confirms the drop is DPR-correlated,
  the cap ships in WO03 with evidence behind it.
- B1's hover-label caching changes inside `src/scene/` **stand as landed** — in-zone,
  visually identical, and independent of this decision.

### 10.6 Handed back

| To | Item |
|---|---|
| dispatcher | Run `git diff --stat -- src/store/graph.ts` to close gate 6 literally |
| G3 (or a fix lane) | **D1** `src/store/tasks.ts:124-125` — case-insensitive compare |
| G3 + U2 | **D2** `src/tasks/api.ts:16` → `string \| null`, `?? ""` at consumers |
| G1 + G3 | **D3** two stale doc comments |
| P1 | **D4** own `.claude/skills/cowtext-terminology/SKILL.md`; 50 → 51 + `agent_memory_ensure` there and in `docs/TERMINOLOGY.md`. Also file O1/O2/O3 and the V3/V4 follow-ups to BACKLOG |
| tester | O1 and O3 belong in the acceptance-walk notes so they don't read as regressions |
