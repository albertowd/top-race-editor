// @vitest-environment node
// The track now, seen from above (context.ts): the outline of made-up faces, chained and kept.
import { describe, expect, it } from 'vitest';
import { chains, contextItem, simplify } from './context';

describe('the track now, seen from above', () => {
  it('outlines two squares as two closed lines, their inner edges out', () => {
    // (a square of two triangles, and another apart: each its four sides, closed)
    const sq = (x: number) => [x, 0, x + 1, 0, x + 1, 1, x, 0, x + 1, 1, x, 1];
    const got = contextItem('A', 'road', 'M', [...sq(0), ...sq(5)]);
    expect(got?.lines?.length).toBe(2);
    for (const L of got?.lines ?? []) expect([L.length, L.slice(0, 2)]).toEqual([10, L.slice(-2)]);
    expect(
      chains([
        [0, 1],
        [1, 2],
        [2, 3],
      ]),
    ).toEqual([[0, 1, 2, 3]]);
    expect(simplify([0, 0, 1, 0.001, 2, 0], 0.02)).toEqual([0, 0, 2, 0]);
  });
});
