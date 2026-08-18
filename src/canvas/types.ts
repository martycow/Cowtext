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
}

export const useInspectorTabStore = create<InspectorTabState>((set) => ({
  tab: "properties",
  setTab: (tab) => set({ tab }),
}));
