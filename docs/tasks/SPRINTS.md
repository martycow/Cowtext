# Sprints

Sprints map 1:1 to plan §9 phases — a sprint is "the evenings it takes to land a phase plus its acceptance walk". Estimates from the plan assume vibe-coding evenings (~2–3 h).

## Current sprint — Sprint 2: Compile (Phase 2)

- **Goal:** one graph → `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/*.mdc` with validation and diff-preview approval; never write without approval.
- **Started:** 2026-08-16 · **Plan estimate:** 1–2 evenings
- **Exit criteria:** Phase 2 acceptance passes — compiled `CLAUDE.md` works in a real Claude Code session; `AGENTS.md` readable by Codex.
- **Sprint status:** 🟡 Code complete (v0.0.0003 landed), acceptance walk pending.

| Name | Tags | Description | Priority | Date Created | Status |
|---|---|---|---|---|---|
| Frozen implementation spec | spec | Contract for two parallel coders; §3 IPC surface frozen | P0 | 2026-08-16 | ✅ Done |
| Rust compile.rs + adapters + tests | rust | Full detail in TASKS.md | P0 | 2026-08-16 | ✅ Done |
| Audit + 3 fixes | rust, review | Full detail in TASKS.md / BUGS.md | P1 | 2026-08-16 | ✅ Done |
| Frontend compile module + modal | frontend | Full detail in TASKS.md | P0 | 2026-08-16 | ✅ Done |
| UI polish (7 fixes incl. rescan bug) | frontend, design | Full detail in TASKS.md / BUGS.md | P1 | 2026-08-16 | ✅ Done |
| Verification pass | verify | tsc / clippy / 23 tests / contract — all green | P1 | 2026-08-16 | ✅ Done |
| Phase 2 manual acceptance walk | qa | The sprint's only open item — see TASKS.md | P0 | 2026-08-16 | 🔲 Open |

## Past sprints

| Sprint | Phase | Window | Outcome |
|---|---|---|---|
| Sprint 0: Skeleton | Phase 0 | pre-2026-08-15 | ✅ Closed — dark shell, open folder, `.md` scan; accepted |
| Sprint 1: Graph canvas | Phase 1 | closed 2026-08-15 | ✅ Closed — canvas, inspector, persistence, adopt-.md; automated checks green (in-window UX verification folded into the Sprint 2 acceptance walk) |

## Next sprint (planned)

**Sprint 3: Assemble (Phase 3)** — `claude -p` child-process queue, per-node Assemble/Refine/Summarize, node progress states. Starts after Sprint 2's acceptance walk closes Phase 2. Prep task in BACKLOG.md.
