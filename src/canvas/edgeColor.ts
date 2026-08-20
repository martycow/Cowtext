// Per-edge colour override (WO10 item 13).
//
// `MemoryEdge.color` has existed in the schema since v3 and round-trips
// through Rust and presets, but nothing ever read it and no UI ever set it.
// This module is the vocabulary that makes it real.
//
// The palette is CLOSED and token-backed. DESIGN_SPEC.md's rule is that hue
// on the canvas belongs to roles, so a free colour picker would let a user
// paint a wire the exact orange of `--role-agent` and quietly break the one
// thing colour is load-bearing for. Seven named entries, each aliasing a
// token that already exists, keeps every override inside the app's own
// scheme and keeps the `[data-warmth]` overrides working for free.
//
// Wire format: the stored string is a palette KEY ("amber"), not a hex. A
// key survives a theme change; a hex freezes one. Hand-written graph.json
// files predating this may carry a raw `#rrggbb`, so those still resolve —
// tolerated on read, never produced on write.

import type { EdgeKind } from "../store/graph";

export interface EdgeColorOption {
  key: string;
  label: string;
  /** The CSS colour this key paints with. */
  css: string;
}

/** `default` is the absence of an override — the wire keeps its kind's own
 *  colour. It is first in the list so the swatch row reads "reset, then
 *  choices", and it is stored as an ABSENT `color`, never as the literal
 *  string "default". */
export const EDGE_COLORS: readonly EdgeColorOption[] = [
  { key: "default", label: "Kind", css: "" },
  { key: "amber", label: "Amber", css: "var(--edge-c-amber)" },
  { key: "blue", label: "Blue", css: "var(--edge-c-blue)" },
  { key: "green", label: "Green", css: "var(--edge-c-green)" },
  { key: "red", label: "Red", css: "var(--edge-c-red)" },
  { key: "violet", label: "Violet", css: "var(--edge-c-violet)" },
  { key: "slate", label: "Slate", css: "var(--edge-c-slate)" },
];

/** The keys that actually paint something — everything but `default`. Marker
 *  defs are generated over this list, so adding an entry above is the only
 *  edit a new colour needs. */
export const EDGE_COLOR_KEYS: readonly string[] = EDGE_COLORS.filter(
  (c) => c.key !== "default",
).map((c) => c.key);

function isHex(v: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(v);
}

/** The CSS colour a wire paints with, given its kind and its stored
 *  override. Unknown keys fall back to the kind colour rather than to
 *  nothing — a typo in a hand-edited file must not make a wire invisible. */
export function edgeStroke(kind: EdgeKind, color: string | undefined): string {
  if (color === undefined || color === "" || color === "default") return `var(--edge-${kind})`;
  if (isHex(color)) return color;
  const hit = EDGE_COLORS.find((c) => c.key === color);
  return hit !== undefined && hit.css !== "" ? hit.css : `var(--edge-${kind})`;
}

/** Marker-def suffix for a stored override, or null when the edge uses its
 *  kind's own marker. A raw hex has no pre-generated marker set (we cannot
 *  emit defs for colours we have never seen), so it falls back to the kind
 *  marker — the line still recolours, the arrowhead stays neutral. That
 *  asymmetry only affects legacy hand-written values. */
export function edgeMarkerSuffix(color: string | undefined): string | null {
  if (color === undefined || color === "" || color === "default") return null;
  return EDGE_COLOR_KEYS.includes(color) ? color : null;
}
