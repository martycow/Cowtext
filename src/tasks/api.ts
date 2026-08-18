// Frontend IPC wrapper for the task-board backend commands
// (TASKBOARD_BATCH_CONTRACT.md §3). This is the ONLY file allowed to hold
// these four invoke() calls; the store imports from here, nobody invokes
// directly. Paths are confined server-side to the four convention files.

import { invoke } from "@tauri-apps/api/core";

export type TaskSource = "table" | "checklist";

export interface TaskItem {
  id: string; // "<relPath>#<line>"
  relPath: string;
  line: number; // 1-based
  source: TaskSource;
  name: string;
  description: string;
  tags: string[];
  priority: string | null;
  phase: string | null;
  agent: string | null;
  done: boolean;
  status: string | null;
  /** Nearest preceding ## heading in the file (sprint grouping); scan-only. */
  section: string | null;
  /** First time token in the line (ISO date / Q1-Q4 / Phase N); scan-only. */
  when: string | null;
}

/** Editable field set for task_update — send only the keys to change;
 *  null clears a field (name may never be cleared). */
export interface TaskPatch {
  name?: string | null;
  description?: string | null;
  tags?: string[] | null;
  priority?: string | null;
  phase?: string | null;
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
  files: TaskFileInfo[]; // always 4, convention order TASKS/SPRINT/BACKLOG/ROADMAP
  tasks: TaskItem[];
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
