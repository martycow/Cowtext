// Edge rendering — kind is read from line style + marker, never hue
// (DESIGN_SPEC.md: edges are neutral by rule; selected → accent).
//   imports      1.75px solid, filled arrow
//   references   1.5px dash 5 4, open circle
//   conditional  1.5px dot 1.5 3.5, filled arrow + mono condition chip
//   sequence     1.5px solid, open chevron + numbered step dot

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { EdgeKind } from "../store/graph";
import type { CanvasEdge } from "./types";

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
 *  markers cannot inherit the edge stroke without context-stroke. */
export function EdgeMarkerDefs() {
  const arrow = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
    >
      <path d="M0 0 L10 5 L0 10 z" fill={colour} />
    </marker>
  );
  const circle = (id: string, colour: string) => (
    <marker key={id} id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8">
      <circle cx="5" cy="5" r="3.25" fill="var(--surface-canvas)" stroke={colour} strokeWidth="1.5" />
    </marker>
  );
  const chevron = (id: string, colour: string) => (
    <marker
      key={id}
      id={id}
      viewBox="0 0 10 10"
      refX="8"
      refY="5"
      markerWidth="8"
      markerHeight="8"
      orient="auto-start-reverse"
    >
      <path d="M3 1 L8 5 L3 9" fill="none" stroke={colour} strokeWidth="1.5" />
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
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected } =
    props;
  const kind: EdgeKind = props.data?.kind ?? "references";
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const isSelected = selected === true;
  const colour = isSelected ? "var(--edge-selected)" : `var(--edge-${kind})`;
  const stroke = STROKE[kind];

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#${markerId(kind, isSelected)})`}
        style={{
          stroke: colour,
          strokeWidth: stroke.width,
          strokeDasharray: stroke.dash,
        }}
        interactionWidth={16}
      />
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
