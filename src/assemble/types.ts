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

/** Emitted by Rust as "assemble://status" on every job transition.
 *  WO13_CONTRACT.md §3.3 (defect 5): `status` stays authoritative — `phase`
 *  and `startedAt` are additive telemetry for a real 3-step stepper
 *  (`starting → running → writing`) with a live elapsed readout, replacing
 *  the old fixed-width blink with nothing behind it. No percentage: the
 *  runner is one-shot and non-streaming, so there is no denominator. */
export interface AssembleProgress {
  nodeId: string;
  /** "queued" | "running" | "assembled" | "error" */
  status: string;
  /** "queued" | "starting" | "running" | "writing" | "done" | "error" */
  phase: string;
  /** Epoch ms the job entered "starting"; `null` only for the initial
   *  "queued" event, present and unchanged for every later event of the
   *  same job. */
  startedAt: number | null;
  /** Set only when status === "error". */
  error: string | null;
}

/** F7: the exact prompt an assemble/refine/summarize call would send, plus
 *  enough to render the confirmation gate. `oldContent: null` means the
 *  target file does not exist yet — assemble will create it. */
export interface AssemblePreview {
  prompt: string;
  relPath: string;
  oldContent: string | null;
  neighbors: string[];
  mode: AssembleMode;
}
