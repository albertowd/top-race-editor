// @vitest-environment node
// A building's outline from above (footprint.ts), for the map: the Velopark's pit building's (the editor's model of
// it, in models/), about its catalogue size, read with the Velopark's library where it is next to the editor.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { footprintOf } from './footprint';
import type { MaterialLibrary } from './gltf';
import { libraryOf } from './materials';
import type { HostFiles } from './placehost';
import { EDITOR } from './velopark-fixture';

const V = 'D:/projects/kart-velopark';
const T = join(EDITOR, 'models').split('\\').join('/');
const files: HostFiles = {
  read: async (p) => new Uint8Array(readFileSync(p)),
  list: async (d) => readdirSync(d),
  size: async (p) => statSync(p).size,
  exists: async (p) => existsSync(p),
  write: async () => {},
};

describe.skipIf(!existsSync(`${V}/source/materials.json`))('a building seen from above', () => {
  it('has its own outline, about its size', async () => {
    const lib = (await libraryOf(files, V)) as MaterialLibrary;
    const rings = await footprintOf(files, `${T}/pit_building.glb`, lib, `${V}/source/textures`);
    expect(rings.length).toBeGreaterThan(0);
    const xs = rings.flatMap((r) => r.filter((_, i) => i % 2 === 0));
    const zs = rings.flatMap((r) => r.filter((_, i) => i % 2 === 1));
    const size = (
      JSON.parse(readFileSync(`${T}/catalogue.json`, 'utf-8')) as { models: { id: string; size: number[] }[] }
    ).models.find((m) => m.id === 'pit_building')?.size as number[];
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(size[0] as number, -1);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(size[2] as number, -1);
    // (kept: the same the second time)
    expect(await footprintOf(files, `${T}/pit_building.glb`, lib, `${V}/source/textures`)).toBe(rings);
  }, 60_000);
});
