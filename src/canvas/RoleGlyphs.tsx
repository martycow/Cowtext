// Hand-authored 8×8 pixel glyphs — the primary role identifier (colour is
// redundant coding, DESIGN_SPEC.md). The only non-stroke iconography in the
// app. The design-project originals live in "Cowtext Spec.dc.html"; these are
// in-repo recreations so there is no icon dependency.

import type { NodeRole } from "../store/graph";

// 8 rows × 8 cols; "#" = filled pixel.
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
  rules: [
    "########",
    "########",
    "########",
    ".######.",
    ".######.",
    "..####..",
    "...##...",
    "........",
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
  // Flag — work with a finish line.
  task: [
    ".######.",
    ".######.",
    ".######.",
    ".#......",
    ".#......",
    ".#......",
    ".#......",
    ".#......",
  ],
  // Bookmark with a notched tail — lookup material.
  reference: [
    "..####..",
    "..####..",
    "..####..",
    "..####..",
    "..####..",
    "..####..",
    "..####..",
    "..#..#..",
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
