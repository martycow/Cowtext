---
name: wo15-u4b-canvas-dialogs
description: WO15 lane U4b (canvas menus, EmptyCanvasGuide, RunSessionDialog token ceiling, task-type chips) — the free-text→chips "none" trap, the don't-duplicate-Rust's-resolver rule for inherited values, the ref+useCallback recipe that kills a mount-only effect's eslint-disable, and the silent `addEdge` deny that any edge-promising menu row must pre-check.
metadata:
  type: project
---

Lane U4b of WO15 (`docs/design/WO15_CONTRACT.md` §6 U4b), 2026-08-21/22.
Three non-obvious things worth carrying forward.

**1. Swapping a free-text field for a chip set leaves a live landmine.**
`NewTaskDialog`'s Task type went from `<input list=…>` to chips
`none · bug · feature · chore · docs`. The state type changed from `string`
(empty = unset) to a union with a `"none"` member — but the submit path
still did `taskType.trim()` and tested `!== ""`, which now happily wrote the
literal string `"none"` into TASKS.md. **Why:** the sentinel moved from `""`
to `"none"` and nothing type-errors, because both are strings.
**How to apply:** when a picker introduces a UI-only sentinel, grep every
read of that state in the same file and funnel them through ONE conversion
(`const chosen = v === "none" ? "" : v`) at the top of submit. Same shape as
the Priority field's existing `none` chip — copy that, don't reinvent it.

**2. An inherited value that Rust already resolves must not be resolved
twice.** `RunSessionDialog`'s Token ceiling now has four sources (this run /
task link / agent default / global default). The UI *displays* the global
default (`settings.sessionTokenCeiling`, 200_000) in its
`Effective: … (from …)` line, but still sends `null` on the wire for that
case so `sessions.rs::resolve_ceiling` stays the single resolver.
**Why:** two resolvers that agree today are a mirror pair that will
silently diverge (WO13 standing lesson #2).
**How to apply:** compute a `wireCeiling` (null = delegate) separately from
the `effectiveCeiling` you render. Note WO15 also *reordered* the inherit
chain — task link now beats agent default, which was the reverse before.

**3. Mount-only effect without `eslint-disable`.** The old code carried both
an unused-disable-directive warning AND the exhaustive-deps warning it was
trying to suppress (the comment sat on the `useEffect(` line, not the deps
line, so it suppressed nothing). Fix that generalises: wrap the callback in
`useCallback(…, [])` when everything it closes over is a setState or a
module import, hold the first-render value in `useRef(value)`, and list the
stable callback in the deps array. The deps become honest instead of
suppressed. See also [[wo13-build-against-unlanded-lane]] for how to gate a
lane while eight others are mid-edit.

**4. A menu row whose payoff is an edge must pre-ask `legalityFor`.**
Fix round, tester finding #2: `New agent from this node…` on a Command or
Skill node opened the wizard promising a Context row, but the wizard's final
`addEdge({ …, kind: "imports" })` hit `edgeRules`' deny and `addEdge`
**returns `null` with nothing surfaced** — no toast, no log.
**Why:** the store's one legality chokepoint fails closed and silently, so
every affordance upstream of it has to ask the same question itself.
**How to apply:** in the menu builder call
`legalityFor("agent", "imports", node.role, false).legality === "deny"` and
set `disabled` + `hint` from it — never a hard-coded role list, so the row
tracks §7.3's table. Pass `false` for the deprecation axis on purpose: that
asks about the role (permanent) rather than the node's current state. The
residual hole — a *deprecated* context node still drops the edge silently —
is a real backlog item, not an oversight. Same trap shape as
[[popover-and-disabled-control-traps]].

Smaller: `EmptyCanvasGuide` is an overlay (`pointer-events-none` container,
`pointer-events-auto` card, `z-canvas-ui`) precisely so pane right-click /
double-click still reach React Flow around it; `ContextMenu`'s portal root
now carries `data-portal="menu"` as the styling hook for the UI-scale rule
(A-16) — but CSS `zoom` on a `position: fixed` portal root also scales its
own `left`/`top`, so whoever applies it must divide the measured
coordinates by the scale or zoom an inner wrapper instead.
