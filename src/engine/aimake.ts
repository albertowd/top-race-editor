// A layout's AI lines made from its racing lines (TRACK_FORMAT's "Racing lines": AC's ai/fast_lane.ai, data/ideal_line.ai and ai/pit_lane.ai, written by
// acai.ts): each line a point every STEP metres along its curve on the floor, and at each the values AC drives by (acai.ts's EXTRA): its way (forward, its
// grade the way's rise), the floor's normal and camber across it, the radius it turns (a circle through the points TURN_SPAN metres either side, its curvature
// averaged over CURVE_SPAN) and which way, the road to either side of it (to its edges, SIDE_MIN to SIDE_MAX metres), and its speed: as fast as GRIP lets it
// round its turns, no more than TOP, braking at BRAKE and speeding up at ACCEL, the throttle and brake from that. Its points are first kept clear of the road's
// edges (aiclear.ts): the kart's wheels off its kerbs and off a pit wall's nose, the corners taken out of it.

import { followFast, keepClear } from "./aiclear";
import type { RacingLine } from "./ailines";

/** metres between a line's points */
export const STEP = 0.5;
/** metres either side of a point the circle of its turn is drawn through */
export const TURN_SPAN = 2;
/** metres either side a point's curvature is averaged over, for its radius, its way and its speed */
export const CURVE_SPAN = 3;
/** the most a line's radius is (a straight's) */
export const STRAIGHT = 5000;
/** metres of road either side of a line, at least and at most */
export const SIDE_MIN = 0.75;
export const SIDE_MAX = 50;
/** m/s² a kart turns at, at most; m/s at most; m/s² it brakes and speeds up at (what the Velopark's recorded lines were made with: their speed squared over
 * their radius, their speeding up and braking) */
export const GRIP = 12.5;
export const TOP = 30;
export const BRAKE = 9.1;
export const ACCEL = 4;
/** the 13th value (AC's own, its use unknown): the recorded lines' */
export const LENGTH = 1.5;
/** points either side a turn's way is eased over, where it changes */
const EASE = 2;
/** a pit lane's: metres of road either side of it at most (the pit road's own, not the track's beside it: AC's own recorded pit lanes have 2.5); m/s it is
 * driven at most (50 km/h, as the Velopark's recorded pit lanes) */
export const PIT_SIDE = 2.5;
export const PIT_SPEED = 13.9;
/** metres a pit lane runs on the fast line at either end, at least (AC takes its karts off and back onto the lap there: the Velopark's recorded pit lanes run
 * 17 to 20); metres from the fast line a point is on it */
export const PIT_OVERLAP = 18;
const ON_LINE = 0.5;

type V2 = [number, number];

/** Points every step metres along a line's curve (a closed one round to its first point, which it does not repeat). */
export function pointsAlong(line: RacingLine, step = STEP): V2[] {
	const c = line.curve;
	const pieces = line.closed ? c.length : c.length - 1;
	const dense: V2[] = [];
	for (let k = 0; k < pieces; k++) {
		const a = c[k] as RacingLine["curve"][number];
		const b = c[(k + 1) % c.length] as RacingLine["curve"][number];
		const P1: V2 = [a.p[0] + a.out[0], a.p[1] + a.out[1]];
		const P2: V2 = [b.p[0] + b.in[0], b.p[1] + b.in[1]];
		const n = 64;
		for (let m = k ? 1 : 0; m <= n; m++) {
			const t = m / n;
			const u = 1 - t;
			dense.push([
				u * u * u * a.p[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * b.p[0],
				u * u * u * a.p[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * b.p[1],
			]);
		}
	}
	if (c.length === 1) return [c[0]?.p as V2];
	const s = [0];
	for (let i = 1; i < dense.length; i++)
		s.push((s[i - 1] as number) + Math.hypot((dense[i] as V2)[0] - (dense[i - 1] as V2)[0], (dense[i] as V2)[1] - (dense[i - 1] as V2)[1]));
	const total = s.at(-1) as number;
	const count = Math.max(2, Math.round(total / step));
	const gap = total / count;
	const out: V2[] = [];
	let k = 0;
	for (let i = 0; i < (line.closed ? count : count + 1); i++) {
		const at = i * gap;
		while (k < dense.length - 2 && (s[k + 1] as number) < at) k++;
		const f = Math.min(1, Math.max(0, (at - (s[k] as number)) / ((s[k + 1] as number) - (s[k] as number) || 1)));
		const a = dense[k] as V2;
		const b = (dense[k + 1] ?? a) as V2;
		out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
	}
	return out;
}

/** How far the point of pts nearest p is. */
function nearestOf(pts: V2[], p: V2): number {
	let best = Infinity;
	for (const q of pts) best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
	return best;
}

/** A pit lane's points run on along the fast line's (fast: every step metres round it) at either end, so that each end is on it for PIT_OVERLAP metres at
 * least: before where it leaves, after where it joins. */
export function onFastAtEnds(P: V2[], fast: V2[], step = STEP): V2[] {
	if (P.length < 2 || fast.length < 3) return P;
	const nearest = (p: V2) => {
		let best = Infinity;
		let at = 0;
		for (let i = 0; i < fast.length; i++) {
			const d = Math.hypot((fast[i] as V2)[0] - p[0], (fast[i] as V2)[1] - p[1]);
			if (d < best) {
				best = d;
				at = i;
			}
		}
		return { at, d: best };
	};
	// (metres an end already runs on the fast line)
	const onFor = (pts: V2[]) => {
		let k = 0;
		while (k < pts.length - 1 && nearest(pts[k] as V2).d <= ON_LINE) k++;
		return k * step;
	};
	const m = fast.length;
	const want = (have: number) => Math.max(0, Math.round((PIT_OVERLAP - have) / step));
	const lead = want(onFor(P));
	const tail = want(onFor([...P].reverse()));
	const first = nearest(P[0] as V2).at;
	const last = nearest(P.at(-1) as V2).at;
	const before: V2[] = [];
	for (let k = lead; k >= 1; k--) before.push(fast[(((first - k) % m) + m) % m] as V2);
	const after: V2[] = [];
	for (let k = 1; k <= tail; k++) after.push(fast[(last + k) % m] as V2);
	return [...before, ...P, ...after];
}

/** Whether a pit lane (its AI points) joins the fast line (its AI points and how far along each is, round a lap) behind where it leaves it: more than half a
 * lap on from its first point to its last. AC takes a pit lane's exit to be ahead of its entry, and read one that comes back behind it (Velopark's karts leave
 * after the start line and rejoin before it) as nearly the whole lap: every AI kart was going to the pits from the grid, and a driver in the lane was shown
 * going the wrong way. */
export function pitRunsBackwards(fast: { points: Float32Array; along: Float32Array }, pit: { points: Float32Array }): boolean {
	const n = fast.along.length;
	const m = pit.points.length / 3;
	if (n < 2 || m < 2) return false;
	const lap =
		(fast.along[n - 1] as number) +
		Math.hypot((fast.points[0] as number) - (fast.points[(n - 1) * 3] as number), (fast.points[2] as number) - (fast.points[(n - 1) * 3 + 2] as number));
	const sAt = (k: number) => {
		const x = pit.points[k * 3] as number;
		const z = pit.points[k * 3 + 2] as number;
		let best = 0;
		let bd = Infinity;
		for (let i = 0; i < n; i++) {
			const d = Math.hypot((fast.points[i * 3] as number) - x, (fast.points[i * 3 + 2] as number) - z);
			if (d < bd) {
				bd = d;
				best = i;
			}
		}
		return fast.along[best] as number;
	};
	const on = (((sAt(m - 1) - sAt(0)) % lap) + lap) % lap;
	return on > lap / 2;
}

/** A racing line as AC's AI line: its points (x, y, z) on the floor, how far along each is, and its extra values (18 each). floor: the floor's height (NaN off
 * it); onRoad: whether a point is on a road. A pit lane's (pit): its road no wider than PIT_SIDE either side (the pit road's, not the track's it runs beside
 * where they meet), driven no faster than PIT_SPEED; with the fast line (pit.fast), run on along it at its ends (onFastAtEnds). */
export function aiLineOf(
	line: RacingLine,
	floor: (x: number, z: number) => number,
	onRoad: (x: number, z: number) => boolean,
	step = STEP,
	pit?: { fast?: RacingLine },
	clearRoad?: (x: number, z: number) => boolean,
	/** metres of road either side of a car's middle it keeps (aiclear.ts's CLEAR: a kart's) */
	margin?: number,
): { points: Float32Array; along: Float32Array; extra: Float32Array } {
	// (the road a kart keeps CLEAR of the edges of, and its sides measured to: the one given, kerbs left out, else onRoad)
	const clear = clearRoad ?? onRoad;
	let drawn = pointsAlong(line, step);
	let fastAt: V2[] | null = null;
	if (pit?.fast) {
		// (the fast line as its own AI line has it, kept clear; the pit lane leaving and joining it there)
		const F0 = pointsAlong(pit.fast, step);
		fastAt = keepClear(F0, true, clear, { step, margin });
		drawn = followFast(drawn, F0, fastAt, ON_LINE);
		const runs = (pts: V2[]) => {
			let k = 0;
			while (k < pts.length - 1 && nearestOf(fastAt as V2[], pts[k] as V2) <= ON_LINE) k++;
			return k;
		};
		drawn = keepClear(drawn, false, clear, {
			pinned: [runs(drawn), runs([...drawn].reverse())],
			side: PIT_SIDE,
			step,
			margin,
		});
	} else drawn = keepClear(drawn, line.closed, clear, pit ? { side: PIT_SIDE, step, margin } : { step, margin });
	const P = fastAt ? onFastAtEnds(drawn, fastAt, step) : drawn;
	const n = P.length;
	const closed = line.closed;
	const at = (i: number) => (closed ? (P[((i % n) + n) % n] as V2) : (P[Math.min(Math.max(i, 0), n - 1)] as V2));
	// (the floor's height, the last one's where the line leaves it)
	const Y = new Float64Array(n);
	let last = 0;
	for (let i = 0; i < n; i++) {
		const y = floor((P[i] as V2)[0], (P[i] as V2)[1]);
		Y[i] = Number.isNaN(y) ? last : y;
		last = Y[i] as number;
	}
	const yAt = (i: number) => Y[closed ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1)] as number;
	const h = (x: number, z: number, near: number) => {
		const y = floor(x, z);
		return Number.isNaN(y) ? near : y;
	};
	const points = new Float32Array(n * 3);
	const along = new Float32Array(n);
	const extra = new Float32Array(n * 18);
	const span = Math.max(1, Math.round(TURN_SPAN / step));
	const radius = new Float64Array(n);
	const turn = new Float64Array(n);
	let s = 0;
	for (let i = 0; i < n; i++) {
		const p = P[i] as V2;
		if (i) s += Math.hypot(p[0] - (P[i - 1] as V2)[0], p[1] - (P[i - 1] as V2)[1], (Y[i] as number) - (Y[i - 1] as number));
		points.set([p[0], Y[i] as number, p[1]], i * 3);
		along[i] = s;
		// (its turn: the circle through it and the points TURN_SPAN either side; which way, as the way turns)
		const a = at(i - span);
		const b = at(i + span);
		const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const ap = Math.hypot(p[0] - a[0], p[1] - a[1]);
		const pb = Math.hypot(b[0] - p[0], b[1] - p[1]);
		const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
		// (its curvature, signed as AC's way: -1 turning left, as the line's own left is (-tz, tx); 1 right)
		radius[i] = Math.abs(cross) > 1e-9 ? (-Math.sign(cross) * 2 * Math.abs(cross)) / (ab * ap * pb || 1) : 0;
	}
	// (the curvature averaged over CURVE_SPAN either side: a line drawn within a few centimetres of where it should be turns tighter and looser by turns over a
	// few metres, and its radius, its way and its speed with it)
	const cspan = Math.max(0, Math.round(CURVE_SPAN / step));
	const k = Float64Array.from(radius);
	for (let i = 0; i < n; i++) {
		let sum = 0;
		let m = 0;
		for (let d = -cspan; d <= cspan; d++) {
			const j = closed ? (((i + d) % n) + n) % n : i + d;
			if (j < 0 || j >= n) continue;
			sum += k[j] as number;
			m++;
		}
		const c = sum / (m || 1);
		radius[i] = Math.min(Math.abs(c) > 1e-9 ? 1 / Math.abs(c) : STRAIGHT, STRAIGHT);
		turn[i] = Math.abs(c) > 1e-9 ? Math.sign(c) : i ? (turn[i - 1] as number) : 1;
	}
	// (eased over EASE points either side where it changes)
	const way = Float64Array.from(turn, (_, i) => {
		let sum = 0;
		for (let d = -EASE; d <= EASE; d++) {
			const j = closed ? (((i + d) % n) + n) % n : Math.min(Math.max(i + d, 0), n - 1);
			sum += turn[j] as number;
		}
		return sum / (2 * EASE + 1);
	});
	// (its speed: as fast as it may turn, braking before and speeding up after; a lap's round twice)
	const v = Float64Array.from(radius, (r) => Math.min(pit ? PIT_SPEED : TOP, Math.sqrt(GRIP * r)));
	const ds = (i: number) => Math.max(1e-3, Math.abs((along[(i + 1) % n] as number) - (along[i] as number)) || step);
	for (let pass = 0; pass < (closed ? 2 : 1); pass++) {
		for (let i = n - 2 + (closed ? 1 : 0); i >= 0; i--) {
			const j = (i + 1) % n;
			v[i] = Math.min(v[i] as number, Math.sqrt((v[j] as number) ** 2 + 2 * BRAKE * ds(i)));
		}
		for (let i = 1; i < n + (closed ? 1 : 0); i++) {
			const j = i % n;
			const k = i - 1;
			v[j] = Math.min(v[j] as number, Math.sqrt((v[k] as number) ** 2 + 2 * ACCEL * ds(k)));
		}
	}
	for (let i = 0; i < n; i++) {
		const p = P[i] as V2;
		// (its way, over a metre either side, rising as the floor does)
		const a = at(i - 2);
		const b = at(i + 2);
		const dy = yAt(i + 2) - yAt(i - 2);
		const L = Math.hypot(b[0] - a[0], dy, b[1] - a[1]) || 1;
		const f = [(b[0] - a[0]) / L, dy / L, (b[1] - a[1]) / L] as const;
		const flat = Math.hypot(f[0], f[2]) || 1;
		// (its left: the roads' (-tz, tx))
		const lx = -f[2] / flat;
		const lz = f[0] / flat;
		const y = Y[i] as number;
		const hx = (h(p[0] + 0.5, p[1], y) - h(p[0] - 0.5, p[1], y)) / 1;
		const hz = (h(p[0], p[1] + 0.5, y) - h(p[0], p[1] - 0.5, y)) / 1;
		const nm = Math.hypot(hx, 1, hz);
		// (the floor's lean across it: its normal's along its right)
		const camber = Math.asin(Math.max(-1, Math.min(1, (-hx / nm) * -lx + (-hz / nm) * -lz)));
		const side = (sx: number, sz: number) => {
			let d = 0;
			const most = pit ? PIT_SIDE : SIDE_MAX;
			while (d < most && clear(p[0] + sx * (d + 0.1), p[1] + sz * (d + 0.1))) d += 0.1;
			// (a pit lane off the road's pictures there (its edge, a gap): its own road's width still)
			if (pit && d === 0) return PIT_SIDE;
			return Math.min(most, Math.max(SIDE_MIN, d));
		};
		const j = closed ? (i + 1) % n : Math.min(i + 1, n - 1);
		const accel = j === i ? 0 : ((v[j] as number) ** 2 - (v[i] as number) ** 2) / (2 * ds(i));
		const brake = accel < -0.5 ? Math.min(1, -accel / BRAKE) : 0;
		const gas = brake ? 0 : 1;
		const r = radius[i] as number;
		extra.set(
			[
				v[i] as number,
				gas,
				brake,
				((way[i] as number) * (v[i] as number) ** 2) / r / 9.81,
				r,
				// (AC's left first: towards (fz, -fx), the other side of the roads' left, as the recorded lines have it; the other way round, AC finds the grid off its
				// road and its karts stop)
				side(-lx, -lz),
				side(lx, lz),
				camber,
				way[i] as number,
				-hx / nm,
				1 / nm,
				-hz / nm,
				LENGTH,
				f[0],
				f[1],
				f[2],
				0,
				f[1],
			],
			i * 18,
		);
	}
	return { points, along, extra };
}
