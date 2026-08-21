// The node-taxonomy single source of truth (WO13_CONTRACT.md §6.3, lane T1).
//
// One array drives the wizard's tile grid, the Inspector's RolePopup, the
// preview pane and (via `roleMeta.ts`'s thin re-export) every existing
// consumer of the old `ROLE_DESCRIPTIONS`/`ROLE_GROUPS` shape. No role
// metadata may be duplicated anywhere else — icons stay in
// `src/canvas/RoleGlyphs.tsx` (hand-authored pixel art, U2's file, keyed on
// `NodeRole` directly) and colours stay in `src/styles/tokens.css`
// (`--role-*`), but everything ELSE describing what a role means lives here.
//
// `microExample` is mandatory and is a CONCRETE INSTANCE for every role,
// never a definition — the contract's own worked pair ("All timestamps are
// UTC" next to "Never commit directly to main") is what tells `invariant`
// and `rule` apart at a glance; a paraphrase of the role's definition tells
// nothing a `hint` doesn't already say. `accent` names a CSS custom property
// (`--role-<role>`, all 14 declared in tokens.css) and is never a hex
// literal — enforced by `nodeTypes.test.ts`'s `rg`-equivalent scan.

import type { NodeRole } from "../store/graph";

export type NodeGroup = "identity" | "constraints" | "structure" | "process" | "knowledge";

/** UI hint only for the 12 roles where `loadLocked === false` (edge spec
 *  A4's own words) — it never affects compilation. It decides which edge
 *  kind the canvas preselects when the user draws an edge INTO a node of
 *  this role (§6.3's table): `always` ⇒ imports/no guard, `on-glob` ⇒
 *  imports + an empty (focused) glob guard, `on-demand` ⇒ references,
 *  `on-invoke` ⇒ references + the inline note "Commands run when you call
 *  them". For the two `loadLocked` roles this is the value `resolveLoad`'s
 *  rule 1 ACTUALLY returns, regardless of edges or `rootLoad`. */
export type NodeDefaultLoad = "always" | "on-demand" | "on-glob" | "on-invoke";

export interface NodeTypeMeta {
  /** NOT `type` — this repo's field is `role` (MemoryNode.role). */
  role: NodeRole;
  group: NodeGroup;
  label: string;
  /** <= 60 chars, plain language — what the role IS, not how to use it. */
  hint: string;
  /** MANDATORY. A concrete instance of the role's content, never a
   *  definition of the role itself. */
  microExample: string;
  /** A CSS custom-property NAME (`--role-<role>`), never a hex literal. */
  accent: string;
  defaultLoad: NodeDefaultLoad;
  /** `true` ⇔ `resolveLoad`'s Amendment-1 rule 1 governs this role (§8.2):
   *  the resolved policy is fixed by role alone, regardless of `rootLoad`
   *  or any edge. `true` for exactly two roles — `command` and `skill`. */
  loadLocked: boolean;
  /** Required iff `loadLocked` — shown as the read-only badge replacing the
   *  root-load control on wizard step 2 (node spec D1). */
  lockedReason?: string;
}

/** Declaration order IS the contract's §6.1 enumeration order and mirrors
 *  `src-tauri/src/project.rs`'s `NodeRole` enum exactly: 14 roles, 5 groups
 *  (1 identity + 3 constraints + 2 structure + 5 process + 3 knowledge).
 *  `agent` sits outside the four wizard-pickable groups — see
 *  `src/wizard/roles.ts`'s `WIZARD_BLOCKED_ROLES` and
 *  `WIZARD_ROLE_GROUPS` for why (dropping it would orphan every
 *  `.claude/agents/*.md` node). */
export const NODE_TYPES: readonly NodeTypeMeta[] = [
  {
    role: "agent",
    group: "identity",
    label: "Agent",
    hint: "An agent's identity, duties and tools.",
    microExample:
      "You are tech-ui: you own src/canvas/ and src/inspector/, and never touch src-tauri/.",
    accent: "--role-agent",
    defaultLoad: "on-demand",
    loadLocked: false,
  },
  {
    role: "rule",
    group: "constraints",
    label: "Rule",
    hint: "A hard constraint the agent must never break.",
    microExample: "Never commit directly to main.",
    accent: "--role-rule",
    defaultLoad: "always",
    loadLocked: false,
  },
  {
    role: "invariant",
    group: "constraints",
    label: "Invariant",
    hint: "A fact that must always hold, stated plainly.",
    microExample: "All timestamps are UTC.",
    accent: "--role-invariant",
    defaultLoad: "always",
    loadLocked: false,
  },
  {
    role: "trap",
    group: "constraints",
    label: "Trap",
    hint: "A known gotcha, flagged so it isn't repeated.",
    microExample:
      "Editing graph.ts's addEdge output directly skips the legality check — always go through the store action.",
    accent: "--role-trap",
    defaultLoad: "always",
    loadLocked: false,
  },
  {
    role: "architecture",
    group: "structure",
    label: "Architecture",
    hint: "How the system fits together: modules and data flow.",
    microExample:
      "The webview never touches the filesystem directly — every read or write goes through a Rust command.",
    accent: "--role-architecture",
    defaultLoad: "on-demand",
    loadLocked: false,
  },
  {
    role: "decision",
    group: "structure",
    label: "Decision",
    hint: "A choice that was made, and why, so it isn't re-litigated.",
    microExample:
      "We store the graph as JSON, not SQLite, because git diffs need to stay readable.",
    accent: "--role-decision",
    defaultLoad: "on-demand",
    loadLocked: false,
  },
  {
    role: "workflow",
    group: "process",
    label: "Workflow",
    hint: "The ordered steps for a recurring job.",
    microExample: "1. Run cargo test. 2. Run npm run lint. 3. Open a PR.",
    accent: "--role-workflow",
    defaultLoad: "on-demand",
    loadLocked: false,
  },
  {
    role: "command",
    group: "process",
    label: "Command",
    hint: "A runnable procedure, invoked by name, not read passively.",
    microExample: "/deploy — builds the release bundle and uploads it to the staging bucket.",
    accent: "--role-command",
    defaultLoad: "on-invoke",
    loadLocked: true,
    lockedReason: "Commands only run when you call them.",
  },
  {
    role: "skill",
    group: "process",
    label: "Skill",
    hint: "A reusable technique the agent loads when it's relevant.",
    microExample:
      "How to write a Cowtext migration pass: key it on a value that stops existing once it runs.",
    accent: "--role-skill",
    defaultLoad: "on-demand",
    loadLocked: true,
    lockedReason: "Skills load themselves when they're relevant.",
  },
  {
    role: "env",
    group: "process",
    label: "Env",
    hint: "Build, run and test commands for this project's shell.",
    microExample: "npm run tauri dev — Vite on :1420, then cargo run.",
    accent: "--role-env",
    defaultLoad: "always",
    loadLocked: false,
  },
  {
    role: "tool",
    group: "process",
    label: "Tool",
    hint: "An external tool the agent can reach for, and how.",
    microExample: "The Figma MCP server: call get_screenshot before editing a component.",
    accent: "--role-tool",
    defaultLoad: "always",
    loadLocked: false,
  },
  {
    role: "glossary",
    group: "knowledge",
    label: "Glossary",
    hint: "The exact words this project uses, and what they mean.",
    microExample: "Memory Node — a graph node backed by a real .md file on disk.",
    accent: "--role-glossary",
    defaultLoad: "on-demand",
    loadLocked: false,
  },
  {
    role: "example",
    group: "knowledge",
    label: "Example",
    hint: "A worked good/bad pair showing what to do and not do.",
    microExample: "Good: catch a specific error type. Bad: catch (e) { /* ignore */ }",
    accent: "--role-example",
    defaultLoad: "on-glob",
    loadLocked: false,
  },
  {
    role: "style",
    group: "knowledge",
    label: "Style",
    hint: "Voice and formatting conventions for output.",
    microExample: "Use sentence case for headings, never Title Case.",
    accent: "--role-style",
    defaultLoad: "on-glob",
    loadLocked: false,
  },
];

/** Fast lookup, built once — every consumer that needs one role's meta
 *  (the wizard's tile, the Inspector's RolePopup row, the preview pane)
 *  reads through this rather than `.find()`-ing `NODE_TYPES` at each call
 *  site. */
export const NODE_TYPE_BY_ROLE: Readonly<Record<NodeRole, NodeTypeMeta>> = Object.fromEntries(
  NODE_TYPES.map((t) => [t.role, t]),
) as Record<NodeRole, NodeTypeMeta>;

/** The two roles Amendment 1's rule 1 locks to a fixed destination
 *  (`command` → on-invoke, `skill` → on-demand), read off `NODE_TYPES`
 *  rather than hand-duplicated — see `edgeRules.ts`'s `imports → command` /
 *  `imports → skill` deny rules, which exist as the draw-time half of the
 *  same policy `resolveLoad` enforces at compile time (§6.3). */
export const LOAD_LOCKED_ROLES: readonly NodeRole[] = NODE_TYPES.filter(
  (t) => t.loadLocked,
).map((t) => t.role);
