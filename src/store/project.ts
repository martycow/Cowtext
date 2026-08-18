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
}));
