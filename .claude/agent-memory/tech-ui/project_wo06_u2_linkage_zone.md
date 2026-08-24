---
name: project_wo06_u2_linkage_zone
description: WO06 dispatch for "lane U2-linkage" narrowed/reshaped the frozen WO06_CONTRACT.md §10 lane grid — what was granted, what was inferred, and why.
metadata:
  type: project
---

On 2026-08-19, a tech-ui dispatch labeled "lane U2-linkage" for WO06 (task-node
linkage, subgraph preview, budget UI) gave a FILE ZONE that does not match
`docs/_archive/contracts/WO06_CONTRACT.md` §10's lane grid verbatim:

- Dispatch zone: `src/sessions/**` + new dirs I create (e.g. `src/tasklinks/`)
  + a new `src/store/tasklinks.ts`. Forbidden: `src/tasks/**`, `src/store/tasks.ts`,
  `src/canvas/**`, `src/inspector/**`, `src/scene/**`, `App.tsx`, `src/store/graph.ts`,
  any src-tauri file.
- Contract §10's grid instead splits this into lane U2 (`src/taskctx/**` +
  `src/handoff/**`) and a SEPARATE lane U3 (`src/store/sessions.ts`,
  `src/store/settings.ts`, `src/sessions/**`, `src/settings/SettingsModal.tsx`,
  `App.tsx`).

**Why this matters for a future session picking up WO06 UI work:** the
dispatch prompt for a work order can restructure the frozen contract's lane
grid without saying so explicitly — the dispatch is authoritative for MY
task boundaries in the moment, but contract §10.3-style FROZEN CROSS-LANE
INTERFACES (e.g. `TaskContextModal`'s exact prop signature, file path
`src/taskctx/TaskContextModal.tsx`) still have to be honored at the exact
path the contract specifies, even when that path isn't literally named in
my dispatch's zone description — because another lane's code (U1's board/
Inspector mount) is written against that exact path and signature. Building
the frozen-interface file under "new directories you create under src/ for
this feature" satisfied both the dispatch's letter and the contract's cross-
lane contract.

**The one real judgment call, flagged for audit:** the dispatch's "may NOT
touch" list did not name `src/store/sessions.ts`, but also didn't grant it
by name (only `src/sessions/**` and `src/store/tasklinks.ts` were granted).
Duty #3 ("budget UI... match the roster bar/agent panel idiom") is
mechanically undeliverable without extending `Session`/`AgentEventKind` in
that file. I chose to extend it additively (new fields, new `"budget"`
event case, new `spawnForTask` action alongside — not replacing — `spawn`)
rather than leave the roster/panel gauges purely theoretical. See
[[feedback_ambiguous_zone_boundaries]] for the general rule this became.

**Also observed:** other WO06 lanes (tech-general as G1/G2/G3, tech-barn as
B1) were committing/editing concurrently during this session — `src/store/
tasks.ts` had real compile errors (missing `TasksState` methods) at the
START of the session and was fixed by another lane before the END of the
session, with zero action from me. Always re-run the actual gate commands
right before writing the final report, not just once at the start — a red
gate outside your zone can self-heal mid-session in a multi-agent run.

**Update — WO06_AUDIT.md, 2026-08-19:** tech-lead's adversarial audit
formally ratified the zone extension after the fact (its "D9" finding):
"U2 writing `src/sessions/**` + `src/store/sessions.ts`; new `src/tasklinks/`
directory | RATIFIED after the fact, with the deliverables gap still owed.
§10.2 to be amended in the docs close-out." So the judgment call in this
memory's previous paragraph was correct and is no longer open — a future
session doesn't need to re-litigate it, just cite the ratification.

**Fix round (same date):** the audit found 4 defects in this lane (D4/D5/D6
majors, O8 minor). D4 was a wire-vs-store confusion worth remembering as a
general pattern: `sessions.rs`'s `budget` event's `usage.totalTokens` field
is `spent` — an already-cumulative snapshot at the moment of the stop — NOT
a per-line delta like every other `usage`-kind event on the same wire. A
store `applyEvent` reducer that treats every `kind` carrying a `usage` block
identically (sum it in) will silently double-count the instant a `budget`
event arrives. The fix added a dedicated `Session.tokensUsed` field that
adds on `"usage"` (mirrors the existing per-turn accumulator, since that one
correctly IS a delta) but ASSIGNS on `"budget"`. General lesson: when a
wire shape reuses a field across event kinds, check the *producer's* comment
for what the number actually means per kind before writing a reducer that
treats them uniformly. D6 (tasklinks recording the volatile `as<N>` id
instead of the durable `claudeSessionId`) was fixed by polling
`agent_session_list` a few times after spawn from inside `recordSession` —
the durable id isn't on the wire as a push event anywhere (`applyEvent` has
no branch for it either), so a short poll of the existing list command was
the only available fix inside this lane's zone without a §1.11 wire change.
