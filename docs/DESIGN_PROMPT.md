# Claude Design Prompt — Cowtext UI/UX Reference

> Paste everything below the line into Claude Design. It is self-contained — Claude Design
> has no access to this repo. The output (design tokens + screen references) comes back into
> `docs/` and drives the Tailwind config and component implementation.

---

## The product

**Cowtext** is a Windows desktop app (Tauri 2 + React + Tailwind) for developers who work
with AI coding agents. Its core idea: an AI agent's context is a **visual graph of Memory
Nodes**, where each node is a real `.md` file in the user's project. You wire nodes together,
press **Compile** to generate `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` from one source of
truth, press **Assemble** to expand one-line briefs into full files via a headless Claude
call. On top sits the signature feature: a **16-bit isometric SNES-style barn scene**
(Harvest Moon × Game Dev Tycoon) where a small cow with a blue scarf — the Claude agent —
physically walks to filing cabinets and bookshelves and reads the user's memory files
**live**, driven by real agent activity.

Brand: made by **Moo.exe**. Mascot: the cow with a blue scarf. Working name: Cowtext.

## Design personality — the one hard problem

Two worlds must coexist without fighting:

1. **The tool layer** — graph canvas, code editor, diff views, settings. This must read as a
   serious, dense, dark professional developer tool (reference class: Linear, VS Code,
   Obsidian Canvas). Developers will judge it in 5 seconds; it cannot look like a toy.
2. **The barn layer** — the PixiJS game scene. Pure 16-bit warmth: wood, hay, dusk light,
   dithered shadows.

Wanted resolution: the tool layer is a clean dark UI that borrows *temperature* from the barn
(warm dark browns/ambers instead of the usual blue-gray dark theme) and allows itself small
pixel-art moments (icons, empty states, the loading cow) — but typography, spacing, and
controls stay crisp and modern. **No pixel fonts for UI text.** Show me where the line sits.

## What I need back

### A. Design token sheet (the primary deliverable)

Deliver as a table AND as a CSS-variables / Tailwind-theme code block I can paste into
`tailwind.config`. Cover:

- **Color** — dark theme first (v1 is dark-only):
  - Surface ramp: app background → panel → raised panel → overlay/modal (4+ steps).
  - Border/divider ramp (subtle, medium, strong).
  - Text ramp: primary, secondary, muted, disabled.
  - One **accent** (brand — likely warm amber/hay or scarf-blue; decide and justify).
  - Semantic: success, warning, danger, info — plus their dim "surface" variants for badges
    and toasts.
  - **7 node-role colors**, colorblind-safe, distinguishable at small badge size:
    `persona`, `rules`, `architecture`, `workflow`, `task`, `reference`, `glossary`.
  - **4 edge-kind styles** (color + line style): `imports` (strong, solid), `references`
    (softer, dashed?), `conditional` (needs a "has a condition" cue), `sequence`
    (directional/ordering cue).
  - Node state overlays: selected, hovered, pulsing-live (agent is reading it), assembling
    (in progress), assembled-success flash, stale/error.
- **Typography** — UI font stack + mono stack (for file paths, code, diffs). Type scale
  (11–24px range is realistic for a dense tool), weights, line heights. Where mono is used
  vs UI font.
- **Spacing** — base unit and scale (4px grid assumed; confirm). Component padding
  standards: panel padding, list-row height, input height, table density.
- **Radii** — scale from inputs to modals. (Does a pixel-art-adjacent brand mean sharper
  corners? Decide.)
- **Elevation/shadows** — for an app that is 95% dark panels: shadow vs border-based
  elevation strategy.
- **Buttons** — primary / secondary / ghost / danger / icon-button; sizes (default +
  compact); all states (rest, hover, active, focus-visible, disabled, loading).
- **Inputs** — text field, select, checkbox, toggle, segmented control; same state coverage.
- **Icons** — style direction (stroke grid-based like Lucide vs custom pixel icons — or the
  hybrid: Lucide for chrome, pixel icons for node roles?); sizes (14/16/20); stroke width.
- **Motion** — duration + easing tokens (fast 100–150ms UI, medium 200–300ms panels);
  the node "pulse" animation spec; `prefers-reduced-motion` behavior for every animation.
- **Focus & accessibility** — focus ring spec, minimum contrast targets (WCAG AA on all
  text tokens; verify the role colors against the surfaces).
- **Z-index / layer scale** — canvas < panels < dropdowns < modals < toasts < command palette.

### B. Screen references

Mockups (or detailed annotated layouts) for these screens, in priority order:

1. **Main shell + graph canvas** — the money shot. Layout: top bar (project name, view
   toggle Canvas ⇄ Barn, Compile / Assemble buttons, hook-status indicator), left side =
   canvas, right side = collapsible Inspector panel (~360–420px). Canvas shows ~8 memory
   nodes wired with all 4 edge kinds, minimap bottom-right.
   - **Memory node card anatomy** (critical, spec it precisely): role icon + role color
     accent, title, file path (mono, truncated), pinned indicator, read-order number,
     badges (token count, "stale", "never read"), connection handles, and how the
     live-pulse state looks.
2. **Inspector panel** — two tabs or stacked: visual form (title, role select, brief
   textarea, pinned toggle, read-order) + markdown editor (CodeMirror) with preview toggle.
   Editor is dark, mono, with a thin file-path header and dirty-state indicator.
3. **Compile flow** — target picker (claude / agents / cursor checkboxes), then the **diff
   preview modal**: file list on left, unified diff on right (green/red diff tokens needed),
   Approve / Cancel. Include the **resolved-context preview** variant: rendered final file
   with expanded imports and a token-count total in the header.
4. **Live event feed** — right-side or bottom panel: timestamped event rows (icon +
   event kind + file path), unknown-path rows, "adopt as node" inline action, session
   header. Nodes on canvas pulse in sync.
5. **Barn view chrome** — the Pixi scene itself is out of scope; design only the HUD around
   it: view toggle, mute button, calm-mode toggle, current-session status line, and how the
   event feed coexists with the scene.
6. **Onboarding / empty state** — open-a-folder screen: recent projects list, "Open
   folder" primary action, and the empty-canvas state after opening a project with no graph
   yet (this is where a pixel cow illustration earns its place).
7. **Command palette** (Ctrl+K) and **toast/problem list** — problems list shows warnings
   (cycles, missing files, dead hooks) with severity colors.
8. **Settings** — simple sectioned panel: theme, context directory, port, sound, claude
   binary path.

### C. Component inventory sheet

One page showing every reusable component at rest + key states: buttons, inputs, badges,
tabs, tooltips, modal frame, toast, table row, list row, empty state, loading state
(cow-themed spinner?), keyboard-shortcut hint chip.

## Constraints

- Desktop only, Windows first. Min window 1200×760; design at 1440×900.
- Dark theme only for v1 — but structure tokens so a light theme can be added later
  (i.e., name tokens semantically: `surface-1`, not `gray-900`).
- Tailwind CSS is the implementation target — token values should map cleanly to a Tailwind
  theme extension.
- The graph canvas is React Flow — node cards, edges, minimap, and controls are fully
  customizable; the canvas background (dot grid?) is part of the design.
- Density matters: this is a tool people keep open all day next to a terminal. Compact by
  default, never cramped.
- Accessibility is a requirement, not a stretch: AA contrast, visible focus everywhere,
  colorblind-safe role palette, reduced-motion variants.
- No trends that will age fast (glassmorphism, heavy gradients). The barn provides the charm;
  the UI provides the trust.

## Deliverable format

1. Token sheet (tables + one copy-pasteable CSS-variables block).
2. Screen references for the 8 screens above.
3. Component inventory.
4. A short "rules of the line" section: 5–10 bullets on where pixel-art charm is allowed in
   the tool layer and where it is banned.
