// The roads' bumps on the map, while they are worked on: each tile of them a picture (red where the floor goes up,
// blue where down, the stronger the more), the points of the roads' meshes loaded (those a point is picked from), the
// point picked, the brush's reach at the mouse.

import { MARK_PX } from '../domain/constants';
import type { Box, Vec2 } from '../domain/types';
import { type Bumps, tileBox } from '../editing/bumps';
import type { RoadDesc } from '../engine/roads';
import { roughnessOf } from '../engine/roughness';
import type { EditorState } from '../store/state';

/** metres of bump drawn at its strongest */
export const BUMP_FULL = 0.02;
/** pixels a metre from which the meshes' points are drawn */
const POINTS_PPM = 12;
const PICKED = '#4fa3ff';

/** Each tile's picture (none: no canvas here), kept while the tile is the same. */
const pictures = new WeakMap<Float32Array, HTMLCanvasElement | null>();

function pictureOf(b: Bumps, t: Float32Array): HTMLCanvasElement | null {
  if (pictures.has(t)) return pictures.get(t) ?? null;
  const c = typeof document === 'undefined' ? null : document.createElement('canvas');
  const g = c?.getContext('2d');
  if (!c || !g) {
    pictures.set(t, null);
    return null;
  }
  c.width = b.tile;
  c.height = b.tile;
  const img = g.createImageData(b.tile, b.tile);
  for (let k = 0; k < t.length; k++) {
    const v = t[k] as number;
    const a = Math.min(1, Math.abs(v) / BUMP_FULL);
    const up = v > 0;
    img.data.set([up ? 255 : 60, up ? 80 : 140, up ? 60 : 255, Math.round(a * 190)], k * 4);
  }
  g.putImageData(img, 0, 0);
  pictures.set(t, c);
  return c;
}

/** The surface's roughness over the roads (engine/roughness.ts) as a picture, a point every PREVIEW metres over the
 * roads' box (none: no canvas here, or none of it); kept while the roads and the surface are the same. */
const PREVIEW = 0.25;
let preview: {
  roads: unknown;
  surface: unknown;
  pic: HTMLCanvasElement | null;
  box: [number, number, number, number];
} | null = null;

function roughPicture(s: EditorState) {
  const surface = s.objects?.surface;
  if (preview && preview.roads === s.roads && preview.surface === surface) return preview;
  const rough = roughnessOf(s.roads as unknown as RoadDesc[], surface);
  let pic: HTMLCanvasElement | null = null;
  let box: [number, number, number, number] = [0, 0, 0, 0];
  if (rough && typeof document !== 'undefined') {
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of s.roads)
      for (const n of r.curve ?? []) {
        const w = Math.max(n.left ?? 4, n.right ?? 4) + 2;
        [x0, z0, x1, z1] = [
          Math.min(x0, n.p[0] - w),
          Math.min(z0, n.p[1] - w),
          Math.max(x1, n.p[0] + w),
          Math.max(z1, n.p[1] + w),
        ];
      }
    const W = Math.ceil((x1 - x0) / PREVIEW);
    const H = Math.ceil((z1 - z0) / PREVIEW);
    const c = W > 0 && H > 0 && W * H < 16e6 ? document.createElement('canvas') : null;
    const g = c?.getContext('2d');
    if (c && g) {
      c.width = W;
      c.height = H;
      const img = g.createImageData(W, H);
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const v = rough(x0 + (i + 0.5) * PREVIEW, z0 + (j + 0.5) * PREVIEW);
          if (!v) continue;
          const a = Math.min(1, Math.abs(v) / BUMP_FULL);
          img.data.set([v > 0 ? 255 : 60, v > 0 ? 80 : 140, v > 0 ? 60 : 255, Math.round(a * 150)], (j * W + i) * 4);
        }
      g.putImageData(img, 0, 0);
      pic = c;
      box = [x0, z0, x1, z1];
    }
  }
  preview = { roads: s.roads, surface, pic, box };
  return preview;
}

const meets = ([x0, z0, x1, z1]: readonly [number, number, number, number], b: Box) =>
  x0 <= b.xmax && x1 >= b.xmin && z0 <= b.zmax && z1 >= b.zmin;

/** The bumps drawn in metres (the canvas in the world's transform): their tiles in view; worked on, the points to
 * pick, the one picked, the brush. */
export function drawBumps(g: CanvasRenderingContext2D, s: EditorState, b: Box, ppm: number) {
  const px = 1 / ppm;
  const bumps = s.bumps;
  g.save();
  g.imageSmoothingEnabled = true;
  // (the whole surface's roughness, while bumps are worked on)
  if (s.mode === 'bumps') {
    const r = roughPicture(s);
    if (r.pic && meets(r.box, b)) g.drawImage(r.pic, r.box[0], r.box[1], r.box[2] - r.box[0], r.box[3] - r.box[1]);
  }
  for (const [key, t] of Object.entries(bumps.tiles)) {
    const box = tileBox(bumps, key);
    if (!meets(box, b)) continue;
    const pic = pictureOf(bumps, t);
    // (each point's colour over its cell, the point at its middle)
    if (pic) g.drawImage(pic, box[0] - bumps.cell / 2, box[1] - bumps.cell / 2, box[2] - box[0], box[3] - box[1]);
  }
  g.restore();
  if (s.mode !== 'bumps') return;
  const brush = s.bumpBrush;
  if (brush.mode === 'point') {
    if (ppm >= POINTS_PPM) {
      g.fillStyle = 'rgba(255,255,255,0.7)';
      const r = 1.5 * px;
      for (const m of Object.values(s.meshes)) {
        const P = m.P;
        if (!P) continue;
        for (let i = 0; i < P.length; i += 2) {
          const x = P[i] as number;
          const z = P[i + 1] as number;
          if (x < b.xmin || x > b.xmax || z < b.zmin || z > b.zmax) continue;
          g.fillRect(x - r, z - r, 2 * r, 2 * r);
        }
      }
    }
    const q: Vec2 | null = s.bumpPick;
    if (q) {
      ring(g, q, brush.reach, px, 'rgba(79,163,255,0.6)');
      g.beginPath();
      g.arc(q[0], q[1], (MARK_PX.dot / 1.5) * px, 0, Math.PI * 2);
      g.fillStyle = PICKED;
      g.fill();
    }
    return;
  }
  if (s.mouse)
    ring(
      g,
      s.mouse,
      brush.radius,
      px,
      brush.mode === 'lower' ? '#3c8cff' : brush.mode === 'raise' ? '#ff503c' : '#ffffff',
    );
}

function ring(g: CanvasRenderingContext2D, q: Vec2, r: number, px: number, colour: string) {
  g.beginPath();
  g.arc(q[0], q[1], r, 0, Math.PI * 2);
  g.strokeStyle = colour;
  g.lineWidth = 1.5 * px;
  g.stroke();
}
