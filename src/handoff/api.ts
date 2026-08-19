// The only invoke() calls of the Handoff module (PHASE56_CONTRACT §3;
// WO06_CONTRACT §6 for handoff_node_propose). Names are byte-exact mirrors
// of the lib.rs generate_handler entries.

import { invoke } from "@tauri-apps/api/core";
import type { HandoffNodeProposal, HandoffResult, HandoffSessionInput } from "./types";

export function handoffGenerate(
  root: string,
  graphJson: string,
  eventsJson: string,
): Promise<HandoffResult> {
  return invoke<HandoffResult>("handoff_generate", { root, graphJson, eventsJson });
}

export function handoffWrite(root: string, content: string): Promise<string> {
  return invoke<string>("handoff_write", { root, content });
}

/** WO06 §6 — deterministic, no LLM call. Rust writes nothing: this only
 *  returns a `HandoffNodeProposal` for the caller to review and commit
 *  itself (see `HandoffNodeProposalModal`). `taskId` is sent explicitly as
 *  `null` rather than omitted when absent — see the field-by-field note at
 *  the top of `./types.ts`. */
export function handoffNodePropose(
  root: string,
  session: HandoffSessionInput,
  taskId: string | null,
  summary: string,
): Promise<HandoffNodeProposal> {
  return invoke<HandoffNodeProposal>("handoff_node_propose", { root, session, taskId, summary });
}
