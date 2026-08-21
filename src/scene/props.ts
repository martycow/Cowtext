// Placeholder prop drawing — programmatic Pixi Graphics only (hard rule: no
// binary/base64 assets in source). Style follows ART_DIRECTION.md: warm
// Barnlight-29 colours, single outline colour, light from the upper-left
// (top faces lightest, left mid, right shaded), dither = 50% checker only
// for ground shadows.

import { Container, Graphics, Text } from "pixi.js";
import { PALETTE, ROLE_ACCENT } from "./palette";
import { TILE_W, TILE_H } from "./iso";

const OUT = { width: 1, color: PALETTE.outline } as const;

/** Dithered checker ground-shadow ellipse (~40% of caster width). */
export function makeShadow(width: number): Graphics {
  const g = new Graphics();
  const rx = width * 0.4;
  const ry = rx * 0.5;
  const px = 2; // dither pixel size
  for (let y = -ry; y < ry; y += px) {
    for (let x = -rx; x < rx; x += px) {
      const inEllipse = (x / rx) ** 2 + (y / ry) ** 2 <= 1;
      const checker = (Math.round(x / px) + Math.round(y / px)) % 2 === 0;
      if (inEllipse && checker) g.rect(x, y, px, px);
    }
  }
  g.fill({ color: PALETTE.outline, alpha: 0.45 });
  return g;
}

/**
 * Iso box on a 1-tile footprint scaled by `f` (0..1), height `h` px.
 * Origin = bottom-centre of the tile diamond; box rises in −y.
 */
function isoBox(
  g: Graphics,
  f: number,
  h: number,
  top: number,
  left: number,
  right: number,
): void {
  const ex = (TILE_W / 2) * f; // 16f
  const ey = (TILE_H / 2) * f; // 8f
  // left face
  g.poly([-ex, -h, 0, ey - h, 0, ey, -ex, 0]).fill(left).stroke(OUT);
  // right face
  g.poly([0, ey - h, ex, -h, ex, 0, 0, ey]).fill(right).stroke(OUT);
  // top face
  g.poly([0, -ey - h, ex, -h, 0, ey - h, -ex, -h]).fill(top).stroke(OUT);
}

/** A prop with a J5 session-accumulation "opened" frame (drawer ajar, book
 *  popped, paper lifted). The frame is pre-authored — visibility toggle only,
 *  never a transform (appearance changes stay frame-quantised). */
export interface PropView {
  view: Container;
  setOpened: (b: boolean) => void;
}

/** Filing cabinet — rule / invariant / trap / agent nodes. Slate metal, drawer seams. */
export function makeCabinet(role: string): PropView {
  const c = new Container();
  c.addChild(makeShadow(26));
  const g = new Graphics();
  isoBox(g, 0.62, 26, PALETTE.slate, PALETTE.slateDark, PALETTE.slate);
  const accent = ROLE_ACCENT[role] ?? PALETTE.straw;
  // drawer fronts on the right face (screen-space rects, placeholder-coarse)
  for (let i = 0; i < 3; i += 1) {
    g.rect(2, -22 + i * 8, 7, 5).fill(PALETTE.slateDark).stroke(OUT);
    g.rect(4, -20 + i * 8, 3, 1).fill(accent);
  }
  c.addChild(g);
  // opened frame: top drawer slid 2 px out, cavity showing above it
  const open = new Graphics();
  open.rect(2, -22, 7, 2).fill(PALETTE.night);
  open.rect(2, -20, 7, 5).fill(PALETTE.slateDark).stroke(OUT);
  open.rect(4, -18, 3, 1).fill(accent);
  open.visible = false;
  c.addChild(open);
  return {
    view: c,
    setOpened: (b) => {
      open.visible = b;
    },
  };
}

/** Bookshelf — architecture / decision / glossary / skill / style / example /
 *  tool nodes. Wood, role-hued spines. */
export function makeBookshelf(): PropView {
  const c = new Container();
  c.addChild(makeShadow(30));
  const g = new Graphics();
  isoBox(g, 0.78, 30, PALETTE.woodLight, PALETTE.woodShadow, PALETTE.woodMid);
  // shelf cavities + book spines on the right face
  const spines = [PALETTE.leaf, PALETTE.clay, PALETTE.iris, PALETTE.orchid, PALETTE.straw];
  for (let s = 0; s < 2; s += 1) {
    g.rect(2, -26 + s * 12, 9, 9).fill(PALETTE.night);
    for (let b = 0; b < 3; b += 1) {
      g.rect(3 + b * 3, -25 + s * 12, 2, 7).fill(spines[(s * 3 + b) % spines.length]);
    }
  }
  c.addChild(g);
  // opened frame: first spine stays popped 2 px out of its slot
  const open = new Graphics();
  open.rect(3, -25, 2, 7).fill(PALETTE.night);
  open.rect(3, -27, 2, 7).fill(spines[0]).stroke(OUT);
  open.visible = false;
  c.addChild(open);
  return {
    view: c,
    setOpened: (b) => {
      open.visible = b;
    },
  };
}

/** Crate of papers — workflow / command / env nodes (floor variant of the corkboard). */
export function makeCrate(): PropView {
  const c = new Container();
  c.addChild(makeShadow(24));
  const g = new Graphics();
  isoBox(g, 0.55, 12, PALETTE.woodPale, PALETTE.woodShadow, PALETTE.woodMid);
  // paper sticking out of the top
  g.poly([-5, -16, 4, -18, 5, -12, -4, -11]).fill(PALETTE.paper).stroke(OUT);
  g.poly([-7, -13, 2, -15, 3, -11, -6, -10]).fill(PALETTE.hayLight).stroke(OUT);
  c.addChild(g);
  // opened frame: top sheet stays lifted 2 px
  const open = new Graphics();
  open.poly([-5, -18, 4, -20, 5, -14, -4, -13]).fill(PALETTE.paper).stroke(OUT);
  open.visible = false;
  c.addChild(open);
  return {
    view: c,
    setOpened: (b) => {
      open.visible = b;
    },
  };
}

/** Dev desk with dual monitors + seated pixel dev (blue shirt — blue is you). */
export function makeDevDesk(): Container {
  const c = new Container();
  c.addChild(makeShadow(34));
  const g = new Graphics();
  isoBox(g, 0.9, 12, PALETTE.woodPale, PALETTE.woodShadow, PALETTE.woodMid);
  // two monitors on the desktop
  for (const mx of [-11, 1]) {
    g.rect(mx + 3, -22, 2, 4).fill(PALETTE.slateDark); // stand
    g.rect(mx, -30, 9, 8).fill(PALETTE.outline);
    g.rect(mx + 1, -29, 7, 5).fill(PALETTE.screen);
    g.rect(mx + 1, -25, 7, 1).fill(PALETTE.screenDark);
    g.rect(mx + 2, -28, 2, 1).fill(PALETTE.scarfLight); // glint
  }
  // seated dev behind the desk: trousers, blue shirt, head, hair
  g.rect(-3, -18, 6, 4).fill(PALETTE.patch);
  g.rect(-4, -26, 8, 8).fill(PALETTE.scarf).stroke(OUT);
  g.rect(-3, -32, 6, 6).fill(PALETTE.muzzle).stroke(OUT);
  g.rect(-3, -33, 6, 3).fill(PALETTE.patchDark);
  c.addChild(g);
  return c;
}

/** Side desk (the cow's typewriter spot for edit/write). */
export function makeSideDesk(): Container {
  const c = new Container();
  c.addChild(makeShadow(26));
  const g = new Graphics();
  isoBox(g, 0.65, 10, PALETTE.woodPale, PALETTE.woodShadow, PALETTE.woodMid);
  // typewriter blob + paper
  g.rect(-5, -17, 8, 5).fill(PALETTE.slateDark).stroke(OUT);
  g.rect(-4, -16, 6, 2).fill(PALETTE.slate);
  g.poly([-2, -21, 4, -22, 4, -17, -2, -16]).fill(PALETTE.paper).stroke(OUT);
  c.addChild(g);
  return c;
}

// ── R10 barn reskin: hay + set-dressing (static furniture, no PropView —
// same plain-Container idiom as makeDevDesk/makeSideDesk; nothing here is
// per-node so there is no "opened" frame). ──────────────────────────────

/** Stacked block bales (2 high) with rope tie lines — the classic barn bale. */
export function makeHayBaleStack(): Container {
  const c = new Container();
  c.addChild(makeShadow(22));
  const g = new Graphics();
  isoBox(g, 0.6, 10, PALETTE.hayLight, PALETTE.hayDeep, PALETTE.hay);
  const g2 = new Graphics();
  g2.position.set(0, -10);
  isoBox(g2, 0.5, 9, PALETTE.hayLight, PALETTE.hayDeep, PALETTE.hay);
  const ties = new Graphics();
  ties.rect(-6, -8, 12, 1).fill(PALETTE.woodShadow);
  ties.rect(-6, -4, 12, 1).fill(PALETTE.woodShadow);
  ties.rect(-5, -17, 10, 1).fill(PALETTE.woodShadow);
  ties.rect(-5, -13, 10, 1).fill(PALETTE.woodShadow);
  c.addChild(g, g2, ties);
  return c;
}

/** A single bale lying on its side, straw wisps poking from both ends. */
export function makeHayBaleLying(): Container {
  const c = new Container();
  c.addChild(makeShadow(28));
  const g = new Graphics();
  isoBox(g, 0.85, 8, PALETTE.hayLight, PALETTE.hayDeep, PALETTE.hay);
  g.rect(-10, -8, 2, 8).fill(PALETTE.woodShadow); // tie band
  g.rect(6, -8, 2, 8).fill(PALETTE.woodShadow); // tie band
  g.poly([-13, -6, -11, -8, -10, -4, -12, -3]).fill(PALETTE.hayLight).stroke(OUT);
  g.poly([12, -6, 14, -8, 15, -4, 13, -3]).fill(PALETTE.hayLight).stroke(OUT);
  c.addChild(g);
  return c;
}

/** Loose hay pile — informal tufts, no crate underneath. */
export function makeHayPile(): Container {
  const c = new Container();
  c.addChild(makeShadow(20));
  const g = new Graphics();
  g.poly([-9, 0, -1, -8, 5, 0]).fill(PALETTE.hayDeep).stroke(OUT);
  g.poly([-2, 0, 6, -10, 11, 0]).fill(PALETTE.hay).stroke(OUT);
  g.poly([-11, 0, -4, -6, 0, 0]).fill(PALETTE.hay).stroke(OUT);
  g.poly([2, -1, 7, -6, 10, -1]).fill(PALETTE.hayLight);
  g.rect(-1, -11, 1, 3).fill(PALETTE.hayLight);
  g.rect(7, -12, 1, 3).fill(PALETTE.hayLight);
  c.addChild(g);
  return c;
}

/** Lantern on a wood post — warm hay-toned glow, amber accent staying put
 *  (never animated: J1-style flutter is reserved for the cow's scarf). */
export function makeLanternPost(): Container {
  const c = new Container();
  c.addChild(makeShadow(14));
  const g = new Graphics();
  g.rect(-2, -28, 4, 28).fill(PALETTE.woodMid).stroke(OUT);
  g.rect(-2, -28, 2, 28).fill(PALETTE.woodLight);
  g.rect(-5, -38, 10, 10).fill(PALETTE.slateDark).stroke(OUT);
  g.rect(-3, -36, 6, 6).fill(PALETTE.hayLight);
  g.rect(-3, -36, 3, 6).fill(PALETTE.hay);
  g.poly([-6, -38, 0, -42, 6, -38]).fill(PALETTE.slate).stroke(OUT);
  c.addChild(g);
  return c;
}

/** Feed trough — low wood basin with hay showing over the rim. */
export function makeFeedTrough(): Container {
  const c = new Container();
  c.addChild(makeShadow(28));
  const g = new Graphics();
  isoBox(g, 0.8, 6, PALETTE.woodPale, PALETTE.woodShadow, PALETTE.woodMid);
  g.poly([-9, -9, 0, -13, 9, -9, 0, -5]).fill(PALETTE.night);
  g.poly([-7, -9, 0, -12, 7, -9, 0, -6]).fill(PALETTE.hay).stroke(OUT);
  g.rect(-3, -11, 2, 2).fill(PALETTE.hayLight);
  g.rect(2, -10, 2, 2).fill(PALETTE.hayLight);
  c.addChild(g);
  return c;
}

/** Two-post fence rail — flanks the barn door in pairs. */
export function makeFenceSegment(): Container {
  const c = new Container();
  c.addChild(makeShadow(24));
  const g = new Graphics();
  for (const px of [-10, 10]) {
    g.rect(px - 1, -16, 3, 16).fill(PALETTE.woodMid).stroke(OUT);
    g.rect(px - 1, -16, 1, 16).fill(PALETTE.woodLight);
  }
  g.rect(-10, -13, 21, 2).fill(PALETTE.woodPale).stroke(OUT);
  g.rect(-10, -7, 21, 2).fill(PALETTE.woodPale).stroke(OUT);
  c.addChild(g);
  return c;
}

/** Wood barrel with slate metal bands. */
export function makeBarrel(): Container {
  const c = new Container();
  c.addChild(makeShadow(16));
  const g = new Graphics();
  g.roundRect(-6, -20, 12, 20, 3).fill(PALETTE.woodMid).stroke(OUT);
  g.roundRect(-6, -20, 6, 20, 3).fill(PALETTE.woodLight);
  g.rect(-6, -17, 12, 2).fill(PALETTE.slateDark);
  g.rect(-6, -6, 12, 2).fill(PALETTE.slateDark);
  g.roundRect(-6, -22, 12, 4, 2).fill(PALETTE.woodPale).stroke(OUT);
  c.addChild(g);
  return c;
}

/** Tiny mouse hole at floor level — a dirt mound with a dark burrow arch. */
export function makeMouseHole(): Container {
  const c = new Container();
  const g = new Graphics();
  g.poly([-6, 0, 0, -3, 6, 0]).fill(PALETTE.woodShadow).stroke(OUT);
  g.poly([-4, 0, -3, -4, 3, -4, 4, 0]).fill(PALETTE.night).stroke(OUT);
  c.addChild(g);
  return c;
}

export type CowPose = "stand" | "lying" | "asleep";

export interface CowSprite {
  view: Container;
  /** Flip horizontally to face walk direction. */
  setFacing: (dir: 1 | -1) => void;
  /** Body bob used by the walk/typewriter animation, in px (negative = crouch). */
  setBob: (px: number) => void;
  /** J1 — 2-frame scarf flutter; 0 = settled. */
  setFlutter: (frame: 0 | 1) => void;
  /** J3 — eye glance, in WORLD x direction (compensates for facing flips). */
  setGlance: (dir: -1 | 0 | 1) => void;
  /** J7 — pre-authored 1-frame landing squash (1 px wider/shorter — never a
   *  scale transform on the sprite). */
  setSquash: (on: boolean) => void;
  /** E5 waiting choreography — pre-authored pose frames. */
  setPose: (pose: CowPose) => void;
  /** E5 — 2-frame hay-chew loop (stand pose only). */
  setChew: (frame: 0 | 1) => void;
  /** Idle micro-behaviour: momentary eyes-closed frame. */
  setBlink: (on: boolean) => void;
}

/** Standing body core; `squash` = the landing frame (1 px wider, 1 px shorter). */
function drawCowCore(g: Graphics, squash: boolean): void {
  const dy = squash ? 1 : 0; // upper body settles down 1 px
  const wd = squash ? 1 : 0; // torso widens 1 px each side
  // legs
  for (const lx of [-8, -3, 3, 6]) {
    g.rect(lx, -6, 3, 6).fill(PALETTE.cream).stroke(OUT);
    g.rect(lx, -2, 3, 2).fill(PALETTE.patch);
  }
  // body
  g.roundRect(-11 - wd, -16 + dy, 21 + 2 * wd, 11 - dy, 4).fill(PALETTE.milk).stroke(OUT);
  g.roundRect(-11 - wd, -9, 21 + 2 * wd, 4, 2).fill(PALETTE.cream);
  // patches
  g.roundRect(-8, -15 + dy, 5, 4, 2).fill(PALETTE.patch);
  g.roundRect(1, -10, 5, 3, 1).fill(PALETTE.patch);
  // tail
  g.rect(-13 - wd, -14 + dy, 2, 6 - dy).fill(PALETTE.cream).stroke(OUT);
  g.rect(-13 - wd, -8, 2, 2).fill(PALETTE.hayDeep);
  // head
  g.roundRect(5, -22 + dy, 10, 9, 3).fill(PALETTE.milk).stroke(OUT);
  g.roundRect(10, -17 + dy, 6, 4, 2).fill(PALETTE.muzzle).stroke(OUT);
  g.rect(4, -24 + dy, 3, 3).fill(PALETTE.patch); // ear
}

/** Lying pose: body settled 4 px, legs folded under. */
function drawCowLying(g: Graphics): void {
  // folded legs peeking out front and back
  g.rect(-9, -3, 4, 3).fill(PALETTE.cream).stroke(OUT);
  g.rect(3, -3, 4, 3).fill(PALETTE.cream).stroke(OUT);
  // body
  g.roundRect(-11, -12, 21, 11, 4).fill(PALETTE.milk).stroke(OUT);
  g.roundRect(-11, -5, 21, 4, 2).fill(PALETTE.cream);
  // patches
  g.roundRect(-8, -11, 5, 4, 2).fill(PALETTE.patch);
  g.roundRect(1, -6, 5, 3, 1).fill(PALETTE.patch);
  // tail curled beside the body
  g.rect(-13, -8, 2, 5).fill(PALETTE.cream).stroke(OUT);
  g.rect(-13, -3, 2, 2).fill(PALETTE.hayDeep);
  // head
  g.roundRect(5, -18, 10, 9, 3).fill(PALETTE.milk).stroke(OUT);
  g.roundRect(10, -13, 6, 4, 2).fill(PALETTE.muzzle).stroke(OUT);
  g.rect(4, -20, 3, 3).fill(PALETTE.patch); // ear
}

/** The cow — milk body, patches, blue scarf (Moo.exe mascot), side view.
 *  Scarf, eye, jaw are addressable children so J1/J3/E5 animate them without
 *  redrawing; pose/squash are pre-authored frames toggled by visibility. */
export function makeCow(): CowSprite {
  const view = new Container();
  view.addChild(makeShadow(22));
  const body = new Container();

  const coreStand = new Graphics();
  drawCowCore(coreStand, false);
  const coreSquash = new Graphics();
  drawCowCore(coreSquash, true);
  const coreLying = new Graphics();
  drawCowLying(coreLying);

  // eye — glance moves the container ±1 px in world x
  const eyeC = new Container();
  const eyeOpen = new Graphics();
  eyeOpen.rect(8, -20, 2, 2).fill(PALETTE.patchDark);
  const eyeClosed = new Graphics();
  eyeClosed.rect(8, -19, 2, 1).fill(PALETTE.patchDark);
  eyeC.addChild(eyeOpen, eyeClosed);

  // chew frame: jaw drops 1 px below the muzzle
  const jaw = new Graphics();
  jaw.rect(10, -13, 6, 1).fill(PALETTE.muzzle);

  // the scarf — blue is Claude's one blue thing; 2 pre-authored flutter frames
  const scarfC = new Container();
  const scarf0 = new Graphics();
  scarf0.rect(4, -14, 10, 3).fill(PALETTE.scarf).stroke(OUT);
  scarf0.rect(6, -11, 3, 4).fill(PALETTE.scarfShade).stroke(OUT);
  scarf0.rect(5, -13, 4, 1).fill(PALETTE.scarfLight);
  const scarf1 = new Graphics();
  scarf1.rect(4, -14, 10, 3).fill(PALETTE.scarf).stroke(OUT);
  scarf1.rect(7, -12, 3, 4).fill(PALETTE.scarfShade).stroke(OUT); // tail kicks back
  scarf1.rect(6, -13, 4, 1).fill(PALETTE.scarfLight);
  scarfC.addChild(scarf0, scarf1);

  body.addChild(coreStand, coreSquash, coreLying, eyeC, jaw, scarfC);
  view.addChild(body);

  let facing: 1 | -1 = 1;
  let flutter: 0 | 1 = 0;
  let glance: -1 | 0 | 1 = 0;
  let squash = false;
  let pose: CowPose = "stand";
  let chew: 0 | 1 = 0;
  let blink = false;

  const refresh = (): void => {
    coreStand.visible = pose === "stand" && !squash;
    coreSquash.visible = pose === "stand" && squash;
    coreLying.visible = pose !== "stand";
    const closed = blink || pose === "asleep";
    eyeOpen.visible = !closed;
    eyeClosed.visible = closed;
    jaw.visible = chew === 1 && pose === "stand";
    scarf0.visible = flutter === 0;
    scarf1.visible = flutter === 1;
    // head-anchored children follow the active frame's head offset
    const dy = pose !== "stand" ? 4 : squash ? 1 : 0;
    eyeC.position.set(glance * facing, dy);
    scarfC.y = dy;
    jaw.y = dy;
    body.scale.x = facing;
  };
  refresh();

  return {
    view,
    setFacing: (dir) => {
      facing = dir;
      refresh();
    },
    setBob: (px) => {
      body.y = -px;
    },
    setFlutter: (frame) => {
      if (flutter !== frame) {
        flutter = frame;
        refresh();
      }
    },
    setGlance: (dir) => {
      if (glance !== dir) {
        glance = dir;
        refresh();
      }
    },
    setSquash: (on) => {
      if (squash !== on) {
        squash = on;
        refresh();
      }
    },
    setPose: (p) => {
      if (pose !== p) {
        pose = p;
        refresh();
      }
    },
    setChew: (frame) => {
      if (chew !== frame) {
        chew = frame;
        refresh();
      }
    },
    setBlink: (on) => {
      if (blink !== on) {
        blink = on;
        refresh();
      }
    },
  };
}

export const BUBBLE_MAX = 24; // filename truncation per plan §8

/** Tail-keep ellipsis truncation. `max` defaults to the bubble width but
 *  callers that need to reserve room for a prefix (mapper.ts's verbLabel)
 *  can pass a smaller budget so the prefix is never swallowed. */
export function truncateLabel(s: string, max: number = BUBBLE_MAX): string {
  return s.length <= max ? s : `…${s.slice(-(max - 1))}`;
}

// ── WO06 B1 — mission control: per-session "stall" readability ─────────
// A live agent session already gets one calf sprite at a fixed tile
// (agentHerd.ts) with a stable seed-derived look. What was missing at
// multi-session scale (up to 4 concurrent, same cap as calves) was a way to
// tell "this tile is a live session's own space" apart from a wandering
// calf at a glance, and to read that session's token budget without
// hovering. The two makers below are added as CHILDREN of the session's
// existing sprite.view (see agentHerd.ts) — no new top-level container, no
// new zIndex bookkeeping, no per-frame animation (both are pure Graphics
// mutated only when their inputs change, matching the file's `setOpened`/
// bubble idiom elsewhere).

/** Floor "stall" marker: a dashed diamond outline + four corner posts,
 *  existing wood tones only (no new Barnlight-29 entry). Purely a ground
 *  decal, drawn at index 0 of the sprite's own Container so it always
 *  sorts with its owning sprite — no separate depth math needed. */
export function makeStallMarker(): Graphics {
  const g = new Graphics();
  const ex = TILE_W / 2 - 3;
  const ey = TILE_H / 2 - 2;
  const corners: Array<[number, number]> = [
    [0, -ey],
    [ex, 0],
    [0, ey],
    [-ex, 0],
  ];
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % 4];
    for (let t = 0; t < 0.99; t += 0.34) {
      const t2 = Math.min(1, t + 0.18);
      g.moveTo(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
        .lineTo(x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2)
        .stroke({ width: 1, color: PALETTE.woodShadow, alpha: 0.8 });
    }
  }
  for (const [px, py] of corners) {
    g.rect(px - 1, py - 3, 2, 3).fill(PALETTE.woodMid).stroke(OUT);
  }
  return g;
}

/** Budget-strip state for `StallPlacard.setBudget`. `fraction` is REMAINING
 *  budget (1 − spent/ceiling, clamped 0..1) — the strip empties as spend
 *  approaches the ceiling. `danger` = spent/ceiling ≥ 0.9 (design-tokens'
 *  "amber -> danger at 90%" rule). `dark` = spent ≥ ceiling, the exact
 *  instant `RegistryCore::charge` fires `Stop` (WO06_CONTRACT §5.3) — the
 *  strip renders hollow/outline-only rather than a 0%-filled bar, so
 *  "empty because nothing spent yet" and "empty because stopped" never look
 *  the same. */
export interface BudgetStripState {
  fraction: number;
  danger: boolean;
  dark: boolean;
}

export interface StallPlacard {
  view: Container;
  /** No-op if `name` is unchanged since the last call. */
  setName: (name: string) => void;
  /** `null` hides the strip entirely — the contractually-correct "budget
   *  off" rendering (ceiling 0/absent, WO06_CONTRACT §5.5.1). No-op if the
   *  effective state is unchanged since the last call (gate 17: mutate an
   *  existing display object, never rebuild Graphics per frame). */
  setBudget: (state: BudgetStripState | null) => void;
}

const PLACARD_FONT_SIZE = 7;
const PLACARD_MAX = 12; // terser than the 24-char hover bubble — this one never hides

/** Always-visible per-session nameplate (unlike the top status bubble,
 *  which only shows during a tool/waiting state) plus an optional budget
 *  strip along its bottom edge. Positioned by the caller (agentHerd.ts)
 *  below the sprite's feet, distinct from the tool bubble above its head. */
export function makeStallPlacard(initialName: string): StallPlacard {
  const view = new Container();
  const bg = new Graphics();
  const label = new Text({
    text: "",
    style: { fontFamily: "Silkscreen, monospace", fontSize: PLACARD_FONT_SIZE, fill: PALETTE.patchDark },
    resolution: 3,
  });
  const strip = new Graphics();
  view.addChild(bg, label, strip);

  let lastName: string | null = null;
  let lastBudgetKey = "";

  const redrawFrame = (): void => {
    const w = Math.max(16, label.width + 6);
    const h = label.height + 4;
    bg.clear();
    bg.roundRect(-w / 2, 0, w, h, 2).fill(PALETTE.woodPale).stroke(OUT);
    label.position.set(-label.width / 2, 2);
    strip.position.set(-w / 2 + 1, h - 2);
  };

  const setName = (name: string): void => {
    if (name === lastName) return;
    lastName = name;
    label.text = name.length <= PLACARD_MAX ? name : `${name.slice(0, PLACARD_MAX - 1)}…`;
    redrawFrame();
  };
  setName(initialName);

  const setBudget = (state: BudgetStripState | null): void => {
    const key = state === null ? "off" : `${Math.round(state.fraction * 20)}:${state.danger}:${state.dark}`;
    if (key === lastBudgetKey) return;
    lastBudgetKey = key;
    strip.clear();
    if (state === null) return;
    const stripW = Math.max(16, label.width + 6) - 2;
    if (state.dark) {
      strip.rect(0, 0, stripW, 2).stroke({ width: 1, color: PALETTE.outline, alpha: 0.9 });
      return;
    }
    strip.rect(0, 0, stripW, 2).fill(PALETTE.night);
    const filled = Math.round(stripW * Math.max(0, Math.min(1, state.fraction)));
    if (filled > 0) strip.rect(0, 0, filled, 2).fill(state.danger ? PALETTE.barnRed : PALETTE.hay);
  };

  return { view, setName, setBudget };
}

/** Speech bubble: paper plate + warm outline + tiny monospace text. */
export function makeBubble(textRaw: string): Container {
  const c = new Container();
  const label = new Text({
    text: truncateLabel(textRaw),
    style: {
      fontFamily: "Silkscreen, monospace",
      fontSize: 8,
      fill: PALETTE.patchDark,
    },
    resolution: 3,
  });
  const w = Math.max(14, label.width + 8);
  const h = label.height + 6;
  const g = new Graphics();
  g.roundRect(-w / 2, -h, w, h, 3).fill(PALETTE.paper).stroke(OUT);
  g.poly([-3, 0, 3, 0, 0, 4]).fill(PALETTE.paper).stroke(OUT);
  g.rect(-3, -1, 6, 2).fill(PALETTE.paper); // hide tail seam
  label.position.set(-label.width / 2, -h + 3);
  c.addChild(g, label);
  return c;
}
