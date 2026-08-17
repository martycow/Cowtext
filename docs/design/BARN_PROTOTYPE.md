# Barn Prototype — integration notes (authorized early §8 slice)

Fleet session 2026-08-16, Barn Coder. Everything lives in `src/scene/` per the
frozen contract (`PHASE34_BARN_CONTRACT.md` §4). Placeholder graphics are 100%
programmatic Pixi `Graphics` in Barnlight-29 colours — no binary assets.

## Files

| File | What it is |
|---|---|
| `src/scene/BarnScene.tsx` | The single React export `<BarnScene/>`: Pixi 8 `Application` (async `init`, destroy on unmount, StrictMode-safe), camera pan (drag) + zoom (wheel, 1–4×, cursor-anchored), demo button overlay |
| `src/scene/palette.ts` | Barnlight-29 hexes as named constants + role-accent map |
| `src/scene/iso.ts` | 2:1 iso math: 32×16 tile, 12×12 grid, `tileToScreen`, depth sort key, Manhattan path |
| `src/scene/props.ts` | Prop drawing: cabinet / bookshelf / crate / dev desk / side desk / cow / dithered shadows / speech bubbles (24-char truncation) |
| `src/scene/sceneGraph.ts` | Layout builder: ground, fixed furniture, per-node props (role → prop shape; `scenePos` when present, deterministic auto-slots otherwise), prop flash animation |
| `src/scene/cow.ts` | Cow entity: interruptible task queue, tile-to-tile walk (≤1.5 s per move, per-step ≤150 ms), 2-frame trot/typewriter bob, bubbles |
| `src/scene/mapper.ts` | BarnEvent → animation mapping per plan §8; `resolveProp` (case-insensitive suffix path match); SFX cue points noted as comments only — **no sound implemented** |
| `src/scene/demo.ts` | `DemoPlayer`: scripted BarnEvent loop (prompt → reads → grep → edit/write → stop) + `DEMO_NODES` fallback so the scene runs with no project open |
| `src/scene/types.ts` | Scene-local `BarnEvent` mirroring contract §2 + `BarnEventSource` seam |

## How to mount (UI Coder)

```tsx
import { BarnScene } from "./scene/BarnScene";

// parent must have real height (flex-1 / height:100%)
<BarnScene />            // props from the open graph; demo props if graph empty
<BarnScene autoDemo />   // start the scripted demo on mount
```

## Demo mode

- **Trigger:** the "Demo" button overlaid top-right of the scene toggles it, or
  pass `autoDemo` to start on mount. Runs fully offline — no backend, no hooks,
  no project needed (falls back to six built-in demo nodes).
- The player pushes events through the *same* callback live events will use.

## Live-event wiring (done — UI Coder, same session)

`src/store/events.ts` landed, so the scene now subscribes to `useEventsStore`
directly (contract §4 allows reading graph + events stores). One entry point:
live hooks (`barn://event` → store) and the demo player both go through
`useEventsStore.pushEvent`; the demo also flips `setDemoMode`, which lights the
DEMO badge in the event-log panel. The `connectEvents` prop remains as an
optional override (tests); `BarnEvent` in `src/scene/types.ts` mirrors
contract §2 byte-for-byte, so the store's type is directly assignable.

The Canvas ⇄ Barn segmented toggle lives in the top bar (`src/App.tsx`);
the canvas stays mounted-but-hidden in Barn view (React Flow viewport
survives), while the Pixi scene mounts on demand and destroys itself cleanly.

## Store expectations

- Reads `useGraphStore` only via `getState()` + `subscribe` (node list → props;
  rebuild on `nodes` identity change). Never writes to any store. Never imports
  React Flow, `src/canvas/`, `src/compile/`, `src/inspector/`.
- Node prop mapping: `rules`/`persona` → filing cabinet ·
  `architecture`/`reference`/`glossary` → bookshelf · `task`/`workflow` → crate.
- `scenePos { tx, ty }` respected when present (clamped to the 12×12 grid).

## Event behaviours (plan §8, placeholder tier)

`prompt` → "!" bubble · `read` → walk to prop, prop bounce, filename bubble ·
`edit`/`write` → side desk, typewriter bob (~0.9 s), filename bubble ·
`grep`/`glob` → sniff between two props with "?" bubbles · `stop` → interrupt
everything, trot to the dev desk, "✓" bubble. Unknown/absent paths: no walk
(log-feed-only, per contract §2). `subagent_stop`/`other`: ignored until the
calf sprite lands (Phase 5).

## Deliberately not done (Phase 5)

Sprites/spritesheets (SVG/PNG assets exist but are not loaded yet), SFX (cue
names sit as comments in `mapper.ts` at the exact hook points), calm mode
toggle, calf/subagent, dev idle/coffee animations. (The Canvas ⇄ Barn view
toggle is now done — see above.)
