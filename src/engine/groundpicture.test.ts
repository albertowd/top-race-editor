// @vitest-environment node
// The ground's picture generated from the photo: what covers each pixel (shadows and canopies the cover round them),
// the covers simplified, each painted in its own colour there; made into the track's textures and library once, made
// again when the photo changes.
import { describe, expect, it } from 'vitest';
import { readPicture } from './dds';
import {
  coverOf,
  coversOf,
  DETAILS,
  detailPicture,
  EARTH,
  GENERATED_MATERIAL,
  GRASS,
  generatedGround,
  PAVED,
  paintCovers,
  tonesOf,
  UNKNOWN,
} from './groundpicture';
import { cleanObjects, ObjectsError } from './objectsfile';
import { pngRgba } from './pictures';

const GRASS_RGB: [number, number, number] = [100, 118, 86];
const ASPHALT_RGB: [number, number, number] = [134, 126, 118];
const SHADOW_RGB: [number, number, number] = [30, 42, 46];

/** A picture (RGB, size a side) of one colour, with another where at(x, y). */
function picture(size: number, base: number[], other: number[], at: (x: number, y: number) => boolean): Uint8Array {
  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.set(at(x, y) ? other : base, (y * size + x) * 3);
  return out;
}

describe('what covers the ground', () => {
  it('tells grass, earth and paving apart, and leaves a shadow or a canopy to the cover round it', () => {
    expect(coverOf(...GRASS_RGB)).toBe(GRASS);
    expect(coverOf(91, 102, 82)).toBe(GRASS);
    expect(coverOf(183, 162, 138)).toBe(EARTH);
    expect(coverOf(...ASPHALT_RGB)).toBe(PAVED);
    expect(coverOf(166, 161, 155)).toBe(PAVED);
    expect(coverOf(...SHADOW_RGB)).toBe(UNKNOWN);
    expect(coverOf(67, 84, 75)).toBe(UNKNOWN);
  });

  it('gives a shadow the cover round it, and keeps a road its own', () => {
    const size = 48;
    // (grass with a road across its lower half, a tree's shadow on the grass)
    const rgb = picture(size, GRASS_RGB, ASPHALT_RGB, (_, y) => y >= 32);
    for (let y = 8; y < 20; y++) for (let x = 10; x < 24; x++) rgb.set(SHADOW_RGB, (y * size + x) * 3);
    const c = coversOf(rgb, size);
    expect(c[14 * size + 16]).toBe(GRASS);
    expect(c[40 * size + 16]).toBe(PAVED);
    expect([...c].every((k) => k === GRASS || k === PAVED)).toBe(true);
  });

  it('simplifies a speck away', () => {
    const size = 32;
    const rgb = picture(size, GRASS_RGB, ASPHALT_RGB, (x, y) => x === 16 && y === 16);
    expect(coversOf(rgb, size)[16 * size + 16]).toBe(GRASS);
  });
});

describe('the ground painted', () => {
  it('is each cover in the colour the photo shows it there, varied, nothing of the shadows', () => {
    const size = 64;
    const rgb = picture(size, GRASS_RGB, ASPHALT_RGB, (_, y) => y >= 32);
    for (let y = 4; y < 14; y++) for (let x = 4; x < 14; x++) rgb.set(SHADOW_RGB, (y * size + x) * 3);
    const { picture: out, mask } = paintCovers(coversOf(rgb, size), tonesOf(rgb, size), size, 0.25);
    expect(out.length).toBe(size * size * 4);
    // (its mask: grass red, paving blue, soft between them)
    expect([...mask.subarray((10 * size + 30) * 4, (10 * size + 30) * 4 + 4)]).toEqual([255, 0, 0, 0]);
    expect([...mask.subarray((50 * size + 30) * 4, (50 * size + 30) * 4 + 4)]).toEqual([0, 0, 255, 0]);
    const edge = mask.subarray((32 * size + 30) * 4, (32 * size + 30) * 4 + 3);
    expect((edge[0] as number) > 0 && (edge[2] as number) > 0).toBe(true);
    const mean = (y0: number, y1: number, ch: number) => {
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < size; x++) {
          s += out[(y * size + x) * 4 + ch] as number;
          n++;
        }
      return s / n;
    };
    // (the grass, where the shadow was too, the photo's grass green; the road its grey)
    for (let ch = 0; ch < 3; ch++) {
      expect(Math.abs(mean(0, 26, ch) - (GRASS_RGB[ch] as number))).toBeLessThan(8);
      expect(Math.abs(mean(38, 64, ch) - (ASPHALT_RGB[ch] as number))).toBeLessThan(8);
    }
    const shade = out[(8 * size + 8) * 4 + 1] as number;
    expect(shade).toBeGreaterThan(90);
    // (varied: not one colour all over the grass)
    const greens = new Set<number>();
    for (let x = 0; x < size; x++) greens.add(out[(10 * size + x) * 4 + 1] as number);
    expect(greens.size).toBeGreaterThan(4);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });
});

describe('the details over the ground up close', () => {
  it('are grey round the middle, so far off the ground is its own colour, with a grain of their own each', () => {
    for (const d of DETAILS) {
      const px = detailPicture(d, 128);
      let sum = 0;
      let low = 255;
      let high = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i] as number;
        expect(px[i + 1]).toBe(v);
        sum += v;
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
      expect(Math.abs(sum / (px.length / 4) - 128)).toBeLessThan(10);
      expect(high - low).toBeGreaterThan(60);
    }
  });
});

describe('the generated ground in a track', () => {
  const P = 'D:/t';
  const lib = {
    materials: {
      Background: {
        colour: 'GoogleMap.png',
        targets: { ac: { shader: 'ksPerPixel', textures: [['txDiffuse', 0, 'GoogleMap.png']] } },
      },
      Asphalt: { colour: 'Asphalt.dds' },
    },
    textures: { 'GoogleMap.png': { ac: 'DXT1', normal: false } },
  };
  const fakeFiles = async (photo: Uint8Array) => {
    const store = new Map<string, Uint8Array>();
    store.set(`${P}/source/textures/GoogleMap.png`, photo);
    store.set(`${P}/source/materials.json`, new TextEncoder().encode(JSON.stringify(lib)));
    const writes: string[] = [];
    return {
      store,
      writes,
      files: {
        read: async (p: string) => {
          const b = store.get(p);
          if (!b) throw new Error(`no ${p}`);
          return b;
        },
        exists: async (p: string) => store.has(p),
        write: async (p: string, b: Uint8Array) => {
          store.set(p, b);
          writes.push(p);
        },
      },
    };
  };
  const photoOf = (rgb: number[]) => {
    const size = 64;
    const rgba = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) rgba.set([...rgb, 255], i * 4);
    return pngRgba(rgba, size, size);
  };

  it("is made beside the photo, its material the photo's with its own picture, once until the photo changes", async () => {
    const f = await fakeFiles(await photoOf(GRASS_RGB));
    const photo = `${P}/source/textures/GoogleMap.png`;
    expect(await generatedGround(f.files, P, photo, 'Background', 100)).toBe(GENERATED_MATERIAL);
    const made = f.store.get(`${P}/source/textures/GroundGenerated.png`) as Uint8Array;
    const pic = await readPicture(made);
    expect([pic.width, pic.height]).toEqual([64, 64]);
    const doc = JSON.parse(new TextDecoder().decode(f.store.get(`${P}/source/materials.json`)));
    expect(doc.materials.Background.colour).toBe('GoogleMap.png');
    expect(doc.materials[GENERATED_MATERIAL].colour).toBe('GroundGenerated.png');
    // (in AC: its picture with each cover's detail over it, tiled its metres over the photo's 100)
    const ac = doc.materials[GENERATED_MATERIAL].targets.ac;
    expect(ac.shader).toBe('ksMultilayer');
    expect(ac.textures).toEqual([
      ['txDiffuse', 0, 'GroundGenerated.png'],
      ['txMask', 1, 'GroundGeneratedMask.png'],
      ['txDetailR', 2, 'GroundDetailGrass.png'],
      ['txDetailG', 3, 'GroundDetailSand.png'],
      ['txDetailB', 4, 'GroundDetailGravel.png'],
      ['txDetailA', 5, 'GroundDetailGravel.png'],
    ]);
    expect(Object.fromEntries(ac.props)).toMatchObject({ multR: 100 / 1.5, multG: 50, multB: 50, magicMult: 2 });
    for (const f of ['GroundGenerated.png', 'GroundGeneratedMask.png', 'GroundDetailSand.png'])
      expect(doc.textures[f]).toEqual({ ac: 'DXT1', normal: false });
    expect(f.store.has(`${P}/source/textures/GroundDetailGrass.png`)).toBe(true);
    // (the photo itself untouched, for the editor to draw over)
    expect(f.writes).not.toContain(photo);
    // (again: nothing made; a new photo: made again)
    f.writes.length = 0;
    await generatedGround(f.files, P, photo, 'Background', 100);
    expect(f.writes).toEqual([]);
    f.store.set(photo, await photoOf(ASPHALT_RGB));
    await generatedGround(f.files, P, photo, 'Background', 100);
    expect(f.writes).toContain(`${P}/source/textures/GroundGenerated.png`);
  });

  it("is asked for in the objects' ground, the photo when not said", () => {
    const base = { version: 3, layouts: {}, objects: [], marks: [] };
    expect(cleanObjects({ ...base, ground: { picture: 'generated' } }).ground).toEqual({ picture: 'generated' });
    expect(cleanObjects({ ...base, ground: { picture: 'photo' } }).ground).toBeUndefined();
    expect(() => cleanObjects({ ...base, ground: { picture: 'drawn' } })).toThrow(ObjectsError);
  });
});
