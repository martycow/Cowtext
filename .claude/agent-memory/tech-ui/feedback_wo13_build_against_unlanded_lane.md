---
name: wo13-build-against-unlanded-lane
description: When a contract names a specific cross-lane file/signature (e.g. T1's resolveLoad.ts, R2's extended lint types) that doesn't exist yet mid-session, write the import against the FROZEN contract shape and proceed — don't stop and wait.
metadata:
  type: feedback
---

During WO13 (large multi-lane work order, `docs/design/WO13_CONTRACT.md`),
dispatched as lane U4 while T1 (`src/config/`) and R2 (extended
`src/lint/types.ts`) had not landed yet — `src/config/` didn't exist on disk
at the start of the session. The contract explicitly says the tree is "RED
until integration — eight other lanes are mid-flight" and names the exact
frozen signatures (`resolveLoad(nodeId, graph): LoadResult`, the `Severity`
union gaining `"info"`, `LintItem.fix`) each lane must build against.

**What worked:** import from the path the contract names
(`../config/resolveLoad`) as if it already existed, write code against the
FROZEN type shapes quoted in the contract, and keep going. T1 actually landed
partway through this same session (visible as new files appearing under
`src/config/` between two `tsc` runs) and the import resolved with zero
rework. For the still-unlanded R2 extension (`Severity`'s third member,
new `LintCode`s), wrote code generically enough to type-check against
BOTH the old 2-member union and the eventual 3-member one (derive filter
options from `Set(items.map(i => i.severity))` at runtime rather than
hardcoding a literal `"info"` that doesn't exist in the type yet, and rank
severities via an unbounded `Record<string, number>` lookup) — zero rework
needed either way.

**Why:** stopping to wait for another lane wastes the whole dispatch (each
lane is a separate agent invocation with no way to block-and-resume), and
the contract's own ordering diagram says integration is where it all comes
together, not before.

**How to apply:** when a contract names a specific not-yet-landed file and
gives its exact exported signature, write the import and use it as spec'd.
Run `tsc --noEmit` scoped to YOUR OWN files (`grep -E "^src/(your/zone/globs)"`
on the tsc output) rather than the whole repo — a red whole-repo build is
expected and uninformative mid-flight; a red file inside your own zone is
the only signal that matters. Re-run the scoped check periodically since
other lanes land concurrently and errors legitimately disappear out from
under you. Flag the still-unlanded dependency plainly in the final report
rather than silently declaring victory.

**Lint, same rule (added WO15 U4b).** `npx eslint <your 11 files>` (exit 0,
no output) is the only lint claim you can honestly make mid-round; the
repo-wide `npm run lint` summary drifts between two invocations in the same
minute because other lanes are saving files as you read it. Corollary: a
contract acceptance line phrased as an absolute count ("lint reports ≤ 14
warnings") is **not testable by your lane** — WO15 U4b removed both of its
assigned warnings and the repo total stayed at 16 because two other lanes
had each added one meanwhile. Report the substantive fact (my two are gone,
zero problems in my files) plus the raw total with attribution, and say
plainly that the count criterion belongs to the tester after integration.
