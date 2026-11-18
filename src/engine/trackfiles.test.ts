// @vitest-environment node
// A track's files as the engine reads and writes them: JSON as Python's json writes it (pyjson), the roads store's
// merge of a page's edits, Python's round, the track's settings.
import {
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
import { describe, expect, it } from 'vitest';
import { imageWidth } from './api';
import { cleanObjects, isV2, loadObjects } from './objectsfile';
import type { HostFiles } from './placehost';
import { dumpPyJson, plain, pyFloat, readPyJson } from './pyjson';
import { fitCurve, mergeRoads, pyRound4, type Road, stamp } from './trackfiles';

describe('JSON as Python writes it', () => {
  it('writes numbers as Python’s repr does, and keeps those it read as they were written', () => {
    expect([1, 0.5, 1e-5, 1e-4, 1.5e16, 4, -0.001].map(pyFloat)).toEqual([
      '1.0',
      '0.5',
      '1e-05',
      '0.0001',
      '1.5e+16',
      '4.0',
      '-0.001',
    ]);
    const text = '{\n "a": 4.0,\n "b": [\n  1e-05,\n  2\n ],\n "c": "\\u00e9t\\u00e9",\n "d": {}\n}';
    expect(dumpPyJson(readPyJson(text), 1)).toBe(text);
    // (a value made here: a whole number as an integer, as the page's JSON reaches Python)
    expect(dumpPyJson({ x: 4, y: 0.25, z: 'été' })).toBe('{"x": 4, "y": 0.25, "z": "\\u00e9t\\u00e9"}');
  });
});

describe('the roads store', () => {
  it('keeps a road not moved as it was (its shape, its heights), the page’s rest; a moved one without them', () => {
    const old: Road[] = [
      { name: 'A', curve: [{ p: [0, 0] }], heights: { h: 1 }, points: [[1, 2, 3, 4]] },
      { name: 'B', curve: [{ p: [0, 0] }], heights: { h: 2 } },
      { name: 'C', curve: [] },
    ];
    const page: Road[] = [
      { name: 'A', curve: [{ p: [9, 9] }], material: 'Pavers', was: 'A', shape: 'x', fitted: true },
      { name: 'B2', curve: [{ p: [5, 5] }], was: 'B', moved: true },
    ];
    const [out, changed] = mergeRoads(old, page, ['C']);
    expect(changed).toEqual(['B2']);
    expect(JSON.stringify(plain(out as never))).toBe(
      JSON.stringify([
        { name: 'A', material: 'Pavers', curve: [{ p: [0, 0] }], points: [[1, 2, 3, 4]], heights: { h: 1 } },
        { name: 'B2', curve: [{ p: [5, 5] }], mesh: 'B' },
      ]),
    );
  });
});

describe('the rest of a track’s files', () => {
  it('rounds as Python’s round(x, 4): ties to the even', () => {
    expect([1.03125, 1.09375, 0.12344, -2.5000500001].map(pyRound4)).toEqual([1.0312, 1.0938, 0.1234, -2.5001]);
  });

  it('fits a road given by points a curve that keeps within FIT of it', () => {
    const points = Array.from({ length: 60 }, (_, i) => [i, 3 * Math.sin(i / 8), 2, 2]);
    const nodes = fitCurve({ name: 'P', points } as Road) as { p: number[]; left: number }[];
    expect(nodes.length).toBeGreaterThan(2);
    expect(nodes[0]?.p).toEqual([0, 0]);
    expect(nodes.at(-1)?.p).toEqual([59, pyRound4(3 * Math.sin(59 / 8))]);
    expect(nodes.every((n) => n.left === 2)).toBe(true);
  });

  it('reads a picture’s width from its header and stamps a backup as Python’s strftime', () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    new DataView(png.buffer).setUint32(16, 4096);
    expect(imageWidth(png)).toBe(4096);
    expect(stamp(new Date(2026, 10, 16, 9, 5, 7))).toBe('20261116-090507');
  });
});

describe('the objects store', () => {
  it('reads a track without the file from its models: each layout’s places, as the places file has them', async () => {
    const d = mkdtempSync(join(tmpdir(), 'objects-')).replace(/\\/g, '/');
    try {
      const files: HostFiles = {
        read: async (p) => new Uint8Array(readFileSync(p)),
        list: async (p) => readdirSync(p),
        size: async (p) => statSync(p).size,
        exists: async (p) => existsSync(p),
        write: async (p, b) => {
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, b);
        },
      };
      // (no models: no layouts)
      expect(await loadObjects(files, `${d}/objects.json`, `${d}/models`)).toEqual({
        objects: { version: 3, layouts: {}, objects: [], marks: [] },
        seeded: true,
        converted: false,
      });
      mkdirSync(`${d}/models`);
      writeFileSync(`${d}/models/vp_a.glb`, '');
      writeFileSync(`${d}/models/vp_b.glb`, '');
      writeFileSync(`${d}/models/other.glb`, '');
      const spots = [
        { name: 'START_1', x: 2, z: 0, heading: 1 },
        { name: 'START_0', x: 1.00049, z: 0, heading: 7 },
        { name: 'PIT_0', x: 3, z: 0, heading: 0 },
        { name: 'HOTLAP_START_0', x: 4, z: 0, heading: 0 },
        { name: 'TIME_0_L', x: 5, z: 1, heading: 0 },
        { name: 'TIME_0_R', x: 5, z: -1, heading: 0 },
        { name: 'TIME_1_L', x: 6, z: 1, heading: 0 },
      ];
      const objects = [
        { name: 'CONE_0', model: 'cone', x: 7, y: 0.6, z: 7, heading: 0 },
        { name: 'BOARD_100', model: 'board', x: 8, y: 0.6, z: 8, heading: 0.5 },
      ];
      writeFileSync(
        `${d}/models/places.json`,
        JSON.stringify({ version: 1, layouts: { vp_a: { spots, pits: 1, objects } } }),
      );
      const got = plain((await loadObjects(files, `${d}/objects.json`, `${d}/models`)).objects as never) as {
        layouts: Record<string, unknown>;
        objects: { name: string; model: string; layouts?: string[] }[];
      };
      expect(got.layouts).toEqual({
        vp_a: {
          grid: [
            { x: 1, z: 0, heading: 0.7168 },
            { x: 2, z: 0, heading: 1 },
          ],
          pits: [{ x: 3, z: 0, heading: 0 }],
          hotlap: { x: 4, z: 0, heading: 0 },
          timing: [{ name: 'AC_TIME_0', left: { x: 5, z: 1 }, right: { x: 5, z: -1 } }],
        },
        vp_b: { grid: [], pits: [], hotlap: null, timing: [] },
      });
      expect(got.objects.map((o) => [o.name, o.model, o.layouts])).toEqual([
        ['CONE_0', 'cone', ['vp_a']],
        ['BOARD_100', 'board', ['vp_a']],
      ]);
      // (a file there: read as it is, version 2 converted)
      writeFileSync(
        `${d}/objects.json`,
        JSON.stringify({ version: 2, layouts: {}, poles: [{ x: 1, z: 2, heading: 0 }] }),
      );
      const v2 = await loadObjects(files, `${d}/objects.json`, `${d}/models`);
      expect([
        v2.seeded,
        v2.converted,
        (plain(v2.objects as never) as { objects: { name: string }[] }).objects[0]?.name,
      ]).toEqual([false, true, 'POLE_0']);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('says what is wrong', () => {
    const one = (o: unknown) => () => cleanObjects({ version: 3, layouts: {}, objects: [o] });
    expect(one({ name: 'A', model: 'cone', curve: [] })).toThrow('objects[0].curve: no nodes');
    expect(one({ name: 'A', model: 'cone', curve: [{ p: [0, 0] }], collision: 'wall' })).toThrow(
      'objects[0].collision: none or static or dynamic or model for one',
    );
    expect(one({ name: 'A', model: 'cone', curve: [{ p: [0, 0] }], scale: [1, 0, 1] })).toThrow('scale: more than 0');
    expect(isV2({ version: 3, layouts: {}, objects: [] })).toBe(false);
    expect(isV2({ layouts: {}, poles: [] })).toBe(true);
  });
});
