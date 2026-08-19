---
name: wo06-lane-g3-budgets
description: WO06 Lane G3 (token ceilings + atomic hard-stop + boot-prompt task-context injection) in sessions.rs — judgment calls the audit should review; read before re-touching sessions.rs's charge/end_turn/register/build_boot_prompt.
metadata:
  type: project
---

WO06 Lane G3 (landed 2026-08-19) built §5 (token ceilings, atomic hard-stop)
and §4.3 (boot-prompt task-context injection) entirely inside
`src-tauri/src/sessions.rs` + `sessions/tests.rs`. Full spec:
`docs/design/WO06_CONTRACT.md` §5, §4.3, §7.1. See also
[[wo06-stage0-seams]] for the seam this fills in.

**Judgment calls an audit should specifically look at:**

1. **`charge` and `end_turn` are free functions taking `&Registry`, not
   `RegistryCore` methods**, despite the contract literally writing
   `fn charge(&self, id: &str, generation: u64, observed_total: u64) ->
   ChargeVerdict`. Reason: `run_turn` only ever carries the cloned
   `Registry` (`Arc<Mutex<HashMap<...>>>`) handle, never a whole
   `RegistryCore` (which also owns the spawn-id `AtomicU64` a turn task has
   no business touching). A `&self` wrapper that only production code never
   calls would be **dead code under plain `cargo clippy -- -D warnings`**
   (no `--all-targets`, so `#[cfg(test)]` isn't compiled and doesn't "use"
   it) — the exact "infra ahead of its consumer" trap documented in
   [[wo03-lane-a-graph-v3-schema]] and hit again at WO06 Stage-0
   ([[wo06-stage0-seams]]). Making `charge`/`end_turn` free functions in the
   same file, called identically by `run_turn` and by
   `sessions/tests.rs`, is the only design with **one** implementation and
   **zero** dead code in either clippy invocation. Confirmed empirically:
   both `cargo clippy --all-targets -- -D warnings` and the plain
   `cargo clippy -- -D warnings` paranoia check are clean.

2. **`charge`'s `Stop` branch folds `tokens_used`/`turn_tokens`/
   `info.tokens_used` itself**, even though the contract's literal §5.3
   pseudocode for step 4 doesn't mention it. Reason: `finish_turn`/`end_turn`
   never run on a budget stop (§5.3 step 3 says `run_turn` returns
   immediately instead) — if `charge` didn't fold, a stopped session's
   `SessionInfo.tokensUsed` would stay stale forever, which contradicts
   "usage accounting is correct at the boundary" (the task brief's own
   phrasing) and §5.5's token-gauge UI. `end_turn` was extracted out of
   `finish_turn` as its own AppHandle-free function specifically so this
   fold logic has ONE implementation, exercised at both exit paths.

3. **`budget_event`'s emitted `usage.totalTokens` is `spent` (the
   accumulated total that crossed the ceiling), not the triggering line's
   own total** — `input_tokens`/`output_tokens`/`cost_usd` are carried
   through from that line's `observed_usage` for fidelity, but
   `total_tokens` must be the ceiling-crossing accumulated value to match
   the contract's own example (`"totalTokens": 200431` against a 200,000
   ceiling). These two numbers only coincide for a single-line turn.

4. **`register()`'s §4.3 spawn guard** (`taskId` present + `taskContext`
   absent/empty ⇒ `Err`) lives inside `RegistryCore::register`, checked
   *before* the mutex lock, alongside the other guardrails — not as a
   separate check in the `agent_session_spawn` command. Keeps "Err never
   mutates" centralized in one place, matching the existing guardrail style.

5. **Cross-module reference to `crate::taskctx::TASK_CONTEXT_MAX_BYTES`**:
   `taskctx` is a *private* `mod` in `lib.rs`, but its `pub const` items are
   still reachable from sibling modules (`sessions`) declared in the same
   crate root — Rust module privacy is about the declaring module's
   position, not "private to itself." Stage-0 deliberately left this const
   `#[allow(dead_code)]`-annotated with a comment naming Lane G3 as the
   consumer — confirms this cross-reference (not a duplicated local
   constant) was the intended design, not a zone violation. `sessions.rs`
   does **not** import anything else from `taskctx`/`compile` — G3 stays
   free of any dependency on G2/compile per the contract's build-order note.

6. **`SessionEntry.task_id` is write-only this work order** (`#[allow(
   dead_code)]`, narrow, documented) — no WO06 G3 command reads it back out
   since `SessionInfo` doesn't carry a `taskId` field (§8's wire-shape diff
   only adds `tokensUsed`/`tokenCeiling`). Kept because the contract
   explicitly lists it as a field `SessionEntry` gains; reserved for a
   future task-scoped session query.

7. **Concurrent multi-agent build state, not a bug**: mid-session, `cargo
   check`/`cargo test` intermittently failed with errors exclusively in
   `tasks.rs` (missing `TasksScan.dag` field, `regenerate_checklist_line`/
   `regenerate_table_row` arg-count mismatches) — this was Lane G1 actively
   editing `tasks.rs` in parallel in the same working tree. Polled with a
   bounded retry loop until it stabilized (~a few minutes) rather than
   touching `tasks.rs`, which is a hard zone boundary. Worth remembering:
   in a multi-instance WO, a red gate whose errors are 100% inside another
   lane's named files is a transient-concurrency signal, not something to
   fix or work around — poll briefly, then report if it doesn't clear.

**Gate numbers at handoff:** `cargo clippy --all-targets -- -D warnings`
clean, `cargo clippy -- -D warnings` (no `--all-targets`) also clean,
`cargo test` 447 lib + 18 cli = 465 (up from the WO06 baseline of 387 —
other lanes' tests are included in the 447 since the crate is shared),
`sessions::tests` alone: 69 passed (35 pre-existing + 34 new). `npm run
build` 0 errors, `npm run lint` 0 errors / 1 pre-existing warning
(`RoleGlyphs.tsx`, not mine).

See also [[wo06-stage0-seams]] (the seam this fills), [[wo03-lane-a-graph-v3-schema]]
(origin of the dead-code-under-`-D-warnings` trap pattern).
