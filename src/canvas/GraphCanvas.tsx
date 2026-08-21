// Graph canvas — React Flow renders FROM the store (single source of truth).
// The RF-local node/edge arrays are a projection: in-flight drag positions and
// selection live here; every real mutation round-trips through the store.

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  type Connection,
  type OnConnectStartParams,
} from "@xyflow/react";
import { FolderOpen, Maximize2, Plus, Sparkles, X } from "lucide-react";
import { EDGE_KINDS, useGraphStore, type NodeRole } from "../store/graph";
import { useProjectStore } from "../store/project";
import { revealPath } from "../fs/api";
import { legalityFor } from "../config/edgeRules";
import { MemoryNodeCard } from "./MemoryNodeCard";
import { LensControl } from "./LensControl";
import { EdgeMarkerDefs, MemoryEdgeView } from "./MemoryEdge";
import { assignPortSlots } from "./portSlots";
import { KindPicker } from "./KindPicker";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenu } from "../ui/useContextMenu";
import type { MenuItem } from "../ui/menuTypes";
import { useDenyTargetStore, useFocusStore, type CanvasEdge, type CanvasNode } from "./types";
import {
  NODE_CARD_H,
  NODE_CARD_W,
  registerViewportCenter,
  viewportCenterPosition,
} from "./viewport";

const NodeWizard = lazy(() =>
  import("../wizard/NodeWizard").then((m) => ({ default: m.NodeWizard })),
);

const nodeTypes = { memory: MemoryNodeCard };
const edgeTypes = { memory: MemoryEdgeView };

// D3b/D6 fix: these were inline object/array literals on the <ReactFlow>
// props below. @xyflow/react's StoreUpdater (index.js:184-243 fieldsToTrack,
// 283-317) compares five of these props by reference every render and calls
// store.setState for each one that changed identity — from a passive effect,
// so a run of transient renders escalates straight into React's nested-update
// abort instead of settling. connectionLineStyle/deleteKeyCode/
// multiSelectionKeyCode/proOptions aren't in fieldsToTrack but a fresh
// identity for the key-code arrays forces useKeyPress to tear down and
// resubscribe its listeners every render for no reason — hoist those too.
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.2 };
const CONNECTION_LINE_STYLE = { stroke: "var(--accent)", strokeWidth: 3 };
const DELETE_KEYS = ["Delete", "Backspace"];
const MULTI_SELECT_KEYS = ["Control", "Meta"];
const PRO_OPTIONS = { hideAttribution: false };

function CanvasInner() {
  const domainNodes = useGraphStore((s) => s.nodes);
  const domainEdges = useGraphStore((s) => s.edges);
  const moveNode = useGraphStore((s) => s.moveNode);
  const deleteNodes = useGraphStore((s) => s.deleteNodes);
  const deleteEdges = useGraphStore((s) => s.deleteEdges);
  const beginConnection = useGraphStore((s) => s.beginConnection);
  const selectedNodeIds = useGraphStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useGraphStore((s) => s.selectedEdgeIds);
  const focusNodeId = useFocusStore((s) => s.nodeId);
  const focusNonce = useFocusStore((s) => s.nonce);
  const root = useProjectStore((s) => s.root);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const { screenToFlowPosition, fitView, getViewport, setCenter } = useReactFlow();
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
    // Pin counts are a property of the EDGES, but they are rendered by the
    // card, so they ride along in node data. Computed here (once per change)
    // rather than in the card, so 200 cards don't each sweep the edge list.
    const { inPins, outPins } = assignPortSlots(domainEdges);
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n] as const));
      return domainNodes.map((n): CanvasNode => {
        const existing = prevById.get(n.id);
        return {
          id: n.id,
          type: "memory",
          position: existing?.dragging === true ? existing.position : n.position,
          data: { memory: n, pins: { in: inPins.get(n.id) ?? 1, out: outPins.get(n.id) ?? 1 } },
          selected: existing !== undefined ? existing.selected : selected.has(n.id),
          dragging: existing?.dragging,
          measured: existing?.measured,
        };
      });
    });
  }, [domainNodes, domainEdges, setNodes]);

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
    // WO10 item 2: seed `selected` from the STORE, not only from the previous
    // React Flow edge. Every store-side selection — the edge context menu,
    // the Problems panel, the Inspector's relations grid — used to be
    // invisible on the canvas because this line only ever preserved what RF
    // already thought. That is also what made "selected wire on top" look
    // broken: RF elevates a selected edge by +1000 (getElevatedEdgeZIndex),
    // but only for edges it knows are selected.
    const storeSelected = new Set(useGraphStore.getState().selectedEdgeIds);
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e] as const));
      return domainEdges.map((e): CanvasEdge => {
        const existing = prevById.get(e.id);
        const isSelected = existing !== undefined ? existing.selected === true : storeSelected.has(e.id);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "memory",
          selected: isSelected,
          // Explicit rather than relying on elevateEdgesOnSelect alone, so
          // the lift is deterministic and survives a store-driven selection.
          zIndex: isSelected ? 1000 : 0,
          data: {
            kind: e.kind,
            guard: e.guard,
            note: e.note,
            step: e.kind === "sequence" ? orderById.get(e.target) : undefined,
            color: e.color,
            waypoints: e.waypoints,
            inSlot: inSlot.get(e.id),
            outSlot: outSlot.get(e.id),
          },
        };
      });
    });
  }, [domainEdges, domainNodes, setEdges]);

  // Store selection → RF selection, for changes that did NOT originate on the
  // canvas (hierarchy row, Problems panel, relations grid). The projection
  // effect above only runs when the graph itself changes, so without this a
  // selection made in another panel would not light up until the next edit.
  // FOLLOW-UP (deferred, D3b/D6 lane): a single-writer selection refactor —
  // seed `selected` from the store in the projection effect above and delete
  // this effect entirely — was scoped out on purpose to keep this fix small
  // and reviewable. This effect is the other half of the store-leads-RF
  // oscillator; onSelectionChange's equality guard below is what stops it
  // from looping today, not this comment, so don't remove the guard thinking
  // this effect is the fix.
  useEffect(() => {
    const nodeSel = new Set(selectedNodeIds);
    const edgeSel = new Set(selectedEdgeIds);
    setNodes((prev) =>
      prev.some((n) => n.selected !== nodeSel.has(n.id))
        ? prev.map((n) => (n.selected === nodeSel.has(n.id) ? n : { ...n, selected: nodeSel.has(n.id) }))
        : prev,
    );
    setEdges((prev) =>
      prev.some((e) => (e.selected === true) !== edgeSel.has(e.id))
        ? prev.map((e) =>
            (e.selected === true) === edgeSel.has(e.id)
              ? e
              : { ...e, selected: edgeSel.has(e.id), zIndex: edgeSel.has(e.id) ? 1000 : 0 },
          )
        : prev,
    );
  }, [selectedNodeIds, selectedEdgeIds, setNodes, setEdges]);

  // WO10 item 8 — a focus request from another panel. Only moves the view
  // when the node is actually off-screen: re-centring on every click would
  // make picking a visible card feel like the canvas jumped out from under
  // the pointer.
  useEffect(() => {
    if (focusNodeId === null) return;
    const node = useGraphStore.getState().nodes.find((n) => n.id === focusNodeId);
    if (node === undefined) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const { x, y, zoom } = getViewport();
    const cx = node.position.x + NODE_CARD_W / 2;
    const cy = node.position.y + NODE_CARD_H / 2;
    // Card centre in screen space, with a margin so a card half-off the
    // edge still counts as needing the move.
    const sx = cx * zoom + x;
    const sy = cy * zoom + y;
    const m = 60;
    const visible = sx >= m && sx <= rect.width - m && sy >= m && sy <= rect.height - m;
    if (visible) return;
    void setCenter(cx, cy, { zoom, duration: 200 });
    // focusNonce, not focusNodeId: re-picking the same row must re-focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Centre entry point (toolbar): stores a thunk that re-derives the
  // viewport centre from the pane's own size + the live RF transform at
  // Confirm time, never client left/top (contract §7.7 helper contract).
  const centerPosition = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const size =
      rect !== undefined ? { width: rect.width, height: rect.height } : { width: 0, height: 0 };
    return viewportCenterPosition(getViewport(), size);
  }, [getViewport]);

  // Publish the probe so off-canvas callers (the graph store's `adoptFile`,
  // driven from the Hierarchy) can place a node in the middle of what the
  // user is actually looking at. See canvas/viewport.ts.
  useEffect(() => {
    registerViewportCenter(centerPosition);
    return () => registerViewportCenter(null);
  }, [centerPosition]);

  const wizardAtCenter = () => {
    setWizardPos(() => centerPosition);
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
        onSelect: () => void fitView(FIT_VIEW_OPTIONS),
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

  // D3b/D6 fix: hoisted to useCallback so identity is stable across renders
  // (see the fieldsToTrack comment by the module-scope constants above) —
  // deps are the store actions, which are stable Zustand references, but
  // listed anyway to keep exhaustive-deps honest rather than suppressed.
  const onNodeDragStop = useCallback(
    (_e: unknown, _node: CanvasNode, dragged: CanvasNode[]) => {
      for (const n of dragged) {
        moveNode(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) });
      }
    },
    [moveNode],
  );

  const onNodesDelete = useCallback(
    (deleted: CanvasNode[]) => deleteNodes(deleted.map((n) => n.id)),
    [deleteNodes],
  );

  const onEdgesDelete = useCallback(
    (deleted: CanvasEdge[]) => deleteEdges(deleted.map((e) => e.id)),
    [deleteEdges],
  );

  const onConnect = useCallback(
    (c: Connection) => beginConnection({ source: c.source, target: c.target }),
    [beginConnection],
  );

  // ── Draw-time legality feedback (WO13_CONTRACT.md §7.3, E4) ────────────
  // The edge's KIND isn't chosen until the KindPicker opens, which happens
  // only after a connection completes — so while the pointer is still down,
  // legality can only ask "is there ANY kind this pair could legally use."
  // A pair where every kind denies (today, only a `@deprecated` target) is
  // refused outright by `isValidConnection` below; KindPicker.tsx does the
  // finer per-kind check once a kind is actually being picked.
  const [connectFrom, setConnectFrom] = useState<{ nodeId: string; role: NodeRole } | null>(null);
  const [denyCursor, setDenyCursor] = useState<{ x: number; y: number; reason: string } | null>(null);

  const anyKindLegal = useCallback(
    (sourceRole: NodeRole, targetRole: NodeRole, targetDeprecated: boolean) =>
      EDGE_KINDS.some((k) => legalityFor(sourceRole, k, targetRole, targetDeprecated).legality !== "deny"),
    [],
  );

  const isValidConnection = useCallback(
    (c: Connection | CanvasEdge) => {
      if (c.source === c.target) return false;
      const graphNodes = useGraphStore.getState().nodes;
      const s = graphNodes.find((n) => n.id === c.source);
      const t = graphNodes.find((n) => n.id === c.target);
      if (s === undefined || t === undefined) return false;
      return anyKindLegal(s.role, t.role, t.deprecated !== undefined);
    },
    [anyKindLegal],
  );

  const onConnectStart = useCallback((_e: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
    const nodeId = params.nodeId;
    if (nodeId === null) {
      setConnectFrom(null);
      return;
    }
    const node = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
    setConnectFrom(node !== undefined ? { nodeId, role: node.role } : null);
  }, []);

  const onConnectEnd = useCallback(() => {
    setConnectFrom(null);
    setDenyCursor(null);
    useDenyTargetStore.getState().clearDeny();
  }, []);

  // Hit-tests the node under the pointer while a connection is live and, if
  // every kind would deny it, writes the reason to `useDenyTargetStore` (the
  // dimmed card, one subscriber) and to local state (the cursor tooltip
  // rendered below). RF gives no per-hover callback for the drag target, so
  // this reads the DOM directly the same way RF's own node wrapper exposes
  // itself: `data-id` on the `.react-flow__node` element.
  useEffect(() => {
    if (connectFrom === null) return;
    const onMove = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nodeEl = el?.closest<HTMLElement>(".react-flow__node") ?? null;
      const targetId = nodeEl?.getAttribute("data-id") ?? null;
      const target =
        targetId !== null && targetId !== connectFrom.nodeId
          ? useGraphStore.getState().nodes.find((n) => n.id === targetId)
          : undefined;
      if (target === undefined || anyKindLegal(connectFrom.role, target.role, target.deprecated !== undefined)) {
        setDenyCursor(null);
        useDenyTargetStore.getState().clearDeny();
        return;
      }
      // Several kinds may deny with different reasons; `legalityFor` does
      // not expose the winning rule's specificity score to callers, so the
      // longest reason stands in as "the most specific one" — in the
      // current rule set (§7.3) an all-kind denial is always the single
      // `@deprecated` rule, so every kind agrees on the reason anyway.
      const reason = EDGE_KINDS.map(
        (k) => legalityFor(connectFrom.role, k, target.role, target.deprecated !== undefined).reason,
      ).reduce((best, r) => (r.length > best.length ? r : best), "");
      setDenyCursor({ x: e.clientX, y: e.clientY, reason });
      useDenyTargetStore.getState().setDeny(target.id, reason);
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      useDenyTargetStore.getState().clearDeny();
    };
  }, [connectFrom, anyKindLegal]);

  // D3b/D6 fix (primary cause): this used to be a fresh inline arrow every
  // render. @xyflow/react's SelectionListenerInner keys its effect on
  // [selectedNodes, selectedEdges, onSelectionChange] (index.js:157-166) —
  // selectedNodes/selectedEdges are stable (compared by id), but the old
  // inline arrow was not, so the effect degraded from edge-triggered ("RF
  // selection changed") to level-triggered on every CanvasInner render,
  // firing with values that lag the RF store by one commit. Combined with
  // the store→RF effect above (:153) that produced a permanent two-state
  // oscillator on every OFF-canvas selection (rail, hierarchy, adopt), which
  // is why this stable callback alone is not enough — the equality guard
  // below is required too, because setSelection (store/graph.ts) clears the
  // project/agent/task selections unconditionally before its own early
  // return (WO11 G3), so even a single converged echo would wipe a
  // selection made one commit earlier by another panel.
  const onSelectionChange = useCallback(
    ({ nodes: ns, edges: es }: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => {
      const nodeIds = ns.map((n) => n.id);
      const edgeIds = es.map((e) => e.id);
      const s = useGraphStore.getState();
      const same = (a: string[], b: string[]) =>
        a.length === b.length && a.every((v, i) => v === b[i]);
      if (same(s.selectedNodeIds, nodeIds) && same(s.selectedEdgeIds, edgeIds)) return;
      s.setSelection(nodeIds, edgeIds);
    },
    [],
  );

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
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        // RF dep-array mechanism: SelectionListenerInner effectively keys its
        // change-detection effect on this prop's identity alongside the
        // (id-compared, stable) selectedNodes/selectedEdges arrays — an
        // inline arrow here turns every render into a spurious "selection
        // changed" firing. Keep this a stable useCallback (see definition
        // above); do not revert to an inline arrow.
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        // §7.3 E4: refuses the drop outright when NO kind could legally
        // connect this pair (today, only a `@deprecated` target) — the
        // pointer-tracked reason above is what explains why, while the drag
        // is still live.
        isValidConnection={isValidConnection}
        // Step, not bezier: the drag preview has to look like the wire it
        // will become, and the finished wire is orthogonal (canvas/edgePath).
        connectionLineType={ConnectionLineType.Step}
        connectionLineStyle={CONNECTION_LINE_STYLE}
        connectionRadius={44}
        deleteKeyCode={DELETE_KEYS}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={MULTI_SELECT_KEYS}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={PRO_OPTIONS}
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
      {/* §7.3 E4: the denial reason, following the pointer while a
          connection drag hovers an all-kind-denied target. `position:
          fixed` against viewport coordinates — this div is a sibling of the
          transformed RF viewport, not a descendant of it. */}
      {denyCursor !== null && (
        <div
          className="pointer-events-none fixed z-tooltip max-w-[240px] border-2 border-danger bg-danger-surface px-2 py-1 font-mono text-2xs leading-snug text-danger-text shadow-plate-sm"
          style={{ left: denyCursor.x + 14, top: denyCursor.y + 14 }}
        >
          {denyCursor.reason}
        </div>
      )}
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
