---
name: design-tokens
description: Cowtext design-token rules for building or reviewing UI — the two-accent law, surface/border/text ramps, elevation, density, radii, motion, focus ring, and the pixel-charm allowed/banned list. Values live in src/styles/tokens.css; decisions in docs/design/DESIGN_SPEC.md.
---

# Cowtext design tokens

Source of truth for values: `src/styles/tokens.css`. Decisions and component specs:
`docs/design/DESIGN_SPEC.md`. Always style through semantic variables — never raw hex,
never Tailwind palette colours.

## The one rule that decides the rest

> **Blue is you. Amber is the cow.**

- `--accent` (#4C9BE8, scarf blue) — everything the *user* initiates: primary buttons,
  selection, focus, links, active tabs.
- `--amber` (#E8A33D, hay) — everything the *agent* does: live reads, assembling,
  pins, the barn HUD. Static amber = warning; **moving** amber = live agent.
- Two accents, never mixed on the same control. Pin indicators are amber (an
  agent-facing guarantee), not blue.

## Token families (names, not values — values in tokens.css)

- **Surfaces**: `--surface-canvas` → `--surface-0..3`, `--surface-inset` (recessed
  wells: editor, diff), `--surface-hover/active`, `--scrim`. Warmth variants via
  `data-warmth` on `<html>` (`warm` is default) swap surface/border/text only.
- **Borders**: `--border-subtle` (dividers) / `--border-default` (controls, cards) /
  `--border-strong` (handles, hover).
- **Text**: `--text-primary/secondary/muted/disabled/inverse`. AA 4.5:1 floor;
  `--text-muted` never below 11px; `--text-disabled` is decoration-only.
- **Roles**: `--role-persona/rules/architecture/workflow/task/reference/glossary`.
  Colour is REDUNDANT coding — the 8×8 glyph identifies; roles own hue.
- **Edges are neutral by rule** (`--edge-*`): kind is read from line style + marker,
  never hue. Selected edge → `--accent`.
- **Semantic**: `--success/warning/danger/info` + `-text`/`-surface` variants.
- **Type**: `--font-ui` (IBM Plex Sans, all UI) / `--font-mono` (JetBrains Mono —
  anything the filesystem or model produced) / `--font-pixel` (Silkscreen — exactly
  three uses: LIVE/READING tags, barn HUD, logo; never UI text).
  Sizes `--fs-micro`(9.5) … `--fs-2xl`(24, onboarding headline only); default 13px.
- **Spacing**: 4px grid (`--sp-*`); `--h-topbar` 44 / `--h-row` 28 (compact default) /
  `--h-control` 28 / `--w-inspector` 392 / `--w-node` 244.
- **Radii**: `--r-xs..xl` = 2/3/4/6/8px; `--r-pill` for toggle tracks + status dots
  ONLY. Nothing rounder than 8px.
- **Elevation** — border-first: surface step + border do the work; shadow only when
  floating. `--elev-0` flush … `--elev-4` modal/palette; `--glow-live` for reading.
- **Motion**: `--dur-instant` 80 / `--dur-fast` 140 / `--dur-base` 180 / `--dur-slow`
  220 / `--dur-pulse` 1600ms; `--ease-out` entering, `--ease-in` leaving.
- **Focus ring**: `--focus-ring` = inner 2px surface gap + 4px accent.
  `:focus-visible` only; never removed, never replaced by a colour change.
- **Z scale**: `--z-canvas` 0 … `--z-tooltip` 500 — use the tokens, no magic numbers.

## Pixel charm — allowed / banned

Allowed: 8×8 role glyphs (`crispEdges`), full-page empty-state cow art, the 4-step
amber **pixel march** (never a spinner), Silkscreen in its three homes, sharp 7px
handles.

Banned: pixel fonts for UI text; dither/pixel textures on panels; cow mascots in
working chrome; wood/hay/paper panel fills; bevels, faux-3D, 2px chunky outlines;
sound or animation on routine UI events (tool-layer motion = state changed).

## Hard checks when reviewing UI

1. Every colour resolves through a token; both accents never on one control.
2. Compact density: 28px rows/controls; top bar 44px; node card 244px fixed.
3. Live-read state: amber stripe + pulsing ring, and `prefers-reduced-motion`
   drops animation but keeps static amber markers.
4. Modals: surface-1, `--r-xl`, `--elev-4`, footer with consequence text; diff/code
   wells drop to `--surface-inset`.
5. Badges: at most one status badge per node card footer (two = split the node).
