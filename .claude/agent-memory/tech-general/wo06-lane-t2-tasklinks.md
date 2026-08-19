---
name: wo06-lane-t2-tasklinks
description: WO06 Lane T2 (tasklinks.json sidecar CRUD + ancestry-cycle guard) — judgment calls behind tasklink_set's cycle detection and the corrupt-vs-future-version split; read before touching tasklinks.rs again or auditing it.
metadata:
  type: project
---

Built `src-tauri/src/tasklinks.rs` (+ `tasklinks/tests.rs`, 21 new tests
plus the Stage-0 placeholder = 22) implementing commands 58-60
(`tasklinks_read`/`tasklink_set`/`tasklink_delete`) against the Stage-0
frozen `TaskLink`/`TaskLinks` types. Full spec: `WO06_CONTRACT.md` §3.2,
§7 (commands 58-60), Gate 7.

**Judgment calls an audit should look at:**

1. **Corrupt-JSON vs. future-version split.** Contract §3.2 L6 only states
   "a missing file reads as empty" and "version > 1 is a hard Err"; it is
   silent on JSON that fails to *parse* at all. My task brief additionally
   said "corrupt sidecar degrades gracefully, never crash." I read these as
   compatible, not conflicting: unparseable JSON (or JSON that parses but
   doesn't match the expected shape, e.g. `links` not an array) degrades to
   `{version:1, links:[]}`; a *syntactically valid* JSON object whose
   `version` field is `> 1` is still a hard `Err`, checked first, before
   any attempt to interpret shape — so a v2+ file is never partially
   trusted. Order matters: version-check happens on the raw `serde_json::
   Value` before the typed `TaskLinks` deserialize is attempted.

2. **Ancestry depth cap conflates "real cycle" with "chain too long."**
   Contract §3.2 L4 says "ancestry cycles are rejected ... depth is capped
   at 8"; §4.1 says `taskctx.rs`'s closure reports both a genuine repeat
   *and* an exceeded depth-8 walk as the same `TaskContextError::
   ParentCycle` (no separate "too deep" variant exists in that enum,
   Stage-0-frozen). I mirrored that: `ancestor_chain` in tasklinks.rs
   returns one `Err` shape for both a revisited id *and* a walk that's
   still following a parent after `MAX_ANCESTRY_DEPTH` (8) hops — no
   separate error class. `tasklink_set` runs this check against a *probe*
   document (existing doc with the candidate entry upserted) before
   writing anything, so a rejected upsert never touches disk — tested by
   `tasklink_set_rejects_a_multi_hop_cycle_and_leaves_file_unchanged`.

3. **"Stable task-id minting and collision behavior" (from my dispatch
   prompt) does NOT mean id minting** — that's `task_id_ensure` in
   `tasks.rs`, explicitly Lane G1/T1's (contract §3.1), a file I must not
   touch. I read "collision" for my module as: `tasklink_set` on an
   already-present `taskId` is an **upsert/replace**, never a duplicate
   entry — implemented as `upsert()`. No id-grammar (`^t-[0-9a-z]{6}$`)
   validation was added to `tasklink_set`; the contract only requires that
   specific grammar check in `taskctx.rs`'s `task_context_rel_path` (§4.5),
   not here. Only a non-empty-string guard on `taskId` was added.

4. **`resolve_within_root` used even though `TASKLINKS_REL_PATH` is a
   fixed constant**, not caller input — my dispatch prompt explicitly asked
   for path-guard reuse; `read_graph`/`write_graph` in `project.rs` instead
   just `.join()` their constant `GRAPH_REL_PATH` directly. Both are safe;
   I chose the more defensive one per instruction. Harmless either way.

5. **`tasklink_delete` on an unknown id still performs a full atomic
   rewrite** (read → normalize → write_atomic), not a short-circuit
   no-disk-touch no-op. "No-op" is interpreted as "the returned document
   and the file's *content* are unchanged," not "no write syscall
   happens" — simpler to reason about than conditionally skipping the
   write, and `write_survives_repeated_calls_idempotently` pins that the
   bytes really don't change.

6. **`token_ceiling: Some(0)` is NOT coerced to `None` on write**, even
   though contract §3.2 L5 says they're semantically equivalent ("absent
   or 0 ⇒ no per-task ceiling"). Left as caller-supplied since no gate or
   contract line asked for byte-level canonicalization of that specific
   value; a consumer must treat `0` and absent the same, per L5.

**Exposed for `taskctx.rs` (Lane T3) to reuse, not yet consumed by
anyone:** `pub(crate) fn ancestor_chain(&TaskLinks, task_id) -> Result<Vec<String>, Vec<String>>`
(`Ok` = ancestors nearest-first, excluding `task_id` itself; `Err` = the
offending path with the repeat appended last, `compile.rs`'s
`ValidationError::Cycle` convention) and `pub(crate) const
MAX_ANCESTRY_DEPTH: usize = 8`. Whoever writes `taskctx.rs`'s §4.1 closure
should almost certainly call this rather than re-implementing the walk —
flag it if they don't.

**Gate results at hand-off (2026-08-19), full detail in the lane report.**
My own module in isolation: `cargo test tasklinks` → 22/22 green. Full-repo
`cargo test` / `cargo clippy --all-targets -- -D warnings` were **RED at
the time I built this**, but for reasons entirely outside this file's zone
— concurrent in-progress work in `sessions.rs` (Lane T4: `RegistryCore::
register`/`build_boot_prompt`/`MappedLine` signature changes not yet
propagated to all call sites) and `taskctx.rs` (Lane T3: unused imports,
mid-edit). Confirmed via `git status` that `tasklinks.rs`/`tasklinks/
tests.rs` were the only files I touched. Re-run the full gate suite after
all WO06 lanes land, not from this memory.

See also [[wo06-stage0-seams]] for the Stage-0 seam this lane fills in.

**Fix round (2026-08-19), 4 defects from `WO06_AUDIT.md` — O5/O6/O7/F4:**

- **F4 (MAJOR, `ancestor_chain` off-by-one):** loop bound was `0..MAX_ANCESTRY_DEPTH`
  (exclusive), one iteration short — a valid, non-cyclic 8-hop chain fell through to
  the same `Err` a genuine cycle produces, because the last iteration is spent
  *reaching* the final ancestor with none left to *confirm* it terminates. Fixed to
  `0..=MAX_ANCESTRY_DEPTH`. **This function is no longer tasklinks-internal-only**:
  mid-fix, the concurrent T3-injection agent landed O2/O3's prescribed fix and
  switched `taskctx.rs::task_context_preview` to call
  `crate::tasklinks::ancestor_chain` directly instead of its own inline walk — so
  this loop-bound is now load-bearing for `taskctx.rs`'s read-side closure too, not
  just `tasklink_set`'s write-time guard. A pre-existing `taskctx/tests.rs` test
  (`ancestry_depth_beyond_eight_generations_is_a_parent_cycle_error`) had pinned the
  exact (buggy) pre-fix path length via `!path.contains(&"t-gen000")`; fixing F4
  correctly shifts the path one hop deeper before erroring, breaking that assertion.
  **Verified by temporarily reverting just the loop bound via `sed` and re-running
  that one test in isolation — it passes on the buggy code, fails on the fixed
  code — confirming causation, not coincidence, before restoring the fix.** Did not
  touch `taskctx.rs`/`taskctx/tests.rs` (T3-injection's zone) — reported to
  tech-lead/T3 instead. Two new regression tests added at the true boundary
  (8-hop resolves, 9-hop still errors), plus an end-to-end one through
  `tasklink_set` itself.

- **O7 (MINOR, no id-grammar check):** `tasklink_set` guarded only non-empty.
  Added a private `is_valid_task_id` mirroring `taskctx.rs`'s (same `^t-[0-9a-z]{6}$`
  check, byte-for-byte identical logic) — duplicated, not shared, since the two
  files are different lanes' zones and neither exposes the other's helper `pub`.

- **O6 (MINOR, no-op delete conjures an empty sidecar):** `tasklink_delete` now
  checks `path.exists()` before writing and skips the write when nothing was
  removed AND the file didn't already exist. A no-op delete against an *existing*
  sidecar still writes (idempotent rewrite, unchanged from before).

- **O5 (MINOR, lost-update window) — DECLINED the TS-side fix, partially addressed
  the Rust-side half.** The audit's prescribed fix (serialize the store's mutations
  behind a promise chain, or re-read `linkFor` from the last adopted doc instead of
  before an `await`) is entirely in `src/store/tasklinks.ts` and the un-awaited
  `recordSession` call site in `src/taskctx/TaskContextModal.tsx:363` — U2-linkage's
  zone, not touched. **But tracing `project::write_atomic` turned up a second,
  worse risk fully inside this zone**: its temp file is named from the destination
  path plus *this process's* id only (`.tasklinks.json.tmp-<pid>`), not
  per-call-unique — so two genuinely concurrent `tasklink_set`/`tasklink_delete`
  invocations (Tauri dispatches non-`async` commands onto its blocking pool, so
  this is real, not hypothetical) share one temp file and can corrupt it outright,
  not just lose a field. Added a process-wide `OnceLock<Mutex<()>>` serializing
  the read-modify-write-through-`write_atomic` section of both commands — this
  fully closes the corruption risk and guarantees concurrent upserts of
  *different* taskIds are never lost, proven by
  `concurrent_tasklink_set_calls_never_corrupt_the_file` (8 real OS threads,
  `std::thread::spawn`, asserts valid JSON + all 8 entries present). **Does NOT
  fix the semantic lost-update O5 actually describes** (a full-entry PUT built
  from a stale client snapshot still clobbers fields the lock can't see) — that
  requires either TS-side sequencing or turning `tasklink_set` into a PATCH, and
  the wire contract (§7) specifies PUT ("upsert one entry"). Documented this
  distinction at length in the `write_lock` doc comment so a future reader doesn't
  assume the lock alone closes O5.

**Gate results at this fix round's close:** `cargo test --lib tasklinks::` 30/30
(22 baseline + 8 new). Full-crate `cargo test`: **503 passed, 1 failed** — the one
failure (`taskctx::tests::ancestry_depth_beyond_eight_generations_is_a_parent_cycle_error`)
is outside this zone (T3-injection's), caused by F4's fix interacting with T3's
concurrent O2/O3 fix, both individually correct — see above. `cargo clippy
--all-targets -- -D warnings`: clean. `npm run build`: clean. `npm run lint`: 0
errors, 1 pre-existing `RoleGlyphs.tsx` warning (expected, not this lane's).
