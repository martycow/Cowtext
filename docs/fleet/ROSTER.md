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

## Session notes — 2026-08-22 (WO15: release truth + UI round 2)

Status column unchanged (every agent stayed in its lane; no verdict authority was
overruled). Lane load for the record:

| Agent | Lanes this session | Note |
|---|---|---|
| tech-lead | contract `docs/design/WO15_CONTRACT.md` (frozen 2026-08-21) + companion `docs/design/PROVIDER_SUPPORT_MATRIX.md`; adversarial audit `docs/design/WO15_AUDIT.md`; amendments A-20…A-24 | **Active.** Both MAJOR findings were defects in its own contract (D-13 vs §3.8; §6 U3.6's `loadAgents`) — found and amended by the same agent that wrote them. Still has no shell (backlog row "Auditor has no shell"), so §9.2's grid check ran as a `rg`/Glob proxy and the dispatcher confirmed it. |
| tech-general | S0 (all §4/§8 seams, alone, tree green at exit), R1 (`git.rs`), R2 (`lib.rs`, `hooks*`, `toolchain.rs`, `agents.rs`, `tasks.rs`), D1 (`scripts/truth*.mjs`, generated `AGENTS.md` + `.agents/skills`) | **Active.** Multiple instances, disjoint zones; zero zone violations this round — the first work order since WO13 with none. S0-alone-first is now the pattern that made that true. |
| tech-ui | U1 (Inspector), U2 (wizards), U3 (agents/skills/compile), U4a (shell, title, settings, styles), U4b (canvas, tasks, sessions) | **Active.** Five parallel UI lanes on one grid. Interface verdict pending on F10 (title-screen primary door vs the Recommended chip) — resolved in the fix round by making the primary follow the composition. |
| tech-barn | B1 (ticker tooltips, legend strip, integer wide-fit) | **Active.** Smallest lane of the round; D-21 (integer fit, no animation) implemented exactly. |
| tester | all five gates + the invoke-name contract + `npm run truth --no-cargo` + `docs/testing/GOLDEN_PATH_MANUAL.md` (38 scenarios) + adversarial pass (2 MEDIUM · 9 LOW · 3 NIT) | **Active.** The golden-path manual is now the v0.1.0 release-gate walk, not a per-WO manual — see ROADMAP §Release gate. |
| project-manager | this close-out: ACTIVITY_LOG, ROSTER, TASKS/BUGS/ROADMAP/BACKLOG, TERMINOLOGY + reference, CLAUDE.md Status + hard rule, the two skills, then `npm run truth:write` / `npm run truth` | **Active — always final.** New standing duty: the Status prose carries **no counts**; the generated truth block between the `truth:begin` / `truth:end` markers is the only place numbers live. |
| product-analyst | — | **Idle by scope.** WO15 is delivery against a frozen contract, not research. |

## Rules

- **Zones never overlap.** When lanes run in parallel, each gets an explicit file
  zone; leaving the zone is forbidden — an agent that needs a foreign file stops
  and reports instead.
- **Conflicts:** architecture/module boundaries → tech-lead's verdict; interface →
  tech-ui's verdict.
- **Idle by scope** means the task had no work in that agent's lane — it is not
  laziness and is not flagged. The dispatcher lists idle agents in one line.
- Roster and `ACTIVITY_LOG.md` are updated by project-manager at the end of every
  fleet session; the log **targets** the three most recent sessions but actually carries 17 — the roll-out into `docs/_archive/` has never run, and needs Marty because that directory is write-frozen (BACKLOG P1.5). Corrected 2026-08-24.

## Mapping from the old 13-callsign roster

Code Lead → tech-lead · Core Coder + Multifunctional Coder → tech-general ·
UI Coder → tech-ui · Barn Coder + Sound Designer → tech-barn · Tester → tester ·
Task Manager + Administrator + Librarian + File System Manager → project-manager ·
Product Analyst → product-analyst · 2D Artist → retired (sprites are Marty-side
asset work; art rules live in the `art-direction` skill).
