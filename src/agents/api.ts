// Frontend IPC wrapper for the Agents & Sub-Agents management suite backend
// commands (AGENTS_SUITE_CONTRACT.md §2). This is the ONLY file allowed to
// hold these ten invoke() calls — other lanes import from here, never invoke
// directly. Paths are built server-side: callers send `root` plus a single
// path component (fileName / dirName / name); Rust resolves and validates
// the rest. Optional args are sent as `null` when absent (the `revealPath`
// idiom in src/fs/api.ts).
//
// `skills:` is a Cowtext / ultracode convention, not a Claude Code feature.
// Claude Code has no native per-agent skills key and ignores unknown
// frontmatter keys; the fleet's own agent files already use it. Attaching a
// skill in Cowtext records intent — it does not change what Claude Code loads.

import { invoke } from "@tauri-apps/api/core";
import type { AgentDoc, AgentsScan, FmFields, SkillDoc } from "./types";

/** Patch sent to agent_save / skill_save. Exactly one of `rawContent` or
 *  `fields`+`body` should be set (the raw-vs-structured guard lives in
 *  Rust, §2.1); an absent field is sent as `null`. */
export interface SavePatch {
  fields?: FmFields | null;
  body?: string | null;
  rawContent?: string | null;
}

export function agentsScan(root: string): Promise<AgentsScan> {
  return invoke<AgentsScan>("agents_scan", { root });
}

export function agentCreate(root: string, name: string): Promise<AgentDoc> {
  return invoke<AgentDoc>("agent_create", { root, name });
}

/** Convert a legacy context .md into a real .claude/agents/<slug>.md
 *  (moves the file, ensuring `name:` frontmatter). Resolves to the new
 *  AgentDoc; never clobbers an existing agent. */
export function agentConvert(root: string, relPath: string, newName: string): Promise<AgentDoc> {
  return invoke<AgentDoc>("agent_convert", { root, relPath, newName });
}

export function agentSave(root: string, fileName: string, patch: SavePatch): Promise<void> {
  return invoke<void>("agent_save", {
    root,
    fileName,
    fields: patch.fields ?? null,
    body: patch.body ?? null,
    rawContent: patch.rawContent ?? null,
  });
}

export function agentRename(root: string, fileName: string, newName: string): Promise<string> {
  return invoke<string>("agent_rename", { root, fileName, newName });
}

export function agentDelete(root: string, fileName: string): Promise<void> {
  return invoke<void>("agent_delete", { root, fileName });
}

export function skillCreate(root: string, name: string): Promise<SkillDoc> {
  return invoke<SkillDoc>("skill_create", { root, name });
}

export function skillSave(root: string, dirName: string, patch: SavePatch): Promise<void> {
  return invoke<void>("skill_save", {
    root,
    dirName,
    fields: patch.fields ?? null,
    body: patch.body ?? null,
    rawContent: patch.rawContent ?? null,
  });
}

export function skillRename(root: string, dirName: string, newName: string): Promise<string> {
  return invoke<string>("skill_rename", { root, dirName, newName });
}

export function skillDelete(root: string, dirName: string): Promise<void> {
  return invoke<void>("skill_delete", { root, dirName });
}

export function agentsMetaWrite(root: string, content: string): Promise<void> {
  return invoke<void>("agents_meta_write", { root, content });
}
