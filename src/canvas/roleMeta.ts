// Role popup copy (contract §7.5) — UI text only; the store keeps owning
// NODE_ROLES. Copy is canon from DESIGN_SPEC's "Meaning" column: do not
// reword the first clause.

import type { NodeRole } from "../store/graph";

export const ROLE_DESCRIPTIONS: Record<NodeRole, string> = {
  agent: "An agent: identity, duties, tools — may be backed by a real .claude/agents file.",
  rules: "Hard constraints the agent must never break.",
  architecture: "How the system fits together: modules, boundaries, data flow.",
  workflow: "Ordered processes — the steps to follow for a recurring job.",
  task: "Work with a finish line: scoped, checkable, done and gone.",
  reference: "Lookup material, read on demand rather than always in context.",
  glossary: "Vocabulary: the exact words this project uses, and what they mean.",
};
