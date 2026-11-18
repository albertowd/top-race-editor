// A layer d metres over a surface along its normal (layer.ts): on flat ground d straight up; on a slope more, so it is
// d thick square to the ground; where the ground cannot be told, straight up.
import { describe, expect, it } from 'vitest';
import { above, upright } from './layer';

describe('a layer over the ground', () => {
  it('is as thick square to the ground as asked', () => {
    expect(above(() => 3, 1, 2, 0.02)).toBeCloseTo(3.02, 12);
    // (a 10% slope: 2 cm square to it is 2.01 cm up)
    const slope = (x: number) => 0.1 * x;
    expect(upright(slope, 5, 0)).toBeCloseTo(1 / Math.hypot(0.1, 1), 12);
    expect(above(slope, 5, 0, 0.02)).toBeCloseTo(0.5 + 0.02 * Math.hypot(0.1, 1), 12);
    // (the thickness along the normal: the height over it times how upright it is)
    expect((above(slope, 5, 0, 0.02) - 0.5) * upright(slope, 5, 0)).toBeCloseTo(0.02, 12);
    // (no ground to tell it by: straight up)
    expect(above((x) => (x > 5 ? Number.NaN : 1), 5, 0, 0.02)).toBeCloseTo(1.02, 12);
  });
});
