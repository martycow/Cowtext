---
name: feedback_no_frontend_test_runner
description: Cowtext has no frontend test runner at all (confirmed by package.json) — when a dispatch asks for "a regression test" on a TS-only fix, say so plainly instead of fabricating one or adding a test dependency.
metadata:
  type: feedback
---

Cowtext's `package.json` scripts are exactly `dev`/`build`/`preview`/`lint`/
`tauri` — no `test` script, and no `vitest`/`jest`/`@testing-library/*` in
`package.json` at all (checked directly, not just recalled from CLAUDE.md).
`CLAUDE.md` already states "No frontend test runner yet" but it's easy to
skim past under a fix-round prompt that explicitly instructs "add a
regression test that would have caught it" for every defect.

**Rule applied:** when a fix-round or audit dispatch demands a regression
test for a defect whose fix lives entirely in `.ts`/`.tsx` files, do NOT:
- add a test framework as a new dependency (violates the hard "no libraries
  without asking" rule — CLAUDE.md §"Hard rules"),
- write a fake/uncompiled "test" file that nothing runs,
- silently skip the instruction without comment.

Instead: state the constraint plainly in the report ("no frontend test
runner exists; verified by manual trace instead"), and actually do the
trace — walk the exact numeric/logical failure scenario from the audit
through the new code path and show the corrected result inline in the
report. This satisfies the spirit of "prove the fix" without inventing
infrastructure that wasn't asked for. Rust-side fixes in the same fix round
still get real `#[test]`s in the owning lane's `tests.rs` — this rule is
TS-only, and only because the tooling genuinely doesn't exist yet.

**Why this matters:** a future session might be tempted to add `vitest`
"just for this one test" since it's a common, low-friction choice — don't,
without asking Marty first (see [[project_wo06_u2_linkage_zone]] for the
fix-round context this was first observed in, WO06 D4/D6/O8).
