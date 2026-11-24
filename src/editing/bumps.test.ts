import { describe, expect, it } from 'vitest';
import {
  BUMP_A_DAB,
  BUMP_BRUSH,
  bumpAt,
  bumpDab,
  bumpPoint,
  bumpsCleared,
  bumpsFrom,
  bumpsJson,
  hasBumps,
  noBumps,
} from './bumps';

describe('the roads’ bumps', () => {
  it('sets a point to so many metres, easing to nothing within its reach; the bumps before kept as they were', () => {
    const none = noBumps();
    expect(bumpAt(none, 3, 4)).toBe(0);
    // (a point off the grid's points, across a tile's edge, below 0)
    const b = bumpPoint(none, -0.03, 12.79, 0.01, 0.3);
    expect(bumpAt(b, -0.03, 12.79)).toBeCloseTo(0.01, 5);
    // (past its reach and the grid's next point: nothing)
    expect(bumpAt(b, -0.03 + 0.3 + 0.1, 12.79)).toBe(0);
    expect(bumpAt(b, -0.03, 12.79 + 0.15)).toBeGreaterThan(0);
    expect(bumpAt(b, -0.03, 12.79 + 0.15)).toBeLessThan(0.01);
    expect(Object.keys(b.tiles).sort()).toEqual(['-1,0', '-1,1', '0,0', '0,1']);
    expect(hasBumps(none)).toBe(false);
    expect(none.tiles).toEqual({});
    // (another point: the first one's tiles copied, not changed)
    const c = bumpPoint(b, 5, 5, -0.004, 0.2);
    expect(bumpAt(c, 5, 5)).toBeCloseTo(-0.004, 5);
    expect(bumpAt(b, 5, 5)).toBe(0);
    expect(c.tiles['-1,1']).toBe(b.tiles['-1,1']);
  });

  it('raises, lowers and smooths with a brush, most at its middle', () => {
    const brush = { ...BUMP_BRUSH, radius: 1, strength: 1 };
    const up = bumpDab(noBumps(), 2, 2, { ...brush, mode: 'raise' });
    expect(bumpAt(up, 2, 2)).toBeCloseTo(BUMP_A_DAB, 6);
    expect(bumpAt(up, 2.5, 2)).toBeLessThan(BUMP_A_DAB);
    expect(bumpAt(up, 3.1, 2)).toBe(0);
    const down = bumpDab(up, 2, 2, { ...brush, mode: 'lower' });
    expect(bumpAt(down, 2, 2)).toBeCloseTo(0, 6);
    // (a spike smoothed: lower at its top, its foot raised)
    const spike = bumpPoint(noBumps(), 2, 2, 0.02, 0.15);
    const smooth = bumpDab(spike, 2, 2, { ...brush, mode: 'smooth' });
    expect(bumpAt(smooth, 2, 2)).toBeLessThan(0.02);
    expect(bumpAt(smooth, 2.3, 2)).toBeGreaterThan(bumpAt(spike, 2.3, 2));
    expect(bumpAt(bumpsCleared(smooth, 2, 2, 2), 2, 2)).toBe(0);
  });

  it('is kept as the track’s file has them: the tiles with bumps only', () => {
    const b = bumpPoint(noBumps(), 1, 1, 0.012, 0.3);
    const j = bumpsJson(b);
    expect(j).toMatchObject({ version: 1, cell: 0.1, tile: 128 });
    expect(Object.keys(j.tiles)).toEqual(['0,0']);
    const back = bumpsFrom(JSON.parse(JSON.stringify(j)));
    expect(bumpAt(back, 1, 1)).toBeCloseTo(0.012, 6);
    // (a tile of nothing left out; nothing given, none)
    expect(bumpsJson(bumpsCleared(b, 1, 1, 1)).tiles).toEqual({});
    expect(bumpsFrom(null)).toEqual(noBumps());
    expect(bumpsFrom({ cell: 0.1, tile: 128, tiles: { bad: 'x', '0,0': 'AAAA' } }).tiles).toEqual({});
  });
});
