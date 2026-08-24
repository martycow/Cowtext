# Cowtext Roadmap

**Positioning: Cowtext is a context compiler for AI coding agents.** Orchestration is a feature, not the pitch. The phased build (0–6) is finished and accepted; this roadmap tracks **Cowtext v2** — the four-layer build toward Blume-class config management, Chorus-class lifecycle, Paperclip-class governance, and the barn on top. Strategy source: `Cowtext_Strategy_2026.pdf` (2026-08-19 planning session).

## v2 — The Context Compiler

Four layers, one graph:

| Layer | What it is | Status |
|---|---|---|
| **L1 Context graph** | The moat: typed nodes + edges, multi-format compiler (claude/agents/cursor/copilot/gemini/skill), importer, linter, CLI check | **5 of 6 targets shipped** (the `skill` target is still WO04); importer, linter and `cowtext-cli` all landed in WO03. Schema is **v5**, not the v3 this cell claimed until 2026-08-24. Remaining L1 = WO04. |
| **L2 Orchestrator** | Table stakes (kanban, worktrees, parallel sessions) + the differentiator: per-task subgraph injection, compile-on-launch, budgets | **All of it shipped in WO06** (done 2026-08-19) — this cell read "= WO06" as if pending until 2026-08-24. Sessions cap at 4 and one per cwd. Known gap found in the WO17 audit: the board→agent hop degrades silently (WO17 P1.7). |
| **L3 Workflows** | Chains, approval gates, permission grids, squads, heartbeat scheduling, auto-promote | Unbuilt = WO07 |
| **L4 Observability + Barn** | Event pipeline, usage heatmap, drift lint, dead-node report, quota tracker — and the barn, free forever | Hooks feed + barn shipped; proof layer = WO05 |

Sequencing principles: L1 excellent before L2; proof layer (heatmap + drift) before orchestrator build-out; barn = garnish that stays. The fourth principle as originally written — "graph v2→v3 schema bump happens exactly once (WO03)" — **did not survive**: v3→v4 landed in WO10 (edge `waypoints`) and v4→v5 in WO13 (roles 13→14, edges 7→5). Each carried a migration, so the standing rule held even though the "exactly once" did not. WO17 P2 is deliberately designed to need no bump at all.

## Release gate

**This section is the single source of release-gate truth.** If another document
says the cut is gated on something else, that document is stale. Established
2026-08-22 (WO15 Stage 6); the live numbers behind it are generated, never typed —
see the truth block in `CLAUDE.md` between `<!-- truth:begin -->` and
`<!-- truth:end -->`, written only by `npm run truth:write`.

**App version: v0.1.0-pre.** The cut to **v0.1.0** happens when all three gates below
are green at the same time. No other condition blocks it — in particular, real
sprites are **not** a release gate (re-based 2026-08-19); they land with WO05.

| # | Gate | How it is proven | State (2026-08-22) |
|---|---|---|---|
| 1 | **Golden-path walk** | Marty walks `docs/testing/GOLDEN_PATH_MANUAL.md` end to end in one sitting — 38 risk-based scenarios, sections A–L, ~55 min, with the *Snap before / Snap after* folder-watch rule on every writing step. Prerequisite: `git` on PATH with a global identity. | **OPEN** — manual authored 2026-08-22, never walked |
| 2 | **Acceptance walks** | **Reconciled against TASKS.md on 2026-08-24; the old list was wrong in three ways** — it named WO10 and WO11, whose walks TASKS.md records as `done`; it omitted WO06, which has an open walk; and two manuals are not named after their work order. The real set, by filename: `WO13_TEST_MANUAL.md` · `INPUT_PROMPT_SWEEP_TEST_MANUAL.md` (**this is WO12** — no `WO12_TEST_MANUAL.md` exists) · `WO09_TEST_MANUAL.md` (manual exists but **no task row tracks it**) · `WO06_TEST_MANUAL.md` · `WO03_TEST_MANUAL.md` · `WO02_TEST_MANUAL.md` · `WO01_BLOCK_A_TEST_MANUAL.md` (**Block A only** — WO01's other blocks have no manual, so "walk all sections" cannot be executed as written). Findings go back to their own work order, not to a new one. | **OPEN** — **seven**, not the eight this row claimed. WO17 P0.2 proposes folding them into one regression list instead; that proposal is TASKS.md "WO17 decision 6" and would redefine this gate. |
| 3 | **`npm run truth` green** | T1–T14 all PASS, T6 included (the cargo counts — so it must be the full run, not `--no-cargo`). Proves: `AGENTS.md` is the render of `CLAUDE.md`, `.agents/skills` are byte mirrors, every registered command has a TS caller and vice versa, Rust and TS agree on the schema version and the compile targets, no stale count in any doc, no forbidden mirror string, and the provider-support sentence is on every surface. | **GREEN** at close-out 2026-08-22 — re-run it before the cut; it is a drift gate, not a one-time proof |

Gate 3 is cheap and must be re-run on the day of the cut. Gates 1 and 2 are
Marty-side and are the actual long poles.

## Work orders toward v2

| Name | Status | Priority | Tags | Agent | When | Description |
|---|---|---|---|---|---|---|
| WO03 — L1 moat hardening | done | critical | wo03, l1, compiler |  | 2026-08-19 | Graph v3 (13 roles, 7 edge kinds, tags/owner/meta, edge color), copilot + gemini compile targets, cowtext-cli compile --check, importer MVP, linter v1. 7 lanes delivered; 14 defects found/fixed (2 CRITICAL); audit 5 OBSERVATIONS. Awaiting Marty's acceptance walk. |
| WO04 — L1 completion | superseded | high | wo04, l1, compiler |  | replanned 2026-08-24 | **Its contract's baseline is dead — see the banner on `docs/design/WO04_CONTRACT.md` and the replan in `docs/design/L1_PLAN.md`.** Written against WO03 (invoke 54, schema v3, 13 roles, 7 edge kinds); the repo is at 81 / v5 / 14 / 5. All eight commands it proposes are absent and `.github/` does not exist, so no backend was built — but §4.4 (skill compile target) and §4.1's `command → Inline` now **contradict shipped code**, and D5's loadouts write a `pinned` field v5 deleted. Scope survives, re-staged as L1-0…L1-6; the moat lane is smaller than this row implies because the `Artifact` arm already ships via `resolve_load`'s destination lock. |
| WO05 — L4 proof layer + barn | new | high | wo05, l4, heatmap, barn |  | after WO04 | Event persistence + usage heatmap (read-event lens), Reality Check drift lint, dead-node report, dust/cobwebs, session history, quota tracker, unmapped-read adopt, cowtext-hook shim (cut-line), sprites integration + GIF export + moo notification. **Note: ran AFTER WO06.** |
| WO06 — L2 orchestrator | done | high | wo06, l2, sessions |  | 2026-08-19 | Task DAG, tasklinks sidecar (task↔node↔session), per-task subgraph injection + compile-on-launch, token ceilings with atomic hard-stop, session-to-node attribution, handoff→node, O1/O2/O3 fixes, barn mission control. Feature-complete: 542/542 tests, 63/63 reachable. Ran **out-of-sequence BEFORE WO04/WO05** at Marty's request ("I need orchestrator suite"). |
| WO10 — canvas legibility + project suite | done | high | wo10, l1, ux |  | 2026-08-20 | All 16 items of the 08/20 brainstorm list plus the four unbuilt 08/19 project items, in one round at Marty's call. Graph v4 (edge `waypoints`), dynamic connector pins (amends the frozen WO09 geometry — see its §3a), one verb per wire with collision-swept labels, per-edge colour, three-tone edge emphasis, viewport-centre spawn + focus-on-select, `sameRelPath` selection sync, Unity-style collapsible Inspector, tools dropdown, and the New/Convert/Edit project wizard over a new `.cowtext/project.json` sidecar. Invoke 63→66; 553 Rust tests. Awaiting Marty's acceptance walk. |
| WO11 — Acceptance-walk defects + Home/Git/Project/Avatars | done | high | wo11, l1, ux, shell |  | 2026-08-20 | WO10 acceptance-walk defects (6 groups A–G), Home button with session warn, Git init + .gitignore composer with presets, project properties in Inspector, agent avatars with upload, fleet-view agent detail, and three doctrines (ONE_WRITER, TOCTOU serialization, standing path-safety rule). Invoke 66→73; 604 Rust tests (586 lib + 18 CLI); all gates green. Three unproven crashes remain open (B2/C1/F1). |
| WO13 — Audit + refactors: gates green | done | high | wo13, verification, audit |  | 2026-08-21 | Nine lanes delivered, all gates green. Schema v4→v5, three refactors (roles 13→14, edges 7→5, agent modal). Invoke 74→75; Rust 770/770 (736 lib + 18 CLI + 16 MCP); Vitest 163/163. Audit 16 defects (D1–D16, Amendment 4) all fixed; two zone-violation incidents recorded; tech-lead §4 proposals drafted. Four grid gaps identified (unassigned files). Awaiting Marty's acceptance walk. |
| WO15 — Release truth + UI round 2 | done | critical | wo15, release-truth, ux, honesty |  | 2026-08-22 | Nine lanes (S0 seams, R1 git, R2 backend, U1 Inspector, U2 wizards, U3 agents/skills, U4a shell, U4b canvas/tasks, B1 barn, D1 truth script) + tech-lead audit + fix round + a live run. Three themes: **honesty** (one provider-support sentence on every surface, `docs/design/PROVIDER_SUPPORT_MATRIX.md`, `.codex/*` marked development-only), **generation** (`scripts/truth.mjs` T1–T14 generates `AGENTS.md`, `.agents/skills/*` and the CLAUDE.md truth block — hand edits denied by docs-guard), **first run** (title auto-scan, empty-state CTAs, six-step New Project wizard leaving the folder on `branch main · 1 commit`). Invoke 76→78; schema v5 unchanged; no new dependencies. Audit 0 CRITICAL · 2 MAJOR · 8 MINOR · 10 NIT, all closed or filed; amendments A-20…A-24. Golden-path manual (38 scenarios) is now the release-gate walk — see §Release gate. |
| WO16 — Agent presets + tech-stack settings | done | high | wo16, presets, settings |  | 2026-08-22 | **Row added 2026-08-24** — WO16 landed on 2026-08-22 and was documented only in the CLAUDE.md Status block and BACKLOG §WO16 research items; this table, `TASKS.md` and `ACTIVITY_LOG.md` all omitted it. Agent presets 6 → 11 with a `group` field, `planner` renamed and rewritten as `project-manager`, three delegating roles given the `subagents` capability. User presets under a `custom:` id namespace in `settings.json`. Settings became a seven-pane nav rail; Tech stack sets a new project's starting ticks and takes user rows with optional 32×32 icons stored in `app_config_dir/stack-icons/` and returned as data URLs — deliberately, so no asset-protocol scope, no CSP widening, no `capabilities/default.json` change. Three new invokes (`stack_icon_import`, `stack_icon_read`, `stack_icon_delete`); graph schema unchanged; no new dependencies. Committed with WO15 as `a8abac7`. |
| WO17 — Visual environment | new | critical | wo17, ux, canvas, maps, barn |  | after v0.1.0 cut | **Plan: `docs/design/WO17_PLAN.md`; items: BACKLOG §WO17 (29 rows, `WO17 P*` names).** Repositions the product from context compiler to *visual environment*, on one thesis: the diagrams you draw to think are the context the agent reads. Six bands: **P0** clear the table (commit WO15+16, walk golden path, fold eight manuals into one regression list, cut v0.1.0) · **P1** restore the fast path (inline node creation, edge without a modal, copy/paste, Ctrl+K palette, auto-layout, Run back on the task card) · **P2** Maps — several canvases over one node pool via a `.cowtext/maps.json` sidecar, **no schema bump**, five map kinds on the existing 14 roles, plus non-file sketch elements · **P3** close the board→agent→graph loop · **P4** the barn as the soul (real sprites, separate window, GIF export) · **P5** revive the dead motion tokens. Diagnosis behind it: the product systematically traded the fast path for the careful path — a 10-node/12-edge graph costs ~22 dialogs today. Six decisions are Marty-only (see TASKS.md); three of them block their band. |
| WO07 — L3 workflows | new | medium | wo07, l3, governance |  | after WO06 | Heartbeat-scheduled agents, event triggers, approval gates, permission grids, squads, auto-promote (Memory Inbox + transcript mining), revisioned config with rollback, workflow packs with secret scrubbing. **Note: WO17 P3.3 re-homes auto-promote (Memory Inbox) out of here.** |
| WO08 — platform | new | low | wo08, platform |  | after WO07 | Fleet dashboard, cowtext-mcp, Claude Code plugin, context packages, Skill Studio, Barn Raising. Scoped after WO05 telemetry. |
| Real sprites (Aseprite originals) | new | high | art, assets, wo05 |  | parallel | Marty-side asset track, can start anytime; integration lands in WO05. Per ART_DIRECTION.md. |

**v0.1.0 re-based (2026-08-19, superseded 2026-08-22)**: the original cut gate (sprites + CSP walk + acceptance walks) was dissolved and the cut re-based to the WO03 landing; the CSP production check folded into WO03's test manual as one step. WO02 committed as `103ac80`. **The live definition of the cut now lives in §Release gate above** — this line is kept for the history of how it moved.

---

## Historical

Everything below is the closed phased build (0–6), kept for the record.

### App version

**Current: v0.1.0-pre** (tauri.conf.json pre-bumped to 0.1.0). This line used to add "the cut is now defined as the WO03 landing" — **that was a second, conflicting definition of the cut inside the same document**, and §Release gate above declares itself the single source. Struck 2026-08-24; the WO03 wording is preserved in the re-basing note under the work-order table as history.

Scheme `v0.0.NNNN`: incremented once per landing (code complete + verified); manual acceptance gates *closed* phases, not the bump.

| Version | Landed | What it covers |
|---|---|---|
| v0.0.0001 | Phase 0 | Tauri 2 skeleton, dark shell, open folder, `.md` scan |
| v0.0.0002 | Phase 1 | Graph canvas, inspector, `.cowtext/graph.json` persistence |
| v0.0.0003 | Phase 2 | Compile: adapters, diff-preview modal, cycle validation |
| v0.0.0004 | Phases 3+4 | Assemble: `claude -p` queue. Live feed: axum on :4923, hooks, event log, Barn prototype. |
| v0.0.0005 | Phase 5 | The Barn: full SFX, Settings modal, juice pass, calm mode, demo filtering |
| v0.0.0006 | Phase 6 | Presets & Handoff: never-clobber, GENERATED header, UI, clipboard variants |
| v0.0.0007 | ship-prep | Production CSP, code-split (1,334→207 kB), ESLint 10, `pixi.js/unsafe-eval` fix |
| — | WO01 (`ef1c23c` et al.) | Blocks A–F + N1–N5: lenses/watcher, token budget, review queue, wizard, thought bubbles, Agents MVP, task-format |
| — | WO02 (`103ac80`) | 7 lanes: board segments, TagPicker, priority buckets, agent memory ensure, FPS overlay, model catalog |

### Phases & milestones — all closed

Each milestone was the phase's gate: "acceptance criteria pass in a running app".
Phases 0–2 were accepted incrementally; the Phase 3–6 acceptance walks all passed 2026-08-18.

| Phase | Milestone | Scope | Acceptance gate | Version | Status |
|---|---|---|---|---|---|
| 0 — Skeleton | M0 — Skeleton works | Tauri 2 + React + Vite scaffold; open folder → `.md` scan; dark Tailwind shell | Pick a real repo, see its `.md` files listed; cold start < 2 s | v0.0.0001 | ✅ Accepted |
| 1 — Graph canvas | M1 — Graph persists | React Flow canvas, edge kind picker, inspector (CodeMirror 6 + form), `.cowtext/graph.json`, adopt `.md` | 6-node graph survives restart; inspector edit changes the file on disk | v0.0.0002 | ✅ Accepted 2026-08-16 |
| 2 — Compile | M2 — Compile trusted | Adapters, diff-preview modal, GENERATED headers, cycle validation | Compiled `CLAUDE.md` works in a real session; nothing written without approval | v0.0.0003 | ✅ Accepted 2026-08-16 |
| 3 — Assemble | M3 — Assemble writes files | `claude -p` queue (max 2), per-node Assemble/Refine/Summarize, progress states | 5 briefs → 5 sensible `.md` files without touching a text editor | v0.0.0004 | ✅ Accepted 2026-08-18 |
| 4 — Live feed | M4 — Live pipeline proven | Hooks writer with confirmation diff; axum on :4923; event log; canvas pulse | Run Claude Code in a terminal, watch nodes light up in real time | v0.0.0004 | ✅ Accepted 2026-08-18 |
| 5 — The Barn | M5 — The Barn delights | Pixi scene, SFX, settings, juice pass, calm mode + mute (placeholder sprites) | A stranger watches a live session for 30 seconds and smiles | v0.0.0005 | ✅ Accepted 2026-08-18 |
| 6 — Presets & Handoff | M6 — Presets & Handoff | Presets (structure + briefs, never-clobber), `HANDOFF.md` + clipboard variants | New project from preset in < 1 minute | v0.0.0006 | ✅ Accepted 2026-08-18 |

### Sprint log — v2 work orders (count history)

**These numbers are deliberately frozen at their landing date and are NOT kept in
sync with the live gates.** `npm run truth` does not scan this file, on purpose: it
is history, and history is allowed to carry old numbers. Do not "fix" a row here
because it disagrees with the truth block in `CLAUDE.md` — that disagreement is the
record of the project moving. The live numbers are in the truth block, and nowhere
else. (WO15 audit §11.4.)

| Work order | Landed | Invoke | Rust tests | Frontend tests | Schema | Notes |
|---|---|---|---|---|---|---|
| WO03 | 2026-08-19 | 51→54 | 387 | — | v3 | 7 lanes; 14 defects found/fixed (2 CRITICAL) |
| WO06 | 2026-08-19 | 54→63 | 542 (524 lib + 18 CLI) | — | v3 | 7 lanes + 2 fix rounds; 63/63 reachable |
| WO09 | 2026-08-19 | 63 (unchanged) | 542 | — | v3 | one connector lane; frozen §3 constant table |
| WO10 | 2026-08-20 | 63→66 | 553 | — | v4 | canvas legibility + project wizard suite |
| WO11 | 2026-08-20 | 66→73 | 604 (586 lib + 18 CLI) | — | v4 | 16 defects fixed; 3 crashes still unproven |
| WO12 | 2026-08-20 | 73→74 | 624 lib + 16 MCP | — | v4 | 12 lanes; 2 PARTIAL items filed as bugs |
| WO13 | 2026-08-21 | 74→75 | 770 (736 + 18 + 16) | 163 / 12 files | v4→**v5** | first Vitest suite; 16 defects (D1–D16) |
| WO15 | 2026-08-22 | 76→**78** | 819 (785 + 18 + 16) | 297 / 17 files | v5 | release truth + UI round 2; 0 CRITICAL · 2 MAJOR |

The title-screen redesign (2026-08-21, invoke 75→76, Rust 785) landed between WO13
and WO15 outside the work-order numbering.

### Sprint log — phases, all closed

Sprints mapped 1:1 to plan §9 phases. Per-task detail lives in TASKS.md and `docs/fleet/ACTIVITY_LOG.md`.

| Sprint | Phases | Window | Outcome |
|---|---|---|---|
| Sprint 0: Skeleton | 0 | pre-2026-08-15 | ✅ Closed — dark shell, open folder, `.md` scan |
| Sprint 1: Graph canvas | 1 | closed 2026-08-15 | ✅ Closed — canvas, inspector, persistence, adopt-.md |
| Sprint 2: Compile | 2 | closed 2026-08-16 | ✅ Closed — adapters, diff-preview modal, validation |
| Sprint 3: Assemble + Live feed | 3+4 | code 2026-08-16, walk 2026-08-18 | ✅ Closed — assemble queue, hooks pipeline, EventLog/HooksModal, Barn prototype; 6/6 audit defects fixed |
| Sprint 4: The Barn + Presets & Handoff | 5+6 | code 2026-08-17, walks 2026-08-18 | ✅ Closed — 4 zero-overlap lanes, zero cross-lane defects; 24/24 audit findings fixed |
