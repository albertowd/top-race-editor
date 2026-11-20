// A track's PNG textures made DDS for Assetto Corsa as its build makes them (materials.py's `ac_dds`): a PNG read
// (8-bit RGB, RGBA or grey, as the track keeps them), a normal map's green turned down, then either a DXT mip chain down to
// 4 pixels (kn5io.py's `dds`: each level the one before made half by Pillow's LANCZOS, its RGBA premultiplied for it)
// or one level (`_dds_plain`: sides not powers of two, or uncompressed), each level as Pillow 13's DDS writer and BCn
// encoder write it (DdsImagePlugin._save, libImaging/BcnEncode.c), in their own arithmetic (float32 where it is), so
// the bytes come out the same.

/** A picture: its pixels row by row, 3 bytes each (RGB) or 4 (RGBA). */
export interface Picture {
  width: number;
  height: number;
  mode: 'RGB' | 'RGBA';
  data: Uint8Array;
}

// ---- reading a PNG ---------------------------------------------------------------------------------------------

/** zlib's inflate (the platform's: a DecompressionStream). */
async function inflate(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** A picture read: a PNG as readPng reads it; another kind (an editor's model's JPEG) by the browser's own decoder,
 * where the engine runs in one, as RGBA. */
export async function readPicture(b: Uint8Array): Promise<Picture> {
  if (b[0] === 0x89 && b[1] === 0x50) return readPng(b);
  if (typeof createImageBitmap === 'undefined') throw new Error('no decoder here for a picture not a PNG');
  const bmp = await createImageBitmap(new Blob([b as Uint8Array<ArrayBuffer>]), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no canvas to decode a picture on');
    g.drawImage(bmp, 0, 0);
    const data = new Uint8Array(g.getImageData(0, 0, bmp.width, bmp.height).data.buffer);
    return { width: bmp.width, height: bmp.height, mode: 'RGBA', data };
  } finally {
    bmp.close();
  }
}

/** A PNG of 8-bit RGB, RGBA, grey or grey with alpha, not interlaced (as a track keeps its textures), read as
 * Pillow reads it (grey as RGB, grey with alpha as RGBA). */
export async function readPng(b: Uint8Array): Promise<Picture> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat: Uint8Array[] = [];
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p);
    const kind = String.fromCharCode(...b.subarray(p + 4, p + 8));
    const body = b.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      const depth = body[8];
      type = body[9] as number;
      if (depth !== 8 || ![0, 2, 4, 6].includes(type) || body[12] !== 0)
        throw new Error(
          `a PNG of a kind the track's textures are not (depth ${depth}, type ${type}, interlace ${body[12]})`,
        );
    } else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    p += 12 + len;
  }
  const all = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) {
    all.set(c, o);
    o += c.length;
  }
  const raw = await inflate(all);
  const bpp = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type] as number;
  const stride = width * bpp;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] as number;
      const a = x >= bpp ? (data[row + x - bpp] as number) : 0;
      const u = y > 0 ? (data[row - stride + x] as number) : 0;
      const c = y > 0 && x >= bpp ? (data[row - stride + x - bpp] as number) : 0;
      let out: number;
      if (f === 0) out = v;
      else if (f === 1) out = v + a;
      else if (f === 2) out = v + u;
      else if (f === 3) out = v + ((a + u) >> 1);
      else if (f === 4) {
        const pp = a + u - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - u);
        const pc = Math.abs(pp - c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? u : c);
      } else throw new Error(`a PNG row of filter ${f}`);
      data[row + x] = out & 255;
    }
  }
  if (type === 2 || type === 6) return { width, height, mode: type === 6 ? 'RGBA' : 'RGB', data };
  // (grey, and grey with alpha: as Pillow converts L to RGB and LA to RGBA, the grey in each channel)
  const n = width * height;
  const so = type === 4 ? 4 : 3;
  const wide = new Uint8Array(n * so);
  for (let i = 0; i < n; i++) {
    const g = data[i * bpp] as number;
    wide[i * so] = g;
    wide[i * so + 1] = g;
    wide[i * so + 2] = g;
    if (so === 4) wide[i * so + 3] = data[i * bpp + 1] as number;
  }
  return { width, height, mode: so === 4 ? 'RGBA' : 'RGB', data: wide };
}

// ---- Pillow's conversions and resize -------------------------------------------------------------------------

/** Image.convert(mode): RGB to RGBA its alpha 255; RGBA to RGB its alpha dropped. */
export function convert(im: Picture, mode: 'RGB' | 'RGBA'): Picture {
  if (im.mode === mode) return im;
  const n = im.width * im.height;
  const out = new Uint8Array(n * (mode === 'RGBA' ? 4 : 3));
  const si = im.mode === 'RGBA' ? 4 : 3;
  const so = mode === 'RGBA' ? 4 : 3;
  for (let i = 0; i < n; i++) {
    out[i * so] = im.data[i * si] as number;
    out[i * so + 1] = im.data[i * si + 1] as number;
    out[i * so + 2] = im.data[i * si + 2] as number;
    if (so === 4) out[i * so + 3] = 255;
  }
  return { width: im.width, height: im.height, mode, data: out };
}

const PRECISION_BITS = 32 - 8 - 2;

const sinc = (x: number) => {
  if (x === 0) return 1;
  const t = x * Math.PI;
  return Math.sin(t) / t;
};
const lanczos = (x: number) => (x >= -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);

/** Pillow's coefficients (precompute_coeffs, normalize_coeffs_8bpc) for LANCZOS from inSize to outSize. */
function coefficients(inSize: number, outSize: number) {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 3 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Int32Array(outSize * ksize);
  const inv = 1 / filterscale;
  const k = new Float64Array(ksize);
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let ww = 0;
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin;
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * inv);
      k[x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) {
      const v = ww !== 0 ? (k[x] as number) / ww : (k[x] as number);
      kk[xx * ksize + x] =
        v < 0 ? Math.trunc(-0.5 + v * (1 << PRECISION_BITS)) : Math.trunc(0.5 + v * (1 << PRECISION_BITS));
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { ksize, bounds, kk };
}

/** clip8 of a fixed-point sum (its last PRECISION_BITS a fraction), as Pillow's: an arithmetic shift, then 0-255. */
const clip8 = (ss: number) => {
  const x = ss >> PRECISION_BITS;
  return Math.min(Math.max(x, 0), 255);
};

/** A pass of Pillow's resample over 8-bit channels: across (horizontal) or down. */
function pass(src: Uint8Array, w: number, h: number, ch: number, outSize: number, across: boolean): Uint8Array {
  const { ksize, bounds, kk } = coefficients(across ? w : h, outSize);
  const ow = across ? outSize : w;
  const oh = across ? h : outSize;
  const out = new Uint8Array(ow * oh * ch);
  const half = 1 << (PRECISION_BITS - 1);
  for (let yy = 0; yy < oh; yy++)
    for (let xx = 0; xx < ow; xx++) {
      const i = across ? xx : yy;
      const min = bounds[i * 2] as number;
      const n = bounds[i * 2 + 1] as number;
      for (let c = 0; c < ch; c++) {
        let ss = half;
        for (let t = 0; t < n; t++) {
          const at = across ? (yy * w + min + t) * ch + c : ((min + t) * w + xx) * ch + c;
          // (in 32 bits, as Pillow's int: its weights small enough that the sum never overflows)
          ss = (ss + (src[at] as number) * (kk[i * ksize + t] as number)) | 0;
        }
        out[(yy * ow + xx) * ch + c] = clip8(ss);
      }
    }
  return out;
}

/** Image.resize((w, h), LANCZOS): across then down (down first where the height shrinks the most, as Pillow 13), each
 * pass rounded to 0-255; RGBA premultiplied for it (Pillow's RGBA to RGBa and back). */
export function resizeLanczos(im: Picture, w: number, h: number): Picture {
  if (w === im.width && h === im.height) return im;
  const ch = im.mode === 'RGBA' ? 4 : 3;
  let d = im.data;
  if (ch === 4) {
    d = new Uint8Array(im.data);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] as number;
      for (let c = 0; c < 3; c++) {
        const t = (d[i + c] as number) * a + 128;
        d[i + c] = ((t >> 8) + t) >> 8;
      }
    }
  }
  let cw = im.width;
  let chh = im.height;
  // (down first where the height loses more than twice what the width does: Pillow 13's horizontal_first)
  const acrossFirst = !(im.height - h > 0 && im.height - h > (im.width - w) * 2);
  const across = () => {
    if (w !== cw) {
      d = pass(d, cw, chh, ch, w, true);
      cw = w;
    }
  };
  const down = () => {
    if (h !== chh) {
      d = pass(d, cw, chh, ch, h, false);
      chh = h;
    }
  };
  if (acrossFirst) {
    across();
    down();
  } else {
    down();
    across();
  }
  if (ch === 4)
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] as number;
      if (a === 255 || a === 0) continue;
      for (let c = 0; c < 3; c++) {
        const v = Math.trunc((255 * (d[i + c] as number)) / a);
        d[i + c] = v <= 0 ? 0 : v < 256 ? v : 255;
      }
    }
  return { width: w, height: h, mode: im.mode, data: d };
}

// ---- Pillow's BCn encoder --------------------------------------------------------------------------------------

const f32 = Math.fround;

const encode565 = (r: number, g: number, b: number) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
function decode565(x: number): [number, number, number] {
  let r = (x & 0xf800) >> 8;
  r |= r >> 5;
  let g = (x & 0x7e0) >> 3;
  g |= g >> 6;
  let b = (x & 0x1f) << 3;
  b |= b >> 5;
  return [r & 255, g & 255, b & 255];
}

/** A 4x4 block's pixels (by x + y * 4): their channels, and whether each lies inside the picture. */
function blockAt(im: Picture, bx: number, by: number) {
  const ch = im.mode === 'RGBA' ? 4 : 3;
  const px = new Uint8Array(16 * 4);
  const inside = new Uint8Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const x = bx + i;
      const y = by + j;
      const b = i + j * 4;
      if (x >= im.width || y >= im.height) continue;
      inside[b] = 1;
      for (let c = 0; c < ch; c++) px[b * 4 + c] = im.data[(y * im.width + x) * ch + c] as number;
    }
  return { px, inside };
}

function bc1Color(im: Picture, bx: number, by: number, separateAlpha: boolean, dst: Uint8Array, o: number): void {
  const { px, inside } = blockAt(im, bx, by);
  const alpha = new Uint8Array(16);
  let first = true;
  let transparency = false;
  let min = 0;
  let max = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const b = i + j * 4;
      if (!inside[b]) continue;
      if (separateAlpha) {
        if (px[b * 4 + 3] === 0) {
          alpha[b] = 0;
          transparency = true;
          continue;
        }
        alpha[b] = 1;
      }
      const c = encode565(px[b * 4] as number, px[b * 4 + 1] as number, px[b * 4 + 2] as number);
      if (first || c < min) min = c;
      if (first || c > max) max = c;
      first = false;
    }
  let p = o;
  if (transparency) {
    dst[p++] = min & 255;
    dst[p++] = min >> 8;
  }
  dst[p++] = max & 255;
  dst[p++] = max >> 8;
  if (!transparency) {
    dst[p++] = min & 255;
    dst[p++] = min >> 8;
  }
  const lo = decode565(min);
  const hi = decode565(max);
  for (let i = 0; i < 4; i++) {
    let l = 0;
    for (let j = 3; j > -1; j--) {
      const b = i * 4 + j;
      if (transparency && !alpha[b]) {
        l |= 3 << (j * 2);
        continue;
      }
      let distance = f32(0);
      let total = 0;
      for (let k = 0; k < 3; k++) {
        const denom = Math.abs(hi[k] - lo[k]);
        if (denom !== 0) {
          distance = f32(distance + f32(Math.abs((px[b * 4 + k] as number) - lo[k]) / denom));
          total += 1;
        }
      }
      if (total === 0) continue;
      if (transparency) {
        distance = f32(distance * Math.trunc(4 / total));
        if (distance < 1) {
          // (color_max)
        } else if (distance < 3) l |= 2 << (j * 2);
        else l |= 1 << (j * 2);
      } else {
        distance = f32(distance * Math.trunc(6 / total));
        if (distance < 1) l |= 1 << (j * 2);
        else if (distance < 3) l |= 3 << (j * 2);
        else if (distance < 5) l |= 2 << (j * 2);
      }
    }
    dst[p++] = l;
  }
}

function bc2Alpha(im: Picture, bx: number, by: number, dst: Uint8Array, o: number): void {
  const { px, inside } = blockAt(im, bx, by);
  let p = o;
  for (let i = 0; i < 4; i++) {
    let l = 0;
    for (let j = 3; j > -1; j--) {
      const b = i * 4 + j;
      // (Pillow puts the whole alpha in a 4-bit field: its bits past the field spill into the next)
      l |= (inside[b] ? (px[b * 4 + 3] as number) : 0) << (j * 4);
    }
    dst[p++] = l & 255;
    dst[p++] = (l >> 8) & 255;
  }
}

function bc3Alpha(im: Picture, bx: number, by: number, channel: number, dst: Uint8Array, o: number): void {
  const { px, inside } = blockAt(im, bx, by);
  const block = new Uint8Array(16);
  let first = true;
  let min = 0;
  let max = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const b = i + j * 4;
      if (!inside[b]) continue;
      const a = px[b * 4 + channel] as number;
      block[b] = a;
      if (first || a < min) min = a;
      if (first || a > max) max = a;
      first = false;
    }
  let p = o;
  dst[p++] = min;
  dst[p++] = max;
  const denom = Math.abs(max - min);
  for (let i = 0; i < 2; i++) {
    let l = 0;
    for (let j = 7; j > -1; j--) {
      const a = block[i * 8 + j] as number;
      if (!a) {
        l |= 6 << (j * 3);
        continue;
      }
      if (a === 255) {
        l |= 7 << (j * 3);
        continue;
      }
      const distance = denom === 0 ? 0 : f32(f32(Math.abs(a - min) / denom) * 10);
      if (distance < 3) l |= 2 << (j * 3);
      else if (distance < 5) l |= 3 << (j * 3);
      else if (distance < 7) l |= 4 << (j * 3);
      else l |= 5 << (j * 3);
    }
    dst[p++] = l & 255;
    dst[p++] = (l >> 8) & 255;
    dst[p++] = (l >> 16) & 255;
  }
}

export type DxtFormat = 'DXT1' | 'DXT3' | 'DXT5';
const BCN: Record<DxtFormat, number> = { DXT1: 1, DXT3: 2, DXT5: 3 };

/** A picture's blocks as Pillow's BCn encoder writes them (n: 1 DXT1, 2 DXT3, 3 DXT5). */
export function bcn(im: Picture, fmt: DxtFormat): Uint8Array {
  const n = BCN[fmt];
  const hasAlpha = im.mode === 'RGBA';
  const size = n === 1 ? 8 : 16;
  const bw = Math.ceil(im.width / 4);
  const bh = Math.ceil(im.height / 4);
  const out = new Uint8Array(bw * bh * size);
  let o = 0;
  for (let by = 0; by < im.height; by += 4)
    for (let bx = 0; bx < im.width; bx += 4) {
      if (n === 2 || n === 3) {
        if (hasAlpha) {
          if (n === 2) bc2Alpha(im, bx, by, out, o);
          else bc3Alpha(im, bx, by, 3, out, o);
        } else out.fill(0xff, o, o + 8);
        o += 8;
      }
      bc1Color(im, bx, by, n === 1 && hasAlpha, out, o);
      o += 8;
    }
  return out;
}

// ---- Pillow's DDS writer ---------------------------------------------------------------------------------------

const DDSD = { CAPS: 0x1, HEIGHT: 0x2, WIDTH: 0x4, PITCH: 0x8, PIXELFORMAT: 0x1000, LINEARSIZE: 0x80000 };
const DDPF = { ALPHAPIXELS: 0x1, FOURCC: 0x4, RGB: 0x40 };
const fourcc = (s: string) =>
  s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);

/** A picture as Pillow saves it as DDS: compressed (fmt given: BCn) or uncompressed (its channels B, G, R, A). */
export function ddsOf(im: Picture, fmt?: DxtFormat): Uint8Array {
  const bands = im.mode === 'RGBA' ? 4 : 3;
  const bitcount = bands * 8;
  let flags = DDSD.CAPS | DDSD.HEIGHT | DDSD.WIDTH | DDSD.PIXELFORMAT;
  let pitch: number;
  let pixelFlags: number;
  let four = 0;
  let mask = [0, 0, 0, 0];
  let body: Uint8Array;
  if (fmt) {
    flags |= DDSD.LINEARSIZE;
    pitch = (im.width + 3) * 4;
    pixelFlags = DDPF.FOURCC;
    four = fourcc(fmt);
    body = bcn(im, fmt);
  } else {
    flags |= DDSD.PITCH;
    pitch = Math.floor((im.width * bitcount + 7) / 8);
    const alpha = im.mode === 'RGBA';
    pixelFlags = DDPF.RGB | (alpha ? DDPF.ALPHAPIXELS : 0);
    mask = [0x00ff0000, 0x0000ff00, 0x000000ff, alpha ? 0xff000000 : 0];
    const n = im.width * im.height;
    body = new Uint8Array(n * bands);
    for (let i = 0; i < n; i++) {
      body[i * bands] = im.data[i * bands + 2] as number;
      body[i * bands + 1] = im.data[i * bands + 1] as number;
      body[i * bands + 2] = im.data[i * bands] as number;
      if (alpha) body[i * bands + 3] = im.data[i * bands + 3] as number;
    }
  }
  const head = new Uint8Array(128);
  const dv = new DataView(head.buffer);
  const u32 = [
    fourcc('DDS '),
    124,
    flags,
    im.height,
    im.width,
    pitch,
    0,
    0,
    ...Array(11).fill(0),
    32,
    pixelFlags,
    four,
    bitcount,
    ...mask,
    0x1000,
    0,
    0,
    0,
    0,
  ];
  u32.forEach((v, i) => {
    dv.setUint32(i * 4, v >>> 0, true);
  });
  const out = new Uint8Array(128 + body.length);
  out.set(head);
  out.set(body, 128);
  return out;
}

const pow2 = (v: number) => v > 0 && (v & (v - 1)) === 0;

/** A DDS with its mip chain down to 4 pixels (kn5io.py's dds): sides powers of two, each level the one before made
 * half (LANCZOS); level 0's header, its mip count and caps set. */
export function ddsChain(img: Picture, fmt: DxtFormat): Uint8Array {
  if (!pow2(img.width) || !pow2(img.height))
    throw new Error(`a mip chain's sides powers of two: ${img.width} x ${img.height}`);
  let cur = convert(img, fmt !== 'DXT1' ? 'RGBA' : 'RGB');
  const levels: Uint8Array[] = [];
  let w = cur.width;
  let h = cur.height;
  for (;;) {
    levels.push(ddsOf(cur, fmt));
    if (Math.min(w, h) <= 4) break;
    w = Math.floor(w / 2);
    h = Math.floor(h / 2);
    cur = resizeLanczos(cur, w, h);
  }
  const first = levels[0] as Uint8Array;
  const head = first.slice(0, 128);
  const dv = new DataView(head.buffer);
  dv.setUint32(8, dv.getUint32(8, true) | 0x20000, true);
  dv.setUint32(28, levels.length, true);
  dv.setUint32(108, dv.getUint32(108, true) | 0x8 | 0x400000, true);
  const out = new Uint8Array(128 + levels.reduce((n, l) => n + l.length - 128, 0));
  out.set(head);
  let o = 128;
  for (const l of levels) {
    out.set(l.subarray(128), o);
    o += l.length - 128;
  }
  return out;
}

/** What the library says of a texture for AC: its DDS format (DXT1 unless it says), whether it is a normal map. */
export interface TextureAc {
  ac?: string;
  normal?: boolean;
}

/** A texture's bytes as AC's build needs them (materials.py's ac_dds): a PNG named X.dds made DDS in the format the
 * library has for it (X.png's entry; a normal map's green turned down first); anything else as it is. */
export async function acDds(name: string, data: Uint8Array, textures: Record<string, TextureAc>): Promise<Uint8Array> {
  const png = data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  if (!png || !name.toLowerCase().endsWith('.dds')) return data;
  const base = name.split(/[\\/]/).pop() as string;
  const t = textures[`${base.slice(0, -4)}.png`] ?? {};
  const fmt = t.ac ?? 'DXT1';
  let img = await readPng(data);
  if (t.normal) {
    img = convert(img, 'RGBA');
    const d = new Uint8Array(img.data);
    for (let i = 1; i < d.length; i += 4) d[i] = 255 - (d[i] as number);
    img = { ...img, data: d };
  }
  if (fmt === 'DXT1' || fmt === 'DXT5' || fmt === 'DXT3') {
    if (pow2(img.width) && pow2(img.height)) return ddsChain(img, fmt);
    return ddsOf(convert(img, fmt !== 'DXT1' ? 'RGBA' : 'RGB'), fmt);
  }
  return ddsOf(convert(img, 'RGBA'));
}
