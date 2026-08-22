---
name: wo15-u4a-ui-scale
description: How Cowtext's UI-scale setting is implemented (zoom on chrome, transform on portals) and the three known debts it left behind
metadata:
  type: project
---

The UI-scale setting (WO15 Block 7 / D-7) is CSS `zoom` on named chrome
containers — never one global zoom, never on `.react-flow` or the Barn host.

**Why:** the app is 100 % px, so root `font-size` moves nothing; and a single
`#root` zoom would have to be *cancelled* on the two pixel-art surfaces with
`calc(1/var(--ui-scale))`, whose float product is not exactly 1 — fractional
scaling shimmers pixel art (ART_DIRECTION.md). Excluding by construction beats
excluding by override.

**The portal rule is the load-bearing part.** `zoom` on a `position: fixed`
portal root also multiplies its own `left`/`top`, so a menu positioned from a
trigger's `getBoundingClientRect()` (already client coordinates, already
zoom-inclusive) drifts by the scale factor. Portal roots therefore get
`transform: scale(var(--ui-scale)); transform-origin: 0 0` instead — the
anchor corner stays put, and because gBCR reports transformed boxes, each
popup's own measure-then-flip pass keeps working. This needs **no coordinate
math and no inner wrapper from any portal-owning lane**; U4b proposed both
during WO15 and neither is necessary. If someone later "fixes" the
inconsistency by switching portals to `zoom`, menus will slide off their
triggers at 115/130 %.

**How to apply:** selectors live in `src/styles/index.css` — `.ct-zoom` for
containers, `.z-modal.inset-0:not(.ct-zoom *)` for dialog scrims (the `:not`
stops a dialog opened from the already-scaled rail scaling twice — zoom
multiplies down the tree), and `body > *:not(#root)` for portals (every
`createPortal` in this repo targets `document.body`, so that selector *is* the
portal set — no `data-portal` marker needed). Percentages and `inset: 0`
resolve in the zoomed element's own coordinate space (safe); absolute px and
**viewport units do not**.

**Neither `zoom` nor `transform: scale()` redefines the viewport**: `80vh`
inside a scaled box is still 80 % of the window *in the box's own space* and
is then multiplied by the scale — 104 vh of real window at 130 %, footer below
the fold. Every vh/vw length inside a scale root therefore needs
`calc(<N>vh / var(--ui-scale))`. WO15's fix round did this in `index.css` as
14 rules (one per distinct value), each prefixed by
`:is(.ct-zoom, .z-modal.inset-0, body > *:not(#root))` — 0-3-0 beats the
0-1-0 Tailwind arbitrary-value utility, so emission order does not matter.
Keep that `:is()` list and the scale-root rules above it in lockstep.
The same round divided `ResizeHandle`'s pointer delta by the scale, captured
once at pointer-down into `dragRef` (`clientX` is real viewport px; the panel
width lives inside `.ct-zoom`).

Debts left open:
1. `src/ui/TwoPaneModal.tsx:147` sets `height: min(760px, 88vh)` as an INLINE
   style (New-agent wizard, NodeWizard) — unreachable by selector without
   `!important`; fix is `calc(88vh / var(--ui-scale))` in that file.
2. Node cards do not scale (D-7's ratified deviation, flagged for Marty).

See [[wo11-uib-shell-rail]] for the App-shell/rail split and
[[ambiguous-zone-boundaries]] for the additive-and-flagged habit used when
scaling containers the contract did not enumerate (banners, Tasks/Agents views).
