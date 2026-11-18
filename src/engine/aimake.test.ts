// @vitest-environment node
// A racing line made AC's AI line (aimake.ts), on a made-up flat oval with a road 8 m wide: a point every STEP
// metres; round its bends as fast as GRIP lets it, no faster than TOP down its straights, braking into the bends; its
// way the line's; the road 4 m either side; which way it turns as AC has it.
import { describe, expect, it } from 'vitest';
import { readAiFile, writeAiFile } from './acai';
import type { LineNode, RacingLine } from './ailines';
import { aiLineOf, GRIP, STEP, TOP } from './aimake';

/** An oval: two 200 m straights along z and bends of radius 30 m, its nodes' handles a circle's (kappa). */
function oval(): RacingLine {
  const r = 30;
  const L = 100;
  const k = 0.5523 * r;
  const curve: LineNode[] = [
    { p: [r, -L], in: [0, -k], out: [0, k] },
    { p: [r, L], in: [0, -100], out: [0, k] },
    { p: [0, L + r], in: [k, 0], out: [-k, 0] },
    { p: [-r, L], in: [0, k], out: [0, -k] },
    { p: [-r, -L], in: [0, 100], out: [0, -k] },
    { p: [0, -L - r], in: [-k, 0], out: [k, 0] },
  ];
  return { curve, closed: true };
}

describe('a racing line made an AI line', () => {
  it('is driven round the oval as a kart would', () => {
    const line = oval();
    const flat = () => 0.5;
    const road = (x: number) => Math.abs(Math.abs(x) - 30) <= 4 || Math.hypot(x, 0) < 30;
    const ai = aiLineOf(line, flat, (x, z) => (Math.abs(z) <= 100 ? Math.abs(Math.abs(x) - 30) <= 4 : road(x)), STEP);
    const n = ai.along.length;
    const E = (i: number, k: number) => ai.extra[i * 18 + k] as number;
    expect(n).toBeGreaterThan(800);
    // (a point every half metre, on the floor)
    expect((ai.along[1] as number) - (ai.along[0] as number)).toBeCloseTo(STEP, 1);
    expect(ai.points[1]).toBeCloseTo(0.5, 6);
    // (the middle of the far bend: as fast as its grip lets it; the middle of a straight: faster, no more than TOP)
    const at = (x: number, z: number) => {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot((ai.points[i * 3] as number) - x, (ai.points[i * 3 + 2] as number) - z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    const bend = at(0, 130);
    const straight = at(30, 0);
    expect(E(bend, 4)).toBeCloseTo(30, -1);
    expect(E(bend, 0)).toBeCloseTo(Math.sqrt(GRIP * 30), 0);
    expect(E(straight, 0)).toBeGreaterThan(E(bend, 0) + 5);
    expect(E(straight, 0)).toBeLessThanOrEqual(TOP);
    // (braking before the bend, the throttle open after it)
    const before = at(30, 95);
    expect(E(before, 2)).toBeGreaterThan(0);
    expect(E(at(-30, 90), 1)).toBe(1);
    // (on the straight: the road 4 m either side, its way up +z, flat)
    expect(E(straight, 5)).toBeCloseTo(4, 0);
    expect(E(straight, 6)).toBeCloseTo(4, 0);
    expect([E(straight, 13), E(straight, 14), E(straight, 15)].map((v) => Math.round(v * 1000) / 1000)).toEqual([
      0, 0, 1,
    ]);
    expect([E(straight, 9), E(straight, 10), E(straight, 11)]).toEqual([-0, 1, -0]);
    // (the oval goes round to its left: AC's -1)
    expect(E(bend, 8)).toBe(-1);
    // (written as AC reads it)
    const back = readAiFile(writeAiFile(ai.points, ai.along, ai.extra, true));
    expect(back.points.length / 3).toBe(n);
    expect(back.extra?.[bend * 18]).toBeCloseTo(E(bend, 0), 4);
  });
});
