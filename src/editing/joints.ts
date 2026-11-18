// Joints: a road's first or last node bound to another road's first or last node ('joint' on both:
// {road, node: 'start' | 'end'}). The two ends kept at one point, one road going straight on into the
// other, as wide each side, their end rows the same way across (start_left / end_left): the build makes
// the one's last row the other's first, point for point, with no gap between their meshes.
//
// These change roads in place: call them on drafts (see store/editorStore.ts).

import { JOIN_REACH } from '../domain/constants';
import type { Road, RoadEnd, Vec2 } from '../domain/types';

const find = (roads: readonly Road[], name: string) => roads.find((r) => r.name === name);

/** Which end node i is ('start', 'end'), or null for a node between. */
export function endOf(road: Road, i: number): RoadEnd | null {
  if (!road.curve) return null;
  if (i === 0) return 'start';
  return i === road.curve.length - 1 ? 'end' : null;
}

export const endIndex = (road: Road, end: RoadEnd): number => (end === 'start' ? 0 : (road.curve?.length ?? 1) - 1);

/** The way a road goes at its end node i (unit). */
export function travelAt(road: Road, i: number): Vec2 {
  const curve = road.curve ?? [];
  const nd = curve[i];
  const st = i === 0;
  let h = st ? nd.out : nd.in;
  let m = Math.hypot(h[0], h[1]);
  if (m < 1e-9) {
    const q = curve[st ? 1 : i - 1].p;
    h = [q[0] - nd.p[0], q[1] - nd.p[1]];
    m = Math.hypot(h[0], h[1]) || 1;
  }
  return st ? [h[0] / m, h[1] / m] : [-h[0] / m, -h[1] / m];
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Its end row at node i: across the way t. */
export function setEndLeft(road: Road, i: number, t: Vec2): void {
  road[i === 0 ? 'start_left' : 'end_left'] = [round6(-t[1]), round6(t[0])];
}

/** dst's end node j made to go on from src's end node i. */
export function follow(src: Road, i: number, dst: Road, j: number): void {
  if (!src.curve || !dst.curve) return;
  const a = src.curve[i];
  const b = dst.curve[j];
  const ta = travelAt(src, i);
  const sameWay = (i === 0) !== (j === 0); // (one ends there, the other starts: they run the same way)
  const tb: Vec2 = sameWay ? ta : [-ta[0], -ta[1]];
  b.p = [a.p[0], a.p[1]];
  const key = j === 0 ? 'out' : 'in';
  const L = Math.hypot(b[key][0], b[key][1]) || 3;
  const sg = j === 0 ? 1 : -1;
  b[key] = [tb[0] * L * sg, tb[1] * L * sg];
  if (sameWay) {
    b.left = a.left;
    b.right = a.right;
  } else {
    b.left = a.right;
    b.right = a.left;
  }
  setEndLeft(src, i, ta);
  setEndLeft(dst, j, tb);
}

/** After a change to a road, the ends joined to its ends follow them (those roads changed in shape too). */
export function syncJoints(roads: readonly Road[], road: Road): void {
  if (!road.curve) return;
  for (const i of [0, road.curve.length - 1]) {
    const jt = road.curve[i].joint;
    const other = jt && find(roads, jt.road);
    if (!jt || !other?.curve) continue;
    follow(road, i, other, endIndex(other, jt.node));
    other.moved = true;
  }
}

/** A road changed: in shape (moved), its joined ends following it. */
export function touch(roads: readonly Road[], road: Road, shape = true): void {
  if (!shape) return;
  road.moved = true;
  syncJoints(roads, road);
}

export interface NearestEnd {
  road: Road;
  j: number;
  d: number;
}

/** The nearest other road's end to road's node i. */
export function nearestEnd(roads: readonly Road[], road: Road, i: number): NearestEnd | null {
  const nd = road.curve?.[i];
  if (!nd) return null;
  let best: NearestEnd | null = null;
  for (const r of roads) {
    if (r.name === road.name || r.along || !r.curve) continue;
    for (const j of [0, r.curve.length - 1]) {
      const d = Math.hypot(r.curve[j].p[0] - nd.p[0], r.curve[j].p[1] - nd.p[1]);
      if (!best || d < best.d) best = { road: r, j, d };
    }
  }
  return best;
}

/** The two ends unbound (on both roads). */
export function unjoin(roads: readonly Road[], road: Road, i: number): void {
  const jt = road.curve?.[i]?.joint;
  if (!jt || !road.curve) return;
  const other = find(roads, jt.road);
  if (other?.curve) {
    const k = endIndex(other, jt.node);
    if (other.curve[k].joint?.road === road.name) delete other.curve[k].joint;
  }
  delete road.curve[i].joint;
}

export type JoinResult = { ok: true; other: string; otherEnd: RoadEnd; moved: number } | { ok: false; why: string };

/** Road's end node i joined to the nearest other road's end (within JOIN_REACH): onto it, the other as it is. */
export function joinNearest(roads: readonly Road[], road: Road, i: number): JoinResult {
  const end = endOf(road, i);
  if (!end || !road.curve) return { ok: false, why: "Only a road's first or last node joins another road's end." };
  const best = nearestEnd(roads, road, i);
  if (!best || best.d > JOIN_REACH)
    return { ok: false, why: `No other road's end within ${JOIN_REACH} m of this one.` };
  const otherEnd = endOf(best.road, best.j) as RoadEnd;
  unjoin(roads, road, i);
  if (best.road.curve?.[best.j].joint) unjoin(roads, best.road, best.j);
  follow(best.road, best.j, road, i);
  road.curve[i].joint = { road: best.road.name, node: otherEnd };
  const otherCurve = best.road.curve as NonNullable<Road['curve']>;
  otherCurve[best.j].joint = { road: road.name, node: end };
  best.road.moved = true;
  road.moved = true;
  return { ok: true, other: best.road.name, otherEnd, moved: best.d };
}

/** A road renamed: the joints naming it follow. */
export function renameInJoints(roads: readonly Road[], was: string, now: string): void {
  for (const r of roads) for (const n of r.curve ?? []) if (n.joint?.road === was) n.joint.road = now;
}
