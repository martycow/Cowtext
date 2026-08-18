// Wire shapes for the Agents & Sub-Agents management suite — mirrors the Rust
// `#[serde(rename_all = "camelCase")]` structs in src-tauri/src/agents.rs 1:1.
// AGENTS_SUITE_CONTRACT.md §4. This is the only TS definition of these types.

/** Known-key subset of the frontmatter. A total value: the UI always sends all five. */
export interface FmFields {
  name: string | null; // null / "" => the key is deleted on save
  description: string | null;
  model: string | null;
  tools: string[]; // [] => the key is deleted on save
  skills: string[];
}

export interface AgentDoc {
  fileName: string; // "tech-ui.md" — never a path
  fields: FmFields;
  body: string; // everything after the closing fence, verbatim
  raw: boolean; // true => edit `content` as whole text, fields are unusable
  parseError: string | null;
  content: string; // full file text (raw fallback + dirty comparison)
}

export interface SkillDoc {
  dirName: string; // "design-tokens"
  fields: FmFields;
  body: string;
  raw: boolean;
  parseError: string | null;
  content: string;
  /** Everything in the skill dir except SKILL.md: recursive, relative, forward
   *  slashes, sorted, capped at 100 entries. Drives the delete confirmation. */
  extraFiles: string[];
  extraFileCount: number; // uncapped total
}

export interface AgentsScan {
  agents: AgentDoc[]; // sorted by fileName
  skills: SkillDoc[]; // sorted by dirName
  metaJson: string | null; // raw .cowtext/agents.json bytes
  skipped: string[]; // unreadable / non-UTF-8 files, e.g. "agents/x.md"
}
