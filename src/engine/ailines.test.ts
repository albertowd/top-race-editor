// @vitest-environment node
// A layout's first racing lines from its AI files (ailines.ts): AC's points fitted with a curve of few nodes that keeps
// within FIT_TOL of every one of them (a made-up circle, and each of the Velopark's layouts where it is next to the
// editor); the pit line's fork and merge where it meets the fast line.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIT_TOL, firstLines, fitLine, type LineNode, readAi } from './ailines';
import type { HostFiles } from './placehost';
import { settingsOf } from './trackfiles';

const VELOPARK = 'D:/projects/kart-velopark';
const files: HostFiles = {
  read: async (p) => new Uint8Array(readFileSync(p)),
  list: async (d) => readdirSync(d),
  size: async (p) => statSync(p).size,
  exists: async (p) => existsSync(p),
  write: async () => {
    throw new Error('nothing is written');
  },
};

type V2 = [number, number];

/** The curve's points, n a piece. */
function sampled(c: LineNode[], closed: boolean, n = 400): V2[] {
  const out: V2[] = [];
  const pieces = closed ? c.length : c.length - 1;
  for (let k = 0; k < pieces; k++) {
    const a = c[k] as LineNode;
    const b = c[(k + 1) % c.length] as LineNode;
    for (let m = 0; m < n; m++) {
      const t = m / n;
      const u = 1 - t;
      const P1 = [a.p[0] + a.out[0], a.p[1] + a.out[1]] as V2;
      const P2 = [b.p[0] + b.in[0], b.p[1] + b.in[1]] as V2;
      out.push([
        u * u * u * a.p[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * b.p[0],
        u * u * u * a.p[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * b.p[1],
      ]);
    }
  }
  return out;
}

/** How far the farthest of the points is from the curve. */
function farthest(P: V2[], C: V2[]): number {
  let worst = 0;
  for (const q of P) {
    let best = Infinity;
    for (const c of C) best = Math.min(best, Math.hypot(c[0] - q[0], c[1] - q[1]));
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('the first racing lines, from the AI files', () => {
  it('fits a curve of few nodes within FIT_TOL of the points', () => {
    // (a lap round a circle and a hairpin: tight and wide turns)
    const P: V2[] = [];
    for (let i = 0; i < 1000; i++) {
      const a = (i / 1000) * 2 * Math.PI;
      const r = 60 + 25 * Math.sin(3 * a);
      P.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const c = fitLine(P, true);
    expect(farthest(P, sampled(c, true))).toBeLessThanOrEqual(FIT_TOL + 0.002);
    expect(c.length).toBeLessThan(120);
    const open = fitLine(P.slice(0, 400), false);
    expect(open[0]?.p).toEqual([P[0]?.[0], P[0]?.[1]].map((v) => Math.round((v as number) * 1000) / 1000));
    expect(open[0]?.in).toEqual([0, 0]);
    expect(farthest(P.slice(0, 400), sampled(open, false))).toBeLessThanOrEqual(FIT_TOL + 0.002);
  });

  it.skipIf(!existsSync(join(VELOPARK, 'track', 'ac')))(
    'reads each of the Velopark’s layouts’ lines, the pit line forking from the fast line and merging into it',
    async () => {
      const s = await settingsOf(files, VELOPARK);
      const layouts = readdirSync(join(VELOPARK, 'track', 'ac')).filter((l) =>
        existsSync(join(VELOPARK, 'track', 'ac', l, 'ai', 'fast_lane.ai')),
      );
      expect(layouts.length).toBeGreaterThan(0);
      for (const l of layouts) {
        const lines = await firstLines(files, s, l);
        const fast = readAi(new Uint8Array(readFileSync(join(VELOPARK, 'track', 'ac', l, 'ai', 'fast_lane.ai'))));
        expect(lines?.fast?.closed, l).toBe(true);
        const C = sampled(lines?.fast?.curve ?? [], true, 400);
        // (every tenth point: within FIT_TOL)
        expect(
          farthest(
            fast.P.filter((_, i) => i % 10 === 0),
            C,
          ),
          l,
        ).toBeLessThanOrEqual(FIT_TOL + 0.01);
        const pit = lines?.pit;
        if (!pit) continue;
        const total = fast.s.at(-1) as number;
        expect(pit.leaves, l).toBeGreaterThanOrEqual(0);
        expect(pit.joins, l).toBeLessThanOrEqual(total + 1);
        expect(pit.closed).toBe(false);
      }
    },
    120_000,
  );
});
