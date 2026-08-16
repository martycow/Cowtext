// Graph canvas — React Flow renders FROM the store (single source of truth).
// The RF-local node/edge arrays are a projection: in-flight drag positions and
// selection live here; every real mutation round-trips through the store.

import { useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import { useGraphStore } from "../store/graph";
import { MemoryNodeCard } from "./MemoryNodeCard";
import { EdgeMarkerDefs, MemoryEdgeView } from "./MemoryEdge";
import { KindPicker } from "./KindPicker";
import type { CanvasEdge, CanvasNode } from "./types";

const nodeTypes = { memory: MemoryNodeCard };
const edgeTypes = { memory: MemoryEdgeView };

function CanvasInner() {
  const domainNodes = useGraphStore((s) => s.nodes);
  const domainEdges = useGraphStore((s) => s.edges);
  const moveNode = useGraphStore((s) => s.moveNode);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const beginConnection = useGraphStore((s) => s.beginConnection);
  const createNode = useGraphStore((s) => s.createNode);
  const setSelection = useGraphStore((s) => s.setSelection);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const { screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Store → RF nodes. Keep in-flight drag positions and RF-side selection;
  // brand-new nodes take their selection from the store (createNode selects).
  useEffect(() => {
    const selected = new Set(useGraphStore.getState().selectedNodeIds);
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n] as const));
      return domainNodes.map((n): CanvasNode => {
        const existing = prevById.get(n.id);
        return {
          id: n.id,
          type: "memory",
          position: existing?.dragging === true ? existing.position : n.position,
          data: { memory: n },
          selected: existing !== undefined ? existing.selected : selected.has(n.id),
          dragging: existing?.dragging,
          measured: existing?.measured,
        };
      });
    });
  }, [domainNodes, setNodes]);

  // Store → RF edges. Sequence edges carry the target's readOrder as the
  // numbered step dot (DESIGN_SPEC.md edge rules).
  useEffect(() => {
    const orderById = new Map(domainNodes.map((n) => [n.id, n.readOrder] as const));
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e] as const));
      return domainEdges.map(
        (e): CanvasEdge => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: "memory",
          selected: prevById.get(e.id)?.selected ?? false,
          data: {
            kind: e.kind,
            condition: e.condition,
            note: e.note,
            step: e.kind === "sequence" ? orderById.get(e.target) : undefined,
          },
        }),
      );
    });
  }, [domainEdges, domainNodes, setEdges]);

  const newNodeAtCenter = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const pos = screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    void createNode({ x: Math.round(pos.x - 122), y: Math.round(pos.y - 48) });
  };

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.classList.contains("react-flow__pane")) return;
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        void createNode({ x: Math.round(pos.x - 122), y: Math.round(pos.y - 48) });
      }}
    >
      <EdgeMarkerDefs />
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_e, _node, dragged) => {
          for (const n of dragged) {
            moveNode(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) });
          }
        }}
        onNodesDelete={(deleted) => deleteNodes(deleted.map((n) => n.id))}
        onEdgesDelete={(deleted) => deleteEdges(deleted.map((e) => e.id))}
        onSelectionChange={({ nodes: ns, edges: es }) =>
          setSelection(
            ns.map((n) => n.id),
            es.map((e) => e.id),
          )
        }
        onConnect={(c) => beginConnection({ source: c.source, target: c.target })}
        connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 1.5 }}
        deleteKeyCode={["Delete", "Backspace"]}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={["Control", "Meta"]}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        proOptions={{ hideAttribution: false }}
      >
        {/* Dot-grid canvas background — the only textured surface in the app. */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.2}
          color="var(--border-default)"
          bgColor="var(--surface-canvas)"
        />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          bgColor="var(--surface-1)"
          maskColor="rgba(9,7,6,.55)"
          nodeStrokeWidth={0}
          nodeColor={(n) => `var(--role-${(n as CanvasNode).data.memory.role})`}
        />
        <Panel position="top-left">
          <button
            onClick={newNodeAtCenter}
            title="New memory node (or double-click the canvas)"
            className="flex h-control items-center gap-1.5 rounded border border-border bg-surface-2 px-3 text-sm text-content shadow-card transition-colors duration-fast hover:border-border-strong hover:bg-surface-3"
          >
            <Plus size={14} strokeWidth={1.5} />
            New node
          </button>
        </Panel>
      </ReactFlow>
      <KindPicker />
    </div>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
