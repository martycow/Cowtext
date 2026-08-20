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

/** 8×8 crisp-edge identicon, or a user-uploaded portrait when `src` is set
 *  (WO11 G6, §5.11/§7.1). `seed` drives both shape and hue — same seed
 *  always renders the same mark (frozen algorithm). Decorative only.
 *  `size` is CSS px; prefer a multiple of 8 so every cell lands on a whole
 *  pixel (11 / 22 / 44 are the long-standing three, 30 is the canvas
 *  portrait window). `src` is a data URL from `agent_avatar_read`/`_set`;
 *  `null`/`undefined`/`""` all fall back to the identicon, so every
 *  pre-WO11 call site keeps rendering exactly as before, unchanged. */
export function AgentAvatar({
  seed,
  size = 11,
  src = null,
}: {
  seed: string;
  size?: number;
  src?: string | null;
}) {
  if (src !== null && src !== "") {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="flex-none rounded-sm object-cover"
      />
    );
  }
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
