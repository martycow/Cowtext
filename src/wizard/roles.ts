// D3a (WO12) — the New Node wizard's role allow-list, in ONE place.
//
// `agent` is minted by the Agent Wizard (tasks/NewAgentDialog.tsx), which
// writes a real `.claude/agents/*.md`. Creating one here mints a
// `context/*.md` tagged `agent` that Claude Code cannot see — the state the
// Inspector's ConvertBanner exists to repair. Re-tagging an already-adopted
// agent node stays available in the Inspector, so this list is deliberately
// wizard-local: do NOT delete `"agent"` from roleMeta.ts's ROLE_GROUPS, that
// shared taxonomy also drives the Inspector's RolePopup (roving-tabindex over
// ROLE_FLAT), which needs the entry for adopted agent nodes.
//
// The wizard has three ways a role reaches `createNodeFrom`, and the picker
// is only one of them — Import preset (wizard/preset.ts) and a stale/edited
// wizard state both bypass it. Every one of them funnels through the helpers
// below so the picker and the write path can never drift apart.

import { ROLE_GROUPS } from "../canvas/roleMeta";
import type { NodeRole } from "../store/graph";

/** Roles the New Node wizard must never create. */
export const WIZARD_BLOCKED_ROLES: readonly NodeRole[] = ["agent"];

/** Landing spot for a blocked (or unknown) role that arrives from outside the
 *  picker. Deliberately the same fallback `migrateGraph`'s pass 5 uses for an
 *  unrecognized role string (v5: "reference" no longer exists — WO13_CONTRACT.md
 *  §6.1/§5.1), so both bad-input paths behave identically. */
export const WIZARD_FALLBACK_ROLE: NodeRole = "architecture";

/** Where the blocked roles actually live, for user-facing copy. */
export const WIZARD_BLOCKED_HINT = "Agents are created in the Agents rail.";

/** May the New Node wizard create a node with this role? */
export function isWizardRole(role: NodeRole): boolean {
  return !WIZARD_BLOCKED_ROLES.includes(role);
}

/** Coerce any role into one the wizard is allowed to create. */
export function toWizardRole(role: NodeRole): NodeRole {
  return isWizardRole(role) ? role : WIZARD_FALLBACK_ROLE;
}

/** ROLE_GROUPS minus the blocked roles (and any group left empty by the
 *  filter — today that is the single-entry Identity header). Rendered by the
 *  wizard's RolePicker; the Inspector keeps the unfiltered ROLE_GROUPS. */
export const WIZARD_ROLE_GROUPS = ROLE_GROUPS.map((g) => ({
  ...g,
  roles: g.roles.filter((r) => isWizardRole(r)),
})).filter((g) => g.roles.length > 0);
