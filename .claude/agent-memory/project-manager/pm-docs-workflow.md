---
name: pm-docs-workflow
description: Two non-obvious constraints on the project-manager doc pass in Cowtext — ACTIVITY_LOG history cannot be trimmed in place, and docs/tasks/* counts must NOT be synced to the live gates.
metadata:
  type: feedback
---

**Do not delete session entries from `docs/fleet/ACTIVITY_LOG.md` to satisfy the
"keep three sessions" duty.** Trim only by moving entries out with `git mv` into
`docs/_archive/`.

**Why:** `docs/_archive/` is write-frozen by the `docs-guard` hook, so archiving
needs Marty to lift the guard; and the project rule is "never delete docs, archive
them". A PM session that enforces the three-session rule by deleting destroys
history that cannot be recovered from the doc. The file's own header records this
as a queued, blocked move. Agent sessions are also told not to run state-changing
git commands, so the move is usually not ours to make.

**How to apply:** add the new entry on top, leave the rest, and keep the debt
visible as a BACKLOG row. Related: the `log-subagent.ps1` SubagentStop hook appends
one worktree-wide row per subagent to the bottom of the same file (~1,900 rows) —
never hand-edit those, and never reformat them.

---

**Do not "fix" the numbers in `docs/tasks/*`.** Work-order rows and the ROADMAP
sprint log carry counts frozen at their landing date, and they are *supposed* to
disagree with the live gates.

**Why:** `npm run truth` (T9) deliberately excludes `docs/tasks/**` from its scanned
set. Those files are history; the record of the project moving is the disagreement.
The live numbers live in exactly one generated place, the truth block in `CLAUDE.md`.
See [[wo15-release-gate-and-open-decisions]].

**How to apply:** when a count in TASKS/ROADMAP/BACKLOG/BUGS looks stale, check
whether the row is describing a past landing. If it is, leave it and make sure the
section header says so.
