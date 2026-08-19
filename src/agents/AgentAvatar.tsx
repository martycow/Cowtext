// Deterministic identicon for an agent/skill seed (contract §7.1, §7.3).
// Same 8×8 vertically-symmetric grid + toPath idiom as RoleGlyphs
// (src/canvas/RoleGlyphs.tsx), but the algorithm and colour come from the
// shared identity module — this file owns only the SVG rendering.

import { accentVar, avatarParams } from "../identity/identity";

// Mirrors RoleGlyphs.toPath exactly: one filled-square path per "#" cell.
function toPath(rows: readonly string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
    }
  });
  return d;
}

/** 8×8 crisp-edge identicon. `seed` drives both shape and hue — same seed
 *  always renders the same mark (frozen algorithm, §7.1). Decorative only. */
export function AgentAvatar({ seed, size = 11 }: { seed: string; size?: 11 | 22 | 44 }) {
  const { rows, accentIdx } = avatarParams(seed);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className="flex-none"
    >
      <path d={toPath(rows)} fill={accentVar(accentIdx)} />
    </svg>
  );
}
