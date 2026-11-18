// @vitest-environment node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { EngineChannel } from '../api/engineport';
import { FIXTURES, greyOfPng } from '../test/made-up';
import { answer, type PortLike } from './host';
import { localFiller } from './merge';
import type { HostFiles, PlaceHost } from './placehost';
import type { RoadsMerged } from './roadshost';
import { Triangle } from './triangle';

const env = { version: 'test', processors: () => 8, freeMemory: () => 3e9, totalMemory: () => 16e9 };

describe('the engine over a message port', () => {
  it('answers the page’s calls, and says when it has no such call', async () => {
    const { port1, port2 } = new MessageChannel();
    answer(port1 as unknown as PortLike, env);
    const ch = new EngineChannel();
    expect(ch.connected).toBe(false);
    await expect(ch.info()).rejects.toThrow('no engine window');
    ch.connect(port2 as unknown as PortLike);
    try {
      expect(await ch.info()).toEqual({ version: 'test', processors: 8, memory: { free: 3e9, total: 16e9 } });
      await expect(ch.call('build')).rejects.toThrow('the engine has no build');
    } finally {
      port1.close();
      port2.close();
    }
  });
});

// ---- the roads merged, on the fixtures' terrain and roads -----------------------------------------------------------

const EDITOR = fileURLToPath(new URL('../..', import.meta.url));

/** The disk as Node has it, and the fixture's pictures made grey. */
function nodePlaceHost(): PlaceHost {
  const files: HostFiles = {
    read: async (p) => new Uint8Array(readFileSync(p)),
    list: async (d) => readdirSync(d),
    size: async (p) => statSync(p).size,
    exists: async (p) => existsSync(p),
    write: async () => {},
  };
  return { files, cacheDir: mkdtempSync(join(tmpdir(), 'host-cache-')), decodeGrey: greyOfPng };
}

describe('the page’s calls answered by the engine', () => {
  it('keeps the track open, opens another (remembered first among those opened before)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'tracks-')).replace(/\\/g, '/');
    for (const t of ['one', 'two']) {
      mkdirSync(join(base, t, 'tools', 'reference'), { recursive: true });
      writeFileSync(join(base, t, 'tools', 'reference', 'track.json'), JSON.stringify({ name: `Track ${t}` }));
    }
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
    let open: string | null = `${base}/one`;
    const recent = `${base}/app/recent.json`;
    const { port1, port2 } = new MessageChannel();
    answer(port1 as unknown as PortLike, {
      ...env,
      place: {
        files,
        cacheDir: `${base}/cache`,
        decodeGrey: async () => ({ rows: 0, cols: 0, data: new Uint8Array(0) }),
      },
      apiHost: { recent },
      project: {
        get: () => open,
        set: (f) => {
          open = f;
        },
      },
    });
    const ch = new EngineChannel();
    ch.connect(port2 as unknown as PortLike);
    try {
      expect(await ch.project()).toBe(`${base}/one`);
      // (a call of no folder: the track open's)
      const t = (await ch.call('api', { folder: '', path: '/api/track' })) as { name: string };
      expect(t.name).toBe('Track one');
      await expect(ch.call('api', { folder: '', path: '/api/open', body: { folder: 'two' } })).rejects.toThrow(
        'a track is opened by its whole folder',
      );
      await expect(ch.call('api', { folder: '', path: '/api/open', body: { folder: `${base}/none` } })).rejects.toThrow(
        'has no track file',
      );
      const got = await ch.call('api', {
        folder: '',
        path: '/api/open',
        body: { folder: `${base.replace(/\//g, '\\')}\\two\\` },
      });
      expect(got).toEqual({ ok: true, name: 'Track two', folder: `${base}/two` });
      expect([open, await ch.project()]).toEqual([`${base}/two`, `${base}/two`]);
      expect(JSON.parse(readFileSync(recent, 'utf-8'))).toEqual([`${base}/two`]);
      await ch.call('api', { folder: '', path: '/api/open', body: { folder: `${base}/one` } });
      expect(JSON.parse(readFileSync(recent, 'utf-8'))).toEqual([`${base}/one`, `${base}/two`]);
      const tracks = (await ch.call('api', { folder: '', path: '/api/tracks' })) as {
        tracks: { name: string; open: boolean }[];
      };
      expect(tracks.tracks.map((x) => [x.name, x.open])).toEqual([
        ['Track one', true],
        ['Track two', false],
      ]);
    } finally {
      port1.close();
      port2.close();
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('reads a track’s roads for the page and writes the page’s back, the file before kept', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'track-'));
    mkdirSync(join(dir, 'tools', 'reference'), { recursive: true });
    copyFileSync(join(FIXTURES, 'roads.json'), join(dir, 'tools', 'reference', 'roads.json'));
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
    const { port1, port2 } = new MessageChannel();
    const tri = await Triangle.load(
      new Uint8Array(readFileSync(join(EDITOR, 'node_modules/triangle-wasm/triangle.out.wasm'))),
    );
    answer(port1 as unknown as PortLike, {
      ...env,
      place: { files, cacheDir: dir, decodeGrey: async () => ({ rows: 0, cols: 0, data: new Uint8Array(0) }) },
      filler: localFiller(tri),
    });
    const ch = new EngineChannel();
    ch.connect(port2 as unknown as PortLike);
    try {
      const got = (await ch.call('api', { folder: dir, path: '/api/roads' })) as {
        roads: { name: string; shape: string; heights?: unknown }[];
        folder: string;
        tile: number;
      };
      expect(got.roads.map((r) => r.name)).toEqual(['A', 'B', 'R']);
      expect(got.roads.every((r) => r.shape && !r.heights)).toBe(true);
      expect([got.folder, got.tile]).toEqual([dir, 512]);
      // (saved: A as it was, its heights kept; the one before kept)
      const before = readFileSync(join(dir, 'tools', 'reference', 'roads.json'), 'utf-8');
      const saved = (await ch.call('api', {
        folder: dir,
        path: '/api/save',
        body: { roads: got.roads.map((r) => ({ ...r, was: r.name })), deleted: [] },
      })) as { changed: string[] };
      expect(saved.changed).toEqual([]);
      // (the same roads, A's recorded heights kept), written into the track file (TRACK_FORMAT's step 7), the roads'
      // own file as it was
      const after = JSON.parse(readFileSync(join(dir, 'tools', 'reference', 'track.json'), 'utf-8')) as {
        version: number;
        roads: { name: string; heights?: unknown }[];
      };
      const was = JSON.parse(before) as { roads: { name: string; heights?: unknown }[] };
      expect(after.version).toBe(1);
      expect(after.roads.map((r) => r.name)).toEqual(was.roads.map((r) => r.name));
      expect(after.roads[0]?.heights).toEqual(was.roads[0]?.heights);
      expect(readFileSync(join(dir, 'tools', 'reference', 'roads.json'), 'utf-8')).toBe(before);
      // (no track file before: none kept)
      expect(existsSync(join(dir, 'build', 'cache', 'roads_backup'))).toBe(false);
      // (a track with no models: no road meshes to bring in)
      expect(await ch.call('api', { folder: dir, path: '/api/meshes' })).toEqual({ meshes: [] });
      // (a track with no terrain: said so; a call needing what this host has not, or one there is none of: said so)
      expect(await ch.call('api', { folder: dir, path: '/api/terrain' })).toEqual({
        exists: false,
        reason: 'no terrain yet (tools/reference/terrain/terrain.json)',
      });
      await expect(ch.call('api', { folder: dir, path: '/api/wizard' })).rejects.toThrow(
        'the engine has no new-track wizard here',
      );
      await expect(ch.call('api', { folder: dir, path: '/api/nothing' })).rejects.toThrow(
        'the engine has no call GET /api/nothing',
      );
      // (the looks at the roads as built: each road's mesh, cut under those above it; the surface over them, proved)
      const roads = got.roads;
      const cuts: string[][] = [];
      for (const road of roads) {
        const m = (await ch.call('api', { folder: dir, path: '/api/mesh', body: { road, roads } })) as {
          P: number[];
          F: number[];
          under: string[];
          wrong: { down: number[]; thin: number[] };
        };
        expect(m.F.length).toBeGreaterThan(0);
        expect(Math.max(...m.F)).toBeLessThan(m.P.length / 2);
        expect(m.wrong.down).toEqual([]);
        cuts.push(m.under);
      }
      expect(cuts.some((u) => u.length)).toBe(true);
      const surface = (await ch.call('api', {
        folder: dir,
        path: '/api/surface',
        body: { roads, window: [-30, -30, 30, 30] },
      })) as { regions: { kind: string }[]; issues: unknown[] };
      expect(surface.issues).toEqual([]);
      expect(surface.regions.map((r) => r.kind)).toContain('ground');
      // (a road given by points, its curve fitted)
      const fit = (await ch.call('api', {
        folder: dir,
        path: '/api/fit',
        body: {
          road: {
            name: 'P',
            points: [
              [0, 0, 2, 2],
              [10, 0, 2, 2],
              [20, 5, 2, 2],
            ],
          },
        },
      })) as { curve: { p: number[] }[] };
      expect(fit.curve.length).toBeGreaterThanOrEqual(2);
    } finally {
      port1.close();
      port2.close();
    }
  });
});

describe('the roads merged by the engine', () => {
  it('merges a track’s roads with its ground, proved, and again only what changed', { timeout: 60_000 }, async () => {
    const { port1, port2 } = new MessageChannel();
    const tri = await Triangle.load(
      new Uint8Array(readFileSync(join(EDITOR, 'node_modules/triangle-wasm/triangle.out.wasm'))),
    );
    answer(port1 as unknown as PortLike, { ...env, place: nodePlaceHost(), filler: localFiller(tri) });
    const ch = new EngineChannel();
    ch.connect(port2 as unknown as PortLike);
    const params = {
      project: join(FIXTURES, 'terrain'),
      roads: join(FIXTURES, 'roads.json'),
      check: true,
    };
    try {
      const first = (await ch.call('roads.merge', params)) as RoadsMerged;
      expect(first.problems, JSON.stringify(first.first)).toBe(0);
      expect(first.regions.map((r) => r.name)).toContain('ground');
      expect(first.regions.length).toBeGreaterThan(2);
      expect(first.kept).toBe(0);
      // (its rumbles merged first, its lines laid)
      expect(first.regions.map((r) => r.name)).toContain('1ROAD_KERB_E_A_0');
      expect(first.paint.lines).toBe(4);
      expect(first.paint.faces).toBeGreaterThan(100);
      const again = (await ch.call('roads.merge', params)) as RoadsMerged;
      expect([again.filled, again.kept]).toEqual([0, first.filled]);
      expect(again.regions).toEqual(first.regions);
    } finally {
      port1.close();
      port2.close();
    }
  });
});
