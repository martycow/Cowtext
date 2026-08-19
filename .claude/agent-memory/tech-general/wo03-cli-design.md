---
name: wo03-cli-design
description: cowtext-cli surface design — subcommands, hand-rolled arg parser, exit-code policy, --json shape (WO03 Lane C, src-tauri/src/bin/cowtext_cli.rs)
metadata:
  type: project
---

Design record for `cowtext-cli` (WO03 Lane C), in case the implementation
needs to be revisited or re-derived. See [[wo03-lane-c-cowtext-cli-blocked-on-lib-visibility]]
for why it doesn't build yet as of 2026-08-19.

**Subcommands**: `compile --check` (required flag — the command has no
other mode, so it can never write), `lint`. Both accept `--root <PATH>`
(default: cwd) and `--json`. Hand-rolled parser (no clap — stack frozen),
pure function `parse_args(&[String]) -> ParseOutcome` fully unit-tested
without touching a filesystem.

**Exit-code policy** (documented in `--help` text, not just code):
- `0` success — compile: nothing drifted; lint: no `error`-severity finding.
- `1` a real finding — compile: drift OR a validation error (cycle/missing
  file/dangling edge — in that case no files are even compared); lint: at
  least one `error`-severity finding (warnings alone never fail CI).
- `2` usage/infrastructure failure — bad flags, missing/unreadable root,
  missing or unparseable `.cowtext/graph.json`. Chosen because the contract
  only pins down 0/1 for the drift-specific outcomes and separately asks for
  "clear message, non-zero exit, never a panic" on a bad graph file — 2
  cleanly distinguishes "CI should fail and look at the diff" (1) from
  "the invocation itself was broken" (2), a common Unix convention.

**compile --check flow**: `read_graph` → `migrate_graph` (graph is migrated
to current schema in memory, mirroring what the app does on open — the CLI
has no webview so must do this itself) → `serialize_graph` (canonical v3
JSON) → `compile_preview(root, that_json)`. Drift = any `PreviewFile` where
`unchanged` is false; `old_content.is_none()` distinguishes "new" from
"changed" for reporting. This is read-only by construction: `compile_write`
is never called anywhere in the CLI.

**lint flow**: `read_graph` → `migrate_graph` → `lint_graph(root, &graph)`
directly (not `lint_run`, to share one graph-load/migrate code path and
error-message style with the compile subcommand). No graph yet ⇒ empty
findings, not an error (matches `lint_run`'s own documented behavior).

**--json shape**: two report structs (`CompileCheckReport`,
`LintReport`), both `#[serde(rename_all = "camelCase")]`, with a `status`
string field (`"ok"|"drift"|"invalid"|"error"` for compile,
`"ok"|"problems"|"error"` for lint) plus `message` for infra failures.
Reuses `compile::ValidationError` and `lint::LintItem`'s own `Serialize`
impls directly rather than re-deriving wire shapes.
