# Cowtext — Design Spec (v1, dark only)

Digest of the Claude Design project **"UI mockups for Cowtext"**
(`claude.ai/design/p/98f3fa2a-b900-4599-9e18-ba7f71d92871`), file `Cowtext Spec.dc.html`.
The paste-ready implementation files live next to this doc: [`tokens.css`](tokens.css) and
[`tailwind.config.js`](tailwind.config.js) — those are the source of truth for values;
this doc records the decisions, rules, and component specs around them.

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
- **Edges are neutral by rule** — kind is read from line style + marker, never hue:
  - `imports` — 1.75px solid, filled arrow. Content inlined into target on compile.
  - `references` — 1.5px dash 5 4, open circle marker. Mentioned by path, never inlined.
  - `conditional` — 1.5px dot 1.5 3.5, filled arrow, **mono condition chip pinned at
    midpoint** (the chip is the cue, not the colour).
  - `sequence` — 1.5px solid, open chevron, numbered step dot at midpoint. Ordering only.
  - Selected edge → `--accent`.

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

## Node states

| State | Spec |
|---|---|
| Rest | 1px `--border-default` · `--elev-1` · 3px role stripe left |
| Hover | border → `--border-strong`; handles fade in 140ms |
| Selected | 2px ring in `--accent` · `--elev-2` · inspector follows |
| Live (reading) | amber stripe replaces role stripe + pulsing 2px amber ring + `--glow-live` |
| Assembling | accent indeterminate progress bar under the title |
| Assembled | 2px `--success` border, 600ms then fades to rest |
| Stale / error | amber or red badge in footer; border unchanged (error adds 3px red left stripe) |

### Live-read pulse spec

```
ring: 2px solid var(--amber), border-radius 6px, inset −4px around the card
scale 1 → 1.06, opacity .6 → 0, 1600ms cubic-bezier(.2,0,0,1) infinite
+ static amber left stripe (replaces role stripe)
+ 5px amber square blinking at 1s steps(2)
```

**prefers-reduced-motion:** ring and blink dropped entirely; amber stripe + solid amber
square remain (state still visible, just static). All panel/modal transitions → 0ms;
toasts appear without translate.

## Memory node card — anatomy (244 × 97)

React Flow custom node; the card is the whole hit target; handles extend 4px outside.

1. **Role stripe** — 3px, full height, left edge. `--role-*` at rest; `--amber` while
   reading. The only place role colour appears as a fill.
2. **Role glyph + label** — 8×8 glyph at 11px, crispEdges; mono 9.5px uppercase,
   letter-spacing .09em, tinted to role.
3. **Pin indicator** — 11px stroke icon in `--amber-text`. Present only when pinned
   (pinning is an agent-facing guarantee ⇒ amber, not blue).
4. **Read-order badge** — mono 9.5px on `--surface-3`, 16px square, `--r-sm`. Matches
   compiled order.
5. **Title** — 13px/600, single line, ellipsis. Never wraps; card width fixed.
6. **File path** — mono 10.5px `--text-muted`, `direction: rtl` so the *filename* survives
   truncation, not the folder.
7. **Footer badges** — token count always; then at most **one** status badge
   (stale / never read / assembling). Two badges means the node needs splitting.
8. **Handles** — 7px squares, `--surface-3` on `--border-strong`, offset −4px, sharp
   corners — the one place the pixel grid shows in a control.

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

## Open asks — need Marty's yes (CLAUDE.md: no libraries without asking)

1. **Lucide React** — stroke icons (24 grid, 1.5px at 16px) for all app chrome. Role
   glyphs are in-repo SVG regardless. Alternative: ~20 chrome glyphs hand-authored in-repo.
2. **@fontsource packages** — `@fontsource/ibm-plex-sans`, `@fontsource/jetbrains-mono`,
   `@fontsource/silkscreen`, bundled/self-hosted.
