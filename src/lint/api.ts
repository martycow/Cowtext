// The one invoke() call of the lint module. `lint_run` is now wired into
// lib.rs's `generate_handler!` list (WO03 Lane E landed it) and its wire
// shape in ./types.ts is confirmed byte-exact against lint.rs. The caller
// (ProblemsPanel) still treats a "Command lint_run not found" rejection as
// "problems unavailable" rather than crashing — defensive against a build
// that somehow ships without the Rust side rebuilt — but any OTHER
// rejection (e.g. a corrupt graph.json) is a real error, not that state
// (WO03 audit D7).

import { invoke } from "@tauri-apps/api/core";
import type { Problems } from "./types";

export function lintRun(root: string): Promise<Problems> {
  return invoke<Problems>("lint_run", { root });
}
