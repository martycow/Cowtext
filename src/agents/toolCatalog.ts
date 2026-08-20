// Claude Code tool names an agent's `tools:` frontmatter may list
// (WO10 item 11).
//
// This is the SINGLE source for that vocabulary. Before it, the app had two
// disagreeing answers: NewAgentDialog offered a fixed ten-item checkbox grid
// at creation time, while AgentEditor offered unvalidated free text
// afterwards — so an agent created through the dialog and then edited could
// silently acquire "Bahs" and nobody would notice until the agent quietly
// lost its shell.
//
// The list is a suggestion, never a restriction. `tools:` also accepts MCP
// tool names (`mcp__server__tool`), which are per-installation and cannot be
// enumerated here, so the picker keeps a free-text row and `isKnownTool`
// exists to DECORATE an unknown value, not to reject it.

export interface ToolGroup {
  label: string;
  tools: string[];
}

/** Grouped by what the tool lets an agent DO — the question a user is
 *  actually answering when they tick boxes ("can this agent write?"). */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  { label: "Read", tools: ["Read", "Glob", "Grep", "NotebookRead"] },
  { label: "Write", tools: ["Edit", "Write", "NotebookEdit"] },
  { label: "Execute", tools: ["Bash", "BashOutput", "KillShell"] },
  { label: "Network", tools: ["WebFetch", "WebSearch"] },
  { label: "Orchestrate", tools: ["Agent", "Task", "TodoWrite", "SlashCommand", "Skill"] },
];

/** Flat list, in group order. */
export const ALL_TOOLS: readonly string[] = TOOL_GROUPS.flatMap((g) => g.tools);

/** The wildcard Claude Code accepts for "every tool". Listed apart from the
 *  groups because ticking it makes every other choice moot, and the picker
 *  says so rather than leaving the user to discover it. */
export const TOOL_WILDCARD = "*";

export function isKnownTool(name: string): boolean {
  return name === TOOL_WILDCARD || ALL_TOOLS.includes(name);
}

/** An MCP tool is legitimate but un-enumerable — worth telling apart from a
 *  typo, so the picker can mark one as "custom" instead of "unknown". */
export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

/** Trim only. Tool names are case-SENSITIVE ("read" is not "Read"), so
 *  normalizing case here would silently break a correct entry. */
export function normalizeToolInput(raw: string): string {
  return raw.trim();
}
