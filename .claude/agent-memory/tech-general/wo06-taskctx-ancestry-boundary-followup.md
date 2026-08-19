---
name: wo06-taskctx-ancestry-boundary-followup
description: WO06 follow-up dispatch — F4's off-by-one fix in tasklinks.rs (ancestor_chain, 0..=MAX_ANCESTRY_DEPTH) shifted the exact error-path contents by one hop, breaking a pre-existing taskctx/tests.rs assertion written against the old (buggy) boundary. Read before touching ancestor_chain's loop bound or the depth-cap tests in either file again.
metadata:
  type: project
---

One test failure (`taskctx::tests::
ancestry_depth_beyond_eight_generations_is_a_parent_cycle_error`) surfaced
after [[wo06-lane-t2-tasklinks]]'s F4 fix round landed
(`ancestor_chain`'s loop bound: `0..MAX_ANCESTRY_DEPTH` →
`0..=MAX_ANCESTRY_DEPTH`, one more iteration). The panic was
`!path.contains(&"t-gen000")` failing — a genuinely correct assertion
*against the pre-fix boundary*, now false against the corrected one.

**Verified by hand-tracing the walk, not by trusting either side's
comment.** The failing test's fixture is a 10-generation chain
(t-gen000..t-gen009, 9 real hops from the query point t-gen009 down to the
root t-gen000). With the corrected loop (9 iterations available:
`0..=8`), the walk has *just enough* budget to traverse all 9 hops and
reach t-gen000 before exhausting — so the returned error path naturally
includes t-gen000. Pre-fix (8 iterations, `0..8`), the walk only got as
far as t-gen001 before running out, so t-gen000 was absent. Both are
internally consistent with their respective loop bounds; the fix is
correct (confirmed independently by [[wo06-lane-t2-tasklinks]]'s own
before/after `sed`-revert test), so **the test was the side that needed
correcting, not the implementation** — updated the assertion to
`path.contains(&"t-gen000")` plus a `path.len() == 10` pin, with a comment
explaining *why* the path reaches the root at this exact depth (budget
exhausts exactly as the walk arrives, not before).

**Two-sided lesson for depth-cap-style off-by-one fixes:** fixing a loop
bound that satisfies "N hops must succeed" simultaneously changes *how far
past N* an over-length walk gets before it's cut off — any test asserting
the exact contents of an overflow error path is coupled to the loop bound,
not just its accept/reject outcome. When you fix one, audit for tests
pinning walk depth on the *reject* side too, in every file that calls the
walk, not just the file you're editing.

**Added for symmetry, not required by contract but cheap and closes the
same class of regression on both sides of the T2/T3 boundary:**
- `taskctx/tests.rs`:
  `ancestry_depth_of_exactly_eight_generations_resolves_without_error` — a
  9-generation/8-hop chain through `task_context_preview` (not just
  `tasklinks::ancestor_chain` directly) must **not** error. No such
  accept-side test existed at this call site before.
- `tasklinks/tests.rs`:
  `tasklink_set_rejects_a_nine_hop_ancestry_chain_end_to_end` — the
  reject-side twin of the already-existing
  `tasklink_set_accepts_an_eight_hop_ancestry_chain_end_to_end`; asserts
  the 9th hop is refused AND leaves the file byte-identical to the
  already-accepted first 8 hops (same "rejected write must not mutate
  disk" convention as the cycle tests above it).

**Gates:** `cargo test` (full crate, `src-tauri/`): 506 passed, 0 failed
(503 baseline + this session's 3 new tests). `cargo clippy --all-targets
-- -D warnings`: clean. Touched only `src-tauri/src/taskctx/tests.rs` and
`src-tauri/src/tasklinks/tests.rs` — no source (`taskctx.rs`/
`tasklinks.rs`) or any other file changed this round.

See also [[wo06-lane-t2-tasklinks]] (F4's own fix + rationale) and
[[wo06-t3-taskctx-injection]] (the O2/O3 delegation that made
`taskctx.rs` depend on `tasklinks::ancestor_chain` in the first place, and
the pre-delegation T2-vs-T3 semantics disagreement this boundary
ultimately resolved).
