---
name: wo01-block-f-sequencing
description: WO01 Block F (agent sessions in the barn) — lane R's store/api files can be missing when lane B/U run; how to work around it
metadata:
  type: project
---

WO01 Block F (docs/_archive/contracts/WO01_BLOCK_F_CONTRACT.md, frozen 2026-08-18) splits work
across three lanes in one fleet run: lane R (tech-general) owns
`src-tauri/src/sessions.rs`/`worktree.rs` + `src/store/sessions.ts` +
`src/sessions/api.ts`; lane U (tech-ui) owns `RosterBar.tsx`/`AgentPanel.tsx`/
`AddAgentDialog.tsx` + `App.tsx`/`Inspector.tsx`; lane B (tech-barn, me) owns
`src/scene/agentHerd.ts` (new) + `BarnScene.tsx` + `hover.ts`. The contract's
§10.2 says lane R should land `store/sessions.ts` + `sessions/api.ts` FIRST so
lanes U/B compile against real exports, not stubs.

**Why this matters:** in practice lane B and lane U's dispatches can run before
lane R's actually lands (observed 2026-08-18: `src/sessions/RosterBar.tsx` and
`AddAgentDialog.tsx` existed on disk but `src/store/sessions.ts` and
`src/sessions/api.ts` did not — confirmed via Glob before trusting the
contract's sequencing claim). `npx tsc --noEmit` then fails with
`Cannot find module '../store/sessions'` in every consumer, cascading into
`TS7006 implicitly any` on store `.subscribe((s, prev) => ...)` callbacks
(the callback's inferred types depend on the store's generic, which is
unresolvable when the import itself fails).

**How to apply:** when picking up a WO01 Block F lane B/U task, verify with
Glob whether `src/store/sessions.ts` and `src/sessions/api.ts` exist before
assuming tsc will be clean. If they don't exist yet: still write the
integration code exactly per the frozen contract shape (correct once lane R
lands) — don't invent a local stub of the store (that's lane R's exclusive
file, and a stub would drift from the real shape). Run tsc/lint anyway,
confirm the only failures trace to the missing module import chain (not to
new logic errors in your own files), and report that isolation clearly rather
than declaring the gate green or silently blocking. `agentHerd.ts` itself
avoids the whole problem by declaring its own local `AgentStatus` type
(structurally identical to the store's `SessionStatus`) instead of importing
from the not-yet-existing store — keeps the file independently compilable
regardless of lane R's landing order. See [[eslint-unused-params]].
