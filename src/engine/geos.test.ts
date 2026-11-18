// @vitest-environment node
// GEOS's booleans on the merge's grid (geos.ts): on squares.
import { beforeAll, describe, expect, it } from 'vitest';
import { geosOp, geosReady, geosTriangles } from './geos';
import type { Poly } from './merge';

const square = (x: number, z: number, s: number): Poly => ({
  outer: [
    [x, z],
    [x + s, z],
    [x + s, z + s],
    [x, z + s],
  ],
  holes: [],
});
const areaOf = (ps: Poly[]) => {
  const a2 = (r: [number, number][]) =>
    r.reduce((s, p, i) => {
      const q = r[(i + 1) % r.length] as [number, number];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0);
  return ps.reduce((s, p) => s + a2(p.outer) / 2 + p.holes.reduce((h, r) => h + a2(r) / 2, 0), 0);
};

beforeAll(async () => {
  await geosReady();
});

describe('GEOS on the grid', () => {
  it('unites, intersects and takes away, outer rings anticlockwise, holes clockwise', () => {
    const a = square(0, 0, 10);
    const b = square(5, 5, 10);
    expect(areaOf(geosOp('union', [a, b]))).toBe(175);
    expect(areaOf(geosOp('intersection', [a], [b]))).toBe(25);
    expect(areaOf(geosOp('difference', [a], [b]))).toBe(75);
    const ring = geosOp('difference', [square(0, 0, 10)], [square(3, 3, 4)]);
    expect(ring.length).toBe(1);
    expect(ring[0]?.holes.length).toBe(1);
    expect(areaOf(ring)).toBe(84);
  });

  it('puts what it makes on the grid', () => {
    // (two triangles crossing between grid points: their crossing put on one)
    const got = geosTriangles([0, 0, 10, 0, 0, 3, 0, 1, 10, 0, 10, 1], 2);
    for (const p of got)
      for (const [x, z] of p.outer) expect([Number.isInteger(x), Number.isInteger(z)]).toEqual([true, true]);
  });
});
