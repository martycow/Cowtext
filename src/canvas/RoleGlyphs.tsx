// Hand-authored 8×8 pixel glyphs — the primary role identifier (colour is
// redundant coding, DESIGN_SPEC.md). The only non-stroke iconography in the
// app. The design-project originals live in "Cowtext Spec.dc.html"; these are
// in-repo recreations so there is no icon dependency.

import type { NodeRole } from "../store/graph";

// 8 rows × 8 cols; "#" = filled pixel.
// v5 (WO13_CONTRACT.md §6.1, §17): 14 roles now, declaration order matching
// NODE_ROLES. `rules`→`rule` is a straight rename (bitmap unchanged); `task`,
// `reference` and `snippet` are gone (their v5 successors — `workflow`,
// `architecture`, `example` — already have, or now get, their own glyph);
// `decision`, `env`, `tool` and `example` are new hand-authored bitmaps, per
// the WO13 dispatch (13 → 14 keys, no index signature — the exhaustive
// Record is the safety net for the closed 14-role set, project.rs:592-605).
const PIXELS: Record<NodeRole, readonly string[]> = {
  // Head and shoulders — who the agent is.
  agent: [
    "..####..",
    "..####..",
    "..####..",
    "........",
    ".######.",
    "########",
    "########",
    "########",
  ],
  // Shield — hard constraints.
  rule: [
    "########",
    "########",
    "########",
    ".######.",
    ".######.",
    "..####..",
    "...##...",
    "........",
  ],
  // Padlock — a fact that must stay locked/true.
  invariant: [
    "..####..",
    "..#..#..",
    "..#..#..",
    ".######.",
    ".######.",
    ".######.",
    ".######.",
    ".######.",
  ],
  // Hollow hazard diamond — a known gotcha.
  trap: [
    "...##...",
    "..#..#..",
    ".#....#.",
    "#......#",
    "#......#",
    ".#....#.",
    "..#..#..",
    "...##...",
  ],
  // Building blocks — how it fits together.
  architecture: [
    "........",
    "..####..",
    "..####..",
    "..####..",
    "........",
    "###..###",
    "###..###",
    "###..###",
  ],
  // Fork — a branch point, two paths converging to one stem. New in v5:
  // `decision` sits beside `architecture` in the structure group, but a
  // decision is a CHOICE rather than a shape, so it gets its own mark
  // instead of reusing architecture's blocks.
  decision: [
    "##....##",
    ".#....#.",
    "..#..#..",
    "...##...",
    "...##...",
    "...##...",
    "...##...",
    "........",
  ],
  // Descending steps — ordered processes.
  workflow: [
    "........",
    "###.....",
    "###.....",
    "...###..",
    "...###..",
    "......##",
    "......##",
    "........",
  ],
  // Prompt chevron + cursor bar — a command to run.
  command: [
    "........",
    "..#.....",
    "...#....",
    "....#...",
    "...#....",
    "..#.....",
    "........",
    ".#####..",
  ],
  // Starburst badge — a learned capability.
  skill: [
    "...##...",
    "...##...",
    "..####..",
    "########",
    ".######.",
    "..####..",
    ".##..##.",
    "##....##",
  ],
  // Plug — the runtime/environment it's plugged into. New in v5: `env` has
  // no v4 predecessor; a plug reads as "what this project is wired into"
  // without borrowing workflow's steps or tool's hardware.
  env: [
    ".##.##..",
    ".##.##..",
    ".######.",
    ".######.",
    ".######.",
    "..####..",
    "..####..",
    "...##...",
  ],
  // Hex nut, hollow — hardware you turn a wrench on. New in v5: `tool`
  // (external commands/integrations) is deliberately NOT the command
  // glyph's chevron — it names a thing, not an action to invoke.
  tool: [
    "..####..",
    ".#....#.",
    "#......#",
    "#......#",
    "#......#",
    "#......#",
    ".#....#.",
    "..####..",
  ],
  // Uneven text lines — vocabulary.
  glossary: [
    "........",
    "######..",
    "........",
    "########",
    "........",
    "#####...",
    "........",
    "###.....",
  ],
  // Target rings — a concrete instance that hits the mark, good or bad.
  // New in v5: replaces `snippet`'s hollow brackets (a generic "reusable
  // fragment") now that the role is specifically the good/bad worked
  // example, not just any excerpt.
  example: [
    "..####..",
    ".#....#.",
    "#.####.#",
    "#.#..#.#",
    "#.#..#.#",
    "#.####.#",
    ".#....#.",
    "..####..",
  ],
  // Diagonal brush stroke — voice and formatting.
  style: [
    "......##",
    ".....##.",
    "....##..",
    "...##...",
    "..##....",
    ".####...",
    "####....",
    "##......",
  ],
};

function toPath(rows: readonly string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
    }
  });
  return d;
}

const PATHS: Record<NodeRole, string> = Object.fromEntries(
  (Object.keys(PIXELS) as NodeRole[]).map((role) => [role, toPath(PIXELS[role])]),
) as Record<NodeRole, string>;

/** 8×8 pixel glyph, `currentColor`, crisp edges. Size in CSS px (spec: 11px on the card). */
export function RoleGlyph({ role, size = 11 }: { role: NodeRole; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="flex-none"
    >
      <path d={PATHS[role]} fill="currentColor" />
    </svg>
  );
}

/** Role colour as a CSS variable reference (tokens.css owns the values). */
export function roleVar(role: NodeRole): string {
  return `var(--role-${role})`;
}
