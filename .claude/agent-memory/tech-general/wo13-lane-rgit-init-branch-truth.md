---
name: wo13-lane-rgit-init-branch-truth
description: git.rs is_repo_at (toplevel vs merely-nested) + probe_status unborn-branch fix; judgment calls for git_init/git_status truthfulness
metadata:
  type: project
---

WO13 lane R-GIT (2026-08-21) fixed acceptance defect 2 ("initialized Git,
picked a branch name, didn't see it") in `src-tauri/src/git.rs`. Two
independent root causes, both fixed:

**(a) Repo probe walked upward.** `git rev-parse --is-inside-work-tree`
answers "is `root` inside *any* work tree" — a project folder nested under
an unrelated outer repo read as "already a repo", so `git_init` silently
no-op'd and discarded the user's branch choice. Fix: new `is_repo_at(root)`
helper that additionally runs `git rev-parse --show-toplevel` and compares
the normalized result against `root` itself (via `worktree::display_path`,
lowercased on Windows) — true only when `root` **is** the toplevel, not
merely inside one. Used in both `probe_status` (so `GitStatus.is_repo` is
now truthful per-project) and `git_init`'s `already_repo` gate. Preserves
the D1b guarantee (re-running init on a real existing repo is still a
no-op) since toplevel == root in that case.

**(b) Unborn HEAD reported as no branch.** `probe_status` used
`git rev-parse --abbrev-ref HEAD`, which fails on a freshly-`git init`-ed
commitless repo (unborn HEAD) — so `GitStatus.branch` came back `None`
right after init even though `symbolic-ref` really had set it. Fix: swap to
`git symbolic-ref --short HEAD`, the exact fix `worktree.rs` D8 already
applied to its own `branch_name` helper for the identical failure mode —
same command, same doctrine, just not yet applied here. Still `None` on
detached HEAD (symbolic-ref fails there too) and on non-repos.

**Why (b) was worth pointing at (a)'s precedent:** `worktree.rs`'s D8 fix
comment explicitly said "fixing `probe_status` itself is out of this lane's
scope" (WO11-era note) — that scope boundary is exactly what WO13 closed.
If `git.rs` grows another unborn-HEAD-sensitive read, check
`worktree.rs:121-203` first; the pattern (split branch lookup into its own
`symbolic-ref --short HEAD` call, treat non-zero exit as `None` not error)
is already established there twice now.

**Wire shape unchanged.** No new `GitStatus` fields — populating the
existing `branch`/`is_repo` truthfully was sufficient; `GitWizard.tsx`
already gated its branch chip on `status.branch !== null`, so no frontend
changes were needed beyond mirroring the doc comments in `types.ts`.

See [[wo03-lane-a-graph-v3-schema]] for the codebase's other Windows-path
canonicalization precedent (`display_path` in `worktree.rs` is the one this
lane reused, not a new helper).
