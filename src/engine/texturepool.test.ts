// A model's pictures each held once (what the build does: one picture under two names one, the materials naming the
// other renamed); and pooled across models (not used by the build: AC finds no picture in another model), a name two
// models give different pictures kept in each; the materials as they were (names, count).
import { describe, expect, it } from 'vitest';
import type { Kn5, Kn5Material } from './kn5tree';
import { dedupeTextures, poolTextures, sharedFirst } from './texturepool';

const pic = (...b: number[]) => Uint8Array.from(b);
const mat = (name: string, ...textures: string[]): Kn5Material => ({
  name,
  shader: 'ksPerPixel',
  blend: 0,
  alpha_tested: 0,
  depth_mode: 0,
  props: [],
  textures: textures.map((t, slot) => ({ sampler: slot ? 'txNormal' : 'txDiffuse', slot, name: t })),
});
const model = (textures: [string, Uint8Array][], materials: Kn5Material[]): Kn5 => ({
  version: 6,
  extra: 0,
  textures: textures.map(([name, data]) => ({ name, active: 1, data })),
  materials,
  root: { kind: 1, name: 'root', active: 1, matrix: [], children: [] },
});

describe("the track's pictures", () => {
  it('are held once, in the shared model; twins one; clashes kept where they are', () => {
    const models = new Map<string, Kn5>([
      [
        'velopark',
        model(
          [
            ['tarmac_dark_nm.dds', pic(1, 1)],
            ['tarmac_light_nm.dds', pic(1, 1)],
            ['GoogleMap.jpg', pic(2)],
          ],
          [
            mat('Tarmac Dark', 'GoogleMap.jpg', 'tarmac_dark_nm.dds'),
            mat('Tarmac Light', 'GoogleMap.jpg', 'tarmac_light_nm.dds'),
          ],
        ),
      ],
      [
        'velopark_kerbs',
        model(
          [
            ['GoogleMap.jpg', pic(2)],
            ['kerb_ramp.dds', pic(3)],
            ['sign.dds', pic(4)],
          ],
          [mat('KerbRamp', 'kerb_ramp.dds'), mat('Background', 'GoogleMap.jpg'), mat('Sign', 'sign.dds')],
        ),
      ],
      ['vp_kids', model([['sign.dds', pic(5)]], [mat('Sign', 'sign.dds')])],
    ]);
    const p = poolTextures(models, 'velopark');
    const names = (s: string) => models.get(s)?.textures.map((t) => t.name);
    expect(names('velopark')).toEqual(['tarmac_dark_nm.dds', 'GoogleMap.jpg', 'kerb_ramp.dds']);
    // (sign.dds: two pictures under one name, each kept where it is)
    expect(names('velopark_kerbs')).toEqual(['sign.dds']);
    expect(names('vp_kids')).toEqual(['sign.dds']);
    expect(p.clashes).toEqual(['sign.dds']);
    // (the light tarmac's normal map the dark one's: the same bytes)
    expect(models.get('velopark')?.materials[1]?.textures[1]?.name).toBe('tarmac_dark_nm.dds');
    expect(p).toMatchObject({ pooled: 3, moved: 2, renamed: 1 });
    // (the materials as they were)
    expect(models.get('velopark_kerbs')?.materials.map((m) => m.name)).toEqual(['KerbRamp', 'Background', 'Sign']);
  });

  it("of one model: each held once, a twin's materials renamed; the model keeps them all", () => {
    const k = model(
      [
        ['tarmac_dark_nm.dds', pic(1, 1)],
        ['tarmac_light_nm.dds', pic(1, 1)],
        ['GoogleMap.jpg', pic(2)],
      ],
      [
        mat('Tarmac Dark', 'GoogleMap.jpg', 'tarmac_dark_nm.dds'),
        mat('Tarmac Light', 'GoogleMap.jpg', 'tarmac_light_nm.dds'),
      ],
    );
    expect(dedupeTextures(k)).toMatchObject({ pooled: 2, moved: 0, renamed: 1 });
    expect(k.textures.map((t) => t.name)).toEqual(['tarmac_dark_nm.dds', 'GoogleMap.jpg']);
    expect(k.materials[1]?.textures[1]?.name).toBe('tarmac_dark_nm.dds');
  });

  it('go to the model every layout loads first, where they all load one', () => {
    expect(sharedFirst({ a: ['velopark', 'vp_a'], b: ['velopark', 'vp_b'] })).toBe('velopark');
    expect(sharedFirst({ a: ['velopark'], b: ['other'] })).toBeNull();
    expect(sharedFirst({})).toBeNull();
  });
});
