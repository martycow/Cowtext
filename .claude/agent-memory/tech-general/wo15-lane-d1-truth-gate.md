---
name: wo15-lane-d1-truth-gate
description: WO15 D1 repo drift gate (scripts/truth.mjs) — the Vitest numTotalTestSuites≠files trap, the wildcard declare-module technique for typing a .mjs import, npm's --no-flag swallowing, and why docs-guard denies AGENTS.md the script itself writes
metadata:
  type: project
---

`scripts/truth.mjs` + `scripts/truth.lib.mjs` are the repo's drift gate (T1–T14);
`src/truth/truth.test.ts` covers the pure half. Four things that cost real time and
are not visible from reading the code.

**1. Vitest's `numTotalTestSuites` counts `describe` blocks, not files.**
WO15 §6 D1.2 named it as the source for the truth block's `**N** files`. Live it
read 79 while the repo had 17 test files (`testResults.length` is one entry per
file in the Jest-shaped report). Printing 79 under a "files" label would have
written a false number into the generated truth block — the exact failure the
lane exists to prevent. Took `testResults.length`, kept the suite count printed
beside it in the T5 row so the divergence stays visible, and flagged the
deviation. **Why:** the standing lesson "the gate is the authority, not the
enumeration" applies to field *names* too — here the contract's own label
("files") outranked the contract's own field name. **How to apply:** when a
contract names both a semantic label and a concrete field, verify they agree
against live data before trusting either.

**2. Typing a `.mjs` import from inside `src/` with tsconfig frozen.**
`src/truth/truth.test.ts` imports `../../scripts/truth.lib.mjs`; `allowJs` is off
and `tsconfig.json` was out of zone, so `tsc -p tsconfig.test.json` gave TS7016.
A relative `declare module "../../scripts/…"` is a hard TS error ("ambient module
declaration cannot specify relative module name"), and there is no `paths` entry.
The one form that works is a **wildcard** ambient module in `src/truth/truth.lib.d.ts`:
`declare module "*/truth.lib.mjs" { … }`. Verified: zero truth errors afterwards.
**Why:** the lib must stay `.mjs` so `truth.mjs` runs under bare `node` with no
build step. **How to apply:** reach for the wildcard form whenever a test in `src/`
must import a build-free script and you cannot touch tsconfig.

**3. `npm run truth --no-cargo` never reaches the script.** npm parses `--no-cargo`
as its own config (`npm_config_cargo` in the env) and does not forward it; only
`npm run truth -- --no-cargo` does. `truth.mjs` therefore checks argv **and**
`process.env.npm_config_cargo`. Both spellings are tested and work.

**4. `docs-guard.ps1` denies `AGENTS.md` and `.agents/skills/` (WO15 D-9) while
`truth.mjs` writes both.** Not a contradiction: the guard is a PreToolUse hook on
Edit/Write/Bash, and the script writes through Node's `fs`, which the hook never
sees. The root allow-list stays CLAUDE/README only — deliberately. **How to apply:**
do not "fix" the guard by allow-listing AGENTS.md; edit CLAUDE.md and run
`npm run truth:write`.

**5. docs-guard also blocks a Bash heredoc whose *contents* mention `.md` paths,**
even when the file being written is a `.mjs` in the session scratchpad, outside the
repo. It scans the command text, not the target. The compliant move is the one the
denial message names: use the Write tool on the permitted path (the scratchpad),
never a second Bash spelling. Cost me one cycle; it will recur for anyone writing a
scratch script that lists the T9 file set.

**6. Fix-round F5 (case-insensitive + `generate_handler!` patterns): the context
window lives *inside* the regex, not in a new `STALE_PATTERNS` field.**
`\b(?:generate_handler|invoke|handler)[^\n]{0,40}?` prefixes the two generic
patterns (`N handlers`, `N commands`) so a stray "3 event handlers" is not drift.
**Why the shape:** a new record field would have to be mirrored in
`src/truth/truth.lib.d.ts`, which was outside the fix-round zone — and a pattern
that is exactly "one regex whose group 1 is the number" needs no mirror at all.
Findings are also deduped per `line|key|value`, because
`` `generate_handler!` command list (76) `` legitimately answers to two patterns and
one wrong number is one drift. **How to apply:** when adding a pattern, prefer a
richer regex over a richer record; add both a positive and a negative fixture (the
generated truth block's `Vitest **276** tests` is the standing negative — no pattern
may reach inside `**…**`).

Related: [[wo15-stage0-seams]], [[wo15-lane-r2-hooks-toolchain-agents-tasks]].
