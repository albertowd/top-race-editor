import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { PaintMark, TrackObjects } from '../domain/types';
import { someObjects } from '../test/fixtures';
import { markEnd, markMiddle, markPieces, moveMarkEnd, offMark, turnMark } from './marks';
import { addObject, countOf, moveObject, moveObjectEnd, objectAt, positionOf, removeObject, turnAll } from './objects';

const mark = (extra: Partial<PaintMark> = {}): PaintMark => ({
  name: 'M',
  p: [0, 0],
  heading: Math.PI / 2,
  length: 4,
  width: 0.1,
  colour: 'white',
  style: 'solid',
  ...extra,
});
const r = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);

describe('a paint mark', () => {
  it('runs from its start, its length along its heading', () => {
    expect(r(markEnd(mark()))).toEqual([4, 0]);
    expect(r(markMiddle(mark()))).toEqual([2, 0]);
    expect(offMark(mark(), 2, 0.5)).toBeCloseTo(0.5, 9);
    expect(offMark(mark(), -3, 0)).toBeCloseTo(3, 9);
  });

  it('is painted whole, or in dashes', () => {
    expect(markPieces(mark())).toEqual([[0, 4]]);
    expect(markPieces(mark({ style: 'dotted', dash: 1, gap: 0.5 }))).toEqual([
      [0, 1],
      [1.5, 2.5],
      [3, 4],
    ]);
    expect(markPieces(mark({ style: 'dotted' }))).toHaveLength(4);
  });

  it('stretches and turns by either end, the other kept; Shift by 15 degrees', () => {
    const m = mark();
    moveMarkEnd(m, 1, 0, 3);
    expect([m.heading, m.length]).toEqual([0, 3]);
    moveMarkEnd(m, 1, 1, 3, true);
    expect(m.heading).toBeCloseTo(Math.PI / 12, 9);
    const n = mark();
    moveMarkEnd(n, 0, 0, -4);
    expect(r(markEnd(n))).toEqual([4, 0]);
    expect(n.length).toBeCloseTo(Math.hypot(4, 4), 9);
    expect(r(n.p)).toEqual([0, -4]);
    moveMarkEnd(n, 1, 0, -4);
    expect(n.length).toBeCloseTo(Math.hypot(4, 4), 9);
    turnMark(n, 7);
    expect(n.heading).toBeCloseTo(7 - 2 * Math.PI, 9);
  });

  it('is one of the objects: picked, moved, turned, added and taken away', () => {
    let o = someObjects();
    const edit = (fn: (d: TrackObjects) => unknown) => {
      o = produce(o, (d) => void fn(d));
    };
    expect(countOf(o, 'vp_a', 'marks')).toBe(1);
    expect(objectAt(o, 'vp_a', 54, -2, 0.1)).toEqual({ kind: 'marks', i: 0, j: 1 });
    expect(objectAt(o, 'vp_a', 52, -2.02, 0.01)).toEqual({ kind: 'marks', i: 0, j: -1 });
    expect(positionOf(o, 'vp_a', { kind: 'marks', i: 0, j: -1 })).toEqual({ x: 52, z: -2 });
    expect(positionOf(o, 'vp_a', { kind: 'marks', i: 0, j: 0 })).toEqual({ x: 50, z: -2 });
    edit((d) => moveObject(d, 'vp_a', { kind: 'marks', i: 0, j: -1 }, 1, 1));
    expect(o.marks[0].p).toEqual([51, -1]);
    edit((d) => moveObjectEnd(d, { kind: 'marks', i: 0, j: 1 }, 51, 3));
    expect([o.marks[0].heading, o.marks[0].length]).toEqual([0, 4]);
    edit((d) => turnAll(d, 'vp_a', { kind: 'marks', i: 0, j: -1 }, Math.PI / 2, 51, -1));
    expect(o.marks[0].heading).toBeCloseTo(Math.PI / 2, 9);
    edit((d) => {
      expect(addObject(d, 'vp_a', 'marks', 0, 0, 1)).toEqual({ kind: 'marks', i: 1, j: -1 });
    });
    expect(o.marks[1]).toMatchObject({ name: 'MARK_2', p: [0, 0], heading: 1, length: 1, width: 0.1, style: 'solid' });
    edit((d) => {
      expect(removeObject(d, 'vp_a', { kind: 'marks', i: 0, j: -1 })).toBe(true);
    });
    expect(o.marks.map((m) => m.name)).toEqual(['MARK_2']);
  });
});
