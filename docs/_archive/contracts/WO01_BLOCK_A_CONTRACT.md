# WO01 BLOCK A CONTRACT — Canvas lenses + file watcher

**Status: FROZEN 2026-08-18.** Authored by tech-lead from Marty's Work Order 01, Block A
(`docs/INPUT_PROMPT.md` T1/T2). Once lanes start, nothing in §2–§7 changes without a
ratification note appended to §9.

Verified against the code at `d717dc3` before freezing: `project.rs:56` `scan_project(root: String)`
is called directly by `project/tests.rs:22,32,47,63` · `project.rs:24` `SKIP_DIRS` (9 entries) ·
`project.rs:82` root-only `.claude` special case → `collect_agent_md` · `project.rs:86` dot-dir skip ·
`hooks_server.rs:78` `app.emit(BARN_EVENT, &event)` emit idiom · `events.ts:150` `initEventListener`
idempotent guard · `events.ts:112` `LIVE_PULSE_MS = 3200` · `settings.ts:125` `mergeSettings`
tolerant merge, `settings.ts:159` `persistNow` payload in declared order · `GraphCanvas.tsx:211`
`<Panel position="top-left">` holds the New-node button · `MemoryNodeCard.tsx:103`
`boxShadow = live ? ring, glow : ring` · `lib.rs:31` `generate_handler!` lists **38** commands ·
`App.tsx:842` single `initEventListener()` call site.

---

## 1. Scope

Block A only. Ship in one fleet run:

1. **Lens system** — a canvas toolbar segmented control `None | Activity | Weight | Live`;
   lens state persisted in `settings.json`; a lens changes **styling only**, never layout.
2. **Activity lens** — node brightness decays linearly with age of the backing file's mtime,
   full at 0 min → floor at ≥ 60 min; legend strip in the toolbar while Activity is active.
3. **A real Rust file watcher** (`notify`) emitting `fs://change`, so a `.md` touched on disk
   brightens its node within 1 s with **no user action and no rescan**.
4. **Weight** and **Live** lenses: minimal viable styling only (they must visibly restyle).

Out of scope, do not build: review queue / disk-diff banner (Block C), real token
semantics (Block B), self-write suppression, per-node badges beyond emphasis, any new
dependency other than `notify`, any binary asset, any change to the 38-command invoke
contract, any change to `capabilities/default.json` (core `emit`/`listen` needs none).

**Invoke contract stays 38 commands.** One new Tauri event. Rust test count grows from
the 88 baseline by ≥ 6.

---

## 2. Dependency ratification

`notify` is **approved** — Work Order 01 §Context declares the fixed stack as
"Rust: axum + notify". This contract ratifies exactly one line in `src-tauri/Cargo.toml`:

```toml
notify = "8"        # latest stable major at time of freeze
```

Default features, on purpose (Windows `ReadDirectoryChangesW` backend). **No
`notify-debouncer-full`, no `notify-debouncer-mini`** — those are separate crates and are
NOT approved; debouncing is hand-rolled in §4.3. If cargo resolves a different major,
lane A stops, records the resolved version, and reports it — it does not substitute a crate.
`Cargo.lock` churn is expected and belongs to lane A.

---

## 3. Lens state (frontend, lane A owns the declaration)

In `src/store/settings.ts`, exported verbatim:

```ts
export type LensMode = "none" | "activity" | "weight" | "live";
export const LENS_MODES: readonly LensMode[] = ["none", "activity", "weight", "live"];
```

- `AppSettings` gains `lens: LensMode`, appended **last** in the interface, in
  `DEFAULT_SETTINGS` (`"none"`), and **last** in the `persistNow` payload literal — declared
  order is the serialization order and this file's law.
- `version` **stays `1`**. This is an additive, tolerant-merge field: no migration, no bump.
- `mergeSettings` gains exactly: `if (typeof r.lens === "string" && LENS_MODES.some((m) => m === r.lens)) out.lens = r.lens as LensMode;`
  Anything else — missing, wrong type, unknown string — leaves the default `"none"`.
  **Unknown values are rejected to `'none'`, never preserved.**
- Setter: `setLens: (l: LensMode) => void` — `set({ lens: l }); schedulePersist();`, same shape
  as every other setter. The existing 500 ms debounce + `flushSettings()` on `beforeunload`
  already make it survive restart; nothing new is needed for persistence.

---

## 4. Watcher (Rust, `src-tauri/src/watcher.rs`, new)

### 4.1 Wire shape — event `fs://change` (byte-exact)

```rust
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    pub rel_path: String,          // forward slashes, relative to root — same string scan_project emits
    pub modified_ms: Option<u64>,  // null on remove or metadata failure; NEVER skipped
    pub size_bytes: Option<u64>,   // null on remove or metadata failure; NEVER skipped
    pub kind: FsChangeKind,        // "modify" | "create" | "remove"  (serde rename_all = "snake_case")
}
```

TS mirror (in `src/store/project.ts`):

```ts
export interface FsChange {
  relPath: string;
  modifiedMs: number | null;
  sizeBytes: number | null;
  kind: "modify" | "create" | "remove";
}
```

`sizeBytes` is a **ratified extension** to the payload named in the work order (see §9): without
it a created or edited file shows `0 tok` and scores wrong in the Weight lens until the next
manual rescan, which would be a visible defect. No other field may be added.

### 4.2 Lifecycle — restarted inside `scan_project` (documented side-effect)

- `project.rs` splits: `pub(crate) fn scan_root(root: String) -> Result<ProjectScan, String>`
  keeps today's body verbatim; the `#[tauri::command] pub fn scan_project` becomes a thin
  wrapper `(app: tauri::AppHandle, state: tauri::State<'_, watcher::WatcherState>, root: String)`.
  **The JS call site and command name do not change** (`invoke("scan_project", { root })`) —
  `AppHandle`/`State` are injected by Tauri. `project/tests.rs` call sites move to `scan_root`.
- On **successful** scan only, the wrapper calls `watcher::restart(&app, &state, &root)`.
  A failed scan leaves the previous watcher untouched.
- `restart` drops the previous `RecommendedWatcher` (drop = stop), aborts its debounce task,
  bumps a `generation: u64`, and installs the new one. Watcher setup failure is **logged to
  stderr and swallowed** — `scan_project` must still return its files (same discipline as
  `hooks_server::start`). One project watched at a time, always the current root.
- State: `#[derive(Default)] pub struct WatcherState(pub std::sync::Mutex<Option<ActiveWatcher>>);`
  managed in `lib.rs::run().setup` via `app.manage(watcher::WatcherState::default())`.
  Never `unwrap()` the mutex (poisoning): `let Ok(mut g) = state.0.lock() else { return; };`.
- **Generation guard:** the debounce task captures its generation and drops a flush without
  emitting if the state's current generation moved on. This is what stops a stale watcher for
  project A from painting nodes in project B during the switch.

### 4.3 What is watched, what is emitted

- One recursive `notify` watch on the project root. Filtering is ours, in the handler.
- A path is relevant iff `project::is_scannable_md(root, path)` returns true. That helper is
  **new, lives in `project.rs`, and is the single source of truth for skip rules**:
  - file name ends with `.md` (case-insensitive) and the path is under `root`;
  - no path component between root and the file starts with `.` — **except** the exact
    root-relative prefix `.claude/agents/` (that dir's `*.md` are Memory Nodes, mirroring
    `collect_agent_md`); nothing else under `.claude/` is relevant;
  - no component is in `SKIP_DIRS`.
  - `.claude/agents` is non-recursive: `.claude/agents/sub/x.md` is NOT relevant.
- Required parity test: build a temp tree, run `walk()`, and assert every `rel_path` it returns
  satisfies `is_scannable_md`, and that a fixture list of skipped paths
  (`.git/x.md`, `node_modules/a/b.md`, `.claude/settings.md`, `.claude/skills/s/SKILL.md`,
  `target/x.md`, `.hidden/x.md`) does not. Skip rules drifting apart is the one seam here.
- **Debounce ~300 ms, hand-rolled.** notify's callback (its own thread) pushes a raw change
  into a `tokio::sync::mpsc::UnboundedSender`. A spawned tokio task keeps
  `HashMap<String /*relPath*/, (FsChangeKind, Instant)>` and loops on
  `tokio::time::timeout(Duration::from_millis(300), rx.recv())`:
  - timeout → flush everything;
  - recv → merge, then **also** flush if `pending.len() >= 64` or the oldest entry is
    > 1000 ms old (starvation guard: a compile writes many files back-to-back).
  - Kind merge precedence: `Create + Modify = Create` · `* + Remove = Remove` ·
    `Remove + (Create|Modify) = Modify` · otherwise the newer kind wins.
  - Flush reads `fs::metadata` fresh per path (never trusts a cached size/mtime);
    `Remove` → both `None`; metadata failure on Create/Modify → emit with both `None`
    rather than dropping the event (Windows transient locks are common).
  - One `app.emit("fs://change", &change)` per changed path (no batching in the payload).
- `notify::EventKind` mapping: `Create(_)` → create · `Remove(_)` → remove ·
  `Modify(_)` and everything else relevant → modify · `Access(_)` → **ignored**.
  Rename is reported by notify as remove+create (or `Modify(Name)`), which the store
  handles correctly through the create/remove paths.
- **Known Block C prerequisite (record, do not build):** there is no self-write suppression.
  Cowtext's own writes (`write_md_file`, `compile_write`, assemble) also emit `fs://change`.
  Harmless for the Activity lens — the node genuinely changed — but Block C's review queue
  MUST NOT ship without an origin filter, or every Cowtext save opens a review banner.

---

## 5. Frontend wiring (lane A)

### 5.1 Listener location — `initEventListener()` in `src/store/events.ts`

Third `listen` inside the existing idempotent `initEventListener` wiring, alongside
`barn://event` and `assemble://status`, pushed into the same `unlistens` array.
**Rationale (binding): `App.tsx` is in neither lane's zone.** `initEventListener` is already
called exactly once there and is StrictMode-safe; no other init site may be created.

```ts
unlistens.push(
  await listen<FsChange>("fs://change", (ev) => {
    useProjectStore.getState().applyFsChange(ev.payload);
  }),
);
```

Import direction check: `project.ts → settings.ts`, `events.ts → graph.ts, project.ts`.
No cycle. `project.ts` must not import `events.ts`.

### 5.2 Store patch — `applyFsChange` in `src/store/project.ts`

`ProjectState` gains `applyFsChange: (c: FsChange) => void`. Rules, frozen:

- **No rescan.** `applyFsChange` never calls `scan_project`.
- `root === null` → ignore.
- `remove` → drop the entry; if absent, return the **same array identity** (no re-render).
- `modify` on a known `relPath` → new array with that entry replaced by
  `{ ...f, modifiedMs: c.modifiedMs ?? Date.now(), sizeBytes: c.sizeBytes ?? f.sizeBytes }`.
  The `?? Date.now()` is deliberate: the event itself is proof the file changed *now*, so a
  metadata failure still brightens the node.
- `modify` on an unknown `relPath`, or `create` → insert
  `{ relPath, sizeBytes: c.sizeBytes ?? 0, modifiedMs: c.modifiedMs ?? Date.now() }` at the
  position that keeps `files` sorted by `relPath` ascending (the invariant `scan_project`
  establishes at `project.rs:64`). `create` on a known path degrades to `modify`.
- Every branch produces a new `MdFile` object for the changed row only; untouched rows keep
  their identity so cards that did not change do not re-render.

### 5.3 Live-lens helper — `src/store/events.ts` (new exports, additive)

`lastLiveTs` and `LIVE_PULSE_MS` are **untouched** (the 3.2 s card pulse keeps its semantics).
Add:

```ts
export const LENS_LIVE_WINDOW_MS = 60_000;
/** Same scan as lastLiveTs, one-minute memory — for the Live lens only. */
export function lensLiveTs(nodeId: string, events: BarnEvent[]): number | null;
```

---

## 6. Lens styling (lane B)

### 6.1 The layout-freeze law (this is the T1 acceptance, structurally)

A lens may set **only**: `filter`, `opacity`, `box-shadow`, `border-color`, `background`,
`color`, and CSS custom properties. It may **never** set `width`, `height`, `min/max-*`,
`padding`, `margin`, `border-width`, `font-size`, `display`, `position`, `transform`, or add/
remove DOM nodes that occupy space. Cards keep their `id` keys, so a lens switch is a pure
style update on already-mounted nodes — no React Flow re-measure, no re-layout.

Mechanism: `MemoryNodeCard` writes two custom properties on the existing card root `style`
(next to `minHeight`/`boxShadow`) and adds `filter: brightness(var(--lens-brightness, 1))`:

- `--lens-brightness: number` — applied through `filter`;
- `--lens-emphasis: 0..1` — raw signal, available for stripe/badge accent tuning.

`lens === "none"` ⇒ emphasis `1`, brightness `1`, i.e. today's exact appearance. The live-read
pulse, selection ring, highlight ring, assemble bar and error stripe all keep priority over
lens styling — a lens tints, it never hides state.

### 6.2 Formulas — `src/canvas/lens.ts` (new, pure, no JSX)

```ts
export const LENS_BRIGHT_MIN = 0.66;   // "base": nothing to say about this node
export const LENS_BRIGHT_MAX = 1.18;   // full emphasis
export const ACTIVITY_WINDOW_MS = 3_600_000;   // 60 min, per T2
export function brightnessFor(emphasis: number): number; // MIN + (MAX-MIN) * clamp01(emphasis)
```

- **Activity:** `age = max(0, nowMs - (modifiedMs ?? 0))`;
  `emphasis = clamp01(1 - age / ACTIVITY_WINDOW_MS)`. Linear on purpose — it is the curve the
  legend gradient draws, and it is trivially verifiable. `modifiedMs === null` or no backing
  file ⇒ `emphasis = 0`. Reading of T2: "dims to base" = the lens floor `LENS_BRIGHT_MIN`;
  fresh files go *above* 1 so a lens is visible on an old project too.
- **Weight (minimal, Block B replaces):** `tokens = max(1, round(sizeBytes / 4))`;
  `maxBytes = useProjectStore((s) => s.files.reduce((m, f) => Math.max(m, f.sizeBytes), 0))`
  (a primitive selector — re-renders only when the max moves);
  `emphasis = maxBytes > 0 ? sizeBytes / maxBytes : 0`; missing file ⇒ 0.
  **Required code comment**, verbatim intent: *"Block A placeholder: bytes/4 over all scanned
  .md. Real token semantics (per-node count, compiled totals, thresholds) arrive with Block B
  — see docs/INPUT_PROMPT.md T3."*
- **Live (minimal):** binary. `lensLiveTs(node.id, events) !== null` ⇒ `emphasis = 1`, else `0`.
- Ticker: `useLensTickStore` (tiny zustand store in `lens.ts`, `{ tick: number; bump: () => void }`).
  `LensControl` owns the only interval: `if (lens !== "activity") return;`
  `setInterval(bump, 30_000)`, cleared on unmount/lens change. Cards read `tick`
  **unconditionally** (rules-of-hooks) and use it as the sole dependency of
  `const nowMs = useMemo(() => Date.now(), [tick, lens])`. Nothing ticks outside Activity.

### 6.3 `LensControl` — `src/canvas/LensControl.tsx` (new)

- Lives **on the canvas**, inside `GraphCanvas`'s existing `<Panel position="top-left">`,
  laid out in a row after the "New node" button (`gap-2`); same `h-control` (28 px),
  `rounded border border-border bg-surface-2 shadow-card` chrome as that button.
- Four segments, labels `None · Activity · Weight · Live`, `font-mono text-micro uppercase`,
  divided by `border-border` hairlines. **Active segment = accent (blue)**: `bg-accent-surface`,
  `text-accent-text`, `border-accent-border`. Inactive: `text-content-muted`, hover
  `bg-surface-3`. Design-tokens law "blue is you, amber is the cow" — the lens picker is a
  user control, so it is blue; the data it reveals (file activity) is amber. Never mix on one
  control.
- A11y: `role="radiogroup"` + `aria-label="Canvas lens"`, each segment `role="radio"` with
  `aria-checked`, plus a `title`. No new keybinding this block.
- **Legend strip** — rendered only when `lens === "activity"`, appended inside the same
  control's row so nothing shifts on the canvas: a 96 × 6 px bar,
  `background: linear-gradient(90deg, var(--surface-3), var(--amber))`, `rounded-pill`,
  flanked by `text-micro text-content-muted` labels `earlier` (left) and `latest` (right),
  `aria-hidden`. Amber because it encodes file/agent activity. No legend for Weight or Live.
- Reduced motion: nothing animates here, so no `selectReducedMotion` handling is needed.

---

## 7. File-zone grid — zero overlap

| Lane | Agent | Files (exclusive) |
|---|---|---|
| **A** | tech-general | `src-tauri/src/watcher.rs` *(new)* · `src-tauri/src/watcher/tests.rs` *(new)* · `src-tauri/src/lib.rs` · `src-tauri/src/project.rs` · `src-tauri/src/project/tests.rs` · `src-tauri/Cargo.toml` · `src-tauri/Cargo.lock` · `src/store/settings.ts` · `src/store/project.ts` · `src/store/events.ts` · `docs/TERMINOLOGY.md` (one Events-table row) |
| **B** | tech-ui | `src/canvas/LensControl.tsx` *(new)* · `src/canvas/lens.ts` *(new)* · `src/canvas/GraphCanvas.tsx` · `src/canvas/MemoryNodeCard.tsx` · `src/styles/index.css` (only if a lens class is genuinely needed) |

Nobody touches: `src/App.tsx`, `src/store/graph.ts`, `src/scene/**`, `src-tauri/capabilities/**`,
`tauri.conf.json`, any other file in the repo. All new files under `src/canvas/` belong to B;
all new files under `src-tauri/src/` and `src/store/` belong to A.

**Frozen API surface B consumes** (A must export exactly these names; B codes against them
and does not stub or redeclare them):

```ts
// src/store/settings.ts
export type LensMode = "none" | "activity" | "weight" | "live";
export const LENS_MODES: readonly LensMode[];
// useSettingsStore state: lens: LensMode; setLens: (l: LensMode) => void;

// src/store/events.ts
export const LENS_LIVE_WINDOW_MS: number;
export function lensLiveTs(nodeId: string, events: BarnEvent[]): number | null;

// src/store/project.ts — unchanged MdFile { relPath, sizeBytes, modifiedMs }
export interface FsChange { relPath: string; modifiedMs: number | null;
  sizeBytes: number | null; kind: "modify" | "create" | "remove" }
```

Sequencing: lane A lands the three store files **before** its Rust work, so lane B can run
`npx tsc --noEmit` against real exports. Gates run once, after both lanes land.

`docs/TERMINOLOGY.md` Events table gains exactly one row (lane A, verbatim):

```
| `fs://change` | `FsChange { relPath, modifiedMs, sizeBytes, kind }` | watcher.rs → emit → `useProjectStore.applyFsChange` → Activity lens |
```

---

## 8. Acceptance gates

Green before the dispatcher commits:

1. `npx tsc --noEmit` clean · `npm run lint` (0 errors; the 1 known warning may remain).
   TS `strict`, no `any`, no unused locals/params.
2. From `src-tauri/`: `cargo clippy -- -D warnings` clean · `cargo test` ≥ 94 passing
   (88 baseline + ≥ 6 new watcher/parity tests, 0 failures).
3. `lib.rs::generate_handler!` still lists **38** commands — unchanged.
4. `settings.json` still has `"version": 1`; an existing settings file without `lens` loads
   with `lens: "none"`; a file with `"lens": "nonsense"` also loads as `"none"`.
5. T1: switching lenses restyles every card, causes **no** node position or size change, and
   the choice survives an app restart. No layout-affecting property in the lens code paths
   (grep the diff for `width|height|padding|margin|border-width|font-size` inside lens logic).
6. T2 (manual walk, `tauri dev` is Marty's to run — lanes never run it): with Activity active,
   `(Get-Item x.md).LastWriteTime = Get-Date` on a managed `.md` brightens that node within
   1 s, with no click, no rescan spinner, and no other node changing.
7. Weight and Live each visibly restyle at least two nodes differently on a real project.
8. No new dependency other than `notify`; no binary asset; no `capabilities/default.json` edit.

---

## 9. Ratifications & deviations

1. **`notify` approved** — Work Order 01 §Context declares "Rust: axum + notify" as the fixed
   stack; this is that line being cashed in, not a stack expansion. Debouncer crates excluded.
2. **`sizeBytes` added to the `fs://change` payload** beyond the work order's
   `{ relPath, modifiedMs, kind }` — ratified by tech-lead; rationale in §4.1 (stale token
   badge and wrong Weight score otherwise). No further payload growth without a note here.
3. **`scan_project` gains injected `AppHandle` + `State` parameters.** The command name, its
   JS arguments and the 38-command count are unchanged; the invoke contract is not touched.
4. **Watcher restart is a side-effect of `scan_project`**, by design and documented here —
   there is deliberately no `watch_start`/`watch_stop` command, because a 39th command would
   need a second call site and a second lifecycle to get wrong.
5. Open risk, accepted for Block A: a recursive watch on a huge repo still receives OS events
   for `node_modules`/`target` before our filter drops them. Measured cost is a filter call per
   event. If it bites, the fix (per-subtree watches) lands in Block C, not here.
6. Open risk, deferred to Block C: no self-write suppression (§4.3).
