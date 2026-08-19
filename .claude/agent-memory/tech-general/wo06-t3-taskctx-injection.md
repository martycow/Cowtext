---
name: wo06-t3-taskctx-injection
description: WO06 lane T3 (per-task subgraph injection, contract §4) — taskctx.rs implementation, closure algorithm, and the judgment calls the audit reviewed (grammar-only UnknownTask, private tasklinks reader, node_ids-vs-rendered-body split). Read before touching taskctx.rs again or wiring sessions.rs/tasklinks.rs to it.
metadata:
  type: project
---

WO06 split contract lane G2 (`docs/design/WO06_CONTRACT.md` §4, §10) into
finer-grained per-agent zones: T2 = `tasklinks.rs` (sidecar CRUD), T3 =
`taskctx.rs` (subgraph closure + compile reuse), T4 = `sessions.rs` (budgets
+ boot-prompt injection). T3 landed `task_context_preview` and
`task_context_write` bodies plus 21 tests in `taskctx/tests.rs`, all green
in isolation.

**Judgment calls the audit should review (none required a contract
deviation report — all are implementation choices within the frozen
shapes):**

1. **`taskctx.rs` reads `.cowtext/tasklinks.json` itself** (private
   `read_tasklinks` helper) instead of calling `tasklinks::tasklinks_read`
   (T2's stub command). Rationale: T2 and T3 are independent build zones
   per the lane grid: a hard call-dependency on a sibling lane's *command
   body* (vs. its pub wire types/consts, which taskctx.rs does use —
   `TaskLink`, `TaskLinks`, `TASKLINKS_REL_PATH`, `TASKLINKS_VERSION`) would
   make taskctx.rs's correctness depend on T2's landing order. The helper
   reimplements the exact same tolerant-read contract as §3.2 L6 (missing
   file → `{version:1, links:[]}`; `version > TASKLINKS_VERSION` → hard
   `Err`), so it stays behaviorally identical to whatever `tasklinks_read`
   ends up doing. This is *reading a shared on-disk artifact*, not editing
   `tasklinks.rs` — the file-zone boundary is about the Rust source file,
   not the JSON sidecar it manages.

2. **`TaskContextError::UnknownTask` is grammar-only.** The contract's doc
   comment says it fires when "no `tasklinks` entry and no task carrying
   that id" — the second half needs a `tasks_scan`-shaped read, which is
   T1's zone and would recreate the exact call-dependency problem in (1),
   this time on a much heavier module. Since `tasklinks[taskId]` absent
   already degrades correctly to `EmptySubgraph` (empty seeds/ancestry, only
   pinned nodes survive), the only case actually left for `UnknownTask` is
   a `taskId` that fails the `^t-[0-9a-z]{6}$` grammar (R5) — checked first,
   before touching the sidecar or the graph at all. A syntactically valid
   but never-linked id degrades to `EmptySubgraph`, not `UnknownTask`. If a
   future lane wants the fuller "no task file carries this id either"
   check, it needs a `tasks.rs` read passed in or delegated — flagged here,
   not built.

3. **`node_ids` (§4.1, the closure) and `body` (§4.2, `compile_preview`
   reused verbatim) are deliberately not the same claim.** A seed/ancestor
   node that is neither `pinned` nor the target of a `references`/
   `conditional` edge from another subgraph node contributes to `node_ids`
   (via the `imports` closure) but is **invisible in the rendered
   markdown** — `compile.rs`'s `emit_root` only ever surfaces pinned nodes
   ("Always read") and on-demand-edge targets ("Read when relevant"); it
   has no third "just list every node" section, and compile.rs is frozen
   this WO so this can't be changed. Confirmed and pinned by
   `golden_task_context_body_and_node_ids_are_byte_exact` (the golden test
   includes an `imports`-only node, `imp`, that's in `node_ids` but never
   appears in `body` text). Worth flagging to product/UI: a task-context
   preview modal showing "N nodes included" alongside the rendered body may
   look like it disagrees with itself for exactly this reason — it isn't a
   bug.

4. **Ancestry depth cap (§4.1 "depth ≤ 8, cycle ⇒ error"):** implemented as
   *up to 8 ancestor generations included*, generation 9+ silently
   truncated (not an error) — only an actual revisited id in the
   `parentTaskId` chain produces `ParentCycle`. Pinned by
   `ancestry_depth_beyond_eight_generations_is_truncated_not_errored`
   (10-generation fixture, generation 9's node absent, generations 1–8
   present, no error).

5. **Validation-error mapping (`compile_preview`'s `ValidationError` →
   `TaskContextError`):** `MissingFile` gets a direct 1:1 field mapping
   (actionable: which node, which file). `Cycle` and `DanglingEdge` both
   fold into the generic `Compile{message}` bucket — `DanglingEdge` should
   be structurally unreachable given the induced-edge rule (both endpoints
   already in `effective`), so it's handled defensively, not assumed
   impossible.

**Gate 9 (allowlist disjointness) tests both directions explicitly**, per
the dispatch instructions: `compile_write` given the `.cowtext/context/
task-*.md` shape → `Err` (`compile_write_refuses_the_task_context_shape`),
and — to prove the test isn't trivially passing because `compile_write`
rejects everything — a control test that a real `CLAUDE.md` shape still
succeeds (`compile_write_still_accepts_a_real_compile_output_shape`). Also:
path-traversal `taskId` (`"../../CLAUDE"`) → `Err`, five malformed-grammar
ids → `Err`, missing GENERATED header → `Err`, and a valid write is proven
idempotent (write twice, byte-identical).

**Concurrent-lane observation, not a defect:** during this session
`sessions.rs` (T4) and `tasks.rs` (T1) were both being edited live in the
same working tree by other agent instances; `cargo clippy --all-targets`
and `cargo test --lib` flipped between green and red several times as
those landed mid-run (e.g. `tasks.rs` briefly missing the `TaskItem.
task_id/depends_on/blocked` fields Gate 10/11 need). `taskctx.rs`/
`taskctx/tests.rs` never contributed to any red gate — confirmed both in
isolation (`cargo test --lib taskctx`: 21/21) and inside a fully-consistent
whole-crate snapshot (`cargo test --lib`: 428/428, `cargo clippy
--all-targets -- -D warnings`: only violation was `sessions.rs:504`,
T4's `manual_is_multiple_of`, unrelated to taskctx.rs). This generalizes
[[wo06-stage0-seams]]'s "independent by construction" design: file-zone
disjointness prevents *edit* collisions, but doesn't prevent transient
whole-crate compile failures while sibling lanes are mid-save — a lane
finishing early should expect the full-crate gate to be flaky until every
lane lands, and should snapshot/report its own module's isolated result
rather than block on a green whole-crate gate that isn't its to fix.

See also [[wo06-stage0-seams]] for the Stage-0 wiring this lane's stub
bodies replaced, and `docs/design/WO06_CONTRACT.md` §4 for the frozen
closure rule and §4.5 for the write-allowlist disjointness ruling.

**Post-hoc discovery, flagged for tech-lead — a real cross-lane semantic
disagreement, not just duplication:** [[wo06-lane-t2-tasklinks]] (T2)
exposed `pub(crate) fn ancestor_chain` + `MAX_ANCESTRY_DEPTH` in
`tasklinks.rs` explicitly "for taskctx.rs to reuse... flag it if they
don't." T3 built its own inline ancestry walk instead (already written by
the time T2's memory was read) and, on comparing the two, found they
implement **different depth-cap semantics** for the same contract
sentence (§4.1: "Depth cap 8; a cycle is a ParentCycle error, not a silent
truncation"). Flagged, not privately reconciled, at build time.

**RESOLVED in the WO06 audit fix round (O2 + O3, `docs/design/WO06_AUDIT.md`):**
tech-lead ruled `tasklinks::ancestor_chain`'s semantics canonical (exceeding
depth 8 ⇒ `Err`/`ParentCycle`, same as a genuine cycle) and ordered
`taskctx.rs` to stop reimplementing both the ancestry walk and the sidecar
read. Both fixed by deleting the private code and calling the shared impl:

- O2 (private `read_tasklinks` hard-`Err`ed on unparseable JSON;
  `tasklinks::tasklinks_read` degrades it to `{version:1, links:[]}`) —
  fixed by deleting `taskctx.rs`'s private `read_tasklinks` entirely and
  calling `crate::tasklinks::tasklinks_read(root.clone())` instead. No edit
  to `tasklinks.rs` was needed — `tasklinks_read` was already `pub fn` (a
  `#[tauri::command]`, same "call the command fn directly" pattern already
  used for `compile::compile_preview` in this module).
- O3 (private inline walk silently truncated ancestry past generation 8;
  `tasklinks::ancestor_chain` `Err`s on both an actual repeat and a
  depth-cap overflow) — fixed by replacing the inline `while let` loop with
  `crate::tasklinks::ancestor_chain(&links, &task_id)`, mapping its `Err`
  straight to `TaskContextError::ParentCycle`. `ancestor_chain` returns
  ancestor *task* ids only, so `taskctx.rs` still joins each ancestor's own
  `nodeIds` from `links` in a short loop after the call — this part was
  never eliminable, matching the original note that reuse "wouldn't have
  shortened this module's code much even set aside the semantics question."

Net effect: **taskctx.rs's read of `.cowtext/tasklinks.json`, and its
ancestry depth-cap enforcement, are no longer private reimplementations —
whatever `tasklinks.rs` (T2) does is now the single source of truth for
both.** This is a real behavior change, not just a refactor: a
10-generation acyclic `parentTaskId` chain now returns `ParentCycle`
(empty context) from `task_context_preview` where it previously returned a
successful, silently-truncated 9-node context. Test
`ancestry_depth_beyond_eight_generations_is_truncated_not_errored` was
renamed to `..._is_a_parent_cycle_error` and rewritten to assert the new
`Err`/`ParentCycle` outcome — do not reintroduce a "truncate, don't error"
test for this case, it would directly contradict §4.1's literal wording.
New regression test for O2:
`corrupt_tasklinks_json_degrades_to_empty_not_a_raw_parser_error`.
Removed with `read_tasklinks`: unused `use std::fs;` / `use std::path::Path;`
imports (no other call site in the file needed either).

Gates after the fix (2026-08-19): `cargo test --lib taskctx` 22/22;
`cargo clippy --all-targets -- -D warnings` clean; whole-crate `cargo test
--lib` 479 passed / 2 failed, both failures inside `tasks.rs` (T1's
`task_move` id-preservation, its own unrelated `o3`-numbered tests) —
confirmed pre-existing/outside this lane by `git status` (only `tasks.rs`/
`tasks/tests.rs` were dirty from another lane, `taskctx.rs`/
`taskctx/tests.rs` are untracked new files with no overlap). `npm run
build`/`npm run lint` both red in `src/tasks/TasksBoard.tsx` (unused
`TaskContextModal` import, missing `contextBusyId`/`onOpenContext` props) —
that file is U1's call-site zone per contract line 869 ("U2 owns
TaskContextModal.tsx, U1 owns the call site"), not T3's; T3 (taskctx.rs) is
backend-only, no frontend files.
