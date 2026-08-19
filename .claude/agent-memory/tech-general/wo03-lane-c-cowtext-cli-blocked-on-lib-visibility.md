---
name: wo03-lane-c-cowtext-cli-blocked-on-lib-visibility
description: cowtext-cli (WO03 Lane C) is code-complete but cargo build --bin cowtext-cli fails until lib.rs's module declarations for project/compile/lint become pub mod
metadata:
  type: project
---

WO03 Lane C (`cowtext-cli`, second `[[bin]]` in `src-tauri`) is code-complete
at `src-tauri/src/bin/cowtext_cli.rs` + the `[[bin]]` entry in
`src-tauri/Cargo.toml`, but does not compile yet. Blocked as of 2026-08-19,
reported to the WO03 dispatcher rather than fixed directly (lib.rs is
outside Lane C's file zone).

**Root cause**: `src-tauri/src/lib.rs` declares `mod project;`, `mod
compile;`, `mod lint;` as *private* modules. A `[[bin]]` target in the same
Cargo package is still a **separate crate** from the `[lib]` target — Cargo
auto-links it, but ordinary cross-crate visibility rules apply. Only items
reachable through a `pub mod` chain from the crate root are visible outside
the crate; `pub fn`/`pub struct` inside a *private* `mod` are invisible to
any other crate, including a sibling binary in the same package. Confirmed
empirically: `cargo build --bin cowtext-cli` fails with 10× `error[E0603]:
module 'X' is private` for `project`, `compile`, `lint` — no other error
kinds present, so the CLI's own code is very likely otherwise correct.
`cargo build --bin cowtext` (the GUI) and `cargo test --lib` (329 tests)
are both unaffected — the `[[bin]]` addition is inert for the existing
binary.

**Fix needed** (3 lines in `src-tauri/src/lib.rs`, NOT in Lane C's zone):
```rust
mod project;   →  pub mod project;
mod compile;   →  pub mod compile;
mod lint;      →  pub mod lint;
```
Purely additive visibility change; touches nothing else (not the
`generate_handler!` list, not behavior). Lane A/B/E's own module doc
comments already anticipated this ("...so a future non-Tauri caller
(`cowtext-cli lint`, Lane C) can call it directly without a webview" in
`lint.rs`) — the `pub mod` flip in `lib.rs` appears to be the one piece
nobody's lane actually owned.

**How to apply**: whoever has lib.rs in scope (tech-lead audit, or a
lib.rs-owning lane) should make this 3-line change, then Lane C's existing
`cowtext_cli.rs` should build without further edits — verify with `cargo
build --bins`, `cargo clippy --all-targets -- -D warnings`, `cargo test`,
and the empirical exit-code fixture run (clean project → 0, then edit
`CLAUDE.md` → 1) that WO03 Lane C's acceptance criteria call for.
See [[wo03-cli-design]] for the CLI's own surface (subcommands, exit-code
policy, `--json` shape).
