---
name: feedback-wo11-temp-stub-verification
description: technique for verifying a file that calls into another lane's not-yet-built API - write temp stubs matching the frozen contract, tsc --noEmit, delete stubs, never commit
metadata:
  type: feedback
---

When a dispatch says "calls into lane X's not-yet-existing API is the one
permitted build failure" (WO11 lane grid, and likely future multi-lane
work), don't just eyeball the code against the frozen signatures and hope —
write throwaway stub files matching the contract's exact exported
names/shapes in the foreign lane's file paths, run `npx tsc --noEmit -p .`,
confirm your own file produces zero errors against the real shape, then
`rm` the stubs immediately (never git-add, never leave them — they are not
yours to write). This caught nothing wrong in WO11 (GitWizard.tsx was
already correct against R1's §4.1 types), but it converts "I read the
contract carefully" into an actual compiler-verified claim, which is a much
stronger thing to put in a report than "should be fine."

**Why:** the alternative — leaving the untested import and reporting
"matches contract by inspection" — can't catch a typo'd export name, a
subtly wrong field type, or a Promise vs. sync mismatch, all of which would
otherwise surface only at integration when it's a different agent/session
debugging it.

**How to apply:** any time a WO-style dispatch has a frozen cross-lane
signature (§4-style command contracts, frozen prop shapes) that a sibling
lane hasn't landed yet, do this stub-verify-delete cycle before reporting a
gate result. Also worth noting: transient tsc errors in *other* lanes'
in-progress files are real — a parallel agent editing
`src/inspector/sectionOrder.tsx` produced a genuinely broken intermediate
`.ts`-vs-`.tsx` resolution error that vanished on the next run. If a build
error names a file outside your zone and disappears on re-run, it was a
concurrent-write race, not something to fix or report as yours.
