// Frontend IPC wrapper for the task-board backend commands
// (TASKBOARD_BATCH_CONTRACT.md §3). This is the ONLY file allowed to hold
// these invoke() calls; the store imports from here, nobody invokes
// directly. Paths are confined server-side to the five convention files.

import { invoke } from "@tauri-apps/api/core";

export type TaskSource = "table" | "checklist";

export interface TaskItem {
  id: string; // "<relPath>#<line>"
  relPath: string;
  line: number; // 1-based
  source: TaskSource;
  name: string;
  description: string | null;
  tags: string[];
  priority: string | null;
  phase: string | null;
  /** Header-driven "Task Type" cell (F6): synonyms `Task Type`|`Type`|`Kind`.
   *  Table-only, like `phase` — always `null` for checklist tasks. */
  taskType: string | null;
  agent: string | null;
  done: boolean;
  status: string | null;
  /** Nearest preceding ## heading in the file (sprint grouping); scan-only. */
  section: string | null;
  /** First time token in the line (ISO date / Q1-Q4 / Phase N); scan-only. */
  when: string | null;
  /** Stable task id lifted out of the Tags cell (WO06 §3.1). null until minted
   *  via `task_id_ensure`. */
  taskId: string | null;
  /** Stable ids this task depends on, lifted from `needs:` tokens. Order as
   *  written (WO06 §3.1). */
  dependsOn: string[];
  /** Scan-only: true if any dependency resolves to a task whose status !=
   *  "done". Always false from single-file commands — only `tasks_scan`
   *  computes it (WO06 §3.3 D1). */
  blocked: boolean;
}

/** One dependency edge that names a taskId no scanned task carries
 *  (WO06 §3.3 — TaskDag.unresolved). A typo must not deadlock the board, so
 *  this is reported, not treated as blocking. */
export interface UnresolvedDep {
  taskId: string;
  dependsOn: string;
}

/** Cross-file DAG derivation, appended to TasksScan (WO06 §3.3). Cycles are
 *  reported, never fatal — tasks_scan always succeeds. */
export interface TaskDag {
  /** Each entry is a task-id cycle path with the first id repeated last. */
  cycles: string[][];
  duplicateIds: string[];
  unresolved: UnresolvedDep[];
}

/** Editable field set for task_update — send only the keys to change;
 *  null clears a field (name may never be cleared). */
export interface TaskPatch {
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
  priority?: string | null;
  phase?: string | null;
  /** See {@link TaskItem.taskType}. */
  taskType?: string | null;
  agent?: string | null;
  status?: string | null;
  done?: boolean | null;
}

export interface TaskFileInfo {
  relPath: string;
  exists: boolean;
  taskCount: number;
}

export interface TasksScan {
  files: TaskFileInfo[]; // always 5, convention order TASKS/SPRINT/BACKLOG/ROADMAP/BUGS
  tasks: TaskItem[];
  dag: TaskDag;
}

export function tasksScan(root: string): Promise<TasksScan> {
  return invoke<TasksScan>("tasks_scan", { root });
}

export function taskToggle(
  root: string,
  relPath: string,
  line: number,
  done: boolean,
): Promise<TaskItem> {
  return invoke<TaskItem>("task_toggle", { root, relPath, line, done });
}

export function taskAppend(root: string, relPath: string, text: string): Promise<TaskItem> {
  return invoke<TaskItem>("task_append", { root, relPath, text });
}

export function taskUpdate(
  root: string,
  relPath: string,
  line: number,
  patch: TaskPatch,
): Promise<TaskItem> {
  return invoke<TaskItem>("task_update", { root, relPath, line, patch });
}

export function taskMove(
  root: string,
  fromRelPath: string,
  line: number,
  toRelPath: string,
): Promise<TaskItem> {
  return invoke<TaskItem>("task_move", { root, fromRelPath, line, toRelPath });
}

/** Mint (or return, idempotently) this task's stable id (WO06 §3.1, command
 *  55). No-op write if the line already carries an `id:` token. */
export function taskIdEnsure(root: string, relPath: string, line: number): Promise<TaskItem> {
  return invoke<TaskItem>("task_id_ensure", { root, relPath, line });
}

/** Add a `needs:<dependsOn>` dependency to this task (command 56). Rejects
 *  (distinct messages) a would-be cycle, a self-dependency, an unknown id,
 *  or an id present in `TaskDag.duplicateIds`. Both this task and the target
 *  must already carry a stable id — mint with `taskIdEnsure` first. */
export function taskDependsAdd(
  root: string,
  relPath: string,
  line: number,
  dependsOn: string,
): Promise<TaskItem> {
  return invoke<TaskItem>("task_depends_add", { root, relPath, line, dependsOn });
}

/** Remove a `needs:<dependsOn>` dependency from this task (command 57).
 *  Removing an absent dependency is a no-op success. */
export function taskDependsRemove(
  root: string,
  relPath: string,
  line: number,
  dependsOn: string,
): Promise<TaskItem> {
  return invoke<TaskItem>("task_depends_remove", { root, relPath, line, dependsOn });
}
