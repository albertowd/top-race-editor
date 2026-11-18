// Roads built from their descriptions: a road's middle and its widths each side, its mesh made from them as the
// track's own roads are (the track's roads.py, ported). Each step is numpy's as the Python takes it (its interp, its
// gradient over uneven steps, its unwrap), so a road's mesh comes out the same: the same points, the same faces.
//
// A road (roads.json's): {name, material, map: 'along' | 'flat', curve: [{p, in, out, left, right}, ...] | points:
// [[x, z, left, right], ...], start_left?, end_left?, heights?: {step, rows}, u_per_m?, v_per_m?}, or a run-off
// {name, along: {road, side, from, to}, width?, profile?, ease?, material?}.
import { above } from './layer';

/** metres: a column's width */
export const COL = 0.5;
/** metres between rows along a road */
export const ROW = 0.1;
/** degrees: a line turning more than this keeps a point more */
export const TURN = 6;
/** metres between a road's fine rows, square to its middle */
export const FINE = 0.1;
/** metres a road's top is over the ground */
export const ROAD = 0.02;
/** metres: the asphalt's texture, each way */
export const TEX = 5;
/** metres along a road between the rows of its heights */
export const HSTEP = 1;
/** metres from a road's end over which its rows turn into its end row */
export const END_BLEND = 4;
/** of a curve's radius: as far out as a road's side inside it goes */
export const INSIDE = 0.97;
/** metres each way a road's turning is measured over */
export const BASE = 0.2;

export interface Node {
  p: [number, number];
  in?: [number, number];
  out?: [number, number];
  left: number;
  right: number;
}

export interface RoadDesc {
  name: string;
  material?: string;
  map?: 'along' | 'flat';
  curve?: Node[];
  points?: number[][];
  start_left?: [number, number];
  end_left?: [number, number];
  heights?: { step: number; rows: number[][] } | null;
  u_per_m?: number;
  v_per_m?: number;
  along?: { road: string; side: 'left' | 'right'; from: number; to: number };
  width?: number;
  profile?: number[][];
  ease?: number;
  joins?: (string | null)[];
}

// ---- numpy's ways ----------------------------------------------------------------------------------------------

/** np.interp(x, xp, fp): fp[-1] at and past the last, fp[0] before the first. */
export function interp(x: number, xp: ArrayLike<number>, fp: ArrayLike<number>): number {
  const n = xp.length;
  const last = xp[n - 1] as number;
  if (!(x >= (xp[0] as number))) return x < (xp[0] as number) ? (fp[0] as number) : Number.NaN;
  if (x >= last) return fp[n - 1] as number;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xp[mid] as number) <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xp[lo] as number;
  if (x === x0) return fp[lo] as number;
  const slope = ((fp[lo + 1] as number) - (fp[lo] as number)) / ((xp[lo + 1] as number) - x0);
  return slope * (x - x0) + (fp[lo] as number);
}

/** np.arange(start, stop, step) */
function arange(start: number, stop: number, step: number): number[] {
  const n = Math.max(Math.ceil((stop - start) / step), 0);
  return Array.from({ length: n }, (_, i) => start + i * step);
}

/** np.linspace(a, b, n) */
export function linspace(a: number, b: number, n: number): number[] {
  if (n === 1) return [a];
  const step = (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : i * step + a));
}

/** np.gradient(f, s): second order inside over uneven steps, first order at the ends. */
export function gradient(f: ArrayLike<number>, s: ArrayLike<number>): Float64Array {
  const n = f.length;
  const out = new Float64Array(n);
  if (n < 2) return out;
  out[0] = ((f[1] as number) - (f[0] as number)) / ((s[1] as number) - (s[0] as number));
  out[n - 1] = ((f[n - 1] as number) - (f[n - 2] as number)) / ((s[n - 1] as number) - (s[n - 2] as number));
  for (let i = 1; i < n - 1; i++) {
    const dx1 = (s[i] as number) - (s[i - 1] as number);
    const dx2 = (s[i + 1] as number) - (s[i] as number);
    const a = -dx2 / (dx1 * (dx1 + dx2));
    const b = (dx2 - dx1) / (dx1 * dx2);
    const c = dx1 / (dx2 * (dx1 + dx2));
    out[i] = a * (f[i - 1] as number) + b * (f[i] as number) + c * (f[i + 1] as number);
  }
  return out;
}

/** numpy's float mod (the sign of the divisor). */
function pymod(a: number, b: number): number {
  let m = a % b;
  if (m !== 0 && b < 0 !== m < 0) m += b;
  return m;
}

/** np.unwrap(p): jumps of more than pi taken out. */
export function unwrap(p: ArrayLike<number>): Float64Array {
  const n = p.length;
  const out = Float64Array.from(p);
  let correct = 0;
  for (let i = 1; i < n; i++) {
    const dd = (p[i] as number) - (p[i - 1] as number);
    let ddmod = pymod(dd + Math.PI, 2 * Math.PI) - Math.PI;
    if (ddmod === -Math.PI && dd > 0) ddmod = Math.PI;
    const fix = Math.abs(dd) < Math.PI ? 0 : ddmod - dd;
    correct += fix;
    out[i] = (p[i] as number) + correct;
  }
  return out;
}

/** np.searchsorted(a, v, side) */
export function searchsorted(a: ArrayLike<number>, v: number, side: 'left' | 'right'): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (side === 'left' ? (a[mid] as number) < v : (a[mid] as number) <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** scipy's maximum_filter1d (mode reflect). */
function maximum1d(a: Float64Array, size: number): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  const start = -(size >> 1);
  const at = (i: number) => {
    const period = 2 * n;
    let k = ((i % period) + period) % period;
    if (k >= n) k = period - 1 - k;
    return a[k] as number;
  };
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    for (let j = 0; j < size; j++) best = Math.max(best, at(i + start + j));
    out[i] = best;
  }
  return out;
}

const norm2 = (x: number, z: number) => Math.sqrt(x * x + z * z);
const smooth = (t: number) => t * t * (3 - 2 * t);

// ---- a road's middle -------------------------------------------------------------------------------------------

/** A smooth curve through points (x, z, left, right): centripetal Catmull-Rom, n points a span. */
export function spline(P: number[][], n = 8): number[][] {
  const d = P[0]?.length ?? 0;
  if (P.length < 3) {
    const first = P[0] as number[];
    const last = P[P.length - 1] as number[];
    return linspace(0, 1, n * (P.length - 1) + 1).map((t) =>
      first.map((v, k) => v * (1 - t) + (last[k] as number) * t),
    );
  }
  const Q = [
    (P[0] as number[]).map((v, k) => 2 * v - ((P[1] as number[])[k] as number)),
    ...P,
    (P[P.length - 1] as number[]).map((v, k) => 2 * v - ((P[P.length - 2] as number[])[k] as number)),
  ];
  const dist = (a: number[], b: number[]) =>
    Math.max(Math.sqrt(norm2((b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number))), 1e-6);
  const out: number[][] = [];
  for (let i = 1; i < Q.length - 2; i++) {
    const p0 = Q[i - 1] as number[];
    const p1 = Q[i] as number[];
    const p2 = Q[i + 1] as number[];
    const p3 = Q[i + 2] as number[];
    const t0 = 0;
    const t1 = dist(p0, p1);
    const t2 = t1 + dist(p1, p2);
    const t3 = t1 + dist(p1, p2) + dist(p2, p3);
    // (np.linspace(t1, t2, n, endpoint=False))
    const step = (t2 - t1) / n;
    for (let m = 0; m < n; m++) {
      const t = m * step + t1;
      const row: number[] = [];
      for (let k = 0; k < d; k++) {
        const a1 = ((t1 - t) / (t1 - t0)) * (p0[k] as number) + ((t - t0) / (t1 - t0)) * (p1[k] as number);
        const a2 = ((t2 - t) / (t2 - t1)) * (p1[k] as number) + ((t - t1) / (t2 - t1)) * (p2[k] as number);
        const a3 = ((t3 - t) / (t3 - t2)) * (p2[k] as number) + ((t - t2) / (t3 - t2)) * (p3[k] as number);
        const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        row.push(((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2);
      }
      out.push(row);
    }
  }
  out.push([...(P[P.length - 1] as number[])]);
  return out;
}

/** A curve of Bezier pieces as points along it (x, z, left, right), about step metres apart; and where along them
 * each node is. */
export function bezier(curve: Node[], step = 0.02): { C: number[][]; at: number[] } {
  const out: number[][] = [];
  const at = [0];
  let n = 0;
  for (let k = 0; k + 1 < curve.length; k++) {
    const a = curve[k] as Node;
    const b = curve[k + 1] as Node;
    const [x0, z0] = a.p;
    const [x3, z3] = b.p;
    const x1 = x0 + (a.out?.[0] ?? 0);
    const z1 = z0 + (a.out?.[1] ?? 0);
    const x2 = x3 + (b.in?.[0] ?? 0);
    const z2 = z3 + (b.in?.[1] ?? 0);
    const L = norm2(x1 - x0, z1 - z0) + norm2(x2 - x1, z2 - z1) + norm2(x3 - x2, z3 - z2);
    const ts = linspace(0, 1, Math.max(Math.trunc(L / step), 2) + 1);
    const seg = ts.map((t) => {
      const u = 1 - t;
      const c0 = u ** 3;
      const c1 = 3 * u ** 2 * t;
      const c2 = 3 * u * t ** 2;
      const c3 = t ** 3;
      const e = t * t * (3 - 2 * t);
      return [
        c0 * x0 + c1 * x1 + c2 * x2 + c3 * x3,
        c0 * z0 + c1 * z1 + c2 * z2 + c3 * z3,
        a.left + (b.left - a.left) * e,
        a.right + (b.right - a.right) * e,
      ];
    });
    if (out.length) seg.shift();
    out.push(...seg);
    n += seg.length;
    at.push(n - 1);
  }
  return { C: out, at };
}

export interface Centre {
  /** points along its middle: x, z, left, right */
  C: number[][];
  /** its length to each */
  s: Float64Array;
  /** how far along each of its nodes (points) is */
  nodes: number[];
}

const centres = new Map<string, Centre>();

/** A road's middle as points close along it, its length to each, and how far along each node is. */
export function centre(road: RoadDesc): Centre {
  const key = JSON.stringify(road.curve ?? (road.points ?? []).map((q) => q.slice(0, 4)));
  let c = centres.get(key);
  if (!c) {
    let C: number[][];
    let at: number[];
    if (road.curve?.length) ({ C, at } = bezier(road.curve));
    else {
      C = spline(
        (road.points ?? []).map((q) => q.slice(0, 4)),
        16,
      );
      at = (road.points ?? []).map((_, i) => i * 16);
    }
    const s = new Float64Array(C.length);
    for (let i = 1; i < C.length; i++) {
      const a = C[i - 1] as number[];
      const b = C[i] as number[];
      s[i] = (s[i - 1] as number) + norm2((b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number));
    }
    c = { C, s, nodes: at.map((i) => s[Math.min(Math.max(i, 0), s.length - 1)] as number) };
    if (centres.size > 200) centres.clear();
    centres.set(key, c);
  }
  return c;
}

/** A road's fine rows: their middles, the way to their left (unit), their widths, how far along each. */
export interface Fine {
  mx: Float64Array;
  mz: Float64Array;
  lx: Float64Array;
  lz: Float64Array;
  wl: Float64Array;
  wr: Float64Array;
  at: Float64Array;
}

/** A road's middle without its repeated points: x, z and its widths, and its length to each. */
function stripped(road: RoadDesc) {
  const { C, s } = centre(road);
  const keep = C.map((_, i) => i === 0 || (s[i] as number) - (s[i - 1] as number) > 1e-9);
  const pick = (k: number) => Float64Array.from(C.filter((_, i) => keep[i]).map((r) => r[k] as number));
  return { x: pick(0), z: pick(1), l: pick(2), r: pick(3), s: Float64Array.from([...s].filter((_, i) => keep[i])) };
}

/** Unit tangents along a middle (np.gradient over its length), read at points how far along. */
function tangentsAt(x: Float64Array, z: Float64Array, s: Float64Array, at: ArrayLike<number>) {
  const gx = gradient(x, s);
  const gz = gradient(z, s);
  for (let i = 0; i < gx.length; i++) {
    const m = Math.max(norm2(gx[i] as number, gz[i] as number), 1e-9);
    gx[i] = (gx[i] as number) / m;
    gz[i] = (gz[i] as number) / m;
  }
  const n = at.length;
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = interp(at[i] as number, s, gx);
    const b = interp(at[i] as number, s, gz);
    const m = Math.max(norm2(a, b), 1e-9);
    tx[i] = a / m;
    tz[i] = b / m;
  }
  return { tx, tz };
}

const fines = new Map<string, [Fine, Fine]>();

/** A road's fine rows (FINE apart along it): inside a curve tighter than the road is wide, no farther out than the
 * curve's middle (raw: the widths as described, which its heights are kept across). */
export function fine(road: RoadDesc, raw = false): Fine {
  const key = JSON.stringify([
    road.curve ?? (road.points ?? []).map((q) => q.slice(0, 4)),
    road.start_left ?? null,
    road.end_left ?? null,
  ]);
  let f = fines.get(key);
  if (!f) {
    const m = stripped(road);
    const L = m.s[m.s.length - 1] as number;
    const at = Float64Array.from([...arange(0, L, FINE), L]);
    const mx = Float64Array.from(at, (a) => interp(a, m.s, m.x));
    const mz = Float64Array.from(at, (a) => interp(a, m.s, m.z));
    const { tx, tz } = tangentsAt(m.x, m.z, m.s, at);
    const { lx, lz } = endsTurned(
      road,
      Float64Array.from(tz, (v) => -v),
      Float64Array.from(tx),
      at,
    );
    const wl0 = Float64Array.from(at, (a) => interp(a, m.s, m.l));
    const wr0 = Float64Array.from(at, (a) => interp(a, m.s, m.r));
    const [wl, wr] = insideWidths(tx, tz, at, wl0, wr0);
    f = [
      { mx, mz, lx, lz, wl, wr, at },
      { mx, mz, lx, lz, wl: wl0, wr: wr0, at },
    ];
    if (fines.size > 200) fines.clear();
    fines.set(key, f);
  }
  return raw ? f[1] : f[0];
}

/** A road's widths where it turns tighter than it is wide: the side inside the curve no farther out than INSIDE of
 * the curve's radius. */
export function insideWidths(
  tx: Float64Array,
  tz: Float64Array,
  at: Float64Array,
  wl: Float64Array,
  wr: Float64Array,
): [Float64Array, Float64Array] {
  const n = at.length;
  if (n < 3) return [wl, wr];
  const h = unwrap(Float64Array.from(tx, (x, i) => Math.atan2(tz[i] as number, x)));
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.min(Math.max(searchsorted(at, (at[i] as number) - BASE, 'right') - 1, 0), n - 1);
    const b = Math.min(Math.max(searchsorted(at, (at[i] as number) + BASE, 'left'), 0), n - 1);
    const v = ((h[b] as number) - (h[a] as number)) / Math.max((at[b] as number) - (at[a] as number), 1e-9);
    k[i] = Math.abs(v) > 1e3 ? 0 : v;
  }
  const kl = maximum1d(
    Float64Array.from(k, (v) => Math.max(v, 0)),
    5,
  );
  const kr = maximum1d(
    Float64Array.from(k, (v) => Math.max(-v, 0)),
    5,
  );
  const L = Float64Array.from(wl, (w, i) =>
    (kl[i] as number) > 1e-6 ? Math.min(w, INSIDE / Math.max(kl[i] as number, 1e-6)) : w,
  );
  const R = Float64Array.from(wr, (w, i) =>
    (kr[i] as number) > 1e-6 ? Math.min(w, INSIDE / Math.max(kr[i] as number, 1e-6)) : w,
  );
  return [L, R];
}

/** Its rows' way across turned, within END_BLEND of each end, into its end rows' (start_left, end_left). */
function endsTurned(road: RoadDesc, lx: Float64Array, lz: Float64Array, at: Float64Array) {
  let x = lx;
  let z = lz;
  const n = at.length;
  for (const [key, d] of [
    ['start_left', (i: number) => (at[i] as number) - (at[0] as number)],
    ['end_left', (i: number) => (at[n - 1] as number) - (at[i] as number)],
  ] as const) {
    const e = road[key];
    if (!e) continue;
    const nx = new Float64Array(n);
    const nz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = smooth(Math.min(Math.max(1 - d(i) / END_BLEND, 0), 1));
      const a = (x[i] as number) * (1 - w) + e[0] * w;
      const b = (z[i] as number) * (1 - w) + e[1] * w;
      const m = Math.max(norm2(a, b), 1e-9);
      nx[i] = a / m;
      nz[i] = b / m;
    }
    x = nx;
    z = nz;
  }
  return { lx: x, lz: z };
}

/** A road's lines along it, left edge to right edge, as offsets at each fine row (+ to the left). */
export function lines(wl: Float64Array, wr: Float64Array): Float64Array[] {
  const kl = Math.ceil(Math.max(...wl) / COL - 1e-6);
  const kr = Math.ceil(Math.max(...wr) / COL - 1e-6);
  const out = [wl];
  for (let k = kl - 1; k > 0; k--) out.push(Float64Array.from(wl, (w) => Math.min(k * COL, w)));
  out.push(new Float64Array(wl.length));
  for (let k = 1; k < kr; k++) out.push(Float64Array.from(wr, (w) => -Math.min(k * COL, w)));
  out.push(Float64Array.from(wr, (w) => -w));
  return out;
}

/** Of a line's points at the fine rows, those it keeps: one every ROW along it, closer where it turns more than
 * TURN, its ends. */
function pick(qx: Float64Array, qz: Float64Array, ang: Float64Array): number[] {
  const keep = [0];
  let run = 0;
  let a0 = ang[0] as number;
  const n = qx.length;
  for (let r = 1; r < n; r++) {
    run += norm2((qx[r] as number) - (qx[r - 1] as number), (qz[r] as number) - (qz[r - 1] as number));
    if (run >= ROW - 1e-6 || Math.abs((ang[r] as number) - a0) > TURN || r === n - 1) {
      keep.push(r);
      run = 0;
      a0 = ang[r] as number;
    }
  }
  if (keep.length > 2) {
    const a = keep[keep.length - 1] as number;
    const b = keep[keep.length - 2] as number;
    if (norm2((qx[a] as number) - (qx[b] as number), (qz[a] as number) - (qz[b] as number)) < ROW * 0.3)
      keep.splice(keep.length - 2, 1);
  }
  return keep;
}

/** A road's mesh: points (x, y, z), their mapping (u, v), faces (three corners each, facing up). */
export interface RoadMesh {
  P: Float64Array;
  U: Float64Array;
  F: Int32Array;
}

/** A road's mesh: its top as high as its heights say, or height(x, z) + ROAD when given. Its lines along it each
 * keep their own points, the strips between them zipped through the fine rows: no point but is shared. */
export function mesh(road: RoadDesc, height?: (x: number, z: number) => number): RoadMesh {
  const f = fine(road);
  const n = f.at.length;
  const ang = Float64Array.from({ length: n }, (_, i) => Math.atan2(-(f.lx[i] as number), f.lz[i] as number));
  const deg = unwrap(ang).map((a) => a * (180 / Math.PI));
  const px: number[] = [];
  const pz: number[] = [];
  const us: number[] = [];
  const so: number[] = [];
  const kept: [number[], number[]][] = [];
  const uPer = road.u_per_m ?? 1 / TEX;
  const vPer = road.v_per_m ?? 1 / TEX;
  const along = (road.map ?? 'along') === 'along';
  for (const off of lines(f.wl, f.wr)) {
    const qx = Float64Array.from(
      { length: n },
      (_, i) => (f.mx[i] as number) + (f.lx[i] as number) * (off[i] as number),
    );
    const qz = Float64Array.from(
      { length: n },
      (_, i) => (f.mz[i] as number) + (f.lz[i] as number) * (off[i] as number),
    );
    const keep = pick(qx, qz, deg);
    const idx: number[] = [];
    for (const r of keep) {
      idx.push(px.length);
      px.push(qx[r] as number);
      pz.push(qz[r] as number);
      so.push(f.at[r] as number, off[r] as number);
      if (along) us.push(((off[r] as number) - (f.wl[r] as number)) * uPer, (f.at[r] as number) * vPer);
      else us.push((qx[r] as number) / TEX, (qz[r] as number) / TEX);
    }
    kept.push([keep, idx]);
  }
  const F: number[] = [];
  for (let l = 0; l + 1 < kept.length; l++) {
    // (two lines zipped along: on along the one whose next point is at the nearer fine row, a quad split the same
    // way where both have one at the same)
    const [ra, ia] = kept[l] as [number[], number[]];
    const [rb, ib] = kept[l + 1] as [number[], number[]];
    let i = 0;
    let j = 0;
    while (i < ia.length - 1 || j < ib.length - 1) {
      const na = i < ia.length - 1 ? (ra[i + 1] as number) : Infinity;
      const nb = j < ib.length - 1 ? (rb[j + 1] as number) : Infinity;
      if (na < nb) {
        F.push(ia[i] as number, ib[j] as number, ia[i + 1] as number);
        i++;
      } else if (nb < na) {
        F.push(ia[i] as number, ib[j] as number, ib[j + 1] as number);
        j++;
      } else {
        F.push(
          ia[i] as number,
          ib[j] as number,
          ib[j + 1] as number,
          ia[i] as number,
          ib[j + 1] as number,
          ia[i + 1] as number,
        );
        i++;
        j++;
      }
    }
  }
  // (the strips where a column runs on the edge have no width: out, and the points left over with them)
  const crossY = (a: number, b: number, c: number) =>
    ((pz[b] as number) - (pz[a] as number)) * ((px[c] as number) - (px[a] as number)) -
    ((px[b] as number) - (px[a] as number)) * ((pz[c] as number) - (pz[a] as number));
  const faces: number[] = [];
  for (let k = 0; k < F.length; k += 3)
    if (Math.abs(crossY(F[k] as number, F[k + 1] as number, F[k + 2] as number)) > 1e-6)
      faces.push(F[k] as number, F[k + 1] as number, F[k + 2] as number);
  const used = [...new Set(faces)].sort((a, b) => a - b);
  const remap = new Int32Array(px.length).fill(-1);
  used.forEach((v, i) => {
    remap[v] = i;
  });
  const m = used.length;
  const P = new Float64Array(m * 3);
  const U = new Float64Array(m * 2);
  const S = new Float64Array(m);
  const O = new Float64Array(m);
  used.forEach((v, i) => {
    P[i * 3] = px[v] as number;
    P[i * 3 + 2] = pz[v] as number;
    U[i * 2] = us[v * 2] as number;
    U[i * 2 + 1] = us[v * 2 + 1] as number;
    S[i] = so[v * 2] as number;
    O[i] = so[v * 2 + 1] as number;
  });
  const out = Int32Array.from(faces, (v) => remap[v] as number);
  if (road.heights && !height) {
    const h = heightAt(road, S, O);
    for (let i = 0; i < m; i++) P[i * 3 + 1] = h[i] as number;
  } else if (height)
    // (ROAD over the ground along its normal: layer.ts)
    for (let i = 0; i < m; i++) P[i * 3 + 1] = above(height, P[i * 3] as number, P[i * 3 + 2] as number, ROAD);
  for (let k = 0; k < out.length; k += 3) {
    const a = out[k] as number;
    const b = out[k + 1] as number;
    const c = out[k + 2] as number;
    const up =
      ((P[b * 3 + 2] as number) - (P[a * 3 + 2] as number)) * ((P[c * 3] as number) - (P[a * 3] as number)) -
      ((P[b * 3] as number) - (P[a * 3] as number)) * ((P[c * 3 + 2] as number) - (P[a * 3 + 2] as number));
    if (up < 0) {
      out[k] = c;
      out[k + 2] = a;
    }
  }
  return { P, U, F: out };
}

// ---- its heights -----------------------------------------------------------------------------------------------

/** Where a road's heights are kept across it at a point, left edge to right (+ to the left): every COL in from its
 * left edge, its right edge the last. */
export function across(wl: number, wr: number): number[] {
  return [...arange(0, wl + wr - 1e-6, COL).map((d) => wl - d), -wr];
}

/** A road's top's height at points how far along (at) and across (off, + to the left) it, from its heights. */
export function heightAt(road: RoadDesc, at: ArrayLike<number>, off: ArrayLike<number>): Float64Array {
  const H = road.heights;
  if (!H) throw new Error(`${road.name}: no heights`);
  const { step, rows } = H;
  const f = fine(road, true);
  const end = f.at[f.at.length - 1] as number;
  const st = [...Array.from({ length: rows.length - 1 }, (_, i) => i * step), end];
  const W = st.map((a) => [interp(a, f.at, f.wl), interp(a, f.at, f.wr)] as const);
  const across1 = (k: number) => {
    let a = across(...(W[k] as readonly [number, number]));
    const row = rows[k] as number[];
    if (row.length !== a.length) a = linspace(a[0] as number, a[a.length - 1] as number, row.length);
    return { a: a.reverse(), row: [...row].reverse() };
  };
  const out = new Float64Array(at.length);
  for (let p = 0; p < at.length; p++) {
    const s = at[p] as number;
    const i = Math.min(Math.max(searchsorted(st, s, 'right') - 1, 0), rows.length - 2);
    const t = Math.min(
      Math.max((s - (st[i] as number)) / Math.max((st[i + 1] as number) - (st[i] as number), 1e-9), 0),
      1,
    );
    const A = across1(i);
    const B = across1(i + 1);
    const o = off[p] as number;
    out[p] = interp(o, A.a, A.row) * (1 - t) + interp(o, B.a, B.row) * t;
  }
  return out;
}

/** A road's middle and the way to its left (unit) at how far along it. */
export function fineAt(road: RoadDesc, at: ArrayLike<number>) {
  const m = stripped(road);
  const { tx, tz } = tangentsAt(m.x, m.z, m.s, at);
  return {
    mx: Float64Array.from(at, (a) => interp(a, m.s, m.x)),
    mz: Float64Array.from(at, (a) => interp(a, m.s, m.z)),
    lx: Float64Array.from(tz, (v) => -v),
    lz: tx,
  };
}

// ---- run-offs --------------------------------------------------------------------------------------------------

/** A run-off's width at how far along its road: its profile (eased point to point), or its width all along; from
 * nothing at its ends over its ease. */
export function alongWidth(desc: RoadDesc, s: number): number {
  const al = desc.along;
  if (!al) throw new Error(`${desc.name}: not a run-off`);
  const prof = [...(desc.profile ?? [])].sort(
    (a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number),
  );
  let w: number;
  if (prof.length === 1) w = (prof[0] as number[])[1] as number;
  else if (prof.length) {
    const xs = prof.map((p) => p[0] as number);
    const ws = prof.map((p) => p[1] as number);
    const i = Math.min(Math.max(searchsorted(xs, s, 'left') - 1, 0), Math.max(xs.length - 2, 0));
    const t = Math.min(
      Math.max((s - (xs[i] as number)) / Math.max((xs[i + 1] as number) - (xs[i] as number), 1e-9), 0),
      1,
    );
    w = (ws[i] as number) + ((ws[i + 1] as number) - (ws[i] as number)) * t * t * (3 - 2 * t);
  } else w = desc.width ?? 2;
  const e = Math.min(Math.max(Math.min(s - al.from, al.to - s) / Math.max(desc.ease ?? 8, 1e-6), 0), 1);
  return w * e * e * (3 - 2 * e);
}

/** A run-off as a road of its own: its middle its road's edge (a point every metre), all its width outward. */
export function alongRoad(desc: RoadDesc, roads: Record<string, RoadDesc>): RoadDesc {
  const al = desc.along;
  if (!al) throw new Error(`${desc.name}: not a run-off`);
  const parent = roads[al.road];
  if (!parent) throw new Error(`${desc.name}: no road ${al.road}`);
  const f = fine(parent);
  const sgn = al.side === 'left' ? 1 : -1;
  const s = [...arange(al.from, al.to, 1), al.to];
  const at = fineAt(parent, s);
  const points = s.map((a, i) => {
    const wSide = interp(a, f.at, al.side === 'left' ? f.wl : f.wr);
    const ex = (at.mx[i] as number) + (at.lx[i] as number) * (sgn * wSide);
    const ez = (at.mz[i] as number) + (at.lz[i] as number) * (sgn * wSide);
    const w = alongWidth(desc, a);
    return [ex, ez, sgn > 0 ? w : 0, sgn > 0 ? 0 : w];
  });
  const out: RoadDesc = { name: desc.name, material: desc.material ?? parent.material, map: 'flat', points };
  if (desc.heights) out.heights = desc.heights;
  return out;
}

/** A road as its mesh is made of it: a run-off as the road of its own it is. */
export const asBuilt = (r: RoadDesc, roads: Record<string, RoadDesc>): RoadDesc => (r.along ? alongRoad(r, roads) : r);

/** The roads' names in the order they are built in, each over those after it: roads.json's order, a road the roads
 * it joins or lies along always after them. */
export function priority(roads: Record<string, RoadDesc>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const put = (name: string, path: string[]) => {
    const r = roads[name];
    if (seen.has(name) || !r || path.includes(name)) return;
    for (const x of [...(r.joins ?? []), ...(r.along ? [r.along.road] : [])]) if (x) put(x, [...path, name]);
    seen.add(name);
    out.push(name);
  };
  for (const name of Object.keys(roads)) put(name, []);
  return out;
}

/** A road's outline as built: its edges along its fine rows (a ring, x and z). */
export function outline(road: RoadDesc, roads: Record<string, RoadDesc>): number[][] {
  const f = fine(asBuilt(road, roads));
  const n = f.at.length;
  const left = Array.from({ length: n }, (_, i) => [
    (f.mx[i] as number) + (f.lx[i] as number) * (f.wl[i] as number),
    (f.mz[i] as number) + (f.lz[i] as number) * (f.wl[i] as number),
  ]);
  const right = Array.from({ length: n }, (_, i) => [
    (f.mx[i] as number) - (f.lx[i] as number) * (f.wr[i] as number),
    (f.mz[i] as number) - (f.lz[i] as number) * (f.wr[i] as number),
  ]);
  return [...left, ...right.reverse()];
}
