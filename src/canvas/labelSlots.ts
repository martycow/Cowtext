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
 * Candidate offsets are searched 0, ±step, ±2·step … so a displaced label
 * lands as close to its wire as it can (smallest absolute displacement
 * wins, always — the search never skips a closer slot to try a farther one
 * first). WO13_CONTRACT.md defect 7(b): which SIGN is tried first at a given
 * step used to be fixed (`[+step, -step]`), so whichever label of a
 * colliding pair was processed second always won the coin flip and always
 * landed BELOW — every displaced chip drifted the same way instead of the
 * bundle staying visually centred. The sign tried first now alternates by
 * each label's position in the (deterministic, id-sorted) processing order,
 * so two labels that both have to move split one up and one down rather
 * than piling onto the same side.
 */
export function resolveLabelOffsets(entries: readonly LabelBox[]): Map<string, number> {
  const out = new Map<string, number>();
  if (entries.length < 2) return out;

  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: { box: LabelBox; y: number }[] = [];

  sorted.forEach((box, i) => {
    // Even processing index tries "down" (+step) first, odd tries "up"
    // (−step) first — a fixed, deterministic alternation, not a coin flip,
    // so the same graph always resolves to the same layout.
    const preferDown = i % 2 === 0;
    let chosen = box.y;
    for (let step = 0; step * LABEL_STEP <= MAX_PUSH; step += 1) {
      const candidates =
        step === 0
          ? [box.y]
          : preferDown
            ? [box.y + step * LABEL_STEP, box.y - step * LABEL_STEP]
            : [box.y - step * LABEL_STEP, box.y + step * LABEL_STEP];
      const free = candidates.find((y) => !placed.some((p) => overlaps(box, y, p.box, p.y)));
      if (free !== undefined) {
        chosen = free;
        break;
      }
    }
    placed.push({ box, y: chosen });
    if (chosen !== box.y) out.set(box.id, chosen - box.y);
  });

  return out;
}
