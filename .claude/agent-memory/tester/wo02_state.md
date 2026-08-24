---
name: wo02-state
description: WO02 acceptance state as of the tester audit on 2026-08-19 — what's still pending and where to find the canonical schema
metadata:
  type: project
---

WO02 (`docs/_archive/contracts/WO02_CONTRACT.md`) build lanes G1/G2/G3/U1/U2/U3/B1 all
landed and passed every automated gate as of 2026-08-19: `npm run build`
clean, `npm run lint` 0 errors (1 pre-existing unrelated warning in
`src/canvas/RoleGlyphs.tsx`, not a WO02 file), `cargo clippy -- -D warnings`
clean, `cargo test` 280/280 passing (42 in `tasks::tests`, 40 in
`agents::tests`, comfortably over the >=12-new-tests gate), invoke contract
51/51 byte-exact between `generate_handler!` in `src-tauri/src/lib.rs` and
every `invoke("...")` call site in `src/`.

**Gate 10 (docs/tasks board columns) is the one open item** — P1
(project-manager) has not yet rewritten `docs/tasks/*.md` to the WO02
canonical grid schema (contract §7.8: `Name | Status | Priority | Tags |
Agent | Created/When | Description`, status cells exactly
`new|in-production|in-testing|done`). Today those files still carry the
legacy prose-status cells (e.g. a checkmark-emoji "Done — accepted by Marty
..." line, an open-box-emoji "Open" line), which normalize to `new` via
`bucket_for_status_input` — so completed rows currently show in the board's
**New** column. This is a known, contract-documented live defect (not a
WO02 regression) that self-resolves once P1's rewrite lands.

**Why:** the tech-lead contract explicitly scopes gate 10 as "P1 + tester"
and P1's docs rewrite was still queued behind the WO02 build lanes at audit
time.

**How to apply:** when re-testing Cowtext's Tasks board against the real
`docs/tasks/` files, don't file a defect for "Done rows appear in New"
until confirming whether P1's rewrite (`docs/tasks/*.md` schema +
`.claude/skills/task-format/SKILL.md`) has landed — check `git log --
docs/tasks/` or just open the files and check whether Status cells are
already the canonical bucket strings. See the WO02 manual's section G for
the step that documents this as PENDING rather than FAIL.

Manual test script for this work order: `docs/testing/WO02_TEST_MANUAL.md`.
