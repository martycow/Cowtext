---
name: wo06-lane-t1-dag
description: WO06 Lane T1-dag (task DAG, stable ids, O1/O2/O3 board defects) — judgment calls in src-tauri/src/tasks.rs's reserved-tag-namespace/dependency-cycle code; read before re-touching tasks.rs's minting/depends/DAG surface.
metadata:
  type: project
---

WO06 Lane T1-dag (2026-08-19) added task-to-task dependencies with cycle
detection to `src-tauri/src/tasks.rs` and fixed O2/O3. Full spec:
`docs/design/WO06_CONTRACT.md` §3.1/§3.3/§11. Zone was `tasks.rs` +
`tasks/tests.rs` only — did not touch `tasklinks.rs`/`taskctx.rs`/
`sessions.rs` (other lanes, see [[wo06-lane-t2-tasklinks]] and
[[wo06-lane-g3-budgets]]).

**Judgment calls the audit should review:**

1. **`dag.cycles` reports at most ONE cycle per scan, mirroring
   `compile.rs`/`lint.rs`'s own cycle detectors exactly (they too only ever
   find one, even though a graph could hold several disjoint cycles).** The
   wire type `Vec<Vec<String>>` is plural, which could be read as "one
   entry per disjoint cycle", but D4 says "the identical deterministic
   walk" — I read that as "identical algorithm", not "generalize it to find
   everything the siblings don't". Flagging explicitly since the plural
   type invites the other reading.

2. **Duplicate-id representative choice**: when N tasks share an `id:`,
   `compute_dag`'s graph (for cycle/blocked purposes) and `task_depends_add`'s
   "does this create a cycle" check both use the FIRST occurrence in scan
   order as that id's representative — same "first wins" convention this
   file already uses for convention-path resolution. The duplicate is still
   reported in `duplicate_ids`, and `task_depends_add` refuses to let
   anything NEW depend on a duplicated id outright, so this representative
   choice is never load-bearing for a fresh edge — only for pre-existing
   files' `blocked`/cycle reporting.

3. **`UnresolvedDep.taskId` for a task with no `id:` of its own but a
   `needs:` token that doesn't resolve**: falls back to the volatile
   locator (`TaskItem.id`, `"<relPath>#<line>"`) since there's no stable id
   to report it under. Contract doesn't address this edge case explicitly.

4. **Minting write is surgical for TABLE rows (true byte-exact — only the
   Tags cell changes, via `set_cell` on the raw cell array) but only
   FIELD-exact for CHECKLIST rows** (`splice_checklist_tags` preserves
   every other *word* and whitespace run byte-exact, splicing the new
   tag-run in at the old tag run's position, or appending at the true end
   when there was no tag run at all). This is as byte-exact as the format
   allows without inventing a token-preserving mini-parser beyond what
   `word_segments` already does.

5. **Big pre-existing trap, NOT introduced by this lane, rediscovered
   here**: `split_name_desc` (pre-Rev-2, someone else's code, out of scope)
   swallows trailing token text into `name`/`description` verbatim whenever
   a checklist line has no dash/em-dash/period boundary. A freshly-minted
   `#id:…` is just another trailing token from that parser's point of view,
   so (a) it can end up baked into `moved.name` when a checklist source's
   `task_id_ensure` used the append-at-end path, and (b) if that item is
   then moved into ANOTHER checklist target, `compose_checklist_text`
   re-emits the SAME id as a proper `#id:…` token too — visibly doubling
   the text on disk (`- [ ] Solo2 #id:xxxxxx #id:xxxxxx`). This is the exact
   same class of caveat the pre-existing WO02 test
   `task_move_table_row_into_checklist_target_preserves_tags_agent_priority`
   and `task_move_into_checklist_only_target_appends_checklist_line`'s doc
   comments already flag for `#tag`/`@agent`/`Pn` — now transitively true
   for `id:`/`needs:` since they're just reserved tags to that parser. NOT
   fixed (out of zone/scope, `split_name_desc` belongs to nobody in
   WO06); two tests in `tasks/tests.rs`
   (`o3_checklist_row_moved_into_table_target_preserves_id` /
   `..._into_checklist_target_preserves_id`) assert the REAL (noisy)
   output with a doc comment explaining why, rather than hiding it behind a
   token-free fixture — `task_id`/`depends_on` still round-trip correctly
   regardless, which is what actually matters for WO06.

6. **`task_append`'s free-text path only strips reserved-shaped tokens on
   the TABLE-row-building branch** (via `lift_reserved_tokens`, so a user
   typing `#id:t-abc123` into the New Task dialog can't accidentally
   "mint" a working id by coincidence when it lands in a Tags column). The
   checklist-append branch (`- [ ] {text}`, today's unchanged verbatim-copy
   behavior) does NOT scrub it — copying `text` unmodified predates WO06
   for every token type, not just the new reserved ones. Extremely low risk
   (requires a user to literally type a well-formed `t-[0-9a-z]{6}` id by
   hand) but flagged as a known, deliberately-unaddressed gap.

7. **O2 fix (`tasks_scan`'s missing-file `home` directory) required a
   two-pass restructure**: first pass finds where each of the 5 convention
   names actually lives (`found_dirs: Vec<Option<&str>>`), so `home` (the
   directory of the first-in-`CONVENTION_NAMES`-order existing file, or
   `"docs/tasks/"` when none exist) can be computed BEFORE the per-file loop
   — a single forward pass can't do this since a later name (e.g. `BUGS.md`)
   might be the only one that exists. This changed one pre-existing test's
   expected value (`tasks_scan_missing_files_report_default_root_location`,
   renamed to `..._report_docs_tasks_home_when_nothing_exists`) — an
   intentional, contract-mandated behavior change (Gate 13), not a
   regression.

8. **Mint algorithm**: FNV-1a 64-bit over
   `now_nanos ++ process_counter ++ attempt ++ rel_path ++ line` (all
   concatenated as bytes, not literally XORed as the contract's shorthand
   `h = fnv1a64(now_nanos ^ process_counter ^ rel_path_bytes ^ line)`
   might suggest) — the contract text isn't type-consistent as literal XOR
   since `rel_path_bytes` is a byte string not an integer; I read it as
   "combine these inputs", not a literal operator. `attempt` (the retry
   counter, 0..16) is folded in specifically so a same-nanosecond retry
   after a collision produces a different candidate. A static
   `AtomicU64` `MINT_COUNTER` guards against two mints in the same
   process at the same OS-clock nanosecond.

**Gates at handoff**: `cargo clippy --all-targets -- -D warnings` and
plain `cargo clippy -- -D warnings` both clean; `cargo test --lib` 479
passed (0 failed); `cargo test --bin cowtext-cli` 18 passed; `npm run
build` 0 errors; `npm run lint` 0 errors / 1 pre-existing warning
(`RoleGlyphs.tsx`, not mine). Note: `cargo clippy --all-targets` was
transiently red on `sessions.rs:504` (a `manual_is_multiple_of` lint, G3's
hot file, mid-edit at the time — 283-line uncommitted diff) during this
session; NOT touched, resolved itself once G3's lane landed its own work.
If you see a clippy failure in a file outside your assigned zone during a
multi-lane WO, re-run once before assuming it's yours to fix — it may be a
concurrently-editing sibling lane's transient state.

See also [[wo02-g1-tasks-three-way-rule]] (the three-way append/move rule
this lane built directly on top of) and [[wo06-stage0-seams]] (the Stage-0
stub bodies this lane filled in).

**Fix round (tech-lead audit, same day, D7 + O1):**

- **D7** (`parse_checklist_line` leaked a minted `#id:`/`#needs:` token into
  `name`/`description` because `split_name_desc` ran on text that still
  contained it — every `task_update` save then duplicated the token, and
  the same bug made `task_move`'s reparse-then-recompose path visibly
  double it too). Fix: new `strip_reserved_tokens(text)` scans
  whitespace-separated words and removes well-formed `id:`/`needs:` tokens
  (same grammar gate + first-wins `id:` rule as `lift_reserved_tokens`,
  just applied to raw prose) BEFORE `split_name_desc`/`extract_tokens` run.
  Returns the original `text` byte-identical (no reallocation-driven
  whitespace normalization) when nothing was stripped, so ordinary lines
  are untouched. This single change also retroactively fixed the
  `o3_checklist_row_moved_into_*_target_preserves_id` tests, which
  previously asserted the (buggy) doubled output with a doc comment
  explaining why — now updated to assert the clean, non-doubled output.
  Two new tests: `d7_mint_into_boundary_less_checklist_line_stays_stable_
  across_updates` (mint → update → update, no boundary) and
  `d7_mint_into_checklist_line_with_early_period_keeps_token_out_of_
  description` (the '.' case). Did NOT touch `write_task_text`
  (`task_append`'s checklist-append branch, tasks.rs:1240) — that's the
  separately-documented, deliberately-unaddressed item 6 gap above; D7 was
  scoped to `parse_checklist_line` only, per the audit's own prescribed fix.
- **O1** (`UnresolvedDep.task_id` fell back to the volatile `TaskItem.id`
  locator for a task with no stable id of its own, violating §3.1 R6).
  Fix: `compute_dag` simply omits id-less tasks from `dag.unresolved`
  (chose "omit" over "add a locator field" — the omit option needed zero
  TS changes, staying inside my zone; `TasksBoard.tsx`'s renderer already
  generically formats whatever's in the array). The dependency is still
  visible via `TaskItem.depends_on` on the task itself; only the board-wide
  summary line requires a real id to key on. Two new tests.

**Gates after this fix round**: `cargo clippy --all-targets -- -D
warnings` and plain `cargo clippy -- -D warnings` both clean (was
transiently red on `tasklinks/tests.rs:401`, a typo — `unwrap_err_or_else`
— mid-edit in a sibling lane's file; resolved on re-run, not mine).
`cargo test --lib`: 503 passed, 1 failed
(`taskctx::tests::ancestry_depth_beyond_eight_generations_is_a_parent_
cycle_error`, `src-tauri/src/taskctx/tests.rs:285` — T3-injection's own O3
fix mid-flight, confirmed persistent on a second run, NOT touched, not my
zone). `tasks::tests` module itself: 79/79 green. `cargo test --bin
cowtext-cli`: 18/18. `npm run build`: 0 errors. `npm run lint`: 0 errors, 1
pre-existing warning (`RoleGlyphs.tsx`, not mine).
