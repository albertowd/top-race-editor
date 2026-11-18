// A track's satellite picture in tiles, in the engine window (satellite.py's, in Chromium's hands): decoded once,
// each level half the one before, a tile TILE pixels a side as JPEG; the last picture kept, its tiles too.
import { TILE } from '../engine/api';
import type { Picture } from '../engine/dds';
import type { HostFiles } from '../engine/placehost';

/** JPEG's quality, as satellite.py saves its tiles */
const QUALITY = 0.88;
/** tiles kept (satellite.py's CACHE_TILES) */
const CACHE_TILES = 600;

export function satelliteTiles(files: HostFiles) {
  let path = '';
  let levels = new Map<number, Promise<ImageBitmap>>();
  const cache = new Map<string, Uint8Array>();

  const level = (p: string, l: number): Promise<ImageBitmap> => {
    if (p !== path) {
      path = p;
      levels = new Map();
      cache.clear();
    }
    let got = levels.get(l);
    if (!got) {
      got = (async () => {
        if (l === 0) return createImageBitmap(new Blob([(await files.read(p)) as Uint8Array<ArrayBuffer>]));
        const im = await level(p, 0);
        const w = Math.max(1, im.width >> l);
        const h = Math.max(1, im.height >> l);
        return createImageBitmap(im, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
      })();
      levels.set(l, got);
      got.catch(() => levels.delete(l));
    }
    return got;
  };

  return async (p: string, l: number, x: number, y: number): Promise<Uint8Array | null> => {
    const key = `${p}|${l}|${x}|${y}`;
    const kept = cache.get(key);
    if (kept && p === path) return kept;
    const im = await level(p, l);
    if (x * TILE >= im.width || y * TILE >= im.height) return null;
    const w = Math.min(TILE, im.width - x * TILE);
    const h = Math.min(TILE, im.height - y * TILE);
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    if (!g) return null;
    g.drawImage(im, x * TILE, y * TILE, w, h, 0, 0, w, h);
    const out = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: QUALITY })).arrayBuffer());
    if (cache.size > CACHE_TILES) cache.clear();
    cache.set(key, out);
    return out;
  };
}

/** A picture made smaller (its longer side side pixels at most; as it is if smaller) as JPEG of quality 0-1: the
 * terrain's picture of the ground round the track (terrain.py's image, Pillow's LANCZOS there). The last kept. */
export function scaledPictures(files: HostFiles) {
  let kept: { key: string; jpeg: Promise<Uint8Array> } | null = null;
  return (p: string, side: number, quality: number): Promise<Uint8Array> => {
    const key = `${p}|${side}|${quality}`;
    if (kept?.key === key) return kept.jpeg;
    const jpeg = (async () => {
      const im = await createImageBitmap(new Blob([(await files.read(p)) as Uint8Array<ArrayBuffer>]));
      const k = side / Math.max(im.width, im.height);
      const w = k < 1 ? Math.round(im.width * k) : im.width;
      const h = k < 1 ? Math.round(im.height * k) : im.height;
      const small =
        k < 1 ? await createImageBitmap(im, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }) : im;
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d');
      if (!g) throw new Error('no canvas to draw the picture on');
      g.drawImage(small, 0, 0);
      return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
    })();
    kept = { key, jpeg };
    jpeg.catch(() => {
      if (kept?.key === key) kept = null;
    });
    return jpeg;
  };
}

/** A picture (JPEG, PNG) as RGB, as Chromium decodes it (no colour space made of it). */
export async function decodeRgb(bytes: Uint8Array): Promise<Picture> {
  const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  try {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no canvas to decode a picture on');
    g.drawImage(bmp, 0, 0);
    const rgba = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const data = new Uint8Array(bmp.width * bmp.height * 3);
    for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
      data[o] = rgba[i] as number;
      data[o + 1] = rgba[i + 1] as number;
      data[o + 2] = rgba[i + 2] as number;
    }
    return { width: bmp.width, height: bmp.height, mode: 'RGB', data };
  } finally {
    bmp.close();
  }
}

/** A picture (RGB or RGBA) as JPEG of quality 0-1 (Chromium's encoder). */
export async function encodeJpeg(im: Picture, quality: number): Promise<Uint8Array> {
  const n = im.mode === 'RGBA' ? 4 : 3;
  const rgba = new Uint8ClampedArray(im.width * im.height * 4);
  for (let i = 0, o = 0; o < rgba.length; i += n, o += 4) {
    rgba[o] = im.data[i] as number;
    rgba[o + 1] = im.data[i + 1] as number;
    rgba[o + 2] = im.data[i + 2] as number;
    rgba[o + 3] = 255;
  }
  const c = new OffscreenCanvas(im.width, im.height);
  const g = c.getContext('2d');
  if (!g) throw new Error('no canvas to make a JPEG on');
  g.putImageData(new ImageData(rgba, im.width, im.height), 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
}
