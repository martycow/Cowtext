---
name: dispatch-scope-overrides-contract
description: When a work-order contract's lane grid and the direct dispatch message disagree on file zone, follow the dispatch message literally
metadata:
  type: feedback
---

In WO06, the frozen contract (`docs/_archive/contracts/WO06_CONTRACT.md` §10) lists lane U1's
zone as `src/tasks/**`, `src/store/tasks.ts`, **and** `src/inspector/Inspector.tsx`
(the deps editor was specced to live in the Inspector's `TaskPanel`). The actual
dispatch message I received for that lane ("U1-board") explicitly narrowed this:
file zone `src/tasks/**` and `src/store/tasks.ts` ONLY, with `src/inspector/**`
listed under "you may NOT touch."

**Rule: the direct dispatch message wins over the contract's lane-grid text when
they conflict.** Treat the narrower scope as an intentional split (e.g. the
dispatcher may be running "U1-board" and a separate "U1-inspector" pass, or may
have reassigned Inspector changes elsewhere) rather than a contradiction to flag
and stop on.

**Why:** the contract is frozen at Stage 0 and lane grids are written before the
dispatcher decides exactly how to slice work across invocations; the dispatch
message is the most current instruction. Re-reading a contract's lane table as
gospel over an explicit "you may NOT touch X" in the same turn's instructions
would mean editing a file I was just told not to touch.

**How to apply:** when a feature the contract assigns to "my" file also has an
out-of-zone home (e.g. dependency-editing UI belongs conceptually next to a
node's Inspector panel), and Inspector is off-limits, build the feature entirely
inside the files I *am* allowed to touch (here: a new on-board popover component
in `src/tasks/`, not a mount point inside Inspector) and say so plainly in the
report — don't silently drop the feature, and don't ask permission first if the
dispatch instructions already answer where it must live.
