// Pictures as the terrain reads them, as Pillow makes them: grey from colour (Image.convert('L')), and made smaller
// over boxes (Image.resize(..., BOX)), both in Pillow's own integer arithmetic so the values come out the same. The
// decoding itself is where the engine runs (the engine window: Chromium's; the tests: what Pillow decoded).

import { crc32, deflate } from './bin';

/** A grey picture: rows of cols values, 0-255. */
export interface Grey {
  rows: number;
  cols: number;
  data: Uint8Array;
}

/** Pillow's RGB to L: (R 19595 + G 38470 + B 7471 + 0x8000) >> 16. rgba: four bytes a pixel (the alpha unread). */
export function greyOf(rgba: Uint8Array | Uint8ClampedArray, cols: number, rows: number, channels = 4): Grey {
  const data = new Uint8Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const o = i * channels;
    data[i] =
      ((rgba[o] as number) * 19595 + (rgba[o + 1] as number) * 38470 + (rgba[o + 2] as number) * 7471 + 0x8000) >>> 16;
  }
  return { rows, cols, data };
}

const PRECISION_BITS = 32 - 8 - 2;

/** Pillow's coefficients for a box filter from inSize to outSize: each output's first input, its count, its weights
 * (fixed point). */
function boxCoefficients(inSize: number, outSize: number) {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 0.5 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds: number[] = [];
  const kk = new Int32Array(outSize * ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    const ss = 1 / filterscale;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    const k: number[] = [];
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      const t = (x + xmin - center + 0.5) * ss;
      const w = t > -0.5 && t <= 0.5 ? 1 : 0;
      k.push(w);
      ww += w;
    }
    for (let x = 0; x < xmax; x++) {
      const v = ww !== 0 ? (k[x] as number) / ww : (k[x] as number);
      kk[xx * ksize + x] =
        v < 0 ? Math.trunc(-0.5 + v * (1 << PRECISION_BITS)) : Math.trunc(0.5 + v * (1 << PRECISION_BITS));
    }
    bounds.push(xmin, xmax);
  }
  return { ksize, bounds, kk };
}

const clip8 = (v: number) => {
  const x = Math.floor(v / (1 << PRECISION_BITS));
  return Math.min(Math.max(x, 0), 255);
};

/** Pillow's Image.resize(size, Image.BOX) of a grey picture: across then down (down first where the rows shrink the most,
 * as Pillow 13), each pass rounded to 0-255. */
export function resizeBox(g: Grey, cols: number, rows: number): Grey {
  // (down first where the rows lose more than twice what the columns do: Pillow 13's horizontal_first)
  const acrossFirst = !(g.rows - rows > 0 && g.rows - rows > (g.cols - cols) * 2);
  return acrossFirst ? boxDown(boxAcross(g, cols), rows) : boxAcross(boxDown(g, rows), cols);
}

function boxAcross(g: Grey, cols: number): Grey {
  if (cols === g.cols) return g;
  const { ksize, bounds, kk } = boxCoefficients(g.cols, cols);
  const out = new Uint8Array(cols * g.rows);
  for (let y = 0; y < g.rows; y++)
    for (let xx = 0; xx < cols; xx++) {
      const xmin = bounds[xx * 2] as number;
      const xmax = bounds[xx * 2 + 1] as number;
      let ss = 1 << (PRECISION_BITS - 1);
      for (let x = 0; x < xmax; x++) ss += (g.data[y * g.cols + x + xmin] as number) * (kk[xx * ksize + x] as number);
      out[y * cols + xx] = clip8(ss);
    }
  return { rows: g.rows, cols, data: out };
}

function boxDown(cur: Grey, rows: number): Grey {
  if (rows === cur.rows) return cur;
  const { ksize, bounds, kk } = boxCoefficients(cur.rows, rows);
  const out = new Uint8Array(cur.cols * rows);
  for (let yy = 0; yy < rows; yy++) {
    const ymin = bounds[yy * 2] as number;
    const ymax = bounds[yy * 2 + 1] as number;
    for (let x = 0; x < cur.cols; x++) {
      let ss = 1 << (PRECISION_BITS - 1);
      for (let y = 0; y < ymax; y++)
        ss += (cur.data[(y + ymin) * cur.cols + x] as number) * (kk[yy * ksize + y] as number);
      out[yy * cur.cols + x] = clip8(ss);
    }
  }
  return { rows, cols: cur.cols, data: out };
}

/** A 16-bit grey PNG (Pillow's of a uint16 array: Image.fromarray(v).save): rows of cols values, row after row. */
export async function png16(v: Uint16Array, cols: number, rows: number): Promise<Uint8Array> {
  const raw = new Uint8Array(rows * (1 + cols * 2));
  for (let r = 0; r < rows; r++) {
    const at = r * (1 + cols * 2);
    for (let c = 0; c < cols; c++) {
      const x = v[r * cols + c] as number;
      raw[at + 1 + c * 2] = x >> 8;
      raw[at + 2 + c * 2] = x & 0xff;
    }
  }
  return pngOf(raw, cols, rows, 16, 0);
}

/** An 8-bit RGBA PNG: rows of cols pixels (r, g, b, a), row after row. */
export async function pngRgba(rgba: Uint8Array, cols: number, rows: number): Promise<Uint8Array> {
  const raw = new Uint8Array(rows * (1 + cols * 4));
  for (let r = 0; r < rows; r++) raw.set(rgba.subarray(r * cols * 4, (r + 1) * cols * 4), r * (1 + cols * 4) + 1);
  return pngOf(raw, cols, rows, 8, 6);
}

/** A PNG of its rows as filtered (raw: each row its filter byte, 0, then its bytes): its depth and colour type. */
async function pngOf(raw: Uint8Array, cols: number, rows: number, depth: number, type: number): Promise<Uint8Array> {
  const chunk = (type: string, data: Uint8Array) => {
    const td = new Uint8Array(4 + data.length);
    td.set(new TextEncoder().encode(type));
    td.set(data, 4);
    const w = new Uint8Array(12 + data.length);
    const dv = new DataView(w.buffer);
    dv.setUint32(0, data.length);
    w.set(td, 4);
    dv.setUint32(8 + data.length, crc32(td));
    return w;
  };
  const head = new Uint8Array(13);
  const hv = new DataView(head.buffer);
  hv.setUint32(0, cols);
  hv.setUint32(4, rows);
  head.set([depth, type, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head),
    chunk('IDAT', await deflate(raw, 'deflate')),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
