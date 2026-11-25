// A track's road meshes not described yet, and one brought in as roads (geometry.py's road_meshes and bring_in, the track's read_road.py, describe_roads.py's
// describe and describe_strip, road_grid.py's grid): read however it lets itself be (by its rows, mapped along it; as a strip, its outline four-cornered; as a
// ring round an infield, two halves joined end to end), each a curve fitted to it, as the page has roads, not saved.

import { geosReady } from "./geos";
import { fromGltf, type MaterialLibrary, readGlb } from "./gltf";
import type { Kn5, Kn5Mesh, Mat4 } from "./kn5tree";
import { VERT } from "./kn5tree";
import { metres, outlineOf, unit } from "./merge";
import { meshes, triangles } from "./mesh";
import { byCodePoint } from "./order";
import type { HostFiles } from "./placehost";
import { fitCurve, type Road } from "./trackfiles";

/** square metres: a road mesh smaller than this is not offered (geometry.py's MIN_AREA) */
export const MIN_AREA = 1;
/** every so many of a road's rows a point of its description (describe_roads.py's KEEP) */
const KEEP = 2;
/** metres: points this near are one (road_grid.py's WELD) */
const GRID_WELD = 0.002;
/** How far along an outline each side of a point its turn is taken over, metres (a fiftieth of the outline at most) */
const CORNER_SPAN = 1;
/** A strip's four corners judged by the road read from them at FIT_ROWS rows, on a raster of FIT_CELLS a side, among the FIT_CORNERS sharpest of its FIT_LOOPS
 * longest loops (a quarter as long as the longest at least): every four on a raster FIT_CELLS a side, the best FIT_KEEP and road_grid's again on cells the mesh
 * covers FIT_FINE of; another four than road_grid's taken when it lies FIT_BETTER more nearly on the mesh */
const FIT_ROWS = 48;
const FIT_CELLS = 96;
const FIT_BETTER = 0.05;
const FIT_CORNERS = 20;
const FIT_LOOPS = 3;
const FIT_KEEP = 10;
const FIT_FINE = 4000;
/** A road brought in, its widths at most this of its middle one across */
const WIDTH_CAP = 0.65;

export class BringError extends Error {}

type V2 = [number, number];

/** A mesh's points placed by its matrix (x, y, z each). */
function placed(n: Kn5Mesh, m: Mat4): Float64Array {
	const nv = n.verts.length / VERT;
	const W = new Float64Array(nv * 3);
	for (let i = 0; i < nv; i++) {
		const x = n.verts[i * VERT] as number;
		const y = n.verts[i * VERT + 1] as number;
		const z = n.verts[i * VERT + 2] as number;
		for (let c = 0; c < 3; c++) W[i * 3 + c] = x * (m[c] as number) + y * (m[4 + c] as number) + z * (m[8 + c] as number) + (m[12 + c] as number);
	}
	return W;
}

const median = (a: number[]) => {
	const s = [...a].sort((x, y) => x - y);
	const h = s.length >> 1;
	return s.length % 2 ? (s[h] as number) : ((s[h - 1] as number) + (s[h] as number)) / 2;
};

/** The two points numpy's gradient takes at point i of n: those either side of it, or at an end, it and its one neighbour. */
function neighbours(i: number, n: number): [number, number] {
	if (i === 0) return [0, 1];
	if (i === n - 1) return [n - 2, n - 1];
	return [i - 1, i + 1];
}

/** numpy's gradient along a list of points (unit spacing: central differences, one-sided at the ends). */
function gradient(P: V2[]): V2[] {
	const n = P.length;
	return P.map((_, i) => {
		if (n < 2) return [0, 0];
		const [ia, ib] = neighbours(i, n);
		const a = P[ia] as V2;
		const b = P[ib] as V2;
		const d = i === 0 || i === n - 1 ? 1 : 2;
		return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
	});
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** Its middle, its edges either side: which of a and b is on its left (by the most of its rows), and its widths. */
function sides(A: V2[], B: V2[]) {
	const mid = A.map((a, i) => [(a[0] + (B[i] as V2)[0]) / 2, (a[1] + (B[i] as V2)[1]) / 2] as V2);
	const t = gradient(mid);
	let s = 0;
	mid.forEach((p, i) => {
		const l = [-(t[i] as V2)[1], (t[i] as V2)[0]];
		s += ((A[i] as V2)[0] - p[0]) * (l[0] as number) + ((A[i] as V2)[1] - p[1]) * (l[1] as number);
	});
	const aLeft = s / Math.max(mid.length, 1) > 0;
	const L = aLeft ? A : B;
	const R = aLeft ? B : A;
	const wl = mid.map((p, i) => Math.hypot((L[i] as V2)[0] - p[0], (L[i] as V2)[1] - p[1]));
	const wr = mid.map((p, i) => Math.hypot((R[i] as V2)[0] - p[0], (R[i] as V2)[1] - p[1]));
	return { mid, L, R, wl, wr };
}

/** A road mesh mapped across u -1 to 0, along v, described by its rows (describe_roads.describe). */
export function describeRows(n: Kn5Mesh, m: Mat4, material: string): Road {
	const W = placed(n, m);
	const nv = n.verts.length / VERT;
	const rows = new Map<number, { umin: number; umax: number; a: V2; b: V2 }>();
	for (let i = 0; i < nv; i++) {
		const u = Math.round((n.verts[i * VERT + 6] as number) * 1e4) / 1e4;
		const v = Math.round((n.verts[i * VERT + 7] as number) * 1e4) / 1e4;
		const p: V2 = [W[i * 3] as number, W[i * 3 + 2] as number];
		const r = rows.get(v);
		if (!r) rows.set(v, { umin: u, umax: u, a: p, b: p });
		else {
			if (u < r.umin) {
				r.umin = u;
				r.a = p;
			}
			if (u > r.umax) {
				r.umax = u;
				r.b = p;
			}
		}
	}
	const vs = [...rows.keys()].sort((x, y) => x - y);
	const { mid, wl, wr } = sides(
		vs.map((v) => (rows.get(v) as { a: V2 }).a),
		vs.map((v) => (rows.get(v) as { b: V2 }).b),
	);
	const keep = [...new Set([...Array.from({ length: Math.ceil(mid.length / KEEP) }, (_, i) => i * KEEP), mid.length - 1])]
		.filter((i) => i < mid.length)
		.sort((x, y) => x - y);
	let s = 0;
	for (let i = 1; i < mid.length; i++) s += Math.hypot((mid[i] as V2)[0] - (mid[i - 1] as V2)[0], (mid[i] as V2)[1] - (mid[i - 1] as V2)[1]);
	return {
		name: n.name,
		material,
		map: "along",
		u_per_m: 1 / median(wl.map((w, i) => w + (wr[i] as number))),
		v_per_m: ((vs.at(-1) as number) - (vs[0] as number)) / Math.max(s, 1e-9),
		points: keep.map((i) => [r3((mid[i] as V2)[0]), r3((mid[i] as V2)[1]), r3(wl[i] as number), r3(wr[i] as number)]),
	} as Road;
}

// ---- road_grid.py: a mesh's outline, its four corners, its two sides paired into rows -------------------------------

type P3 = [number, number, number];
/** The next point on from b of an outline's edges left, come from p (undefined where the walk begins at b). */
type NextEdge = (left: Set<string>, p: number | undefined, b: number) => number | undefined;

/** A mesh's points welded: by their keys sorted, each the first point of its key, as numpy's unique (P), and each vertex's welded point (inv). */
function weld(W: Float64Array, nv: number): { P: P3[]; inv: Int32Array } {
	const keys: [number, number, number, number][] = [];
	for (let i = 0; i < nv; i++)
		keys.push([
			Math.round((W[i * 3] as number) / GRID_WELD),
			Math.round((W[i * 3 + 1] as number) / GRID_WELD),
			Math.round((W[i * 3 + 2] as number) / GRID_WELD),
			i,
		]);
	keys.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
	const inv = new Int32Array(nv);
	const P: P3[] = [];
	keys.forEach((k, j) => {
		const prev = keys[j - 1];
		if (prev?.[0] !== k[0] || prev[1] !== k[1] || prev[2] !== k[2]) P.push([W[k[3] * 3] as number, W[k[3] * 3 + 1] as number, W[k[3] * 3 + 2] as number]);
		inv[k[3]] = P.length - 1;
	});
	return { P, inv };
}

/** Mesh n's faces on its welded points, its top's only (facing more up or down than sideways: not the skirts down its sides), none of two points the same. */
function topFaces(n: Kn5Mesh, P: P3[], inv: Int32Array): P3[] {
	const F: P3[] = [];
	for (let f = 0; f < n.faces.length; f += 3) {
		const t = [inv[n.faces[f] as number], inv[n.faces[f + 1] as number], inv[n.faces[f + 2] as number]] as P3;
		if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
		const [a, b, c] = t.map((i) => P[i] as number[]) as unknown as [number[], number[], number[]];
		const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
		const v = [0, 1, 2].map((k) => (c[k] as number) - (a[k] as number));
		const nn = [
			(u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
			(u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
			(u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
		];
		if (Math.abs(nn[1] as number) > 0.5 * Math.max(Math.hypot(...(nn as P3)), 1e-12)) F.push(t);
	}
	return F;
}

/** An edge's key either way it runs: its lower point first. */
const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/** Faces' outline: their edges no two of them share, the way each face runs (`a,b`), and from each point the points its edges go on to. */
function outlineEdges(F: P3[]): { out: Map<number, number[]>; edges: string[] } {
	const cnt = new Map<string, number>();
	for (const f of F)
		for (let i = 0; i < 3; i++) {
			const a = f[i] as number;
			const b = f[(i + 1) % 3] as number;
			const k = edgeKey(a, b);
			cnt.set(k, (cnt.get(k) ?? 0) + 1);
		}
	const out = new Map<number, number[]>();
	const edges: string[] = [];
	for (const f of F)
		for (let i = 0; i < 3; i++) {
			const a = f[i] as number;
			const b = f[(i + 1) % 3] as number;
			if (cnt.get(edgeKey(a, b)) !== 1) continue;
			const l = out.get(a);
			if (l) l.push(b);
			else out.set(a, [b]);
			edges.push(`${a},${b}`);
		}
	return { out, edges };
}

/** The point an outline goes on to from b of its edges left, come from p: where more go on, the one turning the least first. */
function nextEdge(out: Map<number, number[]>, xzOf: (i: number) => V2, left: Set<string>, p: number | undefined, b: number): number | undefined {
	const nx = (out.get(b) ?? []).filter((c) => left.has(`${b},${c}`));
	if (nx.length > 1 && p !== undefined) {
		const p0 = xzOf(p);
		const pb = xzOf(b);
		const d0 = [pb[0] - p0[0], pb[1] - p0[1]];
		const ang = (c: number) => {
			const pc = xzOf(c);
			const d1 = [pc[0] - pb[0], pc[1] - pb[1]];
			return Math.atan2(
				(d0[0] as number) * (d1[1] as number) - (d0[1] as number) * (d1[0] as number),
				(d0[0] as number) * (d1[0] as number) + (d0[1] as number) * (d1[1] as number),
			);
		};
		nx.sort((x, y) => ang(x) - ang(y));
	}
	return nx[0];
}

/** The first of the edges left, its two points. */
const firstOf = (left: Set<string>) => (left.values().next().value as string).split(",").map(Number) as [number, number];

/** road_grid's walks round an outline's edges: each on till back where it began, or no edge goes on. */
function walkLoops(edges: string[], next: NextEdge): number[][] {
	const walked: number[][] = [];
	const left = new Set(edges);
	while (left.size) {
		const [a, b0] = firstOf(left);
		let b = b0;
		const loop = [a];
		left.delete(`${a},${b}`);
		while (b !== loop[0]) {
			loop.push(b);
			const c = next(left, loop.at(-2), b);
			if (c === undefined) break;
			left.delete(`${b},${c}`);
			b = c;
		}
		walked.push(loop);
	}
	return walked;
}

/** A walk back at a point it passed (seen, its place in the walk): the part since then a loop of its own, the walk cut back to that point. */
function closeAt(loop: number[], at: Map<number, number>, seen: number, loops: number[][]): void {
	loops.push(loop.slice(seen));
	for (const p of loop.slice(seen + 1)) at.delete(p);
	loop.length = seen + 1;
}

/** A walk from edge a to b0 round an outline's edges left, each loop it closes added to loops: on till it is back where it began with no edge on from there, or
 * none goes on (as far as it went then a loop too). */
function walkClosing(a: number, b0: number, left: Set<string>, out: Map<number, number[]>, next: NextEdge, loops: number[][]): void {
	let b = b0;
	const loop = [a];
	const at = new Map<number, number>([[a, 0]]);
	left.delete(`${a},${b}`);
	for (;;) {
		const seen = at.get(b);
		if (seen !== undefined) {
			closeAt(loop, at, seen, loops);
			if (seen === 0 && !(out.get(b) ?? []).some((c) => left.has(`${b},${c}`))) break;
		} else {
			at.set(b, loop.length);
			loop.push(b);
		}
		const c = next(left, loop.at(-2), b);
		if (c === undefined) {
			if (loop.length > 1) loops.push(loop.slice());
			break;
		}
		left.delete(`${b},${c}`);
		b = c;
	}
}

/** Every loop an outline's edges close: back at a point a walk passed, the part since then a loop of its own. */
function everyLoop(edges: string[], out: Map<number, number[]>, next: NextEdge): number[][] {
	const loops: number[][] = [];
	const left = new Set(edges);
	while (left.size) {
		const [a, b0] = firstOf(left);
		walkClosing(a, b0, left, out, next, loops);
	}
	return loops;
}

/** Mesh n's top's outline as rings of welded points: its edges no two faces share, followed the way each face runs, turning the least where more go on. As
 * road_grid.outline follows them (`ring`, the longest loop it closes: on to where it began, or as far as it goes; where two loops touch at a point, on round
 * the other or the walk's own end at it, a piece of the edge), and every loop each of them closes (`loops`, the longest first: two touching at a point each its
 * own); and its top's faces (`top`). */
export function gridLoops(n: Kn5Mesh, m: Mat4): { ring: V2[]; loops: V2[][]; top: V2[][] } | string {
	const W = placed(n, m);
	const nv = n.verts.length / VERT;
	const { P, inv } = weld(W, nv);
	const F = topFaces(n, P, inv);
	const { out, edges } = outlineEdges(F);
	if (!out.size) return "no outline (a ring of road)";
	const xzOf = (i: number) => [(P[i] as number[])[0] as number, (P[i] as number[])[2] as number] as V2;
	const next: NextEdge = (left, p, b) => nextEdge(out, xzOf, left, p, b);
	const walked = walkLoops(edges, next);
	const loops = everyLoop(edges, out, next);
	const len = (l: number[]) =>
		l.reduce((s, i, j) => {
			const p = xzOf(i);
			const q = xzOf(l[(j + 1) % l.length] as number);
			return s + Math.hypot(q[0] - p[0], q[1] - p[1]);
		}, 0);
	// (the longest first, the first of those as long)
	const longest = (ls: number[][]) =>
		ls
			.map((l, i) => [len(l), i, l] as const)
			.sort((x, y) => y[0] - x[0] || x[1] - y[1])
			.map(([, , l]) => l.map(xzOf));
	return { ring: longest(walked)[0] as V2[], loops: longest(loops), top: F.map((f) => f.map(xzOf)) };
}

/** A line of points resampled to n, evenly along it (numpy's interp of each coordinate over its length). */
function resample(C: V2[], n: number): V2[] {
	const d = [0];
	for (let i = 1; i < C.length; i++) d.push((d.at(-1) as number) + Math.hypot((C[i] as V2)[0] - (C[i - 1] as V2)[0], (C[i] as V2)[1] - (C[i - 1] as V2)[1]));
	let i = 1;
	return Array.from({ length: n }, (_, j) => {
		const t = n === 1 ? 0 : (j * (d.at(-1) as number)) / (n - 1);
		while (i < d.length - 1 && (d[i] as number) < t) i++;
		const f = (d[i] as number) > (d[i - 1] as number) ? (t - (d[i - 1] as number)) / ((d[i] as number) - (d[i - 1] as number)) : 0;
		const p = C[i - 1] as V2;
		const q = (C[i] ?? p) as V2;
		const g = Math.min(Math.max(f, 0), 1);
		return [p[0] + (q[0] - p[0]) * g, p[1] + (q[1] - p[1]) * g] as V2;
	});
}

/** The ring round a road read from two sides, as it is brought in: its middle, out either side by its widths, each capped (bringIn's cap: a strip read from an
 * outline flares where it meets another road). */
function roadRing(A: V2[], B: V2[]): V2[] {
	const { mid, wl, wr } = sides(A, B);
	const cap = median(wl.map((w, i) => w + (wr[i] as number))) * WIDTH_CAP;
	const t = gradient(mid);
	const left: V2[] = [];
	const right: V2[] = [];
	mid.forEach((p, i) => {
		const l = Math.max(Math.hypot((t[i] as V2)[0], (t[i] as V2)[1]), 1e-9);
		const nx = -(t[i] as V2)[1] / l;
		const nz = (t[i] as V2)[0] / l;
		const a = Math.min(wl[i] as number, cap);
		const b = Math.min(wr[i] as number, cap);
		left.push([p[0] + nx * a, p[1] + nz * a]);
		right.push([p[0] - nx * b, p[1] - nz * b]);
	});
	return [...left, ...right.reverse()];
}

/** Rings' least and greatest z. */
function zRange(rs: V2[][]): [number, number] {
	let lo = Infinity;
	let hi = -Infinity;
	for (const r of rs)
		for (const p of r) {
			lo = Math.min(lo, p[1]);
			hi = Math.max(hi, p[1]);
		}
	return [lo, hi];
}

/** Where rings' edges cross the line at z, its x each, least first. */
function crossings(rs: V2[][], z: number): number[] {
	const xs: number[] = [];
	for (const r of rs)
		for (let i = 0; i < r.length; i++) {
			const a = r[i] as V2;
			const b = r[(i + 1) % r.length] as V2;
			if (a[1] > z !== b[1] > z) xs.push(a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
		}
	xs.sort((p, q) => p - q);
	return xs;
}

/** How nearly a ring lies on a shape, on a raster: what both cover over what either does (the ring filled even-odd, wherever it goes; the shape the cells
 * inside any of its pieces, on cells of `cell` metres, `across` a side over it if not given). */
function rasterFit(pieces: V2[][], cell?: number, across = FIT_CELLS): (other: V2[]) => number {
	let x0 = Infinity;
	let z0 = Infinity;
	let x1 = -Infinity;
	let z1 = -Infinity;
	for (const [x, z] of pieces.flat()) {
		x0 = Math.min(x0, x);
		z0 = Math.min(z0, z);
		x1 = Math.max(x1, x);
		z1 = Math.max(z1, z);
	}
	const c = cell ?? Math.max(x1 - x0, z1 - z0, 1e-6) / across;
	const W = Math.max(1, Math.ceil((x1 - x0) / c));
	const H = Math.max(1, Math.ceil((z1 - z0) / c));
	// (each row's spans of cells inside, as cell indices: rows from lo to hi)
	const spans = (rs: V2[][], visit: (row: number, c0: number, c1: number) => void) => {
		const [lo, hi] = zRange(rs);
		for (let row = Math.floor((lo - z0) / c); row <= Math.floor((hi - z0) / c); row++) {
			const xs = crossings(rs, z0 + (row + 0.5) * c);
			for (let j = 0; j + 1 < xs.length; j += 2) {
				const c0 = Math.ceil(((xs[j] as number) - x0) / c - 0.5);
				const c1 = Math.floor(((xs[j + 1] as number) - x0) / c - 0.5);
				if (c1 >= c0) visit(row, c0, c1);
			}
		}
	};
	const own = new Uint8Array(W * H);
	let ownN = 0;
	for (const r of pieces)
		spans([r], (row, c0, c1) => {
			if (row < 0 || row >= H) return;
			for (let k = Math.max(c0, 0); k <= Math.min(c1, W - 1); k++)
				if (!own[row * W + k]) {
					own[row * W + k] = 1;
					ownN++;
				}
		});
	return (other) => {
		let all = 0;
		let both = 0;
		spans([other], (row, c0, c1) => {
			all += c1 - c0 + 1;
			if (row < 0 || row >= H) return;
			for (let k = Math.max(c0, 0); k <= Math.min(c1, W - 1); k++) both += own[row * W + k] as number;
		});
		const either = ownN + all - both;
		return either ? both / either : 0;
	};
}

type Quad = { X: V2[]; cs: number[]; o: number };

/** A ring's corners: its points' turns, the sharpest first. road_grid's from point to point; or each from where the ring was CORNER_SPAN before it to where it
 * is that far after, the most of each stretch only (a corner's turn as it is between its two sides; a mesh's own jags and slits, out and back in a few
 * centimetres, none). */
function cornersOf(X: V2[], seg: number[], over: boolean): { at: number[]; turn: number[] } {
	const k = X.length;
	const span0 = over ? Math.min(CORNER_SPAN, seg.reduce((a, b) => a + b, 0) / 50) : 0;
	const turn = X.map((p, i) => {
		let j = (i - 1 + k) % k;
		for (let s = seg[j] as number; s < span0 && (j - 1 + k) % k !== i; ) {
			j = (j - 1 + k) % k;
			s += seg[j] as number;
		}
		let l = (i + 1) % k;
		for (let s = seg[i] as number; s < span0 && (l + 1) % k !== i; ) {
			s += seg[l] as number;
			l = (l + 1) % k;
		}
		const q = X[j] as V2;
		const r = X[l] as V2;
		const a = [p[0] - q[0], p[1] - q[1]] as V2;
		const b = [r[0] - p[0], r[1] - p[1]] as V2;
		const la = Math.hypot(...a);
		const lb = Math.hypot(...b);
		return la > 1e-9 && lb > 1e-9 ? (Math.acos(Math.min(Math.max((a[0] * b[0] + a[1] * b[1]) / la / lb, -1), 1)) * 180) / Math.PI : 0;
	});
	const peak = (i: number) => {
		const t = turn[i] as number;
		for (const dir of [-1, 1]) {
			let j = i;
			for (let s = 0; s < span0; ) {
				const nj = (j + dir + k) % k;
				if (nj === i) break;
				s += seg[dir < 0 ? nj : j] as number;
				j = nj;
				const u = turn[j] as number;
				if (u > t || (u === t && j < i)) return false;
			}
		}
		return true;
	};
	const at = turn
		.map((_, i) => i)
		.filter((i) => !over || peak(i))
		.sort((a, b) => (turn[b] as number) - (turn[a] as number) || a - b);
	return { at, turn };
}

/** Every four of a ring's corners, each way round its two sides, by how short its ends are against its sides (road_grid's score: the best first). */
function quadsOf(X: V2[], seg: number[], cand: number[]): [number, Quad][] {
	const cum = [0];
	for (const s of seg) cum.push((cum.at(-1) as number) + s);
	const span = (i: number, j: number) => (j >= i ? (cum[j] as number) - (cum[i] as number) : (cum.at(-1) as number) - (cum[i] as number) + (cum[j] as number));
	const c = [...cand].sort((a, b) => a - b);
	const out: [number, Quad][] = [];
	for (let a = 0; a < c.length; a++)
		for (let b = a + 1; b < c.length; b++)
			for (let d = b + 1; d < c.length; d++) for (let e = d + 1; e < c.length; e++) out.push(...quadScores(X, [c[a], c[b], c[d], c[e]] as number[], span));
	return out.sort((x, y) => x[0] - y[0]);
}

/** Four of a ring's corners, each way round its two sides, scored by road_grid's: its ends' length over its sides', 0.05 more where its sides have not as
 * many points (span: how far round the ring from one point to another). */
function quadScores(X: V2[], cs: number[], span: (i: number, j: number) => number): [number, Quad][] {
	const k = X.length;
	const Ls = [0, 1, 2, 3].map((i) => span(cs[i] as number, cs[(i + 1) % 4] as number));
	const Ns = [0, 1, 2, 3].map((i) => ((((cs[(i + 1) % 4] as number) - (cs[i] as number)) % k) + k) % k);
	return [0, 1].map((o) => {
		const ends = (Ls[o + 1] as number) + (Ls[(o + 3) % 4] as number);
		const sides = (Ls[o] as number) + (Ls[o + 2] as number);
		return [ends / Math.max(sides, 1e-9) + (Ns[o] === Ns[o + 2] ? 0 : 0.05), { X, cs, o }];
	});
}

/** A ring's two sides between four of its corners, paired into rows: resampled to n points, or, unless they have as many, to as many as the longer has. */
function rowsOf({ X, cs, o }: Quad, n?: number): { A: V2[]; B: V2[] } {
	const k = X.length;
	const chain = (i: number) => {
		const a = cs[i] as number;
		const b0 = cs[(i + 1) % 4] as number;
		const b = b0 > a ? b0 : b0 + k;
		const out: V2[] = [];
		for (let c = a; c <= b; c++) out.push(X[c % k] as V2);
		return out;
	};
	const A = chain(o);
	const B = chain(o + 2).reverse();
	if (n === undefined && A.length === B.length) return { A, B };
	const N = n ?? Math.max(A.length, B.length);
	return { A: resample(A, N), B: resample(B, N) };
}

/** A ring's segments' lengths, each from a point to the next. */
const segOf = (X: V2[]) => X.map((p, i) => Math.hypot((X[(i + 1) % X.length] as V2)[0] - p[0], (X[(i + 1) % X.length] as V2)[1] - p[1]));

/** road_grid's own four corners of a ring, by their turns from point to point: the four sharpest if all turn 60° or more, else the best of the 12 sharpest of
 * 30° or more; none where it has not four. */
function theirQuad(X0: V2[], seg0: number[]): Quad | null {
	const { at, turn } = cornersOf(X0, seg0, false);
	let cand = at.slice(0, 12).filter((i) => (turn[i] as number) >= 30);
	const sharp4 = at.slice(0, 4);
	if (cand.length >= 4 && Math.min(...sharp4.map((i) => turn[i] as number)) >= 60) cand = sharp4;
	if (cand.length >= 4) return (quadsOf(X0, seg0, cand)[0] as [number, Quad])[1];
	return null;
}

/** Every four of the corners of a ring and of the mesh's FIT_LOOPS longest loops (a quarter as long as the longest at least), among the FIT_CORNERS sharpest by
 * their turns over CORNER_SPAN and the 12 sharpest from point to point, of 30° or more: each with its score. */
function rankedQuads(X0: V2[], seg0: number[], loops: V2[][], score: (q: Quad) => number): [number, Quad][] {
	const ranked: [number, Quad][] = [];
	const len0 = segOf(loops[0] as V2[]).reduce((a, b) => a + b, 0);
	for (const X of [X0, ...loops.slice(0, FIT_LOOPS)]) {
		const seg = X === X0 ? seg0 : segOf(X);
		if (X !== X0 && seg.reduce((a, b) => a + b, 0) < 0.25 * len0) break;
		const near = cornersOf(X, seg, true);
		const each = cornersOf(X, seg, false);
		const cand = new Set([
			...near.at.slice(0, FIT_CORNERS).filter((i) => (near.turn[i] as number) >= 30),
			...each.at.slice(0, 12).filter((i) => (each.turn[i] as number) >= 30),
		]);
		if (cand.size < 4) continue;
		for (const [, q] of quadsOf(X, seg, [...cand])) ranked.push([score(q), q]);
	}
	return ranked;
}

/** Mesh n as a strip (road_grid.grid, sharpest): its outline split at four corners into its two long sides and its two ends, its sides paired into rows.
 * road_grid's four (its outline's, by their turns from point to point: the four sharpest if all turn 60° or more, else the best of the 12 sharpest of 30° or
 * more); but where another four (of it or of the mesh's FIT_LOOPS longest loops, among the FIT_CORNERS sharpest either way), the road read from them, lies much
 * more nearly on the mesh (what both cover over what either does, on a raster: FIT_BETTER more), those. road_grid's strip of a car park takes a notch in its
 * edge for an end and fans its rows out from it; of a mesh of pieces, its longest loop's only. */
function gridRows(n: Kn5Mesh, m: Mat4): { A: V2[]; B: V2[] } | string {
	const g = gridLoops(n, m);
	if (typeof g === "string") return g;
	const { ring, loops } = g;
	const X0 = ring;
	const seg0 = segOf(X0);
	const first = theirQuad(X0, seg0);
	// (judged on the mesh's top's faces, all it covers: a folded mesh's loops, filled, leave holes where it folds. Every four on a coarse raster; the best
	// FIT_KEEP, and road_grid's, again on cells of the mesh's own size)
	const coarse = rasterFit(g.top);
	const area = g.top.reduce((s, [a, b, c]) => {
		const [p, q, r] = [a, b, c] as [V2, V2, V2];
		return s + Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
	}, 0);
	const fine = rasterFit(g.top, Math.sqrt(Math.max(area, 1e-6) / FIT_FINE));
	const ringOf = (q: Quad) => {
		const { A, B } = rowsOf(q, FIT_ROWS);
		return roadRing(A, B);
	};
	const theirs = first ? fine(ringOf(first)) : -Infinity;
	const ranked = rankedQuads(X0, seg0, loops, (q) => coarse(ringOf(q)));
	let best: [number, Quad] | null = null;
	for (const [, q] of ranked.toSorted((x, y) => y[0] - x[0]).slice(0, FIT_KEEP)) {
		const f = fine(ringOf(q));
		if (!best || f > best[0]) best = [f, q];
	}
	const chosen = best && best[0] > theirs + FIT_BETTER ? best[1] : first;
	if (!chosen) return "not four corners";
	return rowsOf(chosen);
}

/** A road mesh described from its outline as a strip (describe_roads.describe_strip): mapped flat from above. */
export function describeStrip(n: Kn5Mesh, m: Mat4, material: string): Road {
	const g = gridRows(n, m);
	if (typeof g === "string") throw new BringError(`${n.name}: ${g}`);
	const { mid, L, R, wl, wr } = sides(g.A, g.B);
	const road = {
		name: n.name,
		material,
		map: "flat",
		points: mid.map((p, i) => [r3(p[0]), r3(p[1]), r3(wl[i] as number), r3(wr[i] as number)]),
	} as Road & { start_left?: number[]; end_left?: number[] };
	for (const [key, i] of [
		["start_left", 0],
		["end_left", mid.length - 1],
	] as const) {
		const d = [(L[i] as V2)[0] - (R[i] as V2)[0], (L[i] as V2)[1] - (R[i] as V2)[1]];
		const l = Math.max(Math.hypot(d[0] as number, d[1] as number), 1e-9);
		road[key] = [r5((d[0] as number) / l), r5((d[1] as number) / l)];
	}
	return road;
}

// ---- a ring round an infield ----------------------------------------------------------------------------------

/** A closed ring's point at a distance along it from its first point. */
function along(ring: V2[], d: number): V2 {
	let left = d;
	for (let i = 0; i < ring.length; i++) {
		const p = ring[i] as V2;
		const q = ring[(i + 1) % ring.length] as V2;
		const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
		if (left <= l || i === ring.length - 1) {
			const t = l > 0 ? Math.min(left / l, 1) : 0;
			return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
		}
		left -= l;
	}
	return ring[0] as V2;
}

/** A closed ring's nearest point to a point, and how far it is. */
function nearest(ring: V2[], x: number, z: number): { p: V2; d: number } {
	let best = { p: ring[0] as V2, d: Infinity };
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i] as V2;
		const b = ring[(i + 1) % ring.length] as V2;
		const dx = b[0] - a[0];
		const dz = b[1] - a[1];
		const l2 = dx * dx + dz * dz;
		const t = l2 > 0 ? Math.min(Math.max(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0), 1) : 0;
		const p: V2 = [a[0] + t * dx, a[1] + t * dz];
		const d = Math.hypot(x - p[0], z - p[1]);
		if (d < best.d) best = { p, d };
	}
	return best;
}

const ringLength = (r: V2[]) => r.reduce((s, p, i) => s + Math.hypot((r[(i + 1) % r.length] as V2)[0] - p[0], (r[(i + 1) % r.length] as V2)[1] - p[1]), 0);

/** A road mesh that is a ring round an infield (read_road.describe_ring): two roads, its halves, joined end to end (roads.json has no closed road): its middle
 * halfway between its outer and inner edges every step metres, its widths to each, mapped flat; from its point furthest north, the way its outline goes. */
export function describeRing(n: Kn5Mesh, m: Mat4, material: string, step = 0.5): Road[] {
	const tris = triangles(n, m);
	const T = new Float64Array((tris.length / 9) * 6);
	for (let t = 0; t < tris.length / 9; t++)
		for (let c = 0; c < 3; c++) {
			T[t * 6 + c * 2] = unit(tris[t * 9 + c * 3] as number);
			T[t * 6 + c * 2 + 1] = unit(tris[t * 9 + c * 3 + 2] as number);
		}
	const o = outlineOf(T, T.length / 6);
	const toM = (r: [number, number][]) => r.map(([x, z]) => [metres(x), metres(z)] as V2);
	const area = (r: V2[]) => Math.abs(r.reduce((s, p, i) => s + p[0] * (r[(i + 1) % r.length] as V2)[1] - (r[(i + 1) % r.length] as V2)[0] * p[1], 0)) / 2;
	const parts = o.polys.filter((p) => area(toM(p.outer)) - p.holes.reduce((s, h) => s + area(toM(h)), 0) > 1);
	if (parts.length !== 1 || (parts[0] as { holes: unknown[] }).holes.length !== 1)
		throw new BringError(`${n.name}: not a ring (${parts.length} pieces, ${parts.map((p) => p.holes.length)} holes)`);
	const outer = toM((parts[0] as { outer: [number, number][] }).outer);
	const inner = toM((parts[0] as { holes: [number, number][][] }).holes[0] as [number, number][]);
	const L = ringLength(outer);
	const k = Math.max(16, Math.trunc(L / step));
	const Q = Array.from({ length: k }, (_, i) => along(outer, (i * L) / k));
	const J = Q.map((q) => nearest(inner, q[0], q[1]).p);
	const raw = Q.map((q, i) => [(q[0] + (J[i] as V2)[0]) / 2, (q[1] + (J[i] as V2)[1]) / 2] as V2);
	// (smoothed a little along, the ring closed: the nearest inner point jumps where the inner edge bends)
	const mid = raw.map((_, i) => {
		let x = 0;
		let z = 0;
		for (let j = -2; j <= 2; j++) {
			const p = raw[(i + j + k) % k] as V2;
			x += p[0];
			z += p[1];
		}
		return [x / 5, z / 5] as V2;
	});
	const left = mid.map((_, i) => {
		const a = mid[(i - 1 + k) % k] as V2;
		const b = mid[(i + 1) % k] as V2;
		const t = [b[0] - a[0], b[1] - a[1]];
		const l = Math.max(Math.hypot(t[0] as number, t[1] as number), 1e-9);
		return [-(t[1] as number) / l, (t[0] as number) / l] as V2;
	});
	const dOut = mid.map((p) => nearest(outer, p[0], p[1]).d);
	const dIn = mid.map((p) => nearest(inner, p[0], p[1]).d);
	// (the infield on its left, or not: by the ring's own way round)
	const pole = outer[0] as V2;
	let s = 0;
	mid.forEach((p, i) => {
		s += (pole[0] - p[0]) * (left[i] as V2)[0] + (pole[1] - p[1]) * (left[i] as V2)[1];
	});
	const insideLeft = s / k > 0;
	const [wl, wr] = insideLeft ? [dIn, dOut] : [dOut, dIn];
	let s0 = 0;
	mid.forEach((p, i) => {
		if (p[1] > (mid[s0] as V2)[1]) s0 = i;
	});
	const order = [...Array.from({ length: k - s0 }, (_, i) => s0 + i), ...Array.from({ length: s0 }, (_, i) => i)];
	const half = Math.trunc(k / 2);
	return (
		[
			[n.name, order.slice(0, half + 1)],
			[`${n.name}B`, [...order.slice(half), order[0] as number]],
		] as [string, number[]][]
	).map(
		([name, idx]) =>
			({
				name,
				material,
				map: "flat",
				points: idx.map((i) => [r3((mid[i] as V2)[0]), r3((mid[i] as V2)[1]), r3(wl[i] as number), r3(wr[i] as number)]),
			}) as Road,
	);
}

/** A road mesh described however it lets itself be (read_road.describe_any): by its rows, as a strip, or a ring. */
export function describeAny(n: Kn5Mesh, m: Mat4, material: string): { roads: Road[]; how: "rows" | "strip" | "ring" } {
	const nv = n.verts.length / VERT;
	let umin = Infinity;
	let umax = -Infinity;
	for (let i = 0; i < nv; i++) {
		const u = n.verts[i * VERT + 6] as number;
		umin = Math.min(umin, u);
		umax = Math.max(umax, u);
	}
	if (nv && Math.abs(umin + 1) < 1e-3 && Math.abs(umax) < 1e-3) return { roads: [describeRows(n, m, material)], how: "rows" };
	try {
		return { roads: [describeStrip(n, m, material)], how: "strip" };
	} catch (e) {
		if (!(e instanceof BringError)) throw e;
	}
	return { roads: describeRing(n, m, material), how: "ring" };
}

// ---- the editor's calls --------------------------------------------------------------------------------------

export interface BringSettings {
	project: string;
	models: string;
	roads: string;
	/** where the roads not described yet are read from (the models before their floors were merged), each where it has one */
	meshesFrom: string;
	/** the track file's road_models, else every model */
	roadModels?: string[];
	/** the roads described, wherever the track keeps them (the track file: trackdoc.ts), else roads' file's */
	described?: () => Promise<{ name: string; mesh?: string }[]>;
}

/** A model's meshes as the track's tools have it, its textures not read. */
async function shapesOf(files: HostFiles, path: string, library: MaterialLibrary | undefined): Promise<Kn5> {
	const { doc, bin } = readGlb(await files.read(path));
	return fromGltf(doc, bin, async () => new Uint8Array(0), undefined, library);
}

async function meshModel(files: HostFiles, s: BringSettings, name: string) {
	const p = `${s.meshesFrom}/${name}`;
	return (await files.exists(p)) ? p : `${s.models}/${name}`;
}

/** The roads described already: their names, their meshes', a ring's (its second half's name less its B). */
async function described(files: HostFiles, s: BringSettings): Promise<Set<string>> {
	const have = new Set<string>();
	let roads: { name: string; mesh?: string }[];
	if (s.described) roads = await s.described();
	else if (!(await files.exists(s.roads))) return have;
	else roads = (JSON.parse(new TextDecoder().decode(await files.read(s.roads))) as { roads: typeof roads }).roads;
	for (const r of roads) {
		have.add(r.name);
		if (r.mesh) have.add(r.mesh);
		if (r.name.endsWith("B")) have.add(r.name.slice(0, -1));
	}
	return have;
}

/** Whether a mesh is a road to offer: a 1ROAD_ one (not a kerb's or a patch's) with faces, not described already. */
const isRoadOffered = (nm: string, faces: number, have: Set<string>) =>
	nm.startsWith("1ROAD_") && !nm.startsWith("1ROAD_KERB") && !nm.startsWith("1ROAD_PATCH") && !have.has(nm) && faces > 0;

/** Triangles' area seen from above, and their box (x and z, least then greatest). */
function areaAndBox(T: Float64Array): { a: number; lo: number[]; hi: number[] } {
	let a = 0;
	const lo = [Infinity, Infinity];
	const hi = [-Infinity, -Infinity];
	for (let t = 0; t < T.length; t += 9) {
		const x = [T[t] as number, T[t + 3] as number, T[t + 6] as number];
		const z = [T[t + 2] as number, T[t + 5] as number, T[t + 8] as number];
		a +=
			Math.abs(
				((x[1] as number) - (x[0] as number)) * ((z[2] as number) - (z[0] as number)) -
					((x[2] as number) - (x[0] as number)) * ((z[1] as number) - (z[0] as number)),
			) / 2;
		lo[0] = Math.min(lo[0] as number, ...x);
		lo[1] = Math.min(lo[1] as number, ...z);
		hi[0] = Math.max(hi[0] as number, ...x);
		hi[1] = Math.max(hi[1] as number, ...z);
	}
	return { a, lo, hi };
}

/** The roads in the track's models not described yet, the biggest first (geometry.py's road_meshes). */
export async function roadMeshesOffered(files: HostFiles, s: BringSettings, library?: MaterialLibrary) {
	const have = await described(files, s);
	if (!s.roadModels && !(await files.exists(s.models))) return [];
	const list = s.roadModels ?? (await files.list(s.models)).filter((f) => f.endsWith(".glb")).sort(byCodePoint);
	const out: { model: string; name: string; material: string; area: number; box: number[] }[] = [];
	for (const f of list) {
		const path = await meshModel(files, s, f);
		if (!(await files.exists(path)) || (f.split("/").pop() as string).startsWith("vp_")) continue;
		const k = await shapesOf(files, path, library);
		for (const [n, m] of meshes(k)) {
			const nm = n.name;
			if (!isRoadOffered(nm, n.faces.length, have)) continue;
			const { a, lo, hi } = areaAndBox(triangles(n, m));
			if (a < MIN_AREA) continue;
			out.push({
				model: f,
				name: nm,
				material: k.materials[n.material]?.name ?? "",
				area: Math.round(a * 10) / 10,
				box: [lo[0], lo[1], hi[0], hi[1]].map((v) => Math.round((v as number) * 100) / 100),
			});
		}
	}
	return out.sort((x, y) => y.area - x.area);
}

/** A road mesh brought in (geometry.py's bring_in): described, each road's widths capped (a strip read from an outline flares where it meets another road), its
 * curve fitted, no lines or rumbles; a ring's halves joined end to end. As the page has roads, not saved. */
export async function bringIn(
	files: HostFiles,
	s: BringSettings,
	model: string,
	name: string,
	library?: MaterialLibrary,
): Promise<{ roads: Road[]; how: string }> {
	// (a ring's outline is GEOS's)
	await geosReady();
	const k = await shapesOf(files, await meshModel(files, s, model), library);
	const found = meshes(k).find(([n]) => n.name === name && n.faces.length);
	if (!found) throw new BringError(`${model} has no mesh ${name}`);
	const [n, m] = found;
	const { roads, how } = describeAny(n, m, k.materials[n.material]?.name ?? "");
	const out = roads.map((r) => {
		const P = (r.points as number[][]).map((p) => [...p]);
		// (a strip read from an outline flares where it meets another road, its mouth: as wide as it is along)
		const med = median(P.map((p) => (p[2] as number) + (p[3] as number)));
		for (const p of P) for (const c of [2, 3]) p[c] = Math.min(p[c] as number, med * WIDTH_CAP);
		const road = { ...r, points: P.map((p) => p.map(r3)) } as Road;
		const { points: _pts, ...q } = road as Road & { points?: unknown };
		return { ...q, curve: fitCurve(road), lines: [], kerbs: [] } as unknown as Road & {
			curve: { p: number[]; joint?: unknown }[];
		};
	});
	if (how === "ring") {
		const [a, b] = out as [(typeof out)[number], (typeof out)[number]];
		(a.curve[0] as { joint?: unknown }).joint = { road: b.name, node: "end" };
		(a.curve.at(-1) as { joint?: unknown }).joint = { road: b.name, node: "start" };
		(b.curve[0] as { joint?: unknown }).joint = { road: a.name, node: "end" };
		(b.curve.at(-1) as { joint?: unknown }).joint = { road: a.name, node: "start" };
		(b.curve.at(-1) as { p: number[] }).p = [...(a.curve[0] as { p: number[] }).p];
		(b.curve[0] as { p: number[] }).p = [...(a.curve.at(-1) as { p: number[] }).p];
	}
	return { roads: out, how };
}
