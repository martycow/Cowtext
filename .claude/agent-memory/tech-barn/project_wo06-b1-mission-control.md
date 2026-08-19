---
name: wo06-b1-mission-control
description: WO06 lane B1 (barn mission control) — stall/nameplate/budget-gauge build, dispatched before lane U3 landed; the forward-compat pattern used and why
metadata:
  type: project
---

WO06 (`docs/design/WO06_CONTRACT.md`) lane B1 asked for per-session "stalls"
in the barn: a floor marker + always-visible nameplate + budget gauge on
each live `AgentHerd` sprite, dark when the session's token spend hits its
ceiling. Built entirely inside `src/scene/` (`props.ts`: `makeStallMarker`,
`makeStallPlacard`/`BudgetStripState`; `agentHerd.ts`: `AgentSpriteInput`
gains optional `tokensUsed`/`tokenCeiling`, `budgetStateFor` mirrors
`RegistryCore::charge`'s `spent >= ceiling` Stop threshold so "dark" needs
no separate stopped flag; `BarnScene.tsx`'s adapter). Also closed the
long-flagged [[wo03-role-schema-v3-props]] known issue: `ROLE_ACCENT` in
`palette.ts` now has real `invariant`/`trap` entries (reused the otherwise-
dead `iris`/`orchid` book-spine hues rather than adding a 30th Barnlight
colour — the palette is a closed 29-colour set, confirmed by counting keys).

**Sequencing note, generalizes [[wo01-block-f-sequencing]]:** B1 was
dispatched while only WO06 Stage-0 had landed (confirmed via `git status` —
`src/store/sessions.ts` still had the pre-WO06 `Session` shape, no
`tokensUsed`/`tokenCeiling`). Unlike the Block F case (module didn't exist
at all), here the module existed but lacked fields I needed. Used a
different, more precise technique than "declare a local stub type": in
`BarnScene.tsx`, `type SessionWithBudget = Session & { tokensUsed?: number;
tokenCeiling?: number | null }` plus `const b: SessionWithBudget = s;` (no
cast needed — a value assignable to `Session` is automatically assignable to
`Session & {optional extra fields}`, since optional properties don't need to
be present). This compiles cleanly against TODAY's store and starts reading
real values with **zero further edits** the instant lane U3 adds those exact
field names to `Session` — only worth doing when the wire shape section of a
frozen contract pins the exact field names (WO06_CONTRACT §8 did: `+2
appended: tokensUsed: number, tokenCeiling: number | null` on `SessionInfo`,
and `Session` almost certainly mirrors it 1:1 like every other field).

**How to apply:** when dispatched into a lane whose dependency hasn't landed
yet but the *wire shape* is frozen and named in the contract, prefer the
`Type & {optionalNewFields}` intersection-view pattern over inventing a
parallel type — it self-activates with no follow-up patch once the real
lane lands, and it fails loudly (TS error) rather than silently if the
contract's field names turn out wrong. Reserve the "declare a fully local
structural type" pattern (see [[wo01-block-f-sequencing]]) for when the
dependency *module itself* doesn't exist yet, so there's nothing to extend.

Also ran into the Rust gates going red for reasons entirely outside my zone:
`cargo clippy`/`cargo test` in `src-tauri/` failed on `sessions.rs` +
`sessions/tests.rs` (lane G3's WIP `build_boot_prompt`/`agent_session_spawn`
signature changes, mid-flight, uncommitted). Confirmed via `git diff --stat
-- src-tauri/` that I hadn't touched any Rust file, then reported the exact
error location instead of touching it — this is the "must-not-fix, must
name the file" instruction working as intended, not a blocker for my own
lane's TS gates (which were clean).
