// The place: the ground a track lies on, the first layer, made once and read by position after. The track's
// terrain.py ported: its terrain.json's heights, filtered of trees and buildings (filterPoints), filled onto its grid
// (fill), with its edits on them in order (ground). The arithmetic is the Python's, so the ground comes out the same.
//
// Paths in the description are from the project's root; the edits' files from the terrain's own folder.
import { bytesOf, own, sha1, Writer } from './bin';
import { type Grid, gaussianFilter, greyOpening, grid, Sampler, uniformFilter } from './ndimage';
import { readNpz } from './npz';
import { byCodePoint } from './order';
import { type Grey, resizeBox } from './pictures';
import { distance, inside, type Ring, within } from './polygon';
import { type Box, TileIndex } from './tiles';

export interface Area2 {
  area_x_z: [[number, number], [number, number]];
}

export interface Filters {
  picture_trees: { lum: number; sd: number };
  photo_trees: { lum: number; sd: number };
  tree_near_m: number;
  tree_share: number;
  over_m: number;
  opening_m: number;
  wide_over_m: number;
  wide_opening_m: number;
  fills_m: number[];
  enough_a_cell: number;
  areas?: { kind: 'ground' | 'not_ground'; ring: number[][] }[];
}

export type Edit = { off?: boolean; file?: string } & (
  | { type: 'raster'; file: string }
  | { type: 'offset'; ring: number[][]; by: number; ease_m?: number }
  | {
      type: 'flat';
      ring: number[][];
      ease_m?: number;
      height?: number;
      at?: [number, number];
      plus?: number;
      slope?: [number, number];
    }
  | { type: 'smooth'; ring: number[][]; sigma_m: number; ease_m?: number }
);

export interface TerrainDoc {
  place: { location: string };
  image: Area2 & { file: string; metres_a_pixel: number };
  photo?: { file: string; size_m: number } | null;
  heights: { files: string[]; offset_m: number };
  buildings?: { files: string[]; buffer_m?: number };
  grid: Area2 & { cell_m: number };
  filters: Filters;
  edits?: Edit[];
}

/** Why a height is not the ground (0: it is). */
export const WHY = {
  0: 'ground',
  1: 'trees in the picture',
  2: 'trees in the photo',
  3: 'a building',
  4: 'over the ground round it',
  5: 'over the wide ground round it',
  6: 'an area drawn as not ground',
} as const;

/** metres, the grid a smooth edit is worked out on */
export const SMOOTH_CELL = 0.5;
/** metres a pixel of the ground's picture (ground.png), and of the ground the editor shows */
export const GROUND_CELL = 2;
/** terrain.py's VERSION: its sums' (in what the ground hangs on, its fingerprint) */
export const TERRAIN_VERSION = 1;

/** What the place is made from where the engine runs: the project's files, and its pictures as grey (decoded). */
export interface PlaceSource {
  /** a file's bytes, by its path from the project's root (or absolute) */
  read(path: string): Promise<Uint8Array>;
  /** the paths matching a pattern from the project's root (* in its last part), sorted */
  glob(pattern: string): Promise<string[]>;
  /** a picture as grey (Pillow's convert('L')) */
  grey(path: string): Promise<Grey>;
  /** the terrain's own folder (its edits' files are in it), from the project's root */
  folder: string;
}

const json = async (src: PlaceSource, path: string) => JSON.parse(new TextDecoder().decode(await src.read(path)));

// ---- numpy's ways --------------------------------------------------------------------------------------------

/** np.arange(start, stop, step) */
export function arange(start: number, stop: number, step: number): Float64Array {
  const n = Math.max(Math.ceil((stop - start) / step), 0);
  return Float64Array.from({ length: n }, (_, i) => start + i * step);
}

/** np.round: halves to the even. */
export function roundEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function median(a: ArrayLike<number>): number {
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const smoothstep = (t: number) => {
  const u = Math.min(Math.max(t, 0), 1);
  return u * u * (3 - 2 * u);
};

// ---- the heights and their filters -----------------------------------------------------------------------------

export interface Points {
  x: Float64Array;
  z: Float64Array;
  h: Float64Array;
}

/** Every height: x, z, the track's y. */
export async function points(doc: TerrainDoc, src: PlaceSource): Promise<Points> {
  const rows: number[][] = [];
  for (const pattern of doc.heights.files)
    for (const f of await src.glob(pattern)) rows.push(...((await json(src, f)).rows as number[][]));
  return {
    x: Float64Array.from(rows, (r) => r[0] as number),
    z: Float64Array.from(rows, (r) => r[1] as number),
    h: Float64Array.from(rows, (r) => (r[4] as number) - doc.heights.offset_m),
  };
}

/** The ground's grid: its x and z, and its cell. */
export function gridOf(doc: TerrainDoc): { X: Float64Array; Z: Float64Array; c: number } {
  const [[xa, xb], [za, zb]] = doc.grid.area_x_z;
  const c = doc.grid.cell_m;
  return { X: arange(xa, xb + c * 0.01, c), Z: arange(za, zb + c * 0.01, c), c };
}

/** The share of trees round each pixel of a picture (a metre a pixel): darker than lumMax and more uneven over 9 m
 * than sdMax, both or either, within near metres. */
export function treeShare(lum: Grey, both: boolean, lumMax: number, sdMax: number, near: number): Grid {
  const L = grid(lum.rows, lum.cols, lum.data);
  const L2 = grid(
    lum.rows,
    lum.cols,
    Float64Array.from(lum.data, (v) => v * v),
  );
  const mean = uniformFilter(L, 9);
  const sq = uniformFilter(L2, 9);
  const tree = grid(lum.rows, lum.cols);
  for (let i = 0; i < tree.data.length; i++) {
    const m = mean.data[i] as number;
    const spread = Math.sqrt(Math.max((sq.data[i] as number) - m * m, 0));
    const dark = m < lumMax;
    const rough = spread > sdMax;
    tree.data[i] = (both ? rough && dark : rough || dark) ? 1 : 0;
  }
  return uniformFilter(tree, Math.trunc(2 * near) + 1);
}

/** The buildings (OpenStreetMap's ways with a building tag) as rings in the track's x and z. */
export async function buildings(doc: TerrainDoc, src: PlaceSource): Promise<number[][][]> {
  const loc = await json(src, doc.place.location);
  const [lat0, lon0] = (loc.geotag ?? [0, 0]) as [number, number];
  const EARTH = 6378137;
  const c = Math.cos(loc.theta);
  const s = Math.sin(loc.theta);
  const out: number[][][] = [];
  for (const pattern of doc.buildings?.files ?? [])
    for (const f of await src.glob(pattern))
      for (const e of (await json(src, f)).elements as {
        type: string;
        tags?: Record<string, string>;
        geometry?: { lat: number; lon: number }[];
      }[])
        if (e.type === 'way' && e.tags && 'building' in e.tags && e.geometry)
          out.push(
            e.geometry.map(({ lat, lon }) => {
              // (metres east and north of the geotag, then the track's x and z by the fit)
              const east = (((lon - lon0) * Math.PI) / 180) * EARTH * Math.cos((lat0 * Math.PI) / 180) - loc.east;
              const north = (((lat - lat0) * Math.PI) / 180) * EARTH - loc.north;
              return [-(c * east + s * north), -s * east + c * north];
            }),
          );
  return out;
}

/** Heights splatted onto the grid: each cell's sum, and how many. */
function splat(X: Float64Array, Z: Float64Array, c: number, P: Points) {
  const rows = Z.length;
  const cols = X.length;
  const A = grid(rows, cols);
  const W = grid(rows, cols);
  for (let k = 0; k < P.x.length; k++) {
    const i = roundEven(((P.z[k] as number) - (Z[0] as number)) / c);
    const j = roundEven(((P.x[k] as number) - (X[0] as number)) / c);
    if (i >= 0 && i < rows && j >= 0 && j < cols) {
      A.data[i * cols + j] = (A.data[i * cols + j] as number) + (P.h[k] as number);
      W.data[i * cols + j] = (W.data[i * cols + j] as number) + 1;
    }
  }
  return { A, W };
}

const divide = (a: Grid, b: Grid, floor: number) =>
  grid(
    a.rows,
    a.cols,
    Float64Array.from(a.data, (v, i) => v / Math.max(b.data[i] as number, floor)),
  );

/**
 * Why each height is not the ground (WHY, 0 where it is): the trees in the picture (darker and more uneven than its
 * rule, both), in the photo (darker or more uneven than its), on more than tree_share of the ground within
 * tree_near metres; within a building's buffer; more than over_m over the heights' opening (their lowest round, over
 * opening_m) or wide_over_m over a wide one; then the areas drawn, which say ground or not whatever those find.
 */
export async function filterPoints(doc: TerrainDoc, P: Points, src: PlaceSource): Promise<Uint8Array> {
  const f = doc.filters;
  const n = P.x.length;
  const why = new Uint8Array(n);
  const mark = (code: number, sel: (k: number) => boolean) => {
    for (let k = 0; k < n; k++) if (!why[k] && sel(k)) why[k] = code;
  };
  const near = f.tree_near_m;
  const im = doc.image;
  const [[, xb], [, zb]] = im.area_x_z;
  const px = im.metres_a_pixel;
  const sat = treeShare(await src.grey(im.file), true, f.picture_trees.lum, f.picture_trees.sd, near);
  mark(1, (k) => {
    const col = Math.trunc((xb - (P.x[k] as number)) / px);
    const row = Math.trunc((zb - (P.z[k] as number)) / px);
    const ok = col >= 0 && col < sat.cols && row >= 0 && row < sat.rows;
    return (ok ? (sat.data[row * sat.cols + col] as number) : 1) >= f.tree_share;
  });
  const ph = doc.photo;
  if (ph) {
    const m = Math.trunc(ph.size_m);
    const photo = treeShare(resizeBox(await src.grey(ph.file), m, m), false, f.photo_trees.lum, f.photo_trees.sd, near);
    const hs = ph.size_m / 2;
    mark(2, (k) => {
      const x = P.x[k] as number;
      const z = P.z[k] as number;
      if (!(Math.abs(x) < hs && Math.abs(z) < hs)) return false;
      const r = Math.min(Math.max(Math.trunc(hs - z), 0), photo.rows - 1);
      const c = Math.min(Math.max(Math.trunc(hs - x), 0), photo.cols - 1);
      return (photo.data[r * photo.cols + c] as number) >= f.tree_share;
    });
  }
  const buffer = doc.buildings?.buffer_m ?? 10;
  for (const ring of await buildings(doc, src))
    mark(3, (k) => within(ring, P.x[k] as number, P.z[k] as number, buffer));
  const { X, Z, c } = gridOf(doc);
  const { A, W } = splat(X, Z, c, P);
  const tops = divide(gaussianFilter(A, 1), gaussianFilter(W, 1), 1e-9);
  const at = (G: Grid) => {
    const s = new Sampler(G, 1, 'constant');
    return (k: number) =>
      s.at(((P.z[k] as number) - (Z[0] as number)) / c, ((P.x[k] as number) - (X[0] as number)) / c);
  };
  const open = at(gaussianFilter(greyOpening(tops, Math.trunc(f.opening_m / c) | 1), 1));
  mark(4, (k) => (P.h[k] as number) - open(k) >= f.over_m);
  const wide = at(gaussianFilter(greyOpening(tops, Math.trunc(f.wide_opening_m / c) | 1), 2));
  mark(5, (k) => (P.h[k] as number) - wide(k) >= f.wide_over_m);
  for (const a of f.areas ?? [])
    for (let k = 0; k < n; k++)
      if (inside(a.ring as Ring, P.x[k] as number, P.z[k] as number)) {
        if (a.kind === 'ground') why[k] = 0;
        else if (!why[k]) why[k] = 6;
      }
  return why;
}

/** The heights given on the grid: where there are points enough, theirs smoothed over the finest of the fills that
 * has enough, the coarser filling in between them. */
export function fill(doc: TerrainDoc, P: Points): Grid {
  const { X, Z, c } = gridOf(doc);
  const { A, W } = splat(X, Z, c, P);
  const G = grid(A.rows, A.cols).data.fill(median(P.h));
  const enough = doc.filters.enough_a_cell;
  for (const s of [...doc.filters.fills_m].reverse()) {
    const a = gaussianFilter(A, s / c).data;
    const w = gaussianFilter(W, s / c).data;
    for (let i = 0; i < G.length; i++) {
      const t = Math.min(Math.max((w[i] as number) / enough, 0), 1);
      G[i] =
        (G[i] as number) + t * t * (3 - 2 * t) * ((a[i] as number) / Math.max(w[i] as number, 1e-9) - (G[i] as number));
    }
  }
  return grid(A.rows, A.cols, G);
}

export interface Layers {
  points: Points;
  why: Uint8Array;
  original: Grid;
  filtered: Grid;
}

/** The terrain worked out: every height and why it is not the ground, and the grids from all and from the ground's. */
export async function layers(doc: TerrainDoc, src: PlaceSource): Promise<Layers> {
  const P = await points(doc, src);
  const why = await filterPoints(doc, P, src);
  const keep = (a: Float64Array) => a.filter((_, k) => !why[k]);
  return {
    points: P,
    why,
    original: fill(doc, P),
    filtered: fill(doc, { x: keep(P.x), z: keep(P.z), h: keep(P.h) }),
  };
}

// ---- the ground ------------------------------------------------------------------------------------------------

/** A height at (x, z). */
export type Height = (x: number, z: number) => number;

/** A grid on the terrain's grid as a height: cubic between its points (order 3), or linear. */
export function sampler(G: Grid, doc: TerrainDoc, order: 1 | 3 = 3): Height {
  const { X, Z, c } = gridOf(doc);
  const s = new Sampler(G, order, 'nearest');
  return (x, z) => s.at((z - (Z[0] as number)) / c, (x - (X[0] as number)) / c);
}

/** 1 inside the ring, easing to 0 over ease metres out of it. */
function weight(ring: number[][], ease: number, x: number, z: number): number {
  const d = distance(ring as Ring, x, z);
  return ease > 0 ? 1 - smoothstep(d / ease) : d <= 0 ? 1 : 0;
}

/** A raster edit's values: metres added on a grid from x0, z0 (rows along z), cell metres a side. */
export interface Raster {
  x0: number;
  z0: number;
  cell: number;
  d: Grid;
}

/** A raster read linearly, 0 off it, and the box it covers. */
function onRaster(R: Raster): { at: Height; box: Box } {
  const s = new Sampler(R.d, 1, 'constant', 0);
  return {
    at: (x, z) => s.at((z - R.z0) / R.cell, (x - R.x0) / R.cell),
    box: { x0: R.x0, z0: R.z0, x1: R.x0 + (R.d.cols - 1) * R.cell, z1: R.z0 + (R.d.rows - 1) * R.cell },
  };
}

/** An edit as a step on the ground: the height after it from the height before, at (x, z); and the box it changes
 * the ground in (past it, the step leaves the height as it is, exactly: its weight or its raster there is 0). */
export interface Step {
  box: Box;
  apply(y: number, x: number, z: number): number;
}

/** The box round a ring, eased metres out. */
function ringBox(ring: number[][], ease: number): Box {
  const xs = ring.map((p) => p[0] as number);
  const zs = ring.map((p) => p[1] as number);
  return {
    x0: Math.min(...xs) - ease,
    z0: Math.min(...zs) - ease,
    x1: Math.max(...xs) + ease,
    z1: Math.max(...zs) + ease,
  };
}

/** One edit as a step, on the ground the steps before it make (before: that ground's height, for the edits that read
 * it as they are made: a flat at a point, a smooth); a raster edit's values given (not saved yet), or from its file. */
export async function step(e: Edit, before: Height, src: PlaceSource, given?: Raster): Promise<Step> {
  if (e.type === 'raster' && given) {
    const on = onRaster(given);
    return { box: on.box, apply: (y, x, z) => y + on.at(x, z) };
  }
  if (e.type === 'raster') {
    const d = await readNpz(await src.read(`${src.folder}/${e.file}`));
    const D = d.d;
    if (!D) throw new Error(`${e.file}: no d`);
    const on = onRaster({
      x0: d.x0?.data[0] as number,
      z0: d.z0?.data[0] as number,
      cell: d.cell?.data[0] as number,
      d: grid(D.shape[0] as number, D.shape[1] as number, D.data),
    });
    return { box: on.box, apply: (y, x, z) => y + on.at(x, z) };
  }
  const ease = e.ease_m ?? 0;
  if (e.type === 'offset')
    return { box: ringBox(e.ring, ease), apply: (y, x, z) => y + e.by * weight(e.ring, ease, x, z) };
  if (e.type === 'flat') {
    const a = e.at ?? [0, 0];
    const h0 = e.at ? before(a[0], a[1]) + (e.plus ?? 0) : (e.height ?? 0);
    const [gx, gz] = e.slope ?? [0, 0];
    return {
      box: ringBox(e.ring, ease),
      apply: (y, x, z) => y + (h0 + gx * (x - a[0]) + gz * (z - a[1]) - y) * weight(e.ring, ease, x, z),
    };
  }
  if (e.type === 'smooth') {
    const s = e.sigma_m;
    const xs = e.ring.map((p) => p[0] as number);
    const zs = e.ring.map((p) => p[1] as number);
    const X = arange(Math.min(...xs) - ease - 3 * s, Math.max(...xs) + ease + 3 * s + SMOOTH_CELL, SMOOTH_CELL);
    const Z = arange(Math.min(...zs) - ease - 3 * s, Math.max(...zs) + ease + 3 * s + SMOOTH_CELL, SMOOTH_CELL);
    const Y = grid(Z.length, X.length);
    for (let i = 0; i < Z.length; i++)
      for (let j = 0; j < X.length; j++) Y.data[i * X.length + j] = before(X[j] as number, Z[i] as number);
    const B = gaussianFilter(Y, s / SMOOTH_CELL, 'nearest');
    const D = grid(Y.rows, Y.cols);
    for (let i = 0; i < Z.length; i++)
      for (let j = 0; j < X.length; j++) {
        const k = i * X.length + j;
        D.data[k] =
          ((B.data[k] as number) - (Y.data[k] as number)) * weight(e.ring, ease, X[j] as number, Z[i] as number);
      }
    const on = onRaster({ x0: X[0] as number, z0: Z[0] as number, cell: SMOOTH_CELL, d: D });
    return { box: on.box, apply: (y, x, z) => y + on.at(x, z) };
  }
  throw new Error(`an edit of no type known: ${JSON.stringify((e as { type: unknown }).type)}`);
}

/**
 * The ground: the filtered heights (cubic between their points, or linear) with every edit on them, in order. Read
 * by position: a point's tile gives the few edits whose boxes it lies in, and only those are worked out there (the
 * others leave its height as it is), so a ground of many edits reads as fast as one of few, and the same.
 */
export class Ground {
  private readonly index = new TileIndex<number>();

  constructor(
    readonly base: Height,
    readonly steps: Step[],
    /** false: every step at every point (as the Python does; to check the index changes nothing) */
    readonly indexed = true,
  ) {
    steps.forEach((s, i) => {
      this.index.add(s.box, i);
    });
  }

  y = (x: number, z: number): number => {
    let y = this.base(x, z);
    if (!this.indexed) {
      for (const s of this.steps) y = s.apply(y, x, z);
      return y;
    }
    const near = this.index.find({ x0: x, z0: z, x1: x, z1: z });
    if (near.length > 1) near.sort((a, b) => a - b);
    for (const i of near) y = (this.steps[i] as Step).apply(y, x, z);
    return y;
  };

  /** y() for points (x, z pairs). */
  ys(P: ArrayLike<number>): Float64Array {
    const out = new Float64Array(P.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = this.y(P[i * 2] as number, P[i * 2 + 1] as number);
    return out;
  }
}

/** The ground of a terrain, from its layers (rasters: raster edits' values not saved yet, by their files). */
export async function ground(
  doc: TerrainDoc,
  L: Layers,
  src: PlaceSource,
  order: 1 | 3 = 3,
  indexed = true,
  rasters?: Map<string, Raster>,
): Promise<Ground> {
  const base = sampler(L.filtered, doc, order);
  const steps: Step[] = [];
  for (const e of doc.edits ?? [])
    if (!e.off)
      steps.push(
        await step(e, new Ground(base, [...steps], indexed).y, src, e.file ? rasters?.get(e.file) : undefined),
      );
  return new Ground(base, steps, indexed);
}

// ---- kept between builds -----------------------------------------------------------------------------------------

/** One more when a change here changes the place it makes (what it keeps is then made again). */
export const PLACE_VERSION = 1;

/** Where the place is kept between builds, by its key. */
export interface PlaceCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

/** JSON with its keys in order, so the same description is the same text. */
function sortedJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort(byCodePoint)
      .map((k) => `${JSON.stringify(k)}:${sortedJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** What the place hangs on: its description, the files it reads (by name and size; its edits' files by their
 * bytes) and PLACE_VERSION. */
export async function placeKey(doc: TerrainDoc, src: PlaceSource & { size(path: string): Promise<number> }) {
  const parts = [sortedJson(doc), `place ${PLACE_VERSION}`];
  const files: string[] = [doc.place.location, doc.image.file, ...(doc.photo ? [doc.photo.file] : [])];
  for (const p of [...doc.heights.files, ...(doc.buildings?.files ?? [])]) files.push(...(await src.glob(p)));
  for (const f of files) parts.push(`${f} ${await src.size(f).catch(() => -1)}`);
  const chunks: Uint8Array[] = [new TextEncoder().encode(parts.join('\n'))];
  for (const e of doc.edits ?? []) if (e.file) chunks.push(await src.read(`${src.folder}/${e.file}`));
  return sha1(...chunks).slice(0, 16);
}

const MAGIC = 'TRPL';

/** The layers as bytes, to keep. */
export function packLayers(L: Layers): Uint8Array {
  const head = new TextEncoder().encode(
    JSON.stringify({ version: PLACE_VERSION, points: L.points.x.length, rows: L.filtered.rows, cols: L.filtered.cols }),
  );
  const pad = (n: number) => (8 - (n % 8)) % 8;
  const w = new Writer().bytes(new TextEncoder().encode(MAGIC)).u32(head.length).bytes(head);
  w.bytes(new Uint8Array(pad(w.length)));
  for (const a of [L.points.x, L.points.z, L.points.h, L.original.data, L.filtered.data]) w.bytes(bytesOf(a));
  w.bytes(L.why);
  return w.done();
}

/** Layers kept, or null if they are not this version's. */
export function unpackLayers(b: Uint8Array): Layers | null {
  if (new TextDecoder().decode(b.subarray(0, 4)) !== MAGIC) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + n))) as {
    version: number;
    points: number;
    rows: number;
    cols: number;
  };
  if (head.version !== PLACE_VERSION) return null;
  let at = 8 + n + ((8 - ((8 + n) % 8)) % 8);
  const f64 = (count: number) => {
    const out = new Float64Array(own(b.subarray(at, at + count * 8)).buffer);
    at += count * 8;
    return out;
  };
  const x = f64(head.points);
  const z = f64(head.points);
  const h = f64(head.points);
  const original = grid(head.rows, head.cols, f64(head.rows * head.cols));
  const filtered = grid(head.rows, head.cols, f64(head.rows * head.cols));
  const why = b.slice(at, at + head.points);
  return { points: { x, z, h }, why, original, filtered };
}

/** A terrain's place: its layers (kept between builds, by their key) and its ground. */
export interface Place {
  key: string;
  layers: Layers;
  ground: Ground;
  /** whether its layers were kept from before */
  kept: boolean;
}

export async function makePlace(
  doc: TerrainDoc,
  src: PlaceSource & { size(path: string): Promise<number> },
  cache?: PlaceCache,
): Promise<Place> {
  const key = await placeKey(doc, src);
  const had = cache ? await cache.get(key) : null;
  const kept = had ? unpackLayers(had) : null;
  const L = kept ?? (await layers(doc, src));
  if (!kept && cache) await cache.put(key, packLayers(L));
  return { key, layers: L, ground: await ground(doc, L, src), kept: !!kept };
}
