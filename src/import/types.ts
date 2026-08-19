// Import wire types — RECONCILED against the landed src-tauri/src/import.rs
// (WO03 audit defect D3, docs/design/WO03_AUDIT.md). This file started as a
// best-effort placeholder written while Lane D's import.rs did not yet
// exist; the audit diffed it field-for-field against the real Rust structs
// and found two missing fields (`pinned`, `condition`) — both restored
// below, with Rust's own doc comments carried across. A third field,
// `compileOwned`, was added afterward when Lane D's D2 fix landed (refusing
// to adopt a proposed node whose path is one `compile` owns and
// overwrites — a hand-written CLAUDE.md, a `.cursor/rules/*.mdc`, etc.) —
// see ImportReviewModal.tsx's default-adopt logic and its per-row note.
// Everything else already matched exactly: `id`/`title`/`role`/`filePath`/
// `brief`/`sourceFile`/`alreadyManaged` on the node, `id`/`source`/
// `target`/`kind` on the edge, `ImportChangeset`, and `ImportApplyResult`'s
// `nodesAdded`/`edgesAdded`/`skipped`.

import type { EdgeKind, NodeRole } from "../store/graph";

export interface ImportProposedNode {
  /** Stable within THIS scan only — not a real graph node id until applied. */
  id: string;
  title: string;
  role: NodeRole;
  /** Where this node would live if adopted — usually the source file itself. */
  filePath: string;
  brief: string;
  /** The file this proposal was parsed out of, e.g. "CLAUDE.md",
   *  ".cursor/rules/api.mdc". Shown so a multi-file scan stays legible. */
  sourceFile: string;
  /** True when a GENERATED-header file (or an existing graph node at the
   *  same filePath) means this is "already managed" — contract: these
   *  report as already managed rather than as a fresh proposal. Rendered
   *  disabled/checked-off, never auto-excluded (still visible for review). */
  alreadyManaged: boolean;
  /** A `.mdc`'s frontmatter `alwaysApply: true` maps to this (contract:
   *  "alwaysApply ... maps to pinned ... semantics"). Always `false` for
   *  every non-`.mdc` source. An adopted always-apply rule that lands
   *  unpinned would be a real surprise, so this is surfaced in the review
   *  row, not just carried through silently. */
  pinned: boolean;
  /** True when `filePath` is a shape `compile` owns and overwrites
   *  (CLAUDE.md, AGENTS.md, .cursor/rules/*.mdc, ...) — adopting it would
   *  mean the very next Compile run silently replaces the user's
   *  hand-written content with generated output (WO03 audit D2). The
   *  review UI must default this row to NOT adopted, same as
   *  `alreadyManaged`, and explain why. `import_apply` independently
   *  refuses these regardless of what the client sends — this flag drives
   *  the UI's default state and explanation, not the enforcement. */
  compileOwned: boolean;
}

export interface ImportProposedEdge {
  /** Stable within THIS scan only. */
  id: string;
  /** ImportProposedNode.id (scan-local), not a graph node id. */
  source: string;
  target: string;
  kind: EdgeKind;
  /** Carries a `conditional` edge's glob pattern (from a `.mdc`'s
   *  frontmatter `globs`) through to import_apply — without it a
   *  `conditional` edge would apply with no condition at all, silently
   *  losing the contract's "globs ... maps to ... conditional semantics".
   *  Absent for every `imports`/`references` edge. */
  condition?: string;
}

export interface ImportChangeset {
  nodes: ImportProposedNode[];
  edges: ImportProposedEdge[];
  /** Human-readable, ready to render as-is (e.g. "skipped malformed rule
   *  file foo.mdc"). Advisory only — never blocks review. */
  warnings: string[];
}

/** import_apply's request body: the same shape as ImportChangeset, but
 *  already filtered down to only the adopted subset (never clobbers
 *  existing nodes; writes graph entries only, never file content — per
 *  the "Must-NOT-break" #3 rule in WO03_CONTRACT.md). */
export type ImportApproved = Pick<ImportChangeset, "nodes" | "edges">;

export interface ImportApplyResult {
  nodesAdded: number;
  edgesAdded: number;
  /** Adopted rows that turned out to already exist (race with another
   *  editor, or a second scan) — not an error, just not double-added. */
  skipped: number;
}
