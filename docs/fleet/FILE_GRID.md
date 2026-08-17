# File Grid — project documentation registry

Maintained by **Agent File System Manager**. One row per project-documentation `.md`
in the repo (`docs/**` plus `CLAUDE.md` and `README.md` at root — nothing else is
allowed to exist). Dates come from `git log --follow` where the file is tracked,
otherwise from the session that created it. Update this grid whenever a doc is
added, moved, renamed, or retired.

Last audit: 2026-08-16 (Phase 3/4 fleet session — second pass).

## The grid

| Path | Purpose | Created/edited by | Last updated | Why |
|---|---|---|---|---|
| `CLAUDE.md` | Root instructions for Claude Code: hard rules, commands, architecture, scaffold constraints, phase status line. | Marty + Claude (build sessions) | 2026-08-16 | Required at repo root; read automatically by Claude Code every session. |
| `README.md` | One-line public description of Cowtext. | Marty | 2026-08-15 | Standard repo entry point; will grow once the app is shippable. |
| `docs/FEATURES.md` | Full feature backlog with `SPEC`/`NEW` tags and plan-§9 phase assignments; the scope ledger. | Claude (build session), uncommitted edits pending | 2026-08-16 (uncommitted) | Single list of everything the app will do, so scope changes are explicit. |
| `docs/TERMINOLOGY.md` | Terminology & technology sheet — every product term, tech, and library, with definitions and where each lives. | Agent Terminologist | 2026-08-16 (uncommitted edits) | Shared vocabulary keeps fleet agents and docs consistent. |
| `docs/design/DESIGN_SPEC.md` | UI design spec (v1, dark only) digested from the Claude Design project; decisions, rules, component specs around `tokens.css` / `tailwind.config.js`. | Marty + Claude (design digest) | 2026-08-15 | Source of UI truth for the tool layer ("blue is you, amber is the cow"). |
| `docs/design/ART_DIRECTION.md` | Barn art direction: 16-bit iso style contract, Barnlight-29 palette, sprite rules for the Phase 5 scene. | Agent Art Director | 2026-08-16 | Settles visual style before any Pixi code exists; governs asset production. |
| `docs/design/SOUND_DESIGN.md` | Sound bible: aesthetic direction, cue sheet, mixing rules, file specs, placeholder-to-crafted SFX plan. | Agent Sound Designer | 2026-08-16 | Governs `assets/sfx/` and the Phase 5 howler.js runtime before it lands. |
| `docs/design/PHASE34_BARN_CONTRACT.md` | Phase 3/4 + barn-prototype build contract: frozen command/event/type shapes across the Rust, UI, and Barn lanes, plus a "Revisions" audit section (Code Lead). | Rust Coder / Multifunctional Coder / Barn Coder / Code Lead (fleet session) | 2026-08-16 (untracked) | Freezing invoke names, event wire shapes, and store contracts let three coder lanes build in parallel without drift. |
| `docs/design/BARN_PROTOTYPE.md` | Barn scene integration doc: BarnScene mounting, event wiring via useEventsStore, demo mode, Canvas⇄Barn toggle. | Agent Barn Coder, updated by Agent Integrator | 2026-08-16 (untracked) | Contract-required companion so the scene's seams survive Phase 5 work. |
| `docs/research/UX_NOTES.md` | UX review: journey maps, friction points, improvement proposals keyed to FEATURES numbers. | Agent UX Designer | 2026-08-16 | Feeds backlog items and phase acceptance criteria from a user-journey angle. |
| `docs/research/JUICE.md` | Research on game-feel for the barn: reference games, charm budget, storyboard for the six core BarnEvents. | Agent Researcher (game feel) | 2026-08-16 | Phase 5 designed in advance, not improvised. |
| `docs/research/PRODUCTIVITY.md` | Cold-start research: how a new project reaches a productive agent context fastest; recommendations tagged to FEATURES items. | Agent Researcher (productivity), uncommitted edits pending | 2026-08-16 (uncommitted) | Defines the cold-start moat (structure + briefs + Assemble). |
| `docs/tasks/ROADMAP.md` | Phase order (plan §9) plus the app versioning scheme and current version. | Agent Task Manager | 2026-08-16 | One place answering "where are we and what's next". |
| `docs/tasks/TASKS.md` | Active and recently completed work items with priority/status schema. | Agent Task Manager | 2026-08-16 | Working queue for the current sprint. |
| `docs/tasks/BACKLOG.md` | Known work not yet scheduled into a sprint; pulled into TASKS.md when picked up. | Agent Task Manager | 2026-08-16 | Keeps unscheduled work visible without polluting the active queue. |
| `docs/tasks/BUGS.md` | Known defects and watch items with severity in the priority field. | Agent Task Manager | 2026-08-16 | Defects tracked separately from feature work. |
| `docs/tasks/SPRINTS.md` | Sprint log — sprints map 1:1 to plan §9 phases; goal, dates, exit criteria, status. | Agent Task Manager | 2026-08-16 | Records the cadence and what each phase-sprint actually took. |
| `docs/tasks/MILESTONES.md` | Phase-gate table: acceptance criteria, version at gate, status per milestone. | Agent Task Manager | 2026-08-16 | Milestones close on manual acceptance, not on code landing — this tracks the gap. |
| `docs/testing/PHASE2_TEST_MANUAL.md` | Hand-run test script for the Compile feature (diff-preview trust boundary), ~25 min pass plus Phase 1 regression. | Agent Tester | 2026-08-16 | M2 gate opens only after this manual passes in a running app. |
| `docs/fleet/FILE_GRID.md` | This file — registry of every project-documentation `.md` and the hierarchy rules. | Agent File System Manager | 2026-08-16 | Keeps the doc tree strict, clean, and fresh. |
| `docs/fleet/ROSTER.md` | Fleet roster — who the agents are and what lane each owns. *(pre-registered; created by the Administrator right after this file)* | Agent Administrator | 2026-08-16 | The fleet needs a single membership record. |
| `docs/fleet/ACTIVITY_LOG.md` | Fleet activity log — what each agent did, per session. *(pre-registered; created by the Administrator right after this file)* | Agent Administrator | 2026-08-16 | Session-by-session audit trail of fleet output. |

## Hierarchy rules

Canonical layout — a documentation `.md` belongs in exactly one of these places:

| Location | Contents | Owner |
|---|---|---|
| `CLAUDE.md` (root) | Claude Code project instructions. Only doc allowed at root besides README. | Marty + Claude |
| `README.md` (root) | Public repo description. | Marty |
| `docs/FEATURES.md` | The feature backlog. Fixed filename, lives at `docs/` root. | Marty + fleet |
| `docs/TERMINOLOGY.md` | The terminology sheet. Fixed filename, lives at `docs/` root. | Agent Terminologist |
| `docs/design/` | Visual + sound design + build contracts: `DESIGN_SPEC.md`, `ART_DIRECTION.md`, `SOUND_DESIGN.md`, `PHASE34_BARN_CONTRACT.md`, `BARN_PROTOTYPE.md`. (`tokens.css` and `tailwind.config.js` live here as the spec's paste-ready value files — a documented exception, not a precedent for code in `docs/`.) | Design agents |
| `docs/research/` | Analysis and research notes (`UX_NOTES.md`, `JUICE.md`, `PRODUCTIVITY.md`, future research). | Research agents |
| `docs/tasks/` | Task Manager's files: `ROADMAP.md`, `TASKS.md`, `BACKLOG.md`, `BUGS.md`, `SPRINTS.md`, `MILESTONES.md`. | Agent Task Manager |
| `docs/testing/` | Tester's manual test scripts, one per phase/feature. | Agent Tester |
| `docs/fleet/` | Fleet meta-docs: `FILE_GRID.md` (File System Manager), `ROSTER.md` + `ACTIVITY_LOG.md` (Administrator). | FS Manager + Administrator |

Rules:

1. **No `.md` outside this layout.** No notes, plans, or reports at repo root (besides `CLAUDE.md`/`README.md`), in `src/`, `src-tauri/`, `scripts/`, or `assets/`. (Hard rule from `CLAUDE.md`.)
2. **New doc → new grid row.** Any agent creating a doc adds a row here in the same session, or the FS Manager adds it at next audit and flags the omission.
3. **New subfolder of `docs/` requires a rule.** Don't create a directory that this table doesn't define; propose the rule change here first.
4. **Renames/moves/deletions update cross-references.** A doc that references a moved or deleted file is stale until fixed (see Violations).
5. **Fixed filenames stay fixed.** `FEATURES.md`, `TERMINOLOGY.md`, and the `docs/tasks/` set are singletons — extend them, don't fork variants.

## Session audit — 2026-08-16 (Phase 3/4 + barn prototype fleet session)

Non-doc files created/edited this session (uncommitted), by lane. Docs changes are in the grid above.

| Path | Who | Why |
|---|---|---|
| `src-tauri/src/assemble.rs` + `src-tauri/src/assemble/tests.rs` (new) | Agent Rust Coder; fixed by Agent Verifier | Phase 3 Assemble queue: FIFO max-2-concurrent `claude -p` runner, prompt build per plan §6, atomic writes, `assemble://status` events. Verifier fix: prompt piped over stdin, `.exe` preferred, no console flash. |
| `src-tauri/src/hooks.rs` + `src-tauri/src/hooks/tests.rs` (new) | Agent Rust Coder | Phase 4 `hooks_preview`/`hooks_write`: merge plan-§7 block into `.claude/settings.json` preserving unrelated keys, never-clobber guards. |
| `src-tauri/src/hooks_server.rs` + `src-tauri/src/hooks_server/tests.rs` (new) | Agent Rust Coder | Phase 4 axum server on 127.0.0.1:4923, `POST /event` → BarnEvent normalization → `barn://event` emit. |
| `src-tauri/src/lib.rs` | Agent Rust Coder | Module decls, AssembleQueue managed state, hooks_server startup, 7 new commands in `generate_handler![]`. |
| `src-tauri/Cargo.toml` + `Cargo.lock` | Agent Rust Coder | Added `axum = "0.8"`, `tokio` (contract allowance; nothing else). |
| `src/store/events.ts` (new) | Agent Multifunctional Coder | Events store: BarnEvent ring buffer (200), demoMode, resolveNodeId, initEventListener, live-pulse helpers. |
| `src/assemble/` — `types.ts`, `api.ts` (new) | Agent Multifunctional Coder | Assemble wire types + the five invoke wrappers. |
| `src/inspector/EventLog.tsx` (new) | Agent Multifunctional Coder; polished by Agent Integrator | Collapsible live event feed panel; Integrator made the header a full toggle target and fixed a font-tier violation. |
| `src/inspector/HooksModal.tsx` (new) | Agent Multifunctional Coder; hardened by Agent Integrator | Hooks-install trust-boundary diff modal; Integrator set Cancel as initial focus and clarified the warning copy. |
| `src/store/graph.ts` | Agent Multifunctional Coder | Transient assembleStatus/assembleErrors + setAssembleStatus (no schema/version change). |
| `src/inspector/Inspector.tsx` | Agent Multifunctional Coder; race fixed by Agent Verifier | Assemble/Refine/Summarize UI with status badges; Verifier moved the optimistic "queued" mark before the await. |
| `src/canvas/MemoryNodeCard.tsx` | Agent Multifunctional Coder | Live-read pulse, assembling/assembled/error visual states per DESIGN_SPEC. |
| `src/scene/` — `BarnScene.tsx`, `palette.ts`, `iso.ts`, `props.ts`, `sceneGraph.ts`, `cow.ts`, `mapper.ts`, `demo.ts`, `types.ts` (new) | Agent Barn Coder; wired/fixed by Agent Integrator + Agent Verifier | Barn prototype: Pixi 8 iso scene, cow task queue, event mapper, demo mode. Integrator wired store subscription + demo→pushEvent; Verifier fixed mid-step interrupt and resolveProp delegation. |
| `src/App.tsx` | Agent Integrator | Canvas⇄Barn segmented toggle, initEventListener mount, EventLog mount. |
| `package.json` + `package-lock.json` | (modified in working tree) | Modified per git status — not claimed by any fleet build report this session; flagged for Marty's review (fleet rule: agents do not touch package.json). |

Gate at session end: `npm run build` green, `cargo clippy --all-targets -- -D warnings` clean, `cargo test` 60/60, invoke-name contract verified (14 names).

## Violations

| # | File | Problem | Suggested fix |
|---|---|---|---|
| V1 | `docs/DESIGN_PROMPT.md` | Deletion staged **by Marty himself** (intentional — do not restore); still cited as a source by `docs/TERMINOLOGY.md` (header) and `docs/research/UX_NOTES.md` (inputs list). | Marty commits the staged deletion when ready; Terminologist/UX strip the two stale references; content is superseded by `docs/design/DESIGN_SPEC.md`. |
| V2 | `README.md` | Stale: two lines, no mention of what the app is now (Phase 2 code landed), no build/run instructions. | Flesh out once a phase is accepted; low priority, but it is the repo's public face. |
| V3 | `docs/TERMINOLOGY.md` | Header claims it is "maintained by hand", but it is fleet-maintained (Agent Terminologist) and currently carries uncommitted edits alongside V1's stale `DESIGN_PROMPT.md` citation. | Terminologist updates the source list next pass. |

No misplaced files found — every existing `.md` sits in its canonical location.
