// Shared identity module — AGENTS_SUITE_CONTRACT.md §7.1. ONE deterministic
// algorithm, consumed by both src/agents/AgentAvatar.tsx (lane C) and
// src/scene/calf.ts (lane D). Frozen: any change to the arithmetic below
// changes every user's avatars and calf looks. Do not "improve" it.
//
// Pure module: no DOM, no Pixi, no React, no store, no randomness, no Date.
// The seven-role list below mirrors NODE_ROLES (src/store/graph.ts) in the
// same order but is deliberately NOT imported from there, so this file has
// zero runtime or type coupling to any store.

/** Mirrors NodeRole (src/store/graph.ts) structurally — not imported, see
 *  header comment. Kept in exact sync by convention; both are the same
 *  seven-member string union so values are freely interchangeable. */
type Role =
  | "agent"
  | "rules"
  | "architecture"
  | "workflow"
  | "task"
  | "reference"
  | "glossary";

export type CalfProp = "bell" | "bandana" | "flower" | "tag" | "none";

export interface AvatarParams {
  rows: string[];
  bits: number;
  accentIdx: number;
}

export interface CalfLook {
  patchMask: number;
  accentIdx: number;
  prop: CalfProp;
}

/** Order = roleMeta/NODE_ROLES. Index is what accentIdx (h2 % 7) selects. */
export const ACCENT_ROLES: readonly Role[] = [
  "agent",
  "rules",
  "architecture",
  "workflow",
  "task",
  "reference",
  "glossary",
];

const PROPS: readonly CalfProp[] = ["bell", "bandana", "flower", "tag", "none"];

function norm(seed: string): string {
  const trimmed = seed.trim().toLowerCase();
  return trimmed === "" ? "cowtext" : trimmed;
}

/** FNV-1a, 32-bit, over UTF-16 code units (deterministic — only TS consumes
 *  this hash, so byte-vs-code-unit fidelity with other languages is moot). */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function popcount(n: number): number {
  let x = n >>> 0;
  let count = 0;
  while (x !== 0) {
    x &= x - 1;
    count += 1;
  }
  return count;
}

/** 8×8, vertically symmetric avatar grid. Same seed ⇒ same avatar, forever. */
export function avatarParams(seed: string): AvatarParams {
  const n = norm(seed);
  const h1 = fnv1a32(n);
  const h2 = fnv1a32(`${n}#2`);
  // AND clears rows 0 and 7 (breathing room); OR guarantees a solid 2×4 core
  // (cols 2-3, rows 2-5 of the left half) — density is always 8-24 of 32 cells.
  const bits = ((h1 & 0x0ffffff0) | 0x00cccc00) >>> 0;
  const rows: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    const left: string[] = [];
    for (let col = 0; col < 4; col += 1) {
      const i = row * 4 + col;
      const filled = ((bits >>> i) & 1) === 1;
      left.push(filled ? "#" : ".");
    }
    const right = [left[3], left[2], left[1], left[0]];
    rows.push([...left, ...right].join(""));
  }
  const accentIdx = h2 % 7;
  return { rows, bits, accentIdx };
}

/** 4×3 coat grid + accent + prop. Shares accentIdx with the avatar so a calf
 *  and its avatar always match hue. Same seed ⇒ same calf, forever. */
export function calfLook(seed: string): CalfLook {
  const n = norm(seed);
  const h1 = fnv1a32(n);
  const h2 = fnv1a32(`${n}#2`);
  let m = (h1 >>> 8) & 0xfff;
  if (popcount(m) < 2) m |= 0x041;
  while (popcount(m) > 7) {
    m &= m - 1;
  }
  const accentIdx = h2 % 7;
  const prop = PROPS[(h2 >>> 8) % 5];
  return { patchMask: m, accentIdx, prop };
}

/** Role colour as a CSS variable reference — matches roleVar (RoleGlyphs.tsx). */
export function accentVar(accentIdx: number): string {
  return `var(--role-${ACCENT_ROLES[accentIdx]})`;
}
