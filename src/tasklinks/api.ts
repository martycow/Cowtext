// Frontend IPC wrapper for `.cowtext/tasklinks.json` (WO06_CONTRACT.md §3.2,
// commands 58-60). This is the ONLY file allowed to invoke these three
// commands — other modules import from here, never invoke directly.
// Written only by Rust (§3.2 L1): every mutation returns the whole new
// `TaskLinks` document and the caller re-adopts it wholesale (§8) — there is
// no partial-patch shape on the wire.

import { invoke } from "@tauri-apps/api/core";

/** One task's links (contract §3.2). `nodeIds` are the subgraph injection
 *  seeds; `sessionIds` hold `claudeSessionId` values, never Cowtext's
 *  in-memory `as<N>` session id. Optional fields are OMITTED on the wire
 *  when absent (serde `skip_serializing_if`), never sent as `null`. */
export interface TaskLink {
  taskId: string;
  nodeIds: string[];
  sessionIds: string[];
  parentTaskId?: string;
  tokenCeiling?: number;
}

/** The whole sidecar document. A missing file reads as `{version:1,links:[]}`. */
export interface TaskLinks {
  version: number;
  links: TaskLink[];
}

export function tasklinksRead(root: string): Promise<TaskLinks> {
  return invoke<TaskLinks>("tasklinks_read", { root });
}

/** Upsert one entry — never a whole-document write (contract §7 note on
 *  59/60: two UI paths writing the whole file could clobber each other). */
export function tasklinkSet(root: string, link: TaskLink): Promise<TaskLinks> {
  return invoke<TaskLinks>("tasklink_set", { root, link });
}

/** Unknown id ⇒ no-op success. */
export function tasklinkDelete(root: string, taskId: string): Promise<TaskLinks> {
  return invoke<TaskLinks>("tasklink_delete", { root, taskId });
}
