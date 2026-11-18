// The track's floor made by the engine (TRACK_FORMAT's track/models; the track's merge_floor.py, in the editor's
// layers): the hand-made floors of its models laid on the place (drape_track's rule: a paved top ROAD over the
// ground, the grass on it, an old kerb moved by what the ground moved under it), merged with the roads described
// (roads.json: each made from its description, its rumbles over all), the ground the place's, over a window round all
// of it; each region's mesh written back into the model its region came from, in its material, one normal at each
// point across the seams. The hand-made ground (the near ground, its old strips) gives way to the place's.

import { type Kn5Model, meshNode } from './floorwrite';
import { type Kn5, type Kn5Mesh, type Mat4, VERT } from './kn5tree';
import { above } from './layer';
import { type Filler, type MergeOptions, type Mesh, merge, type Region } from './merge';
import { meshes, triangles } from './mesh';
import { KERB_MATERIALS, kerbGeometry, pictureAspects, type Roads } from './paint';
import { type PlaceHost, placeOf } from './placehost';
import { asBuilt, fine, mesh, priority, type RoadDesc, type RoadMesh } from './roads';
import { crop, roadsTop } from './roadshost';
import { Surface } from './surface';
import type { Box } from './tiles';
import type { Triangle } from './triangle';

/** names a floor's meshes start with (merge_floor's FLOOR); the far ground's; those the merge leaves out */
const FLOOR = ['1ROAD', '1KERB', '1GRASS', 'GRASS', 'KERB'];
const FAR = ['GRASS_1', 'FAR_GROUND'];
const DROP = ['1GRASS_EDGE_RAMP', 'GRASS_FOLDS', 'SKIRT_', 'KERB_BED_SKIRT_', '1ROAD_KERB_E_'];
const SIDE = /^KERB_.*_SIDE$/;
/** the track's ground, and the old strips in it (build_paths' GROUND, FILLER) */
export const GROUND = '1GRASS_0';
const FILLER = '1GRASS_PATHS';
/** metres a road lies over the ground (drape_track's ROAD) */
export const ROAD = 0.02;
/** a face is a top when its normal rises at least this much of its length (merge_floor's UP) */
const UP = 0.3;
/** metres round the floors the window reaches */
const NEAR = 6;
/** metres between the ground's own points */
const SPACING = 2;

export type FloorKind = 'road' | 'drop' | 'ground' | 'far' | 'kerb' | 'paved' | 'grass';

/** What a mesh is in the merge (merge_floor's kind): null, not a floor. */
export function floorKind(name: string, described: Set<string>): FloorKind | null {
  const u = name.toUpperCase();
  if (!FLOOR.some((p) => u.startsWith(p))) return null;
  if (FAR.some((p) => u.startsWith(p))) return 'far';
  if (described.has(name)) return 'road';
  if (DROP.some((p) => name.startsWith(p)) || SIDE.test(name)) return 'drop';
  if (name === GROUND || new RegExp(`^${GROUND}_\\d+$`).test(name) || name === FILLER) return 'ground';
  if (name.startsWith('1ROAD_KERB_') && !name.startsWith('1ROAD_KERB_BED_')) return 'kerb';
  if (['1ROAD', '1KERB', 'KERB'].some((p) => u.startsWith(p))) return 'paved';
  return 'grass';
}

/** The paved and the grass among themselves: a kerb's bed first, the paving, then by name (merge_floor's order_key). */
const orderKey = (name: string): [number, string] => [
  name.includes('KERB_BED') || name.includes('KERB_FILL') ? 0 : name.startsWith('1KERB') ? 1 : 2,
  name,
];

/** A mesh's tops: its triangles facing up (nine numbers each), their corners' mapping (six each). */
function tops(n: Kn5Mesh, m: Mat4): { T: Float64Array; UV: Float64Array } {
  const all = triangles(n, m);
  const T: number[] = [];
  const UV: number[] = [];
  for (let f = 0; f < n.faces.length / 3; f++) {
    const c = [n.faces[f * 3] as number, n.faces[f * 3 + 1] as number, n.faces[f * 3 + 2] as number];
    if (c[0] === c[1] || c[1] === c[2] || c[0] === c[2]) continue;
    const t = all.subarray(f * 9, f * 9 + 9);
    const ux = (t[3] as number) - (t[0] as number);
    const uy = (t[4] as number) - (t[1] as number);
    const uz = (t[5] as number) - (t[2] as number);
    const vx = (t[6] as number) - (t[0] as number);
    const vy = (t[7] as number) - (t[1] as number);
    const vz = (t[8] as number) - (t[2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (ny < UP * Math.hypot(nx, ny, nz)) continue;
    T.push(...t);
    for (const v of c) UV.push(n.verts[v * 11 + 6] as number, n.verts[v * 11 + 7] as number);
  }
  return { T: Float64Array.from(T), UV: Float64Array.from(UV) };
}

/** A floor's tops laid on the place (drape_track's rule): paved ROAD over the ground, grass on it, an old kerb (and
 * anything else) moved by what the ground moved under it from the hand-made ground. */
function laid(
  T: Float64Array,
  kind: FloorKind,
  ground: (x: number, z: number) => number,
  before: Surface | null,
  carried: ((x: number, z: number) => number | null) | null = null,
) {
  const out = Float64Array.from(T);
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i] as number;
    const z = out[i + 2] as number;
    const g = ground(x, z);
    // (ROAD over the ground along its normal: layer.ts)
    if (kind === 'paved') out[i + 1] = above(ground, x, z, ROAD);
    else if (kind === 'grass') out[i + 1] = g;
    else {
      // (an old kerb, driven on: by what the road beside it moved, carried out to it (drape_track's); else by what
      // the ground moved under it)
      const c = carried?.(x, z) ?? null;
      const b = before?.y(x, z) ?? Number.NaN;
      out[i + 1] = (out[i + 1] as number) + (c !== null ? c : Number.isNaN(b) ? 0 : g - b);
    }
  }
  return out;
}

/** metres from the roads their change is carried out to (drape_track's CARRY) */
const CARRY = 12;

/** What the roads moved, carried out from them (drape_track's: the kerbs move as the roads round them moved): at a
 * point, the change at the nearest point of the roads' hand-made meshes (their points, from where the mesh had them to
 * where the road as built lies there), within CARRY; null farther. */
function carriedChange(old: Float64Array[], built: Surface): (x: number, z: number) => number | null {
  const C = 4;
  const cells = new Map<string, number[]>();
  const pts: number[] = [];
  for (const T of old)
    for (let i = 0; i < T.length; i += 3) {
      const [x, y, z] = [T[i] as number, T[i + 1] as number, T[i + 2] as number];
      const now = built.y(x, z);
      if (Number.isNaN(now)) continue;
      const k = `${Math.floor(x / C)},${Math.floor(z / C)}`;
      const l = cells.get(k) ?? [];
      l.push(pts.length);
      cells.set(k, l);
      pts.push(x, z, now - y);
    }
  const reach = Math.ceil(CARRY / C);
  return (x, z) => {
    let best = CARRY;
    let d: number | null = null;
    const cx = Math.floor(x / C);
    const cz = Math.floor(z / C);
    for (let r = 0; r <= reach; r++) {
      // (rings of cells out to the nearest found: a point found closer than the next ring's nearest is it)
      for (let i = cx - r; i <= cx + r; i++)
        for (let j = cz - r; j <= cz + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cz)) !== r) continue;
          for (const k of cells.get(`${i},${j}`) ?? []) {
            const e = Math.hypot((pts[k] as number) - x, (pts[k + 1] as number) - z);
            if (e < best) {
              best = e;
              d = pts[k + 2] as number;
            }
          }
        }
      if (d !== null && best <= r * C) break;
    }
    return d;
  };
}

/** Triangles within margin of a box (merge_floor's crop). */
function cropTris(T: Float64Array, UV: Float64Array, w: Box, margin = 2) {
  const t: number[] = [];
  const u: number[] = [];
  for (let f = 0; f < T.length / 9; f++) {
    const xs = [T[f * 9] as number, T[f * 9 + 3] as number, T[f * 9 + 6] as number];
    const zs = [T[f * 9 + 2] as number, T[f * 9 + 5] as number, T[f * 9 + 8] as number];
    if (Math.max(...xs) < w.x0 - margin || Math.min(...xs) > w.x1 + margin) continue;
    if (Math.max(...zs) < w.z0 - margin || Math.min(...zs) > w.z1 + margin) continue;
    t.push(...T.subarray(f * 9, f * 9 + 9));
    u.push(...UV.subarray(f * 6, f * 6 + 6));
  }
  return { tris: Float64Array.from(t), uvs: Float64Array.from(u) };
}

/** metres from a road's edge an old kerb's top lies, for it to go (build_kerbs' OLD_NEAR) */
const OLD_NEAR = 2;

/** The old kerbs along the roads that have rumbles described (build_kerbs' old_kerbs): their names (each the base
 * after 1ROAD_KERB_), from their tops within OLD_NEAR of such a road's edge (the median of every seventh point). */
export function oldKerbs(models: Kn5[], roads: RoadDesc[]): Set<string> {
  // (the roads' edges: each one's outline, its left side out and its right back)
  const segs: number[] = [];
  for (const r of roads as (RoadDesc & { kerbs?: unknown[]; along?: unknown })[]) {
    if (!r.kerbs?.length || r.along) continue;
    const f = fine(r);
    const ring: [number, number][] = [];
    for (let i = 0; i < f.mx.length; i++)
      ring.push([
        (f.mx[i] as number) + (f.lx[i] as number) * (f.wl[i] as number),
        (f.mz[i] as number) + (f.lz[i] as number) * (f.wl[i] as number),
      ]);
    for (let i = f.mx.length - 1; i >= 0; i--)
      ring.push([
        (f.mx[i] as number) - (f.lx[i] as number) * (f.wr[i] as number),
        (f.mz[i] as number) - (f.lz[i] as number) * (f.wr[i] as number),
      ]);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as [number, number];
      const b = ring[(i + 1) % ring.length] as [number, number];
      segs.push(a[0], a[1], b[0], b[1]);
    }
  }
  const out = new Set<string>();
  if (!segs.length) return out;
  // (filed by cells: a point's distance looked for within the cells round it, OLD_NEAR or more is far)
  const C = 4;
  const cells = new Map<string, number[]>();
  for (let s = 0; s < segs.length; s += 4) {
    const [x0, z0, x1, z1] = [segs[s] as number, segs[s + 1] as number, segs[s + 2] as number, segs[s + 3] as number];
    for (let gx = Math.floor(Math.min(x0, x1) / C); gx <= Math.floor(Math.max(x0, x1) / C); gx++)
      for (let gz = Math.floor(Math.min(z0, z1) / C); gz <= Math.floor(Math.max(z0, z1) / C); gz++) {
        const k = `${gx},${gz}`;
        const l = cells.get(k);
        if (l) l.push(s);
        else cells.set(k, [s]);
      }
  }
  const near = (x: number, z: number) => {
    let best = Infinity;
    const gx = Math.floor(x / C);
    const gz = Math.floor(z / C);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gz - 1; j <= gz + 1; j++)
        for (const s of cells.get(`${i},${j}`) ?? []) {
          const [x0, z0, x1, z1] = [
            segs[s] as number,
            segs[s + 1] as number,
            segs[s + 2] as number,
            segs[s + 3] as number,
          ];
          const dx = x1 - x0;
          const dz = z1 - z0;
          const l2 = dx * dx + dz * dz;
          const t = l2 ? Math.min(1, Math.max(0, ((x - x0) * dx + (z - z0) * dz) / l2)) : 0;
          best = Math.min(best, Math.hypot(x - x0 - t * dx, z - z0 - t * dz));
        }
    return best;
  };
  for (const k of models)
    for (const [n, m] of meshes(k)) {
      const nm = n.name;
      if (!nm.startsWith('1ROAD_KERB_') || nm.startsWith('1ROAD_KERB_E_') || nm.startsWith('1ROAD_KERB_BED_')) continue;
      if (!n.faces.length) continue;
      const T = triangles(n, m);
      const d: number[] = [];
      for (let i = 0; i < T.length / 3; i += 7) d.push(near(T[i * 3] as number, T[i * 3 + 2] as number));
      d.sort((a, b) => a - b);
      // (numpy's median: the middle two's mean where there is an even number)
      const h = d.length / 2;
      const med = d.length % 2 ? (d[Math.floor(h)] as number) : ((d[h - 1] as number) + (d[h] as number)) / 2;
      if (med < OLD_NEAR) out.add(nm.slice('1ROAD_KERB_'.length));
    }
  return out;
}

/** Whether a mesh is one of an old kerb's parts (build_kerbs' parts_of; base: its name after 1ROAD_KERB_). */
export function partsOf(base: string, name: string): boolean {
  const nm = name.startsWith('SKIRT_') ? name.slice('SKIRT_'.length) : name;
  const bed = `KERB_BED_SKIRT_${base}_`;
  return (
    nm === `1ROAD_KERB_${base}` ||
    nm === `KERB_${base}_SIDE` ||
    nm === `1GRASS_KERB_BED_${base}` ||
    nm === `1GRASS_KERB_FILL_${base}` ||
    (nm.startsWith(bed) && ['GRASS', 'ASPHALT'].includes(nm.slice(bed.length))) ||
    nm === `1ROAD_KERB_BED_${base}` ||
    nm.startsWith(`1ROAD_KERB_BED_${base}_`)
  );
}

/** Where each region's mesh goes: its model, the node it takes after (its flags), its material's name. */
export interface Owner {
  model: string;
  template: Kn5Mesh | null;
  material: string;
  /** the meshes it takes the place of in its model, by name */
  replaces: string[];
  /** grass grows on it (the ground, where no hand-made ground says) */
  grass?: boolean;
}

export interface FloorOptions {
  project: string;
  /** the floors' models (by default the track's hand-made: source/models), by file */
  models: Record<string, Kn5>;
  roads: RoadDesc[];
  terrain?: string;
  /** the model the rumbles go into (by default the one holding old kerbs, else the first) */
  rumbles?: string;
  /** given, the regions handed to it and nothing merged nor written */
  regionsOnly?: (regions: Region[], window: Box) => Promise<void> | void;
  /** only so much of the map merged (by default round every road and floor): a look at one place */
  window?: Box;
  /** the far ground made again round the merged floor, out to area (the land round the track's pictures: x and z,
   * metres), by the triangulator given */
  far?: { area: [[number, number], [number, number]]; triangle: Triangle };
  /** the floors the editor makes besides the roads (its paved areas), by their meshes' names: merged as paving. Every
   * other floor of the models (old paving, grass, kerbs) is out: the floor is the roads, the rumbles, these and the
   * ground. Not given: the old floors laid and merged as they were */
  own?: string[];
  /** the ground's material and its picture's mapping, where no hand-made ground gives them */
  ground?: { material: string; uv: (x: number, z: number) => [number, number] };
  log?: (line: string) => void;
}

export interface FloorMade {
  window: Box;
  /** each model's merged meshes, by name (merged_floors.json) */
  merged: Record<string, string[]>;
  regions: number;
  faces: number;
  meshes: Record<string, Mesh>;
  owners: Record<string, Owner>;
  /** the far ground, where made */
  far?: Mesh;
}

/** The floor merged, each model given its meshes (the models changed in place). */
export async function buildFloor(
  host: PlaceHost,
  filler: Filler,
  o: FloorOptions,
  more: Omit<MergeOptions, 'cache' | 'log'> = {},
): Promise<FloorMade> {
  const log = o.log ?? (() => {});
  const roads = Object.fromEntries(o.roads.map((r) => [r.name, r])) as Record<string, RoadDesc>;
  const described = new Set<string>([
    ...Object.keys(roads),
    ...o.roads.flatMap((r) => {
      const m = (r as unknown as { mesh?: unknown }).mesh;
      return typeof m === 'string' ? [m] : [];
    }),
  ]);
  const place = await placeOf(host, o.project, o.terrain);
  const ground = place.ground.y.bind(place.ground);
  // (the hand-made ground: what the hand-made floors were laid on, to move what stands on it by the change)
  const files = Object.keys(o.models);
  // (the old kerbs along the roads with rumbles described, in any of the models: out, every part of them)
  const gone = o.roads.some((r) => (r as { kerbs?: unknown[] }).kerbs?.length)
    ? oldKerbs(Object.values(o.models), o.roads)
    : new Set<string>();
  const groundTops: Float64Array[] = [];
  const found = new Map<string, { kind: FloorKind; file: string; node: Kn5Mesh; parts: [Kn5Mesh, Mat4][] }>();
  for (const f of files) {
    for (const [n, m] of meshes(o.models[f] as Kn5)) {
      if (!n.faces.length) continue;
      const kind0 = floorKind(n.name, described);
      if (!kind0) continue;
      const kind: FloorKind =
        kind0 !== 'road' && kind0 !== 'drop' && [...gone].some((b) => partsOf(b, n.name)) ? 'drop' : kind0;
      if (kind === 'ground') groundTops.push(tops(n, m).T);
      const key = `${kind}|${f}|${n.name}`;
      const g = found.get(key) ?? { kind, file: f, node: n, parts: [] };
      g.parts.push([n, m]);
      found.set(key, g);
    }
  }
  const beforeT = new Float64Array(groundTops.reduce((a, t) => a + t.length, 0));
  let at = 0;
  for (const t of groundTops) {
    beforeT.set(t, at);
    at += t.length;
  }
  const before = beforeT.length ? new Surface(beforeT) : null;
  // (the roads described, each made from its description on its own heights or the place's)
  const built = priority(roads as Roads).map((name) => {
    const rr = asBuilt(roads[name] as RoadDesc, roads as Roads);
    return { name, m: (rr.heights ? mesh(rr) : mesh(rr, ground)) as RoadMesh };
  });
  // (what the roads moved from their hand-made meshes to as built: carried out to the old kerbs beside them)
  const oldRoads = [...found.values()]
    .filter((g) => g.kind === 'road')
    .flatMap((g) => g.parts.map(([n, m]) => triangles(n, m)));
  const builtT = (() => {
    const parts = built.map(({ m }) => {
      const T = new Float64Array(m.F.length * 3);
      for (let k = 0; k < m.F.length; k++)
        T.set(m.P.subarray((m.F[k] as number) * 3, (m.F[k] as number) * 3 + 3), k * 3);
      return T;
    });
    const all = new Float64Array(parts.reduce((a, t) => a + t.length, 0));
    let at2 = 0;
    for (const t of parts) {
      all.set(t, at2);
      at2 += t.length;
    }
    return all;
  })();
  const carried = oldRoads.length && builtT.length ? carriedChange(oldRoads, new Surface(builtT)) : null;
  // (the hand-made floors laid on the place, by kind)
  const groups: Record<
    'kerb' | 'paved' | 'grass',
    { name: string; file: string; node: Kn5Mesh; T: Float64Array; UV: Float64Array }[]
  > = { kerb: [], paved: [], grass: [] };
  const dropped: { file: string; name: string }[] = [];
  const own = o.own ? new Set(o.own) : null;
  let old = 0;
  for (const g of found.values()) {
    // (an old floor the editor does not make: out, emptied as the rest it replaces)
    const leftover = own !== null && g.kind !== 'far' && !own.has(g.node.name);
    if (leftover && (g.kind === 'kerb' || g.kind === 'paved' || g.kind === 'grass')) old++;
    if (g.kind === 'road' || g.kind === 'drop' || g.kind === 'ground' || g.kind === 'far' || leftover) {
      if (g.kind !== 'far') dropped.push({ file: g.file, name: g.node.name });
      continue;
    }
    const ts = g.parts.map(([n, m]) => tops(n, m));
    const T = new Float64Array(ts.reduce((a, t) => a + t.T.length, 0));
    const UV = new Float64Array(ts.reduce((a, t) => a + t.UV.length, 0));
    let p = 0;
    let q = 0;
    for (const t of ts) {
      T.set(laid(t.T, g.kind, ground, before, carried), p);
      UV.set(t.UV, q);
      p += t.T.length;
      q += t.UV.length;
    }
    if (T.length) groups[g.kind].push({ name: g.node.name, file: g.file, node: g.node, T, UV });
  }
  if (old) log(`${old} old floors out (not the editor's)`);
  // (the window: round every road and floor)
  const w = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  const take = (P: ArrayLike<number>) => {
    for (let i = 0; i < P.length; i += 3) {
      w.x0 = Math.min(w.x0, P[i] as number);
      w.x1 = Math.max(w.x1, P[i] as number);
      w.z0 = Math.min(w.z0, P[i + 2] as number);
      w.z1 = Math.max(w.z1, P[i + 2] as number);
    }
  };
  for (const { m } of built) take(m.P);
  for (const k of Object.values(groups)) for (const g of k) take(g.T);
  const window: Box = o.window ?? {
    x0: Math.floor(w.x0 - NEAR),
    z0: Math.floor(w.z0 - NEAR),
    x1: Math.ceil(w.x1 + NEAR),
    z1: Math.ceil(w.z1 + NEAR),
  };
  // (the regions, in merge_floor's order: the rumbles over all, the roads described, the old kerbs, the paved, the
  // grass, the ground)
  const regions: Region[] = [];
  const owners: Record<string, Owner> = {};
  const firstModel = files[0] as string;
  const roadModel = (name: string) =>
    files.find((f) => meshes(o.models[f] as Kn5).some(([n]) => n.name === name)) ?? firstModel;
  const kerbModel =
    o.rumbles ??
    files.find((f) => meshes(o.models[f] as Kn5).some(([n]) => n.name.startsWith('1ROAD_KERB_'))) ??
    firstModel;
  const top = roadsTop(built);
  // (the rumbles' pictures as long as they are: their proportions)
  const aspects = await pictureAspects(host.files, o.project, KERB_MATERIALS);
  for (const { name } of built) {
    const r = roads[name] as RoadDesc & { along?: unknown; kerbs?: unknown[] };
    if (r.along) continue;
    const num = name.replace(/^1(ROAD|KERB)_/, '');
    ((r.kerbs ?? []) as Parameters<typeof kerbGeometry>[1][]).forEach((k, i) => {
      for (const g of kerbGeometry(r as never, k, roads as Roads, top, (m) => aspects[m], ground)) {
        const c = crop({ P: g.P, U: g.U, F: g.F }, window);
        if (!c) continue;
        const rn = `1ROAD_KERB_E_${num}_${i}${g.suffix}`;
        regions.push({ name: rn, ...c });
        owners[rn] = { model: kerbModel, template: null, material: g.material, replaces: [] };
      }
    });
  }
  for (const { name, m } of built) {
    const c = crop(m, window);
    if (!c) continue;
    regions.push({ name, ...c });
    const r = roads[name] as RoadDesc & { material?: string; mesh?: string };
    const model = roadModel(r.mesh ?? name);
    owners[name] = { model, template: null, material: r.material ?? 'Tarmac Dark', replaces: [] };
  }
  const names = new Set(regions.map((r) => r.name));
  for (const kind of ['kerb', 'paved', 'grass'] as const) {
    const sorted = [...groups[kind]].sort((a, b) => {
      const [ka, na] = orderKey(a.name);
      const [kb, nb] = orderKey(b.name);
      return ka - kb || (na < nb ? -1 : na > nb ? 1 : 0);
    });
    for (const g of sorted) {
      const c = cropTris(g.T, g.UV, window);
      if (!c.tris.length) continue;
      const rn = names.has(g.name) ? `${g.name}@${g.file}` : g.name;
      names.add(rn);
      regions.push({ name: rn, ...c });
      const k = o.models[g.file] as Kn5;
      owners[rn] = {
        model: g.file,
        template: g.node,
        material: k.materials[g.node.material]?.name ?? '',
        replaces: [g.name],
      };
    }
  }
  const groundModel = files.find((f) => meshes(o.models[f] as Kn5).some(([n]) => n.name === GROUND)) ?? firstModel;
  const groundAt = meshes(o.models[groundModel] as Kn5).find(([n]) => n.name === GROUND);
  const groundNode = groundAt?.[0] ?? null;
  // (mapped as the ground it takes the place of was: a picture over the whole place (the satellite's) stays one
  // picture; none, or not mapped flat: a picture every 50 m)
  const uv =
    (groundAt && flatMapping(groundAt[0], groundAt[1])) ??
    o.ground?.uv ??
    ((x: number, z: number): [number, number] => [x / 50, z / 50]);
  regions.push({ name: GROUND, ground: { height: ground, uv, spacing: SPACING } });
  owners[GROUND] = {
    model: groundModel,
    template: groundNode,
    material: groundNode
      ? ((o.models[groundModel] as Kn5).materials[groundNode.material]?.name ?? '')
      : (o.ground?.material ?? 'Grass'),
    replaces: [GROUND],
    // (grass on the ground made here: the hand-made one said so itself)
    ...(groundNode ? {} : { grass: true }),
  };
  log(
    `${regions.length} regions: ${built.length} roads described, ${groups.kerb.length} old kerbs, ` +
      `${groups.paved.length} paved, ${groups.grass.length} grass; the window ${window.x1 - window.x0} by ${window.z1 - window.z0} m`,
  );
  // (only the regions, where asked: to look at them before a merge)
  if (o.regionsOnly) {
    await o.regionsOnly(regions, window);
    return { window, merged: {}, regions: regions.length, faces: 0, meshes: {}, owners };
  }
  const result = await merge(regions, window, filler, {
    ...more,
    log: (s, ms) => log(`  ${s} ${(ms / 1000).toFixed(1)} s`),
  });
  // (written: the meshes it takes the place of emptied, each region's mesh in its model, one normal at each point)
  writeFloor(o.models, result, owners, dropped);
  // (the far ground made again round it, in place of the hand-made one: in its model, under its first mesh's name)
  let farMesh: Mesh | undefined;
  if (o.far) {
    const fars = files.flatMap((f) =>
      meshes(o.models[f] as Kn5).flatMap(([n]) => (floorKind(n.name, described) === 'far' ? [[f, n] as const] : [])),
    );
    const g = farGround(result, window, o.far.area, ground, o.far.triangle);
    farMesh = g;
    const [file, template] = fars[0] ?? [groundModel, groundNode];
    for (const [, n] of fars) n.faces = new Uint16Array(0);
    const k = o.models[file] as Kn5;
    const name = template?.name ?? 'GRASS_1';
    const material = template ? (k.materials[template.material]?.name ?? '') : (owners[GROUND]?.material ?? '');
    k.root.children.push(meshNode(k, name, g, material, template ?? null, o.models));
    log(`the far ground: ${g.P.length / 3} points, ${g.F.length / 3} faces, out to the land round it`);
  }
  const merged: Record<string, string[]> = {};
  for (const [rn, own] of Object.entries(owners)) {
    if (!result[rn]) continue;
    const list = merged[own.model] ?? [];
    list.push(rn.split('@')[0] as string);
    merged[own.model] = list;
  }
  for (const v of Object.values(merged)) v.sort();
  return {
    window,
    merged,
    regions: regions.length,
    faces: Object.values(result).reduce((a, m) => a + m.F.length / 3, 0),
    meshes: result,
    owners,
    far: farMesh,
  };
}

/** The merged meshes into their models: those they replace (and those dropped) emptied, each region's mesh a node
 * after its template, one normal at each point (every face round it, across the seams). */
function writeFloor(
  models: Record<string, Kn5>,
  result: Record<string, Mesh>,
  owners: Record<string, Owner>,
  dropped: { file: string; name: string }[],
) {
  // (one normal at each point, by where it is: a point two regions share is one)
  const key = (x: number, z: number) => `${Math.round(x / 1e-4)},${Math.round(z / 1e-4)}`;
  const normals = new Map<string, [number, number, number]>();
  for (const m of Object.values(result))
    for (let f = 0; f < m.F.length; f += 3) {
      const [a, b, c] = [m.F[f] as number, m.F[f + 1] as number, m.F[f + 2] as number];
      const P = m.P;
      const ux = (P[b * 3] as number) - (P[a * 3] as number);
      const uy = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
      const uz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
      const vx = (P[c * 3] as number) - (P[a * 3] as number);
      const vy = (P[c * 3 + 1] as number) - (P[a * 3 + 1] as number);
      const vz = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
      let n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
      for (const v of [a, b, c]) {
        const k = key(P[v * 3] as number, P[v * 3 + 2] as number);
        const s = normals.get(k) ?? [0, 0, 0];
        normals.set(k, [s[0] + n[0], s[1] + n[1], s[2] + n[2]]);
      }
    }
  const normalAt = (x: number, z: number): [number, number, number] => {
    const s = normals.get(key(x, z));
    if (!s) return [0, 1, 0];
    const l = Math.hypot(...s) || 1;
    return [s[0] / l, s[1] / l, s[2] / l];
  };
  const empty = (k: Kn5, name: string) => {
    for (const [n] of meshes(k)) if (n.name === name) n.faces = new Uint16Array(0);
  };
  for (const { file, name } of dropped) empty(models[file] as Kn5, name);
  for (const own of Object.values(owners)) for (const name of own.replaces) empty(models[own.model] as Kn5, name);
  for (const [rn, own] of Object.entries(owners)) {
    const m = result[rn];
    if (!m) continue;
    const k = models[own.model] as Kn5;
    const node = meshNode(k as Kn5Model, rn.split('@')[0] as string, m, own.material, own.template, models, normalAt);
    if (own.grass) node.grass = true;
    k.root.children.push(node);
  }
}

/** metres between the far ground's points (far_terrain's STEP) */
const FAR_STEP = 20;

/** The far ground (far_terrain.py's build, on the place): from the merged floor's outer edge out to area (the land
 * round the track's pictures: x and z, metres), a point every FAR_STEP, on the place's ground; along that edge the
 * merged floor's own points at their own heights, so the two meet with no gap. Its faces up, mapped onto the picture of
 * the land round it as far_ground.py maps it ((x max - x, z max - z) over the area's size). */
export function farGround(
  meshes: Record<string, Mesh>,
  window: Box,
  area: [[number, number], [number, number]],
  height: (x: number, z: number) => number,
  tri: Triangle,
): { P: Float64Array; UV: Float64Array; F: Int32Array } {
  const [[xa, xb], [za, zb]] = area;
  const { x0, z0, x1, z1 } = window;
  const eps = 1e-6;
  // (the merged floor's points on the window's edge, round it the way the ring goes: by how far along its perimeter)
  const along = (x: number, z: number) =>
    Math.abs(z - z0) < eps
      ? x - x0
      : Math.abs(x - x1) < eps
        ? x1 - x0 + (z - z0)
        : Math.abs(z - z1) < eps
          ? x1 - x0 + (z1 - z0) + (x1 - x)
          : 2 * (x1 - x0) + (z1 - z0) + (z1 - z);
  const edge = new Map<string, [number, number, number]>();
  for (const m of Object.values(meshes))
    for (let i = 0; i < m.P.length; i += 3) {
      const [x, y, z] = [m.P[i] as number, m.P[i + 1] as number, m.P[i + 2] as number];
      if (Math.abs(x - x0) < eps || Math.abs(x - x1) < eps || Math.abs(z - z0) < eps || Math.abs(z - z1) < eps)
        edge.set(`${x.toFixed(6)},${z.toFixed(6)}`, [x, y, z]);
    }
  const inner = [...edge.values()].sort((a, b) => along(a[0], a[2]) - along(b[0], b[2]));
  const outer: [number, number][] = [];
  for (const [p, q] of [
    [
      [xa, za],
      [xb, za],
    ],
    [
      [xb, za],
      [xb, zb],
    ],
    [
      [xb, zb],
      [xa, zb],
    ],
    [
      [xa, zb],
      [xa, za],
    ],
  ] as [[number, number], [number, number]][]) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    for (let t = 0; t < L; t += FAR_STEP) outer.push([p[0] + ((q[0] - p[0]) * t) / L, p[1] + ((q[1] - p[1]) * t) / L]);
  }
  const grid: [number, number][] = [];
  const m = FAR_STEP / 2;
  for (let z = za + FAR_STEP; z < zb - FAR_STEP / 2; z += FAR_STEP)
    for (let x = xa + FAR_STEP; x < xb - FAR_STEP / 2; x += FAR_STEP)
      if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) grid.push([x, z]);
  const ni = inner.length;
  const no = outer.length;
  const points = [...inner.map((p) => [p[0], p[2]]), ...outer, ...grid].flat();
  const segments: number[] = [];
  for (let i = 0; i < ni; i++) segments.push(i, (i + 1) % ni);
  for (let i = 0; i < no; i++) segments.push(ni + i, ni + ((i + 1) % no));
  const out = tri.triangulate('pQ', { points, segments, holes: [(x0 + x1) / 2, (z0 + z1) / 2] });
  const n = out.points.length / 2;
  const P = new Float64Array(n * 3);
  const UV = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = out.points[i * 2] as number;
    const z = out.points[i * 2 + 1] as number;
    P[i * 3] = x;
    P[i * 3 + 1] = i < ni ? (inner[i] as [number, number, number])[1] : height(x, z);
    P[i * 3 + 2] = z;
    UV[i * 2] = (xb - x) / (xb - xa);
    UV[i * 2 + 1] = (zb - z) / (zb - za);
  }
  const F = Int32Array.from(out.triangles);
  // (each face up)
  for (let f = 0; f < F.length; f += 3) {
    const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
    const ny =
      ((P[b * 3 + 2] as number) - (P[a * 3 + 2] as number)) * ((P[c * 3] as number) - (P[a * 3] as number)) -
      ((P[b * 3] as number) - (P[a * 3] as number)) * ((P[c * 3 + 2] as number) - (P[a * 3 + 2] as number));
    if (ny < 0) [F[f + 1], F[f + 2]] = [c, b];
  }
  return { P, UV, F };
}

/** A mesh's mapping where it is flat over the ground (u and v each a plane over x and z, as a picture laid over the
 * whole place is: the satellite's), as a function of (x, z); null where it is not (each point within a thousandth of
 * the planes fitted) or the mesh has too few points. */
export function flatMapping(n: Kn5Mesh, m: Mat4): ((x: number, z: number) => [number, number]) | null {
  const V = n.verts;
  const nv = V.length / VERT;
  if (nv < 3) return null;
  const X = new Float64Array(nv);
  const Z = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const x = V[v * VERT] as number;
    const y = V[v * VERT + 1] as number;
    const z = V[v * VERT + 2] as number;
    X[v] = x * (m[0] as number) + y * (m[4] as number) + z * (m[8] as number) + (m[12] as number);
    Z[v] = x * (m[2] as number) + y * (m[6] as number) + z * (m[10] as number) + (m[14] as number);
  }
  // (least squares, about the points' middle: a x + b z + c)
  let mx = 0;
  let mz = 0;
  for (let v = 0; v < nv; v++) {
    mx += X[v] as number;
    mz += Z[v] as number;
  }
  mx /= nv;
  mz /= nv;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (let v = 0; v < nv; v++) {
    const dx = (X[v] as number) - mx;
    const dz = (Z[v] as number) - mz;
    sxx += dx * dx;
    sxz += dx * dz;
    szz += dz * dz;
  }
  const det = sxx * szz - sxz * sxz;
  if (!(Math.abs(det) > 1e-9)) return null;
  const plane = (col: number): [number, number, number] | null => {
    let mu = 0;
    for (let v = 0; v < nv; v++) mu += V[v * VERT + col] as number;
    mu /= nv;
    let sxu = 0;
    let szu = 0;
    for (let v = 0; v < nv; v++) {
      const du = (V[v * VERT + col] as number) - mu;
      sxu += ((X[v] as number) - mx) * du;
      szu += ((Z[v] as number) - mz) * du;
    }
    const a = (sxu * szz - szu * sxz) / det;
    const b = (szu * sxx - sxu * sxz) / det;
    const c = mu - a * mx - b * mz;
    for (let v = 0; v < nv; v++)
      if (Math.abs(a * (X[v] as number) + b * (Z[v] as number) + c - (V[v * VERT + col] as number)) > 1e-3) return null;
    return [a, b, c];
  };
  const pu = plane(6);
  const pv = plane(7);
  if (!pu || !pv) return null;
  return (x, z) => [pu[0] * x + pu[1] * z + pu[2], pv[0] * x + pv[1] * z + pv[2]];
}
