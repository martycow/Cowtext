---
name: wo15-lane-r2-hooks-toolchain-agents-tasks
description: WO15 lane R2 — hooks_addr/BIND_ADDR unification, skills_materialize, AiTool.elapsed_ms + 3s, "in review" status alias, handler list 76→78. Judgment calls on the 4923 grep gate vs contract-verbatim doc text, and the all-or-nothing validation shape. Read before re-touching hooks.rs/hooks_server.rs/toolchain.rs/agents.rs skills code.
metadata:
  type: project
---

Landed 2026-08-21. Spec: `docs/design/WO15_CONTRACT.md` §3.3–§3.7, §6 "R2".
Zone: `hooks.rs`, `hooks_server.rs`, `toolchain.rs`, `agents.rs`, `tasks.rs`
(+ their `tests.rs`), `lib.rs` (handler list only).

**The gate beat the contract's verbatim code block — again.** §3.3's code
block ships a doc comment `/// "127.0.0.1:4923" — the one string …` on
`bind_addr_string()`. §6 R2's acceptance is `rg -n "4923" src-tauri/src`
matching *only* the const line + test files. Writing the doc verbatim
produces a second non-test match, so I reworded it to `"<host>:<port>"` and
moved the literal into `hooks_server/tests.rs`, which pins it anyway. Same
trap bit me twice: my first module-doc rewrite quoted the gate's own grep
pattern and reintroduced the literal. **Check the grep gate after writing
prose about the grep gate.** Standing lesson from WO13 applies verbatim:
the gate is the authority, not the enumeration.

**Judgment call — `has_frontmatter_block` rejects `---\n---\n`.** §3.4's
grammar is "starts with `---\n`/`---\r\n` AND contains `\n---` *after the
opener*". Stripping the opener first means a fieldless frontmatter block has
no `\n---` left and fails. Deliberate and commented: no bundled skill lacks
name/description, so an empty block is far more likely a truncated resource.
If a future built-in legitimately has an empty block, that's the line to
change (searching the whole content instead of the remainder would accept it).

**All-or-nothing validation is the whole point of the command, and every
other test passes without it.** `skills_materialize` validates the entire
`Vec<SkillInput>` (component guard · `preset::slugify(id)? == id` · dupes ·
frontmatter fence) before the first `write_atomic`, because the Skills rail
computes its `virtual`/`materialized`/`modified` badges from what is on
disk — a half-written batch produces wrong badges, not a visible error. The
regression test that actually protects this is
`materialize_with_a_bad_second_entry_leaves_the_first_unwritten`; a naive
per-entry loop is green on all the others. I/O failure mid-batch is
deliberately *different*: `Err` with earlier writes standing (the disk is
the fault, not the request), and the caller reloads.

`preset::slugify` is `pub(crate)` (`preset.rs:98`) — callable from
`agents.rs` without touching preset.rs. The id must *already equal* its
slug, not merely be slugifiable: `"Task Format"` and `"Task-Format"` both
slugify to `task-format`, and accepting either writes a directory whose
name the rail then can't match to its bundled id.

**No dead_code trap this round**, unlike [[wo11-lane-r2-agents-backend]]:
the same lane owned `lib.rs`, so both new commands were registered in the
same change and the plain-lib reachability graph saw them immediately.

§3.6 footnote: the contract says `task_update`'s file text is "unchanged
(`in testing`)", but the table writer has always written the *bucket id*
`in-testing` into the cell (`tasks/tests.rs`
`task_update_table_status_cell_writes_bucket_and_recomputes`). The alias is
input-only; nothing on the write path changed. Pinned by
`task_update_review_alias_writes_the_same_cell_as_in_testing`, which drives
`"in testing"` / `"In Review"` / `"review"` through `task_update` and
asserts one identical file text.

Gates at exit: `cargo test --all-targets` 782 lib + 18 CLI + 16 MCP, all
green · `cargo clippy --all-targets -- -D warnings` clean · handler list 78.
Mid-flight, R1's `git.rs`/`git/tests.rs` produced three `dead_code` errors
under `-D warnings`; reported, not fixed, and gone by the final run — the
contract's "foreign compile error is reported, not fixed" rule worked as
written. Note `cargo test` does *not* apply `-D warnings`, so a test run can
be green while clippy is red on the same tree.
