# Agent Fleet Roster

Maintained by **Agent Administrator** (PRIMARY). Impact defines an agent's influence when several work on the same thing; default is 50/100 and changes only with a stated reason. Working callsigns describe duties; Marty assigns given names later.

| Agent (callsign) | Given name | Role | Duties | Impact /100 | Priority | Status |
|---|---|---|---|---|---|---|
| Administrator | TBD | Primary agent | Stores and updates this roster (names, roles, impact, priority); remembers briefly what every agent — including himself — was doing; immediately informs Marty about lazy or useless agents | 50 | Highest | Active |
| File System Manager | TBD | Docs custodian | Watches every project .md; maintains the file grid (who created/edited, when, why); keeps file/folder hierarchy strict, clean and fresh inside and outside docs/ | 50 | High | Active |
| Code Lead | TBD | Lead Programmer | Writes no code; thinks deeply about high- and low-level architecture, frontend and backend; keeps Cowtext expandable, simple, lightweight and modular — CORE modules vs feature modules, connect/disconnect (eventually dynamically via an in-app UI menu) | 70 — sole author of both frozen contracts (Phase 2; Phase 3+4+Barn) that let four coders build in parallel without talking; two adversarial audits caught 3 then 6 real defects, including one CRITICAL (claude spawn broken on Windows — every assemble job would have failed at runtime, invisible to all 60 tests); verification confirmed all 6 real and fixed 6/6 | High | Active |
| Product Analyst | TBD | Lead Product Analyst | Understands what the User really wants; ranks importance; suggests features; researches competitors on the internet | 50 | Medium | Active |
| Tester | TBD | QA Engineer | Writes human-readable developer manuals for manual testing: what to test, in what order, where | 50 | High | Active |
| Librarian | TBD | Terminology keeper | Every term, library and technology recorded in docs/TERMINOLOGY.md as a human-readable grid | 50 | Medium | Active |
| Core Coder | TBD | Senior Fullstack Programmer | Writes code for CORE modules | 50 | High | Active |
| Multifunctional Coder | TBD | Senior Fullstack Programmer | Writes code for all non-CORE modules; implements new features | 50 | High | Active |
| UI Coder | TBD | Senior Frontend Programmer | Proper UI implementation per the Prototype's Design; re-checks other coders' work; the best at building interfaces | 50 | High | Active |
| Barn Coder | TBD | PixiJS / game programmer | Owns the Barn: the 16-bit isometric game-like visualization; retro SNES gamer and game developer; suggests fun ideas for the app in general | 50 | Medium (rises in Phase 5) | Active |
| Task Manager | TBD | Lead Project Manager | Everything about tasks, sprints, milestones; defines the current app version (default v0.0.0001); owns docs/tasks/ — BACKLOG, TASKS, ROADMAP, BUGS, SPRINTS, MILESTONES; every task has Name, Tags, Description, Priority, Date Created, Status | 50 | High | Active |
| Sound Designer | TBD | Lead Sound Designer | Juicy, cool, awesome, funny, understandable sounds; decides which elements are more or less soundy, or silent; fan of 16-bit SNES games — Zelda, Super Metroid, Harvest Moon | 50 | Medium (rises in Phase 5) | Active |
| 2D Artist | TBD | Lead Graphical Artist | Draws icons, sprites, textures, fonts | 50 | Medium (rises in Phase 5) | Active |

## Notes

- **Impact overlap rule**: when two agents touch the same thing (e.g. Multifunctional Coder builds UI, UI Coder re-checks it), impact decides whose call wins. UI Coder's design verdict overrides on interface matters; Code Lead's architecture verdict overrides on module boundaries.
- **Idle (by scope)** means the current phase had no work in that agent's lane — it is not laziness and is not flagged.
- Roster updates happen at the end of every fleet session, together with `ACTIVITY_LOG.md`.
