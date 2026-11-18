// Points against a polygon (a ring of [x, z]): inside it, and how far from it. What the terrain's areas, buildings and
// edits ask of shapely (contains_xy, distance), worked out exactly.

export type Ring = readonly (readonly [number, number])[] | number[][];

/** Whether (x, z) is inside the ring (even-odd; its own edge not inside, as contains_xy has it). */
export function inside(ring: Ring, x: number, z: number): boolean {
  let inn = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i] as number[];
    const b = ring[j] as number[];
    const ax = a[0] as number;
    const az = a[1] as number;
    const bx = b[0] as number;
    const bz = b[1] as number;
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inn = !inn;
  }
  return inn && edgeDistance(ring, x, z) > 0;
}

/** The distance from (x, z) to the ring's edge. */
export function edgeDistance(ring: Ring, x: number, z: number): number {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as number[];
    const b = ring[(i + 1) % n] as number[];
    const ax = a[0] as number;
    const az = a[1] as number;
    const dx = (b[0] as number) - ax;
    const dz = (b[1] as number) - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0), 1) : 0;
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}

/** The distance from (x, z) to the polygon: 0 inside it or on its edge. */
export function distance(ring: Ring, x: number, z: number): number {
  return inside(ring, x, z) ? 0 : edgeDistance(ring, x, z);
}

/** Whether (x, z) is within r of the polygon (inside it, or within r of its edge): a polygon grown by r. */
export const within = (ring: Ring, x: number, z: number, r: number): boolean =>
  inside(ring, x, z) || edgeDistance(ring, x, z) <= r;
