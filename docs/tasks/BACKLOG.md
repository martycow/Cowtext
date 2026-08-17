# Backlog

Known work not scheduled into the current sprint. Sources: `CLAUDE.md` hard rules & scaffold constraints, `COWTEXT_VIBECODE_PLAN.md`, build-day verification notes. Pull items into TASKS.md when a sprint picks them up.

Priority scale: P0 blocker · P1 high · P2 medium · P3 low.

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Tighten CSP before shipping | security, tauri, config | `tauri.conf.json` has `csp: null` (scaffold default). Define a real Content-Security-Policy before any distributable build. Flagged in CLAUDE.md scaffold constraints. | P1 | 2026-08-16 | 🔲 Backlog |
| Add ESLint + `npm run lint` script | tooling, dx, lint | The plan's `npm run lint` does not exist; `tsc` is the only frontend check. Add ESLint (config aligned with strict TS, no-`any`) and wire the script. Requires approval — stack additions are gated by the hard rules. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 3 Assemble prep | phase-3, assemble, rust | Delivered in the 2026-08-16 fleet session (see TASKS.md — assemble.rs queue + commands). | P1 | 2026-08-16 | ✅ Done — pulled into Sprint 3 |
| Code-split main JS chunk | frontend, perf, build | Main chunk now 1.25 MB (pixi + reactflow + codemirror in one bundle). Split the Barn scene (dynamic import) at Phase 5; also CodeMirror / compile modal. | P2 | 2026-08-16 | 🔲 Backlog |
| Remove `greet` placeholder command | cleanup, rust, scaffold | `create-tauri-app` demo `greet` command in `lib.rs` is placeholder code per CLAUDE.md — replace/remove rather than build around, if any remnant is still registered. | P3 | 2026-08-16 | 🔲 Backlog |
| Verify React 19 vs plan-era integration notes | frontend, react, risk | Plan §2 assumed React 18; scaffold shipped React 19.1. Check React Flow and (later) PixiJS integration guidance against 19 before Phase 5 work leans on plan-era assumptions. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 4 hooks pipeline prep | phase-4, hooks, rust | Delivered in the 2026-08-16 fleet session (see TASKS.md — hooks.rs, hooks_server.rs, EventLog, node pulse). | P2 | 2026-08-16 | ✅ Done — pulled into Sprint 3 |
| Replace placeholder sprites with Aseprite originals | phase-5, art, assets | Phase 5 starts with CC0 packs (Kenney isometric + itch.io farm packs); replace with original 16-bit assets per docs/design/ART_DIRECTION.md. Sprites are assets, not code — never base64 into source. | P3 | 2026-08-16 | 🔲 Backlog |
| Mute + calm mode from day one of the Barn | phase-5, a11y, sound | Delivered in the 2026-08-17 fleet session (see TASKS.md — Mute + Calm mode in SettingsModal, calm/mute gates in sfx.ts, calm-mode reduced motion in the scene). | P2 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
| Digest Claude Design prototype into docs/design | design, docs | The Claude Design prototype (source of UI truth) has not yet been digested into `docs/design/`. Extract remaining tokens/idioms so future UI work doesn't drift. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 6 presets & handoff | phase-6, presets, handoff | Delivered in the 2026-08-17 fleet session (see TASKS.md — preset.rs/handoff.rs, never-clobber apply, `HANDOFF.md` + Chat/Code/Design clipboard variants). | P3 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
| graph.json schema migration discipline | data-model, persistence | Standing rule, tracked so it survives context loss: any schema change to `graph.json` bumps `version` and adds a migration in the v1 harness (`src/store/graph.ts`). | P2 | 2026-08-16 | 🔲 Backlog |

## Pulled from Product Analyst ranking (docs/FEATURES.md, research pass 2026-08-16)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Streaming assemble output into the node | phase-3, assemble, ux, product | 2026 UX bar: stream token output into the node during Assemble (cuts perceived wait 55–70%); buffer incomplete markdown (half-open fences); explicit queued→running→diffing→done states. Current per-node Stop/Cancel + states landed; streaming did not. A spinner-only Assemble reads as broken. | P1 | 2026-08-16 | 🔲 Backlog |
| Surface token-cost counts during Assemble/Compile | product, tokens, compile, assemble | Token-cost display is now table stakes (ai-context-kit lints token cost across CLAUDE.md/AGENTS.md/.cursor/rules). Surface FEATURES 3.6 counts in the Compile modal and Assemble flow. | P1 | 2026-08-16 | 🔲 Backlog |
| Resolved-context preview (FEATURES 4.6) | product, moat, compile | Moat feature per competitor scan — no competitor pairs a visual graph editor with compile + live hooks; 4.6 preview of what an agent actually receives is a differentiator. | P1 | 2026-08-16 | 🔲 Backlog |
| Unmapped-read → one-click adopt (FEATURES 6.7) | phase-4, product, feed | Turn "not on graph" event rows into a one-click adopt action — makes the live feed an acquisition loop no competitor has. | P1 | 2026-08-16 | 🔲 Backlog |
| Node usage heatmap (FEATURES 6.9) | product, moat, feed | Aggregate live-feed events into per-node usage heat — second moat item from the competitor scan. | P2 | 2026-08-16 | 🔲 Backlog |
| Event feed hygiene: retention + layered status | phase-4, feed, perf | Standard feed anatomy: timestamp + icon + description + metadata per row; retention cap / virtualized list (200-ring landed — virtualize if cap rises); layered status (ambient badge → glanceable panel → interrupting alert). | P2 | 2026-08-16 | 🔲 Backlog |
| AGENTS.md positioning note in docs | docs, positioning | AGENTS.md is now the 30+-agent industry standard — add a positioning note to docs (README/marketing), not code. | P3 | 2026-08-16 | 🔲 Backlog |

## Deferred UX debt (integration pass 2026-08-16)

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Filter demo events out of the live ring buffer | phase-4, feed, ux | Delivered in the 2026-08-17 fleet session (see TASKS.md — `LogEvent.demo` tag, demo-event filtering + DEMO badge; audit also fixed demo-stop stale-event replay and demo accumulation persistence). | P2 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
| Barn HUD restyle to tokens | phase-5, barn, design | Delivered in the 2026-08-17 fleet session (see TASKS.md — HUD restyled to tokens in the Lane C juice pass). | P3 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
| Idle-throttle the BarnScene ticker | phase-5, barn, perf, battery | Delivered in the 2026-08-17 fleet session (see TASKS.md — pause-when-hidden + idle FPS throttle in the Lane C juice pass). | P2 | 2026-08-16 | ✅ Done — pulled into Sprint 4 |
