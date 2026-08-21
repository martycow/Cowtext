// Barnlight-29 palette — named constants copied from docs/design/ART_DIRECTION.md.
// Placeholder graphics draw exclusively from these values (no pure black/white,
// no cold grey). Numbers are Pixi-friendly 0xRRGGBB.

export const PALETTE = {
  outline: 0x241a12, // K — the only outline colour
  night: 0x16130f, // N — cavities: open drawers, shelf interiors
  woodShadow: 0x5a3f28, // w — plank seams, wood shade, floor dither
  woodMid: 0x7a5636, // W — default wood: beams, frames, furniture
  woodLight: 0x9c7248, // L — lit wood edges
  woodPale: 0xbc9260, // P — desk top (most-lit surface)
  hayDeep: 0xb07d2e, // h — cork field, hay shadow
  hay: 0xe8a33d, // H — hay proper, live-agent accents
  hayLight: 0xf0be72, // y — hay highlight, dusk-light slits
  paper: 0xf7dca8, // Y — paper: notes, files, corkboard sheets
  milk: 0xf4efe7, // M — cow body white
  cream: 0xe4d9c8, // c — cow underside, leg shading
  patch: 0x4a3728, // p — cow patches, hooves, dev trousers
  patchDark: 0x33251a, // d — eyes, darkest patch, dev hair
  muzzle: 0xe0a891, // z — cow muzzle, skin
  scarf: 0x4c9be8, // S — the scarf; dev shirt. Blue is you.
  scarfShade: 0x3b85ce, // s — scarf shading
  scarfLight: 0x82baf0, // t — scarf highlight, monitor glint
  barnRed: 0xa34233, // R — barn walls, door
  barnRedShade: 0x7e3226, // r — plank seams, wall dither
  slate: 0x8e8477, // g — cabinet metal
  slateDark: 0x5c544a, // f — cabinet shading, monitor stands
  screen: 0x56b4e9, // E — monitor screens
  screenDark: 0x2b5a75, // e — screen lower glow
  leaf: 0x4fb477, // G — book spines
  clay: 0xe4784f, // O — book spines
  straw: 0xe3c25f, // U — book spines
  iris: 0x8a8bee, // V — book spines
  orchid: 0xc58bc9, // Q — book spines
} as const;

/** Role-hue accents (contents only, never structure — ART_DIRECTION rule).
 *  TWO independent consumers, TWO different role vocabularies — do not
 *  reconcile them into one:
 *
 *  1. `makeCabinet` (props.ts, called from sceneGraph.ts's `propForRole`)
 *     reads v5 `NodeRole`. Only `rule`/`agent`/`invariant`/`trap` ever reach
 *     it — the four cabinet-routed roles (WO13 §14.6). `makeBookshelf`/
 *     `makeCrate` ignore role entirely, so no other v5 role needs an entry
 *     here for props.
 *  2. `makeCalf` (calf.ts, write-forbidden §16) reads `identity.ts`'s
 *     frozen, deliberately un-synced 7-member `Role` — still the PRE-WO13
 *     vocabulary (`rules`/`architecture`/`workflow`/`task`/`reference`/
 *     `glossary`, plus `agent`). `identity.ts`'s header says changing its
 *     arithmetic rotates every existing user's calf look; that ban extends
 *     transitively to deleting the palette keys it looks up, even though
 *     this file is not the forbidden one. **Do not remove or rename the six
 *     legacy keys below** — they are dead for props (WO03 tradeoff, see
 *     tech-barn agent-memory `wo03-role-schema-v3-props`) but live for
 *     calves. `rule` is added alongside `rules` for the v5 cabinet path;
 *     both resolve to the same straw the `?? PALETTE.straw` fallback would
 *     give anyway, so adding it changes no pixel — it just stops the v5 name
 *     from silently depending on the fallback. */
export const ROLE_ACCENT: Record<string, number> = {
  rule: PALETTE.straw,
  rules: PALETTE.straw,
  agent: PALETTE.clay,
  // WO06 B1 fix — invariant/trap previously fell back to PALETTE.straw
  // (rule's colour) via `ROLE_ACCENT[role] ?? PALETTE.straw`, making three
  // cabinet-routed roles visually identical. Reuse two of the palette's
  // already-established decorative "book spine" hues (iris/orchid) rather
  // than add a 30th Barnlight colour — both are otherwise dead entries
  // below (task/workflow), so this creates no on-screen clash.
  invariant: PALETTE.iris,
  trap: PALETTE.orchid,
  architecture: PALETTE.screen,
  reference: PALETTE.orchid,
  task: PALETTE.iris,
  workflow: PALETTE.iris,
  glossary: PALETTE.leaf,
};
