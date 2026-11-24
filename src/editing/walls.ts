// A tyre wall's curve: Bezier pieces from node to node, as a road's middle (bezier.ts), without widths; a closed wall's last piece runs from its last node back
// to its first. What it is drawn as, the stacks the build lays along it, and the edits to it (on drafts).

import type { Vec2, WallNode } from "../domain/types";

/** A curve of Bezier pieces an object's copies go along (a tyre wall's, a fence's): its nodes, closed or not, the most its copies are apart (none:
 * TYRE_SPACING), rows deep. */
export interface Curved {
	curve: WallNode[];
	closed?: boolean;
	spacing?: number;
	rows?: number;
}

import { bezPoint, controlPoints, hullLength, lerp2 } from "../geometry/bezier";

/** A tyre stack's radius, as the track's are (to draw them); a new wall's stacks' spacing when there is none to copy. */
export const TYRE_R = 0.32;
export const TYRE_SPACING = 0.65;

/** The pieces of a wall: each its nodes and the index of its first (a ring's last: back to its first node). */
export function wallPieces(w: Curved): [WallNode, WallNode, number][] {
	const c = w.curve;
	const out: [WallNode, WallNode, number][] = [];
	for (let i = 1; i < c.length; i++) out.push([c[i - 1], c[i], i - 1]);
	if (w.closed && c.length > 2) out.push([c[c.length - 1], c[0], c.length - 1]);
	return out;
}

/** A wall's curve as points along it, about step metres apart: each point, how far along (s), its piece and t. */
export interface WallPath {
	P: Vec2[];
	s: number[];
	seg: number[];
	t: number[];
	length: number;
}

export function wallPath(w: Curved, step = 0.1): WallPath {
	const out: WallPath = { P: [], s: [], seg: [], t: [], length: 0 };
	const push = (q: Vec2, seg: number, t: number) => {
		const last = out.P.at(-1);
		const s = last ? (out.s.at(-1) ?? 0) + Math.hypot(q[0] - last[0], q[1] - last[1]) : 0;
		out.P.push(q);
		out.s.push(s);
		out.seg.push(seg);
		out.t.push(t);
	};
	if (w.curve.length === 1) push(w.curve[0].p, 0, 0);
	for (const [k, [a, b, i]] of wallPieces(w).entries()) {
		const n = Math.max(2, Math.ceil(hullLength(a, b) / step));
		for (let m = k ? 1 : 0; m <= n; m++) push(bezPoint(a, b, m / n), i, m / n);
	}
	out.length = out.s.at(-1) ?? 0;
	return out;
}

/** The stacks the build lays along a wall (the track's place_objects.wall_stacks): evenly along its curve, as many as make them no farther apart than spacing,
 * so every gap is the same and none is wider (an open wall from its first node to its last, both ends a stack; a ring round to its first again, its last gap
 * back to it as the others), rows deep, each row one spacing further to its right (going from its first node; its left as the track's roads have it: (-tz,
 * tx)). A wall of one node: one stack there. */
export function wallStacks(w: Curved): Vec2[] {
	if (w.curve.length === 1) return [w.curve[0].p];
	const path = wallPath(w);
	const step = (w.spacing ?? 0) > 0 ? (w.spacing as number) : TYRE_SPACING;
	const ring = w.closed && w.curve.length > 2;
	const gaps = Math.max(Math.ceil(path.length / step - 1e-9), 1);
	const along = Array.from({ length: ring ? gaps : gaps + 1 }, (_, i) => (i === gaps ? path.length : (i * path.length) / gaps));
	const out: Vec2[] = [];
	let k = 0;
	for (const at of along) {
		while (k < path.P.length - 2 && path.s[k + 1] < at) k++;
		const a = path.P[k];
		const b = path.P[k + 1] ?? a;
		const len = path.s[k + 1] - path.s[k] || 1;
		const f = Math.min(1, Math.max(0, (at - path.s[k]) / len));
		const tx = (b[0] - a[0]) / len;
		const tz = (b[1] - a[1]) / len;
		const [x, z] = lerp2(a, b, f);
		for (let row = 0; row < Math.max(1, w.rows ?? 1); row++) out.push([x + tz * row * step, z - tx * row * step]);
	}
	return out;
}

/** The point of a wall's curve nearest (x, z): how far off, its piece and t, how far along. */
export function nearestOnWall(w: Curved, x: number, z: number) {
	const path = wallPath(w);
	let best = 0;
	let bd = Infinity;
	path.P.forEach((q, i) => {
		const d = Math.hypot(q[0] - x, q[1] - z);
		if (d < bd) {
			bd = d;
			best = i;
		}
	});
	return { d: bd, seg: path.seg[best], t: path.t[best], s: path.s[best], length: path.length };
}

/** Where a node's handle is (the world). */
export const handleAt = (n: WallNode, h: "in" | "out"): Vec2 => [n.p[0] + n[h][0], n.p[1] + n[h][1]];

// ---------------------------------------------------------------- edits (on drafts)

/** A node's handle to (x, z); the other follows, turned straight on and as long as it was (a smooth node), unless the node is a corner, or
 * corner makes it one. */
export function moveWallHandle(n: WallNode, h: "in" | "out", x: number, z: number, corner = false) {
	const other = h === "in" ? "out" : "in";
	const v: Vec2 = [x - n.p[0], z - n.p[1]];
	n[h] = v;
	if (corner) n.corner = true;
	const ol = Math.hypot(n[other][0], n[other][1]);
	const m = Math.hypot(v[0], v[1]) || 1;
	if (!n.corner && ol > 0) n[other] = [(-v[0] / m) * ol, (-v[1] / m) * ol];
}

/** Handles along the way through each node's neighbours (as a Catmull-Rom curve), a third of each piece long (only: that node, else every node); a ring's ends
 * see each other. Its nodes no longer corners. */
export function smoothWall(w: Curved, only = -1) {
	const c = w.curve;
	const ring = w.closed && c.length > 2;
	const at = (i: number) => (ring ? c[(i + c.length) % c.length] : c[Math.min(Math.max(i, 0), c.length - 1)]);
	c.forEach((nd, i) => {
		if (only >= 0 && i !== only) return;
		const hasIn = ring || i > 0;
		const hasOut = ring || i < c.length - 1;
		const a = at(i - 1).p;
		const b = at(i + 1).p;
		let tx = b[0] - a[0];
		let tz = b[1] - a[1];
		const m = Math.hypot(tx, tz) || 1;
		tx /= m;
		tz /= m;
		const dIn = hasIn ? Math.hypot(nd.p[0] - a[0], nd.p[1] - a[1]) / 3 : 0;
		const dOut = hasOut ? Math.hypot(b[0] - nd.p[0], b[1] - nd.p[1]) / 3 : 0;
		nd.in = [-tx * dIn, -tz * dIn];
		nd.out = [tx * dOut, tz * dOut];
		delete nd.corner;
	});
}

/** The piece from node seg split at t (de Casteljau), the curve kept as it is: the new node's index. */
export function splitWall(w: Curved, seg: number, t: number): number {
	const c = w.curve;
	const a = c[seg];
	const bi = (seg + 1) % c.length;
	const b = c[bi];
	const [P0, P1, P2, P3] = controlPoints(a, b);
	const A = lerp2(P0, P1, t);
	const B = lerp2(P1, P2, t);
	const C = lerp2(P2, P3, t);
	const D = lerp2(A, B, t);
	const E = lerp2(B, C, t);
	const M = lerp2(D, E, t);
	a.out = [A[0] - P0[0], A[1] - P0[1]];
	b.in = [C[0] - P3[0], C[1] - P3[1]];
	c.splice(seg + 1, 0, { p: M, in: [D[0] - M[0], D[1] - M[1]], out: [E[0] - M[0], E[1] - M[1]] });
	return seg + 1;
}

/** A node added at (x, z): on the curve where it is within tol (split there, the curve kept), else on past the end it is nearer (the wall goes on to there,
 * smoothly). Its index. */
export function addWallNode(w: Curved, x: number, z: number, tol: number): number {
	const c = w.curve;
	if (c.length > 1) {
		const near = nearestOnWall(w, x, z);
		const atEnd = !w.closed && (near.s < 1e-6 || near.s > near.length - 1e-6);
		if (near.d <= tol && !atEnd && near.t > 0 && near.t < 1) return splitWall(w, near.seg, near.t);
	}
	const first = c[0];
	const last = c[c.length - 1];
	const toFirst = Math.hypot(first.p[0] - x, first.p[1] - z);
	const toLast = Math.hypot(last.p[0] - x, last.p[1] - z);
	const node: WallNode = { p: [x, z], in: [0, 0], out: [0, 0] };
	if (c.length > 1 && toFirst < toLast) {
		c.unshift(node);
		smoothWall(w, 0);
		if (!c[1].corner) smoothWall(w, 1);
		return 0;
	}
	c.push(node);
	smoothWall(w, c.length - 1);
	if (c.length > 1 && !c[c.length - 2].corner) smoothWall(w, c.length - 2);
	return c.length - 1;
}
