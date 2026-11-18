import type { Road } from '../domain/types';
import { geo, type Lookup } from '../geometry/roads';
import { inBox, nearestOn, pointAt } from '../geometry/samples';

export interface SnapMark {
  x: number;
  z: number;
  label: string;
}

/**
 * What a point snaps to near (wx, wz), within tol metres: another road's end node first, else its centre
 * line or its edges, the nearest.
 */
export function snapPoint(
  roads: readonly Road[],
  find: Lookup,
  wx: number,
  wz: number,
  exclude: string | null,
  tol: number,
): SnapMark | null {
  let best: (SnapMark & { rank: number; d: number }) | null = null;
  const take = (x: number, z: number, label: string, rank: number) => {
    const d = Math.hypot(x - wx, z - wz);
    if (d <= tol && (!best || rank < best.rank || (rank === best.rank && d < best.d))) best = { x, z, label, rank, d };
  };
  for (const r of roads) {
    if (r.name === exclude || r.along) continue;
    const o = geo(r, find);
    if (!o || !inBox(o.box, wx, wz, tol)) continue;
    if (r.curve)
      for (const i of [0, r.curve.length - 1])
        take(r.curve[i].p[0], r.curve[i].p[1], `${r.name}'s ${i ? 'end' : 'start'}`, 0);
    const n = nearestOn(o, wx, wz);
    const q = pointAt(o, n.s);
    const s = n.s.toFixed(1);
    take(q.x, q.z, `${r.name}'s centre line, s ${s}`, 1);
    take(q.x + q.nx * q.l, q.z + q.nz * q.l, `${r.name}'s left edge, s ${s}`, 1);
    take(q.x - q.nx * q.r, q.z - q.nz * q.r, `${r.name}'s right edge, s ${s}`, 1);
  }
  if (!best) return null;
  const { x, z, label } = best;
  return { x, z, label };
}
