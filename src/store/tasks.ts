// Tasks store (TASKBOARD_BATCH_CONTRACT.md §7) — state behind the SCRUM-like
// board. Tasks are lines in the five convention files (TASKS/SPRINT/BACKLOG/
// ROADMAP/BUGS.md); every mutation goes through the Rust line-surgery commands and
// the store re-adopts the returned item. fs://change events on those files
// (external edits, incl. Claude Code sessions) trigger a debounced reload via
// onTaskFileChange, called from the events.ts listener.

import { create } from "zustand";
import {
  taskAppend,
  taskDependsAdd,
  taskDependsRemove,
  taskIdEnsure,
  taskMove,
  tasksScan,
  taskToggle,
  taskUpdate,
  type TaskDag,
  type TaskFileInfo,
  type TaskItem,
  type TaskPatch,
} from "../tasks/api";

// UI convenience: the board imports its wire types from the store.
export type { TaskDag, TaskFileInfo, TaskItem, TaskPatch, TaskSource, UnresolvedDep } from "../tasks/api";

/** Empty DAG — used before the first scan lands and as a defensive fallback
 *  if a scan response predates WO06 G1 (backend not yet carrying `dag`). */
const EMPTY_DAG: TaskDag = { cycles: [], duplicateIds: [], unresolved: [] };

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

// #14 — order MUST match Rust CONVENTION_NAMES exactly (positional coupling,
// WO02_CONTRACT.md §7.11). BUGS.md is appended last; never reorder.
export const TASK_FILE_NAMES = [
  "TASKS.md",
  "SPRINT.md",
  "BACKLOG.md",
  "ROADMAP.md",
  "BUGS.md",
] as const;

// #13 — canonical priority buckets (mirrors Rust bucket_for_priority_input).
export type TaskPriority = "low" | "medium" | "high" | "critical";

export const TASK_PRIORITIES: readonly TaskPriority[] = ["low", "medium", "high", "critical"];

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "CRITICAL",
};

/** Mirrors Rust bucket_for_priority_input: trim, ASCII-lowercase, -/_ -> space,
 *  collapse whitespace, then match against the canonical vocabulary and its
 *  aliases. null = no priority / unrecognized. */
export function normalizePriority(raw: string | null): TaskPriority | null {
  if (raw === null) return null;
  const norm = raw
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  switch (norm) {
    case "low":
    case "l":
    case "p3":
      return "low";
    case "medium":
    case "med":
    case "normal":
    case "m":
    case "p2":
      return "medium";
    case "high":
    case "h":
    case "p1":
      return "high";
    case "critical":
    case "crit":
    case "blocker":
    case "urgent":
    case "p0":
      return "critical";
    default:
      return null;
  }
}

/** Builds a COMPLETE `TaskPatch` from `item`, then applies `overrides`.
 *
 *  `task_update` is a full-field replace, not a merge: its doc comment
 *  (tasks.rs §R3) states that an absent key — like an explicit `null` —
 *  means "clear this field" for every mapped column. So any caller that
 *  sends a partial patch silently wipes every column it failed to mention,
 *  and each new column (F6's `taskType`) multiplies the blast radius of a
 *  hand-maintained field list.
 *
 *  Every mutation that is not a full-form edit MUST go through this helper;
 *  full-form editors (the Inspector's TaskPanel) build on it too and pass
 *  their edited values as `overrides`, so a newly added column defaults to
 *  "preserve" instead of "destroy".
 *
 *  `phase`/`taskType` are table-only fields: the checklist regenerator
 *  ignores them, and they are always `null` on a checklist item anyway, so
 *  passing them through unconditionally is safe for both sources.
 *  Reserved `id:`/`needs:` tokens are never present in `item.tags` (Rust
 *  lifts them into `taskId`/`dependsOn` at parse time and re-emits them
 *  from the current line), so this can never smuggle one back in. */
export function fullPatch(item: TaskItem, overrides: TaskPatch = {}): TaskPatch {
  return {
    name: item.name,
    description: item.description,
    tags: item.tags,
    priority: item.priority,
    phase: item.phase,
    taskType: item.taskType,
    agent: item.agent,
    status: statusOf(item),
    done: item.done,
    ...overrides,
  };
}

/** Unique tags across every scanned task, case-insensitively deduped
 *  (first-seen casing wins), sorted alphabetically (localeCompare). */
export function allTags(tasks: TaskItem[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tasks) {
    for (const tag of t.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** Is this relPath one of the five convention files (any allowed dir)? */
export function isTaskFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const base = (normalized.split("/").pop() ?? "").toUpperCase();
  if (!TASK_FILE_NAMES.some((n) => n.toUpperCase() === base)) return false;
  const dir = normalized.slice(0, normalized.length - base.length).toLowerCase();
  return dir === "" || dir === "docs/" || dir === "docs/tasks/";
}

interface TasksState {
  root: string | null;
  loading: boolean;
  error: string | null;
  files: TaskFileInfo[];
  tasks: TaskItem[];
  /** Cross-file DAG derivation from the most recent scan (WO06 §3.3). */
  dag: TaskDag;
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
  /** O1 fix: routes to `toggle` (checklist primitive) for checklist rows,
   *  and to a full-field `update` for table rows — `task_toggle` genuinely
   *  refuses table rows server-side. Carries every editable field so an
   *  omitted cell (esp. `phase`) is never silently cleared. */
  toggleAny(item: TaskItem, done: boolean): Promise<string | null>;
  append(relPath: string, text: string): Promise<string | null>;
  move(item: TaskItem, toRelPath: string): Promise<string | null>;
  /** Idempotent: no-op if `item` already carries a stable id. */
  ensureId(item: TaskItem): Promise<TaskItem | string>;
  /** Mints a stable id for `item` and `target` if either is missing one,
   *  then links `item` to `target` via `needs:`. Reloads afterward — blocked
   *  state and dag are cross-file derivations a single-file return can't
   *  carry (WO06 §8). */
  addDependency(item: TaskItem, target: TaskItem): Promise<string | null>;
  removeDependency(item: TaskItem, dependsOnId: string): Promise<string | null>;
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
  dag: EMPTY_DAG,
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
      set({ files: scan.files, tasks: scan.tasks, dag: scan.dag ?? EMPTY_DAG, loading: false, selected });
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
      // WO06 §8 / audit D8: a single-file return can't carry `blocked`/`dag`
      // (cross-file derivations) — reload so any task that depends on this
      // one re-evaluates instead of showing a stale Blocked badge.
      await get().load(root);
      return null;
    } catch (e) {
      void get().load(root);
      return String(e);
    }
  },

  // WO12 F6: the board's status control is the everyday way a card moves
  // between columns, and `task_update` replaces every mapped cell — a
  // two-key `{status, done}` patch cleared Name/Description/Tags/Priority/
  // Phase/Agent/Task Type on every drag (and, with Name cleared, the
  // backend rejected the write outright: "Task name cannot be empty").
  // Re-send the item's own values for everything except the status.
  setStatus: async (item, status) => {
    return get().update(item, fullPatch(item, { status, done: status === "done" }));
  },

  toggle: async (item, done) => {
    const root = get().root;
    if (root === null) return "No project open";
    try {
      const updated = await taskToggle(root, item.relPath, item.line, done);
      set((st) => ({ tasks: st.tasks.map((t) => (t.id === item.id ? updated : t)) }));
      // WO06 §8 / audit D8: recompute cross-file `blocked`/`dag` state — a
      // dependent task's Blocked badge must clear the instant this one is
      // marked done, not only after the fs watcher's 500ms debounce fires.
      await get().load(root);
      return null;
    } catch (e) {
      // Stale line etc. — a rescan resolves it.
      void get().load(root);
      return String(e);
    }
  },

  // O1 fix (WO06 §11): a checklist row can complete through task_toggle's
  // marker-only surgery, but a table row has no marker — task_toggle
  // genuinely refuses it server-side. Routing a table row through the same
  // full-field patch the Inspector's TaskPanel already uses means every
  // mapped cell (name/description/tags/priority/phase/taskType/agent) is
  // re-sent explicitly; omitting one (esp. `phase`) would clear it, since an
  // absent TaskPatch key means "clear this field", same trap set_cell
  // documents. WO12 F6: that hand-maintained list had already gone stale
  // once (`taskType`) — it now comes from `fullPatch`.
  toggleAny: async (item, done) => {
    if (item.source === "checklist") return get().toggle(item, done);
    return get().update(item, fullPatch(item, { status: done ? "done" : "new", done }));
  },

  ensureId: async (item) => {
    if (item.taskId !== null) return item;
    const root = get().root;
    if (root === null) return "No project open";
    try {
      const updated = await taskIdEnsure(root, item.relPath, item.line);
      set((st) => ({
        tasks: st.tasks.map((t) => (t.id === item.id ? updated : t)),
        selected: st.selected?.id === item.id ? updated : st.selected,
      }));
      // WO06 §8 / audit D8: minting an id can resolve a previously-unresolved
      // `needs:` reference elsewhere in the corpus (dag.unresolved shrinks) —
      // reload so that clears immediately rather than waiting on the watcher.
      await get().load(root);
      return updated;
    } catch (e) {
      return String(e);
    }
  },

  addDependency: async (item, target) => {
    const root = get().root;
    if (root === null) return "No project open";
    try {
      // Both ends need a stable id before a `needs:` token can name either
      // of them — mint on demand (WO06 §3.1: "ids appear only when the user
      // first links a task to something").
      let self = item;
      if (self.taskId === null) {
        const ensured = await get().ensureId(self);
        if (typeof ensured === "string") throw new Error(ensured);
        self = ensured;
      }
      let dep = target;
      if (dep.taskId === null) {
        const ensured = await get().ensureId(dep);
        if (typeof ensured === "string") throw new Error(ensured);
        dep = ensured;
      }
      if (dep.taskId === null) throw new Error("could not mint an id for the dependency target");
      const updated = await taskDependsAdd(root, self.relPath, self.line, dep.taskId);
      set((st) => ({
        tasks: st.tasks.map((t) => (t.id === self.id ? updated : t)),
        selected: st.selected?.id === self.id ? updated : st.selected,
      }));
      // blocked / dag are cross-file derivations only tasks_scan computes.
      await get().load(root);
      return null;
    } catch (e) {
      await get().load(root);
      return String(e);
    }
  },

  removeDependency: async (item, dependsOnId) => {
    const root = get().root;
    if (root === null) return "No project open";
    try {
      const updated = await taskDependsRemove(root, item.relPath, item.line, dependsOnId);
      set((st) => ({
        tasks: st.tasks.map((t) => (t.id === item.id ? updated : t)),
        selected: st.selected?.id === item.id ? updated : st.selected,
      }));
      await get().load(root);
      return null;
    } catch (e) {
      await get().load(root);
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
