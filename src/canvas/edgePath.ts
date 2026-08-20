// Edge routing — orthogonal, square corners (Barn canvas, direction C).
// Every edge leaves the source's output pin heading right and enters the
// target's input socket heading right, so the marker always meets the port
// straight-on. A forward run is out-stub → riser → in-stub; anything else
// (target behind or stacked) detours around the plates on a clearance lane
// instead of folding back across them — the "spaghetti" this replaces.
//
// Every segment is axis-aligned, which is what lets styles/index.css render
// edges with shape-rendering: crispEdges — a diagonal or a curve would
// alias into a staircase there, a horizontal 2px line stays exactly 2px.
// Pure geometry, no persistence.
//
// ── Landing math (WO09 round 2, docs/design/WO09_CONNECTOR_CONTRACT.md §2-3) ──
// React Flow's getHandlePosition (@xyflow/system, dist/esm/index.js:1442-1460)
// does NOT report the handle CENTRE for Position.Left/Right — it returns the
// handle border-box's OUTER edge (the left edge for Left, the right edge for
// Right). So `sourceX` arrives already AT the output shoulder's outer face
// and `targetX` arrives already AT the input bay's outer face; routing off
// those numbers unmodified would double-count a half-width gap that isn't
// there.
//
// Nodes paint over edges (RF's GraphView renders EdgeRenderer before
// NodeRenderer; both carry zIndex 0, so later DOM position — the node —
// wins), so anything a wire draws past the connector's outer face is hidden
// UNDER the plate, not floating past it. The frozen fix plugs the wire in:
// PIN_REACH pulls the start 4px inside the output pin (to R+14 of a pin
// that runs to R+18), SOCKET_BITE pushes the end 3px inside the input bay
// (to L−8 of a bay whose outer face is L−11). The arrowhead's tip is
// swallowed by the socket hardware with zero daylight at any zoom, while 8
// of its 11px stay outside and legible — kind is read from line style +
// marker, and that legibility is non-negotiable.
//
// These mirror table §3 of docs/design/WO09_CONNECTOR_CONTRACT.md — change
// them together with the .ct-port rules in styles/index.css and the slot
// constants in canvas/portSlots.ts.
import { slotOffset } from "./portSlots";

const STUB = 22; // straight clearance off each port before any turn
const MARGIN = 30; // lane clearance beyond the estimated plate edges
const NODE_W = 244; // --w-node: plates are fixed-width
const NODE_H = 128; // conservative plate height (103px typical + banners)
const PIN_REACH = 10; // G12: sx = sourceX + PIN_REACH → starts at R+14, 4px inside the R+18 pin tip
const SOCKET_BITE = 3; // G13: tx = targetX + SOCKET_BITE → ends at L−8, 3px inside the L−11 bay face
const RISER_STEP = 8; // G18: per-slot stagger of the fan-in/out turn column

export interface EdgeEnds {
  /** React Flow's sourceX: the OUTER edge of the output shell (R + G10). */
  sourceX: number;
  /** Port CENTRE y, unshifted. */
  sourceY: number;
  sourceSlot: number;
  /** React Flow's targetX: the socket's outer face (L − G8). */
  targetX: number;
  targetY: number;
  targetSlot: number;
}

export interface RoutedEdge {
  path: string;
  labelX: number;
  labelY: number;
}

/** Polyline → SVG path, corners left square. Collinear points are harmless
 *  (a zero-length segment renders as nothing), so callers can emit a fixed
 *  point list without special-casing the straight-across run. */
function sharpPath(pts: ReadonlyArray<readonly [number, number]>): string {
  const [x0, y0] = pts[0];
  return pts
    .slice(1)
    .reduce((d, [x, y]) => `${d} L ${x} ${y}`, `M ${x0} ${y0}`);
}

/** Does the vertical span [a, b] overlap the card band centred on `cy`? */
function crossesBand(a: number, b: number, cy: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return cy - NODE_H / 2 < hi && cy + NODE_H / 2 > lo;
}

/** Route from the source output port to the target input port. Ports are
 *  mid-height on the right/left card edges, so the source card spans
 *  [sourceX − NODE_W, sourceX] and the target card [targetX, targetX + NODE_W]
 *  (both measured from the ports' unshifted centres, i.e. before PIN_REACH /
 *  SOCKET_BITE / slot offsets are applied). `sourceSlot`/`targetSlot` are the
 *  contact-finger indices from canvas/portSlots.ts — 0..SLOT_COUNT-1, or
 *  CENTER_SLOT when a port carries a single wire. */
export function routeEdge(ends: EdgeEnds): RoutedEdge {
  // Step out to the visible hardware, on the finger the slot assignment
  // picked, before routing anything. Everything below works in these
  // coordinates.
  const sx = ends.sourceX + PIN_REACH;
  const sy = ends.sourceY + slotOffset(ends.sourceSlot);
  const tx = ends.targetX + SOCKET_BITE;
  const ty = ends.targetY + slotOffset(ends.targetSlot);

  // Forward run — out-stub, one vertical riser, in-stub. When sy === ty the
  // riser has zero length and this is a single straight line.
  //
  // The riser sits LATE, one stub short of the target, not at the midpoint.
  // Fan-in is the common shape in a context graph — many files importing
  // into one agent — and every one of those edges ends at the same port. A
  // midpoint riser makes them share the whole second half of the run, so a
  // dashed advisory edge paints over a solid structural one and you cannot
  // tell there are two. Turning late keeps each edge on its own source row
  // for nearly the whole distance and shrinks the shared segment to STUB.
  // RISER_STEP staggers that turn column per target slot so a busy port's
  // wires don't even share the one shared segment.
  if (tx - sx >= STUB * 2) {
    const riserX = Math.max(sx + STUB, tx - STUB - ends.targetSlot * RISER_STEP);
    return {
      path: sharpPath([
        [sx, sy],
        [riserX, sy],
        [riserX, ty],
        [tx, ty],
      ]),
      // Anchor labels on the long source-side run, not on the shared stub.
      labelX: Math.round((sx + riserX) / 2),
      labelY: sy,
    };
  }

  // Detour lane. Preferred: the gap BETWEEN vertically separated cards
  // (the common stacked layout) — shortest and reads best. Otherwise the
  // clearance lane above or below both cards, whichever costs less.
  //
  // Lane placement and clearance ALWAYS use the UNSHIFTED port centres
  // (ends.sourceY / ends.targetY), never the slot-shifted sy/ty: feeding it
  // a slot-shifted y would move the card-clearance band by up to 16px
  // against a NODE_H that only carries ~12-17px of slack over the real
  // card. Only the drawn endpoints and the riser columns use the shifted
  // values.
  const gapTop = Math.min(ends.sourceY, ends.targetY) + NODE_H / 2;
  const gapBot = Math.max(ends.sourceY, ends.targetY) - NODE_H / 2;
  let lane: number;
  if (gapBot - gapTop >= 24) {
    lane = (gapTop + gapBot) / 2;
  } else {
    const laneTop = Math.min(ends.sourceY, ends.targetY) - NODE_H / 2 - MARGIN;
    const laneBot = Math.max(ends.sourceY, ends.targetY) + NODE_H / 2 + MARGIN;
    const upCost = Math.abs(ends.sourceY - laneTop) + Math.abs(ends.targetY - laneTop);
    const downCost = Math.abs(ends.sourceY - laneBot) + Math.abs(ends.targetY - laneBot);
    lane = upCost <= downCost ? laneTop : laneBot;
  }

  // Exit/entry verticals sidestep the OTHER card when they would cut it.
  // Each stagger by its own slot so a busy port's wires turn at their own
  // column instead of sharing one riser.
  let outX = sx + STUB + ends.sourceSlot * RISER_STEP;
  if (outX >= tx && outX <= tx + NODE_W && crossesBand(sy, lane, ends.targetY)) {
    outX = Math.max(outX, tx + NODE_W + MARGIN);
  }
  let inX = tx - STUB - ends.targetSlot * RISER_STEP;
  if (inX >= sx - NODE_W && inX <= sx && crossesBand(ty, lane, ends.sourceY)) {
    inX = Math.min(inX, sx - NODE_W - MARGIN);
  }

  const pts: ReadonlyArray<readonly [number, number]> = [
    [sx, sy],
    [outX, sy],
    [outX, lane],
    [inX, lane],
    [inX, ty],
    [tx, ty],
  ];
  return { path: sharpPath(pts), labelX: (outX + inX) / 2, labelY: lane };
}
