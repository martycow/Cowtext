// Scene-graph builder: iso ground, fixed furniture (dev desk, side desk) and
// per-node props laid out on the grid. Rebuilds the prop layer whenever the
// graph's node list changes (BarnScene subscribes to the store and calls
// rebuildProps — this module itself never touches Zustand).

import { Container, Graphics } from "pixi.js";
import type { MemoryNode, NodeRole } from "../store/graph";
import { PALETTE } from "./palette";
import {
  GRID_H,
  GRID_W,
  TILE_H,
  TILE_W,
  clampTile,
  depthOf,
  tileToScreen,
  type Tile,
} from "./iso";
import {
  makeBarrel,
  makeBookshelf,
  makeCabinet,
  makeCrate,
  makeDevDesk,
  makeFeedTrough,
  makeFenceSegment,
  makeHayBaleLying,
  makeHayBaleStack,
  makeHayPile,
  makeLanternPost,
  makeMouseHole,
  makeSideDesk,
  type PropView,
} from "./props";

export const DEV_DESK_TILE: Tile = { tx: 9, ty: 9 };
export const SIDE_DESK_TILE: Tile = { tx: 6, ty: 9 };
export const COW_HOME_TILE: Tile = { tx: 8, ty: 8 };
/** Calves appear here before hopping to their spot (Task-Board §9 hover:
 *  the barn door hit region). Mirrors calf.ts's private DOOR_TILE — calf.ts
 *  is out of the hover lane's file zone, so this is a manually-synced
 *  duplicate; keep both in step if the spawn point ever moves. */
export const BARN_DOOR_TILE: Tile = { tx: 0, ty: 10 };

/** Deterministic auto-layout slots for nodes without scenePos: two rows along
 *  the north walls, then a middle row — stable order, no RNG. */
const AUTO_SLOTS: Tile[] = [
  { tx: 1, ty: 1 },
  { tx: 3, ty: 1 },
  { tx: 5, ty: 1 },
  { tx: 7, ty: 1 },
  { tx: 9, ty: 1 },
  { tx: 1, ty: 3 },
  { tx: 1, ty: 5 },
  { tx: 1, ty: 7 },
  { tx: 1, ty: 9 },
  { tx: 4, ty: 4 },
  { tx: 6, ty: 3 },
  { tx: 3, ty: 6 },
  { tx: 8, ty: 4 },
  { tx: 5, ty: 6 },
  { tx: 10, ty: 3 },
  { tx: 10, ty: 6 },
];

/** R10 barn reskin: static set-dressing, deliberately parked at edges/corners
 *  the AUTO_SLOTS layout and the fixed furniture never reach (checked against
 *  DEV_DESK_TILE, SIDE_DESK_TILE, COW_HOME_TILE, BARN_DOOR_TILE and every
 *  AUTO_SLOTS entry above) — decorative only, never competes with an
 *  info-anchor prop or the cow's walk targets. */
interface DecorSpec {
  id: string;
  tile: Tile;
  make: () => Container;
  label: string;
  /** Hover box size hint (Task-Board §9 extension) — tall props (posts,
   *  bales, barrels) vs. low ones (troughs, fences, the mouse hole). */
  tall: boolean;
}

const DECOR_ITEMS: DecorSpec[] = [
  { id: "hay-stack", tile: { tx: 11, ty: 1 }, make: makeHayBaleStack, label: "Hay bale — fuel for hard-working cows", tall: true },
  { id: "hay-lying", tile: { tx: 11, ty: 4 }, make: makeHayBaleLying, label: "Hay bale — fuel for hard-working cows", tall: true },
  { id: "hay-pile", tile: { tx: 2, ty: 11 }, make: makeHayPile, label: "Loose hay — snack pile", tall: false },
  { id: "lantern", tile: { tx: 0, ty: 4 }, make: makeLanternPost, label: "Lantern — lights the night shift", tall: true },
  { id: "trough", tile: { tx: 3, ty: 10 }, make: makeFeedTrough, label: "Feed trough — keeps the herd fed", tall: false },
  { id: "fence-a", tile: { tx: 0, ty: 9 }, make: makeFenceSegment, label: "Fence — keeps the barnyard tidy", tall: false },
  { id: "fence-b", tile: { tx: 0, ty: 11 }, make: makeFenceSegment, label: "Fence — keeps the barnyard tidy", tall: false },
  { id: "barrel", tile: { tx: 11, ty: 11 }, make: makeBarrel, label: "Barrel — spare supplies", tall: true },
  { id: "mouse-hole", tile: { tx: 0, ty: 0 }, make: makeMouseHole, label: "A tiny mouse hole — someone else lives here too", tall: false },
];

function propForRole(role: NodeRole): PropView {
  switch (role) {
    case "rules":
    case "agent":
      return makeCabinet(role);
    case "architecture":
    case "reference":
    case "glossary":
      return makeBookshelf();
    case "task":
    case "workflow":
      return makeCrate();
  }
}

export interface PropEntry {
  nodeId: string;
  filePath: string;
  role: NodeRole;
  /** Node display name — hover-bubble label metadata (Task-Board §9). */
  title: string;
  tile: Tile;
  view: Container;
  /** Millis of flash remaining (read-open bounce); driven by tick(). */
  flashMs: number;
  baseX: number;
  baseY: number;
  /** J5 — read this session; prop renders its ajar/popped/lifted frame. */
  opened: boolean;
  setOpened: (b: boolean) => void;
}

export interface BarnLayout {
  /** Pan/zoom target — everything lives under this. */
  world: Container;
  /** Sorted object layer (props + cow). */
  objects: Container;
  /** Static furniture views — exposed so hover hit-testing (Task-Board §9)
   *  can exclude them when classifying the leftover children of `objects`
   *  as calves; not part of the sortable prop map. */
  devDeskView: Container;
  sideDeskView: Container;
  /** R10 static set-dressing (hay/lantern/trough/fence/barrel/mouse hole) —
   *  hover.ts (Task-Board §9) reads this to add decoTall/decoLow targets and
   *  to exclude these views from its calf leftover-scan. */
  decos: ReadonlyArray<{ id: string; view: Container; label: string; tall: boolean }>;
  props: Map<string, PropEntry>;
  rebuildProps: (nodes: readonly MemoryNode[]) => void;
  /** Trigger the ≤1.5s open/bounce animation on a node's prop. */
  flashProp: (nodeId: string) => void;
  /** J5 — mark a node's prop opened for the session (ajar drawer etc.). */
  setPropOpened: (nodeId: string) => void;
  /** J5 — one paper step onto the side-desk stack (cap 8, then a 2nd pile). */
  addPaper: () => void;
  /** J5 — set the stack from replayed event state (remount survival). */
  setPaperCount: (n: number) => void;
  /** J7 — pooled 3-frame dust puff at world (x, y). Hard cap 8. */
  spawnDust: (x: number, y: number) => void;
  /** E5 — drifting Z-mote from the same pool (asleep cow). */
  spawnZ: (x: number, y: number) => void;
  /** E5 — coffee cup at the dev desk; steam=false freezes the curl (calm). */
  setCoffee: (on: boolean, steam: boolean) => void;
  /** Advance prop/particle animations; reduced=true renders rest frames. */
  tick: (dtMs: number, reduced?: boolean) => void;
  /** Pixel centre of the whole grid (for initial camera centring). */
  center: { x: number; y: number };
}

/** R10: wood plank floor. Boards run along the ty axis — every tile sharing
 *  a tx column takes the same one of 3 wood tones, so a constant-tx line of
 *  tiles reads as one long floorboard running diagonally across the screen
 *  (real floorboards, not a checkerboard). End-seams land every 3 tiles,
 *  phase-shifted per column so they stagger brick-style instead of lining
 *  into a grid. Dither stays sparse and warm (ART_DIRECTION: dither is wear,
 *  never a texture fill). */
function buildGround(): Container {
  const ground = new Container();
  const g = new Graphics();
  const tones = [PALETTE.woodMid, PALETTE.woodLight, PALETTE.woodShadow];
  for (let ty = 0; ty < GRID_H; ty += 1) {
    for (let tx = 0; tx < GRID_W; tx += 1) {
      const { x, y } = tileToScreen(tx, ty);
      const cy = y - TILE_H / 2;
      const fill = tones[tx % tones.length];
      g.poly([
        x, cy - TILE_H / 2,
        x + TILE_W / 2, cy,
        x, cy + TILE_H / 2,
        x - TILE_W / 2, cy,
      ]).fill(fill);
      // board end-seam, staggered per plank column (brick-style, not a grid)
      const seamPhase = (tx * 2) % 3;
      if ((ty + seamPhase) % 3 === 0) {
        g.moveTo(x - TILE_W / 2, cy)
          .lineTo(x, cy + TILE_H / 2)
          .stroke({ width: 1, color: PALETTE.woodShadow, alpha: 0.5 });
      }
      // sparse warm dither speckle — wear marks, not a texture
      if ((tx * 7 + ty * 13) % 5 === 0) {
        g.rect(x - 6, cy - 1, 2, 1).fill(PALETTE.woodLight);
        g.rect(x + 4, cy + 2, 2, 1).fill(PALETTE.woodShadow);
      }
    }
  }
  // grid outline (subtle, warm)
  const n = tileToScreen(0, 0);
  const e = tileToScreen(GRID_W - 1, 0);
  const s = tileToScreen(GRID_W - 1, GRID_H - 1);
  const w = tileToScreen(0, GRID_H - 1);
  g.poly([
    n.x, n.y - TILE_H, e.x + TILE_W / 2, e.y - TILE_H / 2,
    s.x, s.y, w.x - TILE_W / 2, w.y - TILE_H / 2,
  ]).stroke({ width: 1, color: PALETTE.outline, alpha: 0.6 });
  ground.addChild(g);
  return ground;
}

function placeStatic(objects: Container, view: Container, tile: Tile): void {
  const p = tileToScreen(tile.tx, tile.ty);
  view.position.set(p.x, p.y);
  view.zIndex = depthOf(tile, false);
  objects.addChild(view);
}

// ── particle pool (J7 dust + E5 Z-motes): ONE pool, hard cap 8 ──────────
const PARTICLE_CAP = 8;
const DUST_TTL = 240; // 3 pre-authored frames × 80 ms
const Z_TTL = 2400;

interface Particle {
  view: Container;
  dust: readonly [Graphics, Graphics, Graphics];
  z: Graphics;
  kind: "dust" | "z";
  ageMs: number;
  ttl: number; // 0 = free
  baseY: number;
}

/** Checker-dither puff (the makeShadow idiom), widening/fading per frame. */
function makeDustFrame(step: number): Graphics {
  const g = new Graphics();
  const rx = 2 + step * 2;
  const ry = rx * 0.6;
  for (let y = -rx; y < rx; y += 2) {
    for (let x = -rx; x < rx; x += 2) {
      const inside = (x / rx) ** 2 + (y / ry) ** 2 <= 1;
      const checker = (Math.round(x / 2) + Math.round(y / 2)) % 2 === 0;
      if (inside && checker) g.rect(x, y, 2, 2);
    }
  }
  g.fill({ color: PALETTE.woodPale, alpha: 0.55 - step * 0.15 });
  return g;
}

/** Tiny pixel "Z" for the asleep cow. */
function makeZMote(): Graphics {
  const g = new Graphics();
  g.rect(0, 0, 3, 1).fill(PALETTE.hayLight);
  g.rect(1, 1, 1, 1).fill(PALETTE.hayLight);
  g.rect(0, 2, 3, 1).fill(PALETTE.hayLight);
  return g;
}

const PAPER_PILE_CAP = 8;
const PAPER_MAX = PAPER_PILE_CAP * 2; // two piles, no third (J5)

export function buildLayout(): BarnLayout {
  const world = new Container();
  const objects = new Container();
  objects.sortableChildren = true;
  // non-sorted overlay above the object layer — particles only
  const overlay = new Container();
  world.addChild(buildGround(), objects, overlay);

  const devDesk = makeDevDesk();
  placeStatic(objects, devDesk, DEV_DESK_TILE);
  const sideDesk = makeSideDesk();
  placeStatic(objects, sideDesk, SIDE_DESK_TILE);

  // R10 barn reskin — static hay/set-dressing, placed once, never rebuilt.
  const decos = DECOR_ITEMS.map((spec) => {
    const view = spec.make();
    placeStatic(objects, view, spec.tile);
    return { id: spec.id, view, label: spec.label, tall: spec.tall };
  });

  // ── E5 coffee: cup + 2-frame steam curl (8 s period), dev-desk child ──
  const coffee = new Container();
  const cup = new Graphics();
  cup.rect(9, -17, 4, 4).fill(PALETTE.milk).stroke({ width: 1, color: PALETTE.outline });
  cup.rect(13, -16, 1, 2).fill(PALETTE.milk); // handle
  const steam0 = new Graphics();
  steam0.rect(10, -20, 1, 1).fill(PALETTE.hayLight);
  steam0.rect(11, -22, 1, 1).fill(PALETTE.hayLight);
  const steam1 = new Graphics();
  steam1.rect(11, -20, 1, 1).fill(PALETTE.hayLight);
  steam1.rect(10, -22, 1, 1).fill(PALETTE.hayLight);
  steam1.visible = false;
  coffee.addChild(cup, steam0, steam1);
  coffee.visible = false;
  devDesk.addChild(coffee);
  let steamMs = 0;
  let steamOn = true;

  // ── J5 paper stacks on the side desk (accumulation, session-scoped) ──
  const papers = new Graphics();
  sideDesk.addChild(papers);
  let paperCount = 0;
  const redrawPapers = (): void => {
    papers.clear();
    const pile1 = Math.min(paperCount, PAPER_PILE_CAP);
    const pile2 = Math.min(Math.max(0, paperCount - PAPER_PILE_CAP), PAPER_PILE_CAP);
    for (let i = 0; i < pile1; i += 1) {
      papers.rect(5, -13 - i * 2, 6, 2).fill(i % 2 === 0 ? PALETTE.paper : PALETTE.hayLight);
    }
    for (let i = 0; i < pile2; i += 1) {
      papers.rect(-11, -13 - i * 2, 6, 2).fill(i % 2 === 0 ? PALETTE.hayLight : PALETTE.paper);
    }
  };

  // ── particle pool ──
  const pool: Particle[] = [];
  for (let i = 0; i < PARTICLE_CAP; i += 1) {
    const view = new Container();
    const dust = [makeDustFrame(0), makeDustFrame(1), makeDustFrame(2)] as const;
    for (const f of dust) {
      f.visible = false;
      view.addChild(f);
    }
    const z = makeZMote();
    z.visible = false;
    view.addChild(z);
    view.visible = false;
    overlay.addChild(view);
    pool.push({ view, dust, z, kind: "dust", ageMs: 0, ttl: 0, baseY: 0 });
  }
  /** Free slot if any; else the oldest live particle is reused. */
  const takeParticle = (): Particle => {
    let oldest: Particle | null = null;
    for (const p of pool) {
      if (p.ttl <= 0) return p;
      if (oldest === null || p.ageMs / p.ttl > oldest.ageMs / oldest.ttl) oldest = p;
    }
    return oldest ?? pool[0];
  };
  const spawnParticle = (kind: "dust" | "z", x: number, y: number): void => {
    const p = takeParticle();
    p.kind = kind;
    p.ageMs = 0;
    p.ttl = kind === "dust" ? DUST_TTL : Z_TTL;
    p.baseY = Math.round(y);
    p.view.position.set(Math.round(x), Math.round(y));
    p.view.alpha = 1;
    p.z.visible = kind === "z";
    p.dust.forEach((g, fi) => {
      g.visible = kind === "dust" && fi === 0;
    });
    p.view.visible = true;
  };

  const props = new Map<string, PropEntry>();

  const layout: BarnLayout = {
    world,
    objects,
    devDeskView: devDesk,
    sideDeskView: sideDesk,
    decos,
    props,
    center: tileToScreen((GRID_W - 1) / 2, (GRID_H - 1) / 2),

    rebuildProps: (nodes) => {
      for (const entry of props.values()) entry.view.destroy({ children: true });
      props.clear();
      const taken = new Set<string>([
        `${DEV_DESK_TILE.tx},${DEV_DESK_TILE.ty}`,
        `${SIDE_DESK_TILE.tx},${SIDE_DESK_TILE.ty}`,
      ]);
      let slot = 0;
      const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
      for (const node of ordered) {
        let tile: Tile;
        if (node.scenePos !== undefined) {
          tile = clampTile({ tx: node.scenePos.tx, ty: node.scenePos.ty });
        } else {
          while (slot < AUTO_SLOTS.length && taken.has(`${AUTO_SLOTS[slot].tx},${AUTO_SLOTS[slot].ty}`)) {
            slot += 1;
          }
          tile = AUTO_SLOTS[slot % AUTO_SLOTS.length];
          slot += 1;
        }
        taken.add(`${tile.tx},${tile.ty}`);
        const pv = propForRole(node.role);
        const p = tileToScreen(tile.tx, tile.ty);
        pv.view.position.set(p.x, p.y);
        pv.view.zIndex = depthOf(tile, false);
        objects.addChild(pv.view);
        props.set(node.id, {
          nodeId: node.id,
          filePath: node.filePath,
          role: node.role,
          title: node.title,
          tile,
          view: pv.view,
          flashMs: 0,
          baseX: p.x,
          baseY: p.y,
          opened: false, // session accumulation resets on rebuild (accepted);
          // BarnScene re-derives it from the event ring right after.
          setOpened: pv.setOpened,
        });
      }
    },

    flashProp: (nodeId) => {
      const entry = props.get(nodeId);
      if (entry !== undefined) entry.flashMs = 480; // 4 × 120ms bounce, well under 1.5s
    },

    setPropOpened: (nodeId) => {
      const entry = props.get(nodeId);
      if (entry !== undefined && !entry.opened) {
        entry.opened = true;
        entry.setOpened(true);
      }
    },

    addPaper: () => {
      if (paperCount >= PAPER_MAX) return; // second pile caps and stays
      paperCount += 1;
      redrawPapers();
    },

    setPaperCount: (n) => {
      paperCount = Math.max(0, Math.min(PAPER_MAX, Math.floor(n)));
      redrawPapers();
    },

    spawnDust: (x, y) => spawnParticle("dust", x, y),
    spawnZ: (x, y) => spawnParticle("z", x, y),

    setCoffee: (on, steam) => {
      coffee.visible = on;
      steamOn = steam;
      if (!steam) {
        steam0.visible = false;
        steam1.visible = false;
      }
    },

    tick: (dtMs, reduced = false) => {
      // prop flash — countdown always runs so state stays truthful; reduced
      // motion renders frame 0 (position rest) the whole way.
      for (const entry of props.values()) {
        if (entry.flashMs <= 0) continue;
        entry.flashMs = Math.max(0, entry.flashMs - dtMs);
        if (reduced) {
          entry.view.position.set(entry.baseX, entry.baseY);
          continue;
        }
        // J2 anticipation pre-frame: 1 px handle jiggle before the bounce
        entry.view.x = entry.baseX + (entry.flashMs > 380 ? 1 : 0);
        // 2-frame bounce at 120ms holds (max-4-frames rule)
        const frame = Math.floor(entry.flashMs / 120) % 2;
        entry.view.y = entry.baseY - (entry.flashMs > 0 && frame === 1 ? 2 : 0);
      }
      // coffee steam curl: 2 frames, 8 s period
      if (coffee.visible && steamOn) {
        steamMs = (steamMs + dtMs) % 8000;
        const f = steamMs < 4000 ? 0 : 1;
        steam0.visible = f === 0;
        steam1.visible = f === 1;
      }
      // particles: dust = 3-frame flipbook; z = ease-out drift, stepped fade
      for (const p of pool) {
        if (p.ttl <= 0) continue;
        p.ageMs += dtMs;
        if (p.ageMs >= p.ttl) {
          p.ttl = 0;
          p.view.visible = false;
          continue;
        }
        if (p.kind === "dust") {
          const f = Math.min(2, Math.floor(p.ageMs / 80));
          p.dust.forEach((g, fi) => {
            g.visible = fi === f;
          });
        } else {
          const t = p.ageMs / p.ttl;
          const ease = 1 - (1 - t) * (1 - t);
          p.view.y = Math.round(p.baseY - ease * 12);
          p.view.alpha = t < 0.5 ? 1 : t < 0.8 ? 0.66 : 0.33;
        }
      }
    },
  };
  return layout;
}
