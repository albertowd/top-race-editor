// The warehouse south of the Velopark (beyond the road, past the hotlap building), as the satellite photo and the
// onboard videos show it: 121.1 m east to west, 132.6 m north to south; ribbed light cladding over a precast concrete
// base, a dark flashing along the parapet's top, downpipes; the green graphics at the east end of its north wall (the
// track's side); loading docks with black shelters along its west wall and the east part of its south wall; a ribbed
// metal roof, a low gable (its ridge east to west) with a vent along most of the ridge, and the lighter sheets at its
// north-west and north-east corners. Its own materials, their pictures made here, inside the file. At its own origin,
// its front (+z) its north side, +x its west; metres.
//
//   npm run model:south-warehouse   (then npm run pictures -- south_warehouse)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngRgba } from '../src/engine/pictures';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'models', 'south_warehouse.glb');
const W = 121.1;
const D = 132.6;
const EAVE = 11;
const RIDGE = 12.6;
const PARAPET = 11.9;
const PLINTH = 2.5;
const BELOW = 2;
const IN = 0.3;
const hx = W / 2;
const hz = D / 2;

type V3 = [number, number, number];
type Part = { material: string; P: number[]; N: number[]; U: number[]; T: number[]; I: number[] };
const parts = new Map<string, Part>();
const part = (name: string, material = name): Part => {
  let p = parts.get(name);
  if (!p) {
    p = { material, P: [], N: [], U: [], T: [], I: [] };
    parts.set(name, p);
  }
  return p;
};
/** A flat polygon (3 or 4 corners) facing n, its UVs given; turned to face n whichever way its corners go. */
function face(p: Part, pts: V3[], uv: [number, number][], n: V3, t: V3) {
  const base = p.P.length / 3;
  pts.forEach((q, i) => {
    p.P.push(...q);
    p.N.push(...n);
    p.T.push(...t, 1);
    p.U.push(...(uv[i] as [number, number]));
  });
  const [a, b, c] = pts as [V3, V3, V3];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const along = f[0] * n[0] + f[1] * n[1] + f[2] * n[2] >= 0;
  const idx = pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
  for (let i = 0; i < idx.length; i += 3)
    p.I.push(
      base + (idx[i] as number),
      base + (idx[along ? i + 1 : i + 2] as number),
      base + (idx[along ? i + 2 : i + 1] as number),
    );
}

/** The four sides, each as seen from outside: its left end (x, z), its way to the right, its normal, its length. */
const SIDES = {
  north: { a: [-hx, hz], t: [1, 0], n: [0, 0, 1], L: W },
  west: { a: [hx, hz], t: [0, -1], n: [1, 0, 0], L: D },
  south: { a: [hx, -hz], t: [-1, 0], n: [0, 0, -1], L: W },
  east: { a: [-hx, -hz], t: [0, 1], n: [-1, 0, 0], L: D },
} as const;
type Side = (typeof SIDES)[keyof typeof SIDES];
/** A point on a side: s metres from its left end, y up, o out from it. */
const on = (S: Side, s: number, y: number, o = 0): V3 => [
  S.a[0] + S.t[0] * s + S.n[0] * o,
  y,
  S.a[1] + S.t[1] * s + S.n[2] * o,
];
const tangent = (S: Side): V3 => [S.t[0], 0, S.t[1]];
/** A rectangle on a side, s0..s1 along, y0..y1 up, o out; its UVs metres over (su, sv) a picture. */
function panel(p: Part, S: Side, s0: number, s1: number, y0: number, y1: number, o: number, su: number, sv: number) {
  face(
    p,
    [on(S, s0, y0, o), on(S, s1, y0, o), on(S, s1, y1, o), on(S, s0, y1, o)],
    [
      [s0 / su, -y0 / sv],
      [s1 / su, -y0 / sv],
      [s1 / su, -y1 / sv],
      [s0 / su, -y1 / sv],
    ],
    S.n as unknown as V3,
    tangent(S),
  );
}
/** A box standing out of a side: s0..s1 along, y0..y1 up, from the wall out to o. */
function sideBox(p: Part, S: Side, s0: number, s1: number, y0: number, y1: number, o: number, scale = 1) {
  const n = S.n as unknown as V3;
  const t = tangent(S);
  const uv = (a: number, b: number): [number, number] => [a / scale, -b / scale];
  // (its front, top, bottom, ends)
  face(
    p,
    [on(S, s0, y0, o), on(S, s1, y0, o), on(S, s1, y1, o), on(S, s0, y1, o)],
    [uv(s0, y0), uv(s1, y0), uv(s1, y1), uv(s0, y1)],
    n,
    t,
  );
  face(
    p,
    [on(S, s0, y1, 0), on(S, s1, y1, 0), on(S, s1, y1, o), on(S, s0, y1, o)],
    [uv(s0, 0), uv(s1, 0), uv(s1, o), uv(s0, o)],
    [0, 1, 0],
    t,
  );
  face(
    p,
    [on(S, s0, y0, 0), on(S, s1, y0, 0), on(S, s1, y0, o), on(S, s0, y0, o)],
    [uv(s0, 0), uv(s1, 0), uv(s1, o), uv(s0, o)],
    [0, -1, 0],
    t,
  );
  const back: V3 = [-S.t[0], 0, -S.t[1]];
  face(
    p,
    [on(S, s0, y0, 0), on(S, s0, y0, o), on(S, s0, y1, o), on(S, s0, y1, 0)],
    [uv(0, y0), uv(o, y0), uv(o, y1), uv(0, y1)],
    back,
    n,
  );
  face(
    p,
    [on(S, s1, y0, 0), on(S, s1, y0, o), on(S, s1, y1, o), on(S, s1, y1, 0)],
    [uv(0, y0), uv(o, y0), uv(o, y1), uv(0, y1)],
    tangent(S),
    n,
  );
}

// ---- the walls ----------------------------------------------------------------------------------------------------
const CLAD = 2; // metres the cladding's picture covers
const BASE_U = 6; // metres along a precast panel
for (const S of Object.values(SIDES)) {
  panel(part('base', 'WarehouseBase'), S, 0, S.L, -BELOW, PLINTH, 0, BASE_U, PLINTH + BELOW);
  panel(part('cladding', 'WarehouseCladding'), S, 0, S.L, PLINTH, EAVE + 0.4, 0, CLAD, CLAD);
  panel(part('flashing', 'WarehouseFlashing'), S, 0, S.L, EAVE + 0.4, PARAPET, 0, 2, 2);
}
// (the parapet's inside faces and cap, walked round inside)
for (const S of Object.values(SIDES)) {
  const n: V3 = [-S.n[0], 0, -S.n[2]];
  const a = on(S, 0, 0, -IN);
  const b = on(S, S.L, 0, -IN);
  face(
    part('flashing', 'WarehouseFlashing'),
    [
      [a[0], EAVE - 0.4, a[2]],
      [b[0], EAVE - 0.4, b[2]],
      [b[0], PARAPET, b[2]],
      [a[0], PARAPET, a[2]],
    ],
    [
      [0, 0],
      [S.L / 2, 0],
      [S.L / 2, 1],
      [0, 1],
    ],
    n,
    tangent(S),
  );
  const o0 = on(S, 0, PARAPET, 0);
  const o1 = on(S, S.L, PARAPET, 0);
  face(
    part('flashing', 'WarehouseFlashing'),
    [a.map((v, i) => (i === 1 ? PARAPET : v)) as V3, b.map((v, i) => (i === 1 ? PARAPET : v)) as V3, o1, o0],
    [
      [0, 0],
      [S.L / 2, 0],
      [S.L / 2, 0.15],
      [0, 0.15],
    ],
    [0, 1, 0],
    tangent(S),
  );
}

// ---- the green graphics on the north wall's east end --------------------------------------------------------------
{
  const S = SIDES.north;
  const stripe = (s0: number, w: number, y0: number, y1: number, lean: number, mat: string) => {
    const o = 0.04;
    face(
      part(mat),
      [on(S, s0, y0, o), on(S, s0 + w, y0, o), on(S, s0 + w + lean, y1, o), on(S, s0 + lean, y1, o)],
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      S.n as unknown as V3,
      tangent(S),
    );
  };
  // (three slanted bars rising to the right, a band under them)
  stripe(4, 2.2, 3.4, 10.2, 3.2, 'WarehouseGreen');
  stripe(8.2, 2.2, 3.4, 9.0, 2.6, 'WarehouseGreen');
  stripe(12.4, 2.2, 3.4, 7.8, 2.0, 'WarehouseGreenDark');
  stripe(3.2, 22, 2.9, 3.4, 0, 'WarehouseGreenDark');
}

// ---- the loading docks --------------------------------------------------------------------------------------------
const DOOR_W = 3;
const DOOR_H = 3.2;
const SILL = 1.2;
function dock(S: Side, s: number) {
  const s0 = s - DOOR_W / 2;
  const s1 = s + DOOR_W / 2;
  // (the door, its picture its whole; the black shelter round it standing 0.6 m out; two bumpers under it)
  face(
    part('doors', 'WarehouseDoor'),
    [on(S, s0, SILL, 0.03), on(S, s1, SILL, 0.03), on(S, s1, SILL + DOOR_H, 0.03), on(S, s0, SILL + DOOR_H, 0.03)],
    [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    S.n as unknown as V3,
    tangent(S),
  );
  const sh = part('shelters', 'WarehouseRubber');
  sideBox(sh, S, s0 - 0.45, s0, SILL - 0.1, SILL + DOOR_H + 0.5, 0.6);
  sideBox(sh, S, s1, s1 + 0.45, SILL - 0.1, SILL + DOOR_H + 0.5, 0.6);
  sideBox(sh, S, s0 - 0.45, s1 + 0.45, SILL + DOOR_H, SILL + DOOR_H + 0.5, 0.6);
  sideBox(sh, S, s0 + 0.2, s0 + 0.5, SILL - 0.5, SILL - 0.05, 0.15);
  sideBox(sh, S, s1 - 0.5, s1 - 0.2, SILL - 0.5, SILL - 0.05, 0.15);
}
const DOCKS: [Side, number[]][] = [
  [SIDES.west, Array.from({ length: 15 }, (_, i) => 27 + i * 7)],
  [SIDES.south, Array.from({ length: 6 }, (_, i) => 70 + i * 7)],
];
for (const [S, at] of DOCKS) for (const s of at) dock(S, s);
// (the downpipes, every 18 m along each wall, none in a dock's way)
for (const S of Object.values(SIDES)) {
  const docks = DOCKS.find(([d]) => d === S)?.[1] ?? [];
  for (let s = 9; s < S.L - 4; s += 18)
    if (docks.every((d) => Math.abs(d - s) > 2.6))
      sideBox(part('pipes', 'WarehouseFlashing'), S, s - 0.08, s + 0.08, -0.2, EAVE + 0.4, 0.16, 2);
}

// ---- the roof -----------------------------------------------------------------------------------------------------
const rx = hx - IN;
const rz = hz - IN;
const E = EAVE - 0.4;
const rise = RIDGE - E;
const lz = Math.hypot(rz, rise);
const ROOF = 2; // metres its picture covers
/** A slope's point at x, z (z from 0 at the ridge to ±rz at the eaves), lifted by up. */
const roofAt = (x: number, z: number, up = 0): V3 => [x, RIDGE - (rise * Math.abs(z)) / rz + up, z];
const slopeN = (north: boolean): V3 => {
  const l = Math.hypot(rise, rz);
  return [0, rz / l, ((north ? 1 : -1) * rise) / l];
};
function roofRect(p: Part, x0: number, x1: number, z0: number, z1: number, up: number) {
  const north = z0 + z1 > 0;
  const uv = (x: number, z: number): [number, number] => [x / ROOF, ((Math.abs(z) / rz) * lz) / ROOF];
  face(
    p,
    [roofAt(x0, z0, up), roofAt(x1, z0, up), roofAt(x1, z1, up), roofAt(x0, z1, up)],
    [uv(x0, z0), uv(x1, z0), uv(x1, z1), uv(x0, z1)],
    slopeN(north),
    [1, 0, 0],
  );
}
roofRect(part('roof', 'WarehouseRoof'), -rx, rx, 0, rz, 0);
roofRect(part('roof', 'WarehouseRoof'), -rx, rx, 0, -rz, 0);
// (the lighter sheets: the north slope's west 18 m and east 22 m)
roofRect(part('roof_light', 'WarehouseRoofLight'), rx - 18, rx, 1.5, rz, 0.03);
roofRect(part('roof_light', 'WarehouseRoofLight'), -rx, -rx + 22, 3, rz, 0.03);
// (the gables over the parapet, each end)
for (const sx of [1, -1]) {
  const x = sx * rx;
  face(
    part('flashing', 'WarehouseFlashing'),
    [
      [x, E, rz],
      [x, E, -rz],
      [x, RIDGE, 0],
    ],
    [
      [rz / 2, E / 2],
      [-rz / 2, E / 2],
      [0, RIDGE / 2],
    ],
    [sx, 0, 0],
    [0, 0, 1],
  );
}
// (the vent along the ridge: a long box from the west end most of the way east)
{
  const p = part('vent', 'WarehouseFlashing');
  const [x0, x1, y0, y1, z0, z1] = [-48, 50, RIDGE - 0.3, RIDGE + 0.9, -0.7, 0.7];
  const box: [V3[], V3, V3][] = [
    [
      [
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 1, 0],
      [1, 0, 0],
    ],
    [
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      [0, 0, -1],
      [1, 0, 0],
    ],
    [
      [
        [x1, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      [-1, 0, 0],
      [0, 0, 1],
    ],
  ];
  for (const [pts, n, t] of box)
    face(
      p,
      pts,
      pts.map((q) => [(q[0] + q[2]) / 2, -q[1] / 2] as [number, number]),
      n,
      t,
    );
}

// ---- the pictures -------------------------------------------------------------------------------------------------
function hash(i: number, j: number, k: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Tiling value noise, -1..1: cells a side of size px, wrapping round. */
function noise(x: number, y: number, cells: number, size: number, k: number): number {
  const c = size / cells;
  const u = x / c;
  const v = y / c;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const su = fu * fu * (3 - 2 * fu);
  const sv = fv * fv * (3 - 2 * fv);
  const w = (a: number) => ((a % cells) + cells) % cells;
  const h = (a: number, b: number) => hash(w(a), w(b), k);
  return (
    ((h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv) * 2 - 1
  );
}
const SIZE = 512;
function picture(at: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const c = at(x, y).map((v) => Math.max(0, Math.min(255, Math.round(v))));
      out.set([...c, 255], (y * SIZE + x) * 4);
    }
  return out;
}
const grain = (x: number, y: number, k: number) =>
  0.5 * noise(x, y, 128, SIZE, k) + 0.3 * noise(x, y, 32, SIZE, k + 1) + 0.2 * noise(x, y, 8, SIZE, k + 2);
/** Trapezoidal ribs across u (rib metres apart over a picture of span metres): the light each part of a rib takes. */
function rib(u: number, span: number, pitch: number): number {
  const f = ((u * span) / pitch) % 1;
  if (f < 0.12) return -0.16; // (the rib's shaded side)
  if (f < 0.22) return 0.1; // (its top)
  if (f < 0.3) return 0.06; // (its lit side)
  if (f > 0.97) return -0.06;
  return 0;
}
const pictures: Record<string, Uint8Array> = {
  // (light grey cladding, a rib every 1/3 m, a little grime)
  WarehouseCladding: picture((x, y) => {
    const s = 1 + rib(x / SIZE, CLAD, 1 / 3) + 0.03 * grain(x, y, 1);
    return [222 * s, 224 * s, 226 * s];
  }),
  // (precast concrete: grey, its joint at the panel's ends, its grain)
  WarehouseBase: picture((x, y) => {
    const j = x < 4 || x > SIZE - 4 ? 0.55 : 1;
    const s = j * (1 + 0.07 * grain(x, y, 5) + 0.04 * noise(x, y, 4, SIZE, 9));
    return [158 * s, 156 * s, 150 * s];
  }),
  WarehouseFlashing: picture((x, y) => {
    const s = 1 + 0.05 * grain(x, y, 11);
    return [78 * s, 82 * s, 86 * s];
  }),
  // (the roof's sheets: ribbed across, a rib every 1/3 m, weathered)
  WarehouseRoof: picture((x, y) => {
    const s = 1 + 0.8 * rib(x / SIZE, ROOF, 1 / 3) + 0.06 * grain(x, y, 21) + 0.04 * noise(x, y, 2, SIZE, 23);
    return [172 * s, 174 * s, 176 * s];
  }),
  WarehouseRoofLight: picture((x, y) => {
    const s = 1 + 0.6 * rib(x / SIZE, ROOF, 1 / 3) + 0.04 * grain(x, y, 31);
    return [214 * s, 216 * s, 218 * s];
  }),
  // (a sectional door: its picture the whole door, a joint every 0.53 m of its 3.2, a window row in its fourth panel)
  WarehouseDoor: picture((x, y) => {
    const panelH = SIZE / 6;
    const f = (y % panelH) / panelH;
    let s = f < 0.04 ? 0.55 : f > 0.96 ? 0.8 : 1;
    const row = Math.floor(y / panelH);
    if (row === 2 && f > 0.25 && f < 0.75 && x % (SIZE / 4) > SIZE / 32 && x % (SIZE / 4) < (SIZE / 4) * 0.85)
      s *= 0.35;
    if (x < 6 || x > SIZE - 6) s *= 0.6;
    s *= 1 + 0.04 * grain(x, y, 41);
    return [118 * s, 126 * s, 134 * s];
  }),
  WarehouseRubber: picture((x, y) => {
    const s = 1 + 0.15 * grain(x, y, 51);
    return [34 * s, 34 * s, 35 * s];
  }),
  WarehouseGreen: picture((x, y) => {
    const s = 1 + 0.03 * grain(x, y, 61);
    return [70 * s, 158 * s, 64 * s];
  }),
  WarehouseGreenDark: picture((x, y) => {
    const s = 1 + 0.03 * grain(x, y, 71);
    return [28 * s, 104 * s, 52 * s];
  }),
};

// ---- the glb ------------------------------------------------------------------------------------------------------
type Json = Record<string, unknown> & {
  nodes: unknown[];
  meshes: unknown[];
  materials: unknown[];
  accessors: Record<string, unknown>[];
  bufferViews: unknown[];
  images: unknown[];
  textures: unknown[];
};
const json: Json = {
  asset: { version: '2.0', generator: 'top-race-editor' },
  scene: 0,
  scenes: [{ nodes: [] as number[] }],
  nodes: [],
  meshes: [],
  materials: [],
  accessors: [],
  bufferViews: [],
  images: [],
  textures: [],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  buffers: [],
};
const chunks: Buffer[] = [];
let offset = 0;
const view = (bytes: Uint8Array, target?: number) => {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pad = (4 - (b.length % 4)) % 4;
  chunks.push(b, Buffer.alloc(pad));
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length, ...(target ? { target } : {}) });
  offset += b.length + pad;
  return json.bufferViews.length - 1;
};
const accessor = (
  arr: Float32Array | Uint16Array,
  type: string,
  componentType: number,
  target: number,
  minmax = false,
) => {
  const n = ({ VEC3: 3, VEC2: 2, VEC4: 4, SCALAR: 1 } as Record<string, number>)[type] as number;
  const a: Record<string, unknown> = {
    bufferView: view(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), target),
    componentType,
    count: arr.length / n,
    type,
  };
  if (minmax) {
    const v = [...arr];
    a.min = [0, 1, 2].map((k) => Math.min(...v.filter((_, i) => i % 3 === k)));
    a.max = [0, 1, 2].map((k) => Math.max(...v.filter((_, i) => i % 3 === k)));
  }
  json.accessors.push(a);
  return json.accessors.length - 1;
};
const matIndex = new Map<string, number>();
for (const [name, px] of Object.entries(pictures)) {
  const png = await pngRgba(px, SIZE, SIZE);
  json.images.push({ bufferView: view(png), mimeType: 'image/png', name });
  json.textures.push({ sampler: 0, source: json.images.length - 1 });
  json.materials.push({
    name,
    pbrMetallicRoughness: {
      baseColorTexture: { index: json.textures.length - 1 },
      metallicFactor: 0,
      roughnessFactor: 0.8,
    },
  });
  matIndex.set(name, json.materials.length - 1);
}
let triangles = 0;
for (const [name, p] of parts) {
  if (!p.I.length) continue;
  if (p.P.length / 3 > 65535) throw new Error(`${name}: too many points`);
  json.meshes.push({
    name,
    primitives: [
      {
        attributes: {
          POSITION: accessor(new Float32Array(p.P), 'VEC3', 5126, 34962, true),
          NORMAL: accessor(new Float32Array(p.N), 'VEC3', 5126, 34962),
          TEXCOORD_0: accessor(new Float32Array(p.U), 'VEC2', 5126, 34962),
          TANGENT: accessor(new Float32Array(p.T), 'VEC4', 5126, 34962),
        },
        indices: accessor(new Uint16Array(p.I), 'SCALAR', 5123, 34963),
        material: matIndex.get(p.material),
        mode: 4,
      },
    ],
  });
  json.nodes.push({ name: name.toUpperCase(), mesh: json.meshes.length - 1 });
  (json.scenes as { nodes: number[] }[])[0]?.nodes.push(json.nodes.length - 1);
  triangles += p.I.length / 3;
}
const bin = Buffer.concat(chunks);
json.buffers = [{ byteLength: bin.length }];
let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0);
head.writeUInt32LE(2, 4);
head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const ch = (len: number, type: number) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.writeUInt32LE(type, 4);
  return b;
};
writeFileSync(OUT, Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]));
console.log('written', OUT, 'triangles', triangles, 'bytes', 28 + js.length + bin.length);
