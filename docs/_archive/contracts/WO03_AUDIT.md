# WO03 Audit — L1 Moat Hardening (adversarial)

**Auditor:** tech-lead · **Date:** 2026-08-19 · **Contract:** `docs/design/WO03_CONTRACT.md` (frozen)
**Lanes audited:** A (graph-v3) · B (compile-targets) · C (cli) · D (importer) · E (linter) · F (frontend) · barn micro-lane
**Lane G (docs close-out) has not run** — every documentation obligation below routes to G.

**Verdict: NO — WO03 does not ship as-is.** Defect D1 is a silent data-loss path in the
headline new feature (import). D2–D4 are user-facing. Everything else is fixable in one round.
See §5.

---

## 1. Summary by severity

| Severity | Count | Ids |
|---|---|---|
| Critical | 1 | D1 |
| Major | 3 | D2, D3, D4 |
| Minor | 5 | D5, D6, D7, D8, D9 |
| Nit | 4 | D10, D11, D12, D13 |
| Observations (backlog, not defects) | 5 | O1–O5 |

Deviations ratified: 6 (§4). Contract amendments required: 4 (§4).

---

## 2. CONFIRMED DEFECTS — route back to the owning lane

### D1 · CRITICAL · Import silently loses everything it just imported
**File:** `src/import/ImportReviewModal.tsx:143-156` · **Lane: F** (with D as context)

`doApply()` calls `importApply(...)`, sets `result`/`phase`, and stops. `import_apply`
(`src-tauri/src/import.rs:1062-1065`) writes `.cowtext/graph.json` on disk directly. The
in-memory `useGraphStore` is never reloaded and never told it is stale.

The precedent is three files away and does it correctly:
`src/preset/PresetsModal.tsx:156` — `await useGraphStore.getState().loadGraph(root);`
immediately after `presetApply`. `ImportReviewModal` omits exactly that line.

**Failure scenario (no error, no warning, permanent):**
1. Open a project whose graph has 3 nodes. Store holds 3.
2. Import → adopt 12 proposed nodes → **Adopt selected**. Rust writes graph.json with 15 nodes.
   The modal says "added 12 nodes". The canvas still shows 3 — the user assumes a render lag.
3. User drags any node, edits any title, or toggles any target. `scheduleSave()` → 700 ms →
   `flushSave()` → `write_graph` with the store's **3** nodes.
4. The 12 imported nodes are gone from disk. No undo entry, no error state, no diff.

The watcher does not save them either: `.cowtext/` is a dot-directory and
`project.rs::is_scannable_md` only matches `.md`, so nothing reloads the graph.

**Fix:** `await useGraphStore.getState().loadGraph(root)` before `setPhase("done")`, plus
`void useProjectStore.getState().rescan()`. Note `loadGraph` resets undo history — that is
correct here and matches the preset path.

---

### D2 · MAJOR · The importer proposes compile-output paths as node files, adopted by default
**File:** `src-tauri/src/import.rs:206-242` (CLAUDE.md), `:245-282` (AGENTS.md), `:286-332` (`.mdc`) · **Lane: D**

Every primary file the scanner parses becomes a node whose `filePath` **is that file**.
For the three file families this importer targets, all of those paths are paths **`compile`
owns and overwrites** — `classify_output` (`compile.rs:780-799`) accepts every one of them.
A hand-written `CLAUDE.md` has no GENERATED header, so `already_managed` is `false`
(`import.rs:428`), so `ImportReviewModal.tsx:107` **checks it by default**.

**Failure scenario:**
1. Import a repo with a hand-written 400-line `CLAUDE.md`. Default selection adopts it.
2. Graph now has a node `CLAUDE.md → CLAUDE.md`.
3. User clicks Compile (target `claude`, the default). Preview shows `CLAUDE.md` as
   `handwritten: true` — a loud warning, so this is not silent, which is why it is MAJOR not
   CRITICAL — but the sentence the user reads is "this file was hand-written", which is exactly
   what they *expect* right after an import. They approve.
4. The 400 lines are replaced by the generated 12-line index. The node still points at
   `CLAUDE.md`, so the graph now contains a node whose content is compile's own output; the
   next compile inlines the index into itself.

Same shape for `.cursor/rules/api.mdc`: the cursor adapter derives its output stem from
`file_path` (`compile.rs:989-1001`), so the adopted `.mdc` compiles onto itself, re-wrapping
its own frontmatter each run.

`is_rename_protected` (`project.rs:610-617`) already names `claude.md` / `agents.md` /
`.cursor/**` as untouchable, and `commitNewNode` (`graph.ts:455`) refuses to create a node on
one. `import_apply` has no equivalent guard.

**Fix (Lane D):** in `apply_inner`, refuse any approved node whose `file_path` is a compile
output shape (reuse `compile::classify_output`, make it `pub(crate)`), and in `scan_inner` mark
those proposals so the UI defaults them to *not adopted* with a "compile writes this file" note.
The parsed file should still contribute its `@`/link edges — it just must not become a node.

---

### D3 · MAJOR · `src/import/types.ts` was never reconciled with Lane D — two fields missing
**File:** `src/import/types.ts:24-49` · **Lane: F**

The file's own header (`:16-20`) asks tech-lead to diff it field-for-field once `import.rs`
lands. Done. Result:

| Rust (`import.rs`) | TS (`import/types.ts`) |
|---|---|
| `ImportProposedNode.pinned: bool` (`:102-103`, `#[serde(default)]`, always serialized) | **absent** |
| `ImportProposedEdge.condition: Option<String>` (`:121-122`) | **absent** |

Everything else matches exactly (`id`, `title`, `role`, `filePath`, `brief`, `sourceFile`,
`alreadyManaged`; edge `id`/`source`/`target`/`kind`; `ImportChangeset`; `ImportApplyResult`
`nodesAdded`/`edgesAdded`/`skipped`; `ImportApproved` ≡ `Pick<…,"nodes"|"edges">`).

**Runtime today is accidentally correct** — `ImportReviewModal.tsx:133-141` builds the approved
subset with `.filter()`, so the raw objects (excess properties and all) go straight back to
Rust and `serde` picks `pinned`/`condition` up. That accident is the whole defect: the types
now assert those fields do not exist. The first refactor that does
`.map(n => ({ id: n.id, … }))`, or any consumer that reads `node.pinned`, silently drops
`.mdc` `alwaysApply` and `globs` — and `tsc --strict` will not say a word, because the fields
are not in the type. This is a live tripwire, not a style issue.

**Fix (Lane F):** add `pinned: boolean` and `condition?: string`, and surface `pinned` in
`NodeRow` (an adopted always-apply rule arriving unpinned is a real surprise).

---

### D4 · MAJOR · The Inspector role popup is unreachable by keyboard
**File:** `src/inspector/Inspector.tsx:319-413` (portal at `:368-374`) · **Lane: F**

`RolePopup` declares `role="menu"` with `role="menuitemradio"` children and implements **no**
focus management: nothing focuses the popup on open, there is no roving `tabIndex`, and there
are no `ArrowDown`/`ArrowUp`/`Home`/`End` handlers. Focus stays on the trigger button while a
`createPortal` renders the menu at the end of `document.body`.

**Failure scenario:** keyboard user tabs to the Role field, presses Enter (`:433-438` opens the
popup), then presses Tab — DOM order sends focus to the *next Inspector control*, not into the
portal. The 13 role buttons sit after every other focusable element on the page. The popup does
not close on focus-out, so the user is looking at an open menu they cannot reach. Changing a
node's role is keyboard-impossible; `RoleField` is the only role control for an existing node
(`Inspector.tsx:1288`).

The rationale in the code (`:312-318`) — `ContextMenu`'s `MenuItem` has no header row and its
icon slot is typed to `LucideIcon` — is a legitimate reason not to reuse the primitive. It is
not a reason to also drop what the primitive provides: `ui/ContextMenu.tsx:45` focuses the menu
and `:92-95` implements arrow keys. Even the popup this one claims to mirror, `TagPicker`, at
least `autoFocus`es an input inside itself (`src/tasks/TagPicker.tsx:124`). This is strictly
worse than both.

**Ruling on item 7:** the cost is not "consistency" — it is a functional WCAG 2.1.1 failure and
an ARIA contract violation (`role="menu"` promises arrow-key navigation). Bespoke is ratified;
bespoke-without-focus-management is a defect.

**Fix (Lane F):** focus the popup container on open, roving focus across the flattened role
list, arrow/Home/End, Escape restores focus to the trigger (already done at `:456`). Either
that, or extend `ContextMenu` with a header-row item type and reuse it — the arbitration
belongs to tech-ui, but one of the two must happen.

---

### D5 · MINOR · Rust and TS sort graph.json with different collations
**File:** `src-tauri/src/project.rs:550,552` vs `src/store/graph.ts:188-189` · **Lane: A**

`serialize_graph` sorts by `String::cmp` (byte order); `serializeGraph` sorts by
`localeCompare` (ICU, punctuation weakened, case-insensitive at the primary level).
`project.rs:546-547` claims the two mirror each other. They do not.

Node ids are `` `${base36}-${rand}` `` (`graph.ts:232-235`) — every one contains a `-`, which is
precisely where the two collations disagree. `"m1abc-x9"` vs `"m1abcd-y"`: byte order puts
`-` (0x2D) before `d`, ICU ignores it and compares `x` vs `d`. Opposite results.

**Failure scenario:** run an import (Rust writes graph.json in byte order) → make any edit
(TS rewrites it in ICU order) → the whole `nodes` array reorders in the diff. Every subsequent
Rust-side write flips it back. `graph.json` is git-tracked and the contract's stated reason for
deterministic serialization is small diffs; this produces the largest possible one on a file
where nothing changed.

**Fix (Lane A):** make one side authoritative. Cheapest correct fix is TS-side —
`.sort((a,b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))` — since `serialize_graph` is also
what `cowtext-cli` feeds to `compile_preview`. Add a fixture test asserting both serializers
produce identical bytes for a graph with `-`-containing ids.

*(Verified not a compile-output problem: `total_order` is a `(readOrder, id)` heap and every
adapter sorts, so compiled bytes are invariant to input array order. This is churn only.)*

---

### D6 · MINOR · The canonical Rust model is strict where compile.rs is tolerant — three consumers hard-fail on graphs the app opens fine
**File:** `src-tauri/src/project.rs:302-319, 343-353, 382-390, 399-403` · **Lane: A**

`NodeRole`, `EdgeKind`, and `CompileTarget` have no `#[serde(other)]` fallback, and `Position`
/ `ScenePos` are `i64`. So `migrate_graph` returns `Err` for any graph.json containing an
unrecognized role/kind/target string or a fractional coordinate. `compile.rs` models the same
data tolerantly (`RoleIn::Other` `:105-107`, `EdgeKindIn::Unknown` `:147-148`,
`TargetIn::Unknown` `:197-198`), and the TS store casts without validating
(`graph.ts:218,225-226`).

**Failure scenario:** a user hand-edits `graph.json` (compile.rs:728 explicitly contemplates
this) and typos `role: "referance"`. The app loads it, renders it, and compiles it. But
`lint_run` → `Err`, `import_apply` → `Err`, and `cowtext-cli lint` / `compile --check` → **exit
2** with `invalid graph.json: unknown variant`. A CI job wired to `compile --check` now fails
for an infrastructure reason on a graph the product itself considers valid — the exact
"disagree in a user's CI" outcome the contract was written to prevent.

Same class: `Position { x: i64 }` rejects `"x": 80.5`. Nothing in Rust re-rounds; the app only
rounds on the way out (`graph.ts:161`, `GraphCanvas.tsx:188`), so one historical or
externally-written fractional coordinate bricks all three Rust consumers of that project.

**Fix (Lane A):** either mirror compile.rs's tolerance (`#[serde(other)]` on all three enums,
float-tolerant deserializer for `Position`/`ScenePos` that rounds), or — if strictness is
intentional — make `lint_run` return the parse failure as a `LintItem` with an `error`
severity rather than as a `Result::Err`, so the linter *reports* the bad graph instead of
refusing to run on it. The second is arguably the better product answer.

---

### D7 · MINOR · ProblemsPanel reports every lint failure as "not available in this build"
**File:** `src/inspector/ProblemsPanel.tsx:69-74` (message at `:150`) · **Lane: F**

The `catch` maps *all* rejections to `status: "unavailable"` → "Lint isn't available in this
build yet." That degrade was written while `lint_run` was not yet in `generate_handler!`. It is
now (`lib.rs:101`), so the only remaining rejection causes are real: an unparseable or
strictly-invalid `graph.json` (D6), or an unreadable root.

**Failure scenario:** the graph is corrupt — the single situation the Problems panel exists to
surface — and the panel says the feature does not exist. The user has no path to the message.

**Fix (Lane F):** keep an `unavailable` state only for a "command not found" string; render any
other rejection as a real error row.

---

### D8 · MINOR · `.mdc` `globs` are silently discarded on a Cursor-only project
**File:** `src-tauri/src/import.rs:318-327` · **Lane: D**

The conditional edge that carries a `.mdc`'s `globs` is only created
`if let (Some(anchor), Some(cond))`. `anchor_id` is set only from a root `CLAUDE.md`
(`:222`) or a root `AGENTS.md` (`:259-261`). A repo with only `.cursor/rules/*.mdc` — an
entirely ordinary import target, and the one where Cursor conventions matter most — has no
anchor, so every `globs:` value is dropped with **no `else`, no warning**. `condition` is
computed at `:493` and thrown away.

The contract requires "globs … maps to … conditional semantics", and Lane D added
`ImportProposedEdge.condition` specifically to preserve it (D3).

**Fix (Lane D):** at minimum push a warning ("`api.mdc` has globs but the project has no
CLAUDE.md/AGENTS.md to attach a conditional edge to — glob dropped"). Better: fall back to the
first proposed node, or carry the condition on the node proposal.

---

### D9 · MINOR · Two cycle detectors, no test that pins them together
**File:** `src-tauri/src/lint.rs:233-291` + `:303-335` vs `src-tauri/src/compile.rs:577-626` + `:633-665` · **Lane: E** (with B)

**Ruling on item 3:** the duplication itself is **ratified**. The two implementations operate on
genuinely different types (`NodeIn`/`EdgeIn`, a tolerant parse shape, vs `MemoryNode`/
`MemoryEdge`, the canonical model); unifying them would mean either generics over a trait for
two ~60-line functions or forcing compile.rs onto the strict model, which would inherit D6's
brittleness into the one path that must never fail. `pub mod` visibility does not change that
calculus. Re-derivation stays.

What is **not** ratified is leaving it unpinned. Today the two agree — I verified direction,
tie-break `(readOrder, id)`, dangling-edge exclusion, and `find_cycle`'s
smallest-id-deterministic walk line by line. There is no test that will notice when they stop.
Item 1 in the dispatch brief is that exact risk having already happened once and been caught by
luck.

**Fix (Lane E):** one differential test — a fixture corpus (acyclic, `imports` cycle,
`overrides` cycle, mixed cycle, dangling-edge-breaks-a-cycle) asserting
`compile_preview(...).errors` contains a `Cycle` **iff** `lint_graph(...)` contains a
`LintCode::Cycle`, with the same node id set. Cheap, and it is the only thing standing between
this design and a CI where `compile --check` and `lint` disagree.

---

### D10 · NIT · Stale "contract says 7 → 12" comments
`src-tauri/src/project.rs:297-301` and `src/store/graph.ts:18-21` both tell the reader the
frozen contract says "7 → 12" and that they are deliberately deviating. `WO03_CONTRACT.md:28`
says **"Node `role` enum 7 → 13"**. The comments are wrong and will make a future reader
distrust the contract. **Lanes A, F** — delete both notes.

### D11 · NIT · Stale "not yet landed in compile.rs" note
`src-tauri/src/lint.rs:229-232` says the `overrides` direction "has not yet landed in
compile.rs's own Kahn pass … flagged for reconciliation". It has landed and it agrees
(`compile.rs:595-599`). Replace with a pointer to the normative rule (§4.1). **Lane E.**

### D12 · NIT · Presets drop node `meta`
`src/preset/types.ts:99-103` serializes `tags` and `owner` but not `meta`; `parsePreset`
(`:186-191`) likewise. The contract says the preset format bumps *in lockstep* with graph v3.
`meta` has no writer yet so nothing is lost today, but save→apply is now lossy by
construction. **Lane A/F.**

### D13 · NIT · Nested `@`-imports resolve root-relative
`src-tauri/src/import.rs:438-441` (and `:514-517`) resolve `@path` tokens against the project
root regardless of which file they were found in, while markdown links at `:442-452` correctly
join the containing directory. Claude Code resolves `@` relative to the containing file. A
nested `docs/AGENTS.md` containing `@notes.md` produces a bogus `notes.md` target (warning, or
a false match against a same-named root file). Cowtext's own output is root-relative so
round-tripping is unaffected; only hand-written nested files are. **Lane D.**

---

## 3. OBSERVATIONS — log to backlog, no fix round

**O1 · Barn: three roles are visually identical.** `ROLE_ACCENT` (`src/scene/palette.ts:38-46`)
has 7 entries; `makeCabinet` falls back to straw (`calf.ts:96`, `props.ts:66`), and `rules` *is*
straw. So `rules`, `invariant`, and `trap` render as the same straw cabinet
(`sceneGraph.ts:104-123`). **Ruling on item 8: accepted.** `palette.ts` was out of the barn
micro-lane's zone, the collision is documented at `sceneGraph.ts:101-103`, and the barn is
ambient rather than an identification surface — a user identifies nodes on the canvas, where
all 13 roles have distinct tokens and glyphs. Backlog row: 6 accent hues for the WO03 roles,
bundled with the real-sprites work.

**O2 · 13 roles, one of which does anything.** `compile.rs:110-114` — only `agent` has compile
semantics; the other twelve parse to `RoleIn::Other` and change nothing in any of the five
targets. `lint.rs` never reads `role` at all. **Ruling on item 9:** this does *not* violate
"expandable, simple, lightweight, modular" — the taxonomy is one string field with an
exhaustive `Record<NodeRole, …>` on the TS side (the compiler enforces completeness, so adding
or removing a role is a bounded edit) and a flat `enum` on the Rust side. Nothing branches on
it. That is the cheap way to carry a vocabulary.

It *does* mean the moat claim is currently unearned: "richer taxonomy" that changes zero bytes
of compiled output is metadata, not differentiation. Say this plainly to Marty rather than
letting the roadmap assume it landed. The honest framing for v0.1.0 is "13 roles are how *you*
organize the graph"; the moat arrives when a role changes the output (role-grouped sections in
`emit_root`, role-filtered subgraph injection). That belongs in WO04+, not a retrofit here.
Backlog row: "give NodeRole compile semantics".

**O3 · No `duplicate-id` lint code.** Duplicate node ids are silently tolerated by both
`compile.rs` (`id_to_idx` keeps the last, `:277-282`) and `lint.rs` (`:130-135`). Low
reachability (`makeId` is time+random, `import_apply` uses `unique_id`) but it is the one
graph-integrity check the linter is missing, and it is three lines. Backlog.

**O4 · `import_apply` accepts any existing file path.** `apply_inner` (`import.rs:963-968`)
validates only "inside root and `is_file()`". A malformed or hostile changeset can point a node
at `.claude/settings.json`. No write boundary is crossed (compile's allowlist still holds) but
the node would be read and inlined by the cursor adapter. Defense-in-depth only — D2's fix
should add an `is_rename_protected` / non-`.md` refusal and this closes with it.

**O5 · Lane G's exact obligations.** `docs/TERMINOLOGY.md` is still on the pre-WO03 world:
`:11` and `:33` say **51** commands (now 54), `:77` lists **4** edge kinds (now 7), `:78`
defines effective-pinned without the new structural kinds, and the roles/`BarnGraph version: 1`
lines are unchanged. Plus the two normative sentences in §4.1 and §4.2 below, the two new
compile targets, and `cowtext-cli`. Also update the skill under
`.claude/skills/cowtext-terminology/`.

---

## 4. Adjudications and ratified deviations

### 4.1 `overrides` edge direction — RULED, and it is now normative
**Item 1.** Lane B (`compile.rs:595-599`) and Lane E (`lint.rs:249-253`) independently chose
**target before source** — the same direction as `imports`. They agree by luck; from here they
agree by rule.

**Ruling: `(source, target)` on an `overrides` edge means "source overrides target". The target
is the base and is emitted FIRST; the source is the override and is layered on after. Direction
is identical to `imports`: target-before-source in Kahn's algorithm.**

Rationale: an override is only meaningful once the thing it overrides is established, in both
reading order and (for an LLM consuming the compiled file top-to-bottom) precedence order —
later text wins. Aligning with `imports` also means one mental model for all
target-before-source kinds, and `sequence` remains the only inverted kind.

This sentence goes verbatim into `docs/TERMINOLOGY.md` (Lane G) and into an amendment note on
`WO03_CONTRACT.md`. Lane E deletes the stale reconciliation comment (D11). The differential
test in D9 is what makes the rule enforceable rather than aspirational.

### 4.2 `effective_pinned` deliberately excludes `overrides` — RATIFIED, with a doc obligation
**Item 2.** `compile.rs:670-692` closes over `imports` only. This is coherent and I confirm it:

- `imports` is an *inclusion* relation — "this node's content is part of mine" — so the closure
  is the correct semantics.
- `overrides` is a *precedence* relation. Pulling the base node into always-in-context because
  something overrides it inverts the intent: the whole point is that the base has been
  superseded in some respect.
- The precedent already exists: `sequence` is structural for ordering and has never been in the
  pinned closure. `overrides` joining it is the internally consistent choice, not an exception.

So: **structural ⇒ participates in ordering and cycle detection. Only `imports` ⇒ participates
in the effective-pinned closure. These are two different questions and the code is right to
answer them separately.** Marty's approval stands.

**But it is not documented anywhere a user would find it.** `KindPicker.tsx:24` tells the user
`imports` is "always in context"; `:41` tells them `overrides` "wins on conflict" and says
nothing about context membership. `TERMINOLOGY.md:78` still defines effective-pinned in
pre-WO03 terms. A user can only *infer* the rule from an absence. **Lane G must amend
`TERMINOLOGY.md:78` to read: effective set = pinned + transitive `imports` closure; `sequence`
and `overrides` affect compile order only and never add a node to the always-read set.**
Lane F should extend the `overrides` hint in `KindPicker.tsx:41` with "does not pull the target
into context".

### 4.3 Lane F touched `tokens.css` and `tailwind.config.js` — RATIFIED as legitimate scope
**Item 5.** The edits are purely additive: 6 `--role-*` and 3 `--edge-*` custom properties
(`src/styles/tokens.css:79-84, 95-97`) and their Tailwind mappings
(`tailwind.config.js:57-62, 69-71`). No existing token changed value. No other lane owned
either file this work order, so there was no collision risk.

A 13-role / 7-kind UI is undeliverable without them, and the alternative — hardcoded hexes in
`RoleGlyphs`/`MemoryEdge` — would have violated the design-token rule that every colour resolves
through a variable. Building the feature and not the tokens would have been the worse deviation.

The contract's zone grid was simply incomplete: it says "`src/canvas/` · `src/inspector/` ·
`src/compile/` · `graph.ts` consumers" and forgot that the token registry is a dependency of all
three. **Amend the WO03 zone grid retroactively: Lane F's zone includes `src/styles/tokens.css`
and `tailwind.config.js`, additive entries only.** Standing rule for future contracts: any lane
that adds a visual variant owns additive token entries by default.

### 4.4 Lane D's one-node-per-FILE deviation — RATIFIED, contract amended
**Item 6.** Confirmed correct, and the reasoning at `import.rs:30-43` is exactly right.
One node per `##` heading would require `import_apply` to **write new `.md` files**, and
`import_apply` writing file content is the single most dangerous thing this lane could do — it
breaks must-not-break #3 head-on. Headings are used to *classify* the one node a file yields
(`process_markdown_file:429-436`), never to multiply it. The one honest way the node count
grows without a write — `@imports` and markdown links resolving to files that already exist on
disk (`:336-373`) — is implemented and is the right escape hatch.

**Amend `WO03_CONTRACT.md` (import_scan row): "One proposed node per FILE. Markdown section
structure is used to classify a file's node (title/role/brief), never to split one file into
several nodes — that would require `import_apply` to write new files, which is forbidden.
Additional nodes come only from `@import` / markdown-link targets that already exist on disk."**

### 4.5 Role count is 13, not 12 — RATIFIED
The contract's explicit enumeration (`WO03_CONTRACT.md:28`: 7 existing + `command`,
`invariant`, `trap`, `skill`, `snippet`, `style`) is normative; the line reads "7 → 13" and the
code implements 13. Both lanes were right to implement the enumeration rather than drop a named
role, and both should now delete their comments claiming otherwise (D10).

### 4.6 Lane E's re-derivation of Kahn/cycle — RATIFIED, conditional on D9
See D9. Duplication approved on type-boundary grounds; the differential test is mandatory.

---

## 5. Invariant verification

| Invariant | Verdict | Evidence |
|---|---|---|
| Byte-identity frontmatter (`frontmatter.rs`, `agents.rs` untouched) | **HOLDS** | Neither file appears in any lane's diff; no lane imports them. |
| Deterministic compile / v2→v3 produces byte-identical legacy output | **HOLDS, with a gap** | `compile/tests.rs:1038-1130` pins a v3 graph carrying every new field against the literal pre-WO03 goldens for claude/agents/cursor/nested — a real, well-chosen test. `project/tests.rs:496,533,559` pin lossless + idempotent + no-churn migration. **Gap:** no test joins them, i.e. `serialize_graph(migrate_graph(v2))` → `compile_preview` vs `compile_preview(v2)`. That is the exact chain `cowtext-cli compile --check` runs (`cowtext_cli.rs:336-345`). Add it with D9's fixtures. |
| Never-clobber — `import_apply` | **HOLDS (Rust)** | `import.rs:1000-1006` (path already has a node ⇒ no-op) and `:1043-1046` (edge key exists ⇒ no-op); all node paths validated before the graph is touched (`:963-968`), mirroring `preset_apply`. Content is never written. See D1 — the loss comes from the frontend seam, not from this code. |
| Never-clobber — `preset_apply` | **HOLDS** | `preset.rs:221` (non-empty graph refused), `:238-251` (`create_new` — atomic claim, skip on collision). |
| Write allowlist not weakened by the two new targets | **HOLDS** | `compile.rs:780-799` — `["GEMINI.md"]` and `[".github","copilot-instructions.md"]` are exact full-path matches, not prefix or extension rules. `compile/tests.rs:846-876` proves `.github/copilot-instructions.txt`, `sub/GEMINI.md`, `.github/nested/…`, `github/…`, `GEMINI.MD` are all refused. Textbook. |
| GENERATED header still required | **HOLDS** | `compile.rs:553-555`; agent-block files keep their ratified marker exception (`:545-552`). |
| Errors XOR files | **HOLDS** | `compile.rs:332-337` unchanged. `import_scan` puts the split at the `Result` level — `Err` only for a bad root, every parse problem downgraded to `warnings` (`import.rs:163-166`, `:240`, `:330`, `:345`) — documented at `:9-15`. Acceptable and arguably cleaner; note it in the contract. |
| `lint_run` / `compile --check` genuinely read-only | **HOLDS** | `lint.rs` — no `write_atomic`, no `fs::write`, no `write_graph`; only `read_to_string`/`read_dir`. `cowtext_cli.rs` — never calls `compile_write`, and `compile` without `--check` is a usage error (`:188-192`), so the binary cannot be invoked into a write. |
| `resolve_within_root` on every new FS entry point | **HOLDS** | `lint.rs:207,419,492`; `import.rs:337,964`; `find_readme` (`lint.rs:455`) and `find_mdc_files`/`walk_agents` derive from an already-`checked_root` path and never accept a webview string. |
| Invoke contract 54/54 byte-exact | **HOLDS in code** | `lib.rs:101-103` adds `lint_run`, `import_scan`, `import_apply`; TS call sites match byte-for-byte (`lint/api.ts:13`, `import/api.ts:12,16`). **`docs/TERMINOLOGY.md` still says 51** — Lane G (O5). |
| CLI feasibility (no `tauri::Builder`, rlib) | **HOLDS** | `lib.rs:13-21` `pub mod` for compile/import/lint/project; `cowtext_cli.rs` constructs no Tauri types. |

---

## 6. What is genuinely good

Short, because good work does not need paragraphs:

- **The write allowlist extension** (`compile.rs:780-799`) is exact-match-per-shape with a
  near-miss test corpus. This is the highest-risk surface in the product and it was widened
  without softening a single rule.
- **`LinkStyle`** (`compile.rs:811-834`) is a real refactor, not a rename — it turns "is this
  claude?" into "which of two link families?", which is why adding two targets cost four call
  sites and zero formatting branches.
- **`v3_additions_do_not_change_legacy_target_output`** (`compile/tests.rs:1038`) is the right
  test, correctly identified by its own author as the most important one in the lane.
- **`import.rs`'s module doc** (`:1-43`) states its invariants before its code and names the
  one deviation with its reasoning. That is what let this audit adjudicate item 6 in a minute
  instead of an hour.
- **`cowtext-cli`'s exit-code policy** is split into pure functions (`:313-319`, `:450-456`) and
  unit-tested independently of the filesystem. Correct instinct.

---

## 7. Required before re-audit

**Fix round (blocking):** D1 (F) · D2 (D) · D3 (F) · D4 (F).
**Same round (cheap, do them now):** D5 (A) · D6 (A) · D7 (F) · D8 (D) · D9 (E) ·
D10 (A, F) · D11 (E) · D12 (A/F) · D13 (D).
**Contract amendments (tech-lead, before Lane G):** §4.1 overrides direction · §4.2
effective-pinned scope · §4.3 Lane F token zone · §4.4 one-node-per-file · plus the
`import_scan` errors-XOR note.
**Lane G:** O5, including the two normative sentences.
**Then:** re-run all gates (`npm run build`, `npm run lint`, `cargo clippy --all-targets -- -D
warnings`, `cargo test`, invoke contract 54/54) and re-audit D1–D4 only.

Backlog rows: O1 (barn accents) · O2 (role compile semantics) · O3 (`duplicate-id` lint).
