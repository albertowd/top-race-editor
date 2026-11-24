import { MARK_PX } from "../domain/constants";
import type { Layers, Road, Selection, Vec2 } from "../domain/types";
import { kerbPieces, lineOffsets, type Offset, pieceOffsets } from "../geometry/paint";
import { type AlongHandle, alongHandles, geo, type Lookup } from "../geometry/roads";
import { inBox, nearestOn, pointAt, type Samples, span } from "../geometry/samples";
import { type EndHandle, endHandles, type NodeHandle, nodeHandles } from "./handles";

export interface ItemHit {
	kind: "item";
	which: "line" | "kerb";
	road: number;
	idx: number;
	s: number;
}
export interface RoadHit {
	kind: "road";
	road: number;
	s: number;
}
export type HandleHit = (NodeHandle | EndHandle | AlongHandle) & { road: number };
export type Hit = ItemHit | RoadHit | HandleHit;

export interface HitContext {
	roads: readonly Road[];
	find: Lookup;
	sel: Selection;
	layers: Pick<Layers, "lines" | "kerbs">;
	/** the roads can be picked (default: yes) */
	pickRoads?: boolean;
	/** the selected road's shape can be changed: its nodes, handles, widths, a run-off's ends (default: yes) */
	shape?: boolean;
	ppm: number;
	toScreen: (x: number, z: number) => Vec2;
}

/** The line or rumble under (wx, wz), of any road, within a few pixels; the selected one first. */
export function itemAt(c: HitContext, wx: number, wz: number): ItemHit | null {
	const tol = Math.max(0.05, 4 / c.ppm);
	let best: (ItemHit & { score: number }) | null = null;
	if (!c.layers.lines && !c.layers.kerbs) return null;
	c.roads.forEach((r, i) => {
		const o = geo(r, c.find);
		if (!o || r.along) return;
		if (!inBox(o.box, wx, wz, 2) && !(r.kerbs ?? []).some((k) => k.before || k.after)) return;
		const consider = (which: "line" | "kerb", idx: number, oo: Samples, s0: number, s1: number, f: { a: Offset; b: Offset }) => {
			const near = nearestOn(oo, wx, wz);
			const q = pointAt(oo, near.s);
			const off = (wx - q.x) * q.nx + (wz - q.z) * q.nz;
			if (near.s < s0 - tol || near.s > s1 + tol) return;
			const a = f.a(q, near.s);
			const b = f.b(q, near.s);
			if (off < Math.min(a, b) - tol || off > Math.max(a, b) + tol) return;
			const chosen = i === c.sel.r && (which === "line" ? c.sel.line : c.sel.kerb) === idx;
			// (the selected one first; a line over a rumble)
			const score = Math.abs(off - (a + b) / 2) + (which === "line" ? 0 : 0.01) - (chosen ? 100 : 0);
			if (!best || score < best.score) best = { kind: "item", which, road: i, idx, s: near.s, score };
		};
		if (c.layers.lines)
			(r.lines ?? []).forEach((it, idx) => {
				const [s0, s1] = span(o, it.from, it.to);
				consider("line", idx, o, s0, s1, lineOffsets(it));
			});
		if (c.layers.kerbs)
			(r.kerbs ?? []).forEach((it, idx) => {
				for (const pc of kerbPieces(r, it, c.find)) {
					// (all it covers: its back ramp too)
					const off = pieceOffsets(it, pc);
					consider("kerb", idx, pc.o, pc.s0, pc.s1, { a: off.a, b: off.c });
				}
			});
	});
	if (!best) return null;
	const { score: _score, ...hit } = best as ItemHit & { score: number };
	return hit;
}

/** Screen pixels from (sx, sy) to a mark. */
const away = (c: HitContext, h: { x: number; z: number }, sx: number, sy: number) => {
	const [x, y] = c.toScreen(h.x, h.z);
	return Math.hypot(x - sx, y - sy);
};

/** The nearest of the marks within MARK_PX.grab of (sx, sy), if any. */
function nearest<H extends { x: number; z: number }>(c: HitContext, hs: readonly H[], sx: number, sy: number): H | null {
	let best: H | null = null;
	let bd: number = MARK_PX.grab;
	for (const h of hs) {
		const d = away(c, h, sx, sy);
		if (d < bd) {
			bd = d;
			best = h;
		}
	}
	return best;
}

/** A handle of the selected road under the mouse: a line's or rumble's end, a run-off's, a node's. */
function handleAt(c: HitContext, sx: number, sy: number): HandleHit | null {
	const road = c.roads[c.sel.r];
	if (!road) return null;
	const r = c.sel.r;
	const shape = c.shape !== false;
	const ends = [...endHandles(road, c.sel, c.find), ...(shape ? alongHandles(road, c.find) : [])];
	// (a line's or rumble's end first; then a node's marks, the nearest: a node's square, its handles' dots, its widths)
	const end = nearest(c, ends, sx, sy);
	if (end) return { ...end, road: r };
	if (!shape) return null;
	const h = nearest(c, nodeHandles(road, c.find), sx, sy);
	return h ? { ...h, road: r } : null;
}

/** How near (wx, wz) is to road i (lower: nearer); Infinity if not on it nor within a few pixels. */
function roadScore(c: HitContext, o: Samples, i: number, wx: number, wz: number): { score: number; s: number } {
	const n = nearestOn(o, wx, wz);
	const side = (wx - o.X[n.i]) * o.nx[n.i] + (wz - o.Z[n.i]) * o.nz[n.i];
	const inside = side >= 0 ? side <= o.L[n.i] + 0.05 : -side <= o.R[n.i] + 0.05;
	let score = Infinity;
	if (inside) score = n.d;
	else if (n.d * c.ppm < 6) score = n.d + 100;
	if (i === c.sel.r && inside) score -= 1000; // (the selected road first)
	return { score, s: n.s };
}

function roadAt(c: HitContext, wx: number, wz: number): RoadHit | null {
	let best: { road: number; s: number; score: number } | null = null;
	c.roads.forEach((r, i) => {
		const o = geo(r, c.find);
		if (!o || !inBox(o.box, wx, wz)) return;
		const { score, s } = roadScore(c, o, i, wx, wz);
		if (score < Infinity && (!best || score < best.score)) best = { road: i, s, score };
	});
	if (!best) return null;
	const { road, s } = best;
	return { kind: "road", road, s };
}

/** What is under the mouse at (sx, sy) (wx, wz in the world): a handle of the selected road, a line or rumble, a road. */
export function hitTest(c: HitContext, sx: number, sy: number, wx: number, wz: number): Hit | null {
	return handleAt(c, sx, sy) ?? itemAt(c, wx, wz) ?? (c.pickRoads === false ? null : roadAt(c, wx, wz));
}
