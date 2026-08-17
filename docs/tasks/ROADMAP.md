# Cowtext Roadmap

Source of truth for phase order: `COWTEXT_VIBECODE_PLAN.md` §9. Phases build in this exact order; a phase closes only when its acceptance criteria pass in a running app.

## App version

**Current version: v0.0.0004** (as of 2026-08-16)

Versioning scheme: `v0.0.NNNN`, starting from the project default **v0.0.0001**. The last field increments once per phase landed (code complete and verified by automated checks), independent of manual acceptance. Manual acceptance gates *closing* a phase, not the version bump.

| Version | Landed | What it covers |
|---|---|---|
| v0.0.0001 | Phase 0 | Tauri 2 skeleton, dark shell, open folder, `.md` scan |
| v0.0.0002 | Phase 1 | Graph canvas, inspector, `.cowtext/graph.json` persistence |
| v0.0.0003 | Phase 2 | Compile: `compile.rs` adapters, diff-preview modal, cycle validation — landed 2026-08-16; **accepted by Marty 2026-08-16** |
| v0.0.0004 | Phases 3 + 4 (+ Barn prototype) | Assemble: `claude -p` queue (stdin-piped, max 2 concurrent), per-node Assemble/Refine/Summarize with progress states. Live feed: axum hooks server on :4923, `barn://event` pipeline, event log panel, canvas node pulse, hooks-install confirmation diff. Early Barn prototype (`src/scene/`, Pixi 8, placeholder graphics, demo mode, Canvas⇄Barn toggle) by Marty's explicit authorization. **Landed 2026-08-16**; all checks green (tsc strict, clippy `-D warnings`, 60/60 cargo tests, 14-command invoke contract), awaiting manual acceptance |

Rationale for v0.0.0004: Phases 3 and 4 landed together in one fleet session, so they share a single increment (a deliberate deviation from one-bump-per-phase; MILESTONES.md projections shifted accordingly). The version reflects the code landing; the phase gates stay open until the acceptance walk (see TASKS.md).

Reaching Phase 6 complete ≈ v0.0.0006; a first shippable public cut would justify jumping to v0.1.0.

## Phases

| Phase | Name | Scope | Acceptance criteria (plan §9) | Status |
|---|---|---|---|---|
| 0 | Skeleton | Tauri 2 + React + Vite scaffold; "Open project folder" → Rust scans `.md` → flat list; dark Tailwind shell | Pick a real repo, see its `.md` files listed; cold start < 2 s | ✅ Done |
| 1 | Graph canvas | React Flow canvas; create/drag Memory Nodes; edges with `kind` picker; Inspector (CodeMirror 6 + visual form); persistence to `.cowtext/graph.json`; adopt existing `.md` as node | Build a 6-node graph for a real project, restart app, everything restores; edit a file in the inspector, see it change on disk | ✅ Done |
| 2 | Compile | `compile.rs` adapters (§5), diff preview modal, generated-file headers, cycle validation | Compiled `CLAUDE.md` works in a real Claude Code session; `AGENTS.md` readable by Codex | ✅ Done — accepted 2026-08-16 |
| 3 | Assemble | `claude -p` child process queue; per-node Assemble / Refine / Summarize; progress states on nodes | 5 briefs → 5 sensible `.md` files without touching a text editor | 🟡 Built 2026-08-16 — awaiting manual acceptance |
| 4 | Live feed (ugly version) | Hooks writer with confirmation diff; axum server on :4923; event log panel; canvas nodes pulse on read/edit — no Pixi yet | Run Claude Code on the project in a terminal, watch nodes light up in real time | 🟡 Built 2026-08-16 — awaiting manual acceptance |
| 5 | The Barn | PixiJS scene per §8, placeholder sprites → real ones; camera pan/zoom; Canvas ⇄ Barn toggle; SFX; calm mode | A stranger watches a live session for 30 seconds and smiles | 🟠 Prototype started early (Marty's explicit authorization): `src/scene/` Pixi 8, placeholder graphics, demo mode, Canvas⇄Barn toggle. SFX/sprites/calm mode remain |
| 6 | Presets & Handoff | Save graph (structure + briefs) as preset; "New project from preset" stubs files; Handoff button → `HANDOFF.md` + clipboard variants | New project from preset in < 1 minute; pasted handoff gives Claude Chat full context | ⬜ Pending |

## Near-term order of operations

1. Phase 3 + 4 manual acceptance walk (see TASKS.md) — one real assemble in a running window; run Claude Code in a terminal and watch nodes light up.
2. Barn prototype demo walk (Demo button, Canvas⇄Barn toggle) — informal, prototype only.
3. Phase 5 completion prep: sprites, SFX, calm mode (see BACKLOG.md).
