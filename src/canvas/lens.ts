// Canvas lens formulas — pure, no JSX. Block A (WO01_BLOCK_A_CONTRACT.md §6.2).
// A lens only ever produces a brightness/emphasis pair for MemoryNodeCard to
// paint through CSS custom properties; it never touches layout.

import { create } from "zustand";

/** "base": nothing to say about this node. */
export const LENS_BRIGHT_MIN = 0.66;
/** Full emphasis. */
export const LENS_BRIGHT_MAX = 1.18;
/** 60 min, per T2 — activity decays to base over this window. */
export const ACTIVITY_WINDOW_MS = 3_600_000;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** MIN + (MAX-MIN) * clamp01(emphasis). */
export function brightnessFor(emphasis: number): number {
  return LENS_BRIGHT_MIN + (LENS_BRIGHT_MAX - LENS_BRIGHT_MIN) * clamp01(emphasis);
}

/** Linear decay from full emphasis at age 0 to 0 at >= ACTIVITY_WINDOW_MS.
 *  `modifiedMs === null` (no backing file / never touched) => 0. */
export function activityEmphasis(nowMs: number, modifiedMs: number | null): number {
  if (modifiedMs === null) return 0;
  const age = Math.max(0, nowMs - modifiedMs);
  return clamp01(1 - age / ACTIVITY_WINDOW_MS);
}

/** Weight lens semantics (Block B / T3, docs/INPUT_PROMPT.md): a node's
 *  emphasis is its token estimate relative to the heaviest scanned .md in
 *  the project — still bytes/4 (`tokensForBytes` in store/tokens.ts) since
 *  the lens only needs a relative ranking, not an exact count. The compiled
 *  totals and COMPILE_WARN_LINES/COMPILE_WARN_TOKENS thresholds live in
 *  store/tokens.ts and are surfaced in the compile modal, not here — this
 *  lens colors the canvas, it doesn't gate a compile. */
export function weightEmphasis(sizeBytes: number | undefined, maxBytes: number): number {
  if (sizeBytes === undefined) return 0;
  return maxBytes > 0 ? sizeBytes / maxBytes : 0;
}

interface LensTickState {
  tick: number;
  bump: () => void;
}

/** Tiny ticker store — LensControl is the ONLY writer (setInterval while
 *  lens === "activity"); cards subscribe unconditionally (rules-of-hooks)
 *  and use `tick` as the sole dependency driving a fresh `Date.now()`. */
export const useLensTickStore = create<LensTickState>((set) => ({
  tick: 0,
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}));
