// The start gantries (the catalogue's kind of model "gantries") as the track's build writes them: each a model of its
// own, working in the layouts whose start and finish line it stands over or by, the nearest to it within NEAR (its
// start lamps KS_START_LIGHT_<n>, which AC lights at a race's start, and its flag lamp GANTRY_FLAG, which the track's
// screen script and BeamNG's Lua light), still in the others (NO_START_LIGHT_<n> and STATIC_FLAG: lit by none; its
// board, GANTRY_BOARD, in the library's still material where it has one (stillMaterials), so the screen AC draws on the
// working one's board is not drawn on it). Each layout lists the one it has of each gantry: <model> working,
// <model>_still still; BeamNG's level stands each once, working where some layout has it so (levelModels). Each part a mesh of its own, named as the gantry's model names it; a static one's collision a box
// round each of its feet, the way under it left free.

import type { Kn5 } from './kn5tree';
import { box, COLLISION_OVER, type LaidObject } from './laying';
import { world } from './templates';
import { objectNode } from './trackobjects';

/** the catalogue's kind of a start gantry */
export const GANTRIES = 'gantries';
/** a still gantry's model: its working one's name and this */
export const STILL = '_still';
/** metres from a layout's start and finish line a gantry working there stands at most (over it, or right by it) */
export const NEAR = 30;
/** metres over its feet a gantry's collision stops: what stands lower is its feet, what is higher the way under it */
export const CLEARANCE = 2;

const LAMP = /^KS_START_LIGHT_(\d+)$/;
/** a gantry's board: the mesh a screen is drawn on (BeamNG's level finds it by this name too) */
export const BOARD = 'GANTRY_BOARD';

/** The names a still board's material may have in the library, from a working one's material: Still after it, or in
 * place of its last word (GantryBoard: GantryBoardStill, GantryStill). */
export const stillMaterials = (material: string): string[] => [
  `${material}Still`,
  material.replace(/[A-Z][a-z0-9]*$/, 'Still'),
];

/** A gantry's model's name: the track's model's, the gantry's name after it (track_gantry_1500), and _still for its
 * still one. */
export const gantryModel = (model: string, name: string, working = true): string =>
  `${model}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}${working ? '' : STILL}`;

/** A mesh of a still gantry: its start lamps and flag lamp named so no game lights them. */
export function stillName(mesh: string): string {
  const m = LAMP.exec(mesh);
  if (m) return `NO_START_LIGHT_${m[1]}`;
  return mesh === 'GANTRY_FLAG' ? 'STATIC_FLAG' : mesh;
}

/** The middle of a layout's start and finish line (its first timing gate, TIME_0), or null where it has none. */
export function startLine(layout: {
  timing?: { left: { x: number; z: number }; right: { x: number; z: number } }[];
}): [number, number] | null {
  const g = layout.timing?.[0];
  return g ? [(g.left.x + g.right.x) / 2, (g.left.z + g.right.z) / 2] : null;
}

/** The gantry working in each layout: of those standing in it (in its layouts, or every one), the one nearest its
 * start and finish line's middle (startLine), no farther than within; none where it has no line or no gantry near
 * it. */
export function workingGantries(
  gantries: Pick<LaidObject, 'name' | 'places' | 'layouts'>[],
  starts: Record<string, [number, number] | null | undefined>,
  within = NEAR,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [lay, at] of Object.entries(starts)) {
    let best: string | null = null;
    let near = within;
    if (at)
      for (const g of gantries) {
        if (g.layouts && !g.layouts.includes(lay)) continue;
        for (const [x, z] of g.places) {
          const d = Math.hypot(x - at[0], z - at[1]);
          if (d <= near) {
            near = d;
            best = g.name;
          }
        }
      }
    out[lay] = best;
  }
  return out;
}

/** A gantry's collision: a box round each of its feet (what it has under CLEARANCE over its lowest point, either side
 * of its middle across), each eight points (x, y, z) in the world, as a static object's boxes. */
export function gantryFeet(o: LaidObject): number[][] {
  const out: number[][] = [];
  let low = Infinity;
  for (const p of o.parts) for (let i = 1; i < p.V.length; i += 11) low = Math.min(low, p.V[i] as number);
  for (const [cx, cz, h] of o.places) {
    const c = Math.cos(h);
    const s = Math.sin(h);
    // (each side's lowest and highest across, up and along, in the gantry's own frame: its x across, its z along)
    const sides = [-1, 1].map(() => ({ lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }));
    for (const p of o.parts)
      for (let i = 0; i < p.V.length; i += 11) {
        const y = p.V[i + 1] as number;
        if (y >= low + CLEARANCE) continue;
        const dx = (p.V[i] as number) - cx;
        const dz = (p.V[i + 2] as number) - cz;
        const q = [dx * c - dz * s, y, dx * s + dz * c];
        const side = sides[(q[0] as number) < 0 ? 0 : 1] as (typeof sides)[number];
        for (let k = 0; k < 3; k++) {
          side.lo[k] = Math.min(side.lo[k] as number, q[k] as number);
          side.hi[k] = Math.max(side.hi[k] as number, q[k] as number);
        }
      }
    for (const { lo, hi } of sides) {
      if (!Number.isFinite(lo[0])) continue;
      hi[1] = Math.max(hi[1] as number, low + CLEARANCE) + COLLISION_OVER;
      const { P } = box(lo, hi);
      const W = new Float64Array(8 * 11);
      for (let i = 0; i < 8; i++) W.set(P.slice(i * 3, i * 3 + 3), i * 11);
      const B = world(W, cx, cz, 0, h);
      const pts: number[] = [];
      for (let i = 0; i < 8; i++) pts.push(B[i * 11] as number, B[i * 11 + 1] as number, B[i * 11 + 2] as number);
      out.push(pts);
    }
  }
  return out;
}

/** A gantry laid, into its model k (working or still): each part a mesh named as its model names it (upper-cased:
 * GANTRY_BOARD, KS_START_LIGHT_0...; a still one's lamps renamed), a still one's board in the material stillMaterial
 * gives for its own (none: its own); its boxes (a static one's, its feet) an unseen mesh to hit, 1WALL_<its name>, in
 * its lowest part's material. */
export function writeGantry(
  o: LaidObject,
  k: Kn5,
  materials: Record<string, Kn5>,
  working: boolean,
  stillMaterial: (material: string) => string | null = () => null,
): void {
  k.root.children = [];
  for (const p of o.parts) {
    const own = p.part.toUpperCase();
    const name = working ? own : stillName(own);
    const material = (!working && own === BOARD && stillMaterial(p.material)) || p.material;
    const from = p.from ? { ...materials, [`template:${o.model}`]: p.from } : materials;
    k.root.children.push(objectNode(k, name, p.V, p.F, material, from, true, p.lod));
  }
  if (!o.boxes?.length) return;
  const V = new Float64Array(o.boxes.length * 8 * 11);
  const F: number[] = [];
  const faces = box([0, 0, 0], [1, 1, 1]).F;
  o.boxes.forEach((b, j) => {
    for (let i = 0; i < 8; i++) {
      V.set(b.slice(i * 3, i * 3 + 3), (j * 8 + i) * 11);
      V[(j * 8 + i) * 11 + 4] = 1;
    }
    for (const f of faces) F.push(f + 8 * j);
  });
  // (in the material of what it stands on, its lowest part's: not its board's, a screen's)
  let foot = o.parts[0];
  let low = Infinity;
  for (const p of o.parts)
    for (let i = 1; i < p.V.length; i += 11)
      if ((p.V[i] as number) < low) {
        low = p.V[i] as number;
        foot = p;
      }
  k.root.children.push(objectNode(k, `1WALL_${o.name}`, V, F, foot?.material ?? '', materials, false));
}
