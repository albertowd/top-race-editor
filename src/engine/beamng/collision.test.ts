// What vehicles hit in the BeamNG level: a fine floor made coarse within its error, its bumps and its edges kept,
// cut in tiles of at most so many triangles; a shape only hit laid out as BeamNG's own are.
import { describe, expect, it } from 'vitest';
import { coarsen, collisionTiles, ROAD_ERROR, weld } from './collision';
import { type DaeMesh, writeDae } from './dae';

/** A floor of w by d metres from (x0, 0), a point every `step` metres, its height z(x, y). */
function floor(
  material: string,
  w: number,
  d: number,
  step: number,
  z: (x: number, y: number) => number,
  x0 = 0,
): DaeMesh {
  const nx = Math.round(w / step) + 1;
  const ny = Math.round(d / step) + 1;
  const P: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const y = j * step;
      P.push(x, y, z(x, y));
    }
  const F: number[] = [];
  for (let j = 0; j + 1 < ny; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i;
      F.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx);
    }
  const n = P.length / 3;
  return { name: material, material, P, N: new Array(n * 3).fill(0), U: new Array(n * 2).fill(0), F };
}

/** The height of a coarse mesh under (x, y) (NaN: none under it). */
function heightAt(P: ArrayLike<number>, F: ArrayLike<number>, x: number, y: number): number {
  for (let f = 0; f < F.length; f += 3) {
    const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number].map((k) => k * 3) as [
      number,
      number,
      number,
    ];
    const [ax, ay, bx, by, cx, cy] = [P[a], P[a + 1], P[b], P[b + 1], P[c], P[c + 1]] as number[];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    return l1 * (P[a + 2] as number) + l2 * (P[b + 2] as number) + l3 * (P[c + 2] as number);
  }
  return Number.NaN;
}

const area = (P: ArrayLike<number>, F: ArrayLike<number>) => {
  let s = 0;
  for (let f = 0; f < F.length; f += 3) {
    const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
    const ux = (P[b * 3] as number) - (P[a * 3] as number);
    const uy = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
    const vx = (P[c * 3] as number) - (P[a * 3] as number);
    const vy = (P[c * 3 + 1] as number) - (P[a * 3 + 1] as number);
    s += Math.abs(ux * vy - uy * vx) / 2;
  }
  return s;
};

describe("the level's collision", () => {
  it('makes a flat floor a few triangles, its edge where it was, its ground covered once', () => {
    const m = floor('road', 12, 8, 0.25, () => 1);
    const w = weld([m]);
    const F = coarsen(w, ROAD_ERROR);
    expect(F.length / 3).toBeLessThan(m.F.length / 3 / 10);
    expect(area(w.P, F)).toBeCloseTo(96, 6);
    // (every point on the floor's edge still a corner of a face)
    const used = new Set(F);
    for (let k = 0; k < w.P.length / 3; k++) {
      const x = w.P[k * 3] as number;
      const y = w.P[k * 3 + 1] as number;
      if (x === 0 || y === 0 || Math.abs(x - 12) < 1e-9 || Math.abs(y - 8) < 1e-9) expect(used.has(k)).toBe(true);
    }
  });

  it('keeps a bump within its error, the flat round it made coarse', () => {
    const bump = (x: number, y: number) => 0.03 * Math.exp(-((x - 5) ** 2 + (y - 5) ** 2) / 0.5);
    const m = floor('road', 10, 10, 0.1, bump);
    const w = weld([m]);
    const F = coarsen(w, ROAD_ERROR);
    expect(F.length / 3).toBeLessThan(m.F.length / 3 / 4);
    for (const [x, y] of [
      [5, 5],
      [5.3, 5],
      [5, 4.5],
      [4.2, 5.6],
      [2, 2],
    ] as [number, number][])
      expect(Math.abs(heightAt(w.P, F, x, y) - bump(x, y))).toBeLessThanOrEqual(ROAD_ERROR);
  });

  it('leaves no gap where two materials meet, and cuts them in tiles of at most so many triangles', () => {
    const a = floor('asphalt', 10, 10, 0.2, (x) => 0.01 * x);
    // (the grass a point every 0.4 m, the asphalt every 0.2: their points along x = 10 the grass's, as the merge makes
    // them, point for point)
    const b = floor('grass', 10, 10, 0.4, (x) => 0.01 * x, 10);
    const tiles = collisionTiles(
      [
        { mesh: a, error: ROAD_ERROR },
        { mesh: b, error: 0.01 },
      ],
      300,
    );
    const sizes = tiles.map((t) => t.reduce((s, m) => s + m.F.length / 3, 0));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(300);
    expect(tiles.length).toBeGreaterThan(1);
    // (each tile's meshes by material, its points its own)
    for (const t of tiles) {
      expect(new Set(t.map((m) => m.material)).size).toBe(t.length);
      for (const m of t) expect(Math.max(...Array.from(m.F))).toBe(m.P.length / 3 - 1);
    }
    // (the points along x = 10 the grass has are in both materials' collision)
    const seam = (mat: string) => {
      const s = new Set<string>();
      for (const t of tiles)
        for (const m of t)
          if (m.material === mat)
            for (let k = 0; k < m.P.length / 3; k++)
              if (Math.abs((m.P[k * 3] as number) - 10) < 1e-9) s.add(((m.P[k * 3 + 1] as number) * 10).toFixed(0));
      return s;
    };
    const grass = seam('grass');
    const asphalt = seam('asphalt');
    for (let k = 0; k <= 25; k++) {
      expect(grass.has(String(4 * k))).toBe(true);
      expect(asphalt.has(String(4 * k))).toBe(true);
    }
    // (the ground covered as before, once)
    const total = tiles.flat().reduce((s, m) => s + area(m.P, m.F), 0);
    expect(total).toBeCloseTo(200, 6);
  });

  it('writes a shape only hit as BeamNG writes its own: a detail that draws nothing, its collision', () => {
    const [tile] = collisionTiles([{ mesh: floor('road', 2, 2, 0.5, () => 0), error: ROAD_ERROR }]);
    const dae = writeDae([], { collision: tile });
    expect(dae).toContain('<node id="nulldetail1" name="nulldetail1"/>');
    expect(dae).toContain('<node id="collision-1" name="collision-1"/>');
    expect(dae).toContain('name="Colmesh_0-1"');
    expect(dae).not.toMatch(/_L\d+"/);
  });
});
