// Derived (never persisted) handle-pair choice for an edge (contract §7.11).
// Pure function of the two nodes' canvas positions — used at render time in
// GraphCanvas's store→RF edge mapping so an edge between vertically stacked
// cards routes through their top/bottom handles instead of the mid-height
// left/right pair, which would otherwise cut straight through a card in
// between. MemoryEdge / graph.json gain no sourceHandle/targetHandle field.

import type { MemoryNode } from "../store/graph";

export interface HandlePick {
  sourceHandle: string;
  targetHandle: string;
}

export function pickHandles(source: MemoryNode, target: MemoryNode): HandlePick {
  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;

  // Vertical delta dominates ⇒ route top-to-bottom (or bottom-to-top),
  // never through the card's mid-height side handles.
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy >= 0
      ? { sourceHandle: "s-bottom", targetHandle: "t-top" }
      : { sourceHandle: "s-top", targetHandle: "t-bottom" };
  }
  // Horizontal run (including "target behind source") ⇒ the normal
  // left-to-right pair; the bulging curvature in MemoryEdge keeps the line
  // off the card when the target sits behind the source.
  return { sourceHandle: "s-right", targetHandle: "t-left" };
}
