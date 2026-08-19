# Cowtext Roadmap

**Positioning: Cowtext is a context compiler for AI coding agents.** Orchestration is a feature, not the pitch. The phased build (0–6) is finished and accepted; this roadmap tracks **Cowtext v2** — the four-layer build toward Blume-class config management, Chorus-class lifecycle, Paperclip-class governance, and the barn on top. Strategy source: `Cowtext_Strategy_2026.pdf` (2026-08-19 planning session).

## v2 — The Context Compiler

Four layers, one graph:

| Layer | What it is | Status |
|---|---|---|
| **L1 Context graph** | The moat: typed nodes + edges, multi-format compiler (claude/agents/cursor/copilot/gemini/skill), importer, linter, CLI check | 3 targets shipped; v3 schema, importer, linter, CLI = WO03–WO04 |
| **L2 Orchestrator** | Table stakes (kanban, worktrees, parallel sessions) + the differentiator: per-task subgraph injection, compile-on-launch, budgets | Sessions + board shipped; DAG, linkage, budgets = WO06 |
| **L3 Workflows** | Chains, approval gates, permission grids, squads, heartbeat scheduling, auto-promote | Unbuilt = WO07 |
| **L4 Observability + Barn** | Event pipeline, usage heatmap, drift lint, dead-node report, quota tracker — and the barn, free forever | Hooks feed + barn shipped; proof layer = WO05 |

Sequencing principles: L1 excellent before L2; proof layer (heatmap + drift) before orchestrator build-out; barn = garnish that stays; graph v2→v3 schema bump happens exactly once (WO03).

## Work orders toward v2

| Name | Status | Priority | Tags | Agent | When | Description |
|---|---|---|---|---|---|---|
| WO03 — L1 moat hardening | done | critical | wo03, l1, compiler |  | 2026-08-19 | Graph v3 (13 roles, 7 edge kinds, tags/owner/meta, edge color), copilot + gemini compile targets, cowtext-cli compile --check, importer MVP, linter v1. 7 lanes delivered; 14 defects found/fixed (2 CRITICAL); audit 5 OBSERVATIONS. Awaiting Marty's acceptance walk. |
| WO04 — L1 completion | new | high | wo04, l1, compiler |  | after WO03 | Hierarchy simulator (nearest-file-wins), Windows-safe symlink manager, SKILL.md target, full round-trip import, resolved-context preview, context loadouts, preset starter packs, GitHub Action, branch-aware graph. **Note: ran AFTER WO06 (sequencing deviation).** |
| WO05 — L4 proof layer + barn | new | high | wo05, l4, heatmap, barn |  | after WO04 | Event persistence + usage heatmap (read-event lens), Reality Check drift lint, dead-node report, dust/cobwebs, session history, quota tracker, unmapped-read adopt, cowtext-hook shim (cut-line), sprites integration + GIF export + moo notification. **Note: ran AFTER WO06.** |
| WO06 — L2 orchestrator | done | high | wo06, l2, sessions |  | 2026-08-19 | Task DAG, tasklinks sidecar (task↔node↔session), per-task subgraph injection + compile-on-launch, token ceilings with atomic hard-stop, session-to-node attribution, handoff→node, O1/O2/O3 fixes, barn mission control. Feature-complete: 542/542 tests, 63/63 reachable. Ran **out-of-sequence BEFORE WO04/WO05** at Marty's request ("I need orchestrator suite"). |
| WO07 — L3 workflows | new | medium | wo07, l3, governance |  | after WO06 | Heartbeat-scheduled agents, event triggers, approval gates, permission grids, squads, auto-promote (Memory Inbox + transcript mining), revisioned config with rollback, workflow packs with secret scrubbing. |
| WO08 — platform | new | low | wo08, platform |  | after WO07 | Fleet dashboard, cowtext-mcp, Claude Code plugin, context packages, Skill Studio, Barn Raising. Scoped after WO05 telemetry. |
| Real sprites (Aseprite originals) | new | high | art, assets, wo05 |  | parallel | Marty-side asset track, can start anytime; integration lands in WO05. Per ART_DIRECTION.md. |

**v0.1.0 re-based (2026-08-19)**: the old cut gate (sprites + CSP walk + acceptance walks) is dissolved. The first public cut = WO03 landing; the CSP production check folds into WO03's test manual as one step. WO02 committed as `103ac80`.

---

## Historical

Everything below is the closed phased build (0–6), kept for the record.

### App version

**Current: v0.1.0-pre** (tauri.conf.json pre-bumped to 0.1.0; the cut is now defined as the WO03 landing).

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

### Sprint log — all closed

Sprints mapped 1:1 to plan §9 phases. Per-task detail lives in TASKS.md and `docs/fleet/ACTIVITY_LOG.md`.

| Sprint | Phases | Window | Outcome |
|---|---|---|---|
| Sprint 0: Skeleton | 0 | pre-2026-08-15 | ✅ Closed — dark shell, open folder, `.md` scan |
| Sprint 1: Graph canvas | 1 | closed 2026-08-15 | ✅ Closed — canvas, inspector, persistence, adopt-.md |
| Sprint 2: Compile | 2 | closed 2026-08-16 | ✅ Closed — adapters, diff-preview modal, validation |
| Sprint 3: Assemble + Live feed | 3+4 | code 2026-08-16, walk 2026-08-18 | ✅ Closed — assemble queue, hooks pipeline, EventLog/HooksModal, Barn prototype; 6/6 audit defects fixed |
| Sprint 4: The Barn + Presets & Handoff | 5+6 | code 2026-08-17, walks 2026-08-18 | ✅ Closed — 4 zero-overlap lanes, zero cross-lane defects; 24/24 audit findings fixed |
