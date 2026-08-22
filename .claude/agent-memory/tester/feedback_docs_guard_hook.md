---
name: feedback-docs-guard-hook
description: The docs-guard hook allow-lists .claude/agent-memory/ for Write/Edit but blocks any Bash command whose .md path it cannot resolve (shell variables, relative paths) — use Write/Edit with absolute paths for memory files
metadata:
  type: feedback
---

For `.md` files under `.claude/agent-memory/**`, use the Write/Edit tools with the full
absolute path. Do NOT route the write through Bash (heredoc, `>>`, sed): the guard inspects the
command text, and a path it cannot match to its allow-list (e.g. `$M/MEMORY.md`, a relative
path) is denied with "Do not route this write through Bash to avoid the guard".

**Why:** `.claude/scripts/docs-guard.ps1` line 59 allow-lists
`^\.claude/(agents|skills|agent-memory|commands|scripts)/` — so a direct Write/Edit on the
absolute memory path passes. The earlier note here ("Write is blocked, use Bash") was observed
on an older version of the guard; on 2026-08-22 the Bash route was the one blocked
(variable-hidden path) and Write/Edit succeeded.

**How to apply:** memory file creation → Write with `D:\Moo.exe\Cowtext\.claude\agent-memory\tester\<name>.md`;
index update → Edit on `...\MEMORY.md`. If a Write is ever denied again, quote the guard message
in the report rather than working around it.
