# Tasks

Active and recently completed work items toward v0.1.0. Schema: Name | Status | Priority | Tags | Agent | Created | Description.

All seven phases (0–6) are accepted as of 2026-08-18; WO01 is now fully closed. Only v0.1.0 release work remains.

## Open — toward v0.1.0

| Name | Status | Priority | Tags | Agent | Created | Description |
|---|---|---|---|---|---|---|
| WO01 full acceptance walk (manual sections A–F + N) | new | critical | wo01, qa, acceptance |  | 2026-08-18 | Review all WO01 manual sections and N-suite steps (task-format, @mention, manager mode, status bar). Two known issues documented: MAJOR Windows notify rename, MINOR flush TOCTOU. |
| CSP runtime check under production build | new | high | v0.1.0, csp, qa |  | 2026-08-17 | Run `npm run tauri build` against production CSP; verify invokes, SFX, fonts, Barn render, no CSP refusals in console. |
| Cut v0.1.0 | new | high | v0.1.0, release |  | 2026-08-18 | Real sprites landed, CSP check green, then verified production build + tagged release commit. |

## Done — acceptance walks (2026-08-18)

| Name | Status | Priority | Tags | Agent | Created | Description |
|---|---|---|---|---|---|---|
| Phase 5 manual acceptance walk | done | critical | phase-5, acceptance, qa |  | 2026-08-17 | SETTINGS → PHASE5_JUICE → PHASE5_SOUND manuals walked; acceptance bar met. |
| Phase 3+4 manual acceptance walk | done | critical | phase-3, phase-4, acceptance, qa |  | 2026-08-16 | Real assemble (5 briefs), hooks install, live canvas pulses, Barn demo all walked. |
| Phase 6 manual acceptance walk | done | critical | phase-6, acceptance, qa |  | 2026-08-17 | Preset apply never-clobber, HANDOFF.md, clipboard variants all walked. |

## Done — history by session

| Name | Status | Priority | Tags | Agent | Created | Description |
|---|---|---|---|---|---|---|
| WO01 fully closed (Blocks A–F + N1–N5) | done | critical | wo01, ultracode, product |  | 2026-08-18 | 7-block ultracode: canvas/watcher, token budget, review queue, blocks D/E, agents MVP, task-format skill. Invoke 43→50. All gates green. |
| Agents Suite (v0.0.0011) | done | high | agents, product |  | 2026-08-18 | 10 new invoke commands, 4 lanes, byte-identity parser, fnv1a32 identity, named calves. 40 new tests. Manual written, 4 audit defects all fixed. |
| UX batch (v0.0.0008) | done | high | uxbatch, product |  | 2026-08-18 | 12 in-batch items + 4 invoke commands (rename/reveal/probe/hooks-status). 3 lanes, manual written. |
| ship-prep: Tighten CSP | done | high | v0.1.0, security |  | 2026-08-17 | Production CSP + relaxed devCSP in tauri.conf.json; version pre-bumped to 0.1.0. |
| ship-prep: Code-split main JS chunk | done | medium | v0.1.0, perf |  | 2026-08-17 | Main chunk 1,334 → 207 kB via React.lazy + manualChunks. |
| ship-prep: Add ESLint + `npm run lint` | done | medium | v0.1.0, lint |  | 2026-08-17 | ESLint 10 flat config; no-explicit-any error; classic react-hooks rules. |
| ship-prep: Stale-docs cleanup + README positioning | done | medium | v0.1.0, docs |  | 2026-08-17 | CLAUDE.md bullets refreshed; README AGENTS.md-standard positioning. |
| ship-prep: Adversarial review + 5 fixes | done | high | v0.1.0, review |  | 2026-08-17 | 6 findings, 5 fixed (critical: pixi.js/unsafe-eval), 1 rejected; gates re-run green. |
| Phase 5+6 fleet: Frozen contract PHASE56_CONTRACT.md | done | high | phase-5, phase-6, spec |  | 2026-08-17 | Stage-0 seams, zero-overlap grid, 23-command invoke contract (archived). |
| Phase 5+6 fleet: Stage 0 — shared seams | done | high | seams, rust, frontend |  | 2026-08-17 | howler install, settings store/rs, sfx/preset/handoff stubs, lib.rs at 23 commands. |
| Phase 5+6 fleet: Lane A — SFX layer | done | high | phase-5, sfx |  | 2026-08-17 | Full sfx.ts: 14+3 cues, ducking/cooldowns/throttle/voice pool, calm/mute/hidden gates. |
| Phase 5+6 fleet: Lane B — Settings modal | done | high | phase-5, settings |  | 2026-08-17 | SettingsModal: volume, sound switches, mute, calm, live claude-path override. |
| Phase 5+6 fleet: Lane C — SNES juice pass | done | high | phase-5, barn |  | 2026-08-17 | Scarf flutter, anticipation, dust, waiting choreography, calm-mode motion. |
| Phase 5+6 fleet: Lane D — presets & handoff | done | high | phase-6 |  | 2026-08-17 | preset.rs/handoff.rs never-clobber + full UI with clipboard variants. |
| Phase 5+6 fleet: Integration + audit + verification | done | high | integration, review |  | 2026-08-17 | Zero cross-lane defects; 24/24 findings fixed; gates green (build/clippy/88 tests/23 invoke). |
| Phase 5+6 fleet: Product research pass | done | high | research |  | 2026-08-17 | Brainstorm_Features.md: 18 ideas triaged into BACKLOG.md (original archived). |
| Phase 3+4 fleet: Phase 2 acceptance walk | done | critical | phase-2, qa |  | 2026-08-16 | Marty accepted Phase 2; Phase 1 UX folded in. |
| Phase 3+4 fleet: assemble.rs — `claude -p` queue | done | high | phase-3, rust |  | 2026-08-16 | FIFO max-2 queue, Runner seam, stdin-piped spawn, root-confined atomic writes. |
| Phase 3+4 fleet: hooks.rs + hooks_server.rs | done | high | phase-4, rust |  | 2026-08-16 | Trust-boundary preview/write; axum on :4923 → BarnEvent → emit. |
| Phase 3+4 fleet: Frontend assemble + events + live feed | done | high | phase-3, phase-4, react |  | 2026-08-16 | events store (ring buffer, resolveNodeId), assemble wrappers, EventLog, HooksModal. |
| Phase 3+4 fleet: Barn prototype (early, authorized) | done | high | phase-5, pixi |  | 2026-08-16 | src/scene/: iso scene, cow task queue, event mapper, DemoPlayer, pan/zoom. |
| Phase 3+4 fleet: Integration + audit + verification | done | high | integration, review |  | 2026-08-16 | Canvas⇄Barn toggle; 6/6 audit defects fixed; gates green (60 tests/14 invoke). |
| Phase 2 build day: Frozen spec + compile.rs + frontend + audit | done | high | phase-2 |  | 2026-08-16 | Adapters, validation, Kahn ordering, CompileModal + LCS diff; 3 audit fixes; gates green. |
