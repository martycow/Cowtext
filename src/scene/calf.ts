// Named Calves — recurring, seed-stable visitors spawned by subagent_stop
// events (AGENTS_SUITE_CONTRACT §7.5). Pure Pixi + identity.ts + palette.ts +
// props.ts + iso.ts + motion.ts primitives only. No React, no store imports,
// no howler — and deliberately no sfx.ts import either: the frozen
// `CalfHerd` constructor takes only a Container (no layout/cow handle), so
// this module cannot know whether a spawn() call actually added a calf
// (cap-drop) or only that tick() removed one; it exposes `onSpawn`/
// `onDespawn` callbacks (same idiom as `Cow.onStep` in cow.ts) so the owner
// (BarnScene.tsx) can wire sfx.play("calf_spawn"/"calf_despawn") itself,
// firing only on genuine lifecycle transitions — a dropped spawn at the cap
// stays silent, matching SOUND_DESIGN's "queue-cap drops" rule. This is an
// additive extension of the frozen class shape (constructor/spawn/tick/
// destroy are unchanged); see the tech-barn dispatch report for the note.
//
// "Free tile" note: the frozen constructor only receives a Container, not
// the live BarnLayout or the Cow, so this module cannot query real prop or
// cow tiles at runtime. CALF_SPOTS below is a small fixed set of tiles
// chosen not to overlap the barn's fixed furniture (dev desk 9,9 / side desk
// 6,9 / cow home 8,8) or sceneGraph's auto-layout prop slots — "not the
// cow's tile" / "not a prop tile" are satisfied by construction; "not
// another calf's tile" is checked live against the herd's own entries.

import { Container, Graphics } from "pixi.js";
import { PALETTE, ROLE_ACCENT } from "./palette";
import { makeShadow, makeBubble } from "./props";
import { depthOf, tileToScreen, type Tile } from "./iso";
import { reducedMotion } from "./motion";
import { ACCENT_ROLES, calfLook, fnv1a32, type CalfLook, type CalfProp } from "../identity/identity";

const OUT = { width: 1, color: PALETTE.outline } as const;

export interface CalfSprite {
  view: Container;
  /** Flip horizontally to face travel direction. */
  setFacing: (dir: 1 | -1) => void;
}

function drawCalfProp(g: Graphics, prop: CalfProp, accent: number): void {
  switch (prop) {
    case "bell":
      g.rect(6, -8, 2, 2).fill(PALETTE.hay).stroke(OUT);
      return;
    case "bandana":
      g.poly([4, -9, 7, -9, 5, -7]).fill(accent).stroke(OUT);
      return;
    case "flower":
      g.rect(3, -15, 1, 1).fill(accent);
      g.rect(5, -15, 1, 1).fill(accent);
      g.rect(4, -16, 1, 1).fill(PALETTE.hayLight);
      return;
    case "tag":
      g.rect(4, -13, 2, 2).fill(accent).stroke(OUT);
      return;
    case "none":
      return;
  }
}

/** ~0.6-scale programmatic calf: coat patches from `patchMask` over a 4x3
 *  cell grid, accent hue from `accentIdx` via ROLE_ACCENT, and a 2-3px prop.
 *  PALETTE colours only — no new assets, no base64. */
export function makeCalf(look: CalfLook): CalfSprite {
  const view = new Container();
  view.addChild(makeShadow(14));

  const body = new Container();
  const g = new Graphics();

  // legs
  for (const lx of [-5, -2, 2, 5]) {
    g.rect(lx, -4, 2, 4).fill(PALETTE.cream).stroke(OUT);
  }
  // body core + 4x3 patch grid (3px cells, cell i = row*4 + col)
  const gx = -6;
  const gy = -10;
  const cellW = 3;
  const cellH = 3;
  g.roundRect(gx, gy, 12, 9, 2).fill(PALETTE.milk).stroke(OUT);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const i = row * 4 + col;
      if (((look.patchMask >> i) & 1) === 1) {
        g.rect(gx + col * cellW, gy + row * cellH, cellW, cellH).fill(PALETTE.patch);
      }
    }
  }
  // tail
  g.rect(gx - 2, gy + 1, 2, 4).fill(PALETTE.cream).stroke(OUT);
  // head + ear + muzzle + eye
  g.roundRect(5, -13, 7, 6, 2).fill(PALETTE.milk).stroke(OUT);
  g.roundRect(8, -10, 4, 3, 1).fill(PALETTE.muzzle).stroke(OUT);
  g.rect(4, -14, 2, 2).fill(PALETTE.patch);
  g.rect(7, -12, 1, 1).fill(PALETTE.patchDark);

  const role = ACCENT_ROLES[look.accentIdx];
  const accent = ROLE_ACCENT[role] ?? PALETTE.straw;
  drawCalfProp(g, look.prop, accent);

  body.addChild(g);
  view.addChild(body);

  return {
    view,
    setFacing: (dir) => {
      body.scale.x = dir;
    },
  };
}

// ── Herd lifecycle ───────────────────────────────────────────────────────

const CAP = 4;
const HOP_MS = 500;
const BOUNCE_PX = 5;
const LINGER_MS = 4000;
const FADE_MS = 300;

/** Barn "door" tile calves appear at before hopping to their spot. */
const DOOR_TILE: Tile = { tx: 0, ty: 10 };

/** Reserved calf-visit tiles — see the header note on why these are a fixed
 *  list rather than a live free-tile query. */
const CALF_SPOTS: Tile[] = [
  { tx: 2, ty: 2 },
  { tx: 9, ty: 3 },
  { tx: 3, ty: 9 },
  { tx: 10, ty: 8 },
  { tx: 5, ty: 10 },
  { tx: 8, ty: 10 },
];

type Phase = "hop" | "linger" | "fade";

interface CalfEntry {
  sprite: CalfSprite;
  target: Tile;
  phase: Phase;
  elapsed: number;
  bubble: Container | null;
}

export class CalfHerd {
  /** Fires only when a calf is actually added (never on a cap-dropped
   *  spawn). BarnScene wires sfx.play("calf_spawn") here. */
  onSpawn?: () => void;
  /** Fires once per calf when it finishes despawning. BarnScene wires
   *  sfx.play("calf_despawn") here. */
  onDespawn?: () => void;

  private readonly layer: Container;
  private readonly entries: CalfEntry[] = [];

  constructor(layer: Container) {
    this.layer = layer;
  }

  /** Spawn a calf for `seed`. Ignored at the cap (never evict — eviction
   *  flickers). */
  spawn(seed: string): void {
    if (this.entries.length >= CAP) return;
    const look = calfLook(seed);
    const sprite = makeCalf(look);

    const taken = new Set(this.entries.map((e) => `${e.target.tx},${e.target.ty}`));
    const free = CALF_SPOTS.filter((t) => !taken.has(`${t.tx},${t.ty}`));
    const pool = free.length > 0 ? free : CALF_SPOTS;
    const target = pool[fnv1a32(seed) % pool.length];

    const reduced = reducedMotion();
    const startTile = reduced ? target : DOOR_TILE;
    const p = tileToScreen(startTile.tx, startTile.ty);
    sprite.view.position.set(Math.round(p.x), Math.round(p.y));
    sprite.view.zIndex = depthOf(startTile, true);

    const doorP = tileToScreen(DOOR_TILE.tx, DOOR_TILE.ty);
    const targetP = tileToScreen(target.tx, target.ty);
    if (targetP.x !== doorP.x) sprite.setFacing(targetP.x > doorP.x ? 1 : -1);

    this.layer.addChild(sprite.view);

    const entry: CalfEntry = {
      sprite,
      target,
      phase: reduced ? "linger" : "hop",
      elapsed: 0,
      bubble: null,
    };
    if (reduced) {
      // no hop: appear directly at the target tile, bubble shows at once.
      const bubble = makeBubble("✓");
      bubble.position.set(0, -20);
      sprite.view.addChild(bubble);
      entry.bubble = bubble;
    }
    this.entries.push(entry);
    this.onSpawn?.();
  }

  tick(dtMs: number, reduced: boolean): void {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const e = this.entries[i];
      if (e.phase === "hop") {
        e.elapsed = reduced ? HOP_MS : e.elapsed + dtMs;
        const t = Math.min(1, e.elapsed / HOP_MS);
        const tx = DOOR_TILE.tx + (e.target.tx - DOOR_TILE.tx) * t;
        const ty = DOOR_TILE.ty + (e.target.ty - DOOR_TILE.ty) * t;
        const p = tileToScreen(tx, ty);
        const bounce = reduced ? 0 : Math.round(Math.sin(t * Math.PI) * BOUNCE_PX);
        e.sprite.view.position.set(Math.round(p.x), Math.round(p.y) - bounce);
        e.sprite.view.zIndex = depthOf({ tx, ty }, true);
        if (t >= 1) {
          e.phase = "linger";
          e.elapsed = 0;
          const bubble = makeBubble("✓");
          bubble.position.set(0, -20);
          e.sprite.view.addChild(bubble);
          e.bubble = bubble;
        }
        continue;
      }
      if (e.phase === "linger") {
        e.elapsed += dtMs;
        if (e.elapsed >= LINGER_MS) {
          if (reduced) {
            this.remove(i);
          } else {
            e.phase = "fade";
            e.elapsed = 0;
          }
        }
        continue;
      }
      // fade
      if (reduced) {
        this.remove(i);
        continue;
      }
      e.elapsed += dtMs;
      e.sprite.view.alpha = Math.max(0, 1 - e.elapsed / FADE_MS);
      if (e.elapsed >= FADE_MS) this.remove(i);
    }
  }

  private remove(i: number): void {
    const e = this.entries[i];
    e.sprite.view.destroy({ children: true });
    this.entries.splice(i, 1);
    this.onDespawn?.();
  }

  /** Tear down every live calf with no lifecycle callbacks (unmount, not a
   *  narrative event — matches the "view/demo toggles stay silent" rule). */
  destroy(): void {
    for (const e of this.entries) e.sprite.view.destroy({ children: true });
    this.entries.length = 0;
  }
}
