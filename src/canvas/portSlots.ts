// Port contact-slot assignment — WO09 round 2
// (docs/design/WO09_CONNECTOR_CONTRACT.md §5). Each card's input/output
// block is a run of five cartridge contact fingers (see the .ct-port-in /
// .ct-port-out gradients in styles/index.css); this module decides which
// finger each edge lands on so fan-in and fan-out don't bundle onto one
// shared centre pin.
//
// Two invariants a reviewer must be able to check in one glance, without
// reading the CSS:
//   SLOT_COUNT (5) ≡ FINGER_COUNT — the finger count baked into the
//                     connector block's repeating-linear-gradient.
//   SLOT_PITCH (8) ≡ FINGER_PITCH — that gradient's repeat period, px.
// If this file and the styles/index.css connector block ever disagree,
// wires land between contacts instead of on them.

export const SLOT_COUNT = 5; // ≡ FINGER_COUNT (contract §3 G2)
export const SLOT_PITCH = 8; // ≡ FINGER_PITCH (contract §3 G3), px
export const CENTER_SLOT = 2; // (SLOT_COUNT - 1) / 2

export interface SlotEdge {
  id: string;
  source: string;
  target: string;
}

export interface PortSlots {
  /** edgeId → contact slot on the TARGET card's input block. */
  readonly inSlot: ReadonlyMap<string, number>;
  /** edgeId → contact slot on the SOURCE card's output block. */
  readonly outSlot: ReadonlyMap<string, number>;
}

/** Plain lexicographic string compare — no locale, so ordering is stable
 *  across machines/OSes (`String.localeCompare` is not). */
function lexCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Packing / overflow rule (contract §5). `count = 1` lands dead-centre
 *  (slot 2), 2-4 pack into a centred contiguous run, 5 fills every finger,
 *  and `count > 5` wraps round-robin rather than clamping to the outer two
 *  fingers or compressing to sub-pitch offsets. */
export function slotForRank(rank: number, count: number): number {
  if (count <= SLOT_COUNT) {
    return Math.floor((SLOT_COUNT - count) / 2) + rank;
  }
  return rank % SLOT_COUNT;
}

/** Slot index → y offset from the port centre: −16, −8, 0, +8, +16.
 *  Clamps out-of-range input so it is total. */
export function slotOffset(slot: number): number {
  const clamped = Math.min(SLOT_COUNT - 1, Math.max(0, Math.round(slot)));
  return (clamped - CENTER_SLOT) * SLOT_PITCH;
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

  const inSlot = new Map<string, number>();
  for (const group of byTarget.values()) {
    const ranked = [...group].sort(
      (a, b) => lexCompare(a.source, b.source) || lexCompare(a.id, b.id),
    );
    ranked.forEach((e, rank) => inSlot.set(e.id, slotForRank(rank, ranked.length)));
  }

  const outSlot = new Map<string, number>();
  for (const group of bySource.values()) {
    const ranked = [...group].sort(
      (a, b) => lexCompare(a.target, b.target) || lexCompare(a.id, b.id),
    );
    ranked.forEach((e, rank) => outSlot.set(e.id, slotForRank(rank, ranked.length)));
  }

  return { inSlot, outSlot };
}
