// The objects laid on the floor (laying.ts) written into the track's models as the track's place_objects.py writes
// them: those every layout has (but the knockable ones) in the shared model, the others in their layouts' own; each
// part a mesh of its own (named after its object, and its part where its model has more than one), drawn from and to
// its part's distances; a wall's band and a static one's boxes as an unseen mesh to hit (1WALL_<name>); the old
// models' tyre walls, poles and AC physics objects out. The lights of those that have them (the light poles'), in the
// world: places.json's `lights`.

import { meshNode } from './floorwrite';
import type { Kn5, Kn5Mesh } from './kn5tree';
import type { LaidObject, Place } from './laying';
import { objectLit } from './lightoptions';
import { meshes } from './mesh';
import { pyRound } from './trackfiles';

/** What of a light its object makes its own, its series' otherwise (lightoptions.ts). */
interface OwnValues {
  strength?: number;
  colour?: number[];
  range?: number;
}

/** A model's light (the catalogue's: its series, where it is and where it faces, in the model's own frame); its
 * object's own values with it, where it has them. */
export interface ModelLight extends OwnValues {
  series: string;
  at: number[];
  /** the way it shines (none: all round, a building's lamp) */
  facing?: number[];
}

/** A light in the world (TRACK_FORMAT's "Lights and screens"): its object's own values with it, where it has them
 * (the games' builds light it so, not as its series). */
export interface WorldLight extends OwnValues {
  series: string;
  at: number[];
  facing?: number[];
}

/** A light's own values, those it has. */
const ownOf = (L: OwnValues): OwnValues => ({
  ...(L.strength !== undefined ? { strength: L.strength } : {}),
  ...(L.colour !== undefined ? { colour: [...L.colour] } : {}),
  ...(L.range !== undefined ? { range: L.range } : {}),
});

/** A mesh of a model's points (eleven numbers each: their own normals and tangents kept) for k: drawn and cast
 * shadows (seen), or an unseen one to hit; drawn from and to lod's distances. */
export function objectNode(
  k: Kn5,
  name: string,
  V: Float64Array,
  F: ArrayLike<number>,
  material: string,
  materials: Record<string, Kn5>,
  seen = true,
  lod?: [number, number],
): Kn5Mesh {
  const nv = V.length / 11;
  const P = new Float64Array(nv * 3);
  const UV = new Float64Array(nv * 2);
  for (let i = 0; i < nv; i++) {
    P.set(V.subarray(i * 11, i * 11 + 3), i * 3);
    UV.set(V.subarray(i * 11 + 6, i * 11 + 8), i * 2);
  }
  const m: Kn5Mesh = meshNode(k, name, { P, UV, F }, material, null, materials);
  // (its own normals and tangents, as its model has them)
  for (let i = 0; i < nv; i++) m.verts.set(Float32Array.from(V.subarray(i * 11 + 3, i * 11 + 11)), i * 11 + 3);
  m.cast_shadows = seen ? 1 : 0;
  m.renderable = seen ? 1 : 0;
  if (lod) [m.lod_in, m.lod_out] = lod;
  return m;
}

/** A model's mesh laid as an object's (a building's): under its role's prefix (1WALL_, 1ROAD_...), the object's name
 * after it, then the mesh's own (its role's prefix off). */
export function roleName(object: string, mesh: string): string {
  const m = /^(\d+[A-Z]*_)(.*)$/.exec(mesh);
  return m ? `${m[1]}${object}_${m[2]}` : `${object}_${mesh}`;
}

/** A mesh's faces by the MERGE_CELL square their middles are in (its points eleven numbers each): each square's own
 * points and faces, by its key `<ci>_<cj>`, in the order the squares are first met. */
export function byCell(V: Float64Array, F: ArrayLike<number>): Map<string, { V: Float64Array; F: number[] }> {
  const groups = new Map<string, { at: Map<number, number>; V: number[]; F: number[] }>();
  for (let f = 0; f < F.length; f += 3) {
    const c = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
    const x = c.reduce((a, i) => a + (V[i * 11] as number), 0) / 3;
    const z = c.reduce((a, i) => a + (V[i * 11 + 2] as number), 0) / 3;
    const key = `${Math.floor(x / MERGE_CELL)}_${Math.floor(z / MERGE_CELL)}`;
    let g = groups.get(key);
    if (!g) {
      g = { at: new Map(), V: [], F: [] };
      groups.set(key, g);
    }
    for (const i of c) {
      let j = g.at.get(i);
      if (j === undefined) {
        j = g.V.length / 11;
        g.at.set(i, j);
        for (let q = 0; q < 11; q++) g.V.push(V[i * 11 + q] as number);
      }
      g.F.push(j);
    }
  }
  return new Map([...groups].map(([k, g]) => [k, { V: Float64Array.from(g.V), F: g.F }]));
}

/** a layout's markers in its model (place_objects.MARKERS): its spots and its gates' ends */
export const MARKERS = /^AC_(START_\d+|PIT_\d+|HOTLAP_START_\d+|TIME_\d+_[LR])$/;

/** metres a side of the squares a part drawn only so near or so far is merged in (place_objects.MERGE_CELL) */
export const MERGE_CELL = 20;

const pyStr = (v: string) => `'${v}'`;
const pyNum = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

/** A merged mesh's key as place_objects writes it (str of its tuple: layout, model, part, material, lod, cell), what
 * it sorts them by. */
function sortKey(
  layout: string | null,
  model: string,
  part: string,
  material: string,
  lod: [number, number],
  cell: [number, number],
): string {
  return `(${layout === null ? 'None' : pyStr(layout)}, ${pyStr(model)}, ${pyStr(part)}, ${pyStr(material)}, (${pyNum(lod[0])}, ${pyNum(lod[1])}), (${cell[0]}, ${cell[1]}))`;
}

/** points of a merged mesh at most (a model's meshes index theirs in 16 bits) */
export const MERGE_MAX = 60000;

const BOX_FACES = [
  0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
];

/** A mesh's name: its object's, and its part's after it where its model has more than one (POLE_3_MAST). */
export const partName = (name: string, part: string, parts: number) =>
  parts === 1 ? name : `${name}_${part.toUpperCase()}`;

/** Python's round(x, 3); its -0.0 made 0.0 where asked (round(v, 3) + 0.). */
const r3 = (x: number, plus = false) => {
  const v = pyRound(x, 3);
  return plus && v === 0 ? 0 : v;
};

/** The lights of the objects that have them, in the world (place_objects.object_lights): each of a model's lights
 * turned to its object's heading, on the floor there; by series, each's in the objects' order. */
export function objectLights(lit: [ModelLight[], Place][], floor: (x: number, z: number) => number): WorldLight[] {
  const out: WorldLight[] = [];
  for (const [lights, [x, z, h]] of lit) {
    const y = floor(x, z);
    const s = Math.sin(h);
    const c = Math.cos(h);
    for (const L of lights) {
      const [a0, a1, a2] = L.at as [number, number, number];
      const px = x + c * a0 + s * a2;
      const pz = z - s * a0 + c * a2;
      const at = [r3(px), r3(y + a1), r3(pz)];
      if (!L.facing) {
        // (shining all round: a lamp with no way of its own)
        out.push({ series: L.series, at, ...ownOf(L) });
        continue;
      }
      const [f0, f1, f2] = L.facing as [number, number, number];
      out.push({
        series: L.series,
        at,
        facing: [r3(c * f0 + s * f2, true), r3(f1, true), r3(-s * f0 + c * f2, true)],
        ...ownOf(L),
      });
    }
  }
  // (a stable sort, as Python's sorted)
  return out
    .map((L, i) => [L, i] as const)
    .sort((a, b) => (a[0].series < b[0].series ? -1 : a[0].series > b[0].series ? 1 : a[1] - b[1]))
    .map(([L]) => L);
}

export interface ObjectsWritten {
  /** objects laid, by model */
  count: Record<string, number>;
  lights: WorldLight[];
  /** the ground the solid ones stand on, seen from above: each a ring (x, z) */
  solid: number[][][];
}

/** The laid objects into the models: shared (the model every layout has) and each layout's (by its name); the old
 * models' tyre walls and poles emptied (old: the models holding them), the layouts' AC physics objects out. Those apart
 * (the start gantries: models of their own) are counted, lit and solid, but written by their own. */
export function writeObjects(
  laid: LaidObject[],
  shared: Kn5,
  layouts: Record<string, Kn5>,
  materials: Record<string, Kn5>,
  lightsOf: (model: string) => ModelLight[] | undefined,
  floor: (x: number, z: number) => number,
  old: Kn5[] = [],
  apart: (o: LaidObject) => boolean = () => false,
): ObjectsWritten {
  for (const k of old)
    for (const [n] of meshes(k)) if (/^(TYRES_|1WALL_TYRE|POLE_|1WALL_POLE)/.test(n.name)) n.faces = new Uint16Array(0);
  // (a layout's physics objects and its markers out: each game's build makes its own, from the places)
  for (const k of Object.values(layouts))
    k.root.children = k.root.children.filter(
      (c) => !c.name.startsWith('AC_POBJECT_') && !(c.kind === 1 && MARKERS.test(c.name)),
    );
  shared.root.children = [];
  const every = Object.values(layouts);
  const count: Record<string, number> = {};
  const files = [shared, ...every];
  const merged = new Map<
    string,
    {
      k: Kn5;
      model: string;
      part: string;
      material: string;
      lod?: [number, number];
      /** the model its material is of (its textures with it) */
      from?: Kn5;
      /** its MERGE_CELL square (a part drawn only so near or so far), else null */
      cell: [number, number] | null;
      /** where it goes among the merged (place_objects' order: by its key as Python writes it) */
      order: string;
      copies: [Float64Array, ArrayLike<number>][];
    }
  >();
  const layoutOf = new Map(Object.entries(layouts).map(([l, k]) => [k, l] as const));
  const lit: [ModelLight[], Place][] = [];
  const solid: number[][][] = [];
  const node = (
    k: Kn5,
    name: string,
    V: Float64Array,
    F: ArrayLike<number>,
    material: string,
    seen = true,
    lod?: [number, number],
    from?: Kn5,
    model = '',
  ) => objectNode(k, name, V, F, material, from ? { ...materials, [`template:${model}`]: from } : materials, seen, lod);
  for (const o of laid) {
    const single = o.places.length === 1 && !o.wall;
    // (a knockable one standing alone: a layout's physics object, in its places; each game makes its own)
    if (o.collision === 'dynamic' && single) {
      count[o.model] = (count[o.model] ?? 0) + 1;
      continue;
    }
    // (every layout's in the shared model, but a knockable one: in each layout's)
    const targets: Kn5[] = apart(o)
      ? []
      : o.layouts
        ? o.layouts.flatMap((l) => (layouts[l] ? [layouts[l] as Kn5] : []))
        : o.collision === 'dynamic'
          ? every
          : [shared];
    for (const k of targets) {
      for (const p of o.parts) {
        // (nothing to hit: one mesh of all the copies of this part of the model in this model file, drawn at once; one
        // drawn only so near or so far, of each MERGE_CELL square, as a game measures that from the mesh's middle)
        if (o.collision === 'none') {
          const lod = p.lod ?? [0, 0];
          const limited = lod[0] !== 0 || lod[1] !== 0;
          const at = o.places[0] ?? [0, 0, 0];
          const cell: [number, number] = limited
            ? [Math.floor(at[0] / MERGE_CELL), Math.floor(at[1] / MERGE_CELL)]
            : [0, 0];
          const key = `${files.indexOf(k)}|${o.model}|${p.part}|${p.material}|${lod.join(',')}|${cell.join(',')}`;
          const g = merged.get(key) ?? {
            k,
            model: o.model,
            part: p.part,
            material: p.material,
            lod: p.lod,
            from: p.from,
            cell: limited ? cell : null,
            order: sortKey(k === shared ? null : (layoutOf.get(k) ?? null), o.model, p.part, p.material, lod, cell),
            copies: [],
          };
          g.copies.push([p.V, p.F]);
          merged.set(key, g);
        } else if (o.collision === 'model') {
          // (a building: each of its meshes as it is, under its role (its AC name's prefix), the object's name in it;
          // its materials its model's)
          const m = node(k, roleName(o.name, p.part), p.V, p.F, p.material, p.seen ?? true, p.lod, p.from, o.model);
          m.cast_shadows = p.shadows === false ? 0 : m.cast_shadows;
          k.root.children.push(m);
        } else {
          // (a part drawn only so near or so far, of many copies (a tyre wall): a mesh of each MERGE_CELL square, so
          // its near part and its far stand-in are measured from the same middle, none far from what it draws)
          const name = partName(o.name, p.part, o.parts.length);
          const lod = p.lod ?? [0, 0];
          const pieces =
            (lod[0] !== 0 || lod[1] !== 0) && o.places.length > 1
              ? [...byCell(p.V, p.F)].map(([cell, m]) => ({ name: `${name}_${cell}`, ...m }))
              : [{ name, V: p.V, F: p.F }];
          for (const piece of pieces)
            k.root.children.push(node(k, piece.name, piece.V, piece.F, p.material, true, p.lod, p.from, o.model));
        }
      }
      const mat = o.parts[0]?.material ?? '';
      if (o.wall) {
        const V = new Float64Array((o.wall.P.length / 3) * 11);
        for (let i = 0; i < o.wall.P.length / 3; i++) {
          V.set(o.wall.P.subarray(i * 3, i * 3 + 3), i * 11);
          V[i * 11 + 4] = 1;
        }
        k.root.children.push(node(k, `1WALL_${o.name}`, V, o.wall.F, mat, false));
      } else if (o.boxes?.length) {
        const V = new Float64Array(o.boxes.length * 8 * 11);
        const F: number[] = [];
        o.boxes.forEach((b, j) => {
          for (let i = 0; i < 8; i++) {
            V.set(b.slice(i * 3, i * 3 + 3), (j * 8 + i) * 11);
            V[(j * 8 + i) * 11 + 4] = 1;
          }
          for (const f of BOX_FACES) F.push(f + 8 * j);
        });
        k.root.children.push(node(k, `1WALL_${o.name}`, V, F, mat, false));
      }
    }
    if (o.wall) solid.push(o.places.map(([x, z]) => [x, z]));
    for (const b of o.boxes ?? []) solid.push([0, 1, 5, 4].map((i) => [b[i * 3] as number, b[i * 3 + 2] as number]));
    // (its model's lights as it has them: those it has off out, its own values with the rest)
    const lights = objectLit(lightsOf(o.model) ?? [], o.lights);
    if (lights.length) for (const q of o.places) lit.push([lights, q]);
    count[o.model] = (count[o.model] ?? 0) + 1;
  }
  // (the copies merged: in meshes of at most MERGE_MAX points, named <MODEL>_<PART> (and _<ci>_<cj>, its square, for a
  // part drawn only so near or so far), _<i> after the first)
  for (const g of [...merged.values()].sort((u, v) => (u.order < v.order ? -1 : u.order > v.order ? 1 : 0))) {
    const runs: [Float64Array, ArrayLike<number>][][] = [];
    let run: [Float64Array, ArrayLike<number>][] = [];
    let n = 0;
    for (const c of g.copies) {
      const nv = c[0].length / 11;
      if (run.length && n + nv > MERGE_MAX) {
        runs.push(run);
        run = [];
        n = 0;
      }
      run.push(c);
      n += nv;
    }
    runs.push(run);
    runs.forEach((r, i) => {
      const V = new Float64Array(r.reduce((a, [v]) => a + v.length, 0));
      const F: number[] = [];
      let at = 0;
      for (const [v, f] of r) {
        V.set(v, at);
        for (let j = 0; j < f.length; j++) F.push((f[j] as number) + at / 11);
        at += v.length;
      }
      const square = g.cell ? `_${g.cell[0]}_${g.cell[1]}` : '';
      const name = `${g.model.toUpperCase()}_${g.part.toUpperCase()}${square}${i ? `_${i}` : ''}`;
      g.k.root.children.push(node(g.k, name, V, F, g.material, true, g.lod, g.from, g.model));
    });
  }
  return { count, lights: objectLights(lit, floor), solid };
}

/** each colour of paint's material */
export const PAINT_MATERIALS: Record<string, string> = { white: 'LinePaint', yellow: 'PitLinePaint' };

/** The paint laid on the floor (the edge lines, the marks, the start lines) as the lines model's meshes, in its
 * colour's material, mapped flat (a metre a unit), casting no shadow; the meshes of those names it had out first. */
export function writeLines(
  k: Kn5,
  lines: { name: string; colour: string; P: ArrayLike<number>; F: ArrayLike<number> }[],
  materials: Record<string, Kn5>,
): number {
  const made = new Set(lines.map((l) => l.name));
  k.root.children = k.root.children.filter((c) => !made.has(c.name));
  for (const l of lines) {
    const nv = l.P.length / 3;
    const UV = new Float64Array(nv * 2);
    for (let i = 0; i < nv; i++) {
      UV[i * 2] = l.P[i * 3] as number;
      UV[i * 2 + 1] = l.P[i * 3 + 2] as number;
    }
    const m = meshNode(k, l.name, { P: l.P, UV, F: l.F }, PAINT_MATERIALS[l.colour] ?? 'LinePaint', null, materials);
    m.cast_shadows = 0;
    k.root.children.push(m);
  }
  return lines.length;
}
