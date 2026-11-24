// Rings drawn on the map (the areas, the edits' shapes): what the mouse is on, and their edits.

import type { Vec2 } from "../domain/types";

/** Whether (x, z) is inside the ring (even-odd). */
export function inRing(ring: readonly Vec2[], x: number, z: number): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, zi] = ring[i];
		const [xj, zj] = ring[j];
		if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
	}
	return inside;
}

/** The ring's point nearest (x, z) within tol metres, or -1. */
export function pointNear(ring: readonly Vec2[], x: number, z: number, tol: number): number {
	let best = -1;
	let bd = tol;
	ring.forEach(([px, pz], i) => {
		const d = Math.hypot(px - x, pz - z);
		if (d <= bd) {
			bd = d;
			best = i;
		}
	});
	return best;
}

/** The ring's side nearest (x, z) within tol metres (from point i to the next), and where on it; null if none. */
export function sideNear(ring: readonly Vec2[], x: number, z: number, tol: number): { i: number; p: Vec2 } | null {
	let best: { i: number; p: Vec2 } | null = null;
	let bd = tol;
	for (let i = 0; i < ring.length; i++) {
		const [ax, az] = ring[i];
		const [bx, bz] = ring[(i + 1) % ring.length];
		const L = (bx - ax) ** 2 + (bz - az) ** 2;
		const t = L > 0 ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L)) : 0;
		const p: Vec2 = [ax + (bx - ax) * t, az + (bz - az) * t];
		const d = Math.hypot(p[0] - x, p[1] - z);
		if (d <= bd) {
			bd = d;
			best = { i, p };
		}
	}
	return best;
}

export const centroid = (ring: readonly Vec2[]): Vec2 => {
	const n = ring.length || 1;
	return [ring.reduce((a, p) => a + p[0], 0) / n, ring.reduce((a, p) => a + p[1], 0) / n];
};

export function ringBox(ring: readonly Vec2[]) {
	const xs = ring.map((p) => p[0]);
	const zs = ring.map((p) => p[1]);
	return { xmin: Math.min(...xs), xmax: Math.max(...xs), zmin: Math.min(...zs), zmax: Math.max(...zs) };
}

/** A ring's area (square metres). */
export function ringArea(ring: readonly Vec2[]): number {
	let a = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
	return Math.abs(a) / 2;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const roundPoint = (p: Vec2): Vec2 => [r3(p[0]), r3(p[1])];
