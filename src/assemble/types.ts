// Assemble wire types — mirrors the Rust structs in src-tauri/src/assemble.rs
// exactly (Phase 3+4 contract §1.1 / §3.3). Do not change shapes without a
// contract revision.

export type AssembleMode = "assemble" | "refine" | "summarize";

export type JobStatus = "queued" | "running";

export interface AssembleJobInfo {
  nodeId: string;
  mode: AssembleMode;
  status: JobStatus;
}

/** Emitted by Rust as "assemble://status" on every job transition. */
export interface AssembleProgress {
  nodeId: string;
  /** "queued" | "running" | "assembled" | "error" */
  status: string;
  /** Set only when status === "error". */
  error: string | null;
}
