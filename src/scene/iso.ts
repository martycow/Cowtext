// 2:1 isometric tile math (plan §8 / ART_DIRECTION "Iso grid & anchors").
// Base tile 32×16: sx = (tx − ty) · 16, sy = (tx + ty) · 8.
// All scene positions anchor at the bottom-centre diamond vertex equivalent:
// tileToScreen returns the *centre* of the tile diamond; sprites draw with
// their base at that point and rise in −y.

export const TILE_W = 32;
export const TILE_H = 16;
export const GRID_W = 12;
export const GRID_H = 12;

export interface Tile {
  tx: number;
  ty: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Centre of tile (tx, ty) in world pixels. */
export function tileToScreen(tx: number, ty: number): ScreenPoint {
  return {
    x: (tx - ty) * (TILE_W / 2),
    y: (tx + ty) * (TILE_H / 2) + TILE_H / 2,
  };
}

export function clampTile(t: Tile): Tile {
  return {
    tx: Math.max(0, Math.min(GRID_W - 1, Math.round(t.tx))),
    ty: Math.max(0, Math.min(GRID_H - 1, Math.round(t.ty))),
  };
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.tx === b.tx && a.ty === b.ty;
}

/** Depth key for painter's sort: props at tx+ty, characters get +0.5 on ties. */
export function depthOf(t: Tile, isCharacter: boolean): number {
  return (t.tx + t.ty) * 10 + (isCharacter ? 5 : 0);
}

/**
 * Simple Manhattan path, tx-first then ty, 4-neighbour steps, endpoints
 * exclusive of `from`, inclusive of `to`. Good enough for an open barn floor.
 */
export function manhattanPath(from: Tile, to: Tile): Tile[] {
  const path: Tile[] = [];
  let { tx, ty } = from;
  while (tx !== to.tx) {
    tx += Math.sign(to.tx - tx);
    path.push({ tx, ty });
  }
  while (ty !== to.ty) {
    ty += Math.sign(to.ty - ty);
    path.push({ tx, ty });
  }
  return path;
}
