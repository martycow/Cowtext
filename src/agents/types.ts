// Wire shapes for the Agents & Sub-Agents management suite — mirrors the Rust
// `#[serde(rename_all = "camelCase")]` structs in src-tauri/src/agents.rs 1:1.
// AGENTS_SUITE_CONTRACT.md §4. This is the only TS definition of these types.

/** WO15 §4.10 — the model providers Cowtext can name in the agent modal.
 *  This is a COWTEXT-side concept only: it is persisted in the sidecar
 *  (`.cowtext/agents.json`, §3.8) and never written into an agent's own
 *  frontmatter. `model:` reaches the file iff the provider is `anthropic`
 *  (D-13) — Claude Code is the only runtime that reads it.
 *
 *  Declared here rather than in `src/resources/index.ts` because
 *  `store/agents.ts` needs the type without pulling in the data tables,
 *  and `resources/index.ts` itself imports it back for `Provider.id`. */
export type ProviderId = "anthropic" | "openai" | "google" | "cursor" | "github";

/** Every {@link ProviderId}, in the `models.json` provider order. The
 *  runtime validation list for a sidecar `provider` value: anything not in
 *  here reads as absent (§3.8). */
export const PROVIDER_IDS: readonly ProviderId[] = [
  "anthropic",
  "openai",
  "google",
  "cursor",
  "github",
];

/** Known-key subset of the frontmatter. A total value: the UI always sends
 *  all ten (WO13_CONTRACT.md §14.4 promotes five new keys, in this
 *  canonical append order after `skills`: `disallowedTools`,
 *  `permissionMode`, `maxTurns`, `memory`, `color`). `mcpServers`, `hooks`,
 *  `background`, `effort`, `isolation`, `initialPrompt` stay backlogged —
 *  they survive round-tripping in Rust as unmodeled `Extra` lines and have
 *  no field here. */
export interface FmFields {
  name: string | null; // null / "" => the key is deleted on save
  description: string | null;
  model: string | null;
  tools: string[]; // [] => the key is deleted on save
  skills: string[];
  disallowedTools: string[]; // [] => the key is deleted on save
  /** `default | acceptEdits | auto | dontAsk | bypassPermissions | plan`
   *  per the docs verdict (WO13_CONTRACT.md §3.0) — not validated here. */
  permissionMode: string | null;
  /** Numeric, rendered unquoted; sent/read as a plain digit string. */
  maxTurns: string | null;
  /** `user | project | local` per the docs verdict — a string enum, NOT
   *  an object (the spec's `MemoryConfig` was wrong, §3.0). */
  memory: string | null;
  /** `red|blue|green|yellow|purple|orange|pink|cyan`. */
  color: string | null;
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
