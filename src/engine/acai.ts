// Assetto Corsa's AI lines (ai/fast_lane.ai, ai/pit_lane.ai, data/ideal_line.ai) read and written as the track's tools do (ac_ai.py), byte for byte. A file
// (version 7): its points, each where it is (x, y, z), how far along (metres) and its number; then, where it has them, for each the 18 values AC drives by
// (EXTRA); then, for a lap's line, the grid AC finds the line's points by: GRID_MARGIN metres round them in squares of GRID_CELL, each square the GRID_NEAR
// points nearest its middle, nearest first (the nearer by index where two are as near); else 0.

export const AI_VERSION = 7;
/** the values AC drives by at each point, in their order */
export const EXTRA = [
	"speed",
	"gas",
	"brake",
	"obsolete_lat_g",
	"radius",
	"side_left",
	"side_right",
	"camber",
	"direction",
	"normal_x",
	"normal_y",
	"normal_z",
	"length",
	"forward_x",
	"forward_y",
	"forward_z",
	"tag",
	"grade",
] as const;
export const GRID_MARGIN = 350;
export const GRID_CELL = 10;
export const GRID_NEAR = 10;

/** A lap's line's grid: its bounds (float32 as stored), its squares' size, and each square's nearest points (by columns of x, then rows of z). */
export interface AiGrid {
	hi: [number, number, number];
	lo: [number, number, number];
	near: number;
	cell: number;
	nx: number;
	nz: number;
	/** nx * nz * near points' indices */
	cells: Int32Array;
}

export interface AiLine {
	version: number;
	/** x, y, z of each point */
	points: Float32Array;
	along: Float32Array;
	/** 18 values each (EXTRA), where the file has them */
	extra: Float32Array | null;
	grid: AiGrid | null;
}

const f32 = (v: number) => Math.fround(v);

/** An AI file read. */
export function readAiFile(b: Uint8Array): AiLine {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const version = dv.getInt32(0, true);
	const n = dv.getInt32(4, true);
	if (n < 0 || 16 + n * 20 > b.length) throw new Error(`not an AI line (${n} points in ${b.length} bytes)`);
	const points = new Float32Array(n * 3);
	const along = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const at = 16 + i * 20;
		for (let c = 0; c < 3; c++) points[i * 3 + c] = dv.getFloat32(at + c * 4, true);
		along[i] = dv.getFloat32(at + 12, true);
	}
	let p = 16 + n * 20;
	let extra: Float32Array | null = null;
	if (b.length >= p + 4 && dv.getInt32(p, true) === n) {
		extra = new Float32Array(n * 18);
		for (let i = 0; i < n * 18; i++) extra[i] = dv.getFloat32(p + 4 + i * 4, true);
		p += 4 + n * 72;
	}
	const grid = b.length >= p + 4 && dv.getInt32(p, true) ? readGrid(dv, p) : null;
	return { version, points, along, extra, grid };
}

/** A lap's line's grid, as an AI file has it from p. */
function readGrid(dv: DataView, p: number): AiGrid {
	const fl = (k: number) => dv.getFloat32(p + 4 + k * 4, true);
	const near = dv.getInt32(p + 28, true);
	const cell = dv.getFloat32(p + 32, true);
	const nx = dv.getInt32(p + 36, true);
	let q = p + 40;
	const nz = dv.getInt32(q, true);
	const cells = new Int32Array(nx * nz * near);
	for (let i = 0; i < nx; i++) {
		q += 4;
		for (let j = 0; j < nz; j++) {
			q += 4;
			for (let k = 0; k < near; k++, q += 4) cells[(i * nz + j) * near + k] = dv.getInt32(q, true);
		}
	}
	return { hi: [fl(0), fl(1), fl(2)], lo: [fl(3), fl(4), fl(5)], near, cell, nx, nz, cells };
}

/** The grid of a lap's line (ac_ai.grid): its bounds GRID_MARGIN round its points (y 0), and in each GRID_CELL square, by columns of x then rows of z, the
 * GRID_NEAR points nearest its middle, nearest first. */
export function aiGrid(points: ArrayLike<number>): AiGrid {
	const n = points.length / 3;
	let x0 = Infinity;
	let x1 = -Infinity;
	let z0 = Infinity;
	let z1 = -Infinity;
	for (let i = 0; i < n; i++) {
		const x = points[i * 3] as number;
		const z = points[i * 3 + 2] as number;
		x0 = Math.min(x0, x);
		x1 = Math.max(x1, x);
		z0 = Math.min(z0, z);
		z1 = Math.max(z1, z);
	}
	const lo: [number, number, number] = [f32(x0 - GRID_MARGIN), 0, f32(z0 - GRID_MARGIN)];
	const hi: [number, number, number] = [f32(x1 + GRID_MARGIN), 0, f32(z1 + GRID_MARGIN)];
	const nx = Math.trunc((hi[0] - lo[0]) / GRID_CELL);
	const nz = Math.trunc((hi[2] - lo[2]) / GRID_CELL);
	const k = Math.min(GRID_NEAR, n);
	// (the points as stored: 32-bit)
	const X = new Float64Array(n);
	const Z = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		X[i] = f32(points[i * 3] as number);
		Z[i] = f32(points[i * 3 + 2] as number);
	}
	const cells = new Int32Array(nx * nz * k);
	const bestD = new Float64Array(k);
	const bestI = new Int32Array(k);
	for (let i = 0; i < nx; i++) {
		const cx = lo[0] + (i + 0.5) * GRID_CELL;
		for (let j = 0; j < nz; j++) {
			nearest(X, Z, cx, lo[2] + (j + 0.5) * GRID_CELL, bestD, bestI);
			cells.set(bestI.subarray(0, k), (i * nz + j) * k);
		}
	}
	return { hi, lo, near: k, cell: GRID_CELL, nx, nz, cells };
}

/** The points (X, Z) nearest a square's middle (cx, cz), as many as bestI holds, nearest first (the earlier index first where two are as near): their
 * indices in bestI, their distances in bestD. */
function nearest(X: Float64Array, Z: Float64Array, cx: number, cz: number, bestD: Float64Array, bestI: Int32Array): void {
	const n = X.length;
	const k = bestD.length;
	let have = 0;
	for (let m = 0; m < n; m++) {
		const d = Math.hypot((X[m] as number) - cx, (Z[m] as number) - cz);
		if (have === k && d >= (bestD[k - 1] as number)) continue;
		// (in order: a point as near as one kept goes after it, the earlier index first)
		let at = have < k ? have : k - 1;
		while (at > 0 && (bestD[at - 1] as number) > d) {
			if (at < k) {
				bestD[at] = bestD[at - 1] as number;
				bestI[at] = bestI[at - 1] as number;
			}
			at--;
		}
		bestD[at] = d;
		bestI[at] = m;
		if (have < k) have++;
	}
}

/** An AI file's bytes (ac_ai.write): its points, how far along each is, its extra values (18 each) where given, and for a lap's line its grid (made from its
 * points, or as given). */
export function writeAiFile(
	points: ArrayLike<number>,
	along: ArrayLike<number>,
	extra: ArrayLike<number> | null = null,
	grid: AiGrid | boolean = false,
): Uint8Array {
	const n = points.length / 3;
	const g = grid === true ? aiGrid(points) : grid || null;
	const size = 16 + n * 20 + (extra ? 4 + n * 72 : 0) + (g ? 40 + g.nx * 4 + g.nx * g.nz * (4 + g.near * 4) : 4);
	const out = new Uint8Array(size);
	const dv = new DataView(out.buffer);
	dv.setInt32(0, AI_VERSION, true);
	dv.setInt32(4, n, true);
	for (let i = 0; i < n; i++) {
		const at = 16 + i * 20;
		for (let c = 0; c < 3; c++) dv.setFloat32(at + c * 4, points[i * 3 + c] as number, true);
		dv.setFloat32(at + 12, along[i] as number, true);
		dv.setInt32(at + 16, i, true);
	}
	let p = 16 + n * 20;
	if (extra) {
		dv.setInt32(p, n, true);
		for (let i = 0; i < n * 18; i++) dv.setFloat32(p + 4 + i * 4, extra[i] as number, true);
		p += 4 + n * 72;
	}
	if (g) writeGrid(dv, p, g);
	else dv.setInt32(p, 0, true);
	return out;
}

/** A lap's line's grid written into an AI file from p. */
function writeGrid(dv: DataView, p: number, g: AiGrid): void {
	dv.setInt32(p, 1, true);
	for (const [k, v] of [...g.hi, ...g.lo].entries()) dv.setFloat32(p + 4 + k * 4, v, true);
	dv.setInt32(p + 28, g.near, true);
	dv.setFloat32(p + 32, g.cell, true);
	dv.setInt32(p + 36, g.nx, true);
	let q = p + 40;
	for (let i = 0; i < g.nx; i++) {
		dv.setInt32(q, g.nz, true);
		q += 4;
		for (let j = 0; j < g.nz; j++) {
			dv.setInt32(q, g.near, true);
			q += 4;
			for (let k = 0; k < g.near; k++, q += 4) dv.setInt32(q, g.cells[(i * g.nz + j) * g.near + k] as number, true);
		}
	}
}
