// A DDS read back to pixels (a kn5's textures, as the track's renders draw them): DXT1, DXT3, DXT5 and uncompressed
// RGB(A) by its masks, the largest of its mip levels no wider nor taller than asked. Anything else (DX10's formats,
// BC4 to BC7) is not read: null.
import type { Picture } from './dds';

const FOURCC = 0x4;
const DXT: Record<string, 1 | 2 | 3> = { DXT1: 1, DXT2: 2, DXT3: 2, DXT4: 3, DXT5: 3 };

/** The 565 colour as RGB. */
function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 31;
  const g = (c >> 5) & 63;
  const b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

/** A DXT level's blocks as RGBA. */
function blocks(b: Uint8Array, at: number, w: number, h: number, kind: 1 | 2 | 3): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const size = kind === 1 ? 8 : 16;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pal = new Uint8Array(16);
  const alpha = new Uint8Array(16);
  let o = at;
  for (let by = 0; by < h; by += 4)
    for (let bx = 0; bx < w; bx += 4, o += size) {
      if (o + size > b.length) return out;
      alpha.fill(255);
      if (kind === 2)
        for (let i = 0; i < 16; i++) {
          const v = ((b[o + (i >> 1)] as number) >> ((i & 1) * 4)) & 15;
          alpha[i] = v * 17;
        }
      else if (kind === 3) {
        const a0 = b[o] as number;
        const a1 = b[o + 1] as number;
        const a = [a0, a1, 0, 0, 0, 0, 0, 0];
        if (a0 > a1) for (let i = 1; i < 7; i++) a[i + 1] = Math.round(((7 - i) * a0 + i * a1) / 7);
        else {
          for (let i = 1; i < 5; i++) a[i + 1] = Math.round(((5 - i) * a0 + i * a1) / 5);
          a[6] = 0;
          a[7] = 255;
        }
        // (48 bits of 3-bit indices)
        let bits = 0;
        for (let i = 5; i >= 0; i--) bits = bits * 256 + (b[o + 2 + i] as number);
        for (let i = 0; i < 16; i++) {
          alpha[i] = a[Math.floor(bits / 2 ** (3 * i)) & 7] as number;
        }
      }
      const c = kind === 1 ? o : o + 8;
      const c0 = dv.getUint16(c, true);
      const c1 = dv.getUint16(c + 2, true);
      const [r0, g0, b0] = rgb565(c0);
      const [r1, g1, b1] = rgb565(c1);
      pal.set([r0, g0, b0, 255, r1, g1, b1, 255]);
      if (c0 > c1 || kind !== 1) {
        pal.set([(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255], 8);
        pal.set([(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255], 12);
      } else {
        pal.set([(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255], 8);
        pal.set([0, 0, 0, 0], 12);
      }
      const idx = dv.getUint32(c + 4, true);
      for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3);
        const y = by + (i >> 2);
        if (x >= w || y >= h) continue;
        const k = ((idx >>> (2 * i)) & 3) * 4;
        const p = (y * w + x) * 4;
        out[p] = pal[k] as number;
        out[p + 1] = pal[k + 1] as number;
        out[p + 2] = pal[k + 2] as number;
        out[p + 3] = Math.min(pal[k + 3] as number, alpha[i] as number);
      }
    }
  return out;
}

/** A channel's mask's shift and width. */
function maskOf(m: number): [number, number] {
  if (!m) return [0, 0];
  let s = 0;
  while (!((m >>> s) & 1)) s++;
  let n = 0;
  while ((m >>> (s + n)) & 1) n++;
  return [s, n];
}

/** A DDS's pixels (RGBA), its largest level no side of which is over max; not one this reads: null. */
export function readDds(b: Uint8Array, max = Infinity): Picture | null {
  if (b.length < 128 || b[0] !== 0x44 || b[1] !== 0x44 || b[2] !== 0x53 || b[3] !== 0x20) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let h = dv.getUint32(12, true);
  let w = dv.getUint32(16, true);
  const mips = Math.max(1, dv.getUint32(28, true));
  const pf = dv.getUint32(80, true);
  const four = String.fromCharCode(b[84] as number, b[85] as number, b[86] as number, b[87] as number);
  const bits = dv.getUint32(88, true);
  const kind = pf & FOURCC ? DXT[four] : undefined;
  if (pf & FOURCC && !kind) return null;
  if (!kind && bits !== 32 && bits !== 24) return null;
  const levelSize = (lw: number, lh: number) =>
    kind ? Math.ceil(lw / 4) * Math.ceil(lh / 4) * (kind === 1 ? 8 : 16) : lw * lh * (bits / 8);
  let at = 128;
  for (let level = 0; level < mips - 1 && (w > max || h > max); level++) {
    at += levelSize(w, h);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  if (at + levelSize(w, h) > b.length) return null;
  if (kind) return { width: w, height: h, mode: 'RGBA', data: blocks(b, at, w, h, kind) };
  const masks = [92, 96, 100, 104].map((o) => maskOf(dv.getUint32(o, true)));
  const step = bits / 8;
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let v = 0;
    for (let k = step - 1; k >= 0; k--) v = v * 256 + (b[at + i * step + k] as number);
    masks.forEach(([s, n], c) => {
      out[i * 4 + c] = n ? Math.round(((Math.floor(v / 2 ** s) & (2 ** n - 1)) * 255) / (2 ** n - 1)) : 255;
    });
  }
  return { width: w, height: h, mode: 'RGBA', data: out };
}
