// Bytes in and out: little-endian numbers, latin-1 strings, SHA-1. What the model formats are read and written with.

/** A byte array's own copy, as an ArrayBuffer of its own (aligned for typed arrays over it). */
export function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

export const latin1 = {
  decode(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
    return s;
  },
  encode(s: string): Uint8Array {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  },
};

/** Reads numbers and strings one after another. */
export class Reader {
  readonly view: DataView;
  p = 0;

  constructor(readonly b: Uint8Array) {
    this.view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }

  i32(): number {
    const v = this.view.getInt32(this.p, true);
    this.p += 4;
    return v;
  }

  u8(): number {
    return this.b[this.p++] as number;
  }

  f32(): number {
    const v = this.view.getFloat32(this.p, true);
    this.p += 4;
    return v;
  }

  f32s(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.f32());
    return out;
  }

  raw(n: number): Uint8Array {
    if (this.p + n > this.b.length) throw new Error(`read past the end (${this.p + n} of ${this.b.length} bytes)`);
    const out = this.b.slice(this.p, this.p + n);
    this.p += n;
    return out;
  }

  /** A string: its length (int32), then its bytes, latin-1. */
  str(): string {
    return latin1.decode(this.raw(this.i32()));
  }
}

/** Writes numbers and strings one after another. */
export class Writer {
  private parts: Uint8Array[] = [];
  private size = 0;

  bytes(b: Uint8Array): this {
    this.parts.push(b);
    this.size += b.length;
    return this;
  }

  private num(n: number, put: (v: DataView) => void): this {
    const b = new Uint8Array(n);
    put(new DataView(b.buffer));
    return this.bytes(b);
  }

  i32(v: number): this {
    return this.num(4, (d) => d.setInt32(0, v, true));
  }

  u32(v: number): this {
    return this.num(4, (d) => d.setUint32(0, v, true));
  }

  u16(v: number): this {
    return this.num(2, (d) => d.setUint16(0, v, true));
  }

  u8(v: number): this {
    return this.num(1, (d) => d.setUint8(0, v));
  }

  f32(v: number): this {
    return this.num(4, (d) => d.setFloat32(0, v, true));
  }

  str(s: string): this {
    const b = latin1.encode(s);
    return this.i32(b.length).bytes(b);
  }

  get length(): number {
    return this.size;
  }

  done(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** A typed array's bytes (little-endian, as every computer the app runs on is). */
export const bytesOf = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Bytes as a typed array of their own (copied, so aligned). */
export function f32sOf(b: Uint8Array): Float32Array<ArrayBuffer> {
  return new Float32Array(own(b).buffer);
}

const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

/** SHA-1 of some bytes, in hex: the hashes the track's tools keep (synchronous, so it runs anywhere). */
export function sha1(...chunks: Uint8Array[]): string {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const total = Math.ceil((n + 9) / 64) * 64;
  const m = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    m.set(c, at);
    at += c.length;
  }
  m[n] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor((n * 8) / 2 ** 32), false);
  dv.setUint32(total - 4, (n * 8) >>> 0, false);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const x = (w[i - 3] as number) ^ (w[i - 8] as number) ^ (w[i - 14] as number) ^ (w[i - 16] as number);
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const t = (((a << 5) | (a >>> 27)) + f + e + (K[(i / 20) | 0] as number) + (w[i] as number)) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (zip's and PNG's) of some bytes, on from a CRC before. */
export function crc32(b: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < b.length; i++) c = (CRC_TABLE[(c ^ (b[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return ~c >>> 0;
}

/** Bytes deflated by the platform (a CompressionStream): raw (zip's), or with zlib's frame (PNG's). */
export async function deflate(b: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> {
  const s = new Blob([b as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
