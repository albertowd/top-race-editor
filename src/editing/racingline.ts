// A racing line optimised: moved across the road, within what a car may use, to bend as little as it can overall (the least curvature: out wide into a bend,
// its apex, out wide again, the turn spread through the bend, not a kink at its apex). What a car may use at each point: the roads there (any that cover it: a
// junction's every road) and their rumbles' low ramps (not a concrete rumble, nor a ramp + concrete's concrete), less half the car's width and CLEAR_MORE from
// either side (as the AI lines keep it: engine/aiclear.ts). Worked out coarse to fine (OPT_STEPS); fitted as a line made along roads is (fitLine).

import { KERB_WIDTH, kindOf } from "../domain/constants";
import type { Road, Vec2, WallNode } from "../domain/types";
import { fitLine } from "../engine/ailines";
import { geo, type Lookup } from "../geometry/roads";
import { inBox, nearestOn, pointAt, span } from "../geometry/samples";
import { wallPath } from "./walls";

/** metres a car is wide where the track says not (a kart's), and how much more its middle keeps from an edge */
export const CAR_WIDTH = 1.4;
export const CLEAR_MORE = 0.3;
/** metres between the line's points at each step of the working out, and how many rounds at each */
const OPT_STEPS: readonly [number, number][] = [
	[4, 3000],
	[2, 1500],
	[1, 800],
];
/** metres across a road the corridor is looked for at most, either way */
const REACH = 25;

/** The rumble kinds a car may run over (their whole ramp): not a concrete one; a ramp + concrete's ramp only. */
const drivable = (k: Road["kerbs"] extends (infer K)[] | undefined ? K : never) => kindOf(k.kind) !== "concrete";

/** What a car's middle may use across the line at a point (p, its left n): from lo to hi metres to its left (- right), the roads' (and their low ramps') span
 * round it, less half the car and CLEAR_MORE either side; to its middle where that leaves nothing. */
function corridor(p: Vec2, n: Vec2, roads: readonly Road[], find: Lookup, keep: number): [number, number] {
	const spans: [number, number][] = [];
	for (const road of roads) {
		if (road.along) continue;
		const o = geo(road, find);
		if (!o || !inBox(o.box, p[0], p[1], REACH)) continue;
		const near = nearestOn(o, p[0], p[1]);
		if (near.i === 0 || near.i === o.X.length - 1) {
			// (past an end of it: not this road's, unless right at it)
			const q0 = pointAt(o, near.s);
			if (Math.hypot(q0.x - p[0], q0.z - p[1]) > Math.max(q0.l, q0.r) + 1) continue;
		}
		const q = pointAt(o, near.s);
		// (the road's left as the line's: the same way or the other)
		const same = q.nx * n[0] + q.nz * n[1] >= 0 ? 1 : -1;
		const c = (q.x - p[0]) * n[0] + (q.z - p[1]) * n[1];
		// (its low ramps where they are at s: each side's widened by the ramp's width)
		let extraL = 0;
		let extraR = 0;
		for (const k of road.kerbs ?? []) {
			if (!drivable(k)) continue;
			const [s0, s1] = span(o, k.from, k.to);
			if (near.s < s0 || near.s > s1) continue;
			const w = Math.max(0, (k.width ?? KERB_WIDTH) - (k.inset ?? 0));
			if (k.side === "left") extraL = Math.max(extraL, w);
			else extraR = Math.max(extraR, w);
		}
		const left = q.l + extraL;
		const right = q.r + extraR;
		const a = same > 0 ? c - right : c - left;
		const b = same > 0 ? c + left : c + right;
		if (a <= 0.5 && b >= -0.5) spans.push([a, b]);
	}
	if (!spans.length) return [0, 0];
	// (the spans joined where they meet, the one round the line kept)
	spans.sort((x, y) => x[0] - y[0]);
	let lo = spans[0]?.[0] as number;
	let hi = spans[0]?.[1] as number;
	for (const [a, b] of spans.slice(1))
		if (a <= hi + 0.05) hi = Math.max(hi, b);
		else if (a <= 0) [lo, hi] = [a, b];
	lo += keep;
	hi -= keep;
	return lo <= hi ? [lo, hi] : [(lo + hi) / 2, (lo + hi) / 2];
}

/** Points along a closed or open run of points, step metres apart (the first kept; a closed one round to it). */
function resample(P: Vec2[], closed: boolean, step: number): Vec2[] {
	const pts = closed ? [...P, P[0] as Vec2] : P;
	const S = [0];
	for (let i = 1; i < pts.length; i++)
		S.push((S[i - 1] as number) + Math.hypot((pts[i] as Vec2)[0] - (pts[i - 1] as Vec2)[0], (pts[i] as Vec2)[1] - (pts[i - 1] as Vec2)[1]));
	const L = S.at(-1) as number;
	const n = Math.max(closed ? 3 : 2, Math.round(L / step) + (closed ? 0 : 1));
	const d = closed ? L / n : L / (n - 1);
	const out: Vec2[] = [];
	let k = 1;
	for (let i = 0; i < n; i++) {
		const s = i * d;
		while (k < pts.length - 1 && (S[k] as number) < s) k++;
		const a = pts[k - 1] as Vec2;
		const b = pts[k] as Vec2;
		const f = ((s - (S[k - 1] as number)) / ((S[k] as number) - (S[k - 1] as number) || 1)) as number;
		out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
	}
	return out;
}

/** A line's points moved across within their corridors to the least curvature (P the points, closed or not; its ends kept where it is open), each point's
 * corridor found once (corridorAt); rounds of moving each towards where its neighbours two either side would put it. */
function leastCurvature(P: Vec2[], closed: boolean, rounds: number, corridorAt: (p: Vec2, n: Vec2) => [number, number]): Vec2[] {
	const n = P.length;
	const at = (i: number) => (closed ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1));
	// (each point's left as the points are, and its corridor across it)
	const N: Vec2[] = P.map((_, i) => {
		const a = P[at(i - 1)] as Vec2;
		const b = P[at(i + 1)] as Vec2;
		const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
	});
	const C = P.map((p, i) => corridorAt(p, N[i] as Vec2));
	// (where each point is across: within its corridor to start with)
	const off = C.map(([lo, hi]) => Math.min(Math.max(0, lo), hi));
	const Q = (i: number): Vec2 => {
		const j = at(i);
		const p = P[j] as Vec2;
		const m = N[j] as Vec2;
		return [p[0] + m[0] * (off[j] as number), p[1] + m[1] * (off[j] as number)];
	};
	for (let r = 0; r < rounds; r++)
		for (let i = 0; i < n; i++) {
			if (!closed && (i < 2 || i > n - 3)) continue;
			// (where the second differences either side of it are least: (4 (a + b) - (a2 + b2)) / 6)
			const a2 = Q(i - 2);
			const a = Q(i - 1);
			const b = Q(i + 1);
			const b2 = Q(i + 2);
			const want: Vec2 = [(4 * (a[0] + b[0]) - (a2[0] + b2[0])) / 6, (4 * (a[1] + b[1]) - (a2[1] + b2[1])) / 6];
			const p = P[i] as Vec2;
			const m = N[i] as Vec2;
			const to = (want[0] - p[0]) * m[0] + (want[1] - p[1]) * m[1];
			const [lo, hi] = C[i] as [number, number];
			off[i] = Math.min(Math.max((off[i] as number) + 0.8 * (to - (off[i] as number)), lo), hi);
		}
	return P.map((_, i) => Q(i));
}

/** A racing line optimised (see the module's note): its curve's points worked out coarse to fine, each step from the one before; fitted to nodes. carWidth: the
 * cars' (the track's ai width, else a kart's). */
export function optimiseLine(curve: WallNode[], closed: boolean, roads: readonly Road[], find: Lookup, carWidth = CAR_WIDTH): WallNode[] {
	const keep = carWidth / 2 + CLEAR_MORE;
	let P = wallPath({ curve, closed }, 0.25).P;
	if (closed && P.length > 2) P = P.slice(0, -1);
	for (const [step, rounds] of OPT_STEPS) {
		P = resample(P, closed, step);
		P = leastCurvature(P, closed, rounds, (p, n) => corridor(p, n, roads, find, keep));
	}
	// (a closed line from its first node's place again: its start)
	if (closed) {
		const s0 = curve[0]?.p;
		if (s0) {
			let k = 0;
			P.forEach((q, i) => {
				if (Math.hypot(q[0] - s0[0], q[1] - s0[1]) < Math.hypot((P[k] as Vec2)[0] - s0[0], (P[k] as Vec2)[1] - s0[1])) k = i;
			});
			P = [...P.slice(k), ...P.slice(0, k)];
		}
	}
	return fitLine(P, closed).map((n) => ({ p: n.p, in: n.in, out: n.out }));
}
