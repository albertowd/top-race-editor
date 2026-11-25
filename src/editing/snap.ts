import type { PaintMark, Road } from "../domain/types";
import { edgeLinePoints } from "../geometry/paint";
import { geo, type Lookup } from "../geometry/roads";
import { inBox, nearestOn, pointAt } from "../geometry/samples";
import { markPath } from "./marks";

export interface SnapMark {
	x: number;
	z: number;
	label: string;
}

/** What a point snaps to near (wx, wz), within tol metres: another road's end node first, else its centre line or its edges, the nearest. */
export function snapPoint(roads: readonly Road[], find: Lookup, wx: number, wz: number, exclude: string | null, tol: number): SnapMark | null {
	let best: (SnapMark & { rank: number; d: number }) | null = null;
	const take = (x: number, z: number, label: string, rank: number) => {
		const d = Math.hypot(x - wx, z - wz);
		if (d <= tol && (!best || rank < best.rank || (rank === best.rank && d < best.d))) best = { x, z, label, rank, d };
	};
	for (const r of roads) {
		if (r.name === exclude || r.along) continue;
		const o = geo(r, find);
		if (!o || !inBox(o.box, wx, wz, tol)) continue;
		if (r.curve) for (const i of [0, r.curve.length - 1]) take(r.curve[i].p[0], r.curve[i].p[1], `${r.name}'s ${i ? "end" : "start"}`, 0);
		const n = nearestOn(o, wx, wz);
		const q = pointAt(o, n.s);
		const s = n.s.toFixed(1);
		take(q.x, q.z, `${r.name}'s centre line, s ${s}`, 1);
		take(q.x + q.nx * q.l, q.z + q.nz * q.l, `${r.name}'s left edge, s ${s}`, 1);
		take(q.x - q.nx * q.r, q.z - q.nz * q.r, `${r.name}'s right edge, s ${s}`, 1);
	}
	if (!best) return null;
	const { x, z, label } = best;
	return { x, z, label };
}

/** What is left out of the paint snapped to: a mark (its place in the list), or a road's line (the road's place, the line's). */
export type PaintOwn = { mark: number } | { road: number; line: number };

/** The ends of the roads' edge lines (but own) near (wx, zz), within tol: taken by take, as the ends they are. */
function edgeLineEnds(roads: readonly Road[], find: Lookup, own: PaintOwn | null, take: (x: number, z: number, label: string, rank: number) => void) {
	roads.forEach((r, ri) => {
		if (r.along || !r.lines?.length) return;
		const o = geo(r, find);
		if (!o) return;
		r.lines.forEach((ln, li) => {
			if (own && "road" in own && own.road === ri && own.line === li) return;
			const e = edgeLinePoints(o, ln);
			if (!e) return;
			const [a, b] = [e.points[0], e.points.at(-1)];
			if (a) take(a[0], a[1], `${r.name}'s ${ln.side} line's start`, 0);
			if (b) take(b[0], b[1], `${r.name}'s ${ln.side} line's end`, 0);
		});
	});
}

/** What a line's end dragged to near (wx, wz) snaps to, within tol metres: the end of another line or mark, of any paint (of one paint, the two are painted as
 * one line; of two, joined by a mitred seam). */
export function snapToPaintEnd(
	roads: readonly Road[],
	find: Lookup,
	marks: readonly PaintMark[],
	wx: number,
	wz: number,
	own: PaintOwn | null,
	tol: number,
): SnapMark | null {
	let best: (SnapMark & { d: number }) | null = null;
	const take = (x: number, z: number, label: string) => {
		const d = Math.hypot(x - wx, z - wz);
		if (d <= tol && (!best || d < best.d)) best = { x, z, label, d };
	};
	edgeLineEnds(roads, find, own, take);
	marks.forEach((m, i) => {
		if ((own && "mark" in own && own.mark === i) || m.closed || m.curve.length < 2) return;
		const [a, b] = [m.curve[0]?.p, m.curve.at(-1)?.p];
		if (a) take(a[0], a[1], `${m.name}'s start`);
		if (b) take(b[0], b[1], `${m.name}'s end`);
	});
	if (!best) return null;
	const { x, z, label } = best;
	return { x, z, label };
}

/** A mark's node j as a snap names it: its start or end (an open mark's ends), else its number. */
function nodeLabel(end: boolean, j: number): string {
	if (!end) return `node ${j + 1}`;
	return j ? "end" : "start";
}

/** What a paint mark's node dragged to near (wx, wz) snaps to, within tol metres: another mark's end or a road's edge line's (so the two are painted as one
 * line, their corner mitred; of another paint, joined by a seam), else one of another mark's other nodes, else the nearest point of its line. */
export function snapToMarks(
	marks: readonly Pick<PaintMark, "name" | "curve" | "closed">[],
	wx: number,
	wz: number,
	exclude: number,
	tol: number,
	roads: readonly Road[] = [],
	find?: Lookup,
): SnapMark | null {
	let best: (SnapMark & { rank: number; d: number }) | null = null;
	const take = (x: number, z: number, label: string, rank: number) => {
		const d = Math.hypot(x - wx, z - wz);
		if (d <= tol && (!best || rank < best.rank || (rank === best.rank && d < best.d))) best = { x, z, label, rank, d };
	};
	if (find) edgeLineEnds(roads, find, { mark: exclude }, take);
	marks.forEach((m, i) => {
		if (i === exclude) return;
		const c = m.curve;
		c.forEach((n, j) => {
			const end = !m.closed && (j === 0 || j === c.length - 1);
			take(n.p[0], n.p[1], `${m.name}'s ${nodeLabel(end, j)}`, end ? 0 : 1);
		});
		const P = markPath(m).P;
		for (let k = 1; k < P.length; k++) {
			const a = P[k - 1] as [number, number];
			const b = P[k] as [number, number];
			const dx = b[0] - a[0];
			const dz = b[1] - a[1];
			const len2 = dx * dx + dz * dz;
			const t = len2 > 0 ? Math.min(1, Math.max(0, ((wx - a[0]) * dx + (wz - a[1]) * dz) / len2)) : 0;
			take(a[0] + dx * t, a[1] + dz * t, `${m.name}'s line`, 2);
		}
	});
	if (!best) return null;
	const { x, z, label } = best;
	return { x, z, label };
}
