import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { hooksStatus } from "../fs/api";
import { flushSettings, useSettingsStore } from "./settings";
import { useGraphStore } from "./graph";
import { flushAgentSave, flushMetaSave, useAgentsStore } from "./agents";
import { useTasksStore } from "./tasks";
import { useEventsStore } from "./events";
import { useReviewStore } from "./review";
import { useProjectSelectionStore } from "./projectSelection";

export interface MdFile {
  relPath: string;
  sizeBytes: number;
  modifiedMs: number | null;
}

interface ProjectScan {
  root: string;
  files: MdFile[];
}

/** Wire shape for the `fs://change` event (watcher.rs, WO01 Block A §4.1;
 *  `selfWrite` added Block C §T4 — true when Cowtext itself wrote this path
 *  within the self-write TTL, see `note_self_write`/`take_self_write`). */
export interface FsChange {
  relPath: string;
  modifiedMs: number | null;
  sizeBytes: number | null;
  kind: "modify" | "create" | "remove";
  selfWrite: boolean;
}

interface ProjectState {
  root: string | null;
  files: MdFile[];
  scanning: boolean;
  error: string | null;
  /** null = never probed for this root. */
  hooksInstalled: boolean | null;
  /** false = .claude/settings.json exists but could not be parsed. */
  hooksReadable: boolean;

  openProject: () => Promise<void>;
  /** Open a known path (recent list). Resolves false when the scan failed;
   *  on failure `root` is left untouched and `error` is set. */
  openProjectAt: (root: string) => Promise<boolean>;
  rescan: () => Promise<void>;
  /** Re-reads hooks_status for the current root; no-op when root is null. */
  refreshHooksStatus: () => Promise<void>;
  /** Applies one `fs://change` event in place — never rescans (§5.2). */
  applyFsChange: (c: FsChange) => void;
  /** WO11 G1 — the Home button's action. Flushes every debounced write
   *  FIRST (order is frozen, contract §5.9: losing an edit on the way out
   *  is the failure mode this exists to prevent), then clears this store
   *  and every other panel-owning selection so the title screen never shows
   *  a stale card. Does NOT touch `useSessionsStore` — live agent sessions
   *  are never killed by Home (Marty's ratified ASK #3); they simply stop
   *  being rendered once `root` is null (RosterBar's own mount guard). The
   *  caller (App.tsx) still owns resetting its own local view/modal state
   *  (§5.9 step 4) since that's component state, not a store. */
  closeProject: () => Promise<void>;
}

async function scan(root: string): Promise<ProjectScan> {
  return invoke<ProjectScan>("scan_project", { root });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  root: null,
  files: [],
  scanning: false,
  error: null,
  hooksInstalled: null,
  hooksReadable: true,

  openProject: async () => {
    const picked = await open({ directory: true, title: "Open project folder" });
    if (typeof picked !== "string") return; // cancelled
    await get().openProjectAt(picked);
  },

  openProjectAt: async (root) => {
    set({ scanning: true, error: null, hooksInstalled: null });
    try {
      const result = await scan(root);
      set({ root: result.root, files: result.files, scanning: false });
      useSettingsStore.getState().pushRecentProject(result.root);
      void get().refreshHooksStatus();
      return true;
    } catch (e) {
      set({ scanning: false, error: String(e) });
      return false;
    }
  },

  rescan: async () => {
    const root = get().root;
    if (!root) return;
    set({ scanning: true, error: null });
    try {
      const result = await scan(root);
      set({ files: result.files, scanning: false });
    } catch (e) {
      set({ scanning: false, error: String(e) });
    }
  },

  refreshHooksStatus: async () => {
    const root = get().root;
    if (!root) return;
    try {
      const status = await hooksStatus(root);
      if (get().root !== root) return; // stale: a different project opened meanwhile
      set({ hooksInstalled: status.installed && status.readable, hooksReadable: status.readable });
    } catch {
      if (get().root !== root) return; // stale: a different project opened meanwhile
      set({ hooksInstalled: null, hooksReadable: true });
    }
  },

  applyFsChange: (c) => {
    const { root, files } = get();
    if (root === null) return;

    if (c.kind === "remove") {
      const idx = files.findIndex((f) => f.relPath === c.relPath);
      if (idx === -1) return; // same array identity — no re-render
      const next = files.slice();
      next.splice(idx, 1);
      set({ files: next });
      return;
    }

    const idx = files.findIndex((f) => f.relPath === c.relPath);
    if (idx !== -1) {
      // modify on known path, or create degrading to modify.
      const prev = files[idx];
      const updated: MdFile = {
        ...prev,
        modifiedMs: c.modifiedMs ?? Date.now(),
        sizeBytes: c.sizeBytes ?? prev.sizeBytes,
      };
      const next = files.slice();
      next[idx] = updated;
      set({ files: next });
      return;
    }

    // create, or modify on an unknown path — insert sorted by relPath.
    const inserted: MdFile = {
      relPath: c.relPath,
      sizeBytes: c.sizeBytes ?? 0,
      modifiedMs: c.modifiedMs ?? Date.now(),
    };
    const next = files.slice();
    let pos = next.findIndex((f) => f.relPath > c.relPath);
    if (pos === -1) pos = next.length;
    next.splice(pos, 0, inserted);
    set({ files: next });
  },

  closeProject: async () => {
    // Step 1-2 (frozen order, §5.9): flush every debounced writer before
    // anything is cleared.
    await useGraphStore.getState().flushSave();
    flushAgentSave();
    flushMetaSave();
    flushSettings();

    // Step 3: clear this store...
    set({ root: null, files: [], error: null, hooksInstalled: null, hooksReadable: true });
    // ...and every other panel-owning selection. `useGraphStore` has no
    // public `reset()` — graph.ts is outside this lane's WO11 file zone
    // (lane UI-C) and the contract doesn't list one as a frozen cross-lane
    // seam. `setSelection([], [])` is the closest existing public surface;
    // it already clears the agents/tasks selections too (see its own doc
    // comment in store/graph.ts). Nothing here is load-bearing for
    // correctness either way: `loadGraph`/`loadAgents` both do a full reset
    // of their own store on the NEXT project open regardless of what was
    // left behind — this step is title-screen hygiene, not a data hazard.
    useGraphStore.getState().setSelection([], []);
    useAgentsStore.getState().select(null);
    useTasksStore.getState().select(null);
    useEventsStore.getState().clear();
    useReviewStore.getState().dismissAll();
    useProjectSelectionStore.getState().select(false);
  },
}));
