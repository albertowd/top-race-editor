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
  // (the triangles grass grows on or that keep it off: their corners, uvs, which, their photo)
  const T: number[] = [];
  const UV: number[] = [];
  const isGrass: boolean[] = [];
  const pic: (Picture | undefined)[] = [];
  for (const meshes of models)
    for (const m of meshes) {
      const mat = (m.material ? lib[m.material] : undefined) ?? {};
      if (!(m.grass || mat.covers_grass) || !m.visible) continue;
      const p = m.grass && mat.colour ? photo(mat.colour) : undefined;
      for (let f = 0; f < m.f.length; f += 3) {
        const c = [m.f[f] as number, m.f[f + 1] as number, m.f[f + 2] as number];
        if (c[0] === c[1] || c[1] === c[2] || c[0] === c[2]) continue;
        for (const k of c) {
          T.push(m.v[k * CORNER] as number, m.v[k * CORNER + 1] as number, m.v[k * CORNER + 2] as number);
          UV.push(m.v[k * CORNER + 6] as number, m.v[k * CORNER + 7] as number);
        }
        isGrass.push(m.grass);
        pic.push(p);
      }
    }
  if (!isGrass.some(Boolean) || !line.length) return [];
  const nt = isGrass.length;
  // (the triangles by 4 m cells)
  const CELL = 4;
  const grid = new Map<string, number[]>();
  for (let t = 0; t < nt; t++) {
    const xs = [T[t * 9] as number, T[t * 9 + 3] as number, T[t * 9 + 6] as number];
    const zs = [T[t * 9 + 2] as number, T[t * 9 + 5] as number, T[t * 9 + 8] as number];
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++)
      for (let gz = Math.floor(Math.min(...zs) / CELL); gz <= Math.floor(Math.max(...zs) / CELL); gz++) {
        const key = `${gx},${gz}`;
        const l = grid.get(key);
        if (l) l.push(t);
        else grid.set(key, [t]);
      }
  }
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
  const xs = line.map((p) => p[0]);
  const zs = line.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs) - BAND, Math.max(...xs) + BAND];
  const [z0, z1] = [Math.min(...zs) - BAND, Math.max(...zs) + BAND];
  const r = seeded(SEED);
  const out: [number, number, number][] = [];
  for (let gz = z0; gz < z1; gz += STEP)
    for (let gx = x0; gx < x1; gx += STEP) {
      const x = gx + uniform(r, -STEP / 2, STEP / 2);
      const z = gz + uniform(r, -STEP / 2, STEP / 2);
      if (!nearLine(x, z)) continue;
      const ks = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
      if (!ks) continue;
      // (each triangle over it: its height there, its weights)
      const hits: { t: number; y: number; l: [number, number, number] }[] = [];
      for (const t of ks) {
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
      const top = hits.reduce((a, b) => (b.y > a.y ? b : a));
      if (!isGrass[top.t] || !pic[top.t]) continue;
      // (anything that keeps grass off lying over it, even a little below the grass's top)
      if (hits.some((h) => !isGrass[h.t] && h.y > top.y - 0.05)) continue;
      const u = top.l.reduce((a, l, c) => a + l * (UV[top.t * 6 + c * 2] as number), 0);
      const v = top.l.reduce((a, l, c) => a + l * (UV[top.t * 6 + c * 2 + 1] as number), 0);
      const img = pic[top.t] as Picture;
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
