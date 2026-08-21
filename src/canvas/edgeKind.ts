// STRUCTURAL vs advisory edge-kind classification (WO03; re-cut for v5's 5
// edge kinds and the `affectsOutput`/`edgeParticipatesInOrder` split,
// WO13_CONTRACT.md §9) — split out of MemoryEdge.tsx into its own module so
// that file stays component-only (react-refresh/only-export-components)
// while the Inspector's EdgePanel and anything else that needs the same
// classification import ONE source of truth, not a hand-copied list.
//
// TWO SEPARATE, DIFFERENTLY-NAMED PREDICATES (§9, frozen) — the edge spec
// calls four of five kinds "structural", meaning "changes compiled output".
// This repo's `is_structural()` means "participates in topological ordering
// / Kahn's algorithm / cycle validation" (mirrors Rust's
// `EdgeKind::is_structural`, `project.rs`). If `references` inherited the
// spec's sense it would enter Kahn's algorithm and every `@path` pointer
// would become an ordering constraint — phantom cycles on graphs that have
// none.

import type { EdgeKind } from "../store/graph";

/** Participates in Kahn's algorithm / cycle validation / topological order.
 *  UNCHANGED MEANING (WO03): `imports | sequence | overrides`. Mirrors
 *  Rust's `EdgeKind::is_structural`, `project.rs`. */
export function isStructuralEdgeKind(kind: EdgeKind): boolean {
  return kind === "imports" || kind === "sequence" || kind === "overrides";
}

/** The edge spec's taxonomy (§9): this kind changes what lands in a
 *  compiled file. Everything except `contradicts` (which the linter
 *  reports and the compiler never materializes). Mirrors Rust's
 *  `EdgeKind::affects_output`. */
export function affectsOutput(kind: EdgeKind): boolean {
  return kind !== "contradicts";
}

/** Ordering participation for a CONCRETE edge (§9). A guarded `imports`
 *  edge is conditional content, exactly as the old `conditional` kind was,
 *  and must NOT enter the ordering — doing so would change `total_order`
 *  and therefore the order of `## Always read` and of
 *  `.cursor/rules/*.mdc`. Mirrors Rust's `edge_participates_in_order`.
 *  `KindPicker`'s two group headers read `affectsOutput`; the canvas's
 *  solid-vs-dashed stroke reads `affectsOutput`; Kahn/cycle detection reads
 *  this function. */
export function edgeParticipatesInOrder(kind: EdgeKind, guarded: boolean): boolean {
  return isStructuralEdgeKind(kind) && !guarded;
}
