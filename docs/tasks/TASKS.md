# Tasks

Active and recently completed work items. Schema: Name, Tags, Description, Priority, Date Created, Status. Open tasks live at the top; completed tasks roll into the single history table below (one line per task — full detail lives in git history, BUGS.md, and `docs/fleet/ACTIVITY_LOG.md`).

Priority scale: P0 blocker · P1 high · P2 medium · P3 low.

All seven phases (0–6) are accepted as of 2026-08-18; the only open work is the v0.1.0 cut.

## Open — toward v0.1.0

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| WO01 Block A review by Marty | wo01, canvas, lenses, qa, acceptance | Review `docs/testing/WO01_BLOCK_A_TEST_MANUAL.md` (29 steps, 15 min): canvas lenses (Activity/Weight/Live), watcher fs://change events, lens state persistence, unknown-value fallback, and layout-freeze law. Two defects found: MAJOR rename ghost-entries (Windows notify limitation), MINOR TOCTOU race in flush() generation guard (both reproduced in manual, defect steps documented as known-fails). Block A gates all green (164 tests +6, tsc clean, lint 0 errors, clippy clean). Approve defects as known-issues for v0.1.0 cut or defer to Block B. | P0 | 2026-08-18 | 🔲 Open |
| Agents suite manual acceptance walk | agents, qa, acceptance | `docs/testing/AGENTS_TEST_MANUAL.md`: walk 53 steps covering agents CRUD, skill attach/detach, rename, orphan cleanup, SubagentStop hooks-diff, barn demo calves, reduced-motion check. Four audit defects traced and ALL FIXED in fix round before re-gate (2 major: frontmatter re-quote churn via should_touch_key logic, orphan-key precedence race via live meta + reconcileOrphan timing; 2 minor: case-insensitive rename via dest==src check, inline Save phase bypass via onSave routing). 143/143 cargo tests including 2 new regression tests. Walk gates final delivery. | P0 | 2026-08-18 | 🔲 Open |
| CSP runtime check under production build | v0.1.0, csp, qa | One `npm run tauri build` run against the production `csp`: verify invoke round-trips (open a project), SFX cues play, fonts render (Silkscreen/JetBrains Mono/IBM Plex, not fallbacks), Barn renders (`pixi.js/unsafe-eval` shim active); watch devtools for `Refused to connect/load` entries; confirm lazy-chunk Suspense fallbacks don't flash on Canvas⇄Barn. Dev-mode behaviour was covered by the acceptance walks (devCsp). | P1 | 2026-08-17 | 🔲 Open |
| Cut v0.1.0 | v0.1.0, release | `tauri.conf.json` is pre-bumped to 0.1.0; the cut is: real sprites landed (see BACKLOG), CSP runtime check green, then a verified production build + tagged release commit. | P1 | 2026-08-18 | 🔲 Open |

## Done — acceptance walks (2026-08-18)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Phase 5 manual acceptance walk | phase-5, acceptance, qa | SETTINGS → PHASE5_JUICE → PHASE5_SOUND manuals walked; acceptance bar met ("a stranger watches a live session for 30 s and smiles"). | P0 | 2026-08-17 | ✅ Done — accepted by Marty 2026-08-18 |
| Phase 3+4 manual acceptance walk | phase-3, phase-4, acceptance, qa | PHASE3/PHASE4 manuals walked in a running app: real assemble (5 briefs), hooks install via confirmation diff, live canvas pulses from a real Claude Code session, Barn demo. | P0 | 2026-08-16 | ✅ Done — accepted by Marty 2026-08-18 |
| Phase 5 manual acceptance walk | phase-5, acceptance, qa | SETTINGS → PHASE5_JUICE → PHASE5_SOUND manuals walked; acceptance bar met ("a stranger watches a live session for 30 s and smiles"). | P0 | 2026-08-17 | ✅ Done — accepted by Marty 2026-08-18 |
| Phase 6 manual acceptance walk | phase-6, acceptance, qa | PHASE6 manual walked: preset apply never-clobber in < 1 minute; `HANDOFF.md` + Chat/Code/Design clipboard variants give Claude Chat full context. | P0 | 2026-08-17 | ✅ Done — accepted by Marty 2026-08-18 |

## Done — history by session

One line per task; detail in git, BUGS.md, and ACTIVITY_LOG.md.

| Session | Name | Tags | Summary | Status |
|---|---|---|---|---|
| 2026-08-18 Agents Suite (v0.0.0011) | Agent/Skill management UI + Named Calves | agents, product | 10 new invoke commands (agents_scan, agent_*/skill_* CRUD, agents_meta_write; 27→37 total), 4 lanes (Rust frontmatter parser, identity+store, UI modal, barn calves), hand-rolled parser with byte-identity round-trip, stable agent identity via fnv1a32 hash, named calves with session-stable appearance, 40 new tests (143/143 after fix round), manual written, 4 audit defects found and ALL fixed pre-landing | ✅ Code done; pending manual acceptance |
| 2026-08-18 UX batch (v0.0.0008) | Ultracode UX quick-win batch | uxbatch, product | 12 in-batch items + 4 new invoke commands (rename_node_file, reveal_path, probe_project_dirs, hooks_status; 23→27 total), 3 lanes (Rust/store/UI), manual written, 3 major defects documented for manual walk | ✅ Code done; pending manual acceptance |
| 2026-08-17 ship-prep (v0.0.0007, `cb770d4`) | Tighten CSP | v0.1.0, security | Production `csp` + relaxed `devCsp` in `tauri.conf.json`; version pre-bumped to 0.1.0 | ✅ Done |
| 2026-08-17 ship-prep | Code-split main JS chunk | v0.1.0, perf | Main chunk 1,334 → 207 kB (React.lazy + manualChunks: pixi/codemirror/xyflow vendor chunks) | ✅ Done |
| 2026-08-17 ship-prep | Add ESLint + `npm run lint` | v0.1.0, lint | ESLint 10 flat config; `no-explicit-any` error; classic react-hooks rules (Compiler preset deferred) | ✅ Done |
| 2026-08-17 ship-prep | Stale-docs cleanup + README positioning | v0.1.0, docs | CLAUDE.md bullets refreshed; README AGENTS.md-standard positioning | ✅ Done |
| 2026-08-17 ship-prep | Adversarial review + 5 fixes | v0.1.0, review | 6 findings, 5 fixed (critical: `pixi.js/unsafe-eval` under strict CSP), 1 rejected; gates re-run green | ✅ Done |
| 2026-08-17 Phase 5+6 fleet (`c241b86`) | Frozen contract PHASE56_CONTRACT.md | phase-5, phase-6, spec | Stage-0 seams, zero-overlap grid, 23-command invoke contract (now in `docs/_archive/contracts/`) | ✅ Done |
| 2026-08-17 Phase 5+6 fleet | Stage 0 — shared seams | seams, rust, frontend | howler install, settings store/rs, sfx stub + call sites, preset/handoff stubs, lib.rs at 23 commands | ✅ Done |
| 2026-08-17 Phase 5+6 fleet | Lane A — SFX layer | phase-5, sfx | Full `sfx.ts`: 14+3 cues, ducking/cooldowns/throttle/voice pool/never-queue, calm/mute/hidden gates + manual | ✅ Done |
| 2026-08-17 Phase 5+6 fleet | Lane B — Settings modal | phase-5, settings | SettingsModal: volume, sound switches, mute, calm, live claude-path override + manual | ✅ Done |
| 2026-08-17 Phase 5+6 fleet | Lane C — SNES juice pass | phase-5, barn | Scarf flutter, anticipation, accumulation, dust, waiting choreography, calm-mode motion, perf guards + manual | ✅ Done |
| 2026-08-17 Phase 5+6 fleet | Lane D — presets & handoff | phase-6 | `preset.rs`/`handoff.rs` never-clobber + full UI with Chat/Code/Design clipboard variants + manual | ✅ Done |
| 2026-08-17 Phase 5+6 fleet | Integration + audit + verification | integration, review | Zero cross-lane defects; 24/24 confirmed findings fixed; gates green (build, clippy, 88/88 tests, 23/23 invoke) | ✅ Done |
| 2026-08-17 Phase 5+6 fleet | Product research pass | research | `Brainstorm_Features.md`: 18 ideas, all triaged into BACKLOG.md (original archived) | ✅ Done |
| 2026-08-16 Phase 3+4 fleet (`4f01275`) | Phase 2 acceptance walk | phase-2, qa | Marty accepted Phase 2; Phase 1 UX folded in | ✅ Done |
| 2026-08-16 Phase 3+4 fleet | assemble.rs — `claude -p` queue | phase-3, rust | FIFO max-2 queue, Runner seam, stdin-piped spawn, root-confined atomic writes, 19 tests | ✅ Done |
| 2026-08-16 Phase 3+4 fleet | hooks.rs + hooks_server.rs | phase-4, rust | Trust-boundary preview/write; axum on :4923 → `BarnEvent` → emit; 18 tests | ✅ Done |
| 2026-08-16 Phase 3+4 fleet | Frontend assemble + events + live feed | phase-3, phase-4, react | events store (ring buffer, resolveNodeId), assemble wrappers, EventLog, HooksModal, live-read pulse | ✅ Done |
| 2026-08-16 Phase 3+4 fleet | Barn prototype (early, authorized) | phase-5, pixi | `src/scene/`: iso scene, cow task queue, event mapper, DemoPlayer, pan/zoom | ✅ Done |
| 2026-08-16 Phase 3+4 fleet | Integration + audit + verification | integration, review | Canvas⇄Barn toggle; 6/6 audit defects fixed (critical Windows spawn); gates green (60/60 tests, 14/14 invoke) | ✅ Done |
| 2026-08-16 Phase 2 build day (`635ebaf`) | Frozen spec + compile.rs + frontend + audit | phase-2 | Adapters, validation, Kahn ordering, CompileModal + LCS diff; 3 audit defects fixed; UI polish (7 fixes); gates green 23/23 | ✅ Done |
