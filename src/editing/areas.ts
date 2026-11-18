// The paved areas (a car park, a lane): each a shape of its own, its corners in order, laid as a road's top is (the
// build's), paint marks laid on it as on any road. Made a rectangle, then shaped: a corner moved, added on an edge,
// taken away (three kept); the whole moved. What the mouse is on: a corner, else an edge or inside (the whole).

import type { PaintMark, PavedArea, TrackObjects, Vec2 } from '../domain/types';

/** metres a parking bay is across and deep, unless said */
export const BAY: Vec2 = [2.5, 5];
/** metres a parking line is wide */
const PARK_LINE = 0.1;

/** metres a new area is across and deep */
export const NEW_AREA: Vec2 = [20, 10];
/** an area's material, unless the track's first says otherwise */
export const AREA_MATERIAL = 'Tarmac Dark';

const PREFIX = 'AREA_';

/** A point's distance to the segment a-b, and how far along it (0 to 1). */
function toSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz)), t };
}

/** Whether a point is inside an area (even-odd). */
export function inside(points: readonly Vec2[], x: number, z: number): boolean {
  let on = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Vec2;
    const b = points[j] as Vec2;
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) on = !on;
  }
  return on;
}

/** An area's size, square metres. */
export function areaOf(points: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++)
    s += ((points[j] as Vec2)[0] - (points[i] as Vec2)[0]) * ((points[j] as Vec2)[1] + (points[i] as Vec2)[1]);
  return Math.abs(s) / 2;
}

/** The middle of its corners. */
export function middleOf(points: readonly Vec2[]): Vec2 {
  const n = points.length || 1;
  return [points.reduce((a, p) => a + p[0], 0) / n, points.reduce((a, p) => a + p[1], 0) / n];
}

/** The edge of an area nearest (x, z): its first corner's index, how far off, how far along. */
export function nearestEdge(points: readonly Vec2[], x: number, z: number): { i: number; d: number; t: number } {
  let best = { i: 0, d: Infinity, t: 0 };
  for (let i = 0; i < points.length; i++) {
    const s = toSegment([x, z], points[i] as Vec2, points[(i + 1) % points.length] as Vec2);
    if (s.d < best.d) best = { i, d: s.d, t: s.t };
  }
  return best;
}

// ---------------------------------------------------------------- edits (on drafts)

/** A new area at (x, z): a rectangle NEW_AREA across, turned to heading, named AREA_<n>. Its place in the list. */
export function addArea(
  o: TrackObjects,
  x: number,
  z: number,
  heading: number,
  name: string,
  material = AREA_MATERIAL,
) {
  const [w, d] = [NEW_AREA[0] / 2, NEW_AREA[1] / 2];
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  const at = (u: number, v: number): Vec2 => [x + u * c + v * s, z - u * s + v * c];
  o.areas ??= [];
  o.areas.push({ name, material, points: [at(-w, -d), at(w, -d), at(w, d), at(-w, d)] });
  return o.areas.length - 1;
}

/** A corner added on the edge of an area nearest (x, z), where it is (within tol of the edge): its index, else null. */
export function addCorner(a: PavedArea, x: number, z: number, tol: number): number | null {
  const e = nearestEdge(a.points, x, z);
  if (e.d > tol) return null;
  a.points.splice(e.i + 1, 0, [x, z]);
  return e.i + 1;
}

/** A corner taken away (three kept); the whole area (j < 0). Whether anything was. */
export function removeCorner(o: TrackObjects, i: number, j: number): boolean {
  const a = o.areas?.[i];
  if (!a) return false;
  if (j < 0) {
    o.areas?.splice(i, 1);
    if (!o.areas?.length) delete o.areas;
    return true;
  }
  if (a.points.length <= 3) return false;
  a.points.splice(j, 1);
  return true;
}

/** A corner (j), or the whole area (j < 0), moved by (dx, dz). */
export function moveArea(a: PavedArea, j: number, dx: number, dz: number) {
  a.points = a.points.map((p, k) => (j < 0 || k === j ? [p[0] + dx, p[1] + dz] : p));
}

/** A row of parking bays along an area's longest edge: a line square to it every bay metres (as many as fit, the row in
 * its middle), depth metres into the area, white, named PARK_<area>_<n>. */
export function parkingMarks(a: PavedArea, bay = BAY[0], depth = BAY[1]): PaintMark[] {
  const n = a.points.length;
  if (n < 3 || bay <= 0 || depth <= 0) return [];
  let best = 0;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const p = a.points[i] as Vec2;
    const q = a.points[(i + 1) % n] as Vec2;
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d > len) {
      len = d;
      best = i;
    }
  }
  const p = a.points[best] as Vec2;
  const q = a.points[(best + 1) % n] as Vec2;
  const t: Vec2 = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  // (into the area: the side its middle is on)
  const mid = middleOf(a.points);
  let nn: Vec2 = [-t[1], t[0]];
  if ((mid[0] - p[0]) * nn[0] + (mid[1] - p[1]) * nn[1] < 0) nn = [-nn[0], -nn[1]];
  const count = Math.floor(len / bay);
  if (!count) return [];
  const from = (len - count * bay) / 2;
  const heading = Math.atan2(nn[0], nn[1]);
  return Array.from({ length: count + 1 }, (_, k) => ({
    name: `PARK_${a.name}_${k + 1}`,
    p: [p[0] + t[0] * (from + k * bay), p[1] + t[1] * (from + k * bay)] as Vec2,
    heading,
    length: depth,
    width: PARK_LINE,
    colour: 'white' as const,
    style: 'solid' as const,
  }));
}

/** The name a new area takes: AREA_<n>, free among taken. */
export function areaName(taken: Iterable<string>): string {
  const have = new Set(taken);
  let n = 1;
  while (have.has(`${PREFIX}${n}`)) n++;
  return `${PREFIX}${n}`;
}
