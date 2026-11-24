import { EngineClient, type LocalEngine } from '../api/client';
import type { MeshResponse, RoadMesh, RoadsResponse, SaveResponse, SurfaceResponse } from '../api/types';
import type { CurveNode, Road, TrackObjects, Vec2 } from '../domain/types';
import type { BumpsJson } from '../editing/bumps';
import type { TreePlacement } from '../editing/trees';
import { createEditor } from '../store/editor';
import type { Dialogs } from '../ui/dialogs';

/** A straight node-to-node piece's nodes, handles a third of the way. */
export function straightCurve(from: Vec2, to: Vec2, width = 4): CurveNode[] {
  const d: Vec2 = [(to[0] - from[0]) / 3, (to[1] - from[1]) / 3];
  return [
    { p: from, in: [0, 0], out: d, left: width, right: width },
    { p: to, in: [-d[0], -d[1]], out: [0, 0], left: width, right: width },
  ];
}

export function road(name: string, from: Vec2, to: Vec2, extra: Partial<Road> = {}): Road {
  return {
    name,
    material: 'Tarmac Dark',
    curve: straightCurve(from, to, extra.curve?.[0]?.left ?? 4),
    lines: [],
    kerbs: [],
    ...extra,
  };
}

/** Three roads: A along x from 0 to 100, B going on from A's end to x 200, C crossing A at x 50. */
export function threeRoads(): Road[] {
  return [road('A', [0, 0], [100, 0]), road('B', [100, 0], [200, 0]), road('C', [50, -50], [50, 50])];
}

/** Two layouts sharing a grid; the objects in both (a tyre wall, a pole, a cone, a board, a tree and a kart). */
export function someObjects(): TrackObjects {
  const layout = () => ({
    grid: [
      { x: 10, z: 0, heading: Math.PI / 2 },
      { x: 4, z: 2, heading: Math.PI / 2 },
    ],
    pits: [{ x: 20, z: 10, heading: 0 }],
    hotlap: { x: 60, z: 0, heading: Math.PI / 2 },
    timing: [{ name: 'AC_TIME_0', left: { x: 30, z: 4 }, right: { x: 30, z: -4 } }],
  });
  const one = (x: number, z: number) => [
    { p: [x, z] as [number, number], in: [0, 0] as [number, number], out: [0, 0] as [number, number] },
  ];
  return {
    version: 3,
    layouts: { vp_a: layout(), vp_b: layout() },
    objects: [
      {
        name: 'TYRES_0',
        model: 'tyre_stack',
        curve: [
          { p: [0, -10], in: [0, 0], out: [1.4 / 3, 0] },
          { p: [1.4, -10], in: [-1.4 / 3, 0], out: [0, 0] },
        ],
        closed: false,
        spacing: 0.7,
        rows: 1,
        fit: 'place',
        collision: 'wall',
      },
      { name: 'POLE_0', model: 'light_pole', curve: one(0, 20), heading: 0, collision: 'none' },
      { name: 'CONE_0', model: 'cone', curve: one(40, 5), heading: 0, collision: 'dynamic' },
      { name: 'BOARD_100', model: 'board', curve: one(70, 6), heading: -Math.PI / 2, collision: 'dynamic' },
      { name: 'TREE_BROADLEAF_0', model: 'broad_1', curve: one(120, 30), heading: 0, collision: 'none' },
      { name: 'KART_0', model: 'kart', curve: one(130, -30), heading: Math.PI, collision: 'none' },
    ],
    marks: [
      {
        name: 'MARK_1',
        curve: [
          { p: [50, -2], in: [0, 0], out: [4 / 3, 0] },
          { p: [54, -2], in: [-4 / 3, 0], out: [0, 0] },
        ],
        width: 0.1,
        colour: 'white',
        style: 'solid',
      },
    ],
  };
}

export interface FakeEngine {
  client: EngineClient;
  calls: { path: string; body: unknown }[];
  roads: Road[];
  objects: TrackObjects | null;
  seeded: boolean;
  /** the track file's trees */
  trees: TreePlacement[];
  /** the track file's layouts: each its models */
  layouts: Record<string, { models: string[]; from?: string }>;
  meshes: RoadMesh[];
  /** the track's bumps (source/bumps.json) */
  bumps: BumpsJson;
  fail: Record<string, string>;
  /** the track's folder (another opened: that one's) */
  folder: string;
  /** answers held back till let go (a request kept waiting) */
  hold: Partial<Record<string, Promise<void>>>;
}

/** A value as it comes across the engine window's port: a copy of it. */
const copied = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** An engine answering from memory, keeping what it was asked. */
const buildJob = {
  id: 'build1',
  state: 'done',
  step: 'pack',
  steps: ['models', 'pack'],
  now: 'place_karts',
  log: ['terrain             0 s', 'models made in 3 s', 'packing test_track_ac.7z (7-Zip)'],
  error: '',
  archive: 'D:/tracks/test/build/dist/test_track_ac.7z',
  size: 12_300_000,
  install: false,
  seconds: 95,
};

export function fakeEngine(roads: Road[] = threeRoads()): FakeEngine {
  const fe: FakeEngine = {
    calls: [],
    roads,
    objects: someObjects(),
    seeded: false,
    trees: [],
    layouts: { vp_a: { models: ['track', 'vp_a'] }, vp_b: { models: ['track', 'vp_b'] } },
    meshes: [{ model: 'm.glb', name: '1ROAD_X', material: 'Pavers', area: 50, box: [0, 0, 10, 10] }],
    bumps: { version: 1, cell: 0.1, tile: 128, tiles: {} },
    fail: {},
    folder: 'D:/tracks/test',
    hold: {},
    client: undefined as unknown as EngineClient,
  };
  const answer = (path: string, body: Record<string, unknown> | undefined): unknown => {
    switch (path) {
      case '/api/roads':
        return {
          name: 'Test',
          span: 1000,
          px: 4000,
          tile: 512,
          materials: ['Tarmac Dark', 'Pavers'],
          roads: fe.roads,
        } satisfies RoadsResponse;
      case '/api/track':
        return { name: 'Test', folder: fe.folder, span: 1000, px: 4000, tile: 512, materials: ['Tarmac Dark'] };
      case '/api/tracks':
        return {
          open: { name: 'Test', folder: fe.folder },
          tracks: [
            { name: 'Test', folder: fe.folder, open: true },
            { name: 'Other Park', folder: 'D:/tracks/other', open: false },
          ],
        };
      case '/api/open':
        fe.folder = String(body?.folder);
        return { ok: true, name: 'Other Park', folder: fe.folder };
      case '/api/build': {
        const info = {
          available: true,
          why: '',
          track: 'test_track',
          archive: 'D:/tracks/test/build/dist/test_track_ac.7z',
          packer: '7-Zip',
          game: 'D:/ac/content/tracks',
          beamngMods: 'C:/Users/me/AppData/Local/BeamNG/BeamNG.drive/current/mods',
          locked: false,
          running: null,
          last: null,
          games: [
            {
              id: 'ac',
              label: 'Assetto Corsa',
              archive: 'D:/tracks/test/build/dist/test_track_ac.7z',
              available: true,
            },
            {
              id: 'beamng',
              label: 'BeamNG.drive',
              archive: 'D:/tracks/test/build/dist/test_track_beamng.zip',
              available: true,
              everyLayout: true,
            },
          ],
        };
        if (!body) return info;
        return { ...buildJob, state: 'running', step: 'models', now: 'terrain', install: !!body.install };
      }
      case '/api/build/job?id=build1':
        return buildJob;
      case '/api/build/cancel':
        return { ...buildJob, state: 'stopped' };
      case '/api/context':
        return { items: [{ name: 'X', kind: 'road', material: 'm', lines: [[0, 0, 1, 1]] }] };
      case '/api/drawings':
        return {};
      case '/api/objects':
        if (body) {
          fe.objects = body.objects as TrackObjects;
          fe.seeded = false;
          return { ok: true, objects: fe.objects };
        }
        return fe.objects ? { objects: fe.objects, seeded: fe.seeded } : null;
      case '/api/bumps':
        if (body) {
          fe.bumps = body.bumps as BumpsJson;
          return { ok: true, bumps: fe.bumps };
        }
        return fe.bumps;
      case '/api/layouts':
        if (body) {
          fe.layouts = body.layouts as FakeEngine['layouts'];
          return { ok: true, layouts: fe.layouts };
        }
        return { layouts: fe.layouts };
      case '/api/trees':
        if (body) {
          fe.trees = body.trees as TreePlacement[];
          return { ok: true, trees: fe.trees };
        }
        return { trees: fe.trees };
      case '/api/objects/catalogue':
        return {
          models: {
            light_pole: {
              label: 'Light pole',
              description: 'A light pole, 17 m high.',
              fits: ['place'],
              collision: ['none'],
              lights: [
                { series: 'Pole flood beams', at: [0, 16, 0.4], facing: [0, -0.8, 0.6] },
                { series: 'Pole spill', at: [0, 16, 0.4], facing: [0, -1, 0] },
              ],
            },
          },
          series: {
            'Pole flood beams': { colour: [1, 0.93, 0.82], strength: 1.69, range: 125, spot: 170 },
            'Pole spill': { colour: [1, 0.93, 0.82], strength: 0.29, range: 70, spot: 178 },
          },
        };
      case '/api/meshes':
        return { meshes: fe.meshes };
      case '/api/save': {
        const saved = ((body?.roads ?? []) as Road[]).map(({ moved: _m, was: _w, ...r }) => r);
        fe.roads = saved;
        return {
          ok: true,
          changed: ((body?.roads ?? []) as Road[]).filter((r) => r.moved).map((r) => r.name),
          roads: saved,
        } satisfies SaveResponse;
      }
      case '/api/mesh':
        return { P: [0, 0, 1, 0, 0, 1], F: [0, 1, 2], under: [] } satisfies MeshResponse;
      case '/api/surface':
        return {
          regions: [{ name: 'A', kind: 'road', P: [0, 0, 1, 0, 0, 1], F: [0, 1, 2] }],
          issues: [['gap', 1, 2, 0.1]],
          window: body?.window,
          seconds: 0.1,
        } as SurfaceResponse;
      case '/api/bring':
        return {
          roads: [road(String(body?.name), [0, 10], [30, 10], { lines: undefined, kerbs: undefined })],
          how: 'strip',
        };
      default:
        return null;
    }
  };
  // (the engine window as the page's client asks it: each call by its path, on the track it has open)
  const local: LocalEngine = {
    connected: true,
    project: async () => fe.folder,
    call: async <T>(_method: string, params?: unknown): Promise<T> => {
      const asked = params as { path: string; body?: Record<string, unknown> };
      const path = asked.path;
      const body = copied(asked.body);
      fe.calls.push({ path, body });
      await fe.hold[path];
      if (fe.fail[path]) throw new Error(fe.fail[path]);
      const out = answer(path, body);
      if (out === null) throw new Error('not found');
      return copied(out) as T;
    },
  };
  fe.client = new EngineClient(local);
  return fe;
}

export function fakeDialogs(answers: { confirm?: boolean } = {}): Dialogs & {
  alerts: string[];
} {
  const alerts: string[] = [];
  return {
    alerts,
    alert: (m) => {
      alerts.push(m);
    },
    confirm: () => answers.confirm ?? true,
  };
}

/** An editor on a fake engine, loaded. */
export async function loadedEditor(roads: Road[] = threeRoads(), answers: Parameters<typeof fakeDialogs>[0] = {}) {
  const engine = fakeEngine(roads);
  const dialogs = fakeDialogs(answers);
  const ed = createEditor(engine.client, { dialogs, meshDelay: 0 });
  await ed.load();
  return { ed, engine, dialogs };
}
