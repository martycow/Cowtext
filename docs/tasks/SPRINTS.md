# Sprints

Sprints map 1:1 to plan §9 phases — a sprint is "the evenings it takes to land a phase plus its acceptance walk". Estimates from the plan assume vibe-coding evenings (~2–3 h).

## Current sprint — Sprint 4: The Barn + Presets & Handoff (Phases 5+6)

- **Goal:** complete Phase 5 (SFX layer, settings modal, SNES juice pass, calm mode + mute, idle throttle, demo filtering) and Phase 6 (presets never-clobber apply, `HANDOFF.md` + clipboard variants) — two phases in one fleet session under the frozen `docs/design/PHASE56_CONTRACT.md` (Stage-0 seams, four zero-overlap lanes, 23-command invoke contract).
- **Started:** 2026-08-17 · **Plan estimate:** 2 evenings (two phases in one fleet session)
- **Exit criteria:** Phase 5 acceptance (a stranger watches a live session for 30 s and smiles) + Phase 6 acceptance (new project from preset in < 1 minute; pasted handoff gives Claude Chat full context).
- **Sprint status:** 🟡 Code complete (v0.0.0005 + v0.0.0006 landed), acceptance walks pending; landing not yet committed. Sprint 3's Phase 3+4 acceptance walk also remains open (Marty-only gate).

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Phase 5+6 frozen contract (PHASE56_CONTRACT.md) | design, spec | Full detail in TASKS.md | P0 | 2026-08-17 | ✅ Done |
| Stage 0 — shared seams (settings store/rs, sfx stub, 23 commands) | rust, frontend, seams | Full detail in TASKS.md | P0 | 2026-08-17 | ✅ Done |
| Lane A — sfx.ts full SFX layer | sfx, sound | Full detail in TASKS.md | P0 | 2026-08-17 | ✅ Done |
| Lane B — SettingsModal | settings, frontend | Full detail in TASKS.md | P0 | 2026-08-17 | ✅ Done |
| Lane C — SNES juice pass | barn, pixi, animation | Full detail in TASKS.md | P0 | 2026-08-17 | ✅ Done |
| Lane D — preset.rs/handoff.rs + UI | presets, handoff | Full detail in TASKS.md | P0 | 2026-08-17 | ✅ Done |
| Integration pass (zero cross-lane defects) | integration | Full detail in TASKS.md | P1 | 2026-08-17 | ✅ Done |
| Adversarial audit + 24 fixes | review, fix | Full detail in TASKS.md / BUGS.md | P1 | 2026-08-17 | ✅ Done |
| Verification pass | verify | build / clippy / 88 tests / 23-name invoke contract / howler confinement — all green | P1 | 2026-08-17 | ✅ Done |
| Product research pass (Brainstorm_Features.md) | research | Full detail in TASKS.md | P2 | 2026-08-17 | ✅ Done |
| Phase 5 manual acceptance walk | qa | Three manuals — see TASKS.md | P0 | 2026-08-17 | 🔲 Open |
| Phase 6 manual acceptance walk | qa | PHASE6_TEST_MANUAL.md — see TASKS.md | P0 | 2026-08-17 | 🔲 Open |
| Commit the Phase 5+6 landing | git | See TASKS.md | P1 | 2026-08-17 | 🔲 Open |

## Past sprints

| Sprint | Phase | Window | Outcome |
|---|---|---|---|
| Sprint 3: Assemble + Live feed | Phases 3+4 (+ early Barn prototype) | code closed 2026-08-16 | 🟡 Code complete (v0.0.0004) — assemble queue, hooks pipeline, EventLog/HooksModal, Barn prototype; all gates green. **Phase 3+4 manual acceptance walk still open** (Marty-only gate, tracked in TASKS.md); rolled forward alongside Sprint 4's walks |
| Sprint 2: Compile | Phase 2 | closed 2026-08-16 | ✅ Closed — adapters, diff-preview modal, validation; accepted by Marty 2026-08-16 (Phase 1 in-window UX verified in the same walk) |
| Sprint 0: Skeleton | Phase 0 | pre-2026-08-15 | ✅ Closed — dark shell, open folder, `.md` scan; accepted |
| Sprint 1: Graph canvas | Phase 1 | closed 2026-08-15 | ✅ Closed — canvas, inspector, persistence, adopt-.md; automated checks green (in-window UX verification folded into the Sprint 2 acceptance walk) |

## Next sprint (planned)

**Sprint 4: The Barn (Phase 5 completion)** — real sprites (Aseprite originals per ART_DIRECTION.md), SFX, calm mode + mute from day one, HUD restyle, scene code-split. Starts after Sprint 3's acceptance walk closes Phases 3+4. Prep items in BACKLOG.md.
