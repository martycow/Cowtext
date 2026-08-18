---
name: art-direction
description: Art direction for the Barn — the Barnlight-29 palette, outline and dither rules, iso grid math, sprite inventory with frame counts, and Aseprite export conventions. Load when drawing, placing, or reviewing anything in src/scene/ or assets/sprites/.
---

# Barn art direction

Source: `docs/design/ART_DIRECTION.md` (full palette table, sheet inventory,
deviation audit). Style contract is non-negotiable: **16-bit SNES · 2:1 isometric ·
32×16 base tile · warm barn palette · dithered shadows · max 4 frames per loop ·
every reaction ≤ 1.5 s and interruptible**.

## Palette — Barnlight-29

29 colours; every value is a token from `tokens.css` or derived from one.
`src/scene/palette.ts` mirrors the table 1:1 — keep them in sync. Key anchors:
outline `#241A12` (the ONLY outline colour), `--surface-0` for cavities, wood ramp
`#5A3F28/#7A5636/#9C7248/#BC9260`, hay = `--amber` family, cow body =
`--text-primary`, scarf = `--accent` family, barn red `#A34233`.

Rules:
- No pure black, no pure white, no cold grey — everything on the warm ramp.
- The role hues appear only as *contents* (book spines, screens) — never structure.
  Structure is wood, red, slate.
- Adding a colour renames the palette (Barnlight-30…) and updates both the doc table
  and `scripts/gen_sprites.py`. Prefer reusing a neighbour.
- Max ~10 colours per individual sprite (the cow uses 10).

## Outline, dither, light, shadow

1. Single-colour selective outline in `#241A12`: exterior silhouette always,
   interior lines only where two same-value areas meet.
2. Dither = 50% checkerboard ONLY for (a) ground shadow under an object,
   (b) the darkening band at the bottom of large flat surfaces. Never texture.
3. Light from the upper-left: top faces lightest, left mid, right/bottom shaded.
4. Drop shadows are separate sprites (dithered outline-colour ellipse, ~40% caster
   width, 45% alpha) on the floor layer — never baked in.

## Iso grid & anchors (`src/scene/iso.ts`)

- Tile `(tx, ty)` → screen: `sx = (tx − ty) · 16`, `sy = (tx + ty) · 8`
  (TILE_W 32, TILE_H 16, 12×12 grid).
- Sprite anchor = bottom-centre diamond vertex (Pixi `anchor 0.5, 1.0`).
- Depth sort by `tx + ty`, characters after props on ties.
- `scaleMode: 'nearest'`, integer zoom levels only (1×/2×/3×/4×) — fractional
  scaling shimmers pixel art.

## Cast & props (role → prop)

cow 24×24 (Claude, blue scarf) · calf 16×16 (subagent, spawns at the door) ·
dev 16×20 (pixel Marty, blue shirt — the dev IS the user) · cabinet =
`rules`/`persona` · bookshelf = `architecture`/`reference`/`glossary` ·
corkboard/crate = `task`/`workflow`. Role accents are NOT baked into sheets —
neutral sheet + tiny `accent_tab` overlay tinted at runtime from `ROLE_ACCENT`.

## Production conventions

- Aseprite sources in `assets/sprites/ase/`, one subject per file; export packed
  sheet + JSON (`--format json-array`), frame names `<subject>_<cycle>_<frame>`
  (e.g. `cow_walk_0`…`cow_walk_3`) — Pixi `Spritesheet`/`AnimatedSprite` consume
  directly.
- Sprites are **assets, not code** — never base64 into source files (repo hard rule).
- CC0 substitutes (Kenney, itch farm packs) go into the asset licence manifest the
  day they land.
- Filename bubbles: real paths truncated to 24 chars, Silkscreen (a sanctioned use).
- Calm mode: reaction anims drop to final frame, idle loops stop.
