// @vitest-environment node
// (by hand: the Velopark floor merged over a small window round one place, TOP_RACE_SPOT="x0,z0,x1,z1" (metres),
// proved; the faces as noded and as filled, and the problems, written to test-out/floor_spot.json to look at)
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { loadKn5, type MaterialLibrary } from './gltf';
import { libraryOf } from './materials';
import { check, localFiller } from './merge';
import type { HostFiles } from './placehost';
import type { RoadDesc } from './roads';
import { buildFloor } from './trackfloor';
import { OUT, triangle } from './velopark-fixture';

const VELOPARK = 'D:/projects/kart-velopark';
const MODELS = [
  'velopark.glb',
  'velopark_kerbs.glb',
  'velopark_kids.glb',
  'velopark_paddock.glb',
  'velopark_runoffs.glb',
];
const files: HostFiles = {
  read: async (p) => new Uint8Array(readFileSync(p)),
  list: async (d) => readdirSync(d),
  size: async (p) => statSync(p).size,
  exists: async (p) => existsSync(p),
  write: async () => {},
};

describe.skipIf(!process.env.TOP_RACE_SPOT)('the Velopark floor round one place, by hand', () => {
  it('merges and proves it', async () => {
    const [x0, z0, x1, z1] = (process.env.TOP_RACE_SPOT as string).split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    mkdirSync(OUT, { recursive: true });
    const library = (await libraryOf(files, VELOPARK)) as MaterialLibrary;
    const models = Object.fromEntries(
      await Promise.all(
        MODELS.filter((f) => existsSync(join(VELOPARK, 'source', 'models', f))).map(
          async (f) => [f, await loadKn5(files, `${VELOPARK}/source/models/${f}`, library)] as const,
        ),
      ),
    );
    const roads = (
      JSON.parse(readFileSync(join(VELOPARK, 'tools', 'reference', 'roads.json'), 'utf-8')) as {
        roads: RoadDesc[];
      }
    ).roads;
    const host = {
      files,
      cacheDir: `${process.env.APPDATA}/top-race-editor/cache`.replace(/\\/g, '/'),
      decodeGrey: async () => {
        throw new Error('not in the cache');
      },
    };
    // (a region's own triangles, where named: TOP_RACE_SPOT_REGION)
    if (process.env.TOP_RACE_SPOT_REGION)
      await buildFloor(host, async () => [], {
        project: VELOPARK,
        models,
        roads,
        window: { x0, z0, x1, z1 },
        regionsOnly: (regions) => {
          const r = regions.find((x) => x.name === process.env.TOP_RACE_SPOT_REGION);
          writeFileSync(join(OUT, 'floor_spot_region.json'), JSON.stringify(r ? [...(r.tris ?? [])] : null));
        },
      });
    let faces: unknown[] = [];
    const seenParts: Record<string, { foot: unknown; seen: unknown }> = {};
    const made = await buildFloor(
      host,
      localFiller(await triangle()),
      { project: VELOPARK, models, roads, window: { x0, z0, x1, z1 } },
      {
        ...(process.env.TOP_RACE_SPOT_TILE ? { tile: Number(process.env.TOP_RACE_SPOT_TILE) } : {}),
        seenParts: (name, foot, seen) => {
          seenParts[name] = { foot, seen };
        },
        inspect: (fs) => {
          faces = fs;
        },
      },
    );
    const issues = check(made.meshes, made.window);
    writeFileSync(join(OUT, 'floor_spot.json'), JSON.stringify({ window: made.window, issues, faces, seenParts }));
    console.log(`${issues.length} problems: ${JSON.stringify(issues.slice(0, 8))}`);
  }, 600_000);
});
