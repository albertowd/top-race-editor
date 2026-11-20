// The track as an rFactor 2 location, made from the track's data (TRACK_FORMAT.md's build_rf2), not from another game's
// build: build/rf2/Locations/<venue>, as Studio 397's own tracks are laid out (ModDev/Locations/Joesville):
//
//   <venue>/<venue>.tdf                 the grounds (rf2/text.ts), its materials matched by the start of their names
//   <venue>/Assets/GMT/*.gmt            each model's meshes (rf2/gmt.ts), a GMT for each kind of them (driven on, hit
//                                       unseen, only seen) up to 65536 corners, in rFactor's axes (rf2/aiw.ts's
//                                       TRACK_TO_RF2: x, y, -z), at their places (a static object's GMT is in the
//                                       world's coordinates, its pivot nought)
//   <venue>/Assets/Maps/*.dds           their textures (the AC build's DDS of each: the same file)
//   <venue>/<layout>/<layout>.gdb .scn .AIW .wet, and its timing beams (xfinish, xsector1, xsector2, xpitin,
//                                       xpitout: unseen quads across the lap where its timing gates are, rf2/aiw.ts)
//
// Each layout's scene loads the GMTs of its models (track.json's layouts.<layout>.models) and its own beams; its AIW
// is made from its racing lines on the floor of its models (aimake.ts, as AC's AI lines are). A material is drawn with
// rFactor's plain diffuse shader (L2DIFFUSET0, as Joesville's buildings are), see-through ones blended; one driven on
// is named after its ground (surfaces.json's targets.rf2) so the TDF finds it. Not yet: the lamps, the knockable
// cones, the trackside cameras, packing into a MAS and an rFCMP (ModMgr).

import type { LayoutObjects } from '../../domain/types';
import { acFolder, sha1 } from '../acbuild';
import { type LightsData, lightsData } from '../aclights';
import type { RacingLine, RacingLines } from '../ailines';
import { aiLineOf, STEP } from '../aimake';
import { CORNER, groundOf as meshGround, type OwnMaterial, type TrackMesh, trackModel } from '../beamng/trackmodel';
import { acDds, convert, ddsChain, ddsOf, readPicture, readPng, resizeLanczos, type TextureAc } from '../dds';
import type { HostFiles } from '../placehost';
import { type PyJson, plain } from '../pyjson';
import { Surface } from '../surface';
import { readPart } from '../trackdoc';
import { settingsOf } from '../trackfiles';
import { type Axes, aiwText, aiwTiming, type Beam, TRACK_TO_RF2, type V3 } from './aiw';
import { boxOf, facesOf, floatWord, type Gmt, type GmtMaterial, type GmtMesh, type GmtVertex, writeGmt } from './gmt';
import {
  type Ground,
  gdbText,
  groundOf,
  type Instance,
  type Light,
  materialName,
  scnText,
  tdfText,
  wetText,
} from './text';

/** a GMT's corners at most (its faces name them by 16-bit numbers) */
export const GMT_CORNERS = 65535;
/** a GMT's faces at most: none of the samples has 65536 or more (64,800 the most), the game counting them in 16 bits
 * (more crashed it as a session began) */
export const GMT_FACES = 64000;
/** a GMT's materials (and so its meshes, one a material) at most: the samples have 9 at most, 35 meshes */
export const GMT_MATERIALS = 16;
/** metres a mesh is drawn to where its model does not say */
const DRAW_FAR = 2000;
/** metres what is only seen (a building, a tree) is drawn to where its model does not say */
const SEEN_FAR = 800;
/** the grounds RealRoad rubbers in and wets (their TDF prefixes): the roads and rumbles */
const DEFORMED = new Set(['road', 'rmbl']);
/** a timing beam's reach below and above the floor (as LochDrummond's, about) */
const BEAM_DOWN = 10;
const BEAM_UP = 15;
/** the grounds the AI lines keep to (their sides end where these do) */
const ROADS = new Set(['asphalt', 'rumble', 'kerb']);
const WHITE = 'tsvp_white.dds';

export interface Rf2Options {
  project: string;
  /** where the location is written: <out>/Locations/<venue> (by default build/rf2) */
  out?: string;
  /** the layouts made (by default every one with a racing line) */
  layouts?: string[];
  /** rFactor 2's folder: the location copied into its ModDev/Locations as well, to try in its Mod Mode */
  install?: string;
  axes?: Axes;
  log?: (line: string) => void;
}

export interface Rf2Built {
  location: string;
  venue: string;
  layouts: string[];
  gmts: number;
  textures: number;
  /** layouts left out, and why */
  skipped: Record<string, string>;
  installed: string | null;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const fileName = (t: string) => t.replace(/[^A-Za-z0-9_.-]/g, '_');
const words = (...xs: number[]) => xs.map(floatWord);

/** How a material shows what is behind it: not at all; through the holes its texture's alpha cuts (leaves, wire: its
 * texture's flag 0x80, as LochDrummond's fences have it, drawn opaque); or blended (glass). */
export type Alpha = 'opaque' | 'mask' | 'blend';

/** A material as rFactor's plain diffuse shader draws it (Joesville's buildings': L2DIFFUSET0, one texture). */
export function diffuseMaterial(name: string, texture: string, alpha: Alpha = 'opaque'): GmtMaterial {
  const blend = alpha === 'blend';
  return {
    name,
    flags: blend ? 0x68902023 : 0x68902003,
    ambient: [1, 1, 1, 1],
    diffuse: [1, 1, 1, 1],
    specular: [0.2, 0.2, 0.2, 1],
    emissive: [0, 0, 0, 1],
    srcBlend: blend ? 5 : 2,
    destBlend: blend ? 6 : 1,
    specularPower: 1,
    word144: 0,
    shaders: [
      {
        name: 'L2DIFFUSET0',
        params: [...words(5, 0.1, 0.9), 0, 0, 0, 0, 0, 0, 0, 0],
        textures: [
          {
            name: texture.toUpperCase(),
            flags: alpha === 'mask' ? 0x98 : 0x18,
            flags2: 0x20,
            word68: -1,
            count: 1,
            settings: [
              1,
              3,
              floatWord(1),
              0,
              0,
              0,
              1,
              0,
              floatWord(1),
              0,
              ...words(0.1, 0.9, 5),
              ...new Array(13).fill(0),
            ],
          },
        ],
      },
    ],
  };
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};

/** A corner as a GMT's: its place and normal in rFactor's axes, its uv as it is (both V down), a tangent and binormal
 * across its normal (the plain shader reads none). */
function vertexOf(position: V3, normal: V3, uv: [number, number]): GmtVertex {
  const n = unit(normal);
  const t = unit(Math.abs(n[1]) < 0.9 ? cross([0, 1, 0], n) : cross(n, [0, 0, 1]));
  return {
    position,
    normal: n,
    colour: 0xffffffff,
    colour2: 0,
    bones: [0, 0, 0, 0],
    weights: [255, 0, 0, 0],
    tangent: t,
    binormal: cross(n, t),
    uv: [uv, [0, 0], [0, 0], [0, 0]],
  };
}

/** A track mesh as a GMT's (rFactor's axes): its faces wound as rFactor's are ((b - a) x (c - a) against their
 * corners' normals), the degenerate left out; null where none is left. */
export function gmtMeshOf(m: TrackMesh, material: number, axes: Axes = TRACK_TO_RF2): GmtMesh | null {
  const n = m.v.length / CORNER;
  const vertices: GmtVertex[] = [];
  for (let k = 0; k < n; k++) {
    const o = k * CORNER;
    const p = axes(m.v[o] as number, m.v[o + 1] as number, m.v[o + 2] as number);
    // (a normal is a way, not a place: the axes' mirror, not their move)
    const q = axes(m.v[o + 3] as number, m.v[o + 4] as number, m.v[o + 5] as number);
    const z = axes(0, 0, 0);
    vertices.push(vertexOf(p, [q[0] - z[0], q[1] - z[1], q[2] - z[2]], [m.v[o + 6] as number, m.v[o + 7] as number]));
  }
  const indices: number[] = [];
  for (let f = 0; f < m.f.length; f += 3) {
    let [a, b, c] = [m.f[f] as number, m.f[f + 1] as number, m.f[f + 2] as number];
    if (a === b || b === c || a === c) continue;
    const [A, B, C] = [a, b, c].map((i) => (vertices[i] as GmtVertex).position) as [V3, V3, V3];
    const g = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
    if (Math.hypot(g[0], g[1], g[2]) < 1e-12) continue;
    let d = 0;
    for (const i of [a, b, c]) {
      const nn = (vertices[i] as GmtVertex).normal;
      d += g[0] * nn[0] + g[1] * nn[1] + g[2] * nn[2];
    }
    if (d > 0) [b, c] = [c, b];
    indices.push(a, b, c);
  }
  if (!indices.length) return null;
  return { flags: 0x4080, material, vertices, indices, palette: [] };
}

/** A GMT's mesh cut into pieces each within GMT_CORNERS corners and GMT_FACES faces (its corners renumbered in
 * each, its faces in their order). */
export function gmtPieces(m: GmtMesh, corners = GMT_CORNERS, faces = GMT_FACES): GmtMesh[] {
  if (m.vertices.length <= corners && m.indices.length / 3 <= faces) return [m];
  const out: GmtMesh[] = [];
  let at = new Map<number, number>();
  let piece: GmtMesh = { ...m, vertices: [], indices: [] };
  for (let t = 0; t < m.indices.length; t += 3) {
    const tri = [m.indices[t], m.indices[t + 1], m.indices[t + 2]] as number[];
    const fresh = tri.filter((i, k) => !at.has(i) && tri.indexOf(i) === k).length;
    if (piece.vertices.length + fresh > corners || piece.indices.length / 3 + 1 > faces) {
      out.push(piece);
      at = new Map();
      piece = { ...m, vertices: [], indices: [] };
    }
    for (const i of tri) {
      let k = at.get(i);
      if (k === undefined) {
        k = piece.vertices.length;
        at.set(i, k);
        piece.vertices.push(m.vertices[i] as GmtVertex);
      }
      piece.indices.push(k);
    }
  }
  if (piece.indices.length) out.push(piece);
  return out;
}

/** A GMT being filled: one mesh a material (its pieces' corners after one another), within the samples' limits. */
export class GmtFill {
  readonly meshes: GmtMesh[] = [];
  readonly materials: GmtMaterial[] = [];
  private corners = 0;
  private faces = 0;

  get empty(): boolean {
    return !this.meshes.length;
  }

  /** Whether a piece of the material goes in, within GMT_CORNERS, GMT_FACES and GMT_MATERIALS. */
  fits(piece: GmtMesh, material: GmtMaterial): boolean {
    if (this.empty) return true;
    const known = this.materials.includes(material);
    return (
      this.corners + piece.vertices.length <= GMT_CORNERS &&
      this.faces + piece.indices.length / 3 <= GMT_FACES &&
      (known || this.materials.length < GMT_MATERIALS)
    );
  }

  /** A piece put in: into its material's mesh, its corners after that mesh's. */
  add(piece: GmtMesh, material: GmtMaterial): void {
    let mi = this.materials.indexOf(material);
    if (mi < 0) {
      this.materials.push(material);
      mi = this.materials.length - 1;
      this.meshes.push({ flags: piece.flags, material: mi, vertices: [], indices: [], palette: [] });
    }
    const mesh = this.meshes.find((m) => m.material === mi) as GmtMesh;
    const first = mesh.vertices.length;
    for (const v of piece.vertices) mesh.vertices.push(v);
    for (const i of piece.indices) mesh.indices.push(first + i);
    this.corners += piece.vertices.length;
    this.faces += piece.indices.length / 3;
  }
}

/** A static object's GMT (its corners where they are, its pivot nought) of its meshes and materials. */
export function staticGmt(name: string, meshes: GmtMesh[], materials: GmtMaterial[], far = DRAW_FAR, near = 0): Gmt {
  const { faces, planes } = facesOf(meshes);
  return {
    kind: 'gmt',
    layout: 'new',
    bits: 32,
    flags: 0x04000000,
    name: name.slice(0, 63),
    box: boxOf(meshes),
    lod: [near, far],
    distance2: 0,
    position: [0, 0, 0],
    meshes,
    faces,
    planes,
    bones: [],
    materials,
  };
}

/** A timing beam's GMT: a quad across from its left to its right, BEAM_DOWN under the floor to BEAM_UP over it, seen
 * from both sides (as Joesville's are), never drawn. */
export function beamGmt(beam: Beam): Gmt {
  const { left: L, right: R } = beam;
  const corners: V3[] = [
    [L[0], L[1] - BEAM_DOWN, L[2]],
    [R[0], R[1] - BEAM_DOWN, R[2]],
    [R[0], R[1] + BEAM_UP, R[2]],
    [L[0], L[1] + BEAM_UP, L[2]],
  ];
  const across: V3 = [R[0] - L[0], 0, R[2] - L[2]];
  const face = unit(cross(across, [0, 1, 0]));
  const back: V3 = [-face[0], -face[1], -face[2]];
  const uv: [number, number][] = [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];
  const vertices = [
    ...corners.map((p, i) => vertexOf(p, face, uv[i] as [number, number])),
    ...corners.map((p, i) => vertexOf(p, back, uv[i] as [number, number])),
  ];
  const mesh: GmtMesh = { flags: 0x4080, material: 0, vertices, indices: [], palette: [] };
  // (each side wound as rFactor's: (b - a) x (c - a) against its normal)
  for (const [side, quad] of [
    [face, [0, 1, 2, 0, 2, 3]],
    [back, [4, 5, 6, 4, 6, 7]],
  ] as const)
    for (let t = 0; t < 6; t += 3) {
      let [a, b, c] = [quad[t], quad[t + 1], quad[t + 2]] as [number, number, number];
      const [A, B, C] = [a, b, c].map((i) => (vertices[i] as GmtVertex).position) as [V3, V3, V3];
      const g = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
      if (g[0] * side[0] + g[1] * side[1] + g[2] * side[2] > 0) [b, c] = [c, b];
      mesh.indices.push(a, b, c);
    }
  const g = staticGmt(beam.name, [mesh], [diffuseMaterial(beam.name, WHITE)], 10000);
  return { ...g, flags: 0 };
}

const pow2 = (v: number) => v > 0 && (v & (v - 1)) === 0;

/** Whether a DDS's sides are powers of two (as every texture of rFactor's own tracks is). */
export function powerOfTwoDds(dds: Uint8Array): boolean {
  const v = new DataView(dds.buffer, dds.byteOffset, dds.byteLength);
  return pow2(v.getUint32(12, true)) && pow2(v.getUint32(16, true));
}

/** A PNG made a DDS of sides powers of two (each the next up, at most 4096), with its mips: in the library's DXT
 * format, else DXT5. */
export async function squareDds(png: Uint8Array, fmt: string): Promise<Uint8Array> {
  const img = await readPng(png);
  const up = (n: number) => Math.min(4096, 2 ** Math.ceil(Math.log2(Math.max(n, 4))));
  const sized = pow2(img.width) && pow2(img.height) ? img : resizeLanczos(img, up(img.width), up(img.height));
  return ddsChain(sized, fmt === 'DXT1' || fmt === 'DXT3' || fmt === 'DXT5' ? fmt : 'DXT5');
}

/** metres within which lamps are one light (a pole's flood beams and spill, a building's row of lamps) */
export const LAMP_MERGE = 15;
/** rFactor's intensity of a light of the track's strength (Joesville's lamps 1.5, LochDrummond's 10) */
const INTENSITY = 4;

/** The track's lights (aclights.ts's lightsData: lights.json's, the placed objects', the buildings') as rFactor's
 * omni lights, as its own tracks have only those, lit at night (named NightLight as theirs): those within LAMP_MERGE
 * of one another one light, as strong and reaching as far as the strongest and furthest of them (from their middle),
 * its colour theirs. */
export function nightLights(data: LightsData, axes: Axes = TRACK_TO_RF2): Light[] {
  type Lamp = { at: V3; strength: number; range: number; colour: V3; n: number };
  const lamps: Lamp[] = [];
  for (const l of data.lights) {
    const s = (data.series[String(l.series)] ?? {}) as Record<string, unknown>;
    const pick = <T>(k: string, d: T): T => (l[k] ?? s[k] ?? d) as T;
    if (l.on === false) continue;
    // (numbers as the track's JSON reads them: made plain)
    const at = (l.at as unknown[] | undefined)?.map(Number) as V3 | undefined;
    if (!at) continue;
    const lamp: Lamp = {
      at,
      strength: Number(pick('strength', 1)),
      range: Number(pick('range', 30)),
      colour: pick<unknown[]>('colour', [1, 1, 1]).map(Number) as V3,
      n: 1,
    };
    const near = lamps.find((o) => Math.hypot(o.at[0] - at[0], o.at[1] - at[1], o.at[2] - at[2]) < LAMP_MERGE);
    if (!near) {
      lamps.push(lamp);
      continue;
    }
    const n = near.n + 1;
    near.at = near.at.map((v, k) => (v * near.n + (at[k] as number)) / n) as V3;
    near.colour = near.colour.map((v, k) => (v * near.n + (lamp.colour[k] as number)) / n) as V3;
    near.strength = Math.max(near.strength, lamp.strength);
    near.range = Math.max(near.range, lamp.range);
    near.n = n;
  }
  return lamps.map((l, i) => ({
    name: `NightLight${String(i).padStart(2, '0')}`,
    pos: axes(l.at[0], l.at[1], l.at[2]),
    // (reaching its lamps' furthest from their middle, the merged ones' spread too)
    range: l.range + (l.n > 1 ? LAMP_MERGE / 2 : 0),
    intensity: Math.min(20, Math.max(0.5, l.strength * INTENSITY)),
    colour: l.colour.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)) as V3,
  }));
}

/** What a model's meshes are to rFactor: driven on (and stood on), hit unseen, or only seen. */
type Kind = 'surface' | 'wall' | 'visual';

interface Group {
  kind: Kind;
  visible: boolean;
  shadows: boolean;
  /** metres it is drawn from and to */
  near: number;
  far: number;
  /** RealRoad's (rubbered in, wetted) */
  deformable: boolean;
  meshes: { mesh: TrackMesh; ground: Ground | null }[];
}

/** metres a tile's side, by how far its meshes are drawn: a mesh drawn only near (a tyre stack's detail) in small
 * tiles, so only those near are drawn; the rest in larger */
export const tileSize = (far: number): number => (far <= 100 ? 50 : far <= 600 ? 150 : 250);

/** A mesh cut by the tiles its faces' middles fall in (x, z): each tile's faces, their corners renumbered. */
export function tilesOf(m: TrackMesh, size: number): Map<string, TrackMesh> {
  const cells = new Map<string, number[]>();
  for (let f = 0; f < m.f.length; f += 3) {
    let x = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      const o = (m.f[f + k] as number) * CORNER;
      x += m.v[o] as number;
      z += m.v[o + 2] as number;
    }
    const cell = `${Math.floor(x / 3 / size)},${Math.floor(z / 3 / size)}`;
    const l = cells.get(cell);
    if (l) l.push(f);
    else cells.set(cell, [f]);
  }
  const out = new Map<string, TrackMesh>();
  if (cells.size === 1) {
    out.set(cells.keys().next().value as string, m);
    return out;
  }
  for (const [cell, faces] of cells) {
    const at = new Map<number, number>();
    const v: number[] = [];
    const f: number[] = [];
    for (const first of faces)
      for (let k = 0; k < 3; k++) {
        const i = m.f[first + k] as number;
        let j = at.get(i);
        if (j === undefined) {
          j = v.length / CORNER;
          at.set(i, j);
          for (let c = 0; c < CORNER; c++) v.push(m.v[i * CORNER + c] as number);
        }
        f.push(j);
      }
    out.set(cell, { ...m, v: new Float32Array(v), f: new Uint32Array(f) });
  }
  return out;
}

/** The location made (see the module's note). */
export async function buildRf2(files: HostFiles, o: Rf2Options): Promise<Rf2Built> {
  const log = o.log ?? (() => {});
  const axes = o.axes ?? TRACK_TO_RF2;
  const project = o.project.replace(/[\\/]+$/, '');
  const readJson = async <T>(p: string): Promise<T> => JSON.parse(dec(await files.read(p)).replace(/^﻿/, '')) as T;
  const track = await readJson<{ name?: string; models?: string; layouts?: Record<string, { models?: string[] }> }>(
    `${project}/tools/reference/track.json`,
  );
  const trackName = track.name ?? 'Track';
  const venue = acFolder(trackName);
  const out = `${(o.out ?? `${project}/build/rf2`).replace(/[\\/]+$/, '')}/Locations/${venue}`;
  const models = `${project}/${track.models || 'track/models'}`;
  const libDoc = await readJson<{
    materials: Record<string, { colour?: string; alpha?: string; surface?: string }>;
    textures?: Record<string, TextureAc>;
  }>(`${project}/source/materials.json`);
  const lib = libDoc.materials;
  const texAc = libDoc.textures ?? {};
  const surfaces = (await files.exists(`${project}/source/surfaces.json`))
    ? ((
        await readJson<{ surfaces?: Record<string, { targets?: { rf2?: string } }> }>(`${project}/source/surfaces.json`)
      ).surfaces ?? {})
    : {};
  const objects = plain((await readPart(files, await settingsOf(files, project), 'objects')) ?? ({} as PyJson)) as {
    layouts?: Record<string, LayoutObjects & { lines?: RacingLines }>;
  };
  const lists = Object.fromEntries(Object.entries(track.layouts ?? {}).map(([k, v]) => [k, v.models ?? []]));
  const skipped: Record<string, string> = {};
  const layouts = (o.layouts ?? Object.keys(lists)).filter((l) => {
    if (!lists[l]?.length) skipped[l] = 'no models in track.json';
    else if (!objects.layouts?.[l]?.lines?.fast?.curve?.length) skipped[l] = 'no racing line (its AIW is made of it)';
    return !skipped[l];
  });
  if (!layouts.length) throw new Error(`no layout to make: ${JSON.stringify(skipped)}`);
  const written: string[] = [];
  const put = async (path: string, data: Uint8Array | string) => {
    await files.write(path, typeof data === 'string' ? enc(data) : data);
    written.push(path);
  };

  // ---- textures: each library colour as the AC build's DDS of it, once
  const maps = `${out}/Assets/Maps`;
  const ddsCache = `${project}/build/cache/dds`;
  const textures = new Map<string, string>();
  // (32 bits a pixel: Direct3D 11, rFactor's, has no 24-bit format)
  await put(`${maps}/${WHITE}`, ddsOf({ width: 4, height: 4, mode: 'RGBA', data: new Uint8Array(64).fill(255) }));
  const textureOf = async (png: string | undefined, stem: string): Promise<string> => {
    if (!png) return WHITE;
    const own = `${project}/source/textures/${stem}/${png}`;
    const isOwn = await files.exists(own);
    const src = isOwn ? own : `${project}/source/textures/${png}`;
    const name = fileName(`${isOwn ? `${stem}_` : ''}${png.replace(/\.[^.]*$/, '')}.dds`);
    if (textures.has(src)) return textures.get(src) as string;
    if (!(await files.exists(src))) {
      log(`  ${png}: no such texture, drawn white`);
      textures.set(src, WHITE);
      return WHITE;
    }
    const b = await files.read(src);
    const fmt = texAc[png]?.ac ?? 'DXT1';
    const key = await sha1([b, enc(fmt), new Uint8Array([texAc[png]?.normal ? 1 : 0])]);
    const kept = `${ddsCache}/${key}.dds`;
    let dds: Uint8Array;
    if (await files.exists(kept)) dds = await files.read(kept);
    else {
      dds = await acDds(`${png.replace(/\.[^.]*$/, '')}.dds`, b, texAc);
      await files.write(kept, dds);
    }
    if (!powerOfTwoDds(dds)) dds = await squareDds(b, fmt);
    await put(`${maps}/${name}`, dds);
    textures.set(src, name);
    return name;
  };
  /** An editor's model's own picture (inside its model) as a DDS of sides powers of two, once a picture: DXT5 where
   * it shows through, else DXT1. */
  const ownTextureOf = async (own: OwnMaterial): Promise<string> => {
    const pic = own.colour;
    if (!pic) return WHITE;
    const hash = await sha1([pic.data]);
    const src = `own:${hash}`;
    if (textures.has(src)) return textures.get(src) as string;
    const name = fileName(`own_${hash.slice(0, 8)}_${pic.name.replace(/\.[^.]*$/, '')}.dds`);
    let img: Awaited<ReturnType<typeof readPicture>>;
    try {
      img = await readPicture(pic.data);
    } catch (e) {
      log(`  ${pic.name}: ${(e as Error).message}, drawn white`);
      textures.set(src, WHITE);
      return WHITE;
    }
    const up = (n: number) => Math.min(4096, 2 ** Math.ceil(Math.log2(Math.max(n, 4))));
    const sized = pow2(img.width) && pow2(img.height) ? img : resizeLanczos(img, up(img.width), up(img.height));
    await put(`${maps}/${name}`, ddsChain(convert(sized, 'RGBA'), own.alpha === 'opaque' ? 'DXT1' : 'DXT5'));
    textures.set(src, name);
    return name;
  };

  // ---- each model's meshes as GMTs, a GMT for each kind of them
  const gmtDir = `${out}/Assets/GMT`;
  const stems = [...new Set(layouts.flatMap((l) => lists[l] ?? []))];
  const instancesOf = new Map<string, Instance[]>();
  const floorParts = new Map<string, { floor: Float64Array[]; road: Float64Array[] }>();
  const grounds = new Map<string, Ground>();
  let gmts = 0;
  for (const stem of stems) {
    const path = `${models}/${stem}.glb`;
    if (!(await files.exists(path))) {
      log(`  ${stem}: no model ${path}, left out`);
      instancesOf.set(stem, []);
      continue;
    }
    const meshes = trackModel(await files.read(path));
    const groups = new Map<string, Group>();
    const floor: Float64Array[] = [];
    const road: Float64Array[] = [];
    for (const m of meshes) {
      if (!m.f.length) continue;
      const kind: Kind = m.role === 'surface' ? 'surface' : m.role === 'wall' ? 'wall' : 'visual';
      const g0 = kind === 'visual' ? null : meshGround(m, lib);
      const ground = g0 ? groundOf(g0, surfaces) : null;
      if (ground) grounds.set(ground.prefix, ground);
      if (kind === 'surface') {
        const T = new Float64Array(m.f.length * 3);
        for (let i = 0; i < m.f.length; i++)
          for (let j = 0; j < 3; j++) T[i * 3 + j] = m.v[(m.f[i] as number) * CORNER + j] as number;
        floor.push(T);
        if (g0 && ROADS.has(g0)) road.push(T);
      }
      const near = m.draw[0] ?? 0;
      // (as far as its model says; else the ground and what is driven on to the horizon, the rest not so far)
      const far = m.draw[1] ?? (kind === 'surface' ? DRAW_FAR : SEEN_FAR);
      // (only the roads and rumbles rubbered in and wetted by RealRoad, as Joesville's race surface: not the grass)
      const deformable = kind === 'surface' && !!ground && DEFORMED.has(ground.prefix);
      // (in tiles, each its own GMTs: rFactor culls and draws near or far by a whole GMT, so each keeps to its tile)
      for (const [cell, part] of tilesOf(m, tileSize(far))) {
        const key = `${kind}|${m.visible}|${m.shadows}|${near}|${far}|${deformable}|${cell}`;
        let g = groups.get(key);
        if (!g) {
          g = { kind, visible: m.visible, shadows: m.shadows, near, far, deformable, meshes: [] };
          groups.set(key, g);
        }
        g.meshes.push({ mesh: part, ground });
      }
    }
    floorParts.set(stem, { floor, road });
    const inst: Instance[] = [];
    let n = 0;
    // (each material made once for the model)
    const made = new Map<string, GmtMaterial>();
    for (const g of groups.values()) {
      // (filled up to the samples' limits, a new GMT after; one mesh a material)
      let fill = new GmtFill();
      const flush = async () => {
        if (fill.empty) return;
        const name = fileName(`${stem}_${g.kind}_${n++}`);
        await put(`${gmtDir}/${name}.gmt`, writeGmt(staticGmt(name, fill.meshes, fill.materials, g.far, g.near)));
        gmts++;
        inst.push({
          name,
          mesh: `${name}.gmt`,
          collide: g.kind !== 'visual',
          hat: g.kind === 'surface',
          deformable: g.deformable,
          render: g.visible ? undefined : false,
          // (a surface casts none: rFactor drops Deformable from a shadow caster, as the samples' race surfaces cast none;
          // nor does a mesh drawn only near, a tyre stack's detail: its far stand-in casts its shadow)
          shadows: g.visible && g.shadows && g.kind !== 'surface' && g.far > 100,
        });
        fill = new GmtFill();
      };
      for (const { mesh, ground } of g.meshes) {
        // (an editor's model's own: its picture and alpha, never the library's of its name)
        const own = mesh.own;
        const e = own ? { alpha: own.alpha } : mesh.material ? lib[mesh.material] : undefined;
        const name = materialName(
          own
            ? `${mesh.material ?? 'material'}_own_${own.colour?.name.replace(/\.[^.]*$/, '') ?? ''}`
            : (mesh.material ?? 'hidden'),
          ground,
        );
        let mat = made.get(name);
        if (!mat) {
          const tex = !g.visible
            ? WHITE
            : own
              ? await ownTextureOf(own)
              : await textureOf(lib[mesh.material ?? '']?.colour, stem);
          mat = diffuseMaterial(name, tex, e?.alpha === 'blend' ? 'blend' : e?.alpha === 'mask' ? 'mask' : 'opaque');
          made.set(name, mat);
        }
        const gm = gmtMeshOf(mesh, 0, axes);
        if (!gm) continue;
        for (const piece of gmtPieces(gm)) {
          if (!fill.fits(piece, mat)) await flush();
          fill.add(piece, mat);
        }
      }
      await flush();
    }
    instancesOf.set(stem, inst);
    log(`  ${stem}: ${inst.length} GMT${inst.length === 1 ? '' : 's'}`);
  }

  // ---- the grounds
  // ---- the lamps, lit at night (the track's, as the AC build has them)
  const lights = nightLights(await lightsData(files, project, models), axes);
  log(`  ${lights.length} lights at night`);

  const tdf = `${venue}.tdf`;
  await put(`${out}/${tdf}`, tdfText([...grounds.values()]));

  // ---- each layout: its scene, GDB, weather, AIW and timing beams
  const together = (parts: Float64Array[]) => {
    const all = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return new Surface(all);
  };
  const uiOf = async (l: string) => {
    const p = `${project}/source/track/ui/${l}/ui_track.json`;
    return (await files.exists(p)) ? await readJson<Record<string, string>>(p) : {};
  };
  for (const l of layouts) {
    const dir = `${out}/${l}`;
    const lay = objects.layouts?.[l] as LayoutObjects & { lines: RacingLines };
    const parts = (lists[l] ?? []).map((s) => floorParts.get(s) ?? { floor: [], road: [] });
    const F = together(parts.flatMap((p) => p.floor));
    const R = together(parts.flatMap((p) => p.road));
    const floor = (x: number, z: number) => F.y(x, z);
    const onRoad = (x: number, z: number) => !Number.isNaN(R.y(x, z));
    const fast = aiLineOf(lay.lines.fast as RacingLine, floor, onRoad);
    const pit = lay.lines.pit?.curve?.length ? aiLineOf(lay.lines.pit, floor, onRoad, STEP, {}) : null;
    const input = { layout: lay, fast, pit, floor, axes };
    await put(`${dir}/${l}.AIW`, aiwText(input));
    const timing = aiwTiming(input);
    const beams: Instance[] = [];
    for (const b of timing.beams) {
      await put(`${dir}/${b.name}.gmt`, writeGmt(beamGmt(b)));
      beams.push({
        name: b.name,
        mesh: `${b.name}.gmt`,
        collide: true,
        hat: false,
        render: false,
        response: b.name === 'xpitin' || b.name === 'xpitout' ? 'VEHICLE,PITSTOP' : 'VEHICLE,TIMING',
      });
    }
    // (its fixed reflections seen from the middle of its start line, 2 m over it)
    const finish = timing.beams.find((b) => b.name === 'xfinish') ?? timing.beams[0];
    const centre: [number, number, number] | undefined = finish
      ? [
          (finish.left[0] + finish.right[0]) / 2,
          (finish.left[1] + finish.right[1]) / 2 + 2,
          (finish.left[2] + finish.right[2]) / 2,
        ]
      : undefined;
    const ui = await uiOf(l);
    const title = ui.name || `${trackName} ${l}`;
    await put(
      `${dir}/${l}.scn`,
      scnText({
        searchPaths: ['.', venue, `${venue}\\${l}`, `${venue}\\Assets\\GMT`, `${venue}\\Assets\\Maps`],
        instances: [...(lists[l] ?? []).flatMap((s) => instancesOf.get(s) ?? []), ...beams],
        lights,
        centre,
      }),
    );
    await put(
      `${dir}/${l}.gdb`,
      gdbText({
        id: l,
        trackName: title,
        eventName: title,
        venueName: trackName,
        length: timing.lap,
        tdf: `..\\${tdf}`,
        location: ui.city && ui.country ? `${ui.city}, ${ui.country}` : undefined,
      }),
    );
    await put(`${dir}/${l}.wet`, wetText());
    log(`  ${l}: ${(timing.lap / 1000).toFixed(3)} km, ${beams.length} timing beams`);
  }

  // ---- tried in rFactor 2's Mod Mode: the location copied into its ModDev/Locations
  let installed: string | null = null;
  if (o.install) {
    installed = `${o.install.replace(/[\\/]+$/, '')}/ModDev/Locations/${venue}`;
    for (const p of written) await files.write(`${installed}${p.slice(out.length)}`, await files.read(p));
    log(`  copied into ${installed}`);
  }
  return { location: out, venue, layouts, gmts, textures: textures.size + 1, skipped, installed };
}
