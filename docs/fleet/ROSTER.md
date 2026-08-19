# Agent Fleet Roster

Maintained by **project-manager**. The fleet is 6 agents plus one on-call analyst,
defined in `.claude/agents/` and dispatched by the `/ultracode` skill
(`.claude/skills/ultracode/SKILL.md`). Rewritten 2026-08-18 from the old 13-callsign
roster (see mapping below); the Impact column was dropped — verdict authority now
decides conflicts directly.

| Agent | Role | Lane (paths) | Verdict authority | Status |
|---|---|---|---|---|
| tech-lead | Architect; frozen-contract author; adversarial auditor. Writes no app code | `docs/design/` (contracts), audit reports | Architecture, module boundaries | Active |
| tech-general | Senior fullstack (core + feature modules). Runs as multiple instances with disjoint per-task file zones | `src-tauri/src/*`, `src/store/*`, non-UI `src/` logic — exact zone assigned per task | — | Active |
| tech-ui | Senior frontend; builds and re-checks UI chrome per design tokens | `src/canvas/`, `src/inspector/`, `src/compile/`, `src/settings/`, `src/preset/`, `src/handoff/`, `App.tsx` chrome | Interface | Active |
| tech-barn | PixiJS / game programmer + sound designer; owns the Barn and SFX | `src/scene/` (incl. `sfx.ts` — the only howler importer; WO03 sceneGraph.ts micro-lane) | — | Active |
| tester | QA: manuals in the PHASE2 format, automated gates, adversarial audits. Edits no app code | `docs/testing/`; read-only everywhere else | Gate pass/fail | Active |
| project-manager | Docs & tasks custodian; records every session; always the final agent | `docs/fleet/`, `docs/tasks/`, `docs/TERMINOLOGY*.md`, the CLAUDE.md Status line | — | Active — always final |
| product-analyst | Product research: competitors, rankings, feature suggestions. **Outside the default fleet** — never launched by `/ultracode` | `docs/` (research docs, BACKLOG-ready tables) | — | On call |

## Rules

- **Zones never overlap.** When lanes run in parallel, each gets an explicit file
  zone; leaving the zone is forbidden — an agent that needs a foreign file stops
  and reports instead.
- **Conflicts:** architecture/module boundaries → tech-lead's verdict; interface →
  tech-ui's verdict.
- **Idle by scope** means the task had no work in that agent's lane — it is not
  laziness and is not flagged. The dispatcher lists idle agents in one line.
- Roster and `ACTIVITY_LOG.md` are updated by project-manager at the end of every
  fleet session; the log keeps only the three most recent sessions.

## Mapping from the old 13-callsign roster

Code Lead → tech-lead · Core Coder + Multifunctional Coder → tech-general ·
UI Coder → tech-ui · Barn Coder + Sound Designer → tech-barn · Tester → tester ·
Task Manager + Administrator + Librarian + File System Manager → project-manager ·
Product Analyst → product-analyst · 2D Artist → retired (sprites are Marty-side
asset work; art rules live in the `art-direction` skill).
