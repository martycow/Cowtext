# WO09 — Canvas connectors, round 2 (FROZEN)

Status: FROZEN 2026-08-19. One lane (tech-ui). Two findings from Marty's round-1
rejection. This is a UI round, not a work order — nothing outside the file-zone
grid below may be touched.

---

## 1. Scope

Round 1 (uncommitted, working tree) rebuilt the connectors as socket-bay + pin and
rewrote `edgePath.ts` as an orthogonal router. Marty rejected it on two counts:

1. **The gap** — "Connection lines are still too far away from the Input connectors."
2. **Fan-in** — "There might be multiple connections to one connector. I guess you
   should make connectors a bit higher and look more like 16-bit video game
   cartridge's contacts."

In scope: connector hardware treatment (both sides), wire-to-hardware landing math,
per-edge contact-slot assignment for **fan-in and fan-out**, and the comment
cross-references that keep CSS and TS from drifting.

Out of scope: graph schema, `BarnGraph`, any Rust, any new library, node card
layout, minimap, the React-Flow-native connection-line drag preview.

---

## 2. Root cause of finding (1) — diagnosed, not guessed

**React Flow does not report the handle centre.** `getHandlePosition` in
`node_modules/@xyflow/system/dist/esm/index.js:1442-1460` returns, for
`Position.Left`, `{ x, y: y + height/2 }` — the handle border-box's **left edge**;
for `Position.Right`, `{ x: x + width, ... }` — its **right edge**. Only the
`center = true` branch (used for connection-radius snapping, line 2352) returns a
centre.

Consequences with round-1 CSS (`src/styles/index.css:116-122`, `left:-11px;
width:20px`) on a card whose left edge is `L`:

| quantity | value |
|---|---|
| handle border box | `L−11 … L+9` |
| `targetX` reported by React Flow | **`L−11`** — already the bay's outer face |
| `edgePath.ts:71` `tx = portTx − SOCKET_GAP` (10) | `L−21` |
| stroke terminates at | `L−21` |
| marker (`markerUnits="userSpaceOnUse"`, `markerWidth` 11, `refX` at forward edge) occupies | `L−32 … L−21` |
| **visible daylight, arrow tip → socket face** | **10px** |

So `edgePath.ts:33-34` and its comment ("the socket bay's outer face is −10, and the
wire stops exactly there") encode a false premise: they assume a centre reading and
subtract the half-width a second time. The 10px Marty sees **is** `SOCKET_GAP`.

Source side, same false premise, benign outcome: `portSx = R+4` (shoulder's outer
edge; the `::before` pin runs `R+4 … R+18`), `sx = portSx + PIN_TIP(14) = R+18` — the
wire starts exactly *at* the pin tip, butt-to-butt, not "4px back along the pin" as
the comment claims. It renders acceptably today but can show a hairline seam at
fractional zoom. Fixed here for the same reason.

**Paint order, verified:** `GraphView` renders `EdgeRenderer` before `NodeRenderer`
(`@xyflow/react/dist/esm/index.js:3263`); each edge svg carries `zIndex: 0` (:3021)
and each node div `zIndex: internals.z` (:2350, ≥ 0). Equal z + later DOM position ⇒
**nodes, including their handles, always paint over edges.** Anything the wire draws
past the connector's outer face is hidden.

**Frozen decision.** The wire *plugs in*: the path END lands **3px inside** the
socket's outer face, so the arrowhead's tip is swallowed by the hardware and there is
no daylight at any zoom or DPI rounding. 8 of the arrow's 11px stay outside and
remain readable (kind is read from line style + marker — that legibility is
non-negotiable). Symmetrically the path START sits **4px inside** the output pin.
`SOCKET_GAP` is deleted; `PIN_TIP` is replaced by `PIN_REACH`.

---

## 3. Frozen geometry — ONE table

Every number below. CSS and TS must both quote this table by name. Everything is on
the 4px grid except the 2px plate-edge borders (design-tokens: 2px edges, square
corners, no radius, `crispEdges`).

| # | Name | Value | Lives in | Meaning |
|---|---|---|---|---|
| G1 | `CONN_H` | **44px** | `index.css` `.ct-port` `height` | connector block height, both sides (was 24) |
| G2 | `FINGER_COUNT` | **5** | `index.css` gradient + `portSlots.ts` `SLOT_COUNT` | contact fingers per block |
| G3 | `FINGER_PITCH` | **8px** | `index.css` gradient period + `portSlots.ts` `SLOT_PITCH` | finger centre-to-centre |
| G4 | `FINGER_H` | **4px** | `index.css` gradient stop | one contact finger's height |
| G5 | contact run | **36px** | derived: `5×4 + 4×4` | must equal the content-box height |
| G6 | block padding | **2px 0** | `index.css` `.ct-port-in` | 36 + 4 (padding) + 4 (border t/b) = 44 = G1 |
| G7 | `PORT_IN_W` | **20px** | `.ct-port-in` `width` | bay width |
| G8 | `PORT_IN_OVERHANG` | **11px** | `.ct-port-in` `left: -11px` | bay outer face = `L − 11`; **this is `targetX`** |
| G9 | `PORT_OUT_W` | **8px** | `.ct-port-out` `width` | shoulder shell width |
| G10 | `PORT_OUT_OVERHANG` | **4px** | `.ct-port-out` `right: -4px` | shoulder outer edge = `R + 4`; **this is `sourceX`** |
| G11 | `PIN_LEN` | **14px** | `.ct-port-out::before` `width` | pins protrude to `R + 18` |
| G12 | `PIN_REACH` | **10px** | `edgePath.ts` | `sx = portSx + PIN_REACH` ⇒ start `R+14`, 4px inside the pin |
| G13 | `SOCKET_BITE` | **3px** | `edgePath.ts` | `tx = portTx + SOCKET_BITE` ⇒ end `L−8`, 3px inside the bay |
| G14 | `STUB` | **22px** | `edgePath.ts` | unchanged |
| G15 | `MARGIN` | **30px** | `edgePath.ts` | unchanged |
| G16 | `NODE_W` | **244px** | `edgePath.ts` | unchanged (`--w-node`) |
| G17 | `NODE_H` | **128px** | `edgePath.ts` | unchanged — 44px connector spans ±22, inside ±64, so `crossesBand` clearance is untouched |
| G18 | `RISER_STEP` | **8px** | `edgePath.ts` | per-slot stagger of the fan-in turn column |
| G19 | hit area | **26 × 52px** | `.ct-port::after` | pseudo-elements are excluded from `getBoundingClientRect`, so this never moves the reported port position |
| G20 | `interactionWidth` | **12** | `MemoryEdge.tsx` | was 16; at `FINGER_PITCH` 8 a 16px band straddles the neighbouring wire |

Invariants a reviewer checks in one glance:

- **G3 ≡ `SLOT_PITCH`** and **G2 ≡ `SLOT_COUNT`**. If they diverge, wires land between
  contacts. This is the single most important cross-file coupling in the round.
- **G5 = G2×G4 + (G2−1)×G4 = content-box height**, and **G5 + 4 + 4 = G1**.
- `targetX ≡ L − G8` and `sourceX ≡ R + G10` follow from `getHandlePosition`, not from
  any CSS centre. Never re-derive them from a width.

**Accepted consequence, quantified:** markers are 11px tall (`markerHeight="11"`,
unchanged) while `FINGER_PITCH` is 8. On a fully-loaded 5-wire port, adjacent
arrowheads overlap by 3px — and only in the arrow's 2px-wide rear column, since
`PIXEL_ARROW` tapers 10→2. They nest like a ribbon; the triangles stay individually
readable. The single knob if Marty dislikes it is `FINGER_PITCH` (12 ⇒ `CONN_H` 60).
**Do not turn that knob in this round.**

---

## 4. Connector treatment — `src/styles/index.css`

Cartridge edge connector: a dark shell with a run of five bright contact fingers,
drawn with `repeating-linear-gradient` (allowed; base64 blobs are not — CLAUDE.md).
No new hex anywhere.

**Tokens** — add exactly two lines to `src/styles/tokens.css` beside the plate block
(~L91-99). Both alias existing themed tokens, so the `[data-warmth]` overrides at
L198-210 propagate for free via lazy `var()` substitution. No third token, no new
colour:

```css
--port-body:    var(--plate-edge);     /* connector shell / shoulder */
--port-contact: var(--plate-edge-hi);  /* cartridge contact fingers */
```

**Rules** (shape frozen; exact declaration order is the lane's business):

- `.ct-port` — keeps `position:absolute; top:50%; transform:translate(0,-50%);
  box-sizing:border-box; border-radius:0; opacity:1`. Gains `height: 44px` (G1) and a
  local `--contact: var(--port-contact);` used by both sides' gradients. State changes
  recolour **only** `--contact` — one declaration, no duplicated gradients.
- `.ct-port::after` — 26 × 52 (G19).
- `.ct-port-in` — `left:-11px; width:20px; padding:2px 0;
  border:2px solid var(--port-body); border-left:none;` The open left face is
  deliberate: it is a slot cut into the plate edge, and it lets the fingers run out to
  the outer face so the wire meets a contact, not a wall. Two background layers:

  ```css
  background-image:
    repeating-linear-gradient(to bottom, var(--contact) 0 4px, transparent 4px 8px),
    linear-gradient(var(--plate-inset), var(--plate-inset));
  background-origin: content-box, border-box;
  background-clip:   content-box, border-box;
  background-repeat: repeat, no-repeat;
  ```

  Content box = 18 × 36; the gradient closes exactly on a finger (4,4,4,4,4,4,4,4,4).
- `.ct-port-out` — `right:-4px; width:8px; border:none;
  background:var(--port-body);` (shell only — the pins are the `::before`).
- `.ct-port-out::before` — `left:100%; top:50%; width:14px; height:36px;
  transform:translate(0,-50%);` with the same `repeating-linear-gradient` on
  `--contact`, no second layer (the pins stick out into open canvas).
- State (unchanged semantics, new mechanism): card hover / node selected ⇒
  `--contact: var(--amber-text)`. Port hover / `.connectingfrom` / `.connectingto` ⇒
  `--contact: var(--accent)`, and `.ct-port-in` background layer 2 becomes
  `var(--accent-surface)`. The two accents are mutually exclusive states on this
  control — never simultaneous. The amber-on-card-hover choice is inherited from
  round 1 and is **explicitly not re-litigated here**.

---

## 5. Slot assignment — new module `src/canvas/portSlots.ts`

Frozen, exact:

```ts
export const SLOT_COUNT = 5;   // ≡ FINGER_COUNT (G2)
export const SLOT_PITCH = 8;   // ≡ FINGER_PITCH (G3), px
export const CENTER_SLOT = 2;  // (SLOT_COUNT - 1) / 2

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

/** Pure. O(E log E). Same edge list → same maps, always. */
export function assignPortSlots(edges: readonly SlotEdge[]): PortSlots;

/** Slot index → y offset from the port centre: −16, −8, 0, +8, +16.
 *  Clamps out-of-range input so it is total. */
export function slotOffset(slot: number): number;

/** Packing rule, exported so it can be reasoned about in isolation. */
export function slotForRank(rank: number, count: number): number;
```

**Ordering (determinism).** For each target node, its incoming edges are ranked by
`(source, id)` ascending, lexicographic (`String` comparison, no locale). For each
source node, its outgoing edges are ranked by `(target, id)`. Keys are **node and
edge ids only** — never positions, never store array order. Consequences:

- Same graph ⇒ same slots, on any machine, in any load order.
- Dragging a card never re-slots anything (positions are not an input) — no wires
  jumping between contacts mid-drag, and no per-frame recompute.
- Adding an edge that does not touch port P cannot change any slot on P.
- Adding an edge that *does* touch P re-ranks P's own edges, by design: the bundle
  re-packs to stay centred. This is the only permitted reshuffle.
- Two edges of different kinds between the same pair sort adjacently and take
  adjacent contacts.

**Packing / overflow rule.**

```ts
slotForRank(rank, count) =
  count <= SLOT_COUNT ? Math.floor((SLOT_COUNT - count) / 2) + rank
                      : rank % SLOT_COUNT;
```

- `count = 1` ⇒ slot 2, the centre finger — the common case is dead-centre on the
  port, exactly where `targetY` already points.
- `count = 2,3,4` ⇒ contiguous centred run (`{1,2}`, `{1,2,3}`, `{0,1,2,3}`); the
  even cases bias one contact upward, deterministically.
- `count = 5` ⇒ all five.
- **Overflow (`count > 5`) = wrap (round-robin modulo).** Chosen over *clamp* (piles
  everything on the two outer fingers while inner fingers idle) and over *compress*
  (sub-pitch offsets produce fractional y, which aliases under `crispEdges` and breaks
  the "lands on a contact" read). Wrap keeps every contact in use, keeps adjacent
  ranks apart, and degrades to the pre-WO09 behaviour only for the 6th+ wire.

**Persistent per-edge slots are deferred** (see §9): they would need a `graph.json`
field, hence a `version` bump and a migration — out of scope for a UI round.

---

## 6. Wiring — the three consuming edits

**`src/canvas/GraphCanvas.tsx`** — inside the existing store→RF-edges effect
(currently L92-112, deps `[domainEdges, domainNodes, setEdges]`), call
`assignPortSlots(domainEdges)` once and write the result onto each edge's `data`.
This is the whole memoization story: one `O(E log E)` pass per edges-array change,
`O(1)` per edge per frame, **no new store subscription inside `MemoryEdgeInner`** and
no selector. Do not introduce a Zustand selector or a module-level cache — the effect
already exists and is the correct seam.

**`src/canvas/types.ts`** — `CanvasEdgeData` gains two optional fields:

```ts
/** Contact slot on the target card's input block (portSlots.ts). */
inSlot?: number;
/** Contact slot on the source card's output block. */
outSlot?: number;
```

**`src/canvas/edgePath.ts`** — `routeEdge` takes one object. Six positional numbers
would be unreadable and easy to transpose:

```ts
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

export function routeEdge(ends: EdgeEnds): RoutedEdge;
```

Body changes, and nothing else:

- `const sx = ends.sourceX + PIN_REACH;` `const ty0 = ...`, i.e.
  `sy = ends.sourceY + slotOffset(ends.sourceSlot)`,
  `ty = ends.targetY + slotOffset(ends.targetSlot)`,
  `tx = ends.targetX + SOCKET_BITE`.
- **`crossesBand` keeps using the UNSHIFTED centres** (`ends.sourceY` /
  `ends.targetY`) as the band centre. Feeding it a slot-shifted y would move the
  card-clearance band by up to 16px against a `NODE_H` that only carries ~12-17px of
  slack over the real card. Lane clearance (`gapTop`/`gapBot`) likewise uses the
  unshifted centres; only the endpoints and the riser use the shifted values.
- Fan-in stagger, forward branch:
  `const riserX = Math.max(sx + STUB, tx - STUB - ends.targetSlot * RISER_STEP);`
  The guard `tx - sx >= STUB * 2` is unchanged, so the clamp keeps
  `riserX ∈ [sx+STUB, tx−STUB]` and the polyline strictly monotonic rightward. Result:
  each wire into a busy port turns at its own column instead of sharing one riser.
- Detour branch: `inX = tx - STUB - ends.targetSlot * RISER_STEP` and
  `outX = sx + STUB + ends.sourceSlot * RISER_STEP`, then the existing `crossesBand`
  sidestep clamps apply unchanged.

**`src/canvas/MemoryEdge.tsx`** — call site becomes

```ts
const { path, labelX, labelY } = routeEdge({
  sourceX, sourceY, sourceSlot: props.data?.outSlot ?? CENTER_SLOT,
  targetX, targetY, targetSlot: props.data?.inSlot ?? CENTER_SLOT,
});
```

and `interactionWidth={12}` (G20). Marker defs are **unchanged** — no `refX`,
`markerWidth`, `markerHeight` or path edits. The fix is entirely in where the path
ends.

**`src/canvas/MemoryNodeCard.tsx`** — comment only. The two `<Handle>` elements
**keep no `id`**: FROZEN. Five ids per side would mean 10 measured handles per card
and edges carrying handle ids that would have to be derived from the same slot
function anyway — all cost, no gain, since one handle plus a router offset is exact.

**Fan-out is IN SCOPE**, not deferred: the output block now shows five visible pins,
so routing every outgoing edge off the centre pin would be a visible lie. It reuses
`assignPortSlots`'s `outSlot` map — zero extra machinery. This retires the
"Fan-OUT still overlaps on the source side" admission at `edgePath.ts:84-85`; delete
that paragraph rather than leaving a stale confession.

---

## 7. Comment cross-references (mandatory — this is how the files stop drifting)

| File | Where | Required content |
|---|---|---|
| `src/canvas/edgePath.ts` | header block, currently L18-34 | Replace wholesale. Must state: React Flow reports the handle's **outer edge** for Left/Right (cite `@xyflow/system getHandlePosition`), NOT the centre; `PIN_REACH`/`SOCKET_BITE` values and that the wire deliberately ends *inside* the hardware because nodes paint over edges; and "these mirror table §3 of `docs/design/WO09_CONNECTOR_CONTRACT.md` — change them with `styles/index.css` and `canvas/portSlots.ts`." |
| `src/canvas/edgePath.ts` | L84-85 | Delete the stale "fan-out still overlaps" note. |
| `src/canvas/portSlots.ts` | header | `SLOT_COUNT`/`SLOT_PITCH` must equal the CSS `FINGER_COUNT`/`FINGER_PITCH`; name the CSS block. |
| `src/styles/index.css` | connector block header, L75-87 | Keep the ">>> this block is the whole connector treatment <<<" framing. Add: the gradient period **is** `SLOT_PITCH`, `left:-11px` **is** the value React Flow reports as `targetX`, and both are frozen in table §3. |
| `src/canvas/MemoryNodeCard.tsx` | L489-492 | Update: one contact block per side, five fingers; still **no handle ids**; slot assignment is `canvas/portSlots.ts`. |
| `src/canvas/GraphCanvas.tsx` | L88-91 | Update: edges still carry no handle ids; `data.inSlot`/`data.outSlot` carry the contact assignment, computed once here. |
| `src/canvas/MemoryEdge.tsx` | L57-65 | Update: the marker tip now lands 3px **inside** the socket face by design; `refX` unchanged. |
| `src/styles/tokens.css` | new token lines | One-line purpose each, per the file's existing style. |

---

## 8. File-zone grid — ONE lane, single owner

Confirmed as a single lane; the cut is widened by two files (`types.ts`,
`GraphCanvas.tsx`) because the slot data has to reach the edge component through the
existing mapping effect. No file appears twice; no other lane runs concurrently.

| Zone | Owner | Files | Verb |
|---|---|---|---|
| Z1 | tech-ui | `src/canvas/portSlots.ts` | **create** |
| Z2 | tech-ui | `src/canvas/edgePath.ts` | rewrite constants + `routeEdge` signature/body |
| Z3 | tech-ui | `src/canvas/MemoryEdge.tsx` | call site, `interactionWidth`, comments (**no marker-def edits**) |
| Z4 | tech-ui | `src/canvas/GraphCanvas.tsx` | slot computation in the existing edges effect + comment |
| Z5 | tech-ui | `src/canvas/types.ts` | `CanvasEdgeData` += `inSlot?`, `outSlot?` |
| Z6 | tech-ui | `src/canvas/MemoryNodeCard.tsx` | **comment only** — no JSX change, no handle ids |
| Z7 | tech-ui | `src/styles/index.css` | connector block L75-164 |
| Z8 | tech-ui | `src/styles/tokens.css` | +2 alias lines |

Read-only for this round: everything else, all of `src-tauri/`, all of `docs/`
except this file's own close-out line.

---

## 9. Deliberately deferred (state, do not build)

1. **Persistent per-edge slots** in `graph.json` (stable across adding a sibling
   edge). Needs a schema `version` bump + migration — CLAUDE.md hard rule. Ranking
   re-packs instead.
2. **Geometry-aware ordering** (slot by source-card y, so wires never cross). Would
   make slots a function of position ⇒ recompute on every drag frame and wires hopping
   contacts mid-drag. Rejected on both counts.
3. **Global lane routing** for the shared riser column beyond the `RISER_STEP`
   stagger. Still not a global router; still deliberately not.
4. **The React-Flow-native connection-line preview** (`ConnectionLineType.Step`,
   `GraphCanvas.tsx:203-204`) starts at `R+4` — the base of the pins — and paints
   above the node (`z-index: 1001`), so during a drag the accent line lies over the
   pins. Accepted as-is; no custom `connectionLineComponent`.
5. **`FINGER_PITCH` 12 / `CONN_H` 60** to fully separate arrowheads at 5-wire fan-in.
   The knob is named in §3; it stays at 8 this round.
6. The amber-on-card-hover port state (round-1 inheritance).

---

## 10. Acceptance gates

Machine:

- `npm run build` (tsc strict, `noUnusedLocals`/`noUnusedParameters`) clean.
- `npm run lint` clean — no `any`, no disabled rules.
- No dependency added to `package.json`. No file outside §8 modified.
- Grep check: `SLOT_PITCH = 8` in `portSlots.ts` and the `8px` gradient period in
  `index.css` agree; `SLOT_COUNT = 5` and the 36px content-box run agree.

On screen (Marty walks these):

1. **Plugged in.** Two cards side by side, one edge. The wire leaves the middle pin of
   the output block and runs into the middle contact of the input block. The
   arrowhead's tip is swallowed by the socket — **zero daylight** between arrow and
   connector. Check at 100%, 50% and 200% zoom: no gap opens at any of them.
2. **Three into one.** Three cards feeding one. Three separate wires land on the three
   middle contacts, 8px apart, three distinct arrowheads, and each wire makes its
   final turn at its own column 8px from its neighbour's. You can count the wires
   without following them back.
3. **Oversubscribed.** Six edges into one port: all five contacts in use, one doubled;
   no wire vanishes and none is routed off the block.
4. **Fan-out.** One card with three outgoing edges: three wires leaving three
   different pins, not one bundle off the centre.
5. **Cartridge read.** At 100% the connector reads as a run of discrete contact
   fingers — dark shell, bright fingers, square corners, hard 2px edges, no
   antialiased grey. Still legible as fingers at 50%.
6. **State colours.** Hover the card ⇒ contacts go amber. Hover the port itself or
   start a connection drag ⇒ contacts go accent blue and the bay fills
   `--accent-surface`. Never both at once.
7. **Stability.** Delete an edge elsewhere in the graph that does not touch this port:
   no wire on this port changes contact. Drag any card around: no wire changes
   contact.
8. **Loud edge.** An `overrides` edge (5px) into a busy port lands on its own contact
   and its arrow-plus-bar marker is still readable.

Reject the lane if 1, 2, 4 or 7 fails.
