---
name: parallel-round-gates
description: In parallel fleet rounds the shared npm run build/lint gate is red from other lanes — prove your own zone with a scratchpad tsconfig scoped to src/scene
metadata:
  type: project
---

During a parallel work-order round (WO01, WO13, WO15 all did this), `npm run build`
and `npm run lint` are **shared** gates: other lanes' half-finished files put 25–30
`error TS6133 / TS2459 / TS2304` lines in the output that have nothing to do with
`src/scene/**`. WO15 §7.3 states it explicitly — *a foreign compile error is
reported, not fixed*.

**Why:** the dispatcher still wants a gate result, and "build fails" with no
attribution is indistinguishable from "the barn lane broke the build". Twice now
(2026-08-21 WO15 B1: 25 errors in `src/project/ProjectWizard.tsx`, 3 in
`src/agents/AgentEditor.tsx`, 3 in `src/tasks/NewAgentDialog.tsx`) the shared gate
could not go green at any point during the lane.

**How to apply:** run the shared gate for the record, then prove your own zone two
ways and quote all three:
1. Attribution — `npm run build 2>&1 | grep -c "^src/scene/"` (expect `0`) and the
   same grouped by directory, so the report names the owning lanes.
2. Scoped typecheck — write a scratchpad tsconfig (never in the repo) that
   `extends` the root one with `"include": []`, `"references": []` and a `files`
   list of `src/vite-env.d.ts` (required, else `?url`/`?raw` asset imports in
   `sfx.ts` and `src/resources/index.ts` fail with TS2307) plus the scene entry
   points; `npx tsc -p <that file>` typechecks the scene subtree *and everything it
   transitively imports*, so it still catches real breakage in the stores you
   consume.
3. `npx eslint src/scene` — exits 0 with no output when the zone is clean, which is
   the lint half of the gate attributed to just this lane.

See [[wo01-block-f-sequencing]] for the related case where the foreign file is
missing entirely rather than broken.
