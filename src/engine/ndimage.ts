// What the track's terrain is made with from scipy.ndimage, on grids of 64-bit floats: gaussian, uniform, minimum and maximum filters, grey opening, and
// map_coordinates (linear, and cubic splines with their prefilter), each as scipy has it: the same edges (modes), the same padding, the same order of passes.
// Checked against scipy by the parity cases (within 1e-9).

/** A grid: rows (its first axis, z) of cols (its second, x), row after row. */
export interface Grid {
	rows: number;
	cols: number;
	data: Float64Array;
}

export type Mode = "reflect" | "nearest" | "constant" | "mirror";

export const grid = (rows: number, cols: number, data?: ArrayLike<number>): Grid => ({
	rows,
	cols,
	data: data ? Float64Array.from(data) : new Float64Array(rows * cols),
});

/** Index i of a line of n, its edge extended as mode has it (-1: past it, constant). */
function extend(i: number, n: number, mode: Mode): number {
	if (i >= 0 && i < n) return i;
	if (mode === "constant") return -1;
	if (mode === "nearest") return i < 0 ? 0 : n - 1;
	if (n === 1) return 0;
	if (mode === "reflect") {
		// (d c b a | a b c d | d c b a)
		const period = 2 * n;
		let k = ((i % period) + period) % period;
		if (k >= n) k = period - 1 - k;
		return k;
	}
	// mirror: (d c b | a b c d | c b a)
	const period = 2 * n - 2;
	let k = ((i % period) + period) % period;
	if (k >= n) k = period - k;
	return k;
}

/** A line of a grid along an axis (0: down a column, 1: along a row). */
function lines(g: Grid, axis: 0 | 1): { count: number; n: number; at: (line: number, i: number) => number } {
	return axis === 1 ? { count: g.rows, n: g.cols, at: (l, i) => l * g.cols + i } : { count: g.cols, n: g.rows, at: (l, i) => i * g.cols + l };
}

/** Each line along an axis made anew by fn (its values, extended as mode has it, to its new ones). */
function along(g: Grid, axis: 0 | 1, fn: (get: (i: number) => number, n: number, out: Float64Array) => void): Grid {
	const out = grid(g.rows, g.cols);
	const L = lines(g, axis);
	const line = new Float64Array(L.n);
	for (let l = 0; l < L.count; l++) {
		fn((i) => g.data[L.at(l, i)] as number, L.n, line);
		for (let i = 0; i < L.n; i++) out.data[L.at(l, i)] = line[i] as number;
	}
	return out;
}

/** scipy's correlate1d: each value the weights' sum over its neighbours (the weights centred, symmetric ones as scipy adds them: the middle, then each pair
 * from the farthest in). */
export function correlate1d(g: Grid, weights: number[], axis: 0 | 1, mode: Mode = "reflect", cval = 0): Grid {
	const size1 = (weights.length - 1) >> 1;
	const symmetric = weights.every((w, j) => w === weights[weights.length - 1 - j]);
	return along(g, axis, (get, n, out) => {
		const v = (i: number) => {
			const k = extend(i, n, mode);
			return k < 0 ? cval : get(k);
		};
		for (let i = 0; i < n; i++) {
			let s: number;
			if (symmetric) {
				s = v(i) * (weights[size1] as number);
				for (let j = -size1; j < 0; j++) s += (v(i + j) + v(i - j)) * (weights[size1 + j] as number);
			} else {
				s = 0;
				for (let j = 0; j < weights.length; j++) s += v(i + j - size1) * (weights[j] as number);
			}
			out[i] = s;
		}
	});
}

/** scipy's Gaussian kernel: exp(-x² / 2σ²) over ±int(truncate σ + 0.5), summing to 1. */
export function gaussianKernel(sigma: number, truncate = 4): number[] {
	const radius = Math.trunc(truncate * sigma + 0.5);
	const k: number[] = [];
	for (let x = -radius; x <= radius; x++) k.push(Math.exp((-0.5 / (sigma * sigma)) * x * x));
	const sum = k.reduce((a, b) => a + b, 0);
	return k.map((w) => w / sum);
}

/** scipy's gaussian_filter: along each axis in turn, the first first. */
export function gaussianFilter(g: Grid, sigma: number | [number, number], mode: Mode = "reflect", truncate = 4): Grid {
	const s = typeof sigma === "number" ? [sigma, sigma] : sigma;
	let out = g;
	for (const axis of [0, 1] as const) if ((s[axis] as number) > 1e-15) out = correlate1d(out, gaussianKernel(s[axis] as number, truncate), axis, mode);
	return out;
}

/** scipy's uniform_filter: the mean over size values along each axis (a running sum, each mean that sum divided, as scipy keeps them: the same rounding, so a
 * mean on a rule's edge falls on the same side of it). */
export function uniformFilter(g: Grid, size: number, mode: Mode = "reflect"): Grid {
	let out = g;
	for (const axis of [0, 1] as const)
		out = along(out, axis, (get, n, line) => {
			const v = (i: number) => get(extend(i, n, mode));
			const start = -(size >> 1);
			let s = 0;
			for (let j = 0; j < size; j++) s += v(start + j);
			line[0] = s / size;
			for (let i = 1; i < n; i++) {
				s += v(i + start + size - 1) - v(i + start - 1);
				line[i] = s / size;
			}
		});
	return out;
}

/** The least (or most) over size values along each axis: scipy's minimum_filter (maximum_filter). */
function extremeFilter(g: Grid, size: number, most: boolean, mode: Mode): Grid {
	let out = g;
	for (const axis of [0, 1] as const)
		out = along(out, axis, (get, n, line) => {
			const start = -(size >> 1);
			for (let i = 0; i < n; i++) {
				let best = most ? -Infinity : Infinity;
				for (let j = 0; j < size; j++) {
					const x = get(extend(i + start + j, n, mode));
					if (most ? x > best : x < best) best = x;
				}
				line[i] = best;
			}
		});
	return out;
}

export const minimumFilter = (g: Grid, size: number, mode: Mode = "reflect") => extremeFilter(g, size, false, mode);
export const maximumFilter = (g: Grid, size: number, mode: Mode = "reflect") => extremeFilter(g, size, true, mode);

/** scipy's grey_opening over a square of an odd size: its minimum, then the maximum of that. */
export function greyOpening(g: Grid, size: number, mode: Mode = "reflect"): Grid {
	if (!(size & 1)) throw new Error("grey opening: an odd size only");
	return maximumFilter(minimumFilter(g, size, mode), size, mode);
}

// ---- cubic splines ---------------------------------------------------------------------------------------------

const POLE = Math.sqrt(3) - 2;
/** cells scipy pads a grid with (its edge values) before its splines, mode 'nearest' */
const PAD = 12;

/** A line's cubic B-spline coefficients, in place (scipy's apply_filter, its edges as mode 'reflect' starts them). */
function splineLine(c: Float64Array): void {
	const n = c.length;
	if (n === 1) return;
	const z = POLE;
	const gain = (1 - z) * (1 - 1 / z);
	for (let i = 0; i < n; i++) c[i] = (c[i] as number) * gain;
	// (causal: from the start, its first started as a reflected line has it)
	const zn = z ** n;
	const c0 = c[0] as number;
	let first = c0 + zn * (c[n - 1] as number);
	let zi = z;
	for (let i = 1; i < n; i++) {
		first += zi * ((c[i] as number) + zn * (c[n - 1 - i] as number));
		zi *= z;
	}
	c[0] = first * (z / (1 - zn * zn)) + c0;
	for (let i = 1; i < n; i++) c[i] = (c[i] as number) + z * (c[i - 1] as number);
	// (anticausal: back from the end)
	c[n - 1] = (c[n - 1] as number) * (z / (z - 1));
	for (let i = n - 2; i >= 0; i--) c[i] = z * ((c[i + 1] as number) - (c[i] as number));
}

/** A grid padded by PAD of its edge values all round. */
function padEdge(g: Grid): Grid {
	const rows = g.rows + 2 * PAD;
	const cols = g.cols + 2 * PAD;
	const out = grid(rows, cols);
	for (let i = 0; i < rows; i++) {
		const si = Math.min(Math.max(i - PAD, 0), g.rows - 1);
		for (let j = 0; j < cols; j++) {
			const sj = Math.min(Math.max(j - PAD, 0), g.cols - 1);
			out.data[i * cols + j] = g.data[si * g.cols + sj] as number;
		}
	}
	return out;
}

/** A grid's cubic spline coefficients along both axes (scipy's spline_filter, order 3), padded as scipy pads for mode 'nearest'. */
export function splineCoefficients(g: Grid): Grid {
	const p = padEdge(g);
	for (const axis of [0, 1] as const) {
		const L = lines(p, axis);
		const line = new Float64Array(L.n);
		for (let l = 0; l < L.count; l++) {
			for (let i = 0; i < L.n; i++) line[i] = p.data[L.at(l, i)] as number;
			splineLine(line);
			for (let i = 0; i < L.n; i++) p.data[L.at(l, i)] = line[i] as number;
		}
	}
	return p;
}

/** The cubic B-spline's four weights at t (0-1) past a knot. */
function cubicWeights(t: number): [number, number, number, number] {
	const u = 1 - t;
	return [(u * u * u) / 6, (3 * t * t * t - 6 * t * t + 4) / 6, (3 * u * u * u - 6 * u * u + 4) / 6, (t * t * t) / 6];
}

/** A grid read at points, as scipy's map_coordinates reads it. */
export class Sampler {
	private readonly coeff: Grid | null;

	/** order 1: linear between its values; order 3: cubic splines through them (prefiltered, the grid padded with its edges first, as scipy does for mode
	 * 'nearest'). mode: what lies past its edges ('nearest': the edge's; 'constant': cval, and nothing read past the edge at all). */
	constructor(
		readonly g: Grid,
		readonly order: 1 | 3 = 3,
		readonly mode: "nearest" | "constant" = "nearest",
		readonly cval = 0,
	) {
		if (order === 3 && mode !== "nearest") throw new Error("cubic sampling: mode nearest only");
		this.coeff = order === 3 ? splineCoefficients(g) : null;
	}

	/** The grid at row r, column c (fractional: its first axis, its second). */
	at(r: number, c: number): number {
		const g = this.g;
		if (this.order === 1) {
			if (this.mode === "constant") {
				if (!(r >= 0 && r <= g.rows - 1 && c >= 0 && c <= g.cols - 1)) return this.cval;
			} else {
				r = Math.min(Math.max(r, 0), g.rows - 1);
				c = Math.min(Math.max(c, 0), g.cols - 1);
			}
			const r0 = Math.floor(r);
			const c0 = Math.floor(c);
			const fr = r - r0;
			const fc = c - c0;
			const v = (i: number, j: number) => g.data[Math.min(i, g.rows - 1) * g.cols + Math.min(j, g.cols - 1)] as number;
			const a = v(r0, c0) * (1 - fc) + v(r0, c0 + 1) * fc;
			const b = v(r0 + 1, c0) * (1 - fc) + v(r0 + 1, c0 + 1) * fc;
			return a * (1 - fr) + b * fr;
		}
		const p = this.coeff as Grid;
		// (in the padded grid, the point kept within it)
		const rr = Math.min(Math.max(r + PAD, 0), p.rows - 1);
		const cc = Math.min(Math.max(c + PAD, 0), p.cols - 1);
		const r0 = Math.floor(rr);
		const c0 = Math.floor(cc);
		const wr = cubicWeights(rr - r0);
		const wc = cubicWeights(cc - c0);
		let s = 0;
		for (let i = 0; i < 4; i++) {
			const ri = Math.min(Math.max(r0 - 1 + i, 0), p.rows - 1);
			let row = 0;
			for (let j = 0; j < 4; j++) {
				const cj = Math.min(Math.max(c0 - 1 + j, 0), p.cols - 1);
				row += (p.data[ri * p.cols + cj] as number) * (wc[j] as number);
			}
			s += row * (wr[i] as number);
		}
		return s;
	}
}
