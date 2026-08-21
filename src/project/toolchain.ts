// AI toolchain detection — the TS half of `src-tauri/src/toolchain.rs`.
// Feeds the title screen's toolchain panel and its details modal.

import { invoke } from "@tauri-apps/api/core";
import type { CompileTarget } from "../store/graph";

/** Mirrors Rust `toolchain::AiTool` (camelCase over the wire). */
export interface AiTool {
  /** The `CompileTarget` wire value, NOT a tool name — `"agents"` is the
   *  AGENTS.md target that Codex reads. */
  id: CompileTarget;
  name: string;
  /** The binary as a user would type it (`gh copilot`, not `gh`). */
  cmd: string;
  /** The file this target compiles to. */
  emits: string;
  found: boolean;
  /** null when absent, or present but slow to answer `--version`. */
  version: string | null;
  path: string | null;
}

/** Scan PATH for every tool Cowtext can compile for. Always resolves with one
 *  entry per target, found or not — never a short list. */
export function detectAiTools(): Promise<AiTool[]> {
  return invoke<AiTool[]>("detect_ai_tools");
}
