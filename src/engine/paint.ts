// The paint and the rumbles laid along the roads (step 4): each road's edge lines (the track's roads.py's line_strip,
// dashes; each line whole as the editor draws it, on over another road, a rumble or a run-off it meets) and its
// rumbles (build_kerbs.py's geometry: each a strip of rows across it, its kind's profile, level with its road's edge
// and rising over it, its ends tapering in, going on along the roads its edge carries on into). Ported as the Python
// has them, numpy's ways and all, so they come out point for point.

import type { Vec2, WallNode } from '../domain/types';
import { chainPieces, legacyCurve, type Paintable, paintChains, pastSeam } from '../editing/marks';
import { upright } from './layer';
import { byCodePoint } from './order';
import { earClip, inside } from './polygon';
import { BASE, fine, heightAt, INSIDE, interp, linspace, outline, type RoadDesc, searchsorted, unwrap } from './roads';
import type { Surface } from './surface';

/** metres: an edge line's middle in from its road's edge, its width, how high over the road */
export const LINE_PAD = 0.2;
export const LINE_W = 0.12;
export const LINE_LIFT = 0.006;
/** metres: a dotted line's dashes and the gaps between them, unless it says */
export const DASH = 0.5;
export const GAP = 0.5;

export interface Line {
  name?: string;
  side: 'left' | 'right';
  from?: number | null;
  to?: number | null;
  pad?: number;
  w?: number;
  style?: string;
  dash?: number;
  gap?: number;
  colour?: string;
}

/** Where a rumble goes on along another road (its before or after). */
export interface KerbGoesOn {
  road: string;
  side: 'left' | 'right';
  from?: number | null;
  to?: number | null;
  outer?: string;
}

export interface Kerb {
  side: 'left' | 'right';
  from?: number | null;
  to?: number | null;
  kind?: string;
  width?: number;
  inset?: number;
  start?: string;
  end?: string;
  taper?: number;
  back?: number;
  back_ramp?: number;
  before?: KerbGoesOn | null;
  after?: KerbGoesOn | null;
}

export type Roads = Record<string, RoadDesc & { lines?: Line[]; kerbs?: Kerb[] }>;

const roadLength = (road: RoadDesc) => {
  const at = fine(road).at;
  return at[at.length - 1] as number;
};

/** A road's middle and the way to its left (unit) at how far along it, as its fine rows lie (rows_at). */
export function rowsAt(road: RoadDesc, S: ArrayLike<number>) {
  const f = fine(road);
  const n = S.length;
  const mx = new Float64Array(n);
  const mz = new Float64Array(n);
  const lx = new Float64Array(n);
  const lz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = S[i] as number;
    mx[i] = interp(s, f.at, f.mx);
    mz[i] = interp(s, f.at, f.mz);
    const a = interp(s, f.at, f.lx);
    const b = interp(s, f.at, f.lz);
    const m = Math.max(Math.sqrt(a * a + b * b), 1e-9);
    lx[i] = a / m;
    lz[i] = b / m;
  }
  return { mx, mz, lx, lz };
}

/** Faces turned to face up: those whose cross product points down, the other way round. */
function facingUp(P: ArrayLike<number>, F: number[]): void {
  for (let i = 0; i < F.length; i += 3) {
    const a = F[i] as number;
    const b = F[i + 1] as number;
    const c = F[i + 2] as number;
    const ux = (P[b * 3] as number) - (P[a * 3] as number);
    const uz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
    const vx = (P[c * 3] as number) - (P[a * 3] as number);
    const vz = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
    // (the cross product's y: uz * vx - ux * vz)
    if (uz * vx - ux * vz < 0) {
      F[i] = c;
      F[i + 2] = a;
    }
  }
}

// ---- the edge lines --------------------------------------------------------------------------------------------

/** A line of paint along a road's edge: points (x, y, z) a pair across it at every fine row it spans, faces (facing
 * up), LINE_LIFT over the road (its heights', or height's; none: at 0). */
export function lineStrip(road: RoadDesc, line: Line, height?: (x: number, z: number) => number) {
  const f = fine(road);
  const end = f.at[f.at.length - 1] as number;
  const a0 = line.from || 0;
  const a1 = Math.min(end, line.to !== undefined && line.to !== null ? line.to : end);
  const rows = [a0, ...[...f.at].filter((a) => a > a0 && a < a1), a1];
  const { mx, mz, lx, lz } = rowsAt(road, rows);
  const side = line.side === 'left' ? f.wl : f.wr;
  const sgn = line.side === 'left' ? 1 : -1;
  const w = line.w ?? LINE_W;
  const pad = line.pad ?? LINE_PAD;
  const P: number[] = [];
  const F: number[] = [];
  const offs: number[] = [];
  rows.forEach((r, k) => {
    const oMid = sgn * (interp(r, f.at, side) - pad);
    for (const o of [oMid + w / 2, oMid - w / 2]) {
      P.push((mx[k] as number) + (lx[k] as number) * o, 0, (mz[k] as number) + (lz[k] as number) * o);
      offs.push(o);
    }
    if (k) {
      const a = 2 * (k - 1);
      const b = 2 * k;
      F.push(a, b, b + 1, a, b + 1, a + 1);
    }
  });
  if (height) for (let i = 0; i < P.length; i += 3) P[i + 1] = height(P[i] as number, P[i + 2] as number) + LINE_LIFT;
  else if (road.heights) {
    const y = heightAt(
      road,
      rows.flatMap((r) => [r, r]),
      offs,
    );
    y.forEach((v, i) => {
      P[i * 3 + 1] = v + LINE_LIFT;
    });
  }
  facingUp(P, F);
  return { P: Float64Array.from(P), F: Int32Array.from(F) };
}

/** A line's runs as the dashes laid of them, if it is dotted: a dash every dash + gap metres counted from where the
 * line starts, cut where a run ends; as they are if it is solid. */
export function dashes(line: Line, runs: Line[]): Line[] {
  if (line.style !== 'dotted') return runs;
  const dash = Math.max(line.dash || DASH, 0.05);
  const gap = Math.max(line.gap || GAP, 0.05);
  const a0 = line.from || 0;
  const out: Line[] = [];
  for (const run of runs) {
    const from = run.from as number;
    const to = run.to as number;
    const k = Math.floor((from - a0) / (dash + gap));
    let a = a0 + k * (dash + gap);
    while (a < to - 1e-6) {
      const lo = Math.max(a, from);
      const hi = Math.min(a + dash, to);
      if (hi - lo > 0.02) out.push({ ...run, from: lo, to: hi });
      a += dash + gap;
    }
  }
  return out;
}

/** A road's lines as laid: each line whole, from / to as it says (as the editor draws it: where it meets another road,
 * a rumble or a run-off, on over it), and the pieces of paint of it (its dashes, if dotted). */
export function roadLines(road: RoadDesc & { lines?: Line[] }) {
  return (road.lines ?? []).map((line0) => {
    const runs = [
      {
        ...line0,
        from: line0.from || 0,
        to: line0.to !== undefined && line0.to !== null ? line0.to : roadLength(road),
      },
    ];
    return { line: line0, runs, pieces: dashes(line0, runs) };
  });
}

// ---- the rumbles -----------------------------------------------------------------------------------------------

type Profile = { pts: [number, number][]; v: [number, number]; uPerM: number; material: string };

/** A kind: its top's rise over its base across it ((across 0-1, metres up), ...), its texture across it (v at its
 * inner side, at its outer), along it (u a metre), its material. */
export const PROFILES: Record<string, Profile> = {
  ramp: {
    pts: [
      [0, 0],
      [0.15, 0.008],
      [0.3, 0.026],
      [0.45, 0.045],
      [0.55, 0.052],
      [1, 0.05],
    ],
    v: [0, 0.61],
    uPerM: 0.15,
    material: 'KerbRamp',
  },
  // (level with the road; its dips cut in along it under its picture's gaps between the bars, across the barred part
  // of each block (FLOOR_DIPS): the columns where they start and end)
  floor: {
    pts: [
      [0, 0],
      [0.1, 0],
      [0.14, 0],
      [0.86, 0],
      [0.9, 0],
      [1, 0],
    ],
    v: [0, 1],
    uPerM: 0.21,
    material: 'KerbFloor',
  },
  concrete: {
    pts: [
      [0, 0],
      [0.08, 0.03],
      [0.15, 0.05],
      [0.9, 0.05],
      [1, 0.03],
    ],
    v: [0, 0.97],
    uPerM: 0.2,
    material: 'KerbConcrete',
  },
  round: {
    pts: [
      [0, 0],
      [0.2, 0.025],
      [0.4, 0.045],
      [0.6, 0.04],
      [0.8, 0.015],
      [1, -0.01],
    ],
    v: [0, 0.61],
    uPerM: 0.2,
    material: 'KerbRound',
  },
};
/** metres of concrete behind a ramp + concrete rumble's ramp, unless it says */
export const BACK = 0.75;
/** metres a rumble is wide, unless it says */
export const KERB_W = 0.6;
/** a ramp + concrete rumble: one piece, its ramp (across, up, v), then the concrete back down across its back */
const RAMP_CONCRETE = {
  ramp: [
    [0, 0, 0],
    [0.047, 0.0095, 0.014],
    [0.185, 0.0142, 0.055],
    [0.944, 0.0592, 0.283],
    [1, 0.0491, 0.3],
  ],
  concrete: [
    [0.5, 0.0207, 0.63],
    [1, -0.008, 0.967],
  ],
  uPerM: 0.2,
  material: 'KerbConcrete',
};
/** the materials rumbles are drawn in */
export const KERB_MATERIALS: readonly string[] = [
  ...new Set([...Object.values(PROFILES).map((p) => p.material), RAMP_CONCRETE.material]),
];

/** Materials' pictures' proportions (height over width), by material: their colour PNG's header, as the track's
 * material library (source/materials.json) names it; a material with none (or not a PNG) left out. */
export async function pictureAspects(
  files: { read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> },
  project: string,
  materials: readonly string[],
): Promise<Record<string, number>> {
  const lib = `${project}/source/materials.json`;
  if (!(await files.exists(lib))) return {};
  const doc = JSON.parse(new TextDecoder().decode(await files.read(lib))) as {
    materials?: Record<string, { colour?: string }>;
  };
  const out: Record<string, number> = {};
  for (const m of materials) {
    const colour = doc.materials?.[m]?.colour;
    const file = colour && `${project}/source/textures/${colour}`;
    if (!file || !(await files.exists(file))) continue;
    const b = await files.read(file);
    if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) continue;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const w = v.getUint32(16);
    const h = v.getUint32(20);
    if (w > 0 && h > 0) out[m] = h / w;
  }
  return out;
}

/** metres behind a rumble's outer edge it goes down to its road's height, unless it says: an edge (the old kerbs'
 * dropped straight down, 5 to 10 cm; a surface has one height a point, so a centimetre for it) */
export const BACK_RAMP = 0.01;

/** The concrete's notches (the original kerbs' (source/models/velopark_kerbs, KERB_T2), as the photo has them):
 * along the concrete's top edge, where it meets the ramp, a U notch every so many metres (its steep sides and flat
 * bottom: (metres from its middle, share of its depth)), so wide, so deep, fading to nothing at its foot on the
 * ground; the teeth between them its whole height. */
export const CONCRETE_NOTCHES = {
  every: 0.27,
  half: 0.0625,
  deep: 0.03,
  shape: [
    [-0.0625, 0],
    [-0.03, 1],
    [0.03, 1],
    [0.0625, 0],
  ] as [number, number][],
};

/** The floor rumble's dips (as the photo has them: its painted bars raised, the gaps between them low): where along
 * its picture each gap between two bars of a block is (its middle and half its width, u, a share of the picture: three
 * in each red block, four in each white), how deep, a V. */
export const FLOOR_DIPS = {
  at: [
    [0.063, 0.017],
    [0.1245, 0.0175],
    [0.1875, 0.017],
    [0.3, 0.014],
    [0.35, 0.013],
    [0.4, 0.013],
    [0.45, 0.012],
  ].flatMap(([u, h]) => [
    [u as number, h as number],
    [(u as number) + 0.5, h as number],
  ]) as [number, number][],
  deep: 0.025,
};

/** metres: a rumble's own row this near a dip's edge left out for it */
const NOTCH_GAP = 0.03;

/** A cut along a strip: its middle (metres along), its shape ((metres from its middle, share of its depth), first and
 * last at its edges, 0), its depth. */
interface Dip {
  m: number;
  shape: [number, number][];
  deep: number;
}

/** A strip's rows with dips cut in (a row at each point of a dip's shape, lowered by its share of its depth times
 * each point's share across it (weights); the strip's own rows inside a dip, or within NOTCH_GAP of it, left out). The
 * rows' middles' run along it as the mapping measures it (mid), from along0 metres; dips(first, last): the dips
 * between those (metres along). */
function dipped(
  rows: Float64Array[],
  along0: number,
  weights: number[],
  mid: (row: Float64Array) => [number, number],
  dips: (first: number, last: number) => Dip[],
): Float64Array[] {
  if (rows.length < 2) return rows;
  const at: number[] = [along0];
  for (let j = 1; j < rows.length; j++) {
    const a = mid(rows[j - 1] as Float64Array);
    const b = mid(rows[j] as Float64Array);
    at.push((at[j - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const first = at[0] as number;
  const last = at[at.length - 1] as number;
  const edge = (d: Dip) => [d.m + (d.shape[0] as [number, number])[0], d.m + (d.shape.at(-1) as [number, number])[0]];
  const kept = dips(first, last)
    .filter((d) => {
      const [a, b] = edge(d);
      return (a as number) > first + NOTCH_GAP && (b as number) < last - NOTCH_GAP;
    })
    .sort((x, y) => x.m - y.m);
  if (!kept.length) return rows;
  // (a row at s metres along, between the rows either side; lowered by drop)
  const rowAt = (s: number, drop: number): Float64Array => {
    let j = 1;
    while (j < at.length - 1 && (at[j] as number) < s) j++;
    const a = rows[j - 1] as Float64Array;
    const b = rows[j] as Float64Array;
    const t = Math.min(
      Math.max((s - (at[j - 1] as number)) / Math.max((at[j] as number) - (at[j - 1] as number), 1e-9), 0),
      1,
    );
    const out = a.map((v, i) => v + ((b[i] as number) - v) * t);
    if (drop)
      for (let c = 0; c * 3 < out.length; c++) out[c * 3 + 1] = (out[c * 3 + 1] as number) - drop * (weights[c] ?? 0);
    return out;
  };
  const cuts = kept.flatMap((d) => d.shape.map(([o, k]) => [d.m + o, k * d.deep] as [number, number]));
  const out: Float64Array[] = [];
  let c = 0;
  rows.forEach((row, j) => {
    while (c < cuts.length && (cuts[c] as [number, number])[0] < (at[j] as number) - 1e-6) {
      const [s, drop] = cuts[c] as [number, number];
      out.push(rowAt(s, drop));
      c++;
    }
    const inDip = kept.some((d) => {
      const [a, b] = edge(d);
      return (at[j] as number) > (a as number) - NOTCH_GAP && (at[j] as number) < (b as number) + NOTCH_GAP;
    });
    if (!inDip || j === 0 || j === rows.length - 1) out.push(row);
  });
  return out;
}

/** metres between a rumble's rows along it */
export const KERB_ROW = 0.25;
/** metres: a rumble's piece on one road and the next this near are one strip */
export const JOIN = 1;
/** metres from another road a rumble's tapering end comes down to the road's height */
export const OTHER_EASE = 0.75;
/** metres: a rumble's part rising more than this over its road hides the paint under it */
export const RAISED = 0.005;

export function kindOf(k: Kerb): string {
  if (k.kind === 'yellow') return 'round';
  return k.kind && (k.kind in PROFILES || k.kind === 'ramp_concrete') ? k.kind : 'ramp';
}

/** How far out a rumble may reach along it (metres, at S metres along), narrowing no faster than a tapering end does
 * (its whole REACH_EASE metres of width over taper metres along): where a bend tightens at once (a straight into a
 * hairpin), it narrows on before it, not in one step. */
function narrowedGently(reach: ArrayLike<number>, S: ArrayLike<number>, taper: number): number[] {
  const out = Array.from(reach, (r) => r as number);
  const slope = REACH_EASE / Math.max(taper, 1e-6);
  for (let j = 1; j < out.length; j++)
    out[j] = Math.min(out[j] as number, (out[j - 1] as number) + slope * ((S[j] as number) - (S[j - 1] as number)));
  for (let j = out.length - 2; j >= 0; j--)
    out[j] = Math.min(out[j] as number, (out[j + 1] as number) + slope * ((S[j + 1] as number) - (S[j] as number)));
  return out;
}
/** metres of a rumble's width its narrowing takes over its taper's length */
const REACH_EASE = 1.5;

/** One piece of a rumble along one road: its side, from / to, whether it tapers at each end. */
export interface KerbPiece {
  road: RoadDesc;
  side: 'left' | 'right';
  s0: number;
  s1: number;
  t0: boolean;
  t1: boolean;
}

/** A rumble's pieces along roads: its own road's, and those it goes on along before and after it. */
export function kerbPieces(road: RoadDesc, k: Kerb, roads: Roads): KerbPiece[] {
  const out: KerbPiece[] = [];
  const tri0 = k.start === 'triangle';
  const tri1 = k.end === 'triangle';
  const cont = (c: KerbGoesOn, start: boolean): KerbPiece | null => {
    const r2 = roads[c.road];
    if (!r2) return null;
    const L = roadLength(r2);
    const a = Math.max(0, c.from || 0);
    const b = Math.min(L, c.to !== undefined && c.to !== null ? c.to : L);
    if (b <= a) return null;
    const at0 = c.outer !== 'to';
    const tri = start ? tri0 : tri1;
    return { road: r2, side: c.side, s0: a, s1: b, t0: at0 && tri, t1: !at0 && tri };
  };
  if (k.before) {
    const p = cont(k.before, true);
    if (p) out.push(p);
  }
  const L = roadLength(road);
  const s0 = Math.max(0, k.from || 0);
  const s1 = Math.min(L, k.to !== undefined && k.to !== null ? k.to : L);
  if (s1 > s0) out.push({ road, side: k.side, s0, s1, t0: !k.before && tri0, t1: !k.after && tri1 });
  if (k.after) {
    const p = cont(k.after, false);
    if (p) out.push(p);
  }
  return out;
}

/** A rumble's piece of one road: its rows along it (ROW apart), each row's middle and left, the inner side's offset
 * from the road's middle, and how far each end's taper lets it out (0-1). */
function strip(pc: KerbPiece, k: Kerb) {
  const f = fine(pc.road);
  const sgn = pc.side === 'left' ? 1 : -1;
  const n = Math.max(2, Math.ceil((pc.s1 - pc.s0) / KERB_ROW) + 1);
  const S = linspace(pc.s0, pc.s1, n);
  const rows = rowsAt(pc.road, S);
  const edge = S.map((s) => interp(s, f.at, sgn > 0 ? f.wl : f.wr) - (k.inset ?? 0));
  const tp = Math.max(k.taper || 2, 1e-6);
  const fr = S.map((s) => {
    let v = 1;
    if (pc.t0) v = Math.min(v, Math.min(Math.max((s - pc.s0) / tp, 0), 1));
    if (pc.t1) v = Math.min(v, Math.min(Math.max((pc.s1 - s) / tp, 0), 1));
    return v;
  });
  return { ...rows, sgn, edge, f: fr, S };
}

/** How far out past its road's edge a rumble on that side may go: on the inside of a curve, no farther than INSIDE of
 * the curve's radius from its middle (so it never folds over itself); elsewhere as far as it likes. */
function insideReach(road: RoadDesc, side: 'left' | 'right', S: number[], edge: number[]): number[] {
  const f = fine(road);
  const n = f.at.length;
  // (the way along: (lz, -lx), its angle unwrapped)
  const h = unwrap(Float64Array.from({ length: n }, (_, i) => Math.atan2(-(f.lx[i] as number), f.lz[i] as number)));
  const kk = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const at = f.at[i] as number;
    const a = Math.min(Math.max(searchsorted(f.at, at - BASE, 'right') - 1, 0), n - 1);
    const b = Math.min(Math.max(searchsorted(f.at, at + BASE, 'left'), 0), n - 1);
    kk[i] = ((h[b] as number) - (h[a] as number)) / Math.max((f.at[b] as number) - (f.at[a] as number), 1e-9);
  }
  const sgn = side === 'left' ? 1 : -1;
  return S.map((s, j) => {
    const c = interp(s, f.at, kk) * sgn;
    const R = c > 1e-6 ? 1 / Math.max(c, 1e-6) : Infinity;
    return Math.max(INSIDE * R - (edge[j] as number), 0);
  });
}

/** Outlines' edges filed by metre cells, for the distance from them up to a reach (exactly, as shapely's distance
 * from their union: 0 inside one); past the reach, Infinity. */
class Near {
  private readonly cells = new Map<string, [number, number, number, number][]>();
  private readonly boxes: { ring: number[][]; x0: number; z0: number; x1: number; z1: number }[] = [];

  constructor(
    rings: number[][][],
    private readonly reach: number,
  ) {
    for (const ring of rings) {
      const b = { ring, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      ring.forEach((a, i) => {
        const q = ring[(i + 1) % ring.length] as number[];
        const ax = a[0] as number;
        const az = a[1] as number;
        const bx = q[0] as number;
        const bz = q[1] as number;
        b.x0 = Math.min(b.x0, ax);
        b.x1 = Math.max(b.x1, ax);
        b.z0 = Math.min(b.z0, az);
        b.z1 = Math.max(b.z1, az);
        for (let gx = Math.floor(Math.min(ax, bx)); gx <= Math.floor(Math.max(ax, bx)); gx++)
          for (let gz = Math.floor(Math.min(az, bz)); gz <= Math.floor(Math.max(az, bz)); gz++) {
            const k = `${gx},${gz}`;
            const l = this.cells.get(k);
            if (l) l.push([ax, az, bx, bz]);
            else this.cells.set(k, [[ax, az, bx, bz]]);
          }
      });
      this.boxes.push(b);
    }
  }

  /** Whether (x, z) is inside one of the outlines (even-odd, its own edge not inside). */
  inside(x: number, z: number): boolean {
    for (const b of this.boxes)
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && inside(b.ring, x, z)) return true;
    return false;
  }

  distance(x: number, z: number): number {
    return this.inside(x, z) ? 0 : this.edge(x, z);
  }

  /** The distance from (x, z) to the outlines' edges, up to the reach; past it, Infinity. */
  edge(x: number, z: number): number {
    let best = Infinity;
    const r = Math.ceil(this.reach);
    const gx = Math.floor(x);
    const gz = Math.floor(z);
    for (let ix = gx - r; ix <= gx + r; ix++)
      for (let iz = gz - r; iz <= gz + r; iz++)
        for (const [ax, az, bx, bz] of this.cells.get(`${ix},${iz}`) ?? []) {
          const dx = bx - ax;
          const dz = bz - az;
          const len2 = dx * dx + dz * dz;
          const t = len2 > 0 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0), 1) : 0;
          const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
          if (d < best) best = d;
        }
    return best <= this.reach ? best : Infinity;
  }
}

const others = new Map<string, Near | null>();

/** The roads a rumble does not run along (every road but its own and those its pieces go on along, and the run-offs
 * beside them), as their outlines: the distance from one (0 inside), up to OTHER_EASE (past it, no matter how far:
 * a tapering end eases down only within it). */
function otherRoads(road: RoadDesc, k: Kerb, roads: Roads): ((x: number, z: number) => number) | null {
  const own = new Set([...kerbPieces(road, k, roads).map((p) => p.road.name), road.name]);
  const key = [...own].sort(byCodePoint).join('|');
  let near = others.get(key);
  if (near === undefined) {
    const rest = Object.entries(roads).filter(([n, r]) => !own.has(n) && !(r.along && own.has(r.along.road)));
    near = rest.length
      ? new Near(
          rest.map(([, r]) => outline(r, roads)),
          OTHER_EASE,
        )
      : null;
    if (others.size > 500) others.clear();
    others.set(key, near);
  }
  if (!near) return null;
  const n = near;
  return (x, z) => n.distance(x, z);
}

/** A rumble's meshes: points (x, y, z), texture places (u, v), faces (facing up), material, its name's part. */
export interface KerbMesh {
  P: Float64Array;
  U: Float64Array;
  F: Int32Array;
  material: string;
  suffix: string;
  /** points a row of it is across (its profile's, and its back ramp's) */
  across: number;
}

/** A rumble's surface (build_kerbs.geometry): its rows across it at its kind's profile, level with its road's edge
 * (top: the road's top's height at a point) and rising over it, a tapering end's from nothing over the whole taper
 * (near another road, down to that road's height on it); its pieces on one road and the next made one strip. */
export function kerbGeometry(
  road: RoadDesc,
  k: Kerb,
  roads: Roads,
  top: (x: number, z: number) => number,
  aspectOf?: (material: string) => number | undefined,
  ground?: (x: number, z: number) => number,
): KerbMesh[] {
  const kind = kindOf(k);
  const wRamp = k.width ?? KERB_W;
  let pts: [number, number, number][];
  let uM: number;
  let mat: string;
  if (kind === 'ramp_concrete') {
    const back = k.back ?? BACK;
    pts = [
      ...RAMP_CONCRETE.ramp.map(([a, y, v]) => [(a as number) * wRamp, y, v] as [number, number, number]),
      ...RAMP_CONCRETE.concrete.map(([a, y, v]) => [wRamp + (a as number) * back, y, v] as [number, number, number]),
    ];
    uM = RAMP_CONCRETE.uPerM;
    mat = RAMP_CONCRETE.material;
  } else {
    const p = PROFILES[kind] as Profile;
    pts = p.pts.map(([a, y]) => [a * wRamp, y, p.v[0] + a * (p.v[1] - p.v[0])]);
    uM = p.uPerM;
    mat = p.material;
  }
  // (its picture along it as it is across, its proportions kept (aspectOf: its picture's height over its width): the
  // stripes as long as the picture has them, whatever the rumble's width; none known: its kind's u a metre)
  const pic = aspectOf?.(mat);
  const p0 = pts[0] as [number, number, number];
  const pn = pts[pts.length - 1] as [number, number, number];
  if (pic && pn[0] > p0[0] && pn[2] !== p0[2]) uM = (Math.abs(pn[2] - p0[2]) / (pn[0] - p0[0])) * pic;
  // (and behind it, its back ramp down to its road's height, its texture carried on at its scale across)
  const backRamp = k.back_ramp ?? BACK_RAMP;
  const last = pts[pts.length - 1] as [number, number, number];
  if (last[1] > RAISED && backRamp > 0) {
    const perM = Math.abs(last[2] - (pts[0] as [number, number, number])[2]) / Math.max(last[0], 1e-9);
    pts.push([last[0] + backRamp, 0, Math.max(last[2] - backRamp * perM, 0)]);
  }
  const total = (pts[pts.length - 1] as [number, number, number])[0];
  const ts = pts.map(([a]) => a / total);
  const ys = pts.map(([, y]) => y);
  const vs = pts.map(([, , v]) => v);
  const nc = ts.length;
  const near = otherRoads(road, k, roads);
  // (each piece's rows: each a row of nc points, x y z)
  const runs: Float64Array[][] = [];
  for (const pc of kerbPieces(road, k, roads)) {
    const st = strip(pc, k);
    const reach = narrowedGently(insideReach(pc.road, pc.side, st.S, st.edge), st.S, k.taper ?? 2);
    const rows: Float64Array[] = [];
    for (let j = 0; j < st.S.length; j++) {
      const mmx = st.mx[j] as number;
      const mmz = st.mz[j] as number;
      const llx = st.lx[j] as number;
      const llz = st.lz[j] as number;
      const e = st.edge[j] as number;
      const ff = Math.min(st.f[j] as number, (reach[j] as number) / Math.max(total, 1e-9));
      const yi = top(mmx + llx * st.sgn * e, mmz + llz * st.sgn * e);
      const fj = Math.min(st.f[j] as number, 1);
      // (off the road, as high as its road's edge on the inside, as the ground on the outside (build_kerbs): the
      // ground's height at its outer edge, where known)
      const oOut = st.sgn * (e + total * ff);
      const gOut = ground ? ground(mmx + oOut * llx, mmz + oOut * llz) : Number.NaN;
      const row = new Float64Array(nc * 3);
      for (let c = 0; c < nc; c++) {
        const o = st.sgn * (e + (0 + (ts[c] as number) * (total - 0)) * ff);
        const x = mmx + o * llx;
        const z = mmz + o * llz;
        const g = near && fj < 1 ? Math.min(Math.max(near(x, z) / OTHER_EASE, 0), 1) : 1;
        row[c * 3] = x;
        // (its profile over its road's top there, along its normal (layer.ts); past the road, its edge's)
        const t = top(x, z);
        const lift = (ys[c] as number) * fj * g ** (1 - fj);
        const base = Number.isNaN(gOut) ? yi : yi + (gOut - yi) * (ts[c] as number);
        row[c * 3 + 1] = Number.isNaN(t) ? base + lift : t + lift / upright(top, x, z);
        row[c * 3 + 2] = z;
      }
      rows.push(row);
    }
    runs.push(rows);
  }
  // (its pieces on one road and the next made one strip, the two rows where they meet (within JOIN) one, halfway)
  const mid = (row: Float64Array): [number, number] => {
    let x = 0;
    let z = 0;
    for (let c = 0; c < nc; c++) {
      x += row[c * 3] as number;
      z += row[c * 3 + 2] as number;
    }
    return [x / nc, z / nc];
  };
  const dist = (a: [number, number], b: [number, number]) =>
    Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
  const half = (a: Float64Array, b: Float64Array) => a.map((v, i) => (v + (b[i] as number)) / 2);
  const strips: Float64Array[][] = [];
  for (const R of runs) {
    if (!strips.length) {
      strips.push(R);
      continue;
    }
    const A = strips[strips.length - 1] as Float64Array[];
    const Ar = [...R].reverse();
    const first = (x: Float64Array[]) => x[0] as Float64Array;
    const lastRow = (x: Float64Array[]) => x[x.length - 1] as Float64Array;
    const ends: [number, 'after' | 'before', Float64Array[]][] = [
      [dist(mid(lastRow(A)), mid(first(R))), 'after', R],
      [dist(mid(lastRow(A)), mid(lastRow(R))), 'after', Ar],
      [dist(mid(first(A)), mid(lastRow(R))), 'before', R],
      [dist(mid(first(A)), mid(first(R))), 'before', Ar],
    ];
    let best = ends[0] as [number, 'after' | 'before', Float64Array[]];
    for (const e of ends) if (e[0] < best[0]) best = e;
    const [d, where, R2] = best;
    if (d > JOIN) strips.push(R);
    else if (where === 'after') {
      const B = [...A];
      B[B.length - 1] = half(lastRow(A), first(R2));
      strips[strips.length - 1] = [...B, ...R2.slice(1)];
    } else {
      const B = [...A];
      B[0] = half(first(A), lastRow(R2));
      strips[strips.length - 1] = [...R2.slice(0, -1), ...B];
    }
  }
  const P: number[] = [];
  const U: number[] = [];
  const F: number[] = [];
  let base = 0;
  let along0 = 0;
  // (a ramp + concrete rumble's concrete notched along its top edge, the notches fading to its foot; a floor rumble's
  // dips under its picture's gaps, across its barred part)
  const lengthOf = (R: Float64Array[]) => {
    const c = R.map(mid);
    let len = 0;
    for (let j = 1; j < c.length; j++)
      len += Math.hypot(
        (c[j] as [number, number])[0] - (c[j - 1] as [number, number])[0],
        (c[j] as [number, number])[1] - (c[j - 1] as [number, number])[1],
      );
    return len;
  };
  if (kind === 'ramp_concrete') {
    const edge = RAMP_CONCRETE.ramp.length - 1;
    const a0 = (pts[edge] as [number, number, number])[0];
    const a1 = (pts[pts.length - 1] as [number, number, number])[0];
    const weights = pts.map(([a], c) => (c < edge ? 0 : Math.max(0, 1 - (a - a0) / Math.max(a1 - a0, 1e-9))));
    const { every, half, deep, shape } = CONCRETE_NOTCHES;
    for (let i = 0; i < strips.length; i++)
      strips[i] = dipped(strips[i] as Float64Array[], 0, weights, mid, (_f, last) => {
        const out: Dip[] = [];
        for (let m = every / 2; m + half < last; m += every) out.push({ m, shape, deep });
        return out;
      });
  } else if (kind === 'floor' && uM > 0) {
    // (deepest across the barred part, nothing at the block's frame: by its columns)
    const weights = [0, 0, 1, 1, 0, 0];
    let a0 = 0;
    for (let i = 0; i < strips.length; i++) {
      const R = strips[i] as Float64Array[];
      const len = lengthOf(R);
      strips[i] = dipped(R, a0, weights, mid, (first, last) => {
        const out: Dip[] = [];
        for (let r = Math.floor(first * uM); r <= Math.ceil(last * uM); r++)
          for (const [u, h] of FLOOR_DIPS.at) {
            const hm = h / uM;
            out.push({
              m: (r + u) / uM,
              shape: [
                [-hm, 0],
                [0, 1],
                [hm, 0],
              ],
              deep: FLOOR_DIPS.deep,
            });
          }
        return out;
      });
      a0 += len;
    }
  }
  for (const R of strips) {
    // (how far along each row: the strip's start plus the steps summed, as numpy's along0 + cumsum)
    const c = R.map(mid);
    let sum = 0;
    let along = along0;
    R.forEach((row, j) => {
      if (j) {
        const a = c[j - 1] as [number, number];
        const b = c[j] as [number, number];
        sum += Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
      }
      along = along0 + sum;
      for (let i = 0; i < nc; i++) {
        P.push(row[i * 3] as number, row[i * 3 + 1] as number, row[i * 3 + 2] as number);
        U.push(along * uM, vs[i] as number);
      }
    });
    along0 = along;
    for (let j = 0; j < R.length - 1; j++)
      for (let q = 0; q < nc - 1; q++) {
        const a = base + j * nc + q;
        const b = base + (j + 1) * nc + q;
        F.push(a, b, b + 1, a, b + 1, a + 1);
      }
    base += R.length * nc;
  }
  if (!P.length) return [];
  // (none of no area (a tapering end's tip), each facing up)
  const kept: number[] = [];
  for (let i = 0; i < F.length; i += 3) {
    const a = F[i] as number;
    const b = F[i + 1] as number;
    const cc = F[i + 2] as number;
    const ux = (P[b * 3] as number) - (P[a * 3] as number);
    const uz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
    const vx = (P[cc * 3] as number) - (P[a * 3] as number);
    const vz = (P[cc * 3 + 2] as number) - (P[a * 3 + 2] as number);
    const up = uz * vx - ux * vz;
    if (Math.abs(up) <= 1e-9) continue;
    if (up < 0) kept.push(cc, b, a);
    else kept.push(a, b, cc);
  }
  return [
    {
      P: Float64Array.from(P),
      U: Float64Array.from(U),
      F: Int32Array.from(kept),
      material: mat,
      suffix: '',
      across: nc,
    },
  ];
}

// ---- the paint laid on the merged surface ------------------------------------------------------------------------

/** metres: the surface a point of paint is laid on is the one under it nearest its height, within this */
export const LAY_NEAR = 0.5;

/** A line of paint as laid: its line's name and colour, its points (x, y, z) and faces (facing up). */
export interface PaintMesh {
  name: string;
  colour: string;
  P: Float64Array;
  F: Int32Array;
}

/** Whether a point is on a triangle (nine numbers each, x y z) of a set filed by metre cells. */
class Cover {
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly T: number[]) {
    for (let t = 0; t < T.length / 9; t++) {
      const xs = [T[t * 9] as number, T[t * 9 + 3] as number, T[t * 9 + 6] as number];
      const zs = [T[t * 9 + 2] as number, T[t * 9 + 5] as number, T[t * 9 + 8] as number];
      for (let gx = Math.floor(Math.min(...xs)); gx <= Math.floor(Math.max(...xs)); gx++)
        for (let gz = Math.floor(Math.min(...zs)); gz <= Math.floor(Math.max(...zs)); gz++) {
          const k = `${gx},${gz}`;
          const l = this.cells.get(k);
          if (l) l.push(t);
          else this.cells.set(k, [t]);
        }
    }
  }

  has(x: number, z: number): boolean {
    const T = this.T;
    for (const t of this.cells.get(`${Math.floor(x)},${Math.floor(z)}`) ?? []) {
      const ax = T[t * 9] as number;
      const az = T[t * 9 + 2] as number;
      const bx = T[t * 9 + 3] as number;
      const bz = T[t * 9 + 5] as number;
      const cx = T[t * 9 + 6] as number;
      const cz = T[t * 9 + 8] as number;
      const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
      const d2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
      const d3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
      if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) return true;
    }
    return false;
  }
}

/** metres: an edge line's point this near the straight on from the one kept before to the next left out */
const LINE_KEEP = 0.002;

/** Points along a line, those within tol of the straight between the ones either side left out (Douglas-Peucker):
 * its ends kept. */
function simplified(P: Vec2[], tol: number): Vec2[] {
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length);
  keep[0] = 1;
  keep[P.length - 1] = 1;
  const todo: [number, number][] = [[0, P.length - 1]];
  while (todo.length) {
    const [a, b] = todo.pop() as [number, number];
    const A = P[a] as Vec2;
    const B = P[b] as Vec2;
    const dx = B[0] - A[0];
    const dz = B[1] - A[1];
    const len = Math.hypot(dx, dz);
    let far = -1;
    let fd = tol;
    for (let k = a + 1; k < b; k++) {
      const Q = P[k] as Vec2;
      const d =
        len > 1e-12 ? Math.abs((Q[0] - A[0]) * dz - (Q[1] - A[1]) * dx) / len : Math.hypot(Q[0] - A[0], Q[1] - A[1]);
      if (d > fd) [far, fd] = [k, d];
    }
    if (far < 0) continue;
    keep[far] = 1;
    todo.push([a, far], [far, b]);
  }
  return P.filter((_, k) => keep[k]);
}

/** A road's edge line as painted: its middle's points (at its start and end, and each of the road's fine rows
 * between), its paint (unless it says: LINE_W wide, white, solid). Null where it has no length. */
export function edgeLine(road: RoadDesc, line: Line): Paintable | null {
  const f = fine(road);
  const end = f.at[f.at.length - 1] as number;
  const a0 = Math.max(0, line.from || 0);
  const a1 = Math.min(end, line.to !== undefined && line.to !== null ? line.to : end);
  if (a1 - a0 < 1e-6) return null;
  const rows = [a0, ...[...f.at].filter((a) => a > a0 && a < a1), a1];
  const { mx, mz, lx, lz } = rowsAt(road, rows);
  const side = line.side === 'left' ? f.wl : f.wr;
  const sgn = line.side === 'left' ? 1 : -1;
  const pad = line.pad ?? LINE_PAD;
  const points = rows.map((r, k): Vec2 => {
    const o = sgn * (interp(r, f.at, side) - pad);
    return [(mx[k] as number) + (lx[k] as number) * o, (mz[k] as number) + (lz[k] as number) * o];
  });
  return {
    points: simplified(points, LINE_KEEP),
    width: line.w ?? LINE_W,
    colour: line.colour ?? 'white',
    style: line.style ?? 'solid',
    dash: line.dash,
    gap: line.gap,
  };
}

/** Where a car may drive over the rumbles, as an AI line takes them: their low ramps (a ramp's, a floor's, a round
 * one's, a ramp + concrete's ramp), not their concrete (a concrete rumble's block, a ramp + concrete's back behind its
 * ramp), nor their back ramps down to the road: those jump, and throw a car. Whether (x, z) is on such a part. */
export function kerbsToDrive(roads: Roads): (x: number, z: number) => boolean {
  const T: number[] = [];
  for (const r of Object.values(roads)) {
    if (r.along) continue;
    for (const k of r.kerbs ?? []) {
      const kind = kindOf(k);
      if (kind === 'concrete') continue;
      // (the columns across it a car may be on: its profile's, or a ramp + concrete's ramp's)
      const cols = kind === 'ramp_concrete' ? RAMP_CONCRETE.ramp.length : (PROFILES[kind] as Profile).pts.length;
      for (const g of kerbGeometry(r, k, roads, () => 0)) {
        for (let f = 0; f < g.F.length; f += 3) {
          const v = [g.F[f] as number, g.F[f + 1] as number, g.F[f + 2] as number];
          // (each row of the strip its points across: the column a face starts at)
          const q = Math.min(...v) % g.across;
          if (q + 1 > cols - 1) continue;
          for (const i of v) T.push(g.P[i * 3] as number, 0, g.P[i * 3 + 2] as number);
        }
      }
    }
  }
  const on = new Cover(T);
  return (x, z) => on.has(x, z);
}

/** Where the rumbles rise over their roads: each one's own triangles, on a flat top, risen more than RAISED. */
function raisedOver(roads: Roads): Cover {
  const raised: number[] = [];
  for (const r of Object.values(roads)) {
    if (r.along) continue;
    for (const k of r.kerbs ?? [])
      for (const g of kerbGeometry(r, k, roads, () => 0))
        for (let f = 0; f < g.F.length; f += 3) {
          const v = [g.F[f] as number, g.F[f + 1] as number, g.F[f + 2] as number];
          if (Math.max(...v.map((i) => g.P[i * 3 + 1] as number)) > RAISED)
            for (const i of v) raised.push(g.P[i * 3] as number, g.P[i * 3 + 1] as number, g.P[i * 3 + 2] as number);
        }
  }
  return new Cover(raised);
}

/** The paint laid on the surface as merged (floor: the merged roads and rumbles, the ground not): each road's edge
 * lines along their whole length (over whatever floor is there: another road, a rumble, a run-off), then the marks,
 * all painted as paintLines paints them (an edge line and the next whose ends meet, a road's and the road it joins,
 * one line, its corners mitred; round a ring of them closed; where they overlap, painted once; a mark over a line of
 * another colour on top); a piece only on the floor, none under a rumble's raised part (its rise over its road more
 * than RAISED: the Python's merge_floor); LINE_LIFT over the floor. */
export function layPaint(roads: Roads, floor: Surface, marks: Mark[] = []): Promise<PaintMesh[]> {
  const items: { name: string; paint: Paintable }[] = [];
  for (const road of Object.values(roads)) {
    if (road.along) continue;
    for (const line of road.lines ?? []) {
      const paint = edgeLine(road, line);
      if (paint) items.push({ name: line.name ?? `LINE_${road.name}`, paint });
    }
  }
  marks.forEach((m, k) => {
    items.push({ name: m.name ?? `MARK_${k + 1}`, paint: paintable(m) });
  });
  const under = raisedOver(roads);
  return paintLines(
    items,
    (x, z) => !Number.isNaN(floor.y(x, z)) && !under.has(x, z),
    (x, z) => floor.y(x, z),
  );
}

// ---- the marks and the start lines (place_objects' marks, start_lines) -------------------------------------------

/** metres: the cells the marks' paint is cut in (each piece of it on the floor under it) */
export const MARK_STEP = 0.25;
/** a layout's start line (objects.json's layouts' `start_line`): chequered squares, or a single solid white line */
export type StartLineStyle = 'checker' | 'line';
/** metres a square, its rows behind the line, metres in from the road's edges */
export const CHECKER = 0.3;
export const CHECKER_ROWS = 2;
export const CHECKER_IN = 0.3;
/** metres the start line's front is ahead of the middle of the grid's first slot (a kart's nose and a little more) */
export const START_AHEAD = 1.5;
/** metres wide a solid start line is, along the road: as the roads' edge lines are */
export const START_LINE_W = LINE_W;
/** metres either way across the road the start line is looked for, from where it crosses the road's middle */
const ACROSS_REACH = 20;

/** A mark (objects.json's marks): paint along its curve (an older file's: from p, its length along its heading), its
 * width. */
export interface Mark {
  name?: string;
  curve?: WallNode[];
  closed?: boolean;
  p?: [number, number];
  heading?: number;
  length?: number;
  width?: number;
  colour?: string;
  style?: string;
  dash?: number;
  gap?: number;
}

/** np.arange(start, stop, step) */
const npArange = (start: number, stop: number, step: number) =>
  Array.from({ length: Math.max(Math.ceil((stop - start) / step), 0) }, (_, i) => start + i * step);

/** Points and faces lifted onto the floor, LINE_LIFT over it, each face turned to face up. */
function lifted(name: string, colour: string, P: number[], F: number[], floor: (x: number, z: number) => number) {
  for (let i = 0; i < P.length; i += 3) P[i + 1] = floor(P[i] as number, P[i + 2] as number) + LINE_LIFT;
  facingUp(P, F);
  return { name, colour, P: Float64Array.from(P), F: Int32Array.from(F) };
}

/** A mark as painted: its curve (an older one's straight from p), its paint (unless it says: LINE_W wide, white,
 * solid). */
export function paintable(mk: Mark): Paintable {
  const curve = mk.curve ?? (mk.p ? legacyCurve({ p: mk.p, heading: mk.heading ?? 0, length: mk.length ?? 0 }) : []);
  return {
    curve,
    closed: mk.closed,
    width: mk.width ?? LINE_W,
    colour: mk.colour ?? 'white',
    style: mk.style ?? 'solid',
    dash: mk.dash,
    gap: mk.gap,
  };
}

/** A ring without the points that go straight on (between two in line with them): what it is cut in triangles of. */
function cornersOf(ring: Vec2[]): Vec2[] {
  // (a point repeated once; then, again and again, a point in line with those either side of it out)
  let pts = ring.filter((q, i) => {
    const p = ring[(i + ring.length - 1) % ring.length] as Vec2;
    return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9;
  });
  for (let changed = true; changed && pts.length >= 3; ) {
    changed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n] as Vec2;
      const b = pts[i] as Vec2;
      const c = pts[(i + 1) % n] as Vec2;
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(cr) <= 1e-12 * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]))) {
        pts = [...pts.slice(0, i), ...pts.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** a shape of paint with more points than this split in tiles PAINT_TILE metres square, a mesh each (none too big
 * for a game: AC's meshes count their points in 16 bits) */
export const PAINT_MOST = 30000;
export const PAINT_TILE = 64;

/** Lines of paint laid (each named, its paint): the lines they make (paintChains: those of one paint whose ends meet
 * one line, its corners mitred, round to its first where they close a ring; dotted, in its dashes), each widened,
 * all of a colour that meet one shape (where they overlap, painted once; a colour's under a later line's of another
 * colour, cut away), each shape a mesh named as its first line is (one of more than PAINT_MOST points, a mesh each
 * PAINT_TILE square of it, the first its name, the rest _2, _3...). Cut in cells MARK_STEP square, a piece only where keep says (its middle), each point
 * of it LINE_LIFT over the floor's height there (none: the floor's at the piece's middle). */
async function paintLines(
  items: { name: string; paint: Paintable }[],
  keep: (x: number, z: number) => boolean,
  floor: (x: number, z: number) => number,
): Promise<PaintMesh[]> {
  const chains = paintChains(items.map((i) => i.paint));
  if (!chains.length) return [];
  // (GEOS loaded only here, where it is needed: the map's start lines, painted without it, not waiting on it)
  const { geosPaint, geosReady } = await import('./geos');
  await geosReady();
  const shapes = geosPaint(
    chains.map((c) => ({
      colour: c.colour,
      half: c.width / 2,
      lines: c.style === 'dotted' ? chainPieces(c).map((points) => ({ points, closed: false })) : [c],
      ...(c.cuts ? { cuts: c.cuts.map(pastSeam) } : {}),
    })),
    MARK_STEP,
  );
  const out: PaintMesh[] = [];
  for (const shape of shapes) {
    const tiles = new Map<string, { P: number[]; F: number[] }>();
    for (const piece of shape.pieces) {
      const ring = cornersOf(piece);
      if (ring.length < 3) continue;
      const cx = ring.reduce((a, q) => a + q[0], 0) / ring.length;
      const cz = ring.reduce((a, q) => a + q[1], 0) / ring.length;
      if (!keep(cx, cz)) continue;
      const mid = floor(cx, cz);
      const key = `${Math.floor(cx / PAINT_TILE)},${Math.floor(cz / PAINT_TILE)}`;
      let t = tiles.get(key);
      if (!t) {
        t = { P: [], F: [] };
        tiles.set(key, t);
      }
      const base = t.P.length / 3;
      for (const [x, z] of ring) {
        const y = floor(x, z);
        t.P.push(x, (Number.isNaN(y) ? (Number.isNaN(mid) ? 0 : mid) : y) + LINE_LIFT, z);
      }
      for (const i of earClip(ring)) t.F.push(base + i);
    }
    const first = Math.min(...shape.strokes.flatMap((k) => chains[k]?.marks ?? []));
    const name = items[first]?.name ?? `PAINT_${first + 1}`;
    const colour = chains[shape.strokes[0] as number]?.colour ?? 'white';
    const all = [...tiles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, t]) => t);
    const points = all.reduce((n, t) => n + t.P.length / 3, 0);
    const parts =
      points > PAINT_MOST
        ? all
        : [
            all.reduce(
              (one, t) => {
                const base = one.P.length / 3;
                for (const v of t.P) one.P.push(v);
                for (const i of t.F) one.F.push(i + base);
                return one;
              },
              { P: [] as number[], F: [] as number[] },
            ),
          ];
    let k = 0;
    for (const t of parts) {
      if (!t.F.length) continue;
      facingUp(t.P, t.F);
      k++;
      out.push({ name: k === 1 ? name : `${name}_${k}`, colour, P: Float64Array.from(t.P), F: Int32Array.from(t.F) });
    }
  }
  return out;
}

/** The marks painted (paintLines), a piece only where there is road under it (onRoad: paint never on the grass);
 * LINE_LIFT over the floor. */
export function markPaint(
  marks: Mark[],
  onRoad: (x: number, z: number) => boolean,
  floor: (x: number, z: number) => number,
): Promise<PaintMesh[]> {
  return paintLines(
    marks.map((m, k) => ({ name: m.name ?? `MARK_${k + 1}`, paint: paintable(m) })),
    onRoad,
    floor,
  );
}

/** Where a line from a (along u, from s = lo to hi) is inside a ring: its stretches inside, [s0, s1] each, in order. */
function insideRuns(ring: number[][], a: [number, number], u: [number, number], lo: number, hi: number) {
  const cuts: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as number[];
    const q = ring[(i + 1) % ring.length] as number[];
    const ex = (q[0] as number) - (p[0] as number);
    const ez = (q[1] as number) - (p[1] as number);
    const den = u[0] * ez - u[1] * ex;
    if (Math.abs(den) < 1e-15) continue;
    const dx = (p[0] as number) - a[0];
    const dz = (p[1] as number) - a[1];
    const s = (dx * ez - dz * ex) / den;
    const r = (dx * u[1] - dz * u[0]) / den;
    if (r >= 0 && r < 1 && s > lo && s < hi) cuts.push(s);
  }
  cuts.sort((x, y) => x - y);
  const at = [lo, ...cuts, hi];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < at.length; i++) {
    const m = ((at[i] as number) + (at[i + 1] as number)) / 2;
    if (inside(ring, a[0] + u[0] * m, a[1] + u[1] * m)) out.push([at[i] as number, at[i + 1] as number]);
  }
  return out;
}

/** Stretches [s0, s1] joined where they overlap or touch (within JOIN_GAP), in order. */
function joinedRuns(runs: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [r0, r1] of [...runs].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && r0 <= last[1] + JOIN_GAP) last[1] = Math.max(last[1], r1);
    else out.push([r0, r1]);
  }
  return out;
}

/** the timing gate a layout's start line is painted along: its start and finish (AC's first timing gate) */
export const START_GATE = 'AC_TIME_0';

/** metres between two roads' stretches across the start line that are still one (their outlines meeting) */
const JOIN_GAP = 0.05;

/** A road (not a run-off) with its outline and the outline's box (x0, x1, z0, z1). */
export interface Outlined {
  road: RoadDesc;
  ring: number[][];
  box: readonly [number, number, number, number];
}

/** The roads' outlines, not the run-offs', each with its box: worked out once for all the start lines. */
export function outlinesOf(roads: Roads): Outlined[] {
  return Object.values(roads)
    .filter((r) => !r.along)
    .map((road) => {
      const ring = outline(road, roads);
      let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const q of ring) {
        const x = q[0] as number;
        const z = q[1] as number;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      return { road, ring, box: [x0, x1, z0, z1] as const };
    });
}

/** Whether (x, z) is in an outline: in its box, then even-odd (a point on its edge either way: paint, not a
 * boundary). */
function within(o: Outlined, x: number, z: number): boolean {
  const [x0, x1, z0, z1] = o.box;
  if (x < x0 || x > x1 || z < z0 || z > z1) return false;
  let inn = false;
  const r = o.ring;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i] as number[];
    const b = r[j] as number[];
    const az = a[1] as number;
    const bz = b[1] as number;
    if (az > z !== bz > z && x < (((b[0] as number) - (a[0] as number)) * (z - az)) / (bz - az) + (a[0] as number))
      inn = !inn;
  }
  return inn;
}

/** Where a layout's start line goes: across the road its grid's first slot is on (of the roads, not a run-off, whose
 * outline holds it, the one whose middle is nearest), START_AHEAD in front of that slot along the road the way it
 * faces, square to the road there. A point of its front (a), the way across the road (u), the way back to the grid
 * (back), that road (its name, its outline); null where the slot is on no road. */
export function startLineAt(
  slot: { x: number; z: number; heading: number },
  roads: Roads,
  outlined: Outlined[] = outlinesOf(roads),
): { a: [number, number]; u: [number, number]; back: [number, number]; road: string; ring: number[][] } | null {
  let best: {
    a: [number, number];
    u: [number, number];
    back: [number, number];
    road: string;
    ring: number[][];
    d: number;
  } | null = null;
  const fx = Math.sin(slot.heading);
  const fz = Math.cos(slot.heading);
  for (const o of outlined) {
    const { road, ring } = o;
    if (!within(o, slot.x, slot.z)) continue;
    const f = fine(road);
    const near = (px: number, pz: number) => {
      let k = 0;
      let d = Infinity;
      for (let i = 0; i < f.at.length; i++) {
        const e = Math.hypot((f.mx[i] as number) - px, (f.mz[i] as number) - pz);
        if (e < d) [k, d] = [i, e];
      }
      return { k, d };
    };
    const { k, d } = near(slot.x, slot.z);
    if (best && d >= best.d) continue;
    // (the road's way where the slot is, turned the way the slot faces; the front that far along it)
    const lx = f.lx[k] as number;
    const lz = f.lz[k] as number;
    let t: [number, number] = [-lz, lx];
    if (t[0] * fx + t[1] * fz < 0) t = [-t[0], -t[1]];
    const ahead: [number, number] = [slot.x + t[0] * START_AHEAD, slot.z + t[1] * START_AHEAD];
    // (square to the road where the line is, through its middle there)
    const m = near(ahead[0], ahead[1]).k;
    const ux = f.lx[m] as number;
    const uz = f.lz[m] as number;
    const L = Math.hypot(ux, uz) || 1;
    const u: [number, number] = [ux / L, uz / L];
    let back: [number, number] = [u[1], -u[0]];
    if (back[0] * t[0] + back[1] * t[1] > 0) back = [-back[0], -back[1]];
    best = { a: ahead, u, back, road: road.name, ring, d };
  }
  if (!best) return null;
  const { d: _d, ...at } = best;
  return at;
}

/** The start lines painted: each layout's that has one (its `start_line`), along its start and finish gate (START_GATE,
 * between its posts), else across the road at the front of its grid (startLineAt); on each stretch of road it
 * crosses, from CHECKER_IN in from one edge to as far from the other: chequered (squares CHECKER a side, white and the
 * road's own by turns, CHECKER_ROWS of them back the way the grid's karts come from, in whole squares), or a single
 * solid white line START_LINE_W wide; LINE_LIFT over the floor. */
export function startLinePaint(
  layouts: Record<
    string,
    {
      grid?: { x: number; z: number; heading?: number }[];
      timing?: { name?: string; left: { x: number; z: number }; right: { x: number; z: number } }[];
      start_line?: StartLineStyle | null;
    }
  >,
  roads: Roads,
  floor: (x: number, z: number) => number,
): PaintMesh[] {
  const out: PaintMesh[] = [];
  // (the roads' outlines, not the run-offs': the line across all of them where they meet, a merge's both roads)
  // (each outline once, with its box: a point tested only against the outlines whose box holds it)
  const outlined = outlinesOf(roads);
  const onRoads = (x: number, z: number) => outlined.some((o) => within(o, x, z));
  // (the outlines whose box meets the square of side 2 reach round (x, z))
  const nearTo = (x: number, z: number, reach: number) =>
    outlined.filter(
      ({ box: [x0, x1, z0, z1] }) => x1 >= x - reach && x0 <= x + reach && z1 >= z - reach && z0 <= z + reach,
    );
  for (const [layout, lay] of Object.entries(layouts)) {
    const style = lay.start_line;
    const g0 = lay.grid?.[0];
    if (style !== 'checker' && style !== 'line') continue;
    // where it is painted: along its start and finish gate, between its posts (the roads' stretches there); else
    // across the road ahead of its grid's first slot (the stretch where it crosses that road's middle, or the nearest)
    let a: [number, number];
    let u: [number, number];
    let back: [number, number];
    let segs: [number, number][];
    const gate = lay.timing?.find((t) => t.name === START_GATE);
    const L = gate ? Math.hypot(gate.right.x - gate.left.x, gate.right.z - gate.left.z) : 0;
    if (gate && L > 0.5) {
      a = [gate.left.x, gate.left.z];
      u = [(gate.right.x - gate.left.x) / L, (gate.right.z - gate.left.z) / L];
      // (its rows behind the line, the way the grid's karts come from: against its first slot's heading)
      back = [u[1], -u[0]];
      if (g0) {
        const h = g0.heading ?? 0;
        if (back[0] * Math.sin(h) + back[1] * Math.cos(h) > 0) back = [-back[0], -back[1]];
      }
      const mid: [number, number] = [a[0] + (u[0] * L) / 2, a[1] + (u[1] * L) / 2];
      segs = joinedRuns(nearTo(mid[0], mid[1], L / 2 + 1).flatMap((o) => insideRuns(o.ring, a, u, 0, L)));
    } else {
      if (!g0) continue;
      const at = startLineAt({ x: g0.x, z: g0.z, heading: g0.heading ?? 0 }, roads, outlined);
      if (!at) continue;
      ({ a, u, back } = at);
      const runs = joinedRuns(
        nearTo(a[0], a[1], ACROSS_REACH).flatMap((o) => insideRuns(o.ring, a, u, -ACROSS_REACH, ACROSS_REACH)),
      );
      const off = ([r0, r1]: [number, number]) => (r0 > 0 ? r0 : r1 < 0 ? -r1 : 0);
      const seg = runs.sort((x, y) => off(x) - off(y))[0];
      segs = seg ? [seg] : [];
    }
    const P: number[] = [];
    const F: number[] = [];
    const quad = (q: [number, number][]) => {
      if (!q.every(([x, z]) => onRoads(x, z))) return;
      const k0 = P.length / 3;
      for (const [x, z] of q) P.push(x, 0, z);
      F.push(k0, k0 + 1, k0 + 2, k0, k0 + 2, k0 + 3);
    };
    const corner = (s: number, r: number): [number, number] => [
      a[0] + u[0] * s + back[0] * r,
      a[1] + u[1] * s + back[1] * r,
    ];
    // (each stretch of road it crosses, CHECKER_IN in from its edges)
    for (const [r0, r1] of segs) {
      let s0 = r0 + CHECKER_IN;
      const s1 = r1 - CHECKER_IN;
      if (s1 <= s0) continue;
      if (style === 'checker') {
        const n = Math.floor((s1 - s0) / CHECKER);
        s0 += (s1 - s0 - n * CHECKER) / 2;
        for (let i = 0; i < n; i++)
          for (let r = 0; r < CHECKER_ROWS; r++) {
            if ((i + r) % 2) continue;
            const sa = s0 + i * CHECKER;
            const ra = r * CHECKER;
            quad([
              corner(sa, ra),
              corner(sa + CHECKER, ra),
              corner(sa + CHECKER, ra + CHECKER),
              corner(sa, ra + CHECKER),
            ]);
          }
      } else {
        // (in pieces MARK_STEP long across the road, each on the floor under it)
        const S = [...npArange(s0, s1, MARK_STEP), s1];
        for (let j = 0; j + 1 < S.length; j++) {
          const sa = S[j] as number;
          const sb = S[j + 1] as number;
          quad([corner(sa, 0), corner(sb, 0), corner(sb, START_LINE_W), corner(sa, START_LINE_W)]);
        }
      }
    }
    if (F.length) out.push(lifted(`START_${layout.toUpperCase()}`, 'white', P, F, floor));
  }
  return out;
}
