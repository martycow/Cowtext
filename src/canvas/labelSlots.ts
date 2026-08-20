// Edge-label collision resolution (WO10 item 5).
//
// `routeEdge` anchors every label at a point on its own wire, and knows
// nothing about the other wires. On a dense graph — a fan-in hub, a column of
// stacked cards — several anchors land within a few pixels of each other and
// the chips overlap into an unreadable smear. This module is the second pass
// that fixes that: given every label's anchor and measured box, it hands back
// a y offset per label such that no two boxes overlap.
//
// Pure and deterministic. Entries are swept in a fixed order (by id, never by
// array order or measurement time), and each one is pushed to the first free
// slot searched outward from where it wanted to be — so the same graph always
// resolves to the same layout, no matter which edge happened to render first.
// Nothing here reads the store or the DOM.

/** One label asking for room: its anchor and its measured size. */
export interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Vertical step a displaced label moves by. One 4px-grid unit taller than
 *  the chip itself, so a bumped label clears its neighbour with visible
 *  daylight rather than sitting flush against it. */
export const LABEL_STEP = 4;

/** How far a label may be pushed before we give up and let it overlap.
 *  A label that has walked 60px from its wire is worse than one that
 *  overlaps: it now points at nothing. */
export const MAX_PUSH = 60;

/** Horizontal breathing room required between two chips before they count as
 *  clear of each other. Boxes are compared with this added, so labels never
 *  end up merely touching. */
const GAP = 6;

function overlaps(a: LabelBox, ay: number, b: LabelBox, by: number): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(ay - by);
  return dx < (a.w + b.w) / 2 + GAP && dy < (a.h + b.h) / 2 + 2;
}

/**
 * Resolve overlaps by nudging labels along y.
 *
 * Returns edgeId → y offset in flow pixels (0 for anything that did not have
 * to move — the common case, and the one worth keeping allocation-free at
 * the call site: an unchanged map means nothing re-renders).
 *
 * Candidate offsets are searched 0, +step, −step, +2·step, −2·step … so a
 * displaced label lands as close to its wire as it can, alternating sides to
 * keep a bundle of wires visually centred rather than drifting one way.
 */
export function resolveLabelOffsets(entries: readonly LabelBox[]): Map<string, number> {
  const out = new Map<string, number>();
  if (entries.length < 2) return out;

  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: { box: LabelBox; y: number }[] = [];

  for (const box of sorted) {
    let chosen = box.y;
    for (let step = 0; step * LABEL_STEP <= MAX_PUSH; step += 1) {
      const candidates = step === 0 ? [box.y] : [box.y + step * LABEL_STEP, box.y - step * LABEL_STEP];
      const free = candidates.find((y) => !placed.some((p) => overlaps(box, y, p.box, p.y)));
      if (free !== undefined) {
        chosen = free;
        break;
      }
    }
    placed.push({ box, y: chosen });
    if (chosen !== box.y) out.set(box.id, chosen - box.y);
  }

  return out;
}
