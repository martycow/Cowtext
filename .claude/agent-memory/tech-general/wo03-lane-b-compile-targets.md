---
name: wo03-lane-b-compile-targets
description: Judgment calls behind the WO03 Lane B compile.rs changes — overrides ordering direction, the LinkStyle refactor, and the exact pure-core function surface Lane C (cowtext-cli) needs to extract.
metadata:
  type: project
---

WO03 Lane B (compile-targets, landed 2026-08-19) added `copilot` →
`.github/copilot-instructions.md` and `gemini` → `GEMINI.md` adapters to
`src-tauri/src/compile.rs`, and made the new `overrides` edge kind
structural in `total_order`'s Kahn implementation.

## `overrides` ordering direction — undocumented in the contract, resolved by literal re-reading

The WO03 contract (`docs/design/WO03_CONTRACT.md`) says `overrides` is
"STRUCTURAL — participates in Kahn/cycle validation and ordering" but never
states which direction (does the overriding node come before or after the
overridden one?). The Lane B dispatch prompt, however, contains the
resolving sentence almost in passing: "`overrides` edges participate in
cycle validation and topological ordering **exactly like `imports`**." I
took that literally: `overrides` uses the identical `(target, source)`
tuple as `imports` in `total_order` (i.e. `a overrides b` ⇒ `b` is ordered
before `a`, same as `a imports b` ⇒ `b` before `a`). If a future lane
(linter, docs) needs to describe `overrides` semantics in prose, this is
the authoritative direction — don't re-derive from first principles about
what "override" "should" mean; the dispatch prompt already settled it.

`effective_pinned` (the transitive-imports-closure that decides the
"Always read" set) was deliberately **not** widened to include `overrides`
— the contract only asked for cycle/ordering participation, and the
pinned-closure concept is a separate mechanism the WO03 contract doesn't
mention touching. `on_demand_bullets` (the `references`/`conditional`
prose-bullet renderer) also does not treat `overrides` specially — like
`sequence`, it's ordering-only and produces no bullet text of its own.

## `LinkStyle` refactor — safe because it's a pure rename of an existing bool split

`emit_root`'s old `claude: bool` parameter already encoded the same binary
split the two new targets need (`@path` inline-import vs plain markdown
link) — `gemini` reuses the `claude=true` branch verbatim, `copilot` reuses
the `claude=false` (`agents`) branch verbatim. Refactored into a
`LinkStyle { AtImport, MarkdownLink }` enum with `pinned_line`/
`inline_link` methods rather than adding two more bool branches or
duplicating `emit_root`. This is a pure rename — output bytes for
claude/agents are provably unchanged (see `v3_additions_do_not_change_legacy_target_output`
and the original golden tests, both still pass byte-for-byte). If a sixth
target ever needs a third link style, extend the enum, not another bool.

## Trap: forgetting `emit_nested_agents` fires whenever `agents`-family output is requested

Wasted a debug cycle here — the shared `golden_graph` fixture (used by
nearly every existing compile test) has a `conditional` edge with a clean
folder glob (`src/net/**`), which makes `emit_nested_agents` always
produce a `src/net/AGENTS.md` alongside root `AGENTS.md` whenever `agents`
is a requested target. Pre-existing tests like `golden_agents_output` never
noticed because they only inspect `p.files[0]` (root file is always first
in `produced`'s fixed order) and never assert `p.files.len()`. Any new test
that (a) reuses `golden_graph` and (b) requests `agents`/asserts a total
file count needs to account for this nested file, or use a fixture without
a clean-glob conditional edge.

## Pure compile core — exact surface for Lane C (`cowtext-cli`) to extract

Everything in `compile.rs` is already tauri-free except the two
`#[tauri::command]` wrapper functions themselves. The functions Lane C
needs, verbatim signatures as of this lane:

- `pub fn compile_preview(root: String, graph_json: String) -> Result<CompilePreview, String>`
  — the `#[tauri::command]` wrapper itself; its *body* has zero `tauri::`
  types other than the attribute macro, so Lane C can either call this
  function directly from the CLI bin (it's a plain `pub fn`, not behind
  `cfg(feature = "tauri")` or similar) or peel the attribute off a cloned
  copy. Simplest path: just call `cowtext_lib::compile::compile_preview`
  from `cowtext-cli` — the macro only adds IPC plumbing, it doesn't change
  the fn's Rust-level callability.
- `pub fn compile_write(root: String, files: Vec<ApprovedFile>) -> Result<Vec<String>, String>`
  — same story.
- Supporting pure types, all already `pub`: `CompilePreview { errors, files }`,
  `PreviewFile { rel_path, target, old_content, new_content, handwritten, unchanged }`,
  `ValidationError` (tagged enum: `Cycle { nodes }`, `MissingFile { .. }`,
  `DanglingEdge { .. }`), `NodeRef { id, title }`, `ApprovedFile { rel_path, content }`.
  All `Serialize`/`Deserialize` via serde, no Tauri involvement.
- `pub const GENERATED_HEADER: &str` — needed if the CLI wants to construct
  or check headers itself (e.g. for a `--check` diff against disk without
  going through `compile_preview`'s full validation).
- Everything else (`GraphIn`/`NodeIn`/`EdgeIn`/`EdgeKindIn`/`TargetIn`/`RoleIn`,
  `total_order`, `find_cycle`, `effective_pinned`, `classify_output`,
  `LinkStyle`, `Ctx` and its adapter methods, `yaml_scalar`, `is_glob`,
  `clean_glob_dir`, `has_header`) are private (`fn`/`struct` without `pub`)
  — Lane C does **not** need direct access to any of them; `compile_preview`
  is the only entry point that exercises the ordering/validation/adapter
  pipeline, and `compile_write` is the only entry point that exercises the
  allowlist. If Lane C's `compile --check` needs the *pure* preview
  computation without the two infrastructure-`Result::Err` paths
  `compile_preview` has (bad root, unparseable `graph.json`), it should
  still just call `compile_preview` and treat `Err` as a CLI-level
  infrastructure failure (non-zero exit, distinct from "drift found") —
  there is no lower-level function to peel it down to, by design (the
  module doc's Errors-XOR-files invariant is enforced at exactly this
  boundary).

No entanglement flags for Lane C: the only two functions with the
`#[tauri::command]` attribute are exactly the two Lane C already expects
(`compile_preview`, `compile_write`); nothing else in the file references
`tauri::` at all (confirmed by re-reading the full file after this lane's
edits — `use crate::project::{checked_root, resolve_within_root,
write_atomic}` is the only cross-module import, and none of those three
are Tauri types either).

See also [[wo03-lane-a-graph-v3-schema]] for the `EdgeKind::is_structural`
predicate this lane consumes (`crate::project::EdgeKind`, not re-derived —
`compile.rs`'s own `EdgeKindIn::is_structural` is a thin per-variant
delegator to it, kept because `EdgeKindIn` has to stay a *tolerant* parser
with a `Unknown` fallback that `project::EdgeKind` deliberately lacks).
