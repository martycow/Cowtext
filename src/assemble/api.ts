// The five invoke() calls of the Assemble module (Phase 3+4 contract §1.1 /
// §3.3) — nothing else lives here. Rust rejects with a plain string only at
// enqueue time; everything after enqueue arrives via "assemble://status".

import { invoke } from "@tauri-apps/api/core";
import type { AssembleJobInfo } from "./types";

export function assembleNode(root: string, graphJson: string, nodeId: string): Promise<void> {
  return invoke("assemble_node", { root, graphJson, nodeId });
}

export function refineNode(
  root: string,
  graphJson: string,
  nodeId: string,
  instruction: string,
): Promise<void> {
  return invoke("refine_node", { root, graphJson, nodeId, instruction });
}

export function summarizeNode(root: string, graphJson: string, nodeId: string): Promise<void> {
  return invoke("summarize_node", { root, graphJson, nodeId });
}

export function assembleStatus(): Promise<AssembleJobInfo[]> {
  return invoke<AssembleJobInfo[]>("assemble_status", {});
}

/** Resolves true when a queued (not yet running) job was removed. */
export function assembleCancel(nodeId: string): Promise<boolean> {
  return invoke<boolean>("assemble_cancel", { nodeId });
}
