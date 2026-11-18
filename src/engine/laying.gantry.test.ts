// @vitest-environment node
// A wide model on feet laid on the floor (laying.ts restHeights) as the editor's start gantry: on the floor under its
// feet, not under the open span between them (a road under a gantry higher than the verges its legs stand on).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { feet, restHeights } from './laying';
import { type CatalogueSource, catalogue, loadTemplate } from './templates';

const MODELS = join(__dirname, '..', '..', 'models').split('\\').join('/');

describe('a wide model on feet', () => {
  it('stands on its feet, not on the floor under the span between them', async () => {
    const src: CatalogueSource = {
      read: async (p) => new Uint8Array(readFileSync(p)),
      exists: async (p) => existsSync(p),
      editorModels: MODELS,
    };
    const cat = await catalogue(src);
    const parts = await loadTemplate(src, cat.gantry as NonNullable<(typeof cat)['gantry']>);
    // (a road under its middle, 0.5 m higher than the verges where its legs stand, 9.4 m out each side; whichever way
    // its legs lie in the model)
    const floor = (x: number, z: number) => (Math.hypot(x, z) < 3 ? 0.5 : 0);
    expect(restHeights(parts, [[0, 0, 0]], floor)).toEqual([0]);
    // (the ground under one leg higher: on the lower, the other leg sunk in a little, neither in the air)
    const sloped = (x: number, z: number) => (x > 5 || z > 5 ? 0.2 : 0);
    expect(restHeights(parts, [[0, 0, 0]], sloped)).toEqual([0]);
    // (its two legs level in the model: both its base)
    expect(feet(parts)).toBe(2);
  });
});
