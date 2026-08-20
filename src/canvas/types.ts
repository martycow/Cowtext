// React Flow view types. The store owns the domain model; these are the
// shapes the canvas maps it into. Type aliases (not interfaces) so they
// satisfy React Flow's Record<string, unknown> data constraint.

import { create } from "zustand";
import type { Node, Edge } from "@xyflow/react";
import type { EdgeKind, MemoryNode } from "../store/graph";
import type { PortSlot } from "./portSlots";
import { resolveLabelOffsets, type LabelBox } from "./labelSlots";

export type CanvasNodeData = { memory: MemoryNode; pins?: CanvasNodePins };
export type CanvasNode = Node<CanvasNodeData, "memory">;

export type CanvasNodePins = {
  /** Visible contact fingers on the card's input block (canvas/portSlots.ts).
   *  One per inbound edge, floor 1, capped at MAX_PINS. */
  in: number;
  /** Same, for the output block and outbound edges. */
  out: number;
};

export type CanvasEdgeData = {
  kind: EdgeKind;
  condition?: string;
  note?: string;
  /** For sequence edges: the target node's readOrder, shown in the step tag. */
  step?: number;
  /** v3 edge colour override — a canvas/edgeColor.ts palette key. */
  color?: string;
  /** v4 hand-edited route, in flow space (canvas/edgePath.ts). */
  waypoints?: { x: number; y: number }[];
  /** Contact slot on the target card's input block (canvas/portSlots.ts). */
  inSlot?: PortSlot;
  /** Contact slot on the source card's output block. */
  outSlot?: PortSlot;
};
export type CanvasEdge = Edge<CanvasEdgeData, "memory">;

// ── Cross-panel UI-only state ──────────────────────────────────────────
// A tiny local store (not the domain graph) so the node card's "Open
// markdown" context-menu entry can switch the Inspector to its Markdown tab
// without the canvas statically importing inspector/Inspector.tsx — that
// module pulls in CodeMirror and is lazy-loaded from App.tsx for code
// splitting; importing it here would defeat that split.
export type InspectorTab = "properties" | "markdown";

interface InspectorTabState {
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  /** WO11 §12.3 item 3 / §12.6 "tab-store reset seam" — `tab` used to be
   *  global with no relationship to the Inspector's selection at all, which
   *  is exactly what let clicking an agent node while already on the
   *  Markdown tab reach the §12.1 stale-read hazard in zero clicks: the old
   *  Markdown buffer (a different file, or a different generation of this
   *  one) stayed mounted and armed to overwrite whatever was under it.
   *  `resetTab` is a distinct action from `setTab` — called ONLY by the
   *  Inspector when the underlying selection changes identity (a different
   *  node/edge/task/agent, or the project row), never from a user's own tab
   *  click — so every call site says WHY it's resetting, and the one place
   *  that does it is grep-able as a single seam rather than a scattered
   *  `setTab("properties")`. */
  resetTab: () => void;
  /** Set by every "Rename file…" entry point; the Inspector's File field
   *  consumes it by focusing itself for editing. A flag (consumed on focus)
   *  rather than a counter so it survives the field remounting when the
   *  request also changes the selection. */
  renamePending: boolean;
  requestRename: () => void;
  consumeRename: () => void;
}

export const useInspectorTabStore = create<InspectorTabState>((set) => ({
  tab: "properties",
  setTab: (tab) => set({ tab }),
  resetTab: () => set({ tab: "properties" }),
  renamePending: false,
  requestRename: () => set({ tab: "properties", renamePending: true }),
  consumeRename: () => set({ renamePending: false }),
}));

// Transient hover highlight — set while the pointer rests on a row in the
// Inspector's Relations grid (one neighbour + one edge) or on a file-rail
// row (the node plus its whole neighbourhood); canvas cards and edges echo
// it with an accent ring/stroke. UI-only, never persisted.
interface HighlightState {
  nodeIds: string[];
  edgeIds: string[];
  setHighlight: (nodeIds: string[], edgeIds: string[]) => void;
  clearHighlight: () => void;
}

export const useHighlightStore = create<HighlightState>((set) => ({
  nodeIds: [],
  edgeIds: [],
  setHighlight: (nodeIds, edgeIds) => set({ nodeIds, edgeIds }),
  clearHighlight: () => set({ nodeIds: [], edgeIds: [] }),
}));

// ── Viewport focus requests (WO10 item 8) ─────────────────────────────
// Selecting a node in the Hierarchy used to leave the canvas exactly where
// it was, so picking a row could "select" something 4000px off-screen and
// look like nothing happened. The panels that own a selection ASK for focus
// here; GraphCanvas is the only consumer, and it decides whether the node is
// actually off-screen before moving anything — a request is a request, not a
// command, so clicking a card that is already visible never yanks the view.
//
// A counter rather than a bare id: re-picking the SAME row must re-focus
// (the user may have panned away since), and an id alone cannot express
// "asked again".
interface FocusState {
  nodeId: string | null;
  /** Bumped on every request; GraphCanvas keys its effect on this. */
  nonce: number;
  requestFocus: (nodeId: string) => void;
}

export const useFocusStore = create<FocusState>((set) => ({
  nodeId: null,
  nonce: 0,
  requestFocus: (nodeId) => set((s) => ({ nodeId, nonce: s.nonce + 1 })),
}));

// ── Edge-label placement (WO10 item 5) ────────────────────────────────
// Each MemoryEdge reports the box its chip wants to occupy; this store keeps
// the collective answer — how far each chip must move so none of them
// overlap. Splitting it this way is what lets the collision solver stay a
// pure function (canvas/labelSlots.ts) while the measurements it needs can
// only come from the rendered DOM.
//
// Recomputation is batched into a microtask: mounting a 60-edge graph
// reports 60 boxes in one commit, and resolving after each would be 60
// sweeps to reach the same answer as one.
interface EdgeLabelState {
  boxes: Record<string, LabelBox>;
  /** edgeId → y offset in flow px. Absent ⇒ 0, the overwhelmingly common
   *  case; MemoryEdge reads it with `?? 0` and re-renders only when its own
   *  entry changes. */
  offsets: Record<string, number>;
  report: (box: LabelBox) => void;
  drop: (id: string) => void;
}

let resolveQueued = false;

export const useEdgeLabelStore = create<EdgeLabelState>((set, get) => {
  /** Recompute offsets from the current boxes, once per microtask. Writing
   *  the same object back when nothing moved would re-render every edge, so
   *  an unchanged result is dropped on the floor. */
  const scheduleResolve = () => {
    if (resolveQueued) return;
    resolveQueued = true;
    queueMicrotask(() => {
      resolveQueued = false;
      const boxes = Object.values(get().boxes);
      const next = resolveLabelOffsets(boxes);
      const prev = get().offsets;
      const nextRecord: Record<string, number> = {};
      next.forEach((dy, id) => {
        nextRecord[id] = dy;
      });
      const prevKeys = Object.keys(prev);
      const same =
        prevKeys.length === Object.keys(nextRecord).length &&
        prevKeys.every((k) => prev[k] === nextRecord[k]);
      if (!same) set({ offsets: nextRecord });
    });
  };

  return {
    boxes: {},
    offsets: {},
    report: (box) => {
      const cur = get().boxes[box.id];
      if (
        cur !== undefined &&
        cur.x === box.x &&
        cur.y === box.y &&
        cur.w === box.w &&
        cur.h === box.h
      ) {
        return;
      }
      set((s) => ({ boxes: { ...s.boxes, [box.id]: box } }));
      scheduleResolve();
    },
    drop: (id) => {
      if (get().boxes[id] === undefined) return;
      set((s) => {
        const boxes = { ...s.boxes };
        delete boxes[id];
        return { boxes };
      });
      scheduleResolve();
    },
  };
});
