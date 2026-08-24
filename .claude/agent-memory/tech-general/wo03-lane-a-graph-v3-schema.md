---
name: wo03-lane-a-graph-v3-schema
description: Judgment calls behind the WO03 graph v3 schema bump in project.rs/preset.rs/graph.ts — read before touching graph.json schema, compile.rs's edge-kind handling, or any new Rust module (import.rs/lint.rs/cowtext_lib bin) that needs to parse graph.json.
metadata:
  type: project
---

WO03 Lane A (graph-v3, landed 2026-08-19) built a **full canonical Rust-side
graph schema** in `src-tauri/src/project.rs` (`NodeRole`, `EdgeKind`,
`CompileTarget`, `Position`, `ScenePos`, `MemoryNode`, `MemoryEdge`,
`BarnGraph`, `GRAPH_VERSION`, `migrate_graph`, `serialize_graph`) even though
**before this lane, `project.rs` had zero graph schema** — `read_graph`/
`write_graph` were (and still are) raw string pass-through; the entire
schema/migration/serialization lived only in `src/store/graph.ts`.

**Why:** WO03's contract requires `cargo test`-provable migration/round-trip/
determinism tests, and there is no frontend test runner in this repo. More
importantly, WO03 Lanes C (`cowtext-cli`), D (`import.rs`), and E
(`lint.rs`) are Rust modules that run **without a webview** — they can't
lean on `src/store/graph.ts`'s migration logic at all. So Lane A had to
stand up a real Rust model, not just mirror types in TS. `EdgeKind::
is_structural()` is the specific shared predicate Lanes B/E are contracted
to call instead of re-deriving the Kahn-participation split.

**How to apply:** If you're Lane B integrating `overrides` into
`compile.rs`'s Kahn implementation, or Lane E building the linter, prefer
`crate::project::{EdgeKind, NodeRole, MemoryNode, MemoryEdge, BarnGraph,
migrate_graph, serialize_graph}` over hand-rolling a parallel tolerant
parser — but note `compile.rs`'s own `EdgeKindIn`/`RoleIn`/`TargetIn` are
deliberately *more* tolerant (they have `#[serde(other)] Unknown/Other`
fallbacks for forward-compat with graph.json values the compiler doesn't
know about yet); the new `project.rs` types are a **closed** schema (no
fallback variant) since they're meant to be the source of truth, not a
tolerant reader. Don't assume they're interchangeable without checking.

## The dead_code / `-D warnings` trap for "infra ahead of its consumer"

`cargo clippy -- -D warnings` (no `--tests`) does **not** compile
`#[cfg(test)] mod tests` — so `pub` items with no caller anywhere in
non-test code trip `dead_code` as a hard error under `-D warnings`, even
though `cargo test` (which does compile tests) sees them as used. This bit
Lane A immediately: the new schema had no caller yet (Lanes B/C/D/E hadn't
landed), only tests.

**Fix pattern used:** wrap the whole not-yet-consumed section in a private
submodule with one documented `#[allow(dead_code)]`, then
`#[allow(unused_imports)] pub use that_module::*;` to re-export flat so
callers still see `crate::project::MemoryNode` etc. (the re-export itself
also needs the allow, one level up, for the same reason). This is the
reusable move any lane should reach for when landing library-surface code
ahead of the module that will actually call it — cheaper and more honest
than premature/fake wiring into an unrelated command just to silence the
lint. Should mostly self-resolve (allow becomes inert) once a real caller
lands; worth a cleanup pass in the tech-lead audit if the `#[allow]` is
still doing real work by the time all WO03 lanes have merged.

## Contract count-vs-enumeration mismatch: node roles are 13, not 12

`docs/_archive/contracts/WO03_CONTRACT.md` says "Node role enum 7 → 12" but its own
explicit enumeration (7 existing + `command, invariant, trap, skill,
snippet, style` = 6 new) lists **13** values. Lane A implemented the
explicit list verbatim (didn't drop a named role to force the count to
12) — flagged here and in code comments (`project.rs`'s `NodeRole` doc,
`graph.ts`'s `NodeRole` doc) for whoever runs the tech-lead audit to
reconcile the contract text, not silently resolved.

## Known consumer breakage from the union widening (not fixed — out of zone)

Widening `NodeRole`/`EdgeKind`/`CompileTarget` in `src/store/graph.ts`
breaks `npm run build` in exactly 7 places outside Lane A's zone (verified
via `npx tsc --noEmit` after the change — do not assume this list is stale
without re-running it):

- `src/App.tsx:228` — `COMPILE_TARGET_META: Record<CompileTarget, ...>` (missing copilot/gemini)
- `src/canvas/MemoryEdge.tsx:18` — `STROKE: Record<EdgeKind, ...>` (missing overrides/supersedes/conflicts-with)
- `src/canvas/RoleGlyphs.tsx:9` — `PIXELS: Record<NodeRole, ...>` (missing the 6 new roles)
- `src/canvas/roleMeta.ts:7` — `ROLE_DESCRIPTIONS: Record<NodeRole, string>` (same)
- `src/wizard/NodeWizard.tsx:35` — `TARGET_LABEL: Record<CompileTarget, string>` (missing copilot/gemini)
- `src/wizard/roleSkeleton.ts:14` — `SECTIONS: Record<NodeRole, Section[]>` (missing the 6 new roles)
- `src/scene/sceneGraph.ts:93` (`propForRole`) — exhaustive `switch(role)` with no default, TS2366. **Notable: `src/scene/` is explicitly declared out-of-scope for every WO03 lane ("Zero barn lanes"), yet this file still breaks the build** — a real scope gap someone (dispatcher or an ad-hoc scene touch) needs to resolve; no WO03 lane currently owns fixing it.

Non-breaking but semantically incomplete once new roles/kinds exist (didn't
error, so `npm run build` doesn't catch them — worth a manual pass):
`RoleGlyphs.tsx`'s `PATHS` (derived + `as` cast, compiles but new roles get
an empty glyph path), `scene/sfx.ts`'s `readCueForRole` (ternary chain has
a fallback, new roles get "page_flip"), `canvas/KindPicker.tsx`'s `KINDS`
array (not exhaustive, new edge kinds just don't appear in the picker
until someone adds them), `identity/identity.ts`'s `Role` type (a
structurally-decoupled mirror by design, comment says "seven-role list" —
now stale prose, not a type error).

## Preset version handling: two more layers beyond `preset.rs`

`src-tauri/src/preset.rs`'s `validate_preset` now accepts version 1/2/3
(widened for WO03) and this is fully tested. But
**`src/preset/types.ts`'s `parsePreset()` still hardcodes
`p.version !== 1` → reject**, and `CowtextPreset.version` is typed as the
literal `1`. That file is not in Lane A's zone (not one of the three named
files), so this wasn't touched — but it means a real v2-or-v3-saved preset
would be rejected client-side even though Rust happily accepts it. Whoever
picks this up (likely Lane F, "graph.ts consumers") needs to widen that
check too or the Rust-side "auto-upgrade" work has no visible effect.

## Audit fix round (D5, D6, D10) — 2026-08-19

`docs/_archive/contracts/WO03_AUDIT.md` (tech-lead, adversarial) found three defects in
this lane, all fixed in the same session:

- **D5 (collation mismatch):** `project.rs`'s `serialize_graph` sorted ids
  by `String::cmp` (byte order) while `graph.ts`'s `serializeGraph` sorted
  with `.localeCompare()` (ICU) — a real bug even though I could not
  reproduce the audit's exact adversarial-pair example flipping sign in a
  plain Node.js sandbox (Node's default `localeCompare` with
  `ignorePunctuation:false` happened to agree with byte order for that one
  pair when I checked; it only flips with `ignorePunctuation:true`
  explicitly). Fixed anyway — TS side made authoritative per the audit's
  own recommendation, `graph.ts` now has a `compareIds` helper doing plain
  `<`/`>` comparison, no ICU dependency at all. **Why fix a bug I couldn't
  reproduce:** `localeCompare` behavior is locale-data/runtime-version
  dependent by design (Tauri's WebView2 has different ICU data than my
  Node sandbox), so "didn't reproduce in Node" is not evidence the app
  (WebView2) doesn't hit it — removing the locale dependency entirely is
  correct regardless. Pinned with a Rust-side fixture test using the
  audit's exact pair (`"m1abc-x9"` / `"m1abcd-y9"`).

- **D6 (strict vs tolerant model) — the interesting judgment call:** the
  audit's two suggested fixes both reach outside this lane's zone: (1)
  `#[serde(other)]` on `NodeRole`/`EdgeKind`/`CompileTarget` requires those
  enums to gain a new variant, which breaks two **exhaustive, no-wildcard**
  `match` statements outside this zone — `import.rs`'s `edge_kind_slug`
  (~line 1057) and `lint.rs`'s `edge_kind_name` (~line 154), both Lane
  D/E's files; (2) making `lint_run` catch the `Err` and turn it into a
  `LintItem` requires editing `lint.rs` directly. Neither is available
  without crossing zones. **Resolution actually shipped:** keep the enums
  CLOSED (no new variant, so zero ripple into import.rs/lint.rs) and
  instead added a raw-JSON coercion pre-pass inside `migrate_graph`
  (before typed deserialize): unrecognized node role → `reference`
  (matches `src/preset/types.ts`'s `asRole` fallback precedent), unrecognized
  edge kind → `references` (non-structural, same class as `compile.rs`'s
  own `EdgeKindIn::Unknown`), unrecognized compile target → dropped from
  the array. This satisfies the audit's core ask (`migrate_graph` must
  not `Err` on a graph the app itself considers valid) entirely within
  `project.rs`. **Tradeoff, stated explicitly per the audit's own escape
  hatch ("if you cannot [preserve unknown values], say so explicitly"):**
  the original unrecognized string is NOT preserved on round-trip — it's
  silently normalized to a safe default. `Position`/`ScenePos` fractional
  coordinates were the fully self-contained part of D6 (no cross-file
  ripple risk — public struct shape is unchanged, only the `Deserialize`
  impl got more lenient): replaced the derived `Deserialize` with a manual
  impl that reads `f64` and rounds, same pattern for both structs.
  **If someone later wants full unknown-value fidelity:** would need to
  first add wildcard/default arms to `import.rs:edge_kind_slug` and
  `lint.rs:edge_kind_name` (outside this lane), then widen `EdgeKind` (and
  similarly `NodeRole`/`CompileTarget`) with an `Other(String)` variant plus
  a hand-written `Serialize`/`Deserialize` impl (not `#[serde(other)]`,
  which only supports unit variants) to actually carry the original string.
  Flagging as a possible follow-up, not done here.

- **D10 (stale "7 → 12" comments):** the underlying contract text was
  corrected by tech-lead during the audit (ratified 13 in
  `WO03_AUDIT.md` §4.5), so the fix was to delete the "flagging a
  discrepancy" prose entirely in both `project.rs` and `graph.ts`, not
  just fix the number — there's no more discrepancy to document.

**Tooling note:** the Bash tool here appears to run inside another layer
that single-quote-wraps the whole command, so any apostrophe in heredoc
*content* (e.g. "typo'd", "doesn't") breaks the outer shell quoting with a
confusing `unexpected EOF` error that looks unrelated. Fix: write the
Python (or other) script to a file first (Write tool, using the
session scratchpad dir) and run it with `python3 /path/to/script.py`
instead of a `python3 - <<'EOF' ... EOF` heredoc, whenever the content has
apostrophes or nested quotes.
