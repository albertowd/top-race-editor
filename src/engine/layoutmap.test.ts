// @vitest-environment node
// A layout's map and pictures: where it starts and the way it runs, its name in the game, and the AC track's layouts'
// pictures made of them (its outline; its place rendered from above where the track can be), on a track of two
// layouts.
import { describe, expect, it } from 'vitest';
import { writeAiFile } from './acai';
import { dump, type Kn5 } from './kn5tree';
import { acPictures, layoutTitle, type OutlineSpec, startFacing, startSpot } from './layoutmap';
import type { HostFiles } from './placehost';
import type { Spot } from './places';
import type { Shot, TrackScene } from './trackrender';

/** files in memory */
function memory(start: Record<string, Uint8Array | string> = {}): HostFiles & { got: Map<string, Uint8Array> } {
  const got = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(start)) got.set(k, typeof v === 'string' ? new TextEncoder().encode(v) : v);
  return {
    got,
    read: async (p) => {
      const b = got.get(p);
      if (!b) throw new Error(`no ${p}`);
      return b;
    },
    write: async (p, b) => {
      got.set(p, b);
    },
    exists: async (p) => got.has(p) || [...got.keys()].some((k) => k.startsWith(`${p}/`)),
    list: async () => [],
    size: async (p) => got.get(p)?.length ?? 0,
  };
}

/** a ring of n points round (cx, cz), r across, the track's x y z, as an AC AI file */
function ring(cx: number, cz: number, r: number, n = 40): Uint8Array {
  const P: number[] = [];
  const along: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    P.push(cx + r * Math.cos(a), 0, cz + r * Math.sin(a));
    along.push(i);
  }
  return writeAiFile(P, along);
}

/** a kn5 of nothing */
const kn5 = (): Kn5 => ({
  version: 5,
  extra: null,
  textures: [],
  materials: [],
  root: { kind: 1, name: 'root', active: 1, children: [], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
});

const spot = (name: string, x: number, z: number, heading = 0): Spot => ({ name, x, y: 0, z, heading });

describe("a layout's start", () => {
  it("is a hot lap's own where it is a hot lap, else its grid's first slot", () => {
    const spots = new Map([
      ['START_0', spot('START_0', 1, 2)],
      ['HOTLAP_START_0', spot('HOTLAP_START_0', 5, 6)],
    ]);
    expect(startSpot('vp_1500', spots)?.name).toBe('START_0');
    expect(startSpot('vp_1500_hotlap', spots)?.name).toBe('HOTLAP_START_0');
    expect(startSpot('vp_1500_hotlap', new Map([['START_0', spot('START_0', 1, 2)]]))?.name).toBe('START_0');
    expect(startSpot('vp_1500', new Map())).toBeNull();
  });

  it('faces the way its line runs, whichever way its heading says', () => {
    // (a line running east, x up)
    const line = Array.from({ length: 10 }, (_, i) => [i, 0, 0] as [number, number, number]);
    expect(startFacing(line, [2, 0, 0], Math.PI / 2)).toEqual([1, expect.closeTo(0, 9), 0]);
    expect(startFacing(line, [2, 0, 0], -Math.PI / 2)).toEqual([1, expect.closeTo(0, 9), 0]);
  });
});

describe("a layout's name", () => {
  it("is its ui name with the track's name off its front", () => {
    expect(layoutTitle('Velopark 1500 Short', 'Velopark', 'vp_1500_short')).toBe('1500 Short');
    expect(layoutTitle(undefined, 'Velopark', 'vp_kids')).toBe('vp_kids');
    expect(layoutTitle('Velopark', 'Velopark', 'vp_x')).toBe('vp_x');
  });
});

describe("the AC track's layouts' pictures", () => {
  it('are each its outline and its place rendered, of its own models, from where all its lap is seen', async () => {
    const out = 'P/build/ac/content/tracks/t';
    const files = memory({
      'P/tools/reference/track.json': JSON.stringify({
        name: 'Park',
        layouts: { big: { models: [] }, small: { models: [] }, bare: { models: [] } },
      }),
      [`${out}/models_big.ini`]: '[MODEL_0]\r\nFILE=track.kn5\r\n\r\n[MODEL_1]\r\nFILE=big.kn5\r\n',
      [`${out}/models_small.ini`]: '[MODEL_0]\nFILE=track.kn5\n[MODEL_1]\nFILE=gone.kn5\n',
      [`${out}/track.kn5`]: dump(kn5()),
      [`${out}/big.kn5`]: dump(kn5()),
      [`${out}/big/ai/fast_lane.ai`]: ring(0, 0, 100),
      [`${out}/small/ai/fast_lane.ai`]: ring(0, 0, 30),
    });
    const outlines: OutlineSpec[] = [];
    const renders: { scene: TrackScene; shots: Shot[] }[] = [];
    const host = {
      outline: async (s: OutlineSpec) => {
        outlines.push(s);
        return new TextEncoder().encode('outline');
      },
      render: async (scene: TrackScene, shots: Shot[]) => {
        renders.push({ scene, shots });
        return shots.map((s) => new TextEncoder().encode(`render ${s.models.join(' ')}`));
      },
    };
    const wrote = await acPictures(files, host, { project: 'P', out });
    // (two layouts with a line, each two pictures; the one without a line left as it is)
    expect(wrote).toBe(4);
    expect(files.got.has(`${out}/ui/bare/preview.png`)).toBe(false);
    expect(outlines.every((o) => o.size[0] === 365 && o.size[1] === 192)).toBe(true);
    // (one render of the models every layout draws, each layout its own; a model not there left out)
    expect(renders).toHaveLength(1);
    expect(Object.keys(renders[0]?.scene.models ?? {}).sort()).toEqual(['big.kn5', 'track.kn5']);
    const text = (p: string) => new TextDecoder().decode(files.got.get(p));
    expect(text(`${out}/ui/big/preview.png`)).toBe('render track.kn5 big.kn5');
    expect(text(`${out}/ui/small/preview.png`)).toBe('render track.kn5');
    const [big, small] = (renders[0] as { shots: Shot[] }).shots as [Shot, Shot];
    expect(big.size).toEqual([355, 200]);
    expect(big.format).toBe('png');
    // (looking down at it, from further off for the bigger lap)
    expect(big.eye[1]).toBeGreaterThan(big.target[1]);
    const far = (s: Shot) => Math.hypot(s.eye[0] - s.target[0], s.eye[1] - s.target[1], s.eye[2] - s.target[2]);
    expect(far(big)).toBeGreaterThan(far(small) * 2);
    // (made again of the same: nothing written)
    expect(await acPictures(files, host, { project: 'P', out })).toBe(0);
  });

  it('are the outlines alone where nothing renders the track', async () => {
    const out = 'P/o';
    const files = memory({
      'P/tools/reference/track.json': JSON.stringify({ layouts: { big: {} } }),
      [`${out}/big/ai/fast_lane.ai`]: ring(0, 0, 100),
    });
    const host = { outline: async () => new Uint8Array([1]) };
    expect(await acPictures(files, host, { project: 'P', out })).toBe(1);
    expect(files.got.has(`${out}/ui/big/preview.png`)).toBe(false);
  });
});
