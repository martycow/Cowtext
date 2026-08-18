// Edge rendering — kind is read from line style + marker, never hue
// (DESIGN_SPEC.md: edges are neutral by rule; selected → accent).
//   imports      1.75px solid, filled arrow
//   references   1.5px dash 5 4, open circle
//   conditional  1.5px dot 1.5 3.5, filled arrow + mono condition chip
//   sequence     1.5px solid, open chevron + numbered step dot

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { Edit3, Trash2 } from "lucide-react";
import { EDGE_KINDS, useGraphStore, type EdgeKind } from "../store/graph";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { routeEdge } from "./edgePath";
import { useHighlightStore, type CanvasEdge } from "./types";

const STROKE: Record<EdgeKind, { width: number; dash?: string }> = {
  imports: { width: 1.75 },
  references: { width: 1.5, dash: "5 4" },
  conditional: { width: 1.5, dash: "1.5 3.5" },
  sequence: { width: 1.5 },
};

function markerId(kind: EdgeKind, selected: boolean): string {
  if (selected) {
    if (kind === "references") return "ct-circle-selected";
    if (kind === "sequence") return "ct-chevron-selected";
    return "ct-arrow-selected";
  }
  if (kind === "references") return "ct-circle-references";
  if (kind === "sequence") return "ct-chevron-sequence";
  return `ct-arrow-${kind}`;
}

/** Marker defs, rendered once inside the canvas. Explicit per-kind colours —
 *  markers cannot inherit the edge stroke without context-stroke.
 *  markerUnits="userSpaceOnUse" (contract §7.11.4) fixes the arrow to an
 *  absolute size regardless of each kind's stroke width (1.5 vs 1.75), and
 *  refX is tuned to the BACK of each shape (not the tip) so the line's
 *  round linecap terminates under the marker instead of poking past it. */
export function EdgeMarkerDefs() {
  const arrow = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="1"
      refY="5"
      markerWidth="8"
      markerHeight="8"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path d="M0 0 L10 5 L0 10 z" fill={colour} />
    </marker>
  );
  const circle = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="7"
      refY="5"
      markerWidth="9"
      markerHeight="9"
      markerUnits="userSpaceOnUse"
    >
      <circle cx="5" cy="5" r="3.25" fill="var(--surface-canvas)" stroke={colour} strokeWidth="1.5" />
    </marker>
  );
  const chevron = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="2"
      refY="5"
      markerWidth="9"
      markerHeight="9"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <path d="M3 1 L8 5 L3 9" fill="none" stroke={colour} strokeWidth="1.5" strokeLinecap="round" />
    </marker>
  );
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {arrow("ct-arrow-imports", "var(--edge-imports)")}
        {arrow("ct-arrow-conditional", "var(--edge-conditional)")}
        {arrow("ct-arrow-selected", "var(--edge-selected)")}
        {circle("ct-circle-references", "var(--edge-references)")}
        {circle("ct-circle-selected", "var(--edge-selected)")}
        {chevron("ct-chevron-sequence", "var(--edge-sequence)")}
        {chevron("ct-chevron-selected", "var(--edge-selected)")}
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
  const { path, labelX, labelY } = routeEdge(sourceX, sourceY, targetX, targetY);
  // Hover-highlight echo from the Relations grid renders like selection.
  const highlighted = useHighlightStore((s) => s.edgeIds.includes(id));
  const isSelected = selected === true || highlighted;
  const colour = isSelected ? "var(--edge-selected)" : `var(--edge-${kind})`;
  const stroke = STROKE[kind];

  const openMenu = (e: React.MouseEvent) => {
    const items: MenuItem[] = [
      ...EDGE_KINDS.map(
        (k): MenuItem => ({
          kind: "item",
          id: `kind-${k}`,
          label: k,
          checked: k === kind,
          onSelect: () => updateEdge(id, { kind: k }),
        }),
      ),
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
            strokeLinecap: "round",
          }}
          interactionWidth={16}
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
                className="rounded-sm border bg-surface-2 px-1 py-px font-mono text-micro"
                style={{
                  borderColor: isSelected ? "var(--accent-border)" : "var(--border-default)",
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
                className="grid h-4 w-4 place-items-center rounded-pill border bg-surface-2 font-mono text-micro"
                style={{
                  borderColor: isSelected ? "var(--accent-border)" : "var(--border-strong)",
                  color: isSelected ? "var(--accent-text)" : "var(--text-secondary)",
                }}
              >
                {props.data?.step ?? "·"}
              </span>
            )}
            {props.data?.note !== undefined && props.data.note !== "" && (
              <span className="rounded-sm bg-surface-2 px-1 py-px text-micro text-content-muted">
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
