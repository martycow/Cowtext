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

export function taskMove(
  root: string,
  fromRelPath: string,
  line: number,
  toRelPath: string,
): Promise<TaskItem> {
  return invoke<TaskItem>("task_move", { root, fromRelPath, line, toRelPath });
}
