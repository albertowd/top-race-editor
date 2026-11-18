// @vitest-environment node
// The Velopark's BeamNG level made by the engine (buildBeamng, into test-out/beamng, packed in test-out/dist), from the
// track's models and the AC build's AI lines as they are: whole and packed in a minute or so, each start's map drawn of
// the roads as a picture's pixels, not the floor's millions of triangles (a canvas takes hours to fill a path of those).
// Its log, timed, in test-out/beamng.txt. Only when asked (TOP_RACE_VELOPARK=1), and where the Velopark and its AC build
// are next to the editor.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPng } from '../dds';
import type { HostFiles } from '../placehost';
import { EDITOR, OUT } from '../velopark-fixture';
import { buildBeamng, type MapSpec } from './level';

const VELOPARK = 'D:/projects/kart-velopark';
const AI = `${VELOPARK}/build/ac/content/tracks/techspeed_fueltech_velopark`;
const here = existsSync(join(VELOPARK, 'tools', 'reference', 'track.json')) && existsSync(`${AI}/vp_1500/ai`);
const slashes = (p: string) => p.split('\\').join('/');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

const files: HostFiles = {
  read: async (p) => new Uint8Array(readFileSync(p)),
  list: async (d) => readdirSync(d),
  size: async (p) => statSync(p).size,
  exists: async (p) => existsSync(p),
  write: async (p, b) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, b);
  },
};

describe.skipIf(!here)("the Velopark's BeamNG level", () => {
  it('is made in a minute or so, its starts’ maps of few triangles', { timeout: 600_000 }, async () => {
    const t0 = Date.now();
    const log: string[] = [];
    const maps: MapSpec[] = [];
    try {
      const made = await buildBeamng(
        files,
        {
          // (the textures read as PNGs; the maps' JPEGs, made here of nothing, as a picture of their size)
          decodeRgb: async (b) =>
            b[0] === 0xff ? { width: 800, height: 600, mode: 'RGB', data: new Uint8Array(800 * 600 * 3) } : readPng(b),
          encodeJpeg: async () => JPEG,
          mapPreview: async (spec) => {
            maps.push(spec);
            return JPEG;
          },
        },
        {
          project: VELOPARK,
          layout: 'vp_1500',
          ai: AI,
          out: slashes(join(OUT, 'beamng')),
          editorModels: slashes(join(EDITOR, 'models')),
          pack: true,
          dist: slashes(join(OUT, 'dist')),
          log: (l) => log.push(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} ${l}`),
        },
      );
      expect(made.starts).toBeGreaterThan(1);
      expect(maps).toHaveLength(made.starts);
      for (const m of maps) expect(m.roads.length / 6).toBeLessThan(100_000);
      expect((Date.now() - t0) / 1000).toBeLessThan(180);
    } finally {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, 'beamng.txt'), `${log.join('\n')}\n`);
    }
  });
});
