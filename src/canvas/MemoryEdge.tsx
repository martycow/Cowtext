// Edge rendering — kind is read from line style + marker, never hue
// (DESIGN_SPEC.md: edges are neutral by rule; selected → accent). WO10 adds
// one deliberate exception: an author may pin a wire to a colour from a
// closed palette (canvas/edgeColor.ts), which overrides the neutral. The
// palette borrows no role hue, so "colour means role" still holds.
//
// v5 (WO13_CONTRACT.md §7, §14.5): 5 kinds. SOLID = affects compiled output
// (imports/sequence/overrides — the file's-point-of-view "structural" group
// in KindPicker.tsx); DASHED = advisory, linter-only (references always;
// contradicts always). A GUARD dashes any kind that can legally carry one
// (everything but `contradicts`, §7.1) — that is the visual distinction the
// old `conditional` kind used to own by itself, now available on any of
// them without a separate menu entry (edge spec E2).
//   imports          3px   solid, pixel arrow                 (guard → dashed)
//   sequence         3px   solid, pixel chevron + step tag     (guard → dashed)
//   overrides        5px   solid, pixel arrow + trailing bar   (guard → dashed)
//   references       3px   dash 5 5, open circle               (guard → dashed)
//   contradicts      3px   dash 3 3, cross marker at BOTH ends — no
//                          arrowhead, ever: §7.2 stores it as a symmetric,
//                          unordered pair, and an arrow would claim a
//                          direction that does not exist.
//
// ── The three emphasis tones (WO10 items 1 + 2) ──────────────────────────
//   rest      the kind's colour, or the author's palette override
//   related   a wire touching the selected NODE — `--edge-related`
//   selected  the wire itself is selected — `--edge-selected`, and it is
//             lifted above every other wire so a crossing can be followed
// Markers cannot inherit `stroke` (no `context-stroke` in any shipping
// engine), so every (shape, tone) pair needs its own <marker> def. They are
// generated from one table below rather than hand-listed — adding a palette
// colour must not mean remembering to add six defs.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BaseEdge, EdgeLabelRenderer, useStore, type EdgeProps } from "@xyflow/react";
import { Edit3, Spline, Trash2 } from "lucide-react";
import { EDGE_KINDS, useGraphStore, type EdgeKind } from "../store/graph";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { affectsOutput } from "./edgeKind";
import { legalityFor } from "../config/edgeRules";
import { EDGE_COLOR_KEYS, edgeMarkerSuffix, edgeStroke } from "./edgeColor";
import { dragHandles, moveSegment } from "./edgeEdit";
import { edgeLabel } from "./edgeVerb";
import { routeEdge, type Point } from "./edgePath";
import { SINGLE_SLOT } from "./portSlots";
import { useEdgeLabelStore, useHighlightStore, type CanvasEdge } from "./types";

// Barn canvas: wires are hard lines on an orthogonal route. 3px is the
// standard gauge — heavy enough to read as cabling against 2px plate edges
// and to look plugged into a socket. `overrides` stays the loud one at 5px.
// Dash patterns are whole pixels so the rhythm survives
// shape-rendering: crispEdges at any zoom.
const STROKE: Record<EdgeKind, { width: number; dash?: string }> = {
  imports: { width: 3 },
  references: { width: 3, dash: "5 5" },
  sequence: { width: 3 },
  overrides: { width: 5 },
  contradicts: { width: 3, dash: "3 3" },
};

/** A guarded edge renders dashed regardless of its kind's own base style —
 *  the visual distinction the removed `conditional` kind used to provide by
 *  itself (§14.5, edge spec E2). `contradicts` can never carry a guard
 *  (§7.1), so this pattern is never reached for it. */
const GUARD_DASH = "3 5";

type Shape = "arrow" | "circle" | "chevron" | "arrowBar" | "cross";

/** Which marker shape a kind ends with. The shape carries the kind; the tone
 *  carries the emphasis. Keeping them orthogonal is what makes the def table
 *  a product of two small lists instead of one long hand-written one. */
function shapeFor(kind: EdgeKind): Shape {
  if (kind === "references") return "circle";
  if (kind === "sequence") return "chevron";
  if (kind === "overrides") return "arrowBar";
  // contradicts (§7.2): symmetric tension marker, drawn at BOTH ends below —
  // never an arrowhead, because the relation has no direction.
  if (kind === "contradicts") return "cross";
  return "arrow"; // imports
}

function markerId(kind: EdgeKind, tone: string): string {
  return `ct-${shapeFor(kind)}-${tone}`;
}

/** The emphasis tone a wire paints in, highest priority first. At rest the
 *  tone IS the kind, which is why the rest defs need only one shape each. */
function toneFor(kind: EdgeKind, selected: boolean, related: boolean, color: string | undefined): string {
  if (selected) return "selected";
  if (related) return "related";
  return edgeMarkerSuffix(color) ?? kind;
}

/** Marker defs, rendered once inside the canvas. Explicit per-tone colours —
 *  markers cannot inherit the edge stroke without context-stroke.
 *  markerUnits="userSpaceOnUse" (contract §7.11.4) fixes each marker to an
 *  absolute size regardless of its kind's stroke width, and refX is tuned to
 *  the FORWARD edge of each shape so the marker lands exactly ON the path's
 *  endpoint. WO09 round 2 (docs/design/WO09_CONNECTOR_CONTRACT.md §2-3):
 *  the marker tip now lands 3px INSIDE the socket face by design — edges
 *  render below nodes, so canvas/edgePath.ts deliberately ends the path
 *  SOCKET_BITE (3px) past the bay's outer face, and the hardware swallows
 *  the tip with zero daylight instead of the arrow floating short of it.
 *  refX itself is unchanged; only where the path ends moved. */
export function EdgeMarkerDefs() {
  // Stepped 5-cell pixel triangle instead of a smooth one: at 8px on screen
  // a vector arrowhead antialiases into a grey smudge, while the steps stay
  // hard and read as deliberate at every zoom.
  const PIXEL_ARROW = "M0 0h2v10h-2z M2 1h2v8h-2z M4 2h2v6h-2z M6 3h2v4h-2z M8 4h2v2h-2z";
  const arrow = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="10"
      refY="5"
      markerWidth="11"
      markerHeight="11"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path d={PIXEL_ARROW} fill={colour} />
    </marker>
  );
  const circle = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="9.25"
      refY="5"
      markerWidth="11"
      markerHeight="11"
      markerUnits="userSpaceOnUse"
    >
      <circle cx="5" cy="5" r="3.25" fill="var(--barn-canvas)" stroke={colour} strokeWidth="2" />
    </marker>
  );
  // Pixel chevron — same staircase logic as the arrow, drawn open.
  const chevron = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="6"
      refY="5"
      markerWidth="11"
      markerHeight="11"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path
        d="M0 0h2v2h-2z M2 2h2v2h-2z M4 4h2v2h-2z M2 6h2v2h-2z M0 8h2v2h-2z"
        fill={colour}
      />
    </marker>
  );
  // v3 (WO03) — filled arrow + trailing bar: "overrides", the structural
  // kind that WINS over what it points at, reads as an arrow hitting a wall.
  const arrowBar = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 12 10"
      refX="12"
      refY="5"
      markerWidth="13"
      markerHeight="11"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path d={PIXEL_ARROW} fill={colour} />
      <rect x="10" y="1" width="2" height="8" fill={colour} />
    </marker>
  );
  // Cross — "contradicts" (§7.2): a symmetric, bidirectional tension
  // marker, drawn at BOTH ends of the wire (never just markerEnd) so
  // nothing reads as a directional arrowhead. refX/refY sit on the cross's
  // own visual centre (2..8 in an 0..10 box) rather than offset toward one
  // side, the way the directional shapes above are — this one has to look
  // identical anchored at a path's start OR its end.
  const cross = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="5"
      refY="5"
      markerWidth="11"
      markerHeight="11"
      markerUnits="userSpaceOnUse"
    >
      <path d="M2 2 L8 8 M8 2 L2 8" stroke={colour} strokeWidth="2" strokeLinecap="butt" />
    </marker>
  );

  const draw: Record<Shape, (id: string, colour: string) => React.ReactElement> = {
    arrow,
    circle,
    chevron,
    arrowBar,
    cross,
  };
  const SHAPES: Shape[] = ["arrow", "circle", "chevron", "arrowBar", "cross"];

  // Rest tones are per-KIND, so only that kind's own shape is ever asked
  // for — one def each. Override and emphasis tones can land on any kind, so
  // those need the full shape set.
  const defs: React.ReactElement[] = EDGE_KINDS.map((k) =>
    draw[shapeFor(k)](markerId(k, k), `var(--edge-${k})`),
  );
  const universal: { tone: string; css: string }[] = [
    ...EDGE_COLOR_KEYS.map((key) => ({ tone: key, css: `var(--edge-c-${key})` })),
    { tone: "selected", css: "var(--edge-selected)" },
    { tone: "related", css: "var(--edge-related)" },
  ];
  for (const { tone, css } of universal) {
    for (const shape of SHAPES) defs.push(draw[shape](`ct-${shape}-${tone}`, css));
  }

  return (
    <svg
      width="0"
      height="0"
      style={{ position: "absolute" }}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <defs>{defs}</defs>
    </svg>
  );
}

/** One draggable segment midpoint. Square, 9px, and only ever rendered on a
 *  selected edge — a canvas covered in grab handles would be unreadable, and
 *  the handles would out-compete the wires for every click. */
function SegmentHandle({
  x,
  y,
  axis,
  onGrab,
}: {
  x: number;
  y: number;
  axis: "horizontal" | "vertical" | "point";
  onGrab: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      // nodrag/nopan: React Flow must not read this as a pan or a node drag.
      className="nodrag nopan pointer-events-auto absolute h-[9px] w-[9px] border-2"
      style={{
        transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        borderColor: "var(--edge-selected)",
        background: "var(--barn-canvas)",
        cursor: axis === "vertical" ? "ew-resize" : "ns-resize",
      }}
      onPointerDown={onGrab}
    />
  );
}

function MemoryEdgeInner(props: EdgeProps<CanvasEdge>) {
  const { id, source, target, sourceX, sourceY, targetX, targetY, selected } = props;
  const kind: EdgeKind = props.data?.kind ?? "references";
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const setSelection = useGraphStore((s) => s.setSelection);
  // A wire touching the selected node reads as "part of what you picked"
  // (WO10 item 1). Subscribing to the boolean, not the array, so selecting a
  // node only re-renders the edges whose answer actually changed.
  const related = useGraphStore(
    (s) => s.selectedNodeIds.includes(source) || s.selectedNodeIds.includes(target),
  );
  const zoom = useStore((s) => s.transform[2]);
  const contextMenu = useContextMenu();

  // Live drag preview. While a segment is being dragged the route comes from
  // here instead of the store, so the wire follows the pointer without a
  // write (and so without an undo entry) per frame.
  const [preview, setPreview] = useState<Point[] | null>(null);
  // Mirrors dragRef's liveness as STATE, because the full-viewport pointer
  // catcher below is rendered from it — a ref alone would never re-render.
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ index: number; startX: number; startY: number; points: Point[] } | null>(
    null,
  );

  const waypoints = preview ?? props.data?.waypoints;
  const { path, labelX, labelY, points, handEdited } = routeEdge({
    sourceX,
    sourceY,
    sourceSlot: props.data?.outSlot ?? SINGLE_SLOT,
    targetX,
    targetY,
    targetSlot: props.data?.inSlot ?? SINGLE_SLOT,
    waypoints,
  });

  // Hover-highlight echo from the Relations grid renders like selection.
  const highlighted = useHighlightStore((s) => s.edgeIds.includes(id));
  const isSelected = selected === true || highlighted;
  const tone = toneFor(kind, isSelected, related, props.data?.color);
  const colour =
    tone === "selected"
      ? "var(--edge-selected)"
      : tone === "related"
        ? "var(--edge-related)"
        : edgeStroke(kind, props.data?.color);
  const stroke = STROKE[kind];

  // ── Label: one chip, nudged clear of its neighbours ──────────────────
  const label = edgeLabel(kind, {
    guard: props.data?.guard,
    note: props.data?.note,
    step: props.data?.step,
  });
  const LabelIcon = label.icon;
  const labelRef = useRef<HTMLDivElement>(null);
  const reportBox = useEdgeLabelStore((s) => s.report);
  const dropBox = useEdgeLabelStore((s) => s.drop);
  const dy = useEdgeLabelStore((s) => s.offsets[id] ?? 0);

  // Measure in flow units: offsetWidth/Height are pre-transform, so they are
  // already zoom-independent and the solver never has to know about zoom.
  // WO13_CONTRACT.md §2.7(c): `color`/`kind` are added as a CORRECTNESS
  // GUARD only, not because a colour change is proven to move labelX/labelY
  // — it does not (routeEdge's output is unrelated to colour). What DOES
  // change on a colour or kind edit is the chip's own rendered width (the
  // border/text colour swap below never resizes it, but a kind change can
  // swap the icon and the verb text, which does). Re-measuring on either
  // costs nothing (the effect is a no-op when the box is unchanged, see
  // `report`'s dedupe in canvas/types.ts) and closes the one path where a
  // stale `w`/`h` could linger after an edit.
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (el === null) return;
    reportBox({ id, x: labelX, y: labelY, w: el.offsetWidth, h: el.offsetHeight });
  }, [id, labelX, labelY, label.text, reportBox, props.data?.color, kind]);

  useEffect(() => () => dropBox(id), [id, dropBox]);

  // ── Segment dragging (WO10 item 4) ───────────────────────────────────
  const onGrab = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = { index, startX: e.clientX, startY: e.clientY, points: [...points] };
      setDragging(true);
    },
    [points],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (drag === null) return;
      const delta = { x: (e.clientX - drag.startX) / zoom, y: (e.clientY - drag.startY) / zoom };
      const next = moveSegment(drag.points, drag.index, delta);
      if (next !== null) setPreview(next);
    },
    [zoom],
  );

  const onDragEnd = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (drag === null) return;
      const delta = { x: (e.clientX - drag.startX) / zoom, y: (e.clientY - drag.startY) / zoom };
      const next = moveSegment(drag.points, drag.index, delta);
      setPreview(null);
      // Below the threshold `moveSegment` returns null — that was a click on
      // the handle, not an edit, and must not push an undo entry.
      if (next !== null) updateEdge(id, { waypoints: next });
    },
    [id, updateEdge, zoom],
  );

  const openMenu = (e: React.MouseEvent) => {
    // Read once at open time (the menu is ephemeral) rather than
    // subscribing — a right-click that outlives a graph edit is not a case
    // worth tracking. §7.3: re-checked here as a UI-side courtesy so the
    // switcher does not visibly offer a kind the legality matrix would
    // refuse; the store's `addEdge` is the actual gate for creation.
    const nodes = useGraphStore.getState().nodes;
    const sourceNode = nodes.find((n) => n.id === source);
    const targetNode = nodes.find((n) => n.id === target);
    const kindItem = (k: EdgeKind): MenuItem => {
      const check =
        sourceNode !== undefined && targetNode !== undefined
          ? legalityFor(sourceNode.role, k, targetNode.role, targetNode.deprecated !== undefined)
          : { legality: "allow" as const, reason: "" };
      const denied = check.legality === "deny";
      return {
        kind: "item",
        id: `kind-${k}`,
        label: k,
        hint: denied
          ? check.reason
          : affectsOutput(k)
            ? "changes what lands in the file"
            : "advisory — linter only, never compiled",
        checked: k === kind,
        disabled: denied,
        onSelect: () => {
          if (!denied) updateEdge(id, { kind: k });
        },
      };
    };
    const items: MenuItem[] = [
      ...EDGE_KINDS.filter(affectsOutput).map(kindItem),
      { kind: "separator", id: "sep-structural" },
      ...EDGE_KINDS.filter((k) => !affectsOutput(k)).map(kindItem),
      { kind: "separator", id: "sep-0" },
      {
        kind: "item",
        id: "edit-note",
        label: "Edit note…",
        icon: Edit3,
        onSelect: () => setSelection([], [id]),
      },
      {
        kind: "item",
        id: "reset-path",
        label: "Reset path",
        icon: Spline,
        disabled: !handEdited,
        hint: handEdited ? "back to the automatic route" : "already automatic",
        onSelect: () => updateEdge(id, { waypoints: [] }),
      },
      { kind: "separator", id: "sep-1" },
      {
        kind: "item",
        id: "delete",
        label: "Delete edge",
        icon: Trash2,
        danger: true,
        onSelect: () => deleteEdges([id]),
      },
    ];
    contextMenu.openAt(e, items);
  };

  const handles = isSelected ? dragHandles(points) : [];
  // §7.2: `contradicts` is symmetric and gets the SAME marker at both ends
  // (the cross shape has no orientation of its own, unlike the arrows) —
  // never a markerEnd-only arrowhead, which would claim a direction the
  // relation does not have.
  const markerUrl = `url(#${markerId(kind, tone)})`;
  const guarded = props.data?.guard !== undefined;

  return (
    <>
      <g onContextMenu={openMenu}>
        <BaseEdge
          id={id}
          path={path}
          markerStart={kind === "contradicts" ? markerUrl : undefined}
          markerEnd={markerUrl}
          style={{
            stroke: colour,
            // A related wire thickens by 1 so the emphasis survives on the
            // thin dashed kinds, where a hue step alone is easy to miss.
            strokeWidth: related && !isSelected ? stroke.width + 1 : stroke.width,
            strokeDasharray: guarded ? GUARD_DASH : stroke.dash,
            // Butt caps + miter joins: a round cap on a 2px orthogonal wire
            // rounds off the corners the square routing exists to produce.
            strokeLinecap: "butt",
            strokeLinejoin: "miter",
          }}
          // G20: was 16 (round 1); at FINGER_PITCH 8 (portSlots.ts SLOT_PITCH)
          // a 16px hit band straddles the neighbouring contact's wire.
          interactionWidth={12}
        />
      </g>
      {contextMenu.menu !== null && (
        <ContextMenu
          x={contextMenu.menu.x}
          y={contextMenu.menu.y}
          items={contextMenu.menu.items}
          onClose={contextMenu.close}
        />
      )}
      <EdgeLabelRenderer>
        <div
          ref={labelRef}
          className="pointer-events-none absolute flex items-center gap-1 border-2 bg-plate px-1 py-px leading-none"
          style={{
            // dy is the collision solver's answer (canvas/labelSlots.ts).
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + dy}px)`,
            // WO13_CONTRACT.md §2.7(a) / defect 7: this used to derive from
            // isSelected/related ONLY, falling back to a fixed
            // `--plate-edge` grey — a recoloured wire kept a default-plate
            // chip beside a saturated line. `colour` (above) is the exact
            // value the wire's own stroke paints with, selected/related
            // tones included, so reusing it here makes the chip and the
            // wire the same object by construction rather than two things
            // that happen to usually agree.
            borderColor: colour,
            // Text stays on the dedicated `-text` tokens for selected/
            // related — `--edge-related` resolves to a translucent
            // `accent-border` (rgba .38), fine as a border, unreadable as
            // text. At rest `colour` is always an opaque kind or palette
            // token (never the translucent one), so it is safe as text too.
            color: isSelected ? "var(--accent-text)" : related ? "var(--text-secondary)" : colour,
            // Above the wires, below the cards.
            zIndex: isSelected ? 2 : 1,
          }}
          title={label.title}
        >
          <LabelIcon size={10} strokeWidth={2} />
          <span className="font-mono text-micro">{label.text}</span>
          {label.step !== undefined && (
            <span className="font-pixel text-[8px] text-content-muted">{label.step}</span>
          )}
        </div>
        {handles.map((h) => (
          <SegmentHandle
            key={h.index}
            x={h.x}
            y={h.y}
            axis={h.axis}
            onGrab={onGrab(h.index)}
          />
        ))}
      </EdgeLabelRenderer>
      {/* A full-window catcher while a drag is live, so the pointer can leave
          the 9px handle without the segment snapping back.

          Portalled to <body> deliberately: EdgeLabelRenderer's container
          carries the viewport transform, and a transformed ancestor becomes
          the containing block for `position: fixed` — so a catcher rendered
          inside it would cover the transformed box, not the window, and would
          drop the pointer exactly when the drag leaves the visible graph. */}
      {dragging &&
        createPortal(
          <div
            className="nodrag nopan fixed inset-0 z-modal"
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          />,
          document.body,
        )}
    </>
  );
}

export const MemoryEdgeView = memo(MemoryEdgeInner);
