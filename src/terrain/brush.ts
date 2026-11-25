// The brushes: they paint a raster edit's metres added, a dab at a time, raising, lowering, smoothing the ground or bringing it to a height. A raster grows as
// the brush goes past its edge.

import type { Raster } from "./types";

export type BrushMode = "raise" | "lower" | "smooth" | "flatten";

export interface Brush {
	mode: BrushMode;
	/** metres, the brush's reach */
	radius: number;
	/** 0 to 1: how much a dab does */
	strength: number;
	/** the height flattening brings the ground to (the track's y) */
	target: number;
}

/** metres a dab raises or lowers the ground by at its middle, at full strength */
export const RAISE_A_DAB = 0.2;
/** the share of the way to its target (flatten, smooth) a dab goes at its middle, at full strength */
export const SHARE_A_DAB = 0.5;
/** metres a new raster's cell */
export const BRUSH_CELL = 1;
/** cells a raster grows by at a time */
const GROW = 16;
export const MAX_CELLS = 4096;

export interface CellBox {
	i0: number;
	i1: number;
	j0: number;
	j1: number;
}

const smoothstep = (t: number) => {
	const c = Math.min(1, Math.max(0, t));
	return c * c * (3 - 2 * c);
};

/** How much of a dab a point at d metres from its middle has: all at the middle, nothing at its reach. */
export const falloff = (d: number, radius: number) => (radius > 0 ? 1 - smoothstep(d / radius) : 0);

export const emptyRaster = (x0: number, z0: number, nx: number, nz: number, cell = BRUSH_CELL): Raster => ({
	x0,
	z0,
	cell,
	nx,
	nz,
	v: new Float32Array(nx * nz),
});

/** A raster (none: a new one) grown to cover x0..x1, z0..z1 (a margin over), its values kept; the same one if it already does. */
export function covering(r: Raster | null, x0: number, z0: number, x1: number, z1: number): Raster {
	if (!r) {
		const c = BRUSH_CELL;
		const ax = Math.floor(x0 / c) * c - GROW * c;
		const az = Math.floor(z0 / c) * c - GROW * c;
		const nx = Math.min(MAX_CELLS, Math.ceil((x1 - ax) / c) + GROW + 1);
		const nz = Math.min(MAX_CELLS, Math.ceil((z1 - az) / c) + GROW + 1);
		return emptyRaster(ax, az, nx, nz, c);
	}
	const c = r.cell;
	const left = x0 < r.x0 ? Math.ceil((r.x0 - x0) / c) + GROW : 0;
	const down = z0 < r.z0 ? Math.ceil((r.z0 - z0) / c) + GROW : 0;
	const xEnd = r.x0 + (r.nx - 1) * c;
	const zEnd = r.z0 + (r.nz - 1) * c;
	const right = x1 > xEnd ? Math.ceil((x1 - xEnd) / c) + GROW : 0;
	const up = z1 > zEnd ? Math.ceil((z1 - zEnd) / c) + GROW : 0;
	if (!(left || down || right || up)) return r;
	const nx = Math.min(MAX_CELLS, r.nx + left + right);
	const nz = Math.min(MAX_CELLS, r.nz + down + up);
	const out = emptyRaster(r.x0 - left * c, r.z0 - down * c, nx, nz, c);
	for (let j = 0; j < r.nz && j + down < nz; j++) {
		const row = r.v.subarray(j * r.nx, j * r.nx + Math.min(r.nx, nx - left));
		out.v.set(row, (j + down) * nx + left);
	}
	return out;
}

/** The cells of a raster within radius of (x, z). */
export function cellsNear(r: Raster, x: number, z: number, radius: number): CellBox | null {
	const i0 = Math.max(0, Math.ceil((x - radius - r.x0) / r.cell));
	const i1 = Math.min(r.nx - 1, Math.floor((x + radius - r.x0) / r.cell));
	const j0 = Math.max(0, Math.ceil((z - radius - r.z0) / r.cell));
	const j1 = Math.min(r.nz - 1, Math.floor((z + radius - r.z0) / r.cell));
	return i0 > i1 || j0 > j1 ? null : { i0, i1, j0, j1 };
}

/** Each value of a patch made the mean of those within k cells of it (along rows, then columns). */
function boxBlur(v: Float64Array, w: number, h: number, k: number): Float64Array {
	const pass = (src: Float64Array, along: boolean) => {
		const out = new Float64Array(src.length);
		const n = along ? w : h;
		const lines = along ? h : w;
		for (let l = 0; l < lines; l++) {
			const at = (i: number) => (along ? l * w + i : i * w + l);
			for (let i = 0; i < n; i++) {
				let sum = 0;
				let count = 0;
				for (let q = Math.max(0, i - k); q <= Math.min(n - 1, i + k); q++) {
					sum += src[at(q)];
					count++;
				}
				out[at(i)] = sum / count;
			}
		}
		return out;
	};
	return pass(pass(v, true), false);
}

/** The middle of a raster's column i, in metres. */
const cellX = (r: Raster, i: number) => r.x0 + i * r.cell;
/** The middle of a raster's row j, in metres. */
const cellZ = (r: Raster, j: number) => r.z0 + j * r.cell;

/** A dab raising (or lowering) the ground by metres at its middle, less out to its reach. */
function raiseDab(r: Raster, x: number, z: number, radius: number, by: number, { i0, i1, j0, j1 }: CellBox): void {
	for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) r.v[j * r.nx + i] += by * falloff(Math.hypot(cellX(r, i) - x, cellZ(r, j) - z), radius);
}

/** A dab bringing the ground its share of the way to the brush's height. */
function flattenDab(r: Raster, x: number, z: number, b: Brush, share: number, { i0, i1, j0, j1 }: CellBox, height: (x: number, z: number) => number): void {
	for (let j = j0; j <= j1; j++)
		for (let i = i0; i <= i1; i++) {
			const f = falloff(Math.hypot(cellX(r, i) - x, cellZ(r, j) - z), b.radius);
			if (f > 0) r.v[j * r.nx + i] += (b.target - height(cellX(r, i), cellZ(r, j))) * share * f;
		}
}

/** A dab bringing the ground its share of the way to the mean of the ground within half the brush's reach, worked out on a patch that far wider. */
function smoothDab(
	r: Raster,
	x: number,
	z: number,
	radius: number,
	share: number,
	{ i0, i1, j0, j1 }: CellBox,
	height: (x: number, z: number) => number,
): void {
	const k = Math.max(1, Math.round(radius / 2 / r.cell));
	const w = i1 - i0 + 1 + 2 * k;
	const h = j1 - j0 + 1 + 2 * k;
	const y = new Float64Array(w * h);
	for (let q = 0; q < h; q++) for (let p = 0; p < w; p++) y[q * w + p] = height(cellX(r, i0 - k + p), cellZ(r, j0 - k + q));
	const mean = boxBlur(y, w, h, k);
	for (let j = j0; j <= j1; j++)
		for (let i = i0; i <= i1; i++) {
			const f = falloff(Math.hypot(cellX(r, i) - x, cellZ(r, j) - z), radius);
			const at = (j - j0 + k) * w + (i - i0 + k);
			if (f > 0) r.v[j * r.nx + i] += (mean[at] - y[at]) * share * f;
		}
}

/** One dab at (x, z), painted into the raster (it must cover the dab: see covering); height(x, z) is the ground as it is now. The cells it changed. */
export function dab(r: Raster, x: number, z: number, b: Brush, height: (x: number, z: number) => number): CellBox | null {
	const box = cellsNear(r, x, z, b.radius);
	if (!box) return null;
	const s = Math.min(1, Math.max(0, b.strength));
	if (b.mode === "raise" || b.mode === "lower") {
		raiseDab(r, x, z, b.radius, (b.mode === "raise" ? 1 : -1) * RAISE_A_DAB * s, box);
		return box;
	}
	const share = SHARE_A_DAB * s;
	if (b.mode === "flatten") flattenDab(r, x, z, b, share, box, height);
	// (smooth: towards the mean of the ground within half the brush's reach, worked out on a patch that far wider)
	else smoothDab(r, x, z, b.radius, share, box, height);
	return box;
}

/** The dabs along a stroke from a to b: every quarter of the brush's reach (b, not a, if they are closer). */
export function dabsAlong(a: [number, number], b: [number, number], radius: number): [number, number][] {
	const step = Math.max(radius / 4, 0.05);
	const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
	const n = Math.floor(d / step);
	const out: [number, number][] = [];
	for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k * step) / d, a[1] + ((b[1] - a[1]) * k * step) / d]);
	return out;
}
