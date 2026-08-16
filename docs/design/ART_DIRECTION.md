# Cowtext — Art Direction (the Barn, plan §8)

Placeholder-quality assets and the rules the real ones must follow. The barn scene
itself is **Phase 5**; these assets and this doc exist early so the style is settled
before any Pixi code is written. No app code consumes them yet.

**Style contract (from plan §8, non-negotiable):** 16-bit SNES · 2:1 isometric,
**32×16 base tile** · warm barn palette (wood, hay, dusk light through slats) ·
dithered shadows · **max 4 frames per animation loop**. Think Harvest Moon SNES ×
Game Dev Tycoon. Placeholders first, Aseprite originals later.

The design-system rule carries into the barn: **blue is you, amber is the cow.**
Scarf blue appears only on the cow's/calf's scarf and the dev's shirt (the dev *is*
the user). Amber is hay, paper, and dusk light — the material the agent works with.

## Palette — "Barnlight-29"

29 colours. Every value either **is** a token from
[`tokens.css`](tokens.css) or is derived from one (dusked = darkened toward
`--surface-0`, keeping the hue). The `char` column is the key used in the ASCII
grids in [`scripts/gen_sprites.py`](../../scripts/gen_sprites.py) — that script is
the palette's executable form; keep the two in sync.

| char | Name | Hex | Derivation | Use |
|---|---|---|---|---|
| `K` | outline | `#241A12` | warm near-black between `--surface-0` and `--border-subtle` | the **only** outline colour |
| `N` | night | `#16130F` | = `--surface-0` | cavities: open drawers, shelf interiors |
| `w` | wood-shadow | `#5A3F28` | brown-warmth ramp, extended darker | plank seams, wood shade, floor dither |
| `W` | wood-mid | `#7A5636` | brown-warmth ramp | default wood: beams, frames, furniture |
| `L` | wood-light | `#9C7248` | brown-warmth ramp | lit wood edges, door brace |
| `P` | wood-pale | `#BC9260` | brown-warmth ramp | desk top (most-lit surface in the room) |
| `h` | hay-deep | `#B07D2E` | `--amber` dusked | cork field, hay shadow, tail tuft |
| `H` | hay | `#E8A33D` | = `--amber` | hay proper, live-agent accents |
| `y` | hay-light | `#F0BE72` | = `--amber-text` | hay highlight, dusk-light slits in walls |
| `Y` | hay-pale | `#F7DCA8` | amber lightened | **paper** — notes, files, corkboard sheets |
| `M` | milk | `#F4EFE7` | = `--text-primary` | cow/calf body white |
| `c` | cream | `#E4D9C8` | milk shaded one step | cow underside, leg shading |
| `p` | patch | `#4A3728` | `--border-strong` warmed | cow patches, hooves, dev trousers |
| `d` | patch-dark | `#33251A` | patch darkened | eyes, darkest patch, dev hair |
| `z` | muzzle | `#E0A891` | `--role-persona` desaturated | cow muzzle, skin |
| `S` | scarf | `#4C9BE8` | = `--accent` | the scarf; dev shirt. **Blue is you** |
| `s` | scarf-shade | `#3B85CE` | = `--accent-active` | scarf shading |
| `t` | scarf-light | `#82BAF0` | = `--accent-text` | scarf highlight, monitor glint |
| `R` | barn-red | `#A34233` | `--danger` dusked | barn walls, door |
| `r` | barn-red-shade | `#7E3226` | barn-red dusked | plank seams, wall dither |
| `g` | slate | `#8E8477` | = `--text-muted` | cabinet metal, door handle |
| `f` | slate-dark | `#5C544A` | = `--text-disabled` | cabinet shading, monitor stands |
| `E` | screen | `#56B4E9` | = `--role-architecture` | monitor screens |
| `e` | screen-dark | `#2B5A75` | screen dusked | screen lower glow |
| `G` | leaf | `#4FB477` | = `--success` | book spines, later plants |
| `O` | clay | `#E4784F` | = `--role-persona` | book spines |
| `U` | straw | `#E3C25F` | = `--role-rules` | book spines |
| `V` | iris | `#8A8BEE` | = `--role-task` | book spines |
| `Q` | orchid | `#C58BC9` | = `--role-reference` | book spines |

Rules:

- **No pure black, no pure white, no cold grey.** Everything sits on the warm ramp.
- The five role hues (`G O U V Q` + `E`) appear only as *contents* — book spines,
  screens — never as structure. Structure is wood, red, slate.
- Adding a colour means renaming the palette (Barnlight-30…) and updating both this
  table and `gen_sprites.py`. Prefer reusing a neighbour first.

## Outline & dither rules

1. **Single-colour selective outline.** Every sprite is outlined in `outline
   #241A12` — warm, not black. Exterior silhouette always; interior lines only
   where two same-value areas meet (drawer splits, shelf edges). No double
   outlines, no coloured outlines.
2. **Dither = 50% checkerboard only**, and only in two places: (a) ground shadow
   under an object, (b) the darkening band at the bottom of large flat surfaces
   (floor tile, wall, door). Never as texture on a small sprite, never noise.
3. **Light comes from the upper-left** (dusk through the slats behind the camera's
   left shoulder). Top faces lightest (`P`/`L`), left faces mid, right/bottom
   shaded.
4. **Drop shadows are separate sprites**, not baked in: a dithered `outline`-colour
   ellipse at ~40% width of the caster, drawn on the floor layer so props can be
   re-sorted without dragging shadows along.
5. Max ~10 colours per individual sprite. The cow uses 10; nothing should need more.

## Sprite inventory

Committed placeholders live in `assets/sprites/svg/` (hand-inspectable pixel-grid
SVGs, one `<rect>` per pixel, `shape-rendering: crispEdges`) with 1× PNG twins in
`assets/sprites/png/`. **Source of truth is the ASCII grid in
`scripts/gen_sprites.py`** — edit there, rerun, never touch the SVGs by hand.
All placeholder frames are static (frame 1 of each cycle); the frame counts below
are the spec for the Aseprite pass.

| File | Size | Represents (plan §8 cast) | Placeholder | Cycles needed later |
|---|---|---|---|---|
| `cow` | 24×24 | Claude — small cow, blue scarf, side view | ✅ | idle ·2, walk ·4, read ·2, write ·2, chew ·2 |
| `calf` | 16×16 | subagent — smaller cow, smaller scarf | ✅ | walk ·4, spawn/despawn ·3 |
| `dev` | 16×20 | pixel Marty, seated, blue shirt | ✅ | typing ·2, lean-in ·1, coffee ·2 |
| `desk` | 32×24 | dev's desk, dual monitors | ✅ | screen flicker ·2 (optional) |
| `cabinet_closed` / `cabinet_open` | 16×24 | `rules`/`persona` node | ✅ | the pair *is* the 2-frame drawer anim |
| `bookshelf` | 24×28 | `architecture`/`reference` node | ✅ | book-pop ·2 |
| `corkboard` | 24×18 | `task`/`workflow` node (wall) | ✅ | paper-fly ·4 (paper is its own 8×8 sprite) |
| `crate` | 16×16 | `task`/`workflow` node (floor) | ✅ | paper-fly ·4 (shared) |
| `floor_tile` | 32×16 | 2:1 iso wood floor diamond | ✅ | — |
| `wall` | 32×24 | barn wall, dusk-light slits | ✅ | slit shimmer ·2 (calm mode: off) |
| `door` | 24×28 | barn door — calves spawn here | ✅ | open ·2 |
| `paper` | 8×8 | flying sheet (`Y` + `K`) | follow-up | fly arc ·4 |
| `bubble_*` | 16×12 | `!` `?` `✓` + filename plate | follow-up | static, ≤1.5 s |

Height convention: floor props stand on the 32×16 diamond; tall props may overflow
the tile upward (cabinet 24 px, bookshelf 28 px) — never sideways beyond their
footprint. Characters get a 1-tile footprint.

## Animation specs (event map from plan §8)

Global rules: **≤ 4 frames** per loop, **≤ 1.5 s** per reaction, every animation
interruptible (events queue; walk paths recompute). Calm mode = no sound + reduced
motion: reaction anims drop to their final frame, idle loops stop.

| BarnEvent | Clip(s) | Frames × hold | Total |
|---|---|---|---|
| `prompt_submitted` | `dev_lean` (hold) + `bubble_!` over cow | 1 × 400 ms | 0.4 s |
| `read <file>` | `cow_walk` to prop → prop opens (`cabinet_open` / book-pop) → `bubble_file` | walk 4 × 140 · open 2 × 120 | ≤ 1.5 s |
| `edit/write <file>` | `cow_write` at side desk (typewriter) + paper stack +1 | 2 × 180, loop | while writing |
| `grep/glob` | `cow_walk` between props + `bubble_?` | 4 × 140 | ≤ 1.2 s |
| waiting > 5 s | `dev_coffee` steam + `cow_chew` | steam 2 × 400 · chew 2 × 500 | ambient loop |
| `stop` | `cow_walk` back to dev + `bubble_✓` | 4 × 140 + 1 × 400 | ≤ 1.5 s |
| subagent spawn | `door_open` + `calf` spawn steps | 2 × 120 + 3 × 120 | 0.6 s |
| `SubagentStop` | reverse of spawn | same | 0.6 s |
| idle | `cow_idle` tail flick / ear twitch | 2 × 600 | loop |

Filename bubbles show real paths truncated to 24 chars (§8), rendered in Silkscreen
— the barn is one of its three sanctioned homes (DESIGN_SPEC "Rules of the line").

## Iso grid & anchors

- Screen mapping for tile `(tx, ty)`: `sx = (tx − ty) · 16`, `sy = (tx + ty) · 8`.
- Sprite anchor = **bottom-centre diamond vertex** (Pixi `anchor 0.5, 1.0`).
- Depth sort by `tx + ty`, characters after props on ties.
- Nodes without `scenePos` are auto-placed; `scenePos { tx, ty }` persists in
  `graph.json` (schema §4 — already has the optional field, no bump needed).

## From these files to Pixi spritesheets (Phase 5)

1. **Now → Phase 5 start:** load the 1× PNGs directly as individual textures.
   `scaleMode: 'nearest'`, integer zoom levels only (2×/3×/4×) — never fractional,
   never smoothing. That alone makes placeholders look intentional.
2. **Aseprite pass:** recreate each grid in Aseprite (`.ase` sources go in
   `assets/sprites/ase/`, committed), add the frame cycles above, export one packed
   sheet + JSON via `aseprite --sheet barn.png --data barn.json --format json-array`.
   Frame naming: `cow_walk_0` … `cow_walk_3` — Pixi's `Spritesheet` picks these up
   as `AnimatedSprite` sequences for free.
3. Per plan hard rule: sprites are **assets, not code** — no base64 in source, ever.
   The SVGs here are assets too; the generator script is the only code involved.
4. CC0 packs (Kenney isometric, itch farm packs) may substitute any placeholder;
   if one is adopted, add it to the asset licence manifest (FEATURES 7.8) the day
   it lands.

## Follow-ups

- `paper` and `bubble_*` micro-sprites (trivial grids, add to `gen_sprites.py`).
- Walk/idle/read cycle frames — Aseprite pass, Phase 5.
- Pillow is **not** required and not installed; `gen_sprites.py` writes PNGs with a
  stdlib zlib writer, so no SVG→PNG conversion step is pending.
- SFX side of the §8 event map is specced separately in
  [`SOUND_DESIGN.md`](SOUND_DESIGN.md).
