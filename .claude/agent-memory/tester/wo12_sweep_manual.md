---
name: wo12-sweep-manual
description: WO12 input-prompt sweep (8 defects + 8 features) test manual written 2026-08-20 — D3a and F6 were already fixed beyond what the parent's audit summary claimed
metadata:
  type: project
---

Wrote `docs/_archive/manuals/INPUT_PROMPT_SWEEP_TEST_MANUAL.md` (90 steps, 17 lettered sections
B–R covering D1–D8 then F1–F8 in that literal order, plus regression/cleanup/sign-off).
Source: a parent-agent dispatch summary + full audit text for all 16 items, but I
independently re-verified every control against the current source tree before writing
steps (per the "manuals describe the app as built" rule) rather than trusting the audit
prose verbatim.

**Why this matters**: the audit text embedded in the dispatch prompt said D3a (New Node
Wizard must never create an Agent role) was only PARTIAL — the picker was fixed but
Import-preset could still smuggle `role: "agent"` through. Reading the live
`src/wizard/NodeWizard.tsx` / `src/wizard/roles.ts` / `src/wizard/preset.ts` showed this
had since been fully closed: `preset.ts:parseEnvelope` now runs `rawRole` through
`toWizardRole`/`isWizardRole` (from the new `src/wizard/roles.ts`) and reports a
`blockedRole` the wizard shows as an amber notice, and `NodeWizard.doConfirm` re-checks
`isWizardRole` as a belt-and-suspenders gate before create. Likewise F6 (task-format
skill) was marked PARTIAL because `Inspector.tsx`'s `TaskPanel.save()` and
`TasksBoard`'s drag-to-change-status both used to send a partial `TaskPatch` that wiped
`taskType` (task_update's "omitted key clears the column" semantics) — but the current
`src/store/tasks.ts:setStatus` and `Inspector.tsx:TaskPanel.save` both now build on
`fullPatch(item, {...overrides})`, which seeds every mapped column from the item's own
current value first. Both fixes have explicit code comments dated to this fix and
naming the exact prior bug.

**How to apply**: when a dispatch prompt bundles a large audit-findings block, treat it
as a lead, not ground truth — a concurrent/later fix round can close a "PARTIAL"/"OPEN"
finding between when the audit was written and when the tester picks up the manual-
writing task. Always re-read the actual current file before writing a step, exactly per
the tester agent's `manual-format` skill instruction ("verify controls exist"). If code
shows a finding already fixed, write the manual step as the correct (now-true) behavior
rather than reproducing the old audit language — the manual is a snapshot of app-as-built
at manual-writing time, not a status report on the audit.

Related: [[wo11_verification]] (same "verify before trusting a prior finding" lesson from
the WO11 fleet).
