---
name: wo02-g1-tasks-three-way-rule
description: Judgment calls made implementing WO02 §2.3/§2.4's target-form-aware task_append/task_move in src-tauri/src/tasks.rs — read before touching that file again.
metadata:
  type: project
---

WO02 lane G1 (2026-08-19) made `task_append`/`task_move` target-form-aware
(table row / checklist line / fresh canonical table) and added priority
buckets (`low|medium|high|critical`) to `src-tauri/src/tasks.rs`. The
frozen contract (`docs/_archive/contracts/WO02_CONTRACT.md` §2.3/§2.4/§7.8/§7.11) left
a few things under-specified; these are the resolutions, so a later session
extending this file stays consistent instead of re-litigating them.

- **`task_move`'s checklist-target case recomposes fields, it does not
  preserve the source line verbatim.** Pre-WO02, moving a checklist item
  into a checklist-only target copied the raw source line byte-for-byte
  (preserving its done/in-progress marker). The contract says task_move
  uses "the same three-way rule as task_append", and task_append's
  checklist case always emits `- [ ] <text>` (unchecked/new — "no
  append-with-status primitive"). I generalized that: task_move now
  recomposes `name`/`description`/`tags`/`agent`/`priority` from the
  source `TaskItem` (via `compose_checklist_text`) for ANY target form,
  always landing as `"new"`/unchecked. **Why**: this is the only way a
  table-sourced item's tags/agent/priority survive a move into a
  checklist target too — the old code dropped them for table→checklist
  moves already. **How to apply**: if a future spec wants "preserve
  status/marker on move", that's a new requirement, not a bug in this
  session's work — flag it explicitly rather than assuming today's code
  is wrong.

- **`create_canonical_table`'s "existing file, no tasks" branch normalizes
  ALL trailing blank lines down to exactly one before appending the table
  block**, rather than naively pushing one more `\n`. A naive append would
  double up when the existing content already ends in a blank line (e.g.
  `"# SPRINT\n\n"` → `"# SPRINT\n\n\n| Name..."`, an extra empty line).
  **Why**: contract's byte-exact example only covers the from-scratch
  case; "appended after a blank line" for the has-content case needed an
  idempotent interpretation to avoid this artifact. **How to apply**: if
  byte-exact fixtures for this branch are added later, verify against the
  normalized (exactly-one-blank-line) shape, not naive-append.

- **Two different empty-cell paddings coexist, deliberately, not as a
  bug**: `pad_cell` (brand-new rows — canonical table creation) always
  emits `" {v} "`, so an empty value is `"  "` (two spaces) — matches
  §2.3's literal creation example byte-for-byte. `set_cell` (inserting a
  row into an *existing* table, and `task_update` cell edits) collapses an
  empty/cleared value to a single space `" "` — matches §2.3's explicit
  "unmapped cells are written as a single space" rule for that case. Don't
  unify these two conventions without re-checking both contract quotes.

- **`extract_tokens`' priority slot now always yields a normalized bucket
  or `None`, never a raw fallback** (recognizes `!low`/`!medium`/`!high`/
  `!critical` case-insensitively and legacy bare `P0`-`P3`). This means
  `TaskItem.priority` for **checklist**-sourced tasks is bucket-or-`None`
  always; only **table**-sourced tasks can carry a tolerant raw (non-
  bucket) priority string (§2.4's "otherwise the raw trimmed cell text"
  applies to table cells specifically, not checklist tokens).

- **`split_name_desc` still doesn't strip `#tag`/`@agent`/`Pn`/`!bucket`
  tokens out of `name`/`description`** — this is pre-existing parser
  behavior (see the `task_update_checklist_roundtrip_unchanged_for_canonical_line`
  test's "canonical fixture" comment), not something this session changed.
  It means composing a checklist line from separately-tracked fields and
  then re-scanning it will double up any token that was embedded in the
  original `name`/`description` text without a dash/em-dash/period
  boundary before it. Tests in `tasks/tests.rs` route around this with
  token-free fixtures; don't "fix" it without checking whether it's
  actually in scope.
