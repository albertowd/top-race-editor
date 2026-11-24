// Each layout's map and pictures, as the games show a layout: AC's preview.png (rendered: the gantry its lap runs
// under, else its place from above with its whole lap in it: trackrender.ts) and outline.png (the layout's line alone, white edged black, as AC's own
// tracks' are, drawn over the preview by AC), and a start's map where the track cannot be rendered (the roads, its
// racing line, where it starts and the way it runs, its name). The map is drawn in its own axes: x east, y north (the
// track's -z), z up (BeamNG's axes too). The pictures are drawn where there is a canvas and a GPU (the app's engine
// window: PictureHost); the AC build's are made here once its track is.
import { readAiFile } from './acai';
import type { HostFiles } from './placehost';
import type { Spot } from './places';
import { acPoint, layoutViews, type RenderHost, type Shot, trackScene, type View } from './trackrender';

type V3 = [number, number, number];

/** The track's point (y up) in the map's axes: x stays, -z is north, y is up. */
export const mapPoint = (x: number, y: number, z: number): V3 => [x, -z, y];

/** A start's map drawn (a JPEG): the roads from above (triangles, x y each corner), the lap's line, the start and the
 * way it runs, the layout's name; frame the corners shown. */
export interface MapSpec {
  roads: Float32Array;
  line: number[];
  at: [number, number];
  fwd: [number, number];
  title: string;
  frame: [[number, number], [number, number]];
}

/** A layout's outline (AC's outline.png): its line (x y in turn) alone, fitted to a picture of size, see-through
 * round it. */
export interface OutlineSpec {
  line: number[];
  size: [number, number];
}

/** What draws the pictures (Chromium's canvas, in the app's engine window), and renders the track where it has a GPU
 * (none: the layouts' previews left as they came). */
export interface PictureHost {
  outline(spec: OutlineSpec): Promise<Uint8Array>;
  render?: RenderHost['render'];
}

/** AC's outline.png's size (its own tracks', and this track's as it came) */
export const OUTLINE_SIZE: [number, number] = [365, 192];
/** AC's preview.png's size (its own tracks') */
export const PREVIEW_SIZE: [number, number] = [355, 200];

/** A racing line (an AC AI file) in the map's axes, and how far the road reaches either side of each point (null:
 * the file does not say). */
export function racingLine(b: Uint8Array): { line: V3[]; sides: [number, number][] | null } {
  const ai = readAiFile(b);
  const n = ai.points.length / 3;
  const line: V3[] = [];
  for (let i = 0; i < n; i++)
    line.push(mapPoint(ai.points[i * 3] as number, ai.points[i * 3 + 1] as number, ai.points[i * 3 + 2] as number));
  const sides = ai.extra
    ? Array.from(
        { length: n },
        (_, i) => [ai.extra?.[i * 18 + 5] as number, ai.extra?.[i * 18 + 6] as number] as [number, number],
      )
    : null;
  return { line, sides };
}

/** Where a layout starts: a hot lap's own start where it is a hot lap and has one, else its grid's first slot (none:
 * null). */
export function startSpot(layout: string, spots: Map<string, Spot>): Spot | null {
  const hotlap = spots.get('HOTLAP_START_0');
  if (layout.includes('hotlap') && hotlap) return hotlap;
  return spots.get('START_0') ?? null;
}

/** The way a start faces, flat (its heading's, in the map's axes), turned to run the way its line does nearest it. */
export function startFacing(line: V3[], at: V3, heading: number): V3 {
  let fwd = mapPoint(Math.sin(heading), 0, Math.cos(heading));
  let k = 0;
  let bd = Infinity;
  line.forEach((p, i) => {
    const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
    if (d < bd) {
      bd = d;
      k = i;
    }
  });
  if (line.length) {
    const a = line[(k + 3) % line.length] as V3;
    const c = line[k] as V3;
    if ((a[0] - c[0]) * fwd[0] + (a[1] - c[1]) * fwd[1] < 0) fwd = [-fwd[0], -fwd[1], -fwd[2]];
  }
  const L = Math.hypot(fwd[0], fwd[1]) || 1;
  return [fwd[0] / L, fwd[1] / L, 0];
}

/** A layout's name in the game, the track's name off its front (its ui_track.json's name; none: the layout's). */
export function layoutTitle(uiName: string | undefined, trackName: string, layout: string): string {
  const lead = new RegExp(`^${trackName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`);
  return (uiName ?? layout).replace(lead, '') || layout;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The AC track's layouts' pictures, made in its folder (out, as the AC build left it): each layout's ui/outline.png
 * (its line) and, where the track can be rendered, ui/preview.png (trackrender's layoutView: its gantry, else all
 * its lap from above). A layout with no AI line yet is left as it is. How many it wrote. */
export async function acPictures(
  files: HostFiles,
  host: PictureHost,
  o: { project: string; out: string; log?: (line: string) => void },
): Promise<number> {
  const log = o.log ?? (() => {});
  const project = o.project.replace(/[\\/]+$/, '');
  const dec = (b: Uint8Array) => new TextDecoder().decode(b).replace(/^﻿/, '');
  const track = JSON.parse(dec(await files.read(`${project}/tools/reference/track.json`))) as {
    layouts?: Record<string, unknown>;
  };
  const lines = new Map<string, V3[]>();
  for (const lay of Object.keys(track.layouts ?? {})) {
    const fast = `${o.out}/${lay}/ai/fast_lane.ai`;
    if (await files.exists(fast)) lines.set(lay, racingLine(await files.read(fast)).line);
  }
  if (!lines.size) return 0;
  let wrote = 0;
  const write = async (p: string, b: Uint8Array) => {
    if ((await files.exists(p)) && same(b, await files.read(p))) return;
    await files.write(p, b);
    wrote++;
  };
  const flat = (l: V3[]) => l.flatMap((p) => [p[0], p[1]]);
  for (const [lay, line] of lines)
    await write(`${o.out}/ui/${lay}/outline.png`, await host.outline({ line: flat(line), size: OUTLINE_SIZE }));
  let rendered = 0;
  if (host.render) {
    const { scene, drawn } = await trackScene(files, o.out, [...lines.keys()]);
    const shown = [...lines].filter(([lay]) => drawn[lay]?.length);
    const views = layoutViews(
      scene,
      drawn,
      new Map(shown.map(([lay, line]) => [lay, line.map(acPoint)])),
      PREVIEW_SIZE,
    );
    const shots = shown.map(
      ([lay]): Shot => ({
        ...(views.get(lay) as View),
        models: drawn[lay] as string[],
        size: PREVIEW_SIZE,
        format: 'png',
      }),
    );
    const made = await host.render(scene, shots);
    for (const [i, [lay]] of shown.entries()) await write(`${o.out}/ui/${lay}/preview.png`, made[i] as Uint8Array);
    rendered = shown.length;
  }
  log(`  pictures: ${lines.size} layouts' outlines, ${rendered} previews rendered, ${wrote} written`);
  return wrote;
}
