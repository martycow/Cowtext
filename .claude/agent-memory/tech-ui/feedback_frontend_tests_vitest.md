---
name: frontend-tests-vitest
description: The repo DOES have a frontend test runner (Vitest, `npm run test`) since WO13 — the old "no test runner" note is dead; scope runs to your own files during parallel lanes
metadata:
  type: feedback
---

Frontend tests run under **Vitest** (`npm run test`, config `vitest.config.ts`,
globals wired in `eslint.config.js` for `src/**/*.test.ts`). As of WO15 the
suite is ~276 tests / 17 files. This replaces the pre-WO13 memory that said
"no frontend test runner exists" — that note was true once and is now wrong.

**Why:** answering a "write a regression test" ask with "there is no runner"
would be a false statement about the current repo, and adding a dependency to
"fix" it would break the fixed-stack rule.

**How to apply:** when asked for a TS-side regression test, write a real
`*.test.ts` beside the module. During a parallel lane round, run only the
files you care about (`npx vitest run src/wizard/projectGraph.test.ts`) — the
full suite is fast, but the full `npm run build` is not a lane-local signal:
other lanes' half-saved files make `tsc` red at random moments. See
[[wo13-build-against-unlanded-lane]] for the scoping habit.
