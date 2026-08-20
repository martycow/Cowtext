// Pure viewport-geometry helpers for node placement (contract §7.7, items
// #9/#16). No React, no store — GraphCanvas and NodeWizard both call these.

/** Plate footprint used when centring a freshly created node. Mirrors the
 *  rendered MemoryNodeCard's default box — `w-node` wide, and the memory
 *  plate's own height (the agent plate runs ~10px taller, but the wizard
 *  only ever creates a memory plate at this point). */
export const NODE_CARD_W = 244;
export const NODE_CARD_H = 93;

/** Flow-space top-left for a card centred in the current viewport.
 *  Uses the RF viewport transform + the pane's own size — never client
 *  left/top, so a scrolled or offset page can't skew it. */
export function viewportCenterPosition(
  viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  const { x, y, zoom } = viewport;
  const flowCenterX = (size.width / 2 - x) / zoom;
  const flowCenterY = (size.height / 2 - y) / zoom;
  return {
    x: Math.round(flowCenterX - NODE_CARD_W / 2),
    y: Math.round(flowCenterY - NODE_CARD_H / 2),
  };
}

// ── Where a fresh node lands (WO10 item 7) ────────────────────────────
// The canvas toolbar could already place a node at the viewport centre,
// because it runs INSIDE <ReactFlowProvider> and can call useReactFlow().
// Adopting from the Hierarchy could not: that panel lives outside the
// provider, and the graph store — which is where `adoptFile` runs — is not a
// React component at all. So it fell back to a fixed 4-column cascade from
// (80, 80) and could drop a node kilometres off-screen.
//
// A module-scope probe, registered by GraphCanvas on mount, is the smallest
// thing that fixes it without either dragging React Flow's context into the
// store or duplicating the transform maths in a second place. It is
// deliberately a nullable function: with no canvas mounted (headless tests,
// the Barn view) there is no viewport to centre on, and callers fall back.

let probe: (() => { x: number; y: number }) | null = null;

/** Called by GraphCanvas. Pass `null` on unmount so a stale closure over a
 *  dead React Flow instance can never be consulted. */
export function registerViewportCenter(fn: (() => { x: number; y: number }) | null): void {
  probe = fn;
}

/** Flow-space top-left for a card centred in the live viewport, or `null`
 *  when no canvas is mounted. */
export function viewportCenter(): { x: number; y: number } | null {
  return probe === null ? null : probe();
}
