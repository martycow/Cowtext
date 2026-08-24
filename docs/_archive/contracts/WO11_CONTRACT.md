# WO11 — Acceptance-walk defects + Home / Git / Project / Avatars

Status: **FROZEN 2026-08-20**. Source: `docs/INPUT_PROMPT.md` (Marty's WO10
acceptance walk, 6 defect groups + 6 new features).

Amends WO10 (`WO10_CONTRACT.md`) — its §3 items 11, 12, 16 and its Lane 6
project suite. Does **not** amend WO09's connector geometry.

Invoke commands: **66 → 73**. Graph schema: **unchanged (v4)**.
`.cowtext/project.json`: **unchanged (v1)**. `.cowtext/agents.json`:
**unchanged (v1)**.

---

## 1. Scope

Everything in `INPUT_PROMPT.md` as of 2026-08-20, in one round:

| Group | Items |
|---|---|
| A | Project wizard: Video Game type, brief cap, list fields swallow space/newline, optional collapsed |
| B | Hierarchy: VS Code row shape, agent selection breaks the UI |
| C | Inspector: "Adopt to graph" breaks the UI, Transform pinned to top, Tools dropdown won't scroll |
| D | Agent properties: make it a component, Create-it → Reveal/Fix, model duplicates, no Save button, no Delete Agent |
| E | Duplicate "Add agent" |
| F | Node wizard: Assemble-after-close crashes |
| G | Home button, Git wizard, project properties in Inspector, reveal project, agent detail in the fleet view, agent avatars |

Out of scope: §8.

---

## 2. Root causes

### 2.1 CONFIRMED — read from the code

**A3 — spaces and newlines are swallowed in Requirements / Hard rules / Constraints.**
`src/project/ProjectWizard.tsx:58-86` (`ListField`) is a **controlled** textarea
whose value is re-derived from the parsed list on every keystroke:

```
value={listToLines(value)}
onChange={(e) => onChange(linesToList(e.target.value))}
```

and `src/project/types.ts:51-56` (`linesToList`) does
`.replace(/^\s*[-*]\s+/, "").trim()` then `.filter((l) => l !== "")`.

Failure scenario: type `Run` then Space → React re-renders the textarea with
`"Run"` (trailing space trimmed) → the space never appears and the caret jumps
to end. Press Enter → a trailing empty line is created, `filter` drops it, the
newline never appears. Typing `- ` at line start is eaten by the bullet regex.
The field is not a chip input and no key handler is involved: the round-trip
itself is lossy.

**Fix (frozen):** `ListField` owns the raw text in local state, seeded once from
`listToLines(value)` and re-seeded only when the field's identity changes.
`onChange` sets the raw text **and** calls `onChange(linesToList(raw))`. The
textarea renders the raw text, never the re-serialized list. The bullet-strip
regex moves out of the keystroke path — it runs only inside `linesToList`, which
is now a commit-time projection, and Rust's `clean_list`
(`project_meta.rs:86-92`) remains the final normalizer.

**B1 — hierarchy does not read like VS Code.** Three separate causes, all in
`src/App.tsx`:

1. `FileRow` renders **`file.relPath`** (line 802), not the basename, inside a
   tree that has already indented by directory — so a file under `context/design/`
   shows the whole path again, with `[direction:rtl]` truncation reversing the
   visual anchor (line 798).
2. File rows have no chevron gutter, and the two row types use different
   spacing (`DirRow` = `gap-1.5` + 12px chevron at `App.tsx:925-932`; `FileRow`
   = `gap-2` + 13px icon at `App.tsx:771`), so icons never line up in one column.
3. `sortEntries` (`App.tsx:872-876`) sorts **files before directories**
   (`a.kind === "file" ? -1 : 1`). VS Code puts folders first.

**Fix (frozen):** one row primitive, one 16px chevron gutter (empty on files),
basename only (`title` keeps the full relPath), LTR truncation, folders first
then files, both alphabetical, indentation via a per-depth left pad on the row
(not nested `<ul>` padding), row height stays `h-row`.

**C2 — Transform pinned to the top.** There is no ordering model: `Position` is
literally the first `<InspectorSection>` in the JSX of both
`Inspector.tsx:1458` (`PropertiesTab`) and `Inspector.tsx:1044`
(`AgentNodePanel`). See §5.3 for the frozen order.

**C3 — Tools dropdown cannot be scrolled.** `src/agents/ToolPicker.tsx:66,71`:

```
const onScroll = () => onClose();
window.addEventListener("scroll", onScroll, true);   // capture phase
```

The popup's own list is `overflow-y-auto` with `max-h-[340px]`
(`ToolPicker.tsx:123,125`), so scrolling it fires a `scroll` event that the
**capture-phase window listener sees first** and closes the popup. The dropdown
is scrollable and dismisses itself on the first wheel tick.

**Fix (frozen):** the scroll-close handler ignores events whose target is
`popRef.current` or contained by it — `if (popRef.current?.contains(e.target as Node)) return;`
The outside-scroll close (repositioning would be wrong) stays.

**D2 — "Create it" does nothing and always shows.**
`src/agents/AgentEditor.tsx:294-295`:

```
const memoryIndexPath = `${memoryPath}MEMORY.md`;
const memoryMissing = !files.some((f) => sameRelPath(f.relPath, memoryIndexPath));
```

`files` comes from `scan_project`. `src-tauri/src/project.rs:94-103` special-cases
`.claude` **at root only** and collects **`.claude/agents/*.md` and nothing
else**; every other dot-directory is skipped (line 104). So
`.claude/agent-memory/<stem>/MEMORY.md` is *never* in `files` and `memoryMissing`
is **always true** for every agent, healthy or not. Clicking the button calls
`agent_memory_ensure`, which is idempotent and never clobbers — on an agent that
already has memory it writes nothing, the scan still can't see the file, and the
button stays exactly as it was. That is precisely "does nothing, and is
displayed to matter that the memory file exists."

Second, smaller defect on the same control: `doEnsureMemory`'s error lands in
`saveError` (`AgentEditor.tsx:344-346`), which is rendered only inside the
Duties block (`line 560`) — far below the button — and **not at all** in the
`raw` branch.

**Fix (frozen):** the frontend cannot answer this question from the project
scan. New read-only probe `agent_memory_status` (§4.3) is the source of truth;
the button becomes Reveal / Fix per §5.5. Errors render adjacent to the button.

**D3 — duplicate models.** `src/agents/modelCatalog.ts:15-24` lists canonical
ids and bare aliases in one flat select:
`claude-opus-5` + `opus`, `claude-sonnet-5` + `sonnet`,
`claude-haiku-4-5-20251001` + `haiku`. Two rows per model tier. See §5.6.

### 2.2 UNRESOLVED by reading — Stage 0 must diagnose

I could not name the throwing expression for **B2**, **C1** or **F1** from
static reading, and I will not guess in a frozen contract. What I did establish:

**The app has no error boundary at all.** `ErrorBoundary` /
`componentDidCatch` / `getDerivedStateFromError` appear nowhere in `src/`.
Any render-phase throw therefore unmounts the whole React tree and blanks the
window — which is exactly the symptom Marty reports for all three. This is the
single structural reason three unrelated actions produce one indistinguishable
failure mode.

Ranked hypotheses, for the record:

- **B2** — the agent path is the only one that mounts `AgentEditor`, and it
  reaches it through two different Inspector branches (`AgentNodePanel`
  `Inspector.tsx:1003` when the agent is on the graph, `StandaloneAgentsPanel`
  `Inspector.tsx:1113` when it is not). Both render `AgentEditor`, so the throw
  is inside `AgentEditor` or one of its WO10-new children (`ToolPicker`,
  `ModelPicker`, `SkillsChecklist`, `CodeMirrorEditor`).
  Related **confirmed** defect on the same path, whatever the crash turns out to
  be: `AgentNodePanel` derives `fileName` with `node.filePath.split("/").pop()`
  (`Inspector.tsx:1004`) — a bare `/` split, not `canonPath`. A node stored with
  backslashes (the shape WO10's §4 says Windows produces easily) yields a
  `fileName` no agent matches, and the panel falls through to "Agent file … is
  not loaded". Use `canonPath`/`sameRelPath` here.
- **C1** — "Adopt to graph" (`Inspector.tsx:1147-1152`) calls `adoptFile`, which
  swaps the Inspector from `StandaloneAgentsPanel` to `AgentNodePanel` in one
  commit. Same `AgentEditor` suspicion as B2, plus the branch swap.
- **F1** — the Assemble-after-close branch (`NodeWizard.tsx:364-383`) is
  structurally identical to `Inspector.tsx:129-157` and
  `MemoryNodeCard.tsx:195-214`, both of which work, so a JS render throw is the
  *weaker* hypothesis here. The stronger one is Rust-side: `assemble.rs` takes
  the queue mutex with `.expect("assemble queue mutex")` at lines
  **203, 222, 243, 272, 296**. One panic in the pump thread poisons the mutex,
  after which every later `assemble_*` command panics too — a backend abort
  blanks the window in a way indistinguishable from a JS crash.

**Stage 0 (blocking, see §6):** land the error boundary, then reproduce B2, C1
and F1 with `npm run tauri dev` open and record, for each: the JS stack (if
any) **or** the Rust panic line. Publish the three verdicts before any of the
B2/C1/F1 fix work starts. If a case turns out to be a Rust panic, it moves from
the UI lane to lane R2 by amendment, not by improvisation.

---

## 3. Schema decisions

| Artefact | Change | Migration |
|---|---|---|
| `graph.json` | **none** (stays v4) | — |
| `.cowtext/project.json` | **none** (stays v1) — G3 edits the existing eight fields | — |
| `.cowtext/agents.json` | **none** (stays v1) | — |
| Avatars | **new files, no schema**: `.cowtext/avatars/<agent-stem>.<ext>` | none needed |
| `.gitignore` | user file, no schema | — |

**Avatars deliberately carry no sidecar key.** The path is derived server-side
from the agent's file stem, so "does this agent have a custom avatar" is
answered by `agent_avatar_read` returning non-null. No `agents.json` version
bump, no orphan-key reconciliation, no second writer for a file the frontend
already owns byte-for-byte (`serializeMeta`, `store/agents.ts:280-309`).
Consequence to respect: `agent_rename` must move the avatar file — that is part
of lane R2's acceptance.

**One wire change to an existing command** (ASK #7): `agent_save` returns
`AgentDoc` instead of `()`. Required by D4 — see §5.7.

---

## 4. Command contract (7 new; 66 → 73)

Names are byte-exact for `generate_handler!`. camelCase in JS ⇄ snake_case in
Rust. Every new command validates its root through `checked_root` and never
accepts a webview-supplied absolute path except where stated.

### 4.1 Git — `src-tauri/src/git.rs` (new module, lane R1)

Shells out to the system `git` exactly as `worktree.rs` already does
(`Command::new("git")`, `no_console` CREATE_NO_WINDOW, `stderr_tail`).
**No new dependency.** `git` missing from PATH is an *answer*, not an error
(`gitAvailable: false`), mirroring `worktree_check`'s doctrine at
`worktree.rs:127-140`.

```rust
#[tauri::command] pub fn git_status(root: String) -> Result<GitStatus, String>
#[tauri::command] pub fn git_init(root: String) -> Result<GitStatus, String>
#[tauri::command] pub fn gitignore_write(root: String, content: String) -> Result<(), String>
```

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub git_available: bool,       // `git --version` succeeded
    pub git_version: Option<String>,
    pub is_repo: bool,
    pub has_commits: bool,         // `git rev-parse HEAD` succeeded
    pub branch: Option<String>,    // None on detached HEAD / no commits / not a repo
    pub gitignore_exists: bool,
    pub gitignore_content: Option<String>,  // verbatim, None when absent
}
```

```ts
// src/git/types.ts  (lane R1)
export interface GitStatus {
  gitAvailable: boolean;
  gitVersion: string | null;
  isRepo: boolean;
  hasCommits: boolean;
  branch: string | null;
  gitignoreExists: boolean;
  gitignoreContent: string | null;
}
// src/git/api.ts   (lane R1)
export function gitStatus(root: string): Promise<GitStatus>;
export function gitInit(root: string): Promise<GitStatus>;
export function gitignoreWrite(root: string, content: string): Promise<void>;
```

Rules, frozen:

- `git_init` runs `git -C <root> init` and **nothing else** — no commit, no
  remote, no config, no first `add`. It re-probes and returns the fresh
  `GitStatus`. Calling it on an existing repo is a no-op that still returns
  status (git's own `init` is idempotent).
- `gitignore_write` writes `<root>/.gitignore` through `write_atomic`. It is
  **not** a general write primitive: the path is fixed server-side, `content`
  is the only variable, and content is normalized to LF with exactly one
  trailing newline before writing.
- `.gitignore` is a user file, so the trust boundary applies: the UI **must**
  show the LCS diff (`src/compile/diff.ts`, already built) of
  `gitignoreContent` → proposed content, with explicit approval, before
  `gitignore_write` is called. No silent write, ever.
- Nothing here touches `.claude/settings.json` and nothing here stages,
  commits or pushes.

### 4.2 Agent avatars — `src-tauri/src/agents.rs` (lane R2)

```rust
#[tauri::command] pub fn agent_avatar_set(root: String, file_name: String, source_path: String)
    -> Result<AgentAvatarRef, String>
#[tauri::command] pub fn agent_avatar_read(root: String, file_name: String)
    -> Result<Option<String>, String>          // data URL, or None
#[tauri::command] pub fn agent_avatar_clear(root: String, file_name: String) -> Result<(), String>
```

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct AgentAvatarRef {
    pub rel_path: String,   // ".cowtext/avatars/tech-ui.png"
    pub data_url: String,   // "data:image/png;base64,…"
    pub bytes: u64,
}
```

```ts
// src/agents/avatarApi.ts  (lane R2)
export interface AgentAvatarRef { relPath: string; dataUrl: string; bytes: number }
export function agentAvatarSet(root: string, fileName: string, sourcePath: string): Promise<AgentAvatarRef>;
export function agentAvatarRead(root: string, fileName: string): Promise<string | null>;
export function agentAvatarClear(root: string, fileName: string): Promise<void>;
```

Rules, frozen:

- `source_path` is the **only** absolute path any WO11 command accepts, and it
  arrives from `@tauri-apps/plugin-dialog`'s `open()` — a user-chosen file. It
  is read, never written to, and never stored; only the copy inside the project
  is kept.
- Accepted formats by **magic bytes**, not extension: PNG (`89 50 4E 47`),
  JPEG (`FF D8 FF`), WebP (`RIFF….WEBP`), GIF (`GIF87a`/`GIF89a`). Anything
  else → `Err("unsupported image format — PNG, JPEG, WebP or GIF")`.
- Size cap **512 KB**; over → `Err("image too large (max 512 KB)")`. No
  resizing, no re-encoding, no pixel-dimension check — that would need an image
  crate, and the stack is fixed (ASK #2).
- Destination is derived server-side: `.cowtext/avatars/<stem>.<ext>` where
  `<stem>` is `file_name` minus `.md` and `<ext>` comes from the detected
  format. Writing replaces any existing avatar for that agent **and deletes
  any sibling with a different extension**, so an agent can never have two.
- `agent_avatar_read` returns `Ok(None)` when there is no avatar and when the
  file is unreadable — a broken avatar must never stop the rail from
  rendering.
- `agent_rename` (existing) gains: move `.cowtext/avatars/<old>.<ext>` to
  `<new>.<ext>` when present. `agent_delete` (existing) gains: remove it.
  Both best-effort — an avatar failure never fails the rename/delete.
- Frontend fallback is the existing `AgentAvatar` identicon whenever the data
  URL is null. The identicon algorithm is **frozen and unchanged**
  (`src/identity/identity.ts`).

### 4.3 Agent memory probe — `src-tauri/src/agents.rs` (lane R2)

```rust
#[tauri::command] pub fn agent_memory_status(root: String, file_name: String)
    -> Result<AgentMemoryStatus, String>
```

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct AgentMemoryStatus {
    pub dir_rel_path: String,     // ".claude/agent-memory/tech-ui/"
    pub index_rel_path: String,   // ".claude/agent-memory/tech-ui/MEMORY.md"
    pub dir_exists: bool,
    pub index_exists: bool,
    pub index_bytes: u64,
    pub healthy: bool,            // dir_exists && index_exists && index is valid UTF-8
}
```

```ts
// src/agents/api.ts  (lane R2, appended)
export interface AgentMemoryStatus {
  dirRelPath: string; indexRelPath: string;
  dirExists: boolean; indexExists: boolean; indexBytes: number; healthy: boolean;
}
export function agentMemoryStatus(root: string, fileName: string): Promise<AgentMemoryStatus>;
```

Read-only. `healthy === false` with `index_exists === true` means the index is
present but not valid UTF-8 — the "corrupted" case Marty named. Zero-byte
`MEMORY.md` counts as **unhealthy** (`index_bytes == 0` → `healthy: false`):
an empty index is the shape `agent_memory_ensure` is supposed to fix.

### 4.4 Registration

`src-tauri/src/lib.rs` gains exactly seven `generate_handler!` entries:

```
git::git_status, git::git_init, git::gitignore_write,
agents::agent_avatar_set, agents::agent_avatar_read, agents::agent_avatar_clear,
agents::agent_memory_status
```

`docs/TERMINOLOGY.md` invoke table and its "(66)" headings become **(73)**;
new group row `| git | git_status, git_init, gitignore_write |`; the three
avatar commands and `agent_memory_status` join the existing `agents` row.

---

## 5. Frozen UI decisions

### 5.1 Project wizard (A1–A4)

- **A1.** `PROJECT_TYPES` (`src/project/types.ts:28-34`) gains, as the second
  entry:
  `{ key: "game", label: "Video Game", hint: "Interactive, real-time; content and feel matter as much as code." }`
  `projectType` stays free-form on the wire — no Rust change.
- **A2.** `export const PROJECT_BRIEF_MAX = 1000;` in `src/project/types.ts`.
  The brief textarea clamps **user input only** (`e.target.value.slice(0, PROJECT_BRIEF_MAX)`)
  and shows a live `n / 1000` counter, amber at ≥ 900. It must **not** clamp on
  load: a longer hand-written sidecar round-trips untouched until edited. Rust
  does not truncate.
- **A3.** As §2.1.
- **A4.** Step 2 splits into a required block (Name, Type, Brief, Requirements)
  and one collapsed disclosure titled `Optional (4)` holding Hard rules, Target
  audience, Architecture, Constraints. Collapsed by default; auto-**expanded**
  on open when any of the four already has a value (edit mode must never hide
  data the user typed). Not persisted in `AppSettings` — this is a wizard, not
  a panel.

### 5.2 Hierarchy (B1, G3 row, G4)

Row order in the rail, top to bottom: **project row** → file tree → AGENTS →
SKILLS.

- Project row (currently `App.tsx:1080-1088`) becomes selectable: click selects
  the project (§5.4), right-click opens a menu with **Reveal in File
  Explorer** (`revealPath(root, null)` — the existing invoke, **no new
  command** — G4), **Edit project properties…** (opens `ProjectWizard`
  mode `"edit"`), **Git…** (opens `GitWizard`), **Rescan**.
- Tree rows per §2.1 B1.
- Selection highlight uses the existing `bg-accent-surface shadow-[inset_2px_0_0_var(--accent)]`.

### 5.3 Inspector section order (C2, D1)

New module `src/inspector/sectionOrder.ts` exporting one declared order per
panel kind. Panels render by mapping that array — no section may be hoisted by
being first in JSX again.

| Panel | Order |
|---|---|
| memory node | Metadata · Context · Relations · File · **Position** · Assemble · Actions |
| agent node | **Agent** · Context · Relations · **Position** · Assemble · Actions |
| off-graph agent | **Agent** · Actions |
| skill | Skill · Actions |
| edge | Metadata · Path · Actions |
| **project** (new) | Identity · Description · Requirements · Rules & constraints · Git · Actions |

`sectionKey` strings are stable and additive (`node.agent`, `project.identity`,
`project.description`, `project.requirements`, `project.rules`, `project.git`,
`project.actions`). `AppSettings.collapsedSections` needs **no migration**: a
key absent from the collapsed list starts open, which is the documented WO10
behaviour.

No drag-to-reorder. No add/remove component. Same reasoning as WO10 §2.4.

### 5.4 Project properties in the Inspector (G3)

New panel-owning selection, because the Inspector's branch ladder
(`Inspector.tsx:1997-2057`) is a fixed priority list and the project must take
its own slot. New store `src/store/projectSelection.ts`:

```ts
interface ProjectSelectionState { selected: boolean; select: (v: boolean) => void }
export const useProjectSelectionStore = create<ProjectSelectionState>(...)
```

`useGraphStore.setSelection` (`store/graph.ts:808-818`) gains
`useProjectSelectionStore.getState().select(false)` alongside its existing
agents/tasks clears — and the guard at line 812 that early-returns on an
unchanged selection **must be moved after the clears**, or selecting the
project while the graph selection is already empty will not clear the other
panels. (That same early return is a live defect today: with a task selected
and no node selected, clicking an off-graph agent in the rail never runs
`clearTaskSelection()`, so the Inspector keeps showing the task.)

Branch priority becomes: session → node → edge → multi → **project** → task →
agent → empty.

Field split, frozen:

| Field | In Inspector |
|---|---|
| `name` | **read-only** (identity; edit in the wizard) |
| `projectType` | **read-only** |
| root path, `.cowtext/project.json`, `context/project.md` presence | **read-only** |
| git branch / repo state (from `git_status`) | **read-only** |
| `brief` | editable (same 1000 cap + counter) |
| `requirements` | editable |
| `hardRules` | editable |
| `targetAudience` | editable |
| `architecture` | editable |
| `constraints` | editable |

Rule: **identity and scaffold are read-only here; description content is
editable.** Anything read-only carries a "Edit in the project wizard" link.

Persistence: edits commit **on blur**, not per keystroke, via
`project_meta_write`. Reason: `project_meta_write`
(`project_meta.rs:192-204`) rewrites `context/project.md` whenever it exists —
a user-owned Memory Node. Per-keystroke writes would rewrite a user file
dozens of times a sentence. On-blur is the frozen behaviour; the existing
conditional refresh (never resurrect a deleted node) stays exactly as is.

### 5.5 Agent memory control (D2)

Replaces `AgentEditor.tsx:529-547` entirely. State comes from
`agent_memory_status`, re-probed on agent selection and after every action —
**never** from `useProjectStore.files`.

| `healthy` | Control | Action |
|---|---|---|
| `true` | **Reveal in Explorer** | `revealPath(root, status.indexRelPath)` |
| `false` | **Fix** (amber) | `agent_memory_ensure(root, fileName)` then re-probe |

The path readout stays. `Fix` shows the reason inline
(`no memory folder` / `no MEMORY.md` / `index is empty` / `index is not valid UTF-8`).
Errors from either action render **immediately under the control**, in both the
structured and the `raw` branch.

### 5.6 Model catalog (D3)

`MODEL_CATALOG[0].models` becomes exactly:

```ts
["inherit", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-fable-5"]
```

The bare aliases `opus` / `sonnet` / `haiku` leave the picker. They stay valid
values on the wire — `companyFor` (`modelCatalog.ts:90-96`) must still resolve
a stored `"opus"` to Anthropic rather than falling to `"Other"`, so keep a
module-private `ALIAS_MODELS` set consulted by `companyFor` and, when the
stored value is an alias, render it as a disabled extra `<option>` so the
select never shows blank on a hand-edited file. `MODEL_NOTES` keeps the alias
entries. `shortModelLabel` is unchanged (frozen by WO10 item 14).

### 5.7 No Save button for agent properties (D4)

The explicit-draft discipline in `store/agents.ts` is kept **for skills** and
retired **for agents**.

- `AgentEditor` loses both `Save` buttons (`AgentEditor.tsx:433-435, 556-558`)
  and the `Delete agent` block (`AgentEditor.tsx:575-583`, D5). Its props
  become `{ root, doc, disabled }` — `onSave` and `onRequestDelete` are gone.
  `SkillEditor` is untouched and keeps its Save.
- New store action `agentEdit(fileName, patch)`: updates the draft (as
  `updateDraft` does today) **and** schedules a per-file autosave, debounced
  **500 ms**, keyed by fileName so two agents can never share a timer.
- Autosave calls `agent_save`, which now **returns the saved `AgentDoc`**
  (§3). The store replaces that one entry in `agents` in place — **no
  `agentsScan`**. Rationale: `saveDoc`'s current full rescan
  (`store/agents.ts:446-452`) replaces every `AgentDoc` object identity, which
  would trip `AgentEditor`'s `doc.content` watcher (`AgentEditor.tsx:314-319`),
  bump `gen`, and rebuild CodeMirror **on every keystroke burst** — losing the
  caret. Forbidden.
- Autosave must **not** set the global `busy` flag. `busy` gates every control
  in `AgentEditor` via `disabled={busy}`; toggling it twice a second would make
  the editor flicker between enabled and disabled while typing. New per-file
  state instead: `agentSaveState: Record<string, "idle" | "saving" | "saved" | "error">`
  and `agentSaveErrors: Record<string, string>`.
- CodeMirror `docKey` becomes `${doc.fileName}:${reloadNonce}` where
  `reloadNonce` is bumped **only** by `loadAgents` and by an external
  `fs://change` on that file — never by our own save. The
  `doc.content !== prevContent.current` effect is deleted.
- Failure surface: the `Agent` section header shows `hint="unsaved"` in amber
  while `error`, with the message in a strip at the top of the section body and
  a `Retry` button. A failed autosave keeps the draft, so nothing is lost and
  the next edit retries.
- `flushAgentSave()` exported alongside the existing `flushMetaSave`, and wired
  into: `App.tsx`'s `beforeunload` handler (`App.tsx:1381-1389`), agent
  selection change, project close (G1), and before `agent_rename` /
  `agent_delete`.
- Rename stays explicit-on-blur (`commitRename`, `AgentEditor.tsx:326-336`) —
  it moves a file, and a debounced rename is a debounced `mv`.

### 5.8 Delete agent / Add agent (D5, E1)

- **D5.** `Delete agent` leaves `AgentEditor`. It survives in exactly two
  places, both already built: the rail row's context menu
  (`RailSections.tsx:150-157`) and — for an agent node on the graph — the
  Inspector's `Actions` section (`Inspector.tsx:1078-1095`), whose
  `Remove from graph` and armed `DangerConfirm` stay as they are.
  `AgentNodePanel` stops passing `onRequestDelete`; its own `armed` state and
  `DangerConfirm` remain, driven from the Actions section only.
- **E1.** Exactly one affordance per verb, and they must not share a label:
  - *create an agent file* → the rail AGENTS section header `+`
    (`RailSections.tsx:38-44`). **This one survives.**
  - *spawn a session* → `RosterBar`'s button (`RosterBar.tsx:131-139`),
    **relabelled `Spawn agent`** (title: `Spawn a session`). The label
    "Add agent" disappears from the app. `AddAgentDialog`'s own title bar
    (`AddAgentDialog.tsx:206,211`) becomes `Spawn agent` / `Launch for task`.
  - Lane UI-B must grep for `Add agent` and confirm zero remaining hits before
    calling the item done.

### 5.9 Home button (G1)

Topbar, left of the view segments, house icon, `title="Close project and return to the title screen"`.

New `useProjectStore.closeProject()`. Order is frozen, because getting it wrong
silently loses work:

1. `await useGraphStore.getState().flushSave()`
2. `flushAgentSave()` · `flushMetaSave()` · `flushSettings()`
3. clear: `useProjectStore` (root, files, error, hooks) ·
   `useGraphStore.reset()` · `useAgentsStore` selection+drafts ·
   `useTasksStore` · `useEventsStore` · `useReviewStore` ·
   `useProjectSelectionStore.select(false)`
4. `setView("canvas")`, close every open modal

Live agent sessions are **not** killed. When `useSessionsStore.sessions.length > 0`,
Home first shows a confirm strip naming the count
("N agent sessions keep running in the background") with **Go home** /
**Cancel** (ASK #3). Recent-projects list is untouched, so one click returns.

### 5.10 Git wizard (G2)

`src/git/GitWizard.tsx`, exported as:

```ts
export function GitWizard({ root, onClose }: { root: string; onClose: () => void }): JSX.Element
```

Three states off one `git_status` probe:

1. **`gitAvailable === false`** — a single explanatory panel: git is not on
   PATH, here is the path Cowtext looked on, nothing can be done from here.
   No retry loop, no bundled git.
2. **`isRepo === false`** — "Initialize a git repository here" with the root
   path shown, one primary button → `git_init`, then falls through to (3).
3. **`isRepo === true`** — the `.gitignore` composer:
   - Preset checkbox groups from a new pure module `src/git/gitignorePresets.ts`
     (`Node`, `Rust / Cargo`, `Tauri`, `Editors & OS`, `Cowtext` — the last
     being `.cowtext/*.tmp` style entries only; **`.cowtext/` itself is never
     offered**, it is the project's source of truth and must stay tracked).
   - A free-text area for extra lines.
   - Composition rule, frozen: existing `.gitignore` content is preserved
     **verbatim and first**; preset blocks are appended under a
     `# --- added by Cowtext ---` marker; a line already present anywhere in
     the file is never added twice. Nothing is ever removed.
   - **Diff-preview gate:** the composed result renders through the existing
     LCS diff (`src/compile/diff.ts`) against `gitignoreContent`, and
     `gitignore_write` is only called after explicit approval. This is a write
     into the user's project — CLAUDE.md's confirmation rule applies.

Entry points: the rail project row's context menu (§5.2) and the topbar
overflow menu. Not on the title screen (there is no root yet).

### 5.11 Agent avatars (G6)

- In the `Agent` Inspector section, the 44px avatar becomes a control: click →
  menu with **Upload image…** (dialog `open()` filtered to
  `png,jpg,jpeg,webp,gif` → `agent_avatar_set`), **Reset seed** (existing
  `avatarSeed` behaviour, identicon), **Remove image** (`agent_avatar_clear`),
  the last two only when applicable.
- Data URLs cached in the agents store: `avatars: Record<string, string | null>`,
  populated lazily per agent on first render and refreshed on set/clear/rename.
  `AgentAvatar` gains an optional `src?: string | null` prop; when non-null it
  renders an `<img>` with `object-cover` and the same square footprint,
  otherwise it falls back to the frozen identicon path. All existing call
  sites keep working unchanged.
- The Barn's calf/cow sprites do **not** read uploaded avatars. Sprites are
  assets; this is a UI portrait. Out of scope (§8).

### 5.12 Fleet view agent detail (G5)

`OrchestratorView` gains a read-only detail column for the selected agent:
avatar, model (`shortModelLabel`), tools, skills, memory status (from
`agent_memory_status`), context estimate (`agentContextTokens`), and the two
orchestration settings it already owns (default cwd, default token ceiling —
still the only editable fields there). Its existing doctrine holds and is
restated here as binding: **one writer per field.** The definition fields stay
editable only in the Inspector; the orchestrator shows them read-only with a
"Edit in Inspector" affordance that selects the agent.

---

## 6. Lanes and file-zone grid

Zones are exclusive. A lane may read anything and may write **only** the paths
in its row. `Inspector.tsx` (2060 lines) and `App.tsx` (1488 lines) are each
assigned **whole** to exactly one lane — no splitting across lanes, no
serialization needed. Extraction into new files inside a lane's own zone is
encouraged but the extracted files stay in that lane's zone.

### Stage 0 — blocking, one owner (tech-ui, lane UI-B), before any other lane

| Deliverable | Files |
|---|---|
| Global `ErrorBoundary` around `<App/>` (renders component stack + message + Reload; not a silent fallback) | `src/ui/ErrorBoundary.tsx` (new), `src/main.tsx` |
| Reproduce B2, C1, F1 with the boundary live; record JS stack **or** Rust panic line for each; publish verdicts | — (report to tech-lead, no file) |

No B2/C1/F1 fix may be written before its verdict is published. If a verdict
lands on Rust, the item moves to lane R2 by contract amendment.

### Rust lanes (tech-general)

| Lane | Owns (write) | Items |
|---|---|---|
| **R1 — git** | `src-tauri/src/git.rs`, `src-tauri/src/git/tests.rs`, `src-tauri/src/lib.rs`, `src/git/api.ts`, `src/git/types.ts`, `src/git/gitignorePresets.ts` | G2 backend + all 7 handler registrations |
| **R2 — agents backend** | `src-tauri/src/agents.rs`, `src-tauri/src/agents/tests.rs`, `src/agents/api.ts`, `src/agents/avatarApi.ts` | G6 backend, `agent_memory_status`, `agent_save` → `AgentDoc`, avatar move/delete in rename/delete |

`lib.rs` belongs to **R1 only**. R2 lands first (its three fns must exist
before R1 registers them); R1 then lands git + all registrations in one pass.

### UI lanes (tech-ui)

| Lane | Owns (write) | Items |
|---|---|---|
| **UI-A — wizards** | `src/project/ProjectWizard.tsx`, `src/project/types.ts`, `src/wizard/NodeWizard.tsx`, `src/git/GitWizard.tsx` | A1–A4, F1, G2 UI |
| **UI-B — shell & rail** | `src/App.tsx`, `src/main.tsx`, `src/ui/ErrorBoundary.tsx`, `src/agents/RailSections.tsx`, `src/sessions/RosterBar.tsx`, `src/sessions/AddAgentDialog.tsx`, `src/store/project.ts`, `src/store/settings.ts` | Stage 0, B1, E1, G1, G4, rail project row, wizard entry points |
| **UI-C — Inspector** | `src/inspector/**`, `src/store/graph.ts`, `src/store/projectSelection.ts` | C1 (post-verdict), C2, D1 mounting, D5, G3 |
| **UI-D — agent properties** | `src/agents/AgentEditor.tsx`, `src/agents/ToolPicker.tsx`, `src/agents/modelCatalog.ts`, `src/agents/AgentAvatar.tsx`, `src/store/agents.ts`, `src/orchestrator/OrchestratorView.tsx` | B2 (post-verdict), C3, D2, D3, D4, G5, G6 UI |

Cross-lane seams, frozen so lanes can build in parallel against a signature
they cannot renegotiate:

| Seam | Producer | Consumer | Frozen contract |
|---|---|---|---|
| `GitWizard` | UI-A | UI-B | `({ root: string; onClose: () => void })` |
| `AgentEditor` | UI-D | UI-C | `({ root: string; doc: AgentDoc; disabled: boolean })` — `onSave` and `onRequestDelete` removed |
| `useProjectSelectionStore` | UI-C | UI-B | `{ selected: boolean; select(v: boolean): void }` |
| `flushAgentSave()` | UI-D | UI-B | `() => void`, exported from `src/store/agents.ts` |
| `AgentAvatar` | UI-D | UI-B, UI-C | `({ seed: string; size?: number; src?: string | null })` |
| git / avatar / memory invokes | R1, R2 | UI-A, UI-C, UI-D | §4, byte-exact |

### Ordering

```
Stage 0 (UI-B)  ──────────────► verdicts for B2 / C1 / F1
      │
      ├── R2 (agents backend) ──► R1 (git + registrations)
      │                                │
      └── UI-A ─┐   UI-B ─┐   UI-C ─┐  │
                └─────────┴─────────┴──┴──► integration → gates → docs
```

- R2 before R1 (`lib.rs` cannot register fns that do not exist).
- R1+R2 before the **call sites** go green, but UI lanes may write those call
  sites in parallel against §4 — the build is only required green at
  integration.
- UI-A, UI-B, UI-C, UI-D are mutually parallel. UI-C's `setSelection` change
  (§5.4) must land before UI-B's project row is exercised; both are in the same
  integration pass.
- Stage 0's ErrorBoundary must land before **any** UI lane, so a lane's own
  regression shows a stack instead of a white screen.

---

## 7. Acceptance gates

### Global (all lanes)

`npm run build` · `npm run lint` (0 errors) ·
`cargo clippy --all-targets -- -D warnings` · `cargo test` ·
**73/73 invoke commands** declared, registered, and called from TS by exact
name · `docs/TERMINOLOGY.md` updated to 73 with the `git` group row.

### Stage 0
- Throwing a synthetic error in any panel renders the boundary, not a blank
  window; the message and component stack are readable without devtools.
- Three written verdicts (B2, C1, F1), each naming a file:line or a Rust panic
  site, or an explicit "not reproducible" with the exact steps tried.

### R1 — git
- `git_status` on a non-repo returns `isRepo: false`, **not** `Err`.
- With `git` absent from PATH (test via a `PATH`-scrubbed child or a mocked
  seam mirroring `worktree.rs`'s), `git_status` returns `gitAvailable: false`,
  never `Err`, never a panic.
- `git_init` on an already-initialized repo is a no-op returning
  `isRepo: true`.
- `gitignore_write` is atomic, LF-normalized, exactly one trailing newline;
  writing the same content twice is byte-identical.
- `gitignore_write` refuses a path outside root by construction (path is
  server-derived; test asserts no argument can redirect it).

### R2 — agents backend
- `agent_avatar_set` rejects a `.txt` renamed to `.png` (magic-byte check) and
  a 600 KB image; accepts a 4-byte-header PNG fixture.
- Setting a JPEG over an existing PNG leaves exactly one file in
  `.cowtext/avatars/`.
- `agent_rename` moves the avatar; `agent_delete` removes it; both still
  succeed when there is no avatar.
- `agent_memory_status` returns `healthy: false` for: missing dir, missing
  index, 0-byte index, non-UTF-8 index; `true` only for a real index with
  content.
- `agent_save` returns an `AgentDoc` whose `content` equals the bytes now on
  disk (round-trip byte-identity, per `frontmatter.rs`'s existing invariant).

### UI-A — wizards
- A1: "Video Game" is selectable and round-trips through
  `project_meta_write` → `project_meta_read` unchanged.
- A2: pasting 3000 characters into Brief leaves 1000; the counter reads
  `1000 / 1000`; a pre-existing 1500-char sidecar brief opens **untruncated**
  and stays so until edited.
- A3: in Requirements, Hard rules and Constraints — typing `Hello world` keeps
  the space; pressing Enter creates a second line; typing `- foo` keeps the
  dash while typing and commits as `foo`. Caret never jumps.
- A4: Optional block is collapsed on a fresh New Project; opening Edit on a
  project that has Hard rules shows it expanded.
- F1: after the Stage-0 verdict, "Assemble after close" + Create node
  completes with the wizard closed, the node created, and the app still
  rendering. If the verdict is Rust-side, this gate moves to R2.

### UI-B — shell & rail
- B1: a file at `context/design/tokens.md` shows as `tokens.md` under an
  expandable `design` under `context`; chevron column aligns across dir and
  file rows at every depth; folders sort before files; the full relPath is
  still the row `title`.
- E1: `rg "Add agent" src/` returns zero hits.
- G1: Home from a project with unsaved graph edits, an unsaved agent field and
  an unsaved panel width writes all three before the title screen appears
  (verify by reopening). With a live session, the confirm strip appears and
  Cancel leaves everything untouched.
- G4: right-click the project row → Reveal opens the project folder; a failure
  shows the inline error banner, never a silent no-op.

### UI-C — Inspector
- C2: Position is **not** the first section on a memory node or an agent node;
  order matches §5.3 exactly; collapse state still persists across restart.
- C1: after the Stage-0 verdict — "Adopt to graph" on an off-graph agent
  produces exactly one new node, selects it, and the Inspector switches to the
  agent-node panel without unmounting the app.
- G3: selecting the project row shows the project panel with `name` and
  `projectType` read-only; editing Brief and blurring writes
  `.cowtext/project.json` and refreshes `context/project.md` **only if it
  exists**; deleting `context/project.md` and editing again does not resurrect
  it.
- Selecting a node while the project is selected clears the project panel, and
  vice versa; the `setSelection` early-return no longer strands a task
  selection (regression test: select a task, then click an off-graph agent —
  the Inspector shows the agent).
- D5: no `Delete agent` button anywhere in the Inspector; deletion still
  reachable from the rail context menu.

### UI-D — agent properties
- B2: after the Stage-0 verdict — selecting every agent in the rail, on-graph
  and off-graph, renders the panel; no blank window; a node whose `filePath`
  uses backslashes still resolves its `AgentDoc`.
- C3: the Tools dropdown scrolls its full list with the wheel and stays open;
  scrolling the page **behind** it still closes it.
- D2: on an agent with a healthy memory index the control reads
  **Reveal in Explorer** and opens it; delete the index on disk, reselect →
  reads **Fix**; Fix creates it and the control flips to Reveal without a
  rescan.
- D3: the Anthropic model list has exactly five entries, no tier appears
  twice; an agent whose frontmatter says `model: opus` still opens on
  Anthropic with `opus` shown, not blank, not "Other".
- D4: no Save button; typing in Description and waiting 1 s writes the file
  (verify on disk); the caret never jumps and CodeMirror never rebuilds while
  typing; killing the write (read-only file) shows the amber unsaved state and
  the message, and the text is still in the editor.
- G6: uploading a PNG replaces the identicon in the Inspector and the rail;
  Remove image restores the identicon; renaming the agent keeps the avatar.
- G5: the fleet view shows the selected agent's model/tools/skills/memory
  read-only and no field is editable in two places.

---

## 8. Out of scope for WO11

| Item | Why |
|---|---|
| **A real global edge router** | Still open from 08/19 item 2 and still not this work order. WO10 shipped hand-editing as the answer; WO11 is defects + shell, and a router is a week of geometry on its own. |
| Git beyond init + `.gitignore` (stage / commit / branch / push / remote) | Marty asked for "at least init + gitignore". Everything past that needs a diff/staging UI and a credentials story; both are their own work order. |
| Image processing for avatars (resize, crop, dimension validation) | Needs an image crate. Stack is fixed — see ASK #2. Magic-byte + size validation only. |
| Uploaded avatars in the Barn scene | Sprites are assets with a frozen palette and a 16-bit look. An arbitrary user PNG in the iso scene is an art-direction decision, not a plumbing one. |
| Drag-to-reorder Inspector sections | C2 asks for Transform to stop being special, not for a layout editor. Declared order (§5.3) meets the ask at a tenth of the surface. |
| Autosave for skills | D4 names agent properties. `SkillEditor` keeps its explicit Save; changing both would double the blast radius of the riskiest item in this order. |
| `.claude/agent-memory/**` in the project scan | Tempting as a D2 fix, but it would put every agent's memory file into the Hierarchy, the graph's adoptable set, the linter and the watcher. A read-only probe (§4.3) answers the question without moving that boundary. |
| A second "Agents tab" view | See ASK #1 — WO11 assumes the existing Orchestrator tab is the target. |

---

## 9. ASK list — Marty decides before the named lane starts

1. **G5 "Agents tab" — which surface?** There is no Agents tab; `View` is
   `canvas | barn | tasks | orchestrator` (`App.tsx:78`). This contract assumes
   the **Orchestrator** tab is what Marty means and §5.12 extends it. If a
   fifth top-level tab is wanted instead, UI-D must be re-scoped. *(Blocks UI-D's G5 only.)*
2. **Avatars — validation depth.** Proposed: magic-byte format check + 512 KB
   cap, **no** resizing or dimension checks, because those need an image crate
   and the stack is fixed. A large-but-under-cap 4000×4000 PNG will be scaled
   by CSS. Confirm, or approve a dependency (`image`) — that is a stack change
   and needs an explicit yes. *(Blocks R2's avatar work.)*
3. **Home button with live sessions.** Proposed: warn + confirm, sessions keep
   running. Alternative: kill all on Home. *(Blocks UI-B's G1.)*
4. **G3 editable / read-only split.** Proposed rule: identity and scaffold
   (`name`, `projectType`, paths) read-only in the Inspector, editable only in
   the wizard; all six description fields editable. Confirm. *(Blocks UI-C's G3.)*
5. **Git wizard scope.** `git init` + `.gitignore` composer only; no staging,
   commits, branches or remotes in WO11. Confirm. *(Blocks UI-A's G2.)*
6. **Stage 0 gate.** B2, C1 and F1 have no statically determinable root cause
   (§2.2). This contract makes the ErrorBoundary + reproduction a blocking
   Stage 0 rather than letting lanes guess. Confirm that a diagnostic pass
   before the fix is acceptable. *(Blocks everything.)*
7. **`agent_save` return-type change** (`()` → `AgentDoc`). Required by D4 to
   avoid a full `agentsScan` per keystroke. It is a wire change to an existing
   command, not a new one, so the invoke count is unaffected — but it is a
   deviation from the WO02 agents contract and needs ratification. *(Blocks R2 and UI-D's D4.)*

No new libraries are requested by this contract. Git shells out to the system
`git` exactly as `worktree.rs` already does; avatars use `std::fs` plus the
existing `@tauri-apps/plugin-dialog`.

---

## 10. Amendment 1 — D5 self-conflict, agent-delete orphan, two strays

Ruled 2026-08-20 by tech-lead, on a conflict lane UI-C found in §5.8 vs §7 and
escalated rather than silently resolving. Escalating was correct. This section
is normative and supersedes the text it names.

### 10.1 Verdict on D5 — the button **goes**

Marty's words are not ambiguous: *"Remove 'Delete Agent' button. Agent's
management must be in Agents tab or in Hierarchy."* That is the entire reason
the item exists. The Inspector keeps no delete trigger for an agent — not for
off-graph agents, not for on-graph ones.

**§5.8's first bullet is struck and replaced by:**

> **D5.** `Delete agent` leaves the Inspector completely. No Inspector panel —
> memory node, agent node, off-graph agent, skill or project — carries a
> control that deletes an agent *file*. `AgentEditor` stops taking
> `onRequestDelete`; `AgentNodePanel` and `StandaloneAgentsPanel` drop their
> `armed` state and their `DangerConfirm` for agent-file deletion. Agent-file
> deletion lives in exactly one place: the rail row's context menu
> (`RailSections.tsx:150-157` → the `ConfirmStrip` at `:229-239`).
>
> `Remove from graph` — which deletes a *node*, never a file — **stays** in the
> agent node's `Actions` section. It is a graph operation on a graph object and
> is not what D5 is about; its helper line ("The agent file stays on disk.")
> already says so.

**§7's UI-C gate stands exactly as written** and is the normative test:
*"no `Delete agent` button anywhere in the Inspector; deletion still reachable
from the rail context menu."* Add one mechanical gate: `rg "Delete agent" src/inspector/`
returns zero hits.

I could not re-read `src/inspector/**` at ruling time (lane UI-C has the tree
mid-edit). The wording above is normative regardless of what is currently on
disk; UI-C reconciles to it.

### 10.2 UI-C's orphan claim — **CONFIRMED**

Verified, with the mechanism:

- `RailSections.tsx:232-236` — `onConfirm` calls `select({ kind: "agent", key })`
  then `useAgentsStore.getState().deleteSelected()`. Nothing else.
- `store/agents.ts:938-971` — `deleteSelected`, `kind === "agent"` branch:
  `agentDelete(root, key)` then a `set()` that touches only `agents`, `drafts`,
  `meta`, `avatars`, `agentSaveState`, `agentSaveErrors`, `selection`. It never
  reaches the graph store, and cannot: `agents.ts` deliberately does not import
  `graph.ts` (`agents.ts:157-159` — *"graph → agents import is one-directional"*).

**Failure scenario.** Adopt `.claude/agents/tech-ui.md` to the graph. Right-click
its rail row → Delete agent file… → delete. The file is gone; the node is still
on the canvas, still selected, still in `graph.json` after the next
`scheduleSave()`. It renders with the "missing file" badge, still counts in
`Relations`, still participates in compile validation, and `Assemble` on it
fails at read time. Undo does not restore the file.

**UI-C's remedy is REJECTED.** Keeping the Inspector button does not fix this;
it only makes the one path Marty asked us to delete the only safe one, while
the path he named as correct — the Hierarchy — keeps orphaning. That is
backwards. A store-layer defect gets a store-layer fix.

### 10.3 The fix and its zones — **overrides the dispatcher's proposed split**

Do **not** put this in `RailSections.tsx`. A per-call-site fix would have to be
repeated at every present and future `deleteSelected` caller, and it is exactly
the shape the codebase already solved once: `agentRenameListeners`
(`store/agents.ts:157-166`) exists **because** the graph store must react to an
agents-store mutation without the reverse import. Delete gets the same seam.

| Half | Zone / lane | Change |
|---|---|---|
| **A — notify** | `src/store/agents.ts` — **lane UI-D** | Add, directly beside the rename seam: `export type AgentDeleteListener = (fileName: string) => void;` and `export const agentDeleteListeners: AgentDeleteListener[] = [];` plus a private `notifyAgentDeleted(fileName)`. Call it in `deleteSelected`'s `kind === "agent"` branch **after** `await agentDelete(...)` succeeds and **after** the `set()` at `agents.ts:954-970` — never before, and never on the error path. Skills are unaffected. |
| **B — react** | `src/store/graph.ts` — **lane UI-C** | Register beside the existing rename listener at `graph.ts:941-954`: on `fileName`, resolve `.claude/agents/${fileName}` and call `get().deleteNodes(ids)` for every node whose `filePath` matches. Use `deleteNodes`, not a raw `setState` — it is the action that also prunes incident edges, clears the selection, drops `assembleStatus`/`assembleErrors` and pushes an undo entry (`graph.ts:724-741`). No-op when no node matches. |

Two conditions on half B, both binding:

1. **Match with `sameRelPath`, not `===`.** The neighbouring rename listener is
   itself defective: `graph.ts:945` and `:948` compare `n.filePath === oldPath`
   with a bare `===`, which is precisely the Windows backslash class WO10 §4
   declared closed by making `sameRelPath` the only comparison. A node stored
   as `.claude\agents\tech-ui.md` is therefore *not* renamed today, and would
   *not* be deleted either. **UI-C fixes both listeners in the same hunk** —
   the new delete listener uses `sameRelPath`, and `graph.ts:945,948` are
   converted to `sameRelPath`.
2. **`deleteNodes` pushes undo; the file deletion does not.** That asymmetry is
   pre-existing and correct (`graph.ts:428-430`: file operations are never
   undone). Do not attempt to make the file deletion undoable, and do not
   suppress the node-side undo entry to match — a user who undoes gets the node
   back with a missing-file badge, which is the honest state.

`src/agents/RailSections.tsx` needs **no functional change**, so lane UI-B stays
off this critical path. It gets one copy item only (§10.4).

Ordering: half A and half B are independent files in different lanes and may
land in either order; the behaviour only exists once both are in. Neither may
land without the other in the same integration pass.

### 10.4 Is the lifecycle surface adequate after removal? — **Yes, with one copy fix**

Marty ratified extending the existing **Orchestrator** tab rather than adding an
Agents tab (ASK #1), so "Agents tab or Hierarchy" resolves to the Hierarchy for
deletion. After §10.1 + §10.3 there is exactly one delete path, and it is
complete:

rail row → context menu `Delete agent file…` → `ConfirmStrip` → `agent_delete`
(file) → `agentDeleteListeners` → `deleteNodes` (node + incident edges +
selection + assemble state) → `agent_avatar_clear` semantics already covered by
R2's `agent_delete` avatar cleanup (§4.2).

Creation, rename, memory repair and avatar changes all remain reachable, and
`Remove from graph` still exists for the "unwire it but keep the file" case. No
capability is lost by removing the Inspector button.

The one gap is honesty of the confirmation, not reachability:

> **UI-B copy item (new).** `RailSections.tsx:231` — when the agent being
> deleted has a graph node (`nodeFor(a.fileName) !== undefined`, already
> computed at `:188`), the `ConfirmStrip` label must also say the node goes:
> `Delete .claude/agents/<file>? Its node is removed from the graph too.`
> A destructive confirm that under-reports what it destroys is the same class of
> problem as a silent write.

### 10.5 Stray 1 — `MemoryNodeCard.tsx:80` bare-`/` split → **lane UI-D**

Confirmed: `src/canvas/MemoryNodeCard.tsx:80`
`const agentFileName = agentBacked ? (node.filePath.split("/").pop() ?? node.filePath) : "";`
`agentBacked` on the line above uses `isAgentFile`, which normalizes separators
via `canonPath` — so a backslash path passes the agent test and then yields a
`fileName` of `.claude\agents\tech-ui.md`, which matches no `AgentDoc`. The card
renders as an agent plate with no avatar seed, no display name, no model chip
and no priority chip (`:81-88`). Same class as §2.2's `Inspector.tsx:1004` and
§10.3's `graph.ts:945`.

`src/canvas/MemoryNodeCard.tsx` is added to **lane UI-D's zone**, fenced: UI-D
may edit **only** the `agentFileName` derivation at `:80` and nothing else in
that file. It belongs to UI-D because lines 80-88 are entirely the agent-identity
lookup UI-D already owns (`seedFor`, `metaOrDefault`, the agent doc), and because
UI-C must not be given a second file in the canvas directory mid-flight.

Fix: derive the basename from the canonical form — `canonPath(node.filePath).split("/").pop()`
— or match the doc with `sameRelPath` against `.claude/agents/${a.fileName}`.
Either is acceptable; the gate is behavioural.

**Gate (UI-D):** a node whose `filePath` is stored with backslashes renders its
avatar, display name, model chip and priority chip identically to the same node
stored with forward slashes.

**Standing rule, restated because it has now produced four defects in one work
order** (`Inspector.tsx:1004`, `graph.ts:945`, `graph.ts:948`,
`MemoryNodeCard.tsx:80`): **no `.md` path comparison or basename extraction in
`src/` may use a bare `===` or a bare `.split("/")`.** `canonPath` /
`sameRelPath` are the only sanctioned forms. Any lane that adds one is deviating
from WO10 §4, which is already frozen.

### 10.6 Stray 2 — `docs/TERMINOLOGY.md` invoke count → **project-manager**

Confirmed as project-manager's docs pass, not a lane's. `docs/` upkeep is PM's
per CLAUDE.md, and `TERMINOLOGY.md` sits in no lane's zone by design — four
lanes touching the canon file concurrently is how it drifts. R1 was right to
flag rather than edit it.

Required edits, so PM does not re-derive them:

1. Module table: `generate_handler!` command list **(66) → (73)**.
2. Section heading: `## Invoke commands (66)` → `(73)`.
3. New row: `| git | git_status, git_init, gitignore_write |`.
4. `agents` row gains `agent_avatar_set`, `agent_avatar_read`,
   `agent_avatar_clear`, `agent_memory_status`.
5. New module rows: `src-tauri/src/git.rs` (git probe/init/`.gitignore` write,
   shells out to system `git`) and `src/git/` (GitWizard + presets).
6. Key terms: add **Agent avatar** (`.cowtext/avatars/<stem>.<ext>`, magic-byte
   validated, ≤ 512 KB, identicon fallback, no sidecar key) and **Agent memory
   status** (read-only probe; `.claude/agent-memory/**` is deliberately outside
   the project scan — §8).
7. The skill file `.claude/skills/cowtext-terminology/SKILL.md` still says 63
   and lists a stale command set; it needs the same pass. PM owns it.

PM runs this **after** integration, once 73/73 is verified in the merged tree —
not before, or the canon will describe a tree that does not exist yet.

### 10.7 Summary of changes to the frozen contract

| Section | Change |
|---|---|
| §5.8 bullet 1 (D5) | Struck and replaced (§10.1). Inspector keeps no agent-file delete. |
| §6 grid — UI-D | `src/store/agents.ts` gains `agentDeleteListeners`; `src/canvas/MemoryNodeCard.tsx` added, fenced to line 80. |
| §6 grid — UI-C | `src/store/graph.ts` gains the delete listener + the `sameRelPath` fix at `:945,948`. |
| §6 grid — UI-B | One copy item on `RailSections.tsx:231`. No functional change. |
| §7 UI-C gate | Unchanged; now the normative text, plus an `rg` gate. |
| §7 UI-D gates | Add the backslash-path plate gate and the orphan-delete gate. |
| §7 global | Add: deleting an on-graph agent from the rail leaves **zero** nodes referencing `.claude/agents/<deleted>` in `graph.json` after the next save. |
| Invoke count | Unchanged at 73. No schema change. No new ASK. |

---

## 11. Amendment 2 — `agent_save` / `agent_rename` TOCTOU

Ruled 2026-08-20 by tech-lead. Overturns the assumption in the tester's
original assessment ("fails cleanly via `save_doc`'s `path.is_file()` check")
and the dispatcher routing that followed from it. R2 was right to verify
rather than implement, and right to flag back instead of adding a lock it had
been told not to add.

Line numbers below are the current tree; the dispatcher's `agents.rs:694` /
`:710` have drifted to `:697` / `:713` since the avatar work landed.

### 11.1 The defect, confirmed

`save_doc` (`agents.rs:928-952`) guards with `path.is_file()` at **`:943`**,
then reads at `:949`, patches at `:950`, and writes at `:951`. The guard and
the write are separated by a read and a frontmatter round-trip.

`write_atomic` (`project.rs:235-255`) is a **create-or-replace** primitive, not
a replace-only one:

```
fs::write(&tmp, content)          // :245
if path.exists() { remove_file }  // :249-251
fs::rename(&tmp, path)            // :252
```

It never asserts that `path` existed. So when `agent_rename` (`:713-740`) lands
its `fs::rename(&src, &dest)` (`:732`) after `:943`'s check and before `:252`'s
rename, `write_atomic` **recreates the old path** from the pre-rename content
plus the save's edit. `agents_scan` then reports it as a second, unrelated
agent. The renamed file gets only `rename_patch_name`'s `name:` patch
(`:954-971`) and never receives the edit.

Silent data loss **plus** file duplication. R2's deterministic repro
(`agents/tests.rs`, `agent_rename_landing_mid_save_can_resurrect_the_old_file_as_an_orphan`,
the `write_atomic` call at `tests.rs:1241`) demonstrates it without threads,
because it is an ordering bug, not a data race.

**Aggravating factor this work order created.** Before WO11, agent saves were
explicit button presses, so the window was rare. §5.7 (D4) replaced that with a
500 ms debounced autosave, and `commitRename` fires on **blur**
(`AgentEditor.tsx:326-336`). Typing in a field and tabbing to the Name field to
rename is now the ordinary flow, and it puts a rename directly inside a
pending save's window. WO11 manufactured its own hazard; WO11 closes it.

### 11.2 Where the fix belongs — **one module-scope lock in `agents.rs`**

**Not in `write_atomic`.** A re-check there would break correct callers — see
§11.3. `write_atomic`'s create-or-replace semantics are load-bearing for most
of its call sites and are not the bug; the bug is that `agents.rs` treats a
`is_file()` probe as if it were a lock.

**Mechanism, frozen:** a single module-scope mutex in `agents.rs` guarding the
whole `.claude/agents/` + `.claude/skills/` mutation surface.

```rust
// agents.rs, module scope
static AGENT_FS: Mutex<()> = Mutex::new(());
fn agent_fs_guard() -> MutexGuard<'static, ()> { … }
```

Taken for the duration of the body of every command that **mutates** an agent
or skill file: `agent_create`, `agent_save`, `agent_rename`, `agent_delete`,
`agent_convert`, `agent_memory_ensure`, `agent_avatar_set`,
`agent_avatar_clear`, `skill_create`, `skill_save`, `skill_rename`,
`skill_delete`, `agents_meta_write`. `agents_scan`, `agent_avatar_read` and
`agent_memory_status` are read-only and take it too — a scan that interleaves a
rename otherwise reports a half-moved directory.

Four binding conditions:

1. **One lock, not a per-path map.** `agent_rename` touches two paths (`src`
   at `:726`, `dest` at `:727`); a per-path map means acquiring two locks and
   inventing an ordering rule, which is how deadlocks get written. With exactly
   one lock in existence and nothing else acquired while it is held, deadlock
   is structurally impossible. Contention is irrelevant: these are debounced
   few-KB writes, and `assemble.rs` already caps concurrency at 2.
2. **Never `.expect()` on it.** Recover from poisoning —
   `.unwrap_or_else(|e| e.into_inner())`. §2.2 of this contract names
   `assemble.rs:203,222,243,272,296`'s `.expect("assemble queue mutex")` chain
   as the leading hypothesis for F1's whole-app crash, precisely because one
   panic under the lock turns every later command into a panic. Do not add a
   thirteenth site of the same anti-pattern.
3. **The guard is taken once, at the top of the command body, after argument
   validation and `checked_root`, and held to return.** No nested acquisition,
   no re-entrant helper that takes it again — `save_doc`, `rename_patch_name`,
   `move_avatar_best_effort`, `write_atomic_bytes` and the avatar helpers must
   stay lock-free and be called *under* the caller's guard. A helper that locks
   is how a `Mutex<()>` self-deadlocks.
4. **Do not add a second `path.is_file()` re-check just before
   `write_atomic`.** Once the lock holds, it protects nothing, and it would
   read to a future maintainer as if the ordering were defended by the check
   rather than by the lock — which is exactly the mistaken belief that produced
   this defect. `:943`'s existing check stays as the "no such agent" *error
   message*, which is its real job.

**Scope limit, to be stated in the module doc comment.** A process-local mutex
serializes everything inside this app, including a second Tauri window (Tauri
windows share one process). It does **not** protect against an external writer.
Today that exposure is nil: the only other Cowtext process is
`cowtext_cli.rs`, whose `compile --check` and `lint` never write agent files.
Closing the out-of-process case would need OS file locking — a new dependency,
a stack change, and an ASK. Not this work order, and not needed.

### 11.3 Blast radius — why `write_atomic` must not change

`write_atomic` has **17 call sites in 11 modules**. For most of them
"create if absent" is required behaviour, so an existence re-check inside it
would be a regression, not a fix:

| Call site | Would an existence re-check break it? |
|---|---|
| `project_meta.rs:195, 248` | **Yes** — `project_init` creates `.cowtext/project.json` from nothing |
| `git.rs:219` | **Yes** — `.gitignore` frequently does not exist yet (WO11 §5.10) |
| `tasks.rs:1873` | **Yes** — `task_append` reads with `unwrap_or_default()` and creates the file |
| `preset.rs:128, 206, 260` | **Yes** — preset save creates new files; `preset_apply` creates `graph.json` |
| `hooks.rs:79` | **Yes** — `.claude/settings.json` may be absent |
| `settings.rs:31` | **Yes** — app settings on first run |
| `tasklinks.rs:221` | **Yes** — sidecar created on the first link |
| `agents.rs:925` | **Yes** — `agents.json` created on the first meta write |
| `compile.rs:560`, `handoff.rs:237`, `taskctx.rs:295` | **Yes** — compile/handoff outputs are routinely new files |
| `tasks.rs:1852, 1934, 1939, 1941, 2011, 2106, 2176, 2212` | No, but they gain nothing |
| `agents.rs:947, 951, 969` | No — the only sites that want replace-only |

Three sites out of seventeen want the stricter semantics, and all three are in
`agents.rs`. That settles it: **the fix stays local to `agents.rs`.**
`src-tauri/src/project.rs` is **not** modified, so no currently-unowned file
needs assigning and no other module's behaviour changes.

`write_atomic_bytes` (`agents.rs:271-287`) has the same create-or-replace
shape and is already inside the locked module — no change needed there either.

### 11.4 Owning lane and zone

**Lane R2 (tech-general — agents backend). Zone unchanged**:
`src-tauri/src/agents.rs`, `src-tauri/src/agents/tests.rs`. Nothing else.

R2 also **inverts its own repro** rather than deleting it: rename the test to
`agent_rename_during_save_never_resurrects_the_old_file` and assert
`!old_path.exists()` plus "the renamed file carries the edit". A test that
proves the bug is worth more once it proves the fix. Add a second test that a
`skill_save` / `skill_rename` pair is likewise serialized, since `save_doc` is
shared.

### 11.5 Is UI-D's JS-side fix still required? — **Yes. Let it land.**

These are two defects, not one, and the Rust fix converts the second from
corruption into a wrong-but-safe outcome. It does not remove it.

`runAgentSave`'s in-flight branch returns the original promise instead of one
chained to the queued follow-up, so `flushAgentSaveFor` resolves early.
`deleteSelected` (`store/agents.ts:951`) awaits it for a stated reason — its own
comment: *"this keeps `agent_save` from ever writing to a file `agent_delete`
has already removed."* With the lock in place and the flush still resolving
early:

- **Delete:** the queued follow-up save runs *after* `agent_delete`, the lock
  serializes it cleanly, and `save_doc:943` returns `Err("No such agent: …")`.
  But `deleteSelected`'s `set()` at `agents.ts:954-970` has already dropped the
  store entry — so the error lands in `agentSaveErrors[fileName]` for an agent
  that no longer exists. A stuck amber "unsaved" state keyed to a ghost, with
  no UI able to clear or retry it.
- **Rename:** the follow-up targets the **old** filename, fails the same way,
  and the user sees "unsaved — No such agent" immediately after a rename that
  in fact succeeded. The edit is genuinely lost, quietly.

So: the lock guarantees the file system is never corrupted; the JS fix
guarantees the last edit actually reaches disk and no phantom error state is
left behind. **Both ship in WO11.** UI-D continues; nothing is stood down.

Add to §7's UI-D gates: after typing in Description and immediately renaming
the agent (blur), the renamed file contains the typed text, and no `unsaved`
state remains under either the old or the new filename. Same for typing then
deleting: no error state survives the delete.

### 11.6 Severity — **HIGH confirmed, and a WO11 landing blocker**

HIGH, not CRITICAL: it needs a rename to land inside a specific write window,
so it is not certain on every use. But it is routinely reachable — D4 made the
window a normal part of typing-then-renaming (§11.1) — and the outcome is
silent data loss plus a duplicate file that `agents_scan` presents as a real
agent. There is no error, no undo, and the duplicate then competes for the
same identity in the rail, the graph and compile.

It **must land in WO11**, not be deferred to a follow-up: this work order is
what made the window routine, and shipping D4 without §11.2 would mean WO11
ships a data-loss regression against WO02 behaviour. Add to §7 global gates:
*a rename issued while an autosave is pending leaves exactly one file in
`.claude/agents/` for that agent, carrying the pending edit.*

Invoke count unchanged at **73**. No schema change. No new ASK. No new
dependency.

---

## 12. Amendment 3 — the Markdown tab is a second writer

Ruled 2026-08-20 by tech-lead. Tester's finding confirmed. Line numbers in
`src/` have drifted under UI-C's work, so surfaces are named by function.

### 12.1 Confirmed — and it is **not** the same defect as §11

Verified:

- `write_md_file` (`project.rs:721-728`) special-cases only
  `.claude/settings.json` (`:723-725`), then calls `write_atomic`. It takes no
  lock, and `AGENT_FS` lives in `agents.rs`, so §11's mutex structurally cannot
  reach it.
- `InspectorHeader` renders both tabs unconditionally for every node
  (`Inspector.tsx:1980-1992`), and "Open markdown tab" is ungated
  (`:1949-1955`). `isAgentFile` gates only the `"properties"` branch
  (`:2065-2073`).
- `useInspectorTabStore.tab` (`canvas/types.ts:59-65`) is global with **no
  reset on selection change** — so clicking an agent node while already on the
  Markdown tab lands in the hazard with zero extra clicks. Confirmed.
- `MarkdownTab` does its own `read_md_file` on mount and its own
  `write_md_file` on Save, sharing no state with `store/agents.ts`.

**But the mechanism is different from §11, and this matters for the fix.**
§11 was a microsecond-scale ordering bug between two Rust commands: a lock
fixed it. This is a **stale-read / lost-update** across *human* time. The
Markdown tab reads the file at mount and may hold that buffer for minutes
before the user presses Save. No lock can help: serializing the two writes
just makes the clobber orderly. **Extending a lock to `write_md_file` is
rejected** — it would drag `project.rs` in for zero benefit and, worse, would
look like a fix.

It is also **bidirectional**, which the tester's repro only shows one half of.
`save_doc` re-reads the file from disk and patches it (`agents.rs:949-951`), so
after the Markdown tab writes, the agents store's `doc` is stale; the next
keystroke in the Agent panel autosaves a `body`/`fields` patch computed from
that stale draft and clobbers the Markdown edit in return.

**The severity argument that decides this**: pre-WO11 the Agent panel had an
explicit Save button. A user who typed, didn't press it, and switched tabs lost
the edit — but the enabled Save button had been telling them it was unsaved.
§5.7's D4 replaced that with "every change saves immediately." Losing an edit
now is not a missed step; it is **the application breaking a promise it makes
in the UI**. That is strictly worse than the pre-WO11 behaviour it replaced.

### 12.2 Verdict — **landing blocker**

Same call as §11, for the same reason and one more. WO11 manufactured this
overlap (§12.1), it is near-deterministic, zero-click reachable, silent, and it
regresses a guarantee this very work order introduced. Shipping D4 with a
second uncoordinated writer on the same files would mean WO11's headline
feature is the thing that loses your work.

It does **not** get deferred to a tracked bug. It is scoped tightly below: no
new invoke, no schema change, no new dependency, and no change to
`write_atomic`.

### 12.3 The fix — **one writer per file**

Four changes. The principle is that for an agent file, `store/agents.ts`'s save
queue is the **only** writer and the **only** reader of record.

1. **`MarkdownTab` gets an agent branch.** When `isAgentFile(node.filePath)`:
   load the buffer from `useAgentsStore`'s `doc.content` — **not** from
   `read_md_file` — and save through a new store action
   `saveAgentRaw(fileName, text)` that enqueues on the **existing**
   `runAgentSave` queue with `rawContent` (`agent_save`'s `raw_content`
   parameter already does a whole-file write, `agents.rs:946-947`, and already
   returns the fresh `AgentDoc`). Non-agent files keep the current
   `read_md_file`/`write_md_file` path unchanged. One queue ⇒ no stale read is
   possible in either direction, and the agent panel's `doc` stays current
   because `agent_save` hands it back.
2. **Flush and await on tab switch.** `setTab` on an agent node awaits
   `flushAgentSaveFor(fileName)` before the Markdown branch mounts, so the
   queue is quiescent. Necessary even with (1), because the store's `doc` is
   only current once the pending save has returned.
3. **`tab` resets to `"properties"` on selection change.** A global tab that
   outlives the selection is what makes this reachable in zero clicks.
4. **`write_md_file` rejects agent paths in Rust.** One rejection arm beside
   the existing `.claude/settings.json` one (`project.rs:723-725`):
   a `rel_path` matching `.claude/agents/*.md` (normalized, case-insensitive —
   `canonPath` rules) returns
   `Err("Use agent_save to write an agent file")`.

**Why (4) is required and not belt-and-braces.** This project has now
demonstrated *twice in one work order* that a documented rule does not hold:
§10.5's `sameRelPath` rule was declared closed by WO10 and produced four fresh
violations, and §12 is the second lost-update from D4's seam. A guard in the
one function every path must go through converts every future violation from
silent data loss into a loud error at the offending call site. That is the only
enforcement mechanism with a track record here.

### 12.4 Does `project.rs` change? — **Yes, and the blast radius is nothing like §11.3**

§11.3 rejected touching `write_atomic` because 14 of its 17 call sites require
create-if-absent. That reasoning does **not** transfer: this change is to
`write_md_file`, a leaf command, and it adds a rejection arm rather than
altering write semantics. `write_atomic` is untouched, so all 17 of its callers
are unaffected.

`write_md_file` has exactly **four** TypeScript call sites, all verified:

| Call site | Effect of the guard |
|---|---|
| `MarkdownTab`'s `save` | Rerouted by (1); never reaches the guard for agent files |
| `MarkdownTab`'s `createFile` | Same |
| `MemoryNodeCard`'s "Create file" (`:233`) | Would start failing on agent paths — §12.5 |
| `review.ts`'s `revertCurrent` (`:218`) | Would start failing on agent paths — §12.5 |

Rust-side callers: none outside tests. Existing tests
(`project/tests.rs:113-127`, `agents/tests.rs:230-240`) already cover the
settings-json arm and extend naturally.

### 12.5 The two secondary instances — **in scope, because (4) forces them**

I would have backlogged both on reachability alone. The Rust guard changes
that: shipping (4) without them converts two low-severity issues into two new
failures. They land together or not at all.

- **`MemoryNodeCard.tsx:224-245` "Create file".** Gated by `file === undefined`,
  so there is no pending edit to clobber and no data loss today — but it writes
  a bare `# {title}\n\n` stub with **no frontmatter**, which `agents_scan` then
  reports as a `raw`/parse-error agent. Fix: for an agent path, call
  `agent_create` (which writes the real template, `agents.rs:140-144`) instead
  of `write_md_file`. Strictly better than today, independent of the guard.
- **`store/review.ts:218` `revertCurrent`.** The genuine defect here is the
  reverse of the tester's framing: a pending autosave landing *after* the
  revert silently undoes it, so the user's explicit "restore my version" does
  not stick. Note `:219-222` swallows the error, so under the guard this would
  become a silent no-op — unacceptable. Fix: for an agent path, `await
  flushAgentSaveFor(fileName)`, then write through `saveAgentRaw`, and surface
  a failure instead of swallowing it.

### 12.6 Owning lanes and zones

`src-tauri/src/project.rs` is unowned by every WO11 lane. **Assigning it to
lane R2** (tech-general — agents backend), fenced: R2 may edit **only**
`write_md_file`'s rejection arm and the corresponding tests, nothing else in
`project.rs`. R2 already owns the agent-file write invariant, so the guard
belongs with the module that defines what it protects.

| Change | Lane | Zone |
|---|---|---|
| (4) `write_md_file` agent-path guard + tests | **R2** | `src-tauri/src/project.rs` (fenced to `write_md_file`), `src-tauri/src/project/tests.rs` |
| (1) `MarkdownTab` agent branch, (2) flush-on-switch, (3) tab reset | **UI-C** | `src/inspector/**` |
| `saveAgentRaw` + queue reuse | **UI-D** | `src/store/agents.ts` |
| `MemoryNodeCard` "Create file" → `agent_create` | **UI-D** | `src/canvas/MemoryNodeCard.tsx` (already in UI-D's zone per §10.5; fence widened to this menu item) |
| `review.ts` revert reroute | **UI-D** | `src/store/review.ts` (new to UI-D's zone; no other lane touches it) |
| `canvas/types.ts` tab-store reset seam | **UI-C** | `src/canvas/types.ts` (new to UI-C's zone; UI-D must not touch it) |

Seam, frozen so UI-C and UI-D build in parallel:
`saveAgentRaw(fileName: string, text: string): Promise<string | null>` —
resolves `null` on success, else the message; enqueues on the same per-file
queue as `agentEdit`, never a second one.

Ordering: R2's guard lands **last** of the five, or CI goes red between the
guard and the reroutes.

### 12.7 Gates

Add to §7:

- **UI-C/UI-D (the repro):** type in the Agent panel's Description, switch to
  the Markdown tab before the 500 ms debounce, edit there, Save. The file
  contains **both** edits' intent and neither is silently dropped. Reverse
  order likewise: edit in Markdown, save, switch to Agent panel, type — the
  Markdown edit survives.
- **UI-C:** selecting a different node while on the Markdown tab returns the
  Inspector to Properties.
- **R2:** `write_md_file` rejects `.claude/agents/x.md`, `.claude\agents\x.md`
  and `.CLAUDE/AGENTS/X.MD` with the agent-save message; still accepts
  `context/*.md` and `CLAUDE.md`.
- **Global:** `rg 'write_md_file' src/` — every remaining call site is either a
  non-agent path by construction or carries a comment naming why.

### 12.8 Doctrine — recorded, and made enforceable

Yes. Recorded as a hard rule, and note that **three of the four highest-severity
defects in this work order (§11, §12, and the D4 flush bug in §11.5) come from
the same seam**: D4 replaced an explicit Save with a queue, and every surface
that did not learn about the queue became a data-loss path.

> **One writer per file.** Any UI surface that writes a file which a
> store-level save queue also writes MUST route through that queue. A second
> write path is a **lost update, not a race** — a lock cannot fix it, because
> the two writes are separated by human time, not microseconds. The queue owns
> both the read and the write; a surface that reads the file independently is
> already wrong, even before it writes.
>
> **Corollary.** Replacing an explicit Save with an autosave queue is not a UI
> change. It is a concurrency change, and it obliges an audit of every other
> reader and writer of the same files in the same work order.
>
> **Enforcement.** Where a single chokepoint command exists, the rule is a
> runtime rejection in that command, not a comment. Documented-only invariants
> in this codebase have now failed twice (WO10's `sameRelPath`, §10.5; and
> this).

This goes into `docs/TERMINOLOGY.md` as a canon term (**One writer per file**)
in project-manager's §10.6 docs pass, and the `write_md_file` entry gains
"never for agent files — `agent_save` owns those."

Invoke count unchanged at **73**. No schema change. No new ASK. No new
dependency.
