// The only two invoke() calls of the Compile module (Phase 2 spec §3).
// Rust rejects with a plain string ONLY for infrastructure failures; graph
// problems come back as CompilePreview.errors.

import { invoke } from "@tauri-apps/api/core";
import type { ApprovedFile, CompilePreview } from "./types";

// WO13_CONTRACT.md §10.1: `overlay` stands in for files not yet on disk (a
// draft node's body, or unsaved edits) so the wizard's live preview and the
// step-4 diff can share one compiler instead of inventing a second one.
// Defaulted here — not left to Tauri's optional-argument tolerance — so
// this wrapper's own `invoke` call always sends the key explicitly, per the
// contract's "every TS call site sends the key explicitly" rule.
export function compilePreview(
  root: string,
  graphJson: string,
  overlay: ApprovedFile[] = [],
): Promise<CompilePreview> {
  return invoke<CompilePreview>("compile_preview", { root, graphJson, overlay });
}

export function compileWrite(root: string, files: ApprovedFile[]): Promise<string[]> {
  return invoke<string[]>("compile_write", { root, files });
}
