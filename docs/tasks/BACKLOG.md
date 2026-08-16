# Backlog

Known work not scheduled into the current sprint. Sources: `CLAUDE.md` hard rules & scaffold constraints, `COWTEXT_VIBECODE_PLAN.md`, build-day verification notes. Pull items into TASKS.md when a sprint picks them up.

Priority scale: P0 blocker · P1 high · P2 medium · P3 low.

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Tighten CSP before shipping | security, tauri, config | `tauri.conf.json` has `csp: null` (scaffold default). Define a real Content-Security-Policy before any distributable build. Flagged in CLAUDE.md scaffold constraints. | P1 | 2026-08-16 | 🔲 Backlog |
| Add ESLint + `npm run lint` script | tooling, dx, lint | The plan's `npm run lint` does not exist; `tsc` is the only frontend check. Add ESLint (config aligned with strict TS, no-`any`) and wire the script. Requires approval — stack additions are gated by the hard rules. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 3 Assemble prep | phase-3, assemble, rust | Design the `claude -p` child-process queue (max 2 concurrent, `--output-format json`), per-node Assemble/Refine/Summarize commands, prompt template (project name, role, brief, 1-hop neighbor titles+briefs, ≤ 60 lines), and node progress states. Plan §6. | P1 | 2026-08-16 | 🔲 Backlog |
| Code-split main JS chunk | frontend, perf, build | Vite warns the main chunk is 944.52 kB (> 500 kB). Split CodeMirror / React Flow / compile modal via dynamic import when it starts hurting startup. Non-blocking today. | P3 | 2026-08-16 | 🔲 Backlog |
| Remove `greet` placeholder command | cleanup, rust, scaffold | `create-tauri-app` demo `greet` command in `lib.rs` is placeholder code per CLAUDE.md — replace/remove rather than build around, if any remnant is still registered. | P3 | 2026-08-16 | 🔲 Backlog |
| Verify React 19 vs plan-era integration notes | frontend, react, risk | Plan §2 assumed React 18; scaffold shipped React 19.1. Check React Flow and (later) PixiJS integration guidance against 19 before Phase 5 work leans on plan-era assumptions. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 4 hooks pipeline prep | phase-4, hooks, rust | `hooks_server.rs` (axum on :4923, POST /event), hook-writer with confirmation diff into user project `.claude/settings.json` (trust boundary — always show diff), `BarnEvent` normalization, `barn://event` emit, event log panel, canvas node pulse. Plan §7. | P2 | 2026-08-16 | 🔲 Backlog |
| Replace placeholder sprites with Aseprite originals | phase-5, art, assets | Phase 5 starts with CC0 packs (Kenney isometric + itch.io farm packs); replace with original 16-bit assets per docs/design/ART_DIRECTION.md. Sprites are assets, not code — never base64 into source. | P3 | 2026-08-16 | 🔲 Backlog |
| Mute + calm mode from day one of the Barn | phase-5, a11y, sound | Plan §8 rule: mute button and calm mode (no sound, reduced motion) must exist from the first Barn build, not be retrofitted. Track so it lands inside Phase 5, not after. | P2 | 2026-08-16 | 🔲 Backlog |
| Digest Claude Design prototype into docs/design | design, docs | The Claude Design prototype (source of UI truth) has not yet been digested into `docs/design/`. Extract remaining tokens/idioms so future UI work doesn't drift. | P2 | 2026-08-16 | 🔲 Backlog |
| Phase 6 presets & handoff | phase-6, presets, handoff | Graph-as-preset (structure + briefs, no content), "New project from preset" file stubbing, Handoff button filling a template from graph + recent event log → `HANDOFF.md` + clipboard variants. Plan §9 P6. | P3 | 2026-08-16 | 🔲 Backlog |
| graph.json schema migration discipline | data-model, persistence | Standing rule, tracked so it survives context loss: any schema change to `graph.json` bumps `version` and adds a migration in the v1 harness (`src/store/graph.ts`). | P2 | 2026-08-16 | 🔲 Backlog |
