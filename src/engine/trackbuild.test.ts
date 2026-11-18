// @vitest-environment node
// The Velopark made by the engine from the editor's data alone (buildTrack, into test-out/trackbuild): the build
// whole (the floor, its rumbles, the paint, each layout's own model, every tree planted, every object laid), nothing of
// a hand-made model in it; its start gantries each a model of its own, working (its lamps lit) in the layouts whose
// start and finish line it stands by, still in the others. Skipped where the Velopark is not next to the editor.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostFiles, PlaceHost } from './placehost';
import { buildTrack, MODEL } from './trackbuild';
import { EDITOR, nodeFiller, OUT } from './velopark-fixture';

const VELOPARK = 'D:/projects/kart-velopark';
const here = existsSync(join(VELOPARK, 'tools', 'reference', 'track.json'));
const slashes = (p: string) => p.split('\\').join('/');
/** the names of a model's nodes (its meshes', as kept) */
const nodeNames = (p: string): string[] => {
  const b = readFileSync(p);
  const doc = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf-8')) as { nodes?: { name?: string }[] };
  return (doc.nodes ?? []).map((n) => n.name ?? '');
};

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

describe.skipIf(!here)('the Velopark made by the engine', () => {
  it('is whole, of the editor’s data alone', async () => {
    const out = slashes(join(OUT, 'trackbuild'));
    rmSync(out, { recursive: true, force: true });
    const host: PlaceHost = {
      files,
      // (the place as the app worked it out, kept in its cache)
      cacheDir: slashes(`${process.env.APPDATA}/top-race-editor/cache`),
      decodeGrey: async () => {
        throw new Error('the place is not in the app’s cache: open the Velopark in the app first');
      },
    };
    const pool = await nodeFiller();
    const log: string[] = [];
    let made: Awaited<ReturnType<typeof buildTrack>>;
    try {
      made = await buildTrack(host, pool.filler, {
        project: VELOPARK,
        editorModels: slashes(join(EDITOR, 'models')),
        out,
        log: (l) => log.push(l),
        more: { outliner: pool.outliner },
      });
    } finally {
      await pool.close();
    }
    writeFileSync(join(OUT, 'trackbuild.txt'), `${log.join('\n')}\n`);
    const track = JSON.parse(readFileSync(join(VELOPARK, 'tools', 'reference', 'track.json'), 'utf-8')) as {
      layouts?: Record<string, unknown>;
      trees?: unknown[];
    };
    // (the floor, its rumbles, the paint, the objects, the trees, each layout's own, the gantries' (each working or
    // still); nothing else)
    const gantryModels = [...new Set(Object.values(made.gantries).flat())].map((g) => `${g}.glb`);
    expect([...made.models].sort()).toEqual(
      [
        ...['', '_kerbs', '_lines', '_objects', '_trees'].map((x) => `${MODEL}${x}.glb`),
        ...Object.keys(track.layouts ?? {}).map((l) => `${l}.glb`),
        ...gantryModels,
      ].sort(),
    );
    // (each layout with at most one gantry working, at its start, its others still: the working one's lamps AC's start
    // lights and its flag lamp the screen's, a still one's lit by none)
    expect(gantryModels.length).toBeGreaterThan(0);
    // (the Velopark's: the 1000's over the vp_1000's line, the 1500's over the line of the 1500s and the 2500; none by
    // the kids' line, both still there, as the old models had them)
    const working = (lay: string) => (made.gantries[lay] ?? []).filter((g) => !g.endsWith('_still'));
    expect(working('vp_1000')).toEqual([`${MODEL}_gantry_1000`]);
    for (const lay of [
      'vp_1500',
      'vp_1500_amateur',
      'vp_1500_hotlap',
      'vp_1500_short',
      'vp_1500_short_amateur',
      'vp_2500',
    ])
      expect(working(lay), lay).toEqual([`${MODEL}_gantry_1500`]);
    expect(working('vp_kids')).toEqual([]);
    expect(made.gantries.vp_kids?.length).toBe(2);
    for (const [lay, list] of Object.entries(made.gantries)) {
      expect(list.filter((g) => !g.endsWith('_still')).length, lay).toBeLessThanOrEqual(1);
      for (const g of list) {
        const names = nodeNames(join(out, `${g}.glb`));
        const still = g.endsWith('_still');
        expect(names.filter((n) => /^KS_START_LIGHT_\d$/.test(n)).length, g).toBe(still ? 0 : 5);
        expect(names.filter((n) => /^NO_START_LIGHT_\d$/.test(n)).length, g).toBe(still ? 5 : 0);
        expect(names.includes(still ? 'STATIC_FLAG' : 'GANTRY_FLAG'), g).toBe(true);
        expect(names.includes('GANTRY_BOARD'), g).toBe(true);
      }
    }
    writeFileSync(join(OUT, 'trackbuild-gantries.json'), JSON.stringify(made.gantries, null, 1));
    expect(
      readdirSync(out)
        .filter((f) => f.endsWith('.glb'))
        .sort(),
    ).toEqual([...made.models].sort());
    const planted = Object.values(made.trees?.count ?? {}).reduce((a, b) => a + b, 0);
    expect([planted + (made.trees?.cleared ?? 0), made.trees?.offFloor ?? 0]).toEqual([track.trees?.length ?? 0, 0]);
    expect(Object.keys(made.objects).length).toBeGreaterThan(0);
  }, 3_600_000);
});
