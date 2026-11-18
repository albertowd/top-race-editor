// A start's picture for the BeamNG level, drawn by Chromium (the track's beamng_races.map_preview): the track's roads
// from above, north up, the layout's racing line, an arrow at the start the way the lap runs, and its name; drawn at
// twice the size and made smaller, for smooth edges; a JPEG.
import type { MapSpec } from '../engine/beamng/level';

const SIZE: [number, number] = [800, 600];
const BACK = 'rgb(24, 30, 26)';
const ROAD = 'rgb(92, 96, 102)';
const LINE = 'rgb(255, 118, 34)';
/** the roads' triangles filled at a time */
const PATH_TRIANGLES = 1000;

export async function mapPreview(spec: MapSpec): Promise<Uint8Array> {
  const k = 2;
  const w = SIZE[0] * k;
  const h = SIZE[1] * k;
  const [lo, hi] = spec.frame;
  const margin = 36 * k;
  const s = Math.min((w - 2 * margin) / (hi[0] - lo[0] || 1), (h - 2 * margin - 40 * k) / (hi[1] - lo[1] || 1));
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2] as [number, number];
  const px = (x: number, y: number): [number, number] => [w / 2 + (x - mid[0]) * s, h / 2 + 20 * k - (y - mid[1]) * s];
  const big = new OffscreenCanvas(w, h);
  const g = big.getContext('2d') as OffscreenCanvasRenderingContext2D;
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
    g.lineWidth = 5 * k;
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
  const r = 15 * k;
  g.beginPath();
  g.arc(c[0], c[1], r, 0, Math.PI * 2);
  g.fillStyle = 'rgb(20, 20, 20)';
  g.fill();
  g.lineWidth = 3 * k;
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
  g.font = `bold ${34 * k}px Arial, "DejaVu Sans", sans-serif`;
  g.textBaseline = 'top';
  g.fillText(spec.title, margin, 20 * k);
  const small = new OffscreenCanvas(SIZE[0], SIZE[1]);
  const sg = small.getContext('2d') as OffscreenCanvasRenderingContext2D;
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(big, 0, 0, SIZE[0], SIZE[1]);
  const blob = await small.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return new Uint8Array(await blob.arrayBuffer());
}
