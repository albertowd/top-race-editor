// The roads' bumps: metres the floor is raised (or lowered) by, where they were made by hand, on a grid of its own
// (BUMP_CELL apart) kept in tiles, only those painted. The build moves every point of the merged floor by the bumps
// where it is (the same at a point whichever mesh it is in: no seam opens); the page makes them a point at a time, or
// with a brush that raises, lowers or smooths them. Each edit gives new bumps (the tiles it changed new, the rest
// shared): the page keeps the old ones to undo.

/** metres between the bumps' points */
export const BUMP_CELL = 0.1;
/** points a tile is wide and deep */
export const BUMP_TILE = 128;

export interface Bumps {
  /** metres between its points (point i, j at x = i * cell, z = j * cell) */
  cell: number;
  /** points a tile is wide */
  tile: number;
  /** its tiles by "ti,tj": metres at each point, row by row (z), tile points wide */
  tiles: Readonly<Record<string, Float32Array>>;
}

export const noBumps = (): Bumps => ({ cell: BUMP_CELL, tile: BUMP_TILE, tiles: {} });

/** Whether there are any. */
export const hasBumps = (b: Bumps | null | undefined): b is Bumps => !!b && Object.keys(b.tiles).length > 0;

const keyOf = (ti: number, tj: number) => `${ti},${tj}`;

/** Metres at point (i, j): 0 where no tile is. */
function at(b: Bumps, i: number, j: number): number {
  const ti = Math.floor(i / b.tile);
  const tj = Math.floor(j / b.tile);
  const t = b.tiles[keyOf(ti, tj)];
  return t ? (t[(j - tj * b.tile) * b.tile + (i - ti * b.tile)] as number) : 0;
}

/** The bumps at (x, z), linear between their points: 0 where none are. */
export function bumpAt(b: Bumps, x: number, z: number): number {
  const fx = x / b.cell;
  const fz = z / b.cell;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  return (
    (at(b, i, j) * (1 - tx) + at(b, i + 1, j) * tx) * (1 - tz) +
    (at(b, i, j + 1) * (1 - tx) + at(b, i + 1, j + 1) * tx) * tz
  );
}

/** New bumps, each point within radius of (x, z) set to what change makes of it (its place, its metres now, how far
 * it is): the tiles it changes new copies, the rest shared. */
function changed(
  b: Bumps,
  x: number,
  z: number,
  radius: number,
  change: (i: number, j: number, v: number, d: number) => number,
): Bumps {
  const c = b.cell;
  const i0 = Math.ceil((x - radius) / c);
  const i1 = Math.floor((x + radius) / c);
  const j0 = Math.ceil((z - radius) / c);
  const j1 = Math.floor((z + radius) / c);
  const tiles: Record<string, Float32Array> = { ...b.tiles };
  const fresh = new Set<string>();
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * c - x, j * c - z);
      if (d > radius) continue;
      const v = at(b, i, j);
      const w = change(i, j, v, d);
      if (w === v) continue;
      const ti = Math.floor(i / b.tile);
      const tj = Math.floor(j / b.tile);
      const k = keyOf(ti, tj);
      if (!fresh.has(k)) {
        const old = tiles[k];
        tiles[k] = old ? old.slice() : new Float32Array(b.tile * b.tile);
        fresh.add(k);
      }
      (tiles[k] as Float32Array)[(j - tj * b.tile) * b.tile + (i - ti * b.tile)] = w;
    }
  return fresh.size ? { ...b, tiles } : b;
}

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** How much of an edit a point at d metres from its middle takes: all at the middle, nothing at its reach. */
export const bumpFalloff = (d: number, radius: number) => (radius > 0 ? 1 - smoothstep(d / radius) : 0);

export type BumpMode = 'point' | 'raise' | 'lower' | 'smooth';

/** How the bumps are made: a point at a time (its reach), or a brush (its reach, how strong a dab is). */
export interface BumpBrush {
  mode: BumpMode;
  /** metres a brush reaches */
  radius: number;
  /** 0 to 1: how much a dab does */
  strength: number;
  /** metres a point set reaches: it eases to nothing there */
  reach: number;
}

export const BUMP_BRUSH: BumpBrush = { mode: 'point', radius: 1, strength: 0.5, reach: 0.25 };

/** metres a dab raises or lowers the floor by at its middle, at full strength */
export const BUMP_A_DAB = 0.004;
/** the share of the way to the mean round it a smoothing dab goes at its middle, at full strength */
const SMOOTH_A_DAB = 0.5;

/** One dab of a brush at (x, z): raised, lowered, or smoothed (towards the mean of the bumps within half its reach). */
export function bumpDab(b: Bumps, x: number, z: number, brush: BumpBrush): Bumps {
  const s = Math.min(1, Math.max(0, brush.strength));
  if (brush.mode === 'raise' || brush.mode === 'lower') {
    const by = (brush.mode === 'raise' ? 1 : -1) * BUMP_A_DAB * s;
    return changed(b, x, z, brush.radius, (_i, _j, v, d) => v + by * bumpFalloff(d, brush.radius));
  }
  if (brush.mode !== 'smooth') return b;
  const k = Math.max(1, Math.round(brush.radius / 2 / b.cell));
  // (the mean of each point's square of points round it: of the bumps before the dab)
  const mean = (i: number, j: number) => {
    let sum = 0;
    let n = 0;
    for (let q = j - k; q <= j + k; q++)
      for (let p = i - k; p <= i + k; p++) {
        sum += at(b, p, q);
        n++;
      }
    return sum / n;
  };
  return changed(
    b,
    x,
    z,
    brush.radius,
    (i, j, v, d) => v + (mean(i, j) - v) * SMOOTH_A_DAB * s * bumpFalloff(d, brush.radius),
  );
}

/** The bumps at (x, z) made to metres, easing to what they were within reach of it. */
export function bumpPoint(b: Bumps, x: number, z: number, metres: number, reach: number): Bumps {
  // (each point moved by its share of the way there; again, so (x, z) between them comes to it)
  let out = b;
  for (let k = 0; k < 4; k++) {
    const by = metres - bumpAt(out, x, z);
    if (Math.abs(by) < 1e-6) break;
    out = changed(
      out,
      x,
      z,
      Math.max(reach, out.cell),
      (_i, _j, v, d) => v + by * bumpFalloff(d, Math.max(reach, out.cell)),
    );
  }
  return out;
}

/** The bumps within radius of (x, z) taken away (back to the floor as built). */
export const bumpsCleared = (b: Bumps, x: number, z: number, radius: number): Bumps =>
  changed(b, x, z, radius, () => 0);

/** The world each tile covers (x0, z0, x1, z1: from its first point to the next tile's). */
export function tileBox(b: Bumps, key: string): [number, number, number, number] {
  const [ti, tj] = key.split(',').map(Number) as [number, number];
  const span = b.tile * b.cell;
  return [ti * span, tj * span, (ti + 1) * span, (tj + 1) * span];
}

// ---------------------------------------------------------------- as the track keeps them

/** The bumps as the track's file has them (source/bumps.json): each tile's metres, float32 little-endian, base64. */
export interface BumpsJson {
  version: 1;
  cell: number;
  tile: number;
  tiles: Record<string, string>;
}

function base64Of(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function bytesOf(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The bumps as kept: the tiles with any bump only (one of nothing left out). */
export function bumpsJson(b: Bumps): BumpsJson {
  const tiles: Record<string, string> = {};
  for (const [k, t] of Object.entries(b.tiles))
    if (t.some((v) => Math.abs(v) > 1e-7)) tiles[k] = base64Of(new Uint8Array(t.buffer, t.byteOffset, t.byteLength));
  return { version: 1, cell: b.cell, tile: b.tile, tiles };
}

/** The bumps as kept, read (none, or not of this kind: none). */
export function bumpsFrom(j: unknown): Bumps {
  const d = j as Partial<BumpsJson> | null;
  if (!d || typeof d !== 'object' || !d.tiles || typeof d.cell !== 'number' || typeof d.tile !== 'number')
    return noBumps();
  const n = d.tile * d.tile;
  const tiles: Record<string, Float32Array> = {};
  for (const [k, s] of Object.entries(d.tiles)) {
    if (!/^-?\d+,-?\d+$/.test(k) || typeof s !== 'string') continue;
    const bytes = bytesOf(s);
    if (bytes.length !== n * 4) continue;
    tiles[k] = new Float32Array(bytes.buffer);
  }
  return { cell: d.cell, tile: d.tile, tiles };
}
