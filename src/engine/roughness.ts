// The roads' surface made imperfect all over, as real asphalt is (objects.json's `surface`, millimetres): long waves
// (8 to 20 m), bumps (1.5 to 4 m) and a ripple (a third to most of a metre: what makes a kart tremble), each noise in
// the world's own coordinates; and every bend lower on its inside, the tighter the more, down to its inside edge. One
// function of where a point is (the same in every mesh at a point: no seam opens), full on the roads and easing to
// nothing a metre past their edges and their free ends (the grass, the far ground as they are).

import type { SurfaceRoughness } from '../domain/types';
import { fine, type RoadDesc } from './roads';

/** Ready-made levels (millimetres): none of it, a little, a used track's, an old one's. */
export const ROUGH_LEVELS: Record<'light' | 'medium' | 'heavy', Required<Omit<SurfaceRoughness, 'seed' | 'map'>>> = {
  light: { waves: 6, bumps: 2.5, ripple: 0.8, camber: 15 },
  medium: { waves: 12, bumps: 5, ripple: 1.5, camber: 30 },
  heavy: { waves: 18, bumps: 8, ripple: 2.5, camber: 45 },
};

/** metres between the rows of a road it reads (its fine rows are every 0.1 m) */
const ROW = 0.5;
/** metres either side of a row its bend is read over */
const BEND = 4;
/** metres: a bend this tight (its radius) or tighter has its inside down by the whole camber */
const TIGHT = 12;
/** metres past a road's edge (and its free end) the roughness eases to nothing over */
const EASE = 1;
/** metres a cell of the rows' index is */
const CELL = 4;
/** metres from a point of the roughness map it counts; how much it may scale the roughness, at least and at most */
const MAP_REACH = 6;
const MAP_LEAST = 0.3;
const MAP_MOST = 2.5;

/** How rough each place is by the map (videos'): the points within MAP_REACH, the nearer the more; none near: 1. */
function mapOf(points: [number, number, number][] | undefined): (x: number, z: number) => number {
  if (!points?.length) return () => 1;
  const cells = new Map<string, [number, number, number][]>();
  for (const p of points) {
    const key = `${Math.floor(p[0] / MAP_REACH)},${Math.floor(p[1] / MAP_REACH)}`;
    const l = cells.get(key);
    if (l) l.push(p);
    else cells.set(key, [p]);
  }
  return (x, z) => {
    const ci = Math.floor(x / MAP_REACH);
    const cj = Math.floor(z / MAP_REACH);
    let sum = 0;
    let wsum = 0;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const [px, pz, k] of cells.get(`${ci + di},${cj + dj}`) ?? []) {
          const d = Math.hypot(px - x, pz - z);
          if (d > MAP_REACH) continue;
          // (fading to nothing at the reach: where the map ends, the levels as they are)
          const w = (1 - d / MAP_REACH) ** 2;
          sum += w * k;
          wsum += w;
        }
    const k = wsum ? (sum + Math.max(0, 1 - wsum)) / Math.max(wsum, 1) : 1;
    return Math.min(MAP_MOST, Math.max(MAP_LEAST, k));
  };
}

/** A hash of a lattice point (and a seed) to 0..1. */
function hash(i: number, j: number, seed: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise at (x, z) on a lattice so many metres apart: -1 to 1. */
function noise(x: number, z: number, metres: number, seed: number): number {
  const u = x / metres;
  const v = z / metres;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * fu * (fu * (fu * 6 - 15) + 10);
  const sv = fv * fv * fv * (fv * (fv * 6 - 15) + 10);
  const a = hash(i, j, seed);
  const b = hash(i + 1, j, seed);
  const c = hash(i, j + 1, seed);
  const d = hash(i + 1, j + 1, seed);
  return ((a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv) * 2 - 1;
}

/** A road's rows as read: middle, its left (unit), its way (unit), its widths left and right, its bend (1/m, +
 * turning left), whether it is a free end's (no road going on from it). */
interface Row {
  x: number;
  z: number;
  lx: number;
  lz: number;
  tx: number;
  tz: number;
  wl: number;
  wr: number;
  k: number;
  end: -1 | 0 | 1;
}

function rowsOf(road: RoadDesc): Row[] {
  const f = fine(road);
  const n = f.at.length;
  if (n < 2) return [];
  const pick: number[] = [];
  for (let i = 0, next = 0; i < n; i++)
    if ((f.at[i] as number) >= next || i === n - 1) {
      pick.push(i);
      next = (f.at[i] as number) + ROW;
    }
  // (its way at each fine row: its left turned back, (lz, -lx))
  const way = (i: number): [number, number] => [f.lz[i] as number, -(f.lx[i] as number)];
  const along = (i: number, d: number) => {
    const target = (f.at[i] as number) + d;
    let j = i;
    if (d > 0) while (j < n - 1 && (f.at[j] as number) < target) j++;
    else while (j > 0 && (f.at[j] as number) > target) j--;
    return j;
  };
  const joins = (road as { joins?: (string | null)[] }).joins ?? [];
  return pick.map((i, k) => {
    const a = along(i, -BEND);
    const b = along(i, BEND);
    const ta = way(a);
    const tb = way(b);
    const ds = (f.at[b] as number) - (f.at[a] as number);
    const t = way(i);
    return {
      x: f.mx[i] as number,
      z: f.mz[i] as number,
      lx: f.lx[i] as number,
      lz: f.lz[i] as number,
      tx: t[0],
      tz: t[1],
      wl: f.wl[i] as number,
      wr: f.wr[i] as number,
      // (the turn from a to b over the way between: its cross product's sine over the length)
      k: ds > 1e-6 ? (ta[0] * tb[1] - ta[1] * tb[0]) / ds : 0,
      end: k === 0 && !joins[0] ? -1 : k === pick.length - 1 && !joins[1] ? 1 : 0,
    } satisfies Row;
  });
}

/** The roughness of the roads described (run-offs left out: they go with their road), in metres at (x, z); null
 * where the track has none. */
export function roughnessOf(
  roads: RoadDesc[],
  s: SurfaceRoughness | undefined,
): ((x: number, z: number) => number) | null {
  const waves = (s?.waves ?? 0) / 1000;
  const bumps = (s?.bumps ?? 0) / 1000;
  const ripple = (s?.ripple ?? 0) / 1000;
  const camber = (s?.camber ?? 0) / 1000;
  if (!(waves || bumps || ripple || camber)) return null;
  const seed = s?.seed ?? 1;
  const rough = mapOf(s?.map);
  const rows: Row[] = roads.filter((r) => !r.along).flatMap(rowsOf);
  const cells = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const key = `${Math.floor(r.x / CELL)},${Math.floor(r.z / CELL)}`;
    const l = cells.get(key);
    if (l) l.push(i);
    else cells.set(key, [i]);
  });
  return (x, z) => {
    // (the road under it: the nearest row within reach, and where across and along it the point is)
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    let best = -1;
    let bd = Infinity;
    for (let di = -3; di <= 3; di++)
      for (let dj = -3; dj <= 3; dj++)
        for (const i of cells.get(`${ci + di},${cj + dj}`) ?? []) {
          const r = rows[i] as Row;
          const d = (r.x - x) ** 2 + (r.z - z) ** 2;
          if (d < bd) [bd, best] = [d, i];
        }
    if (best < 0) return 0;
    const r = rows[best] as Row;
    const dx = x - r.x;
    const dz = z - r.z;
    const o = dx * r.lx + dz * r.lz;
    const a = dx * r.tx + dz * r.tz;
    const w = o >= 0 ? r.wl : r.wr;
    const past = Math.max(0, Math.abs(o) - w, r.end !== 0 && Math.sign(a) === r.end ? Math.abs(a) - ROW : 0);
    if (past >= EASE) return 0;
    const mask = 1 - past / EASE;
    // (as rough here as the videos say: the bumps and ripple by it, the long waves by its square root)
    const k = rough(x, z);
    const n =
      Math.sqrt(k) * waves * (noise(x, z, 14, seed) * 0.7 + noise(x, z, 7, seed + 1) * 0.3) +
      k * bumps * (noise(x, z, 2.6, seed + 2) * 0.65 + noise(x, z, 1.4, seed + 3) * 0.35) +
      k * ripple * (noise(x, z, 0.5, seed + 4) * 0.6 + noise(x, z, 0.27, seed + 5) * 0.4);
    // (a bend's inside down: the tighter, the more, the more so the nearer its inside edge)
    let down = 0;
    if (camber && r.k !== 0 && Math.sign(o) === Math.sign(r.k)) {
      const share = Math.min(1, Math.abs(o) / Math.max(w, 0.5));
      down = camber * Math.min(1, Math.abs(r.k) * TIGHT) * share ** 1.3;
    }
    return mask * (n - down);
  };
}
