import type { TrackInfo } from '../api/types';
import type { Size, View } from './viewport';
import { viewBox } from './viewport';

export const MAX_TILE_LEVEL = 4;

/** A satellite tile in view: its level, its column and row, its corner in the world and its width (metres). */
export interface TileSpot {
  level: number;
  tx: number;
  ty: number;
  /** its corner in the world (the picture's pixel (u, v) = ((span/2 - x) k, (span/2 - z) k)) */
  x: number;
  z: number;
  /** pixels the picture's level has a metre */
  k: number;
}

/** The tiles that cover the view, at the level that has about as many pixels as the screen. */
export function visibleTiles(view: View, size: Size, sat: Pick<TrackInfo, 'span' | 'px' | 'tile'>): TileSpot[] {
  const K = sat.px / sat.span;
  const half = sat.span / 2;
  const level = Math.max(0, Math.min(MAX_TILE_LEVEL, Math.floor(Math.log2(K / view.ppm))));
  const f = 2 ** level;
  const tw = (sat.tile * f) / K; // (a tile's width, metres)
  const b = viewBox(view, size);
  const u0 = ((half - b.xmax) * K) / (sat.tile * f);
  const u1 = ((half - b.xmin) * K) / (sat.tile * f);
  const v0 = ((half - b.zmax) * K) / (sat.tile * f);
  const v1 = ((half - b.zmin) * K) / (sat.tile * f);
  const n = Math.ceil(sat.px / f / sat.tile);
  const out: TileSpot[] = [];
  for (let ty = Math.max(0, Math.floor(v0)); ty <= Math.min(n - 1, Math.floor(v1)); ty++)
    for (let tx = Math.max(0, Math.floor(u0)); tx <= Math.min(n - 1, Math.floor(u1)); tx++)
      out.push({ level, tx, ty, x: half - tx * tw, z: half - ty * tw, k: K / f });
  return out;
}

/** ms before a tile not had is asked for again */
export const RETRY_MS = 2000;

/** Tiles as images, loaded as asked for, the oldest forgotten past a limit; one not had asked for again. */
export class TileCache {
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(
    /** a tile's address: at once, or once it is had (a blob's URL, let go when the tile is) */
    private readonly url: (level: number, x: number, y: number) => string | Promise<string>,
    private readonly onLoad: () => void,
    private readonly limit = 800,
  ) {}

  get(level: number, x: number, y: number): HTMLImageElement {
    const key = `${level}/${x}/${y}`;
    let im = this.images.get(key);
    if (!im) {
      const image = new Image();
      im = image;
      image.onload = this.onLoad;
      // (a tile not had (the engine busy, say): forgotten, and the map drawn again a moment later, which asks for it
      // again; kept, it would stay blank)
      const failed = () => {
        if (this.images.get(key) === image) this.images.delete(key);
        setTimeout(this.onLoad, RETRY_MS);
      };
      image.onerror = failed;
      const url = this.url(level, x, y);
      if (typeof url === 'string') image.src = url;
      else url.then((u) => (image.src = u)).catch(failed);
      this.images.set(key, image);
      if (this.images.size > this.limit) {
        const oldest = this.images.keys().next().value;
        if (oldest !== undefined) {
          const gone = this.images.get(oldest);
          if (gone?.src.startsWith('blob:')) URL.revokeObjectURL(gone.src);
          this.images.delete(oldest);
        }
      }
    }
    return im;
  }

  get size(): number {
    return this.images.size;
  }
}
