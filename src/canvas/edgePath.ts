// Edge routing (post-connector-revert). Every edge leaves the source's
// output port heading right and enters the target's input port heading
// right, so the marker always meets the funnel straight-on. A forward run
// is a single horizontal-tangent cubic; anything else (target behind or
// stacked) detours around the cards on a clearance lane with rounded
// turns instead of folding back across them — the "spaghetti" this
// replaces. Pure geometry, no persistence.

const STUB = 22; // straight clearance off each port before any turn
const MARGIN = 30; // lane clearance beyond the estimated card edges
const NODE_W = 244; // --w-node: cards are fixed-width
const NODE_H = 128; // conservative card height (97px min + banners)
const RADIUS = 10; // corner rounding on detour turns

export interface RoutedEdge {
  path: string;
  labelX: number;
  labelY: number;
}

/** Polyline → SVG path with quarter-arc rounded corners (clamped so short
 *  segments never overshoot). */
function roundedPath(pts: ReadonlyArray<readonly [number, number]>): string {
  const [x0, y0] = pts[0];
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py) || 1;
    const outLen = Math.hypot(nx - cx, ny - cy) || 1;
    const r = Math.min(RADIUS, inLen / 2, outLen / 2);
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((nx - cx) / outLen) * r;
    const by = cy + ((ny - cy) / outLen) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const [xn, yn] = pts[pts.length - 1];
  return `${d} L ${xn} ${yn}`;
}

/** Does the vertical span [a, b] overlap the card band centred on `cy`? */
function crossesBand(a: number, b: number, cy: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return cy - NODE_H / 2 < hi && cy + NODE_H / 2 > lo;
}

/** Route from the source output port (sx, sy) to the target input port
 *  (tx, ty). Ports are mid-height on the right/left card edges, so the
 *  source card spans [sx − NODE_W, sx] and the target card [tx, tx + NODE_W]. */
export function routeEdge(sx: number, sy: number, tx: number, ty: number): RoutedEdge {
  // Forward run — enough room for both stubs: symmetric cubic whose t=0.5
  // point is the exact midpoint (label anchor).
  if (tx - sx >= STUB * 2) {
    const c = Math.max(STUB, Math.min(140, (tx - sx) / 2));
    return {
      path: `M ${sx} ${sy} C ${sx + c} ${sy}, ${tx - c} ${ty}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2,
    };
  }

  // Detour lane. Preferred: the gap BETWEEN vertically separated cards
  // (the common stacked layout) — shortest and reads best. Otherwise the
  // clearance lane above or below both cards, whichever costs less.
  const gapTop = Math.min(sy, ty) + NODE_H / 2;
  const gapBot = Math.max(sy, ty) - NODE_H / 2;
  let lane: number;
  if (gapBot - gapTop >= 24) {
    lane = (gapTop + gapBot) / 2;
  } else {
    const laneTop = Math.min(sy, ty) - NODE_H / 2 - MARGIN;
    const laneBot = Math.max(sy, ty) + NODE_H / 2 + MARGIN;
    const upCost = Math.abs(sy - laneTop) + Math.abs(ty - laneTop);
    const downCost = Math.abs(sy - laneBot) + Math.abs(ty - laneBot);
    lane = upCost <= downCost ? laneTop : laneBot;
  }

  // Exit/entry verticals sidestep the OTHER card when they would cut it.
  let outX = sx + STUB;
  if (outX >= tx && outX <= tx + NODE_W && crossesBand(sy, lane, ty)) {
    outX = Math.max(outX, tx + NODE_W + MARGIN);
  }
  let inX = tx - STUB;
  if (inX >= sx - NODE_W && inX <= sx && crossesBand(ty, lane, sy)) {
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
  return { path: roundedPath(pts), labelX: (outX + inX) / 2, labelY: lane };
}
