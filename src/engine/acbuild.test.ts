// @vitest-environment node
// The track built for AC (acbuild.ts): its folder's name and its nodes turned.
import { describe, expect, it } from 'vitest';
import { acFolder, placeMatrix } from './acbuild';

describe('the track built for AC', () => {
  it('names its folder and turns its nodes', () => {
    expect(acFolder('Techspeed FuelTech Velopark')).toBe('techspeed_fueltech_velopark');
    const m = placeMatrix(1, 2, 3, Math.PI / 2);
    // (its +z along (sin, 0, cos): east)
    expect(m.slice(8, 11).map((v) => Math.round(v * 1e12) / 1e12)).toEqual([1, 0, 0]);
    expect(m.slice(12)).toEqual([1, 2, 3, 1]);
  });
});
