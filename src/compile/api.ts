// The only two invoke() calls of the Compile module (Phase 2 spec §3).
// Rust rejects with a plain string ONLY for infrastructure failures; graph
// problems come back as CompilePreview.errors.

import { invoke } from "@tauri-apps/api/core";
import type { ApprovedFile, CompilePreview } from "./types";

export function compilePreview(root: string, graphJson: string): Promise<CompilePreview> {
  return invoke<CompilePreview>("compile_preview", { root, graphJson });
}

export function compileWrite(root: string, files: ApprovedFile[]): Promise<string[]> {
  return invoke<string[]>("compile_write", { root, files });
}
