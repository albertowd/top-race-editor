import { END_BLEND, INSIDE, TURN_BASE } from "../domain/constants";
import type { Box, CurveNode, Road } from "../domain/types";
import { bezPoint, bezTangent, hullLength, smooth } from "./bezier";

/** A road's middle sampled along it: x, z, its widths left and right, which piece and t, and, once finished, how far along (s), the way to its left (nx, nz),
 * its length and its box. */
export interface Samples {
	X: number[];
	Z: number[];
	L: number[];
	R: number[];
	SEG: number[];
	T: number[];
	DX?: number[];
	DZ?: number[];
	/** the sample each node is at */
	nodeAt: number[];
	s: Float64Array;
	nx: Float64Array;
	nz: Float64Array;
	length: number;
	box: Box;
}

export type RawSamples = Omit<Samples, "s" | "nx" | "nz" | "length" | "box">;

/** A point along a road: its middle, its widths, the way to its left. */
export interface RoadPoint {
	x: number;
	z: number;
	l: number;
	r: number;
	nx: number;
	nz: number;
}

export const emptyBox = (): Box => ({ xmin: Infinity, xmax: -Infinity, zmin: Infinity, zmax: -Infinity });

export function grow(box: Box, x: number, z: number, r = 0): void {
	box.xmin = Math.min(box.xmin, x - r);
	box.xmax = Math.max(box.xmax, x + r);
	box.zmin = Math.min(box.zmin, z - r);
	box.zmax = Math.max(box.zmax, z + r);
}

export const boxesMeet = (a: Box, b: Box): boolean => !(a.xmax < b.xmin || a.xmin > b.xmax || a.zmax < b.zmin || a.zmin > b.zmax);

export const inBox = (box: Box, x: number, z: number, pad = 0): boolean =>
	x >= box.xmin - pad && x <= box.xmax + pad && z >= box.zmin - pad && z <= box.zmax + pad;

/** A curve sampled every step metres or closer. */
export function sampleCurve(nodes: readonly CurveNode[], step = 0.2): Samples {
	const o: RawSamples = { X: [], Z: [], L: [], R: [], SEG: [], T: [], DX: [], DZ: [], nodeAt: [0] };
	for (let i = 0; i < nodes.length - 1; i++) {
		const a = nodes[i];
		const b = nodes[i + 1];
		const n = Math.max(2, Math.ceil(hullLength(a, b) / step));
		for (let k = i ? 1 : 0; k <= n; k++) {
			const t = k / n;
			const [x, z] = bezPoint(a, b, t);
			const [dx, dz] = bezTangent(a, b, t); // (its way there exactly, from the curve itself)
			const e = smooth(t);
			o.X.push(x);
			o.Z.push(z);
			o.L.push(a.left + (b.left - a.left) * e);
			o.R.push(a.right + (b.right - a.right) * e);
			o.SEG.push(i);
			o.T.push(t);
			o.DX?.push(dx);
			o.DZ?.push(dz);
		}
		o.nodeAt.push(o.X.length - 1);
	}
	return finishSamples(o);
}

/** Turning (radians a metre) at each sample, measured over TURN_BASE metres at least. */
function turning(s: Float64Array, nx: Float64Array, nz: Float64Array): Float64Array {
	const n = s.length;
	const h = headings(nx, nz);
	const k = new Float64Array(n);
	// (a small kink at a node, where the samples lie close, is no tight curve)
	for (let i = 0; i < n; i++) {
		let a = i;
		let b = i;
		while (a > 0 && s[i] - s[a] < TURN_BASE) a--;
		while (b < n - 1 && s[b] - s[i] < TURN_BASE) b++;
		const ds = s[b] - s[a];
		k[i] = ds > 1e-9 ? (h[b] - h[a]) / ds : 0;
	}
	return k;
}

/** Each sample's heading (radians), unwound so it never jumps by a turn. */
function headings(nx: Float64Array, nz: Float64Array): Float64Array {
	const h = new Float64Array(nx.length);
	for (let i = 0; i < nx.length; i++) {
		h[i] = Math.atan2(nx[i], -nz[i]);
		if (!i) continue;
		while (h[i] - h[i - 1] > Math.PI) h[i] -= 2 * Math.PI;
		while (h[i] - h[i - 1] < -Math.PI) h[i] += 2 * Math.PI;
	}
	return h;
}

/** The way along at sample i: the curve's own where it has one, else between the samples either side. */
function wayAt(o: RawSamples, i: number): [number, number] {
	if (o.DX && o.DZ && Math.hypot(o.DX[i], o.DZ[i]) > 1e-9) return [o.DX[i], o.DZ[i]];
	const n = o.X.length;
	let a = Math.max(0, i - 1);
	let b = Math.min(n - 1, i + 1);
	while (a > 0 && Math.hypot(o.X[b] - o.X[a], o.Z[b] - o.Z[a]) < 1e-6) a--;
	while (b < n - 1 && Math.hypot(o.X[b] - o.X[a], o.Z[b] - o.Z[a]) < 1e-6) b++;
	return [o.X[b] - o.X[a], o.Z[b] - o.Z[a]];
}

/** Where it turns tighter than it is wide: the side inside the curve no farther out than INSIDE of the curve's radius, as the track's roads.py has it, so its
 * edge closes to a fan and never folds back. */
function keepInside(o: RawSamples, k: Float64Array): void {
	const n = k.length;
	for (let i = 0; i < n; i++) {
		let kl = 0;
		let kr = 0;
		for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
			kl = Math.max(kl, k[j]);
			kr = Math.max(kr, -k[j]);
		}
		if (kl > 1e-6) o.L[i] = Math.min(o.L[i], INSIDE / kl);
		if (kr > 1e-6) o.R[i] = Math.min(o.R[i], INSIDE / kr);
	}
}

/** Samples finished: how far along, the way to the left, the widths kept inside tight curves, the box. */
export function finishSamples(o: RawSamples): Samples {
	const n = o.X.length;
	const s = new Float64Array(n);
	const nx = new Float64Array(n);
	const nz = new Float64Array(n);
	for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(o.X[i] - o.X[i - 1], o.Z[i] - o.Z[i - 1]);
	for (let i = 0; i < n; i++) {
		const [tx, tz] = wayAt(o, i);
		const m = Math.hypot(tx, tz) || 1;
		nx[i] = -tz / m; // (its left, as the track's roads.py has it)
		nz[i] = tx / m;
	}
	keepInside(o, turning(s, nx, nz));
	const box = emptyBox();
	for (let i = 0; i < n; i++) grow(box, o.X[i], o.Z[i], Math.max(o.L[i], o.R[i]) + 1);
	return { ...o, s, nx, nz, length: s[n - 1] || 0, box };
}

/** The sample at or before s along, and how far on to the next. */
export function interpAt(o: Samples, s: number): [number, number] {
	const A = o.s;
	let lo = 0;
	let hi = A.length - 1;
	if (s <= 0) return [0, 0];
	if (s >= o.length) return [hi, 0];
	while (hi - lo > 1) {
		const m = (lo + hi) >> 1;
		if (A[m] <= s) lo = m;
		else hi = m;
	}
	return [lo, (s - A[lo]) / Math.max(A[hi] - A[lo], 1e-9)];
}

/** The road at s metres along. */
export function pointAt(o: Samples, s: number): RoadPoint {
	const [i, f] = interpAt(o, s);
	const j = Math.min(i + 1, o.X.length - 1);
	const mix = (A: ArrayLike<number>) => A[i] + (A[j] - A[i]) * f;
	const nx = mix(o.nx);
	const nz = mix(o.nz);
	const m = Math.hypot(nx, nz) || 1;
	return { x: mix(o.X), z: mix(o.Z), l: mix(o.L), r: mix(o.R), nx: nx / m, nz: nz / m };
}

/** The sample nearest a point: which, how far off, how far along. */
export function nearestOn(o: Samples, x: number, z: number): { i: number; d: number; s: number } {
	let best = 0;
	let bd = Infinity;
	for (let i = 0; i < o.X.length; i++) {
		const d = (o.X[i] - x) ** 2 + (o.Z[i] - z) ** 2;
		if (d < bd) {
			bd = d;
			best = i;
		}
	}
	return { i: best, d: Math.sqrt(bd), s: o.s[best] };
}

/** from / to along a road, kept on it (to: null for its end). */
export const span = (o: Samples, from?: number | null, to?: number | null): [number, number] => [Math.max(0, from ?? 0), Math.min(o.length, to ?? o.length)];

/** Its rows' way across turned, within END_BLEND of each end, into its end rows' (start_left / end_left). */
export function endsTurned(road: Pick<Road, "start_left" | "end_left">, o: Samples): Samples {
	for (const [e, fromStart] of [
		[road.start_left, true],
		[road.end_left, false],
	] as const) {
		if (!e) continue;
		for (let i = 0; i < o.X.length; i++) {
			const d = fromStart ? o.s[i] : o.length - o.s[i];
			if (d >= END_BLEND) continue;
			const w = smooth(Math.min(Math.max(1 - d / END_BLEND, 0), 1));
			const nx = o.nx[i] * (1 - w) + e[0] * w;
			const nz = o.nz[i] * (1 - w) + e[1] * w;
			const m = Math.hypot(nx, nz) || 1;
			o.nx[i] = nx / m;
			o.nz[i] = nz / m;
		}
	}
	return o;
}
