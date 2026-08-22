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

/** Result of agent_memory_ensure (WO02 §2.1) — the calculated per-agent
 *  memory directory under `.claude/agent-memory/<stem>/`. */
export interface AgentMemory {
  dirRelPath: string;
  indexRelPath: string;
  created: boolean;
}

export function agentsScan(root: string): Promise<AgentsScan> {
  return invoke<AgentsScan>("agents_scan", { root });
}

/** `fileName`: `undefined`/`null` => today's behaviour (`slugify(name)+".md"`);
 *  a string => that exact file name is used (still validated + never-clobber
 *  server-side). The frontmatter `name:` stays `slugify(name)` either way. */
export function agentCreate(
  root: string,
  name: string,
  fileName?: string | null,
): Promise<AgentDoc> {
  return invoke<AgentDoc>("agent_create", { root, name, fileName: fileName ?? null });
}

/** Idempotent: ensures `.claude/agent-memory/<stem>/MEMORY.md` exists,
 *  never clobbering an existing index file. */
export function agentMemoryEnsure(root: string, fileName: string): Promise<AgentMemory> {
  return invoke<AgentMemory>("agent_memory_ensure", { root, fileName });
}

/** Convert a legacy context .md into a real .claude/agents/<slug>.md
 *  (moves the file, ensuring `name:` frontmatter). Resolves to the new
 *  AgentDoc; never clobbers an existing agent. */
export function agentConvert(root: string, relPath: string, newName: string): Promise<AgentDoc> {
  return invoke<AgentDoc>("agent_convert", { root, relPath, newName });
}

/** WO11 §3 (ASK #7, ratified): returns the freshly saved `AgentDoc` instead
 *  of `()`, re-read off disk, so callers (the per-keystroke autosave, §5.7)
 *  can update their store in place without a full `agentsScan`. */
export function agentSave(root: string, fileName: string, patch: SavePatch): Promise<AgentDoc> {
  return invoke<AgentDoc>("agent_save", {
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

/** Result of `agent_memory_status` (WO11 §4.3) — a read-only probe of an
 *  agent's memory index. `healthy === false` with `indexExists === true`
 *  means the index is present but not valid UTF-8, or 0 bytes; source of
 *  truth for the Reveal/Fix control (§5.5), never `useProjectStore.files`. */
export interface AgentMemoryStatus {
  dirRelPath: string;
  indexRelPath: string;
  dirExists: boolean;
  indexExists: boolean;
  indexBytes: number;
  healthy: boolean;
}

export function agentMemoryStatus(root: string, fileName: string): Promise<AgentMemoryStatus> {
  return invoke<AgentMemoryStatus>("agent_memory_status", { root, fileName });
}

/** One bundled skill to write (WO15 §3.4). `id` is the skill directory slug;
 *  `content` is the full SKILL.md text, frontmatter first. */
export interface SkillInput {
  id: string;
  content: string;
}

/** `.claude/skills/<id>/SKILL.md` paths, forward slashes, in input order. */
export interface SkillsMaterialized {
  written: string[];
}

/** Writes bundled (built-in) skills to disk — create-or-replace on purpose,
 *  because this is also the "Reset to built-in" path (WO15 Block 4, D-4).
 *  Compile itself may never write under `.claude/skills/`, so the Compile
 *  modal calls this AFTER `compileWrite` succeeds, with only the skill rows
 *  the user approved. Every entry is validated before any write; an I/O
 *  failure part-way rejects with earlier writes already on disk, so the
 *  caller reloads. */
export function skillsMaterialize(
  root: string,
  skills: SkillInput[],
): Promise<SkillsMaterialized> {
  return invoke<SkillsMaterialized>("skills_materialize", { root, skills });
}
