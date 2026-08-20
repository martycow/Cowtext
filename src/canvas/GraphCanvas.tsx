// Graph canvas — React Flow renders FROM the store (single source of truth).
// The RF-local node/edge arrays are a projection: in-flight drag positions and
// selection live here; every real mutation round-trips through the store.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { FolderOpen, Maximize2, Plus, Sparkles, X } from "lucide-react";
import { useGraphStore } from "../store/graph";
import { useProjectStore } from "../store/project";
import { revealPath } from "../fs/api";
import { MemoryNodeCard } from "./MemoryNodeCard";
import { LensControl } from "./LensControl";
import { EdgeMarkerDefs, MemoryEdgeView } from "./MemoryEdge";
import { assignPortSlots } from "./portSlots";
import { KindPicker } from "./KindPicker";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import type { CanvasEdge, CanvasNode } from "./types";
import { NODE_CARD_H, NODE_CARD_W, viewportCenterPosition } from "./viewport";

const NodeWizard = lazy(() =>
  import("../wizard/NodeWizard").then((m) => ({ default: m.NodeWizard })),
);

const nodeTypes = { memory: MemoryNodeCard };
const edgeTypes = { memory: MemoryEdgeView };

function CanvasInner() {
  const domainNodes = useGraphStore((s) => s.nodes);
  const domainEdges = useGraphStore((s) => s.edges);
  const moveNode = useGraphStore((s) => s.moveNode);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const beginConnection = useGraphStore((s) => s.beginConnection);
  const setSelection = useGraphStore((s) => s.setSelection);
  const root = useProjectStore((s) => s.root);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const { screenToFlowPosition, fitView, getViewport } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const paneMenu = useContextMenu();
  // Contract §7.10 acceptance: "a reveal failure surfaces as an inline
  // error, never a silent no-op."
  const [revealError, setRevealError] = useState<string | null>(null);
  // Contract §7.7 (#9/#16): every creation entry point opens the wizard.
  // The centre entry point stores a thunk so the position re-derives at
  // Confirm (pan-while-open stays true to "current viewport centre"); the
  // positional entry points (double-click, pane menu) store a fixed value
  // captured at the click point. null = closed.
  const [wizardPos, setWizardPos] = useState<
    { x: number; y: number } | (() => { x: number; y: number }) | null
  >(null);

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
  // numbered step dot (DESIGN_SPEC.md edge rules). Each card has exactly one
  // input (left) and one output (right) port, so edges carry no handle ids;
  // data.inSlot/data.outSlot instead carry the contact-finger assignment
  // (canvas/portSlots.ts), computed once per edges-array change right here —
  // routing around cards using those slots is the edge path's job
  // (canvas/edgePath.ts).
  useEffect(() => {
    const orderById = new Map(domainNodes.map((n) => [n.id, n.readOrder] as const));
    const { inSlot, outSlot } = assignPortSlots(domainEdges);
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e] as const));
      return domainEdges.map((e): CanvasEdge => {
        return {
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
            inSlot: inSlot.get(e.id),
            outSlot: outSlot.get(e.id),
          },
        };
      });
    });
  }, [domainEdges, domainNodes, setEdges]);

  // Centre entry point (toolbar): stores a thunk that re-derives the
  // viewport centre from the pane's own size + the live RF transform at
  // Confirm time, never client left/top (contract §7.7 helper contract).
  const wizardAtCenter = () => {
    setWizardPos(() => () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      const size = rect !== undefined ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };
      return viewportCenterPosition(getViewport(), size);
    });
  };

  const wizardAtPoint = (clientX: number, clientY: number) => {
    const pos = screenToFlowPosition({ x: clientX, y: clientY });
    setWizardPos({ x: Math.round(pos.x - NODE_CARD_W / 2), y: Math.round(pos.y - NODE_CARD_H / 2) });
  };

  const onPaneContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("react-flow__pane")) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    const items: MenuItem[] = [
      {
        kind: "item",
        id: "new-node-wizard",
        label: "New node here…",
        icon: Sparkles,
        onSelect: () => wizardAtPoint(clientX, clientY),
      },
      {
        kind: "item",
        id: "fit-view",
        label: "Fit view",
        icon: Maximize2,
        onSelect: () => void fitView({ maxZoom: 1, padding: 0.2 }),
      },
      { kind: "separator", id: "sep-1" },
      {
        kind: "item",
        id: "reveal-root",
        label: "Reveal project in File Explorer",
        icon: FolderOpen,
        disabled: root === null,
        hint: root === null ? "no project open" : undefined,
        onSelect: () => {
          if (root === null) return;
          setRevealError(null);
          void revealPath(root, null).catch((err: unknown) => setRevealError(String(err)));
        },
      },
    ];
    paneMenu.openAt(e, items);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (!target.classList.contains("react-flow__pane")) return;
        wizardAtPoint(e.clientX, e.clientY);
      }}
      onContextMenu={onPaneContextMenu}
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
        // Step, not bezier: the drag preview has to look like the wire it
        // will become, and the finished wire is orthogonal (canvas/edgePath).
        connectionLineType={ConnectionLineType.Step}
        connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 3 }}
        connectionRadius={44}
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
        {/* Dot grid over the 6px dither in styles/index.css — the two
            together are the only textured surface in the app. No bgColor:
            an opaque background rect here would paint over the dither. */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1.4}
          color="var(--barn-dot)"
        />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          bgColor="var(--plate-inset)"
          maskColor="rgba(9,7,6,.62)"
          nodeStrokeWidth={0}
          nodeColor={(n) => `var(--role-${(n as CanvasNode).data.memory.role})`}
        />
        <Panel position="top-left">
          <div className="flex items-center gap-2">
            {/* Contract §7.7 (#9): the split button collapses to one plain
                entry — every creation path opens the wizard now. */}
            <button
              onClick={wizardAtCenter}
              title="New memory node (or double-click the canvas)"
              className="flex h-control items-center gap-1.5 border-2 border-plate-edge bg-plate px-3 text-sm text-content shadow-plate-sm transition-colors duration-fast hover:border-plate-edge-hi hover:bg-plate-hi"
            >
              <Plus size={14} strokeWidth={1.5} />
              New node
            </button>
            <LensControl />
          </div>
        </Panel>
        {revealError !== null && (
          <Panel position="top-center">
            <div className="flex max-w-[420px] items-center gap-2 border-2 border-danger bg-danger-surface px-2.5 py-1.5 shadow-plate-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-danger-text">
                {revealError}
              </span>
              <button
                onClick={() => setRevealError(null)}
                title="Dismiss"
                className="grid h-4 w-4 flex-none place-items-center text-danger-text transition-opacity duration-fast hover:opacity-70"
              >
                <X size={11} strokeWidth={1.5} />
              </button>
            </div>
          </Panel>
        )}
      </ReactFlow>
      <KindPicker />
      {paneMenu.menu !== null && (
        <ContextMenu
          x={paneMenu.menu.x}
          y={paneMenu.menu.y}
          items={paneMenu.menu.items}
          onClose={paneMenu.close}
        />
      )}
      {wizardPos !== null && root !== null && (
        <Suspense fallback={null}>
          <NodeWizard root={root} initialPosition={wizardPos} onClose={() => setWizardPos(null)} />
        </Suspense>
      )}
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
