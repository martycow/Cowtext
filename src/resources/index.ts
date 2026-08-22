// Bundled data tables (WO15 §4.9) — DATA ONLY. No React, no store imports,
// no `invoke`. Everything here ships inside the app binary and is identical
// for every project; nothing in this directory reads or writes disk.
//
// The JSON files are the editable source (Marty reviews `models.json`'s
// non-Anthropic ids, D-10); this module is the typed front door and the one
// place a cast from "whatever JSON says" to the declared shape happens.
// `resources.test.ts` is the validator for that cast: it asserts the ids,
// order, labels and cross-table invariants the types alone cannot express.

import modelsJson from "./models.json";
import presetsJson from "./agent-presets.json";
import stacksJson from "./stacks.json";
import principlesJson from "./principles.json";
import builtinTaskFormat from "./skills/task-format/SKILL.md?raw";
// Type-only: `store/graph.ts` must never be pulled into this module's
// runtime graph (it owns the live Zustand store), and `agents/types.ts`
// imports nothing at all — the ProviderId union lives there so the sidecar
// parser in `store/agents.ts` can validate a provider without loading these
// tables.
import type { ProviderId } from "../agents/types";
import type { CompileTarget } from "../store/graph";

/** The one sentence every provider-facing surface carries VERBATIM
 *  (`docs/design/PROVIDER_SUPPORT_MATRIX.md` §"The sentence", WO15 §7.7).
 *  Never paraphrase it, never split it, never claim "multi-provider" for
 *  Assemble / Run / hooks — those are Claude Code only. */
export const PROVIDER_SUPPORT_SENTENCE =
  "Cowtext compiles context for multiple AI coding agents. Assemble, Run and live hooks currently use Claude Code.";

// ── Providers & models (Block 3a) ──────────────────────────────────────

export type ModelTier = "flagship" | "balanced" | "fast";

/** Keys of `src/icons/providers/index.ts` — a monochrome glyph per provider,
 *  hand-authored, no icon library. */
export type ProviderIconId = "anthropic" | "openai" | "gemini" | "cursor" | "copilot";

export interface ModelEntry {
  id: string;
  label: string;
  tier: ModelTier;
}

export interface Provider {
  id: ProviderId;
  name: string;
  icon: ProviderIconId;
  /** The binary as a user would type it (`gh copilot`, not `gh`). */
  cli: string;
  /** Empty for providers with no public model picker (cursor, github). */
  models: ModelEntry[];
}

interface ProvidersFile {
  providers: Provider[];
}

export const PROVIDERS: readonly Provider[] = (modelsJson as unknown as ProvidersFile).providers;

export function providerById(id: string): Provider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** First `flagship` entry, else the first model, else null (cursor/github
 *  ship no model list — their runtime picks the model, not Cowtext). */
export function defaultModelFor(id: ProviderId): string | null {
  const provider = providerById(id);
  if (provider === null) return null;
  const flagship = provider.models.find((m) => m.tier === "flagship");
  if (flagship !== undefined) return flagship.id;
  return provider.models[0]?.id ?? null;
}

export const DEFAULT_PROVIDER: ProviderId = "anthropic";
export const DEFAULT_AGENT_MODEL = "claude-fable-5";

/** Which toolchain row proves a provider is installed on this machine — the
 *  provider chips dim (but stay selectable) when the matching
 *  `detect_ai_tools` row reports `found: false`. Keyed by provider, valued
 *  by `CompileTarget` because that is what the scan is keyed on. */
export const PROVIDER_COMPILE_TARGET: Record<ProviderId, CompileTarget> = {
  anthropic: "claude",
  openai: "agents",
  google: "gemini",
  cursor: "cursor",
  github: "copilot",
};

// ── Agent presets (Block 3c) ───────────────────────────────────────────

export interface AgentPreset {
  id: string;
  name: string;
  /** The system-prompt body — what the agent DOES. */
  description: string;
  /** One sentence starting `Use when`; becomes the agent's `description:`
   *  frontmatter, which is what Claude Code matches on. */
  whenToUse: string;
  /** Members of `ALL_TOOLS` (`agents/toolCatalog.ts`). Empty ⇔ `inherit`. */
  tools: string[];
  mode: "inherit" | "restrict";
  priority: number;
  /** Absent ⇒ the wizard's own default model applies. */
  model?: string;
}

interface PresetsFile {
  presets: AgentPreset[];
}

export const AGENT_PRESETS: readonly AgentPreset[] = (presetsJson as unknown as PresetsFile)
  .presets;

// ── Stack picker (Block 6) ─────────────────────────────────────────────

export interface StackItem {
  id: string;
  label: string;
}

export interface StackCategory {
  id: string;
  label: string;
  items: StackItem[];
}

interface StacksFile {
  categories: StackCategory[];
}

export const STACK_CATEGORIES: readonly StackCategory[] = (stacksJson as unknown as StacksFile)
  .categories;

export function stackItemById(id: string): { category: StackCategory; item: StackItem } | null {
  for (const category of STACK_CATEGORIES) {
    const item = category.items.find((i) => i.id === id);
    if (item !== undefined) return { category, item };
  }
  return null;
}

// ── Principles (Block 6) ───────────────────────────────────────────────

export interface Principle {
  id: string;
  label: string;
  /** Full markdown of a `rule`-role node — heading, rule, worked example. */
  body: string;
}

interface PrinciplesFile {
  principles: Principle[];
}

export const PRINCIPLES: readonly Principle[] = (principlesJson as unknown as PrinciplesFile)
  .principles;

/** The principle the wizard's "Fixed stack" checkbox implies — ticking it
 *  adds this rule node even when the user never checked it in the
 *  Principles step (§4.11 rule 4). */
export const FIXED_STACK_PRINCIPLE_ID = "ask-before-dependency";

// ── Built-in skills (Block 4) ──────────────────────────────────────────

export interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  /** Everything after the frontmatter fence — what a `virtual` skill shows
   *  in the read-only editor. */
  body: string;
  /** The whole SKILL.md text, frontmatter first. This is the byte payload
   *  `skills_materialize` writes, and the `newContent` of the Compile
   *  modal's synthetic skill row. */
  content: string;
}

/** Minimal frontmatter reader — `name:` / `description:` scalars between the
 *  first two `---` lines. Deliberately NOT a YAML parser: these two files
 *  are ours, the shape is fixed, and a dependency for two `split(":")` calls
 *  is exactly what `ask-before-dependency` exists to prevent. Unquoted
 *  scalars only; surrounding quotes are stripped when present. */
export function parseSkillMd(content: string): {
  name: string;
  description: string;
  body: string;
} {
  const empty = { name: "", description: "", body: content };
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return empty;
  const openerLen = content.startsWith("---\r\n") ? 5 : 4;
  const rest = content.slice(openerLen);
  const lines = rest.split("\n");
  let fenceIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, "") === "---") {
      fenceIdx = i;
      break;
    }
  }
  if (fenceIdx === -1) return empty;

  let name = "";
  let description = "";
  for (const raw of lines.slice(0, fenceIdx)) {
    const line = raw.replace(/\r$/, "");
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line
      .slice(sep + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/^'(.*)'$/, "$1");
    if (key === "name") name = value;
    else if (key === "description") description = value;
  }

  // Everything after the closing fence LINE, with the single newline that
  // separates fence from body removed — so `body` starts at the first real
  // character, and `content` can be rebuilt as fence + "\n" + body.
  const after = lines.slice(fenceIdx + 1).join("\n");
  const body = after.startsWith("\r\n") ? after.slice(2) : after.startsWith("\n") ? after.slice(1) : after;
  return { name, description, body };
}

function builtin(content: string): BuiltinSkill {
  const parsed = parseSkillMd(content);
  return {
    id: parsed.name,
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    content,
  };
}

/** The skills Cowtext ships. A built-in is VIRTUAL until the user includes
 *  it in a compile — nothing is on disk until `skills_materialize` runs
 *  (Block 4, D-4). Order here is the Skills rail's Built-in group order. */
export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [builtin(builtinTaskFormat)];
