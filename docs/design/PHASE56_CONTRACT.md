# PHASE 5/6 BUILD CONTRACT — Sound · Settings · Juice · Presets & Handoff

Status: **FROZEN**. Author: Code Lead, 2026-08-17. Four lanes build in parallel from this
document without talking to each other. Every interface here is binding; every ambiguity
found later is handled by the Deviation procedure (§12), never by improvising.

Companion authorities (read before coding your lane):
- `CLAUDE.md` — hard rules (stack freeze, FS-through-Rust, trust boundaries, clippy/tsc gates).
- `docs/design/SOUND_DESIGN.md` — §2b cue sheet and §3 mixing rules are law for Lane A.
- `docs/design/DESIGN_SPEC.md` + `src/styles/tokens.css` — law for Lane B and any DOM UI.
- `docs/research/JUICE.md` §4–5 — storyboards for Lane C.
- `docs/design/PHASE34_BARN_CONTRACT.md` — conventions this contract extends, not replaces.

---

## 0. Decisions register (read this first)

| # | Decision | Choice |
|---|---|---|
| D1 | Settings persistence | **Rust command pair** `read_app_settings` / `write_app_settings` writing `settings.json` into `app.path().app_config_dir()` (`C:\Users\<u>\AppData\Roaming\com.mooexe.cowtext\settings.json`) via the existing `write_atomic`. No new plugin, no capability change, keeps "all FS through Rust". localStorage rejected (webview-local, violates FS rule spirit). |
| D2 | SFX asset serving | **14 individual WAVs, loaded as separate Howls** via Vite `?url` imports from `assets/sfx/`. The sprite-concat build step (webm/mp3 encode) needs audio tooling we don't have in the stdlib-only script policy — deferred to the crafted-SFX pass. WAVs total ~580 KB, local disk, all preloaded at init → zero first-play latency anyway. |
| D3 | howler | `howler@^2.2.4` + `@types/howler@^2.2.12` added in Stage 0. It is in the plan-§2 fixed stack; no other new dependency is permitted. |
| D4 | Stale SFX files | The 14 `assets/sfx/barn_*.wav` + `ui_*.wav` files (pre-rename draft, zero references, not in `cues.json`) are **deleted by Lane A** (`git rm`). Canonical set = the 14 stems in `cues.json`. |
| D5 | Barn cues in Canvas view | SOUND_DESIGN §3 says barn cues play in both views, but the mapper only runs while `<BarnScene/>` is mounted. Resolution: `sfx.ts` runs a **detached-mode** event subscription that fires event-receipt cues when the scene is unmounted (§5.4). One `sceneMounted` boolean prevents double-fire. |
| D6 | `claudeBinaryPath` setting is real, not decorative | Stage 0 adds a `set_claude_override` seam to `assemble.rs` (10 lines); `settings.rs` applies it on write and at startup. Lane D's handoff runner inherits it for free (same `ClaudeRunner`). |
| D7 | Handoff runner seam | `handoff.rs` manages its **own** `HandoffRunner(pub Arc<dyn assemble::Runner>)` newtype state (`app.manage` in Stage 0 lib.rs). `AssembleQueue.runner` stays private; no assemble.rs API change beyond D6. |
| D8 | Preset storage | App-level: `app_config_dir()/presets/<slug>.cowtext-preset.json` (presets seed *new* projects, so per-project storage is wrong). Export/import moves them through OS dialogs (`dialog:allow-save` added in Stage 0). |
| D9 | J8 calf sprites | **SKIPPED.** Scene recon confirms calves are not rendered (`subagent_stop` is a no-op) and no spawn event kind exists. `calf_spawn`/`calf_despawn` cues stay loaded but unwired, documented in sfx.ts. |
| D10 | Tool sounds default | **ON** (SOUND_DESIGN's current spec), behind the "Tool sounds" switch. Master volume default **0.6**. The "no sound before settings exist" rule is satisfied: settings ship in this same push. |
| D11 | Sound call sites in shared scene files | ALL `sfx.*` call insertions into `mapper.ts` / `cow.ts` / `BarnScene.tsx` / `CompileModal.tsx` are made **in Stage 0** against the no-op stub, so Lane A only fills `sfx.ts` and Lane C owns the scene files without merge conflicts. Lane C must preserve every inserted `sfx.*` call at its semantic moment when refactoring. |
| D12 | Demo-event filtering | Ring buffer stores `LogEvent extends BarnEvent { demo?: true }` (shape frozen in Stage 0). Demo rows get a badge while running and are **purged from the ring when the demo stops**. Handoff and the HUD ticker exclude demo rows. |
| D13 | Warmth (`data-warmth`) setting | **Cut from this push** (not in the mission's settings list). Stays in backlog. |

---

## 1. Stage 0 — seam edits (ONE seam agent, before any lane starts)

Stage 0 must end with all gates green (§10) — the tree compiles, clippy passes, tests pass,
sounds are silent no-ops, new modals open with placeholder bodies, new Rust commands return
`Err("not implemented …")`. Only then do the four lanes fork.

### S1 — `package.json`

Add and `npm install` (lockfile update is part of Stage 0):

```json
"dependencies": { "howler": "^2.2.4", ... }
"devDependencies": { "@types/howler": "^2.2.12", ... }
```

### S2 — `src/store/settings.ts` (NEW, **complete** in Stage 0 — not a stub)

```ts
// App-level settings — the single source both the Settings UI and sfx.ts consume.
// Persisted via Rust read_app_settings/write_app_settings (app_config_dir/settings.json).
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  version: 1;
  masterVolume: number;      // 0..1
  barnSounds: boolean;
  toolSounds: boolean;
  muted: boolean;
  calmMode: boolean;
  claudeBinaryPath: string;  // "" = auto-resolve via `where claude`
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  masterVolume: 0.6,
  barnSounds: true,
  toolSounds: true,
  muted: false,
  calmMode: false,
  claudeBinaryPath: "",
};

export interface SettingsState extends AppSettings {
  loaded: boolean;
  /** OS prefers-reduced-motion; force-enables calm's MOTION half only. */
  prefersReducedMotion: boolean;
  load: () => Promise<void>;
  setMasterVolume: (v: number) => void;
  setBarnSounds: (b: boolean) => void;
  setToolSounds: (b: boolean) => void;
  setMuted: (b: boolean) => void;
  setCalmMode: (b: boolean) => void;
  setClaudeBinaryPath: (p: string) => void;
}

/** Reduced motion is on when calm mode OR the OS asks for it. */
export function selectReducedMotion(s: SettingsState): boolean {
  return s.calmMode || s.prefersReducedMotion;
}
/** Sound is hard-off when muted OR calm (calm implies mute). */
export function selectSoundOff(s: SettingsState): boolean {
  return s.muted || s.calmMode;
}
```

Implementation requirements (Stage 0 writes the full body):
- `load()`: idempotent (module-level promise guard, same idiom as `events.ts` `initEventListener`).
  `invoke<string | null>("read_app_settings")` → JSON.parse, spread over `DEFAULT_SETTINGS`
  (unknown/missing fields tolerated), `set({...parsed, loaded: true})`. Parse failure → defaults.
  Also wires `window.matchMedia("(prefers-reduced-motion: reduce)")` → `prefersReducedMotion`
  (initial value + `change` listener).
- Every setter: `set(...)` then debounced (500 ms, module-level timer) persist:
  serialize exactly the `AppSettings` fields (stable key order as declared above, 2-space
  indent, trailing newline) → `invoke("write_app_settings", { content })`. Errors logged
  to console AND surfaced as `persistError: string | null` on the store (a failed write
  also means the claude override never reached Rust — SettingsModal renders it); never
  thrown. Exported `flushSettings()` fires a pending debounce immediately; App.tsx's
  beforeunload handler calls it alongside the graph flush so a change made within 500 ms
  of quitting is not lost.
- No component imports; no scene imports. Plain Zustand like the other stores.

### S3 — `src/scene/sfx.ts` (NEW — public API stub, no-op bodies, Lane A fills)

The **only** file in the repo that may `import { Howl, Howler } from "howler"` (stub does
not import it yet; Lane A adds the import when filling). Public API is **frozen**:

```ts
// The barn's voice. Only file importing howler. See PHASE56_CONTRACT §5.
import type { NodeRole } from "../store/graph";

export type SfxCue =
  | "kb_clack" | "drawer_slide" | "page_flip" | "paper_shuffle"
  | "ding" | "sniff" | "moo_happy" | "calf_spawn" | "calf_despawn"
  | "compile_ok" | "assemble_done" | "error_soft";

export type SfxGroup = "barn" | "tool" | "ambient";

/** Idempotent. Loads howls, subscribes to settings/graph/events stores,
 *  registers the visibilitychange suspend. Called once from App. */
export function initSfx(): void {}

/** Fire a one-shot. All gating (mute/calm/group gain/cooldowns/voice pool/
 *  ducking/pitch variance) lives INSIDE this function — call sites stay dumb. */
export function play(cue: SfxCue): void { void cue; }

/** Read-burst throttle, claimed at EVENT RECEIPT (SOUND_DESIGN §2b).
 *  Returns true if this read may sound on arrival. A false claim still
 *  walks/flashes — silently. */
export function claimReadCue(): boolean { return false; }

/** Cabinet=rules/persona → drawer_slide; bookshelf=architecture/reference/
 *  glossary → page_flip; crate=task/workflow → paper_shuffle. */
export function readCueForRole(role: NodeRole): SfxCue {
  return role === "rules" || role === "persona" ? "drawer_slide"
    : role === "task" || role === "workflow" ? "paper_shuffle"
    : "page_flip";
}

export function startTypewriter(): void {}
export function stopTypewriter(): void {}

/** Called every ticker frame with ms since the last BarnEvent.
 *  >5000 → ambient bed fades in (800 ms); <5000 → fades out (250 ms). */
export function tickAmbient(idleMs: number): void { void idleMs; }

export function setCalm(b: boolean): void { void b; }
export function setMuted(b: boolean): void { void b; }
export function setGroupGain(group: SfxGroup, gain: number): void { void group; void gain; }

/** BarnScene calls true on mount, false on unmount. While false, sfx.ts
 *  itself fires event-receipt cues (detached mode, §5.4). */
export function setSceneMounted(mounted: boolean): void { void mounted; }
```

(`void x;` keeps `noUnusedParameters` green in the stub.)

### S4 — `src-tauri/src/settings.rs` (NEW, **complete** in Stage 0) + `assemble.rs` seam

`settings.rs`:

```rust
// App-level settings persistence. Frontend owns the JSON shape; Rust stores bytes.
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("settings.json"))
        .map_err(|e| format!("app_config_dir: {e}"))
}

fn read_inner(app: &AppHandle) -> Result<Option<String>, String> {
    let p = settings_path(app)?;
    if !p.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&p)
        .map(Some)
        .map_err(|e| format!("{}: {e}", p.display()))
}

#[tauri::command]
pub fn read_app_settings(app: AppHandle) -> Result<Option<String>, String> {
    read_inner(&app)
}

#[tauri::command]
pub fn write_app_settings(app: AppHandle, content: String) -> Result<(), String> {
    let p = settings_path(&app)?;
    crate::project::write_atomic(&p, &content)?;
    apply_claude_override(&content);
    Ok(())
}

/// Parse claudeBinaryPath out of the settings JSON and hand it to assemble.rs.
/// Tolerant: bad JSON or missing field clears the override.
fn apply_claude_override(json: &str) {
    let path = serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("claudeBinaryPath")?.as_str().map(str::to_owned))
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .map(resolve_override); // bare name on Windows → `where` probe (deviation 2026-08-17)
    crate::assemble::set_claude_override(path);
}

/// Called once from lib.rs setup — applies a persisted override at startup.
pub fn init(app: &AppHandle) {
    if let Ok(Some(json)) = read_inner(app) {
        apply_claude_override(&json);
    }
}
```

`assemble.rs` additions (Stage 0, the ONLY parallel-phase-frozen edit to this file):

```rust
// near the top, after imports
static CLAUDE_OVERRIDE: std::sync::Mutex<Option<std::path::PathBuf>> =
    std::sync::Mutex::new(None);

/// Settings-provided absolute path to the claude binary. None = auto-resolve.
pub fn set_claude_override(p: Option<std::path::PathBuf>) {
    *CLAUDE_OVERRIDE.lock().unwrap() = p;
}

fn claude_override() -> Option<std::path::PathBuf> {
    CLAUDE_OVERRIDE.lock().unwrap().clone()
}
```

And inside `impl Runner for ClaudeRunner::run` (lines ~437–490), at the point where the
resolved binary is chosen: check `claude_override()` **first**; if `Some(p)`, spawn `p`
directly (skip the `OnceLock` cache and the `where` probe entirely — the user said so;
a bad path surfaces as the normal spawn error). All other spawn rules (stdin prompt,
CREATE_NO_WINDOW, concurrent stdin writer, `parse_claude_output`) unchanged. One new
test in `assemble/tests.rs`: `set_claude_override(Some(bogus))` → run fails mentioning
the bogus path; `set_claude_override(None)` restores auto-resolve (run serially or use
a lock — the static is process-global).

### S5 — `src-tauri/src/preset.rs` + `src-tauri/src/handoff.rs` (NEW — signature stubs, Lane D fills)

Exact stub pattern (compiles under `-D warnings`, keeps Tauri arg names intact — never
underscore-prefix a command arg, it changes the JS key):

```rust
// preset.rs (Stage 0 stub)
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub name: String,
    pub path: String,
    pub saved_at: String,
    pub node_count: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StubFile {
    pub rel_path: String,
    pub content: String,
}

#[tauri::command]
pub fn preset_save(app: AppHandle, name: String, preset_json: String) -> Result<String, String> {
    let _ = (&app, &name, &preset_json);
    Err("not implemented (Lane D)".to_string())
}

#[tauri::command]
pub fn preset_list(app: AppHandle) -> Result<Vec<PresetInfo>, String> {
    let _ = &app;
    Err("not implemented (Lane D)".to_string())
}

#[tauri::command]
pub fn preset_read(path: String) -> Result<String, String> {
    let _ = &path;
    Err("not implemented (Lane D)".to_string())
}

#[tauri::command]
pub fn preset_export(path: String, preset_json: String) -> Result<(), String> {
    let _ = (&path, &preset_json);
    Err("not implemented (Lane D)".to_string())
}

#[tauri::command]
pub fn preset_apply(
    root: String,
    graph_json: String,
    stubs: Vec<StubFile>,
) -> Result<Vec<String>, String> {
    let _ = (&root, &graph_json, &stubs);
    Err("not implemented (Lane D)".to_string())
}
```

```rust
// handoff.rs (Stage 0 stub)
use std::sync::Arc;
use serde::Serialize;
use tauri::State;

/// Handoff's own runner seam — same ClaudeRunner instance class as assemble,
/// injected in lib.rs setup; tests inject fakes.
pub struct HandoffRunner(pub Arc<dyn crate::assemble::Runner>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffResult {
    pub content: String,
    pub old_content: Option<String>,
}

#[tauri::command]
pub async fn handoff_generate(
    state: State<'_, HandoffRunner>,
    root: String,
    graph_json: String,
    events_json: String,
) -> Result<HandoffResult, String> {
    let _ = (&state, &root, &graph_json, &events_json);
    Err("not implemented (Lane D)".to_string())
}

#[tauri::command]
pub fn handoff_write(root: String, content: String) -> Result<String, String> {
    let _ = (&root, &content);
    Err("not implemented (Lane D)".to_string())
}
```

### S6 — `src-tauri/src/lib.rs` (full Stage-0 form, then FROZEN — no lane edits it)

```rust
mod assemble;
mod compile;
mod handoff;
mod hooks;
mod hooks_server;
mod preset;
mod project;
mod settings;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(assemble::AssembleQueue::new(Arc::new(
                assemble::ClaudeRunner::default(),
            )));
            app.manage(handoff::HandoffRunner(Arc::new(
                assemble::ClaudeRunner::default(),
            )));
            settings::init(app.handle());
            hooks_server::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            project::scan_project,
            project::read_graph,
            project::write_graph,
            project::read_md_file,
            project::write_md_file,
            compile::compile_preview,
            compile::compile_write,
            assemble::assemble_node,
            assemble::refine_node,
            assemble::summarize_node,
            assemble::assemble_status,
            assemble::assemble_cancel,
            hooks::hooks_preview,
            hooks::hooks_write,
            settings::read_app_settings,
            settings::write_app_settings,
            preset::preset_save,
            preset::preset_list,
            preset::preset_read,
            preset::preset_export,
            preset::preset_apply,
            handoff::handoff_generate,
            handoff::handoff_write
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Invoke-name contract is now **23 commands**; the fleet grep check must find all 23 names
byte-exact on both sides.

### S7 — `src-tauri/capabilities/default.json`

Add `"dialog:allow-save"` to the permissions array (preset export). Nothing else.

### S8 — `src/App.tsx` (all shared-shell edits, then FROZEN)

1. Extend the lucide import with `Settings, Package, Send`.
2. Skeleton modal imports (single lines):
   ```ts
   import { SettingsModal } from "./settings/SettingsModal";
   import { PresetsModal } from "./preset/PresetsModal";
   import { HandoffModal } from "./handoff/HandoffModal";
   import { useSettingsStore } from "./store/settings";
   import { initSfx } from "./scene/sfx";
   ```
3. In `App()`, next to `compileOpen`:
   ```ts
   const [settingsOpen, setSettingsOpen] = useState(false);
   const [presetsOpen, setPresetsOpen] = useState(false);
   const [handoffOpen, setHandoffOpen] = useState(false);
   ```
4. One-time init effect (next to the existing `initEventListener` effect):
   ```ts
   useEffect(() => {
     void useSettingsStore.getState().load().then(() => initSfx());
   }, []);
   ```
   (Both are idempotent, so StrictMode double-fire is safe.)
5. `TopBar` gains three props `onSettings`, `onPresets`, `onHandoff` and three buttons in
   the secondary-button idiom (exact class string copied from the existing Compile button),
   placed between Compile and "Open folder":
   - `Presets` — `<Package size={14} strokeWidth={1.5}/>`, rendered only when `root !== null`.
   - `Handoff` — `<Send size={14} strokeWidth={1.5}/>`, rendered only when `root !== null`,
     `disabled={nodeCount === 0}` title "The graph is empty".
   - Settings — icon-only 28 px square button, `<Settings size={14} strokeWidth={1.5}/>`,
     `aria-label="Settings"`, always rendered (app-global).
6. Modal mounts next to CompileModal:
   ```tsx
   {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
   {presetsOpen && root !== null && <PresetsModal root={root} onClose={() => setPresetsOpen(false)} />}
   {handoffOpen && root !== null && <HandoffModal root={root} onClose={() => setHandoffOpen(false)} />}
   ```

### S9 — Skeleton modal files (compile-clean placeholders)

Create with the shared modal skeleton (scrim + `role="dialog"` panel + 44 px header +
close ✕ + Escape handler — copy the shell of `HooksModal.tsx`, body = one
`<p className="p-4 text-sm text-content-secondary">TODO Lane {B|D}</p>`):

- `src/settings/SettingsModal.tsx` — `export function SettingsModal({ onClose }: { onClose: () => void })` → Lane B fills.
- `src/preset/PresetsModal.tsx` — `export function PresetsModal({ root, onClose }: { root: string; onClose: () => void })` → Lane D fills.
- `src/handoff/HandoffModal.tsx` — `export function HandoffModal({ root, onClose }: { root: string; onClose: () => void })` → Lane D fills.

### S10 — Scene sound call sites (`mapper.ts`, `cow.ts`, `BarnScene.tsx`) — inserted against the stub

`src/scene/cow.ts` — extend `CowTask`:

```ts
export interface CowTask {
  // Deviation 2026-08-17: optional — omitted = wherever the cow is when the
  // task STARTS (in-place reactions; a tile snapshotted at enqueue goes stale).
  target?: Tile;
  bubbleOnStart?: string;
  bubbleOnArrive?: string;
  onStart?: () => void;      // fires when the task is picked up (Stage 0)
  onArrive?: () => void;
  busyMs?: number;
  onBusyEnd?: () => void;    // busy loop ran to completion (natural end only)
  onBusyCancel?: () => void; // busy loop cut short by interrupt()
}
```

- `startTask`: after showing `bubbleOnStart`, call `task.onStart?.();`.
- Busy-end branch (`busyLeft <= 0` → `setBob(0)`): call `this.current.onBusyEnd?.()`
  immediately before `this.current = null`.
- `interrupt()`: before clearing state, `if (this.busyLeft > 0) this.current?.onBusyCancel?.();`.

`src/scene/mapper.ts` — `import * as sfx from "./sfx";` and per arm:

- `prompt`: first statement of the arm → `sfx.play("kb_clack");`
- `read` (resolved): at event receipt `const sound = sfx.claimReadCue();` then in the
  task's `onArrive` closure, alongside `layout.flashProp(...)`:
  `if (sound) sfx.play(sfx.readCueForRole(prop.role));`
  Unresolved read stays silent (early return untouched).
- `edit`/`write`: task gets
  `onArrive: () => { sfx.startTypewriter(); }`,
  `onBusyEnd: () => { sfx.stopTypewriter(); sfx.play("ding"); }`,
  `onBusyCancel: () => { sfx.stopTypewriter(); }`.
- `grep`/`glob`: zero-prop in-place branch → `sfx.play("sniff");` at receipt.
  Two-hop branch: first task gets `onStart: () => sfx.play("sniff")`; second hop silent.
- `stop`: interrupt task gets `onArrive: () => sfx.play("moo_happy")` (fires with the "✓"
  bubble; never fires if a later event discards the task — exactly the spec's drop rule).

`src/scene/BarnScene.tsx`:

- `import * as sfx from "./sfx";`
- After successful init: `sfx.setSceneMounted(true);` and push
  `cleanups.push(() => sfx.setSceneMounted(false));`.
- Idle clock: `let lastEventTs = performance.now();` beside the `push` closure; the push
  closure sets `lastEventTs = performance.now();` before `handleEvent`. Ticker callback
  adds `sfx.tickAmbient(performance.now() - lastEventTs);`.
  (Lane C reuses `lastEventTs` for waiting-choreography and idle FPS; it may restructure
  but the `tickAmbient` call with true ms-since-last-event must survive.)

### S11 — Tool-cue call sites (`src/compile/CompileModal.tsx`) — then FROZEN

`import { play as sfxPlay } from "../scene/sfx";` and three one-liners:

1. In `doWrite`'s `.then` success branch, at `setPhase("done")` → `sfxPlay("compile_ok");`
2. In the preview-load effect where `setPhase(p.errors.length > 0 ? "errors" : "preview")`
   is decided: when errors > 0 → `sfxPlay("error_soft");`
3. In `doWrite`'s failure path (`setPhase("failed")`) → `sfxPlay("error_soft");`

(`error_soft`'s 10 s cooldown lives inside sfx.ts, so repeated previews can't spam.)

### S12 — `src/store/events.ts` demo-tag shape (then owned by Lane C)

```ts
export interface LogEvent extends BarnEvent {
  /** Present and true only for demo-player events. Absent on live events. */
  demo?: true;
}
```

- `events: LogEvent[]`; `pushEvent: (e: BarnEvent, opts?: { demo?: boolean }) => void` —
  stores `opts?.demo ? { ...e, demo: true } : e`. The `BarnEvent` wire shape itself is
  unchanged (frozen by the Phase 3+4 contract); `demo` exists only in the store.
- In `BarnScene.tsx`, the DemoPlayer wiring's push callback becomes
  `(e) => useEventsStore.getState().pushEvent(e, { demo: true })`.

Stage 0 exit criteria: `npm run build` green, `cargo clippy --all-targets -- -D warnings`
green, `cargo test` green (61 = 60 + override test), app runs, all three new buttons open
placeholder modals, invoke grep = 23/23. Commit as `Stage 0: Phase 5/6 seams`.

---

## 2. File ownership grid

A lane may create/edit ONLY the files on its row. Everything else is read-only to it.
"FROZEN" files are owned by nobody after Stage 0 — touching one requires a Deviation (§12).

| Lane | May create/edit | Explicitly forbidden highlights |
|---|---|---|
| **A — Sound** | `src/scene/sfx.ts` (fill body); `assets/sfx/*` (delete the 14 stale wavs only — canonical wavs and `cues.json` untouched) | `mapper.ts`, `cow.ts`, `BarnScene.tsx`, `CompileModal.tsx` (call sites are already in), any store file |
| **B — Settings UI** | `src/settings/**` (SettingsModal.tsx + any private helper components in that dir) | `src/store/settings.ts` (shape frozen), `App.tsx`, `src-tauri/**`, tokens/tailwind config |
| **C — Juice** | `src/scene/**` **except `sfx.ts`**; `src/store/events.ts`; `src/inspector/EventLog.tsx` | `sfx.ts`; removing/moving any Stage-0 `sfx.*` call away from its semantic moment; `src/store/graph.ts`; `App.tsx` |
| **D — Phase 6** | `src-tauri/src/preset.rs` + `src-tauri/src/preset/tests.rs`; `src-tauri/src/handoff.rs` + `src-tauri/src/handoff/tests.rs`; `src/preset/**`; `src/handoff/**` | `lib.rs` (all names pre-registered), `assemble.rs`, `compile.rs`, `project.rs` (use its `pub(crate)` helpers), `App.tsx` |
| FROZEN after Stage 0 | `src/App.tsx`, `src-tauri/src/lib.rs`, `src-tauri/src/settings.rs`, `src-tauri/src/assemble.rs`, `src/store/settings.ts`, `src/compile/CompileModal.tsx`, `package.json`, `capabilities/default.json`, `tauri.conf.json`, `tailwind.config.js`, `src/styles/**` | |

No two lanes share a writable file. Lane C is the sole writer of `mapper.ts`/`cow.ts`/
`BarnScene.tsx`; Lane A's contact surface with the scene is exactly the `sfx.ts` module
boundary. Docs: each lane may add its manual-test file under `docs/testing/` (named
`PHASE5_SOUND_TEST_MANUAL.md`, `SETTINGS_TEST_MANUAL.md`, `PHASE5_JUICE_TEST_MANUAL.md`,
`PHASE6_TEST_MANUAL.md`) — no other docs, nothing outside `docs/`.

---

## 3. Rust command contract (the invoke-name table, 9 new)

Args listed in JS camelCase; Rust params are the snake_case mirrors. All return
`Result<T, String>`; `Err` = infrastructure failure only, domain outcomes ride the Ok payload.

| invoke name | args (JS) | Ok payload (JS shape) | Notes |
|---|---|---|---|
| `read_app_settings` | — | `string \| null` | null = no settings file yet |
| `write_app_settings` | `{ content: string }` | `null` | atomic write; applies claude override |
| `preset_save` | `{ name: string, presetJson: string }` | `string` (absolute path written) | slug = lowercase, `[a-z0-9-]`, spaces→`-`; empty slug → Err; overwrites same-name preset silently (presets are app-local, not a trust boundary) |
| `preset_list` | — | `PresetInfo[]` = `{ name, path, savedAt, nodeCount }[]` | empty dir / missing dir → `[]`; unreadable/invalid preset files skipped |
| `preset_read` | `{ path: string }` | `string` (preset JSON) | absolute path from an OS open-dialog; validates parse + `kind === "cowtext-preset"` + `version === 1` → Err on mismatch |
| `preset_export` | `{ path: string, presetJson: string }` | `null` | absolute path from OS save-dialog; appends `.cowtext-preset.json` if the name lacks it, but Errs instead of silently overwriting an existing file at the APPENDED path (the dialog's overwrite prompt covered only the literal typed name); the frontend passes a `filters` entry so the dialog usually appends the extension itself |
| `preset_apply` | `{ root, graphJson, stubs: {relPath, content}[] }` | `string[]` (written rel paths, forward slashes) | Err if `<root>/.cowtext/graph.json` exists with a non-empty (or unparseable) `nodes` array ("project already has a graph"); a graph.json with `nodes: []` is tolerated and overwritten — it matches the UI's `loaded && nodes.length === 0` Apply gate. Each stub relPath through `resolve_within_root`, must end `.md` (case-insensitive); **existing files are skipped, not overwritten** (never-clobber, atomic via `create_new`) and excluded from the return list. Stubs written first, `graph.json` last. |
| `handoff_generate` | `{ root, graphJson, eventsJson }` | `{ content, oldContent: string \| null }` | async; `State<HandoffRunner>`; content starts with the GENERATED header; oldContent = current `HANDOFF.md` if present |
| `handoff_write` | `{ root, content }` | `string` (`"HANDOFF.md"`) | allowlist EXACTLY root-level `HANDOFF.md`; requires the GENERATED header within the first 10 trimmed lines; `write_atomic` |

Frontend mirrors: `src/preset/api.ts` and `src/handoff/api.ts` (invoke wrappers only),
`src/preset/types.ts` / `src/handoff/types.ts` (struct mirrors) — the `src/compile/` idiom.
Settings has no api.ts; its two invokes live inside `src/store/settings.ts` (Stage 0).

---

## 4. Settings schema & persisted shape

TS type: `AppSettings` in §1-S2 (that block is normative). Persisted `settings.json`:

```json
{
  "version": 1,
  "masterVolume": 0.6,
  "barnSounds": true,
  "toolSounds": true,
  "muted": false,
  "calmMode": false,
  "claudeBinaryPath": ""
}
```

Defaults exactly as above. Forward compat: readers spread unknown JSON over
`DEFAULT_SETTINGS` and ignore extra keys; any future field addition bumps nothing
(version stays 1 until a breaking shape change). `prefersReducedMotion`, hooks port, and
context dir are **not persisted** — the first is an OS live query, the other two are
display-only constants/derived.

---

## 5. Lane A — Sound (fill `src/scene/sfx.ts`)

### 5.1 Loading

- `import { Howl, Howler } from "howler";` — nowhere else in the repo, ever.
- 14 Vite asset imports: `import kbClackUrl from "../../assets/sfx/kb_clack.wav?url";` etc.
  (`vite/client` types cover `.wav`; files live inside the Vite root so they bundle and
  fingerprint in production builds). Never base64, never `new Audio`.
- 12 one-shot `Howl`s (`preload: true`) + `typewriter` (`loop: true`) + `ambient_loop`
  (`loop: true`). Durations/loop flags conceptually come from `assets/sfx/cues.json`;
  since howls are per-file, no offsets are needed — do NOT hand-copy numbers from the
  manifest into code.
- `initSfx()` idempotent (module flag). Inside: build howls, `Howler.volume(masterVolume)`,
  subscribe to `useSettingsStore` (volume/group/mute/calm), subscribe to `useGraphStore`
  (assemble_done / error_soft, §5.5), wire detached mode (§5.4), register
  `document.visibilitychange` → hidden: hard-stop everything ≤50 ms and suppress `play()`;
  visible: lift suppression (loops do NOT auto-resume; the next tick/event restarts them).

### 5.2 Gain model

- Master: `Howler.volume(masterVolume)` live from the settings store.
- Group gains (multiplied into every play/loop volume): `barn`, `tool`, `ambient`.
  Settings wiring: `barn = barnSounds ? 1 : 0`; `tool = toolSounds ? 1 : 0`;
  `ambient = barnSounds ? 1 : 0` (ambient rides the Barn switch — no third toggle).
  `setGroupGain` sets the runtime multiplier directly (the store subscription calls it).
- Tier loudness is baked into the WAV masters (§3 of SOUND_DESIGN) — per-cue base volume
  is 1.0; do not re-balance in code.
- Cue → group: all barn cues → `barn`; `compile_ok`/`assemble_done`/`error_soft` → `tool`;
  `ambient_loop` → `ambient`. Typewriter → `barn`.

### 5.3 `play()` internals (single gate, no per-cue logic at call sites)

Order of checks inside `play(cue)`:
1. `isCalmOrMuted()` (settings: `muted || calmMode`) or window-hidden or group gain 0 → drop.
2. Per-cue cooldowns: `sniff` 1000 ms, `ding` 2000 ms, `error_soft` 10 000 ms,
   `moo_happy` 2000 ms, `kb_clack` 250 ms. Cooled-down calls are **dropped, never queued**
   (SOUND_DESIGN §3: late sound is wrong sound).
3. Voice pool: max 3 concurrent one-shots (track howler play ids); a 4th steals (stops)
   the oldest.
4. Pitch variance (J4): `rate(0.95 + Math.random() * 0.1)` on every one-shot; never on loops.
5. Ducking:
   - `moo_happy` → all other currently-sounding cues duck −12 dB (×0.25) for the moo's
     duration, restore after.
   - Ambient bed → −6 dB (×0.5) while any one-shot or typewriter plays; recovers over 400 ms.
   - Nothing ducks the tool confirms.
6. Read-burst throttle (used by `claimReadCue()`, claimed at event receipt): at most one
   read cue per 150 ms; if ≥4 read claims land inside 500 ms, play a single
   `paper_shuffle` for the burst and return false for further claims until 500 ms pass
   with no claim. Visuals still enumerate; sound summarizes.
7. `typewriter`: `startTypewriter()` no-ops if already running; auto-fade after 3 s
   continuous (fade out ≤200 ms; animation continues). `stopTypewriter()` hard-stops ≤50 ms.
8. `tickAmbient(idleMs)`: `idleMs > 5000` and no one-shot currently sounding → fade bed in
   over 800 ms; `idleMs < 5000` → fade out over 250 ms (covers "bed dies on any event",
   since the idle clock resets to 0 at event receipt).

### 5.4 Detached mode (barn cues in Canvas view — decision D5)

While `sceneMounted === false`, an internal `useEventsStore.subscribe` fires cues at
**event receipt** from the newest appended event:

| kind | cue |
|---|---|
| `prompt` | `kb_clack` |
| `read` | `claimReadCue()` then `readCueForRole(role)` — role via `resolveNodeId(filePath)` + `useGraphStore` lookup; unresolved → silent |
| `grep` / `glob` | `sniff` |
| `edit` / `write` | `ding` (2 s cooldown; the typewriter loop never plays detached — "animation not visible" rule). Contract deviation from the ding's "typewriter ran first" clause is deliberate: in Canvas view the referent animation doesn't exist and the write still deserves its confirm. |
| `stop` | `moo_happy` |
| `subagent_stop` / `other` | silent |

While `sceneMounted === true` this subscription is inert (one boolean check) — the
mapper/task callbacks are the only trigger path. No cue can double-fire.

### 5.5 Tool cues (store-level detection inside `initSfx`)

`compile_ok` / `error_soft` call sites already exist in CompileModal (Stage 0). Inside
sfx.ts add the two store-derived detections:

```ts
// assemble_done: queue drained after being busy, with at least one success
// FROM THIS BATCH. Statuses persist for the session, so the 'assembled'
// count is baselined at the busy rising edge; chime only if it grew.
// (Deviation 2026-08-17: the earlier any-'assembled' check chimed on a
// stale success when a later batch failed entirely.)
let wasBusy = false;
let assembledBaseline = 0;
useGraphStore.subscribe((s) => {
  const sts = Object.values(s.assembleStatus);
  const busy = sts.some((x) => x === "queued" || x === "running");
  const assembled = sts.filter((x) => x === "assembled").length;
  if (!wasBusy && busy) assembledBaseline = assembled;
  if (wasBusy && !busy && assembled > assembledBaseline) play("assemble_done");
  wasBusy = busy;
});

// error_soft: assemble error count transitions 0 -> n (never n -> n+1).
let prevErr = 0;
useGraphStore.subscribe((s) => {
  const errs = Object.values(s.assembleStatus).filter((x) => x === "error").length;
  if (prevErr === 0 && errs > 0) play("error_soft");
  prevErr = errs;
});
```

(Two subscriptions may be merged into one; semantics above are what's frozen. The 10 s
`error_soft` cooldown still applies on top.)

### 5.6 Calm/mute wiring

`setCalm`/`setMuted` remain public (scene/tests may call them), but the source of truth is
the settings-store subscription: on `muted || calmMode` becoming true, hard-stop all sound
≤50 ms (`Howler.stop()` acceptable) and gate future plays. Calm's motion half is Lane C's
job — sfx.ts handles sound only.

### 5.7 Asset cleanup (Lane A owns this)

`git rm` exactly: `assets/sfx/barn_ambient.wav barn_calf_bye.wav barn_calf_hello.wav
barn_ding.wav barn_drawer.wav barn_moo.wav barn_page.wav barn_sniff.wav barn_step.wav
barn_typewriter.wav ui_prompt.wav ui_compile_done.wav ui_assemble_done.wav ui_error.wav`.
Do not touch the 14 canonical wavs or `cues.json`; do not edit `scripts/gen_sfx.py`.

### 5.8 Not wired (documented in a comment at the top of sfx.ts)

`calf_spawn` / `calf_despawn` load with the rest but have no call site (D9). Footsteps,
bubbles, camera, view/demo toggles, queue drops: deliberately silent — add no cues.

---

## 6. Lane B — Settings window (`src/settings/SettingsModal.tsx`)

Follow the CompileModal/HooksModal skeleton exactly (scrim → `w-[560px]` panel is allowed
for this smaller dialog; `max-w-[92vw]`, `rounded-xl border border-border bg-surface-1
shadow-modal`; 44 px header "Settings", ✕; Escape closes; focus pulled into panel).
No charm in chrome: no cow, no pixel font, no textures. All values read/write
`useSettingsStore` — persistence is automatic (debounced in the store); there is no
Save button.

Body, three sections (section label: `text-2xs uppercase tracking-wide text-content-muted`,
rows 28 px, label left `text-sm text-content`, control right):

**Sound**
1. Master volume — custom-styled `<input type="range" min={0} max={100} step={5}>`
   (native styling is light-scheme; use `appearance-none`, track `h-[4px] rounded-sm
   bg-surface-inset`, thumb 12 px square `bg-accent` via `[&::-webkit-slider-thumb]`
   arbitrary variants), mono `%` readout right. Maps to `masterVolume` (0–1).
   Disabled (dimmed) while Mute or Calm is on.
2. Barn sounds — toggle (copy the 34×19 pill idiom from `Inspector.tsx`'s `Toggle` into a
   local component; do not import across lanes). → `barnSounds`.
3. Tool sounds — toggle → `toolSounds`. Helper line under it, `text-2xs text-content-muted`:
   "Compile, assemble and problem chimes."
4. Mute — toggle → `muted`. While Calm mode is on: checked, `disabled`, title
   "Calm mode implies mute".
5. Calm mode — toggle → `calmMode`. Helper line: "No sound and reduced motion. The barn
   keeps working, quietly." When `prefersReducedMotion` is true and calm is off, show
   `text-2xs text-content-muted`: "Your OS requests reduced motion — animations are
   already reduced."

**Agent**
6. `claude` binary — 28 px text input (surface-2, border, mono), value `claudeBinaryPath`,
   placeholder `auto-detect (where claude)`, committed per keystroke via
   `setClaudeBinaryPath(value.trim())` (the store's persist debounce absorbs the churn;
   a blur-only commit dropped the draft on Esc/scrim/Done, which unmount without firing
   blur). Helper: "Used by Assemble and Handoff. Leave empty to auto-detect."
7. Hooks server — read-only mono row: `127.0.0.1:4923` (local constant in the file).

**Context**
8. Context data — read-only mono row: when a project is open
   (`useProjectStore(s => s.root)`), show `<root>\.cowtext\graph.json` (rtl-truncated,
   `title` = full path); else "No project open" in `text-content-muted`.

Footer (50 px): left consequence text `text-sm text-content-secondary` "Settings apply
immediately and persist on this machine."; right a single secondary "Done" button →
`onClose`. No primary/accent button — nothing to confirm.

---

## 7. Lane C — Juice (scene), backlog debt, HUD

All work bounded by the barn hard rules: ≤4 frames/loop, holds 90–180 ms, every reaction
≤1.5 s and interruptible, particles from ONE pool capped at 8, no screen shake, Barnlight-29
palette only, no base64 assets, scene imports only `pixi.js`, `./`-local modules, and the
two sanctioned stores (+ `src/store/settings.ts`, now sanctioned read-only for the scene).
Preserve every Stage-0 `sfx.*` call at its semantic moment.

### 7.1 Reduced motion (build FIRST — everything below gates on it)

- Module-level accessor in the scene (e.g. `src/scene/motion.ts`, Lane C-owned):
  subscribes `useSettingsStore` with `selectReducedMotion`; exports `reducedMotion(): boolean`.
- Gates when true: no trot/busy bob (`setBob(0)` clamped), no scarf flutter, no
  anticipation crouch, no dust/particles, no stop-walk hop, prop flash renders frame 0
  (keep `flashMs` countdown running so state stays truthful), waiting choreography reduced
  to coffee-cup + static resting pose (no steam loop, no Z-motes, no micro-fidgets).
- Walks/teleports: cow **keeps walking** (mapper stays truthful; log/pulse unaffected).
  Bubbles appear/expire without any added squash frames.

### 7.2 Tier-1 juice (JUICE.md §4, storyboards §5)

- **J1 scarf flutter**: split the scarf rects out of the flattened cow `Graphics` in
  `makeCow` into an addressable child; add `CowSprite.setFlutter(frame: 0 | 1)`; toggle
  each walk step alongside the existing 90 ms `walkPhase` trot bob; settle to frame 0 one
  step after stopping.
- **J2 anticipation**: 80 ms crouch before the FIRST step of each walk (not per step):
  `anticipationLeft` countdown in `Cow.startTask`; visual = 1 px down-bob. Total walk time
  stays inside the 1.5 s clamp (crouch counts against it).
- **J3 eyes-glance**: split the eye pixel into an addressable child;
  `CowSprite.setGlance(dir: -1 | 0 | 1)`; on `enqueue`, glance toward the newest task's
  target (sign of `tileToScreen(target).x − cow.x`); reset to 0 on arrival.
- **J5 session accumulation** (Deviation 2026-08-17: accumulation moved to EVENT RECEIPT —
  the remount replay derives from the event ring, which stores no completion data, so the
  live path must accumulate at receipt or toggling views changes the scene; JUICE.md's
  log-derived rule is authoritative. Sounds stay at their semantic moments per
  SOUND_DESIGN's no-fake-completion rule):
  - Paper stack: `layout.addPaper()` — stack sprite at the side desk grows one 2 px step
    per write EVENT, called at event receipt in mapper.ts's edit/write arm (the ding still
    fires only from `onBusyEnd`). Cap 8 steps, then a second pile starts; second pile caps
    at 8 and stays (no third).
  - Ajar props: add `opened` state to `PropEntry` + a redraw path per prop kind — cabinet
    drawer slides 2 px open, bookshelf book stays popped 2 px, crate paper stays lifted.
    Set at event receipt in the read arm (resolved reads only; `flashProp` and the read
    cue stay in `onArrive`). Session-scoped; `rebuildProps` resets it (accepted).
- **J6 stop choreography (E6)**: the stop task's walk is the bounciest — +1 px hop per
  stride (extend `CowTask` with `bouncy?: boolean`, set only by the stop arm), 1-frame
  arrival squash (`setBob` squash), then the "✓" bubble (moo fires from the existing
  Stage-0 `onArrive`).
- **J7 dust + landing squash**: one pooled particle layer (hard cap 8, pre-allocated,
  oldest reused) living in a non-sorted overlay container in `layout.world`; aging driven
  from `layout.tick`. Spawn a 2 px checker-dither puff (use the `makeShadow` dither idiom,
  ≤3 frames, ~240 ms) on step landing via a new `Cow` hook `onStep?: (tile: Tile) => void`
  (constructor arg or public field, wired in BarnScene). Landing squash = 1 frame on final
  step.
- **J8 calves**: skipped (D9). Leave `subagent_stop` as a no-op.

### 7.3 Waiting > 5 s choreography (E5 / A6)

Drive from the Stage-0 `lastEventTs` idle clock in the BarnScene ticker; pose state lives
on `Cow` as an `idlePose` that any task pickup instantly clears (idle never enqueues tasks,
so it can never block or delay real events):

| idle | scene |
|---|---|
| 5 s | coffee cup + 2-frame steam curl loop (8 s period) appears at the dev desk (new child of the desk prop, palette colors); cow walks home (`COW_HOME_TILE`) if not there, 2-frame chew loop (1.2 s period) |
| 30 s | cow lies down — 1-frame settle pose |
| 5 min | eyes-closed frame + one drifting Z-mote every 8 s from the particle pool |
| any event | wake: 2 px hop (the one allowed exaggeration), scarf settles, straight into the event's animation; coffee cup fades/removes |

Ambient bed pairs automatically (Lane A's `tickAmbient` reads the same clock).

### 7.4 Pause-when-hidden + idle FPS throttle (BACKLOG)

- `document.visibilitychange` listener in the BarnScene effect (cleanups array):
  hidden → `app.ticker.stop()`; visible → `app.ticker.start()`. (sfx has its own listener;
  no coordination needed.)
- `app.ticker.maxFPS = 60` at init; when `idleMs > 10_000` set `maxFPS = 12`; restore 60
  in the push closure. All idle-loop holds are ≥120 ms so 12 fps loses nothing.

### 7.5 Demo-event filtering (BACKLOG) — `src/store/events.ts` + `EventLog.tsx`

- `setDemoMode(false)` additionally purges: `events: st.events.filter((e) => !e.demo)`.
- EventLog rows with `e.demo` render a `DEMO` chip (mono 9 px, 16 px tall, amber border +
  amber text, `rounded-sm`) after the kind tag.
- `lastLiveTs` / node pulse: demo events still pulse (unchanged — the demo exists to show
  the pipeline off).

### 7.6 Barn HUD restyle + session ticker (BACKLOG + DESIGN_SPEC Phase-5 row)

- Replace the inline-styled Demo/Stop-demo overlay buttons with token classes (the
  secondary-button idiom: `rounded border border-border bg-surface-2 px-3 text-sm
  text-content hover:bg-surface-3` — the overlay is DOM, Tailwind works).
- Session ticker, bottom-left overlay: `font-pixel text-2xs text-[var(--amber)]`,
  content `R {reads} · W {writes} · ✓ {turns}` counting non-demo events in the ring
  (`read` / `edit`+`write` / `stop`), via `useEventsStore` selector in the overlay React
  layer (not per-frame). Amber is the agent's color — correct here; Silkscreen is
  sanctioned in the barn HUD.

### 7.7 Camera

Pan/zoom already exist. Verify against the manual; add: re-center on host resize
(`centerCamera()` on a `ResizeObserver` or Pixi resize event, only when the user hasn't
panned yet — track a `userMoved` flag). No inertia, no keyboard, no further work.

---

## 8. Lane D — Phase 6: Presets & Handoff

### 8.1 Preset file format (frozen)

`.cowtext-preset.json` — structure + briefs, **never node content**, never `lastVerified`:

```json
{
  "version": 1,
  "kind": "cowtext-preset",
  "name": "Cedar default",
  "savedAt": "2026-08-17T12:00:00Z",
  "nodes": [
    { "id": "…", "title": "…", "role": "rules", "brief": "…", "filePath": "context/x.md",
      "readOrder": 1, "pinned": false, "position": { "x": 0, "y": 0 },
      "scenePos": { "tx": 3, "ty": 4 } }
  ],
  "edges": [
    { "id": "…", "source": "…", "target": "…", "kind": "imports", "condition": "…", "note": "…" }
  ],
  "compileTargets": ["claude"]
}
```

(`scenePos`/`condition`/`note` optional, omitted when absent — same stable-serialization
style as `serializeGraph`.) Frontend builds it (`src/preset/types.ts` exports
`buildPreset(name: string): string` reading `useGraphStore.getState()`); Rust validates
minimally on `preset_save`/`preset_read` (parse, `kind`, `version`, `nodes` is an array)
and re-serializes **nothing** — it stores the frontend's bytes (graph-serialization
ownership rule).

### 8.2 `preset.rs` implementation notes

- Presets dir: `app.path().app_config_dir()?.join("presets")`; `write_atomic` creates it.
- `preset_save`: slugify name; write bytes; return absolute path string.
- `preset_list`: read dir (missing → `Ok(vec![])`), parse each `*.cowtext-preset.json`,
  skip unparseable, map to `PresetInfo { name, path, saved_at, node_count }`.
- `preset_apply` (per §3): graph guard FIRST (`graph.json` absent OR parses with
  `nodes: []`); then stubs (skip existing via `fs::File::create_new` — check-and-claim
  in one syscall, no TOCTOU), then graph.json — so a mid-way failure leaves no usable
  graph.json and the apply is retryable.
- Tests (`preset/tests.rs`, ≥6): slugify; save/list round-trip; invalid-kind rejection;
  apply refuses existing graph.json; apply skips existing stub and reports only written
  paths; apply path-traversal stub (`../x.md`) → Err.

### 8.3 Handoff generation

`handoff_generate` builds the prompt in Rust (Vec<String> + join, the `build_prompt`
style):

- Inputs: tolerant `GraphIn` deserialization of `graph_json` (own
  `#[serde(rename_all = "camelCase", default)]` subset — copy the compile.rs pattern:
  nodes with title/role/brief/filePath/readOrder/pinned, edges with source/target/kind);
  `events_json` = JSON array `{ kind, filePath?, ts }` (≤100 entries, newest last —
  the frontend has already filtered demo events).
- Prompt skeleton (exact section names are frozen; wording inside is Lane D's):
  system framing "You are writing a project handoff document." + graph summary (nodes
  with roles/briefs in readOrder, edge list) + recent-activity digest (event kinds +
  file paths, timestamps humanized) + instruction to output ONLY markdown with exactly
  these four `##` sections: `## Current state`, `## Decisions made`,
  `## Open threads`, `## Next actions`.
- Run through `state.0.run(prompt).await?` (prompt over stdin — the Runner handles the
  Windows spawn rules). Prepend `crate::compile::GENERATED_HEADER` + `"\n\n# HANDOFF\n\n"`
  to the model output; read existing `HANDOFF.md` for `old_content`.
- `handoff_write`: own 5-line header check (first 10 trimmed lines contain the header —
  do not reach into compile.rs private fns), allowlist exactly `HANDOFF.md`,
  `resolve_within_root` + `write_atomic`.
- Tests (`handoff/tests.rs`, ≥4, fake Runner like assemble's `EchoRunner`): prompt
  contains node titles + event kinds; generate output starts with GENERATED header;
  write rejects wrong rel path; write rejects missing header.

### 8.4 `PresetsModal.tsx` (UI — modal skeleton per DESIGN_SPEC)

Phases: `list` → (`saving` | `applying` | `confirm-apply`) → `done`/`failed`.

- **List**: rows (28 px) from `preset_list` — name, mono `nodeCount` badge, savedAt date.
  Row actions (icon buttons): Export (opens `save({ defaultPath: name + ".cowtext-preset.json" })`
  from `@tauri-apps/plugin-dialog`, then `preset_export`), Apply.
- **Save current graph as preset**: name input + secondary button (disabled when graph
  empty); `buildPreset(name)` → `preset_save` → refresh list.
- **Import**: `open({ filters: [{ name: "Cowtext preset", extensions: ["json"] }] })` →
  `preset_read(path)` → `preset_save(nameFromFile, json)` → refresh list.
- **Apply** ("New project from preset"): only enabled when a project is open AND the
  current graph is empty (`useGraphStore`: `loaded && nodes.length === 0`) — otherwise the
  row action is disabled with title "Open an empty project first". Confirm screen (this is
  a write into the user's project → confirmation is mandatory): list every file to be
  created — `.cowtext/graph.json` + one `context/*.md` stub per node (stub content is
  exactly the Inspector idiom: `# ${title}\n\n`) — with existing files struck "will be
  skipped". Footer consequence text: "Creates N files in <root>. Existing files are never
  overwritten." Confirm → frontend materializes `BarnGraph` (`version: 1`, projectName
  from root basename, preset nodes/edges/compileTargets) → `serializeGraph` →
  `preset_apply` → on success `useGraphStore.getState().loadGraph(root)` +
  `useProjectStore.getState().rescan()` → done screen lists written paths.

### 8.5 `HandoffModal.tsx`

Phases: `idle` → `generating` → `diff` → `written`/`failed`.

- `idle`: explanation line + primary "Generate handoff". Consequence text: "Runs
  `claude -p` with your graph and recent activity."
- `generating`: PixelMarch (amber 4-dot, never a spinner) + "Generating…". Closing the
  modal abandons the wait (no cancel command — the child finishes and is discarded;
  document in a comment).
- Events payload: `useEventsStore.getState().events.filter((e) => !e.demo).slice(-100)`
  mapped to `{ kind, filePath, ts }`.
- `diff`: old vs new in `surface-inset` wells (reuse CompileModal's diff presentation
  idiom — side-by-side not required; stacked old/new with `unchanged` note is fine).
  Footer: Cancel + primary "Write HANDOFF.md" → `handoff_write`. Trust boundary: no
  write without this approval, ever.
- Copy buttons (enabled from `diff` onward, one row, secondary style):
  - **Copy for Claude Chat** → clipboard: `"Here is the current project handoff. Read it, then continue from “Next actions”.\n\n"` + content.
  - **Copy for Claude Code** → `"Read this handoff, then explore the repo before acting. The graph-compiled CLAUDE.md is the standing context; this handoff is the session state.\n\n"` + content.
  - **Copy for Claude Design** → `"Here is the project handoff. Focus on the design-relevant threads under “Open threads” and “Next actions”.\n\n"` + content.
  - Mechanism: `navigator.clipboard.writeText` (WebView2 supports it); on rejection, show
    the content in a selectable read-only `<textarea>` with "Copy failed — select and copy
    manually". No clipboard plugin (would be a new dependency).
  - Button flashes "Copied" (text swap, `--dur-base`) — no toast, no sound (routine UI).

---

## 9. Event/store detection reference (normative sketches)

- **Assemble queue drained** and **problems 0→n**: §5.5 code blocks (live inside sfx.ts).
- **Idle clock**: `lastEventTs` in BarnScene (§1-S10); reset in the push closure; consumed
  by `sfx.tickAmbient`, waiting choreography (§7.3), FPS throttle (§7.4).
- **Reduced motion**: `useSettingsStore.subscribe` + `selectReducedMotion` (§7.1).
- **Scene mounted**: `sfx.setSceneMounted` from BarnScene mount/cleanup (§1-S10);
  detached-mode table in §5.4.
- **Demo tagging**: `pushEvent(e, { demo: true })` from the DemoPlayer wiring only;
  everything else pushes untagged (§1-S12).

---

## 10. Gates (every lane, before hand-back)

1. `npm run build` — tsc strict, `noUnusedLocals`/`noUnusedParameters`, then vite build.
2. `cargo clippy --all-targets -- -D warnings` (from `src-tauri/`).
3. `cargo test` — all existing tests stay green; Lane D adds ≥10 (§8.2, §8.3); Stage 0
   adds 1 (override).
4. Invoke-name contract: all **23** command names byte-identical between
   `generate_handler![]` and TS `invoke(...)` call sites.
5. No new dependencies beyond `howler` + `@types/howler` (Stage 0). No new Tauri plugins.
6. Generated files: `HANDOFF.md` carries the GENERATED header, line 1. Preset stubs are
   user content (no header — they're the user's files, same as Assemble output).
7. Sprites/SFX are assets — zero base64/binary blobs in any source file; `howler` imported
   in `sfx.ts` only (grep-checkable).
8. All new docs under `docs/` (test manuals in `docs/testing/`); nothing at repo root.
9. Trust boundaries intact: no code path writes `HANDOFF.md`, generated compile outputs,
   or `.claude/settings.json` without the approval modal; `preset_apply` never overwrites.
10. Scene boundary intact: nothing outside `src/scene/` imports pixi; `src/scene/` imports
    no React Flow / canvas / inspector / compile modules; stores import no views.

---

## 11. Out of scope (do not build, do not stub)

Streaming assemble output · token counts in Compile/Assemble · resolved-context preview ·
node usage heatmap · unmapped-read one-click adopt · real Aseprite sprite sheets (scene
stays programmatic `Graphics`; `assets/sprites/` remain unwired) · calf sprites (J8/D9) ·
GIF export · barn mini-mode · warmth setting (D13) · day/night tint, barn cat, weather,
rare idle events (Tier 2/3 beyond A6) · sfx sprite-concat build step · ESLint · CSP
tightening · asset licence manifest (no external assets landed). All stay in
`docs/tasks/BACKLOG.md`.

---

## 12. Deviation procedure

If a lane cannot proceed without touching a file outside its grid row or changing a frozen
interface: STOP coding, append a dated `## Deviation` entry to THIS file describing the
conflict and the minimal change, make the change in a separate commit referencing the
entry, and continue. Never edit another lane's files silently. If two deviations collide,
the later lane rebases onto the earlier entry.

---

## Deviation — 2026-08-17 (audit fixes, code lead)

Adversarial audit of the Phase 5/6 build confirmed defects in frozen contract text
(items 1–3 from the first fix pass, 4–8 from the second); the minimal corrections below
are now the frozen text (sections already updated in place):

1. **§5.5 `assemble_done`** — the frozen any-`assembled` check chimed on a stale success
   from an earlier batch when a later batch failed entirely (statuses persist all
   session). Now: baseline the `assembled` count at the busy rising edge, chime on drain
   only if the count grew. `error_soft` unchanged.
2. **§7.2 J5 accumulation** — `addPaper` / `setPropOpened` moved from `onBusyEnd` /
   `onArrive` to EVENT RECEIPT in mapper.ts. The mount replay derives from the event
   ring, which stores no completion data, so completion-gated live accumulation made
   Canvas ⇄ Barn toggles change the scene. JUICE.md's log-derived rule is authoritative;
   all sfx calls stay at their semantic moments (ding still `onBusyEnd` only).
   Additionally, stopping the demo now re-derives accumulation from the purged ring
   (`setPaperCount` + `rebuildProps` + reopen from ring) and cancels queued cow tasks
   (`Cow.cancelAll()`), so rehearsal never leaves papers/ajar props behind (§7.5 spirit).
3. **§S10 `CowTask.target`** — now optional: omitted = the cow's tile when the task
   starts. `target: cow.tile` snapshotted at enqueue walked the cow back to a stale tile
   when an in-place reaction (prompt "!", zero-prop grep "?") arrived mid-walk.

4. **§3/§8.2 `preset_apply` graph guard** — the frozen "Err if graph.json exists, not
   even with an empty node list" contradicted the frozen UI gate (`loaded &&
   nodes.length === 0`): deleting a project's last node leaves `nodes: []` on disk, so
   Apply was enabled but always failed. Now: an existing graph.json that parses with an
   empty `nodes` array is tolerated (and overwritten); unparseable or non-empty stays
   fail-closed. Stub skipping also moved from `exists()` + `write_atomic` (which
   pre-deletes its target — a TOCTOU clobber window) to atomic `fs::File::create_new`.
5. **§3 `preset_export`** — the mandated silent extension append could overwrite a
   different file than the save dialog confirmed (type `backup` twice). Now the
   frontend passes a dialog `filters` entry so the OS appends and prompts on the real
   final path, and Rust Errs instead of overwriting an existing file at an appended
   path it invented.
6. **Stage-0 §S2 settings persistence** — "errors logged to console, never thrown to
   the UI" hid that a failed write also leaves the claude override un-applied; failures
   now also set `persistError` (rendered in SettingsModal). The debounce gained an
   exported `flushSettings()` called from beforeunload so a change within 500 ms of
   quit persists.
7. **§6 item 6 claude-path commit** — "commit on blur/Enter" lost the draft when the
   modal closed via Esc/scrim/Done (unmount fires no blur in Chromium). Now committed
   per keystroke; the persist debounce absorbs the churn.
8. **§S4 claude override** — a bare command name (e.g. `claude`) in `claudeBinaryPath`
   can never spawn an npm `.cmd` install on Windows (CreateProcess appends only
   `.exe`), while the same word works in the user's shell. `apply_claude_override` now
   resolves a separator-less name through the same `where` probe as auto-detect
   (`.exe` over `.cmd`), once per settings write; `where` finding nothing falls back to
   the verbatim name (normal spawn error preserved). The runner still spawns a
   path-like override directly with no probe, as frozen.

Related non-contract fixes in the same commit: BarnScene ignores shrinking event-array
updates (a §7.5 purge must not replay the surviving tail through the mapper); ambient
duck recovery rate is scaled by the actual duck depth so recovery spans the specified
400 ms; the typewriter 3 s auto-fade starts from the live volume so an active moo duck
is not audibly undone; `arrive()` no longer wipes the J3 glance on an interrupted-step
landing (reset-on-arrival still holds for real arrivals).

Second audit pass, same date: preset apply's failed phase no longer claims "nothing was
applied" (stubs before the failure point exist; the file rail is rescanned and the copy
says re-applying skips them); `parsePreset` rejects nodes whose `filePath` is empty or
not `.md`, naming the node — un-appliable presets now fail at import, not with a bare
"Refusing to write non-markdown stub:" at apply; wheel zoom steps an integer ladder
(1→2→3→4) and drag/zoom commit whole-pixel camera positions (JUICE.md's integer-zoom
rule; §7.7 centerCamera already committed to it); sfx drops cues while the AudioContext
is not running (drop-not-queue — Howler would otherwise queue pre-gesture cues and
burst them on the first click), checked before the cooldown stamp; HandoffModal blocks
Esc/scrim/✕ during the "writing" phase (HooksModal idiom — §8.5's phase list omitted
"writing" but the footer Cancel was already gated) and logs write/generate rejections
that arrive after close.
