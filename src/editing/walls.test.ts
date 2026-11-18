import { describe, expect, it } from 'vitest';
import type { Vec2, WallNode } from '../domain/types';
import type { Curved } from './walls';

/** A wall as the tests make one: a curve, named, hit or not. */
type TyreWall = Curved & { name: string; collision: boolean };

import {
  addWallNode,
  handleAt,
  moveWallHandle,
  nearestOnWall,
  smoothWall,
  splitWall,
  wallPath,
  wallPieces,
  wallStacks,
} from './walls';

/** A straight node-to-node wall through points, its handles a third of each piece. */
function straight(points: Vec2[], extra: Partial<TyreWall> = {}): TyreWall {
  const curve: WallNode[] = points.map((p, i) => {
    const a = points[i - 1];
    const b = points[i + 1];
    return {
      p,
      in: a ? [(a[0] - p[0]) / 3, (a[1] - p[1]) / 3] : [0, 0],
      out: b ? [(b[0] - p[0]) / 3, (b[1] - p[1]) / 3] : [0, 0],
      corner: true,
    };
  });
  return { name: 'W', curve, closed: false, spacing: 0.5, rows: 1, collision: true, ...extra };
}

const square: Vec2[] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
];
const round2 = (q: Vec2) => q.map((v) => Math.round(v * 100) / 100);

describe("a tyre wall's curve", () => {
  it('runs node to node, and back to its first when closed', () => {
    expect(wallPieces(straight(square)).map((p) => p[2])).toEqual([0, 1, 2]);
    expect(wallPieces(straight(square, { closed: true })).map((p) => p[2])).toEqual([0, 1, 2, 3]);
    const path = wallPath(
      straight([
        [0, 0],
        [2, 0],
      ]),
    );
    expect(path.length).toBeCloseTo(2, 9);
    expect(path.P[0]).toEqual([0, 0]);
    expect(wallPath(straight([[1, 1]])).P).toEqual([[1, 1]]);
  });

  it('has a stack every spacing along it, rows to its right, a ring short of its first again', () => {
    expect(
      wallStacks(
        straight([
          [0, 0],
          [2, 0],
        ]),
      ),
    ).toHaveLength(5);
    const two = wallStacks(
      straight(
        [
          [0, 0],
          [2, 0],
        ],
        { rows: 2 },
      ),
    );
    expect(two).toHaveLength(10);
    // (going +x, its right is -z: (tz, -tx))
    expect(round2(two[1])).toEqual([0, -0.5]);
    expect(wallStacks(straight(square, { closed: true, spacing: 1 }))).toHaveLength(8);
    expect(wallStacks(straight([[3, 4]]))).toEqual([[3, 4]]);
    // (spread evenly, none farther apart than spacing: 2 m at 0.6 is 4 gaps of 0.5 m, both ends a stack; a ring of
    // 8 m at 0.75 is 11 gaps of 8/11 m, the last back to its first as the others)
    const even = wallStacks(
      straight(
        [
          [0, 0],
          [2, 0],
        ],
        { spacing: 0.6 },
      ),
    );
    expect(even.map((q) => round2(q)[0])).toEqual([0, 0.5, 1, 1.5, 2]);
    const ring = wallStacks(straight(square, { closed: true, spacing: 0.75 }));
    expect(ring).toHaveLength(11);
    expect(round2(ring[1])).toEqual([round2([8 / 11, 0])[0], 0]);
    // (a curve: the stacks along it, not along its nodes' line)
    const bent: TyreWall = {
      ...straight([
        [0, 0],
        [4, 0],
      ]),
      curve: [
        { p: [0, 0], in: [0, 0], out: [0, 2] },
        { p: [4, 0], in: [0, 2], out: [0, 0] },
      ],
      spacing: 1,
    };
    const stacks = wallStacks(bent);
    expect(stacks.length).toBeGreaterThan(5);
    expect(Math.max(...stacks.map((q) => q[1]))).toBeGreaterThan(1);
  });

  it('finds the nearest point of it', () => {
    const near = nearestOnWall(
      straight([
        [0, 0],
        [2, 0],
      ]),
      1,
      0.3,
    );
    expect(near.d).toBeCloseTo(0.3, 2);
    expect(near.seg).toBe(0);
    expect(near.t).toBeCloseTo(0.5, 1);
  });
});

describe("a tyre wall's edits", () => {
  it('moves a handle, the other following unless a corner', () => {
    const n: WallNode = { p: [0, 0], in: [-1, 0], out: [1, 0] };
    moveWallHandle(n, 'out', 0, 2);
    expect(n.out).toEqual([0, 2]);
    expect(n.in.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, -1]);
    moveWallHandle(n, 'in', 3, 0, true);
    expect(n.corner).toBe(true);
    expect(n.out).toEqual([0, 2]);
    expect(handleAt(n, 'in')).toEqual([3, 0]);
  });

  it('smooths its handles through its neighbours, a ring all round', () => {
    const w = straight(square);
    smoothWall(w, 1);
    expect(w.curve[1].corner).toBeUndefined();
    expect(round2(w.curve[1].out)).toEqual([0.47, 0.47]);
    expect(w.curve[0].corner).toBe(true);
    smoothWall(w);
    expect(w.curve[0].in.map(Math.abs)).toEqual([0, 0]);
    const ring = straight(square, { closed: true });
    smoothWall(ring);
    expect(round2(ring.curve[0].in)).toEqual([-0.47, 0.47]);
  });

  it('splits a piece keeping the curve, and goes on past its ends', () => {
    const w = straight([
      [0, 0],
      [3, 0],
    ]);
    expect(splitWall(w, 0, 0.5)).toBe(1);
    expect(round2(w.curve[1].p)).toEqual([1.5, 0]);
    expect(round2(w.curve[0].out)).toEqual([0.5, 0]);
    expect(addWallNode(w, 2, 0.1, 0.3)).toBe(2);
    expect(addWallNode(w, 5, 0, 0.3)).toBe(4);
    expect(addWallNode(w, -2, 0, 0.3)).toBe(0);
    expect(w.curve.map((n) => Math.round(n.p[0]))).toEqual([-2, 0, 2, 2, 3, 5]);
    expect(w.curve[0].out[0]).toBeGreaterThan(0);
    const one: TyreWall = { ...straight([[0, 0]]), curve: [{ p: [0, 0], in: [0, 0], out: [0, 0] }] };
    expect(addWallNode(one, 1, 0, 0.3)).toBe(1);
    expect(one.curve[0].out[0]).toBeGreaterThan(0);
    const ring = straight(square, { closed: true });
    expect(addWallNode(ring, 0, 1, 0.3)).toBe(4);
  });
});
