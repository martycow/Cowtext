// App-level settings — the single source both the Settings UI and sfx.ts consume.
// Persisted via Rust read_app_settings/write_app_settings (app_config_dir/settings.json).
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  version: 1;
  masterVolume: number; // 0..1
  barnSounds: boolean;
  toolSounds: boolean;
  muted: boolean;
  calmMode: boolean;
  claudeBinaryPath: string; // "" = auto-resolve via `where claude`
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
}

/** Reduced motion is on when calm mode OR the OS asks for it. */
export function selectReducedMotion(s: SettingsState): boolean {
  return s.calmMode || s.prefersReducedMotion;
}
/** Sound is hard-off when muted OR calm (calm implies mute). */
export function selectSoundOff(s: SettingsState): boolean {
  return s.muted || s.calmMode;
}

/** Tolerant merge: unknown fields ignored, missing fields default, bad types default. */
function mergeSettings(raw: unknown): AppSettings {
  const out = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.masterVolume === "number" && Number.isFinite(r.masterVolume)) {
    out.masterVolume = Math.min(1, Math.max(0, r.masterVolume));
  }
  if (typeof r.barnSounds === "boolean") out.barnSounds = r.barnSounds;
  if (typeof r.toolSounds === "boolean") out.toolSounds = r.toolSounds;
  if (typeof r.muted === "boolean") out.muted = r.muted;
  if (typeof r.calmMode === "boolean") out.calmMode = r.calmMode;
  if (typeof r.claudeBinaryPath === "string") out.claudeBinaryPath = r.claudeBinaryPath;
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

export const useSettingsStore = create<SettingsState>((set) => ({
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
}));
