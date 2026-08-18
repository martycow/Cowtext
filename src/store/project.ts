import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { hooksStatus } from "../fs/api";
import { useSettingsStore } from "./settings";

export interface MdFile {
  relPath: string;
  sizeBytes: number;
  modifiedMs: number | null;
}

interface ProjectScan {
  root: string;
  files: MdFile[];
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
}));
