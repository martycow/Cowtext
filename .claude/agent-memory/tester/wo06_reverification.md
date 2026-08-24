---
name: wo06-reverification
description: WO06 (L2 orchestrator suite) re-verification pass 2026-08-19 post-fix-round at commit 6d81251 — what was actually fixed vs still open, and the count-vs-reachability gate lesson
metadata:
  type: project
---

WO06 (`docs/_archive/contracts/WO06_CONTRACT.md`) shipped 63 invoke commands / 524 tests
at commit `6d81251`. `tech-lead`'s adversarial audit
(`docs/_archive/contracts/WO06_AUDIT.md`) found 3 critical + 6 major + 8 minor findings
and ruled NOT SHIPPABLE, but had **no shell that session** — every gate claim
in the audit was inference, explicitly hedged. A fix round landed on top of
the audit. This memory records what I (tester) actually verified by running,
at commit `6d81251`, after that fix round — see
`docs/_archive/manuals/WO06_TEST_MANUAL.md`'s Findings section for the full table.

**Outcome:** of the 4 blocking criticals (D1/D2/D3/D9), 3 fixed (D1, D2's
literal stub, D3), 1 still open (D9 — no global default session-token
ceiling anywhere in the tree, confirmed by a tree-wide grep for
`sessionTokenCeiling` returning zero hits). All 5 "required before Marty's
walk" majors (D4-D8) fixed. All 8 minors (O1-O8) fixed. Verdict: conditionally
shippable, not clean — D9 is the one real gap plus a narrower version of D2
(handoff_node_propose's Rust body is real and tested now, but has zero
TypeScript call sites — same reachability class as D1, just cheaper to close).

**Why this matters for future passes:** the invoke-count gate (63/63) is
byte-exact but **cannot see reachability** — a registered, non-stub command
can still have zero callers in `src/`. The direct diagnostic is
`comm -13 <(rust command names) <(grep -oh invoke\("...") sorted)` — empty
means every TS call names a real command, but the reverse diff
(`comm -23`) shows which registered commands nothing calls. This caught
`handoff_node_propose` cleanly: implemented, tested, invoke-count-clean, and
still completely dead from the user's perspective.

**How to apply:** when re-verifying a fix round against an audit, don't
trust "stub message grep returns zero hits" as proof a feature shipped —
also diff Rust command names against TS invoke() call sites in both
directions. And always re-run every gate yourself rather than trusting a
report that says gates passed; in this case all 5 gates the audit couldn't
run (no shell) were confirmed green on the actual merged tree, but that had
to be established by running, not by reading the fix round's own claims.

See also [[wo02_state]] for the sibling WO02 acceptance-state memory (same
pattern: re-verify a "gates green" claim by actually running them).
