// Lint wire types — mirrors the Rust structs in src-tauri/src/lint.rs
// EXACTLY (WO03 Lane E, extended WO13 Lane R2 — see lint.rs's module doc).
// Do not change shapes without a contract revision; this is the real wire
// shape, not a placeholder pending reconciliation.

import type { NodeRole } from "../store/graph";

/** Kebab-case on the wire (`#[serde(rename_all = "kebab-case")]`). WO13
 *  (WO13_CONTRACT.md §11.2): `conflicts-with` is renamed `contradicts`;
 *  `superseded-but-pinned` is RETIRED (its edge kind no longer exists on
 *  the v5 wire). Nine new codes added. */
export type LintCode =
  | "cycle"
  | "missing-file"
  | "dangling-edge"
  | "contradicts"
  | "duplicate-title"
  | "near-duplicate-content"
  | "readme-duplication"
  | "stale-last-verified"
  | "sequence-not-co-resident"
  | "override-not-co-resident"
  | "structural-edge-into-deprecated"
  | "orphan-node"
  | "unreachable-import"
  | "always-budget-exceeded"
  | "duplicate-imports"
  | "command-may-be-env"
  | "edge-legality-warning";

/** Lowercase on the wire (`#[serde(rename_all = "lowercase")]`). WO13 adds
 *  a third tier, `info`, below `warning` — used only by `duplicate-imports`. */
export type Severity = "error" | "warning" | "info";

/** A small closed enum of graph edits (WO13_CONTRACT.md §11.3), applied by
 *  the frontend through the EXISTING graph-store actions
 *  (`deleteEdges`/`updateNode`/`addEdge`) — every fix is reversible via
 *  existing undo for free, and lint itself never mutates the graph.
 *  Tagged on `kind`, camelCase (`#[serde(tag = "kind", rename_all =
 *  "camelCase")]`). */
export type LintFix =
  | { kind: "dropEdge"; edgeId: string }
  | { kind: "retypeNode"; nodeId: string; role: NodeRole }
  | { kind: "addImports"; source: string; target: string };

/** One lint finding. `nodeIds`/`edgeIds`/`filePath`/`fix` are the
 *  navigation/action handles the Problems panel uses — Rust omits them
 *  from the wire when empty/absent (`skip_serializing_if`), so they are
 *  optional here, never `null`/`[]` guaranteed. */
export interface LintItem {
  code: LintCode;
  severity: Severity;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
  filePath?: string;
  fix?: LintFix;
}

export interface Problems {
  items: LintItem[];
}

/** Human label for a LintCode — used by the Problems panel; not part of
 *  the wire shape. */
export const LINT_CODE_LABELS: Record<LintCode, string> = {
  cycle: "cycle",
  "missing-file": "missing file",
  "dangling-edge": "dangling edge",
  contradicts: "contradicts",
  "duplicate-title": "duplicate title",
  "near-duplicate-content": "near-duplicate content",
  "readme-duplication": "duplicates README",
  "stale-last-verified": "stale",
  "sequence-not-co-resident": "sequence not co-resident",
  "override-not-co-resident": "override not co-resident",
  "structural-edge-into-deprecated": "structural edge into deprecated",
  "orphan-node": "orphan node",
  "unreachable-import": "unreachable import",
  "always-budget-exceeded": "always-budget exceeded",
  "duplicate-imports": "duplicate import",
  "command-may-be-env": "command may be env",
  "edge-legality-warning": "edge legality",
};
