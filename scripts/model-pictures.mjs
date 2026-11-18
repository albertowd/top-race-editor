// The models' pictures (public/models), drawn from each catalogue model's .glb as the build reads it (its parts but
// its hull, those it draws near): its icon, <id>.png, seen from its front-left and above, and its picture from
// straight above, <id>.top.png, its front at the picture's top, `top` metres across with the model's origin in its
// middle, as the map draws it; flat shaded, on nothing (transparent). Each material is coloured with its own picture:
// the model's texture, else the track's material library's colour picture (source/materials.json, source/textures),
// sampled at its points' UVs; else a plain colour of its name. The catalogue's `top` is written as drawn.
//
//   npm run pictures [-- [--track <the track's folder>] [model id ...]]
//
// The track's folder is where its material library is (the Velopark's, ../kart-velopark beside the editor, unless
// said); the track's own models (materials "track") are drawn only with it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createJiti } from 'jiti';
import { readJpeg } from './jpeg.mjs';

const EDITOR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = join(EDITOR, 'models').split('\\').join('/');
const PICTURES = join(EDITOR, 'public', 'models');
const CATALOGUE = join(MODELS, 'catalogue.json');

/** the icon's side, in pixels */
const ICON = 128;
/** the picture from above: pixels a metre, its side at least and at most */
const TOP_PPM = 12;
const TOP_MIN = 48;
const TOP_MAX = 1024;
/** each pixel drawn of so many by so many, for smooth edges */
const FINE = 3;

const jiti = createJiti(import.meta.url);
const { catalogue, loadTemplate } = await jiti.import('../src/engine/templates.ts');
const { libraryOf } = await jiti.import('../src/engine/materials.ts');
const { readPng } = await jiti.import('../src/engine/dds.ts');

// ---- what to draw ----------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const trackAt = args.indexOf('--track');
const track = (trackAt >= 0 ? resolve(args[trackAt + 1]) : resolve(EDITOR, '..', 'kart-velopark'))
  .split('\\')
  .join('/');
const only = args.filter((_, i) => trackAt < 0 || (i !== trackAt && i !== trackAt + 1));

const files = {
  read: async (p) => new Uint8Array(readFileSync(p)),
  exists: async (p) => existsSync(p),
};
const hasTrack = existsSync(`${track}/source/materials.json`);
if (!hasTrack) console.warn(`no material library at ${track}: plain colours, and the track's own models left out`);
const textures = `${track}/source/textures`;
const src = {
  ...files,
  editorModels: MODELS,
  ...(hasTrack ? { library: await libraryOf(files, track), textures } : {}),
};
const library = hasTrack ? JSON.parse(readFileSync(`${track}/source/materials.json`, 'utf-8')).materials : {};

// ---- pictures read and written ---------------------------------------------------------------------------------

/** A picture's pixels, RGBA (a PNG's or a JPEG's; null: neither, or not read). */
async function decode(bytes) {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      const im = await readPng(bytes);
      if (im.mode === 'RGBA') return im;
      const data = new Uint8Array(im.width * im.height * 4);
      for (let i = 0; i < im.width * im.height; i++) {
        data.set(im.data.subarray(i * 3, i * 3 + 3), i * 4);
        data[i * 4 + 3] = 255;
      }
      return { width: im.width, height: im.height, data };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
  } catch (e) {
    console.warn(`  a picture not read: ${e.message}`);
  }
  return null;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (b) => {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

/** RGBA pixels as a PNG, each row filtered the way it packs smallest. */
function png(width, height, rgba) {
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    let best = null;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let x = 0; x < stride; x++) {
        const v = rgba[y * stride + x];
        const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
        const u = y ? rgba[(y - 1) * stride + x] : 0;
        const c = y && x >= 4 ? rgba[(y - 1) * stride + x - 4] : 0;
        let p = v;
        if (f === 1) p = v - a;
        else if (f === 2) p = v - u;
        else if (f === 3) p = v - ((a + u) >> 1);
        else if (f === 4) {
          const q = a + u - c;
          const pa = Math.abs(q - a);
          const pb = Math.abs(q - u);
          const pc = Math.abs(q - c);
          p = v - (pa <= pb && pa <= pc ? a : pb <= pc ? u : c);
        }
        row[x] = p & 255;
        sum += row[x] < 128 ? row[x] : 256 - row[x];
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = [f, Uint8Array.from(row)];
      }
    }
    raw[y * (stride + 1)] = best[0];
    raw.set(best[1], y * (stride + 1) + 1);
  }
  const chunk = (type, body) => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const head = new Uint8Array(13);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  head.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ---- each material's colour ------------------------------------------------------------------------------------

const decoded = new Map();
const once = (key, make) => {
  if (!decoded.has(key)) decoded.set(key, make());
  return decoded.get(key);
};

/** A plain colour of a name: a quiet one, the same each time. */
function plain(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = (h % 360) / 360;
  const k = (n) => (n + hue * 12) % 12;
  const f = (n) => 0.62 - 0.12 * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** A part's look: its picture (null: none), its colour where it has none, and how its alpha counts. */
async function lookOf(part) {
  const name = part.material;
  const m = part.from?.materials.find((x) => x.name === name);
  if (m) {
    const t = m.textures.find((x) => x.sampler === 'txDiffuse');
    const bytes = t && part.from.textures.find((x) => x.name === t.name)?.data;
    const pic = bytes?.length
      ? await once(
          part.from.textures.find((x) => x.name === t.name),
          () => decode(bytes),
        )
      : null;
    const alpha = m.alpha_tested ? 'mask' : m.blend ? 'blend' : 'opaque';
    if (pic) return { pic, colour: average(pic), alpha };
  }
  const lib = library[name];
  if (lib?.colour && existsSync(`${textures}/${lib.colour}`)) {
    const pic = await once(`lib:${lib.colour}`, () =>
      decode(new Uint8Array(readFileSync(`${textures}/${lib.colour}`))),
    );
    if (pic) return { pic, colour: average(pic), alpha: lib.alpha ?? 'opaque' };
  }
  return { pic: null, colour: plain(name), alpha: 'opaque' };
}

function average(pic) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const step = Math.max(1, Math.floor((pic.width * pic.height) / 4096));
  for (let i = 0; i < pic.width * pic.height; i += step) {
    if (pic.data[i * 4 + 3] < 128) continue;
    r += pic.data[i * 4];
    g += pic.data[i * 4 + 1];
    b += pic.data[i * 4 + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : [160, 160, 160];
}

// ---- drawing ---------------------------------------------------------------------------------------------------

/** The model's triangles to draw: its parts but its hull, those it does not draw and those drawn only far; each
 * corner's point and UV, the part's look. */
async function trianglesOf(meta, parts) {
  const out = [];
  for (const p of parts) {
    if (p.part === meta.hull || p.seen === false) continue;
    const lod = meta.lods?.[p.part];
    if (lod && lod[0] > 0) continue;
    const look = await lookOf(p);
    for (let f = 0; f < p.F.length; f += 3) {
      const c = [p.F[f], p.F[f + 1], p.F[f + 2]].map((i) => [
        p.V[i * 11],
        p.V[i * 11 + 1],
        p.V[i * 11 + 2],
        p.V[i * 11 + 6],
        p.V[i * 11 + 7],
      ]);
      out.push({ c, look });
    }
  }
  return out;
}

const norm = (v) => {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The triangles drawn on a picture side by side pixels: seen along -back (right and up the picture's), each point at
 * (centre + its right * scale, centre - its up * scale), lit from light; RGBA, its alpha how much of each pixel is
 * covered.
 */
function draw(tris, side, view, light) {
  const W = side * FINE;
  const depth = new Float32Array(W * W).fill(-Infinity);
  const colour = new Float32Array(W * W * 4);
  const { right, up, back, scale, cx, cy } = view;
  const opaque = tris.filter((t) => t.look.alpha !== 'blend');
  const blended = tris.filter((t) => t.look.alpha === 'blend');
  for (const [list, blend] of [
    [opaque, false],
    [blended, true],
  ])
    for (const t of list) {
      const P = t.c.map((q) => [
        (cx + dot(q, right) * scale) * FINE,
        (cy - dot(q, up) * scale) * FINE,
        dot(q, back),
        q[3],
        q[4],
      ]);
      // (flat: the face's own normal, turned to the eye; lit, never quite dark)
      let n = norm(cross(sub(t.c[1], t.c[0]), sub(t.c[2], t.c[0])));
      if (dot(n, back) < 0) n = n.map((x) => -x);
      const shade = Math.min(1.08, 0.5 + 0.58 * Math.max(0, dot(n, light)));
      raster(P, W, (i, b0, b1, b2) => {
        const z = b0 * P[0][2] + b1 * P[1][2] + b2 * P[2][2];
        if (z <= depth[i]) return;
        let rgb = t.look.colour;
        let a = 1;
        const pic = t.look.pic;
        if (pic) {
          const u = b0 * P[0][3] + b1 * P[1][3] + b2 * P[2][3];
          const v = b0 * P[0][4] + b1 * P[1][4] + b2 * P[2][4];
          const x = Math.min(pic.width - 1, Math.floor((u - Math.floor(u)) * pic.width));
          const y = Math.min(pic.height - 1, Math.floor((v - Math.floor(v)) * pic.height));
          const o = (y * pic.width + x) * 4;
          rgb = [pic.data[o], pic.data[o + 1], pic.data[o + 2]];
          if (t.look.alpha !== 'opaque') a = pic.data[o + 3] / 255;
        }
        if (t.look.alpha === 'mask' && a < 0.5) return;
        if (!blend) {
          depth[i] = z;
          a = 1;
        } else a = Math.max(a, 0.35);
        const k = i * 4;
        for (let j = 0; j < 3; j++) colour[k + j] = colour[k + j] * (1 - a) + Math.min(255, rgb[j] * shade) * a;
        colour[k + 3] = colour[k + 3] * (1 - a) + a;
      });
    }
  // (each pixel the mean of its fine ones, its colour weighed by how much each is covered)
  const out = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const s = [0, 0, 0, 0];
      for (let j = 0; j < FINE; j++)
        for (let i = 0; i < FINE; i++) {
          const k = ((y * FINE + j) * W + x * FINE + i) * 4;
          for (let c = 0; c < 4; c++) s[c] += colour[k + c];
        }
      const o = (y * side + x) * 4;
      const covered = s[3] / (FINE * FINE);
      // (the colours were laid over nothing: each already weighed by how much it covers)
      for (let c = 0; c < 3; c++) out[o + c] = s[3] > 0 ? Math.round(Math.min(255, s[c] / s[3])) : 0;
      out[o + 3] = Math.round(covered * 255);
    }
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Each pixel a triangle covers (its middle inside), with its weights at the corners. */
function raster(P, W, put) {
  const [a, b, c] = P;
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const y1 = Math.min(W - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
      const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      put(y * W + x, w0, w1, w2);
    }
}

/** Its icon: seen from its front-left (its own left, +x, on the right) and above, the whole of it filling the square. */
function icon(tris) {
  const az = (35 * Math.PI) / 180;
  const el = (28 * Math.PI) / 180;
  const back = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  const right = norm(cross([0, 1, 0], back));
  const up = cross(back, right);
  let lo = [Infinity, Infinity];
  let hi = [-Infinity, -Infinity];
  for (const t of tris)
    for (const q of t.c) {
      const p = [dot(q, right), -dot(q, up)];
      lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
      hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
    }
  const scale = (ICON * 0.9) / Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-6);
  const view = {
    right,
    up,
    back,
    scale,
    cx: ICON / 2 - ((lo[0] + hi[0]) / 2) * scale,
    cy: ICON / 2 - ((lo[1] + hi[1]) / 2) * scale,
  };
  // (lit from above the eye, a little from its left)
  const light = norm([0, 1, 2].map((j) => right[j] * -0.35 + up[j] * 0.75 + back[j] * 0.55));
  return draw(tris, ICON, view, light);
}

/** Its picture from above: its front at the top (its own left, +x, on the left), top metres across. */
function fromAbove(tris, top) {
  const side = Math.max(TOP_MIN, Math.min(TOP_MAX, Math.round(top * TOP_PPM)));
  const view = { right: [-1, 0, 0], up: [0, 0, 1], back: [0, 1, 0], scale: side / top, cx: side / 2, cy: side / 2 };
  return { side, rgba: draw(tris, side, view, norm([0.35, 1, 0.45])) };
}

/** Metres across its picture from above: twice its farthest point from its origin, across or along, and a little. */
function topOf(tris) {
  let r = 0;
  for (const t of tris) for (const q of t.c) r = Math.max(r, Math.abs(q[0]), Math.abs(q[2]));
  return Math.max(0.2, Math.ceil(r * 2 * 1.04 * 10) / 10);
}

// ---- every model -----------------------------------------------------------------------------------------------

const cat = await catalogue(src);
const ids = only.length ? only : Object.keys(cat);
const tops = {};
for (const id of ids) {
  const meta = cat[id];
  if (!meta) throw new Error(`the catalogue has no ${id}`);
  if (meta.materials === 'track' && !hasTrack) continue;
  const tris = await trianglesOf(meta, await loadTemplate(src, meta));
  const top = topOf(tris);
  const above = fromAbove(tris, top);
  writeFileSync(join(PICTURES, `${id}.png`), png(ICON, ICON, icon(tris)));
  writeFileSync(join(PICTURES, `${id}.top.png`), png(above.side, above.side, above.rgba));
  tops[id] = top;
  console.log(`${id}: ${tris.length} triangles, ${top} m across from above (${above.side} px)`);
}

// (each model's top, in its catalogue's text as it is)
let text = readFileSync(CATALOGUE, 'utf-8');
for (const [id, top] of Object.entries(tops)) {
  const start = text.indexOf(`"id": "${id}"`);
  const next = text.indexOf('"id": "', start + 1);
  const end = next < 0 ? text.length : next;
  const block = text.slice(start, end);
  const made = /"top": [\d.]+/.test(block)
    ? block.replace(/"top": [\d.]+/, `"top": ${top}`)
    : block.replace(/("size": \[[^\]]*\],\n)(\s*)/, `$1$2"top": ${top},\n$2`);
  text = text.slice(0, start) + made + text.slice(end);
}
writeFileSync(CATALOGUE, text);
