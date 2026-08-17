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
import { makeBookshelf, makeCabinet, makeCrate, makeDevDesk, makeSideDesk } from "./props";

export const DEV_DESK_TILE: Tile = { tx: 9, ty: 9 };
export const SIDE_DESK_TILE: Tile = { tx: 6, ty: 9 };
export const COW_HOME_TILE: Tile = { tx: 8, ty: 8 };

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

function propForRole(role: NodeRole): Container {
  switch (role) {
    case "rules":
    case "persona":
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
  tile: Tile;
  view: Container;
  /** Millis of flash remaining (read-open bounce); driven by tick(). */
  flashMs: number;
  baseY: number;
}

export interface BarnLayout {
  /** Pan/zoom target — everything lives under this. */
  world: Container;
  /** Sorted object layer (props + cow). */
  objects: Container;
  props: Map<string, PropEntry>;
  rebuildProps: (nodes: readonly MemoryNode[]) => void;
  /** Trigger the ≤1.5s open/bounce animation on a node's prop. */
  flashProp: (nodeId: string) => void;
  /** Advance prop animations. */
  tick: (dtMs: number) => void;
  /** Pixel centre of the whole grid (for initial camera centring). */
  center: { x: number; y: number };
}

function buildGround(): Container {
  const ground = new Container();
  const g = new Graphics();
  for (let ty = 0; ty < GRID_H; ty += 1) {
    for (let tx = 0; tx < GRID_W; tx += 1) {
      const { x, y } = tileToScreen(tx, ty);
      const cy = y - TILE_H / 2;
      const fill = (tx + ty) % 2 === 0 ? PALETTE.woodMid : PALETTE.woodShadow;
      g.poly([
        x, cy - TILE_H / 2,
        x + TILE_W / 2, cy,
        x, cy + TILE_H / 2,
        x - TILE_W / 2, cy,
      ]).fill(fill);
      // sparse warm dither speckle so the checker reads as planks, not chess
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

export function buildLayout(): BarnLayout {
  const world = new Container();
  const objects = new Container();
  objects.sortableChildren = true;
  world.addChild(buildGround(), objects);

  placeStatic(objects, makeDevDesk(), DEV_DESK_TILE);
  placeStatic(objects, makeSideDesk(), SIDE_DESK_TILE);

  const props = new Map<string, PropEntry>();

  const layout: BarnLayout = {
    world,
    objects,
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
        const view = propForRole(node.role);
        const p = tileToScreen(tile.tx, tile.ty);
        view.position.set(p.x, p.y);
        view.zIndex = depthOf(tile, false);
        objects.addChild(view);
        props.set(node.id, {
          nodeId: node.id,
          filePath: node.filePath,
          role: node.role,
          tile,
          view,
          flashMs: 0,
          baseY: p.y,
        });
      }
    },

    flashProp: (nodeId) => {
      const entry = props.get(nodeId);
      if (entry !== undefined) entry.flashMs = 480; // 4 × 120ms bounce, well under 1.5s
    },

    tick: (dtMs) => {
      for (const entry of props.values()) {
        if (entry.flashMs <= 0) continue;
        entry.flashMs = Math.max(0, entry.flashMs - dtMs);
        // 2-frame bounce at 120ms holds (max-4-frames rule)
        const frame = Math.floor(entry.flashMs / 120) % 2;
        entry.view.y = entry.baseY - (entry.flashMs > 0 && frame === 1 ? 2 : 0);
      }
    },
  };
  return layout;
}
