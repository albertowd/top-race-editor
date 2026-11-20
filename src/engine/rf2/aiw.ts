// rFactor 2's AIW of a layout (its AI's waypoints, grid, pits and timing), made from the layout's spots and gates and
// its AI lines (aimake.ts's aiLineOf: a point every half metre on the floor, with its way, the floor's normal, the road
// to either side and a speed). Its syntax as Studio 397's own AIWs have it (ModDev/Locations: Joesville Speedway's, an
// oval of 407 waypoints with a pit lane; LochDrummond Long and Short, road courses), CRLF lines, written by their AIW
// editor (gMa1.002f). What the samples show:
//
// - The file: the editor's first line, [Features] (pitlanes; startinggrid 104, pitspots 52, garagespots 3, auxspots 8,
//   the same in every sample: capacities; each path's name and lap time, definepath / pathtime), [GRID] (GridIndex,
//   Pos, Ori a slot, the pole first), [ALTGRID] (another grid: empty at LochDrummond), [TELEPORT] (slots as the grid's,
//   from the waypoint teleportwp on), [PITS] (TeamIndex, PitPos / PitOri its pit box, GarPos / GarOri (n, ...) its
//   garages), [AUX] (LocationIndex 0 and 1, a place each), [Waypoint]: a header, then each waypoint's lines. A blank
//   line before each section, two CRLFs at the end; comments (//) on the header's AISpec and the first waypoint only.
// - Axes: y up, left-handed. wp_perp is wp_normal × the way (its components' cross product) and points to the right:
//   Joesville is run anticlockwise seen from above (left turns, as ovals are), its infield, apron and pit lane to the
//   left (-perp), its banked turns' normals leaning in; LochDrummond's lines likewise. A car's nose is its -z, its left
//   its +x: Ori is (pitch, yaw, roll) in radians, its way (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch), its
//   normal rolled towards its left by -roll (Joesville's banked grid: roll -0.180, its normals leaning 10° to the left);
//   turned as y · x · z (yaw, then pitch, then roll: with pitch and roll this small the order cannot be told). Every
//   Ori (GRID, PITS' Pit and Gar, AUX, wp_oriantation) alike. The track's x, y, z (a right-handed world, aimake's and
//   the objects') are made rFactor's by `axes` (by default z turned round), as the GMTs' must be.
// - A waypoint: wp_pos LIFT (0.1 m) over the floor (a grid slot's or pit box's Pos is on it); wp_perp, wp_normal unit
//   vectors, at right angles; per path (0 FASTEST, 1 LEFT, 2 RIGHT, as [Features] defines them) wp_pathinfo2 (path,
//   its offset from the waypoint along wp_perp in metres, then two values of the editor's test runs, the second a
//   speed: -1, -1 where it has none, as Joesville's fastest path and every pit lane have), wp_oriantation (path, the
//   way's pitch, yaw, roll: unset rubbish at the samples' non-path waypoints, so the game cannot need it), wp_pathflags
//   (path, 0); wp_width (metres to the road's left and right edges, then to the far ones, what may be driven beyond
//   it), wp_dwidth (to what is hit left and right, the far edges at every sample; then two cut widths, 0), wp_test_speed
//   (m/s of the editor's test run; 0 or -1 off the lap), wp_score (sector 0..2, metres into the lap), wp_wpse (0, 0;
//   once (1, a number like a hash) on the pit lane at xpitin), wp_branchID, wp_bitfields (1: a non-path waypoint),
//   wp_pitlane (1 everywhere), WP_PTRS (prev, next, branch: a waypoint another way goes on to, -1 none; then its own
//   branchID, at every waypoint of every sample). wp_lockedAlpha and wp_reverb 0 everywhere.
// - Waypoints 5 m apart (LochDrummond's exactly; Joesville's 5 to 6 m, its 407 a main loop of 124, a pit lane of 103
//   and two for each grid slot and pit box).
// - Branches: 0 the main loop, its last's next its first. 1 the pit lane: its first's prev the main waypoint where it
//   forks, whose branch is the pit lane's first; its last's next the main waypoint it merges into (nothing points
//   back). Its waypoints' branch the main waypoint beside them, but none (or a box's) between xpitin and xpitout, along
//   the boxes. Its scores the lap's distance beside it. 2 + g grid slot g; 2 + startinggrid + k team k's pit box: two
//   non-path waypoints each, the spot (its next itself: a dead end) and one some metres behind it leading in (3.58 m at
//   Joesville's grid, 3.05 at its boxes), whose prev is a lane's waypoint some way behind (10 to 20 m), that one's
//   branch the lead-in; a box's two have the pit lane's next waypoint on as their branch (the way out), a slot's none.
// - Timing: the lap starts where the main loop crosses xfinish (score 0; Joesville's xfinish at x 1.1, between
//   waypoints 2 and 3); sector_1_length and sector_2_length are the scores at xsector1 and xsector2 (LochDrummond's
//   each the score of the first waypoint of its sector), a waypoint's sector the one its score is in; lap_length the
//   loop's length, every score the 3D length of the chords from the start (to a millimetre). The beams (GMTs, Response
//   VEHICLE,TIMING) time the laps; xpitin and xpitout (VEHICLE,PITSTOP) cross the pit lane before its first box and
//   after its last (Joesville: about 15 m).
//
// Made here of the layout: the waypoints (the fast line's and the pit line's points every SPACING metres, closer where
// the grid's slots or the boxes are closer, so that each has a lane's waypoint of its own to be led in from; on the
// floor, their normals, ways, road edges and speeds aimake's; which side an edge is told by the waypoint's perp, not by
// aimake's names), a waypoint on the start line and each sector's start, the scores, sectors and lap from them, the
// grid's slots and the pit boxes (on the floor, their Ori of their heading and the floor's slope; the boxes led in from
// the pit lane, or from the main loop where they are nearer it), the links. Set as a sample has them:
// trackstate, the [Features] capacities, the header's AI settings (LochDrummond Long's), pitlanepaths, the lead-ins'
// lengths. Guessed: the far edges (the road's, RUNOFF more: the samples' are the grass to the walls), LEFT and RIGHT
// paths (either side of the road's middle, LaneSpacing apart where it is wide enough), path times and FuelUse (from
// the speeds, Joesville's fuel a metre), one garage a team at its pit box (karts have no garages), the two AUX places
// (on the pit lane before xpitout, where Joesville has them), TELEPORT as the grid, LeftHandedPits (the side the boxes
// are of the pit lane: LochDrummond's are on the right and say 1 all the same), the pit lane's scores (from the fork's
// to the merge's, evenly: a pit lane looping back, as the Velopark's do, has none beside it).

import type { Gate, LayoutObjects, Spot } from '../../domain/types';
import type { aiLineOf } from '../aimake';

export type V3 = [number, number, number];
/** a line as aimake's aiLineOf makes it: its points (x, y, z) on the floor, how far along each, 18 values each */
export type AiLine = ReturnType<typeof aiLineOf>;
/** the track's x, y, z to rFactor's (y up both) */
export type Axes = (x: number, y: number, z: number) => V3;

/** The track's world (right-handed, y up) as rFactor's (left-handed): its z turned round. */
export const TRACK_TO_RF2: Axes = (x, y, z) => [x, y, -z];

/** metres between waypoints (LochDrummond's); the least they come to where the grid's slots or the pit boxes are
 * closer */
export const SPACING = 5;
export const LEAST_SPACING = 1;
/** metres a waypoint is over the floor (the samples': their grid slots' and boxes' waypoints over their Pos) */
export const LIFT = 0.1;
/** metres behind a grid slot and a pit box their lead-in is (Joesville's) */
export const GRID_LEAD = 3.58;
export const PIT_LEAD = 3.05;
/** metres back along its lane a lead-in leaves it, at least */
export const LINK_BACK = 10;
/** metres the far edges are beyond the road's */
export const RUNOFF = 2;
/** metres apart the LEFT and RIGHT paths are where the road is wide enough (the header's LaneSpacing), and the least
 * they keep from its edges */
export const LANE_SPACING = 4.5;
export const LANE_EDGE = 1;
/** metres before the first pit box xpitin crosses the pit lane, and after the last xpitout */
export const PIT_BEAM = 10;
/** metres off the pit lane the main waypoint beside it is, at most */
export const BESIDE = 10;
/** fuel a metre of the lap (Joesville's FuelUse over its lap_length) */
export const FUEL_PER_METRE = 15;
/** the capacities every sample's [Features] has */
export const STARTING_GRID = 104;
export const PIT_SPOTS = 52;
export const GARAGE_SPOTS = 3;
/** metres between a team's garage spots, one behind the other from its pit box */
export const GARAGE_BACK = 3;
export const AUX_SPOTS = 8;
/** the paths, as Joesville defines them: their names, and their lap times over the fastest's (LochDrummond Short's) */
const PATHS = ['FASTEST', 'LEFT', 'RIGHT'] as const;
const PATH_TIME = [1, 1.05, 1.05];

// (aimake's 18 values a point: its speed, the road to the side of (wz, -wx) (AC's left) and to the other, the floor's
// normal, its way)
const E = 18;
const SPEED = 0;
const SIDE_A = 5;
const SIDE_B = 6;
const NORMAL = 9;
const WAY = 13;

export interface AiwInput {
  layout: Pick<LayoutObjects, 'grid' | 'pits' | 'timing'>;
  /** aiLineOf of the layout's fast line (closed) and of its pit line (none: no pit lane) */
  fast: AiLine;
  pit?: AiLine | null;
  /** the floor's height at (x, z), NaN off it (the grid's, the boxes' and the gates' places; none: the nearer line's) */
  floor?: (x: number, z: number) => number;
  axes?: Axes;
  spacing?: number;
}

export type BeamName = 'xfinish' | 'xsector1' | 'xsector2' | 'xpitin' | 'xpitout';

/** A timing beam: across the lap (or the pit lane) from left to right (rFactor's axes, on the floor), at `score`
 * metres into the lap; made of its timing gate, or across the line where the layout has none. */
export interface Beam {
  name: BeamName;
  left: V3;
  right: V3;
  score: number;
  gate: string | null;
}

export interface AiwTiming {
  lap: number;
  sector1: number;
  sector2: number;
  beams: Beam[];
}

// ---------------------------------------------------------------- vectors

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};
const lerp = (a: V3, b: V3, f: number): V3 => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
  a[2] + (b[2] - a[2]) * f,
];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const flatDist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const mod = (v: number, m: number) => ((v % m) + m) % m;

/** A waypoint's frame of its way and the floor's normal (rFactor's axes): its way along the floor, its perp (to its
 * right: normal × way) and its Ori (pitch, yaw, roll). */
export function orientation(way: V3, normal: V3): { way: V3; perp: V3; ori: V3 } {
  const n = unit(normal);
  const d = unit(sub(way, mul(n, dot(way, n))));
  const perp = unit(cross(n, d));
  const yaw = Math.atan2(-d[0], -d[2]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
  // (its normal: -sin roll along its left, cos roll along its up with no roll)
  const left: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up: V3 = [Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
  const roll = Math.atan2(-dot(n, left), dot(n, up));
  return { way: d, perp, ori: [pitch, yaw, roll] };
}

// ---------------------------------------------------------------- a line, every half metre, in rFactor's axes

interface Dense {
  P: V3[];
  N: V3[];
  W: V3[];
  /** the road to its left and right (metres) */
  L: number[];
  R: number[];
  V: number[];
  /** how far along each point is, and the whole (a closed one round to its first again) */
  S: number[];
  total: number;
  closed: boolean;
}

interface Sample {
  p: V3;
  n: V3;
  w: V3;
  left: number;
  right: number;
  v: number;
}

function denseOf(ai: AiLine, closed: boolean, axes: Axes): Dense {
  const n = ai.along.length;
  const P: V3[] = [];
  const N: V3[] = [];
  const W: V3[] = [];
  const L: number[] = [];
  const R: number[] = [];
  const V: number[] = [];
  const S: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = (k: number) => ai.extra[i * E + k] as number;
    const at: V3 = [ai.points[i * 3] as number, ai.points[i * 3 + 1] as number, ai.points[i * 3 + 2] as number];
    const p = axes(...at);
    const dir = (v: V3) => sub(axes(...add(at, v)), p);
    const nm = unit(dir([e(NORMAL), e(NORMAL + 1), e(NORMAL + 2)]));
    const w = unit(dir([e(WAY), e(WAY + 1), e(WAY + 2)]));
    // (aimake's first side is towards (wz, -wx) of its way: which of rFactor's it is, its perp told)
    const flat = Math.hypot(e(WAY), e(WAY + 2)) || 1;
    const a = dir([e(WAY + 2) / flat, 0, -e(WAY) / flat]);
    const right = dot(a, cross(nm, w)) > 0;
    P.push(p);
    N.push(nm);
    W.push(w);
    L.push(right ? e(SIDE_B) : e(SIDE_A));
    R.push(right ? e(SIDE_A) : e(SIDE_B));
    V.push(e(SPEED));
    S.push(i ? (S[i - 1] as number) + dist(p, P[i - 1] as V3) : 0);
  }
  const total = (S[n - 1] ?? 0) + (closed && n > 1 ? dist(P[n - 1] as V3, P[0] as V3) : 0);
  return { P, N, W, L, R, V, S, total, closed };
}

/** The point s metres along a line (a closed one round again). */
function sampleAt(d: Dense, s: number): Sample {
  const n = d.P.length;
  const at = d.closed ? mod(s, d.total) : Math.min(Math.max(s, 0), d.S[n - 1] as number);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((d.S[mid] as number) <= at) lo = mid;
    else hi = mid - 1;
  }
  const j = d.closed ? (lo + 1) % n : Math.min(lo + 1, n - 1);
  const end = lo + 1 < n ? (d.S[lo + 1] as number) : d.total;
  const f = end > (d.S[lo] as number) ? (at - (d.S[lo] as number)) / (end - (d.S[lo] as number)) : 0;
  const num = (A: number[]) => (A[lo] as number) + ((A[j] as number) - (A[lo] as number)) * f;
  return {
    p: lerp(d.P[lo] as V3, d.P[j] as V3, f),
    n: unit(lerp(d.N[lo] as V3, d.N[j] as V3, f)),
    w: unit(lerp(d.W[lo] as V3, d.W[j] as V3, f)),
    left: num(d.L),
    right: num(d.R),
    v: num(d.V),
  };
}

/** How far along a line the point of it nearest q is (seen from above). */
const project = (d: Dense, q: V3): number => nearestOn(d, q).s;

/** The point of a line nearest q (seen from above): how far along it, how far off. */
function nearestOn(d: Dense, q: V3): { s: number; off: number } {
  const n = d.P.length;
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < (d.closed ? n : n - 1); i++) {
    const a = d.P[i] as V3;
    const b = d.P[(i + 1) % n] as V3;
    const ab: V3 = [b[0] - a[0], 0, b[2] - a[2]];
    const len2 = ab[0] ** 2 + ab[2] ** 2;
    const t = len2 ? Math.min(1, Math.max(0, ((q[0] - a[0]) * ab[0] + (q[2] - a[2]) * ab[2]) / len2)) : 0;
    const m = Math.hypot(a[0] + ab[0] * t - q[0], a[2] + ab[2] * t - q[2]);
    if (m < bd) {
      bd = m;
      const end = i + 1 < n ? (d.S[i + 1] as number) : d.total;
      best = (d.S[i] as number) + (end - (d.S[i] as number)) * t;
    }
  }
  return { s: best, off: bd };
}

/** Where a line crosses the segment a to b (seen from above), how far along it: the crossing nearest the segment's
 * middle; null where it does not. */
function crossing(d: Dense, a: V3, b: V3): number | null {
  const n = d.P.length;
  const mid = lerp(a, b, 0.5);
  let best: number | null = null;
  let bd = Infinity;
  for (let i = 0; i < (d.closed ? n : n - 1); i++) {
    const p = d.P[i] as V3;
    const q = d.P[(i + 1) % n] as V3;
    const r = [q[0] - p[0], q[2] - p[2]] as const;
    const s = [b[0] - a[0], b[2] - a[2]] as const;
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a[0] - p[0]) * s[1] - (a[2] - p[2]) * s[0]) / den;
    const u = ((a[0] - p[0]) * r[1] - (a[2] - p[2]) * r[0]) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const at = lerp(p, q, t);
    const m = flatDist(at, mid);
    if (m < bd) {
      bd = m;
      const end = i + 1 < n ? (d.S[i + 1] as number) : d.total;
      best = (d.S[i] as number) + (end - (d.S[i] as number)) * t;
    }
  }
  return best;
}

// ---------------------------------------------------------------- the waypoints

interface Waypoint {
  pos: V3;
  perp: V3;
  normal: V3;
  way: V3;
  ori: V3;
  /** each path's offset along perp */
  offsets: number[];
  /** road left, right; far left, right */
  width: [number, number, number, number];
  speed: number;
  score: number;
  sector: number;
  branch: number;
  nonpath: boolean;
  prev: number;
  next: number;
  link: number;
}

interface Built {
  wps: Waypoint[];
  main: number;
  lap: number;
  sector1: number;
  sector2: number;
  grid: { pos: V3; ori: V3 }[];
  pits: { pos: V3; ori: V3 }[];
  aux: { pos: V3; ori: V3 };
  teleport: number;
  leftPits: boolean;
  pathTime: number;
  pitLane: boolean;
  beams: Beam[];
}

/** A lane's spacing: about `spacing`, closer where its spots (count of them, spread metres along it) are closer, so
 * that each has a waypoint of its own to be led in from. */
const spacingFor = (spacing: number, spread: number, count: number) =>
  count > 1 && spread > 0 ? Math.min(spacing, Math.max(LEAST_SPACING, (0.9 * spread) / (count - 1))) : spacing;

/** LEFT and RIGHT either side of the road's middle (from a waypoint `left` and `right` metres to its edges). */
function offsetsOf(left: number, right: number): number[] {
  const middle = (right - left) / 2;
  const half = Math.max(0, Math.min(LANE_SPACING / 2, (left + right) / 2 - LANE_EDGE));
  return [0, middle - half, middle + half];
}

function waypointOf(s: Sample, lane: boolean): Waypoint {
  const f = orientation(s.w, s.n);
  return {
    pos: add(s.p, [0, LIFT, 0]),
    perp: f.perp,
    normal: s.n,
    way: f.way,
    ori: f.ori,
    offsets: lane ? offsetsOf(s.left, s.right) : [0, 0, 0],
    width: [s.left, s.right, s.left + RUNOFF, s.right + RUNOFF],
    speed: s.v,
    score: 0,
    sector: 0,
    branch: 0,
    nonpath: false,
    prev: -1,
    next: -1,
    link: -1,
  };
}

function build(input: AiwInput): Built {
  const axes = input.axes ?? TRACK_TO_RF2;
  const spacing = input.spacing ?? SPACING;
  const { grid, pits, timing } = input.layout;
  if (input.fast.along.length < 3) throw new Error('the layout has no fast line to make waypoints of');
  if (grid.length > STARTING_GRID) throw new Error(`${grid.length} grid slots: rFactor takes ${STARTING_GRID}`);
  if (pits.length > PIT_SPOTS) throw new Error(`${pits.length} pit boxes: rFactor takes ${PIT_SPOTS}`);
  const fast = denseOf(input.fast, true, axes);
  const pitDense = input.pit && input.pit.along.length >= 2 ? denseOf(input.pit, false, axes) : null;
  // (a place of the track's on the floor, in rFactor's axes; its normal: the floor's there, else the nearer line's)
  const onFloor = (x: number, z: number, near: Dense): { p: V3; n: V3 } => {
    const h = input.floor ? input.floor(x, z) : Number.NaN;
    if (Number.isNaN(h)) {
      const flat = axes(x, 0, z);
      const s = sampleAt(near, project(near, flat));
      return { p: [flat[0], s.p[1], flat[2]], n: s.n };
    }
    const fl = input.floor as (x: number, z: number) => number;
    const y = (dx: number, dz: number) => {
      const v = fl(x + dx, z + dz);
      return Number.isNaN(v) ? h : v;
    };
    const hx = y(0.5, 0) - y(-0.5, 0);
    const hz = y(0, 0.5) - y(0, -0.5);
    const at: V3 = [x, h, z];
    const p = axes(...at);
    return { p, n: unit(sub(axes(...add(at, [-hx, 1, -hz])), p)) };
  };
  const headingWay = (spot: Spot): V3 => {
    const at = axes(spot.x, 0, spot.z);
    return unit(sub(axes(spot.x + Math.sin(spot.heading), 0, spot.z + Math.cos(spot.heading)), at));
  };

  // (the lap: from where the fast line crosses the start line, its sectors' ends where it crosses the other gates,
  // in the lap's order; a third and two thirds of the way round where there are none)
  const gateEnds = (g: Gate): [V3, V3] => [onFloor(g.left.x, g.left.z, fast).p, onFloor(g.right.x, g.right.z, fast).p];
  const along = (g: Gate) => {
    const [a, b] = gateEnds(g);
    return crossing(fast, a, b) ?? project(fast, lerp(a, b, 0.5));
  };
  const finishGate = timing.find((g) => g.name === 'AC_TIME_0') ?? timing[0] ?? null;
  const start = finishGate ? along(finishGate) : 0;
  const L = fast.total;
  const ends = timing
    .filter((g) => g !== finishGate)
    .map((g) => ({ gate: g, u: mod(along(g) - start, L) }))
    .filter((e) => e.u > 2 * spacing && e.u < L - 2 * spacing)
    .sort((a, b) => a.u - b.u)
    .filter((e, i, all) => i === 0 || e.u - (all[i - 1] as { u: number }).u > 2 * spacing)
    .slice(0, 2);
  const sectorEnds: { gate: Gate | null; u: number }[] = [...ends];
  if (!sectorEnds.length) sectorEnds.push({ gate: null, u: L / 3 }, { gate: null, u: (2 * L) / 3 });
  else if (sectorEnds.length === 1) {
    const u = (sectorEnds[0] as { u: number }).u;
    if (u < L / 2) sectorEnds.push({ gate: null, u: (u + L) / 2 });
    else sectorEnds.unshift({ gate: null, u: u / 2 });
  }
  const bounds = [0, (sectorEnds[0] as { u: number }).u, (sectorEnds[1] as { u: number }).u, L];

  // (the pit boxes led in from the pit lane where they are beside it, else from the main loop (a layout's boxes may be
  // somewhere else than its pit line))
  const slotAt = grid.map((g) => axes(g.x, 0, g.z));
  const boxAt = pits.map((b) => axes(b.x, 0, b.z));
  const offFrom = (d: Dense) => boxAt.reduce((sum, q) => sum + nearestOn(d, q).off, 0);
  const boxesOnPit = !!pitDense && pits.length > 0 && offFrom(pitDense) <= offFrom(fast);
  // (how far along a line some places are from the first of them to the last: round a closed one, either way of the
  // first (the slot beside the pole may be a little ahead of it))
  const spreadOn = (d: Dense, at: V3[]) => {
    const u = at.map((q) => project(d, q));
    const rel = u.map((v) => (d.closed ? mod(v - (u[0] ?? 0) + d.total / 2, d.total) - d.total / 2 : v));
    return rel.length ? Math.max(...rel) - Math.min(...rel) : 0;
  };

  // (the main loop: a waypoint on each of those, the rest evenly between, about spacing apart: closer where the grid
  // (or the boxes led in from it) is closer)
  const mainSpacing = Math.min(
    spacingFor(spacing, spreadOn(fast, slotAt), grid.length),
    boxesOnPit ? spacing : spacingFor(spacing, spreadOn(fast, boxAt), pits.length),
  );
  const wps: Waypoint[] = [];
  const mainU: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = bounds[k] as number;
    const len = (bounds[k + 1] as number) - a;
    const m = Math.max(1, Math.round(len / mainSpacing));
    for (let j = 0; j < m; j++) {
      const u = a + (len * j) / m;
      const w = waypointOf(sampleAt(fast, start + u), true);
      w.sector = k;
      wps.push(w);
      mainU.push(u);
    }
  }
  const M = wps.length;
  let lap = 0;
  wps.forEach((w, i) => {
    w.prev = (i - 1 + M) % M;
    w.next = (i + 1) % M;
    w.score = lap;
    lap += dist(w.pos, (wps[(i + 1) % M] as Waypoint).pos);
  });
  const firstOf = (k: number) => wps.find((w) => w.sector === k) as Waypoint;
  const sector1 = firstOf(1).score;
  const sector2 = firstOf(2).score;
  const sectorOf = (score: number) => (score < sector1 ? 0 : score < sector2 ? 1 : 2);
  // (a place's lap distance: its nearest on the fast line, between the waypoints' scores there)
  const scoreAt = (q: V3) => {
    const u = mod(project(fast, q) - start, L);
    let k = 0;
    while (k + 1 < M && (mainU[k + 1] as number) <= u) k++;
    const u1 = k + 1 < M ? (mainU[k + 1] as number) : L;
    const s1 = k + 1 < M ? (wps[k + 1] as Waypoint).score : lap;
    const f = u1 > (mainU[k] as number) ? (u - (mainU[k] as number)) / (u1 - (mainU[k] as number)) : 0;
    return mod((wps[k] as Waypoint).score + (s1 - (wps[k] as Waypoint).score) * f, lap);
  };
  // (the last main waypoint at or before a place on the fast line, and the first at or after)
  const mainBefore = (q: V3) => {
    const u = mod(project(fast, q) - start, L);
    let k = 0;
    while (k + 1 < M && (mainU[k + 1] as number) <= u + 1e-6) k++;
    return k;
  };
  const mainAfter = (q: V3) => {
    const u = mod(project(fast, q) - start, L);
    // (past the last: the first, round again)
    return Math.max(
      0,
      mainU.findIndex((v) => v >= u - 1e-6),
    );
  };

  // (the pit lane: its points between its fork and its merge, which are the fast line's)
  const pitStart = M;
  const pitS: number[] = [];
  let pitIn = 0;
  let pitOut = 0;
  let pitScore = (_s: number) => 0;
  if (pitDense) {
    const Lp = pitDense.total;
    const boxes = boxesOnPit ? boxAt.map((q) => project(pitDense, q)) : [];
    const m = Math.max(2, Math.round(Lp / spacingFor(spacing, spreadOn(pitDense, boxAt), boxes.length)));
    const first = pitDense.P[0] as V3;
    const last = pitDense.P.at(-1) as V3;
    const fork = mainBefore(first);
    const merge = mainAfter(last);
    const from = scoreAt(first);
    const gap = mod(scoreAt(last) - from, lap) || lap;
    pitScore = (s: number) => mod(from + (gap * s) / Lp, lap);
    for (let j = 1; j < m; j++) {
      const s = (Lp * j) / m;
      const w = waypointOf(sampleAt(pitDense, s), true);
      w.branch = 1;
      w.score = pitScore(s);
      w.sector = sectorOf(w.score);
      w.speed = 0;
      wps.push(w);
      pitS.push(s);
    }
    for (let j = 0; j < pitS.length; j++) {
      const w = wps[pitStart + j] as Waypoint;
      w.prev = j ? pitStart + j - 1 : fork;
      w.next = j + 1 < pitS.length ? pitStart + j + 1 : merge;
    }
    (wps[fork] as Waypoint).link = pitStart;
    // (the boxes' stretch: from PIT_BEAM before the first box to PIT_BEAM after the last)
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    pitIn = clamp(boxes.length ? Math.min(...boxes) - PIT_BEAM : 0.1 * Lp, 0.05 * Lp, 0.9 * Lp);
    pitOut = clamp(boxes.length ? Math.max(...boxes) + PIT_BEAM : 0.9 * Lp, pitIn + 0.05 * Lp, 0.95 * Lp);
  }
  const P = pitS.length;

  // (a lane's waypoints, the main loop's or the pit lane's, and how far along it each is)
  const mainLane = { first: 0, count: M, closed: true, at: (i: number) => mainU[i] as number, total: L };
  const pitLane = {
    first: pitStart,
    count: P,
    closed: false,
    at: (j: number) => pitS[j] as number,
    total: pitDense?.total ?? 0,
  };
  type Lane = typeof mainLane;
  const laneU = (lane: Lane, q: V3) =>
    lane === mainLane ? mod(project(fast, q) - start, L) : project(pitDense as Dense, q);
  /** the lane's free waypoint LINK_BACK or more behind u (back further while taken; else on towards u) */
  const linkBehind = (lane: Lane, u: number): number => {
    if (!lane.count) return -1;
    const back = (k: number) => (lane.closed ? mod(u - lane.at(k), lane.total) : u - lane.at(k));
    let k = -1;
    for (let i = 0; i < lane.count; i++) if (back(i) >= LINK_BACK && (k < 0 || back(i) < back(k))) k = i;
    if (k < 0) k = 0;
    for (let tries = 0; tries < lane.count; tries++) {
      const i = lane.closed ? mod(k - tries, lane.count) : k - tries;
      if (i < 0) break;
      if ((wps[lane.first + i] as Waypoint).link < 0) return lane.first + i;
    }
    for (let i = k + 1; i < lane.count && (lane.closed || lane.at(i) < u); i++)
      if ((wps[lane.first + i] as Waypoint).link < 0) return lane.first + i;
    return lane.first + k;
  };
  /** the lane's first waypoint on from u (none: -1) */
  const nextOn = (lane: Lane, u: number) => {
    for (let i = 0; i < lane.count; i++) if (lane.at(i) > u) return lane.first + i;
    return lane.closed ? lane.first : -1;
  };
  const nearest = (lane: Lane, q: V3) => {
    let best = lane.first;
    for (let i = 0; i < lane.count; i++)
      if (dist((wps[lane.first + i] as Waypoint).pos, q) < dist((wps[best] as Waypoint).pos, q)) best = lane.first + i;
    return best;
  };

  // (the grid's slots and the pit boxes: two waypoints each, the spot and its lead-in)
  const spots = (list: Spot[], lane: Lane, near: Dense, lead: number, firstBranch: number, box: boolean) =>
    list.map((spot, k) => {
      const at = onFloor(spot.x, spot.z, near);
      const f = orientation(headingWay(spot), at.n);
      const back = onFloor(spot.x - Math.sin(spot.heading) * lead, spot.z - Math.cos(spot.heading) * lead, near);
      const iS = wps.length;
      const made = [at, back].map((place) => {
        const o = orientation(f.way, place.n);
        const pos = add(place.p, [0, LIFT, 0]);
        const W = wps[nearest(lane, pos)] as Waypoint;
        const off = dot(sub(pos, W.pos), W.perp);
        const left = Math.max(0.1, W.width[0] + off);
        const right = Math.max(0.1, W.width[1] - off);
        const u = laneU(lane, place.p);
        const score = lane === pitLane ? pitScore(u) : scoreAt(place.p);
        const w: Waypoint = {
          pos,
          perp: o.perp,
          normal: place.n,
          way: o.way,
          ori: o.ori,
          offsets: [0, 0, 0],
          width: [left, right, left, right],
          speed: 0,
          score,
          sector: sectorOf(score),
          branch: firstBranch + k,
          nonpath: true,
          prev: -1,
          next: iS,
          // (a box's way out: its lane's next waypoint on)
          link: box ? nextOn(lane, u) : -1,
        };
        wps.push(w);
        return { w, u };
      });
      const [S, B] = made as [{ w: Waypoint; u: number }, { w: Waypoint; u: number }];
      S.w.prev = iS + 1;
      const from = linkBehind(lane, B.u);
      B.w.prev = from;
      if (from >= 0 && (wps[from] as Waypoint).link < 0) (wps[from] as Waypoint).link = iS + 1;
      return { pos: at.p, ori: f.ori };
    });
  const gridSpots = spots(grid, mainLane, fast, GRID_LEAD, 2, false);
  const pitSpots = boxesOnPit
    ? spots(pits, pitLane, pitDense as Dense, PIT_LEAD, 2 + STARTING_GRID, true)
    : spots(pits, mainLane, fast, PIT_LEAD, 2 + STARTING_GRID, true);

  // (the pit lane's waypoints outside the boxes' stretch: the main waypoint beside each, going its way)
  for (let j = 0; j < P; j++) {
    const w = wps[pitStart + j] as Waypoint;
    const s = pitS[j] as number;
    if (w.link >= 0 || (s >= pitIn && s <= pitOut)) continue;
    const i = nearest(mainLane, w.pos);
    const m = wps[i] as Waypoint;
    if (dist(m.pos, w.pos) <= BESIDE && dot(m.way, w.way) > 0.5) w.link = i;
  }

  // (the beams: the gates', else across the line; xpitin and xpitout across the pit lane at the boxes' stretch)
  const across = (s: Sample, margin: number): [V3, V3] => {
    const f = orientation(s.w, s.n);
    return [add(s.p, mul(f.perp, -(s.left + margin))), add(s.p, mul(f.perp, s.right + margin))];
  };
  const beam = (name: BeamName, gate: Gate | null, u: number, score: number): Beam => {
    const [left, right] = gate ? gateEnds(gate) : across(sampleAt(fast, start + u), RUNOFF);
    return { name, left, right, score, gate: gate?.name ?? null };
  };
  const beams: Beam[] = [
    beam('xfinish', finishGate, 0, 0),
    beam('xsector1', (sectorEnds[0] as { gate: Gate | null }).gate, bounds[1] as number, sector1),
    beam('xsector2', (sectorEnds[1] as { gate: Gate | null }).gate, bounds[2] as number, sector2),
  ];
  if (pitDense)
    for (const [name, s] of [
      ['xpitin', pitIn],
      ['xpitout', pitOut],
    ] as const) {
      const [left, right] = across(sampleAt(pitDense, s), LANE_EDGE);
      beams.push({ name, left, right, score: pitScore(s), gate: null });
    }

  // (the AUX places: on the pit lane before xpitout; with no pit lane, the pole's)
  const auxAt = pitDense ? sampleAt(pitDense, Math.max(pitIn, pitOut - spacing)) : null;
  const aux = auxAt
    ? { pos: auxAt.p, ori: orientation(auxAt.w, auxAt.n).ori }
    : (gridSpots[0] ?? { pos: (wps[0] as Waypoint).pos, ori: (wps[0] as Waypoint).ori });
  // (the boxes' side of the lane they are led in from)
  let side = 0;
  for (const b of pitSpots) {
    const W = wps[nearest(boxesOnPit ? pitLane : mainLane, b.pos)] as Waypoint;
    side += Math.sign(dot(sub(b.pos, W.pos), W.perp));
  }
  let pathTime = 0;
  for (let i = 0; i < M; i++) {
    const w = wps[i] as Waypoint;
    pathTime += dist(w.pos, (wps[w.next] as Waypoint).pos) / Math.max(1, w.speed);
  }
  return {
    wps,
    main: M,
    lap,
    sector1,
    sector2,
    grid: gridSpots,
    pits: pitSpots,
    aux,
    teleport: gridSpots[0] ? mainBefore(gridSpots[0].pos) : 0,
    leftPits: side <= 0,
    pathTime,
    pitLane: P > 0,
    beams,
  };
}

// ---------------------------------------------------------------- the text

const f3 = (v: readonly number[]) => v.map((x) => x.toFixed(3)).join(',');
const f4 = (v: readonly number[]) => v.map((x) => x.toFixed(4)).join(',');

/** The layout's AIW (CRLF lines, as Studio 397's). */
export function aiwText(input: AiwInput): string {
  const b = build(input);
  const L: string[] = ['//[[gMa1.002f (c)2016    ]] [[            ]]', '[Features]'];
  L.push(
    `pitlanes=${b.pitLane ? 1 : 0}`,
    `startinggrid=${STARTING_GRID}`,
    `pitspots=${PIT_SPOTS}`,
    `garagespots=${GARAGE_SPOTS}`,
    `auxspots=${AUX_SPOTS}`,
    'acceptabledriverlinenoise=0.500000',
    'StartingStretch=20.000000',
  );
  PATHS.forEach((p, i) => {
    L.push(`definepath=${p}`, `pathtime=${(b.pathTime * (PATH_TIME[i] as number)).toFixed(4)}`);
  });
  const slots = (list: { pos: V3; ori: V3 }[]) =>
    list.flatMap((s, i) => [`GridIndex=${i}`, `Pos=(${f3(s.pos)})`, `Ori=(${f3(s.ori)})`]);
  L.push('', '[GRID]', ...slots(b.grid), '', '[ALTGRID]', '', '[TELEPORT]', ...slots(b.grid), '', '[PITS]');
  b.pits.forEach((p, i) => {
    L.push(`TeamIndex=${i}`, `PitPos=(${f3(p.pos)})`, `PitOri=(${f3(p.ori)})`);
    // (every one of its GARAGE_SPOTS, as the samples have them all: the game takes them all, and stops on a team
    // with fewer; its box, then each GARAGE_BACK further behind it, the way its nose (-z) points turned round)
    const yaw = p.ori[1];
    const back: V3 = [Math.sin(yaw), 0, Math.cos(yaw)];
    for (let k = 0; k < GARAGE_SPOTS; k++) {
      const at: V3 = [p.pos[0] + back[0] * GARAGE_BACK * k, p.pos[1], p.pos[2] + back[2] * GARAGE_BACK * k];
      L.push(`GarPos=(${k},${f3(at)})`, `GarOri=(${k},${f3(p.ori)})`);
    }
  });
  L.push('', '[AUX]');
  for (const i of [0, 1]) L.push(`LocationIndex=${i}`, `Pos=(${f3(b.aux.pos)})`, `Ori=(${f3(b.aux.ori)})`);
  L.push(
    '',
    '[Waypoint]',
    'trackstate=395',
    'drivinglines=1',
    'autogengridf=(-1.0,15.00)',
    'autogenaltgridf=(-1.0,15.00)',
    `teleportwp=(${b.teleport})`,
    'pitlanepaths=(2,3)',
    `number_waypoints=${b.wps.length}`,
    `lap_length=${b.lap.toFixed(6)}`,
    `sector_1_length=${b.sector1.toFixed(6)}`,
    `sector_2_length=${b.sector2.toFixed(6)}`,
    `LeftHandedPits=${b.leftPits ? 1 : 0}`,
    `FuelUse=${(b.lap * FUEL_PER_METRE).toFixed(6)}`,
    'AIBrakingStiffness=(1.0000,1.0000,0.9000)',
    'slowwhenpushed=1.00',
    'DelayPitCrewLoad=0',
    `LaneSpacing=${LANE_SPACING.toFixed(2)}`,
    'ultracarefulyellow=0',
    'SafetyCarReleaseDist=(0.8500, 0.9500)',
    'WorstAdjust=(0.8000)',
    'MidAdjust=(1.0000)',
    'BestAdjust=(1.2000)',
    'AIRange=(0.1000)',
    'AISpec=(0.0000,0.0000,1.0000,0.0000)     // 4 ways to express AI speed on track, limit the acceration, max speed, their cornering speed, or their deceleration.  0.0 - 1.0',
    'AIDraftStickiness=(4.0000)',
  );
  b.wps.forEach((w, i) => {
    // (the first waypoint's lines say what they are, as the samples' do)
    const say = (text: string) => (i ? '' : ` // ${text}`);
    L.push(`wp_pos=(${f4(w.pos)})`, `wp_perp=(${f4(w.perp)})`, `wp_normal=(${f4(w.normal)})`);
    PATHS.forEach((_, p) => {
      L.push(
        `wp_pathinfo2=(${p},${(w.offsets[p] as number).toFixed(4)},-1.0000,-1.0000)`,
        `wp_oriantation=(${p},${f4(w.ori)})`,
        `wp_pathflags=(${p},0)`,
      );
    });
    L.push(
      `wp_width=(${f3(w.width)})${say('road left, road right, far left, far right')}`,
      `wp_dwidth=(${f3([w.width[2], w.width[3], 0, 0])})${say('collision left, collision right, cut left, cut right')}`,
      `wp_lockedAlpha=(0)${say('(used for editor specific algorithms)')}`,
      `wp_test_speed=(${w.speed.toFixed(6)})`,
      'wp_reverb=(0)',
      `wp_score=(${w.sector},${w.score.toFixed(3)})${say('sector ID, distance into lap')}`,
      `wp_wpse=(0,0)${say('some special events')}`,
      `wp_branchID=(${w.branch})${say('0 = main, 1...whatever pit lanes')}`,
      `wp_bitfields=(${w.nonpath ? 1 : 0})${say('1 = nonpath waypoint.  ')}`,
      `wp_pitlane=(1)${say("what pitlane I'm a part of (only relevent for non-path waypoints) ")}`,
      `WP_PTRS=(${w.prev},${w.next},${w.link},${w.branch})${say('prev waypoint id, next waypoint id, branch waypoint id, path of branch wp ')}`,
    );
  });
  L.push('', '');
  return L.join('\r\n');
}

/** The layout's lap as its AIW has it (metres: its length, where sectors 2 and 3 start) and its timing beams' places
 * (the xfinish, xsector1, xsector2, xpitin and xpitout GMTs'), in rFactor's axes. */
export function aiwTiming(input: AiwInput): AiwTiming {
  const b = build(input);
  return { lap: b.lap, sector1: b.sector1, sector2: b.sector2, beams: b.beams };
}
