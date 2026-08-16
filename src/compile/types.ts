// Compile wire types — mirrors the Rust structs in src-tauri/src/compile.rs
// exactly (Phase 2 spec §1.3 / §2.2). Do not change shapes without a spec rev.

import type { CompileTarget } from "../store/graph";

export interface NodeRef {
  id: string;
  title: string;
}

export type ValidationError =
  | { kind: "cycle"; nodes: NodeRef[] }
  | { kind: "missingFile"; nodeId: string; title: string; filePath: string }
  | { kind: "danglingEdge"; edgeId: string; edgeKind: string; missingEnd: string };

export interface PreviewFile {
  relPath: string;
  target: CompileTarget;
  oldContent: string | null;
  newContent: string;
  handwritten: boolean;
  unchanged: boolean;
}

export interface CompilePreview {
  errors: ValidationError[];
  files: PreviewFile[];
}

export interface ApprovedFile {
  relPath: string;
  content: string;
}
