---
name: wo12-canvas-loop-d3b-d6
description: WO12 canvas-loop lane — fixed the React Flow StoreUpdater update-depth crash on off-canvas selection (rail/hierarchy/adopt/wizard). Root cause pattern for any future GraphCanvas.tsx work.
metadata:
  type: project
---

WO12 lane `canvas-loop` fixed D3b/D6 (2026-08-20): "Maximum update depth exceeded … at
StoreUpdater … at CanvasInner" crash, reported via two symptoms (wizard "Assemble after
close", and clicking an agent row in the Hierarchy after adopt-to-graph). Files touched:
`src/canvas/GraphCanvas.tsx` only (`src/store/graph.ts` was in-zone but deliberately left
untouched — see below).

**Root cause, verified against installed `@xyflow/react` v12.11.3 source, two independent
bugs stacking:**
1. `onSelectionChange` was a fresh inline arrow every render. RF's
   `SelectionListenerInner` keys its effect on `[selectedNodes, selectedEdges,
   onSelectionChange]` — the node/edge arrays are id-compared and stable, but the inline
   arrow wasn't, so the effect degraded from edge-triggered to level-triggered on every
   render, firing with values one commit stale relative to the RF store. Combined with a
   second effect that pushes store selection forward into RF's node array, this is a
   permanent two-state oscillator — but ONLY when the store leads RF (i.e. every
   off-canvas selection path: rail pick, hierarchy adopt, wizard-created node). An
   on-canvas click never loops because RF originates the change and both sides agree from
   commit 1.
2. `StoreUpdater` compares five `<ReactFlow>` props (`onConnect`, `onNodesDelete`,
   `onEdgesDelete`, `onNodeDragStop`, `fitViewOptions`) BY REFERENCE every render and
   calls `store.setState` for each changed one, from a passive effect — inline literals
   for any of these turn ordinary renders into a `checkForNestedUpdates` time bomb.

**Fix pattern:** `useCallback` for `onSelectionChange`/`onNodeDragStop`/`onNodesDelete`/
`onEdgesDelete`/`onConnect` with the store actions as deps (Zustand actions are stable
references, list them anyway for honest exhaustive-deps); hoist `fitViewOptions`,
`connectionLineStyle`, `deleteKeyCode`, `multiSelectionKeyCode`, `proOptions` to
module-scope constants beside `nodeTypes`/`edgeTypes`. **The equality guard inside
`onSelectionChange` is required, not optional** — even a converged single echo would wipe
a selection another panel set one commit earlier, because `setSelection` in
`store/graph.ts` clears the project/agent/task selections UNCONDITIONALLY before its own
early-return equality check (a deliberate WO11 G3 decision — see
[[project_wo11_uic_inspector]] for that ordering bug's earlier appearance). Guard at the
call site in `GraphCanvas.tsx`, never move those three clears behind the early return in
`graph.ts`.

**Deferred on purpose, left as a one-line comment at the call site:** collapsing to a
single-writer selection model (seed `selected` from the store in the node-projection
effect, delete the separate store→RF selection effect) was explicitly out of scope — the
crash fix had to land small and reviewable. Next lane touching selection sync in
`GraphCanvas.tsx` should read that comment before changing the store→RF effect.

**Why this matters beyond this one fix:** any new prop added to the `<ReactFlow>` element
that is an inline object/array/arrow is a candidate repeat of this bug class. Check
`fieldsToTrack` in `node_modules/@xyflow/react/dist/esm/index.js` before assuming an
inline literal is harmless — RF's own reference-equality checks are stricter than they
look.
