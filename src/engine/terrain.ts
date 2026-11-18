// The terrain as the page edits it (on the place of place.ts): its description checked, its layers worked out for a
// description not saved yet (the filters once for each set of rules, the edits each time), a raster edit's file, and
// the description saved: its rasters written, the one before kept, terrain.json and what the track tools'
// terrain.py's write makes of it (its pictures, heights.json, points.json).
//
// A description is checked into the form it is saved in: the numbers checked as floats (Python's float()), the rest
// as the page sent them (a browser's JSON: a whole number an integer), so the file is the Python's byte for byte.

import { sha1 } from './bin';
import { type Grid, grid } from './ndimage';
import { readNpz, writeNpz } from './npz';
import { png16 } from './pictures';
import {
  arange,
  GROUND_CELL,
  gridOf,
  ground as groundOf,
  type Layers,
  layers as layersOf,
  packLayers,
  placeKey,
  type Raster,
  roundEven,
  SMOOTH_CELL,
  sampler,
  TERRAIN_VERSION,
  type TerrainDoc,
  unpackLayers,
  WHY,
} from './place';
import { type HostFiles, type PlaceHost, placeCache, placeSource } from './placehost';
import { dumpPyJson, type PyJson, PyNumber, plain, pyFloat } from './pyjson';
import { readPart, writePart } from './trackdoc';
import { pyRound, settingsOf, stamp, writePyJsonFile } from './trackfiles';

/** the terrain's folder, from the project's root (terrain.py's TERRAIN) */
export const TERRAIN = 'tools/reference/terrain';
const EDIT_TYPES = ['raster', 'offset', 'flat', 'smooth'];
const AREA_KINDS = ['ground', 'not_ground'];
const RASTER_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.npz$/;
const TREE_RULES = ['picture_trees', 'photo_trees'];
const FILTER_NUMBERS = [
  'tree_near_m',
  'tree_share',
  'over_m',
  'opening_m',
  'wide_over_m',
  'wide_opening_m',
  'enough_a_cell',
];
/** the filters' work kept for this many sets of rules */
const MEMO = 3;
/** cells a raster's side, at most */
const MAX_RASTER = 4096;
/** pixels the picture of the ground round the track is sent at, at most (its longer side) */
export const IMAGE_SIDE = 4096;
/** JPEG's quality, the picture of the ground as it is sent */
export const IMAGE_QUALITY = 0.85;
/** a ring's points rounded to millimetres */
const DIGITS = 3;
const ABOUT =
  "16 bit heightmaps, north up and west on the left (a pixel's x falls left to right, its z top to bottom): a " +
  "pixel's value v is the track's y lo + v * (hi - lo) / 65535 metres; the first pixel (top left) at x_max, z_max";

/** A terrain's description that cannot be used: why. */
export class TerrainError extends Error {}

type J = { [k: string]: PyJson };

/** A number as Python's float() makes it: written as a float. */
const F = (x: number) => new PyNumber(x, pyFloat(x));

// ---- grids as the page has them ----------------------------------------------------------------------------------

/** Bytes in base64. */
export function base64Of(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Values written as base64 of little-endian 32-bit floats (the page's rasters and points). */
const f4 = (a: ArrayLike<number>) => base64Of(bytes(Float32Array.from(a)));

/** A grid of heights (rows along z from z0, columns along x from x0) as the page reads it: 16 bit, lo + v * (hi - lo)
 * / 65535 metres. */
export function gridOut(G: Grid, x0: number, z0: number, cell: number) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of G.data)
    if (!Number.isNaN(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  return { x0, z0, cell, nx: G.cols, nz: G.rows, lo, hi, data: base64Of(bytes(sixteen(G.data, lo, hi))) };
}

/** Heights as 16 bit over lo to hi (a missing one as lo). */
function sixteen(d: ArrayLike<number>, lo: number, hi: number): Uint16Array {
  const k = Math.max(hi - lo, 1e-9);
  const v = new Uint16Array(d.length);
  for (let i = 0; i < d.length; i++) {
    const x = d[i] as number;
    v[i] = roundEven((((Number.isNaN(x) ? lo : x) - lo) / k) * 65535);
  }
  return v;
}

/** An edit's raster (metres added) as the page edits it: 32-bit floats. */
const rasterOut = (R: Raster) => ({
  x0: R.x0,
  z0: R.z0,
  cell: R.cell,
  nx: R.d.cols,
  nz: R.d.rows,
  d: f4(R.d.data),
});

// ---- the description, checked ------------------------------------------------------------------------------------

const isDict = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PyNumber);
const bare = (v: unknown) => (v instanceof PyNumber ? v.value : v);
/** Python's truth of a value */
const truthy = (v: unknown) => {
  const x = bare(v);
  if (Array.isArray(x)) return x.length > 0;
  if (isDict(x)) return Object.keys(x).length > 0;
  return !!x;
};
/** Python's str() of a value as JSON brings it */
const pyStr = (v: unknown): string => {
  const x = bare(v);
  if (typeof x === 'boolean') return x ? 'True' : 'False';
  if (v instanceof PyNumber) return v.text;
  return String(x);
};
/** a value copied, its numbers as they were */
const copyOf = (v: unknown): PyJson => {
  if (Array.isArray(v)) return v.map(copyOf);
  if (isDict(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copyOf(x)]));
  return v as PyJson;
};

function num(v: unknown, what: string, low?: number, above?: number): number {
  const x = bare(v);
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new TerrainError(`${what}: a number, please`);
  if (low !== undefined && x < low) throw new TerrainError(`${what}: ${low} or more`);
  if (above !== undefined && x <= above) throw new TerrainError(`${what}: more than ${above}`);
  return x;
}

/** Base64 of little-endian 32-bit floats: count of them. */
function decodeF4(s: string, count: number): Float64Array {
  if (s.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new TerrainError('not base64');
  const t = atob(s);
  if (t.length % 4) throw new TerrainError('buffer size must be a multiple of element size');
  if (t.length / 4 !== count) throw new TerrainError(`${t.length / 4} values where ${count} were meant`);
  const b = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i);
  return Float64Array.from(new Float32Array(b.buffer));
}

/** A raster the page sent: x0, z0, cell and its values (nz rows of nx). */
function rasterIn(r: unknown, what: string): Raster {
  if (!isDict(r)) throw new TerrainError(`${what}: {x0, z0, cell, nx, nz, d}, please`);
  const x0 = num(r.x0, `${what}'s x0`);
  const z0 = num(r.z0, `${what}'s z0`);
  const cell = num(r.cell, `${what}'s cell`, undefined, 0);
  const [nx, nz] = [bare(r.nx), bare(r.nz)];
  if (![nx, nz].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_RASTER))
    throw new TerrainError(`${what}: 1 to ${MAX_RASTER} cells a side`);
  const d = decodeF4(String(r.d ?? ''), (nx as number) * (nz as number));
  if (!d.every(Number.isFinite)) throw new TerrainError(`${what}: its values all numbers, please`);
  return { x0, z0, cell, d: grid(nz as number, nx as number, d) };
}

function ring(v: unknown, what: string): PyJson[] {
  if (!Array.isArray(v) || v.length < 3) throw new TerrainError(`${what}: a ring of three points or more, please`);
  return v.map((p) => {
    if (!Array.isArray(p) || p.length !== 2) throw new TerrainError(`${what}: each point [x, z], please`);
    return [F(pyRound(num(p[0], what), DIGITS)), F(pyRound(num(p[1], what), DIGITS))];
  });
}

function pair(v: unknown, what: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new TerrainError(`${what}: [x, z], please`);
  return [num(v[0], what), num(v[1], what)];
}

function filtersIn(f: unknown): J {
  if (!isDict(f)) throw new TerrainError('the filters: an object, please');
  const out: J = copyOf(f) as J;
  for (const k of TREE_RULES) {
    const rule = f[k];
    if (!isDict(rule)) throw new TerrainError(`the filters' ${k}: {lum, sd}, please`);
    out[k] = { ...(copyOf(rule) as J), lum: F(num(rule.lum, `${k}.lum`, 0)), sd: F(num(rule.sd, `${k}.sd`, 0)) };
  }
  for (const k of FILTER_NUMBERS) out[k] = F(num(f[k], k, 0));
  const fills = f.fills_m;
  if (!Array.isArray(fills) || !fills.length) throw new TerrainError('fills_m: a list of distances, please');
  out.fills_m = fills.map((v) => F(num(v, 'fills_m', undefined, 0)));
  if ((bare(out.enough_a_cell) as number) <= 0) throw new TerrainError('enough_a_cell: more than 0');
  const areas = 'areas' in f ? f.areas : [];
  if (!Array.isArray(areas)) throw new TerrainError('the areas: a list, please');
  out.areas = areas.map((a, i) => {
    if (!isDict(a) || !AREA_KINDS.includes(bare(a.kind) as string))
      throw new TerrainError(`area ${i + 1}: its kind ground or not_ground, please`);
    return {
      ...(copyOf(a) as J),
      name: pyStr(truthy(a.name) ? a.name : `area ${i + 1}`),
      kind: a.kind as string,
      ring: ring(a.ring, `area ${i + 1}`),
    };
  });
  return out;
}

function editIn(e: unknown, i: number, rasters: Map<string, Raster>): J {
  const what = `edit ${i + 1}`;
  if (!isDict(e) || !EDIT_TYPES.includes(bare(e.type) as string))
    throw new TerrainError(`${what}: its type one of ${EDIT_TYPES.join(', ')}, please`);
  const out: J = Object.fromEntries(Object.entries(e).flatMap(([k, v]) => (k === 'data' ? [] : [[k, copyOf(v)]])));
  out.name = pyStr(truthy(e.name) ? e.name : `${e.type} ${i + 1}`);
  if ('off' in e) {
    if (typeof e.off !== 'boolean') throw new TerrainError(`${what}: off true or false, please`);
    if (!e.off) delete out.off;
  }
  const t = e.type;
  if (t === 'raster') {
    if (typeof e.file !== 'string' || !RASTER_FILE.test(e.file))
      throw new TerrainError(`${what}: its file a plain name ending .npz, please`);
    if ('data' in e) rasters.set(e.file, rasterIn(e.data, what));
    return out;
  }
  out.ring = ring(e.ring, what);
  out.ease_m = F(num('ease_m' in e ? e.ease_m : 0, `${what}'s ease_m`, 0));
  if (t === 'offset') out.by = F(num(e.by, `${what}'s by`));
  else if (t === 'flat') {
    if ('at' in e) {
      out.at = pair(e.at, `${what}'s at`).map(F);
      out.plus = F(num('plus' in e ? e.plus : 0, `${what}'s plus`));
      delete out.height;
    } else out.height = F(num(e.height, `${what}'s height`));
    if ('slope' in e) out.slope = pair(e.slope, `${what}'s slope`).map(F);
  } else out.sigma_m = F(num(e.sigma_m, `${what}'s sigma_m`, undefined, 0));
  return out;
}

/** A terrain's description checked (check): as it is saved (its rasters' data out of it), and the rasters that came
 * with data (not saved yet), by their files. */
export interface Checked {
  saved: J;
  doc: TerrainDoc;
  rasters: Map<string, Raster>;
}

/** A terrain's description as the page sent it (or as it was read), checked: its filters and edits (off: true, an
 * edit turned off); the rest as it is. */
export function checkTerrain(given: unknown): Checked {
  if (!isDict(given)) throw new TerrainError('a terrain: an object, please');
  for (const k of ['place', 'image', 'heights', 'grid'])
    if (!isDict(given[k])) throw new TerrainError(`a terrain has its ${k}`);
  const out: J = Object.fromEntries(
    Object.entries(given).flatMap(([k, v]) => (k === 'filters' || k === 'edits' ? [] : [[k, copyOf(v)]])),
  );
  const g = given.grid as Record<string, unknown>;
  const area = g.area_x_z;
  if (!Array.isArray(area) || area.length !== 2)
    throw new TerrainError("the grid's area_x_z: [[x_min, x_max], [z_min, z_max]], please");
  const [xa, xb] = pair(area[0], 'area_x_z');
  const [za, zb] = pair(area[1], 'area_x_z');
  if (xb <= xa || zb <= za) throw new TerrainError("the grid's area_x_z: each from less to more");
  out.grid = {
    ...(copyOf(g) as J),
    area_x_z: [
      [F(xa), F(xb)],
      [F(za), F(zb)],
    ],
    cell_m: F(num(g.cell_m, 'cell_m', undefined, 0)),
  };
  const h = given.heights as Record<string, unknown>;
  out.heights = { ...(copyOf(h) as J), offset_m: F(num('offset_m' in h ? h.offset_m : 0, 'offset_m')) };
  out.filters = filtersIn(given.filters);
  const edits = 'edits' in given ? given.edits : [];
  if (!Array.isArray(edits)) throw new TerrainError('the edits: a list, please');
  const rasters = new Map<string, Raster>();
  out.edits = edits.map((e, i) => editIn(e, i, rasters));
  const names = edits.filter((e) => isDict(e) && e.type === 'raster').map((e) => (e as { file: string }).file);
  if (new Set(names).size !== names.length) throw new TerrainError('two raster edits in one file');
  return { saved: out, doc: plain(out) as TerrainDoc, rasters };
}

// ---- the terrain -------------------------------------------------------------------------------------------------

const absolute = (p: string) => /^([A-Za-z]:)?[\\/]/.test(p);
const fromRoot = (project: string, p: string) => (absolute(p) ? p : `${project}/${p}`);

/** A picture's size from its header alone (a JPEG's frame, a PNG's IHDR): [width, height], null if neither. */
export function imageSize(b: Uint8Array): [number, number] | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return [dv.getUint32(16), dv.getUint32(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) {
        p++;
        continue;
      }
      const marker = b[p + 1] as number;
      // (a start of frame, any kind but the DHT, JPG and DAC markers among them)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return [dv.getUint16(p + 7), dv.getUint16(p + 5)];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        p += 2;
        continue;
      }
      p += 2 + dv.getUint16(p + 2);
    }
  }
  return null;
}

/** The terrain's description as saved (its numbers as written, in its own file's form: its edits' files named from
 * its folder), wherever the track keeps it (its track file, or terrain.json: trackdoc.ts); null where it has none. */
export async function savedTerrain(files: HostFiles, project: string): Promise<PyJson | null> {
  return readPart(files, await settingsOf(files, project), 'terrain');
}

async function savedOrNot(files: HostFiles, project: string): Promise<PyJson> {
  const doc = await savedTerrain(files, project);
  if (doc === null) throw new TerrainError(`no terrain yet (the track file's, or ${TERRAIN}/terrain.json)`);
  return doc;
}

/** The terrain as it is saved: {exists, doc, why (each code's meaning), ground_cell, smooth_cell, folder, image
 * ({area_x_z, metres_a_pixel, size})}; exists false (and why not) where the track has none. */
export async function terrainInfo(files: HostFiles, project: string) {
  const saved = await savedTerrain(files, project);
  if (saved === null) return { exists: false, reason: `no terrain yet (${TERRAIN}/terrain.json)` };
  const doc = saved as J;
  const im = doc.image as J;
  const file = fromRoot(project, String(plain(im.file)));
  const size = (await files.exists(file)) ? imageSize(await files.read(file)) : null;
  return {
    exists: true,
    doc,
    why: Object.fromEntries(Object.entries(WHY).map(([k, v]) => [String(k), v])),
    ground_cell: F(GROUND_CELL),
    smooth_cell: F(SMOOTH_CELL),
    folder: TERRAIN,
    image: { area_x_z: im.area_x_z, metres_a_pixel: im.metres_a_pixel, size },
  };
}

/** The picture of the ground round the track's file (its terrain's image), from the project's root. */
export async function terrainImage(files: HostFiles, project: string): Promise<string> {
  const doc = plain(await savedOrNot(files, project)) as TerrainDoc;
  return fromRoot(project, doc.image.file);
}

/** A raster edit's file, as the page edits it. */
export async function terrainRaster(files: HostFiles, project: string, file: string) {
  if (!RASTER_FILE.test(file)) throw new TerrainError('a raster: a plain name ending .npz, please');
  const at = `${project}/${TERRAIN}/${file}`;
  if (!(await files.exists(at))) throw new Error(`no such file: ${file}`);
  return rasterOut(await rasterFile(files, at));
}

async function rasterFile(files: HostFiles, at: string): Promise<Raster> {
  const d = await readNpz(await files.read(at));
  const D = d.d;
  if (!D) throw new Error(`${at}: no d`);
  return {
    x0: d.x0?.data[0] as number,
    z0: d.z0?.data[0] as number,
    cell: d.cell?.data[0] as number,
    d: grid(D.shape[0] as number, D.shape[1] as number, Float64Array.from(Float32Array.from(D.data))),
  };
}

// (the filters' work, by the project and what it hangs on; the last MEMO kept)
const memo = new Map<string, Promise<Layers>>();

/** The heights and what the filters make of them, worked out once for each set of rules (the edits have nothing to do
 * with them); kept in the engine's cache too (keep: the description as saved, which is asked for again). */
async function filtersOf(host: PlaceHost, project: string, doc: TerrainDoc, keep: boolean): Promise<Layers> {
  const base = { ...doc, edits: [] };
  const src = placeSource(host, project, TERRAIN);
  const key = await placeKey(base, src);
  const at = `${project}|${key}`;
  let got = memo.get(at);
  if (got) {
    memo.delete(at);
    memo.set(at, got);
  } else {
    const cache = placeCache(host);
    got = (async () => {
      const had = await cache.get(key);
      const kept = had ? unpackLayers(had) : null;
      if (kept) return kept;
      const L = await layersOf(base, src);
      if (keep && L.why.includes(0)) await cache.put(key, packLayers(L));
      return L;
    })();
    memo.set(at, got);
    got.catch(() => memo.delete(at));
    while (memo.size > MEMO) memo.delete(memo.keys().next().value as string);
  }
  const L = await got;
  if (!L.why.includes(0)) throw new TerrainError('the filters leave no ground at all');
  return L;
}

/** The ground (the filtered heights with the edits on them) every GROUND_CELL metres over the grid. */
async function groundGrid(host: PlaceHost, project: string, c: Checked, L: Layers) {
  const src = placeSource(host, project, TERRAIN);
  for (const e of c.doc.edits ?? [])
    if (!e.off && e.type === 'raster' && !c.rasters.has(e.file))
      if (!(await host.files.exists(`${project}/${TERRAIN}/${e.file}`))) throw new TerrainError(`no raster ${e.file}`);
  const g = await groundOf(c.doc, L, src, 3, true, c.rasters);
  const { X, Z } = gridOf(c.doc);
  const Xg = arange(X[0] as number, (X.at(-1) as number) + 1e-6, GROUND_CELL);
  const Zg = arange(Z[0] as number, (Z.at(-1) as number) + 1e-6, GROUND_CELL);
  const G = grid(Zg.length, Xg.length);
  for (let i = 0; i < Zg.length; i++)
    for (let j = 0; j < Xg.length; j++) G.data[i * Xg.length + j] = g.y(Xg[j] as number, Zg[i] as number);
  return { G, Xg, Zg };
}

const WANT = ['original', 'filtered', 'ground', 'change', 'points'];

/** The terrain worked out, for a description (as saved, if none): want among original, filtered (on the grid),
 * ground (every GROUND_CELL metres), change (the ground less the filtered, where the edits change it) and points
 * (each height: x, z, y, why). */
export async function terrainLayers(host: PlaceHost, project: string, given?: unknown, want?: unknown) {
  const t0 = performance.now();
  const asSaved = given === undefined || given === null;
  const c = checkTerrain(asSaved ? await savedOrNot(host.files, project) : given);
  const w = new Set(Array.isArray(want) && want.length ? (want as string[]) : WANT);
  const L = await filtersOf(host, project, c.doc, asSaved);
  const { X, Z, c: cell } = gridOf(c.doc);
  const grids: Record<string, ReturnType<typeof gridOut> | null> = {};
  for (const k of ['original', 'filtered'] as const)
    if (w.has(k)) grids[k] = gridOut(L[k], X[0] as number, Z[0] as number, cell);
  if (w.has('ground') || w.has('change')) {
    const { G, Xg, Zg } = await groundGrid(host, project, c, L);
    if (w.has('ground')) grids.ground = gridOut(G, Xg[0] as number, Zg[0] as number, GROUND_CELL);
    if (w.has('change')) {
      const base = sampler(L.filtered, c.doc, 3);
      const C = new Float64Array(G.data.length);
      let [i0, i1, j0, j1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < Zg.length; i++)
        for (let j = 0; j < Xg.length; j++) {
          const k = i * Xg.length + j;
          C[k] = (G.data[k] as number) - base(Xg[j] as number, Zg[i] as number);
          if (Math.abs(C[k] as number) > 1e-4) {
            i0 = Math.min(i0, i);
            i1 = Math.max(i1, i + 1);
            j0 = Math.min(j0, j);
            j1 = Math.max(j1, j + 1);
          }
        }
      if (i1 > i0) {
        const cut = grid(i1 - i0, j1 - j0);
        for (let i = i0; i < i1; i++)
          cut.data.set(C.subarray(i * Xg.length + j0, i * Xg.length + j1), (i - i0) * cut.cols);
        grids.change = gridOut(cut, Xg[j0] as number, Zg[i0] as number, GROUND_CELL);
      } else grids.change = null;
    }
  }
  const out: Record<string, unknown> = { grids };
  if (w.has('points')) {
    const why = L.why;
    out.points = {
      count: why.length,
      x: f4(L.points.x),
      z: f4(L.points.z),
      y: f4(L.points.h),
      why: base64Of(why),
    };
    out.counts = Object.fromEntries(Object.keys(WHY).map((k) => [k, why.filter((v) => v === Number(k)).length]));
  }
  out.seconds = pyRound((performance.now() - t0) / 1000, 3);
  return out;
}

// ---- saved -------------------------------------------------------------------------------------------------------

/** The description saved kept in the backups (terrain-<stamp>/: its own file, where it is in one; the track file is
 * kept as it is written), with its edits' files. */
async function backupTerrain(files: HostFiles, project: string, backups: string, now?: Date) {
  const folder = `${project}/${TERRAIN}`;
  const doc = `${folder}/terrain.json`;
  let saved: PyJson | null = null;
  try {
    saved = await savedTerrain(files, project);
  } catch {
    // (a file that is not JSON: kept, its edits' files not looked for)
  }
  const inFile = await files.exists(doc);
  if (saved === null && !inFile) return null;
  const target = `${backups}/terrain-${stamp(now)}`;
  if (inFile) await files.write(`${target}/terrain.json`, await files.read(doc));
  const old = (saved === null ? {} : plain(saved)) as { edits?: { file?: unknown }[] };
  for (const e of old.edits ?? []) {
    const name = typeof e.file === 'string' ? e.file : '';
    if (name && (await files.exists(`${folder}/${name}`)))
      await files.write(`${target}/${name.split(/[\\/]/).pop()}`, await files.read(`${folder}/${name}`));
  }
  return target;
}

/** A path as relpath from the root gives it ('.' and '..' taken out, '/' between). */
const normal = (p: string) => {
  const out: string[] = [];
  for (const s of p.replace(/\\/g, '/').split('/'))
    if (s === '..') out.pop();
    else if (s && s !== '.') out.push(s);
  return out.join('/');
};

/** A value with its keys in order, its numbers as they are (json.dumps' sort_keys). */
const sortedKeys = (v: PyJson): PyJson => {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (isDict(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortedKeys((v as J)[k] as PyJson)]),
    );
  return v;
};

/** What the ground hangs on (terrain.py's fingerprint) of a description (as it is written): the description, its
 * edits' files, the heights' and pictures' files (by name and size), the version of the sums. */
export async function fingerprint(host: PlaceHost, project: string, saved: PyJson): Promise<string> {
  const enc = new TextEncoder();
  const src = placeSource(host, project, TERRAIN);
  const chunks: Uint8Array[] = [enc.encode(dumpPyJson(sortedKeys(saved))), enc.encode(`terrain ${TERRAIN_VERSION}`)];
  const doc = plain(saved) as TerrainDoc;
  const files: string[] = [];
  for (const p of [...doc.heights.files, ...(doc.buildings?.files ?? [])]) files.push(...(await src.glob(p)));
  for (const d of [doc.image, doc.photo]) if (d) files.push(d.file);
  const edited = (doc.edits ?? []).flatMap((e) => (e.file ? [`${TERRAIN}/${e.file}`] : []));
  files.push(...edited);
  for (const f of files) {
    const at = fromRoot(project, f);
    const size = (await host.files.exists(at)) ? await host.files.size(at) : -1;
    chunks.push(enc.encode(`${normal(f)} ${size}`));
  }
  for (const f of edited)
    if (await host.files.exists(fromRoot(project, f))) chunks.push(await host.files.read(fromRoot(project, f)));
  return sha1(...chunks).slice(0, 16);
}

/** A grid as a 16-bit picture, north up and west on the left (its rows and columns both turned): its lo and hi. */
async function picture16(files: HostFiles, path: string, G: Grid): Promise<[number, number]> {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of G.data)
    if (!Number.isNaN(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const v = sixteen(G.data, lo, hi).reverse();
  await files.write(path, await png16(v, G.cols, G.rows));
  return [lo, hi];
}

/** What terrain.py's write makes of a description saved: original.png, filtered.png, ground.png, heights.json and
 * points.json in the terrain's folder; heights.json's contents. */
async function writeTerrain(host: PlaceHost, project: string, c: Checked, L: Layers) {
  const folder = `${project}/${TERRAIN}`;
  const { X, Z, c: cell } = gridOf(c.doc);
  const layers: J = {};
  const meta: J = { about: ABOUT, fingerprint: await fingerprint(host, project, c.saved), layers };
  for (const name of ['original', 'filtered'] as const) {
    const [lo, hi] = await picture16(host.files, `${folder}/${name}.png`, L[name]);
    layers[name] = {
      file: `${name}.png`,
      x_max: F(X.at(-1) as number),
      z_max: F(Z.at(-1) as number),
      cell_m: F(cell),
      size: [X.length, Z.length],
      lo: F(lo),
      hi: F(hi),
    };
  }
  const { G, Xg, Zg } = await groundGrid(host, project, c, L);
  const [lo, hi] = await picture16(host.files, `${folder}/ground.png`, G);
  layers.ground = {
    file: 'ground.png',
    x_max: F(Xg.at(-1) as number),
    z_max: F(Zg.at(-1) as number),
    cell_m: F(GROUND_CELL),
    size: [Xg.length, Zg.length],
    lo: F(lo),
    hi: F(hi),
  };
  const why = L.why;
  meta.heights = {
    count: why.length,
    why: Object.fromEntries(Object.entries(WHY).map(([k, v]) => [v, why.filter((w) => w === Number(k)).length])),
  };
  await writePyJsonFile(host.files, `${folder}/heights.json`, meta);
  const rows: string[] = [];
  for (let i = 0; i < why.length; i++)
    rows.push(
      `[${pyFloat(pyRound(L.points.x[i] as number, 2))},${pyFloat(pyRound(L.points.z[i] as number, 2))},` +
        `${pyFloat(pyRound(L.points.h[i] as number, 3))},${why[i]}]`,
    );
  const head = dumpPyJson({ columns: ['x', 'z', 'y', 'why'], why: WHY }, undefined, { separators: [',', ':'] });
  await host.files.write(
    `${folder}/points.json`,
    new TextEncoder().encode(`${head.slice(0, -1)},"rows":[${rows.join(',')}]}`),
  );
  return meta;
}

/** A description saved: its rasters that came with data written into the folder, terrain.json (the one before kept,
 * with its rasters), then the terrain's pictures and points made again. */
export async function saveTerrain(host: PlaceHost, project: string, backups: string, given: unknown, now?: Date) {
  const c = checkTerrain(given);
  const files = host.files;
  const folder = `${project}/${TERRAIN}`;
  // (the filters must find some ground first)
  const L = await filtersOf(host, project, c.doc, true);
  await backupTerrain(files, project, backups, now);
  for (const [file, R] of c.rasters)
    await files.write(
      `${folder}/${file}`,
      await writeNpz({
        x0: { dtype: '<f8', shape: [], data: [R.x0] },
        z0: { dtype: '<f8', shape: [], data: [R.z0] },
        cell: { dtype: '<f8', shape: [], data: [R.cell] },
        d: { dtype: '<f4', shape: [R.d.rows, R.d.cols], data: R.d.data },
      }),
    );
  for (const e of c.doc.edits ?? [])
    if (e.type === 'raster' && !(await files.exists(`${folder}/${e.file}`)))
      throw new TerrainError(`no raster ${e.file}: send its data`);
  // (into the track file: TRACK_FORMAT's step 7)
  await writePart(files, await settingsOf(files, project), 'terrain', c.saved, backups, now);
  const meta = await writeTerrain(host, project, c, L);
  return { ok: true, ...(await terrainInfo(files, project)), meta };
}

/** A new track's terrain, its description written already (terrain.json): its pictures and points made (the
 * track's terrain.py's write, as the wizard has it run). */
export async function makeTerrain(host: PlaceHost, project: string, say: (line: string) => void = () => {}) {
  const c = checkTerrain(plain(await savedOrNot(host.files, project)));
  const L = await filtersOf(host, project, c.doc, true);
  let [lo, hi] = [Infinity, -Infinity];
  for (const v of L.filtered.data) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  const ground = L.why.filter((w) => w === 0).length;
  say(`  ${L.why.length} heights, ${ground} of them the ground; ${lo.toFixed(1)} to ${hi.toFixed(1)} m`);
  const meta = await writeTerrain(host, project, c, L);
  const g = (meta.layers as J).ground as J;
  const why = Object.entries((meta.heights as J).why as Record<string, number>)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${k}`);
  say(
    `  the ground ${Number(g.lo).toFixed(2)} to ${Number(g.hi).toFixed(2)} m; ${L.why.length} heights, ${why.join(', ')}`,
  );
  return meta;
}
