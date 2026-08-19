// STRUCTURAL vs advisory edge-kind classification (WO03) — split out of
// MemoryEdge.tsx into its own module so that file stays component-only
// (react-refresh/only-export-components) while the Inspector's EdgePanel
// and anything else that needs the same classification import ONE source
// of truth, not a hand-copied list.

import type { EdgeKind } from "../store/graph";

/** STRUCTURAL edges affect compile order and can form cycles (mirrors Rust
 *  `EdgeKind::is_structural`, compile.rs); everything else is advisory,
 *  consumed only by the linter. */
export function isStructuralEdgeKind(kind: EdgeKind): boolean {
  return kind === "imports" || kind === "sequence" || kind === "overrides";
}
