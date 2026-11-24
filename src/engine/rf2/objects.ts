// A layout's placed objects (places.json: its cones and its marker board) as rFactor 2 knocks them about, as Joesville's
// cones are: each its own GMT, its model turned by its heading about its place, that place its pivot (the GMT's
// position), and an instance of it in the layout's scene, Moveable. Its seen parts are what is drawn and hit (rFactor
// hits a moveable's own meshes); its hull, AC's, is left out.
import { placeMatrix } from '../acbuild';
import { CORNER, type TrackMesh } from '../beamng/trackmodel';
import type { PhysicsObject } from '../places';
import type { TemplatePart } from '../templates';
import { type Axes, TRACK_TO_RF2 } from './aiw';
import type { Gmt, GmtMaterial, GmtMesh } from './gmt';
import type { Instance } from './text';

/** metres a placed object is drawn to (Joesville's cones') */
export const OBJECT_FAR = 500;

/** A part's points (eleven numbers each: place, normal, u v, tangent) turned by a heading about the model's origin,
 * as a track mesh's corners (place, normal, u v). */
export function turnedMesh(p: TemplatePart, heading: number): TrackMesh {
  const m = placeMatrix(0, 0, 0, heading);
  const n = p.V.length / 11;
  const v = new Float32Array(n * CORNER);
  // (row points: [p, w] @ M, as the AC build places a model)
  const tr = (x: number, y: number, z: number) =>
    [0, 1, 2].map((c) => x * (m[c] as number) + y * (m[4 + c] as number) + z * (m[8 + c] as number));
  for (let k = 0; k < n; k++) {
    const o = k * 11;
    const at = tr(p.V[o] as number, p.V[o + 1] as number, p.V[o + 2] as number);
    const nn = tr(p.V[o + 3] as number, p.V[o + 4] as number, p.V[o + 5] as number);
    v.set([...at, ...nn, p.V[o + 6] as number, p.V[o + 7] as number], k * CORNER);
  }
  return {
    name: p.part,
    role: 'visual',
    surface: null,
    visible: true,
    shadows: true,
    grass: false,
    draw: [0, null],
    material: p.material,
    v,
    f: Uint32Array.from(p.F),
  };
}

/** A placed object's GMT: its meshes (about its place) and their materials, its place its position. */
export function objectGmt(
  name: string,
  o: Pick<PhysicsObject, 'x' | 'y' | 'z'>,
  meshes: GmtMesh[],
  materials: GmtMaterial[],
  make: (name: string, meshes: GmtMesh[], materials: GmtMaterial[], far: number) => Gmt,
  axes: Axes = TRACK_TO_RF2,
): Gmt {
  return { ...make(name, meshes, materials, OBJECT_FAR), position: axes(o.x, o.y, o.z) };
}

/** A placed object's instance in a layout's scene: knocked about, hit, casting its shadow. */
export const objectInstance = (name: string): Instance => ({
  name,
  mesh: `${name}.gmt`,
  collide: true,
  hat: false,
  moveable: true,
  shadows: true,
});

/** A placed object's GMT's name: its model and a short hash of where it stands and what it says (the same object in
 * two layouts one GMT). */
export const objectName = (model: string, hash: string): string =>
  `${model.replace(/[^A-Za-z0-9_]/g, '_')}_${hash.slice(0, 10)}`.slice(0, 60);

/** What makes a placed object one: its model, place, heading and text. */
export const objectKey = (o: PhysicsObject): string =>
  [o.model, o.x.toFixed(4), o.y.toFixed(4), o.z.toFixed(4), o.heading.toFixed(5), o.text ?? ''].join('|');
