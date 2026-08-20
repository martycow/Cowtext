// Port contact-slot assignment — WO09 round 2
// (docs/design/WO09_CONNECTOR_CONTRACT.md §5), amended by WO10 §3.
//
// Each card's input/output block is a run of cartridge contact fingers; this
// module decides how MANY fingers a port shows and which one each edge lands
// on, so fan-in and fan-out don't bundle onto one shared centre pin.
//
// WO10 amendment — the finger count is no longer frozen at five. A port shows
// exactly as many pins as it carries connections, with a floor of one (an
// unconnected port still reads as hardware you can aim at) and a ceiling of
// MAX_PINS, past which ranks wrap round-robin rather than compressing to
// sub-pitch offsets. The block's height follows from the count via
// `portHeight`; at 5 pins that is 44px — byte-identical to the frozen WO09
// geometry, which is why the amendment is a generalization rather than a
// redesign.
//
// The one invariant a reviewer must be able to check without reading the CSS:
//   SLOT_PITCH (8) ≡ FINGER_PITCH — finger centre-to-centre, px, and the
//   period the .ct-pin flex column in styles/index.css reproduces (4px
//   finger + 4px gap). If this file and that block disagree, wires land
//   between contacts instead of on them.

export const SLOT_PITCH = 8; // ≡ FINGER_PITCH (contract §3 G3), px
export const FINGER_H = 4; // ≡ one contact finger's height (G4), px
/** Ceiling on visible pins. Past this, ranks wrap — a hub with 30 inbound
 *  edges would otherwise grow a connector taller than the card it is bolted
 *  to. 9 keeps the tallest block (76px) under the ~93px memory plate. */
export const MAX_PINS = 9;

export interface SlotEdge {
  id: string;
  source: string;
  target: string;
}

/** Where one edge lands on one port: which finger, out of how many. The
 *  count travels with the rank because the offset is only meaningful
 *  relative to it — a rank of 0 is the top finger of a 5-pin block and the
 *  ONLY finger of a 1-pin block, and those are different y offsets. */
export interface PortSlot {
  rank: number;
  pins: number;
}

/** Slot 0 of 1 — a port carrying a single wire, landing dead-centre. Used as
 *  the fallback wherever an assignment hasn't arrived yet. */
export const SINGLE_SLOT: PortSlot = { rank: 0, pins: 1 };

export interface PortSlots {
  /** edgeId → contact slot on the TARGET card's input block. */
  readonly inSlot: ReadonlyMap<string, PortSlot>;
  /** edgeId → contact slot on the SOURCE card's output block. */
  readonly outSlot: ReadonlyMap<string, PortSlot>;
  /** nodeId → visible pin count on its input block. Absent ⇒ 1. */
  readonly inPins: ReadonlyMap<string, number>;
  /** nodeId → visible pin count on its output block. Absent ⇒ 1. */
  readonly outPins: ReadonlyMap<string, number>;
}

/** Plain lexicographic string compare — no locale, so ordering is stable
 *  across machines/OSes (`String.localeCompare` is not). */
function lexCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** How many fingers a port with `degree` connections shows: one per
 *  connection, never fewer than 1, never more than MAX_PINS. Total (accepts
 *  any number, including a negative or fractional degree). */
export function pinCount(degree: number): number {
  if (!Number.isFinite(degree)) return 1;
  return Math.min(MAX_PINS, Math.max(1, Math.round(degree)));
}

/** Rendered height of a connector block with `pins` fingers, in px:
 *  `pins` × 4px of contact + (`pins` − 1) × 4px of gap + 2px padding and
 *  2px border on each edge. 12px at one pin, **44px at five** (the frozen
 *  WO09 G1), 76px at nine. styles/index.css quotes this function by name. */
export function portHeight(pins: number): number {
  const p = pinCount(pins);
  return FINGER_H * p + FINGER_H * (p - 1) + 8;
}

/** Slot → y offset from the port centre. A 5-pin block yields the frozen
 *  −16, −8, 0, +8, +16 ladder; a 1-pin block yields 0; an even count
 *  straddles the centre (2 pins ⇒ −4, +4). Always a whole number of pixels,
 *  because the half-pitch of an even count is exactly 4. Total: an
 *  out-of-range rank is clamped rather than extrapolated. */
export function slotOffset(slot: PortSlot): number {
  const pins = pinCount(slot.pins);
  const rank = Math.min(pins - 1, Math.max(0, Math.round(slot.rank)));
  return (rank - (pins - 1) / 2) * SLOT_PITCH;
}

/** Pure. O(E log E). Same edge list → same maps, always — ranking keys on
 *  node and edge ids only, never positions or store array order, so
 *  dragging a card never re-slots a wire and load order never matters. */
export function assignPortSlots(edges: readonly SlotEdge[]): PortSlots {
  const byTarget = new Map<string, SlotEdge[]>();
  const bySource = new Map<string, SlotEdge[]>();
  for (const e of edges) {
    const inGroup = byTarget.get(e.target);
    if (inGroup === undefined) byTarget.set(e.target, [e]);
    else inGroup.push(e);
    const outGroup = bySource.get(e.source);
    if (outGroup === undefined) bySource.set(e.source, [e]);
    else outGroup.push(e);
  }

  const inSlot = new Map<string, PortSlot>();
  const inPins = new Map<string, number>();
  for (const [nodeId, group] of byTarget) {
    const pins = pinCount(group.length);
    inPins.set(nodeId, pins);
    const ranked = [...group].sort(
      (a, b) => lexCompare(a.source, b.source) || lexCompare(a.id, b.id),
    );
    ranked.forEach((e, rank) => inSlot.set(e.id, { rank: rank % pins, pins }));
  }

  const outSlot = new Map<string, PortSlot>();
  const outPins = new Map<string, number>();
  for (const [nodeId, group] of bySource) {
    const pins = pinCount(group.length);
    outPins.set(nodeId, pins);
    const ranked = [...group].sort(
      (a, b) => lexCompare(a.target, b.target) || lexCompare(a.id, b.id),
    );
    ranked.forEach((e, rank) => outSlot.set(e.id, { rank: rank % pins, pins }));
  }

  return { inSlot, outSlot, inPins, outPins };
}
