---
name: wo03-lane-e-linter
description: WO03 Lane E (lint.rs) design decisions — LintItem/Problems wire shape, the 9 LintCode values, the unresolved `overrides` cycle-direction convention Lane B needs to reconcile, and why cycle detection duplicates compile.rs's Kahn pass instead of importing it.
metadata:
  type: project
---

WO03 Lane E (linter v1, landed 2026-08-19) built `src-tauri/src/lint.rs` +
`src-tauri/src/lint/tests.rs` (23 tests) on top of [[wo03-lane-a-graph-v3-schema]]'s
canonical `project.rs` model. New invoke command `lint_run(root) ->
Problems`, wired into `lib.rs` as a pure append (`mod lint;` + one
`generate_handler!` entry, appended at the end of both lists — did not
reorder or touch anything else).

## Wire shape (Lane F builds the Problems panel against this — verify still
current before relying on it, grep `src-tauri/src/lint.rs` for `LintItem`)

```ts
type Severity = "error" | "warning";
type LintCode =
  | "cycle" | "missing-file" | "dangling-edge"       // graph-integrity, Error
  | "conflicts-with" | "duplicate-title" | "near-duplicate-content"
  | "readme-duplication" | "stale-last-verified" | "superseded-but-pinned"; // Warning

interface LintItem {
  code: LintCode;
  severity: Severity;
  message: string;        // human-readable, ready to render
  nodeIds?: string[];      // omitted (not []) when empty
  edgeIds?: string[];      // omitted when empty
  filePath?: string;       // omitted when absent
}
interface Problems { items: LintItem[]; }
```

Flat shape deliberately, not a tagged union per code — every check produces
the same 6 fields, frontend doesn't need to branch on `code` to read a
field. `cycle`'s `nodeIds` is the **ordered path with the first node
repeated as the last element** (matches `compile.rs`'s `NodeRef` cycle
convention). All other checks' `nodeIds`/`edgeIds` are unordered offender
lists.

## The `overrides` cycle-direction convention — independently guessed, then confirmed against Lane B

`EdgeKind::is_structural()` says `overrides` participates in Kahn's
algorithm, but neither the WO03 contract nor `project.rs` says *which*
direction (does the override read before or after what it overrides?).
Lane E picked "target before source" — same direction as `imports` — on
the theory that the overridden (base) content must be established before
the override is layered on top, before Lane B's `compile.rs` change had
landed (so there was nothing to check against at the time). **Confirmed
matching after the fact**: [[wo03-lane-b-compile-targets]] independently
settled on the identical `(target, source)` tuple for `overrides` in
`compile.rs`'s `total_order` (their dispatch prompt had the resolving
sentence "exactly like `imports`" — see that memory for the full
reasoning). So `lint.rs`'s cycle detection and `compile.rs`'s ordering
agree on `overrides` semantics; no reconciliation action needed. If either
module's `overrides` direction ever changes, re-check the other.

## Cycle detection duplicates compile.rs's Kahn pass on purpose

Contract explicitly forbids importing/modifying `compile.rs` from
`lint.rs`, and re-deriving via `project.rs`'s model was preferred over
"say so and skip it" — the ~60-line Kahn's-algorithm-plus-cycle-recovery
pair (`check_cycle`/`find_cycle` in `lint.rs`) is structurally identical in
shape to `compile.rs`'s `total_order`/`find_cycle`, just typed against
`MemoryNode`/`MemoryEdge` instead of `compile.rs`'s tolerant `NodeIn`/
`EdgeIn`. This is real, acknowledged duplication, flagged in both the
lane's final report and in a `lint.rs` module-doc comment — a future
refactor (not this WO) could extract a shared generic Kahn/cycle helper
into `project.rs` that both `compile.rs` and `lint.rs` call, but doing that
now would have meant touching `compile.rs`, which was out of zone.

## No date/time crate — hand-rolled Howard Hinnant civil-calendar math

`stale-last-verified` needed "days since an ISO `YYYY-MM-DD` date" and the
repo has zero date/time dependency (WO03 forbids adding one just for this).
`lint.rs::days_from_civil` is Howard Hinnant's public-domain
`days_from_civil` algorithm (the standard proleptic-Gregorian
days-since-1970-01-01 formula used by most date libraries internally) —
reach for this helper (or lift it) before adding `chrono`/`time` anywhere
else in this crate for a similar one-off calculation; it's exact and
`1970-01-01 => 0` is asserted by test.

## `near-duplicate-content` and `readme-duplication` are simpler than the name suggests

"Near-duplicate" = exact match of *normalized* content (whitespace-collapsed,
lower-cased) via a content hash — not fuzzy/approximate similarity; there is
no similarity-scoring crate available and adding one was out of scope.
"README duplication" = a node's non-trivial lines, normalized, overlap
README.md's own normalized line set by >= 70% (`README_DUP_LINE_OVERLAP`),
with a >= 3-line floor (`README_DUP_MIN_LINES`) so a one-line stub isn't
flagged for sharing a title line. Both thresholds are named constants at
the top of `lint.rs` — adjust there, not inline, if they prove too
strict/loose during the WO03 manual walk.

## Fix round (D9, tech-lead audit): differential test pinning the two cycle detectors

Audit finding D9 (minor) ratified the intentional duplication between
`lint.rs`'s `check_cycle`/`find_cycle` and `compile.rs`'s `total_order`/
`find_cycle` (different input types — compile's tolerant `NodeIn`/`EdgeIn`
vs lint's strict `MemoryNode`/`MemoryEdge` — unifying would mean generics
over a trait for two ~60-line functions, or forcing `compile.rs` onto the
strict model and inheriting its brittleness into the one path that must
never fail). What the audit did NOT ratify: no test noticed if the two
ever drifted apart, and this exact risk already materialized once (the
`overrides` direction was guessed independently in this lane, before Lane
B's `compile.rs` change landed, and only later confirmed to match by
reading [[wo03-lane-b-compile-targets]]'s memory — pure luck it agreed).

Fix: `lint/tests.rs` now has a differential corpus (`differential_*` tests)
that runs the same `BarnGraph` fixture through both `lint_graph` (direct
call) and `crate::compile::compile_preview` (via
`crate::project::serialize_graph` → JSON → the real command function,
called directly since it's a plain `pub fn` despite the `#[tauri::command]`
attribute) and asserts **exact** agreement — not just "both found a cycle"
but the identical ordered node-id path (first id repeated last). Fixtures:
acyclic, pure-`imports` cycle, pure-`overrides` cycle, a 3-node cycle
mixing all three structural kinds (`sequence`+`imports`+`overrides` in one
loop — hand-traced before writing so the exact expected path,
`["a","b","c","a"]`, could be asserted, not just cross-checked), and a
dangling-edge-adjacent-to-a-would-be-cycle case (proves dangling exclusion
happens before Kahn in both, so a stale edge referencing a nonexistent id
never manufactures a false cycle in either implementation).

**Result: zero disagreement found on any fixture.** Both implementations
produced byte-for-byte identical ordered cycle paths on every case,
including the mixed 3-kind cycle. This was not a given going in — it's
confirmed by the test now, not just asserted by prose. `pub mod compile`
(landed by Lane C's work between the initial build and this fix round) is
what made calling `crate::compile::compile_preview` from `lint/tests.rs`
possible without touching `compile.rs` itself — this lane's zone stayed
exactly `lint.rs` + `lint/tests.rs`, calling into Lane B's zone, never
editing it.
