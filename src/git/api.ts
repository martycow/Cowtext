// Frontend IPC wrapper for the git backend (WO11 contract §4.1): `git init`
// + a `.gitignore` composer, nothing more (no staging, commits, branches or
// remotes — see WO11_CONTRACT.md §8). JS args camelCase, Rust snake_case;
// Tauri converts.

import { invoke } from "@tauri-apps/api/core";
import type { GitStatus } from "./types";

/** Read-only probe. Never rejects for a non-repo, a bare repo, or `git`
 *  missing from PATH — those are all valid `GitStatus` answers
 *  (`gitAvailable: false` in the last case). Only a bad project root
 *  rejects. */
export function gitStatus(root: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { root });
}

/** `git init` and nothing else — no commit, no remote, no config, no first
 *  `add`. A no-op (still returns fresh status) when `root` is already a
 *  repo. */
export function gitInit(root: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_init", { root });
}

/** Writes `<root>/.gitignore` verbatim — this is a write into the user's
 *  project (CLAUDE.md's trust boundary). Callers MUST show a diff-preview
 *  and get explicit approval before calling this; the command itself writes
 *  unconditionally once invoked. Content is normalized to LF with exactly
 *  one trailing newline before writing. */
export function gitignoreWrite(root: string, content: string): Promise<void> {
  return invoke<void>("gitignore_write", { root, content });
}
