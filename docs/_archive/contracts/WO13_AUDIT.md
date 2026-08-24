# WO13 — adversarial audit

Author: tech-lead. Date: 2026-08-21. Subject: the nine WO13 lanes against
`docs/design/WO13_CONTRACT.md` (frozen, Amendment 1).

Starting point: `cargo clippy --all-targets -- -D warnings` 0 ·
`cargo test --all-targets` 751/751 · `npx tsc --noEmit` 0 · `npm run build`
clean · Vitest 95/95. **Everything below passed all of those.**

Method: read the contract, then read what landed at every lane seam, then
attack the four claims the work order rests on — the §18.1 byte-identity
gate, the `resolveLoad` "one decider", serializer parity, and one-writer.

| Severity | Count |
|---|---|
| HIGH | 6 |
| MEDIUM-HIGH | 2 |
| MEDIUM | 5 |
| LOW–MEDIUM | 1 |
| LOW | 2 |
| CONTRACT-ONLY | 1 |
| **Total confirmed** | **17** |
| Rejected | 1 (open item 2) |

**D15 and D16 were raised by the lanes during the fix round, not by this
audit** — D15 by R2 from a D12 regression test, D16 by R1's rebuilt §18.1 gate
on its first real run. Both are recorded in full because in both cases the
fault is in the **contract**, not in the lane that implemented it faithfully.
Four contract self-contradictions were found in total (§7.3 formula vs table;
§18.1 missing rows 6, P; §14.2 vs §4.1/§8.2) — every one of them a case of two
sections of the same document disagreeing, and none of them caught by any gate
until something computed a real answer.

---

## 1. Findings

### D1 — HIGH — the §18.1 gate does not perform the diff it claims
**`src-tauri/src/compile/tests.rs:1278-1432`** (owner: R1).

§18.1's procedure is *"Compile the fixture with the pre-WO13 compiler;
migrate; recompile with the post-WO13 compiler; **diff the produced file
sets**."* What landed is three tests of `assert!(content.contains(…))`
spot-checks against a hand-traced expectation. The test file says so itself
at `:1280-1285`: *"traced by hand from the pre-WO13 algorithm, since that
compiler no longer exists in this tree to run side-by-side — the enumeration
below IS the executable record of that diff."*

It is not. Specifically:

- **Part A** (`:1306-1345`) asserts three `@path` lines, three bullets and
  four absences in `CLAUDE.md` only. §18.1 Part A requires `AGENTS.md`,
  `GEMINI.md`, `.github/copilot-instructions.md`, **every nested
  `{dir}/AGENTS.md`** and **every `.cursor/rules/*.mdc`** to be
  byte-identical. Not one of those five is touched by any assertion, even
  though `:1316` deliberately turns all five targets on.
- "Nothing is removed" is not asserted anywhere — there is no file-set
  comparison at all, only `by_path.contains_key` probes.
- **Part B row 1** requires *"every other line in that section is unchanged
  and in the same order"*. `:1361-1368` only tests membership of
  `at_lines`; order is never checked.
- **Part B row 5** (`:1392-1396`) is vacuous and admits it: *"none of these
  stems collide in this fixture, so the absence of any `-2` suffix anywhere
  is itself the assertion."* F9 is genuinely covered — by the unrelated test
  at `:1180-1195` — but the gate row that exists to catch it proves nothing.

**Failure scenario.** A fix-round change that reorders `## Always read`, or
drops the nested `packages/api/AGENTS.md`, or alters an `.mdc` body, passes
Parts A, B and C green. The contract's *"Any difference outside A + B + C is
a defect"* is unenforceable because no difference is ever computed.

**Fix.** Commit the pre-WO13 produced file sets as fixtures, then assert **full
set equality modulo the enumerated rows**. Owner: R1, with tech-lead authoring
the baseline.

**CLOSED.** R1 generated a real baseline — isolated `git worktree` at `605760e`
(the WO03 commit) **outside the shared tree**, ran the then-current 2-arg
`compile_preview` against the current fixtures, committed
`tests/fixtures/compiled_baseline_v4_in.json` and
`compiled_baseline_v4_rule1_in.json`. All three parts now compute a real
`diff_file_sets` and assert equality with the enumerated set. Two notes for the
record: the isolated-worktree choice is exactly right and should be the standing
technique for baseline generation (it is the one way to run an old compiler
without the snapshot-restore hazard of §4's incident class); and **the rebuilt
gate immediately found something the spot-check version structurally could not**
— see D16.

---

### D2 — HIGH — §18.1's enumeration is missing a sixth row, and both fixtures were built so it can never fire
**`tests/fixtures/graph_v4_rule1_in.json`** (whole file) + contract §18.1
Part B. Owner: tech-lead (contract + fixture), R1 (gate).

Amendment 1 excludes `command`/`skill` from `AlwaysClosure` as seeds **and**
as traversal targets (`src-tauri/src/resolve_load.rs:207-214, 316-320`).
Pre-WO13 `effective_pinned` closed over *all* `imports` edges out of *all*
pinned nodes. Therefore, for any v4 graph containing

```
pinned command node  --imports-->  D
```

node **D** was in `## Always read` before migration and resolves
`unreachable-import` / `excluded` after it. D's `@path` line disappears from
all four Claude-family root files while its `.cursor/rules/*.mdc` survives
(ignore mode). That is content loss outside the five enumerated rows, and
§18.1 says any such difference is a defect.

Neither fixture can see it. `graph_v4_rule1_in.json` has exactly two edges,
`f01-x` (glob-conditional) and `f02-x` (references), **both sourced at
`r01-x`, the control `rules` node**. No unguarded `imports` edge leaves
`r02-x` (pinned command) or `r03-x` (pinned skill). The fixture was built to
hit rows 1–5 and hits only rows 1–5.

**Verdict on the behaviour: correct and intended** — a node that cannot be
inlined cannot inline its own imports, and `lint.rs`'s `unreachable-import`
does surface it. **Verdict on the contract: wrong.** §18.1 amended with row
6 (below); `graph_v4_rule1_in.json` gains `r06` (pinned `command`)
`--imports-->` `r07` (`architecture`); Part B asserts r07 leaves
`## Always read`, keeps its `.mdc`, and produces a lint `unreachable-import`.

---

### D3 — HIGH — the node wizard writes compile outputs with no approval gate and no `handwritten` protection
**`src/wizard/NodeWizard.tsx:565-568, 710-716`** (owner: U1), reaching
`src-tauri/src/fsbatch.rs:150-212`.

```ts
// :568
setPreviewFiles(res.files.filter((f) => !f.unchanged));
// :710-713
const batch: BatchEntry[] = [
  { relPath: finalPath, content: bodyContent },
  ...previewFiles.map((f) => ({ relPath: f.relPath, content: f.newContent })),
];
```

Every changed compile output goes into the batch. There is no per-file
approval control; the `handwritten` chip at `:390-394` is display-only.
`fs_apply_batch` has no GENERATED-header check — that check lives only in
`compile_write` / `CompileModal`.

This voids §21.3's entire safety argument, which reads: *"a hand-authored
`.claude/commands/deploy.md` is an existing, non-empty file with no
GENERATED header, so `PreviewFile.handwritten` already flags it and
`CompileModal` already makes overwriting it loud and opt-in."* On this path
there is no CompileModal. §12.2's wording is *"every **approved** compile
output"*; nothing approves.

**Failure scenario.** A project with a hand-maintained `CLAUDE.md` that has
never been compiled and carries no GENERATED header. The user creates one
node in the New Node wizard and clicks Confirm on step 4. `CLAUDE.md` is
silently replaced by the generated index. The only warning was a small chip
in a collapsed diff row. Same for `.claude/commands/deploy.md`. This also
breaks CLAUDE.md's hard rule *"Compile never writes without diff-preview
approval."*

**Fix.** Exclude `f.handwritten` entries from `batch` unless individually
ticked, tick defaulting to off, matching CompileModal's opt-in.

---

### D4 — HIGH — `docs/testing/WO13_TEST_MANUAL.md` does not exist
Owner: `tester`.

§18.10 required four manual steps in the PHASE2 format. `docs/testing/`
contains 19 manuals and no WO13 file. Consequences:

- **Open item 8 has no home.** §10.5's `description` frontmatter is the one
  uncertainty the contract deliberately named rather than hid, with a
  pre-agreed fallback (body + GENERATED header, no YAML fence). Nothing
  carries the walk that decides it.
- §18.9 gate #7 explicitly reads *"Plus the manual step in §18.10 item 2"* —
  defect 7 is therefore not fully gated.
- §18.10 item 3 ("a hand-authored command file is protected") is unwalked —
  and it is the same trust boundary **D3** breaks.
- §18.10 item 4 (`.claude/skills/` never written by compile) is unwalked.

---

### D5 — HIGH — `always_closure` does not apply `role_lock` to seeds; two callers are wrong because of it
**`src-tauri/src/resolve_load.rs:296-304`** (owner: R1), with live
consequences in `lint.rs` (R2) and `taskctx.rs` (R3).

```rust
for &s in seeds {
    let Some(n) = by_id.get(s) else { continue };
    if n.deprecated { continue; }
    if set.insert(s.to_string()) { queue.push(s.to_string()); }
}
```

The `RoleLock::Apply` command/skill filter exists only at `:316-320`, on
traversal **targets**. `resolve_load_impl` hides the hole by pre-filtering
its own seed list at `:207-214`. The other two callers do not:

- `src-tauri/src/lint.rs:208-213` — seeds every `root_always && !deprecated`
  node.
- `src-tauri/src/taskctx.rs:180-184` — seeds `base` with every
  `root_load == Always` node, plus the task's own seed node ids, which may
  name a `command`/`skill` node directly.

The TS mirror **does** filter command/skill seeds
(`src/config/resolveLoad.ts:100`), so the two languages' closures disagree —
masked at the `resolveLoad` entry point, live everywhere else.

**Failure scenarios.**

1. `taskctx.rs`: a project with a `rootLoad: "always"` `command` node. Launch
   any task. The command node **and its whole unguarded-imports subtree** are
   injected into the task's boot prompt. §8.3 states plainly *"a command node
   must not be inlined into it either"*, and `taskctx.rs:192-194`'s own
   comment claims the new code fixed exactly this.
2. `lint.rs:1213` `check_always_budget_exceeded` counts that node's tokens
   toward a budget it never occupies.
3. `lint.rs:1063-1073` `check_override_not_co_resident` sees `rule
   --overrides--> command` (both root-always) as co-resident and stays
   silent. An override with no effect ships with no error — a false negative
   on an **error**-severity check.

**Fix.** Filter command/skill seeds inside `always_closure` under
`RoleLock::Apply`. That one change corrects all three callers and restores
TS/Rust equality. Add a corpus case exercising `always_closure` directly.

---

### D6 — MEDIUM-HIGH — `pinnedContextTokens` is a surviving second load-policy decider
**`src/store/tokens.ts:53-71`** (owner: T1).

```ts
/** Pinned-set estimate: pinned nodes' file sizes. The effective-pinned
 *  closure (transitive imports) arrives with Work Order Block B. */
...
if (n.rootLoad === "always") bytes += sizeByPath.get(canonPath(n.filePath)) ?? 0;
```

No closure, no rule 1, no deprecated exclusion. The doc comment is a
WO01-era note that WO13 §8 was supposed to close. This directly contradicts
the edge spec's DoD clause quoted in §8.4 (*"`resolveLoad` is the only
function deciding load policy"*) and disagrees with
`lint.rs::check_always_budget_exceeded`, which uses the closure.

**Failure scenario.** A pinned `rule` imports three large `architecture`
nodes. The Inspector's pinned-context readout shows ~2k tokens; the Problems
panel fires `always-budget-exceeded` at 12k. Same number, two answers, one
screen apart. A deprecated root-always node inflates the readout; a
root-always `command` node inflates it too.

**Fix.** `pinnedContextTokens` keys on `resolveLoad(n.id, graph).policy ===
"always"`. This needs `edges`, so the signature changes and its callers
(`MemoryNodeCard` U2, `Inspector` U4, `NodeWizard` U1) move with it —
schedule as a cross-lane hunk.

---

### D7 — MEDIUM — `updateEdge` has no legality gate, no `contradicts` normalization, and no guard strip
**`src/store/graph.ts:1172-1178`**. Confirms open item 1, with three
distinct consequences rather than one:

**(a)** Denied kind. The only kind-switch call site,
`src/canvas/MemoryEdge.tsx:410`, checks `denied` first — so the deny is
honoured today **by U2's courtesy check alone**. Any second call site
re-opens it.

**(b)** `updateEdge(id, { kind: "contradicts" })` on an edge whose
`source > target` stores an un-normalized pair; §7.2 requires
`source < target`. `serializeGraph` writes it as-is. The next
`migrateGraph` (`src/store/graph.ts:441-450`) swaps the endpoints, so **the
edge silently flips direction on reload** — and if the reciprocal already
exists, `migrateContradicts`'s dedupe **deletes one of the two edges
outright, with its `note`, `color` and `waypoints`** (§5.6's frozen lossy
behaviour). Data loss from one right-click, surfacing one reload later.

**(c)** Switching a *guarded* `imports` edge to `contradicts` leaves `guard`
set, which §7.1 declares illegal. It survives on the wire until the next
load strips it (`:431-433`).

**Ruling on the closed-file doctrine (open item 1).** The spec criterion
wins and `graph.ts` reopens — **serially, in the fix round, before any
parallel fix work.** The Stage-0-then-CLOSED doctrine exists to stop
*concurrent* lanes colliding in one file (§17's own rationale: "the WO03
lesson that made `lib.rs` closed"). A serial fix round does not have that
property, so the doctrine's premise does not apply. §17 amended: closed
means *closed for the duration of parallel lane execution*. **U2 was right
to stop and report** — with the doctrine as written, that was the only
correct move.

**Fix.** `updateEdge` runs the same three checks `addEdge` does and returns
`false` on refusal so the caller can show the reason.

---

### D8 — MEDIUM — denied edges enter through three paths, and lint refuses to report them
The §7.3 criterion is absolute: *"Denied edges cannot be created through any
code path."* Reality:

- **`preset_apply` and `import_apply` never touch `addEdge`.** Both are Rust
  commands that write `graph.json`; the store re-enters through `loadGraph`
  → `migrateGraph` (`src/store/graph.ts:979`), which applies no legality
  check. §7.3's own sentence *"paste, undo/redo, preset-apply and
  `import_apply`'s store commit all pass through it"* is **factually wrong**
  about the last two — my error in the contract, not a lane's.
- **`updateEdge`** (D7).
- **undo/redo** restore whole snapshots (`graph.ts:1248, 1269`), so an edge
  that became denied after its target was deprecated returns on redo.

And nothing reports the result: `src-tauri/src/lint.rs:930-943`
`check_edge_legality_warning` emits only for `Legality::Warn`, on the stated
assumption at `:925-929` that *"a well-behaved graph never contains one (the
frontend's `addEdge`/`updateEdge` refuses them at draw time)"*. That is a
lane asserting its own premise — and `updateEdge` does not refuse them.

**Failure scenario.** Import a `CLAUDE.md` whose structure yields an
`imports` edge into a `command`-role node. The edge is created and stored.
`resolveLoad` rule 3 then makes it a no-op, so the user sees an edge on the
canvas that does nothing, with no explanation available anywhere in the app.

**Fix.** `check_edge_legality_warning` also emits for `Deny`, at
`Severity::Error`, under the same `edge-legality-warning` code, carrying the
same verbatim reason. Owner: R2. §11.2 and §7.3 amended.

---

### D9 — MEDIUM — `import.rs`'s `classify_output` mirror is stale; three copies now exist
**`src-tauri/src/import.rs:769-789`** vs **`src-tauri/src/compile.rs:858-882`**.

`classify_output` has seven arms. `is_compile_output_path` has six — it is
missing `[".claude", "commands", name]`, which R1 added this round at
`compile.rs:875-879`. The test at `src-tauri/src/import/tests.rs:890-898`,
named `helper_is_compile_output_path_matches_every_compile_write_shape`,
asserts a claim that is now false and passes anyway because it enumerates
only the old six.

**Failure scenario.** `import.rs:1122` is the WO03-D2 guard — the last line
stopping `import_apply` from creating a node whose file compile owns and
will silently overwrite. It no longer covers `.claude/commands/`. A
changeset naming `.claude/commands/deploy.md` is admitted; the next Compile
then treats that node's **own source file** as its output destination,
reading it and writing it back wrapped in a `description:` fence and a
GENERATED header, on every compile.

**Ruling on open item 3, part one: CONFIRMED — and one correction to the
framing.** Of the two allowlist copies, `fsbatch.rs:103-110
is_cursor_mdc_output` is the **safe** direction: it covers only the single
non-`.md` arm, and since rule 3's other half admits any `.md`, it is a
*superset* of `classify_output` — a divergence there causes a refusal, never
an unauthorized write. `import.rs`'s copy is a **subset**, and it fails
open. R3 flagged its own copy in eleven lines of doc comment
(`fsbatch.rs:76-102`) and was right to; the dangerous copy is the one nobody
flagged.

**Fix the class, not the instances.** Make `classify_output` `pub(crate)`
(R1); delete both re-derivations (R2, R3); both call it through an
`.is_some()` wrapper. `fsbatch` keeps its `|| ends_with(".md")` half — that
is §12.1 rule 3, not duplication. This edit crosses three lanes: run it in
the serial fix-round Stage 0 alongside D7.

---

### D10 — MEDIUM — the `resolve_load` corpus does not pin the projections that feed it, nor dangling edges
**`tests/fixtures/resolve_load_cases.json`** (14 cases). The corpus **is**
the entire basis for the one-decider claim, so:

**(a) No dangling-edge case.** §8.2 states *"Dangling edges (an endpoint
naming no node) are excluded before resolution."*
`src/config/resolveLoad.ts:127` implements it.
`src-tauri/src/resolve_load.rs:165-270` does **not** — it trusts callers.
The two implementations are therefore not equivalent as functions.
Divergent input: node `b` with one `references` edge whose source is a
nonexistent `ghost` → Rust returns `on-demand`/`referenced`, TS returns
`excluded`/`orphan`. Currently latent (all three Rust callers pre-filter:
`compile.rs:392` and `lint.rs:207` pass `live_edges`; `taskctx.rs` is
closure-only), but it is a trap for the next caller.

**(b) No case contains an `overrides`, `sequence` or `contradicts` edge**, so
`LoadEdgeKind::Other` is never produced. Worse, the corpus reader maps kinds
itself (`resolve_load/tests.rs:50-52`), so **the corpus cannot test the
production projections at all**. There are four hand-written projections —
`compile.rs:398-402`, `taskctx.rs:220-224`, `lint.rs:1003-1005`, and the test
reader — and a slip mapping `overrides` → `Imports` in any of the first
three would change compiled output and pass the whole corpus green.

**(c)** No case exercises rule 6's `source ∈ AlwaysClosure` filter on
`decidingEdgeId` (a lower-id unguarded `imports` edge from a *non*-closure
source). Both implementations get it right; nothing holds them there.

**Fix.** Three new cases; plus a Rust test that pushes a real
`project::BarnGraph` / `compile::GraphIn` through each production projection
rather than the test's own parser. Owner: tech-lead (corpus) + R1.

---

### D11 — MEDIUM-HIGH — the Stage 0 sweep licence had no Rust half; two modules silently degraded
Root cause: §17's sweep licence enumerates **19 TypeScript files** and no
Rust ones. `#[serde(default)] pinned: bool` on a private node projection is
invisible to the compiler once `pinned` leaves the wire — it just reads
`false` forever. Two modules were hit:

**(a) `src-tauri/src/assemble.rs:150, 213, 358, 610-612`** (owner: R3, but
outside its written carry). `NodeIn.pinned` deserializes `false` for every
v5 node, so `build_prompt` never emits `"Pinned: always in context."` — a
WO12-D5 capability regressed to dead code with no test failure. The existing
test sets `job.pinned = true` directly (`assemble/tests.rs:232`), so it
proves the prompt builder works and never that `pinned` can be true from a
real graph. Textbook lane-tests-its-own-assumption. Fix: read
`rootLoad == "always"`.

**(b) `src-tauri/src/handoff.rs:61, 117`** — same shape, same silent effect:
every handoff prompt has lost its `, pinned` annotation, so the model
writing the handoff no longer knows which nodes are always-in-context.
Additionally **`handoff.rs:280-281, 357`** still returns `role: "reference"`
— a role deleted in v5 — with a doc comment asserting *"ALWAYS
`reference`"*. It only fails safe because
`src/handoff/HandoffNodeProposalModal.tsx:164` validates and falls back to
`"architecture"`; the safety net is doing the producer's work, and the
fallback stamps no `needsReview`. Fix: emit `"architecture"`.

`src-tauri/src/handoff.rs` was **assigned to no lane** — §17 grid gap, added
below.

---

### D12 — LOW-MEDIUM — two lint fixes can be silently unapplicable
**`src-tauri/src/lint.rs:1039-1047`**. `check_not_co_resident` emits
`AddImports { source: e.source, target: e.target }` for both
`sequence-not-co-resident` and `override-not-co-resident`. Fixes are applied
through `addEdge` (§11.3), which returns `null` for a denied edge. When the
target is `command`, `skill` or deprecated, `edgeRules.ts` denies `imports`
into it, so clicking Fix does nothing, silently.

Guaranteed reachable: an `overrides` edge into a `command` node can never be
co-resident (rule 3 → `on-invoke`), so the **error** always fires and its fix
is always inert. Fix: suppress the `fix` when `legality_for(source, Imports,
target, deprecated) == Deny`; and surface a failed fix in the Problems panel
rather than swallowing the `null`. Owner: R2 (+ U4 for the panel half).

---

### D13 — LOW — the wizard writes the node's own file twice, and its Undo is silently partial
**`src/wizard/NodeWizard.tsx:710-743`**. `fsApplyBatch` writes `finalPath`,
then `createNodeFrom({ content: bodyContent })` writes the same path again —
acknowledged at `:706-709` as *"redundantly but harmlessly … both writes
agree byte-for-byte"*, a claim asserted by comment and by no test. Two
writers to one path inside one user action; two `fs://change` events.

Separately: the Undo toast reverts **files only**. The node stays in the
graph store and `scheduleSave` persists it, so Undo leaves a node pointing at
a file it just deleted. That is consistent with §12.3 (graph undo must not
learn about files) and is the right call — but the toast says nothing, unlike
the agent modal's memory-folder detail (§12.2, *"the toast detail says so"*).
Add the detail line. Owner: U1.

---

### D15 — HIGH — the deprecated-target `deny` is outranked by every other rule in the matrix
**`src/config/edgeRules.ts:52-179`** (T1) and **`src-tauri/src/lint.rs:781-923`**
(R2). Raised by R2 from a D12 regression test; CONFIRMED, and larger than
reported. **The contract is at fault, not either lane** — §7.3's formula and
§7.3's own required-rule table disagreed, and both lanes implemented both
faithfully.

`{ source: "*", kind: "*", target: "@deprecated" }` scores
`0 + 0 + 1 = 1` — **the lowest score in the table.** Every other rule scores
2 or more, so all twelve outrank it and the deprecation guard survives only in
the default case where nothing else matches:

| target is deprecated, edge is… | winning rule (score) | actual | correct |
|---|---|---|---|
| `imports → command` | 1 (3) | deny, **wrong reason** | deny |
| `imports → skill` | 2 (3) | deny, **wrong reason** | deny |
| `imports → architecture` | 4 (3) | **warn** | deny |
| `glossary overrides *` | 5 (6) | deny, **wrong reason** | deny |
| `example overrides *` | 6 (6) | deny, **wrong reason** | deny |
| `workflow references command` | 7 (7) | **allow** | deny |
| `example references rule` | 8 (7) | **allow** | deny |
| `example references invariant` | 9 (7) | **allow** | deny |
| `example references style` | 10 (7) | **allow** | deny |
| `decision contradicts decision` | 11 (7) | **allow** | deny |
| cross-group `overrides` | 12 (2) | **warn** | deny |
| anything else | 3 (1) | deny ✓ | deny ✓ |

Five silent `allow`s, two `warn`s, and four denies carrying a user-facing
reason about the wrong subject.

**Failure scenario.** Draw `arch_a --imports--> arch_b`, where `arch_b` is
deprecated. `legalityFor` returns `warn`, so `addEdge` creates the edge.
`check_edge_legality_warning` then files a **warning** whose verbatim reason is
*"Architecture notes are usually long. Inlining puts this in every request."* —
a sentence about length, not about deprecation.
`check_structural_edge_into_deprecated` files an **error** on the same edge.
`resolveLoad(arch_b)` returns `excluded`/`deprecated` (§8.2 rule 2), so the
edge provably cannot affect any output. The user gets two contradictory
Problems entries — "this is fine, just so you know" and "this is broken" —
about one wire that does nothing.

**Ruling: it is a defect. The deny becomes a precondition evaluated before
scoring.** Reasons, in order of weight:

1. **Category error.** Specificity ranking resolves *competing statements about
   the same kind of thing* — role pairings. Deprecation is a property of the
   target's **state**, orthogonal to both role and kind: a node has a role *and*
   a deprecation status, and the table can score only one target dimension. The
   `target: NodeRole | "*" | "@deprecated"` union was the tell — it is a union
   of two different kinds of thing, and I froze it anyway.
2. **Three other subsystems already treat deprecation as a hard gate, and I
   argued for it explicitly in one of them.** §8.2 puts `deprecated` at rule 2,
   *before* the role rules, and the contract's own words are *"`deprecated`
   outranks the role rules … Getting this order wrong ships a generated file
   for a node the user marked out of date."* §10.3 excludes deprecated nodes
   from all output unconditionally. `structural-edge-into-deprecated` is
   severity **Error**, unconditionally. §7.3 was the only place deprecation was
   negotiable — three to one, and the one is mine.
3. **A "required" rule that any of twelve rows can defeat is not required.**
   When a contract's normative table and its resolution mechanism disagree, the
   table states the intent and the mechanism is an implementation detail. The
   mechanism yields.

**Steelman for keeping it uniform, and why it loses.** Uniformity buys one code
path and no special cases — but the special case already exists, in the type.
Hoisting `@deprecated` out does not *add* a special case; it **removes** one
from the table and lets `EdgeRule.target` become cleanly `NodeRole | "*"`. The
other argument is extensibility: one might later want `decision contradicts
deprecated decision` for provenance. That is a real use case, but `contradicts`
is advisory-only and a deprecated node reaches no output either way (§10.3), so
the edge would do nothing; if we want provenance links later we add an explicit
escape hatch, not rely on a scoring artifact nobody intended.

**Rejected alternative:** giving `@deprecated` a dominating score (e.g. 8).
Same category error with a magic number, keeps the mixed union, and breaks the
"explainable by inspection" property §7.3 froze as *testable*.

**Consequences to expect, so they are not a surprise in review.** Seven
outcomes change (5 `allow`→`deny`, 2 `warn`→`deny`) and four keep `deny` but
change their user-facing reason string, which §7.3 had frozen verbatim. All
movement is toward denying edges that provably cannot affect output, and it
makes the draw-time answer agree with the lint error instead of contradicting
it. Deprecating a node *after* its edges exist does not retro-delete them —
correctly; those become one Problems item, per the amended §7.3.

**Owner: R2**, both halves in one lane (`lint.rs` plus a temporary grant of
`src/config/edgeRules.ts`), in the serial fix-round Stage 0 slot beside D7 and
D9 — a mirror pair must not be split across lanes (§17). **Mandatory gate:**
`tests/fixtures/edge_legality_cases.json`, tech-lead-authored, asserted from
both languages. Contract §7.3 amended (Amendment 3, applied).

**Standing consequence.** This is the **second** instance of a Rust/TS mirror
pair agreeing with each other while both diverged from the spec, after D5's
`always_closure` seed handling. Consistency between mirrors is not evidence of
correctness — it is only evidence that one person wrote both. From here, **an
unpinned mirror pair is an incomplete deliverable**, and open item 3's shared
legality corpus is promoted from "recommended fix" to a contract requirement.

---

### D16 — CONTRACT-ONLY — §18.1 Part A demands byte-identity that §10.4 makes impossible
Raised by R1 from the rebuilt gate's first real diff. **No code defect — the
implementation is correct and the contract was wrong.**

`tests/fixtures/graph_v4_in.json`'s `e06-x` is
`n09-x --overrides--> n02-x`. Both were `pinned: true` in v4, so both are
root-always in v5, so both resolve `always`, so they are co-resident by §11.1 —
and §10.4's precedence marker fires. `precedence_markers` has exactly one call
site (`emit_root`), so the effect is **one inserted line in each of the four
root files**, and nothing in `.cursor/rules/*.mdc` or the nested
`{dir}/AGENTS.md`. §18.1 Part A says those files are byte-identical and
enumerates no exception for it.

**Ruling 1 — amend the prose.** §10.4 is block E-C, a deliberate output change I
specified in this same contract and then failed to reconcile with §18.1.
**Exception P** added, scoped to all three parts and bounded line-for-line
(Amendment 4, applied).

**Ruling 2 — keep the fixture; do NOT quieten the control.** The coordinator's
lean is right, and the reason is stronger than tidiness:

- `e06-x` is the **only** `overrides` edge in the corpus. Deleting it to make
  "control" mean "zero differences" would leave §10.4 — one of the three
  edge-model deliverables — with **no gate coverage at all**. That trades real
  coverage for a tidier definition.
- A control asserting one precisely-bounded known change is strictly *more*
  informative than one asserting none: it proves the marker fires, fires once,
  fires in the right position, and fires in exactly four files. A gate that can
  only say "nothing changed" cannot distinguish *correct* from *the emitter
  never ran* — which is the failure mode D1 was about in the first place.
- Editing the fixture now would also invalidate the baseline dumps R1 just
  generated from a real worktree: real cost, zero benefit.

**The pattern worth naming.** This is the **third** incomplete §18.1 exception
list, and **all three omissions were output changes specified elsewhere in the
same document** — Amendment 1's destination lock, D2's closure row, and now
§10.4's marker. The enumeration was written by reading the amendment in front of
me rather than by walking every section that touches an emitter. Standing rule
added to §18.1: *the exception list must be derivable from the set of sections
that change emitter behaviour — §8.2 rules 3/4, §10.2, §10.3, §10.4, §10.5* —
and that set is now verified complete against the real diff (§10.2 is
byte-identical by construction; §9's `edge_participates_in_order` is a no-op
against pre-WO13 because `conditional` was never structural either). **From here
the gate, not my enumeration, is the authority** — which is precisely what D1
was for.

---

### D14 — LOW — `write_graph`'s v4 backup skips a corrupt pre-v5 file
**`src-tauri/src/project.rs:1044-1047`**:
`serde_json::from_str::<Value>(&old).ok()…unwrap_or(false)`. A `graph.json`
that is pre-v5 but corrupted (partial write, merge-conflict markers) yields
`false`, no backup is taken, and the irreversible overwrite proceeds. §5.8's
posture is that a failed backup is a hard `Err`. Fix: unparseable existing
content is an `Err`, not a `false`.

---

## 2. Verdicts on the eight open items

**1. `updateEdge` has no legality gate — CONFIRMED (D7), with two extra
consequences the report did not name (un-normalized `contradicts` causing
edge deletion on next load; illegal guard surviving on the wire).**
**Ruling on the doctrine:** the spec criterion wins. `graph.ts` reopens for
one serial pass in the fix round, before any parallel work. The closed-file
doctrine protects against *concurrent* writers; a serial fix round has no
concurrency to protect against, so the rule is scoped to parallel execution,
not made permanent. U2's stop-and-report was the correct behaviour under the
rule as written, and its UI-side courtesy check is currently the only thing
holding the criterion.

**2. §11 badges on affected nodes and edges — REJECTED as a defect; ruled
OUT OF SCOPE.** The contract's §11 never required them; that text is the edge
spec's Block D, which §11 did not carry forward, and §17 deliberately assigns
no owner for a shared lint-results store. U4's refusal — citing WO03's
multiple-lanes-adding-the-same-state class — is exactly right. Backlogged in
§19 **with a named owner**: `src/store/lint.ts`, laid once by the next work
order's Stage 0, before any lane starts. Assigning it now would create the
defect U4 avoided.

**3. Two re-derived rule tables — CONFIRMED, both, with one correction.**
- Write allowlist: see **D9**. The framing inverts — `fsbatch`'s copy is a
  superset that fails closed; `import.rs`'s copy is a subset that fails open,
  and it is already stale. Fix the class: `pub(crate) classify_output`, both
  copies deleted.
- Edge-legality table: I compared `lint.rs:781-878` + `node_group:767-777`
  against `src/config/edgeRules.ts:52-143` row by row and reason string by
  reason string. **They agree today**, including the tie rule
  (`lint.rs:914-917` later-index-wins ≡ `edgeRules.ts:175` `score >= best`)
  and `@deprecated` scoring as a concrete target. There is no cheap way to
  merge them across the language boundary and I am not asking for one. Fix =
  the mechanism §8.3 already established: a frozen shared corpus
  `tests/fixtures/edge_legality_cases.json`, asserted from `lint.rs`'s tests
  and `edgeRules.test.ts`. It pins `node_group` too, via the cross-group
  `overrides` rule. Current severity LOW (no drift); severity of leaving it
  unpinned, MEDIUM.

**4. U1 did not build step 2's glob input — CONFIRMED. U1 IS RIGHT, and this
is explicitly NOT a silent miss.** §14.2's *"glob input only for `on-glob`
with a live match count"* is unimplementable against the v5 wire shape the
same contract froze. `on-glob` is not a node property: it is §8.2 rule 7,
derived from a **guarded `imports` edge into the node**, and §4.1 gives
`MemoryNode` no glob field — only `rootLoad: "always" | absent`. A node being
created has no incoming edges, so a glob typed in step 2 has nowhere on the
wire to go. §14.2 contradicts §4.1 and §8.2; §4.1 and §8.2 win. U1 shipped an
informational note (`src/wizard/NodeWizard.tsx:891-896`) rather than a dead
control, which is the A3-correct answer, and the capability now lives in the
edge guard control. **§14.2 amended** — the criterion is struck, not missed.

One thing genuinely lost and not to be dropped with it: **the live match
count against `useProjectStore.files` was never built anywhere.** The
Inspector's `GuardEditor` (`src/inspector/Inspector.tsx:2244-2256`) takes a
glob list with no feedback, so a user cannot learn a glob matches zero files.
Carried to U4 as a fix-round item; not scored against U1.

**5. `localStorage` for banner dismissal — CONFIRMED deviation, RATIFIED with
a follow-up.** `src/store/project.ts:159-163, 211, 245` is the only
`localStorage` use in the codebase, and every other preference is Rust-backed
`AppSettings`. But `store/settings.ts` is outside U4's zone (§17), U4 flagged
it in-code (`:159-162`) instead of reaching across, and the failure mode is
benign — it degrades to "not dismissed" when storage is unavailable
(`:212-215`). That is precisely the behaviour the grid asks for from a lane
that finds a foreign file, and I am not going to punish it. Follow-up: fold
into `AppSettings.dismissedMigrationBanners` next round. Note the key is the
absolute root path, so the banner also returns if the project moves.

**6. `orphan-node` / `unreachable-import` ship `fix: None` — CONFIRMED TRUE,
not convenient.** `LintFix::AddImports { source, target }` (§11.3) is an
*apply-me* fix: both endpoints must be concrete. For `orphan-node` nothing
points at the node, so there is no source to name. For `unreachable-import`
the honest fix is "make the *source* reachable", which needs a root-always
node the linter would have to pick arbitrarily — wrong whenever there are
zero or several. `check_not_co_resident` can name both endpoints only because
the offending edge supplies them; these two checks have no such edge. **§11.2
amended to `fix: none`** for both, with the reasoning recorded so it is not
re-flagged as a miss. (Separately: the fixes that *are* emitted are not always
applicable — D12.)

**7. U3 moved the avatar into the "Local only" group — CONFIRMED; the literal
reading is right; ACCEPTED as built.** §14.3 names `avatarPath` in the
local-only list explicitly, and the avatar genuinely never reaches the agent's
frontmatter — badging it `local only` is the honest answer A3 demands.
Moving it back to identity would recreate the "one of four non-compiling
controls is unmarked" state that §3.2/D8 was decided to eliminate.
`src/agents/AgentEditor.tsx:1092-1121` and `src/tasks/NewAgentDialog.tsx:472-475`
both do this consistently. **No change requested.** §14.3 gains one
clarifying sentence so this is not relitigated: the avatar image and its menu
are part of the `avatarPath` field.

**8. §10.5's `description` frontmatter — NOT CARRIED. See D4:** there is no
WO13 test manual at all, so none of §18.10's four steps exist.

---

## 3. Contract corrections applied (Amendment 2)

Marty's four, plus five from this audit. All are normative.

| # | Change | Source |
|---|---|---|
| A2-1 | **§16 corrected** — `src/scene/sfx.ts` is removed from write-forbidden. The role-set fallout *does* reach it; `readCueForRole` produced two real `TS2367`s. Assigned to B1 mid-dispatch. **RATIFIED.** | Marty |
| A2-2 | **§17 gains `src/store/events.ts` → R3.** **RATIFIED.** Without it, R3's `phase`/`startedAt` and U2's stepper never meet and defect 5 ships as a blinking bar with more code behind it. Verified landed and correct: `src/store/events.ts:171-217`. | Marty |
| A2-3 | **§17 gains `src-tauri/src/cowtext_cli.rs` and `cowtext_mcp.rs` → R1** (both call `compile_preview`, whose signature changed). **RATIFIED.** | Marty |
| A2-4 | **§14.5/§16 strengthened — the `identity.ts` hazard is TRANSITIVE.** Generalized rule: *any table a frozen ramp indexes into inherits that ramp's write-forbidden status.* B1 nearly deleted "dead" keys from `src/scene/palette.ts`'s `ROLE_ACCENT`, which `calf.ts` reads *through* `identity.ts` — silently changing every calf's accent in 5 of 7 slots. **RATIFIED.** | Marty |
| A2-5 | **§17 gains `src-tauri/src/handoff.rs`** — unassigned, and carrying two v4 leftovers (D11b). | audit |
| A2-6 | **§17's Stage 0 sweep licence gains a Rust half.** It enumerated 19 TS files and no Rust ones; `#[serde(default)] pinned: bool` on a private node projection is invisible to the compiler once `pinned` leaves the wire (D11). | audit |
| A2-7 | **§18.1 Part B gains row 6** (D2) and the procedure gains a committed pre-WO13 baseline file set (D1). | audit |
| A2-8 | **§14.2 strikes the step-2 glob input**; the live match count moves to the edge guard control (open item 4). **§11.2**: `orphan-node`/`unreachable-import` → `fix: none` (item 6); `edge-legality-warning` also fires at `Severity::Error` for `Deny` (D8). **§14.3**: the avatar image and its menu belong to the `avatarPath` field (item 7). | audit |
| **A4** | **§18.1 AMENDED AND APPLIED (Amendment 4)** — the Procedure now mandates a **committed baseline generated from an isolated worktree at `605760e`**, not a hand-traced expectation; **Exception P** (§10.4 precedence markers, all three parts, bounded line-for-line) added; **Part B row 6** added to the table; the control fixture is kept deliberately un-quietened, with the reason recorded. Standing rule added: the exception list must be derivable from §8.2 rules 3/4, §10.2, §10.3, §10.4, §10.5. D16. | R1 raised, tech-lead ruled |
| **A3** | **§7.3 AMENDED AND APPLIED (Amendment 3)** — the deprecated-target `deny` becomes a **precondition evaluated before specificity**, `EdgeRule.target` narrows to `NodeRole \| "*"`, the `@deprecated` row is hoisted out of the required table, lint reports one item per edge rather than two, and `tests/fixtures/edge_legality_cases.json` becomes a **required** gate. D15. | R2 raised, tech-lead ruled |
| A2-9 | **§7.3's sentence *"paste, undo/redo, preset-apply and `import_apply`'s store commit all pass through it"* is STRUCK — it is factually wrong** about the last two (D8). **§17's "CLOSED afterwards" is scoped to the duration of parallel lane execution** (D7). **§19 gains** node/edge lint badges, with `src/store/lint.ts` named for a future Stage 0 (item 2). | audit |

---

## 4. Mechanism proposal — the zone-violation class

Both incidents share one shape, and it is not indiscipline.

- **U1** wrote a throwaway stub over `src/config/nodeTypes.ts` (T1's
  exclusive file) partly because *the file did not exist when U1 checked*.
  "Zone" was a promise about a file with no existence yet.
- **R1** patched five foreign files and restored them by `diff -q` against
  **its own snapshot**, not against current state — reverting concurrent
  edits. R2 was clobbered several times; R3 watched `taskctx.rs:286` change
  under it twice; R1 saw `compile.rs` revert to pre-WO13 content.

Both agents were doing the same rational thing: **making a build go green so
they could validate their own work**, against a brief that told them the tree
would be red until integration. A rule that says *"don't"* while the
environment makes *"don't"* mean *"you cannot check your work"* gets broken
every time. WO11, then twice in WO13. **The instruction is not the missing
part.** Three changes, cheapest first:

### (1) Make the zone grid mechanically enforced, not remembered
Emit `.claude/zones/<lane>.json` from §17 at dispatch — a literal allowlist
of glob paths — and add a `PreToolUse` hook on Edit/Write/Bash that refuses
any write outside the running lane's allowlist. This is the exact shape
`docs-guard.ps1` already uses in this repo, on a rule Marty already trusts to
block writes. A lane then *physically cannot* write a foreign file, and
"stop and report" becomes the only available action rather than the
disciplined one. This alone prevents both incidents, including U1's race —
the hook refuses on path, not on existence.

### (2) Give every lane a private green baseline, so nobody needs a foreign file to compile
The real driver is validation, so remove the need:

- **Stage 0's deliverables gain compiling stubs for *every* cross-lane seam
  it freezes**, not just `fs_apply_batch`. It already did this for
  `resolve_load.rs` and it demonstrably worked — R3 coded its `taskctx` hunk
  against `always_closure`'s frozen signature without waiting for R1's body,
  and R1's own file arrived as a skeleton. Generalize the rule: if §17 says
  lane A consumes lane B's signature, Stage 0 lays that signature with an
  `unimplemented!()` / `throw` body. **The tree is then green from the end of
  Stage 0**, and "the tree is red until integration" stops being true — which
  removes the motive rather than forbidding the act.
  (Note where this already failed: `NodeWizard.tsx:560-565` carries a comment
  explaining that `compilePreview`'s third arg "is not yet landed … this is a
  real, expected `tsc` red". That comment is the motive, written down.)
- **Each lane validates its own scope, not the crate.** `npx tsc --noEmit -p
  tsconfig.lane.json` with a narrowed `include`, and `cargo clippy
  --all-targets` read through a lane-local filter. A lane that can prove its
  own files compile does not go patching other people's.

### (3) Ban snapshot-restore outright, and name the misconception
Add to CLAUDE.md's hard rules:

> *Never restore a file you did not write from a snapshot you took. Your
> snapshot is stale the moment another lane writes. If a foreign file blocks
> you, stop and report.*

R1's `diff -q` verification was rigorous and still wrong — it compared
against the wrong baseline. That is a concurrency misconception, not
carelessness, and naming the misconception is worth more than repeating the
prohibition. Paired with (1), it cannot be reached anyway.

**Cost:** one hook script plus a generated JSON per lane; a Stage 0 scope
rule already half-practised; two sentences. None of them ask the lanes to be
more careful, which is the property I want.

---

## 5. Fix-round sequencing

Three fixes cross lane boundaries and **must run serially, first, as a
fix-round Stage 0**, before anything parallelises:

1. **D7** — `src/store/graph.ts` reopens for `updateEdge`.
2. **D9** — `classify_output` → `pub(crate)`; both re-derivations deleted
   (`compile.rs` + `import.rs` + `fsbatch.rs`, three lanes, one edit).
3. **D15** — the deprecation precondition, both halves
   (`src/config/edgeRules.ts` + `src-tauri/src/lint.rs`) in **one** lane, R2,
   plus the shared corpus. Sequence it **after** D7: `updateEdge` must already
   carry the legality gate, or the new deny is enforced on only one of the two
   creation paths.

Then, in parallel: R1 (D1, D2, D5, D10), R2 (D8, D9-half, D11b, D12), R3
(D9-half, D11a), T1 (D6), U1 (D3, D13), U4 (item-4 match count, D12 panel
half), tester (D4).

## 6. Open risks

- ~~**D1 + D2 mean the byte-identity claim is unproven.**~~ **CLOSED.** R1
  committed real pre-WO13 baselines and the gate now computes an actual
  `diff_file_sets`. The claim is now proven-with-exceptions, and the exceptions
  are enumerated, bounded and asserted. It found D16 on its first run, which is
  the return on doing it properly.
- **The corpus is no longer purely tech-lead-authored.** `resolve_load_cases.json`
  grew 13 → 19 (R1: `c14`/`c14b` for D5, `c15`–`c17` for D10). R1 flagged the
  additions rather than editing ground truth quietly — correct behaviour, and
  the contract's fixture rule should be relaxed to say so explicitly: a lane may
  **propose** cases, tech-lead ratifies, and no lane may **modify or delete** an
  existing case. Ratified for these six. Also worth recording: D5 was proven
  load-bearing by R1 disabling its own fix and watching the *pre-existing* case
  `c10` fail — which is the right way to demonstrate a fix is real, and confirms
  the audit's reading that the pre-filter in `resolve_load_impl` was what hid the
  seed bug from the public entry points.
- **D3 is a live data-loss path** to a user's hand-written `CLAUDE.md`, and
  the manual step that would have caught it (§18.10 item 3) does not exist
  (D4). Do not ship v0.1.0 with both open.
- The `emit_commands` / `emit_cursor` stale-output question — neither deletes
  `.mdc` or command files for nodes that stopped qualifying — is unchanged
  from pre-WO13 and out of scope, but the new emitter doubles the surface.
  Worth a backlog row.
