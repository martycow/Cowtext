---
name: wo11-ui-a-wizards
description: WO11 lane UI-A (wizards) — A1-A4 project wizard fixes, F1 NodeWizard hardening, GitWizard built against R1's not-yet-existing API
metadata:
  type: project
---

WO11 lane UI-A shipped 2026-08-20: `src/project/ProjectWizard.tsx`,
`src/project/types.ts`, `src/wizard/NodeWizard.tsx`, `src/git/GitWizard.tsx`
(new). Full contract: `docs/_archive/contracts/WO11_CONTRACT.md`.

**A3 controlled-textarea trap** (generalizable pattern, watch for it
elsewhere): a textarea whose `value` is re-derived from a *cleaned/parsed*
form of its own `onChange` output on every keystroke will silently eat
trailing spaces and newlines the instant a cleaning step (`.trim()`,
`.filter(blank)`) runs in that round-trip. Fix is always the same shape: the
input owns raw text in local state, seeded once from the parsed value and
re-seeded only on an explicit identity change (not on every parent
re-render); the cleaned/committed form is still produced on every keystroke
for the caller, but never fed back into the textarea's own `value`.

**A4 collapsible-but-unpersisted disclosure**: `InspectorSection.tsx`
(`src/inspector/`) is the referenced idiom but is wired to
`AppSettings.collapsedSections` — not reusable as-is inside a wizard whose
collapse state must NOT persist across opens. Built a local `Disclosure`
component matching its visual idiom (chevron, mono uppercase 2xs tracking
header) but backed by plain `useState`, latched open via a ref-guarded effect
so loaded data with values in the collapsed block force it open exactly once
and a later manual collapse is never fought by re-renders.

**F1 (Assemble-after-close) verdict: UNPROVEN, hardened anyway.** Could not
find a throwing expression in `NodeWizard.tsx`'s assemble branch — structure
was already close to the two working siblings (`Inspector.tsx`
`AssembleSection.run`, `MemoryNodeCard.tsx` `runAssemble`). The one real
difference found: NodeWizard's `assembleNode(...).catch(...)` was a
*detached*, un-awaited promise chain (fire-and-forget outside the enclosing
async IIFE), unlike the siblings which `await fn(...)` inside their own
try/catch. Rewrote it to match the siblings exactly (await inside the same
try/catch scope) — removes the only structurally-unsound difference, but I
could not reproduce or name a file:line throw. If Marty still repros F1
after this lands, the bug is very likely Rust-side (`assemble.rs`/`run_job`)
despite Stage 0's mutex-poison hypothesis being refuted by static reading.

**GitWizard built against a not-yet-existing sibling module**: WO11's lane
split has R1 (tech-general) owning `src/git/api.ts`, `src/git/types.ts`,
`src/git/gitignorePresets.ts` while UI-A owns only `GitWizard.tsx` that
imports from them. Verified byte-exact §4.1 signatures by writing temporary
local stub files matching the contract, running `tsc --noEmit`, confirming
zero errors in `GitWizard.tsx` itself, then deleting the stubs (never
committed) — leaves the real build failure as exactly the module-not-found
error, which is the one permitted failure per the dispatch. `gitignorePresets.ts`'s
export shape was *not* specified in the contract (only the five group names
in prose) — guessed `{ key, label, lines }[]` as `GITIGNORE_PRESETS`; flagged
as an assumption R1 must match or this file needs a one-line adjustment at
integration.

**Fix round 1 (tester audit) — J.1 CRLF phantom diff, MAJOR.**
`composeGitignore`'s no-op branch used to return `existingLines.join("\n")`
(re-joined from a CRLF-tolerant split) even when nothing was being added —
silently re-encoding CRLF→LF and, compared against the raw
`status.gitignoreContent` by `diffLines` (whose shared `splitLines` in
`src/ui/diff.ts` only recognizes `\n`, so old-side lines kept a trailing
`\r`), produced a full phantom delete+add of every existing line for a
zero-op review. `src/ui/diff.ts` is outside this lane's zone — the fix had
to live entirely in `GitWizard.tsx`. Resolution, and the general pattern for
any future "diff must match what gets written" bug where the diff renderer
itself can't be touched: make the **no-op case propose the literal untouched
original** (`return existing ?? ""`) so `proposed === existing` byte-for-byte
and trips `diffLines`'s own `oldText === newText` fast-path *before* either
side is ever line-split — never normalize/strip characters purely for
comparison purposes. When a real change genuinely is proposed, let the honest
transformation show (a CRLF file gaining new lines will legitimately show
every old line as changed too, because the write really does normalize the
whole file to LF) and add a distinct explanatory note beside the diff rather
than hiding that inside the line-by-line view. Verified against
`docs/_archive/manuals/WO11_TEST_MANUAL.md` §J.1's exact repro (hand-write a CRLF
`.gitignore`, reopen with nothing ticked → expect "no changes"/Write
disabled) by tracing the code path, not by running the app (no dev server in
this environment).

See also [[feedback_wo11_temp_stub_verification]].
