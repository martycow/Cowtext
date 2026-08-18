---
name: eslint-unused-params
description: This repo's eslint config has no argsIgnorePattern — underscore-prefixed unused params still error; use `void param;` in the body instead
metadata:
  type: feedback
---

`eslint.config.js` has no `argsIgnorePattern` override for
`@typescript-eslint/no-unused-vars`, so naming an intentionally-unused
function parameter `_dtMs`/`_reduced` (the usual TS convention, which tsc's
own `noUnusedParameters` DOES exempt via leading underscore) still fails
`npm run lint` with `'_dtMs' is defined but never used`.

**Why:** confirmed empirically 2026-08-18 in `src/scene/agentHerd.ts`:
`AgentHerd.tick(dtMs, reduced)` has no per-frame work in WO01 Block F (status
changes redraw immediately in `sync()`), but the method signature is frozen
by the barn contract (`tick(dtMs: number, reduced: boolean): void`), so the
params can't be dropped. Renaming to `_dtMs`/`_reduced` passed `tsc --noEmit`
but failed `npx eslint`.

**How to apply:** for a frozen/required-but-unused parameter, keep the
contract's exact parameter name and add `void dtMs; void reduced;` as the
first lines of the function body instead of underscore-prefixing. This reads
as "used" to eslint (it's a real reference) without changing behavior. Check
for a real use first, though — this is a last resort for signatures frozen by
a contract, not a habit.
