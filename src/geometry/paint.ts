import {
  BACK,
  BACK_RAMP,
  KERB_END_RISE,
  KERB_TAPER,
  KERB_WIDTH,
  kindOf,
  LINE_PAD,
  LINE_WIDTH,
  RAISED,
} from '../domain/constants';
import type { Kerb, KerbContinuation, PaintLine, Road, Side, Vec2 } from '../domain/types';
import { geo, type Lookup } from './roads';
import { nearestOn, pointAt, type RoadPoint, type Samples, span } from './samples';

/** Offsets out from a road's middle (to its left: positive) at a point along it. */
export type Offset = (q: RoadPoint, s?: number) => number;

export interface LineOffsets {
  sgn: number;
  a: Offset;
  b: Offset;
}

/** A line's two sides, out from the road's middle. */
export function lineOffsets(ln: PaintLine): LineOffsets {
  const sgn = ln.side === 'left' ? 1 : -1;
  const pad = ln.pad ?? LINE_PAD;
  const w = ln.w ?? LINE_WIDTH;
  const edge = (q: RoadPoint) => (sgn > 0 ? q.l : q.r);
  return { sgn, a: (q) => sgn * (edge(q) - pad + w / 2), b: (q) => sgn * (edge(q) - pad - w / 2) };
}

export interface KerbOffsets {
  sgn: number;
  /** its inner side */
  a: Offset;
  /** its ramp's outer side */
  m: Offset;
  /** its outer side (behind its concrete, for a ramp + concrete) */
  b: Offset;
  /** the outer side of all it covers: behind its back ramp, if it has one (else as b) */
  c: Offset;
}

/** Metres of back ramp behind a rumble: down to its road's height, where its kind ends raised (as the track's
 * build_kerbs makes it), unless the rumble says. */
export function backRampOf(k: Kerb): number {
  return KERB_END_RISE[kindOf(k.kind)] > RAISED ? Math.max(k.back_ramp ?? BACK_RAMP, 0) : 0;
}

/**
 * A rumble's inner and outer offsets; a triangle end (t0 at s0, t1 at s1) grows from nothing to its width
 * over 'taper' metres, all it covers alike (its back ramp too).
 */
export function kerbOffsets(
  k: Kerb,
  s0 = 0,
  s1 = Infinity,
  t0 = k.start === 'triangle',
  t1 = k.end === 'triangle',
): KerbOffsets {
  const sgn = k.side === 'left' ? 1 : -1;
  const inset = k.inset ?? 0;
  const w = k.width ?? KERB_WIDTH;
  const tp = Math.max(k.taper ?? KERB_TAPER, 1e-6);
  const f = (s: number) =>
    Math.min(t0 ? Math.min(Math.max((s - s0) / tp, 0), 1) : 1, t1 ? Math.min(Math.max((s1 - s) / tp, 0), 1) : 1);
  const back = kindOf(k.kind) === 'ramp_concrete' ? (k.back ?? BACK) : 0;
  const ramp = backRampOf(k);
  const edge = (q: RoadPoint) => (sgn > 0 ? q.l : q.r) - inset;
  const g = (s?: number) => (s == null ? 1 : f(s));
  return {
    sgn,
    a: (q) => sgn * edge(q),
    m: (q, s) => sgn * (edge(q) + w * g(s)),
    b: (q, s) => sgn * (edge(q) + (w + back) * g(s)),
    c: (q, s) => sgn * (edge(q) + (w + back + ramp) * g(s)),
  };
}

/** One stretch of a rumble, on one road. */
export interface KerbPiece {
  road: Road;
  o: Samples;
  s0: number;
  s1: number;
  side: Side;
  t0: boolean;
  t1: boolean;
  role: 'before' | 'main' | 'after';
  /** where along it the rumble's own end is (for a stretch on another road) */
  outer?: number;
}

/**
 * A rumble's pieces, each on its road: it may go on along another road whose edge carries on from its
 * road's ('before': before its start, 'after': after its end); its triangle ends at its own ends only.
 */
export function kerbPieces(road: Road, k: Kerb, find: Lookup): KerbPiece[] {
  const out: KerbPiece[] = [];
  const o = geo(road, find);
  if (!o) return out;
  const cont = (c: KerbContinuation, isStart: boolean): KerbPiece | null => {
    const r2 = find(c.road);
    const o2 = r2 && geo(r2, find);
    if (!r2 || !o2) return null;
    const [a, b] = span(o2, c.from, c.to);
    if (b <= a) return null;
    const tri = (isStart ? k.start : k.end) === 'triangle';
    const at0 = c.outer !== 'to';
    return {
      road: r2,
      o: o2,
      s0: a,
      s1: b,
      side: c.side,
      t0: at0 && tri,
      t1: !at0 && tri,
      role: isStart ? 'before' : 'after',
      outer: at0 ? a : b,
    };
  };
  if (k.before) {
    const pc = cont(k.before, true);
    if (pc) out.push(pc);
  }
  const [s0, s1] = span(o, k.from, k.to);
  if (s1 > s0)
    out.push({
      road,
      o,
      s0,
      s1,
      side: k.side,
      t0: !k.before && k.start === 'triangle',
      t1: !k.after && k.end === 'triangle',
      role: 'main',
    });
  if (k.after) {
    const pc = cont(k.after, false);
    if (pc) out.push(pc);
  }
  return out;
}

export const pieceOffsets = (k: Kerb, pc: KerbPiece): KerbOffsets =>
  kerbOffsets({ ...k, side: pc.side }, pc.s0, pc.s1, pc.t0, pc.t1);

/** A strip along a road from s0 to s1 between two offsets: its outline (metres). */
export function band(o: Samples, s0: number, s1: number, offA: Offset, offB: Offset, step = 0.25): Vec2[] {
  const pts: Vec2[] = [];
  const back: Vec2[] = [];
  const n = Math.max(2, Math.ceil((s1 - s0) / step));
  for (let k = 0; k <= n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    const q = pointAt(o, s);
    const A = offA(q, s);
    const B = offB(q, s);
    pts.push([q.x + q.nx * A, q.z + q.nz * A]);
    back.push([q.x + q.nx * B, q.z + q.nz * B]);
  }
  return pts.concat(back.toReversed());
}

interface EdgeMatch {
  dd: number;
  side: Side;
  sE: number;
  sM: number;
}

/**
 * Where another road (o2) takes on an edge ending at E going the way T: under the mouse (wx, wz), its edge
 * within a metre of E, going that way or straight back; which of its edges, and how far along E and the mouse are.
 */
function edgeMatch(o2: Samples, E: Vec2, T: Vec2, side: Side, wx: number, wz: number): EdgeMatch | null {
  const m = nearestOn(o2, wx, wz);
  const qm = pointAt(o2, m.s);
  if (m.d > Math.max(qm.l, qm.r) + 1.5) return null; // (the mouse on it)
  const e = nearestOn(o2, E[0], E[1]);
  const q2 = pointAt(o2, e.s);
  const dot = T[0] * q2.nz - T[1] * q2.nx;
  if (Math.abs(dot) < 0.9) return null; // (going the way this one goes, or straight back)
  // (the same edge of the two: this side going the same way, the other going back)
  const other: Side = side === 'left' ? 'right' : 'left';
  const side2 = dot > 0 ? side : other;
  const sg2 = side2 === 'left' ? 1 : -1;
  const w2 = sg2 > 0 ? q2.l : q2.r;
  const dd = Math.hypot(q2.x + q2.nx * sg2 * w2 - E[0], q2.z + q2.nz * sg2 * w2 - E[1]);
  return dd <= 1 ? { dd, side: side2, sE: e.s, sM: m.s } : null;
}

/**
 * Another road under (wx, wz) whose edge goes on from this road's edge where the rumble starts (or ends),
 * the same way: the rumble's piece along it, from there to the mouse.
 */
export function continuation(
  road: Road,
  k: Kerb,
  isStart: boolean,
  wx: number,
  wz: number,
  roads: readonly Road[],
  find: Lookup,
): KerbContinuation | null {
  const o = geo(road, find);
  if (!o) return null;
  const sj = isStart ? Math.max(0, k.from ?? 0) : Math.min(o.length, k.to ?? o.length);
  const q = pointAt(o, sj);
  const sgn = k.side === 'left' ? 1 : -1;
  const w = sgn > 0 ? q.l : q.r;
  const E: Vec2 = [q.x + q.nx * sgn * w, q.z + q.nz * sgn * w];
  const T: Vec2 = [q.nz, -q.nx];
  let best: (EdgeMatch & { r2: Road }) | null = null;
  for (const r2 of roads) {
    const o2 = r2 === road || r2.along ? null : geo(r2, find);
    const match = o2 && edgeMatch(o2, E, T, k.side, wx, wz);
    if (match && (!best || match.dd < best.dd)) best = { ...match, r2 };
  }
  if (!best) return null;
  const a = Math.min(best.sE, best.sM);
  const b = Math.max(best.sE, best.sM);
  if (b - a < 0.2) return null;
  return {
    road: best.r2.name,
    side: best.side,
    from: Math.round(a * 10) / 10,
    to: Math.round(b * 10) / 10,
    outer: best.sM < best.sE ? 'from' : 'to',
  };
}
