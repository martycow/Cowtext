// React Flow view types. The store owns the domain model; these are the
// shapes the canvas maps it into. Type aliases (not interfaces) so they
// satisfy React Flow's Record<string, unknown> data constraint.

import { create } from "zustand";
import type { Node, Edge } from "@xyflow/react";
import type { EdgeKind, MemoryNode } from "../store/graph";

export type CanvasNodeData = { memory: MemoryNode };
export type CanvasNode = Node<CanvasNodeData, "memory">;

export type CanvasEdgeData = {
  kind: EdgeKind;
  condition?: string;
  note?: string;
  /** For sequence edges: the target node's readOrder, shown in the step dot. */
  step?: number;
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
