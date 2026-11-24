// The ground's picture made by the build, in place of the satellite photo (which the editor keeps, to draw over): the
// photo only read for what covers the ground where (grass, earth, paving; a shadow or a dark canopy the cover round
// it), those simplified into plain shapes, and for each cover's colour over 8 or so metres; each cover then painted in
// its colour there with a texture of its own made here (noise at several scales): none of the photo's detail in it.
// Kept in the track's textures (GroundGenerated.jpg, or .png where no JPEG encoder is) with a material of the track's
// library like the photo's (BackgroundGenerated); made again when the photo or this way of making it changes.

import { readPicture } from './dds';
import { pngRgba } from './pictures';
import { dumpPyJson, type PyJson, readPyJson } from './pyjson';

export type GroundSource = 'photo' | 'generated';
export const GENERATED_MATERIAL = 'BackgroundGenerated';
/** pixels the generated picture is a side */
export const GROUND_SIZE = 4096;
/** what the generator is: made again when it changes */
const VERSION = 3;

/** the covers: grass (a canopy too), earth (dry ground, sand, dirt roads), paving (asphalt, concrete, roofs);
 * unknown (a shadow) */
export const GRASS = 0;
export const EARTH = 1;
export const PAVED = 2;
export const UNKNOWN = 255;
const COVERS = 3;

/** Each cover's colour where the photo shows none of it (RGB 0..255), and how much its noise varies it at each scale
 * (metres: 0.3, 1.2, 5). */
const LOOK: { rgb: [number, number, number]; vary: [number, number, number] }[] = [
  { rgb: [96, 114, 80], vary: [0.1, 0.07, 0.06] },
  { rgb: [160, 140, 112], vary: [0.08, 0.06, 0.05] },
  { rgb: [128, 122, 116], vary: [0.05, 0.03, 0.03] },
];
/** pixels the majority of covers is taken over (either side) and the covers' borders are blended over */
const SIMPLIFY = 3;
const BLEND = 2;
/** pixels a block of the covers' colours is a side */
const TONE_BLOCK = 32;
/** brightness (0..255) below which a pixel is a canopy's or a shade's, not the ground's colour */
const TONE_DARK = 88;

/** A pixel of the photo's cover (r g b 0..255). */
export function coverOf(r: number, g: number, b: number): number {
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  // (dark: a shadow; blue-grey: the shade of a sky lit shadow; dark grey: a shadow on paving; a blue-green: a tree's
  // canopy (grass is never as blue as red): the cover round it)
  if (L < 60 || (b > g && b > r && L < 110) || (sat < 14 && L < 85)) return UNKNOWN;
  if (g > r + 4 && b >= r - 2 && L < 125) return UNKNOWN;
  if (g > r + 4 && g >= b - 2) return GRASS;
  if (sat > 30 && r > b + 25 && r >= g - 4) return EARTH;
  return PAVED;
}

/** A hash of a lattice point to 0..1. */
function hash(i: number, j: number, k: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise, -1..1, on a lattice cells pixels apart. */
function noise(x: number, y: number, cell: number, k: number): number {
  const u = x / cell;
  const v = y / cell;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const a = hash(i, j, k);
  const b = hash(i + 1, j, k);
  const c = hash(i, j + 1, k);
  const d = hash(i + 1, j + 1, k);
  return ((a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv) * 2 - 1;
}

/** A square picture's values (size a side) each the mean of those within radius of it either way (in place; at the
 * picture's edges only what is in it). */
function boxBlur(v: Float32Array, size: number, radius: number): void {
  const t = new Float32Array(size);
  const pass = (at: (line: number, i: number) => number) => {
    for (let line = 0; line < size; line++) {
      let acc = 0;
      let n = 0;
      for (let i = 0; i < radius && i < size; i++) {
        acc += v[at(line, i)] as number;
        n++;
      }
      for (let i = 0; i < size; i++) {
        if (i + radius < size) {
          acc += v[at(line, i + radius)] as number;
          n++;
        }
        if (i - radius - 1 >= 0) {
          acc -= v[at(line, i - radius - 1)] as number;
          n--;
        }
        t[i] = acc / n;
      }
      for (let i = 0; i < size; i++) v[at(line, i)] = t[i] as number;
    }
  };
  pass((y, x) => y * size + x);
  pass((x, y) => y * size + x);
}

/** A photo's colours, a pixel for each block of it (RGBA, photoSize a side; size a side out): RGB. */
export function shrunk(rgba: Uint8Array, photoSize: number, size: number): Uint8Array {
  const step = photoSize / size;
  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = 0; dy < step; dy++)
        for (let dx = 0; dx < step; dx++) {
          const i = ((Math.floor(y * step) + dy) * photoSize + Math.floor(x * step) + dx) * 4;
          r += rgba[i] as number;
          g += rgba[i + 1] as number;
          b += rgba[i + 2] as number;
          n++;
        }
      out.set([Math.round(r / n), Math.round(g / n), Math.round(b / n)], (y * size + x) * 3);
    }
  return out;
}

/** The covers of a picture (RGB, size a side): its shadows given the cover round them, then simplified: each pixel
 * the cover most of those within SIMPLIFY of it are, twice. */
export function coversOf(rgb: Uint8Array, size: number): Uint8Array {
  const c = new Uint8Array(size * size);
  for (let i = 0; i < c.length; i++)
    c[i] = coverOf(rgb[i * 3] as number, rgb[i * 3 + 1] as number, rgb[i * 3 + 2] as number);
  // (the unknown the cover of the known nearest them: filled outwards from the known, a ring at a time)
  const queue = new Int32Array(c.length);
  let tail = 0;
  for (let i = 0; i < c.length; i++) if (c[i] !== UNKNOWN) queue[tail++] = i;
  if (!tail) c.fill(GRASS);
  for (let head = 0; head < tail; head++) {
    const i = queue[head] as number;
    const x = i % size;
    const k = c[i] as number;
    const reach = (j: number) => {
      if (c[j] !== UNKNOWN) return;
      c[j] = k;
      queue[tail++] = j;
    };
    if (x > 0) reach(i - 1);
    if (x < size - 1) reach(i + 1);
    if (i >= size) reach(i - size);
    if (i < c.length - size) reach(i + size);
  }
  // (simplified: each cover's share round each pixel, the most of them its cover)
  const most = new Float32Array(size * size);
  const share = new Float32Array(size * size);
  for (let round = 0; round < 2; round++) {
    most.fill(-1);
    const next = c.slice();
    for (let k = 0; k < COVERS; k++) {
      for (let i = 0; i < c.length; i++) share[i] = c[i] === k ? 1 : 0;
      boxBlur(share, size, SIMPLIFY);
      for (let i = 0; i < c.length; i++)
        if ((share[i] as number) > (most[i] as number)) {
          most[i] = share[i] as number;
          next[i] = k;
        }
    }
    c.set(next);
  }
  return c;
}

/** Each cover's colour block by block (TONE_BLOCK pixels a side): its pixels' mean in the picture; a block with few of
 * them its neighbours', a cover with none its LOOK. Per cover, n x n blocks of RGB. */
export interface Tones {
  n: number;
  rgb: Float32Array[];
}

/** The covers' tones of a picture (RGB, size a side). */
export function tonesOf(rgb: Uint8Array, size: number): Tones {
  const n = Math.ceil(size / TONE_BLOCK);
  const sum = Array.from({ length: COVERS }, () => new Float32Array(n * n * 4));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const r = rgb[i] as number;
      const g = rgb[i + 1] as number;
      const b = rgb[i + 2] as number;
      const k = coverOf(r, g, b);
      // (not a canopy's or a shade's dark: the ground's colour in the open)
      if (k === UNKNOWN || 0.299 * r + 0.587 * g + 0.114 * b < TONE_DARK) continue;
      const s = sum[k] as Float32Array;
      const at = (Math.floor(y / TONE_BLOCK) * n + Math.floor(x / TONE_BLOCK)) * 4;
      for (let ch = 0; ch < 3; ch++) s[at + ch] = (s[at + ch] as number) + (rgb[i + ch] as number);
      s[at + 3] = (s[at + 3] as number) + 1;
    }
  const least = TONE_BLOCK * TONE_BLOCK * 0.04;
  const rgbs = sum.map((s, k) => {
    const t = new Float32Array(n * n * 3);
    const known = new Uint8Array(n * n);
    let any = false;
    for (let b = 0; b < n * n; b++)
      if ((s[b * 4 + 3] as number) >= least) {
        for (let ch = 0; ch < 3; ch++) t[b * 3 + ch] = (s[b * 4 + ch] as number) / (s[b * 4 + 3] as number);
        known[b] = 1;
        any = true;
      }
    if (!any) {
      for (let b = 0; b < n * n; b++) t.set((LOOK[k] as (typeof LOOK)[number]).rgb, b * 3);
      return t;
    }
    // (the blocks without it their known neighbours' mean, ring after ring)
    for (let left = true; left; ) {
      left = false;
      const was = known.slice();
      for (let by = 0; by < n; by++)
        for (let bx = 0; bx < n; bx++) {
          const b = by * n + bx;
          if (was[b]) continue;
          const m = [0, 0, 0];
          let c = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = bx + dx;
              const yy = by + dy;
              if (xx < 0 || yy < 0 || xx >= n || yy >= n || !was[yy * n + xx]) continue;
              for (let ch = 0; ch < 3; ch++) m[ch] = (m[ch] as number) + (t[(yy * n + xx) * 3 + ch] as number);
              c++;
            }
          if (!c) {
            left = true;
            continue;
          }
          for (let ch = 0; ch < 3; ch++) t[b * 3 + ch] = (m[ch] as number) / c;
          known[b] = 1;
        }
    }
    return t;
  });
  return { n, rgb: rgbs };
}

/** A cover's colour at a pixel (into out): its blocks' colours bilinearly between their middles. */
function toneAt(t: Float32Array, n: number, x: number, y: number, out: number[]): void {
  const u = Math.min(Math.max(x / TONE_BLOCK - 0.5, 0), n - 1);
  const v = Math.min(Math.max(y / TONE_BLOCK - 0.5, 0), n - 1);
  const i = Math.floor(u);
  const j = Math.floor(v);
  const i1 = Math.min(i + 1, n - 1);
  const j1 = Math.min(j + 1, n - 1);
  const fu = u - i;
  const fv = v - j;
  for (let ch = 0; ch < 3; ch++) {
    const a = t[(j * n + i) * 3 + ch] as number;
    const b = t[(j * n + i1) * 3 + ch] as number;
    const c = t[(j1 * n + i) * 3 + ch] as number;
    const d = t[(j1 * n + i1) * 3 + ch] as number;
    out[ch] = (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }
}

/** The ground's picture painted from its covers (size pixels a side, metres a pixel) in their tones: each cover's
 * share of each pixel blurred over BLEND pixels (soft borders), its colour there varied by noise at three scales;
 * RGBA. */
export function paintCovers(
  c: Uint8Array,
  tones: Tones,
  size: number,
  metres: number,
): { picture: Uint8Array; mask: Uint8Array } {
  const px = (m: number) => Math.max(1, m / metres);
  const acc = [new Float32Array(size * size), new Float32Array(size * size), new Float32Array(size * size)];
  const w = new Float32Array(size * size);
  // (each cover's share, a channel of the mask: red grass, green earth, blue paving)
  const mask = new Uint8Array(size * size * 4);
  const share = new Float32Array(size * size);
  const tone = [0, 0, 0];
  for (let k = 0; k < COVERS; k++) {
    for (let i = 0; i < c.length; i++) share[i] = c[i] === k ? 1 : 0;
    boxBlur(share, size, BLEND);
    const L = LOOK[k] as (typeof LOOK)[number];
    const t = tones.rgb[k] as Float32Array;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const s = share[i] as number;
        mask[i * 4 + k] = Math.round(s * 255);
        if (s <= 0.001) continue;
        toneAt(t, tones.n, x, y, tone);
        const shade =
          s *
          (1 +
            L.vary[0] * noise(x, y, px(0.3), k * 8 + 1) +
            L.vary[1] * noise(x, y, px(1.2), k * 8 + 2) +
            L.vary[2] * noise(x, y, px(5), k * 8 + 3));
        for (let ch = 0; ch < 3; ch++) {
          const a = acc[ch] as Float32Array;
          a[i] = (a[i] as number) + shade * (tone[ch] as number);
        }
        w[i] = (w[i] as number) + s;
      }
  }
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const d = (w[i] as number) || 1;
    for (let ch = 0; ch < 3; ch++)
      out[i * 4 + ch] = Math.max(0, Math.min(255, Math.round(((acc[ch] as Float32Array)[i] as number) / d)));
    out[i * 4 + 3] = 255;
    mask[i * 4 + 3] = 0;
  }
  return { picture: out, mask };
}

/** The details laid over each cover up close (the ground's material's, tiled DETAIL_METRES a side): grass, sand
 * (earth), gravel (paving). */
export const DETAILS = ['grass', 'sand', 'gravel'] as const;
export type Detail = (typeof DETAILS)[number];
export const DETAIL_METRES: Record<Detail, number> = { grass: 1.5, sand: 2, gravel: 2 };
/** pixels a detail's picture is a side */
export const DETAIL_SIZE = 1024;

/** Tiling value noise, -1..1, cells a side of a picture size pixels a side (wrapping round). */
function tiled(x: number, y: number, cells: number, size: number, k: number): number {
  const c = size / cells;
  const u = x / c;
  const v = y / c;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const w = (a: number) => ((a % cells) + cells) % cells;
  const h = (a: number, b: number) => hash(w(a), w(b), k);
  return (
    ((h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv) * 2 - 1
  );
}

/** A detail's picture (RGBA, tiling): grey round the middle (128: the ground's picture's own colour where the material
 * doubles it), its grain lighter and darker about it, so far off (its mipmaps) the ground is its picture's colour.
 * Grass: blades, short streaks every way, and clumps; sand: fine grains, pebbles, faint ripples; gravel: stones. */
export function detailPicture(kind: Detail, size = DETAIL_SIZE): Uint8Array {
  const v = new Float32Array(size * size);
  const fbm = (x: number, y: number, k: number, from: number, octaves: number) => {
    let s = 0;
    let a = 0.5;
    let cells = from;
    for (let o = 0; o < octaves; o++) {
      s += a * tiled(x, y, cells, size, k + o);
      a *= 0.55;
      cells *= 2;
    }
    return s;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const fine = hash(x, y, kind.length) * 2 - 1;
      if (kind === 'grass') v[i] = 0.16 * fbm(x, y, 3, 8, 4) + 0.1 * fine;
      else if (kind === 'sand')
        v[i] =
          0.12 * fbm(x, y, 13, 16, 5) +
          0.16 * fine +
          0.05 * Math.sin((y / size) * Math.PI * 2 * 9 + 3 * tiled(x, y, 4, size, 17));
      else v[i] = 0.1 * fbm(x, y, 23, 32, 3) + 0.08 * fine;
    }
  // (grass: blades, a short streak each; sand and gravel: stones, a round speck each, a lit and a shaded side)
  const rnd = (n: number, k: number) => hash(n, k, 977);
  const count = kind === 'grass' ? size * 40 : kind === 'sand' ? size * 3 : size * 12;
  for (let n = 0; n < count; n++) {
    const cx = rnd(n, 1) * size;
    const cy = rnd(n, 2) * size;
    if (kind === 'grass') {
      const a = rnd(n, 3) * Math.PI;
      const len = 4 + rnd(n, 4) * 10;
      const d = (rnd(n, 5) - 0.45) * 0.5;
      for (let t = 0; t < len; t++) {
        const x = Math.round(cx + Math.cos(a) * t);
        const y = Math.round(cy + Math.sin(a) * t);
        const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
        v[i] = (v[i] as number) * 0.4 + d;
      }
    } else {
      const r = kind === 'sand' ? 1 + rnd(n, 3) * 2.5 : 2 + rnd(n, 3) * 5;
      const d = (rnd(n, 4) - 0.5) * (kind === 'sand' ? 0.5 : 0.4);
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          const q = Math.hypot(dx, dy) / r;
          if (q > 1) continue;
          const x = Math.round(cx + dx);
          const y = Math.round(cy + dy);
          const i = (((y % size) + size) % size) * size + (((x % size) + size) % size);
          // (lit from the top left, a shadow at its bottom right edge)
          const light = q > 0.7 && dx + dy > 0 ? -0.18 : (-(dx + dy) / (2 * r)) * 0.1;
          v[i] = d + light;
        }
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const g = Math.max(0, Math.min(255, Math.round(128 * (1 + (v[i] as number)))));
    out.set([g, g, g, 255], i * 4);
  }
  return out;
}

/** A picture encoded: JPEG where the platform has an encoder (the engine window's canvas), else PNG. */
async function encoded(rgba: Uint8Array, size: number): Promise<{ bytes: Uint8Array; ext: 'jpg' | 'png' }> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size, size);
    const g = canvas.getContext('2d');
    if (g) {
      g.putImageData(
        new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), size, size),
        0,
        0,
      );
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpg' };
    }
  }
  return { bytes: await pngRgba(rgba, size, size), ext: 'png' };
}

async function sha1(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-1', b as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** the generated ground's mask and its details' pictures, beside it */
const MASK_FILE = 'GroundGeneratedMask.png';
const detailFile = (d: Detail) => `GroundDetail${d[0]?.toUpperCase()}${d.slice(1)}.png`;
type AcTarget = { shader?: string; props?: [PyJson, PyJson][]; textures?: [string, number, string][] };

interface Files {
  read(p: string): Promise<Uint8Array>;
  exists(p: string): Promise<boolean>;
  write(p: string, b: Uint8Array): Promise<void>;
}

/** The generated ground ready in the track (its picture in source/textures, its material in the library, made again
 * where the photo or the generator changed): the material's name. photo: the satellite picture's path; material: the
 * library's material of it (its look copied); span: metres the photo covers. */
export async function generatedGround(
  files: Files,
  project: string,
  photo: string,
  material: string,
  span: number,
  log: (line: string) => void = () => {},
): Promise<string> {
  const dir = `${project}/source/textures`;
  const meta = `${dir}/GroundGenerated.json`;
  const lib = `${project}/source/materials.json`;
  const bytes = await files.read(photo);
  const made = { version: VERSION, photo: await sha1(bytes), size: GROUND_SIZE };
  const doc = readPyJson(new TextDecoder().decode(await files.read(lib))) as {
    materials: Record<string, PyJson>;
    textures?: Record<string, PyJson>;
  };
  const was = (await files.exists(meta))
    ? (JSON.parse(new TextDecoder().decode(await files.read(meta))) as typeof made & { file?: string })
    : null;
  const fresh =
    was &&
    was.version === made.version &&
    was.photo === made.photo &&
    was.size === made.size &&
    was.file &&
    (await files.exists(`${dir}/${was.file}`)) &&
    (await files.exists(`${dir}/${MASK_FILE}`)) &&
    doc.materials[GENERATED_MATERIAL];
  if (fresh) return GENERATED_MATERIAL;
  const t0 = performance.now();
  const pic = await readPicture(bytes);
  if (pic.width !== pic.height) throw new Error(`the satellite picture is not square (${pic.width} x ${pic.height})`);
  const rgba =
    pic.mode === 'RGBA'
      ? pic.data
      : (() => {
          const o = new Uint8Array(pic.width * pic.height * 4);
          for (let i = 0; i < pic.width * pic.height; i++) o.set([...pic.data.subarray(i * 3, i * 3 + 3), 255], i * 4);
          return o;
        })();
  const size = Math.min(GROUND_SIZE, pic.width);
  const small = shrunk(rgba, pic.width, size);
  const { picture, mask } = paintCovers(coversOf(small, size), tonesOf(small, size), size, span / size);
  const { bytes: out, ext } = await encoded(picture, size);
  const file = `GroundGenerated.${ext}`;
  await files.write(`${dir}/${file}`, out);
  await files.write(`${dir}/${MASK_FILE}`, await pngRgba(mask, size, size));
  for (const d of DETAILS)
    await files.write(`${dir}/${detailFile(d)}`, await pngRgba(detailPicture(d), DETAIL_SIZE, DETAIL_SIZE));
  // (its material: the photo's, its picture this one; in AC its covers' details over it up close (ksMultilayer: the
  // picture times the details its mask mixes, doubled), each tiled its own metres)
  const base = JSON.parse(JSON.stringify(doc.materials[material] ?? {})) as Record<string, unknown>;
  base.colour = file;
  const ac = (base.targets as { ac?: AcTarget } | undefined)?.ac;
  if (ac) {
    const keep = (ac.props ?? []).filter(([n]) =>
      ['ksAmbient', 'ksDiffuse', 'ksSpecular', 'ksSpecularEXP', 'ksEmissive', 'ksAlphaRef'].includes(String(n)),
    );
    const tile = (d: Detail) => span / DETAIL_METRES[d];
    ac.shader = 'ksMultilayer';
    ac.props = [
      ...keep,
      ['multR', tile('grass')],
      ['multG', tile('sand')],
      ['multB', tile('gravel')],
      ['multA', tile('gravel')],
      ['magicMult', 2],
      ['boh', 0],
    ];
    ac.textures = [
      ['txDiffuse', 0, file],
      ['txMask', 1, MASK_FILE],
      ['txDetailR', 2, detailFile('grass')],
      ['txDetailG', 3, detailFile('sand')],
      ['txDetailB', 4, detailFile('gravel')],
      ['txDetailA', 5, detailFile('gravel')],
    ];
  }
  doc.materials[GENERATED_MATERIAL] = base as PyJson;
  const photoName = photo.split('/').pop() ?? '';
  if (doc.textures) {
    doc.textures[file] = doc.textures[photoName] ?? ({ ac: 'DXT1', normal: false } as PyJson);
    for (const f of [MASK_FILE, ...DETAILS.map(detailFile)]) doc.textures[f] = { ac: 'DXT1', normal: false } as PyJson;
  }
  await files.write(lib, new TextEncoder().encode(`${dumpPyJson(doc as unknown as PyJson, 1)}\n`));
  await files.write(meta, new TextEncoder().encode(JSON.stringify({ ...made, file })));
  log(
    `the ground's picture generated from the photo's covers: ${size} px, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );
  return GENERATED_MATERIAL;
}
