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
