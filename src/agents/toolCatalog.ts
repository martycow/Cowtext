// Claude Code tool names an agent's `tools:` frontmatter may list, plus the
// CAPABILITY model the pickers actually present (WO12).
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
//
// WO12 — why capabilities, and the one invariant that makes them safe:
//
// Users tick boxes to answer "can this agent write?", not to recall whether
// the tool is called Edit or MultiEdit. Capabilities are also STABLE while
// tool names churn — this file was wrong in both directions within one
// release (it listed Task/TodoWrite/SlashCommand/NotebookRead/BashOutput/
// KillShell, none of which appear in real transcripts, and omitted
// PowerShell/Skill/ToolSearch/Workflow/Agent/SendMessage/TaskOutput/
// TaskStop/AskUserQuestion/Artifact/ExitPlanMode, all of which do).
//
// But `tools:` stores EXACT NAMES, so a capability row is a *view* over
// them, and a lossy view mutates data just by being looked at — the exact
// bug WO11 A3 fixed in the project wizard, where a controlled round-trip
// ate every space the user typed. Hence `capabilityState`: a row is "all",
// "some", or "none", and a "some" row must never be silently normalized to
// all-or-nothing. Only an explicit user toggle writes. See `applyCapability`.

export interface ToolGroup {
  label: string;
  tools: string[];
}

/** A user-facing ability, expressed as the tool names that grant it.
 *  `label` answers "what can this agent DO?" — the question a user is
 *  actually answering when they tick a box. */
export interface Capability {
  /** Stable key for React and for round-tripping UI state. */
  key: string;
  label: string;
  /** One short clause; the picker shows it under the label. */
  hint: string;
  /** Every tool name that contributes to this ability. Order matters only
   *  for display in the Advanced list. */
  tools: readonly string[];
}

/** The capability rows, in the order the picker shows them.
 *
 *  Names verified against real session transcripts rather than recalled —
 *  the previous hand-written list disagreed with reality in both
 *  directions. Names not observed in transcripts are still included where
 *  Claude Code documents them (NotebookRead/NotebookEdit, WebFetch/
 *  WebSearch), because absence from one machine's history is not evidence a
 *  tool does not exist; the reverse error (omitting a real tool) costs an
 *  agent a capability silently, which is the worse failure. */
export const CAPABILITIES: readonly Capability[] = [
  {
    key: "read",
    label: "Read files",
    hint: "Open files, list them, search their contents",
    tools: ["Read", "Glob", "Grep", "NotebookRead"],
  },
  {
    key: "write",
    label: "Write to files",
    hint: "Create and edit files on disk",
    tools: ["Edit", "Write", "NotebookEdit"],
  },
  {
    key: "execute",
    label: "Run commands",
    hint: "Shell access — build, test, git, anything",
    tools: ["Bash", "PowerShell", "BashOutput", "KillShell"],
  },
  {
    key: "web",
    label: "Search the web",
    hint: "Fetch pages and run web searches",
    tools: ["WebFetch", "WebSearch"],
  },
  {
    key: "subagents",
    label: "Use subagents",
    hint: "Spawn other agents and manage their work",
    tools: ["Agent", "Task", "TaskOutput", "TaskStop", "SendMessage"],
  },
  {
    key: "skills",
    label: "Use skills",
    hint: "Invoke skills and slash commands",
    tools: ["Skill", "SlashCommand", "ToolSearch"],
  },
  {
    key: "plan",
    label: "Plan and ask",
    hint: "Track todos, enter plan mode, ask the user questions",
    tools: ["TodoWrite", "ExitPlanMode", "AskUserQuestion"],
  },
];

/** Grouped by what the tool lets an agent DO — retained as the Advanced
 *  list's section headers, and still the flat vocabulary `isKnownTool`
 *  validates against. Derived from CAPABILITIES so the two can never
 *  drift; before WO12 they were two hand-maintained lists. */
export const TOOL_GROUPS: readonly ToolGroup[] = CAPABILITIES.map((c) => ({
  label: c.label,
  tools: [...c.tools],
}));

/** Flat list, in capability order. */
export const ALL_TOOLS: readonly string[] = CAPABILITIES.flatMap((c) => c.tools);

/** The wildcard Claude Code accepts for "every tool". Listed apart from the
 *  capabilities because ticking it makes every other choice moot, and the
 *  picker says so rather than leaving the user to discover it. */
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

export type CapabilityState = "all" | "some" | "none";

/** Tri-state, and the reason this file has a capability model at all.
 *
 *  An agent with `tools: Read, Glob` has SOME of "Read files". Collapsing
 *  that to a two-state checkbox forces a silent mutation on save — ticked
 *  grants Grep the agent never had, unticked strips Read and Glob. Both
 *  rewrite the user's file for merely opening an editor. */
export function capabilityState(selected: readonly string[], cap: Capability): CapabilityState {
  const owned = cap.tools.filter((t) => selected.includes(t)).length;
  if (owned === 0) return "none";
  return owned === cap.tools.length ? "all" : "some";
}

/** The only writer of capability-shaped changes.
 *
 *  `on` adds every tool in the capability without disturbing anything else
 *  (including MCP names and tools from other capabilities); `off` removes
 *  exactly this capability's tools and nothing more. A capability the user
 *  never touched is never rewritten — untouched frontmatter round-trips
 *  byte-identical, which is the whole invariant. */
export function applyCapability(
  selected: readonly string[],
  cap: Capability,
  on: boolean,
): string[] {
  if (!on) return selected.filter((t) => !cap.tools.includes(t));
  const missing = cap.tools.filter((t) => !selected.includes(t));
  return [...selected, ...missing];
}

/** Tool names in the selection that belong to no capability and are not the
 *  wildcard — MCP names, and anything newer than this catalog. The picker
 *  surfaces these separately so a capability view never hides a tool the
 *  agent actually has. */
export function uncategorizedTools(selected: readonly string[]): string[] {
  return selected.filter((t) => t !== TOOL_WILDCARD && !ALL_TOOLS.includes(t));
}
