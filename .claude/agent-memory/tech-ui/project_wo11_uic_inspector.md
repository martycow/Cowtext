---
name: project_wo11_uic_inspector
description: WO11 lane UI-C (Inspector) — C1 verdict, the section-order model built, and a real conflict found inside WO11_CONTRACT.md's own text (D5) and how it was resolved.
metadata:
  type: project
---

On 2026-08-20, WO11 lane UI-C (`src/inspector/**`, `src/store/graph.ts`,
`src/store/projectSelection.ts`) shipped C1, C2, D1 (mounting only), D5, G3.

**C1 verdict, independently confirmed: UNPROVEN, matches Stage 0.**
`adoptFile` (`store/graph.ts`) is fully synchronous, calls no `invoke`, and
its only external call is `viewportCenter()` (pure geometry, no component
reach) — no render-phase throw is reachable from this path. The REAL
adjacent defect Stage 0 flagged was real: `adoptFile` set
`selectedNodeIds` directly instead of going through `setSelection`, leaving
`useAgentsStore.selection` stale. Fixed by routing `adoptFile` through
`get().setSelection([node.id], [])` after the node lands in state (not
before — `setSelection`'s guard compares against selection *before* the new
node exists, so ordering here doesn't matter for THIS call, but routing
through the single selection path is what actually matters for the "exactly
one thing selected" invariant).

**A second, separate bug in the same function was already live and is
worth remembering as a general pattern**: `setSelection`'s "same selection,
skip" early-return ran BEFORE it cleared the other three panel-owning
selections (agents/tasks/project), so when a caller set the graph selection
to something that was ALREADY the current value (e.g. `[],[]` when nothing
on the graph was selected), the clears never ran at all. Concretely: select
a task (task store only, graph selection stays `[],[]`), then click an
off-graph agent in the rail — the rail's own convention is "set graph
selection first, own selection second" (already documented in
`store/graph.ts`'s own comments), so it calls `setSelection([],[])`, which
matched the already-empty current selection and short-circuited before
`clearTaskSelection()` ran. The Inspector kept showing the task panel
instead of the agent. **Fix pattern: do the clears unconditionally, put the
unchanged-selection guard ONLY around the final `set()` call that would
otherwise cause an extra re-render.** Any store with a similar "N selection
stores, one arbiter function clears the other N-1" shape should check for
this exact ordering bug.

**A real self-conflict inside WO11_CONTRACT.md itself (D5) — escalated,
then RULED on by tech-lead in a same-day §10 amendment. Full arc worth
remembering.** §5.8's frozen text implied an Actions-section delete trigger
for on-graph agents; §7's acceptance gate flatly said "no Delete agent
button anywhere in the Inspector." I traced the functional consequence
(rail's delete calls only `deleteSelected()`, never `deleteNodes(...)` →
orphaned graph node) and kept a button, flagging the tension loudly rather
than picking silently. **Verdict: the button still goes — Marty's plain
words win outright, no functional-consequence argument overrides an
explicit instruction.** But the orphan defect I surfaced was CONFIRMED real
and got a proper store-layer fix instead of a UI workaround: a second
one-directional listener seam, `agentDeleteListeners` (`store/agents.ts`,
mirroring the existing `agentRenameListeners` seam exactly), with the graph
half registered in `store/graph.ts` calling `deleteNodes(ids)` (never raw
`setState` — it's the action that prunes edges/selection/assemble-state and
pushes undo) for every node matching the deleted file via `sameRelPath`.
**Lesson for next time: when a contract's prose conflicts with its own
acceptance gate, the acceptance gate + the plain-English instruction that
motivated the item are the more durable signal — a "keep it working"
functional argument is a reason to escalate loudly, not a license to
override the literal instruction myself.** Escalating instead of silently
resolving was still the right call (see [[feedback_ambiguous_zone_boundaries]]):
it got the REAL defect fixed properly (store-layer seam) instead of papering
over it with a UI button that only protected the one path Marty explicitly
asked to close.

**Standing rule that came out of this ruling, worth carrying into every
future session on this repo**: no `.md` path comparison or basename
extraction anywhere in `src/` may use a bare `===` or a bare `.split("/")`
— `canonPath`/`sameRelPath` (`store/graph.ts`) are the only sanctioned
forms. This produced four real defects in one work order (`Inspector.tsx`
AgentNodePanel lookup, `graph.ts`'s rename listener ×2, `MemoryNodeCard.tsx`)
before tech-lead made it explicit. Grep for `\.split\("/"\)` and bare
`.filePath ===` / `.relPath ===` before trusting any new path-comparison
code in this codebase, mine or another lane's.

**Section-order model (C2/D1), implementation shape worth reusing**: rather
than each panel simply reordering its own JSX (which the contract calls out
as the ORIGINAL disease — "no section may be hoisted by being first in JSX
again"), built `src/inspector/sectionOrder.ts` as ONE canonical per-panel-kind
`readonly string[]` plus a generic `SectionStack<K>({ order, sections })`
component that maps the declared array over a `Partial<Record<K, ReactNode>>`
lookup built by the panel (object literal, property order irrelevant). A
panel can no longer change its own visual order by moving JSX around — only
by editing the shared array. Wired this through every panel kind I own
(memory node, agent node, off-graph agent, edge, new project panel);
deliberately did NOT touch `SkillEditor.tsx` (not my file/zone) even though
its panel kind is declared in the same module for documentation parity with
the contract's §5.3 table.

**Cross-lane git/avatar seam landed mid-session.** `src/git/**` (R1) and the
avatar/memory additions to `store/agents.ts` (R2/UI-D) did not exist when I
started reading the contract but existed by the time I ran `tsc` — multi-
agent WO11 lanes were running concurrently and self-healed the seam gap
before my own gate check, same pattern as [[project_wo06_u1_fixround_d1_d8_o4]]'s
closing note. Always re-run the actual gate commands right before writing
the final report.
