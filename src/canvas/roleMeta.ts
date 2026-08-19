// Role popup copy (contract §7.5) — UI text only; the store keeps owning
// NODE_ROLES. Copy is canon from DESIGN_SPEC's "Meaning" column: do not
// reword the first clause (applies to the original 7; the WO03 six are new
// and have no DESIGN_SPEC entry yet — G lane closes that gap).

import type { NodeRole } from "../store/graph";

export const ROLE_DESCRIPTIONS: Record<NodeRole, string> = {
  agent: "An agent: identity, duties, tools — may be backed by a real .claude/agents file.",
  rules: "Hard constraints the agent must never break.",
  architecture: "How the system fits together: modules, boundaries, data flow.",
  workflow: "Ordered processes — the steps to follow for a recurring job.",
  task: "Work with a finish line: scoped, checkable, done and gone.",
  reference: "Lookup material, read on demand rather than always in context.",
  glossary: "Vocabulary: the exact words this project uses, and what they mean.",
  // v3 (WO03) — six more roles.
  command: "A runnable command or procedure — meant to be executed, not just read.",
  invariant: "A fact that must always hold — data or state the agent should never contradict.",
  trap: "A known gotcha — a mistake made here before, flagged so it isn't repeated.",
  skill: "A learned capability — a reusable technique, not a one-off task.",
  snippet: "A reusable fragment of code or text, meant to be copied in verbatim.",
  style: "Voice and formatting conventions — how output should look, not what it contains.",
};

/** Grouping for the 13-role picker (contract WO03 §"F — frontend": "the
 *  picker must stay usable at 13 options, not just technically correct" —
 *  a flat list stopped scanning well past ~7, so this is the taxonomy both
 *  NodeWizard's step-1 grid and the Inspector's RoleField popup render
 *  sections from. Every NODE_ROLES value appears in exactly one group;
 *  the four group counts (1+3+5+4) must sum to NODE_ROLES.length. */
export interface RoleGroup {
  label: string;
  roles: readonly NodeRole[];
}

export const ROLE_GROUPS: readonly RoleGroup[] = [
  { label: "Identity", roles: ["agent"] },
  { label: "Constraints", roles: ["rules", "invariant", "trap"] },
  { label: "Process", roles: ["architecture", "workflow", "task", "command", "skill"] },
  { label: "Knowledge", roles: ["reference", "glossary", "snippet", "style"] },
];
