# Milestones

Milestones are the phase gates from plan §9 — each one is "the phase's acceptance criteria pass in a running app". A phase's code landing bumps the version (see ROADMAP.md); the milestone itself only closes on acceptance.

| Milestone | Gate (acceptance criteria) | Version at gate | Target | Status |
|---|---|---|---|---|
| M0 — Skeleton works | Pick a real repo, see its `.md` files listed; cold start < 2 s | v0.0.0001 | done | ✅ Reached |
| M1 — Graph persists | 6-node graph for a real project survives app restart; inspector edit changes the file on disk | v0.0.0002 | done | ✅ Reached |
| M2 — Compile trusted | Compiled `CLAUDE.md` works in a real Claude Code session; `AGENTS.md` readable by Codex; nothing written without diff-preview approval | v0.0.0003 | acceptance walk (next session) | 🟡 Code landed 2026-08-16 — gate open |
| M3 — Assemble writes files | 5 briefs → 5 sensible `.md` files without touching a text editor | v0.0.0004 | after M2 | ⬜ Pending |
| M4 — Live pipeline proven | Run Claude Code in a terminal, watch canvas nodes light up in real time | v0.0.0005 | after M3 | ⬜ Pending |
| M5 — The Barn delights | A stranger watches a live session for 30 seconds and smiles | v0.0.0006 | after M4 | ⬜ Pending |
| M6 — Presets & Handoff | New project from the "Cedar default" preset in < 1 minute; pasted handoff gives Claude Chat full context | v0.0.0007 | after M5 | ⬜ Pending |

## Beyond M6

First public-shippable cut (CSP tightened, lint in CI, code-split, real sprites) would justify jumping the version to **v0.1.0**. Prerequisites tracked in BACKLOG.md.
