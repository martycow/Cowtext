---
name: wo13-lane-r2-lint-import-frontmatter-agents
description: WO13 Lane R2 (lint.rs v5 extension, import.rs v5 migration, frontmatter.rs 5 new known keys, agents.rs description-seed fix) — a live cross-lane file-clobbering incident and its detection technique, the edge-legality-warning re-derivation call, a real serde per-variant rename_all gotcha, and an orphan-node test-fixture semantics trap. Read before re-touching lint.rs, import.rs, frontmatter.rs, or dispatching another lane that shares files mid-flight with a "scratch patch and restore" lane.
metadata:
  type: project
---

WO13 Lane R2 (2026-08-21, parallel with 8 other lanes) extended `lint.rs`
with 9 new checks + `LintFix` + `Severity::Info`, migrated `import.rs` to
the v5 taxonomy (roles/edge-kinds/`guard`/`rootLoad`), promoted 5 new
`frontmatter.rs` known keys, and fixed `agents.rs::agent_template`'s blank
`description:`. See [[wo03-lane-e-linter]] and [[wo03-lane-a-graph-v3-schema]]
for the v3-era precedents this built on.

## Cross-lane file-clobbering incident — detect it, don't fight it blind

**What happened:** Lane R1 used a "scratch patch → verify → restore
byte-identical via `diff -q`" technique on files OUTSIDE its own zone
(`import.rs`, `import/tests.rs`, `lint/tests.rs`, plus R3's/CLI's/MCP's
files) to prove a full-crate clippy run against its new `compile_preview`
signature. The flaw: "restore byte-identical" means identical to R1's
*snapshot*, not to the file's live state — so every edit I made to those
three files during R1's patch-verify-restore window was silently reverted
to R1's pre-patch snapshot. This happened **repeatedly** (at least 4 times
across the session) and was NOT visible as an error — `Write`/`Edit` calls
reported success each time; only a fresh `grep` for stale patterns (e.g.
`EdgeKind::Conditional`, `pub condition`) after later, unrelated tool calls
revealed the revert.

**Detection technique that worked:** after any suspicious "file modified
on disk since you last read it" system reminder, or before declaring a
zone-file done, `grep -c` for the exact stale strings your edit removed
(not just the new strings your edit added — a revert leaves the OLD
strings present again, which a "does my new content exist" check would
miss if it only greps for additions in isolation). Cross-check node-level
vs edge-level edits separately: in this incident, `MemoryNode` field
edits (`root_load`, `infer_role`, `edge_kind_slug`) persisted through
several revert cycles while `ImportProposedEdge`/`PendingRef`/`push_edge`
(the specific region R1's compile_preview-signature patch touched)
reverted every time — a *partial*, boundary-shaped revert pattern is a
strong tell that it's a scoped foreign-lane patch-restore, not random
corruption or a full-file overwrite.

**Resolution:** tech-lead was notified by R3 independently (same
mechanism hit `taskctx.rs` twice) and told R1 to stop. After that,
`import.rs`/`import/tests.rs`/`lint/tests.rs` held stable through a full
`cargo test --all-targets` + `cargo clippy --all-targets -- -D warnings`
pass (717 lib + 18 CLI + 16 MCP tests, all green). **General lesson:**
never use scratch-patch-and-restore on a file outside your own zone, for
any reason — accept red tests instead (the whole tree is red until
integration by design) or stop and report. If you observe your own
zone's file reverting with no error, do not assume you're wrong — verify
byte-for-byte with `grep`, and if genuinely external, re-land your own
work (you're the owner) and flag the pattern precisely (which region
reverted, in sync with which other lane's plausible work) so tech-lead
can size the blast radius.

## `edge-legality-warning` — no Rust source of truth exists; re-derived by design

WO13_CONTRACT.md §7.3's edge-legality matrix (`legalityFor`) is specified
as a TS module (`src/config/edgeRules.ts`, lane T1) with **no Rust mirror
planned by any lane** in the file-zone grid — yet §11.2 lists
`edge-legality-warning` as a lint check, and lint.rs is Rust-only and may
not import TS. Re-derived the frozen §7.3 table (11 named rules + the
1 cross-group `overrides` warn rule = 12 total) as a private
`EDGE_LEGALITY_RULES` const array + `legality_for` matcher inside
`lint.rs`, keyed against the **contract's own frozen text**, not against
`edgeRules.ts` — the same cross-language-boundary tradeoff this exact
file already made for its cycle detector (re-derived from `project.rs`
rather than importing `compile.rs`, per the WO03 contract). Flagged as a
drift risk in the module doc: the two implementations can diverge since
nothing pins them to each other (no shared fixture corpus, unlike
`resolveLoad`'s `resolve_load_cases.json`). Worth a differential test
once `edgeRules.ts` lands, mirroring the WO03 D9 fix-round precedent that
added a differential cycle-detector test after the fact.

## Serde gotcha: enum-level `rename_all` does NOT reach fields inside struct variants

```rust
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LintFix {
    DropEdge { edge_id: String },   // still serializes as "edge_id", NOT "edgeId"!
    ...
}
```
The enum-level `rename_all` renames the **variant name** (the `kind` tag
value) only. To camelCase fields *inside* a struct-like variant, add
`#[serde(rename_all = "camelCase")]` directly on that variant too (valid,
supported syntax — serde applies the per-variant attribute to that
variant's own fields). Caught by a wire-shape test
(`lint_fix_serializes_tagged_camel_case`) asserting the literal JSON
string, not just `serde_json::from_str::<LintFix>` round-tripping (which
would have silently accepted the wrong casing on both sides). **Any
future internally-tagged enum with struct-variant fields in this codebase
needs the same per-variant attribute** — this is the first one in the
crate, so there's no existing precedent to copy from; check for this
explicitly during review.

## `orphan-node`/`unreachable-import` test-fixture trap: an unpinned "root" node is a genuine orphan under v5

`resolveLoad` rule 11 (orphan) fires for ANY node that is not `deprecated`,
not `command`/`skill`-role, not in the `AlwaysClosure`, and has nothing
(`references` or `imports`) pointing at it — **including a node that is
itself the SOURCE of outgoing edges but has no incoming ones and is not
`rootLoad: "always"`**. This is intentional (the whole point of the check
is "will this ever reach an agent"), but it silently broke 4 pre-existing
"clean graph" test fixtures carried over from WO03 that used a plain
`node("a", ...)` as the edge source with no `rootLoad`. **Fix pattern:**
any lint-check test graph with an edge `source --edge--> target` where
`source` isn't the *subject under test* needs `always(source)` (or an
incoming edge into it) so it doesn't independently trip `orphan-node` and
pollute the assertion. Tests using `.find(|i| i.code == X)` (existence of
one specific code) are unaffected; tests using
`!codes(&items).contains(&Y)` or `items.is_empty()` are the ones that
break, since they implicitly assert *nothing else* fires either.

## `AddImports` fix omitted (`None`) for `orphan-node`/`unreachable-import` — a judgment call, not full contract literalism

§11.2's table lists `AddImports` as the "Fix" for both `orphan-node` and
`unreachable-import`, but unlike `sequence-not-co-resident` /
`override-not-co-resident` / `duplicate-imports` (where the triggering
edge's own `(source, target)` is the natural, already-known pair to feed
`LintFix::AddImports`), an orphan/unreachable node has **no existing edge
to reuse** — there is no principled "add an import FROM WHERE" answer the
backend can determine unambiguously. Shipped `fix: None` for these two
checks specifically, with a code comment explaining the reasoning, rather
than inventing a plausible-looking but arbitrary source id. Flagged as a
deviation in the lane report rather than silently deviating.

## `import.rs` v5 edge design: `ImportProposedEdge.guard: Option<EdgeGuard>` replaces `condition: Option<String>`

A `.mdc`'s `globs:` frontmatter value is comma-joined on disk (same
direction `compile.rs::emit_cursor` writes it) — the importer splits it
back into `EdgeGuard::Glob { globs: Vec<String> }` directly, **never**
via `project::is_glob_condition` (that predicate classifies free-text
`conditional` conditions of unknown shape; a `.mdc`'s `globs:` key is
definitionally already a glob list, so classification doesn't apply).
`ImportProposedNode.pinned: bool` stays a plain proposal-local field
(unrenamed) mapping to `root_load: Some(RootLoad::Always)` only at
`import_apply` time — matches the Stage-0 sweep precedent of leaving
domain-shaped UI fields alone when they aren't literally a `MemoryNode`
field (see [[wo13-stage0-schema-seam]]).

## Fix round (WO13_AUDIT.md, same session): D8, D11b, D12

**D8 — `edge-legality-warning` now fires at `Error` for `Deny`, same code.**
Waited for Stage-0 D7 (`src/store/graph.ts`'s `updateEdge` legality gate) to
land before finalizing severity — confirmed via `edgeLegalityResolver` call
+ `if (legality === "deny") return false;` in `updateEdge`. Once that gate
exists, a `deny`-legality edge surviving into a *loaded* graph only arrives
via `import_apply`/`preset_apply` (write `graph.json` directly, never
re-enter the store) or undo/redo resurrecting a snapshot — genuinely
exceptional, so `Severity::Error` is correct. Both `Warn` and `Deny` share
one `edge-legality-warning` code and the same verbatim `reason`.

**D11b — `handoff.rs` (newly assigned, 4th unowned-file gap this WO).**
Two silent v4-leftover regressions, exact D11-class shape ("a private
tolerant wire projection invisible to the compiler once the field it names
is renamed"): (a) `NodeIn.pinned: bool` always deserialized `false` since
v5 sends `rootLoad?: "always"`, not `pinned` — the handoff prompt's
`", pinned"` annotation silently went dead with a test that only proved the
OLD field name still worked when hand-supplied, never that real v5 payloads
carry it. Fixed by reading `root_load: Option<String>` instead. (b)
`HandoffNodeProposal.role` was hardcoded `"reference"` (deleted in v5) with
a doc comment asserting "ALWAYS reference" — caught only by
`HandoffNodeProposalModal.tsx`'s client-side fallback substituting
`architecture` without stamping `needsReview`. Fixed to emit
`"architecture"` directly (matches `migrate_graph`'s and `import.rs`'s own
unknown-role fallback). **Lesson for future unowned-file discoveries:**
always add a regression test that uses the CORRECT v5 wire key name in the
JSON fixture, not just a renamed struct field — the original bug's test
passed for months because its JSON literal used the old key by hand.

**D12 — `AddImports` fix suppressed when the suggested edge would itself be
denied.** `sequence-not-co-resident`/`override-not-co-resident` share
`check_not_co_resident`, which now checks
`legality_for(source_role, EdgeKind::Imports, target_role, target_deprecated)
== Deny` (the SAME matcher `edge-legality-warning` uses, no second
predicate) before attaching `LintFix::AddImports`; `fix: None` otherwise.
`DropEdge` (structural-edge-into-deprecated, duplicate-imports) and
`RetypeNode` (command-may-be-env) needed no change — deleting an edge or
retyping a node is never legality-gated, only *creating*/*updating* one is.
**Trap hit while writing the regression test:** a deprecated node whose
role is `architecture` is NOT an unambiguous deny case for `imports` — rule
4 (`*, imports, architecture → warn`, specificity score 3) outscores rule 3
(`*, *, @deprecated → deny`, score 1) under the frozen §7.3 scoring
formula, consistently on both the Rust and TS (`edgeRules.ts`) sides (same
`score >= best.score`, later-wins-tie algorithm) — confirmed this is a real
frozen-table consequence, not a divergence, by reading `edgeRules.ts`'s
`legalityFor` before treating it as a bug. Test fixtures proving "denied →
no fix" must pick a target role/edge-kind combination with no competing
higher-specificity rule (e.g. `workflow`, not `architecture`, for a
deprecated `imports`-target fixture) — `architecture` only unambiguously
denies under `references`/other non-`imports` kinds.

**`too_many_arguments` refactor note:** adding the `graph: &BarnGraph`
parameter to `check_not_co_resident` pushed it to 8 args, tripping
`clippy::too_many_arguments`. Fixed by bundling the per-caller-fixed
`(kind, code, severity, message)` quad into a `NotCoResidentSpec` struct —
cheaper than `#[allow]` and keeps each call site's frozen text in one
place. Worth remembering as the default move whenever a fix-round adds one
more parameter to an already-large check-function signature in this file.

## D15 (HIGH, Amendment 3) — deprecated-target deny hoisted out of the scored table

The D12 fix-suppression regression test trap (documented above: an
`architecture`-role deprecated target isn't unambiguously `Deny` under
`imports`) turned out to be the whole bug, not a corner of it: the
`{*, *, @deprecated}` row scored **1**, the lowest score in the table —
every one of the other 11 rules (all scoring ≥2) outranked it. Confirmed
by tech-lead (WO13_AUDIT.md D15) and applied as Amendment 3: deprecation is
now a PRECONDITION in both `legality_for` (lint.rs) and `legalityFor`
(edgeRules.ts), checked and returned **before** the specificity loop runs
at all — `EdgeRule.target`/`LegalityTarget` cleanly become `NodeRole | "*"`
(no more `@deprecated` union member/variant). Both halves landed in one
lane (`src/config/edgeRules.ts` granted to R2 for this one change — §17's
own rule that a mirror pair must never split across lanes; do not touch
anything else in T1's zone).

**One report per edge (new rule, not present before D15):**
`check_edge_legality_warning` now SKIPS the deprecation-deny for
`imports`/`sequence`/`overrides` (`EdgeKind::is_structural()`), since
`check_structural_edge_into_deprecated` already owns those and carries the
`DropEdge` fix. For `references`/`contradicts` (no structural check
watches them), `edge-legality-warning` remains the sole and only report.
Implemented as one condition: `if target.deprecated.is_some() &&
e.kind.is_structural() { continue; }`, placed before the
`legality_for` call in the loop.

**A `dead_code` trap from removing a table row:** deleting the
`@deprecated` row (the only rule using `kind: LegalityKind::Any`,
i.e. matching every edge kind) made `LegalityKind::Any` itself
unconstructed anywhere in `EDGE_LEGALITY_RULES`, tripping
`clippy::dead_code` even though the MATCH arm handling it is still live
code (dead-code analysis cares about construction sites, not match arms).
Fixed with a scoped `#[allow(dead_code)]` + a comment explaining it mirrors
`edgeRules.ts`'s still-general `EdgeKind | "*"` union rather than deleting
the variant — worth remembering as the generic shape of this trap whenever
a fix round removes the one rule/case that was exercising a general-purpose
enum variant.

**Standing lesson, tech-lead's framing, worth repeating verbatim:** this is
the **second** time a Rust/TS mirror pair agreed with each other while both
diverged from the contract text (after D5's `always_closure` seed
handling). *"Audit a mirror against the contract text, never against its
twin."* An unpinned mirror pair (no shared fixture corpus) is now treated
as an incomplete deliverable, not a tolerable risk — `resolveLoad` already
had `resolve_load_cases.json`; `legalityFor`/`legality_for` now has
`tests/fixtures/edge_legality_cases.json` (created this round, since it
didn't exist yet when D15 landed — tech-lead-owned going forward, same
"hand-authored, no lane may edit" status as the resolveLoad corpus).

**A tie case has no natural production collision.** The frozen 11-row
table has no two rules that ever match the exact same `(source, kind,
target)` triple at equal specificity — every fully-specific rule differs
in at least one field from every other. The existing TS "later entry wins
on an exact score tie" test (predates this session) already handles this
correctly by re-deriving the scoring function over a tiny LOCAL synthetic
table rather than trying to find a real collision — confirmed this is the
right, and only, way to test the tie-break mechanism, and left that test
untouched. The shared JSON corpus intentionally does NOT attempt a tie
case for this reason (documented in the fixture's own `note` field).
