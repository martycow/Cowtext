---
name: wo12-lane-f8-mcp-server
description: cowtext-mcp stdio JSON-RPC server (F8/WO12) — design decisions behind dispatch()/tool_manifest()/handle_message() in src-tauri/src/bin/cowtext_mcp.rs
metadata:
  type: project
---

Built the second bin target `cowtext-mcp` (F8, WO12) exposing 14 Cowtext
tools to Claude Code over stdio JSON-RPC 2.0, newline-delimited (not LSP
framing). Files: `src-tauri/src/bin/cowtext_mcp.rs`, `.mcp.json` (repo
root), `docs/design/MCP_SERVER.md`. lib.rs bumped `agents`/`tasks`/`taskctx`
private `mod` → `pub mod` (same E0603 mechanism WO03 Lane C used for
compile/import/lint/project); `project.rs`'s `scan_root` went
`pub(crate)` → `pub`. Neither touched `generate_handler!`.

**Judgment calls, in case this surface changes again:**
- `cowtext_graph_read` `Err`s when no `.cowtext/graph.json` exists yet
  (message points at `cowtext_graph_write`), rather than synthesizing an
  empty default graph — matches `cowtext-cli`'s existing idiom
  (`read_graph → migrate_graph → serialize_graph`, copied verbatim) and
  keeps "no graph" unambiguous for the model instead of silently faking one.
- `cowtext_task_append`'s `relPath` JSON-schema property is a **live**
  `enum` computed from `tasks::tasks_scan(root).files[].relPath` inside
  `tool_manifest(root: &Path)` — not hardcoded — because `tasks_scan`
  always reports exactly 5 entries (existing or not) regardless of project
  state, so this is safe to call even against a brand-new/empty root.
  `tool_manifest` therefore takes `root: &Path` (does real I/O), which is a
  looser sense of "pure" than "no side effects" — it just means
  synchronous/no-stdio/directly-unit-testable-without-a-socket, matching
  the CLI's 18-test precedent.
- Notification vs request is decided by **presence of the `id` key in the
  raw JSON object**, not by `Option::is_none()` after a normal struct
  deserialize (which would collapse an explicit `"id": null` into the same
  bucket as a missing key). Read via
  `value.as_object().and_then(|o| o.get("id")).cloned()`.
- Every delegated `Err(String)` — including "unknown tool" — surfaces as
  `isError: true` inside a normal JSON-RPC **result**, never as a
  `-32601`/JSON-RPC error object; those codes are reserved for protocol
  faults (bad method, unparseable JSON) per the frozen contract.

Verified live over stdio (not just unit tests): piped raw JSON-RPC lines
into the built `cowtext-mcp.exe --root <repo>`, confirmed
`notifications/initialized` produces zero output lines,
`tools/list` returns all 14 with the enum populated against the real repo,
and an unknown tool call round-trips as `isError:true` with no top-level
`error` key. 16 new Rust unit tests added (bin-local `#[cfg(test)]`),
workspace `cargo clippy -- -D warnings` and `--all-targets` both clean,
`cargo test --lib --bin cowtext-cli --bin cowtext-mcp` all green (624 lib +
18 CLI + 16 MCP at handoff time — lib count includes concurrent WO12 lanes'
in-flight work, not mine).
