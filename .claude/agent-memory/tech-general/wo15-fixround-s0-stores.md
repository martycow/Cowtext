---
name: wo15-fixround-s0-stores
description: WO15 audit fix round, S0 stores lane (sidecar `model`, `reloadSkills`, loadAgents flush-before-discard, settings no-persist-on-failed-read, adoptFile basename). Three places where the dispatcher's prompt and the audit's frozen amendment disagreed, and how I picked. Read before re-touching store/agents.ts's sidecar or settings.ts's load().
metadata:
  type: project
---

WO15 fix round (2026-08-22), zone = `src/store/{agents,settings,graph}.ts` +
their tests. All five items landed; gates green (297 Vitest / 17 files,
`tsc` clean, ESLint 0 errors / 16 pre-existing warnings). See
[[wo15-stage0-seams]] for the lane that built these seams originally.

## Where the dispatcher prompt and the frozen amendment disagreed

Three times, and the amendment (or the audit's own fix table) was right
twice. Worth re-reading both before starting — the dispatcher prompt is a
paraphrase, the audit is the text that was frozen.

- **`AgentMeta.model` optional vs required.** Prompt said
  `model?: string | null`; A-20 and audit §12 said `model: string | null`
  (required, `DEFAULT_META.model = null`). Went REQUIRED, because
  `ModelPicker`'s prop is `model: string | null` and the audit prescribes
  U3 writing `m.model` straight into it. A required field is assignable to
  BOTH consumer styles (`m.model` and `m.model ?? null`); an optional one
  breaks the prescribed line. Nothing outside the store constructs an
  `AgentMeta` literal (`TasksBoard` only names the type), so required cost
  no foreign edits.
- **`adoptFile`'s basename.** Prompt said "use `canonPath`/`sameRelPath`";
  the audit's F8 said `relPath.replace(/\\/g, "/").split("/")` and
  explicitly "not `canonPath`, which lower-cases the title". The audit is
  right — that basename becomes the node's visible title, so `canonPath`
  would be a real behaviour change on forward-slash paths, which the same
  prompt forbade. Used the `graph.ts:1384` idiom inline; the duplicate
  guard one line up already uses `sameRelPath`.
- **"`await flushMetaSave()`" when the export returns `void`.** Changed the
  export to `Promise<void>` rather than awaiting the private internal.
  Safe here because **this repo's ESLint has no type-aware rules** — no
  `@typescript-eslint/no-floating-promises` — so the four existing bare
  `flushMetaSave();` call sites (App.tsx, project.ts, CompileModal,
  RailSections) neither error nor warn. Check `eslint.config.js` before
  assuming that again.

## Judgment calls worth keeping

- `parseAgentMeta` reads `model` UNCONDITIONALLY (even with no `provider`
  beside it); `serializeMeta` is the single place that decides whether it
  may be written back (needs `model !== null` AND a provider AND
  `provider !== "anthropic"`). Splitting it that way means a hand-edited or
  older file never loses data on read, and there is exactly one rule about
  what lands on disk.
- `settingsAfterLoad(read)` returns `{settings, persist, problem}` and is
  the whole of tester #4: **no file at all is a SUCCESS** (persist — the
  first launch is exactly when settings.json should be created); a file
  that parses to a non-object (`[]`, `"nope"`, `null`) is a FAILURE (do not
  persist — it is somebody's data in a shape we don't understand). The
  launch still counts in memory on every path. Pure fn because `load()`
  touches `window.matchMedia` and the test layer is `environment: node`.
- `loadAgents` now awaits BOTH flushes before its reset `set()` — the
  sidecar and a new private `flushPendingAgentSaves()` (awaited counterpart
  of the fire-and-forget `flushAgentSave()`). Order matters: the flush must
  run while `root`/`meta`/`drafts` still name the OLD project, since that
  is where those writes belong.
- Exported `parseMetaJson`/`serializeMeta` (with a "for tests" doc comment,
  the `isDirty` precedent) so the §3.8 wire shape is pinned by a round-trip
  test instead of by reading. Store actions like `updateMeta`/`reloadSkills`
  stay untested — they need invoke mocking, which this repo deliberately
  does not do (§15 pure-module rule); say so in the report rather than
  introducing `vi.mock`.
