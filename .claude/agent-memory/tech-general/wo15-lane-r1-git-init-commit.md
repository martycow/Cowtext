---
name: wo15-lane-r1-git-init-commit
description: WO15 R1 git.rs — GIT_CONFIG_GLOBAL env seam through run_git, why the .gitignore appender is tested at helper level, the transient cross-lane dead_code signal, and what `git add` really does with an empty-dir pathspec (audit F3)
metadata:
  type: project
---

WO15 lane R1 (2026-08-21/22) added `GitStatus.identity_name/email`,
`git_init(root, branch, commit) -> GitInitResult`, the four `pub(crate)`
consts and a `.gitignore` create-or-append to `src-tauri/src/git.rs`.
Judgment calls worth keeping:

**Second test seam: `GIT_ENV_OVERRIDE`.** `run_git` now delegates to
`run_git_env(root, args, extra_env)`. A `thread_local!` env map (same
reasoning as the existing `GIT_BIN_OVERRIDE` — a process-wide static would
race concurrent `#[test]` threads) lets a test point `GIT_CONFIG_GLOBAL` at
a temp file and set `GIT_CONFIG_NOSYSTEM=1`, which is the ONLY way to test
"identity missing" on a dev box that has a global `user.name`.
`GIT_CONFIG_GLOBAL` replaces both `~/.gitconfig` and the XDG file but needs
git >= 2.32 — the identity tests silently depend on that. `extra_env` is
applied AFTER the thread-local map on purpose, so the commit's own
`GIT_TERMINAL_PROMPT=0` hardening can never be weakened by a test.

**`.gitignore` idempotency is only testable at helper level.** A second
`git_init` on the same folder takes the D-15 existing-repo skip path, so
"call it twice, expect byte-identical" is invisible from outside; the tests
call the private `ensure_gitignore_lines` directly (no git needed at all).

**The contract's append shape is literal.** `<eol>{MARKER}<eol>` + missing
lines: the LEADING `<eol>` is both the blank separator after an existing
newline-terminated file and the "file lacking a trailing newline gets one"
guarantee. Don't "fix" it by normalising the file first — that would modify
bytes the contract says are never modified. `<eol>` is CRLF iff the file
already contains one anywhere.

**Cross-lane transient `dead_code`.** The sibling Rust lane (R2) compiling
the same crate mid-edit reported three `dead_code` errors at `git.rs:84` and
`git/tests.rs:40,52` — exactly `set_git_env_override` and the two config
helpers, in the window between defining them and appending the tests that
call them. Under `-D warnings` an unused `#[cfg(test)] pub(crate)` helper IS
an error. Expected noise when two lanes share a crate; report, never fix,
and it disappears at the author lane's own final gate. See
[[wo13-lane-r2-lint-import-frontmatter-agents]] for the worse version of
this (actual file clobbering).

**Fix round (2026-08-22), audit F3 — `git add` tolerates an EMPTY existing
directory.** The audit predicted (by reading, not running) that
`git add -- .gitignore .cowtext context` dies with "pathspec 'context' did
not match any files" when `context/` exists but is empty. Measured on git
2.45.1.windows.1: **exit 0**. `builtin/add.c` only dies when
`!seen[i] && !path_exists(path)` — an empty directory *exists*, so a literal
pathspec pointing at one is silently a no-match-but-fine. A directory holding
only ignored content (`.cowtext/` with just `cache/`) is also exit 0. Only a
genuinely ABSENT path is fatal (exit 128). So the pre-existing `exists()`
filter was already sufficient in practice; `holds_stageable_content` (a
symlink-safe, iterative, "≥ 1 non-directory entry anywhere beneath"
probe) is hardening + a regression guard, not a live bug fix. Worth
remembering as a method point: an audit finding about a *shelled-out tool's*
behaviour is a hypothesis until it is run — a 30-second probe in the
scratchpad settles it, and the answer changes how the fix is described.

**Count correction:** the dispatch prompt said "keep all 37 existing tests
passing"; `git/tests.rs` actually had 28. Final: 42 (28 + 14 new).
Baseline `preset.rs:219-227` empty-graph tolerance (A-6) verified by reading
— `graph_path.exists() && !graph_is_empty(...)` is already the guard, no
edit was needed. Prior git work: [[wo13-lane-rgit-init-branch-truth]].
