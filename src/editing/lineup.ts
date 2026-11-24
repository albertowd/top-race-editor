// Grid slots and pit boxes laid out along a line: from where the first stands, the rest the line's way, in one file
// or in rows (side by side, staggered or not), each facing back to the line's start or along it, leaning off it (pit
// boxes set at a slant). And their paint, laid out the same way but on a line of its own: a box painted round each
// (paint marks, for every layout), apart from the layout's slots and boxes.

import type { LineColour, PaintMark, Spot, Vec2 } from '../domain/types';
import { markMiddle, markThrough } from './marks';

/** the grid's slots, the pit boxes (a layout's), or the paint of each (every layout's) */
export type LineUpKind = 'grid' | 'pits' | 'gridPaint' | 'pitPaint';

export const isPaint = (k: LineUpKind): k is 'gridPaint' | 'pitPaint' => k === 'gridPaint' || k === 'pitPaint';

/** The paint round each: its shape (an outline, open at the back, a bracket (a line across the front, its ends turned
 * back a little: [ ), or only a line across the front), how big, its lines' width and colour. */
export interface BoxPaint {
  shape: 'box' | 'open' | 'bracket' | 'front';
  /** metres across, and long */
  width: number;
  length: number;
  /** a bracket's: metres its ends reach back from the front (BRACKET_ARM unless said) */
  arm?: number;
  /** metres: its lines' width */
  line: number;
  colour: LineColour;
}

export interface LineUp {
  /** how many */
  count: number;
  /** side by side in a row: 1, one file */
  rows: number;
  /** metres from one row to the next, along the line (unless fit) */
  spacing: number;
  /** spread from the line's start to its end (the spacing what it takes) */
  fit: boolean;
  /** metres between those side by side */
  across: number;
  /** each of a row a share of the spacing further back than the one before it (a staggered grid) */
  stagger: boolean;
  /** the first of a row on the left of the way they face, or on the right */
  first: 'left' | 'right';
  /** facing back to the line's start (a grid behind its pole) or along the line */
  facing: 'back' | 'along';
  /** degrees each is turned off the way it faces (+ clockwise on the map): boxes set at a slant */
  lean: number;
  /** the paint's (a paint kind's) */
  box?: BoxPaint;
}

/** metres a bracket's ends reach back from its front (the old grid marks': 1.7 m across, 0.6 m deep) */
export const BRACKET_ARM = 0.5;

export const LINE_UPS: Record<LineUpKind, LineUp> = {
  grid: {
    count: 12,
    rows: 2,
    spacing: 6,
    fit: false,
    across: 2.6,
    stagger: true,
    first: 'left',
    facing: 'back',
    lean: 0,
  },
  pits: {
    count: 10,
    rows: 1,
    spacing: 3,
    fit: false,
    across: 3,
    stagger: false,
    first: 'left',
    facing: 'along',
    lean: 0,
  },
  gridPaint: {
    count: 12,
    rows: 2,
    spacing: 6,
    fit: false,
    across: 2.6,
    stagger: true,
    first: 'left',
    facing: 'back',
    lean: 0,
    box: { shape: 'bracket', width: 1.7, length: 2.6, arm: BRACKET_ARM, line: 0.1, colour: 'white' },
  },
  pitPaint: {
    count: 10,
    rows: 1,
    spacing: 3,
    fit: false,
    across: 3,
    stagger: false,
    first: 'left',
    facing: 'along',
    lean: 0,
    box: { shape: 'bracket', width: 1.7, length: 2.6, arm: BRACKET_ARM, line: 0.1, colour: 'white' },
  },
};

/** The names a paint kind's marks have (laid out again where they are, those go). */
export const PAINT_PREFIX = { gridPaint: 'MARK_GRID_', pitPaint: 'MARK_PIT_' } as const;

const DEG = Math.PI / 180;
const wrap = (h: number) => Math.atan2(Math.sin(h), Math.cos(h));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** How many rows a line-up takes. */
export const rowsOf = (u: LineUp): number => Math.ceil(Math.max(1, u.count) / Math.max(1, u.rows));

/** The metres from one row to the next: the spacing, or (fit) what spreads them from a to b. */
export function spacingOf(u: LineUp, a: Vec2, b: Vec2): number {
  const n = rowsOf(u);
  const per = u.stagger && u.rows > 1 ? n - 1 + (u.rows - 1) / u.rows : n - 1;
  return u.fit && per > 0 ? Math.hypot(b[0] - a[0], b[1] - a[1]) / per : u.spacing;
}

/** The spots of a line-up from a (where the first stands) the way of b; none if a and b are one point. */
export function lineUp(u: LineUp, a: Vec2, b: Vec2): Spot[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return [];
  const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const rows = Math.max(1, Math.round(u.rows));
  const step = spacingOf(u, a, b);
  // (the way they face, and its left: as headings turn, from +z towards +x)
  const face: Vec2 = u.facing === 'back' ? [-d[0], -d[1]] : d;
  const left: Vec2 = [face[1], -face[0]];
  const side = u.first === 'left' ? 1 : -1;
  const heading = wrap(Math.atan2(face[0], face[1]) + u.lean * DEG);
  const out: Spot[] = [];
  for (let i = 0; i < Math.max(0, Math.round(u.count)); i++) {
    const row = Math.floor(i / rows);
    const col = i % rows;
    const along = (row + (u.stagger && rows > 1 ? col / rows : 0)) * step;
    const off = ((rows - 1) / 2 - col) * u.across * side;
    out.push({
      x: r3(a[0] + d[0] * along + left[0] * off),
      z: r3(a[1] + d[1] * along + left[1] * off),
      heading: Math.round(heading * 1e4) / 1e4,
    });
  }
  return out;
}

/** The marks painting a box round each spot (its front the way it faces), one a box, its corners mitred: named prefix
 * and their number from after + 1. */
export function boxMarks(spots: readonly Spot[], box: BoxPaint, prefix: string, after = 0): PaintMark[] {
  const out: PaintMark[] = [];
  const hw = box.width / 2;
  const hl = box.length / 2;
  for (const s of spots) {
    const f: Vec2 = [Math.sin(s.heading), Math.cos(s.heading)];
    const l: Vec2 = [f[1], -f[0]];
    const at = (u: number, v: number): Vec2 => [s.x + l[0] * u + f[0] * v, s.z + l[1] * u + f[1] * v];
    const fl = at(hw, hl);
    const fr = at(-hw, hl);
    const bl = at(hw, -hl);
    const br = at(-hw, -hl);
    // (its front, and its sides back from it: a bracket's arms, a box's sides round to its back)
    let points: Vec2[] = [fl, fr];
    if (box.shape === 'bracket') {
      const arm = Math.min(box.arm ?? BRACKET_ARM, box.length);
      points = [at(hw, hl - arm), fl, fr, at(-hw, hl - arm)];
    } else if (box.shape !== 'front') points = [bl, fl, fr, br];
    const closed = box.shape === 'box';
    out.push(
      markThrough(
        `${prefix}${after + out.length + 1}`,
        points.map((q): Vec2 => [r3(q[0]), r3(q[1])]),
        { width: box.line, colour: box.colour, closed },
      ),
    );
  }
  return out;
}

/** The paint of a kind (its marks, by their names) where these spots' boxes go: within a box's diagonal of one of
 * them. What painting them again replaces; the paint elsewhere (another layout's grid, on another straight) is kept. */
export function paintAt(
  marks: readonly PaintMark[],
  spots: readonly Spot[],
  box: BoxPaint,
  prefix: string,
): PaintMark[] {
  const reach = Math.hypot(box.width, box.length);
  return marks.filter((m) => {
    if (!m.name.startsWith(prefix)) return false;
    const [x, z] = markMiddle(m);
    return spots.some((s) => Math.hypot(s.x - x, s.z - z) <= reach);
  });
}

/** The highest number a paint kind's marks have (0: none). */
export function lastPaintNumber(marks: readonly PaintMark[], prefix: string): number {
  let n = 0;
  for (const m of marks) {
    if (!m.name.startsWith(prefix)) continue;
    const k = Number(m.name.slice(prefix.length));
    if (Number.isInteger(k) && k > n) n = k;
  }
  return n;
}
