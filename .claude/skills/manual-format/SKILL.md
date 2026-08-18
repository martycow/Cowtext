---
name: manual-format
description: The established Cowtext test-manual format — structure, step style, and sign-off table — distilled from docs/testing/PHASE2_TEST_MANUAL.md (the reference example). Load before writing or reviewing any manual in docs/testing/.
---

# Test manual format

Reference example: `docs/testing/PHASE2_TEST_MANUAL.md`. Every manual in
`docs/testing/` follows this shape. Manuals are written against the code **as
built**, not as specced — verify every named control exists before writing the step.

## File header

1. Title: `# <Phase/Feature> Manual Test Script — <Subject>`.
2. One-paragraph intro: what feature, run top-to-bottom in one sitting, which
   sections reuse earlier state, and the as-of line naming the exact source files
   and date: *"Written against the code as of YYYY-MM-DD (`src/...`, `src-tauri/...`).
   Every step names the real control and the exact expected result — if reality
   differs, that is a bug (or this manual is stale; either way, note it)."*
3. **Time budget** line (e.g. "~25 min full pass, plus the 2-minute regression").

## Sections

- `## A. Preconditions` — free ports, exact launch command in a fenced
  ```powershell block, and a **throwaway test project** built by pasteable
  commands (never a real project when the test writes/deletes files).
- `## B. Happy path` — the core flow, subdivided (`### B1.`, `### B2.` …).
- `## C/D. Validation / Safety` — error paths, trust boundaries, keyboard safety,
  "closing is blocked mid-flight" checks.
- `## E. Regression` — a 2-minute pass over the previous phase's core flow.
- `## Cleanup` — pasteable removal of the scratch project.
- `## Sign-off` — the table (see below).

## Step style

- One numbered list continuous across ALL sections (step numbers never restart).
- Each step: **bold** the control being used (`Press **Compile**`,
  `Flip the **Pinned** toggle ON`), then `*Expected:*` with the exact observable
  result — real labels, colours, counts, file paths, byte-exact header lines.
- Expected results are specific enough to fail: "footer reads **4 of 4 files will
  be written**", not "the footer updates".
- Include negative/inertness checks (buttons greyed, Escape inert while writing).
- Multi-file disk verification: fenced code blocks with the exact expected content
  or a pasteable check command.
- Design-idiom expectations belong in steps too (pixel march "the cow is
  compiling" — never a spinner).

## Sign-off table (always last)

```markdown
## Sign-off

| Section | Pass/Fail | Notes |
|---|---|---|
| A Preconditions | | |
| B Happy path | | |
| ... | | |

Tester: ____________  Date: ____________  Build/commit: ____________
```
