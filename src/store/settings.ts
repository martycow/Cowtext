// App-level settings — the single source both the Settings UI and sfx.ts consume.
// Persisted via Rust read_app_settings/write_app_settings (app_config_dir/settings.json).
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

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
}

/** Reduced motion is on when calm mode OR the OS asks for it. */
export function selectReducedMotion(s: SettingsState): boolean {
  return s.calmMode || s.prefersReducedMotion;
}
/** Sound is hard-off when muted OR calm (calm implies mute). */
export function selectSoundOff(s: SettingsState): boolean {
  return s.muted || s.calmMode;
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

/** Tolerant merge: unknown fields ignored, missing fields default, bad types default. */
function mergeSettings(raw: unknown): AppSettings {
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
  return out;
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
  };
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  invoke("write_app_settings", { content }).then(
    () => useSettingsStore.setState({ persistError: null }),
    (e: unknown) => {
      // Surfaced in the UI (persistError) — a failed write also means the
      // claude override was never applied Rust-side for this session.
      console.error("write_app_settings failed:", e);
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
      let merged = { ...DEFAULT_SETTINGS };
      try {
        const raw = await invoke<string | null>("read_app_settings");
        if (raw !== null) merged = mergeSettings(JSON.parse(raw) as unknown);
      } catch (e: unknown) {
        // Parse or IPC failure → defaults; the app must still start.
        console.error("read_app_settings failed:", e);
      }
      set({ ...merged, loaded: true });
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
}));
