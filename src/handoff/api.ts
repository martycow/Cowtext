// The only invoke() calls of the Handoff module (PHASE56_CONTRACT §3).
// Names are byte-exact mirrors of the lib.rs generate_handler entries.

import { invoke } from "@tauri-apps/api/core";
import type { HandoffResult } from "./types";

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
