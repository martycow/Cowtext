# Milestones

Milestones are the phase gates from plan §9 — each one is "the phase's acceptance criteria pass in a running app". A phase's code landing bumps the version (see ROADMAP.md); the milestone itself only closes on acceptance.

| Milestone | Gate (acceptance criteria) | Version at gate | Target | Status |
|---|---|---|---|---|
| M0 — Skeleton works | Pick a real repo, see its `.md` files listed; cold start < 2 s | v0.0.0001 | done | ✅ Reached |
| M1 — Graph persists | 6-node graph for a real project survives app restart; inspector edit changes the file on disk | v0.0.0002 | done | ✅ Reached |
| M2 — Compile trusted | Compiled `CLAUDE.md` works in a real Claude Code session; `AGENTS.md` readable by Codex; nothing written without diff-preview approval | v0.0.0003 | done | ✅ Reached — accepted by Marty 2026-08-16 |
| M3 — Assemble writes files | 5 briefs → 5 sensible `.md` files without touching a text editor | v0.0.0004 | acceptance walk (next session) | 🟡 Code landed 2026-08-16 — gate open |
| M4 — Live pipeline proven | Run Claude Code in a terminal, watch canvas nodes light up in real time | v0.0.0004 | acceptance walk (next session) | 🟡 Code landed 2026-08-16 — gate open (built in the same fleet session as M3; shares the v0.0.0004 bump) |
| M5 — The Barn delights | A stranger watches a live session for 30 seconds and smiles | v0.0.0005 | acceptance walk (next session) | 🟡 Code landed 2026-08-17 — gate open (SFX, settings, juice pass, calm mode; walk via the three Phase 5 manuals in docs/testing/) |
| M6 — Presets & Handoff | New project from the "Cedar default" preset in < 1 minute; pasted handoff gives Claude Chat full context | v0.0.0006 | acceptance walk (next session) | 🟡 Code landed 2026-08-17 — gate open (built in the same fleet session as M5, but with its own version bump; walk via docs/testing/PHASE6_TEST_MANUAL.md) |

Note (2026-08-16): Phases 3 and 4 were built together in one fleet session, so M3 and M4 share the v0.0.0004 landing; projected versions for M5/M6 shifted down accordingly.

Note (2026-08-17): Phases 5 and 6 also landed in one fleet session, but each kept its own bump (v0.0.0005, v0.0.0006) — the one-bump-per-phase rule resumed, landing the counter exactly on the projections above. Four milestone gates (M3–M6) are now simultaneously open, all Marty-only acceptance walks.

## Beyond M6

First public-shippable cut (CSP tightened, lint in CI, code-split, real sprites) would justify jumping the version to **v0.1.0**. Prerequisites tracked in BACKLOG.md.
