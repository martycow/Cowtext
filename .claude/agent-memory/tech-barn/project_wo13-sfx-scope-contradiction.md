---
name: wo13-sfx-scope-contradiction
description: WO13 dispatch overrode WO13_CONTRACT.md §16 (sfx.ts listed write-forbidden) because Stage 0 found role-set fallout does reach readCueForRole — contract text was wrong, dispatch corrected it
metadata:
  type: project
---

`docs/_archive/contracts/WO13_CONTRACT.md` §16 (write-forbidden files) lists
`src/scene/sfx.ts` with the reason "role-set fallout does not reach them."
That was wrong: `readCueForRole` (`sfx.ts:348-352`, pre-fix) compared
`NodeRole` against `"rules"`/`"task"` literals that the 13→14 role rename
deleted, producing 2 tsc errors (`TS2367` — comparison has no overlap).
tech-lead's dispatch for lane B1 explicitly added `sfx.ts` to the file zone
for that one dispatch, overriding §16, and asked B1 to flag the
contradiction so tech-lead corrects the contract text.

**Why this matters beyond WO13:** §17's lane grid and §16's forbidden list
are meant to be the authority, but they were drafted before Stage 0 actually
ran `tsc` against every file the role rename touches. When a dispatch
message explicitly says "X is an addition to the grid, made this dispatch"
and cites a concrete tsc error as evidence, that dispatch instruction wins
over the frozen contract text for that file, for that round — the dispatch
is tech-lead correcting a contract mistake in real time, not authorizing a
scope violation. Still report it; don't just silently absorb the expanded
zone.

**How to apply:** when a WO contract's write-forbidden list or file-zone
grid claims a file is unaffected by a change, verify with `tsc`/`grep`
before trusting the claim, especially for `sfx.ts` (the sound-role mapping
mirrors the prop-role mapping in `sceneGraph.ts`, so any `NodeRole` schema
change that reaches `propForRole` almost certainly also reaches
`readCueForRole` — they're structurally the same exhaustive switch problem
twice). See [[project_wo03-role-schema-v3-props]] for the actual prop/cue
mapping this round landed.
