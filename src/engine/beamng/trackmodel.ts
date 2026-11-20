// The track's models as every game's build reads them (the track's track_models.py, TRACK_FORMAT's "Models"): each
// mesh of a model (.glb) with what it is (extras.track: its role, its ground, whether it is seen, how far it is drawn,
// its shadows, whether grass grows on it), its material's name in the library (source/materials.json) and its
// corners and triangles where it stands, in the track's axes (y up). Nothing here is one game's: AC's names and flags
// are its own build's. A mesh over the 65536 corners a 16-bit index reaches is cut in pieces of its name.
import { accessor, BLENDER_COPY, type GltfDoc, type GltfNode, nodeMatrix, readGlb } from '../gltf';

/** numbers a corner has: position, normal, uv */
export const CORNER = 8;

export interface TrackMesh {
  name: string;
  /** what it is: 'surface' (driven on), 'wall' (hit), 'visual' (seen only) */
  role: string;
  /** its own ground (where its material has none) */
  surface: string | null;
  visible: boolean;
  /** metres it is drawn from and to (null: as far as it is seen) */
  draw: [number, number | null];
  shadows: boolean;
  grass: boolean;
  /** its material's name in the library */
  material: string | null;
  /** its material an editor's model's own (its picture inside the model): drawn so, not as the library's of its name */
  own?: OwnMaterial;
  /** CORNER numbers a corner */
  v: Float32Array;
  /** three corners a triangle */
  f: Uint32Array;
}

/** An editor's model's own material: its colour picture (its file name, its bytes) and how it shows through. */
export interface OwnMaterial {
  colour: { name: string; data: Uint8Array } | null;
  alpha: 'opaque' | 'mask' | 'blend';
}

type Track = {
  role?: string;
  surface?: string;
  visible?: boolean;
  draw?: [number | null, number | null];
  shadows?: boolean;
  grass?: boolean;
  material?: string;
  own?: boolean;
};

const trackOf = (x: { extras?: unknown } | undefined): Track =>
  ((x?.extras as { track?: Track } | undefined)?.track ?? {}) as Track;

/** A 4x4 matrix of rows taking row points (16 numbers) times another. */
function times(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[i * 4 + k] as number) * (b[k * 4 + j] as number);
      out[i * 4 + j] = s;
    }
  return out;
}

/** A 3x3's inverse transposed (rows taking row normals), of a 4x4's top left. */
function normalMatrix(m: number[]): number[] {
  const a = (i: number, j: number) => m[i * 4 + j] as number;
  const det =
    a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) -
    a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) +
    a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
  const d = det || 1;
  // (the cofactor matrix over the determinant: the inverse transposed)
  return [
    (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) / d,
    -(a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) / d,
    (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)) / d,
    -(a(0, 1) * a(2, 2) - a(0, 2) * a(2, 1)) / d,
    (a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0)) / d,
    -(a(0, 0) * a(2, 1) - a(0, 1) * a(2, 0)) / d,
    (a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1)) / d,
    -(a(0, 0) * a(1, 2) - a(0, 2) * a(1, 0)) / d,
    (a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)) / d,
  ];
}

/** A mesh's corners and faces cut in pieces each within 65536 corners, its faces' corners renumbered. */
function* pieces(v: Float32Array, f: Uint32Array): Generator<[Float32Array, Uint32Array]> {
  const nv = v.length / CORNER;
  if (nv < 65536) {
    yield [v, f];
    return;
  }
  const nf = f.length / 3;
  let start = 0;
  while (start < nf) {
    const used = new Map<number, number>();
    let end = start;
    while (end < nf && used.size + 3 <= 65535) {
      for (let c = 0; c < 3; c++) {
        const k = f[end * 3 + c] as number;
        if (!used.has(k)) used.set(k, used.size);
      }
      end++;
    }
    const out = new Float32Array(used.size * CORNER);
    for (const [old, i] of used) out.set(v.subarray(old * CORNER, (old + 1) * CORNER), i * CORNER);
    const faces = new Uint32Array((end - start) * 3);
    for (let j = start * 3; j < end * 3; j++) faces[j - start * 3] = used.get(f[j] as number) as number;
    yield [out, faces];
    start = end;
  }
}

/** A model's meshes (its glb's bytes), in the order the model has them. */
export function trackModel(bytes: Uint8Array): TrackMesh[] {
  const { doc, bin } = readGlb(bytes);
  const names = (doc.materials ?? []).map(
    (g) => trackOf(g).material ?? (g.name ?? 'material').replace(BLENDER_COPY, ''),
  );
  const owns = (doc.materials ?? []).map((g) => (trackOf(g).own ? ownMaterial(doc, bin, g) : undefined));
  const out: TrackMesh[] = [];
  const node = (i: number, parent: number[]) => {
    const g = doc.nodes?.[i] as GltfNode | undefined;
    if (!g) return;
    const m = times(nodeMatrix(g), parent);
    if (g.mesh !== undefined) mesh(doc, bin, g, m, names, owns, out);
    for (const c of g.children ?? []) node(c, m);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const i of doc.scenes[doc.scene ?? 0]?.nodes ?? []) node(i, identity);
  return out;
}

/** A material's own picture and alpha, as its model holds them (its colour the image its base colour is of: named so,
 * with its kind's ending where its name has none). */
function ownMaterial(doc: GltfDoc, bin: Uint8Array, g: NonNullable<GltfDoc['materials']>[number]): OwnMaterial {
  const alpha = g.alphaMode === 'MASK' ? 'mask' : g.alphaMode === 'BLEND' ? 'blend' : 'opaque';
  const t = g.pbrMetallicRoughness?.baseColorTexture;
  const img = t ? doc.images?.[doc.textures?.[t.index]?.source ?? -1] : undefined;
  const view = img ? doc.bufferViews?.[img.bufferView ?? -1] : undefined;
  if (!img || !view) return { colour: null, alpha };
  const at = view.byteOffset ?? 0;
  const data = bin.slice(at, at + view.byteLength);
  const ext = data[0] === 0x89 && data[1] === 0x50 ? '.png' : '.jpg';
  const base = (img.name || g.name || 'material').replace(/[\\/]/g, '_');
  return { colour: { name: /\.(png|jpe?g)$/i.test(base) ? base : base + ext, data }, alpha };
}

function mesh(
  doc: GltfDoc,
  bin: Uint8Array,
  g: GltfNode,
  m: number[],
  names: string[],
  owns: (OwnMaterial | undefined)[],
  out: TrackMesh[],
) {
  const track = trackOf(g);
  const name = (g.name ?? 'mesh').replace(BLENDER_COPY, '');
  const draw = track.draw ?? [0, null];
  const nm = normalMatrix(m);
  for (const prim of doc.meshes?.[g.mesh as number]?.primitives ?? []) {
    if ((prim.mode ?? 4) !== 4) continue;
    const at = prim.attributes;
    const pos = accessor(doc, bin, at.POSITION as number).data;
    const nv = pos.length / 3;
    const faces =
      prim.indices !== undefined
        ? Uint32Array.from(accessor(doc, bin, prim.indices).data)
        : Uint32Array.from({ length: nv }, (_, i) => i);
    const uv = at.TEXCOORD_0 !== undefined ? accessor(doc, bin, at.TEXCOORD_0).data : new Float32Array(nv * 2);
    let nor: Float64Array;
    if (at.NORMAL !== undefined) {
      const n0 = accessor(doc, bin, at.NORMAL).data;
      nor = new Float64Array(nv * 3);
      for (let k = 0; k < nv; k++)
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (let i = 0; i < 3; i++) s += (n0[k * 3 + i] as number) * (nm[i * 3 + j] as number);
          nor[k * 3 + j] = s;
        }
    } else {
      // (none: each corner the sum of its faces')
      nor = new Float64Array(nv * 3);
      for (let t = 0; t < faces.length; t += 3) {
        const [a, b, c] = [faces[t] as number, faces[t + 1] as number, faces[t + 2] as number];
        const u = [0, 1, 2].map((i) => (pos[b * 3 + i] as number) - (pos[a * 3 + i] as number));
        const w = [0, 1, 2].map((i) => (pos[c * 3 + i] as number) - (pos[a * 3 + i] as number));
        const n = [
          (u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number),
          (u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number),
          (u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number),
        ];
        for (const k of [a, b, c])
          for (let i = 0; i < 3; i++) nor[k * 3 + i] = (nor[k * 3 + i] as number) + (n[i] as number);
      }
    }
    const v = new Float32Array(nv * CORNER);
    for (let k = 0; k < nv; k++) {
      for (let j = 0; j < 3; j++) {
        let s = m[12 + j] as number;
        for (let i = 0; i < 3; i++) s += (pos[k * 3 + i] as number) * (m[i * 4 + j] as number);
        v[k * CORNER + j] = s;
      }
      const L = Math.hypot(nor[k * 3] as number, nor[k * 3 + 1] as number, nor[k * 3 + 2] as number) || 1;
      for (let j = 0; j < 3; j++) v[k * CORNER + 3 + j] = (nor[k * 3 + j] as number) / Math.max(L, 1e-12);
      v[k * CORNER + 6] = uv[k * 2] as number;
      v[k * CORNER + 7] = uv[k * 2 + 1] as number;
    }
    for (const [pv, pf] of pieces(v, faces))
      out.push({
        name,
        role: track.role ?? 'visual',
        surface: track.surface ?? null,
        visible: track.visible !== false,
        draw: [Number(draw[0] ?? 0), draw[1] == null ? null : Number(draw[1])],
        shadows: track.shadows !== false,
        grass: !!track.grass,
        material: prim.material !== undefined && names.length ? (names[prim.material] ?? null) : null,
        ...(prim.material !== undefined && owns[prim.material] ? { own: owns[prim.material] } : {}),
        v: pv,
        f: pf,
      });
  }
}

/** The kind of ground a mesh is driven as (a key of surfaces.json), or null if nothing drives on it: a wall's 'wall';
 * a surface's its material's surface (lib: the library's materials), or its own where its material has none. */
export function groundOf(mesh: TrackMesh, lib: Record<string, { surface?: string }>): string | null {
  if (mesh.role === 'wall') return 'wall';
  if (mesh.role !== 'surface') return null;
  return (mesh.material ? lib[mesh.material]?.surface : undefined) ?? mesh.surface;
}
