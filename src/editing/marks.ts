// Paint marks: lines laid on the roads from a start, a way and a length. Where their ends are, what the mouse is
// on, the pieces a dotted one is painted in, and the edits to them (on drafts).

import { DASH, GAP } from '../domain/constants';
import type { PaintMark, Vec2 } from '../domain/types';

export const MARK_WIDTH = 0.1;
/** a new mark's length when it is clicked, not dragged (m) */
export const MARK_LENGTH = 1;
/** Shift: a mark's way kept to whole steps of this (radians: 15 degrees) */
export const MARK_SNAP = Math.PI / 12;

const wrap = (h: number) => Math.atan2(Math.sin(h), Math.cos(h));

/** The way a heading looks (x, z): from +z towards +x. */
const along = (h: number): Vec2 => [Math.sin(h), Math.cos(h)];

/** A mark's far end. */
export function markEnd(m: Pick<PaintMark, 'p' | 'heading' | 'length'>): Vec2 {
  const [ax, az] = along(m.heading);
  return [m.p[0] + ax * m.length, m.p[1] + az * m.length];
}

/** A mark's start (0) or far end (1). */
export const markPoint = (m: PaintMark, j: number): Vec2 => (j === 1 ? markEnd(m) : m.p);

export const markMiddle = (m: PaintMark): Vec2 => {
  const e = markEnd(m);
  return [(m.p[0] + e[0]) / 2, (m.p[1] + e[1]) / 2];
};

/** How far (x, z) is off a mark's line. */
export function offMark(m: PaintMark, x: number, z: number): number {
  const [ax, az] = along(m.heading);
  const t = Math.min(m.length, Math.max(0, (x - m.p[0]) * ax + (z - m.p[1]) * az));
  return Math.hypot(m.p[0] + ax * t - x, m.p[1] + az * t - z);
}

/** The pieces a mark is painted in, from and to metres along it: one if solid, dash after gap if dotted. */
export function markPieces(m: PaintMark): [number, number][] {
  if (m.style !== 'dotted') return [[0, m.length]];
  const dash = m.dash && m.dash > 0 ? m.dash : DASH;
  const gap = m.gap && m.gap > 0 ? m.gap : GAP;
  const out: [number, number][] = [];
  for (let s = 0; s < m.length - 1e-9; s += dash + gap) out.push([s, Math.min(s + dash, m.length)]);
  return out;
}

const snapped = (h: number, snap: boolean) => (snap ? Math.round(h / MARK_SNAP) * MARK_SNAP : h);

/** One end of a mark (0 its start, 1 its far end) dragged to (x, z), the other kept: it stretches and turns (snap:
 * its way to whole steps of MARK_SNAP, its length as dragged). */
export function moveMarkEnd(m: PaintMark, j: number, x: number, z: number, snap = false) {
  const fixed = j === 1 ? m.p : markEnd(m);
  const [dx, dz] = j === 1 ? [x - fixed[0], z - fixed[1]] : [fixed[0] - x, fixed[1] - z];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return;
  const heading = wrap(snapped(Math.atan2(dx, dz), snap));
  m.heading = heading;
  m.length = length;
  if (j !== 1) {
    const [ax, az] = along(heading);
    m.p = [fixed[0] - ax * length, fixed[1] - az * length];
  }
}

/** A mark turned about its start to look along heading. */
export function turnMark(m: PaintMark, heading: number) {
  m.heading = wrap(heading);
}
