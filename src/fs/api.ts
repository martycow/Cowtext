// Frontend IPC wrapper for the UX-batch backend commands (rename/reveal/probe/hooks
// status). This is the ONLY file allowed to hold these four invoke() calls — see
// docs/design/UXBATCH_CONTRACT.md §3. Other lanes import from here, never invoke directly.
import { invoke } from "@tauri-apps/api/core";

/** Mirrors src-tauri hooks::HooksStatus 1:1. */
export interface HooksStatus {
  installed: boolean;
  fileExists: boolean;
  readable: boolean;
}

/** Rename a node's .md file. Resolves to the normalized new relative path.
 *  Rejects with a plain string: collision, protected file, escape attempt, IO. */
export function renameNodeFile(
  root: string,
  relPath: string,
  newRelPath: string,
): Promise<string> {
  return invoke<string>("rename_node_file", { root, relPath, newRelPath });
}

/** Show a file in the OS file manager. `relPath` omitted/null reveals the root. */
export function revealPath(root: string, relPath?: string | null): Promise<void> {
  return invoke<void>("reveal_path", { root, relPath: relPath ?? null });
}

/** Existence probe for the recent-projects list; same order as `paths`. */
export function probeProjectDirs(paths: string[]): Promise<boolean[]> {
  return invoke<boolean[]>("probe_project_dirs", { paths });
}

/** Passive read of .claude/settings.json install state. */
export function hooksStatus(root: string): Promise<HooksStatus> {
  return invoke<HooksStatus>("hooks_status", { root });
}

/** One entry in a batch passed to `fs_apply_batch` (WO13_CONTRACT.md §12.1).
 *  `content: null` deletes the path. Mirrors src-tauri `fsbatch::BatchEntry`
 *  1:1 — `content` is always present on the wire (never omitted), so this
 *  stays `string | null`, not an optional field. */
export interface BatchEntry {
  relPath: string;
  content: string | null;
}

/** All-or-nothing multi-file write/delete (WO13_CONTRACT.md §12.1, the
 *  75th invoke). Resolves to the INVERSE of the batch that was applied —
 *  applying the returned value undoes the call. Rejects the whole batch,
 *  leaving the tree byte-unchanged, on any single failure: a bad path, the
 *  one-writer guard (`.claude/settings.json`, `.claude/agents/*.md`,
 *  anything under `.claude/skills/`), an unsupported shape (not `.md` and
 *  not `.cursor/rules/*.mdc`), a duplicate `relPath`, or an I/O failure
 *  partway through. */
export function fsApplyBatch(root: string, entries: BatchEntry[]): Promise<BatchEntry[]> {
  return invoke<BatchEntry[]>("fs_apply_batch", { root, entries });
}
