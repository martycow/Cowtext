# Cowtext — Design Spec (v1, dark only)

Digest of the Claude Design project **"UI mockups for Cowtext"**
(`claude.ai/design/p/98f3fa2a-b900-4599-9e18-ba7f71d92871`), file `Cowtext Spec.dc.html`.
**Source of truth for values is `src/styles/tokens.css` and the repo-root
`tailwind.config.js`.** This paragraph used to point at `tokens.css` and
`tailwind.config.js` "next to this doc" — neither has ever existed in
`docs/design/`; the stale copies sit in `docs/_archive/superseded/`. Corrected
2026-08-24. The values themselves still agree with the live files. This doc
records the decisions, rules, and component specs around them.

The project also contains `Cowtext Prototype.dc.html` (screen prototype) — not yet
digested here.

## Core direction

The tool layer borrows the barn's **temperature** and nothing else. Surfaces are warm dark
greys pulled toward hay; type, spacing, and controls stay crisp and modern. Every colour
resolves through a CSS variable, so warmth variants — and a light theme later — are one
override, not a rebuild.

### The one rule that decides the rest

> **Blue is you. Amber is the cow.**

- **Scarf blue (`--accent` #4C9BE8)** marks anything the *user* initiates — primary
  buttons, selection, focus, links, active tabs.
- **Hay amber (`--amber` #E8A33D)** marks anything the *agent* does on its own — live
  reads, assembling, pins that survive compile, the barn HUD.
- Static amber = warning; **moving** amber = live agent.
- Two accents, never mixed on the same control.

## Rules of the line — pixel charm

**Allowed:**
1. Node role icons — hand-authored 8×8 pixel SVG glyphs, `shape-rendering: crispEdges`,
   tinted to the role colour. The only non-stroke iconography in the app.
2. Full-page empty states and onboarding: one cow illustration, large enough to be a
   decision, never a decoration. Inline empties get one line of text, no art.
3. Progress/loading: a **4-step amber pixel march** — never a spinner. Determinate where
   possible.
4. The LIVE / READING tag and the barn HUD — Silkscreen is permitted here and nowhere else.
5. Sharp 7px connection handles + the radius ramp shifted down a step; the pixel grid shows
   in geometry, not ornament.

**Banned:**
1. Pixel fonts for any UI text (labels, buttons, titles, menus, form copy). Silkscreen has
   three sanctioned uses and no fourth.
2. Pixel/dither textures on panels, modals, buttons, inputs. The canvas background is the
   only textured surface.
3. Cow mascots inside working chrome — no cow in the top bar, in a toast, or watching you
   type.
4. Wood/hay/parchment/paper imagery as panel fills. Warmth comes from the surface ramp only.
5. Wobbly borders, bevels, faux-3D buttons, chunky 2px outlines on controls.
6. Sound or animation tied to routine UI events. Tool-layer motion = state changed; barn
   motion = the cow moved.

> **Carve-out — the graph canvas (Marty, 2026-08-19).** `src/canvas/**` runs the "Barn"
> direction and deliberately overrides bans 1, 2 and 5 *inside the canvas viewport only*:
> Silkscreen is permitted on plate labels, order tags, nameplates and the lens control; a
> 6px checker dither sits under the dot grid; plates and canvas chrome use hard 2px edges
> and an unblurred offset shadow. This is a bounded exception, not a repeal — panels,
> modals, the inspector, the top bar and every form stay on the surface ramp and the rules
> above. See "Barn canvas" below.

## Warmth variants

Set `data-warmth` on `<html>`. Surface/border/text ramps only; accents shared.

| Variant | Ramp | Verdict |
|---|---|---|
| `neutral` | #131416 → #292D33 | Standard pro dark; barn feels bolted on |
| `warm` | #16130F → #2F2820 | **Recommended default.** Hue 70°, chroma < .01 — reads as "not cold", barn feels like the same building |
| `brown` | #19130B → #372B1B | Committed; tiring in long sessions ("reading on cardboard") |

## Colour usage notes (values in tokens.css)

- Contrast measured on `--surface-1`; AA 4.5:1 is the floor for all text tokens except
  `--text-disabled` (2.4:1 — disabled + decoration only; line numbers).
- `--text-muted` (4.8:1) never below 11px.
- Surface ramp is 4 steps + `--surface-inset` recessed well (editor, diff, resolved
  preview) + `--surface-canvas` behind the graph.
- Borders are the primary elevation tool; see Elevation below.
- **Node roles: colour is redundant coding.** The 8×8 glyph is the primary identifier;
  lightness is staggered so the set survives deuteranopia and greyscale. Roles own hue.
- **Edges are neutral by rule** — kind is read from line style + marker, never hue.
  Widths and dashes below are the Barn-canvas values (all even, so a 2px line lands on
  whole pixels under `shape-rendering: crispEdges`); the seven kinds and their marker
  shapes are unchanged from v3:
  - `imports` — 2px solid, filled pixel arrow. Content inlined into target on compile.
  - `references` — 2px dash 4 4, open circle marker. Mentioned by path, never inlined.
  - `conditional` — 2px dash 2 4, pixel arrow, **mono condition chip pinned on the
    source-side run** (the chip is the cue, not the colour).
  - `sequence` — 2px solid, pixel chevron, numbered step tag. Ordering only.
  - `overrides` — 4px solid, pixel arrow + trailing bar. Structural, "wins".
  - `supersedes` — 2px dash 8 4, hollow square. Advisory.
  - `conflicts-with` — 2px dash 2 2, cross. Advisory.
  - **Three emphasis tones, in priority order** (WO10): the wire itself selected →
    `--edge-selected` and lifted above every other wire so a crossing can be followed;
    a wire touching the SELECTED NODE → `--edge-related` (`--accent-border`) and one
    step thicker; otherwise rest.
  - **One label per wire, never a stack** (WO10). An icon plus one short verb saying what
    the edge does — Reads / Refers / Then / Controls / Replaces / Conflicts — or, for
    `conditional`, the condition itself compacted to ~18 chars. An author's `note`
    replaces the verb. Labels are swept clear of each other along y by a pure solver
    (`src/canvas/labelSlots.ts`) so two wires' chips never overlap.
  - **The one exception to "edges are neutral"** (WO10): an author may pin a wire to a
    colour from a CLOSED, token-backed palette (`src/canvas/edgeColor.ts`, `--edge-c-*`).
    The palette borrows no role hue, so "colour means role" still holds; the override
    repaints the line and its arrowhead together.
  - Routing is orthogonal with square corners (`src/canvas/edgePath.ts`). The riser turns
    one stub short of the target rather than at the midpoint: fan-in is the common shape
    and a midpoint riser makes every incoming edge share the whole second half of the run,
    so a dashed advisory edge paints over a solid structural one. Fan-OUT still overlaps on
    the source side — that needs a global router, which this is not.
  - **A route may be hand-edited** (WO10). Selecting a wire hangs a 9px handle on each
    interior segment; dragging one snaps to the 4px grid and persists as `waypoints` in
    `graph.json` v4. The two stub segments are never draggable — they are what keeps the
    wire plugged into its connector. "Reset path" returns it to the router.

## Node roles

| Role | Hex | Ratio (surface-2) | Meaning |
|---|---|---|---|
| persona | #E4784F | 5.5:1 | Who the agent is |
| rules | #E3C25F | 9.3:1 | Hard constraints |
| architecture | #56B4E9 | 7.0:1 | How it fits together |
| workflow | #3FBF92 | 7.0:1 | Ordered processes |
| task | #8A8BEE | 5.4:1 | Work with a finish line |
| reference | #C58BC9 | 6.1:1 | Lookup material |
| glossary | #A9A296 | 6.4:1 | Vocabulary — deliberately achromatic |

The seven 8×8 glyphs are hand-authored SVG `<symbol>`s (`#s-persona` … `#s-glossary`),
committed to the repo — no icon dependency. Full SVG source is in `Cowtext Spec.dc.html`
in the design project.

## Barn canvas — node plates (direction C, 2026-08-19)

Values live in `tokens.css` under "Barn plate" (`--plate-*`, `--barn-*`); Tailwind exposes
them as `bg-plate`, `border-plate-edge`, `shadow-plate`, `bg-barn-tag`. Nothing outside
`src/canvas/**` reads them.

Common to both plate shapes: 244px fixed width (`--w-node`), square corners, a hard 2px
edge, `--plate-drop` (`4px 4px 0`, never blurred), a 1px lit lip top-left and a 1px shade
bottom-right. The whole plate is the hit target.

**Memory plate** (~95px tall)

1. **Role glyph chip** — 24px solid square butted into the top-left corner, filled
   `--role-*` with the 8×8 glyph knocked out at 14px in `--barn-canvas`. Replaces the old
   3px stripe: louder at zoom, and it frees the plate edge to carry state instead.
2. **Read-order tag** — Silkscreen 10px on `--barn-tag`, stamped into the top-right corner
   with a 2px left/bottom edge. Grows leftward for 2–3 digits. **Memory plates only**
   (WO10): read order is the sequence the context is assembled in, and an agent is the
   thing doing the reading, not a step in it.
3. **Role label** — Silkscreen 8px uppercase, tinted to role.
4. **Live square / pin** — 6px amber square (hard one-step blink) and the 11px pin icon,
   right-aligned on the label row.
5. **Title** — 13px/600, single line, ellipsis.
6. **File path** — mono 10.5px `--text-muted`, `direction: rtl`.
7. **Tags** — token count always; then at most **one** status badge. Square, 1px
   `--plate-edge`. Two badges means the node needs splitting.

**Agent plate** — same width and information order, different *silhouette*, which is the
point: a ring and a chip both vanish below ~50% zoom and in greyscale, so identification
moved to shape.

- **Notched corner** — the top-left is chamfered 18px (`clip-path`), so the outline alone
  says "agent" at any zoom. `clip-path` also clips `box-shadow`, so the offset shadow is a
  `filter: drop-shadow` here.
- **Frame** — the entire 3px frame is the identity colour (`--role-agent`, `--amber` while
  live, `--danger` on error).
- **Portrait window** — 46px square, 2px frame in the identity colour, `--plate-inset`
  fill, holding the 30px identicon.
- **Nameplate** — model name in Silkscreen 8px, knocked out of an identity-colour block
  under the portrait.
- Priority moves to a tag; the old AGENT chip is gone (the whole plate says it).
- **Model name is shortened for display** (WO10) — `claude-haiku-4-5-20251001` → `Haiku-4.5`.
  The 46px nameplate cannot hold a wire id, and truncating one eats the only part that
  differs between two Anthropic models. Full id stays in the tooltip.
- **Nickname under the title, in quotes**, when the sidecar has one (WO10) — what Marty
  actually calls this agent, as opposed to its file identity on the line above.

### Plate states

| State | Spec |
|---|---|
| Rest | 2px `--plate-edge` (memory) or 3px identity frame (agent) · `--plate-drop` |
| Hover | fill → `--plate-face-hi`; both ports step up to `--amber-text` |
| Selected | 2px `--accent` marquee, inset −5px · inspector follows |
| Relations-hover | same marquee in `--accent-border` |
| Live (reading) | edge/frame → `--amber` + 2px amber marquee, hard blink + 6px amber square |
| Assembling | 4px accent bar under the title |
| Assembled | 2px `--success` marquee, 900ms then back to rest |
| Missing file / error | edge → `--danger` + one red tag in the footer |

Selection is a **marquee** (a separate inset rectangle), not a ring on the plate: a
box-shadow ring would be clipped into the notch on agent plates. One rule, both shapes.

**prefers-reduced-motion:** the global rule in `tokens.css` freezes the blink; the amber
edge, marquee and square all remain, so the state is still fully readable — it just stops
flashing.

### Connectors

Ports read as hardware and are always visible: cartridge edge connectors. Input — a 20px
socket bay straddling the left edge, `--plate-inset` inside a 2px `--port-body` frame with
the left face open. Output — an 8px shoulder flush to the right edge, its contact pins
running through it and 14px out into open canvas. The asymmetry is deliberate: you can
tell input from output without following the wire. Neutral at rest (hue belongs to roles),
`--amber-text` on plate hover, `--accent` when aimed at or while a connection drag is live.
A transparent `::after` holds a **26 × 52** hit area regardless of how small the mark is.

**A port shows one contact finger per connection** (WO10) — floor 1, cap 9 — on an 8px
pitch, so the block's height says how loaded the port is before you trace anything. Height
is `portHeight(pins)` from `canvas/portSlots.ts`: 12px at one pin, **44px at five**, 76px at
the cap. Fingers are elements, not paint, because a gradient has no way to know how many
wires arrived.

The whole treatment is one block in `styles/index.css`; `PIN_REACH` / `SOCKET_BITE` in
`canvas/edgePath.ts` land the wire 4px inside the pin and 3px inside the socket, so it
plugs in with no daylight rather than floating short of the hardware. `SLOT_PITCH` (8px) is
the one number CSS and TS must agree on. Change them together — the frozen geometry table
and its WO10 amendment are `docs/_archive/contracts/WO09_CONNECTOR_CONTRACT.md` §3 / §3a.

## Typography

- **IBM Plex Sans** — all UI. Real 500 weight for dense rows.
- **JetBrains Mono** — anything the filesystem or the model produced: paths, token counts,
  diffs, timestamps, keycaps, condition chips.
- **Silkscreen** — the barn's voice; three uses only (LIVE/READING tags, barn HUD, logo).
- Delivery: self-hosted via `@fontsource` (needs approval — see Open asks). No CDN link:
  offline rendering + survives CSP tightening (backlog 9.8).
- Scale: 9.5 / 10.5 / 11 / 12 / **13 (default)** / 14 / 16 / 20 / 24px — see tokens.css.
  24px is the onboarding headline only.

## Spacing, density, radii

- 4px grid with 2px and 6px available inside controls.
- **Compact is the default** (28px rows/controls) — the window lives next to a terminal
  all day. Comfortable = 34px rows. Compact 24px controls inside rows/tab strips.
- Key metrics: top bar 44px · sub-bars 31px · panel gutter 12px (16px in modals) ·
  inspector 392px (collapses to a 34px rail) · node card 244px fixed.
- Radii ramp shifted one step down from web-normal: 2/3/4/6/8px, pill only for toggle
  tracks + status dots. Nothing rounder than 8px. Square corners everywhere would read as
  unfinished, not deliberate.

## Elevation

Border-first: in a 95%-dark app a shadow is nearly invisible — surface step + border do
the work. **If it doesn't overlap something, it gets no shadow.**

| Token | Use |
|---|---|
| elev-0 | Flush: canvas chips, inline toolbars (border-subtle only) |
| elev-1 | Node card, raised panel |
| elev-2 | Popover, tooltip, hovered node |
| elev-3 | Dropdown, problems panel, toast |
| elev-4 | Modal, command palette |

## Motion & focus

- 80ms colour-only / 140ms hover-focus / 180ms menus-toasts-modal-in / 220ms panel
  collapse. Ease-out for entering/expanding, ease-in for leaving.
- **Focus ring**: `0 0 0 2px var(--surface-1), 0 0 0 4px var(--accent)` — the inner ring
  punches a gap so it reads on any background. `:focus-visible` only; never removed,
  never replaced by a colour change.
- Z scale: canvas 0 · canvas-ui 10 · panel 20 · sticky 30 · dropdown 100 · modal 200 ·
  toast 300 · palette 400 · tooltip 500.

## Component inventory (key specs)

- **Buttons** — primary (accent fill, 600 weight) / secondary (surface-2 + border) /
  ghost / danger (danger fill, dark text #1A0B0A); 28px default, 24px compact; states:
  rest, hover, active, focus, disabled, loading (`· · ·` label). Icon button 28px square.
- **Inputs** — 28px; surface-2 + border-default; focus = accent border + focus ring;
  invalid = danger border + danger-text; disabled = surface-1 + border-subtle.
- **Checkbox** 15px, r-xs. **Toggle** 34×19 pill. **Segmented control** — 2px padding
  frame on surface-2, active segment surface-3, e.g. Canvas ⇄ Barn.
- **Badges** — 17px tall, mono 9.5px, r-sm: `stale`(amber) `never read`(neutral)
  `assembling`(accent) `assembled`(success) `cycle`(danger) `pinned`(amber)
  `1.8k tok`(outline only).
- **Keycaps** — mono 10px, 1px border-default, r-sm, e.g. `Ctrl` `K`.
- **Tabs** — 30px, active = 2px accent underline + 500 weight.
- **Tooltip** — surface-3, border-default, elev-2, 11.5px, optional keycap hint.
- **Event feed rows** — 28px; kind tag 58×16 uppercase mono 9px (read=amber,
  write=success, other=neutral); path mono 11.5px ellipsis; unknown-path rows get a faint
  accent tint; selected = accent-surface bg + 2px accent left border.
- **Toasts** — surface-3, 3px semantic left border, elev-3, title 12.5/500 + mono detail
  line, one text action (e.g. "Undo", "Logs").
- **Loading** — 4-step amber pixel march (8px squares, ctBlink staggered 200ms) +
  Silkscreen caption ("the cow is reading"). Never a spinner.
- **Modal** — surface-1 on scrim, border-default, r-xl, elev-4; 44px header (title 15/600,
  meta right-aligned, ✕); body scrolls, header/footer fixed; nested code/diff drops to
  surface-inset; footer 50px with consequence text left, Cancel + Confirm right.

## Grounded in the repo (not invented)

- `context/*.md` — node files (§3); compile adapter pins them as `@context/*.md`.
- `.cowtext/graph.json` — per-project source of truth; shown in Settings → Context.
- `127.0.0.1:4923` — axum hooks server → BarnEvent → `app.emit`; Settings → Agent.
- GENERATED header — line 1 of every compiled diff, never editable.
- Diff before write is a trust boundary — Approve is the only path out of the modal.
- `.cursor/rules/*.mdc` — third compile target, off by default in target picker.
- Calm mode (§8) = no sound + reduced motion — one control, both effects.

## Design → phase mapping

| Phase | Design work |
|---|---|
| 0 | Token layer, dark shell, top bar, open-folder/onboarding screen |
| 1 | Node card + all states, canvas chrome (minimap, zoom, legend, dither bg), inspector form, CodeMirror editor |
| 2 | Compile diff modal, resolved-context preview, target picker, command palette, problems list, node badges |
| 3 | Assemble progress + success flash, settings panel |
| 4 | Live event feed, unknown-path rows, adopt-as-node, live-read pulse, hook status pill |
| 5 | Barn HUD, calm mode, mute, session ticker + full reduced-motion & colourblind pass (9.7) |
| 6 | Onboarding wizard, presets, handoff, auto-layout |

## Approved dependencies (Marty, 2026-08-15) — install when phase 0 UI work starts

1. **lucide-react** — stroke icons (24 grid, 1.5px at 16px) for all app chrome. Role
   glyphs are in-repo SVG regardless.
2. **@fontsource packages** — `@fontsource/ibm-plex-sans`, `@fontsource/jetbrains-mono`,
   `@fontsource/silkscreen`, bundled/self-hosted. No CDN font links, ever.
