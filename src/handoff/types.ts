// Handoff wire types — mirrors the Rust structs in src-tauri/src/handoff.rs
// exactly (PHASE56_CONTRACT §3 / §8.3). Do not change shapes without a
// contract revision.

export interface HandoffResult {
  content: string;
  oldContent: string | null;
}
