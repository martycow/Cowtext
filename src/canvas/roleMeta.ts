// Role popup copy — THIN RE-EXPORT over `src/config/nodeTypes.ts`, the v5
// single source of truth (WO13_CONTRACT.md §6.3, §17 "Contested files":
// "It becomes a derived view of nodeTypes.ts. Owning the source and the
// shim in one lane is the only way they cannot drift."). Existing
// consumers (NodeWizard.tsx, the Inspector's RolePopup) keep reading
// `ROLE_DESCRIPTIONS`/`ROLE_GROUPS` from here unchanged; nothing about a
// role's meaning is authored in this file anymore.

import { NODE_TYPES, type NodeGroup } from "../config/nodeTypes";
import type { NodeRole } from "../store/graph";

/** Derived from `NODE_TYPES[*].hint` — kept as its own export (rather than
 *  inlining `NODE_TYPE_BY_ROLE[role].hint` at every call site) so existing
 *  importers of this exact name keep working unchanged. */
export const ROLE_DESCRIPTIONS: Record<NodeRole, string> = Object.fromEntries(
  NODE_TYPES.map((t) => [t.role, t.hint]),
) as Record<NodeRole, string>;

/** Grouping for the 14-role picker — the taxonomy both NodeWizard's step-1
 *  grid and the Inspector's RoleField popup render sections from. Every
 *  `NodeRole` value appears in exactly one group; the five group counts
 *  (1+3+2+5+3) sum to `NODE_ROLES.length` (14), asserted by
 *  `src/config/nodeTypes.test.ts`. Declaration order mirrors
 *  `NodeGroup`'s own order (identity, constraints, structure, process,
 *  knowledge) and, within each group, `NODE_TYPES`' declaration order —
 *  which is itself the contract's §6.1 enumeration order. */
export interface RoleGroup {
  label: string;
  roles: readonly NodeRole[];
}

const GROUP_LABELS: Record<NodeGroup, string> = {
  identity: "Identity",
  constraints: "Constraints",
  structure: "Structure",
  process: "Process",
  knowledge: "Knowledge",
};

const GROUP_ORDER: readonly NodeGroup[] = [
  "identity",
  "constraints",
  "structure",
  "process",
  "knowledge",
];

export const ROLE_GROUPS: readonly RoleGroup[] = GROUP_ORDER.map((group) => ({
  label: GROUP_LABELS[group],
  roles: NODE_TYPES.filter((t) => t.group === group).map((t) => t.role),
}));
