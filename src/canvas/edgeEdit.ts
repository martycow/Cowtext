// Hand-edited wire routes (WO10 item 4) — the pure algebra behind dragging
// a segment of a selected edge. No React, no store: `MemoryEdge` hands in the
// polyline `routeEdge` drew plus the segment the user grabbed and how far
// they moved it, and gets back the waypoint list to persist on the edge
// (graph.json v4, `MemoryEdge.waypoints`).
//
// The model is deliberately small. A waypoint is a CORNER the wire must pass
// through, not a spline control point, so an orthogonal route stays
// orthogonal by construction and there is nothing to "smooth". Dragging a
// vertical segment moves it in x; dragging a horizontal one moves it in y;
// the two endpoints are never draggable, because they belong to the
// connector hardware (see the landing math in canvas/edgePath.ts) and a wire
// that leaves its socket is a bug, not an edit.

import type { Point } from "./edgePath";

/** How much of a drag is ignored before it counts as an edit — a click that
 *  wobbles by a pixel must not rewrite the route (and so must not push an
 *  undo entry). */
export const DRAG_THRESHOLD = 3;

/** Grid the edited corners land on. Matches the design system's 4px grid, so
 *  a hand-routed wire keeps the same rhythm as everything else on the
 *  canvas and two independently dragged segments line up. */
export const EDIT_GRID = 4;

export type SegmentAxis = "horizontal" | "vertical" | "point";

export function segmentAxis(a: Point, b: Point): SegmentAxis {
  if (a.x === b.x && a.y === b.y) return "point";
  return a.x === b.x ? "vertical" : "horizontal";
}

function snap(v: number): number {
  return Math.round(v / EDIT_GRID) * EDIT_GRID;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Drop repeats and points that sit mid-way along a straight run. Mirrors
 *  `simplify` in edgePath.ts, but operating on the waypoint list we are
 *  about to PERSIST — a stored route must not accumulate redundant corners
 *  every time a neighbouring segment is nudged back into line. */
export function pruneWaypoints(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last !== undefined && samePoint(last, p)) continue;
    const prev = out[out.length - 2];
    if (
      last !== undefined &&
      prev !== undefined &&
      ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))
    ) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * Move segment `index` (the run from `points[index]` to `points[index + 1]`)
 * by `delta`, and return the waypoint list that reproduces the result.
 *
 * The returned list is the whole interior of the route — every corner except
 * the two hardware endpoints — so it is a complete replacement for the edge's
 * `waypoints`, not a patch. That keeps the caller a one-liner
 * (`updateEdge(id, { waypoints: moveSegment(...) })`) and means an edit is
 * always idempotent: applying the same drag to the same route twice yields
 * the same stored route.
 *
 * Returns `null` when the drag cannot produce a valid edit — an out-of-range
 * index, a degenerate (zero-length) segment, a drag below the threshold, or
 * a grab on one of the two stub segments that keep the wire plugged in.
 */
export function moveSegment(
  points: readonly Point[],
  index: number,
  delta: Point,
): Point[] | null {
  if (index < 0 || index + 1 >= points.length) return null;
  // The first and last segments are the stubs off the pin and into the
  // socket. Moving either would tear the wire out of its connector.
  if (index === 0 || index + 1 === points.length - 1) return null;
  if (Math.abs(delta.x) < DRAG_THRESHOLD && Math.abs(delta.y) < DRAG_THRESHOLD) return null;

  const a = points[index];
  const b = points[index + 1];
  const axis = segmentAxis(a, b);
  if (axis === "point") return null;

  const moved: Point[] =
    axis === "vertical"
      ? [
          { x: snap(a.x + delta.x), y: a.y },
          { x: snap(b.x + delta.x), y: b.y },
        ]
      : [
          { x: a.x, y: snap(a.y + delta.y) },
          { x: b.x, y: snap(b.y + delta.y) },
        ];

  const next = [...points.slice(0, index), ...moved, ...points.slice(index + 2)];
  // Strip the two hardware endpoints — they are re-derived from the live
  // handle positions on every render, so persisting them would freeze a wire
  // to wherever its card happened to sit at drag time.
  return pruneWaypoints(next.slice(1, next.length - 1));
}

/** Midpoints of the draggable segments, with the index each one edits.
 *  The stubs are excluded for the same reason `moveSegment` refuses them. */
export function dragHandles(
  points: readonly Point[],
): { index: number; x: number; y: number; axis: SegmentAxis }[] {
  const out: { index: number; x: number; y: number; axis: SegmentAxis }[] = [];
  for (let i = 1; i + 1 < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const axis = segmentAxis(a, b);
    if (axis === "point") continue;
    out.push({
      index: i,
      x: Math.round((a.x + b.x) / 2),
      y: Math.round((a.y + b.y) / 2),
      axis,
    });
  }
  return out;
}
