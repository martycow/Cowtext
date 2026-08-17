# Sprints

Sprints map 1:1 to plan §9 phases — a sprint is "the evenings it takes to land a phase plus its acceptance walk". Estimates from the plan assume vibe-coding evenings (~2–3 h).

## Current sprint — Sprint 3: Assemble + Live feed (Phases 3+4, + early Barn prototype)

- **Goal:** per-node Assemble/Refine/Summarize via a `claude -p` queue; hooks pipeline (:4923 → `barn://event` → event log + node pulse) behind a confirmation-diff trust boundary; early Barn prototype (Marty's explicit authorization).
- **Started:** 2026-08-16 · **Plan estimate:** 2–3 evenings (two phases in one fleet session)
- **Exit criteria:** Phase 3 acceptance (5 briefs → 5 sensible `.md` files, no text editor) + Phase 4 acceptance (nodes light up live while Claude Code runs in a terminal).
- **Sprint status:** 🟡 Code complete (v0.0.0004 landed), acceptance walk pending.

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| assemble.rs — claude -p queue + 5 commands | rust | Full detail in TASKS.md | P0 | 2026-08-16 | ✅ Done |
| hooks.rs + hooks_server.rs (:4923) | rust, hooks | Full detail in TASKS.md | P0 | 2026-08-16 | ✅ Done |
| Frontend assemble + events store + EventLog + HooksModal | frontend | Full detail in TASKS.md | P0 | 2026-08-16 | ✅ Done |
| Barn prototype (src/scene/, Pixi 8) | pixi, barn | Full detail in TASKS.md | P1 | 2026-08-16 | ✅ Done |
| Integration pass (Canvas⇄Barn toggle, event wiring, spec re-check) | frontend, integration | Full detail in TASKS.md | P1 | 2026-08-16 | ✅ Done |
| Adversarial audit + 6 fixes | review, fix | Full detail in TASKS.md / BUGS.md | P1 | 2026-08-16 | ✅ Done |
| Verification pass | verify | build / clippy / 60 tests / 14-name invoke contract — all green | P1 | 2026-08-16 | ✅ Done |
| Product research pass (FEATURES ranking) | research | Full detail in TASKS.md; pulls in BACKLOG.md | P2 | 2026-08-16 | ✅ Done |
| Phase 3+4 manual acceptance walk | qa | The sprint's only open item — see TASKS.md | P0 | 2026-08-16 | 🔲 Open |

## Past sprints

| Sprint | Phase | Window | Outcome |
|---|---|---|---|
| Sprint 2: Compile | Phase 2 | closed 2026-08-16 | ✅ Closed — adapters, diff-preview modal, validation; accepted by Marty 2026-08-16 (Phase 1 in-window UX verified in the same walk) |
| Sprint 0: Skeleton | Phase 0 | pre-2026-08-15 | ✅ Closed — dark shell, open folder, `.md` scan; accepted |
| Sprint 1: Graph canvas | Phase 1 | closed 2026-08-15 | ✅ Closed — canvas, inspector, persistence, adopt-.md; automated checks green (in-window UX verification folded into the Sprint 2 acceptance walk) |

## Next sprint (planned)

**Sprint 4: The Barn (Phase 5 completion)** — real sprites (Aseprite originals per ART_DIRECTION.md), SFX, calm mode + mute from day one, HUD restyle, scene code-split. Starts after Sprint 3's acceptance walk closes Phases 3+4. Prep items in BACKLOG.md.
