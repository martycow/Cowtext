// Frontend IPC wrapper for per-task subgraph injection (WO06_CONTRACT.md §4,
// commands 61-62). This is the ONLY file allowed to invoke these two
// commands. `TaskContext` holds the errors-XOR-body invariant exactly as
// `compile_preview`'s `CompilePreview` does (§1.7): `errors` non-empty ⇒
// `body === ""` and `nodeIds === []`.

import { invoke } from "@tauri-apps/api/core";

export type TaskContextError =
  | { kind: "emptySubgraph" }
  | { kind: "unknownTask"; taskId: string }
  | { kind: "parentCycle"; path: string[] }
  | { kind: "missingFile"; nodeId: string; filePath: string }
  | { kind: "compile"; message: string };

export interface TaskContext {
  taskId: string;
  /** The effective closure (§4.1), sorted byte-order — the seeds actually
   *  used to compile `body`. */
  nodeIds: string[];
  /** The compiled CLAUDE.md-shaped body, GENERATED header on line 1, taken
   *  verbatim from `compile_preview`. */
  body: string;
  /** `body`'s byte length, before any boot-prompt truncation is applied at
   *  spawn time. */
  bytes: number;
  errors: TaskContextError[];
}

/** Boot-prompt injection cap (contract §4.3) — mirrors
 *  `taskctx::TASK_CONTEXT_MAX_BYTES` on the Rust side. Surfaced so the
 *  preview can warn when `body` will be truncated at spawn time. */
export const TASK_CONTEXT_MAX_BYTES = 32 * 1024;

export function taskContextPreview(
  root: string,
  taskId: string,
  graphJson: string,
): Promise<TaskContext> {
  return invoke<TaskContext>("task_context_preview", { root, taskId, graphJson });
}

/** Optional durable artifact: `.cowtext/context/task-<taskId>.md`. Resolves
 *  to the written relPath. */
export function taskContextWrite(root: string, taskId: string, content: string): Promise<string> {
  return invoke<string>("task_context_write", { root, taskId, content });
}
