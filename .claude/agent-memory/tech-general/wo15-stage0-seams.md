---
name: wo15-stage0-seams
description: WO15 Stage 0 (S0) — the shared seams nine parallel lanes build against (settings appearance fields, toolchain/ui stores, pushLocal, hooksAddr, src/resources data tables, providerForModel, buildProjectGraph, LocalOnlyBadge, git wire types). Judgment calls, two gate traps, and the ambiguities I resolved. Read before touching src/resources/, store/toolchain.ts, store/ui.ts or wizard/projectGraph.ts.
metadata:
  type: project
---

WO15 Stage 0 (2026-08-21, serial, blocking R1/R2/U1/U2/U3/U4a/U4b/B1/D1)
landed every seam in `docs/_archive/contracts/WO15_CONTRACT.md` §4 in the §8 manifest
order. Gates at exit: build ✓ · lint 0 errors / 16 warnings · Vitest 234
tests / 16 files (was 163 / 12). See [[wo13-stage0-schema-seam]] for the
prior Stage-0-shaped lane — its NUL-byte and eager-import lessons both
applied again and both were checked for (no NUL bytes this time; no
forward-reference imports were needed because every seam landed complete).

## Ambiguities in the contract text, and how I resolved them

- **Stack-file markdown (§4.11 rule 3)** — "`## <label>` + `- <item label>`
  lines ¶" is ambiguous about a blank line between the heading and its
  bullets. Read it literally: the ¶ separates CATEGORIES, so the emitted
  body is `## Languages\n- TypeScript\n- Rust\n\n## Frontend\n- React`.
  Pinned byte-exactly in `projectGraph.test.ts`, so a later reader changing
  it breaks a test rather than silently churning every new project's
  `context/stack.md`.
- **Principle stub = "`body` + trailing `\n`" (§4.11 rule 4)** — my first
  `principles.json` had bodies ENDING in `\n`, which would have produced a
  double trailing newline. Fixed in the DATA (bodies now end at the last
  visible character) rather than by defensively trimming in code, so the
  rule stays the contract's literal one-liner and the JSON is the only
  place the shape is decided. If Marty edits `principles.json`, keep bodies
  un-terminated.
- **`providerForModel` prefix table (§4.10)** — implemented exactly the
  listed prefixes (`claude-|opus|sonnet|haiku|fable`, `gpt-|o1|o3|o4|codex`,
  `gemini-`) as `startsWith` on the lowercased id, and deliberately did NOT
  add the `us.anthropic.` / `anthropic.` prefixes `shortModelLabel` knows
  about. Reason: the WO13 mirror lesson — audits compare against the
  contract text, and an "obvious" extra arm is exactly the kind of drift
  that reads as a defect later. Flag it if a bedrock-style id ever appears.
- **`isToolFound` returns `boolean | null`** — `null` only when `tools` is
  empty (never scanned). A scanned-but-missing id returns `false`. The
  distinction matters for U3's provider chips: an unscanned machine must
  render neutral, not "not installed".

## Two real gate traps

- **`no-useless-escape` is an ESLint ERROR, and §4.9 spells the model-id
  regex as `/^[a-z0-9][a-z0-9.\-]*$/`.** Copying the contract verbatim
  fails `npm run lint`. Moved the hyphen to the end of the character class
  (`[a-z0-9.-]`) — identical semantics — with a comment naming the reason.
  General rule: contract-quoted regexes are prose, not lint-clean code.
- **`tsconfig.json` EXCLUDES `src/**/*.test.ts`, so `npm run build` never
  type-checks a test file.** `tsconfig.test.json` exists but is wired into
  no npm script, and running it surfaces ~14 PRE-EXISTING errors
  (`edgeRules.test.ts`/`resolveLoad.test.ts` missing `node:*` types,
  `agents.test.ts`'s `stateWith` helper's inferred union). Worth running
  `npx tsc -p tsconfig.test.json --noEmit | grep <your files>` as a private
  self-check — it caught nothing this round, but the only other type
  coverage a test file gets is Vitest actually executing every line.

## Deliberate structural choices

- `ProviderId`/`PROVIDER_IDS` live in `src/agents/types.ts`, not
  `src/resources/index.ts` — `store/agents.ts` must validate a sidecar
  `provider` without pulling in the data tables, and `resources/index.ts`
  imports the union back (type-only) for `Provider.id`.
- `resources/index.ts` casts each imported JSON once (`as unknown as
  <Shape>File`) and `resources.test.ts` IS the validator for that cast —
  ids, order, exact labels, `tools ⊆ ALL_TOOLS`, `priority ===
  DEFAULT_PRIORITY`, `parseSkillMd(content).body === body`. Don't replace
  the cast with a runtime narrowing map; it would silently drop bad data
  instead of failing a test.
- `events.ts` grew a shared `appendTrimmed(events, entry)` so `pushEvent`
  and `pushLocal` cannot drift on the ring-trim rule.
- `builtinInclude` stores ONLY `true` entries (`delete` on false), matching
  how §3.8 serializes it — the map and the file can never disagree about
  what "off" looks like.
- Path comparisons in the NEW tests go through `sameRelPath` (§7.8), even
  where a bare `===` would obviously pass; the auditor greps for
  `relPath ===` across all of `src/`, tests included.
