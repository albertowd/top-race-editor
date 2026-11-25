// Polygons' unions, intersections and differences by GEOS (geos-wasm: the C library under the track's shapely), on the merge's grid: each result then put on
// the grid as the Python's set_precision(GRID) puts it (whole numbers of the grid, valid, what is thinner than it collapsed). Robust where clipper2-js is not:
// its booleans never end on some overlapping shapes (the Velopark's paddock). GEOS is loaded once where the engine runs (geosReady), then used at once (its
// calls are not awaited).

import initGeosJs from "geos-wasm";
import type { Poly, Pt } from "./merge";

type Geos = Awaited<ReturnType<typeof initGeosJs>>;

let geos: Geos | null = null;
let loading: Promise<Geos> | null = null;

/** GEOS, loaded (once). */
export function geosReady(): Promise<Geos> {
	loading ??= initGeosJs().then((g) => {
		geos = g;
		return g;
	});
	return loading;
}

const ready = (): Geos => {
	if (!geos) throw new Error("GEOS is not loaded: await geosReady() first");
	return geos;
};

/** twice a ring's area, anticlockwise positive */
const area2 = (r: Pt[]) => {
	let s = 0;
	for (let i = 0; i < r.length; i++) {
		const a = r[i] as Pt;
		const b = r[(i + 1) % r.length] as Pt;
		s += a[0] * b[1] - b[0] * a[1];
	}
	return s;
};

/** A ring as GEOS's (closed). */
function ringOf(g: Geos, r: Pt[]): number {
	const n = r.length + 1;
	const buf = g.Module._malloc(n * 16);
	const f = new Float64Array(g.Module.HEAPF64.buffer, buf, n * 2);
	r.forEach(([x, z], i) => {
		f[i * 2] = x;
		f[i * 2 + 1] = z;
	});
	f[r.length * 2] = (r[0] as Pt)[0];
	f[r.length * 2 + 1] = (r[0] as Pt)[1];
	const seq = g.GEOSCoordSeq_copyFromBuffer(buf, n, 0, 0);
	g.Module._free(buf);
	return g.GEOSGeom_createLinearRing(seq);
}

/** Polygons as one GEOS geometry (a collection of them), each first through fix where given (made valid). */
function geomOf(g: Geos, polys: Poly[], fix?: (p: number) => number): number {
	const parts: number[] = [];
	for (const p of polys) {
		if (p.outer.length < 3) continue;
		const shell = ringOf(g, p.outer);
		const holes = p.holes.filter((h) => h.length >= 3).map((h) => ringOf(g, h));
		const hp = g.Module._malloc(Math.max(1, holes.length) * 4);
		holes.forEach((h, i) => {
			g.Module.HEAP32[(hp >> 2) + i] = h;
		});
		const poly = g.GEOSGeom_createPolygon(shell, hp, holes.length);
		if (fix) {
			// (a fixed one is a new geometry: the collection holds it, the one it was made from let go)
			const fixed = fix(poly);
			g.GEOSGeom_destroy(poly);
			if (!fixed) throw new Error("GEOS: a polygon could not be made valid");
			parts.push(fixed);
		} else parts.push(poly);
		g.Module._free(hp);
	}
	const ptr = g.Module._malloc(Math.max(1, parts.length) * 4);
	parts.forEach((p, i) => {
		g.Module.HEAP32[(ptr >> 2) + i] = p;
	});
	// (7: a collection: its polygons may overlap, made one by a union before any other use)
	const out = g.GEOSGeom_createCollection(7, ptr, parts.length);
	g.Module._free(ptr);
	return out;
}

/** A GEOS ring's points (its last, the first again, left out): on the grid (whole numbers), or as they are. */
function pointsOf(g: Geos, ring: number, round = true): Pt[] {
	const seq = g.GEOSGeom_getCoordSeq(ring);
	const sp = g.Module._malloc(4);
	g.GEOSCoordSeq_getSize(seq, sp);
	const n = g.Module.getValue(sp, "i32");
	g.Module._free(sp);
	if (n < 4) return [];
	const buf = g.Module._malloc(n * 16);
	g.GEOSCoordSeq_copyToBuffer(seq, buf, 0, 0);
	const f = new Float64Array(g.Module.HEAPF64.buffer, buf, n * 2);
	const out: Pt[] = [];
	for (let i = 0; i < n - 1; i++)
		out.push(round ? [Math.round(f[i * 2] as number), Math.round(f[i * 2 + 1] as number)] : [f[i * 2] as number, f[i * 2 + 1] as number]);
	g.Module._free(buf);
	return out;
}

/** A GEOS polygon's holes, clockwise (on the grid, or as they are), those with no area left out. */
function holesOf(g: Geos, geom: number, round: boolean): Pt[][] {
	const holes: Pt[][] = [];
	const nh = g.GEOSGetNumInteriorRings(geom);
	for (let i = 0; i < nh; i++) {
		const h = pointsOf(g, g.GEOSGetInteriorRingN(geom, i), round);
		if (h.length < 3 || area2(h) === 0) continue;
		if (area2(h) > 0) h.reverse();
		holes.push(h);
	}
	return holes;
}

/** A GEOS geometry's polygons: outer rings anticlockwise, holes clockwise (on the grid, or as they are). */
function polysOfGeom(g: Geos, geom: number, out: Poly[] = [], round = true): Poly[] {
	const type = g.GEOSGeomTypeId(geom);
	if (type === 3) {
		const outer = pointsOf(g, g.GEOSGetExteriorRing(geom), round);
		if (outer.length < 3 || area2(outer) === 0) return out;
		if (area2(outer) < 0) outer.reverse();
		out.push({ outer, holes: holesOf(g, geom, round) });
	} else if (type === 6 || type === 7) {
		const n = g.GEOSGetNumGeometries(geom);
		for (let i = 0; i < n; i++) polysOfGeom(g, g.GEOSGetGeometryN(geom, i), out, round);
	}
	return out;
}

export type GeosOp = "union" | "intersection" | "difference";

/** a with b by op, a new GEOS geometry (or none where it failed) */
function binaryOp(g: Geos, op: GeosOp, a: number, b: number): number {
	if (op === "union") return g.GEOSUnion(a, b);
	if (op === "intersection") return g.GEOSIntersection(a, b);
	return g.GEOSDifference(a, b);
}

/** a, made one, then with b (made one) by op; on the grid (whole numbers), as polygons. */
export function geosOp(op: GeosOp, a: Poly[], b: Poly[] | null = null): Poly[] {
	const g = ready();
	const made: number[] = [];
	const keep = (x: number) => {
		if (!x) throw new Error(`GEOS: the ${op} failed`);
		made.push(x);
		return x;
	};
	try {
		// (each polygon made valid first, as the Python's buffer(0) makes one: of a ring crossing itself, the area its way round encloses (a loop the other way
		// round, none); then all made one)
		const one = (ps: Poly[]) => keep(g.GEOSUnaryUnion(keep(geomOf(g, ps, (p) => g.GEOSBuffer(p, 0, 8)))));
		const A = one(a);
		let R: number;
		if (b === null) R = A;
		else {
			const B = one(b);
			R = keep(binaryOp(g, op, A, B));
		}
		// (then on the grid, as the Python's set_precision(GRID) puts it: whole numbers, valid, what is thinner than the grid (a channel a unit wide between two
		// edges almost meeting) collapsed)
		return polysOfGeom(g, keep(g.GEOSGeom_setPrecision(R, 1, 0)));
	} finally {
		for (const x of made) g.GEOSGeom_destroy(x);
	}
}

/** The union of triangles (six numbers each: three corners x, z, grid units), on the grid, as polygons. */
export function geosTriangles(T: ArrayLike<number>, n: number): Poly[] {
	const tris: Poly[] = [];
	for (let t = 0; t < n; t++) {
		const r: Pt[] = [
			[T[t * 6] as number, T[t * 6 + 1] as number],
			[T[t * 6 + 2] as number, T[t * 6 + 3] as number],
			[T[t * 6 + 4] as number, T[t * 6 + 5] as number],
		];
		const a = area2(r);
		if (a === 0) continue;
		if (a < 0) r.reverse();
		tris.push({ outer: r, holes: [] });
	}
	return geosOp("union", tris);
}

// ---- the paint: lines widened and made one ------------------------------------------------------------------------

/** a line's corner sharper than this many times its half width cut square (GEOS's mitre limit) */
const MITRE_LIMIT = 5;
/** how many times a cell is cut in four, at most, to leave no piece of it with a hole */
const CELL_SPLITS = 4;

/** Paint to lay along lines (metres): its colour, half its width, its lines (each its points; closed: a ring). */
export interface PaintStroke {
	colour: string;
	half: number;
	lines: { points: Pt[]; closed: boolean }[];
	/** seams with paint of another kind: what each cuts off (a ring) */
	cuts?: Pt[][];
}

/** One shape of paint: the strokes it is made of (their places in the list), and its pieces (rings, metres, anticlockwise; none with a hole), no piece bigger
 * than a cell. */
export interface PaintShape {
	strokes: number[];
	pieces: Pt[][];
}

type Box4 = [number, number, number, number];

/** A line as GEOS's (closed: its first point again at its end, a ring: GEOS widens it both sides, no ends). */
function lineOf(g: Geos, pts: Pt[], closed: boolean): number {
	const all = closed ? [...pts, pts[0] as Pt] : pts;
	const buf = g.Module._malloc(all.length * 16);
	const f = new Float64Array(g.Module.HEAPF64.buffer, buf, all.length * 2);
	all.forEach(([x, z], i) => {
		f[i * 2] = x;
		f[i * 2 + 1] = z;
	});
	const seq = g.GEOSCoordSeq_copyFromBuffer(buf, all.length, 0, 0);
	g.Module._free(buf);
	return g.GEOSGeom_createLineString(seq);
}

/** Geometries as one GEOS collection (it owns them after). */
function collectionOf(g: Geos, parts: number[]): number {
	const ptr = g.Module._malloc(Math.max(1, parts.length) * 4);
	parts.forEach((p, i) => {
		g.Module.HEAP32[(ptr >> 2) + i] = p;
	});
	const out = g.GEOSGeom_createCollection(7, ptr, parts.length);
	g.Module._free(ptr);
	return out;
}

/** A stroke's box: its points', grown by half its width. */
function strokeBox(st: PaintStroke): Box4 {
	const b: Box4 = [Infinity, Infinity, -Infinity, -Infinity];
	for (const l of st.lines)
		for (const [x, z] of l.points) {
			b[0] = Math.min(b[0], x - st.half);
			b[1] = Math.min(b[1], z - st.half);
			b[2] = Math.max(b[2], x + st.half);
			b[3] = Math.max(b[3], z + st.half);
		}
	return b;
}

const boxesMeet = (a: Box4, b: Box4) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** What a geometry made is handed to: kept to be let go at the end (none made: the step named failed). */
type Keep = (x: number, what: string) => number;

/** A stroke's paint: its lines widened and made one, then (where it meets paint of another kind end to end) only its side of each seam; none: null. */
function strokePaint(g: Geos, st: PaintStroke, keep: Keep): number | null {
	const parts: number[] = [];
	for (const l of st.lines) {
		if (l.points.length < 2) continue;
		const line = lineOf(g, l.points, l.closed && l.points.length > 2);
		const wide = g.GEOSBufferWithStyle(line, st.half, 8, 2, 2, MITRE_LIMIT);
		g.GEOSGeom_destroy(line);
		if (wide) parts.push(wide);
	}
	let one = parts.length ? keep(g.GEOSUnaryUnion(keep(collectionOf(g, parts), "collection")), "union") : null;
	for (const cut of st.cuts ?? []) {
		if (!one) break;
		const off = keep(g.GEOSGeom_createPolygon(ringOf(g, cut), 0, 0), "seam");
		one = keep(g.GEOSDifference(one, off), "seam");
		if (g.GEOSisEmpty(one) === 1) one = null;
	}
	return one;
}

/** Each stroke's paint under a later stroke of another colour cut away (none left: null). */
function cutUnder(g: Geos, geo: (number | null)[], colour: (i: number) => string, meets: (a: number, b: number) => boolean, keep: Keep): void {
	for (let a = 0; a < geo.length; a++)
		for (let b = a + 1; b < geo.length && geo[a]; b++) {
			if (!geo[b] || colour(b) === colour(a) || !meets(a, b)) continue;
			geo[a] = keep(g.GEOSDifference(geo[a] as number, geo[b] as number), "difference");
			if (g.GEOSisEmpty(geo[a] as number) === 1) geo[a] = null;
		}
}

/** The strokes with paint grouped, each colour's that meet one group (its first stroke's place, its strokes in order). */
function strokeGroups(geo: (number | null)[], colour: (i: number) => string, meets: (a: number, b: number) => boolean): Map<number, number[]> {
	const root = geo.map((_, i) => i);
	const find = (i: number): number => {
		let r = i;
		while (root[r] !== r) r = root[r] as number;
		return r;
	};
	for (let a = 0; a < geo.length; a++)
		for (let b = a + 1; b < geo.length; b++) {
			if (!geo[a] || !geo[b] || colour(a) !== colour(b)) continue;
			if (find(a) !== find(b) && meets(a, b)) root[find(b)] = find(a);
		}
	const groups = new Map<number, number[]>();
	geo.forEach((_, i) => {
		if (!geo[i]) return;
		const r = find(i);
		groups.set(r, [...(groups.get(r) ?? []), i]);
	});
	return groups;
}

/** A group's shape: its one stroke's paint, or (more than one) their union, of copies of them (the collection owns what it holds). */
function groupShape(g: Geos, members: number[], geo: (number | null)[], keep: Keep): number {
	if (members.length === 1) return geo[members[0] as number] as number;
	return keep(
		g.GEOSUnaryUnion(
			keep(
				collectionOf(
					g,
					members.map((i) => g.GEOSGeom_clone(geo[i] as number)),
				),
				"collection",
			),
		),
		"union",
	);
}

/** The box round strokes' boxes. */
function membersBox(members: number[], boxes: Box4[]): Box4 {
	const box: Box4 = [Infinity, Infinity, -Infinity, -Infinity];
	for (const i of members) {
		const b = boxes[i] as Box4;
		box[0] = Math.min(box[0], b[0]);
		box[1] = Math.min(box[1], b[1]);
		box[2] = Math.max(box[2], b[2]);
		box[3] = Math.max(box[3], b[3]);
	}
	return box;
}

/** A shape being cut on the grid of cells: GEOS, the cells' size and the pieces cut so far. */
interface Cutting {
	g: Geos;
	cell: number;
	pieces: Pt[][];
}

/** A cell's piece of a shape: its polygons; one with a hole, the cell cut in four again (CELL_SPLITS times at most). */
function cutCell(c: Cutting, geom: number, cx: number, cz: number, size: number, depth: number): void {
	const { g } = c;
	const part = g.GEOSClipByRect(geom, cx, cz, cx + size, cz + size);
	if (!part) return;
	try {
		if (g.GEOSisEmpty(part) === 1) return;
		const polys = polysOfGeom(g, part, [], false);
		if (polys.some((p) => p.holes.length) && depth < CELL_SPLITS) {
			const h = size / 2;
			for (const [dx, dz] of [
				[0, 0],
				[h, 0],
				[0, h],
				[h, h],
			] as const)
				cutCell(c, part, cx + dx, cz + dz, h, depth + 1);
			return;
		}
		for (const p of polys) c.pieces.push(p.outer);
	} finally {
		g.GEOSGeom_destroy(part);
	}
}

/** A part of a shape's box (ni by nj cells from cell i0, j0) cut in two again and again, the halves of whole cells, till each part is a cell: each cut only of
 * what is in the part it halves. */
function halveCells(c: Cutting, geom: number, i0: number, j0: number, ni: number, nj: number): void {
	const { g, cell } = c;
	if (ni <= 1 && nj <= 1) {
		cutCell(c, geom, i0 * cell, j0 * cell, cell, 0);
		return;
	}
	const across = ni >= nj;
	const h = Math.floor((across ? ni : nj) / 2);
	for (const [a, n] of [
		[0, h],
		[h, (across ? ni : nj) - h],
	] as const) {
		const [ia, ja, na, ma] = across ? [i0 + a, j0, n, nj] : [i0, j0 + a, ni, n];
		const part = g.GEOSClipByRect(geom, ia * cell, ja * cell, (ia + na) * cell, (ja + ma) * cell);
		if (!part) continue;
		try {
			if (g.GEOSisEmpty(part) !== 1) halveCells(c, part, ia, ja, na, ma);
		} finally {
			g.GEOSGeom_destroy(part);
		}
	}
}

/** A shape's pieces on a grid of cells cell metres square, its box's. */
function shapePieces(g: Geos, shape: number, box: Box4, cell: number): Pt[][] {
	const c: Cutting = { g, cell, pieces: [] };
	const i0 = Math.floor(box[0] / cell);
	const j0 = Math.floor(box[1] / cell);
	halveCells(c, shape, i0, j0, Math.max(1, Math.ceil(box[2] / cell) - i0), Math.max(1, Math.ceil(box[3] / cell) - j0));
	return c.pieces;
}

/** The paint laid along lines: each stroke's lines widened (flat ends, corners mitred), a stroke's paint under any later stroke of another colour over it cut
 * away (the later on top), then each colour's strokes that meet made one shape (where they overlap, one paint); each shape cut on a grid of cells cell metres
 * square (its pieces each on the ground under it), a piece with a hole cut smaller. The shapes in the order of their first stroke. */
export function geosPaint(strokes: PaintStroke[], cell: number): PaintShape[] {
	const g = ready();
	const made: number[] = [];
	const keep = (x: number, what: string) => {
		if (!x) throw new Error(`GEOS: the paint's ${what} failed`);
		made.push(x);
		return x;
	};
	try {
		// (each stroke's paint, and its box)
		const geo: (number | null)[] = [];
		const boxes = strokes.map(strokeBox);
		for (const st of strokes) geo.push(strokePaint(g, st, keep));
		const meets = (a: number, b: number) => boxesMeet(boxes[a] as Box4, boxes[b] as Box4) && g.GEOSIntersects(geo[a] as number, geo[b] as number) === 1;
		const colour = (i: number) => (strokes[i] as PaintStroke).colour;
		cutUnder(g, geo, colour, meets, keep);
		const out: PaintShape[] = [];
		for (const members of strokeGroups(geo, colour, meets).values()) {
			const shape = groupShape(g, members, geo, keep);
			out.push({ strokes: members, pieces: shapePieces(g, shape, membersBox(members, boxes), cell) });
		}
		return out.sort((a, b) => Math.min(...a.strokes) - Math.min(...b.strokes));
	} finally {
		for (const x of made) g.GEOSGeom_destroy(x);
	}
}
