---
name: wo03-role-schema-v3-props
description: NodeRole prop-mapping history in sceneGraph.ts (v3 13-role, then v5 14-role WO13) — grouping rationale and the palette.ts/props.ts boundary that shaped it
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

**UPDATE (WO06 B1, see [[wo06-b1-mission-control]]):** the specific
`invariant`/`trap`-look-like-`rules` gap is closed — `ROLE_ACCENT` now has
real entries for both (reused the dead `iris`/`orchid` keys). The broader
"6 roles, 3 undifferentiated shapes" debt (architecture/reference/glossary/
skill/style all render as the same bookshelf; task/workflow/command/snippet
all render as the same crate) is still open — `makeBookshelf`/`makeCrate`
still take no role param at all.

**UPDATE (WO13 B1, role set 13→14, `rules`→`rule`/`snippet`→`example`/
`task`→`workflow`/`reference` gone, `decision`/`env`/`tool` new — contract
`docs/design/WO13_CONTRACT.md` §14.6 froze the mapping, no judgement call
needed):**

- **cabinet**: `rule`, `invariant`, `trap`, `agent` (unchanged from v3 modulo rename)
- **bookshelf**: `architecture`, `decision`, `glossary`, `skill`, `style`, `example`, `tool`
- **crate**: `workflow`, `command`, `env`

`readCueForRole` in `sfx.ts` was converted from a ternary chain to an
exhaustive switch mirroring this exact grouping (drawer_slide/page_flip/
paper_shuffle), so a future role addition fails the sfx.ts build too, not
just sceneGraph.ts's. See [[project_wo13-sfx-scope-contradiction]] for why
`sfx.ts` was in scope at all despite §16 listing it write-forbidden.

**Load-bearing trap found this round, keep watching for it:** `ROLE_ACCENT`
(`palette.ts`) has two independent, differently-versioned consumers —
`props.ts`'s `makeCabinet` reads current `NodeRole` (v5 now), but
`calf.ts`'s `makeCalf` reads `identity.ts`'s **frozen, deliberately
un-synced** 7-member `Role` list, which still says `rules`/`architecture`/
`workflow`/`task`/`reference`/`glossary` — the pre-WO13 vocabulary,
permanently. `identity.ts` is write-forbidden specifically so calf/avatar
looks never rotate; that ban is transitive to any shared table it reads
through, even in a file you do own. **Do not delete or rename dead-looking
`ROLE_ACCENT` keys that match a role name only `identity.ts` still uses** —
check `identity.ts`'s `ACCENT_ROLES` list before removing anything from
`ROLE_ACCENT`, even entries that look orphaned from `props.ts`'s side.
