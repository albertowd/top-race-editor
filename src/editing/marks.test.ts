import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { PaintMark, TrackObjects, Vec2 } from '../domain/types';
import { someObjects } from '../test/fixtures';
import {
  chainPieces,
  legacyCurve,
  markLength,
  markMiddle,
  markThrough,
  moveMarkNode,
  offMark,
  paintChains,
} from './marks';
import { addObject, countOf, moveObject, moveObjectEnd, objectAt, positionOf, removeObject, turnAll } from './objects';
import { smoothObject } from './strands';

const white = { width: 0.1, colour: 'white' } as const;
const mark = (points: Vec2[], extra: Partial<PaintMark> = {}): PaintMark => ({
  ...markThrough('M', points, white),
  ...extra,
});
const r = (v: readonly number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);

describe('a paint mark', () => {
  it('runs along its curve, straight from node to node as made', () => {
    const m = mark([
      [0, 0],
      [4, 0],
    ]);
    expect(markLength(m)).toBeCloseTo(4, 9);
    expect(r(markMiddle(m))).toEqual([2, 0]);
    expect(offMark(m, 2, 0.5)).toBeCloseTo(0.5, 9);
    expect(offMark(m, -3, 0)).toBeCloseTo(3, 9);
    // (an L: a corner at its middle node, its handles a third of each piece along it)
    const l = mark([
      [0, 0],
      [4, 0],
      [4, 3],
    ]);
    expect(l.curve[1]).toMatchObject({ corner: true });
    expect(r(l.curve[1]?.in ?? [])).toEqual([-4 / 3, 0].map((v) => Math.round(v * 1e6) / 1e6));
    expect(markLength(l)).toBeCloseTo(7, 9);
    // (a ring: round to its first again)
    const ring = markThrough(
      'R',
      l.curve.map((n) => n.p),
      { ...white, closed: true },
    );
    expect(ring.closed).toBe(true);
    expect(markLength(ring)).toBeCloseTo(12, 9);
  });

  it('reads as older files had it: from p, its length along its heading', () => {
    const c = legacyCurve({ p: [1, 2], heading: Math.PI / 2, length: 3 });
    expect(c.map((n) => r(n.p))).toEqual([
      [1, 2],
      [4, 2],
    ]);
    expect(markLength({ curve: c })).toBeCloseTo(3, 9);
  });

  it('keeps a straight piece straight when a node is moved; Shift turns a two-node one by 15 degrees', () => {
    const m = mark([
      [0, 0],
      [4, 0],
    ]);
    moveMarkNode(m, 1, 0, 3);
    expect(r(m.curve[0]?.out ?? [])).toEqual([0, 1]);
    expect(r(m.curve[1]?.in ?? [])).toEqual([0, -1]);
    moveMarkNode(m, 1, 1, 3, true);
    const [a, b] = m.curve.map((n) => n.p) as [Vec2, Vec2];
    expect(Math.atan2(b[0] - a[0], b[1] - a[1])).toBeCloseTo(Math.PI / 12, 9);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(Math.hypot(1, 3), 9);
    // (a bent piece stays as bent: its handles kept)
    const bent = mark([
      [0, 0],
      [4, 0],
    ]);
    bent.curve[0] = { p: [0, 0], in: [0, 0], out: [1, 1] };
    moveMarkNode(bent, 1, 5, 0);
    expect(bent.curve[0]?.out).toEqual([1, 1]);
  });

  it('is one of the objects: picked by its nodes, handles and line, moved, turned, added to and taken away', () => {
    let o = someObjects();
    const edit = (fn: (d: TrackObjects) => unknown) => {
      o = produce(o, (d) => void fn(d));
    };
    const at = (j: number) => o.marks[0]?.curve[j]?.p;
    expect(countOf(o, 'vp_a', 'marks')).toBe(1);
    expect(objectAt(o, 'vp_a', 54, -2, 0.1)).toEqual({ kind: 'marks', i: 0, j: 1 });
    expect(objectAt(o, 'vp_a', 52, -2.02, 0.01)).toEqual({ kind: 'marks', i: 0, j: -1 });
    // (the picked one's handles too)
    const picked = { kind: 'marks', i: 0, j: -1 } as const;
    expect(objectAt(o, 'vp_a', 50 + 4 / 3, -2, 0.1, undefined, picked)).toEqual({
      kind: 'marks',
      i: 0,
      j: 0,
      h: 'out',
    });
    expect(positionOf(o, 'vp_a', picked)).toEqual({ x: 52, z: -2 });
    expect(positionOf(o, 'vp_a', { kind: 'marks', i: 0, j: 0 })).toEqual({ x: 50, z: -2 });
    edit((d) => moveObject(d, 'vp_a', picked, 1, 1));
    expect([at(0), at(1)]).toEqual([
      [51, -1],
      [55, -1],
    ]);
    edit((d) => moveObjectEnd(d, { kind: 'marks', i: 0, j: 1 }, 51, 3));
    expect(r(o.marks[0]?.curve[0]?.out ?? [])).toEqual([0, 4 / 3].map((v) => Math.round(v * 1e6) / 1e6));
    edit((d) => turnAll(d, 'vp_a', picked, Math.PI / 2, 51, -1));
    expect(r(at(1) ?? [])).toEqual([55, -1]);
    // (placing on into it: a node past its nearer end; on its line: a node there, the curve kept)
    edit((d) => {
      expect(addObject(d, 'vp_a', 'marks', 58, -1, 0, { within: 0 })).toEqual({ kind: 'marks', i: 0, j: 2 });
    });
    expect(o.marks[0]?.curve).toHaveLength(3);
    edit((d) => {
      expect(smoothObject(d, 'vp_a', 'marks', 0)).toBe(true);
    });
    edit((d) => {
      expect(addObject(d, 'vp_a', 'marks', 0, 0, 1)).toEqual({ kind: 'marks', i: 1, j: 1 });
    });
    expect(o.marks[1]).toMatchObject({ name: 'MARK_2', width: 0.1, style: 'solid' });
    expect(markLength(o.marks[1] as PaintMark)).toBeCloseTo(1, 9);
    // (a node of three taken away: that node; of two, the whole mark)
    edit((d) => {
      expect(removeObject(d, 'vp_a', { kind: 'marks', i: 0, j: 2 })).toBe(true);
    });
    expect(o.marks[0]?.curve).toHaveLength(2);
    edit((d) => {
      expect(removeObject(d, 'vp_a', { kind: 'marks', i: 0, j: 1 })).toBe(true);
    });
    expect(o.marks.map((m) => m.name)).toEqual(['MARK_2']);
  });
});

describe('the lines the marks are painted as', () => {
  const line = (points: Vec2[], extra: Partial<PaintMark> = {}) => mark(points, extra);

  it('joins marks of one paint whose ends meet into one line, a ring where they close', () => {
    const chains = paintChains([
      line([
        [0, 0],
        [4, 0],
      ]),
      line([
        [4, 3],
        [4, 0.02],
      ]),
      line([
        [10, 0],
        [12, 0],
      ]),
    ]);
    expect(chains).toHaveLength(2);
    const [l, alone] = chains;
    expect(l?.marks).toEqual([0, 1]);
    expect(l?.closed).toBe(false);
    // (the corner: halfway between the two ends that meet; the second mark turned to go on from the first)
    expect(l?.points.map((q) => r(q))).toContainEqual([4, 0.01]);
    expect(r(l?.points.at(-1) ?? [])).toEqual([4, 3]);
    expect(alone?.marks).toEqual([2]);
    // (four sides of a box: one ring)
    const sides: Vec2[] = [
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
    ];
    const ring = paintChains(sides.map((p, i) => line([p, sides[(i + 1) % 4] as Vec2])));
    expect(ring).toHaveLength(1);
    expect(ring[0]).toMatchObject({ marks: [0, 1, 2, 3], closed: true });
    expect(ring[0]?.points.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps apart marks of another paint, and two that turn back over each other', () => {
    const a = line([
      [0, 0],
      [4, 0],
    ]);
    expect(
      paintChains([
        a,
        line(
          [
            [4, 0],
            [4, 3],
          ],
          { colour: 'yellow' },
        ),
      ]),
    ).toHaveLength(2);
    expect(
      paintChains([
        a,
        line([
          [4, 0],
          [1, 0.01],
        ]),
      ]),
    ).toHaveLength(2);
    expect(
      paintChains([
        a,
        line(
          [
            [4, 0],
            [8, 0],
          ],
          { width: 0.2 },
        ),
      ]),
    ).toHaveLength(2);
  });

  it('joins the two going on straightest where three ends meet', () => {
    const chains = paintChains([
      line([
        [0, 0],
        [4, 0],
      ]),
      line([
        [4, 0],
        [4, 3],
      ]),
      line([
        [4, 0],
        [8, 0],
      ]),
    ]);
    expect(chains.map((c) => c.marks)).toEqual([[0, 2], [1]]);
  });

  it('paints a dotted line in dashes along the whole of it, round its corners', () => {
    const [c] = paintChains([
      line(
        [
          [0, 0],
          [3, 0],
          [3, 3],
        ],
        { style: 'dotted', dash: 1, gap: 1.5 },
      ),
    ]);
    const pieces = chainPieces(c as NonNullable<typeof c>);
    expect(pieces).toHaveLength(3);
    // (the second from 2.5 m along to 3.5: round the corner)
    const second = pieces[1]?.map((q) => r(q)) ?? [];
    expect(second[0]).toEqual([2.5, 0]);
    expect(second).toContainEqual([3, 0]);
    expect(second.at(-1)).toEqual([3, 0.5]);
    expect(pieces[2]?.map((q) => r(q)).at(-1)).toEqual([3, 3]);
  });
});

describe('lines of two paints meeting end to end', () => {
  it('each carried on to the corner, cut along the seam from their inner edges’ crossing to their outer ones’', () => {
    const chains = paintChains([
      mark([
        [0, 0],
        [4, 0],
      ]),
      mark(
        [
          [4, 0],
          [4, 3],
        ],
        { colour: 'yellow' },
      ),
    ]);
    expect(chains).toHaveLength(2);
    const [w, y] = chains;
    const seam = (c: typeof w) => [c?.cuts?.[0]?.a, c?.cuts?.[0]?.b].map((q) => r(q ?? []));
    expect(seam(w)).toEqual([
      [3.95, 0.05],
      [4.05, -0.05],
    ]);
    expect(seam(y)).toEqual(seam(w));
    // (the white kept back from the seam, the yellow on past it)
    expect(r(w?.cuts?.[0]?.keep ?? [])[0]).toBeLessThan(4);
    expect(r(y?.cuts?.[0]?.keep ?? [])[1]).toBeGreaterThan(0);
    // (another width, the same colour: a seam too; going straight on, square across)
    const [a, b] = paintChains([
      mark([
        [0, 0],
        [4, 0],
      ]),
      mark(
        [
          [4.05, 0],
          [8, 0],
        ],
        { width: 0.12 },
      ),
    ]);
    expect(a?.cuts?.[0]).toBeDefined();
    expect(r(a?.cuts?.[0]?.a ?? [])[0]).toBeCloseTo(4.025, 6);
    expect(r(b?.cuts?.[0]?.b ?? [])[0]).toBeCloseTo(4.025, 6);
  });
});

describe('a rubber mark', () => {
  it('is placed, picked, grown and taken away as a paint mark is, in a list of its own', () => {
    const o = produce(someObjects(), (d: TrackObjects) => {
      // (placed: a new one, straight, as wide and dark as asked, its far end picked; named apart from the rest)
      expect(addObject(d, 'vp_a', 'rubber', 10, 0, 0, { rubber: { width: 1.5, wear: 'very_used' } })).toEqual({
        kind: 'rubber',
        i: 0,
        j: 1,
      });
      expect(d.rubber?.[0]).toMatchObject({ name: 'RUBBER_1', width: 1.5, wear: 'very_used' });
      expect(d.marks).toHaveLength(someObjects().marks.length);
      // (a node on past its end, into the one picked)
      expect(addObject(d, 'vp_a', 'rubber', 10, 5, 0, { within: 0 })).toEqual({ kind: 'rubber', i: 0, j: 2 });
    });
    expect(countOf(o, 'vp_a', 'rubber')).toBe(1);
    // (picked by its band, as wide as it is)
    expect(objectAt(o, 'vp_a', 10.6, 0.5, 0.01, ['rubber'], null)).toMatchObject({ kind: 'rubber', i: 0 });
    expect(positionOf(o, 'vp_a', { kind: 'rubber', i: 0, j: 2 })).toEqual({ x: 10, z: 5 });
    const less = produce(o, (d: TrackObjects) => {
      moveObjectEnd(d, { kind: 'rubber', i: 0, j: 2 }, 12, 5);
      expect(removeObject(d, 'vp_a', { kind: 'rubber', i: 0, j: 1 })).toBe(true);
    });
    expect(less.rubber?.[0]?.curve.map((n) => n.p)).toEqual([
      [10, 0],
      [12, 5],
    ]);
    // (two nodes kept: the whole taken away, and the list with its last)
    const none = produce(less, (d: TrackObjects) => {
      expect(removeObject(d, 'vp_a', { kind: 'rubber', i: 0, j: 1 })).toBe(true);
    });
    expect(none.rubber).toBeUndefined();
  });
});
