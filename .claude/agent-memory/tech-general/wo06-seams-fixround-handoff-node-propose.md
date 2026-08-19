---
name: wo06-seams-fixround-handoff-node-propose
description: WO06 fix round dispatched to lane "seams" — implemented handoff_node_propose (§6, D2/F3) in handoff.rs, the one orphaned slice nobody's post-split zone (T2/T3/T4) claimed; declined the frontend/docs defects (D9/F2/F5) as genuinely out of seams' zone. Read before touching handoff.rs again or reasoning about who owns an "orphaned" WO06 file.
metadata:
  type: project
---

**Context: a fix-round dispatch can reassign a defect to a different lane
than the original §10 grid names**, when the original owner never ran or
was split up. WO06's contract lane grid gave `handoff.rs`'s §6 body to G2,
but the real dispatch split G2 into T2 (`tasklinks.rs`) and T3
(`taskctx.rs`) and silently dropped the handoff slice — see
[[wo03-lane-a-graph-v3-schema]]-style precedent for "infra ahead of its
consumer," except this time the consumer never arrived at all. The fix-round
orchestrator assigned the resulting D2/F3 defect to **seams** (me) instead,
presumably because `handoff.rs` was one of the three files Stage-0 touched
mechanically (§9.3) and nobody else's live zone covers it post-split.

**Judgment call: implemented the Rust body, declined everything frontend.**
Read literally, "your zone is exactly what seams owned" would forbid this
(seams' `handoff.rs` edit was only ever the literal stub append). But (a)
the file is genuinely orphaned — no concurrent agent's zone includes it —
and (b) the dispatch instructions named this specific file+line defect as
mine to fix. Implemented `handoff_node_propose` in full (deterministic, no
LLM, §6): title/rel_path/role/brief/content/meta/anchor_node_id, all per
spec. **Declined and reported, not attempted:** the TS wrapper
(`src/handoff/api.ts`) and the three-step commit flow in `HandoffModal` —
squarely `src/handoff/**`, U2's zone, never touched by seams. Also declined
D9/F2 (`sessionTokenCeiling` — `src/store/settings.ts`,
`src/settings/SettingsModal.tsx`, `src/taskctx/TaskContextModal.tsx`, all
U2/U3 zone, 100% frontend, contract says "no Rust change needed") and F5
(docs close-out — `docs/TERMINOLOGY.md`, the skill file, `CLAUDE.md`, lane
D/project-manager's zone) — none of these were ever in seams' zone, not
even adjacent to a mechanical seam edit, unlike `handoff.rs`.

**Implementation notes, in case `handoff.rs` needs touching again:**
- Anchor lookup (`anchor_for_task`) reads `.cowtext/tasklinks.json` with its
  own private tolerant reader, same "independent lane, don't call a
  sibling's command body" rationale [[wo06-t3-taskctx-injection]] already
  documents for `taskctx.rs` — but *unlike* taskctx's reader, a corrupt/
  unreadable sidecar here degrades to `None`, not `Err`: the anchor is
  optional decoration on a **proposal** (Rust writes nothing regardless),
  never a value the caller depends on for success.
- No new dependency for the ISO-8601 `producedAt` timestamp — wrote
  `civil_from_days`, the algorithmic inverse of `lint.rs`'s private
  `days_from_civil` (same Howard Hinnant public-domain algorithm, same "no
  date/time crate" rationale). `lint.rs`'s fn is private so this is a
  from-scratch reimplementation, not a call — pinned by
  `civil_from_days_known_anchors` (1970-01-01, 1969-12-31, 2000-01-01,
  2024-01-01, and a leap day 2024-02-29).
- Collision-free `rel_path` (`context/handoff/<slug>.md`, `-2`, `-3`, …) is
  a **read-only filesystem peek** (`root.join(candidate).exists()`), not a
  write — consistent with "Rust writes nothing" (§1.12/§6). Reused
  `preset::slugify` (`pub(crate)`, read-only call, same precedent as
  `taskctx.rs` calling `compile::compile_preview` on a file it doesn't own).
  `import.rs`'s own collision helper (`unique_id`) is private, not reusable.
- Session-id fallback (`claudeSessionId` if present else `session.id`) is
  used for **both** `meta.session` and the title/content's session label —
  the contract states the fallback rule only for `meta.session`, but the
  title spec's "taskId or session id" reads naturally as the same effective
  id, so this reuses one computed value for both. Flagged as an inference,
  not an explicit contract line.
- Regression test for the defect itself:
  `handoff_node_propose_is_no_longer_the_stage0_stub` — asserts a normal
  call succeeds and that neither `title` nor `content` contains "Stage-0
  stub". The audit's broader ask ("assert no handler body still returns the
  Stage-0 stub string" as an invoke-gate check) was **not** built — that
  would need to enumerate all 63 handler bodies across every lane's files,
  which is out of seams' zone as currently scoped; flagged for tech-lead/
  tester as a possible grep-based CI check rather than a unit test.

**Concurrent-lane red, not mine:** `cargo test` showed one failure,
`taskctx::tests::ancestry_depth_beyond_eight_generations_is_a_parent_cycle_error`,
consistent across repeated runs (not flaky) in `src-tauri/src/taskctx.rs` /
`taskctx/tests.rs` — T3's exclusive zone, untouched by this session. The
test now asserts depth-cap overflow is a `ParentCycle` `Err`, but
`taskctx.rs`'s ancestry walk still silently truncates past generation 8 (see
[[wo06-t3-taskctx-injection]]'s documented T2-vs-T3 semantics disagreement
on this exact point) — looks like another concurrent instance mid-landing
the tech-lead ruling on that disagreement. Did not touch `taskctx.rs`.

**Gates at handoff (this session):** `cargo clippy --all-targets -- -D
warnings` clean (twice, before and after adding tests). `cargo test` (lib):
503 passed, 1 failed (the taskctx one above, not mine) — was 503/504
excluding it. `cargo test --bin cowtext-cli`: 18/18. `npm run build`: 0
errors. `npm run lint`: 0 errors, 1 pre-existing `RoleGlyphs.tsx` warning
(not mine). `generate_handler!` count re-verified at 63 (lib.rs untouched,
per the dispatch instruction forbidding edits to it this round).

See also [[wo06-stage0-seams]] (the original Stage-0 pass this fix round
extends) and [[wo06-t3-taskctx-injection]] (the private-tasklinks-reader
precedent and the depth-cap semantics disagreement this session observed
mid-resolution).
