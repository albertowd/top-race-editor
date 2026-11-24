// Grass for the BeamNG.drive level (the track's beamng_grass.py): clumps of blades standing on the ground where grass
// grows, as BeamNG has no grass of its own on meshes.
//
// Where: on the meshes grass grows on (extras.track grass), where no mesh of a material that keeps it off
// (materials.json covers_grass: roads, kerbs, tyres, buildings) lies over them, and where the ground photo is green,
// as Assetto Corsa's colour mask keeps its grass off what is not; within BAND metres of the layouts' racing lines, as
// further out it would only cost frames. Each clump is two crossed quads with a texture of blades made here, a little
// turned, sized and tilted at random (seeded: the same each build); the clumps are cut in tiles of TILE metres, a
// shape each, so BeamNG draws only those in view.
import type { Picture } from '../dds';
import type { DaeMesh } from './dae';
import { writePng } from './images';
import { CORNER, type TrackMesh } from './trackmodel';

export const BAND = 18;
export const STEP = 0.6;
export const TILE = 64;
export const HEIGHT: [number, number] = [0.18, 0.34];
export const WIDTH = 0.55;
export const GREEN = 0.015;
const SEED = 7;

/** A seeded random stream (mulberry32): uniform in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniform = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();
const normal = (r: () => number, mu: number, sd: number) =>
  mu + sd * Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());

/** A convex polygon filled into an RGBA picture (w by h), its pixels' centres inside it. */
function fill(px: Uint8Array, w: number, h: number, poly: [number, number][], col: [number, number, number, number]) {
  const ys = poly.map((p) => p[1]);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length] as [number, number];
      if ((a[1] <= cy && b[1] > cy) || (b[1] <= cy && a[1] > cy))
        xs.push(a[0] + ((cy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    });
    if (xs.length < 2) continue;
    const x0 = Math.max(0, Math.ceil(Math.min(...xs) - 0.5));
    const x1 = Math.min(w - 1, Math.floor(Math.max(...xs) - 0.5));
    for (let x = x0; x <= x1; x++) px.set(col, (y * w + x) * 4);
  }
}

/** The blades: a clump of thin tapered blades in the photo's grass greens, clear round them (what shows through the
 * blades' own colour at its edges, not black); and what shows of it, a grey map. */
export async function bladesTexture(): Promise<{ png: Uint8Array; opacity: Uint8Array }> {
  const r = seeded(SEED);
  const w = 256;
  const h = 256;
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([70, 90, 45, 0], i * 4);
  for (let k = 0; k < 70; k++) {
    const x = uniform(r, 0.1, 0.9) * w;
    const top = uniform(r, 0, 0.45) * h;
    const lean = normal(r, 0, 0.12) * w;
    const half = uniform(r, 1.5, 3.5);
    const g = uniform(r, 0.75, 1.15);
    const col = [72, 98, 44].map((c) => Math.min(255, Math.floor(c * g))) as [number, number, number];
    fill(
      px,
      w,
      h,
      [
        [x - half, h],
        [x + half, h],
        [x + lean + 0.4, top],
        [x + lean - 0.4, top],
      ],
      [...col, 255],
    );
  }
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3] as number;
  return { png: await writePng(px, w, h, 4), opacity: await writePng(alpha, w, h, 1) };
}

/** Where clumps stand, in the track's axes ([x, y, z] each): on grass meshes of the models (lib: the library's
 * materials; photo: a material's colour texture, the ground's photo), within BAND of the line's points ([x, z]). */
export function grassPlaces(
  models: TrackMesh[][],
  lib: Record<string, { colour?: string; covers_grass?: boolean }>,
  photo: (texture: string) => Picture | undefined,
  line: [number, number][],
): [number, number, number][] {
  // (none grows anywhere, or no line to grow along: nothing looked at, as a track's millions of triangles would be)
  if (!line.length) return [];
  const meshes = models
    .flat()
    .filter((m) => m.visible && (m.grass || (m.material ? lib[m.material]?.covers_grass : false)));
  if (!meshes.some((m) => m.grass)) return [];
  // (where the clumps can be: within BAND of the line's points)
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of line) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]);
    z1 = Math.max(z1, p[1]);
  }
  [x0, x1, z0, z1] = [x0 - BAND, x1 + BAND, z0 - BAND, z1 + BAND];
  // (the triangles grass grows on or that keep it off, reaching in there: which mesh and face each, read from the mesh
  // itself, not copied)
  const pics = meshes.map((m) => {
    const colour = m.material ? lib[m.material]?.colour : undefined;
    return m.grass && colour ? photo(colour) : undefined;
  });
  const reaches = (m: TrackMesh, f: number) => {
    const a = m.f[f] as number;
    const b = m.f[f + 1] as number;
    const c = m.f[f + 2] as number;
    if (a === b || b === c || a === c) return false;
    const ax = m.v[a * CORNER] as number;
    const bx = m.v[b * CORNER] as number;
    const cx = m.v[c * CORNER] as number;
    const az = m.v[a * CORNER + 2] as number;
    const bz = m.v[b * CORNER + 2] as number;
    const cz = m.v[c * CORNER + 2] as number;
    return (
      Math.max(ax, bx, cx) >= x0 &&
      Math.min(ax, bx, cx) <= x1 &&
      Math.max(az, bz, cz) >= z0 &&
      Math.min(az, bz, cz) <= z1
    );
  };
  let nt = 0;
  for (const m of meshes) for (let f = 0; f < m.f.length; f += 3) if (reaches(m, f)) nt++;
  const triMesh = new Int32Array(nt);
  const triFace = new Int32Array(nt);
  nt = 0;
  meshes.forEach((m, mi) => {
    for (let f = 0; f < m.f.length; f += 3)
      if (reaches(m, f)) {
        triMesh[nt] = mi;
        triFace[nt++] = f;
      }
  });
  /** a triangle's corner's number (0 1 2: x y z; 6 7: u v) */
  const corner = (t: number, c: number, i: number) => {
    const m = meshes[triMesh[t] as number] as TrackMesh;
    return m.v[(m.f[(triFace[t] as number) + c] as number) * CORNER + i] as number;
  };
  // (their corners, x y z each, as the meshes keep them: 32-bit, so none changed)
  const T = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++)
    for (let c = 0; c < 3; c++) for (let i = 0; i < 3; i++) T[t * 9 + c * 3 + i] = corner(t, c, i);
  // (the triangles by 4 m cells over there, a cell's in order: cellStart[k] to cellStart[k + 1] of cellTris)
  const CELL = 4;
  const gx0 = Math.floor(x0 / CELL);
  const gz0 = Math.floor(z0 / CELL);
  const ncx = Math.floor(x1 / CELL) - gx0 + 1;
  const ncz = Math.floor(z1 / CELL) - gz0 + 1;
  const cellsOf = (t: number, each: (k: number) => void) => {
    const [ax, bx, cx] = [T[t * 9] as number, T[t * 9 + 3] as number, T[t * 9 + 6] as number];
    const [az, bz, cz] = [T[t * 9 + 2] as number, T[t * 9 + 5] as number, T[t * 9 + 8] as number];
    const i0 = Math.max(Math.floor(Math.min(ax, bx, cx) / CELL) - gx0, 0);
    const i1 = Math.min(Math.floor(Math.max(ax, bx, cx) / CELL) - gx0, ncx - 1);
    const j0 = Math.max(Math.floor(Math.min(az, bz, cz) / CELL) - gz0, 0);
    const j1 = Math.min(Math.floor(Math.max(az, bz, cz) / CELL) - gz0, ncz - 1);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) each(j * ncx + i);
  };
  const cellStart = new Int32Array(ncx * ncz + 1);
  for (let t = 0; t < nt; t++)
    cellsOf(t, (k) => {
      cellStart[k + 1]++;
    });
  for (let k = 0; k < ncx * ncz; k++) cellStart[k + 1] += cellStart[k] as number;
  const cellTris = new Int32Array(cellStart[ncx * ncz] as number);
  const filled = cellStart.slice(0, ncx * ncz);
  for (let t = 0; t < nt; t++)
    cellsOf(t, (k) => {
      cellTris[filled[k]++] = t;
    });
  // (the line's points by BAND cells, to tell a point within BAND of it)
  const lineCells = new Map<string, [number, number][]>();
  for (let i = 0; i < line.length; i += 4) {
    const p = line[i] as [number, number];
    const key = `${Math.floor(p[0] / BAND)},${Math.floor(p[1] / BAND)}`;
    const l = lineCells.get(key);
    if (l) l.push(p);
    else lineCells.set(key, [p]);
  }
  const nearLine = (x: number, z: number) => {
    const cx = Math.floor(x / BAND);
    const cz = Math.floor(z / BAND);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cz - 1; j <= cz + 1; j++)
        for (const p of lineCells.get(`${i},${j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < BAND) return true;
    return false;
  };
  const grows = (t: number) => (meshes[triMesh[t] as number] as TrackMesh).grass;
  const r = seeded(SEED);
  const out: [number, number, number][] = [];
  for (let gz = z0; gz < z1; gz += STEP)
    for (let gx = x0; gx < x1; gx += STEP) {
      const x = gx + uniform(r, -STEP / 2, STEP / 2);
      const z = gz + uniform(r, -STEP / 2, STEP / 2);
      if (!nearLine(x, z)) continue;
      // (within BAND of the line: inside the cells)
      const i = Math.floor(x / CELL) - gx0;
      const j = Math.floor(z / CELL) - gz0;
      if (i < 0 || i >= ncx || j < 0 || j >= ncz) continue;
      const k = j * ncx + i;
      // (each triangle over it: its height there, its weights)
      const hits: { t: number; y: number; l: [number, number, number] }[] = [];
      for (let e = cellStart[k] as number; e < (cellStart[k + 1] as number); e++) {
        const t = cellTris[e] as number;
        const ax = T[t * 9] as number;
        const az = T[t * 9 + 2] as number;
        const bx = T[t * 9 + 3] as number;
        const bz = T[t * 9 + 5] as number;
        const cx = T[t * 9 + 6] as number;
        const cz = T[t * 9 + 8] as number;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) <= 1e-9) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const y = l1 * (T[t * 9 + 1] as number) + l2 * (T[t * 9 + 4] as number) + l3 * (T[t * 9 + 7] as number);
        hits.push({ t, y, l: [l1, l2, l3] });
      }
      if (!hits.length) continue;
      const top = hits.reduce((a, b) => (b.y > a.y ? b : a), hits[0] as (typeof hits)[number]);
      const img = pics[triMesh[top.t] as number];
      if (!grows(top.t) || !img) continue;
      // (anything that keeps grass off lying over it, even a little below the grass's top)
      if (hits.some((h) => !grows(h.t) && h.y > top.y - 0.05)) continue;
      const u = top.l.reduce((a, l, c) => a + l * corner(top.t, c, 6), 0);
      const v = top.l.reduce((a, l, c) => a + l * corner(top.t, c, 7), 0);
      const ch = img.mode === 'RGBA' ? 4 : 3;
      const py = Math.floor((((v % 1) + 1) % 1) * img.height) % img.height;
      const pxx = Math.floor((((u % 1) + 1) % 1) * img.width) % img.width;
      const at = (py * img.width + pxx) * ch;
      const [rr, gg, bb] = [img.data[at] as number, img.data[at + 1] as number, img.data[at + 2] as number].map(
        (c) => c / 255,
      ) as [number, number, number];
      if (gg - Math.max(rr, bb) < GREEN) continue;
      out.push([x, top.y, z]);
    }
  return out;
}

/** The clumps standing at at (the track's axes), by tile ('i_j'), as meshes in BeamNG's axes (toBeamng: a point's). */
export function grassClumps(
  at: [number, number, number][],
  toBeamng: (x: number, y: number, z: number) => [number, number, number],
): Map<string, DaeMesh> {
  const r = seeded(SEED + 1);
  const tiles = new Map<string, [number, number, number][]>();
  for (const p of at) {
    const key = `${Math.floor(p[0] / TILE)}_${Math.floor(p[2] / TILE)}`;
    const l = tiles.get(key);
    if (l) l.push(p);
    else tiles.set(key, [p]);
  }
  const out = new Map<string, DaeMesh>();
  for (const [key, ps] of tiles) {
    const P: number[] = [];
    const U: number[] = [];
    const F: number[] = [];
    for (const p of ps) {
      const h = uniform(r, HEIGHT[0], HEIGHT[1]);
      const w = WIDTH * uniform(r, 0.8, 1.2);
      const turn = uniform(r, 0, Math.PI);
      const tilt = [normal(r, 0, 0.06), normal(r, 0, 0.06)] as [number, number];
      for (let q = 0; q < 2; q++) {
        const a = turn + (q * Math.PI) / 2;
        const dx = (Math.cos(a) * w) / 2;
        const dz = (Math.sin(a) * w) / 2;
        // (a little into the ground, so no clump floats over a dip; its top leaning)
        const corners: [number, number, number][] = [
          [p[0] - dx, p[1] - 0.03, p[2] - dz],
          [p[0] + dx, p[1] - 0.03, p[2] + dz],
          [p[0] + dx + tilt[0] * h, p[1] + h, p[2] + dz + tilt[1] * h],
          [p[0] - dx + tilt[0] * h, p[1] + h, p[2] - dz + tilt[1] * h],
        ];
        const base = P.length / 3;
        for (const c of corners) P.push(...toBeamng(c[0], c[1], c[2]));
        // (u, v: Collada's v up the texture)
        U.push(0, 0, 1, 0, 1, 1, 0, 1);
        F.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    // (lit as the ground under them is, from above)
    const N = new Array<number>(P.length);
    for (let i = 0; i < P.length; i += 3) N.splice(i, 3, 0, 0, 1);
    out.set(key, { name: 'grass', material: 'velopark_grass', P, N, U, F });
  }
  return out;
}
