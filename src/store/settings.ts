// App-level settings — the single source both the Settings UI and sfx.ts consume.
// Persisted via Rust read_app_settings/write_app_settings (app_config_dir/settings.json).
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { pushToast } from "./toasts";
// Type-only: `src/store/graph.ts` imports THIS module, so a value import here
// would close an import cycle. The runtime list of valid targets stays in
// graph.ts (`COMPILE_TARGETS`), which filters this field where it is applied.
import type { CompileTarget } from "./graph";
// Type-only for the same reason: `resources/index.ts` is a data module with
// no store imports of its own, but keeping this erased means the settings
// store stays loadable by a test that never touches the bundled tables.
import type { AgentPreset, PresetGroup } from "../resources";

/** One entry in the recent-projects list (startup screen). */
export interface RecentProject {
  /** Absolute project root, exactly as the dialog / scan returned it. */
  root: string;
  /** Basename, precomputed so the startup screen needs no path parsing. */
  name: string;
  lastOpenedMs: number;
}

export const MAX_RECENT_PROJECTS = 8;

export const PANEL_LIMITS = {
  leftMin: 180,
  leftMax: 480,
  leftDefault: 248,
  rightMin: 320,
  rightMax: 900,
  rightDefault: 460,
  briefMin: 48,
  briefMax: 600,
  briefDefault: 72,
} as const;

export type LensMode = "none" | "activity" | "weight" | "live";
export const LENS_MODES: readonly LensMode[] = ["none", "activity", "weight", "live"];

// WO06 D9 fix (§5.1/§8): the global default cap applied to every agent
// session spawned with no explicit per-task ceiling. `0` is the deliberate
// whole-app opt-out to unbounded (same wire convention `Session.tokenCeiling`
// already uses). `src-tauri/src/settings.rs::DEFAULT_SESSION_TOKEN_CEILING`
// is the byte-exact mirror of this constant, for the case a settings.json
// predates this field: Rust falls back to the same 200_000 there for the
// same reason (its own comment cites `CONTEXT_WINDOW_TOKENS` and the
// contract's own worked example). Kept in sync deliberately — NOT the
// contract text's literal "default 0": since this store always persists the
// FULL settings object on every change (never a partial merge), the first
// unrelated setting change after load would otherwise bake `0` into
// settings.json and silently defeat Rust's own safety-net fallback.
export const DEFAULT_SESSION_TOKEN_CEILING = 200_000;

// ── Appearance (WO15 Block 7 / §4.1) ───────────────────────────────────
//
// Scale is a PERCENT, not a ratio: it is what the segmented control shows
// and what settings.json stores. App.tsx divides by 100 for the
// `--ui-scale` custom property. D-7: the scale applies to chrome containers
// and portal roots via CSS `zoom` — never to `.react-flow` or the Barn host
// (both are px-frozen geometry).

export type UiScale = 85 | 100 | 115 | 130;
export const UI_SCALES: readonly UiScale[] = [85, 100, 115, 130];

export type UiFont = "system" | "plex";
export type CodeFont = "jetbrains" | "system-mono";

/** No new fonts are bundled (WO15 §7.9): every family below is either a
 *  system stack or one already loaded by `main.tsx`. Each value is the
 *  whole `font-family` list, applied to `--font-ui` by App.tsx. */
export const UI_FONT_STACKS: Record<UiFont, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  plex: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
};

export const CODE_FONT_STACKS: Record<CodeFont, string> = {
  jetbrains: '"JetBrains Mono", ui-monospace, Consolas, monospace',
  "system-mono": 'ui-monospace, Consolas, "Courier New", monospace',
};

/** Node-type help stays open for the first N launches (Block 1.3). */
export const NODE_TYPE_HELP_OPEN_LAUNCHES = 3;

// ── Tech stack defaults (WO16 Block C) ─────────────────────────────────
//
// Two separate things, deliberately not merged into one list:
//
//   `defaultStackItemIds` is which items the New Project wizard STARTS
//   ticked — exactly the `defaultCompileTargets` precedent, and consulted
//   only while the wizard is open. It may name bundled ids, custom ids, or
//   ids that no longer exist; the wizard filters at the point of use, so a
//   stack item deleted after being made a default is dropped there rather
//   than silently rewritten out of settings.json.
//
//   `customStackItems` is the user EXTENDING the bundled table. These are
//   real rows in the picker, not preferences about it, so deleting one has
//   to be a deliberate act in Settings.

/** Prefix marking a stack item as the user's own. Same two-namespace rule
 *  as {@link AgentPreset} ids: a custom item can never collide with a
 *  bundled one, and `stacks.json` stays the closed table it is. */
export const CUSTOM_STACK_PREFIX = "custom:";

/** Category custom items fall into when they name no bundled category (or
 *  name one that has since gone away). Rendered as its own trailing group. */
export const CUSTOM_STACK_CATEGORY_ID = "custom";

/** Longest a stack label may be — a picker row, not a description. */
export const MAX_STACK_LABEL = 40;

export interface CustomStackItem {
  /** `custom:<slug>`, unique across the whole picker. */
  id: string;
  label: string;
  /** A `STACK_CATEGORIES` id, or {@link CUSTOM_STACK_CATEGORY_ID}. Not
   *  validated against the bundled table here — categories are data that
   *  can move between releases, and an item whose category vanished should
   *  reappear under "Custom", not disappear. */
  categoryId: string;
  /** Basename of the file in `app_config_dir/stack-icons/`, or `null` for
   *  the default glyph. Never a path and never image bytes: the icon store
   *  is Rust-owned (`stack_icon_*`), and the hard rule against base64 blobs
   *  in source applies just as much to a JSON the app writes. */
  iconFile: string | null;
}

export interface AppSettings {
  version: 1;
  masterVolume: number; // 0..1
  barnSounds: boolean;
  toolSounds: boolean;
  muted: boolean;
  calmMode: boolean;
  claudeBinaryPath: string; // "" = auto-resolve via `where claude`
  // ── new in this batch ──
  recentProjects: RecentProject[]; // newest first, <= MAX_RECENT_PROJECTS
  leftPanelWidth: number; // px, clamped leftMin..leftMax
  rightPanelWidth: number; // px, clamped rightMin..rightMax
  leftPanelCollapsed: boolean; // default false
  briefHeight: number; // px, clamped briefMin..briefMax
  syncFileName: boolean; // default true (idea #1)
  lens: LensMode; // canvas lens (WO01 Block A); additive, tolerant-merge field
  // N3: hides the Barn segment (and never mounts BarnScene/Pixi) for a pure
  // manager UI. Additive, tolerant-merge field — default false.
  managerMode: boolean;
  /** WO02 #7: Barn FPS overlay. Additive, tolerant-merge field — default false. */
  showFps: boolean;
  /** WO06 §5.1/§8 (D9 fix), appended last: the global default token ceiling
   *  for a new agent session that carries no explicit per-task ceiling.
   *  `0` = unbounded (explicit whole-app opt-out). Rust's
   *  `agent_session_spawn` already folds this in server-side
   *  (`settings::global_token_ceiling` + `sessions.rs::resolve_ceiling`) —
   *  no frontend spawn call site needs to change. */
  sessionTokenCeiling: number;
  /** WO10 item 16: Inspector section keys the user has COLLAPSED. Stored as
   *  the exceptions rather than the full state, so a section added in a
   *  later release starts open without a migration, and a settings.json
   *  written by an older build simply has fewer exceptions in it. */
  collapsedSections: string[];
  /** Compile targets a BRAND-NEW project starts with — the ticks in the
   *  title screen's AI-toolchain details. Scanning finds what this machine
   *  runs; this is the user saying which of those Cowtext should compile
   *  for by default. An existing project's own `compileTargets` in
   *  graph.json always wins; this is only consulted when there is no
   *  graph.json yet (`graph.ts::loadGraph`). Additive, tolerant-merge
   *  field — an older settings.json simply falls back to `["claude"]`. */
  defaultCompileTargets: CompileTarget[];
  /** WO15 Block 7: chrome zoom, in percent. One of {@link UI_SCALES}. */
  uiScale: UiScale;
  /** WO15 Block 7: the UI text family — see {@link UI_FONT_STACKS}. */
  uiFont: UiFont;
  /** WO15 Block 7: the monospace family — see {@link CODE_FONT_STACKS}. */
  codeFont: CodeFont;
  /** WO15 Block 1.3: how many times this install has been launched.
   *  Incremented exactly once per `load()` (the `loading` guard keeps
   *  StrictMode's double effect to one bump). Drives first-run affordances
   *  like the Inspector's node-type help. */
  launchCount: number;
  /** WO15 Block 1.3: `null` = the user has never touched the node-type help
   *  disclosure, so `launchCount` decides (see
   *  {@link selectNodeTypeHelpOpen}); a boolean is an explicit choice that
   *  wins from then on. */
  nodeTypeHelpCollapsed: boolean | null;
  /** WO15 Block 5b: `fileName` of the agent the Run dialog last spawned,
   *  used as its default the next time nothing else selects one. `""` = no
   *  memory yet. Not a path — the same key `useAgentsStore.meta` uses. */
  lastRunAgentFile: string;
  /** WO16 Block B: the user's own agent presets, shown in the New Agent
   *  dialog's picker alongside the ones Cowtext ships. Every id carries
   *  {@link CUSTOM_PRESET_PREFIX}, so this list can never shadow a
   *  built-in. Additive, tolerant-merge field. */
  customAgentPresets: AgentPreset[];
  /** WO16 Block C: stack items a BRAND-NEW project starts ticked. See the
   *  block comment above — the wizard filters these at the point of use. */
  defaultStackItemIds: string[];
  /** WO16 Block C: rows the user added to the stack picker. */
  customStackItems: CustomStackItem[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  masterVolume: 0.6,
  barnSounds: true,
  toolSounds: true,
  muted: false,
  calmMode: false,
  claudeBinaryPath: "",
  recentProjects: [],
  leftPanelWidth: PANEL_LIMITS.leftDefault,
  rightPanelWidth: PANEL_LIMITS.rightDefault,
  leftPanelCollapsed: false,
  briefHeight: PANEL_LIMITS.briefDefault,
  syncFileName: true,
  lens: "none",
  managerMode: false,
  showFps: false,
  sessionTokenCeiling: DEFAULT_SESSION_TOKEN_CEILING,
  collapsedSections: [],
  defaultCompileTargets: ["claude"],
  uiScale: 100,
  uiFont: "plex",
  codeFont: "jetbrains",
  launchCount: 0,
  nodeTypeHelpCollapsed: null,
  lastRunAgentFile: "",
  customAgentPresets: [],
  defaultStackItemIds: [],
  customStackItems: [],
};

export interface SettingsState extends AppSettings {
  loaded: boolean;
  /** OS prefers-reduced-motion; force-enables calm's MOTION half only. */
  prefersReducedMotion: boolean;
  /** Last write_app_settings failure (null = last persist succeeded).
   *  Surfaced in SettingsModal: a failed write also means the claude
   *  override never reached Rust, so the user must see it. */
  persistError: string | null;
  load: () => Promise<void>;
  setMasterVolume: (v: number) => void;
  setBarnSounds: (b: boolean) => void;
  setToolSounds: (b: boolean) => void;
  setMuted: (b: boolean) => void;
  setCalmMode: (b: boolean) => void;
  setClaudeBinaryPath: (p: string) => void;
  pushRecentProject: (root: string) => void;
  removeRecentProject: (root: string) => void;
  setLeftPanelWidth: (px: number) => void;
  setRightPanelWidth: (px: number) => void;
  setLeftPanelCollapsed: (b: boolean) => void;
  setBriefHeight: (px: number) => void;
  setSyncFileName: (b: boolean) => void;
  setLens: (l: LensMode) => void;
  setManagerMode: (b: boolean) => void;
  setShowFps: (b: boolean) => void;
  setSessionTokenCeiling: (n: number) => void;
  /** Collapse/expand one Inspector section by key. */
  setSectionCollapsed: (key: string, collapsed: boolean) => void;
  setDefaultCompileTargets: (targets: CompileTarget[]) => void;
  setUiScale: (v: UiScale) => void;
  setUiFont: (v: UiFont) => void;
  setCodeFont: (v: CodeFont) => void;
  setNodeTypeHelpCollapsed: (v: boolean | null) => void;
  setLastRunAgentFile: (fileName: string) => void;
  /** Add or replace one custom preset, matched on `id`. */
  saveCustomPreset: (preset: AgentPreset) => void;
  removeCustomPreset: (id: string) => void;
  setDefaultStackItemIds: (ids: string[]) => void;
  /** Add or replace one custom stack item, matched on `id`. */
  saveCustomStackItem: (item: CustomStackItem) => void;
  /** Remove the item AND any default that pointed at it — a default naming
   *  a row that no longer exists is dead weight the wizard would filter out
   *  on every open. */
  removeCustomStackItem: (id: string) => void;
}

/** Reduced motion is on when calm mode OR the OS asks for it. */
export function selectReducedMotion(s: SettingsState): boolean {
  return s.calmMode || s.prefersReducedMotion;
}
/** Sound is hard-off when muted OR calm (calm implies mute). */
export function selectSoundOff(s: SettingsState): boolean {
  return s.muted || s.calmMode;
}

/** Is the Inspector's node-type help disclosure open? (Block 1.3.) Until the
 *  user collapses or expands it themselves (`nodeTypeHelpCollapsed === null`)
 *  it stays open for the first {@link NODE_TYPE_HELP_OPEN_LAUNCHES} launches
 *  — the state where the taxonomy is genuinely new — and closes on its own
 *  afterwards. Once touched, the explicit choice wins forever. */
export function selectNodeTypeHelpOpen(s: SettingsState): boolean {
  return s.nodeTypeHelpCollapsed === null
    ? s.launchCount <= NODE_TYPE_HELP_OPEN_LAUNCHES
    : !s.nodeTypeHelpCollapsed;
}

/** Dedupe/compare key: trailing slash stripped, lowercased (Windows paths). */
function recentKey(root: string): string {
  return root.replace(/[\\/]+$/, "").toLowerCase();
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Validate + normalize a raw recentProjects value. Anything malformed -> []. */
function mergeRecentProjects(raw: unknown): RecentProject[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RecentProject[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.root !== "string" || e.root === "") continue;
    if (typeof e.name !== "string" || e.name === "") continue;
    if (typeof e.lastOpenedMs !== "number" || !Number.isFinite(e.lastOpenedMs)) continue;
    const key = recentKey(e.root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ root: e.root, name: e.name, lastOpenedMs: e.lastOpenedMs });
    if (out.length >= MAX_RECENT_PROJECTS) break;
  }
  return out;
}

/** The three preset groups, spelled out rather than imported, for the same
 *  reason `uiFont` is compared against string literals two screens down:
 *  this module validates settings.json without loading the bundled tables.
 *  `resources.test.ts` pins the two lists against each other. */
const PRESET_GROUP_IDS: readonly PresetGroup[] = ["direction", "engineering", "task"];

/** Validate one custom agent preset out of settings.json. Anything that
 *  would put the New Agent dialog in a state no control can leave — a
 *  missing id, an id that pretends to be a built-in, an unknown group — is
 *  rejected outright; a merely odd value (a huge priority, a tool name this
 *  build does not know) is clamped or passed through, because the dialog
 *  already validates tools at the point of use and a preset is only ever a
 *  starting point the user can edit. */
function mergeCustomPresets(raw: unknown): AgentPreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AgentPreset[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id.startsWith("custom:")) continue;
    if (seen.has(e.id)) continue;
    if (typeof e.name !== "string" || e.name.trim() === "") continue;
    if (typeof e.description !== "string") continue;
    if (typeof e.whenToUse !== "string") continue;
    if (e.mode !== "inherit" && e.mode !== "restrict") continue;
    const group = PRESET_GROUP_IDS.find((g) => g === e.group);
    if (group === undefined) continue;
    const tools = Array.isArray(e.tools)
      ? e.tools.filter((t): t is string => typeof t === "string")
      : [];
    // The one invariant the picker itself relies on: `inherit` means "no
    // list at all". A file claiming both is read as the mode it names.
    const preset: AgentPreset = {
      id: e.id,
      name: e.name.trim(),
      group,
      description: e.description,
      whenToUse: e.whenToUse,
      tools: e.mode === "inherit" ? [] : tools,
      mode: e.mode,
      priority:
        typeof e.priority === "number" && Number.isFinite(e.priority)
          ? Math.round(e.priority)
          : 1,
    };
    if (typeof e.model === "string" && e.model !== "") preset.model = e.model;
    seen.add(preset.id);
    out.push(preset);
  }
  return out;
}

/** Validate the user's stack rows. `label` is trimmed and capped; an entry
 *  without a usable id or label is dropped. */
function mergeCustomStackItems(raw: unknown): CustomStackItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomStackItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id.startsWith(CUSTOM_STACK_PREFIX)) continue;
    if (seen.has(e.id)) continue;
    if (typeof e.label !== "string" || e.label.trim() === "") continue;
    seen.add(e.id);
    out.push({
      id: e.id,
      label: e.label.trim().slice(0, MAX_STACK_LABEL),
      categoryId:
        typeof e.categoryId === "string" && e.categoryId !== ""
          ? e.categoryId
          : CUSTOM_STACK_CATEGORY_ID,
      // A path here would be a settings.json naming a file anywhere on
      // disk; only a bare basename is ever accepted, and Rust re-checks.
      iconFile:
        typeof e.iconFile === "string" && e.iconFile !== "" && !/[\\/]/.test(e.iconFile)
          ? e.iconFile
          : null,
    });
  }
  return out;
}

/** Tolerant merge: unknown fields ignored, missing fields default, bad types
 *  default. Exported (pure, no store access) so `settings.test.ts` can pin
 *  the merge rules for every field without a running app — WO15 §4.1. */
export function mergeSettings(raw: unknown): AppSettings {
  const out = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.masterVolume === "number" && Number.isFinite(r.masterVolume)) {
    out.masterVolume = clamp(r.masterVolume, 0, 1);
  }
  if (typeof r.barnSounds === "boolean") out.barnSounds = r.barnSounds;
  if (typeof r.toolSounds === "boolean") out.toolSounds = r.toolSounds;
  if (typeof r.muted === "boolean") out.muted = r.muted;
  if (typeof r.calmMode === "boolean") out.calmMode = r.calmMode;
  if (typeof r.claudeBinaryPath === "string") out.claudeBinaryPath = r.claudeBinaryPath;
  out.recentProjects = mergeRecentProjects(r.recentProjects);
  if (typeof r.leftPanelWidth === "number" && Number.isFinite(r.leftPanelWidth)) {
    out.leftPanelWidth = clamp(r.leftPanelWidth, PANEL_LIMITS.leftMin, PANEL_LIMITS.leftMax);
  }
  if (typeof r.rightPanelWidth === "number" && Number.isFinite(r.rightPanelWidth)) {
    out.rightPanelWidth = clamp(r.rightPanelWidth, PANEL_LIMITS.rightMin, PANEL_LIMITS.rightMax);
  }
  if (typeof r.leftPanelCollapsed === "boolean") out.leftPanelCollapsed = r.leftPanelCollapsed;
  if (typeof r.briefHeight === "number" && Number.isFinite(r.briefHeight)) {
    out.briefHeight = clamp(r.briefHeight, PANEL_LIMITS.briefMin, PANEL_LIMITS.briefMax);
  }
  if (typeof r.syncFileName === "boolean") out.syncFileName = r.syncFileName;
  if (typeof r.lens === "string" && LENS_MODES.some((m) => m === r.lens)) {
    out.lens = r.lens as LensMode;
  }
  if (typeof r.managerMode === "boolean") out.managerMode = r.managerMode;
  if (typeof r.showFps === "boolean") out.showFps = r.showFps;
  if (
    typeof r.sessionTokenCeiling === "number" &&
    Number.isFinite(r.sessionTokenCeiling) &&
    r.sessionTokenCeiling >= 0
  ) {
    out.sessionTokenCeiling = Math.round(r.sessionTokenCeiling);
  }
  if (Array.isArray(r.collapsedSections)) {
    out.collapsedSections = r.collapsedSections.filter((k): k is string => typeof k === "string");
  }
  // Strings only here; graph.ts narrows to real CompileTargets where it
  // applies them, so an unknown target left by a newer build is dropped at
  // the point of use rather than silently rewritten out of settings.json.
  if (Array.isArray(r.defaultCompileTargets)) {
    out.defaultCompileTargets = r.defaultCompileTargets.filter(
      (t): t is CompileTarget => typeof t === "string",
    );
  }
  // WO15 §4.1 — the six appearance/first-run fields. Same tolerance rule as
  // everything above: an unknown or badly-typed value falls back to the
  // default rather than being carried through, so a settings.json edited by
  // hand (or written by a newer build) can never put the UI in a state no
  // control can leave.
  if (typeof r.uiScale === "number" && UI_SCALES.some((s) => s === r.uiScale)) {
    out.uiScale = r.uiScale as UiScale;
  }
  if (r.uiFont === "system" || r.uiFont === "plex") out.uiFont = r.uiFont;
  if (r.codeFont === "jetbrains" || r.codeFont === "system-mono") out.codeFont = r.codeFont;
  if (
    typeof r.launchCount === "number" &&
    Number.isFinite(r.launchCount) &&
    r.launchCount >= 0
  ) {
    out.launchCount = Math.floor(r.launchCount);
  }
  if (typeof r.nodeTypeHelpCollapsed === "boolean" || r.nodeTypeHelpCollapsed === null) {
    out.nodeTypeHelpCollapsed = r.nodeTypeHelpCollapsed;
  }
  if (typeof r.lastRunAgentFile === "string") out.lastRunAgentFile = r.lastRunAgentFile;
  // WO16 — the three additive fields. Each element is validated
  // individually and a bad one is DROPPED rather than defaulting the whole
  // list: one malformed preset in a hand-edited settings.json should cost
  // that preset, not every preset the user ever saved.
  out.customAgentPresets = mergeCustomPresets(r.customAgentPresets);
  if (Array.isArray(r.defaultStackItemIds)) {
    out.defaultStackItemIds = r.defaultStackItemIds.filter(
      (id): id is string => typeof id === "string" && id !== "",
    );
  }
  out.customStackItems = mergeCustomStackItems(r.customStackItems);
  return out;
}

/** What `read_app_settings` gave us. `{ ok: true, raw: null }` = the file
 *  does not exist yet (a first launch, not a failure); `{ ok: false }` = the
 *  IPC itself rejected. */
export type SettingsRead = { ok: true; raw: string | null } | { ok: false };

export interface SettingsLoad {
  /** What the store adopts. `launchCount` is ALREADY incremented. */
  settings: AppSettings;
  /** May this be written back to `settings.json`? */
  persist: boolean;
  /** Why the file's contents were not used — `null` when they were (or when
   *  there was no file). The IPC-rejection message is not repeated here; the
   *  caller has the real error in hand for that case. */
  problem: string | null;
}

function withLaunch(s: AppSettings): AppSettings {
  return { ...s, launchCount: s.launchCount + 1 };
}

/** The pure core of `load()` — tester #4.
 *
 *  Two independent decisions, which the old inline version conflated:
 *
 *   1. WHAT TO SHOW. Always something: a settings.json we cannot read must
 *      never stop the app from starting, so every failure path falls back to
 *      `DEFAULT_SETTINGS`. And the launch still counts on every path — this
 *      loader IS the "app launched" event (WO15 Block 1.3 / A-2), and a user
 *      whose file is unreadable is still launching the app.
 *
 *   2. WHETHER TO WRITE IT BACK. Only when the read actually SUCCEEDED. The
 *      old code persisted unconditionally, 500 ms after every launch: one
 *      transient IPC failure, or a settings.json a text editor left
 *      half-written, and the user's recent projects / panel sizes / claude
 *      binary path were overwritten with defaults — permanently, from a
 *      problem that might have been momentary. Falling back in MEMORY is
 *      recoverable (relaunch); writing the fallback to disk is not.
 *
 *  "Succeeded" means the file parsed into a JSON object. No file at all is a
 *  success (there is nothing to destroy, and the first launch is exactly
 *  when settings.json should be created); a file holding `[]`, `"nope"` or
 *  `null` is not — it is somebody's data in a shape we do not understand. */
export function settingsAfterLoad(read: SettingsRead): SettingsLoad {
  const defaults = withLaunch(DEFAULT_SETTINGS);
  if (!read.ok) return { settings: defaults, persist: false, problem: "settings.json could not be read" };
  if (read.raw === null) return { settings: defaults, persist: true, problem: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.raw);
  } catch {
    return { settings: defaults, persist: false, problem: "settings.json is not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { settings: defaults, persist: false, problem: "settings.json is not a settings object" };
  }
  return { settings: withLaunch(mergeSettings(parsed)), persist: true, problem: null };
}

// Debounced persist — serialize exactly the AppSettings fields in declared
// order (2-space indent, trailing newline); errors logged, never thrown.
const PERSIST_DEBOUNCE_MS = 500;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistNow(): void {
  const s = useSettingsStore.getState();
  const payload: AppSettings = {
    version: 1,
    masterVolume: s.masterVolume,
    barnSounds: s.barnSounds,
    toolSounds: s.toolSounds,
    muted: s.muted,
    calmMode: s.calmMode,
    claudeBinaryPath: s.claudeBinaryPath,
    recentProjects: s.recentProjects,
    leftPanelWidth: s.leftPanelWidth,
    rightPanelWidth: s.rightPanelWidth,
    leftPanelCollapsed: s.leftPanelCollapsed,
    briefHeight: s.briefHeight,
    syncFileName: s.syncFileName,
    lens: s.lens,
    managerMode: s.managerMode,
    showFps: s.showFps,
    sessionTokenCeiling: s.sessionTokenCeiling,
    collapsedSections: s.collapsedSections,
    defaultCompileTargets: s.defaultCompileTargets,
    uiScale: s.uiScale,
    uiFont: s.uiFont,
    codeFont: s.codeFont,
    launchCount: s.launchCount,
    nodeTypeHelpCollapsed: s.nodeTypeHelpCollapsed,
    lastRunAgentFile: s.lastRunAgentFile,
    customAgentPresets: s.customAgentPresets,
    defaultStackItemIds: s.defaultStackItemIds,
    customStackItems: s.customStackItems,
  };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  invoke("write_app_settings", { content }).then(
    () => useSettingsStore.setState({ persistError: null }),
    (e: unknown) => {
      // Surfaced in the UI (persistError) — a failed write also means the
      // claude override was never applied Rust-side for this session.
      pushToast({
        severity: "danger",
        title: "Settings failed to save",
        detail: String(e),
      });
      useSettingsStore.setState({ persistError: String(e) });
    },
  );
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

/** Fire any pending debounced persist immediately (mirrors graph.ts
 *  flushSave). Called from the beforeunload handler so a change made within
 *  500 ms of quitting is not silently lost. */
export function flushSettings(): void {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  persistNow();
}

// Idempotent load guard (same idiom as events.ts initEventListener).
let loading: Promise<void> | null = null;

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  prefersReducedMotion: false,
  persistError: null,

  load: () => {
    if (loading !== null) return loading;
    loading = (async () => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      set({ prefersReducedMotion: mq.matches });
      mq.addEventListener("change", (ev) => set({ prefersReducedMotion: ev.matches }));
      let read: SettingsRead;
      try {
        read = { ok: true, raw: await invoke<string | null>("read_app_settings") };
      } catch (e: unknown) {
        // IPC failure → defaults; the app must still start.
        pushToast({
          severity: "danger",
          title: "Settings failed to load",
          detail: String(e),
        });
        read = { ok: false };
      }
      // The launch counts on every path; the WRITE-BACK does not. See
      // `settingsAfterLoad` — tester #4.
      const outcome = settingsAfterLoad(read);
      if (read.ok && outcome.problem !== null) {
        pushToast({
          severity: "danger",
          title: "Settings failed to load",
          detail: `${outcome.problem}. Defaults are in use for this session; your file was left untouched.`,
        });
      }
      set({ ...outcome.settings, loaded: true });
      if (outcome.persist) schedulePersist();
    })();
    return loading;
  },

  setMasterVolume: (v) => {
    set({ masterVolume: v });
    schedulePersist();
  },
  setBarnSounds: (b) => {
    set({ barnSounds: b });
    schedulePersist();
  },
  setToolSounds: (b) => {
    set({ toolSounds: b });
    schedulePersist();
  },
  setMuted: (b) => {
    set({ muted: b });
    schedulePersist();
  },
  setCalmMode: (b) => {
    set({ calmMode: b });
    schedulePersist();
  },
  setClaudeBinaryPath: (p) => {
    set({ claudeBinaryPath: p });
    schedulePersist();
  },

  pushRecentProject: (root) => {
    const key = recentKey(root);
    const name = root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? root;
    const entry: RecentProject = { root, name, lastOpenedMs: Date.now() };
    set((st) => {
      const rest = st.recentProjects.filter((p) => recentKey(p.root) !== key);
      return { recentProjects: [entry, ...rest].slice(0, MAX_RECENT_PROJECTS) };
    });
    schedulePersist();
  },
  removeRecentProject: (root) => {
    const key = recentKey(root);
    set((st) => ({
      recentProjects: st.recentProjects.filter((p) => recentKey(p.root) !== key),
    }));
    schedulePersist();
  },
  setLeftPanelWidth: (px) => {
    set({ leftPanelWidth: clamp(px, PANEL_LIMITS.leftMin, PANEL_LIMITS.leftMax) });
    schedulePersist();
  },
  setRightPanelWidth: (px) => {
    set({ rightPanelWidth: clamp(px, PANEL_LIMITS.rightMin, PANEL_LIMITS.rightMax) });
    schedulePersist();
  },
  setLeftPanelCollapsed: (b) => {
    set({ leftPanelCollapsed: b });
    schedulePersist();
  },
  setBriefHeight: (px) => {
    set({ briefHeight: clamp(px, PANEL_LIMITS.briefMin, PANEL_LIMITS.briefMax) });
    schedulePersist();
  },
  setSyncFileName: (b) => {
    set({ syncFileName: b });
    schedulePersist();
  },
  setLens: (l) => {
    set({ lens: l });
    schedulePersist();
  },
  setManagerMode: (b) => {
    set({ managerMode: b });
    schedulePersist();
  },
  setShowFps: (b) => {
    set({ showFps: b });
    schedulePersist();
  },
  setSessionTokenCeiling: (n) => {
    set({ sessionTokenCeiling: Math.max(0, Math.round(n)) });
    schedulePersist();
  },

  setSectionCollapsed: (key, collapsed) => {
    const cur = get().collapsedSections;
    const has = cur.includes(key);
    if (has === collapsed) return;
    // Sorted so the persisted file doesn't churn on toggle order.
    set({
      collapsedSections: collapsed ? [...cur, key].sort() : cur.filter((k) => k !== key),
    });
    schedulePersist();
  },

  setDefaultCompileTargets: (targets) => {
    set({ defaultCompileTargets: [...targets] });
    schedulePersist();
  },

  setUiScale: (v) => {
    set({ uiScale: v });
    schedulePersist();
  },
  setUiFont: (v) => {
    set({ uiFont: v });
    schedulePersist();
  },
  setCodeFont: (v) => {
    set({ codeFont: v });
    schedulePersist();
  },
  setNodeTypeHelpCollapsed: (v) => {
    set({ nodeTypeHelpCollapsed: v });
    schedulePersist();
  },
  setLastRunAgentFile: (fileName) => {
    set({ lastRunAgentFile: fileName });
    schedulePersist();
  },

  // ── WO16 Block B/C ───────────────────────────────────────────────────
  // Both saves are upsert-by-id and preserve position: editing a preset or
  // a stack row must not make it jump to the end of a list the user has
  // been reading top-to-bottom.
  saveCustomPreset: (preset) => {
    set((s) => {
      const at = s.customAgentPresets.findIndex((p) => p.id === preset.id);
      if (at === -1) return { customAgentPresets: [...s.customAgentPresets, preset] };
      const next = [...s.customAgentPresets];
      next[at] = preset;
      return { customAgentPresets: next };
    });
    schedulePersist();
  },
  removeCustomPreset: (id) => {
    set((s) => ({ customAgentPresets: s.customAgentPresets.filter((p) => p.id !== id) }));
    schedulePersist();
  },
  setDefaultStackItemIds: (ids) => {
    set({ defaultStackItemIds: [...new Set(ids)] });
    schedulePersist();
  },
  saveCustomStackItem: (item) => {
    set((s) => {
      const at = s.customStackItems.findIndex((i) => i.id === item.id);
      if (at === -1) return { customStackItems: [...s.customStackItems, item] };
      const next = [...s.customStackItems];
      next[at] = item;
      return { customStackItems: next };
    });
    schedulePersist();
  },
  removeCustomStackItem: (id) => {
    set((s) => ({
      customStackItems: s.customStackItems.filter((i) => i.id !== id),
      defaultStackItemIds: s.defaultStackItemIds.filter((d) => d !== id),
    }));
    schedulePersist();
  },
}));
