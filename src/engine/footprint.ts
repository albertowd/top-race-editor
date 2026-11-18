// A catalogue model's outline seen from above (a building's, a glb template's), for the editor's map: each of its drawn
// meshes the hull round its points from above, in its own frame (x across, z forward, metres), rings x z x z ...; kept
// while its file is the same.

import { loadKn5, type MaterialLibrary } from './gltf';
import type { Kn5Mesh } from './kn5tree';
import { meshes, triangles } from './mesh';
import type { HostFiles } from './placehost';

const kept = new Map<string, { size: number; rings: number[][] }>();

type P2 = [number, number];

/** The hull round points (x z x z ...), as a ring x z x z ... (Andrew's monotone chain). */
export function hull(P: ArrayLike<number>): number[] {
  const pts: P2[] = [];
  for (let i = 0; i + 1 < P.length; i += 2) pts.push([P[i] as number, P[i + 1] as number]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts.flat();
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (list: P2[]) => {
    const out: P2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2] as P2, out[out.length - 1] as P2, p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = chain(pts);
  const upper = chain([...pts].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].flat();
}

/** A model's outline from above: each drawn mesh's hull, x z x z ... each. */
export async function footprintOf(
  files: HostFiles,
  path: string,
  library?: MaterialLibrary,
  textures?: string,
): Promise<number[][]> {
  const size = await files.size(path);
  const was = kept.get(path);
  if (was && was.size === size) return was.rings;
  const k = await loadKn5(files, path, library, textures);
  const rings: number[][] = [];
  for (const [n, m] of meshes(k)) {
    if (!n.faces.length || n.renderable === 0) continue;
    const T = triangles(n as Kn5Mesh, m);
    const P: number[] = [];
    for (let i = 0; i < T.length; i += 3) P.push(T[i] as number, T[i + 2] as number);
    const r = hull(P);
    if (r.length >= 6) rings.push(r.map((v) => Math.round(v * 100) / 100));
  }
  kept.set(path, { size, rings });
  return rings;
}
