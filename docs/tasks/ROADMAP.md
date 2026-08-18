# Cowtext Roadmap

Source of truth for phase order: `COWTEXT_VIBECODE_PLAN.md` §9. **All seven phases
(0–6) are code-complete and accepted** — the phased build is finished. This roadmap
now tracks the road to the first public cut, **v0.1.0**.

## App version

**Current: v0.0.0007** (as of 2026-08-18) · **Next: v0.1.0** — the first
public-shippable cut.

Scheme `v0.0.NNNN`: the last field increments once per landing (code complete and
verified by automated checks); manual acceptance gates *closing* a phase, not the
bump. The v0.0.0004 shared bump (Phases 3+4 landed in one session) remains a
documented one-off, not the norm.

| Version | Landed | What it covers |
|---|---|---|
| v0.0.0001 | Phase 0 | Tauri 2 skeleton, dark shell, open folder, `.md` scan |
| v0.0.0002 | Phase 1 | Graph canvas, inspector, `.cowtext/graph.json` persistence |
| v0.0.0003 | Phase 2 | Compile: `compile.rs` adapters, diff-preview modal, cycle validation |
| v0.0.0004 | Phases 3+4 (+ Barn prototype) | Assemble: `claude -p` queue, per-node Assemble/Refine/Summarize. Live feed: axum hooks server on :4923, `barn://event` pipeline, event log, canvas pulse, hooks confirmation diff. Early Barn prototype (Pixi 8, demo mode, Canvas⇄Barn toggle) |
| v0.0.0005 | Phase 5 | The Barn completed: full SFX layer (`sfx.ts`, 14+3 cues, ducking/cooldowns/gates), Settings modal, SNES juice pass, calm mode + mute, pause-when-hidden, demo filtering |
| v0.0.0006 | Phase 6 | Presets & Handoff: `preset.rs`/`handoff.rs` (never-clobber, GENERATED header), preset & handoff UI, Chat/Code/Design clipboard variants |
| v0.0.0007 | v0.1.0 ship-prep (`cb770d4`) | Production CSP + relaxed devCsp (`tauri.conf.json` version pre-bumped to 0.1.0), code-split (main chunk 1,334 → 207 kB), ESLint 10 flat config + `npm run lint`, `pixi.js/unsafe-eval` CSP fix |

## Phases & milestones — all closed

Each milestone is the phase's gate: "acceptance criteria pass in a running app".
Phases 0–2 were accepted incrementally; the Phase 3–6 acceptance walks all passed
2026-08-18, closing M3–M6 together.

| Phase | Milestone | Scope | Acceptance gate | Version | Status |
|---|---|---|---|---|---|
| 0 — Skeleton | M0 — Skeleton works | Tauri 2 + React + Vite scaffold; open folder → `.md` scan; dark Tailwind shell | Pick a real repo, see its `.md` files listed; cold start < 2 s | v0.0.0001 | ✅ Accepted |
| 1 — Graph canvas | M1 — Graph persists | React Flow canvas, edge kind picker, inspector (CodeMirror 6 + form), `.cowtext/graph.json`, adopt `.md` | 6-node graph survives restart; inspector edit changes the file on disk | v0.0.0002 | ✅ Accepted 2026-08-16 (folded into the Phase 2 walk) |
| 2 — Compile | M2 — Compile trusted | Adapters (§5), diff-preview modal, GENERATED headers, cycle validation | Compiled `CLAUDE.md` works in a real Claude Code session; `AGENTS.md` readable by Codex; nothing written without approval | v0.0.0003 | ✅ Accepted 2026-08-16 |
| 3 — Assemble | M3 — Assemble writes files | `claude -p` queue (max 2), per-node Assemble/Refine/Summarize, progress states | 5 briefs → 5 sensible `.md` files without touching a text editor | v0.0.0004 | ✅ Accepted 2026-08-18 |
| 4 — Live feed | M4 — Live pipeline proven | Hooks writer with confirmation diff; axum on :4923; event log; canvas pulse | Run Claude Code in a terminal, watch nodes light up in real time | v0.0.0004 | ✅ Accepted 2026-08-18 |
| 5 — The Barn | M5 — The Barn delights | Pixi scene per §8, SFX, settings, juice pass, calm mode + mute (placeholder sprites) | A stranger watches a live session for 30 seconds and smiles | v0.0.0005 | ✅ Accepted 2026-08-18 |
| 6 — Presets & Handoff | M6 — Presets & Handoff | Presets (structure + briefs, never-clobber), `HANDOFF.md` + clipboard variants | New project from preset in < 1 minute; pasted handoff gives Claude Chat full context | v0.0.0006 | ✅ Accepted 2026-08-18 |

## Toward v0.1.0

Remaining before the cut (everything else is done):

1. **Real sprites** — Aseprite originals per `docs/design/ART_DIRECTION.md`,
   replacing the placeholder Graphics. Assets, Marty-side (tracked in BACKLOG.md).
2. **CSP runtime check under a production build** — one `npm run tauri build` pass:
   invoke round-trip, SFX cues, fonts, Barn render, no CSP refusals in the console
   (tracked in TASKS.md).
3. **Cut v0.1.0** — `tauri.conf.json` is already pre-bumped to 0.1.0; the cut is a
   verified production build + tagged commit.

Post-v0.1.0 direction lives in BACKLOG.md (quick wins / moat bets / platform bets
and the `7+` rows of the Feature inventory).

## Sprint log — all closed

Sprints mapped 1:1 to plan §9 phases ("the evenings it takes to land a phase plus
its acceptance walk"). Per-task detail for every sprint lives in TASKS.md and
`docs/fleet/ACTIVITY_LOG.md`.

| Sprint | Phases | Window | Outcome |
|---|---|---|---|
| Sprint 0: Skeleton | 0 | pre-2026-08-15 | ✅ Closed — dark shell, open folder, `.md` scan |
| Sprint 1: Graph canvas | 1 | closed 2026-08-15 | ✅ Closed — canvas, inspector, persistence, adopt-.md (UX verification folded into the Sprint 2 walk) |
| Sprint 2: Compile | 2 | closed 2026-08-16 | ✅ Closed — adapters, diff-preview modal, validation; accepted 2026-08-16 |
| Sprint 3: Assemble + Live feed | 3+4 (+ early Barn prototype) | code 2026-08-16, walk 2026-08-18 | ✅ Closed — assemble queue, hooks pipeline, EventLog/HooksModal, Barn prototype; audit fixed 6/6 defects incl. the critical Windows spawn |
| Sprint 4: The Barn + Presets & Handoff | 5+6 | code 2026-08-17 (`c241b86`), walks 2026-08-18 | ✅ Closed — 4 zero-overlap lanes under the frozen contract, zero cross-lane defects; 24/24 audit findings fixed; SFX + settings + juice + presets/handoff |
