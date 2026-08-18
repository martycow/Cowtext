# UX BATCH — FROZEN CONTRACT

Author: tech-lead · Date: 2026-08-18 · Status: **FROZEN** once lanes start.
Source of ideas: `docs/INPUT_PROMPT.md` (Marty, 20 raw ideas).
Binding rules: `CLAUDE.md` (stack fixed, no new libraries, TS strict / no `any`,
clippy `-D warnings`, all FS through Rust, graph.json schema change ⇒ version bump
+ migration).

---

## 1. Scope

**IN this batch (12 items):** #1 filename↔title sync · #2 hooks-installed indicator ·
#3 resizable panels · #4 wider code editor/viewer · #5 role descriptions ·
#7 bigger read-order badge · #8 recent projects · #9 dynamic context menus ·
#10 Reveal in File Explorer · #13 scan overlay · #16 (rendering half) nicer edges ·
#17 resizable brief field.

**Rulings that changed the dispatcher's triage:**

- **#14 "ability to connect nodes" — ALREADY SUPPORTED, no work.** Verified in
  `src/canvas/MemoryNodeCard.tsx` (source/target `<Handle>`), `GraphCanvas.tsx`
  (`onConnect → beginConnection`), `KindPicker.tsx` (kind choice) and
  `store/graph.ts` (`beginConnection` / `confirmConnection` / `cancelConnection`).
  Connecting shipped in Phase 1. Its *spirit* — "make connecting easy" — folds into
  #16 as the snap-radius and handle-placement work (§7.11).
- **#16 edge COLOUR — DEFERRED** (see §11). Splines, snap radius, handle placement
  and the arrow joint stay in batch: they are render-side only.
- **#15 .ts/.html/.css split — REJECTED** (architecture verdict, §10). Deferred
  either way; the verdict is for the record.

**OUT (deferred, full list in §11):** #6, #11, #12, #15, #16-colour, #18, #19, #20.

**Phase discipline:** every in-batch item is polish on already-accepted phases 0–6.
No future-phase feature is introduced.

---

## 2. Command contract — 4 new invoke commands (23 → 27)

Each needs the three coordinated edits: `#[tauri::command]` fn · entry in
`tauri::generate_handler![]` · `invoke("<exact name>")` in TS. Names below are
**byte-exact and frozen**.

### 2.1 `rename_node_file` — `src-tauri/src/project.rs`

```rust
/// Rename a node's .md file inside the project root. Never clobbers.
/// Returns the normalized (forward-slash) new relative path — the exact string
/// `scan_project` would emit — so the store can store it verbatim.
#[tauri::command]
pub fn rename_node_file(
    root: String,
    rel_path: String,
    new_rel_path: String,
) -> Result<String, String>
```

TS: `invoke<string>("rename_node_file", { root, relPath, newRelPath })`

Guards, in order (each returns `Err(String)`, nothing is touched on failure):

1. `checked_root(&root)?` — root must be a directory.
2. Both paths through `resolve_within_root` — no `..`, no absolute, no drive prefix.
3. `new_rel_path` must end with `.md` (ASCII case-insensitive) →
   `"Destination must be a .md file: {new_rel_path}"`.
4. **Protected paths** — reject if either side, normalized to forward slashes and
   lowercased, is `claude.md` or `agents.md`, or starts with `.claude/`,
   `.cursor/`, `.cowtext/` →
   `"Refusing to rename a generated or tool-owned file: {rel_path}"`.
   (Compile outputs and the trust-boundary files are never renameable.)
5. Source must be an existing file → `"Not a file: {rel_path}"`.
6. No-op guard: identical resolved paths → `Err("Source and destination are the same")`.
   The store never calls in this case; the guard is belt-and-braces.
7. **Never-clobber:** if the destination exists (file *or* directory) →
   `"Already exists: {new_rel_path}"`. (`fs::rename` on Windows would fail anyway;
   on Unix it would silently clobber — the explicit check makes both platforms equal.)
8. `fs::create_dir_all(dest.parent())`, then `fs::rename`. IO errors are surfaced
   verbatim, prefixed with the relative path.

Tests to add in `src-tauri/src/project/tests.rs`: happy path returns the normalized
path; clobber refused and both files still present; `..` in either arg refused;
`CLAUDE.md` refused; missing source refused; rename into a new subdirectory creates it.

### 2.2 `reveal_path` — `src-tauri/src/project.rs`

```rust
/// Show a project file (or the project folder itself) in the OS file manager.
/// `rel_path == None` (or empty) reveals `root`.
#[tauri::command]
pub fn reveal_path(
    app: tauri::AppHandle,
    root: String,
    rel_path: Option<String>,
) -> Result<(), String>
```

TS: `invoke<void>("reveal_path", { root, relPath })` where `relPath: string | null`.

- Implementation: `use tauri_plugin_opener::OpenerExt;` then
  `app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())`.
  The plugin is already a dependency (`tauri-plugin-opener 2.5.4`); its Rust API
  exposes `reveal_item_in_dir`.
- `root` must be a directory (`checked_root`). `rel_path` goes through
  `resolve_within_root`.
- **Missing-file fallback:** if the resolved path does not exist, walk up to the
  nearest existing ancestor that is still inside `root` and reveal that instead
  (a node whose file was deleted still opens its folder). If no ancestor exists,
  `Err("Nothing to reveal: {rel_path}")`.

**Capability ruling (binding):** because the reveal goes through the plugin's *Rust*
API from our own command, **no new entry in `src-tauri/capabilities/default.json` is
required** and the file stays as-is. Lanes must NOT call
`revealItemInDir` from `@tauri-apps/plugin-opener` in the webview — that path both
violates "the webview never touches paths directly" and would need
`opener:allow-reveal-item-in-dir` added to capabilities. If a lane believes the JS
path is unavoidable it stops and reports to tech-lead; it does not edit capabilities.

### 2.3 `probe_project_dirs` — `src-tauri/src/project.rs`

```rust
/// Existence probe for the recent-projects list. Same order as the input;
/// individual entries never error.
#[tauri::command]
pub fn probe_project_dirs(paths: Vec<String>) -> Result<Vec<bool>, String>
```

TS: `invoke<boolean[]>("probe_project_dirs", { paths })`.
Body is `Ok(paths.iter().map(|p| Path::new(p).is_dir()).collect())`. The `Result`
wrapper is kept for signature symmetry with the rest of the surface.

### 2.4 `hooks_status` — `src-tauri/src/hooks.rs`

```rust
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    /// All three Cowtext hook entries present in .claude/settings.json.
    pub installed: bool,
    /// .claude/settings.json exists on disk.
    pub file_exists: bool,
    /// The file parsed as a JSON object with a usable `hooks` object.
    /// false ⇒ `installed` is meaningless; the UI must say so, not lie.
    pub readable: bool,
}

/// Passive, read-only probe. Never writes, never errors on malformed JSON.
#[tauri::command]
pub fn hooks_status(root: String) -> Result<HooksStatus, String>
```

TS: `invoke<HooksStatus>("hooks_status", { root })`.

Semantics:

| on disk | installed | fileExists | readable |
|---|---|---|---|
| absent | false | false | true |
| valid JSON, all 3 hooks carry `HOOK_MARKER` | true | true | true |
| valid JSON, 0–2 hooks | false | true | true |
| invalid JSON / `hooks` not an object / top level not an object | false | true | false |

`Err` only for infrastructure failure (`root` not a directory, IO read error).
Implementation must reuse the existing `HOOK_EVENTS` / `HOOK_MARKER` constants; factor
the per-event "already installed" test out of `merge_hooks` into a private helper so
the two paths cannot drift. Tests to add in `src-tauri/src/hooks/tests.rs`: all four
rows above.

### 2.5 Unchanged commands

`scan_project`, `read_graph`, `write_graph`, `read_md_file`, `write_md_file`,
`compile_*`, `assemble_*`, `refine_node`, `summarize_node`, `hooks_preview`,
`hooks_write`, `read_app_settings`, `write_app_settings`, `preset_*`, `handoff_*`
keep their exact signatures. **Nothing in `compile.rs`, `assemble.rs`, `preset.rs`,
`handoff.rs`, `settings.rs`, `hooks_server.rs` changes in this batch.**

---

## 3. Frontend IPC wrapper — `src/fs/api.ts` (NEW FILE, Lane 2)

The only file that may contain the four new `invoke()` calls. Lane 3 imports it and
never edits it.

```ts
import { invoke } from "@tauri-apps/api/core";

/** Mirrors src-tauri hooks::HooksStatus 1:1. */
export interface HooksStatus {
  installed: boolean;
  fileExists: boolean;
  readable: boolean;
}

/** Rename a node's .md file. Resolves to the normalized new relative path.
 *  Rejects with a plain string: collision, protected file, escape attempt, IO. */
export function renameNodeFile(
  root: string,
  relPath: string,
  newRelPath: string,
): Promise<string> {
  return invoke<string>("rename_node_file", { root, relPath, newRelPath });
}

/** Show a file in the OS file manager. `relPath` omitted/null reveals the root. */
export function revealPath(root: string, relPath?: string | null): Promise<void> {
  return invoke<void>("reveal_path", { root, relPath: relPath ?? null });
}

/** Existence probe for the recent-projects list; same order as `paths`. */
export function probeProjectDirs(paths: string[]): Promise<boolean[]> {
  return invoke<boolean[]>("probe_project_dirs", { paths });
}

/** Passive read of .claude/settings.json install state. */
export function hooksStatus(root: string): Promise<HooksStatus> {
  return invoke<HooksStatus>("hooks_status", { root });
}
```

---

## 4. Store API additions (Lane 2 — frozen signatures)

### 4.1 `src/store/settings.ts`

`settings.json` lives in `app_config_dir` and is **frontend-owned**; it is NOT
`graph.json`, so the hard "bump version + migrate" rule does not apply. `version`
stays `1`; `mergeSettings` is already tolerant (unknown fields ignored, missing
fields defaulted) which is the migration mechanism. New fields must be added to
`AppSettings`, to `DEFAULT_SETTINGS`, to `mergeSettings` (with type + range
validation), and to the `persistNow` payload **in declared order**.

```ts
export interface RecentProject {
  /** Absolute project root, exactly as the dialog / scan returned it. */
  root: string;
  /** Basename, precomputed so the startup screen needs no path parsing. */
  name: string;
  lastOpenedMs: number;
}

export const MAX_RECENT_PROJECTS = 8;

export const PANEL_LIMITS = {
  leftMin: 180, leftMax: 480, leftDefault: 248,
  rightMin: 320, rightMax: 900, rightDefault: 460,
  briefMin: 48, briefMax: 600, briefDefault: 72,
} as const;

interface AppSettings {
  version: 1;
  masterVolume: number;
  barnSounds: boolean;
  toolSounds: boolean;
  muted: boolean;
  calmMode: boolean;
  claudeBinaryPath: string;
  // ── new in this batch ──
  recentProjects: RecentProject[];   // newest first, ≤ MAX_RECENT_PROJECTS
  leftPanelWidth: number;            // px, clamped leftMin..leftMax
  rightPanelWidth: number;           // px, clamped rightMin..rightMax
  leftPanelCollapsed: boolean;       // default false
  briefHeight: number;               // px, clamped briefMin..briefMax
  syncFileName: boolean;             // default true (idea #1)
}
```

New actions on `SettingsState` (all persist through the existing 500 ms debounce):

```ts
pushRecentProject: (root: string) => void;   // move-to-front, dedupe, cap 8
removeRecentProject: (root: string) => void;
setLeftPanelWidth: (px: number) => void;     // clamped
setRightPanelWidth: (px: number) => void;    // clamped
setLeftPanelCollapsed: (b: boolean) => void;
setBriefHeight: (px: number) => void;        // clamped
setSyncFileName: (b: boolean) => void;
```

`mergeSettings` rules for `recentProjects`: must be an array; each entry kept only if
`root` and `name` are non-empty strings and `lastOpenedMs` is a finite number; deduped
by `root` compared case-insensitively (Windows); truncated to 8; anything else →
`[]`. Numeric fields are clamped, not rejected, so a hand-edited file cannot wedge the
layout off-screen.

Dedupe/compare key is `root.replace(/[\\/]+$/, "").toLowerCase()`.

### 4.2 `src/store/project.ts`

```ts
interface ProjectState {
  root: string | null;
  files: MdFile[];
  scanning: boolean;
  error: string | null;
  /** null = never probed for this root. */
  hooksInstalled: boolean | null;
  /** false = .claude/settings.json exists but could not be parsed. */
  hooksReadable: boolean;

  openProject: () => Promise<void>;             // dialog → openProjectAt
  /** Open a known path (recent list). Resolves false when the scan failed;
   *  on failure `root` is left untouched and `error` is set. */
  openProjectAt: (root: string) => Promise<boolean>;
  rescan: () => Promise<void>;
  /** Re-reads hooks_status for the current root; no-op when root is null. */
  refreshHooksStatus: () => Promise<void>;
}
```

- A successful open (either entry point) calls
  `useSettingsStore.getState().pushRecentProject(result.root)` and
  `void get().refreshHooksStatus()`.
- Opening a *different* root resets `hooksInstalled` to `null` **before** the probe,
  so the UI never shows the previous project's state.
- `refreshHooksStatus` sets `{ hooksInstalled: s.installed && s.readable, hooksReadable: s.readable }`;
  on rejection it sets `{ hooksInstalled: null, hooksReadable: true }` (unknown, not
  "broken") and does not touch `error`.
- Import direction: `project.ts → settings.ts → (nothing)`. No cycle.

### 4.3 `src/store/graph.ts`

```ts
/** Paths the app must never rename — mirrors the Rust guard in rename_node_file. */
export function isRenameProtected(relPath: string): boolean;

/** Suggested .md path for a title: same directory as `currentPath`, slugified
 *  title, `.md`; de-duped with `-2`, `-3`… against `taken`. Pure. */
export function suggestFilePath(
  currentPath: string,
  title: string,
  taken: ReadonlySet<string>,
): string;

interface GraphState {
  // …existing…
  /** Rename the node's file on disk, then adopt the returned path.
   *  Rejects with a plain string; on failure `filePath` is unchanged. */
  renameNodeFile: (id: string, nextRelPath: string) => Promise<void>;
  /** Commit a title edit. Always sets the title. When settings.syncFileName is
   *  on and the file is not protected and the slug changed, also renames the
   *  file. Resolves to an error message when the rename failed (title is still
   *  applied), or null on success/no-op. Never throws. */
  commitTitle: (id: string, title: string) => Promise<string | null>;
}
```

- `renameNodeFile` calls `fs/api.ts#renameNodeFile`, then
  `updateNode(id, { filePath: returned })` and `void useProjectStore.getState().rescan()`.
  It never writes `filePath` optimistically.
- `taken` for `suggestFilePath` = all node `filePath`s **plus** all scanned
  `useProjectStore` file paths, exactly like `createNode` builds it today.
- `commitTitle` is the ONLY place that auto-renames. Renames never fire per keystroke —
  only on blur / Enter from the UI.
- `beginConnection` / `confirmConnection` and the `MemoryNode` / `MemoryEdge` /
  `BarnGraph` shapes are **untouched**. `graph.json` stays `version: 1`;
  `serializeGraph` output for an unchanged graph must be byte-identical to today's.

---

## 5. Persistence & wire shapes summary

| What | Where | Owner | Schema impact |
|---|---|---|---|
| recent projects, panel widths, brief height, syncFileName | `app_config_dir/settings.json` via `write_app_settings` | frontend (`store/settings.ts`) | none — tolerant merge, `version` stays 1 |
| node `filePath` after rename | `.cowtext/graph.json` (existing field) | `store/graph.ts` | none |
| hooks install state | derived at runtime from `.claude/settings.json` | `store/project.ts` | none — never persisted |
| edge handle choice (#16) | derived at render time from node positions | `src/canvas/` | none — deliberately NOT persisted |
| edge colour | **deferred** | — | would be version 2 + migration (§11) |

No event (`barn://event`, `assemble://status`) changes. No new event.

---

## 6. Capabilities

`src-tauri/capabilities/default.json` stays exactly:

```json
"permissions": ["core:default", "opener:default", "dialog:allow-open", "dialog:allow-save"]
```

No new permission is required by this batch (see §2.2). Any lane that thinks otherwise
stops and reports — capability edits are a tech-lead ratification, not a lane decision.

---

## 7. Per-idea design decisions & acceptance criteria

### 7.1 #1 — node filename synced with node title

**Flow.** Inspector Title input commits on blur or Enter (not per keystroke) →
`commitTitle(id, title)` → store sets the title → if `syncFileName` is on, the file is
not protected, and `slugify(title) !== current basename`, it calls
`renameNodeFile(id, suggestFilePath(...))` → Rust renames (never-clobber) → store
adopts the returned path → `rescan()` refreshes the file rail and token counts.

**Collision.** Rust refuses; `commitTitle` resolves with the error string; the title
stays changed, the file path stays as it was; the Inspector shows the message inline
under the File field with a "Rename to <suggestion>…" affordance (the suggestion is
already de-duped, so the second attempt succeeds). Nothing is ever overwritten.

**Edges / references.** Edges key on node `id`, never on `filePath` — no edge fix-up
needed. `resolveNodeId` in `store/events.ts` reads node paths live from the store, so
the live-read pulse follows the rename with no extra work. Compile reads `filePath`
from the store at compile time. **Nothing else in `graph.json` needs touching.**

**Protected files** (`CLAUDE.md`, `AGENTS.md`, `.claude/**`, `.cursor/**`,
`.cowtext/**`) are never renamed, automatically or manually; the UI shows "generated
file — not renameable" instead of the rename affordance.

Acceptance: renaming a node titled "New node" to "API surface" moves
`context/new-node.md` → `context/api-surface.md` on disk, the card path updates, the
file rail shows the new path after rescan, and `graph.json` records the new path ·
a title collision leaves both files intact and shows a message · a node adopted from
`CLAUDE.md` is never renamed · toggling **Settings → Rename file with title** off
stops all automatic renames while the manual rename entry still works.

### 7.2 #2 — hooks-installed indicator

Detection is `hooks_status` (§2.4), probed on project open and re-probed after a
successful `hooks_write`. The EventLog header renders exactly one of:

| `hooksInstalled` / `hooksReadable` | UI |
|---|---|
| `true` / `true` | static success-tinted badge `hooks installed`, **no button**; `title` names `.claude/settings.json` |
| `false` / `true` | today's `install hooks` button (unchanged) |
| `false` / `false` | amber badge `hooks: settings.json unreadable` which is clickable and opens `HooksModal` (the modal surfaces the parse error) |
| `null` / — | nothing (state unknown; never guess) |

`HooksModal` calls `useProjectStore.getState().refreshHooksStatus()` after the write
succeeds, so the button disappears without reopening the project. The trust boundary
is unchanged: the modal still requires an explicit approval click.

Acceptance: with hooks already in `.claude/settings.json` the install button is absent
on project open · after installing from the modal the button is replaced by the badge
without a reopen · a project with a corrupt `settings.json` shows the amber badge and
never claims "installed".

### 7.3 #3 — resizable left/right panels

Widths come from the settings store (`leftPanelWidth` / `rightPanelWidth`) and are
applied as inline `style={{ width }}`; the `w-inspector` Tailwind class is dropped
from the panel element (the token stays in `tokens.css` as the documented default).
Drag is a shared `src/ui/ResizeHandle.tsx`: 4 px visible / 10 px hit strip, pointer
capture, `cursor-col-resize`, hover shows the accent line, double-click resets to
default, Left/Right arrows nudge ±16 px when focused, `role="separator"` +
`aria-orientation="vertical"` + `aria-valuenow`. Clamping lives in the store setters
(`PANEL_LIMITS`), never in the component. Persist is the existing 500 ms debounce, so
a drag writes once.

`FileRail`'s collapsed flag moves from local `useState` to `leftPanelCollapsed`, so
the layout survives a restart.

Acceptance: both panels drag smoothly with no layout jump and no canvas remount ·
widths survive an app restart · widths clamp at the limits · double-click resets ·
the canvas never shrinks below its own min (flex `min-w-0` is already in place).

### 7.4 #4 — wider code editor / viewer

Three moves, no new window (that is #18, deferred):

1. Default inspector width 392 → **460 px** (`PANEL_LIMITS.rightDefault`), max 900 px
   via #3.
2. Code/diff modals widen: `CompileModal` and `HooksModal` panels go from
   `w-[720px]` to `w-[1040px] max-w-[94vw]`, with the diff body given a
   `min-h-[46vh]`. Floor: at a 1280 px viewport the panel must be ≥ 960 px wide.
3. The Markdown tab's editor area fills the panel height (`min-h-0 flex-1` is already
   correct) — no fixed heights may be introduced.

Acceptance: at 1280×800 the compile diff shows ≥ 110 monospace columns without
horizontal scrolling · the inspector opens at 460 px on a fresh profile · no modal
exceeds the viewport at 1024×768.

### 7.5 #5 — role description in the Role popup

New file `src/canvas/roleMeta.ts` (UI copy, not domain data — the store keeps owning
`NODE_ROLES`):

```ts
export const ROLE_DESCRIPTIONS: Record<NodeRole, string> = {
  persona:      "Who the agent is: voice, stance, standing preferences.",
  rules:        "Hard constraints the agent must never break.",
  architecture: "How the system fits together: modules, boundaries, data flow.",
  workflow:     "Ordered processes — the steps to follow for a recurring job.",
  task:         "Work with a finish line: scoped, checkable, done and gone.",
  reference:    "Lookup material, read on demand rather than always in context.",
  glossary:     "Vocabulary: the exact words this project uses, and what they mean.",
};
```

Copy is derived from the DESIGN_SPEC "Meaning" column — canon, do not reword the first
clause. The native `<select>` is replaced by a custom role popup built on the shared
menu primitive (§7.9): each row is glyph + role name + description, the active row is
marked; the active role's description also stays visible under the control in the
Properties tab. Role colour comes from `roleVar` / `--role-*` as today.

Acceptance: all seven roles show a description in the popup and the active one is
visible without opening the popup · keyboard: the popup opens with Enter/Space, moves
with arrows, commits with Enter, cancels with Escape · no raw hex colours.

### 7.6 #7 — bigger, more visible read-order badge

`MemoryNodeCard` badge: 16×16 / `text-micro` → **20 px tall, `min-w-[20px]`,
`px-1`, `text-2xs font-semibold`, tabular numerals**, `bg-surface-3` +
`border border-border-strong`, text `--text-primary` instead of secondary. It grows
horizontally for 2–3 digits and never wraps or truncates the title row.

Acceptance: legible at canvas zoom 0.5 · a 3-digit order does not push the pin or the
live dot out of the row · the card's 97 px min-height is unchanged.

### 7.7 #8 — recent projects on the startup screen

Persistence: `AppSettings.recentProjects` (§4.1). Recording happens in the project
store on every successful open; the startup screen never writes the list except
through `removeRecentProject`.

UI (inside `EmptyState` in `App.tsx`): under the "Open folder" button, a "Recent"
section listing ≤ 8 rows, newest first. Row = project name (base) + full path
(mono, muted, rtl-truncated with a `title`) + relative last-opened ("today",
"3 days ago"). Click → `openProjectAt(root)`. A hover-revealed `×` calls
`removeRecentProject`. On mount the screen calls `probeProjectDirs` once with the
list; entries that come back `false` render disabled with a `missing` tag and only
offer remove. Right-click menu: **Open · Reveal in File Explorer** (disabled when
missing) **· Remove from list**. Empty list ⇒ the section is not rendered at all
(the current empty state is unchanged for first-run users).

Acceptance: opening two projects then restarting shows both, newest first · opening an
already-listed project moves it to the top without duplicating · a deleted folder shows
`missing` and cannot be opened · removing a row persists across a restart · a failed
open shows the scan error and leaves the current view intact.

### 7.8 #13 — scan overlay

DESIGN_SPEC forbids rotating spinners; the canonical waiting indicator is the 4-step
amber pixel march already used by `Scanning`. **Ruling: implement the "spinner" as an
overlay carrying the pixel march, not a rotating spinner.**

New `src/ui/ScanOverlay.tsx`: `absolute inset-0 z-panel`, translucent
`--scrim`-based veil, centred pixel march + caption, `pointer-events-auto` so clicks
during a scan are swallowed, `aria-busy` + `role="status"`. Mounted over the
**Inspector** and over the **file-rail list**, driven by `useProjectStore(s => s.scanning)`.
It must NOT unmount the Inspector or the CodeMirror instance (editor scroll position
and unsaved buffer survive a rescan). Respect `selectReducedMotion` — with reduced
motion the marks are static and only the caption shows.

Acceptance: pressing Rescan veils the right panel and the file list within one frame
and clears when the scan resolves · unsaved markdown text is still there afterwards ·
the canvas is never veiled (it does not depend on the scan) · calm mode shows no
animation.

### 7.9 #9 — dynamic context menus

One reusable primitive, in a new `src/ui/` directory (Lane 3):

```ts
// src/ui/menuTypes.ts
export type MenuItem =
  | { kind: "item"; id: string; label: string; icon?: LucideIcon;
      hint?: string; disabled?: boolean; danger?: boolean; checked?: boolean;
      onSelect: () => void }
  | { kind: "separator"; id: string };

// src/ui/useContextMenu.ts
export function useContextMenu(): {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  openAt: (e: React.MouseEvent, items: MenuItem[]) => void;   // preventDefault inside
  close: () => void;
};

// src/ui/ContextMenu.tsx
export function ContextMenu(props: {
  x: number; y: number; items: MenuItem[]; onClose: () => void;
}): JSX.Element | null;
```

Behaviour: `z-dropdown`, `shadow-dropdown`, viewport-flip on both axes, closes on
Escape / outside pointerdown / scroll / window blur / after any selection, arrow-key +
Home/End navigation skipping separators and disabled rows, `role="menu"` /
`role="menuitem"`, focus returns to the invoking element. Items are **computed per
open** from current state — that is what makes them dynamic; a disabled item must
carry a `hint` explaining why.

Per-surface item sets (state-dependent entries in *italics*):

| Surface | Items |
|---|---|
| Node card | *Open markdown* / *Create file* (when missing) · Rename file… (disabled + hint for protected files) · **Reveal in File Explorer** · — · *Pin* / *Unpin* · Assemble (disabled while busy) · Summarize (disabled while busy) · *Cancel assemble* (only when queued) · — · Remove from graph (danger) |
| Canvas pane | New node here · Fit view · — · **Reveal project in File Explorer** |
| Edge | Change kind → 4 rows with the current kind `checked` · Edit note… (selects the edge) · — · Delete edge (danger) |
| File-rail row | *Adopt as memory node* / *Select node* · **Reveal in File Explorer** · Copy relative path · — · Rescan |
| File-rail header | Rescan · **Reveal project in File Explorer** · Collapse panel |
| Inspector header / File field | **Reveal in File Explorer** · Copy relative path · Rename file… · Open markdown tab |
| Event-log row | **Reveal in File Explorer** (only when the event has a `filePath` that resolves inside the root) · Copy path |
| Recent-project row (startup) | Open · **Reveal in File Explorer** (disabled when missing) · Remove from list |

"Copy path" uses `navigator.clipboard.writeText` — no FS access, no new dependency.
Edge "Change kind" is a submenu-free flat group with a checkmark column (no nested
menus in this batch).

Acceptance: every surface above opens its menu on right-click and only its menu (no
browser menu, no double menu) · Escape and outside-click always close · disabled rows
are not selectable and explain themselves · no menu escapes the viewport · keyboard
navigation works on every surface.

### 7.10 #10 — Reveal in File Explorer

Backed by `reveal_path` (§2.2), surfaced in the node context menu, the file-rail row
and header menus, the Inspector menu (right panel), the event-log row menu and the
recent-project row menu — exactly as listed in §7.9. A node whose file is missing still
gets the entry: the Rust fallback reveals the nearest existing parent folder.

Acceptance: the entry opens Explorer with the file selected on Windows · a missing file
opens its folder instead of erroring · reveal on the project root opens the project
folder · a reveal failure surfaces as an inline error, never a silent no-op.

### 7.11 #16 (rendering half) — nicer edges, easier connecting

**In batch, all render-side, no schema change:**

1. **Handles on halves of the perimeter.** `MemoryNodeCard` gets three target handles
   on the input half — ids `t-top`, `t-left`, `t-bottom` (top-left corner, left centre,
   bottom-left corner) — and three source handles on the output half — `s-top`,
   `s-right`, `s-bottom`. Ids are frozen. Only the handle nearest the counterpart node
   is visually emphasised; all six accept a connection.
2. **Handle choice is derived, never persisted.** A pure helper
   `src/canvas/handles.ts#pickHandles(source: MemoryNode, target: MemoryNode):
   { sourceHandle: string; targetHandle: string }` chooses the pair from relative
   positions at render time in `GraphCanvas`'s store→RF edge mapping.
   `MemoryEdge`/`graph.json` gain **no** `sourceHandle`/`targetHandle` fields —
   that would be a schema change and is out of scope. `onConnect` keeps discarding
   React Flow's handle ids and calls `beginConnection({ source, target })` unchanged.
3. **Splines.** Keep `getBezierPath` (a bezier *is* the spline here) but pass an
   explicit `curvature` derived from the endpoint delta: ~0.28 for a normal
   left-to-right run, rising toward 0.6 when the target is behind the source or the
   vertical delta dominates, so the curve bulges out instead of folding back through
   the cards.
4. **Arrow joint.** `BaseEdge` gets `strokeLinecap: "round"`; markers get
   `markerUnits="userSpaceOnUse"` with `refX` retuned so the stroke terminates at the
   arrow base. No stroke stub may poke through the arrowhead at zoom 2.
5. **Snap radius.** `<ReactFlow connectionRadius={44}>` (default 20) plus an enlarged
   invisible hit area on `.ct-handle` (≈16 px square via a transparent `::after` in
   `src/styles/index.css`) while the visible square stays 7 px. Handles fade in on
   node hover as today.

**Out of batch:** edge colour (§11) — it is a `graph.json` field.

Acceptance: an edge between two vertically stacked cards no longer passes through
either card · connecting starts from ~40 px away from a handle · the arrow tip is a
clean single shape at zoom 2 and at zoom 0.4 · `graph.json` written before and after
this work is byte-identical for the same graph · all four edge kinds keep their
current stroke/marker vocabulary (kind is read from style, never hue).

### 7.12 #17 — resizable brief field

The Brief `<textarea>` keeps `resize-y` but gets `min-h-[48px] max-h-[50vh]` and its
height is bound to `AppSettings.briefHeight`, committed via a `ResizeObserver` on
pointer-up (debounced by the existing settings persist). Without persistence the height
resets on every selection change because React remounts the field per node — that is
the actual bug behind the request.

Acceptance: dragging the brief taller survives switching nodes and restarting the app ·
the field never pushes the Assemble section out of reach (the tab still scrolls).

---

## 8. File-zone grid — STRICTLY DISJOINT

| Lane | Agent | Files it may create/edit |
|---|---|---|
| **L1 — backend** | tech-general | `src-tauri/src/project.rs` · `src-tauri/src/project/tests.rs` · `src-tauri/src/hooks.rs` · `src-tauri/src/hooks/tests.rs` · `src-tauri/src/lib.rs` |
| **L2 — store + IPC** | tech-general | `src/fs/api.ts` *(new)* · `src/store/project.ts` · `src/store/graph.ts` · `src/store/settings.ts` |
| **L3 — UI** | tech-ui | `src/App.tsx` · `src/ui/**` *(new: `ContextMenu.tsx`, `useContextMenu.ts`, `menuTypes.ts`, `ResizeHandle.tsx`, `ScanOverlay.tsx`)* · `src/canvas/**` *(incl. new `roleMeta.ts`, `handles.ts`)* · `src/inspector/**` · `src/settings/SettingsModal.tsx` · `src/compile/CompileModal.tsx` · `src/styles/index.css` · `src/styles/tokens.css` · `tailwind.config.js` |

**Owned by nobody this batch — do not touch:** `src-tauri/capabilities/default.json`
(ruling §6) · `src-tauri/src/{compile,assemble,preset,handoff,settings,hooks_server,main}.rs`
and their tests · `src/scene/**` · `src/preset/**` · `src/handoff/**` · `src/assemble/**` ·
`src/compile/{api,diff,types}.ts` · `src/store/events.ts` · `package.json` ·
`src-tauri/Cargo.toml` · `tauri.conf.json` · `docs/**`.

**Sequencing.** L1 and L2 are independent (TS does not need Rust to typecheck; the
command names are frozen here). L3 codes against the frozen signatures in §3 and §4
and may not typecheck until L2 lands — that is an ordering dependency, not a zone
overlap. The gates in §9 are evaluated after all three lanes land.

**Boundary etiquette.** An agent that needs a file outside its zone stops and reports;
it does not edit it. Any deviation from this contract needs tech-lead ratification.

---

## 9. Acceptance gates (all must be green after the lanes land)

1. `cd src-tauri && cargo clippy -- -D warnings` — clean.
2. `cd src-tauri && cargo test` — the existing 88 pass, plus the new
   `rename_node_file` (6) and `hooks_status` (4) cases.
3. `npx tsc --noEmit` — clean (strict, `noUnusedLocals`/`noUnusedParameters`).
4. `npm run lint` — 0 errors (the pre-existing 1 warning may remain). No `any`,
   anywhere.
5. **Invoke contract = 27.** Every `invoke("x")` string in `src/` has a matching
   `#[tauri::command]` fn **and** a `generate_handler![]` entry; the four new names are
   spelled exactly `rename_node_file`, `reveal_path`, `probe_project_dirs`,
   `hooks_status`.
6. **No new dependency** in `package.json` or `src-tauri/Cargo.toml`.
7. **No schema drift:** `graph.json` still `version: 1`; `serializeGraph` output for an
   unchanged graph is byte-identical to pre-batch output.
8. `src-tauri/capabilities/default.json` unchanged.
9. `npm run tauri dev` / `tauri build` are NOT run by any lane.
10. Design canon: no rotating spinners, no raw hex colours in components (tokens only),
    kind-by-style not hue on edges, blue = user-initiated / amber = agent activity.

---

## 10. Architecture verdict — idea #15 (.ts / .html / .css split)

**VERDICT: REJECTED.** Deferred either way; this is the standing ruling.

Rationale:

1. **The stack is fixed** (CLAUDE.md §2: Tauri 2 + React + PixiJS). In React, JSX *is*
   the layout language. Moving markup into `.html` files needs a template runtime or a
   parser — a new library, which requires Marty's yes and is outside this pipeline.
2. **It would cost real guarantees.** Templates are strings: props stop being
   type-checked, `strict: true` and `no-explicit-any` lose their grip on the view
   layer, and the Vite/lazy-import code-splitting that took the bundle 1,334 → 207 kB
   would have to be re-solved for template assets.
3. **Styles are already separated, better than per-component CSS.** `src/styles/tokens.css`
   is the single visual source of truth (colours, spacing, z-layers, motion) consumed
   through Tailwind and `var(--…)`. Per-component `.css` files would fragment that and
   reintroduce exactly the cascade conflicts the token layer exists to prevent.
4. **The legitimate kernel is already honoured.** "One file should not mix logic,
   markup and style" is satisfied by the module layout: state in `src/store/*.ts`,
   IPC in per-module `api.ts`, pure logic in plain `.ts` (`compile/diff.ts`,
   `scene/iso.ts`, `scene/motion.ts`), presentation in `.tsx`, design tokens in `.css`.
5. **Constructive alternative** (not this batch): keep the rule that non-presentational
   logic in a `.tsx` moves to a sibling `.ts`, and split `.tsx` files over ~250 lines
   **by component, not by language**. `src/inspector/Inspector.tsx` (547 lines) is the
   obvious candidate for a later, contract-covered refactor.

---

## 11. Deferred (with reasons)

| Idea | Reason |
|---|---|
| **#6 RU/EN localization** | Large. Needs a string-extraction pass over every component plus a locale store; no i18n library may be added, so it needs a hand-rolled `t()` layer and a translation file format. Its own batch. |
| **#11 Background 16-bit music** | Asset work — sprites/SFX are assets and Marty-side per CLAUDE.md; the code half (a looping music channel in `src/scene/sfx.ts`, calm-mode aware) is tech-barn's zone, untouched by this batch. |
| **#12 "Run Claude" launcher window** | `assemble.rs` only runs headless `claude -p`. An interactive launcher with arbitrary flags is a new spawn surface and a trust-boundary question (which flags may a click pass to a child process?). Needs its own contract. |
| **#15 .ts/.html/.css split** | **REJECTED** — architecture verdict, §10. Not a scheduling deferral. |
| **#16 — edge colour only** | Moved out by tech-lead. Persisting `color` on `MemoryEdge` is a `graph.json` schema change: `version` 1 → 2 + a migration in `migrateGraph`, **and** `src-tauri/src/preset.rs:61` hard-rejects any preset whose `version != 1`, so every preset saved after the bump would be refused — that is Rust + preset migration + preset tests, spanning a zone this batch does not own, on top of 12 items. Recipe for the follow-up: bump `BarnGraph.version` to 2, add `migrateGraph` v1→v2 (pass-through, `color` optional), widen `preset.rs` to accept `1..=2` and migrate on `preset_apply`, add `color?: string` to `stableEdge`, and constrain the picker to the token palette (no raw hex). |
| **#18 dockable / separate editor window** | Needs a second Tauri `WebviewWindow` and cross-window store sync (Zustand is per-window; the graph store would need an event bridge). Architecture work of its own. |
| **#19 sub-agent management suite** | A whole product surface: a new persisted entity with roles/tools/skills/priority, plus avatars (asset work, Marty-side). Needs product-analyst input and a phase of its own. |
| **#20 preset marketplace** | Product-analyst territory, explicitly outside this pipeline. |
