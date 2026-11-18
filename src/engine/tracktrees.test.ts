// @vitest-environment node
// The trees laid and written (tracktrees.ts), on a made-up tree: turned, sized and stood on its foot (the lowest of the
// floor round its trunk); merged in squares of TREE_TILE metres by part, a run under MERGE_MAX points each; their
// trunks' walls unseen, sized across but not up; those on a solid object's ground, off the floor, or of no tree of the
// catalogue left out.
import { describe, expect, it } from 'vitest';
import type { Kn5, Kn5Mesh } from './kn5tree';
import type { LaidObject } from './laying';
import type { CatalogueModel, TemplatePart } from './templates';
import { MERGE_MAX } from './trackobjects';
import { TREE_TILE, writeTrees } from './tracktrees';

/** A part of one triangle: its points at P (x, y, z each), facing up. */
function part(name: string, material: string, P: number[][]): TemplatePart {
  const V = new Float64Array(P.length * 11);
  P.forEach((p, i) => {
    V.set(p, i * 11);
    V[i * 11 + 4] = 1;
    V[i * 11 + 8] = 1;
  });
  return { part: name, V, F: Int32Array.from(P.map((_, i) => i)), material };
}

const TREE = [
  part('bark', 'EucaBark', [
    [0, 0, 0],
    [1, 0, 0],
    [0, 10, 0],
  ]),
  part('leaves', 'EucaLeaves', [
    [0, 8, 0],
    [2, 8, 0],
    [0, 9, 2],
  ]),
  part('hull', 'EucaBark', [
    [1, -0.3, 0],
    [0, 3.5, 1],
    [-1, 3.5, 0],
  ]),
];
const CAT: Record<string, CatalogueModel> = {
  euca_0: { file: 'euca_0.glb', size: [2, 10, 2], kind: 'trees', draw: [0, 0] },
  cone: { file: 'cone.glb', size: [0.3, 0.5, 0.3] },
};
const blank = (): Kn5 => ({
  version: 6,
  extra: 0,
  textures: [],
  materials: [
    { name: 'EucaBark', shader: 'ksPerPixel', alpha_blend: 0, alpha_tested: 0, depth: 0, props: [], textures: [] },
    { name: 'EucaLeaves', shader: 'ksPerPixel', alpha_blend: 0, alpha_tested: 0, depth: 0, props: [], textures: [] },
  ] as never,
  root: { kind: 1, name: '', active: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [] },
});
/** a floor rising 0.1 m a metre east, none west of x -1000 */
const floor = (x: number, _z: number) => (x < -1000 ? Number.NaN : 0.1 * x);
const points = (m: Kn5Mesh) => {
  const out: number[][] = [];
  for (let i = 0; i < m.verts.length; i += 11) out.push([m.verts[i], m.verts[i + 1], m.verts[i + 2]] as number[]);
  return out;
};

describe('the trees laid and written', () => {
  it('stands a tree on the floor under its middle, sized and turned, its wall with it', () => {
    const k = blank();
    const w = writeTrees(
      [{ model: 'euca_0', x: 10, z: 20, heading: Math.PI / 2, scale: 2 }],
      k,
      CAT,
      new Map([['euca_0', TREE]]),
      floor,
      [],
      {},
    );
    // (the tree where it stands, as another game's forest stands it: the floor's height under it, 0.1 a metre east)
    expect(w).toEqual({
      count: { euca_0: 1 },
      cleared: 0,
      offFloor: 0,
      unknown: [],
      meshes: 3,
      planted: [['euca_0', 10, 1, 20, Math.PI / 2, 2]],
    });
    const [bark, leaves, wall] = k.root.children as Kn5Mesh[];
    expect([bark?.name, leaves?.name, wall?.name]).toEqual([
      'EUCA_BARK_0_0_0',
      'EUCA_LEAVES_0_0_0',
      '1WALL_EUCA_TRUNKS_0_0_0',
    ]);
    // (turned a quarter: its x along -z; twice as big, up too; on the floor under it, 1.0)
    const b = points(bark as Kn5Mesh);
    expect(b[1]?.[0]).toBeCloseTo(10, 5);
    expect(b[1]?.[2]).toBeCloseTo(18, 5);
    expect(b[2]?.[1]).toBeCloseTo(21, 5);
    // (its wall sized as the tree: -0.6 to 7 over its foot), unseen
    const h = points(wall as Kn5Mesh);
    expect(h[0]?.[2]).toBeCloseTo(18, 5);
    expect(h[0]?.[1]).toBeCloseTo(0.4, 5);
    expect(h[1]?.[1]).toBeCloseTo(8, 5);
    expect([(wall as Kn5Mesh).renderable, (bark as Kn5Mesh).renderable]).toEqual([0, 1]);
  });

  it('merges each square’s copies by part in runs under MERGE_MAX points, and leaves out those it cannot plant', () => {
    const k = blank();
    // (a big part: as many copies as a run holds and one more)
    const big = part(
      'leaves',
      'EucaLeaves',
      Array.from({ length: 3000 }, (_, i) => [i % 3, 8, Math.floor(i / 3) * 0.01]),
    );
    const per = Math.floor(MERGE_MAX / 3000);
    const trees = [
      ...Array.from({ length: per + 1 }, (_, i) => ({ model: 'euca_0', x: 1 + i * 0.01, z: 1, heading: 0, scale: 1 })),
      { model: 'euca_0', x: TREE_TILE + 1, z: -1, heading: 0, scale: 1 },
      { model: 'euca_0', x: -2000, z: 0, heading: 0, scale: 1 },
      { model: 'cone', x: 0, z: 0, heading: 0, scale: 1 },
      { model: 'nothing', x: 0, z: 0, heading: 0, scale: 1 },
      // (on a static box's ground)
      { model: 'euca_0', x: 30.2, z: 30.2, heading: 0, scale: 1 },
    ];
    const box: LaidObject = {
      name: 'SHED',
      model: 'shed',
      collision: 'static',
      places: [[30, 30, 0]],
      size: [1, 1, 1],
      parts: [],
      boxes: [[29, 0, 29, 31, 0, 29, 29, 1, 29, 31, 1, 29, 29, 0, 31, 31, 0, 31, 29, 1, 31, 31, 1, 31]],
    };
    const w = writeTrees(trees, k, CAT, new Map([['euca_0', [TREE[0] as TemplatePart, big]]]), floor, [box], {});
    expect(w.count).toEqual({ euca_0: per + 2 });
    expect([w.cleared, w.offFloor, w.unknown]).toEqual([1, 1, ['cone', 'nothing']]);
    expect(k.root.children.map((c) => c.name)).toEqual([
      'EUCA_BARK_0_0_0',
      'EUCA_LEAVES_0_0_0',
      'EUCA_LEAVES_0_0_1',
      'EUCA_BARK_1_-1_0',
      'EUCA_LEAVES_1_-1_0',
    ]);
    const n = (i: number) => (k.root.children[i] as Kn5Mesh).verts.length / 11;
    expect([n(1), n(2)]).toEqual([per * 3000, 3000]);
  });
});
