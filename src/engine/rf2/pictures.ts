// The location's pictures, as rFactor 2's own tracks have them (ModDev's Joesville and LochDrummond): the venue's icon
// (<venue>Icon.dds, 512 square: the track seen, darkened, its laps' map over it, where it starts and its pits), and
// each layout's, in its folder: <layout>icon.tga (102 x 87, its lap white on a red tile), <layout>Thmb.tga (190 x 128,
// its lap yellow, see-through round it, where it starts and its pits, the way it runs), <layout>SMicon.dds (512
// square, its lap on a dark tile), swheel_trackmap.dds (128 x 256, its lap for a wheel's screen) and
// <layout>_loading.jpg (1920 x 1080: the track seen from its start, its data and its map in panels over it; without
// one the game loads on black). They are drawn where there is a canvas (the app's engine window: Rf2PictureHost), the
// track rendered under them where there is a GPU too (the AC build's models, as its own pictures are).
import type { Picture } from '../dds';
import { convert, ddsChain, readPng } from '../dds';
import { mapPoint } from '../layoutmap';
import type { RenderHost } from '../trackrender';

type V3 = [number, number, number];

export type Rf2PictureKind = 'venue' | 'tile' | 'icon' | 'thumb' | 'wheel' | 'loading';

/** each picture's size, as the samples' */
export const RF2_PICTURE_SIZE: Record<Rf2PictureKind, [number, number]> = {
  venue: [512, 512],
  tile: [512, 512],
  icon: [102, 87],
  thumb: [190, 128],
  wheel: [128, 256],
  loading: [1920, 1080],
};

/** A picture to draw: the laps on it (each a line, x y in turn, the map's axes: x east, y north), the first the one it
 * is of; where that starts and the way it runs, where its pits are; a render to draw over (venue, loading); and what
 * a loading screen's panels say. */
export interface Rf2Picture {
  kind: Rf2PictureKind;
  lines: number[][];
  start: [number, number] | null;
  fwd: [number, number] | null;
  pit: [number, number] | null;
  /** roads drawn as the laps are, open (the venue's: its other layouts' own stretches) */
  runs?: number[][];
  backdrop?: Uint8Array;
  panel?: LoadingPanel;
}

/** A loading screen's: its track data's rows (name, value), the venue and the layout's names, which way its lap runs. */
export interface LoadingPanel {
  rows: [string, string][];
  venue: string;
  layout: string;
  clockwise: boolean;
}

/** What draws the pictures (Chromium's canvas: a PNG, the loading screen a JPEG), and renders the track where it has
 * a GPU. */
export interface Rf2PictureHost {
  picture(spec: Rf2Picture): Promise<Uint8Array>;
  render?: RenderHost['render'];
}

/** A layout's lap and its places, as the pictures take them (the track's axes in, the map's out). */
export interface LapPlaces {
  /** the lap's points, the track's x y z in turn */
  points: ArrayLike<number>;
  start: { x: number; y: number; z: number; heading: number } | null;
  pit: { x: number; z: number } | null;
}

/** A lap's line in the map's axes (x y in turn), every n-th point (its last joined to its first). */
export function mapLine(points: ArrayLike<number>, every = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < points.length; i += 3 * every) {
    const p = mapPoint(points[i] as number, points[i + 1] as number, points[i + 2] as number);
    out.push(p[0], p[1]);
  }
  return out;
}

/** metres: a layout's line this near one drawn already is the same road */
export const SAME_ROAD = 6;

/** Laps as a map of the roads, each once (the map's axes): the first whole, and of each after it its stretches more
 * than near metres from every point drawn before (each a point into what it leaves and joins, so it meets it); one
 * near none whole. laps: those whole; runs: the stretches, open. */
export function roadMap(lines: number[][], near = SAME_ROAD): { laps: number[][]; runs: number[][] } {
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / near)},${Math.floor(y / near)}`;
  const add = (l: number[]) => {
    for (let i = 0; i + 1 < l.length; i += 2) {
      const k = key(l[i] as number, l[i + 1] as number);
      const c = cells.get(k);
      if (c) c.push(l[i] as number, l[i + 1] as number);
      else cells.set(k, [l[i] as number, l[i + 1] as number]);
    }
  };
  const isNear = (x: number, y: number) => {
    const cx = Math.floor(x / near);
    const cy = Math.floor(y / near);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cy - 1; j <= cy + 1; j++) {
        const c = cells.get(`${i},${j}`) ?? [];
        for (let k = 0; k + 1 < c.length; k += 2)
          if (Math.hypot((c[k] as number) - x, (c[k + 1] as number) - y) <= near) return true;
      }
    return false;
  };
  const laps: number[][] = [];
  const runs: number[][] = [];
  for (const l of lines) {
    const n = l.length / 2;
    if (n < 3) continue;
    const close = Array.from({ length: n }, (_, i) => isNear(l[i * 2] as number, l[i * 2 + 1] as number));
    if (!close.some(Boolean)) {
      laps.push(l);
      add(l);
      continue;
    }
    // (the stretches of points away from the drawn, from one near before them to one near after, round the lap)
    const first = close.indexOf(true);
    let run: number[] | null = null;
    for (let s = 1; s <= n; s++) {
      const i = (first + s) % n;
      const p = [l[i * 2] as number, l[i * 2 + 1] as number];
      const prev = (i - 1 + n) % n;
      if (!close[i]) {
        run ??= [l[prev * 2] as number, l[prev * 2 + 1] as number];
        run.push(...p);
      } else if (run) {
        run.push(...p);
        if (run.length >= 8) runs.push(run);
        run = null;
      }
    }
    add(l);
  }
  return { laps, runs };
}

/** Whether a lap (the map's axes, y north) runs clockwise seen from above: its signed area under nought. */
export function clockwise(line: number[]): boolean {
  let a = 0;
  const n = line.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (line[i * 2] as number) * (line[j * 2 + 1] as number) - (line[j * 2] as number) * (line[i * 2 + 1] as number);
  }
  return a < 0;
}

/** Where a lap starts in the map's axes, and the way it runs there (flat): its start's heading turned to run as the
 * lap does nearest it. */
export function startOn(
  line: number[],
  s: NonNullable<LapPlaces['start']>,
): { at: [number, number]; fwd: [number, number] } {
  const at = mapPoint(s.x, s.y, s.z);
  let fwd: V3 = mapPoint(Math.sin(s.heading), 0, Math.cos(s.heading));
  let k = 0;
  let bd = Infinity;
  for (let i = 0; i * 2 < line.length; i++) {
    const d = Math.hypot((line[i * 2] as number) - at[0], (line[i * 2 + 1] as number) - at[1]);
    if (d < bd) {
      bd = d;
      k = i;
    }
  }
  const n = line.length / 2;
  if (n > 3) {
    const a = (k + 3) % n;
    const ax = (line[a * 2] as number) - (line[k * 2] as number);
    const ay = (line[a * 2 + 1] as number) - (line[k * 2 + 1] as number);
    if (ax * fwd[0] + ay * fwd[1] < 0) fwd = [-fwd[0], -fwd[1], 0];
  }
  const L = Math.hypot(fwd[0], fwd[1]) || 1;
  return { at: [at[0], at[1]], fwd: [fwd[0] / L, fwd[1] / L] };
}

/** A picture as a 32-bit TGA, as the samples' icons and thumbnails are: uncompressed, its rows from the bottom, eight
 * bits of alpha. */
export function tga(p: Picture): Uint8Array {
  const im = convert(p, 'RGBA');
  const out = new Uint8Array(18 + im.width * im.height * 4);
  out[2] = 2;
  out[12] = im.width & 255;
  out[13] = im.width >> 8;
  out[14] = im.height & 255;
  out[15] = im.height >> 8;
  out[16] = 32;
  out[17] = 8;
  for (let y = 0; y < im.height; y++)
    for (let x = 0; x < im.width; x++) {
      const s = ((im.height - 1 - y) * im.width + x) * 4;
      const d = 18 + (y * im.width + x) * 4;
      out[d] = im.data[s + 2] as number;
      out[d + 1] = im.data[s + 1] as number;
      out[d + 2] = im.data[s] as number;
      out[d + 3] = im.data[s + 3] as number;
    }
  return out;
}

/** A drawn PNG as the file rFactor reads: a TGA (icon, thumb) or a DDS with its smaller levels (venue and tile DXT5,
 * as LochDrummond's; the wheel's DXT1). */
export async function rf2File(kind: Exclude<Rf2PictureKind, 'loading'>, png: Uint8Array): Promise<Uint8Array> {
  const p = await readPng(png);
  if (kind === 'icon' || kind === 'thumb') return tga(p);
  return ddsChain(convert(p, 'RGBA'), kind === 'wheel' ? 'DXT1' : 'DXT5');
}

/** Each layout's pictures' file names, in its folder. */
export const layoutPictureFiles = (layout: string) => ({
  icon: `${layout}icon.tga`,
  thumb: `${layout}Thmb.tga`,
  tile: `${layout}SMicon.dds`,
  wheel: 'swheel_trackmap.dds',
  loading: `${layout}_loading.jpg`,
});

/** The venue's icon's file name, in the location's folder (the GDBs' VenueIcon, from rFactor's Locations). */
export const venueIconFile = (venue: string) => `${venue}Icon.dds`;
