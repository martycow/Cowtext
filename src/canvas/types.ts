// React Flow view types. The store owns the domain model; these are the
// shapes the canvas maps it into. Type aliases (not interfaces) so they
// satisfy React Flow's Record<string, unknown> data constraint.

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
