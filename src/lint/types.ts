// Lint wire types — mirrors the Rust structs in src-tauri/src/lint.rs
// EXACTLY (WO03 Lane E, already landed at the time this lane wrote this
// file — see LintCode/Severity/LintItem/Problems there). Do not change
// shapes without a contract revision; this is the real wire shape, not a
// placeholder pending reconciliation (unlike src/import/types.ts, whose
// Rust side — Lane D — had not landed yet).

/** Kebab-case on the wire (`#[serde(rename_all = "kebab-case")]`). */
export type LintCode =
  | "cycle"
  | "missing-file"
  | "dangling-edge"
  | "conflicts-with"
  | "duplicate-title"
  | "near-duplicate-content"
  | "readme-duplication"
  | "stale-last-verified"
  | "superseded-but-pinned";

/** Lowercase on the wire (`#[serde(rename_all = "lowercase")]`). */
export type Severity = "error" | "warning";

/** One lint finding. `nodeIds`/`edgeIds`/`filePath` are the navigation
 *  handles the Problems panel uses to jump to the offender — Rust omits
 *  them from the wire when empty/absent (`skip_serializing_if`), so they
 *  are optional here, never `null`/`[]` guaranteed. */
export interface LintItem {
  code: LintCode;
  severity: Severity;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
  filePath?: string;
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
  "conflicts-with": "conflict",
  "duplicate-title": "duplicate title",
  "near-duplicate-content": "near-duplicate content",
  "readme-duplication": "duplicates README",
  "stale-last-verified": "stale",
  "superseded-but-pinned": "superseded but pinned",
};
