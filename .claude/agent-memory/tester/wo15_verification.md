---
name: wo15-verification
description: WO15 tester pass (2026-08-22) — gate results, the invoke/mount proofs, 14 audit findings with file:line, and the manual's structure; read before a WO15 fix-round re-verification
metadata:
  type: project
---

WO15 first tester pass (2026-08-22, worktree on top of 7646db9): all five gates green
(build · lint 0 err/16 warn · Vitest 276/17 · cargo 782+18+16=816 · clippy), invoke 78=78
both directions, all §4.15 mounts correct, truth T9/T12/T13 FAIL only on PM-owned prose.

**Why (what was non-obvious):**
- Lint "≤ 14 warnings" acceptance MISSES at 16: U4b removed AddAgentDialog's 2, but U3
  (`providerOf`, AgentEditor.tsx) and U2 (`isValidBranchName`, BranchPicker.tsx) each added a
  react-refresh warning. Attribute by diffing `^export` lines at HEAD vs worktree.
- Contract D-13 says `{provider, model}` go to the sidecar; §3.8 lists only `provider` — lanes
  followed §3.8, so a non-Anthropic model id is dropped while the badge says "kept locally".
- `addEdge` returns null on `deny` legality; "New agent from this node…" on a Command/Skill
  node promises an `imports` edge it never draws (NewAgentDialog ignores the return).
- The wizard's `branch main · 1 commit` line is unobservable on the success path (onDone fires in
  the same tick) unless "Install Claude Code hooks" is ON — the manual uses that trick.
- `pushLocal` rows vanish on Home (`closeProject` clears events) — the Toolchain scan row is only
  visible in the first project opened after launch/Rescan.
- The agents store never watches skill bodies: a disk edit to a materialized skill needs Home →
  reopen (or the Inspector "Rescan agents" button) before the badge flips to modified.

**How to apply:** on the fix round re-run the five gates + `npm run truth -- --no-cargo` and
re-check the 14 findings by file:line (report text in the session log); the manual is
`docs/testing/GOLDEN_PATH_MANUAL.md` (38 scenarios, continuous steps 1–77, projects under
`%TEMP%\cowtext-gp\{delta,alpha,gamma,beta,epsilon}`, `Snap` helper for P0-10).
