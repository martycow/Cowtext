---
name: wo15-u3-agents-skills
description: WO15 lane U3 (agents/skills/compile modal) — where the built-in-skill read-only view had to move, where a non-Anthropic model lives (sidecar, A-20), and which store action refreshes skills without eating drafts (A-21)
metadata:
  type: project
---

WO15 U3 built the provider→model picker, agent presets, the Built-in/Project
Skills rail and the CompileModal skill rows. The fix round (2026-08-22) closed
audit F1/F2 and tester #2/#5. What outlives the work:

**`Inspector.tsx` cannot show anything that has no on-disk doc.**
It resolves a skill selection with `skills.find(...)` and returns `null` when
there is none, so a *virtual* built-in (bundled, not on disk) can never reach
`SkillEditor` through it. The read-only view stayed in `SkillEditor.tsx`
(exported as `BuiltinSkillReadOnly`) but is mounted inline from the Skills rail.
**How to apply:** when a contract names a component but the mount lives in a
foreign file, move the mount, not the component, and say so in the report.

**Model has two homes, one per provider — never both.** Anthropic keeps
`model:` in the agent's own frontmatter (D-13); every other provider stores it
in the sidecar as `AgentMeta.model` (A-20, `serializeMeta` emits it only when
`provider` is set and non-anthropic). Both `NewAgentDialog` (Create) and
`AgentEditor` (onChange) write both keys in one `updateMeta`, setting the
unused home to `null`, so the two can never disagree.
**Why:** the earlier "session-local only" state silently dropped the choice
while the badge claimed otherwise — audit F1.

**`loadAgents` is a project-open reset, not a refresh.** It discards drafts,
selection, meta and every autosave timer. Anything that merely wrote a skill
calls `reloadSkills(root)` (A-21) — re-scans and replaces `skills`/`skipped`
only. Both `CompileModal.doWrite` and the rail's Reset use it; `loadAgents`
is left to project open and the Inspector's "Rescan agents" button.
**How to apply:** grep future contracts for the phrase "→ `loadAgents(root)`"
on an already-open project; it is a concurrency instruction, not a refresh.

**Skills rail header counts files, not rows** — virtual built-ins are excluded
and shown as a ` · N built-in` note, because the number is what a `ls
.claude/skills/` would find.

See also [[wo15-controlled-child-state-remount]], [[modal-deferred-writes]].
