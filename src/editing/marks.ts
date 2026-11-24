// Paint marks: lines laid on the roads along curves of Bezier pieces (as a tyre wall's, walls.ts). Where they run, what the mouse is on, the lines they are
// painted as (marks of one paint whose ends meet: one line, its corners mitred), and the edits to them (on drafts).

import { DASH, GAP } from "../domain/constants";
import type { LineColour, LineStyle, PaintMark, RubberMark, RubberWear, Vec2, WallNode } from "../domain/types";
import { nearestOnWall, wallPath, wallPieces } from "./walls";

export const MARK_WIDTH = 0.1;
/** a new mark's length when it is clicked, not dragged (m) */
export const MARK_LENGTH = 1;
/** Shift: a two-node mark's way kept to whole steps of this (radians: 15 degrees) */
export const MARK_SNAP = Math.PI / 12;
/** metres between the points a mark's curve is painted along */
export const MARK_PATH_STEP = 0.1;
/** metres: two lines' ends this near each other (or within half their width) meet: of one paint, painted as one line; of two (another colour, width or style),
 * joined by a mitred seam, each its half of the corner */
export const MARK_MEET = 0.1;
/** a seam's corner no longer than this many times its lines' half width (as GEOS's mitre limit) */
const SEAM_LIMIT = 5;
/** two marks meeting that turn back on each other more than this (radians: 150 degrees) overlap, not one line */
const DOUBLES_BACK = (150 * Math.PI) / 180;

const wrap = (h: number) => Math.atan2(Math.sin(h), Math.cos(h));
const third = (a: Vec2, b: Vec2): Vec2 => [(b[0] - a[0]) / 3, (b[1] - a[1]) / 3];

/** A curve straight from point to point, a corner at each point between (closed: on back to its first). */
export function straightThrough(points: readonly Vec2[], closed = false): WallNode[] {
	const n = points.length;
	const ring = closed && n > 2;
	return points.map((p, i) => {
		const prev = i > 0 ? points[i - 1] : ring ? points[n - 1] : undefined;
		const next = i < n - 1 ? points[i + 1] : ring ? points[0] : undefined;
		const node: WallNode = {
			p: [p[0], p[1]],
			in: prev ? third(p, prev) : [0, 0],
			out: next ? third(p, next) : [0, 0],
		};
		if (prev && next) node.corner = true;
		return node;
	});
}

/** A mark straight from point to point (closed: on back to its first), solid unless it says. */
export function markThrough(
	name: string,
	points: readonly Vec2[],
	paint: { width: number; colour: LineColour; style?: LineStyle; closed?: boolean },
): PaintMark {
	const closed = !!paint.closed && points.length > 2;
	return {
		name,
		curve: straightThrough(points, closed),
		...(closed ? { closed } : {}),
		width: paint.width,
		colour: paint.colour,
		style: paint.style ?? "solid",
	};
}

/** A mark as older files have it (from p, length metres along heading): its curve, straight. */
export function legacyCurve(m: { p: Vec2; heading: number; length: number }): WallNode[] {
	return straightThrough([m.p, [m.p[0] + Math.sin(m.heading) * m.length, m.p[1] + Math.cos(m.heading) * m.length]]);
}

/** What a line of paint is painted of: a mark's curve, or the points of one (a road's edge line), and its paint. */
export type Paintable = Partial<Pick<PaintMark, "curve">> &
	Pick<PaintMark, "closed" | "width" | "dash" | "gap"> & {
		points?: readonly Vec2[];
		colour: string;
		style: string;
	};

/** Whether a mark's curve is a ring (closed, three nodes at least). */
export const isRing = (m: Pick<PaintMark, "curve" | "closed">): boolean => !!m.closed && m.curve.length > 2;

const paths = new WeakMap<object, { P: Vec2[]; s: number[]; length: number }>();

/** A mark's curve as points along it (MARK_PATH_STEP apart about; a ring's last point its first again), how far along each is, and its length; kept while the
 * mark is the same. */
export function markPath(m: Pick<PaintMark, "curve" | "closed">) {
	let d = paths.get(m);
	if (!d) {
		const w = wallPath(m, MARK_PATH_STEP);
		d = { P: w.P, s: w.s, length: w.length };
		paths.set(m, d);
	}
	return d;
}

/** The point as far along a path as s. */
function pointAlong(path: { P: Vec2[]; s: number[] }, s: number): Vec2 {
	const { P, s: S } = path;
	if (P.length < 2) return P[0] ?? [0, 0];
	let k = 1;
	while (k < P.length - 1 && (S[k] as number) < s) k++;
	const a = P[k - 1] as Vec2;
	const b = P[k] as Vec2;
	const len = (S[k] as number) - (S[k - 1] as number) || 1;
	const f = Math.min(1, Math.max(0, (s - (S[k - 1] as number)) / len));
	return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

export const markLength = (m: Pick<PaintMark, "curve" | "closed">): number => markPath(m).length;

/** A mark's start (its first node) or its end (its last). */
export const markEnds = (m: Pick<PaintMark, "curve">): [Vec2, Vec2] => [m.curve[0]?.p ?? [0, 0], m.curve.at(-1)?.p ?? [0, 0]];

/** Halfway along a mark. */
export const markMiddle = (m: Pick<PaintMark, "curve" | "closed">): Vec2 => {
	const path = markPath(m);
	return pointAlong(path, path.length / 2);
};

/** How far (x, z) is off a mark's curve. */
export const offMark = (m: Pick<PaintMark, "curve" | "closed">, x: number, z: number): number =>
	m.curve.length > 1 ? nearestOnWall(m, x, z).d : Math.hypot((m.curve[0]?.p[0] ?? 0) - x, (m.curve[0]?.p[1] ?? 0) - z);

// ---------------------------------------------------------------- the lines painted

/** Marks of one paint (colour, style, width; a dotted one's dashes) painted as one line: the marks it is of (their places in the list, in its order along it),
 * its points (a ring's last point not its first again), closed or not. */
export interface PaintChain {
	marks: number[];
	points: Vec2[];
	closed: boolean;
	width: number;
	colour: string;
	style: string;
	dash: number;
	gap: number;
	/** where it meets a line of another paint end to end: its end carried on past the seam (in its points), and the side of each seam it keeps (the line through
	 * a and b; keep, a point on its side) */
	cuts?: Seam[];
}

/** A seam between two lines of different paint: the line through a and b, keep a point on the side kept; what is cut off past it, only within reach of it (the
 * end carried on past it: none of the line's own elsewhere, a bend's other side). */
export interface Seam {
	a: Vec2;
	b: Vec2;
	keep: Vec2;
	reach: number;
}

/** The part of the plane a seam cuts off: past it, away from keep, within its reach of where the two lines meet (a square along the seam, reach either way,
 * reach deep). */
export function pastSeam({ a, b, keep, reach }: Seam): Vec2[] {
	const m = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
	const d: Vec2 = [(b[0] - a[0]) / m, (b[1] - a[1]) / m];
	let n: Vec2 = [-d[1], d[0]];
	if ((keep[0] - a[0]) * n[0] + (keep[1] - a[1]) * n[1] > 0) n = [-n[0], -n[1]];
	// (the seam's point nearest the line kept's end, between a and b)
	const t = (keep[0] - a[0]) * d[0] + (keep[1] - a[1]) * d[1];
	const M: Vec2 = [a[0] + d[0] * t, a[1] + d[1] * t];
	return [
		[M[0] - d[0] * reach, M[1] - d[1] * reach],
		[M[0] + d[0] * reach, M[1] + d[1] * reach],
		[M[0] + d[0] * reach + n[0] * reach, M[1] + d[1] * reach + n[1] * reach],
		[M[0] - d[0] * reach + n[0] * reach, M[1] - d[1] * reach + n[1] * reach],
	];
}

const dashOf = (m: Paintable) => (m.dash && m.dash > 0 ? m.dash : DASH);
const gapOf = (m: Paintable) => (m.gap && m.gap > 0 ? m.gap : GAP);
const paintKey = (m: Paintable) => [m.colour, m.style, Math.round(m.width * 1000), ...(m.style === "dotted" ? [dashOf(m), gapOf(m)] : [])].join("|");

/** Two points the same, near enough. */
const samePoint = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;

/** A line's points as painted: its own, or its curve's path; a point repeated (a node's handles none) once. */
function pointsOf(m: Paintable): Vec2[] {
	const out: Vec2[] = [];
	const P = m.points ?? (m.curve ? markPath(m as Pick<PaintMark, "curve" | "closed">).P : []);
	for (const q of P) if (!out.length || !samePoint(out.at(-1) as Vec2, q)) out.push(q);
	return out;
}

/** How long a run of points is. */
function lengthOf(P: readonly Vec2[]): number {
	let len = 0;
	for (let k = 1; k < P.length; k++) len += Math.hypot((P[k] as Vec2)[0] - (P[k - 1] as Vec2)[0], (P[k] as Vec2)[1] - (P[k - 1] as Vec2)[1]);
	return len;
}

/** The way a run of points leaves its end (0 its first point, 1 its last), out of it. */
function wayOut(P: Vec2[], end: 0 | 1): Vec2 {
	const a = (end ? P.at(-1) : P[0]) as Vec2;
	const b = (end ? P.at(-2) : P[1]) ?? a;
	const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
	return [(a[0] - b[0]) / d, (a[1] - b[1]) / d];
}

/** The lines the marks (and the roads' edge lines) are painted as: each alone, but those of one paint whose ends meet (within MARK_MEET, or half their width)
 * one line through them, round to its first again where they close a ring; where more than two ends meet, the two going on straightest joined first. Two marks
 * turning back on each other where they meet (one over the other) are left apart: their paint is one where they overlap all the same (as the build lays it). */
export function paintChains(marks: readonly Paintable[]): PaintChain[] {
	const out: PaintChain[] = [];
	const chain = (m: Paintable, idx: number[], points: Vec2[], closed: boolean): PaintChain => ({
		marks: idx,
		points,
		closed,
		width: m.width,
		colour: m.colour,
		style: m.style,
		dash: dashOf(m),
		gap: gapOf(m),
	});
	const pts = marks.map(pointsOf);
	const open: number[] = [];
	marks.forEach((m, i) => {
		const P = pts[i] as Vec2[];
		if (P.length < 2) return;
		if (m.points ? !!m.closed && P.length > 2 : m.curve && isRing({ curve: m.curve, closed: m.closed })) {
			if (samePoint(P[0] as Vec2, P.at(-1) as Vec2)) P.pop();
			out.push(chain(m, [i], P, true));
		} else open.push(i);
	});
	// (each end of the open ones: what it may join, nearest first, then the straightest)
	const byKey = new Map<string, number[]>();
	for (const i of open) {
		const k = paintKey(marks[i] as Paintable);
		byKey.set(k, [...(byKey.get(k) ?? []), i]);
	}
	/** what each end (mark i, end e: key i * 2 + e) is joined to */
	const link = new Map<number, number>();
	for (const group of byKey.values()) {
		const meet = Math.max(MARK_MEET, ((marks[group[0] as number] as Paintable).width ?? 0) / 2);
		const pairs: { a: number; b: number; d: number; turn: number }[] = [];
		const ends = group.flatMap((i) => [0, 1].map((e) => ({ i, e: e as 0 | 1 })));
		for (let x = 0; x < ends.length; x++)
			for (let y = x + 1; y < ends.length; y++) {
				const A = ends[x] as { i: number; e: 0 | 1 };
				const B = ends[y] as { i: number; e: 0 | 1 };
				// (a mark's own two ends: only a long one's, round to its start)
				if (A.i === B.i && lengthOf(pts[A.i] as Vec2[]) <= 4 * meet) continue;
				const PA = pts[A.i] as Vec2[];
				const PB = pts[B.i] as Vec2[];
				const qa = (A.e ? PA.at(-1) : PA[0]) as Vec2;
				const qb = (B.e ? PB.at(-1) : PB[0]) as Vec2;
				const d = Math.hypot(qa[0] - qb[0], qa[1] - qb[1]);
				if (d > meet) continue;
				// (the way on from one into the other: out of A, then into B, against B's way out)
				const ua = wayOut(PA, A.e);
				const ub = wayOut(PB, B.e);
				const turn = Math.acos(Math.min(1, Math.max(-1, -(ua[0] * ub[0] + ua[1] * ub[1]))));
				if (turn > DOUBLES_BACK) continue;
				pairs.push({ a: A.i * 2 + A.e, b: B.i * 2 + B.e, d: Math.round(d * 1000), turn });
			}
		pairs.sort((p, q) => p.d - q.d || p.turn - q.turn);
		for (const { a, b } of pairs) {
			if (link.has(a) || link.has(b)) continue;
			link.set(a, b);
			link.set(b, a);
		}
	}
	// (each run of marks joined: from one with an end joined to none, along the links; the rest are rings)
	const done = new Set<number>();
	const walk = (start: number, from: 0 | 1) => {
		const idx: number[] = [];
		let points: Vec2[] = [];
		let i = start;
		let enter: 0 | 1 = from;
		let closed = false;
		for (;;) {
			done.add(i);
			idx.push(i);
			const P = enter === 0 ? (pts[i] as Vec2[]) : [...(pts[i] as Vec2[])].reverse();
			if (!points.length) points = [...P];
			else {
				// (where they meet: halfway between the two ends)
				const a = points.at(-1) as Vec2;
				const b = P[0] as Vec2;
				points[points.length - 1] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
				points.push(...P.slice(1));
			}
			const leave = (enter === 0 ? 1 : 0) as 0 | 1;
			const to = link.get(i * 2 + leave);
			if (to === undefined) break;
			const j = Math.floor(to / 2);
			if (j === start && to % 2 === from) {
				// (round to the first again: a ring, its first and last point one, halfway)
				const a = points.at(-1) as Vec2;
				const b = points[0] as Vec2;
				points[0] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
				points.pop();
				closed = true;
				break;
			}
			if (done.has(j)) break;
			i = j;
			enter = (to % 2) as 0 | 1;
		}
		return { idx, points, closed };
	};
	const runs: { idx: number[]; points: Vec2[]; closed: boolean }[] = [];
	for (const i of open)
		if (!done.has(i)) {
			const free = !link.has(i * 2) ? 0 : !link.has(i * 2 + 1) ? 1 : -1;
			if (free >= 0) runs.push(walk(i, free as 0 | 1));
		}
	for (const i of open) if (!done.has(i)) runs.push(walk(i, 0));
	for (const r of runs) {
		const m = marks[r.idx[0] as number] as Paintable;
		if (r.closed && r.points.length < 3) r.closed = false;
		out.push(chain(m, r.idx, r.points, r.closed));
	}
	out.sort((a, b) => Math.min(...a.marks) - Math.min(...b.marks));
	seams(out);
	return out;
}

/** Where two left with b's (x, z): where the line from p along u meets the one from q along v; null if they run on the same way. */
function crossing(p: Vec2, u: Vec2, q: Vec2, v: Vec2): Vec2 | null {
	const den = u[0] * v[1] - u[1] * v[0];
	if (Math.abs(den) < 1e-9) return null;
	const t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den;
	return [p[0] + u[0] * t, p[1] + u[1] * t];
}

/** The lines of different paint whose ends meet (within MARK_MEET, or half the wider's width; the nearest first, not one turning back over the other): each end
 * carried on to the corner their edges make, and cut along the seam from where their inner edges cross to where their outer ones do (going on straight: square
 * across), each keeping its own side; a corner sharper than SEAM_LIMIT allows, cut off there. */
function seams(chains: PaintChain[]): void {
	const ends: { c: number; e: 0 | 1 }[] = [];
	chains.forEach((c, i) => {
		if (!c.closed && c.points.length >= 2) ends.push({ c: i, e: 0 }, { c: i, e: 1 });
	});
	const at = (x: { c: number; e: 0 | 1 }) => {
		const P = (chains[x.c] as PaintChain).points;
		return (x.e ? P.at(-1) : P[0]) as Vec2;
	};
	const pairs: { x: number; y: number; d: number }[] = [];
	for (let i = 0; i < ends.length; i++)
		for (let j = i + 1; j < ends.length; j++) {
			const A = ends[i] as { c: number; e: 0 | 1 };
			const B = ends[j] as { c: number; e: 0 | 1 };
			if (A.c === B.c) continue;
			const ca = chains[A.c] as PaintChain;
			const cb = chains[B.c] as PaintChain;
			const d = Math.hypot(at(A)[0] - at(B)[0], at(A)[1] - at(B)[1]);
			if (d > Math.max(MARK_MEET, Math.max(ca.width, cb.width) / 2)) continue;
			const ua = wayOut(ca.points, A.e);
			const ub = wayOut(cb.points, B.e);
			if (Math.acos(Math.min(1, Math.max(-1, -(ua[0] * ub[0] + ua[1] * ub[1])))) > DOUBLES_BACK) continue;
			pairs.push({ x: i, y: j, d });
		}
	pairs.sort((p, q) => p.d - q.d);
	const used = new Set<number>();
	for (const { x, y } of pairs) {
		if (used.has(x) || used.has(y)) continue;
		used.add(x).add(y);
		const A = ends[x] as { c: number; e: 0 | 1 };
		const B = ends[y] as { c: number; e: 0 | 1 };
		const ca = chains[A.c] as PaintChain;
		const cb = chains[B.c] as PaintChain;
		const pa = at(A);
		const pb = at(B);
		const J: Vec2 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
		// (A goes on into J along ua; B comes out of it the way -ub; each one's left (across its way, the same side))
		const ua = wayOut(ca.points, A.e);
		const ub = wayOut(cb.points, B.e);
		const la: Vec2 = [-ua[1], ua[0]];
		const lb: Vec2 = [ub[1], -ub[0]];
		const ha = ca.width / 2;
		const hb = cb.width / 2;
		const side = (sg: number) => crossing([J[0] + la[0] * ha * sg, J[1] + la[1] * ha * sg], ua, [J[0] + lb[0] * hb * sg, J[1] + lb[1] * hb * sg], ub);
		const reach = SEAM_LIMIT * Math.max(ha, hb);
		let a = side(1);
		let b = side(-1);
		if (!a || !b || Math.hypot(a[0] - J[0], a[1] - J[1]) > reach || Math.hypot(b[0] - J[0], b[1] - J[1]) > reach) {
			// (straight on, or too sharp a corner: square across the way between them)
			const w: Vec2 = [ua[0] - ub[0], ua[1] - ub[1]];
			const m = Math.hypot(w[0], w[1]) || 1;
			a = [J[0] - (w[1] / m) * reach, J[1] + (w[0] / m) * reach];
			b = [J[0] + (w[1] / m) * reach, J[1] - (w[0] / m) * reach];
		}
		const far = Math.min(reach, Math.max(Math.hypot(a[0] - J[0], a[1] - J[1]), Math.hypot(b[0] - J[0], b[1] - J[1])));
		for (const [c, e, u] of [
			[ca, A.e, ua],
			[cb, B.e, ub],
		] as const) {
			// (its end at J, then on past it as far as the corner reaches; its side: back along it from J)
			const P = c.points;
			const tip: Vec2 = [J[0] + u[0] * (far + c.width), J[1] + u[1] * (far + c.width)];
			if (e) {
				P[P.length - 1] = J;
				P.push(tip);
			} else {
				P[0] = J;
				P.unshift(tip);
			}
			const keep: Vec2 = [J[0] - u[0] * c.width, J[1] - u[1] * c.width];
			c.cuts ??= [];
			c.cuts.push({ a, b, keep, reach: far + 2 * Math.max(ca.width, cb.width) });
		}
	}
}

/** The pieces a line is painted in: the whole of it if solid; dotted, dash after gap along it from its start (a ring: on round its last piece back to its first
 * point), each piece its points. */
export function chainPieces(c: Pick<PaintChain, "points" | "closed" | "style" | "dash" | "gap">): Vec2[][] {
	const P = c.closed ? [...c.points, c.points[0] as Vec2] : c.points;
	if (c.style !== "dotted") return [P];
	const S = [0];
	for (let k = 1; k < P.length; k++)
		S.push((S[k - 1] as number) + Math.hypot((P[k] as Vec2)[0] - (P[k - 1] as Vec2)[0], (P[k] as Vec2)[1] - (P[k - 1] as Vec2)[1]));
	const length = S.at(-1) as number;
	const path = { P, s: S };
	const out: Vec2[][] = [];
	for (let a = 0; a < length - 1e-9; a += c.dash + c.gap) {
		const b = Math.min(a + c.dash, length);
		const piece: Vec2[] = [pointAlong(path, a)];
		for (let k = 0; k < P.length; k++) if ((S[k] as number) > a + 1e-9 && (S[k] as number) < b - 1e-9) piece.push(P[k] as Vec2);
		piece.push(pointAlong(path, b));
		out.push(piece);
	}
	return out;
}

// ---------------------------------------------------------------- edits (on drafts)

const snapped = (h: number, snap: boolean) => (snap ? Math.round(h / MARK_SNAP) * MARK_SNAP : h);

/** Whether a piece runs straight: its handles along the way from one node to the other (or none). */
function isStraight(a: WallNode, b: WallNode): boolean {
	const dx = b.p[0] - a.p[0];
	const dz = b.p[1] - a.p[1];
	const len = Math.hypot(dx, dz);
	if (len < 1e-9) return true;
	const along = (h: Vec2, sgn: number) => {
		const m = Math.hypot(h[0], h[1]);
		if (m < 1e-9) return true;
		return Math.abs(h[0] * dz - h[1] * dx) <= 1e-6 * m * len && sgn * (h[0] * dx + h[1] * dz) > 0;
	};
	return along(a.out, 1) && along(b.in, -1);
}

/** A node of a mark (j) moved to (x, z): the pieces either side of it that ran straight still straight (a node between them that turns: a corner); snap (a mark
 * of two nodes): its way from the other node kept to whole steps of MARK_SNAP, its length as dragged. */
export function moveMarkNode(m: Pick<PaintMark, "curve" | "closed">, j: number, x: number, z: number, snap = false) {
	const c = m.curve;
	const n = c[j];
	if (!n) return;
	if (snap && c.length === 2) {
		const o = (c[1 - j] as WallNode).p;
		const len = Math.hypot(x - o[0], z - o[1]);
		const h = wrap(snapped(Math.atan2(x - o[0], z - o[1]), true));
		[x, z] = [o[0] + Math.sin(h) * len, o[1] + Math.cos(h) * len];
	}
	const straight = wallPieces(m).filter(([a, b, i]) => (i === j || c.indexOf(b) === j) && isStraight(a, b));
	n.p = [x, z];
	for (const [a, b] of straight) {
		a.out = third(a.p, b.p);
		b.in = third(b.p, a.p);
	}
	// (a node whose handles no longer go on straight through it: a corner, so dragging one leaves the other)
	const ends = new Set<WallNode>();
	for (const [a, b] of straight) ends.add(a).add(b);
	for (const q of ends) {
		const li = Math.hypot(q.in[0], q.in[1]);
		const lo = Math.hypot(q.out[0], q.out[1]);
		if (li > 1e-9 && lo > 1e-9 && Math.abs(q.in[0] * q.out[1] - q.in[1] * q.out[0]) > 1e-6 * li * lo) q.corner = true;
	}
}

/** How wide a band of rubber each darkness lays along a racing line: a share of the cars' width (the more it is used, the more the cars spread over it). */
const RUBBER_SHARE: Record<RubberWear, number> = { almost_new: 0.9, used: 1.1, very_used: 1.4 };

/** A rubber mark's width (m, to the centimetre) along a racing line of cars carWidth wide, as dark as wear. */
export const rubberWidth = (wear: RubberWear, carWidth: number): number => Math.round(carWidth * RUBBER_SHARE[wear] * 100) / 100;

/** A new rubber mark at (x, z): straight, MARK_LENGTH along heading, width wide, as dark as wear. */
export function newRubber(name: string, x: number, z: number, heading: number, paint: Pick<RubberMark, "width" | "wear">): RubberMark {
	const h = wrap(heading);
	return {
		name,
		curve: straightThrough([
			[x, z],
			[x + Math.sin(h) * MARK_LENGTH, z + Math.cos(h) * MARK_LENGTH],
		]),
		width: paint.width,
		wear: paint.wear,
	};
}

/** A new mark at (x, z): straight, MARK_LENGTH along heading. */
export function newMark(name: string, x: number, z: number, heading: number): PaintMark {
	const h = wrap(heading);
	return markThrough(
		name,
		[
			[x, z],
			[x + Math.sin(h) * MARK_LENGTH, z + Math.cos(h) * MARK_LENGTH],
		],
		{ width: MARK_WIDTH, colour: "white" },
	);
}
