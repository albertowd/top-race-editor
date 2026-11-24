// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bumpAt, bumpPoint, bumpsJson, noBumps } from '../editing/bumps';
import { bumped, bumpsPath, loadBumps, saveBumps } from './bumpsfile';
import type { HostFiles } from './placehost';

/** Files in memory. */
function memory(): HostFiles & { kept: Map<string, Uint8Array> } {
  const kept = new Map<string, Uint8Array>();
  return {
    kept,
    read: async (p) => {
      const b = kept.get(p);
      if (!b) throw new Error(`no ${p}`);
      return b;
    },
    write: async (p, b) => {
      kept.set(p, b);
    },
    exists: async (p) => kept.has(p),
    list: async () => [],
    size: async (p) => kept.get(p)?.length ?? 0,
  };
}

describe('the bumps as the track keeps them', () => {
  it('are none till saved; saved, read back as they were, the file before kept', async () => {
    const files = memory();
    expect(await loadBumps(files, 'D:/t/')).toEqual(noBumps());
    const b = bumpPoint(noBumps(), 4, 2, 0.015, 0.3);
    await saveBumps(files, 'D:/t', 'D:/t/backups', bumpsJson(b));
    expect(files.kept.has(bumpsPath('D:/t'))).toBe(true);
    expect(bumpAt(await loadBumps(files, 'D:/t'), 4, 2)).toBeCloseTo(0.015, 6);
    await saveBumps(files, 'D:/t', 'D:/t/backups', bumpsJson(noBumps()));
    expect([...files.kept.keys()].some((k) => k.startsWith('D:/t/backups/bumps-'))).toBe(true);
    expect(await loadBumps(files, 'D:/t')).toEqual(noBumps());
  });

  it('move every point of the merged floor by the bumps where it is, the same in each mesh', () => {
    const b = bumpPoint(noBumps(), 1, 1, 0.01, 0.5);
    // (two meshes sharing a point at (1, 1): a road's and the ground's)
    const road = { P: Float64Array.from([1, 2, 1, 5, 2, 5]), UV: new Float64Array(4), F: new Int32Array() };
    const ground = { P: Float64Array.from([1, 2, 1]), UV: new Float64Array(2), F: new Int32Array() };
    const before = road.P;
    expect(bumped({ road, ground }, b)).toBe(2);
    expect(road.P[1]).toBeCloseTo(2.01, 6);
    expect(ground.P[1]).toBeCloseTo(2.01, 6);
    expect(road.P[4]).toBe(2);
    // (the points it had left as they were)
    expect(before[1]).toBe(2);
    expect(bumped({ road }, noBumps())).toBe(0);
  });
});
