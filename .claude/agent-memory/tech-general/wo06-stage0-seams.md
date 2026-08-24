---
name: wo06-stage0-seams
description: WO06 Stage-0 seams pass (lib.rs wiring + tasklinks.rs/taskctx.rs stubs + mechanical edits to tasks.rs/sessions.rs/handoff.rs) — read before touching any WO06 lane (G1/G2/G3) that fills these bodies in.
metadata:
  type: project
---

WO06 Stage-0 (landed 2026-08-19) wired every new invoke command's *shape*
(54 → 63) with stub bodies returning `Err("<cmd>: not implemented (WO06
Stage-0 stub)")`, so lanes G1/G2/G3 could build in parallel against a
compiling `lib.rs` with zero contention. Full spec: `docs/_archive/contracts/WO06_CONTRACT.md`
§9.

**New modules created:** `src-tauri/src/tasklinks.rs` (+`tasklinks/tests.rs`)
and `src-tauri/src/taskctx.rs` (+`taskctx/tests.rs`), both declared as
**private** `mod` in `lib.rs` (no non-GUI consumer needs them, unlike
compile/import/lint/project which are `pub mod` for `cowtext-cli`).
Inserted alphabetically: `taskctx` < `tasklinks` < `tasks`, directly above
the pre-existing `mod tasks;`.

**Mechanical edits (not logic) in three existing files:**
- `tasks.rs`: appended `task_id_ensure`/`task_depends_add`/
  `task_depends_remove` stubs at EOF, under a banner comment. Lane G1's body.
- `sessions.rs`: `agent_session_spawn` gained 3 trailing `Option` params
  (`task_id`, `task_context`, `token_ceiling`) — now **9 args**, tripping
  `clippy::too_many_arguments` (threshold 7). Fixed with a narrow, documented
  `#[allow(clippy::too_many_arguments)]` since the contract freezes this
  exact signature (§7.1) — not something Stage-0 can restructure. Also:
  `SessionInfo` gained `tokens_used: u64`/`token_ceiling: Option<u64>`
  (appended last), single construction site updated (`RegistryCore::
  register`, `0`/`None`). Lane G3's body.
- `handoff.rs`: appended `HandoffSessionInput`/`HandoffNodeProposal` types +
  `handoff_node_propose` stub at EOF. Needed a new `use std::collections::
  BTreeMap;` import (wasn't there before). Lane G2's body.

**Two real clippy traps hit and fixed (`cargo clippy --all-targets -- -D
warnings`, which — unlike WO03's plain `cargo clippy -- -D warnings` — DOES
compile `#[cfg(test)] mod tests`, so this gate is stricter about catching
things but also gives tests a chance to "use" otherwise-dead items):**

1. **`unused import` on both `use super::*;` in the two trivial
   `tests.rs` files** (the test body is empty, so nothing from the parent
   module is referenced) — fixed by just deleting the import, not adding an
   `#[allow(unused_imports)]`. The contract's literal template for these
   files didn't show the import; don't copy the `use super::*;` idiom from
   real test files into a truly-empty placeholder test.
2. **`dead_code` on `HandoffSessionInput`'s fields** ("fields ... are never
   read") even though the struct derives `Deserialize` and is used as a
   real command parameter on a command that's wired into `generate_handler!`
   — confirms the WO03 memory's lesson generalizes to *field-level* dead-code,
   not just whole-type: a `Deserialize`-only struct's fields being
   *constructed* by the derive doesn't count as being *read*; only a
   `Serialize` impl (or hand-written field access) reads fields. Fixed with
   a narrow, documented `#[allow(dead_code)]` on the struct, since Lane G2's
   body is what will actually read them.

**Non-trap, confirmed empirically:** `TaskLink`/`TaskLinks` (tasklinks.rs)
and `TaskContext` (taskctx.rs) — all deriving `Serialize` and used as real
command return types — did NOT need any `#[allow(dead_code)]`; the
`#[allow(dead_code)]` was only needed for (a) the two never-referenced `pub
const`s in each new module (`TASKLINKS_VERSION`/`TASKLINKS_REL_PATH`,
`TASK_CONTEXT_DIR`/`TASK_CONTEXT_MAX_BYTES` — genuinely unused until a lane
body reads them) and (b) the `TaskContextError` enum (its variants are never
*constructed* anywhere yet — matching in a derived `Serialize` impl doesn't
count as construction, only literal `Variant { .. }` syntax does).

**Contract text was unambiguous and matched the real codebase exactly** —
no deviation filed. `sessions.rs:209-217`/`983` (contract's cited line
numbers for the `register` construction site and `agent_session_spawn`)
were accurate at time of Stage-0.

Gates at handoff: `cargo clippy --all-targets -- -D warnings` clean, `cargo
clippy -- -D warnings` (no `--all-targets`, extra paranoia check) also
clean, `cargo test` 371 lib + 18 cli = 389 (387 baseline + the 2 mandatory
trivial `*_module_compiles` tests §9.1 requires — an intentional, contract-
mandated exception to "don't add tests"), `npm run build` 0 errors, `npm
run lint` 0 errors / 1 pre-existing warning (`RoleGlyphs.tsx` react-refresh,
not mine). `generate_handler!` count verified at exactly 63 by hand-count
of the block.

See also [[wo03-lane-a-graph-v3-schema]] for the original dead_code/
`-D warnings` "infra ahead of its consumer" trap this generalizes.
