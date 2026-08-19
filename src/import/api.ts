// The two invoke() calls of the import module. Both commands are now wired
// into lib.rs's `generate_handler!` list (WO03 Lane D landed import.rs) and
// ./types.ts is reconciled field-for-field against it (WO03 audit D3).
// Either call rejecting (bad root, corrupt graph.json, ...) surfaces as a
// real inline error in ImportReviewModal's failed phase — it never
// swallows a rejection into a fake "unavailable" state.

import { invoke } from "@tauri-apps/api/core";
import type { ImportApplyResult, ImportApproved, ImportChangeset } from "./types";

export function importScan(root: string): Promise<ImportChangeset> {
  return invoke<ImportChangeset>("import_scan", { root });
}

export function importApply(root: string, changeset: ImportApproved): Promise<ImportApplyResult> {
  return invoke<ImportApplyResult>("import_apply", { root, changeset });
}
