import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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
  openProject: () => Promise<void>;
  rescan: () => Promise<void>;
}

async function scan(root: string): Promise<ProjectScan> {
  return invoke<ProjectScan>("scan_project", { root });
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  root: null,
  files: [],
  scanning: false,
  error: null,

  openProject: async () => {
    const picked = await open({ directory: true, title: "Open project folder" });
    if (typeof picked !== "string") return; // cancelled
    set({ scanning: true, error: null });
    try {
      const result = await scan(picked);
      set({ root: result.root, files: result.files, scanning: false });
    } catch (e) {
      set({ scanning: false, error: String(e) });
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
}));
