// Points against a polygon (a ring of [x, z]): inside it, and how far from it. What the terrain's areas, buildings and edits ask of shapely (contains_xy,
// distance), worked out exactly.

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
export const within = (ring: Ring, x: number, z: number, r: number): boolean => inside(ring, x, z) || edgeDistance(ring, x, z) <= r;

/** Twice a ring's area (anticlockwise: more than 0). */
const area2 = (r: Ring) => {
	let s = 0;
	for (let i = 0; i < r.length; i++) {
		const a = r[i] as readonly [number, number];
		const b = r[(i + 1) % r.length] as readonly [number, number];
		s += a[0] * b[1] - b[0] * a[1];
	}
	return s;
};

/** A simple ring cut into triangles on its own points alone, ear by ear (a sliver, which a Delaunay fill cannot tell the sides of). */
export function earClip(ring: Ring): number[] {
	const idx = ring.map((_, i) => i);
	if (idx.length < 3) return [];
	const sign = area2(ring) > 0 ? 1 : -1;
	const out: number[] = [];
	let guard = 0;
	while (idx.length > 3 && guard++ < 10 * ring.length * ring.length) {
		let best = -1;
		let bi = -1;
		for (let k = 0; k < idx.length; k++) {
			const A = ring[idx[(k + idx.length - 1) % idx.length] as number] as readonly [number, number];
			const B = ring[idx[k] as number] as readonly [number, number];
			const C = ring[idx[(k + 1) % idx.length] as number] as readonly [number, number];
			const cr = sign * ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]));
			if (cr <= 0) continue;
			let blocked = false;
			for (const j of idx) {
				const P = ring[j] as readonly [number, number];
				if (P === A || P === B || P === C) continue;
				const d1 = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]);
				const d2 = (C[0] - B[0]) * (P[1] - B[1]) - (C[1] - B[1]) * (P[0] - B[0]);
				const d3 = (A[0] - C[0]) * (P[1] - C[1]) - (A[1] - C[1]) * (P[0] - C[0]);
				if (sign * d1 >= 0 && sign * d2 >= 0 && sign * d3 >= 0) {
					blocked = true;
					break;
				}
			}
			if (!blocked && cr > best) {
				best = cr;
				bi = k;
			}
		}
		if (bi < 0) break;
		out.push(idx[(bi + idx.length - 1) % idx.length] as number, idx[bi] as number, idx[(bi + 1) % idx.length] as number);
		idx.splice(bi, 1);
	}
	if (idx.length === 3) out.push(...idx);
	return out;
}
