---
name: wo15-release-gate-and-open-decisions
description: After WO15 (2026-08-22) the v0.1.0 cut is gated by three things only, and seven product decisions plus the P1 start are waiting on Marty.
metadata:
  type: project
---

WO15 closed 2026-08-22 with all gates green and **uncommitted** (worktree left dirty
for Marty's review). Two things it changed about how the project records itself:

1. **`docs/tasks/ROADMAP.md` §Release gate is the single source of release-gate
   truth.** The v0.1.0 cut needs exactly three: the golden-path walk
   (`docs/testing/GOLDEN_PATH_MANUAL.md`, 38 scenarios, never walked yet), the eight
   outstanding per-work-order acceptance walks, and `npm run truth` green with T6
   (the cargo counts — so a full run, not `--no-cargo`). Real sprites are **not** a
   release gate; that was dissolved 2026-08-19.
2. **Counts live only in the generated truth block in `CLAUDE.md`.** T13 fails the
   gate if any count reappears in the Status prose. See [[pm-docs-workflow]].

**Waiting on Marty (do not decide these for him):** port 4923 as canon · whether to
delete `.codex/hooks.json` and `.codex/agents/*.toml` (kept, marked unsupported/
dev-only) · review of the non-Anthropic model ids in `src/resources/models.json` ·
UI scale deliberately excluding canvas node cards · task status labels-only on disk ·
built-in-skill placement after materialisation · `git_init` leaving the folder
untouched when git has no identity.

**P1 must not start without Marty's confirmation** (accessibility, frontend
interaction tests, state-sync audit, invoke reachability, docs compression, no-op
test replacement). The blocks are filed in `docs/tasks/BACKLOG.md` tagged `p1`; a new
testing library needs permission before install.

**Why:** the plan says stop at the P0 checkpoint and report. Starting P1 work — or
quietly resolving one of the seven above inside a work order — spends Marty's
decisions for him.

**How to apply:** when a future session proposes work that touches any of these,
say it is checkpoint-blocked and point at the BACKLOG row rather than scoping it in.
Verify the list against ROADMAP §Release gate before relying on it — items come off
as Marty answers them.
