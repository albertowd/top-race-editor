import type { ContextItem, SurfaceRegion } from "../api/types";
import type { Box, Vec2 } from "../domain/types";
import { emptyBox, grow } from "../geometry/samples";
import type { RoadShapes } from "../geometry/shapes";

// Shapes as Path2D for the canvas, in metres, gathered in cells so only those in view are drawn.

export function pathOf(pts: readonly Vec2[], close = false, into = new Path2D()): Path2D {
	pts.forEach(([x, z], i) => {
		if (i) into.lineTo(x, z);
		else into.moveTo(x, z);
	});
	if (close) into.closePath();
	return into;
}

export interface Cell {
	kind: string;
	path: Path2D;
	box: Box;
}

/** Shapes gathered in cells of size metres (each cell one Path2D a kind). */
export class Cells {
	private readonly m = new Map<string, Cell>();
	constructor(private readonly size: number) {}

	at(kind: string, x: number, z: number): Cell {
		const key = `${kind}:${Math.floor(x / this.size)}:${Math.floor(z / this.size)}`;
		let c = this.m.get(key);
		if (!c) {
			c = { kind, path: new Path2D(), box: emptyBox() };
			this.m.set(key, c);
		}
		return c;
	}

	/** A mesh's faces (points x z ..., faces a b c ...), each into the cell of its first point. */
	addFaces(kind: string, P: ArrayLike<number>, F: ArrayLike<number>): void {
		for (let f = 0; f < F.length; f += 3) {
			const a = F[f] * 2;
			const b = F[f + 1] * 2;
			const d = F[f + 2] * 2;
			const cell = this.at(kind, P[a], P[a + 1]);
			cell.path.moveTo(P[a], P[a + 1]);
			cell.path.lineTo(P[b], P[b + 1]);
			cell.path.lineTo(P[d], P[d + 1]);
			cell.path.closePath();
			grow(cell.box, P[a], P[a + 1]);
			grow(cell.box, P[b], P[b + 1]);
			grow(cell.box, P[d], P[d + 1]);
		}
	}

	list(): Cell[] {
		return [...this.m.values()];
	}
}

/** The track as its models have it now (but the roads described: drawn as edited), in cells of 50 m. */
export function contextCells(items: readonly ContextItem[], described: ReadonlySet<string>): Cell[] {
	const cs = new Cells(50);
	for (const it of items) {
		if (described.has(it.name)) continue;
		for (const L of it.lines ?? []) {
			for (let i0 = 0; i0 < L.length - 2; i0 += 126) {
				// (in pieces of 64 points)
				const end = Math.min(L.length, i0 + 128);
				const c = cs.at(it.kind, L[i0], L[i0 + 1]);
				c.path.moveTo(L[i0], L[i0 + 1]);
				for (let i = i0; i < end; i += 2) {
					c.path.lineTo(L[i], L[i + 1]);
					grow(c.box, L[i], L[i + 1]);
				}
			}
		}
		const R = it.rings ?? [];
		for (let i = 0; i < R.length; i += 3) {
			const c = cs.at(it.kind, R[i], R[i + 1]);
			c.path.moveTo(R[i] + R[i + 2], R[i + 1]);
			c.path.arc(R[i], R[i + 1], R[i + 2], 0, Math.PI * 2);
			grow(c.box, R[i], R[i + 1], R[i + 2]);
		}
	}
	return cs.list();
}

export function surfaceCells(regions: readonly SurfaceRegion[]): Cell[] {
	const cs = new Cells(10);
	for (const r of regions) cs.addFaces(r.kind, r.P, r.F);
	return cs.list();
}

export function wireCells(P: ArrayLike<number>, F: ArrayLike<number>): Cell[] {
	const cs = new Cells(10);
	cs.addFaces("w", P, F);
	return cs.list();
}

export interface RoadPaths {
	outline: Path2D;
	sides: Path2D;
	mid: Path2D;
	white: Path2D;
	yellow: Path2D;
	kerbs: [string, Path2D][];
}

const roadPathCache = new WeakMap<RoadShapes, RoadPaths>();

export function roadPaths(sh: RoadShapes): RoadPaths {
	let p = roadPathCache.get(sh);
	if (!p) {
		const sides = new Path2D();
		for (const s of sh.sides) pathOf(s, false, sides);
		const many = (list: Vec2[][]) => {
			const out = new Path2D();
			for (const pts of list) pathOf(pts, true, out);
			return out;
		};
		p = {
			outline: pathOf(sh.outline, true),
			sides,
			mid: pathOf(sh.mid),
			white: many(sh.white),
			yellow: many(sh.yellow),
			kerbs: [...sh.kerbs].map(([col, list]) => [col, many(list)]),
		};
		roadPathCache.set(sh, p);
	}
	return p;
}
