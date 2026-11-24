// A layout's drawn pictures, by Chromium (layoutmap.ts's): its map, where the track cannot be rendered (no GPU: the
// roads from above, north up, its racing line, an arrow at its start the way the lap runs, its name; a JPEG), and AC's
// outline of it (its line white edged black, see-through round it; a PNG). Each drawn at twice the size and made
// smaller, for smooth edges; renders (render.ts) made smaller the same way.
import type { MapSpec, OutlineSpec } from '../engine/layoutmap';

const SIZE: [number, number] = [800, 600];
const BACK = 'rgb(24, 30, 26)';
const ROAD = 'rgb(92, 96, 102)';
const LINE = 'rgb(255, 118, 34)';
/** the roads' triangles filled at a time */
const PATH_TRIANGLES = 1000;
/** drawn this many times larger, then made smaller */
const K = 2;

type G = OffscreenCanvasRenderingContext2D;

/** A big canvas made small, as the format asked. */
export async function finished(
  big: OffscreenCanvas,
  size: [number, number],
  format: 'jpeg' | 'png',
): Promise<Uint8Array> {
  const small = new OffscreenCanvas(size[0], size[1]);
  const sg = small.getContext('2d') as G;
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(big, 0, 0, size[0], size[1]);
  const blob = await small.convertToBlob(
    format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 },
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export async function mapPreview(spec: MapSpec): Promise<Uint8Array> {
  const w = SIZE[0] * K;
  const h = SIZE[1] * K;
  const [lo, hi] = spec.frame;
  const margin = 36 * K;
  const s = Math.min((w - 2 * margin) / (hi[0] - lo[0] || 1), (h - 2 * margin - 40 * K) / (hi[1] - lo[1] || 1));
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2] as [number, number];
  const px = (x: number, y: number): [number, number] => [w / 2 + (x - mid[0]) * s, h / 2 + 20 * K - (y - mid[1]) * s];
  const big = new OffscreenCanvas(w, h);
  const g = big.getContext('2d') as G;
  g.fillStyle = BACK;
  g.fillRect(0, 0, w, h);
  g.fillStyle = ROAD;
  // (a few triangles a path: Chromium takes ever longer for each one more a path has, a path of 100 000 half a minute)
  g.beginPath();
  for (let i = 0, n = 1; i + 5 < spec.roads.length; i += 6, n++) {
    const a = px(spec.roads[i] as number, spec.roads[i + 1] as number);
    const b = px(spec.roads[i + 2] as number, spec.roads[i + 3] as number);
    const c = px(spec.roads[i + 4] as number, spec.roads[i + 5] as number);
    g.moveTo(...a);
    g.lineTo(...b);
    g.lineTo(...c);
    g.closePath();
    if (n % PATH_TRIANGLES === 0) {
      g.fill();
      g.beginPath();
    }
  }
  g.fill();
  if (spec.line.length >= 4) {
    g.strokeStyle = LINE;
    g.lineWidth = 5 * K;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(...px(spec.line[0] as number, spec.line[1] as number));
    for (let i = 2; i + 1 < spec.line.length; i += 2)
      g.lineTo(...px(spec.line[i] as number, spec.line[i + 1] as number));
    g.closePath();
    g.stroke();
  }
  // (the start: a white arrow over a dark ring, pointing the way the lap runs)
  const c = px(spec.at[0], spec.at[1]);
  let f: [number, number] = [spec.fwd[0], -spec.fwd[1]];
  const L = Math.hypot(...f) || 1;
  f = [f[0] / L, f[1] / L];
  const side: [number, number] = [-f[1], f[0]];
  const r = 15 * K;
  g.beginPath();
  g.arc(c[0], c[1], r, 0, Math.PI * 2);
  g.fillStyle = 'rgb(20, 20, 20)';
  g.fill();
  g.lineWidth = 3 * K;
  g.strokeStyle = 'white';
  g.stroke();
  const tip: [number, number] = [c[0] + f[0] * r * 0.75, c[1] + f[1] * r * 0.75];
  const back: [number, number] = [c[0] - f[0] * r * 0.55, c[1] - f[1] * r * 0.55];
  g.beginPath();
  g.moveTo(...tip);
  g.lineTo(back[0] + side[0] * r * 0.55, back[1] + side[1] * r * 0.55);
  g.lineTo(c[0] - f[0] * r * 0.2, c[1] - f[1] * r * 0.2);
  g.lineTo(back[0] - side[0] * r * 0.55, back[1] - side[1] * r * 0.55);
  g.closePath();
  g.fillStyle = 'white';
  g.fill();
  g.font = `bold ${34 * K}px Arial, "DejaVu Sans", sans-serif`;
  g.textBaseline = 'top';
  g.fillText(spec.title, margin, 20 * K);
  return finished(big, SIZE, 'jpeg');
}

/** AC's outline of a layout: its line white edged black, fitted to the picture, see-through round it (a PNG). */
export async function outline(spec: OutlineSpec): Promise<Uint8Array> {
  const w = spec.size[0] * K;
  const h = spec.size[1] * K;
  const big = new OffscreenCanvas(w, h);
  const g = big.getContext('2d') as G;
  const l = spec.line;
  if (l.length >= 4) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 1 < l.length; i += 2) {
      x0 = Math.min(x0, l[i] as number);
      x1 = Math.max(x1, l[i] as number);
      y0 = Math.min(y0, l[i + 1] as number);
      y1 = Math.max(y1, l[i + 1] as number);
    }
    const pad = 12 * K;
    const s = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (y1 - y0 || 1));
    const px = (x: number, y: number): [number, number] => [
      w / 2 + (x - (x0 + x1) / 2) * s,
      h / 2 - (y - (y0 + y1) / 2) * s,
    ];
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(...px(l[0] as number, l[1] as number));
    for (let i = 2; i + 1 < l.length; i += 2) g.lineTo(...px(l[i] as number, l[i + 1] as number));
    g.closePath();
    g.strokeStyle = 'black';
    g.lineWidth = 7 * K;
    g.stroke();
    g.strokeStyle = 'white';
    g.lineWidth = 4 * K;
    g.stroke();
  }
  return finished(big, spec.size, 'png');
}
