---
name: wo15-u1-inspector
description: WO15 lane U1 (Inspector/EventLog/HooksModal) — section-order rework, AssembleSection as the job-owning section, session-local defaultCollapsed, and the seams U1 consumes from other lanes
metadata:
  type: project
---

WO15 U1 rebuilt the Inspector around "what a node IS and what it will BECOME":
`MEMORY_NODE_ORDER` = metadata · assemble · context · relations · file · advanced ·
actions; `AGENT_NODE_ORDER` = agent · context · relations · assemble · advanced ·
actions. Brief and Tags moved OUT of Metadata into `AssembleSection` (the only
consumer), which now owns Brief → Tags → Influence → action buttons → a 400 ms
debounced live `assemblePreview` (in-memory `serializeGraph`, deliberately **no**
`flushSave` — typing must not become a stream of disk writes).

**Why:** WO15_CONTRACT.md §6 U1 + Block 2; acceptance was "Influence slider visible
without scrolling at 1920×1080 on a fresh project", which is a layout budget, not a
feature — every row added above Influence eats it.

**How to apply:** when adding an Inspector control, put it in the section whose job
reads it, not in Metadata. `InspectorSection` now takes `defaultCollapsed?: boolean`;
that flag switches collapse from `AppSettings.collapsedSections` (which stores only
collapsed *exceptions*) to a module-level session Map — D-18. Don't try to persist a
start-closed section in the settings model; the polarity is wrong.

Fix round (2026-08-22, tester #8/#10/#11 + audit F9): `AssembleSection` is
mounted `key={`assemble-${node.id}`}` at BOTH sites (memory panel + agent
panel) — its Refine box, preview and errors are per-node state that React
otherwise carries across a selection change. `Segmented` (the chip row) is a
**duplicated component**: one copy in `Inspector.tsx`, an identical one in
`tasks/NewTaskDialog.tsx`. I added `disabled` to the Inspector copy only, so
the two have now drifted — a mirror pair to reconcile if either grows again.
TaskPanel's task type is chips over `TASK_TYPE_OPTIONS` with `""` (not the
word `none`) as the stored empty value, plus an extra chip for an unknown
word already on disk.

Seams U1 consumed, all landed by S0 before the lane ran: `selectNodeTypeHelpOpen` /
`setNodeTypeHelpCollapsed` (settings), `useUiStore.setHooksModalOpen` (App owns the
single `HooksModal` mount now — `ProjectWizard.tsx` still mounts its own copy with
local state, which is fine), `LogEvent.note` + `pushLocal`, `useHooksAddr`,
`LocalOnlyBadge`, `Inspector.surface`. See [[wo15-popover-and-disabled-control-traps]]
for the two interaction traps hit while cloning `RolePopup`.
