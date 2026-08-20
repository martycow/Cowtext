---
name: project_wo11_uib_shell_rail
description: WO11 lane UI-B (shell & rail) — B1 hierarchy extraction pattern, the closeProject() cross-store composition workaround for a missing useGraphStore.reset(), and the "topbar overflow menu" deviation.
metadata:
  type: project
---

WO11 (2026-08-20) assigned tech-ui lane UI-B: `src/App.tsx`, `src/main.tsx`,
`src/ui/ErrorBoundary.tsx`, `src/agents/RailSections.tsx`,
`src/sessions/RosterBar.tsx`, `src/sessions/AddAgentDialog.tsx`,
`src/store/project.ts`, `src/store/settings.ts` — B1 (hierarchy row shape),
E1 (duplicate "Add agent"), G1 (Home), G4 (reveal project), rail project row
selectability, wizard entry points (GitWizard mount).

**B1 extraction landed at `src/rail/Hierarchy.tsx`** (new file, new dir —
permitted per [[feedback_ambiguous_zone_boundaries]] rule 2: extraction into
a fresh directory under `src/` that no other lane owns). Houses a single
`RowShell` primitive (16px chevron gutter, empty on files; per-depth inline
`paddingLeft` instead of nested `<ul>` padding) consumed by `ProjectRow`,
`DirRow`, `FileRow`. `sortEntries` fixed to directories-before-files. Ported
`FileRail` wholesale from `App.tsx` (~450 lines) including the AGENTS/SKILLS
mount points at the bottom — those two calls didn't change, just moved.
`App.tsx` dropped from ~1488 to ~1030 lines net of the new file.

**`useGraphStore.reset()` does not exist and isn't a frozen seam.** WO11
§5.9's G1 order names it explicitly ("clear: ... `useGraphStore.reset()` ...")
but `graph.ts` is UI-C's zone in the WO11 lane grid, not UI-B's, and the
contract's frozen-seams table (§6) doesn't list a `reset()` method — only
`setSelection`'s project-clearing addition is listed there. Per
[[feedback_ambiguous_zone_boundaries]] rule 4 (forbidden files → don't
improvise a workaround in them), I did NOT add `reset()` to graph.ts.
Instead `useProjectStore.closeProject()` (my file) calls the closest existing
public surface (`setSelection([], [])`, which already clears the
agents/tasks selections per graph.ts's own doc comment) and leaves it there.
This is provably safe, not just expedient: `loadGraph(root)` already does a
full unconditional reset of every graph field (nodes/edges/undo history/
selection) on the NEXT project open regardless of what `closeProject` left
behind — confirmed by reading `loadGraph`'s body, which sets every relevant
field with no merge. `useAgentsStore.loadAgents(root)` has the identical
shape. So the "missing reset()" is title-screen hygiene only, never a
correctness hazard — worth remembering before treating a contract's named
call as ground truth without checking the actual store file for whether the
method exists.

**Cross-store composition in Zustand files creates real import cycles here,
and it's fine.** `store/project.ts` now imports `useGraphStore` (which
already imports `useProjectStore`), plus `agents.ts`, `tasks.ts`,
`events.ts`, `review.ts`, `projectSelection.ts` — several of which already
import `project.ts` themselves (e.g. `events.ts` already did before this
session). Every cross-reference here is used only inside action closures
(`closeProject: async () => { useGraphStore.getState()... }`), never at
module top-level, so ES module circular-import semantics resolve it fine
under Vite/esbuild — confirmed by a clean `tsc --noEmit` and `vite build`
with zero runtime symptoms. This mirrors the existing pattern (`graph.ts`
already cross-imports `agents.ts`/`review.ts`/`tasks.ts`/`project.ts`); a
future session doesn't need to be nervous about adding one more spoke to
this hub as long as usage stays lazy.

**"Topbar overflow menu" (§5.10 G2 entry point) — deviation, not built as a
menu.** The contract names an overflow menu for the Git… entry, but nothing
of that shape exists in `TopBar` today — every other action (Project
properties, Import, Presets, Handoff, Settings) is its own standalone icon/
labelled button. Building generic overflow-menu chrome to hold exactly one
item would be premature architecture for a single entry point that already
has an idiomatic home (a `GitBranch` icon button beside the existing `Gem`
project-properties button). Flagged explicitly in the final report as a
named deviation with reasoning, not silently substituted — matches how this
fleet expects a judgment call to be surfaced.

**Session observation: concurrent lanes landed their frozen-seam files mid-
session.** `src/git/GitWizard.tsx` (UI-A) and `src/store/projectSelection.ts`
(UI-C) did not exist when this lane started reading the tree, and both
appeared — byte-exact to the contract's frozen signatures — by the time the
first `tsc --noEmit` ran. Re-running the actual gate command close to
report time (not trusting an earlier read) caught this; matches the general
lesson already in [[project_wo06_u2_linkage_zone]] about red/missing gates
self-healing mid-session in a multi-agent run. At report time the one
remaining `tsc`/`build` failure (`Inspector.tsx` ⇄ `AgentEditor.tsx` prop
signature mismatch — UI-C already calls the new frozen
`{root, doc, disabled}` shape, UI-D's `AgentEditor.tsx` still declares the
old `onRequestDelete`/`onSave` props) was confirmed STABLE across two
re-checks ~20s apart, both files squarely outside UI-B's zone — reported,
not fixed.
