// The track's trees (the track file's `trees`: treesfile.ts) laid on the floor and written into its trees model as the
// track's tools plant them (place_trees.py): each tree its model (a catalogue model of kind "tree": a tree, or a mass
// of understory; or an editor's tree, of kind "trees") sized by its scale, turned to its heading and stood on the floor
// under its middle; the trees on a solid object's ground left out (laying.ts's treesGone); every part of the copies in
// each TREE_TILE metre square merged, by part, in runs under MERGE_MAX points (EUCA_<PART>_<tx>_<tz>_<i>), the squares
// in order and each one's parts by name; then their trunks' unseen walls (their models' hulls, sized as the trees),
// each square's (1WALL_EUCA_TRUNKS_<tx>_<tz>_<i>).

import type { Kn5 } from './kn5tree';
import { type Floor, type LaidObject, type Tree, treesGone } from './laying';
import type { CatalogueModel, TemplatePart } from './templates';
import { world } from './templates';
import { MERGE_MAX, objectNode } from './trackobjects';
import type { TreePlacement } from './treesfile';

/** metres a side of the squares the trees are merged in */
export const TREE_TILE = 50;
/** the meshes' names begin so */
export const TREE_PREFIX = 'EUCA_';
/** the catalogue's kind a tree is of */
export const TREE_KINDS: ReadonlySet<string> = new Set(['trees']);

/** A part sized: its points scale times as far from its foot, its normals and tangents as they are (sized alike every
 * way). */
function sized(V: Float64Array, scale: number): Float64Array {
  if (scale === 1) return V;
  const out = Float64Array.from(V);
  for (let i = 0; i < V.length; i += 11) for (let c = 0; c < 3; c++) out[i + c] = (V[i + c] as number) * scale;
  return out;
}

export interface TreesWritten {
  /** trees planted, by model */
  count: Record<string, number>;
  /** trees left out: on a solid object's ground, off the floor, or of a model the catalogue has not */
  cleared: number;
  offFloor: number;
  unknown: string[];
  meshes: number;
  /** the trees planted where they stand: [model, x, y (the floor's), z, heading, scale] each (another game's forest,
   * as BeamNG's, stands them so) */
  planted: [string, number, number, number, number, number][];
}

type Copy = [Float64Array, ArrayLike<number>];

/** Copies merged into meshes of at most MERGE_MAX points, in the order given. */
function merged(copies: Copy[]): { V: Float64Array; F: number[] }[] {
  const runs: Copy[][] = [];
  let run: Copy[] = [];
  let n = 0;
  for (const c of copies) {
    const nv = c[0].length / 11;
    if (run.length && n + nv > MERGE_MAX) {
      runs.push(run);
      run = [];
      n = 0;
    }
    run.push(c);
    n += nv;
  }
  if (run.length) runs.push(run);
  return runs.map((r) => {
    const V = new Float64Array(r.reduce((a, [v]) => a + v.length, 0));
    const F: number[] = [];
    let at = 0;
    for (const [v, f] of r) {
      V.set(v, at);
      for (let j = 0; j < f.length; j++) F.push((f[j] as number) + at / 11);
      at += v.length;
    }
    return { V, F };
  });
}

/** A catalogue model's distances (its far one null: no limit, 0 as the game takes it). */
function drawOf(draw: CatalogueModel['draw'] | [number, number | null] | undefined): [number, number] | undefined {
  if (!draw) return undefined;
  return [draw[0] ?? 0, draw[1] ?? 0];
}

const bySquare = (a: { at: [number, number] }, b: { at: [number, number] }) => a.at[0] - b.at[0] || a.at[1] - b.at[1];

/** The trees laid and written into k (its meshes all replaced). */
export function writeTrees(
  trees: TreePlacement[],
  k: Kn5,
  cat: Record<string, CatalogueModel>,
  templates: Map<string, TemplatePart[]>,
  floor: Floor,
  solid: LaidObject[],
  materials: Record<string, Kn5>,
): TreesWritten {
  const gone = new Set(
    treesGone(
      trees.map((t) => [t.model, t.x, 0, t.z] as Tree),
      solid,
    ),
  );
  const count: Record<string, number> = {};
  const unknown = new Set<string>();
  let offFloor = 0;
  const planted: TreesWritten['planted'] = [];
  // (each square's parts, by part, in the order first planted; its walls, of their hulls' material)
  const tiles = new Map<string, { at: [number, number]; parts: Map<string, { material: string; copies: Copy[] }> }>();
  const walls = new Map<string, { at: [number, number]; material: string; copies: Copy[] }>();
  const lods = new Map<string, [number, number] | undefined>();
  trees.forEach((t, i) => {
    if (gone.has(i)) return;
    const meta = cat[t.model];
    const parts = templates.get(t.model);
    if (!meta?.kind || !TREE_KINDS.has(meta.kind) || !parts) {
      unknown.add(t.model);
      return;
    }
    const y = floor(t.x, t.z);
    if (Number.isNaN(y)) {
      offFloor++;
      return;
    }
    const at: [number, number] = [Math.floor(t.x / TREE_TILE), Math.floor(t.z / TREE_TILE)];
    const key = at.join(',');
    let tile = tiles.get(key);
    if (!tile) {
      tile = { at, parts: new Map() };
      tiles.set(key, tile);
    }
    for (const p of parts) {
      const V = world(sized(p.V, t.scale), t.x, t.z, y, t.heading);
      if (p.part === 'hull') {
        const w = walls.get(key) ?? { at, material: p.material, copies: [] };
        w.copies.push([V, p.F]);
        walls.set(key, w);
        continue;
      }
      const g = tile.parts.get(p.part) ?? { material: p.material, copies: [] };
      g.copies.push([V, p.F]);
      tile.parts.set(p.part, g);
      if (!lods.has(p.part)) lods.set(p.part, meta.lods?.[p.part] ?? drawOf(meta.draw));
    }
    count[t.model] = (count[t.model] ?? 0) + 1;
    planted.push([t.model, t.x, y, t.z, t.heading, t.scale]);
  });
  k.root.children = [];
  let made = 0;
  for (const tile of [...tiles.values()].sort(bySquare)) {
    const [tx, tz] = tile.at;
    for (const [part, g] of [...tile.parts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      merged(g.copies).forEach(({ V, F }, i) => {
        const name = `${TREE_PREFIX}${part.toUpperCase()}_${tx}_${tz}_${i}`;
        k.root.children.push(objectNode(k, name, V, F, g.material, materials, true, lods.get(part)));
        made++;
      });
  }
  // (the walls after: unseen, casting no shadow)
  for (const w of [...walls.values()].sort(bySquare))
    merged(w.copies).forEach(({ V, F }, i) => {
      const name = `1WALL_${TREE_PREFIX}TRUNKS_${w.at[0]}_${w.at[1]}_${i}`;
      k.root.children.push(objectNode(k, name, V, F, w.material, materials, false));
      made++;
    });
  return { count, cleared: gone.size, offFloor, unknown: [...unknown].sort(), meshes: made, planted };
}
