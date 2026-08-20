// Edge rendering — kind is read from line style + marker, never hue
// (DESIGN_SPEC.md: edges are neutral by rule; selected → accent).
// SOLID stroke = STRUCTURAL (participates in Kahn ordering / cycle
// validation, changes compiled output); DASHED/DOTTED = advisory /
// lint-only (never changes what gets compiled) — contract WO03 §"F —
// frontend". That split predates v3 (imports/sequence were already solid,
// references/conditional already dashed) — v3 just extends both families.
//   imports          3px   solid, pixel arrow                      STRUCTURAL
//   sequence         3px   solid, pixel chevron + numbered step tag STRUCTURAL
//   overrides        5px   solid, pixel arrow + trailing bar        STRUCTURAL
//   references       3px   dash 5 5, open circle                    advisory
//   conditional      3px   dash 3 5, pixel arrow + condition chip    advisory
//   supersedes       3px   dash 9 5, hollow square                  advisory
//   conflicts-with   3px   dash 3 3, cross marker                   advisory

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { Edit3, Trash2 } from "lucide-react";
import { EDGE_KINDS, useGraphStore, type EdgeKind } from "../store/graph";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { isStructuralEdgeKind } from "./edgeKind";
import { routeEdge } from "./edgePath";
import { CENTER_SLOT } from "./portSlots";
import { useHighlightStore, type CanvasEdge } from "./types";

// Barn canvas: wires are hard lines on an orthogonal route. 3px is the
// standard gauge — heavy enough to read as cabling against 2px plate edges
// and to look plugged into a 24px-tall socket. `overrides` stays the loud
// one at 5px. Dash patterns are whole pixels so the rhythm survives
// shape-rendering: crispEdges at any zoom.
const STROKE: Record<EdgeKind, { width: number; dash?: string }> = {
  imports: { width: 3 },
  references: { width: 3, dash: "5 5" },
  conditional: { width: 3, dash: "3 5" },
  sequence: { width: 3 },
  overrides: { width: 5 },
  supersedes: { width: 3, dash: "9 5" },
  "conflicts-with": { width: 3, dash: "3 3" },
};

function markerId(kind: EdgeKind, selected: boolean): string {
  if (selected) {
    if (kind === "references") return "ct-circle-selected";
    if (kind === "sequence") return "ct-chevron-selected";
    if (kind === "supersedes") return "ct-square-selected";
    if (kind === "conflicts-with") return "ct-cross-selected";
    return "ct-arrow-selected";
  }
  if (kind === "references") return "ct-circle-references";
  if (kind === "sequence") return "ct-chevron-sequence";
  if (kind === "supersedes") return "ct-square-supersedes";
  if (kind === "conflicts-with") return "ct-cross-conflicts-with";
  return `ct-arrow-${kind}`;
}

/** Marker defs, rendered once inside the canvas. Explicit per-kind colours —
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
  // Hollow square — "supersedes": the old node has been swapped out.
  const square = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="11"
      markerHeight="11"
      markerUnits="userSpaceOnUse"
    >
      <rect
        x="2"
        y="2"
        width="6"
        height="6"
        fill="var(--barn-canvas)"
        stroke={colour}
        strokeWidth="2"
      />
    </marker>
  );
  // Cross — "conflicts-with": a symmetric, bidirectional tension marker.
  const cross = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="11"
      markerHeight="11"
      markerUnits="userSpaceOnUse"
    >
      <path d="M2 2 L8 8 M8 2 L2 8" stroke={colour} strokeWidth="2" strokeLinecap="butt" />
    </marker>
  );
  return (
    <svg
      width="0"
      height="0"
      style={{ position: "absolute" }}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <defs>
        {arrow("ct-arrow-imports", "var(--edge-imports)")}
        {arrow("ct-arrow-conditional", "var(--edge-conditional)")}
        {arrow("ct-arrow-selected", "var(--edge-selected)")}
        {circle("ct-circle-references", "var(--edge-references)")}
        {circle("ct-circle-selected", "var(--edge-selected)")}
        {chevron("ct-chevron-sequence", "var(--edge-sequence)")}
        {chevron("ct-chevron-selected", "var(--edge-selected)")}
        {arrowBar("ct-arrow-overrides", "var(--edge-overrides)")}
        {square("ct-square-supersedes", "var(--edge-supersedes)")}
        {square("ct-square-selected", "var(--edge-selected)")}
        {cross("ct-cross-conflicts-with", "var(--edge-conflicts-with)")}
        {cross("ct-cross-selected", "var(--edge-selected)")}
      </defs>
    </svg>
  );
}

function MemoryEdgeInner(props: EdgeProps<CanvasEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, selected } = props;
  const kind: EdgeKind = props.data?.kind ?? "references";
  const updateEdge = useGraphStore((s) => s.updateEdge);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const setSelection = useGraphStore((s) => s.setSelection);
  const contextMenu = useContextMenu();
  const { path, labelX, labelY } = routeEdge({
    sourceX,
    sourceY,
    sourceSlot: props.data?.outSlot ?? CENTER_SLOT,
    targetX,
    targetY,
    targetSlot: props.data?.inSlot ?? CENTER_SLOT,
  });
  // Hover-highlight echo from the Relations grid renders like selection.
  const highlighted = useHighlightStore((s) => s.edgeIds.includes(id));
  const isSelected = selected === true || highlighted;
  const colour = isSelected ? "var(--edge-selected)" : `var(--edge-${kind})`;
  const stroke = STROKE[kind];

  const openMenu = (e: React.MouseEvent) => {
    const kindItem = (k: EdgeKind): MenuItem => ({
      kind: "item",
      id: `kind-${k}`,
      label: k,
      hint: isStructuralEdgeKind(k)
        ? "structural — changes compile order"
        : "advisory — lint only, doesn't change output",
      checked: k === kind,
      onSelect: () => updateEdge(id, { kind: k }),
    });
    const items: MenuItem[] = [
      ...EDGE_KINDS.filter(isStructuralEdgeKind).map(kindItem),
      { kind: "separator", id: "sep-structural" },
      ...EDGE_KINDS.filter((k) => !isStructuralEdgeKind(k)).map(kindItem),
      { kind: "separator", id: "sep-0" },
      {
        kind: "item",
        id: "edit-note",
        label: "Edit note…",
        icon: Edit3,
        onSelect: () => setSelection([], [id]),
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

  return (
    <>
      <g onContextMenu={openMenu}>
        <BaseEdge
          id={id}
          path={path}
          markerEnd={`url(#${markerId(kind, isSelected)})`}
          style={{
            stroke: colour,
            strokeWidth: stroke.width,
            strokeDasharray: stroke.dash,
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
      {(kind === "conditional" || kind === "sequence" || props.data?.note !== undefined) && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute flex items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {kind === "conditional" && (
              <span
                className="border-2 bg-plate px-1 py-px font-mono text-micro leading-none"
                style={{
                  borderColor: isSelected ? "var(--accent)" : "var(--plate-edge)",
                  color: isSelected ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                {props.data?.condition !== undefined && props.data.condition !== ""
                  ? props.data.condition
                  : "if …"}
              </span>
            )}
            {kind === "sequence" && (
              <span
                className="grid h-5 w-5 place-items-center border-2 bg-plate font-pixel text-[10px] leading-none"
                style={{
                  borderColor: isSelected ? "var(--accent)" : "var(--plate-edge-hi)",
                  color: isSelected ? "var(--accent-text)" : "var(--text-primary)",
                }}
              >
                {props.data?.step ?? "·"}
              </span>
            )}
            {props.data?.note !== undefined && props.data.note !== "" && (
              <span className="border-2 border-plate-edge bg-plate px-1 py-px text-micro leading-none text-content-muted">
                {props.data.note}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const MemoryEdgeView = memo(MemoryEdgeInner);
