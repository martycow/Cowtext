// Frontend IPC wrapper for the git backend (WO11 contract §4.1): `git init`
// + a `.gitignore` composer, nothing more (no staging, commits, branches or
// remotes — see WO11_CONTRACT.md §8). JS args camelCase, Rust snake_case;
// Tauri converts.

import { invoke } from "@tauri-apps/api/core";
import type { GitInitResult, GitStatus } from "./types";

/** Read-only probe. Never rejects for a non-repo, a bare repo, or `git`
 *  missing from PATH — those are all valid `GitStatus` answers
 *  (`gitAvailable: false` in the last case). Only a bad project root
 *  rejects. */
export function gitStatus(root: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { root });
}

/** `git init` plus, when `commit` is true, the project's first commit
 *  (WO15 Block 0 / §3.2). A no-op (fresh status, HEAD untouched, nothing
 *  written, `skippedExistingRepo: true`) when `root` is already a repo
 *  toplevel — even when `branch` is non-null, and even when `commit` is
 *  true (D1b/D-15: re-running the wizard on a project you already
 *  initialized must never move that repo's HEAD or add a commit).
 *  `branch: null` leaves the name to `init.defaultBranch` / git's default.
 *
 *  `commit === true` is a WRITE into the user's project: it composes
 *  `.gitignore` and creates a commit. Only the project wizard's Create and
 *  GitWizard's explicit button pass it. With a missing `user.name` /
 *  `user.email` the call rejects with the identity message BEFORE anything
 *  is created (A-4) — an untouched folder beats a half-initialised one. */
export function gitInit(
  root: string,
  branch: string | null,
  commit = false,
): Promise<GitInitResult> {
  return invoke<GitInitResult>("git_init", { root, branch, commit });
}

/** Writes `<root>/.gitignore` verbatim — this is a write into the user's
 *  project (CLAUDE.md's trust boundary). Callers MUST show a diff-preview
 *  and get explicit approval before calling this; the command itself writes
 *  unconditionally once invoked. Content is normalized to LF with exactly
 *  one trailing newline before writing. */
export function gitignoreWrite(root: string, content: string): Promise<void> {
  return invoke<void>("gitignore_write", { root, content });
}
