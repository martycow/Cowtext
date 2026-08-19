// Handoff wire types — mirrors the Rust structs in src-tauri/src/handoff.rs
// exactly (PHASE56_CONTRACT §3 / §8.3). Do not change shapes without a
// contract revision.

export interface HandoffResult {
  content: string;
  oldContent: string | null;
}

// ── Handoff → node (WO06_CONTRACT.md §6) ────────────────────────────────
// Verified field-by-field against `src-tauri/src/handoff.rs`'s
// `HandoffSessionInput` / `HandoffNodeProposal` structs (both
// `#[serde(rename_all = "camelCase")]`, neither carrying a struct-level
// `#[serde(default)]`). Every `Option<String>` field below is typed
// `string | null` (never optional `?`) and every call site sends the key
// explicitly with `null` rather than omitting it — deserializing an
// explicit JSON `null` into `Option<T>` is unambiguous serde behavior
// regardless of `#[serde(default)]`, so this sidesteps needing to confirm
// serde's missing-key-on-Option semantics for a struct that doesn't opt
// into the tolerant `default` attribute the way `GraphIn`/`EventIn` do.

/** Mirrors `HandoffSessionInput` (handoff.rs) — deliberately NOT a
 *  registry lookup, so the caller supplies exactly what it already has in
 *  `store/sessions.ts`'s `Session` shape. */
export interface HandoffSessionInput {
  id: string;
  name: string;
  agentFileName: string | null;
  cwd: string;
  claudeSessionId: string | null;
  /** u64 on the wire; always a non-negative integer here. */
  tokensUsed: number;
}

/** Mirrors `HandoffNodeProposal` (handoff.rs). A **proposal only** — Rust
 *  writes nothing (contract §1.12/§6). The frontend commits it via the
 *  existing `src/store/graph.ts` actions (`createNodeFrom` + `updateNode` +
 *  `beginConnection`/`confirmConnection`), never a new Rust write path. */
export interface HandoffNodeProposal {
  title: string;
  relPath: string;
  /** Wire type is a plain Rust `String`, not a role enum — always
   *  `"reference"` today per handoff.rs's doc comment, but kept as `string`
   *  here (not `NodeRole`) to mirror the Rust field byte-for-byte. Validated
   *  against `NODE_ROLES` at the one call site that needs a `NodeRole`. */
  role: string;
  brief: string;
  content: string;
  /** The WO03-reserved extension map (scalars only): `source`, `session`,
   *  `agent`, `task`, `producedAt`, `tokens` — always present, `task`/`agent`
   *  possibly empty strings. */
  meta: Record<string, string>;
  anchorNodeId: string | null;
}
