// The catalogue of models the objects are laid of (the track's templates.py), every one of it the editor's, none the
// track's: models/catalogue.json, each model's .glb beside it; and a model's parts read: each part's points (eleven
// numbers each: x y z, normal, u v, tangent), faces and material, in the model's own frame (its front along +z, its foot
// at 0).
import { footprintOf } from './footprint';
import { accessor, fromGltf, type GltfDoc, loadKn5, type MaterialLibrary, nodeMatrix, readGlb } from './gltf';
import { type Kn5, VERT } from './kn5tree';
import { meshes } from './mesh';
import type { HostFiles } from './placehost';

/** Where a model's materials are: its own, its textures in its file (made in Blender: the editor's own); the track's
 * material library's, by name (each mesh a part as it is named, its hull "hull"); or as the track's own models keep
 * them (gltf_source's kn5 data on its nodes: AC's names and flags, read with its library and textures). */
export type ModelMaterials = 'own' | 'library' | 'track';

/** A model of the catalogue, as models/catalogue.json says of it. */
export interface CatalogueModel {
  id?: string;
  /** its .glb in the editor's models */
  file?: string;
  materials?: ModelMaterials;
  label?: string;
  description?: string;
  size: number[];
  fits?: string[];
  collision?: string[];
  /** its part the games' collisions are of (unseen) */
  hull?: string;
  lights?: unknown[];
  kind?: string;
  /** the distances it is drawn from and to, near and far (every part of it but those lods names) */
  draw?: [number, number];
  /** each part's distances it is drawn from and to (a far stand-in, say) */
  lods?: Record<string, [number, number]>;
}

/** A part of a model: eleven numbers a point. */
export interface TemplatePart {
  part: string;
  V: Float64Array;
  F: Int32Array;
  material: string;
  /** a model's own mesh (a building's): drawn or not, casting shadows or not (its role's) */
  seen?: boolean;
  shadows?: boolean;
  /** the model it is of (its materials and textures) */
  from?: Kn5;
}

/** Where the catalogue is read from: the editor's models folder. */
export interface CatalogueSource {
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  editorModels: string;
  /** the track's material library and textures (a track's model read with them: its meshes' roles, as AC names) */
  library?: MaterialLibrary;
  textures?: string;
}

/** The editor's models folder: as given, else beside the track's folder (the editor's checkout next to the track's). */
export const editorModelsOf = (project: string, given?: string): string =>
  given ?? `${project}/../top-race-editor/models`;

/** The games' scripts in the editor's models: scripts/ac (each screen's, screens/<shows>.lua), scripts/beamng (the
 * BeamNG level's Lua). */
export const scriptsOf = (editorModels: string): string => `${editorModels}/scripts`;

const json = async (src: CatalogueSource, path: string) =>
  JSON.parse(new TextDecoder().decode(await src.read(path))) as unknown;

/** The catalogue, by model id: models/catalogue.json's models (none where it is not). */
export async function catalogue(src: CatalogueSource): Promise<Record<string, CatalogueModel>> {
  const at = `${src.editorModels}/catalogue.json`;
  if (!(await src.exists(at))) return {};
  const doc = (await json(src, at)) as { models?: (CatalogueModel & { id: string })[] };
  return Object.fromEntries((doc.models ?? []).map((m) => [m.id, m]));
}

/** The catalogue as the page has it, the build's own (catalogue): each model as it says; a track's model's outline from
 * above (a building's own shape, for the map), read with the track's material library and textures. */
export async function pageCatalogue(
  files: HostFiles,
  editorModels: string,
  library?: MaterialLibrary,
  textures?: string,
): Promise<Record<string, CatalogueModel & { outline?: number[][] }>> {
  const cat = await catalogue({ read: (f) => files.read(f), exists: (f) => files.exists(f), editorModels });
  const out: Record<string, CatalogueModel & { outline?: number[][] }> = {};
  for (const [id, m] of Object.entries(cat)) {
    const it: CatalogueModel & { outline?: number[][] } = { ...m };
    const at = `${editorModels}/${m.file}`;
    if (m.materials === 'track' && (await files.exists(at)))
      it.outline = await footprintOf(files, at, library, textures);
    out[id] = it;
  }
  return out;
}

/** A model's parts (templates.load): a library's model's meshes as they are, in order; a track's model's, each its
 * role's AC name and flags; an editor's own model's, by their names lower-cased; their nodes' matrices applied (points,
 * normals, tangents). */
export async function loadTemplate(src: CatalogueSource, meta: CatalogueModel): Promise<TemplatePart[]> {
  const at = `${src.editorModels}/${meta.file}`;
  if (meta.materials === 'track') {
    // (its textures the track's: its source/textures, as given)
    const k = await loadKn5(src as unknown as Parameters<typeof loadKn5>[0], at, src.library, src.textures);
    return glbParts(k, false).map((p) => ({ ...p, from: k }));
  }
  const { doc, bin } = readGlb(await src.read(at));
  if (meta.materials === 'library') return libraryParts(doc, bin);
  // (its pictures inside it: its model with its parts, their materials' textures with them)
  const k = await fromGltf(doc, bin, async () => new Uint8Array(0));
  for (const m of k.materials) m.own = true;
  return glbParts(k, true).map((p) => ({ ...p, from: k }));
}

/** A model's meshes as parts, its nodes' matrices applied (points, normals, tangents): by their names (lower-cased,
 * an editor's own model's), drawn and casting shadows as each is. */
function glbParts(k: Kn5, lower: boolean): TemplatePart[] {
  const out: TemplatePart[] = [];
  for (const [n, m] of meshes(k)) {
    if (!n.faces.length) continue;
    const nv = n.verts.length / VERT;
    const V = new Float64Array(nv * 11);
    for (let i = 0; i < nv; i++) {
      const v = (j: number) => n.verts[i * VERT + j] as number;
      // (row points: [p, 1] @ M, as build_paths' triangles)
      const tr = (x: number, y: number, z: number, w: number) =>
        [0, 1, 2].map(
          (c) => x * (m[c] as number) + y * (m[4 + c] as number) + z * (m[8 + c] as number) + w * (m[12 + c] as number),
        );
      const p = tr(v(0), v(1), v(2), 1);
      const nn = tr(v(3), v(4), v(5), 0);
      const t = VERT > 10 ? tr(v(8), v(9), v(10), 0) : [0, 0, 0];
      V.set([...p, ...nn, v(6), v(7), ...t], i * 11);
    }
    out.push({
      part: lower ? n.name.toLowerCase() : n.name,
      V,
      F: Int32Array.from(n.faces),
      material: k.materials[n.material]?.name ?? '',
      ...(lower ? {} : { seen: n.renderable !== 0, shadows: n.cast_shadows !== 0 }),
    });
  }
  return out;
}

/** A library's model's parts: each mesh's triangles a part of its node's name, in the file's order, its points as they
 * are kept (eleven numbers: its tangent's first three), its material's name the library's. */
function libraryParts(doc: GltfDoc, bin: Uint8Array): TemplatePart[] {
  const out: TemplatePart[] = [];
  const walk = (i: number, parent: number[] | null) => {
    const g = doc.nodes?.[i];
    if (!g) return;
    const own = nodeMatrix(g);
    const m = parent ? times(own, parent) : own;
    for (const prim of doc.meshes?.[g.mesh ?? -1]?.primitives ?? []) {
      const at = prim.attributes;
      const col = (a: number | undefined) => (a === undefined ? null : accessor(doc, bin, a));
      const pos = col(at.POSITION);
      if (!pos) continue;
      const nor = col(at.NORMAL);
      const uv = col(at.TEXCOORD_0);
      const tan = col(at.TANGENT);
      const nv = pos.data.length / 3;
      const V = new Float64Array(nv * 11);
      const moved = m.some((v, j) => v !== (j % 5 === 0 ? 1 : 0));
      for (let k = 0; k < nv; k++) {
        const put = (c: { data: ArrayLike<number>; n: number } | null, n: number, to: number, w: number) => {
          if (!c) return;
          const x = c.data[k * c.n] as number;
          const y = c.data[k * c.n + 1] as number;
          const z = n > 2 ? (c.data[k * c.n + 2] as number) : 0;
          if (n === 2 || !moved) {
            V[k * 11 + to] = x;
            V[k * 11 + to + 1] = y;
            if (n > 2) V[k * 11 + to + 2] = z;
            return;
          }
          // (row points: [p, w] @ M)
          for (let j = 0; j < 3; j++)
            V[k * 11 + to + j] =
              x * (m[j] as number) + y * (m[4 + j] as number) + z * (m[8 + j] as number) + w * (m[12 + j] as number);
        };
        put(pos, 3, 0, 1);
        put(nor, 3, 3, 0);
        put(uv, 2, 6, 0);
        put(tan, 3, 8, 0);
      }
      const F =
        prim.indices === undefined
          ? Int32Array.from({ length: nv }, (_, k) => k)
          : Int32Array.from(accessor(doc, bin, prim.indices).data);
      out.push({ part: g.name ?? `node${i}`, V, F, material: doc.materials?.[prim.material ?? -1]?.name ?? '' });
    }
    for (const c of g.children ?? []) walk(c, m);
  };
  for (const i of doc.scenes[doc.scene ?? 0]?.nodes ?? []) walk(i, null);
  return out;
}

/** Two kn5 matrices (rows taking row vectors) one after the other: a's, then b's. */
function times(a: number[], b: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[i * 4 + k] as number) * (b[k * 4 + j] as number);
      out.push(s);
    }
  return out;
}

/** An object's own points (eleven numbers each) into the world: at c (x, z), its floor at y0, turned to its heading h
 * (templates.world: [x, z] @ [[cos h, -sin h], [sin h, cos h]] + c). */
export function world(V: Float64Array, cx: number, cz: number, y0: number, h: number): Float64Array {
  const s = Math.sin(h);
  const co = Math.cos(h);
  const out = Float64Array.from(V);
  for (let i = 0; i < V.length; i += 11) {
    const x = V[i] as number;
    const z = V[i + 2] as number;
    out[i] = x * co + z * s + cx;
    out[i + 1] = (V[i + 1] as number) + y0;
    out[i + 2] = x * -s + z * co + cz;
    for (const a of [3, 8]) {
      const u = V[i + a] as number;
      const w = V[i + a + 2] as number;
      out[i + a] = u * co + w * s;
      out[i + a + 2] = u * -s + w * co;
    }
  }
  return out;
}
