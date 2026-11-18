// A road's end edges: the row across it where it starts and where it ends (start_left / end_left: the way to its
// left there). Square to the road unless turned off it; turned, the road's last END_BLEND metres turn into it. The
// end's Bezier handle turns its edge with it (keepEdge). A joined end's edge is square, its other road's too
// (joints.ts's follow).
//
// These change roads in place: call them on drafts.

import type { Road, Vec2 } from '../domain/types';
import { endOf, travelAt } from './joints';

/** degrees off square an end's edge turns at most (beyond, it would run along the road) */
export const EDGE_MAX = 80;
/** degrees off square within which a dragged edge snaps square (and follows the road again) */
export const EDGE_SNAP = 1.5;

const DEG = 180 / Math.PI;
const key = (i: number) => (i === 0 ? 'start_left' : 'end_left');
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** The way to the road's left at its end node i, square to the road. */
export function squareLeft(road: Road, i: number): Vec2 {
  const t = travelAt(road, i);
  return [-t[1], t[0]];
}

/** The way to the road's left along its end edge at node i: as turned, or square. */
export function edgeLeft(road: Road, i: number): Vec2 {
  return road[key(i)] ?? squareLeft(road, i);
}

/** Degrees between a and b (b from a; + clockwise on the map). */
function between(a: Vec2, b: Vec2): number {
  return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * DEG;
}

/** How far the edge at end node i is turned off square, in degrees (+ clockwise on the map); 0 at a node between. */
export function edgeAngle(road: Road, i: number): number {
  const e = endOf(road, i) && road[key(i)];
  return e ? between(squareLeft(road, i), e) : 0;
}

/** The edge at end node i turned deg off square (within EDGE_MAX); null, or (snap) within EDGE_SNAP: square again,
 * following the road. */
export function turnEdge(road: Road, i: number, deg: number | null, snap = true): void {
  if (!endOf(road, i)) return;
  if (deg === null || !Number.isFinite(deg) || (snap && Math.abs(deg) < EDGE_SNAP)) {
    delete road[key(i)];
    return;
  }
  const a = Math.max(-EDGE_MAX, Math.min(EDGE_MAX, deg)) / DEG;
  const [x, z] = squareLeft(road, i);
  road[key(i)] = [round6(x * Math.cos(a) - z * Math.sin(a)), round6(x * Math.sin(a) + z * Math.cos(a))];
}

/** A change to a road's end node i (its handle turned) made with its edge turning with it: as far off square after
 * as before. A joined end is left to its joint. */
export function keepEdge(road: Road, i: number, change: () => void): void {
  const turned = !!endOf(road, i) && !road.curve?.[i]?.joint && !!road[key(i)];
  const before = turned ? edgeAngle(road, i) : 0;
  change();
  if (turned) turnEdge(road, i, before, false);
}
