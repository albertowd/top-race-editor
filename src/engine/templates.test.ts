// @vitest-environment node
// The catalogue read from the editor's models alone (models/catalogue.json, each model's .glb beside it), nothing of
// the track's folder; a library's model's parts as its file keeps them; and the editor's own catalogue whole: every
// model's file there, each read as it says.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_KINDS } from '../editing/objects';
import { GENERATOR, type GltfDoc, writeGlb } from './gltf';
import type { HostFiles } from './placehost';
import { type CatalogueSource, catalogue, editorModelsOf, loadTemplate, pageCatalogue, scriptsOf } from './templates';

const ED = '/ed/models';
const TRACK = '/track';
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

/** A glb of meshes (eleven numbers a point, three corners a face), each a node of its name; a node moved by `at`. */
function glbOf(parts: { name: string; material: string; V: number[]; F: number[]; at?: number[] }[]): Uint8Array {
  const chunks: number[] = [];
  const views: NonNullable<GltfDoc['bufferViews']> = [];
  const accessors: NonNullable<GltfDoc['accessors']> = [];
  const add = (values: number[], componentType: number, type: string, count: number) => {
    const b = componentType === 5126 ? new Float32Array(values) : new Uint16Array(values);
    const bytes = [...new Uint8Array(b.buffer)];
    while (bytes.length % 4) bytes.push(0);
    views.push({ buffer: 0, byteOffset: chunks.length, byteLength: b.byteLength });
    chunks.push(...bytes);
    accessors.push({ bufferView: views.length - 1, componentType, count, type });
    return accessors.length - 1;
  };
  const cols = (V: number[], a: number, b: number, w?: number) =>
    Array.from({ length: V.length / 11 }, (_, i) => [
      ...V.slice(i * 11 + a, i * 11 + b),
      ...(w === undefined ? [] : [w]),
    ]).flat();
  const materials = [...new Set(parts.map((p) => p.material))];
  const doc: GltfDoc = {
    asset: { version: '2.0', generator: GENERATOR },
    scene: 0,
    scenes: [{ nodes: parts.map((_, i) => i) }],
    nodes: parts.map((p, i) => ({ name: p.name, mesh: i, ...(p.at ? { translation: p.at } : {}) })),
    meshes: parts.map((p) => {
      const n = p.V.length / 11;
      return {
        primitives: [
          {
            attributes: {
              POSITION: add(cols(p.V, 0, 3), 5126, 'VEC3', n),
              NORMAL: add(cols(p.V, 3, 6), 5126, 'VEC3', n),
              TEXCOORD_0: add(cols(p.V, 6, 8), 5126, 'VEC2', n),
              TANGENT: add(cols(p.V, 8, 11, 1), 5126, 'VEC4', n),
            },
            indices: add(p.F, 5123, 'SCALAR', p.F.length),
            material: materials.indexOf(p.material),
          },
        ],
      };
    }),
    materials: materials.map((name) => ({ name })),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: chunks.length }],
  };
  return writeGlb(doc, Uint8Array.from(chunks));
}

/** a corner: x y z, normal up, u v, tangent along x */
const pt = (x: number, y: number, z: number, u = 0, v = 0) => [x, y, z, 0, 1, 0, u, v, 1, 0, 0];
const BOARD = [...pt(-0.3, 0, 0, 0, 0), ...pt(0.3, 0, 0, 1, 0), ...pt(0, 0.6, 0.1, 0.5, 1)];
const HULL = [...pt(-0.3, 0, -0.05), ...pt(0.3, 0, -0.05), ...pt(0, 0.65, 0.07)];

const disk: Record<string, Uint8Array> = {
  [`${ED}/catalogue.json`]: enc({
    models: [
      {
        id: 'board',
        file: 'board.glb',
        kind: 'boards',
        label: 'Marker board',
        materials: 'library',
        size: [0.6, 0.65, 0.13],
        fits: ['place'],
        hull: 'hull',
      },
      { id: 'pole', file: 'pole.glb', kind: 'poles', materials: 'library', size: [2, 17, 1], collision: ['none'] },
      {
        id: 'gantry',
        file: 'gantry.glb',
        kind: 'gantries',
        label: 'Start gantry',
        materials: 'own',
        size: [19, 5, 2.6],
      },
    ],
  }),
  [`${ED}/board.glb`]: glbOf([
    { name: 'board', material: 'MarkerBoards', V: BOARD, F: [0, 1, 2] },
    { name: 'hull', material: 'MarkerBoards', V: HULL, F: [0, 1, 2], at: [0, 0, 1] },
  ]),
  // (the track's own templates, as tracks had them: not read)
  [`${TRACK}/tools/reference/templates/models.json`]: enc({ shed: { file: 'shed.npz', size: [1, 1, 1] } }),
};
const asked: string[] = [];
const files: HostFiles = {
  read: async (p) => {
    asked.push(p);
    const b = disk[p];
    if (!b) throw new Error(`no ${p}`);
    return b;
  },
  exists: async (p) => {
    asked.push(p);
    return p in disk;
  },
  list: async () => [],
  size: async (p) => disk[p]?.length ?? 0,
  write: async () => {},
};
const src: CatalogueSource = { read: files.read, exists: files.exists, editorModels: ED };

describe('the catalogue', () => {
  it('is the editor’s alone: its catalogue’s models, by id', async () => {
    asked.length = 0;
    const cat = await catalogue(src);
    expect(Object.keys(cat)).toEqual(['board', 'pole', 'gantry']);
    expect(cat.board).toMatchObject({ file: 'board.glb', label: 'Marker board', hull: 'hull', materials: 'library' });
    expect(cat.gantry).toMatchObject({ kind: 'gantries', materials: 'own' });
    expect(asked.every((p) => p.startsWith(`${ED}/`))).toBe(true);
    // (none: an empty one)
    expect(await catalogue({ ...src, editorModels: '/nowhere' })).toEqual({});
  });

  it('is the page’s too: an outline only of a track’s model', async () => {
    asked.length = 0;
    const page = await pageCatalogue(files, ED);
    expect(Object.keys(page)).toEqual(['board', 'pole', 'gantry']);
    expect(page.gantry).toEqual({
      id: 'gantry',
      file: 'gantry.glb',
      kind: 'gantries',
      label: 'Start gantry',
      materials: 'own',
      size: [19, 5, 2.6],
    });
    expect(Object.values(page).some((m) => m.outline)).toBe(false);
    expect(asked.some((p) => p.startsWith(TRACK))).toBe(false);
  });

  it('reads a library’s model’s parts as its file keeps them: each node’s name, its material’s, moved as it is', async () => {
    const cat = await catalogue(src);
    const parts = await loadTemplate(src, cat.board as NonNullable<(typeof cat)['board']>);
    expect(parts.map((p) => [p.part, p.material])).toEqual([
      ['board', 'MarkerBoards'],
      ['hull', 'MarkerBoards'],
    ]);
    // (its numbers as kept, 32-bit floats; the hull's node moved 1 m forward)
    expect([...(parts[0]?.V ?? [])]).toEqual([...Float32Array.from(BOARD)]);
    expect([...(parts[0]?.F ?? [])]).toEqual([0, 1, 2]);
    expect(parts[1]?.V[2]).toBeCloseTo(0.95, 6);
    expect(parts[1]?.V[8]).toBe(1);
    expect(parts.every((p) => p.from === undefined && p.seen === undefined)).toBe(true);
  });

  it('has its folders in the editor’s models', () => {
    expect(editorModelsOf('/p/kart')).toBe('/p/kart/../top-race-editor/models');
    expect(editorModelsOf('/p/kart', ED)).toBe(ED);
    expect(scriptsOf(ED)).toBe(`${ED}/scripts`);
  });
});

const MODELS = join(__dirname, '..', '..', 'models').split('\\').join('/');
const PICTURES = join(__dirname, '..', '..', 'public', 'models');

describe('the editor’s catalogue', () => {
  const doc = JSON.parse(readFileSync(`${MODELS}/catalogue.json`, 'utf-8')) as {
    models: { id: string; file: string; kind: string; materials: string; hull?: string; top?: number }[];
  };
  const disk: CatalogueSource = {
    read: async (p) => new Uint8Array(readFileSync(p)),
    exists: async (p) => existsSync(p),
    editorModels: MODELS,
  };

  it('has each model once, its file beside it and its pictures, of a kind the editor places', () => {
    const ids = doc.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of doc.models) {
      expect(existsSync(`${MODELS}/${m.file}`), m.id).toBe(true);
      expect(m.file, m.id).toBe(`${m.id}.glb`);
      expect(['own', 'library', 'track'], m.id).toContain(m.materials);
      expect(MODEL_KINDS as readonly string[], m.id).toContain(m.kind);
      expect(m.top, m.id).toBeGreaterThan(0);
      for (const f of [`${m.id}.png`, `${m.id}.top.png`]) expect(existsSync(join(PICTURES, f)), f).toBe(true);
    }
  });

  it('reads every model but the track’s own (their textures the track’s), its hull where it says', async () => {
    const cat = await catalogue(disk);
    for (const m of doc.models.filter((x) => x.materials !== 'track')) {
      const parts = await loadTemplate(disk, cat[m.id] as NonNullable<(typeof cat)[string]>);
      expect(parts.length, m.id).toBeGreaterThan(0);
      expect(
        parts.some((p) => p.part === 'hull'),
        m.id,
      ).toBe(m.hull === 'hull');
    }
  }, 60_000);
});
