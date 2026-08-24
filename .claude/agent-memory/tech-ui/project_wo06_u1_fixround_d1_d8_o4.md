---
name: project_wo06_u1_fixround_d1_d8_o4
description: WO06 fix round (tech-lead audit) for lane U1-board — how D1/F1 (unreachable differentiator), D8 (stale-badge store reloads) and O4 (DependsPicker ARIA) were resolved, and the one Rust test failure found outside U1's zone.
metadata:
  type: project
---

On 2026-08-19, `docs/_archive/contracts/WO06_AUDIT.md` found the WO06 differentiator
(§4 per-task subgraph injection) fully built on the Rust side but with **zero
UI entry point** — `TaskContextModal` (U2, `src/taskctx/`) and
`TaskLinksPanel` (U2, `src/tasklinks/`) existed but were imported by nothing.
Fix round assigned to U1-board (zone: `src/tasks/**`, `src/store/tasks.ts`,
`src/inspector/Inspector.tsx`).

**D1/F1 resolution — two mount points, both inside U1's own zone:**
- `src/tasks/TasksBoard.tsx`: added a `Layers`-icon `ContextButton` next to
  `DependsPicker` on both `StatusCard` and `FlatRow` (so every convention
  file's cards get it, not just the Kanban ones), opening the frozen §10.3
  `TaskContextModal` directly. Mints the task's stable id on demand via
  `ensureId` (same on-demand-mint idiom `DependsPicker`'s `onAdd` already
  uses) if the task doesn't have one yet.
- `src/inspector/Inspector.tsx`: mounted `TaskLinksPanel` (import from
  `../tasklinks/TaskLinksPanel`, U2's ratified directory — read-only import,
  not an edit to that file) at the bottom of `TaskPanel`, per the audit's own
  either/or ruling and §10.1's existing note "the deps editor lives in
  `TaskPanel`". `TaskLinksPanel` already contains its own "Preview context…"
  button that opens `TaskContextModal`, so this single mount also closes the
  Inspector half of D1's fix (a) for free. See
  [[feedback_ambiguous_zone_boundaries]] rule 5 for the general pattern.

**D8 resolution:** added `await get().load(root)` to `update`, `toggle` and
`ensureId` in `src/store/tasks.ts` (audit's literal prescribed fix). `toggleAny`
needed no separate edit — it purely delegates to `toggle`/`update`, both now
fixed, so the stale-Blocked-badge case (toggling a checklist OR table-row
dependency) is closed transitively.

**O4 resolution, one non-obvious trap:** `DependsPicker.tsx`'s popup had
`role="menu"` with a text `<input>` and plain `<button>`s inside (ARIA 1.2
violation) plus no focus containment. Fixed via `role="dialog"
aria-modal="false"` + an `onBlur` focusout-close. **The naive version of the
focusout-close breaks the click-to-link flow**: `runAdd`'s own `setBusy(...)`
disables the just-clicked candidate button, and a browser blurring a
just-disabled focused element fires `blur` with `relatedTarget === null` (no
"next" focus target) — closing the popup the instant a link click lands,
before the linked-row confirmation ever renders (regression against
`WO06_TEST_MANUAL.md` step 11's documented flow). Fix: only close when
`e.relatedTarget !== null && !container.contains(relatedTarget)` — a real
Tab-driven focus move always carries a concrete `relatedTarget`; a
disable-induced blur never does. Worth remembering as a general React pattern
whenever a "close on blur" popup contains a control that can disable itself
mid-interaction.

**Gate finding, out of zone, reported not fixed:** `cargo test` was red on
the merged tree — `taskctx::tests::ancestry_depth_beyond_eight_generations_is_a_parent_cycle_error`
fails in `src-tauri/src/taskctx/tests.rs` (testing `src-tauri/src/taskctx.rs`,
lane G2's HOT file — the exact O3 finding from the audit: `taskctx`'s inline
ancestry walk silently truncates past 8 generations instead of erroring).
`cargo clippy --all-targets -- -D warnings` was clean. Confirms the pattern
from [[project_wo06_u2_linkage_zone]] generalizes both ways: a red gate
outside your zone can EITHER self-heal mid-session OR still be red at your
own gate-check time — always run the actual command and attribute the
failure to the exact file/lane rather than assuming either outcome.
