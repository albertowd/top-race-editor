// The map in square tiles: the parts the layers are made and kept in (a tile of the place, the roads' footprints
// over it), and how a point, a box or a set of points finds the tiles it is on, by position (no search).

/** metres a side of a tile */
export const TILE = 64;

/** An extent on the map: x and z, metres. */
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A tile by its column and row. */
export type Tile = readonly [number, number];

export const tileKey = (t: Tile): string => `${t[0]},${t[1]}`;

export function tileOf(x: number, z: number, size = TILE): Tile {
  return [Math.floor(x / size), Math.floor(z / size)];
}

/** A tile's extent. */
export function tileBox(t: Tile, size = TILE): Box {
  return { x0: t[0] * size, z0: t[1] * size, x1: (t[0] + 1) * size, z1: (t[1] + 1) * size };
}

/** The tiles a box lies on (a box on a tile's edge, on both). */
export function tilesOver(b: Box, size = TILE): Tile[] {
  const [gx0, gz0] = tileOf(b.x0, b.z0, size);
  const [gx1, gz1] = tileOf(b.x1, b.z1, size);
  const out: Tile[] = [];
  for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) out.push([gx, gz]);
  return out;
}

/** The box round points (x, z pairs), grown by pad all round; null for none. */
export function boxOf(P: ArrayLike<number>, pad = 0): Box | null {
  if (P.length < 2) return null;
  const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (let i = 0; i + 1 < P.length; i += 2) {
    const x = P[i] as number;
    const z = P[i + 1] as number;
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (z < b.z0) b.z0 = z;
    if (z > b.z1) b.z1 = z;
  }
  return { x0: b.x0 - pad, z0: b.z0 - pad, x1: b.x1 + pad, z1: b.z1 + pad };
}

export const overlaps = (a: Box, b: Box): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;

/** Things filed by the tiles their boxes lie on, found again by a box: those whose tiles it lies on. */
export class TileIndex<T> {
  private readonly tiles = new Map<string, { box: Box; item: T }[]>();

  constructor(readonly size = TILE) {}

  add(box: Box, item: T): void {
    for (const t of tilesOver(box, this.size)) {
      const k = tileKey(t);
      const list = this.tiles.get(k);
      if (list) list.push({ box, item });
      else this.tiles.set(k, [{ box, item }]);
    }
  }

  /** Those whose boxes meet the box, each once. */
  find(box: Box): T[] {
    const seen = new Set<T>();
    for (const t of tilesOver(box, this.size))
      for (const e of this.tiles.get(tileKey(t)) ?? []) if (!seen.has(e.item) && overlaps(e.box, box)) seen.add(e.item);
    return [...seen];
  }

  /** The tiles with something on them. */
  keys(): string[] {
    return [...this.tiles.keys()];
  }
}
