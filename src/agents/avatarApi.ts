// Frontend IPC wrapper for agent avatars (WO11_CONTRACT.md §4.2, §5.11).
// Storage is path-derived, not sidecar-keyed: `.cowtext/avatars/<stem>.<ext>`.
// `sourcePath` is the one absolute, webview-supplied path any WO11 command
// accepts — it must come from `@tauri-apps/plugin-dialog`'s `open()` (a
// user-chosen file), never a value built by the frontend itself.

import { invoke } from "@tauri-apps/api/core";

export interface AgentAvatarRef {
  relPath: string;
  dataUrl: string;
  bytes: number;
}

/** Validates by magic bytes (PNG/JPEG/WebP/GIF), never by extension, and
 *  caps at 512 KB — no resizing, no dimension check (stack is fixed).
 *  Replaces any existing avatar for this agent, whatever its extension. */
export function agentAvatarSet(
  root: string,
  fileName: string,
  sourcePath: string,
): Promise<AgentAvatarRef> {
  return invoke<AgentAvatarRef>("agent_avatar_set", { root, fileName, sourcePath });
}

/** `null` both when there is no avatar and when the file on disk can't be
 *  read back — a broken avatar must never stop the rail from rendering. */
export function agentAvatarRead(root: string, fileName: string): Promise<string | null> {
  return invoke<string | null>("agent_avatar_read", { root, fileName });
}

export function agentAvatarClear(root: string, fileName: string): Promise<void> {
  return invoke<void>("agent_avatar_clear", { root, fileName });
}
