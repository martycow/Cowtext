---
name: cowtext-work-order-cadence
description: How Cowtext work orders run end to end (Stage 0 seams, lanes, audit, gates, docs close-out) and where the artifacts live
metadata:
  type: project
---

Cowtext ships in numbered work orders dispatched by the `/ultracode` skill. The cadence that
has stabilized:

`frozen contract (tech-lead, docs/design/WOnn_CONTRACT.md)` → `Stage 0 seams pass (one
tech-general agent lays every new module + the complete lib.rs wiring as compiling stubs)` →
`parallel build lanes, exclusive file zones` → `adversarial audit (tech-lead,
docs/design/WOnn_AUDIT.md — severity, file:line, failure scenario, CONFIRMED/REJECTED)` →
`defect fix round by the owning lanes` → `tester re-runs all gates` → `project-manager docs
close-out (TERMINOLOGY.md + the cowtext-terminology skill + Status line + test manual)`.

**Why Stage 0 exists:** WO03 had lanes appending to `lib.rs` concurrently ("shared-append
protocol") and it cost extra rounds. Laying every stub down first makes `lib.rs` closed for
the rest of the work order and every lane's zone genuinely exclusive.

**How to apply:** a contract without a Stage-0 seams spec precise enough to need no judgment
is incomplete. Always name the hot files (`tasks.rs`, `sessions.rs`, `compile.rs`,
`TasksBoard.tsx`, `App.tsx`, `lib.rs`, `store/graph.ts`) and assign each to exactly one lane
or explicitly freeze it. Docs close-out is never one of the build lanes — it runs after.

Related: [[contract-failure-modes]]
