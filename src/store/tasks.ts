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
  taskUpdate,
  type TaskFileInfo,
  type TaskItem,
  type TaskPatch,
} from "../tasks/api";

// UI convenience: the board imports its wire types from the store.
export type { TaskFileInfo, TaskItem, TaskPatch, TaskSource } from "../tasks/api";

// ── Status model (contract Rev 2 R2) ───────────────────────────────────

export type TaskStatus = "new" | "in-production" | "in-testing" | "done";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "new",
  "in-production",
  "in-testing",
  "done",
];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  "new": "New",
  "in-production": "In production",
  "in-testing": "In testing",
  "done": "Done",
};

/** Normalized status of a task (Rust emits the enum; this is the defensive
 *  fallback for anything older/foreign). */
export function statusOf(item: TaskItem): TaskStatus {
  const s = item.status;
  if (s === "new" || s === "in-production" || s === "in-testing" || s === "done") return s;
  return item.done ? "done" : "new";
}

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
  /** Task shown in the Inspector's Properties panel (Rev 2 R4). */
  selected: TaskItem | null;

  load(root: string): Promise<void>;
  select(item: TaskItem | null): void;
  update(item: TaskItem, patch: TaskPatch): Promise<string | null>;
  setStatus(item: TaskItem, status: TaskStatus): Promise<string | null>;
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
  selected: null,

  load: async (root) => {
    set({ root, loading: true, error: null });
    try {
      const scan = await tasksScan(root);
      // Drop the result if another project was opened while scanning.
      if (get().root !== root) return;
      // Re-point the selection at the reloaded item (line may have shifted;
      // match by id first, then by relPath+name as the line-move fallback).
      const prev = get().selected;
      const selected =
        prev === null
          ? null
          : (scan.tasks.find((t) => t.id === prev.id) ??
             scan.tasks.find((t) => t.relPath === prev.relPath && t.name === prev.name) ??
             null);
      set({ files: scan.files, tasks: scan.tasks, loading: false, selected });
    } catch (e) {
      if (get().root !== root) return;
      set({ error: String(e), loading: false });
    }
  },

  setAgentFilter: (agent) => set({ agentFilter: agent }),

  select: (item) => set({ selected: item }),

  update: async (item, patch) => {
    const root = get().root;
    if (root === null) return "No project open";
    try {
      const updated = await taskUpdate(root, item.relPath, item.line, patch);
      set((st) => ({
        tasks: st.tasks.map((t) => (t.id === item.id ? updated : t)),
        selected: st.selected?.id === item.id ? updated : st.selected,
      }));
      return null;
    } catch (e) {
      void get().load(root);
      return String(e);
    }
  },

  setStatus: async (item, status) => {
    return get().update(item, { status, done: status === "done" });
  },

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
