// Starter preset pack (WO12 F5) — a shipped, built-in preset seeding three
// Memory Nodes on EXISTING roles, not a 14th role (see PresetsModal.tsx's
// pinned first row and the rationale below). Frozen decision: preset
// templates, not new graph roles — a new role costs a hand-drawn glyph, a
// WCAG token, and every exhaustive-map entry the taxonomy touches, for zero
// new semantics.
//
// Node choices (WO13_CONTRACT.md F2 — "task"/"reference" no longer exist
// as of the v5 taxonomy; frozen replacements below):
//   - Task Board (role: workflow, docs/tasks/TASKS.md) — "Work with a
//     finish line" folded into workflow's "ordered steps" framing.
//   - Backlog (role: architecture, docs/tasks/BACKLOG.md)
//   - Changelog (role: architecture, docs/CHANGELOG.md)
// TASKS.md and BACKLOG.md are already CONVENTION_DIRS x CONVENTION_NAMES
// hits (tasks.rs:44-49) so the Tasks board picks them up for free without
// any extra wiring. CHANGELOG.md is deliberately NOT a convention name, so
// it stays a pure Memory Node — read by agents, never parsed as a task
// table.
//
// Bodies are built with buildRoleSkeleton (src/wizard/roleSkeleton.ts) —
// pure and deterministic — so headings stay canon with every other
// freshly-created node in the app. This file only supplies title/role/brief
// and, for the Task Board, appends the canonical 6-column grid header
// (tasks.rs:1118 HEADER/SEP, frozen by WO02_CONTRACT.md §194) so the file is
// immediately parseable by the board with zero rows.

import type { NodeRole } from "../store/graph";
import { buildRoleSkeleton } from "../wizard/roleSkeleton";
import { PRESET_VERSION, type CowtextPreset, type PresetNode } from "./types";

// Mirrors tasks.rs:1118/1119 byte-for-byte — this is presentation only (a
// starting file body), not parsed by any Rust code path, so no contract
// coupling beyond "stay byte-identical so the board reads it with 0 rows".
const TASK_TABLE_HEADER = "| Name | Status | Priority | Tags | Agent | Description |";
const TASK_TABLE_SEP = "|---|---|---|---|---|---|";

function starterNode(
  id: string,
  title: string,
  role: NodeRole,
  brief: string,
  filePath: string,
  readOrder: number,
  extraBody?: string,
): PresetNode {
  const body = buildRoleSkeleton(title, role, brief) + (extraBody ?? "");
  return {
    id,
    title,
    role,
    brief,
    filePath,
    readOrder,
    // v5 (WO13_CONTRACT.md F2): `pinned: false` -> omit `rootLoad` entirely
    // (the single-variant-optional shape — see PresetNode.rootLoad).
    position: { x: readOrder * 260, y: 80 },
    content: body,
  };
}

/** Built-in, always-available preset — not read from `preset_list` (which
 *  only enumerates `app_config_dir/presets/*` and is never seeded), so
 *  PresetsModal renders it as a pinned first row and applies this literal
 *  directly instead of round-tripping through presetRead. */
export const STARTER_PRESET: CowtextPreset = {
  version: PRESET_VERSION,
  kind: "cowtext-preset",
  name: "Starter pack",
  savedAt: "",
  nodes: [
    starterNode(
      "starter-task-board",
      "Task Board",
      "workflow",
      "The project's live task table — what's next, what's in progress, what's done.",
      "docs/tasks/TASKS.md",
      1,
      `\n${TASK_TABLE_HEADER}\n${TASK_TABLE_SEP}\n`,
    ),
    starterNode(
      "starter-backlog",
      "Backlog",
      "architecture",
      "Ideas and future work that isn't scheduled yet.",
      "docs/tasks/BACKLOG.md",
      2,
    ),
    starterNode(
      "starter-changelog",
      "Changelog",
      "architecture",
      "A dated log of what shipped, newest entry first.",
      "docs/CHANGELOG.md",
      3,
    ),
  ],
  edges: [],
  compileTargets: ["claude"],
};
