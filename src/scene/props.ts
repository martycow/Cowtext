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

/** Filing cabinet — rules / persona nodes. Slate metal, drawer seams. */
export function makeCabinet(role: string): Container {
  const c = new Container();
  c.addChild(makeShadow(26));
  const g = new Graphics();
  isoBox(g, 0.62, 26, PALETTE.slate, PALETTE.slateDark, PALETTE.slate);
  // drawer fronts on the right face (screen-space rects, placeholder-coarse)
  for (let i = 0; i < 3; i += 1) {
    g.rect(2, -22 + i * 8, 7, 5).fill(PALETTE.slateDark).stroke(OUT);
    g.rect(4, -20 + i * 8, 3, 1).fill(ROLE_ACCENT[role] ?? PALETTE.straw);
  }
  c.addChild(g);
  return c;
}

/** Bookshelf — architecture / reference nodes. Wood, role-hued spines. */
export function makeBookshelf(): Container {
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
  return c;
}

/** Crate of papers — task / workflow nodes (floor variant of the corkboard). */
export function makeCrate(): Container {
  const c = new Container();
  c.addChild(makeShadow(24));
  const g = new Graphics();
  isoBox(g, 0.55, 12, PALETTE.woodPale, PALETTE.woodShadow, PALETTE.woodMid);
  // paper sticking out of the top
  g.poly([-5, -16, 4, -18, 5, -12, -4, -11]).fill(PALETTE.paper).stroke(OUT);
  g.poly([-7, -13, 2, -15, 3, -11, -6, -10]).fill(PALETTE.hayLight).stroke(OUT);
  c.addChild(g);
  return c;
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

export interface CowSprite {
  view: Container;
  /** Flip horizontally to face walk direction. */
  setFacing: (dir: 1 | -1) => void;
  /** Body bob used by the walk/typewriter animation, in px. */
  setBob: (px: number) => void;
}

/** The cow — milk body, patches, blue scarf (Moo.exe mascot), side view. */
export function makeCow(): CowSprite {
  const view = new Container();
  view.addChild(makeShadow(22));
  const body = new Container();
  const g = new Graphics();
  // legs
  for (const lx of [-8, -3, 3, 6]) {
    g.rect(lx, -6, 3, 6).fill(PALETTE.cream).stroke(OUT);
    g.rect(lx, -2, 3, 2).fill(PALETTE.patch);
  }
  // body
  g.roundRect(-11, -16, 21, 11, 4).fill(PALETTE.milk).stroke(OUT);
  g.roundRect(-11, -9, 21, 4, 2).fill(PALETTE.cream);
  // patches
  g.roundRect(-8, -15, 5, 4, 2).fill(PALETTE.patch);
  g.roundRect(1, -10, 5, 3, 1).fill(PALETTE.patch);
  // tail
  g.rect(-13, -14, 2, 6).fill(PALETTE.cream).stroke(OUT);
  g.rect(-13, -8, 2, 2).fill(PALETTE.hayDeep);
  // head
  g.roundRect(5, -22, 10, 9, 3).fill(PALETTE.milk).stroke(OUT);
  g.roundRect(10, -17, 6, 4, 2).fill(PALETTE.muzzle).stroke(OUT);
  g.rect(8, -20, 2, 2).fill(PALETTE.patchDark); // eye
  g.rect(4, -24, 3, 3).fill(PALETTE.patch); // ear
  // the scarf — blue is Claude's one blue thing
  g.rect(4, -14, 10, 3).fill(PALETTE.scarf).stroke(OUT);
  g.rect(6, -11, 3, 4).fill(PALETTE.scarfShade).stroke(OUT);
  g.rect(5, -13, 4, 1).fill(PALETTE.scarfLight);
  body.addChild(g);
  view.addChild(body);
  return {
    view,
    setFacing: (dir) => {
      body.scale.x = dir;
    },
    setBob: (px) => {
      body.y = -px;
    },
  };
}

const BUBBLE_MAX = 24; // filename truncation per plan §8

export function truncateLabel(s: string): string {
  return s.length <= BUBBLE_MAX ? s : `…${s.slice(-(BUBBLE_MAX - 1))}`;
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
