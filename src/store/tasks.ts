// Tasks store (TASKBOARD_BATCH_CONTRACT.md §7) — state behind the SCRUM-like
// board. Tasks are lines in the four convention files (TASKS/SPRINT/BACKLOG/
// ROADMAP.md); every mutation goes through the Rust line-surgery commands and
// the store re-adopts the returned item. fs://change events on those files
// (external edits, incl. Claude Code sessions) trigger a debounced reload via
// onTaskFileChange, called from the events.ts listener.

import { create } from "zustand";
import {
  taskAppend,
  taskMove,
  tasksScan,
  taskToggle,
  type TaskFileInfo,
  type TaskItem,
} from "../tasks/api";

// UI convenience: the board imports its wire types from the store.
export type { TaskFileInfo, TaskItem, TaskSource } from "../tasks/api";

export const TASK_FILE_NAMES = ["TASKS.md", "SPRINT.md", "BACKLOG.md", "ROADMAP.md"] as const;

/** Is this relPath one of the four convention files (any allowed dir)? */
export function isTaskFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const base = (normalized.split("/").pop() ?? "").toUpperCase();
  if (!(TASK_FILE_NAMES as readonly string[]).includes(base)) return false;
  const dir = normalized.slice(0, normalized.length - base.length).toLowerCase();
  return dir === "" || dir === "docs/" || dir === "docs/tasks/";
}

interface TasksState {
  root: string | null;
  loading: boolean;
  error: string | null;
  files: TaskFileInfo[];
  tasks: TaskItem[];
  /** null = all agents; "producer" additionally matches agent === null. */
  agentFilter: string | null;

  load(root: string): Promise<void>;
  setAgentFilter(agent: string | null): void;
  toggle(item: TaskItem, done: boolean): Promise<string | null>;
  append(relPath: string, text: string): Promise<string | null>;
  move(item: TaskItem, toRelPath: string): Promise<string | null>;
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined;

/** Called by events.ts for every fs://change; reloads (debounced 500 ms)
 *  when a convention task file changed on disk. */
export function onTaskFileChange(relPath: string): void {
  if (!isTaskFile(relPath)) return;
  const { root } = useTasksStore.getState();
  if (root === null) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    const s = useTasksStore.getState();
    if (s.root !== null) void s.load(s.root);
  }, 500);
}

export const useTasksStore = create<TasksState>((set, get) => ({
  root: null,
  loading: false,
  error: null,
  files: [],
  tasks: [],
  agentFilter: null,

  load: async (root) => {
    set({ root, loading: true, error: null });
    try {
      const scan = await tasksScan(root);
      // Drop the result if another project was opened while scanning.
      if (get().root !== root) return;
      set({ files: scan.files, tasks: scan.tasks, loading: false });
    } catch (e) {
      if (get().root !== root) return;
      set({ error: String(e), loading: false });
    }
  },

  setAgentFilter: (agent) => set({ agentFilter: agent }),

  toggle: async (item, done) => {
    const root = get().root;
    if (root === null) return "No project open";
    try {
      const updated = await taskToggle(root, item.relPath, item.line, done);
      set((st) => ({ tasks: st.tasks.map((t) => (t.id === item.id ? updated : t)) }));
      return null;
    } catch (e) {
      // Stale line etc. — a rescan resolves it.
      void get().load(root);
      return String(e);
    }
  },

  append: async (relPath, text) => {
    const root = get().root;
    if (root === null) return "No project open";
    try {
      await taskAppend(root, relPath, text);
      await get().load(root);
      return null;
    } catch (e) {
      return String(e);
    }
  },

  move: async (item, toRelPath) => {
    const root = get().root;
    if (root === null) return "No project open";
    try {
      await taskMove(root, item.relPath, item.line, toRelPath);
      await get().load(root);
      return null;
    } catch (e) {
      void get().load(root);
      return String(e);
    }
  },
}));
