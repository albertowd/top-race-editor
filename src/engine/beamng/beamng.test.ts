// @vitest-environment node
// The BeamNG level's parts: a shape as BeamNG's own are laid out (its details, its collision meshes); a PNG read back
// as written; a start's rotation (BeamNG's quaternion: its y the way given); two layouts on one road one road of the
// network, parting where they part; a model's meshes read with what they are (role, ground, draw) where they stand; the
// level's Lua (the editor's) under the level's own names, none of another track's left in it; a gantry's board showing
// first a layout it works in; a start's map's roads as the picture's runs of pixels, however fine the floor.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPng } from '../dds';
import { toGltf, writeGlb } from '../gltf';
import type { Kn5 } from '../kn5tree';
import { boardConfig, type gantry } from './board';
import { writeDae } from './dae';
import { writePng } from './images';
import { extensionFolder, levelModels, levelScripts, roadCover } from './level';
import { roadNetwork } from './network';
import { quat, type V3 } from './races';
import { groundOf, trackModel } from './trackmodel';

const tri = {
  name: 'ROAD_3',
  material: 'tsvp_tarmac',
  P: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  N: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  U: [0, 0, 1, 0, 0, 1],
  F: [0, 1, 2],
};

describe("the BeamNG level's parts", () => {
  it('writes a shape as BeamNG lays its own out: its detail, its collision', () => {
    const solid = writeDae([tri], { collide: true });
    expect(solid).toContain('<node id="detail2" name="detail2"/>');
    expect(solid).toContain('<node id="collision-1" name="collision-1"/>');
    // (a name ending in a number makes no detail of its own: its mesh named with its detail)
    expect(solid).toContain('name="ROAD_3_0_L2"');
    expect(solid).toContain('name="Colmesh_0-1"');
    const seen = writeDae([tri], { sizes: [7] });
    expect(seen).toContain('detail7');
    expect(seen).not.toContain('Colmesh');
  });

  it('writes a PNG read back as it was', async () => {
    const px = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
    const back = await readPng(await writePng(px, 2, 2, 3));
    expect([back.width, back.height, back.mode]).toEqual([2, 2, 'RGB']);
    expect([...back.data]).toEqual([...px]);
  });

  it("turns a start BeamNG's way: facing north, no turn; east, a quarter turn", () => {
    expect(quat([0, 1, 0]).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 0, 1]);
    const q = quat([1, 0, 0]);
    expect(Math.abs(q[2] as number)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('lays two layouts sharing a road on one road of the network, parting where they part', () => {
    // (a 100 m square lap, and a lap on the same west, south and north sides that cuts across at x 60)
    const lap = (east: number): V3[] => {
      const out: V3[] = [];
      for (let x = 0; x < east; x += 1) out.push([x, 0, 0]);
      for (let y = 0; y < 50; y += 1) out.push([east, y, 0]);
      for (let x = east; x > 0; x -= 1) out.push([x, 50, 0]);
      for (let y = 50; y > 0; y -= 1) out.push([0, y, 0]);
      return out;
    };
    const net = roadNetwork({ long: { line: lap(100), sides: null }, short: { line: lap(60), sides: null } });
    const long = net.laps.long ?? [];
    const short = net.laps.short ?? [];
    const shared = short.filter((w) => long.includes(w));
    // (most of the short lap on the long one's waypoints: its own only where it cuts across)
    expect(shared.length).toBeGreaterThan(short.length * 0.6);
    expect(Object.keys(net.segments).filter((k) => k.startsWith('road_')).length).toBeGreaterThan(1);
  });

  it("reads a model's meshes with what they are, where they stand", () => {
    const k: Kn5 = {
      version: 6,
      extra: 0,
      textures: [],
      materials: [
        { name: 'Tarmac', shader: 'ksPerPixel', blend: 0, alpha_tested: 0, depth_mode: 0, props: [], textures: [] },
      ],
      root: {
        kind: 1,
        name: 'root',
        active: 1,
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 5, 1],
        children: [
          {
            kind: 2,
            name: '1ROAD_7',
            active: 1,
            children: [],
            verts: Float32Array.from([
              0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0,
            ]),
            faces: Uint16Array.from([0, 2, 1]),
            material: 0,
            cast_shadows: 1,
            visible: 1,
            transparent: 0,
            layer: 0,
            lod_in: 0,
            lod_out: 0,
            sphere: [0, 0, 0, 1],
            renderable: 1,
          },
        ],
      },
    };
    const { doc, bin } = toGltf(k, () => null);
    // (what the track's tools write of it: its role and ground)
    const node = doc.nodes?.find((n) => n.name === '1ROAD_7');
    if (node) node.extras = { ...(node.extras ?? {}), track: { role: 'surface', surface: 'asphalt', draw: [0, 45] } };
    const [m] = trackModel(writeGlb(doc, bin));
    expect(m?.name).toBe('1ROAD_7');
    expect(m?.draw).toEqual([0, 45]);
    expect(groundOf(m as NonNullable<typeof m>, {})).toBe('asphalt');
    // (where it stands: moved by its parent's matrix)
    expect([m?.v[0], m?.v[2]]).toEqual([10, 5]);
  });

  it('makes one map of every layout: each model once, a gantry working where any layout has it so', () => {
    const { stems, shared, ownOf } = levelModels(
      {
        long: ['ground', 'long', 'gantry_a', 'gantry_b_still'],
        short: ['ground', 'short', 'gantry_a', 'gantry_b_still'],
        other: ['ground', 'other', 'lines', 'gantry_a_still', 'gantry_b'],
        kids: ['ground', 'gantry_a_still', 'gantry_b_still'],
      },
      'long',
    );
    expect(stems).toEqual(['ground', 'long', 'gantry_a', 'other', 'lines', 'gantry_b', 'short']);
    expect(shared).toEqual(['ground', 'gantry_a', 'gantry_b']);
    // (the rest spawned by each layout's own races)
    expect([ownOf('long'), ownOf('other'), ownOf('kids')]).toEqual([['long'], ['other', 'lines'], []]);
  });

  it('writes the editor’s Lua under the level’s own names', () => {
    const at = new URL('../../../models/scripts/beamng/', import.meta.url);
    const scripts = {
      board: readFileSync(new URL('board.lua', at), 'utf-8'),
      modScript: readFileSync(new URL('modScript.lua', at), 'utf-8'),
    };
    expect(extensionFolder('some_kart_track')).toBe('someKartTrack');
    const made = levelScripts(scripts, 'some_kart_track', 'Some Kart Track');
    expect(Object.keys(made).sort()).toEqual([
      'lua/ge/extensions/someKartTrack/board.lua',
      'scripts/some_kart_track/modScript.lua',
    ]);
    const board = made['lua/ge/extensions/someKartTrack/board.lua'] as string;
    const mod = made['scripts/some_kart_track/modScript.lua'] as string;
    expect(board).toContain("local LEVEL = 'some_kart_track'");
    expect(board).toContain("local logTag = 'someKartTrack_board'");
    expect(board).toContain('Some Kart Track');
    expect(mod).toContain('extensions.load("someKartTrack_board")');
    expect(mod).toContain('setExtensionUnloadMode("someKartTrack_board", "manual")');
    // (nothing of the track they were written for, nothing left to fill)
    for (const text of [board, mod]) expect(text).not.toMatch(/velopark|techspeed|fueltech|\{\{/i);
  });

  it("draws a start's map's roads as runs of its pixels, however many triangles the floor is", () => {
    // (a 100 m square of road made of 80 000 triangles, and a road 10 m wide beside it of two)
    const T: number[] = [];
    const n = 200;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const [x, y, d] = [(i * 100) / n, (j * 100) / n, 100 / n];
        T.push(x, y, x + d, y, x + d, y + d, x, y, x + d, y + d, x, y + d);
      }
    T.push(150, 0, 160, 0, 160, 100, 150, 0, 160, 100, 150, 100);
    const frame: [[number, number], [number, number]] = [
      [0, 0],
      [160, 100],
    ];
    const cover = roadCover(T, frame, 160);
    // (a metre a cell: each of the 100 rows two runs, the square's and the road's)
    expect(cover.length / 12).toBe(200);
    const runs = Array.from({ length: cover.length / 12 }, (_, r) => [cover[r * 12], cover[r * 12 + 2]]);
    expect(runs.filter(([a, b]) => a === -0.5 && b === 100.5)).toHaveLength(100);
    expect(runs.filter(([a, b]) => a === 149.5 && b === 160.5)).toHaveLength(100);
    // (the square's own whole: every corner of it in its runs)
    expect([Math.min(...cover), Math.max(...cover)]).toEqual([-0.5, 160.5]);
  });

  it('shows on a gantry’s board first a layout it works in', () => {
    const g = (name: string) =>
      ({ name, centre: [0, 0, 0], lamps: [], flags: [], faces: [], layouts: [], default: null }) as ReturnType<
        typeof gantry
      >;
    const doc = JSON.parse(
      boardConfig([g('track_gantry_a'), g('track_gantry_b')], { a: [5, 0, 0], b: [10, 0, 0], far: [500, 0, 0] }, (m) =>
        m === 'track_gantry_b' ? ['b'] : [],
      ),
    ) as { gantries: { name: string; layouts: string[]; default: string | null }[] };
    expect(doc.gantries.map((x) => [x.layouts, x.default])).toEqual([
      [['a', 'b'], 'a'],
      [['a', 'b'], 'b'],
    ]);
  });
});
