// @vitest-environment node
// The page's looks at the roads as built (geometry.py's mesh and surface), judged by what they should come to: a
// road's mesh its own area less what the roads above it cover; the surface over a window covered once, proved.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClipType } from 'clipper2-js';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../test/made-up';
import { localFiller, polysOf, toPaths, unit } from './merge';
import { above, roadPreview, surfacePreview, wrongFaces } from './previews';
import { asBuilt, mesh, outline, type RoadDesc } from './roads';
import { triangle } from './velopark-fixture';

const polyOf = (pts: number[][]) => ({
  outer: pts.map(([x, z]) => [unit(x as number), unit(z as number)] as [number, number]),
  holes: [],
});
const areaOfPolys = (ps: ReturnType<typeof polysOf>) => {
  let s = 0;
  for (const p of ps)
    for (const r of [p.outer, ...p.holes])
      for (let i = 0; i < r.length; i++) {
        const a = r[i] as [number, number];
        const b = r[(i + 1) % r.length] as [number, number];
        s += a[0] * b[1] - b[0] * a[1];
      }
  return (s / 2) * 1e-8;
};
/** a mesh's area seen from above (points x z) */
const meshArea = (P: number[], F: number[]) => {
  let s = 0;
  for (let f = 0; f < F.length; f += 3) {
    const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
    s +=
      Math.abs(
        ((P[b * 2] as number) - (P[a * 2] as number)) * ((P[c * 2 + 1] as number) - (P[a * 2 + 1] as number)) -
          ((P[c * 2] as number) - (P[a * 2] as number)) * ((P[b * 2 + 1] as number) - (P[a * 2 + 1] as number)),
      ) / 2;
  }
  return s;
};

/** a mesh's area seen from above (points x y z) */
const meshArea3 = (P: ArrayLike<number>, F: ArrayLike<number>) => {
  const xz: number[] = [];
  for (let i = 0; i < P.length; i += 3) xz.push(P[i] as number, P[i + 2] as number);
  return meshArea(xz, Array.from(F));
};

describe('the road previews', () => {
  // (the made-up roads of the fixtures: two crossing, a run-off along one)
  const list = (JSON.parse(readFileSync(join(FIXTURES, 'roads.json'), 'utf-8')) as { roads: RoadDesc[] }).roads;
  const roads = Object.fromEntries(list.map((r) => [r.name, r]));

  it('cuts each road where the roads above it lie, and no more', { timeout: 300_000 }, () => {
    let cut = 0;
    for (const road of list) {
      const got = roadPreview(road, list);
      expect(got.under).toEqual(above(road, roads as Record<string, RoadDesc>));
      // (no face wrong but those of its own mesh: the cut makes none)
      const level = Object.fromEntries(list.map((r) => [r.name, { ...r, heights: null }]));
      const own = mesh(asBuilt(level[road.name] as RoadDesc, level), () => 0);
      const ownWrong = wrongFaces(own.P, own.F);
      expect(got.wrong.down, road.name).toEqual([]);
      expect(got.wrong.thin.length, road.name).toBeLessThanOrEqual(ownWrong.thin.length);
      if (!got.under.length) continue;
      // (what it should come to: its own outline less those of the roads above it)
      const by = roads as Record<string, RoadDesc>;
      const mine = polysOf(ClipType.Union, toPaths([polyOf(outline(road, by))]), null);
      const over = polysOf(ClipType.Union, toPaths(got.under.map((x) => polyOf(outline(by[x] as RoadDesc, by)))), null);
      const left = areaOfPolys(polysOf(ClipType.Difference, toPaths(mine), toPaths(over)));
      const whole = areaOfPolys(mine);
      if (whole - left < 1e-3) continue;
      cut++;
      // (its own mesh less what the roads above cover of it: the mesh's edge a few centimetres off its outline's,
      // where they cover it as near as that allows: 2 cm along the covered part's edge)
      const ownArea = meshArea3(own.P, own.F);
      const expected = ownArea - (whole - left);
      const covered = polysOf(ClipType.Intersection, toPaths(mine), toPaths(over));
      const edge =
        covered
          .flatMap((p) => [p.outer, ...p.holes])
          .reduce(
            (s, r) =>
              s +
              r.reduce(
                (t, a, i) =>
                  t +
                  Math.hypot(
                    ...([0, 1].map((k) => ((r[(i + 1) % r.length] as number[])[k] as number) - (a[k] as number)) as [
                      number,
                      number,
                    ]),
                  ),
                0,
              ),
            0,
          ) * 1e-4;
      expect(Math.abs(meshArea(got.P, got.F) - expected), road.name).toBeLessThan(0.02 * edge + 0.05);
    }
    expect(cut).toBeGreaterThan(0);
  });

  it('merges the surface in a window: covered once, nothing wrong', async () => {
    const tri = await triangle();
    const window: [number, number, number, number] = [-40, -40, 40, 40];
    const got = await surfacePreview(list, window, localFiller(tri), 'test');
    expect(got.issues).toEqual([]);
    const total = got.regions.reduce((s, r) => s + meshArea(r.P, r.F), 0);
    expect(Math.abs(total - 80 * 80)).toBeLessThan(0.5);
    expect(got.regions.some((r) => r.kind === 'road')).toBe(true);
    expect(got.regions.at(-1)?.kind).toBe('ground');
    for (const r of got.regions) {
      const P3 = new Float64Array((r.P.length / 2) * 3);
      r.P.forEach((v, i) => {
        P3[Math.floor(i / 2) * 3 + (i % 2) * 2] = v;
      });
      expect(wrongFaces(P3, r.F), r.name).toEqual({ down: [], thin: [] });
    }
  });
});
