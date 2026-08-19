---
name: wo03-role-schema-v3-props
description: NodeRole v3 (13 roles) prop mapping in sceneGraph.ts — grouping rationale and the palette.ts/props.ts boundary that shaped it
metadata:
  type: project
---

WO03 Lane A bumped `NodeRole` from 7 to 13 roles (added `command`,
`invariant`, `trap`, `skill`, `snippet`, `style`). `propForRole` in
`src/scene/sceneGraph.ts` maps all 13 onto the 3 existing `PropView` shapes
(`makeCabinet`, `makeBookshelf`, `makeCrate` — see `src/scene/props.ts`):

- **cabinet** (governance/guardrail): `rules`, `agent`, `invariant`, `trap`
- **bookshelf** (browsable reference): `architecture`, `reference`,
  `glossary`, `skill`, `style`
- **crate** (active/work items): `task`, `workflow`, `command`, `snippet`

**Why:** the micro-lane's file zone was `sceneGraph.ts` only — `props.ts`
(sprite drawing) and `palette.ts` (`ROLE_ACCENT` colour map) were explicitly
off-limits. `makeCabinet(role)` is the only maker that varies its look via
`ROLE_ACCENT[role]`; `makeBookshelf`/`makeCrate` take no role param at all
(already-tied groups pre-v3: architecture/reference/glossary all render
identically, as do task/workflow). Since `ROLE_ACCENT` only has entries for
the original 7 roles, any new role routed to `makeCabinet` silently falls
back to the same straw accent as `rules` — so `invariant`/`trap` are
currently visually identical to `rules` (and to each other). This was an
accepted tradeoff, not an oversight — the task brief itself suggested
`invariant` reusing the rules cabinet.

**How to apply:** if a future lane touches `props.ts`/`palette.ts` and adds
real per-role accent colours or new prop shapes for the v3 roles, revisit
`propForRole` — the grouping above is a placeholder-graphics compromise, not
a final design intent. Six roles sharing 3 undifferentiated shapes is a
known readability debt, flagged for a follow-up art pass rather than solved
here. See [[feedback_eslint-unused-params]] for the general "flag, don't
silently absorb, cross-lane constraints" pattern this lane follows.
