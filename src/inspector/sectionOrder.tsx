// WO11 C2/D1 — the Inspector's section order model.
//
// Before this, "which component renders first" was decided by JSX position
// in Inspector.tsx: Position/Transform happened to be typed first in both
// PropertiesTab and AgentNodePanel, so it was permanently pinned to the top
// of the panel no matter how little sense that made for a node you're
// scanning top-to-bottom (Metadata should read before where the card sits
// on the canvas). There was no ordering CONCEPT at all — just accretion.
//
// This module is that concept: one declared array per panel kind, per
// WO11_CONTRACT.md §5.3's table, byte-exact. A panel builds a lookup of
// { sectionKey: <rendered InspectorSection> } and hands it to `SectionStack`
// below, which walks the declared order and looks each key up — so a
// section can never be hoisted back to the top by moving it earlier in a
// panel's JSX. Reordering the visible panel means editing the array here,
// not the render function. No drag-to-reorder, no add/remove component —
// same reasoning as WO10 §2.4: these sections aren't optional per node.
import { Fragment, type ReactNode } from "react";

export type MemoryNodeSectionKey =
  | "node.metadata"
  | "node.context"
  | "node.relations"
  | "node.file"
  | "node.position"
  | "node.assemble"
  | "node.actions";

export const MEMORY_NODE_ORDER: readonly MemoryNodeSectionKey[] = [
  "node.metadata",
  "node.context",
  "node.relations",
  "node.file",
  "node.position",
  "node.assemble",
  "node.actions",
];

export type AgentNodeSectionKey =
  | "node.agent"
  | "node.context"
  | "node.relations"
  | "node.position"
  | "node.assemble"
  | "node.actions";

export const AGENT_NODE_ORDER: readonly AgentNodeSectionKey[] = [
  "node.agent",
  "node.context",
  "node.relations",
  "node.position",
  "node.assemble",
  "node.actions",
];

export type OffGraphAgentSectionKey = "node.agent" | "node.actions";

export const OFF_GRAPH_AGENT_ORDER: readonly OffGraphAgentSectionKey[] = [
  "node.agent",
  "node.actions",
];

// Declared for completeness against §5.3's table (SkillEditor is UI-D's
// file, out of this lane's zone — not wired through SectionStack here).
export type SkillSectionKey = "skill.skill" | "skill.actions";

export const SKILL_ORDER: readonly SkillSectionKey[] = ["skill.skill", "skill.actions"];

export type EdgeSectionKey = "edge.metadata" | "edge.appearance" | "edge.path" | "edge.actions";

// §5.3's table names only Metadata · Path · Actions. Appearance (WO10 item
// 13, landed after that table's prose was written) is kept — dropping it
// here would delete a shipped feature, which is a worse outcome than the
// table being one section short. Documented deviation, not a defect.
export const EDGE_ORDER: readonly EdgeSectionKey[] = [
  "edge.metadata",
  "edge.appearance",
  "edge.path",
  "edge.actions",
];

export type ProjectSectionKey =
  | "project.identity"
  | "project.description"
  | "project.requirements"
  | "project.rules"
  | "project.git"
  | "project.actions";

export const PROJECT_ORDER: readonly ProjectSectionKey[] = [
  "project.identity",
  "project.description",
  "project.requirements",
  "project.rules",
  "project.git",
  "project.actions",
];

/** Renders `sections[key]` for every key in `order`, in that order, skipping
 *  any key a caller didn't supply. The order array is the only thing that
 *  decides layout — `sections` is a plain lookup, never read for its own
 *  (irrelevant) property order. */
export function SectionStack<K extends string>({
  order,
  sections,
}: {
  order: readonly K[];
  sections: Partial<Record<K, ReactNode>>;
}) {
  return (
    <>
      {order.map((key) => (
        <Fragment key={key}>{sections[key] ?? null}</Fragment>
      ))}
    </>
  );
}
