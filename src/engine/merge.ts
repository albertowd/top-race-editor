// The ground's surface built as one (the track's surface.py, its full merge): every region on it (a road, a run-off, the ground) meeting its neighbours edge to
// edge, point for point, at one height. Regions, not tracks.
//
// A region: its name and either its own triangles (a road's mesh), each corner with its texture's place, or none (the ground: a height(x, z), its mapping, a
// point every so many metres). The first over all those after it.
//
// 1. Each region's outline (its triangles' union) and the part of it no region before it covers (its seen part), on the Python's grid (GRID: whole numbers of
//    it, so nothing is rounded twice); an outline's points within SNAP of what is over it put on that's edge first, as the Python does.
// 2. Every seen part's rings noded (each ring given every other's points that lie on it) and cut in pieces no longer than STEP, each worked out from the same
//    end on both sides of an edge: the same points either side.
// 3. Each seen part a face (they do not overlap), filled: its region's own triangles wholly inside it kept, the rest filled on its edge points by Triangle (the
//    ground with a point every spacing metres too); a sliver ear by ear.
// 4. One height a point: a region's own points first, by the order; any other the first region's over it; the ground's eased from what borders it to its own
//    over RAMP.
//
// check() proves it: every edge of two faces (but on the world's edge), one height a point, the world covered once.
import { Clipper64, ClipType, FillRule, Path64, Paths64, Point64 } from "clipper2-js";
import { geosOp, geosReady, geosTriangles } from "./geos";
import { earClip } from "./polygon";
import { type Box, TILE, TileIndex } from "./tiles";
import type { Triangle } from "./triangle";

/** metres: every point on this grid */
export const GRID = 1e-4;
/** grid units: a point of another ring this near an edge is put in it (GEOS's snap-rounding puts a point in the middle of its unit square, up to half its
 * diagonal (0.71) off the edges another operation left straight; more, and a point of a neighbour a few units off an edge is pulled into it, a sliver of it
 * laid over the neighbour) */
const NODE_OFF = 0.75;
/** grid units: a mesh's points this near one another (each way) made one as it is put on the grid: an unwelded seam closed */
const SEAM_U = 10;
/** metres: the longest piece of a shared edge */
export const STEP = 0.5;
/** metres: an outline's point this near the edge of a region over it put on that edge */
export const SNAP = 0.01;
/** metres over which the ground eases from what borders it to its own height */
export const RAMP = 1.5;
/** square metres: the ground's largest triangle */
export const AREA = 4;
/** metres: a face thinner than this (its area over its half perimeter) is a sliver */
export const SLIVER = GRID * 20;

const STEP_U = Math.round(STEP / GRID);
const SNAP_U = Math.round(SNAP / GRID);
/** metres: points of the merge closer than this made one (no face with an edge shorter) */
export const WELD = 0.001;
const WELD_U = Math.round(WELD / GRID);
/** grid units: a point's number (the merge's heights) exact within this of the world's middle (3.3 km) */
const HALF = 2 ** 25;
/** grid units: how far past the world a region's points may lie (its triangles cropped 2 m past it) */
const PAST_WORLD = 1e6;
/** an edge's number: its two points' numbers, the first times this (points fewer than it: 2^26) */
const EDGE_KEY = 2 ** 26;

export interface Region {
	name: string;
	/** its triangles: nine numbers each (three corners, x y z) */
	tris?: Float64Array;
	/** their corners' texture places: six numbers each */
	uvs?: Float64Array;
	/** the ground: its height and mapping, and metres between its own points */
	ground?: {
		height: (x: number, z: number) => number;
		uv: (x: number, z: number) => [number, number];
		spacing: number;
	};
}

/** A region's surface: points (x, y, z), their mapping (u, v), faces (three corners, facing up). */
export interface Mesh {
	P: Float64Array;
	UV: Float64Array;
	F: Int32Array;
}

// ---- the grid ----------------------------------------------------------------------------------------------------

/** np.round: halves to the even (the Python's snap). */
function roundEven(v: number): number {
	const r = Math.round(v);
	return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** A coordinate on the grid, as a whole number of GRID. */
export const unit = (v: number) => roundEven(v / GRID);
/** A whole number of GRID back to metres. */
export const metres = (u: number) => u * GRID;
const keyOf = (x: number, z: number) => `${x},${z}`;

export { earClip };

export type Pt = [number, number];
/** A ring of grid points (no point repeated at its end). */
type Ring = Pt[];
/** A polygon: its outer ring (anticlockwise) and its holes (clockwise). */
export interface Poly {
	outer: Ring;
	holes: Ring[];
}

export const area2 = (r: Ring) => {
	let s = 0;
	for (let i = 0; i < r.length; i++) {
		const a = r[i] as Pt;
		const b = r[(i + 1) % r.length] as Pt;
		s += a[0] * b[1] - b[0] * a[1];
	}
	return s;
};

const toPath = (r: Ring) => {
	const p = new Path64();
	for (const [x, z] of r) p.push(new Point64(x, z));
	return p;
};
const fromPath = (p: Path64): Ring => p.map((q) => [Number(q.x), Number(q.y)] as Pt);
export const toPaths = (polys: Poly[]) => {
	const out = new Paths64();
	for (const p of polys) {
		out.push(toPath(p.outer));
		for (const h of p.holes) out.push(toPath(h));
	}
	return out;
};

/** Paths (as a boolean leaves them) as polygons with their holes: outer rings anticlockwise, holes clockwise, each hole the smallest outer ring's round a point
 * inside it. (Clipper2's tree of them fails in clipper2-js 1.2.4: its flat result is used.) */
export function polysOf(op: ClipType, subject: Paths64, clip: Paths64 | null, rule = FillRule.NonZero): Poly[] {
	const c = new Clipper64();
	c.addSubjectPaths(subject);
	if (clip) c.addClipPaths(clip);
	const sol = new Paths64();
	if (!c.execute(op, rule, sol)) throw new Error("a polygon operation failed");
	const outers: { poly: Poly; area: number }[] = [];
	const holes: Ring[] = [];
	for (const path of sol) {
		const r = unspike(fromPath(path));
		if (r.length < 3) continue;
		const a = area2(r);
		if (a > 0) outers.push({ poly: { outer: r, holes: [] }, area: a });
		else if (a < 0) holes.push(r);
	}
	outers.sort((u, v) => u.area - v.area);
	for (const h of holes) {
		const [x, z] = inside([...h].reverse());
		const home = outers.find((o) => ringHas(o.poly.outer, x, z));
		home?.poly.holes.push(h);
	}
	return outers.map((o) => o.poly);
}

/** A ring without its spikes: no point repeated next to itself, none its path goes out to and straight back from (Clipper2's union of a mesh's triangles can
 * leave its inner edges in as such slits, no wider than nothing). Points in line going on are kept: they are other faces' points. */
export function unspike(r: Ring): Ring {
	const out = [...r];
	let changed = true;
	while (changed && out.length >= 3) {
		changed = false;
		for (let i = 0; i < out.length && out.length >= 3; i++) {
			const a = out[(i + out.length - 1) % out.length] as Pt;
			const b = out[i] as Pt;
			const c = out[(i + 1) % out.length] as Pt;
			const same = b[0] === a[0] && b[1] === a[1];
			const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
			const back = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0;
			if (same || (cross === 0 && back)) {
				out.splice(i, 1);
				changed = true;
				i--;
			}
		}
	}
	return out.length >= 3 ? out : [];
}

/** Whether (x, z) is inside a ring (even-odd). */
function ringHas(r: Ring, x: number, z: number): boolean {
	let inn = false;
	for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
		const a = r[i] as Pt;
		const b = r[j] as Pt;
		if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inn = !inn;
	}
	return inn;
}

const polyArea = (p: Poly) => (area2(p.outer) + p.holes.reduce((a, h) => a + area2(h), 0)) / 2;
const shapeArea = (s: Poly[]) => s.reduce((a, p) => a + polyArea(p), 0);
const rings = (p: Poly) => [p.outer, ...p.holes];

// ---- points against edges --------------------------------------------------------------------------------------

/** Segments filed by the grid cells they cross (cells CELL units a side), for what lies near a point. */
class SegIndex {
	static readonly CELL = 10000;
	private readonly cells = new Map<string, number[]>();
	readonly a: Pt[] = [];
	readonly b: Pt[] = [];

	add(a: Pt, b: Pt): void {
		const i = this.a.length;
		this.a.push(a);
		this.b.push(b);
		const C = SegIndex.CELL;
		const x0 = Math.floor(Math.min(a[0], b[0]) / C);
		const x1 = Math.floor(Math.max(a[0], b[0]) / C);
		const z0 = Math.floor(Math.min(a[1], b[1]) / C);
		const z1 = Math.floor(Math.max(a[1], b[1]) / C);
		for (let x = x0; x <= x1; x++)
			for (let z = z0; z <= z1; z++) {
				const k = keyOf(x, z);
				const l = this.cells.get(k);
				if (l) l.push(i);
				else this.cells.set(k, [i]);
			}
	}

	/** The segments within r units of a point (by their cells). */
	near(p: Pt, r: number): number[] {
		const C = SegIndex.CELL;
		const out = new Set<number>();
		for (let x = Math.floor((p[0] - r) / C); x <= Math.floor((p[0] + r) / C); x++)
			for (let z = Math.floor((p[1] - r) / C); z <= Math.floor((p[1] + r) / C); z++) for (const i of this.cells.get(keyOf(x, z)) ?? []) out.add(i);
		return [...out];
	}
}

/** A point's distance to a segment, and how far along it (0-1) its foot is. */
function toSegment(p: Pt, a: Pt, b: Pt): [number, number] {
	const dx = b[0] - a[0];
	const dz = b[1] - a[1];
	const L2 = dx * dx + dz * dz;
	const t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2 : 0;
	const u = Math.min(Math.max(t, 0), 1);
	return [Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dz)), t];
}

/** Points filed by grid cells, for those near a point. */
class PointIndex {
	static readonly CELL = 10000;
	private readonly cells = new Map<string, Pt[]>();

	add(p: Pt): void {
		const k = keyOf(Math.floor(p[0] / PointIndex.CELL), Math.floor(p[1] / PointIndex.CELL));
		const l = this.cells.get(k);
		if (l) l.push(p);
		else this.cells.set(k, [p]);
	}

	near(lo: Pt, hi: Pt): Pt[] {
		const C = PointIndex.CELL;
		const out: Pt[] = [];
		for (let x = Math.floor(lo[0] / C); x <= Math.floor(hi[0] / C); x++)
			for (let z = Math.floor(lo[1] / C); z <= Math.floor(hi[1] / C); z++)
				for (const p of this.cells.get(keyOf(x, z)) ?? []) if (p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1]) out.push(p);
		return out;
	}
}

// ---- 1. outlines and seen parts --------------------------------------------------------------------------------

/** A region's triangles on the grid, those of no area out (as the Python's Region). */
function gridTris(r: Region): { T: Int32Array | Float64Array; Y: Float64Array; UV: Float64Array | null; n: number } {
	const src = r.tris as Float64Array;
	const n0 = src.length / 9;
	const keep: number[] = [];
	const g = new Float64Array(n0 * 6);
	// (a point within SEAM_U of one put on the grid before it made that one: a mesh's seam its modeller left unwelded, its two sides a hair apart, closed (else a
	// crack a unit wide, for the ground to fill as a spike))
	const cells = new Map<string, Pt[]>();
	const welded = (x: number, z: number): Pt => {
		const cx = Math.floor(x / (2 * SEAM_U));
		const cz = Math.floor(z / (2 * SEAM_U));
		for (let i = cx - 1; i <= cx + 1; i++)
			for (let j = cz - 1; j <= cz + 1; j++)
				for (const p of cells.get(keyOf(i, j)) ?? []) if (p !== undefined && Math.abs(p[0] - x) <= SEAM_U && Math.abs(p[1] - z) <= SEAM_U) return p;
		const p: Pt = [x, z];
		const k = keyOf(cx, cz);
		const l = cells.get(k);
		if (l) l.push(p);
		else cells.set(k, [p]);
		return p;
	};
	for (let t = 0; t < n0; t++) {
		for (let c = 0; c < 3; c++) {
			const [x, z] = welded(unit(src[t * 9 + c * 3] as number), unit(src[t * 9 + c * 3 + 2] as number));
			g[t * 6 + c * 2] = x;
			g[t * 6 + c * 2 + 1] = z;
		}
		const a =
			((g[t * 6 + 2] as number) - (g[t * 6] as number)) * ((g[t * 6 + 5] as number) - (g[t * 6 + 1] as number)) -
			((g[t * 6 + 4] as number) - (g[t * 6] as number)) * ((g[t * 6 + 3] as number) - (g[t * 6 + 1] as number));
		// (the Python's 2e-10 m² on the grid: 2e-10 / GRID²)
		if (Math.abs(a) > 2e-10 / (GRID * GRID)) keep.push(t);
	}
	const T = new Float64Array(keep.length * 6);
	const Y = new Float64Array(keep.length * 3);
	const UV = r.uvs ? new Float64Array(keep.length * 6) : null;
	keep.forEach((t, i) => {
		T.set(g.subarray(t * 6, t * 6 + 6), i * 6);
		for (let c = 0; c < 3; c++) Y[i * 3 + c] = src[t * 9 + c * 3 + 1] as number;
		if (UV && r.uvs) UV.set(r.uvs.subarray(t * 6, t * 6 + 6), i * 6);
	});
	return { T, Y, UV, n: keep.length };
}

/** A mesh's outline: the union of its triangles. From the edges no two of its triangles share (each turned anticlockwise), chained into rings and those made
 * one: the same as the union of every triangle where none overlaps another (its area theirs). Where some do (a mesh folded over itself), those found (folded),
 * and the union of every triangle made by GEOS. */
export function outlineOf(T: Float64Array | Int32Array, n: number): Outline {
	const all = Array.from({ length: n }, (_, t) => t);
	const { paths, total } = edgeRings(T, all);
	const fast = polysOf(ClipType.Union, paths, null);
	if (Math.abs(shapeArea(fast) * 2 - total) <= Math.max(1, total * 1e-12)) return { polys: noCracks(fast), folded: null };
	const fold = folded(T, n);
	// (where some do: the union of every one of them by GEOS, as the Python's shapely makes it (clipper2-js's union of such never ends on some: the Velopark
	// paddock's floor, an old kerb's top))
	return { polys: noCracks(geosTriangles(T, n)), folded: fold };
}

/** Polygons without their cracks: a hole thinner than a sliver (its area over its half perimeter under SLIVER), a mesh's seam its modeller left open, is the
 * region's, not a hole in the floor (else the ground fills it, thinner than it can be filled). */
function noCracks(polys: Poly[]): Poly[] {
	for (const p of polys)
		p.holes = p.holes.filter((h) => {
			let len = 0;
			for (let i = 0; i < h.length; i++) {
				const a = h[i] as Pt;
				const b = h[(i + 1) % h.length] as Pt;
				len += Math.hypot(b[0] - a[0], b[1] - a[1]);
			}
			return Math.abs(area2(h)) / 2 / Math.max(len / 2, 1e-9) >= SLIVER / GRID;
		});
	return polys;
}

/** A triangle of a mesh as a ring, anticlockwise. */
export function triRing(T: Float64Array | Int32Array, t: number): Ring {
	const r: Ring = [
		[T[t * 6] as number, T[t * 6 + 1] as number],
		[T[t * 6 + 2] as number, T[t * 6 + 3] as number],
		[T[t * 6 + 4] as number, T[t * 6 + 5] as number],
	];
	if (area2(r) < 0) r.reverse();
	return r;
}

/** Some of a mesh's triangles' edges no two of them share, chained into rings (the way they go: anticlockwise round what they cover), and twice their area. */
export function edgeRings(T: Float64Array | Int32Array, ids: number[]): { paths: Paths64; total: number } {
	// (each edge's count one way less the other: those left over are the outline's, the way they go)
	const net = new Map<string, number>();
	const ends = new Map<string, Pt>();
	let total = 0;
	for (const t of ids) {
		const r = triRing(T, t);
		total += area2(r);
		for (let k = 0; k < 3; k++) {
			const a = r[k] as Pt;
			const b = r[(k + 1) % 3] as Pt;
			const ka = keyOf(a[0], a[1]);
			const kb = keyOf(b[0], b[1]);
			ends.set(ka, a);
			ends.set(kb, b);
			const [e, s] = ka < kb ? [`${ka}|${kb}`, 1] : [`${kb}|${ka}`, -1];
			net.set(e, (net.get(e) ?? 0) + s);
		}
	}
	const out = new Map<string, string[]>();
	for (const [e, c] of net) {
		if (!c) continue;
		const [ka, kb] = e.split("|") as [string, string];
		const [from, to] = c > 0 ? [ka, kb] : [kb, ka];
		for (let i = 0; i < Math.abs(c); i++) {
			const l = out.get(from);
			if (l) l.push(to);
			else out.set(from, [to]);
		}
	}
	const paths = new Paths64();
	for (const start of [...out.keys()]) {
		while (out.get(start)?.length) {
			const ring: Ring = [];
			let k = start;
			for (let guard = 0; guard <= net.size; guard++) {
				const next = out.get(k)?.pop();
				if (next === undefined) break;
				ring.push(ends.get(k) as Pt);
				k = next;
				if (k === start) break;
			}
			if (ring.length >= 3) paths.push(toPath(ring));
		}
	}
	return { paths, total };
}

/** A mesh's outline, and which of its triangles lie over others of its own (none, null, when it covers as much as they do). */
export interface Outline {
	polys: Poly[];
	folded: Uint8Array | null;
}

/** Which of a mesh's triangles overlap another of its own (a strip folded on a tight curve): their insides meeting, not only touching (the Python's intersects
 * and not touches). Exact on the grid's whole numbers: two triangles' insides are apart only if the line of one of their six edges has them
 * on its two sides. */
export function folded(T: Float64Array | Int32Array, n: number): Uint8Array {
	const out = new Uint8Array(n);
	// (filed by cells of FOLD_CELL, each pair looked at in the first cell both are in)
	const C = FOLD_CELL;
	const box = new Float64Array(n * 4);
	const cells = new Map<string, number[]>();
	for (let t = 0; t < n; t++) {
		const xs = [T[t * 6] as number, T[t * 6 + 2] as number, T[t * 6 + 4] as number];
		const zs = [T[t * 6 + 1] as number, T[t * 6 + 3] as number, T[t * 6 + 5] as number];
		box.set([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], t * 4);
		for (let gx = Math.floor((box[t * 4] as number) / C); gx <= Math.floor((box[t * 4 + 2] as number) / C); gx++)
			for (let gz = Math.floor((box[t * 4 + 1] as number) / C); gz <= Math.floor((box[t * 4 + 3] as number) / C); gz++) {
				const k = keyOf(gx, gz);
				const l = cells.get(k);
				if (l) l.push(t);
				else cells.set(k, [t]);
			}
	}
	const v = (t: number, c: number, a: number) => T[t * 6 + (c % 3) * 2 + a] as number;
	const apart = (a: number, b: number) => {
		for (const [s, o] of [
			[a, b],
			[b, a],
		] as const)
			for (let c = 0; c < 3; c++) {
				const nx = -(v(s, c + 1, 1) - v(s, c, 1));
				const nz = v(s, c + 1, 0) - v(s, c, 0);
				let lo1 = Infinity;
				let hi1 = -Infinity;
				let lo2 = Infinity;
				let hi2 = -Infinity;
				for (let k = 0; k < 3; k++) {
					const p = v(s, k, 0) * nx + v(s, k, 1) * nz;
					const q = v(o, k, 0) * nx + v(o, k, 1) * nz;
					lo1 = Math.min(lo1, p);
					hi1 = Math.max(hi1, p);
					lo2 = Math.min(lo2, q);
					hi2 = Math.max(hi2, q);
				}
				if (hi1 <= lo2 || hi2 <= lo1) return true;
			}
		return false;
	};
	for (const [key, l] of cells) {
		const [cx, cz] = key.split(",").map(Number) as [number, number];
		for (let i = 0; i < l.length; i++)
			for (let j = i + 1; j < l.length; j++) {
				const a = l[i] as number;
				const b = l[j] as number;
				// (their boxes' insides apart: apart; and the pair once, in the first cell of both)
				if (
					(box[a * 4 + 2] as number) <= (box[b * 4] as number) ||
					(box[b * 4 + 2] as number) <= (box[a * 4] as number) ||
					(box[a * 4 + 3] as number) <= (box[b * 4 + 1] as number) ||
					(box[b * 4 + 3] as number) <= (box[a * 4 + 1] as number)
				)
					continue;
				const fx = Math.floor(Math.max(box[a * 4] as number, box[b * 4] as number) / C);
				const fz = Math.floor(Math.max(box[a * 4 + 1] as number, box[b * 4 + 1] as number) / C);
				if (fx !== cx || fz !== cz) continue;
				if (!apart(a, b)) {
					out[a] = 1;
					out[b] = 1;
				}
			}
	}
	return out;
}

/** The box round polygons' outer rings, grid units, grown by pad. */
function polysBox(ps: Poly[], pad: number): Box {
	const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
	for (const p of ps)
		for (const [x, z] of p.outer) {
			if (x < b.x0) b.x0 = x;
			if (x > b.x1) b.x1 = x;
			if (z < b.z0) b.z0 = z;
			if (z > b.z1) b.z1 = z;
		}
	return { x0: b.x0 - pad, z0: b.z0 - pad, x1: b.x1 + pad, z1: b.z1 + pad };
}

/** An outline with its points within SNAP of the edges of what is over it (and not on them) put on them: onto the nearest of that edge's own points; and where
 * two of its points in a row are on that edge, the edge's own points between them taken too. As it was if that would change its area by more than the moves can
 * (a twist). */
function snapTo(f: Poly[], over: Poly[]): Poly[] {
	const B = new SegIndex();
	const BV = new PointIndex();
	for (const p of over)
		for (const r of rings(p))
			r.forEach((a, i) => {
				B.add(a, r[(i + 1) % r.length] as Pt);
				BV.add(a);
			});
	const nearestVertex = (p: Pt): [Pt | null, number] => {
		let best: Pt | null = null;
		let bd = Infinity;
		for (let r = SNAP_U; r <= SNAP_U * 64 && !best; r *= 4)
			for (const q of BV.near([p[0] - r, p[1] - r], [p[0] + r, p[1] + r])) {
				const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
				if (d < bd) {
					bd = d;
					best = q;
				}
			}
		return [best, bd];
	};
	const onEdge = (p: Pt) => B.near(p, SNAP_U).some((i) => toSegment(p, B.a[i] as Pt, B.b[i] as Pt)[0] < SNAP_U);
	let moved = 0;
	const ring = (c: Ring): Ring => {
		const on = c.map(onEdge);
		const pts = c.map((p, i): Pt => {
			if (!on[i]) return p;
			const [v, d] = nearestVertex(p);
			if (!v) return p;
			if (d > 0.5) moved++;
			return v;
		});
		const out: Ring = [];
		for (let i = 0; i < pts.length; i++) {
			const a = pts[i] as Pt;
			const b = pts[(i + 1) % pts.length] as Pt;
			out.push(a);
			if (!(on[i] && on[(i + 1) % pts.length])) continue;
			const dx = b[0] - a[0];
			const dz = b[1] - a[1];
			const L2 = dx * dx + dz * dz;
			if (L2 < 1) continue;
			const L = Math.sqrt(L2);
			const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
			const reach = L / 2 + SNAP_U;
			const cand = BV.near([mid[0] - reach, mid[1] - reach], [mid[0] + reach, mid[1] + reach])
				.map((q) => {
					const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2;
					const off = Math.abs((q[0] - a[0]) * dz - (q[1] - a[1]) * dx) / L;
					return { q, t, off };
				})
				.filter(({ t, off }) => t > 1e-6 && t < 1 - 1e-6 && off < SNAP_U)
				.sort((u, v) => u.t - v.t);
			for (const { q } of cand) out.push(q);
			moved += cand.length;
		}
		const dedup = out.filter((p, i) => {
			const q = out[(i + out.length - 1) % out.length] as Pt;
			return i === 0 || p[0] !== q[0] || p[1] !== q[1];
		});
		while (dedup.length > 1) {
			const a = dedup[0] as Pt;
			const z = dedup[dedup.length - 1] as Pt;
			if (a[0] === z[0] && a[1] === z[1]) dedup.pop();
			else break;
		}
		return dedup;
	};
	const parts: Paths64 = new Paths64();
	for (const p of f) {
		const outer = ring(p.outer);
		if (outer.length < 3) {
			moved++;
			continue;
		}
		parts.push(toPath(outer));
		for (const h of p.holes) {
			const r = ring(h);
			if (r.length >= 3) parts.push(toPath(r));
		}
	}
	if (!moved) return f;
	const out = polysOf(ClipType.Union, parts, null, FillRule.EvenOdd);
	const tolerance = (moved * SNAP * STEP + 1e-6) / (GRID * GRID);
	return Math.abs(shapeArea(out) - shapeArea(f)) > tolerance ? f : out;
}

// ---- 2. the edges noded and cut ----------------------------------------------------------------------------------

/** Every ring of the faces given each point of any ring that lies on one of its edges (within a unit), then each edge between two of its points cut in pieces
 * no longer than STEP (worked out from its lower end, so both sides of an edge cut it alike), but those on the world's edge. */
function node(faces: Poly[], world: [number, number, number, number], tile = 0, spacing = STEP_U): void {
	/** On a tile line (the ground's tiles meeting): along which axis, else -1. Cut at every spacing from 0 on it, the ground's own points' places, not every
	 * STEP. */
	const tileLine = (a: Pt, b: Pt): 0 | 1 | -1 => (!tile ? -1 : a[0] === b[0] && a[0] % tile === 0 ? 1 : a[1] === b[1] && a[1] % tile === 0 ? 0 : -1);
	const all = new PointIndex();
	const seen = new Set<string>();
	for (const f of faces)
		for (const r of rings(f))
			for (const p of r) {
				const k = keyOf(p[0], p[1]);
				if (!seen.has(k)) {
					seen.add(k);
					all.add(p);
				}
			}
	const [x0, z0, x1, z1] = world;
	const onWorld = (a: Pt, b: Pt) =>
		(a[0] === x0 && b[0] === x0) || (a[0] === x1 && b[0] === x1) || (a[1] === z0 && b[1] === z0) || (a[1] === z1 && b[1] === z1);
	const cut = (r: Ring): Ring => {
		const out: Ring = [];
		for (let i = 0; i < r.length; i++) {
			const a = r[i] as Pt;
			const b = r[(i + 1) % r.length] as Pt;
			out.push(a);
			const dx = b[0] - a[0];
			const dz = b[1] - a[1];
			const L2 = dx * dx + dz * dz;
			if (L2 < 1) continue;
			const L = Math.sqrt(L2);
			// (the points of the others on it, in order along it)
			const on = all
				.near([Math.min(a[0], b[0]) - NODE_OFF, Math.min(a[1], b[1]) - NODE_OFF], [Math.max(a[0], b[0]) + NODE_OFF, Math.max(a[1], b[1]) + NODE_OFF])
				.map((q) => ({
					q,
					t: ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2,
					off: Math.abs((q[0] - a[0]) * dz - (q[1] - a[1]) * dx) / L,
				}))
				.filter(({ t, off }) => t > 1e-12 && t < 1 - 1e-12 && off <= NODE_OFF)
				.sort((u, v) => u.t - v.t)
				.map(({ q }) => q);
			const stops = [a, ...on, b];
			for (let k = 0; k + 1 < stops.length; k++) {
				const p = stops[k] as Pt;
				const q = stops[k + 1] as Pt;
				if (k) out.push(p);
				// (the world's edge too: it has nothing the other side, so its points are its own; at the ground's spacing, so the ground follows itself along it, not
				// a straight line from one corner to the next)
				const axis = onWorld(p, q) ? (p[0] === q[0] ? 1 : 0) : tileLine(p, q);
				if (axis !== -1) {
					const lo = Math.min(p[axis] as number, q[axis] as number);
					const hi = Math.max(p[axis] as number, q[axis] as number);
					const mid: Pt[] = [];
					for (let v = Math.floor(lo / spacing + 1) * spacing; v < hi; v += spacing) mid.push(axis === 0 ? [v, p[1]] : [p[0], v]);
					if ((q[axis] as number) < (p[axis] as number)) mid.reverse();
					out.push(...mid);
					continue;
				}
				const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
				const n = Math.max(1, Math.ceil(len / STEP_U - 1e-9));
				if (n < 2) continue;
				// (from the lower end of the two, whichever way the ring goes)
				const lowFirst = p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]);
				const [lo, hi] = lowFirst ? [p, q] : [q, p];
				const mid: Pt[] = [];
				for (let m = 1; m < n; m++) mid.push([roundEven(lo[0] + ((hi[0] - lo[0]) * m) / n), roundEven(lo[1] + ((hi[1] - lo[1]) * m) / n)]);
				if (!lowFirst) mid.reverse();
				out.push(...mid);
			}
		}
		return out.filter((p, i) => {
			const q = out[(i + out.length - 1) % out.length] as Pt;
			return out.length < 2 || p[0] !== q[0] || p[1] !== q[1];
		});
	};
	for (const f of faces) {
		f.outer = cut(f.outer);
		f.holes = f.holes.map(cut);
	}
	// (then the points the cutting made put in the edges they lie on too, the other side's: again until none is)
	for (let round = 0; round < 4 && insertAll(faces); round++);
}

/** Every point of the faces' rings that lies on an edge of one (within NODE_OFF) and is not one of its ends put in it, in order along it: whether any was. */
function insertAll(faces: Poly[]): boolean {
	const all = new PointIndex();
	const seen = new Set<string>();
	for (const f of faces)
		for (const r of rings(f))
			for (const p of r) {
				const k = keyOf(p[0], p[1]);
				if (!seen.has(k)) {
					seen.add(k);
					all.add(p);
				}
			}
	let any = false;
	const put = (r: Ring): Ring => {
		const out: Ring = [];
		for (let i = 0; i < r.length; i++) {
			const a = r[i] as Pt;
			const b = r[(i + 1) % r.length] as Pt;
			out.push(a);
			const dx = b[0] - a[0];
			const dz = b[1] - a[1];
			const L2 = dx * dx + dz * dz;
			if (L2 < 1) continue;
			const L = Math.sqrt(L2);
			const on = all
				.near([Math.min(a[0], b[0]) - NODE_OFF, Math.min(a[1], b[1]) - NODE_OFF], [Math.max(a[0], b[0]) + NODE_OFF, Math.max(a[1], b[1]) + NODE_OFF])
				.map((q) => ({
					q,
					t: ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2,
					off: Math.abs((q[0] - a[0]) * dz - (q[1] - a[1]) * dx) / L,
				}))
				.filter(({ q, t, off }) => t > 1e-12 && t < 1 - 1e-12 && off <= NODE_OFF && !(q[0] === b[0] && q[1] === b[1]))
				.sort((u, v) => u.t - v.t);
			for (const { q } of on) out.push(q);
			if (on.length) any = true;
		}
		return out.filter((p, i) => {
			const q = out[(i + out.length - 1) % out.length] as Pt;
			return out.length < 2 || p[0] !== q[0] || p[1] !== q[1];
		});
	};
	for (const f of faces) {
		f.outer = put(f.outer);
		f.holes = f.holes.map(put);
	}
	return any;
}

// ---- 3. each face filled ---------------------------------------------------------------------------------------

/** A point inside a ring (a hole's), off its edges: the middle of the widest stretch across it at its middle height. */
function inside(r: Ring): Pt {
	let lo = Infinity;
	let hi = -Infinity;
	for (const p of r) {
		lo = Math.min(lo, p[1]);
		hi = Math.max(hi, p[1]);
	}
	const z = (lo + hi) / 2 + 0.123456;
	const xs: number[] = [];
	for (let i = 0; i < r.length; i++) {
		const a = r[i] as Pt;
		const b = r[(i + 1) % r.length] as Pt;
		if (a[1] > z !== b[1] > z) xs.push(a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
	}
	xs.sort((u, v) => u - v);
	let best: Pt = [(r[0] as Pt)[0], z];
	let w = -1;
	for (let i = 0; i + 1 < xs.length; i += 2)
		if ((xs[i + 1] as number) - (xs[i] as number) > w) {
			w = (xs[i + 1] as number) - (xs[i] as number);
			best = [((xs[i] as number) + (xs[i + 1] as number)) / 2, z];
		}
	return best;
}

/** A polygon's edges filed by bands across z, for whether a point is inside it as pip says (an edge whose z-range misses the point's can neither hold it nor
 * cross its ray), looking only at the edges of the point's band. */
class PolyIndex {
	static readonly BAND = 10000;
	private readonly bands = new Map<number, number[]>();
	private readonly e: number[] = [];

	constructor(p: Poly) {
		for (const r of rings(p))
			for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
				const a = r[i] as Pt;
				const b = r[j] as Pt;
				const k = this.e.length / 4;
				this.e.push(a[0], a[1], b[0], b[1]);
				const lo = Math.floor(Math.min(a[1], b[1]) / PolyIndex.BAND);
				const hi = Math.floor(Math.max(a[1], b[1]) / PolyIndex.BAND);
				for (let band = lo; band <= hi; band++) {
					const l = this.bands.get(band);
					if (l) l.push(k);
					else this.bands.set(band, [k]);
				}
			}
	}

	pip(x: number, z: number): "in" | "on" | "out" {
		let inn = false;
		const e = this.e;
		for (const k of this.bands.get(Math.floor(z / PolyIndex.BAND)) ?? []) {
			const ax = e[k * 4] as number;
			const az = e[k * 4 + 1] as number;
			const bx = e[k * 4 + 2] as number;
			const bz = e[k * 4 + 3] as number;
			const cross = (bx - ax) * (z - az) - (bz - az) * (x - ax);
			if (cross === 0 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && z >= Math.min(az, bz) && z <= Math.max(az, bz)) return "on";
			if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inn = !inn;
		}
		return inn ? "in" : "out";
	}
}

/** A face filled: its points (grid units, but those Triangle added inside the ground) and its triangles. */
export interface Filled {
	P: Float64Array;
	F: Int32Array;
}

/** A face to fill, all it needs: its rings, its road's triangles near it (on the grid, six numbers each; none for the ground) and the ground's metres between
 * its own points (0: a road). Made to be sent to a worker. */
export interface FillJob {
	outer: Float64Array;
	holes: Float64Array[];
	T: Float64Array;
	spacing: number;
}

/** What fills the faces: here, one after another, or on workers (each with its own Triangle). */
export type Filler = (jobs: FillJob[]) => Promise<Filled[]>;

/** Faces filled here, one after another. */
export const localFiller =
	(tri: Triangle): Filler =>
	async (jobs) =>
		jobs.map((j) => fill(j, tri));

/** Triangles filed by grid cells. */
interface Tris {
	T: Float64Array | Int32Array;
	n: number;
	/** its triangles filed by grid cells */
	cells: Map<string, number[]>;
	cell: number;
}

interface Prepared extends Tris {
	/** its triangles over others of its own: never kept as they are, the fill's instead (null: none) */
	folded: Uint8Array | null;
	r: Region;
	Y: Float64Array;
	UV: Float64Array | null;
}

const CELL = 20000;
/** grid units a side of the cells a mesh's triangles are looked for folds in */
const FOLD_CELL = 5000;

function trisOf(T: Float64Array | Int32Array): Tris {
	const t: Tris = { T, n: T.length / 6, cells: new Map(), cell: CELL };
	for (let i = 0; i < t.n; i++)
		for (const k of cellsOf(T, i, t.cell)) {
			const l = t.cells.get(k);
			if (l) l.push(i);
			else t.cells.set(k, [i]);
		}
	return t;
}

const ringOf = (a: Float64Array): Ring => {
	const r: Ring = [];
	for (let i = 0; i < a.length; i += 2) r.push([a[i] as number, a[i + 1] as number]);
	return r;
};

/** A face filled, as a job gives it. */
export function fill(job: FillJob, tri: Triangle): Filled {
	const face: Poly = { outer: ringOf(job.outer), holes: job.holes.map(ringOf) };
	const f = fillFace(face, trisOf(job.T), job.spacing, tri);
	return { P: Float64Array.from(f.P), F: Int32Array.from(f.F) };
}

/** A face's job: its region's triangles near it, in their order. */
function jobOf(face: Poly, reg: Prepared): FillJob {
	const flat = (r: Ring) => Float64Array.from(r.flat());
	const out: FillJob = { outer: flat(face.outer), holes: face.holes.map(flat), T: new Float64Array(0), spacing: 0 };
	if (reg.r.ground) {
		out.spacing = reg.r.ground.spacing;
		return out;
	}
	const b = polysBox([face], 0);
	const cand = new Set<number>();
	for (let gx = Math.floor(b.x0 / reg.cell); gx <= Math.floor(b.x1 / reg.cell); gx++)
		for (let gz = Math.floor(b.z0 / reg.cell); gz <= Math.floor(b.z1 / reg.cell); gz++) for (const t of reg.cells.get(keyOf(gx, gz)) ?? []) cand.add(t);
	const ts = [...cand].filter((t) => !reg.folded?.[t]).sort((u, v) => u - v);
	out.T = new Float64Array(ts.length * 6);
	ts.forEach((t, i) => {
		out.T.set(reg.T.subarray(t * 6, t * 6 + 6), i * 6);
	});
	return out;
}

function fillFace(face: Poly, reg: Tris, spacing: number, tri: Triangle): { P: number[]; F: number[] } {
	const perimeter = rings(face).reduce(
		(a, r) => a + r.reduce((s, p, i) => s + Math.hypot((r[(i + 1) % r.length] as Pt)[0] - p[0], (r[(i + 1) % r.length] as Pt)[1] - p[1]), 0),
		0,
	);
	const area = polyArea(face);
	if (!face.holes.length && area < ((SLIVER / GRID) * perimeter) / 2) {
		const ring = face.outer;
		return { P: ring.flat(), F: earClip(ring) };
	}
	const pts: number[] = [];
	const segs: number[] = [];
	const at = new Map<string, number>();
	const point = (x: number, z: number) => {
		const k = keyOf(x, z);
		let i = at.get(k);
		if (i === undefined) {
			i = pts.length / 2;
			at.set(k, i);
			pts.push(x, z);
		}
		return i;
	};
	const seg = (i: number, j: number) => {
		if (i !== j) segs.push(i, j);
	};
	for (const r of rings(face)) {
		const ids = r.map((p) => point(p[0], p[1]));
		ids.forEach((id, i) => {
			seg(id, ids[(i + 1) % ids.length] as number);
		});
	}
	const inFace = new PolyIndex(face);
	// (its region's own triangles wholly inside it, kept)
	let kept: number[] = [];
	if (reg.n && !spacing) {
		let x0 = Infinity;
		let z0 = Infinity;
		let x1 = -Infinity;
		let z1 = -Infinity;
		for (const p of face.outer) {
			x0 = Math.min(x0, p[0]);
			x1 = Math.max(x1, p[0]);
			z0 = Math.min(z0, p[1]);
			z1 = Math.max(z1, p[1]);
		}
		const E = new SegIndex();
		for (const r of rings(face))
			r.forEach((a, i) => {
				E.add(a, r[(i + 1) % r.length] as Pt);
			});
		const cand = new Set<number>();
		for (let gx = Math.floor(x0 / reg.cell); gx <= Math.floor(x1 / reg.cell); gx++)
			for (let gz = Math.floor(z0 / reg.cell); gz <= Math.floor(z1 / reg.cell); gz++) for (const t of reg.cells.get(keyOf(gx, gz)) ?? []) cand.add(t);
		const T = reg.T;
		for (const t of cand) {
			const c: Pt[] = [0, 1, 2].map((k) => [T[t * 6 + k * 2] as number, T[t * 6 + k * 2 + 1] as number]);
			if (c.some(([x, z]) => inFace.pip(x, z) === "out")) continue;
			// (no edge of the face through it: its corners in, and none of its edges crossing one of the face's)
			let crosses = false;
			for (let k = 0; k < 3 && !crosses; k++) {
				const a = c[k] as Pt;
				const b = c[(k + 1) % 3] as Pt;
				const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
				const reach = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 1;
				for (const i of E.near(mid, reach))
					if (properCross(a, b, E.a[i] as Pt, E.b[i] as Pt)) {
						crosses = true;
						break;
					}
				if (!crosses && inFace.pip(mid[0], mid[1]) === "out") crosses = true;
			}
			if (!crosses) kept.push(t);
		}
		kept = dropTs(kept, reg, face);
		// (the kept triangles' own edges where the rest meets them: its edges too)
		for (const [a, b] of borderEdges(kept, reg)) seg(point(a[0], a[1]), point(b[0], b[1]));
	}
	// (the ground's own points inside it, away from its edges)
	if (spacing) {
		const sp = spacing / GRID;
		let x0 = Infinity;
		let z0 = Infinity;
		let x1 = -Infinity;
		let z1 = -Infinity;
		for (const p of face.outer) {
			x0 = Math.min(x0, p[0]);
			x1 = Math.max(x1, p[0]);
			z0 = Math.min(z0, p[1]);
			z1 = Math.max(z1, p[1]);
		}
		const E = new SegIndex();
		for (const r of rings(face))
			r.forEach((a, i) => {
				E.add(a, r[(i + 1) % r.length] as Pt);
			});
		const away = sp * 0.3;
		for (let x = Math.ceil(x0 / sp) * sp; x < x1; x += sp)
			for (let z = Math.ceil(z0 / sp) * sp; z < z1; z += sp) {
				const p: Pt = [roundEven(x), roundEven(z)];
				if (inFace.pip(p[0], p[1]) !== "in") continue;
				if (E.near(p, away).some((i) => toSegment(p, E.a[i] as Pt, E.b[i] as Pt)[0] <= away)) continue;
				point(p[0], p[1]);
			}
	}
	// (Triangle on those, what is outside the face by the points in its holes)
	const S: number[] = [];
	const seenSeg = new Set<string>();
	for (let i = 0; i < segs.length; i += 2) {
		const a = Math.min(segs[i] as number, segs[i + 1] as number);
		const b = Math.max(segs[i] as number, segs[i + 1] as number);
		const k = `${a},${b}`;
		if (!seenSeg.has(k)) {
			seenSeg.add(k);
			S.push(a, b);
		}
	}
	// (what is outside the face told to Triangle: a point in each hole, as the Python's; a hole thinner than the grid allows (its area over its length) not so, a
	// point in it falling either side of its edge: its triangles, on its own points alone and their middles in it, out after)
	const holes: number[] = [];
	const thin: Ring[] = [];
	for (const h of face.holes) {
		const ring = [...h].reverse();
		const length = ring.reduce((a, p, i) => a + Math.hypot((ring[(i + 1) % ring.length] as Pt)[0] - p[0], (ring[(i + 1) % ring.length] as Pt)[1] - p[1]), 0);
		if (Math.abs(area2(ring)) / 2 / Math.max(length, 1e-9) > 20) holes.push(...inside(h));
		else thin.push(ring);
	}
	const out = tri.triangulate(spacing ? `pYYQq25a${AREA / (GRID * GRID)}` : "pYYQ", {
		points: pts,
		segments: S,
		holes,
	});
	const TV = Array.from(out.points);
	TV.splice(0, pts.length, ...pts);
	let TF = Array.from(out.triangles);
	// (a pocket of the outside a ring touching itself closes (Clipper's, where shapely gives a hole) has no point in it for Triangle: its triangles, their
	// middles outside the face, out)
	{
		const keep: number[] = [];
		for (let i = 0; i < TF.length; i += 3) {
			const v = [TF[i] as number, TF[i + 1] as number, TF[i + 2] as number];
			const cx = v.reduce((a, k) => a + (TV[k * 2] as number), 0) / 3;
			const cz = v.reduce((a, k) => a + (TV[k * 2 + 1] as number), 0) / 3;
			if (inFace.pip(cx, cz) !== "out") keep.push(...v);
		}
		TF = keep;
	}
	for (const ring of thin) {
		const own = new Set(ring.map((p) => keyOf(p[0], p[1])));
		const index = new PolyIndex({ outer: ring, holes: [] });
		const keep: number[] = [];
		for (let i = 0; i < TF.length; i += 3) {
			const v = [TF[i] as number, TF[i + 1] as number, TF[i + 2] as number];
			const mine = v.every((k) => own.has(keyOf(TV[k * 2] as number, TV[k * 2 + 1] as number)));
			const cx = v.reduce((a, k) => a + (TV[k * 2] as number), 0) / 3;
			const cz = v.reduce((a, k) => a + (TV[k * 2 + 1] as number), 0) / 3;
			if (!(mine && index.pip(cx, cz) === "in")) keep.push(...v);
		}
		TF = keep;
	}
	// (not where a kept triangle is: by where each one's middle falls)
	if (kept.length) {
		const keptCells = new Map<string, number[]>();
		for (const t of kept)
			for (const gk of cellsOf(reg.T, t, reg.cell)) {
				const l = keptCells.get(gk);
				if (l) l.push(t);
				else keptCells.set(gk, [t]);
			}
		const keepTri: number[] = [];
		for (let i = 0; i < TF.length; i += 3) {
			const cx = ((TV[(TF[i] as number) * 2] as number) + (TV[(TF[i + 1] as number) * 2] as number) + (TV[(TF[i + 2] as number) * 2] as number)) / 3;
			const cz =
				((TV[(TF[i] as number) * 2 + 1] as number) + (TV[(TF[i + 1] as number) * 2 + 1] as number) + (TV[(TF[i + 2] as number) * 2 + 1] as number)) / 3;
			const on = (keptCells.get(keyOf(Math.floor(cx / reg.cell), Math.floor(cz / reg.cell))) ?? []).some((t) => inTriangle(reg.T, t, cx, cz));
			if (!on) keepTri.push(TF[i] as number, TF[i + 1] as number, TF[i + 2] as number);
		}
		TF = keepTri;
		// (the kept triangles, on the same points)
		for (const t of kept) {
			const ids = [0, 1, 2].map((k) => {
				const x = reg.T[t * 6 + k * 2] as number;
				const z = reg.T[t * 6 + k * 2 + 1] as number;
				const key = keyOf(x, z);
				let i = at.get(key);
				if (i === undefined) {
					i = TV.length / 2;
					at.set(key, i);
					TV.push(x, z);
				}
				return i;
			});
			TF.push(...ids);
		}
	}
	return { P: TV, F: TF };
}

function cellsOf(T: Float64Array | Int32Array, t: number, cell: number): string[] {
	const xs = [T[t * 6] as number, T[t * 6 + 2] as number, T[t * 6 + 4] as number];
	const zs = [T[t * 6 + 1] as number, T[t * 6 + 3] as number, T[t * 6 + 5] as number];
	const out: string[] = [];
	for (let gx = Math.floor(Math.min(...xs) / cell); gx <= Math.floor(Math.max(...xs) / cell); gx++)
		for (let gz = Math.floor(Math.min(...zs) / cell); gz <= Math.floor(Math.max(...zs) / cell); gz++) out.push(keyOf(gx, gz));
	return out;
}

/** Whether (x, z) is in triangle t or on its edge. */
function inTriangle(T: Float64Array | Int32Array, t: number, x: number, z: number): boolean {
	const ax = T[t * 6] as number;
	const az = T[t * 6 + 1] as number;
	const bx = T[t * 6 + 2] as number;
	const bz = T[t * 6 + 3] as number;
	const cx = T[t * 6 + 4] as number;
	const cz = T[t * 6 + 5] as number;
	const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax);
	const d2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx);
	const d3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
	return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

/** Whether two segments cross inside both (not only touching). */
function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
	const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
	return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** The edges of some triangles no other of them shares. */
function borderEdges(kept: number[], reg: Tris): [Pt, Pt][] {
	const count = new Map<string, [Pt, Pt, number]>();
	for (const t of kept)
		for (let k = 0; k < 3; k++) {
			const a: Pt = [reg.T[t * 6 + k * 2] as number, reg.T[t * 6 + k * 2 + 1] as number];
			const b: Pt = [reg.T[t * 6 + ((k + 1) % 3) * 2] as number, reg.T[t * 6 + ((k + 1) % 3) * 2 + 1] as number];
			const ka = keyOf(a[0], a[1]);
			const kb = keyOf(b[0], b[1]);
			const k2 = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
			const e = count.get(k2);
			if (e) e[2]++;
			else count.set(k2, [a, b, 1]);
		}
	return [...count.values()].filter((e) => e[2] === 1).map(([a, b]) => [a, b]);
}

/** Of the kept triangles, those not leaving a T: none with a point of the face's edge, or of another kept one's border, inside one of its border edges; none
 * with a border corner on the face's edge that is not one of its points. Looked for again as long as one goes (its going makes others' edges the border). */
function dropTs(kept: number[], reg: Tris, face: Poly): number[] {
	let live = kept;
	const ringPts = rings(face).flat();
	const ringKeys = new Set(ringPts.map((p) => keyOf(p[0], p[1])));
	for (let round = 0; round < 8; round++) {
		const border = borderEdges(live, reg);
		const B = new PointIndex();
		for (const p of ringPts) B.add(p);
		for (const [a, b] of border) {
			B.add(a);
			B.add(b);
		}
		const bad = new Set<string>();
		for (const [a, b] of border) {
			const dx = b[0] - a[0];
			const dz = b[1] - a[1];
			const L2 = dx * dx + dz * dz;
			const L = Math.sqrt(L2);
			const lo: Pt = [Math.min(a[0], b[0]) - 1, Math.min(a[1], b[1]) - 1];
			const hi: Pt = [Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1];
			for (const q of B.near(lo, hi)) {
				const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / L2;
				const off = Math.abs((q[0] - a[0]) * dz - (q[1] - a[1]) * dx) / L;
				if (t > 1e-6 && t < 1 - 1e-6 && off < 1) bad.add(`${keyOf(a[0], a[1])}|${keyOf(b[0], b[1])}`);
			}
		}
		if (!bad.size) break;
		live = live.filter((t) => {
			for (let k = 0; k < 3; k++) {
				const a = keyOf(reg.T[t * 6 + k * 2] as number, reg.T[t * 6 + k * 2 + 1] as number);
				const b = keyOf(reg.T[t * 6 + ((k + 1) % 3) * 2] as number, reg.T[t * 6 + ((k + 1) % 3) * 2 + 1] as number);
				if (bad.has(`${a}|${b}`) || bad.has(`${b}|${a}`)) return false;
			}
			return true;
		});
	}
	// (a border corner on the face's edge but not one of its points: a T the other way)
	const E = new SegIndex();
	for (const r of rings(face))
		r.forEach((a, i) => {
			E.add(a, r[(i + 1) % r.length] as Pt);
		});
	const stray = new Set<string>();
	for (const [a, b] of borderEdges(live, reg))
		for (const p of [a, b]) {
			const k = keyOf(p[0], p[1]);
			if (ringKeys.has(k)) continue;
			if (E.near(p, 1).some((i) => toSegment(p, E.a[i] as Pt, E.b[i] as Pt)[0] < 1)) stray.add(k);
		}
	if (stray.size) live = live.filter((t) => ![0, 1, 2].some((k) => stray.has(keyOf(reg.T[t * 6 + k * 2] as number, reg.T[t * 6 + k * 2 + 1] as number))));
	return live;
}

// ---- 4. heights ------------------------------------------------------------------------------------------------

/** For a point, the triangle of a region holding it and its weights there; null where none does. */
function locate(reg: Prepared, x: number, z: number): [number, number, number, number] | null {
	for (const t of reg.cells.get(keyOf(Math.floor(x / reg.cell), Math.floor(z / reg.cell))) ?? []) {
		const T = reg.T;
		const ax = T[t * 6] as number;
		const az = T[t * 6 + 1] as number;
		const e1x = (T[t * 6 + 2] as number) - ax;
		const e1z = (T[t * 6 + 3] as number) - az;
		const e2x = (T[t * 6 + 4] as number) - ax;
		const e2z = (T[t * 6 + 5] as number) - az;
		const qx = x - ax;
		const qz = z - az;
		const det = e1x * e2z - e2x * e1z;
		if (Math.abs(det) <= 1e-14) continue;
		const w1 = (qx * e2z - e2x * qz) / det;
		const w2 = (e1x * qz - qx * e1z) / det;
		if (w1 >= -1e-7 && w2 >= -1e-7 && w1 + w2 <= 1 + 1e-7) return [t, 1 - w1 - w2, w1, w2];
	}
	return null;
}

/** A region's height and mapping at a point: from the triangle holding it, else from its nearest own point. */
function sample(reg: Prepared, x: number, z: number): [number, number, number] {
	const hit = locate(reg, x, z);
	if (hit) {
		const [t, a, b, c] = hit;
		const y = (reg.Y[t * 3] as number) * a + (reg.Y[t * 3 + 1] as number) * b + (reg.Y[t * 3 + 2] as number) * c;
		const UV = reg.UV;
		const u = UV ? (UV[t * 6] as number) * a + (UV[t * 6 + 2] as number) * b + (UV[t * 6 + 4] as number) * c : 0;
		const v = UV ? (UV[t * 6 + 1] as number) * a + (UV[t * 6 + 3] as number) * b + (UV[t * 6 + 5] as number) * c : 0;
		return [y, u, v];
	}
	// (past its triangles: its nearest own point's, from the cells round it out to where none nearer can be; the first of those as near, as a search of them all
	// in order finds)
	let best = 0;
	let bd = Infinity;
	const consider = (i: number) => {
		const d = Math.hypot((reg.T[i * 2] as number) - x, (reg.T[i * 2 + 1] as number) - z);
		if (d < bd || (d === bd && i < best)) {
			bd = d;
			best = i;
		}
	};
	const gx = Math.floor(x / reg.cell);
	const gz = Math.floor(z / reg.cell);
	let found = false;
	for (let k = 0; k <= 8 && !found; k++) {
		for (let ix = gx - k; ix <= gx + k; ix++)
			for (let iz = gz - k; iz <= gz + k; iz++) {
				if (Math.max(Math.abs(ix - gx), Math.abs(iz - gz)) !== k) continue;
				for (const t of reg.cells.get(keyOf(ix, iz)) ?? []) for (let c = 0; c < 3; c++) consider(t * 3 + c);
			}
		// (a point nearer than k cells out is in the rings looked at)
		found = bd <= k * reg.cell;
	}
	if (!found) for (let i = 0; i < reg.n * 3; i++) consider(i);
	return [reg.Y[best] as number, (reg.UV?.[best * 2] as number) ?? 0, (reg.UV?.[best * 2 + 1] as number) ?? 0];
}

// ---- the whole -------------------------------------------------------------------------------------------------

export interface MergeOptions {
	/** what each stage took, as it goes */
	log?: (stage: string, ms: number) => void;
	/** metres a side of the ground's tiles, each filled by itself (default TILE; 0: the ground in one) */
	tile?: number;
	/** what an earlier merge made, kept: its outlines and faces taken again where what they are made from is the same */
	cache?: MergeCache;
	/** what makes the outlines: here, one after another, or on workers */
	outliner?: (Ts: (Float64Array | Int32Array)[]) => Promise<Outline[]>;
	/** each face as noded (its region, its rings, grid units) and as filled, before the heights (for finding what is wrong) */
	inspect?: (faces: { region: string; outer: Pt[]; holes: Pt[][]; filled: Filled }[]) => void;
	/** what it is about to do, region by region (for finding where it sticks) */
	trace?: (what: string) => void;
	/** each region's foot and seen part as worked out, before the noding (for finding what is wrong) */
	seenParts?: (name: string, foot: Poly[], seen: Poly[]) => void;
	/** each ground tile's box and the feet it is cut by, before it is (for finding where it sticks) */
	tileFeet?: (box: Poly, feet: Poly[]) => void;
}

/** A hash of numbers (their 64-bit floats' bytes, FNV-1a twice over): what a face or an outline is made from. */
function hashOf(parts: (Float64Array | Int32Array | number)[]): string {
	let a = 0x811c9dc5;
	let b = 0xcbf29ce4;
	const one = new Float64Array(1);
	for (const p of parts) {
		if (typeof p === "number") one[0] = p;
		const f = typeof p === "number" ? one : p;
		const u = new Uint32Array(f.buffer, f.byteOffset, f.byteLength / 4);
		for (let i = 0; i < u.length; i++) {
			a = Math.imul(a ^ (u[i] as number), 0x01000193) >>> 0;
			b = Math.imul(b ^ (u[i] as number), 0x01000197) >>> 0;
		}
		a = Math.imul(a ^ u.length, 0x01000193) >>> 0;
	}
	return `${a.toString(16)}.${b.toString(16)}`;
}

/** What one merge leaves for the next (a road edited: only the faces it changes filled again). Holds what the last merge used, no more. */
/** A region's triangles as the merge has them (on the grid, filed in cells; their heights, mapping), and its outline's key. */
interface GridKept extends Tris {
	Y: Float64Array;
	UV: Float64Array | null;
	key: string;
}

export class MergeCache {
	private outlines = new Map<string, Outline>();
	private faces = new Map<string, Filled>();
	private nextOutlines = new Map<string, Outline>();
	private nextFaces = new Map<string, Filled>();
	/** of the last merge: faces taken again, and filled */
	kept = 0;
	filled = 0;

	private seens = new Map<string, { foot: Poly[]; seen: Poly[] }>();
	private nextSeens = new Map<string, { foot: Poly[]; seen: Poly[] }>();
	private tiles = new Map<string, Poly[]>();
	private nextTiles = new Map<string, Poly[]>();
	private grids = new Map<string, GridKept>();
	private nextGrids = new Map<string, GridKept>();

	/** A region's triangles on the grid and filed in cells, its outline's key: by its triangles as given. */
	gridKept(key: string): GridKept | undefined {
		return this.grids.get(key);
	}

	gridUsed(key: string, g: GridKept): void {
		this.nextGrids.set(key, g);
	}

	outlineKept(key: string): Outline | undefined {
		return this.outlines.get(key);
	}

	outlineUsed(key: string, o: Outline): void {
		this.nextOutlines.set(key, o);
	}

	/** A road's foot and seen part, by its chain of keys (its outline's and those before it near it). */
	seenKept(key: string) {
		return this.seens.get(key);
	}

	seenUsed(key: string, s: { foot: Poly[]; seen: Poly[] }): void {
		this.nextSeens.set(key, s);
	}

	/** A ground tile's pieces, by its box and the keys of the feet near it. */
	tileKept(key: string): Poly[] | undefined {
		return this.tiles.get(key);
	}

	tileUsed(key: string, p: Poly[]): void {
		this.nextTiles.set(key, p);
	}

	/** A filler that fills only the faces it has not got. */
	wrap(inner: Filler): Filler {
		return async (jobs) => {
			const keys = jobs.map((j) => hashOf([j.outer, ...j.holes, j.holes.length, j.T, j.spacing]));
			const want = keys.map((k, i) => (this.faces.has(k) ? -1 : i)).filter((i) => i >= 0);
			const made = want.length ? await inner(want.map((i) => jobs[i] as FillJob)) : [];
			want.forEach((i, m) => {
				this.faces.set(keys[i] as string, made[m] as Filled);
			});
			this.kept = jobs.length - want.length;
			this.filled = want.length;
			const out = keys.map((k) => this.faces.get(k) as Filled);
			keys.forEach((k, i) => {
				this.nextFaces.set(k, out[i] as Filled);
			});
			return out;
		};
	}

	/** The merge done: what it used kept, the rest let go. */
	done(): void {
		this.outlines = this.nextOutlines;
		this.faces = this.nextFaces;
		this.seens = this.nextSeens;
		this.tiles = this.nextTiles;
		this.grids = this.nextGrids;
		this.nextGrids = new Map();
		this.nextOutlines = new Map();
		this.nextFaces = new Map();
		this.nextSeens = new Map();
		this.nextTiles = new Map();
	}
}

/** metres: a region is cut by those before it whose outlines' boxes come this near its own */
const NEAR = 1;

/** The world less the roads' feet, a tile at a time (tile lines every size units from 0): each tile less the feet near it, not the whole world's ground cut to
 * each. (clipper2-js's RectClip64 fails inside itself: not used) */
function groundTiles(
	feet: Poly[][],
	near: TileIndex<number>,
	W: [number, number, number, number],
	size: number,
	footKeys: string[] = [],
	cache?: MergeCache,
	trace?: (what: string) => void,
	tileFeet?: (box: Poly, feet: Poly[]) => void,
): Poly[] {
	const out: Poly[] = [];
	for (let x = Math.floor(W[0] / size) * size; x < W[2]; x += size)
		for (let z = Math.floor(W[1] / size) * size; z < W[3]; z += size) {
			const b = {
				x0: Math.max(x, W[0]),
				z0: Math.max(z, W[1]),
				x1: Math.min(x + size, W[2]),
				z1: Math.min(z + size, W[3]),
			};
			if (b.x1 <= b.x0 || b.z1 <= b.z0) continue;
			const box: Poly = {
				outer: [
					[b.x0, b.z0],
					[b.x1, b.z0],
					[b.x1, b.z1],
					[b.x0, b.z1],
				],
				holes: [],
			};
			const idx = near.find(b).sort((p, q) => p - q);
			const key = `tile ${b.x0},${b.z0},${b.x1},${b.z1}|${idx.map((j) => footKeys[j]).join("/")}`;
			let pieces = cache?.tileKept(key);
			if (!pieces) {
				trace?.(`ground tile ${b.x0},${b.z0}: ${idx.length} feet`);
				tileFeet?.(
					box,
					idx.flatMap((j) => feet[j] as Poly[]),
				);
				const near = idx.flatMap((j) => feet[j] as Poly[]);
				pieces = near.length ? geosOp("difference", [box], near) : [box];
			}
			cache?.tileUsed(key, pieces);
			out.push(...pieces.map((p) => ({ outer: p.outer, holes: [...p.holes] })));
		}
	return out;
}

/** The surface over the world (x0, z0, x1, z1): each region's mesh, by name. */
export async function merge(regions: Region[], world: Box, filler: Filler, opts: MergeOptions = {}): Promise<Record<string, Mesh>> {
	// (GEOS, for its booleans: loaded once)
	await geosReady();
	let t0 = performance.now();
	const stage = (s: string) => {
		const now = performance.now();
		opts.log?.(s, now - t0);
		t0 = now;
	};
	const W: [number, number, number, number] = [unit(world.x0), unit(world.z0), unit(world.x1), unit(world.z1)];
	const Wpoly: Poly[] = [
		{
			outer: [
				[W[0], W[1]],
				[W[2], W[1]],
				[W[2], W[3]],
				[W[0], W[3]],
			],
			holes: [],
		},
	];
	// 1. outlines, and what of each is seen: each cut by those before it near it (what is over it, as the Python's
	// union of all before it is there), the ground the world less all of them, in tiles (each on the grid, filed in cells: kept from before where its triangles
	// are as they were)
	const keys: string[] = [];
	const prepared: Prepared[] = regions.map((r) => {
		const raw = r.tris ? hashOf(r.uvs ? [r.tris, r.uvs] : [r.tris]) : "";
		let g = raw ? opts.cache?.gridKept(raw) : undefined;
		if (!g) {
			const t = r.tris ? gridTris(r) : { T: new Float64Array(0), Y: new Float64Array(0), UV: null };
			g = { ...trisOf(t.T), Y: t.Y, UV: t.UV, key: r.ground ? "" : hashOf([t.T]) };
		}
		if (raw) opts.cache?.gridUsed(raw, g);
		keys.push(r.ground ? "" : g.key);
		return { r, T: g.T, n: g.n, cells: g.cells, cell: g.cell, Y: g.Y, UV: g.UV, folded: null };
	});
	// (each road's outline: kept from before, else made, all of them at once on the workers if there are)
	const outlines = new Map<string, Outline>();
	const want: number[] = [];
	prepared.forEach((reg, i) => {
		if (reg.r.ground) return;
		const kept = opts.cache?.outlineKept(keys[i] as string);
		if (kept) outlines.set(keys[i] as string, kept);
		else if (!want.some((w) => keys[w] === keys[i])) want.push(i);
	});
	const made = opts.outliner
		? await opts.outliner(want.map((i) => (prepared[i] as Prepared).T))
		: want.map((i) => outlineOf((prepared[i] as Prepared).T, (prepared[i] as Prepared).n));
	want.forEach((i, m) => {
		outlines.set(keys[i] as string, made[m] as Outline);
	});
	for (const k of keys) if (k) opts.cache?.outlineUsed(k, outlines.get(k) as Outline);
	stage(`outlines (${want.length} made)`);
	// (each road's foot and seen part: cut by those before it near it; kept from before when its outline and theirs, all the way back, are as they were: a chain
	// of keys)
	const foot = new Map<string, Poly[]>();
	const seen = new Map<string, Poly[]>();
	const near = new TileIndex<number>(TILE / GRID);
	const feet: Poly[][] = [];
	const footKeys: string[] = [];
	const copy = (ps: Poly[]) => ps.map((p) => ({ outer: p.outer, holes: [...p.holes] }));
	const wKey = W.join(",");
	prepared.forEach((reg, i) => {
		const r = reg.r;
		if (r.ground) {
			foot.set(r.name, Wpoly);
			if (opts.tile === 0) {
				const all = feet.flat();
				seen.set(r.name, all.length ? geosOp("difference", Wpoly, all) : Wpoly);
			} else seen.set(r.name, groundTiles(feet, near, W, (opts.tile ?? TILE) / GRID, footKeys, opts.cache, opts.trace, opts.tileFeet));
			return;
		}
		const outline = outlines.get(keys[i] as string) as Outline;
		reg.folded = outline.folded;
		opts.trace?.(`seen: ${r.name} (${outline.polys.length} polygons${outline.folded ? ", folded" : ""})`);
		let f = geosOp("intersection", outline.polys, Wpoly);
		const box = polysBox(f, NEAR / GRID);
		const idx = near.find(box).sort((a, b) => a - b);
		const key = `${keys[i]}|${wKey}|${idx.map((j) => footKeys[j]).join("/")}`;
		let got = opts.cache?.seenKept(key);
		if (!got) {
			const before = idx.flatMap((j) => feet[j] as Poly[]);
			opts.trace?.(`  the ${before.length} feet before it near it, as one`);
			const covered = before.length ? geosOp("union", before) : null;
			opts.trace?.("  its foot snapped to them");
			if (covered) f = geosOp("intersection", snapTo(f, covered), Wpoly);
			opts.trace?.("  what of it they leave seen");
			got = { foot: f, seen: covered ? geosOp("difference", f, covered) : f };
		}
		opts.cache?.seenUsed(key, got);
		opts.seenParts?.(r.name, got.foot, got.seen);
		foot.set(r.name, got.foot);
		seen.set(r.name, copy(got.seen));
		if (got.foot.length) near.add(polysBox(got.foot, 0), feet.length);
		feet.push(got.foot);
		footKeys.push(hashOf([Float64Array.from(key, (c) => c.charCodeAt(0))]));
	});
	stage("seen parts");
	// 2. the faces' edges noded and cut
	const faces: { poly: Poly; reg: Prepared }[] = [];
	for (const reg of prepared) for (const p of seen.get(reg.r.name) ?? []) faces.push({ poly: p, reg });
	const groundReg0 = prepared.find((p) => p.r.ground);
	node(
		faces.map((f) => f.poly),
		W,
		opts.tile === 0 ? 0 : (opts.tile ?? TILE) / GRID,
		(groundReg0?.r.ground?.spacing ?? STEP) / GRID,
	);
	// (a ring the noding left of no area, a slit (a sliver given a point of the other side's): no hole there, no face; its copy on the other side goes the same
	// way, being the same ring) (and a spike the noding left, out to a point and straight back: both sides have it, so both lose it)
	for (const f of faces) {
		f.poly.outer = unspike(f.poly.outer);
		f.poly.holes = f.poly.holes.map(unspike).filter((h) => h.length >= 3);
	}
	for (const f of faces) f.poly.holes = f.poly.holes.filter((h) => area2(h) !== 0);
	const kept = faces.filter((f) => f.poly.outer.length >= 3 && area2(f.poly.outer) !== 0);
	faces.length = 0;
	faces.push(...kept);
	stage(`edges noded (${faces.length} faces)`);
	// 3. each face filled
	const fillWith = opts.cache ? opts.cache.wrap(filler) : filler;
	const filled = await fillWith(faces.map(({ poly, reg }) => jobOf(poly, reg)));
	opts.inspect?.(
		faces.map(({ poly, reg }, i) => ({
			region: reg.r.name,
			outer: poly.outer,
			holes: poly.holes,
			filled: filled[i] as Filled,
		})),
	);
	const parts = new Map<string, Filled[]>();
	faces.forEach(({ reg }, i) => {
		const l = parts.get(reg.r.name) ?? [];
		l.push(filled[i] as Filled);
		parts.set(reg.r.name, l);
	});
	stage(opts.cache ? `faces filled (${opts.cache.filled}; ${opts.cache.kept} kept)` : "faces filled");
	// 4. heights: a region's own points first, by the order; then every other point (each point by a number of its
	// own: two grid coordinates from the world's middle, exact within HALF of it, past any track; by a string, far slower, in a world bigger)
	const cx = Math.round((W[0] + W[2]) / 2);
	const cz = Math.round((W[1] + W[3]) / 2);
	const numeric = Math.max(W[2] - W[0], W[3] - W[1]) / 2 + PAST_WORLD < HALF;
	const pk: (x: number, z: number) => number | string = numeric ? (x, z) => (x - cx) * 2 * HALF + (z - cz) : keyOf;
	const xyz = new Map<number | string, number>();
	for (const reg of prepared)
		for (let i = 0; i < reg.n * 3; i++) {
			const k = pk(reg.T[i * 2] as number, reg.T[i * 2 + 1] as number);
			if (!xyz.has(k)) xyz.set(k, reg.Y[i] as number);
		}
	const isGridPoint = (x: number) => Number.isInteger(x);
	for (const reg of prepared) {
		if (reg.r.ground) continue;
		for (const f of parts.get(reg.r.name) ?? [])
			for (let i = 0; i < f.P.length; i += 2) {
				const x = f.P[i] as number;
				const z = f.P[i + 1] as number;
				if (!isGridPoint(x) || !isGridPoint(z)) continue;
				const k = pk(x, z);
				if (!xyz.has(k)) xyz.set(k, sample(reg, x, z)[0]);
			}
	}
	// (points no region's own: the first region over each, as high as it is there; by the feet near it)
	const feetAt = new TileIndex<number>(TILE / GRID);
	const footIn = new Map<number, PolyIndex[]>();
	prepared.forEach((reg, i) => {
		const fp = foot.get(reg.r.name);
		if (!reg.r.ground && fp?.length) feetAt.add(polysBox(fp, 1), i);
	});
	for (const reg of prepared) {
		if (!reg.r.ground) continue;
		for (const f of parts.get(reg.r.name) ?? [])
			for (let i = 0; i < f.P.length; i += 2) {
				const x = f.P[i] as number;
				const z = f.P[i + 1] as number;
				const k = pk(x, z);
				if (xyz.has(k)) continue;
				const over = feetAt.find({ x0: x, z0: z, x1: x, z1: z }).sort((a, b) => a - b);
				for (const j of over) {
					const other = prepared[j] as Prepared;
					let fp = footIn.get(j);
					if (!fp) {
						fp = (foot.get(other.r.name) ?? []).map((p) => new PolyIndex(p));
						footIn.set(j, fp);
					}
					if (fp.some((p) => p.pip(x, z) !== "out")) {
						xyz.set(k, sample(other, x, z)[0]);
						break;
					}
				}
			}
	}
	stage("heights of the regions");
	const groundReg = prepared.find((p) => p.r.ground);
	const out: Record<string, Mesh> = {};
	if (groundReg?.r.ground) {
		const g = groundReg.r.ground;
		const edge = new PointIndex();
		const edgeY = new Map<number | string, number>();
		const free: Pt[] = [];
		const seenK = new Set<number | string>();
		for (const f of parts.get(groundReg.r.name) ?? [])
			for (let i = 0; i < f.P.length; i += 2) {
				const p: Pt = [f.P[i] as number, f.P[i + 1] as number];
				const k = pk(p[0], p[1]);
				if (seenK.has(k)) continue;
				seenK.add(k);
				const y = xyz.get(k);
				if (y === undefined) free.push(p);
				else {
					edge.add(p);
					edgeY.set(k, y);
				}
			}
		const R = RAMP / GRID;
		for (const p of free) {
			const x = metres(p[0]);
			const z = metres(p[1]);
			let own = g.height(x, z);
			const onWorld = Math.min(p[0] - W[0], W[2] - p[0], p[1] - W[1], W[3] - p[1]) < 2;
			if (!onWorld) {
				let best: Pt | null = null;
				let bd = Infinity;
				for (const q of edge.near([p[0] - R, p[1] - R], [p[0] + R, p[1] + R])) {
					const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
					if (d < bd) {
						bd = d;
						best = q;
					}
				}
				if (best) {
					const t0_ = Math.min(Math.max((bd * GRID) / RAMP, 0), 1);
					const t = t0_ * t0_ * (3 - 2 * t0_);
					const Ey = edgeY.get(pk(best[0], best[1])) as number;
					own += (Ey - g.height(metres(best[0]), metres(best[1]))) * (1 - t);
				}
			}
			xyz.set(pk(p[0], p[1]), own);
		}
	}
	stage("heights of the ground");
	// 5. points closer than WELD made one (a face filled with an edge of a hair's width has no normal of its own, the
	// game's shading goes wrong round it): each pair at an edge's ends, every region's the same (by the grid point), the one on the world's edge kept, else the
	// first; a face two of whose corners are then one, gone
	const rep = new Map<number | string, number | string>();
	const pointOf = new Map<number | string, [number, number]>();
	const find = (k: number | string): number | string => {
		let r = k;
		for (let n = rep.get(r); n !== undefined && n !== r; n = rep.get(r)) r = n;
		if (r !== k) rep.set(k, r);
		return r;
	};
	const onWorld = (x: number, z: number) => x === W[0] || x === W[2] || z === W[1] || z === W[3];
	const before = (a: number | string, b: number | string) => {
		const [ax, az] = pointOf.get(a) as [number, number];
		const [bx, bz] = pointOf.get(b) as [number, number];
		const wa = onWorld(ax, az);
		const wb = onWorld(bx, bz);
		return wa !== wb ? wa : ax !== bx ? ax < bx : az < bz;
	};
	for (const fs of parts.values())
		for (const f of fs)
			for (let i = 0; i < f.F.length; i += 3)
				for (let e = 0; e < 3; e++) {
					const a = f.F[i + e] as number;
					const b = f.F[i + ((e + 1) % 3)] as number;
					const dx = (f.P[a * 2] as number) - (f.P[b * 2] as number);
					const dz = (f.P[a * 2 + 1] as number) - (f.P[b * 2 + 1] as number);
					if (dx * dx + dz * dz >= WELD_U * WELD_U) continue;
					const pa: [number, number] = [f.P[a * 2] as number, f.P[a * 2 + 1] as number];
					const pb: [number, number] = [f.P[b * 2] as number, f.P[b * 2 + 1] as number];
					const ka = pk(pa[0], pa[1]);
					const kb = pk(pb[0], pb[1]);
					pointOf.set(ka, pa);
					pointOf.set(kb, pb);
					const ra = find(ka);
					const rb = find(kb);
					if (ra === rb) continue;
					if (before(ra, rb)) rep.set(rb, ra);
					else rep.set(ra, rb);
				}
	// (the points made one, each by the one it is now)
	const welds = new Set<number | string>();
	for (const k of rep.keys()) {
		welds.add(k);
		welds.add(find(k));
	}
	const welded = (gx: number, gz: number): [number, number] => {
		if (!rep.size) return [gx, gz];
		const k = pk(gx, gz);
		return rep.has(k) ? (pointOf.get(find(k)) as [number, number]) : [gx, gz];
	};
	for (const reg of prepared) {
		const fs = parts.get(reg.r.name);
		if (!fs?.length) continue;
		const P: number[] = [];
		const UV: number[] = [];
		const F: number[] = [];
		for (const f of fs) {
			const at: (number | string)[] = [];
			// (each point's index in the mesh: one made one with another of the part's, that one's)
			const idx: number[] = [];
			const local = new Map<number | string, number>();
			for (let i = 0; i < f.P.length; i += 2) {
				const [gx, gz] = welded(f.P[i] as number, f.P[i + 1] as number);
				const k = pk(gx, gz);
				at.push(k);
				if (welds.has(k)) {
					const had = local.get(k);
					if (had !== undefined) {
						idx.push(had);
						continue;
					}
					local.set(k, P.length / 3);
				}
				idx.push(P.length / 3);
				const x = metres(gx);
				const z = metres(gz);
				let y = xyz.get(k);
				let uv: [number, number];
				if (reg.r.ground) {
					y ??= reg.r.ground.height(x, z);
					uv = reg.r.ground.uv(x, z);
				} else {
					const s = sample(reg, gx, gz);
					y ??= s[0];
					uv = [s[1], s[2]];
				}
				P.push(x, y, z);
				UV.push(...uv);
			}
			for (let i = 0; i < f.F.length; i += 3) {
				const [ka, kb, kc] = [at[f.F[i] as number], at[f.F[i + 1] as number], at[f.F[i + 2] as number]];
				if (ka === kb || kb === kc || kc === ka) continue;
				const a = idx[f.F[i] as number] as number;
				const b = idx[f.F[i + 1] as number] as number;
				const c = idx[f.F[i + 2] as number] as number;
				// (facing up)
				const up =
					((P[b * 3] as number) - (P[a * 3] as number)) * ((P[c * 3 + 2] as number) - (P[a * 3 + 2] as number)) -
					((P[c * 3] as number) - (P[a * 3] as number)) * ((P[b * 3 + 2] as number) - (P[a * 3 + 2] as number));
				if (up > 0) F.push(c, b, a);
				else F.push(a, b, c);
			}
		}
		out[reg.r.name] = { P: Float64Array.from(P), UV: Float64Array.from(UV), F: Int32Array.from(F) };
	}
	stage("meshes");
	opts.cache?.done();
	return out;
}

// ---- the proof ---------------------------------------------------------------------------------------------------

export interface Issue {
	what: string;
	x: number;
	z: number;
	much: number;
}

/** The surface proved: every edge of two faces (but on the world's edge), one height a point, the world covered once. */
export function check(meshes: Record<string, Mesh>, world: Box): Issue[] {
	// (each point by a number of its own, as the merge's heights have them; each edge by its two points' numbers in one, the edges sorted and counted: no string
	// a point or edge, millions of them over a whole map)
	const W = [unit(world.x0), unit(world.z0), unit(world.x1), unit(world.z1)] as const;
	const cx = Math.round((W[0] + W[2]) / 2);
	const cz = Math.round((W[1] + W[3]) / 2);
	const numeric = Math.max(W[2] - W[0], W[3] - W[1]) / 2 + PAST_WORLD < HALF;
	const pk: (x: number, z: number) => number | string = numeric ? (x, z) => (x - cx) * 2 * HALF + (z - cz) : keyOf;
	const id = new Map<number | string, number>();
	const lo: number[] = [];
	const hi: number[] = [];
	const X: number[] = [];
	const Z: number[] = [];
	const issues: Issue[] = [];
	let nEdges = 0;
	for (const m of Object.values(meshes)) nEdges += m.F.length;
	const edges = new Float64Array(nEdges);
	let ne = 0;
	let total = 0;
	for (const m of Object.values(meshes)) {
		const ids = new Int32Array(m.P.length / 3);
		for (let i = 0; i < m.P.length; i += 3) {
			const x = m.P[i] as number;
			const y = m.P[i + 1] as number;
			const z = m.P[i + 2] as number;
			const k = pk(unit(x), unit(z));
			let j = id.get(k);
			if (j === undefined) {
				j = lo.length;
				id.set(k, j);
				lo.push(y);
				hi.push(y);
				X.push(x);
				Z.push(z);
			} else {
				if (y < (lo[j] as number)) lo[j] = y;
				if (y > (hi[j] as number)) hi[j] = y;
			}
			ids[i / 3] = j;
		}
		for (let f = 0; f < m.F.length; f += 3) {
			const va = m.F[f] as number;
			const vb = m.F[f + 1] as number;
			const vc = m.F[f + 2] as number;
			const g = [ids[va] as number, ids[vb] as number, ids[vc] as number];
			for (let k = 0; k < 3; k++) {
				const a = g[k] as number;
				const b = g[(k + 1) % 3] as number;
				edges[ne++] = a < b ? a * EDGE_KEY + b : b * EDGE_KEY + a;
			}
			const ax = m.P[va * 3] as number;
			const az = m.P[va * 3 + 2] as number;
			total +=
				Math.abs(((m.P[vb * 3] as number) - ax) * ((m.P[vc * 3 + 2] as number) - az) - ((m.P[vc * 3] as number) - ax) * ((m.P[vb * 3 + 2] as number) - az)) / 2;
		}
	}
	for (let j = 0; j < lo.length; j++)
		if ((hi[j] as number) - (lo[j] as number) > 1e-6)
			issues.push({
				what: "heights differ",
				x: X[j] as number,
				z: Z[j] as number,
				much: (hi[j] as number) - (lo[j] as number),
			});
	const onWorld = (x: number, z: number) =>
		Math.min(Math.abs(x - world.x0), Math.abs(x - world.x1), Math.abs(z - world.z0), Math.abs(z - world.z1)) < GRID * 10;
	if (lo.length >= EDGE_KEY) throw new Error(`the proof takes ${EDGE_KEY} points at most: ${lo.length} given`);
	edges.sort();
	for (let i = 0; i < edges.length; ) {
		let j = i + 1;
		while (j < edges.length && edges[j] === edges[i]) j++;
		const n = j - i;
		if (n !== 2) {
			const e = edges[i] as number;
			const a = Math.floor(e / EDGE_KEY);
			const b = e - a * EDGE_KEY;
			const mx = ((X[a] as number) + (X[b] as number)) / 2;
			const mz = ((Z[a] as number) + (Z[b] as number)) / 2;
			if (!(n === 1 && onWorld(mx, mz)))
				issues.push({
					what: n === 1 ? "open edge" : `edge of ${n} faces`,
					x: mx,
					z: mz,
					much: Math.hypot((X[a] as number) - (X[b] as number), (Z[a] as number) - (Z[b] as number)),
				});
		}
		i = j;
	}
	const want = (world.x1 - world.x0) * (world.z1 - world.z0);
	if (Math.abs(total - want) > Math.max(1e-3, want * 1e-6))
		issues.push({ what: "cover", x: (world.x0 + world.x1) / 2, z: (world.z0 + world.z1) / 2, much: total - want });
	return issues;
}
