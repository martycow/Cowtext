// Frontend IPC wrapper for the agent-session runtime (WO01 Block F contract
// §4). This is the ONLY file allowed to invoke these seven commands — other
// lanes import from here, never invoke directly. JS args camelCase, Rust
// snake_case; Tauri converts.

import { invoke } from "@tauri-apps/api/core";

export interface WorktreeInfo {
  path: string; // canonicalized, forward slashes
  isRepo: boolean;
  isWorktree: boolean; // true iff git-dir !== git-common-dir (a linked worktree)
  branch: string | null; // null when detached HEAD or not a repo
}

export interface SessionInfo {
  id: string; // Cowtext-side id, opaque — never parsed by the frontend
  name: string;
  agentFileName: string | null; // e.g. "tech-ui.md", relative to <root>/.claude/agents/
  cwd: string; // canonicalized, forward slashes
  root: string;
  alive: boolean;
  claudeSessionId: string | null; // captured from the stream's system/init line
  // WO06 §7.1/§8 — appended last.
  tokensUsed: number;
  tokenCeiling: number | null;
}

export function worktreeCheck(path: string): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>("worktree_check", { path });
}

export function worktreeAdd(repoPath: string, newPath: string, branch: string): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>("worktree_add", { repoPath, newPath, branch });
}

/** WO06 §7.1 — three appended optional args, all `null` ⇒ behaviour
 *  byte-identical to pre-WO06 (contract §1.14). Defaulted (not just typed
 *  optional) so an existing 4-arg call site keeps compiling unchanged while
 *  still sending explicit `null`s on the wire, per the contract's own
 *  "callers always pass explicit null" precedent. */
export function agentSessionSpawn(
  root: string,
  agentFileName: string | null,
  name: string,
  cwd: string,
  taskId: string | null = null,
  taskContext: string | null = null,
  tokenCeiling: number | null = null,
): Promise<SessionInfo> {
  return invoke<SessionInfo>("agent_session_spawn", {
    root,
    agentFileName,
    name,
    cwd,
    taskId,
    taskContext,
    tokenCeiling,
  });
}

export function agentSessionSend(id: string, prompt: string): Promise<void> {
  return invoke<void>("agent_session_send", { id, prompt });
}

export function agentSessionKill(id: string): Promise<void> {
  return invoke<void>("agent_session_kill", { id });
}

export function agentSessionRestart(id: string): Promise<SessionInfo> {
  return invoke<SessionInfo>("agent_session_restart", { id });
}

export function agentSessionList(): Promise<SessionInfo[]> {
  return invoke<SessionInfo[]>("agent_session_list", {});
}
