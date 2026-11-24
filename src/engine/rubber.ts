// The rubber the cars have laid on the roads: each rubber mark a band draped on the floor along its curve, its picture its own all the way along (never a tile
// repeating), as the cars lay it. Where along: a car driven along the mark's curve (the way it runs), as fast as each bend lets it, braking into the bends and
// driving out of them; the rubber laid as the tyres slide, the most where they work hardest (braking, through a bend's apex, driving out of it), a little all
// along. Across: the marks of many cars' passes, each its two tyres' (crisp, the lines of their rubber in them) wandering over the line, the line narrow at an
// apex and fanning out of a bend; lock-up marks in the braking and wheelspin out of the bends; a film of rubber dust over the band, its edges ragged; the
// stones of the asphalt showing through; the marbles (bits of rubber) thrown off the line outside the bends.
//
// Where marks lie over one another (the layouts' lines on the road they share), each point of the road is shown as one: every mark there weighed by how much
// rubber it lays there (the darker the more; as much: the first), the weights a share of one, and each mark drawing its own rubber to the power of its weight
// (1 - (1 - a)^w). However the game blends them, and in whatever order, the road shows the marks' blend there: never darker than the darkest of them. A mark
// another covers all across draws nothing there, and has no picture there either.

import type { RubberMark, RubberWear } from "../domain/types";
import { pointsAlong } from "./aimake";
import { RUBBER, RUBBER_LIFT } from "./wear";

type V2 = [number, number];

/** metres between the rows of a band's mesh */
export const RUBBER_STEP = 0.25;
/** metres a texel of the rubber's pictures is across a band, and along it */
export const TEXEL_ACROSS = 0.015;
export const TEXEL_ALONG = 0.05;
/** texels a page of the rubber's pictures is high (and at most wide) */
export const RUBBER_PAGE = 4096;
/** texels round each piece of picture, the rubber as it goes on past it (no seam where its mips sample past it) */
const GUTTER = 8;
/** a band's mesh as wide as this many times its mark's width (the bands fanning out, the marbles outside them) */
const SPREAD = 1.9;
/** points across a band's mesh */
const ACROSS = 13;
/** texels across between the points the marks' weights are found at */
const COARSE = 4;

// ---- the car driven along a mark -----------------------------------------------------------------------------------

/** m/s²: the most a car turns, brakes and drives out at; m/s: its top speed */
const A_TURN = 14;
const A_BRAKE = 11;
const A_DRIVE = 4.5;
const V_TOP = 40;

// ---- the weights where marks meet ----------------------------------------------------------------------------------

/** how sharply the darker mark takes a point (its rubber's share of one, times this, in the weights' exponent) */
const SHARP = 50;
/** a mark after another taken as this much lighter where they are as dark (the first of them there takes it) */
const LATER = 0.07;
/** a weight under this none (the others its share) */
const LEAST = 0.03;

/** How each darkness lays its rubber: the cars' passes (faint traces all along) and how dark one is at most; the slides (a metre, where the tyres work hardest)
 * and how dark one's mark is at most; the film of dust over the band, how much the stones show through, the marbles, and its darkest. */
const LAID: Record<
	RubberWear,
	{
		passes: number;
		mark: number;
		streaks: number;
		streak: number;
		film: number;
		stones: number;
		marbles: number;
		most: number;
	}
> = {
	almost_new: { passes: 16, mark: 0.025, streaks: 0.7, streak: 0.45, film: 0.03, stones: 0.4, marbles: 0.3, most: 0.6 },
	used: { passes: 24, mark: 0.03, streaks: 1.6, streak: 0.55, film: 0.06, stones: 0.3, marbles: 0.6, most: 0.8 },
	very_used: { passes: 32, mark: 0.035, streaks: 3.2, streak: 0.68, film: 0.1, stones: 0.2, marbles: 1, most: 0.9 },
};

/** A rubber mark as the rubber needs it. */
export type RubberLine = Pick<RubberMark, "curve" | "closed" | "width" | "wear">;

/** A mesh of rubber: its points (x, y, z), their place on its page (u, v), its faces. */
export interface RubberMesh {
	P: Float64Array;
	UV: Float64Array;
	F: Int32Array;
}

/** A page of the rubber's pictures: RGBA, row after row. */
export interface RubberPage {
	width: number;
	height: number;
	rgba: Uint8Array;
}

/** A piece of a mark's rubber: its mesh, on which page. */
export interface RubberPiece {
	mark: number;
	page: number;
	mesh: RubberMesh;
}

export interface RubberLaid {
	pages: RubberPage[];
	pieces: RubberPiece[];
}

// ---- numbers that are the same for the same seed --------------------------------------------------------------------

function hash(a: number, b: number, c = 0): number {
	let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

function randomOf(seed: number): () => number {
	let s = seed >>> 0 || 1;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Noise along a mark (0 to 1, smooth), its cells about cell metres; on a ring, a whole number of them round it. */
class Along {
	private readonly cells: number;
	private readonly size: number;

	constructor(
		readonly seed: number,
		cell: number,
		length: number,
		readonly ring: boolean,
	) {
		this.cells = ring ? Math.max(1, Math.round(length / cell)) : 0;
		this.size = ring ? length / this.cells : cell;
	}

	at(a: number): number {
		const x = a / this.size;
		const i = Math.floor(x);
		const f = x - i;
		const k = (n: number) => (this.ring ? ((n % this.cells) + this.cells) % this.cells : n);
		const s = f * f * (3 - 2 * f);
		return hash(k(i), this.seed) * (1 - s) + hash(k(i + 1), this.seed) * s;
	}
}

// ---- a mark's line --------------------------------------------------------------------------------------------------

/** A mark as laid: its rows (h metres apart along its curve, a ring's last its first again), the car's work along them, how wide its mesh
 * and its picture are. */
interface Line {
	index: number;
	wear: RubberWear;
	width: number;
	ring: boolean;
	/** rows, h apart: their middles, ways along and to the left (x, z each) */
	n: number;
	h: number;
	length: number;
	P: Float64Array;
	T: Float64Array;
	/** at each row: the rubber laid there (0 to 1), the tyres' work across (0 to 1), how much it drives out of a bend (0 to 1), the outside of its bend (1 left,
	 * -1 right), the cars' line's middle (m to the left) and spread (m) */
	laid: Float64Array;
	turn: Float64Array;
	brake: Float64Array;
	exit: Float64Array;
	outside: Float64Array;
	middle: Float64Array;
	spread: Float64Array;
	/** metres from a tyre lane to the line's middle; a tyre's width */
	half: number;
	tyre: number;
	/** the mesh's width (m) and the picture's texels across it (its gutters too) */
	mesh: number;
	nx: number;
}

/** An array smoothed along (as a Gaussian of sigma rows about: three boxes), round a ring on a ring. */
function smoothed(x: Float64Array, sigma: number, ring: boolean): Float64Array {
	const n = x.length;
	const r = Math.max(1, Math.round(sigma * 1.1));
	let a = Float64Array.from(x);
	for (let pass = 0; pass < 3; pass++) {
		const b = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			let s = 0;
			let c = 0;
			for (let k = -r; k <= r; k++) {
				let j = i + k;
				if (ring) j = (((j % (n - 1)) + (n - 1)) % (n - 1)) as number;
				else if (j < 0 || j >= n) continue;
				s += a[j] as number;
				c++;
			}
			b[i] = s / c;
		}
		if (ring) b[n - 1] = b[0] as number;
		a = b;
	}
	return a;
}

function lineOf(m: RubberLine, index: number): Line | null {
	const pts = pointsAlong({ curve: m.curve, closed: !!m.closed }, RUBBER_STEP) as V2[];
	const ring = !!m.closed && pts.length > 2;
	if (ring) pts.push(pts[0] as V2);
	const n = pts.length;
	if (n < 2 || !(m.width > 0)) return null;
	let length = 0;
	for (let i = 1; i < n; i++) length += Math.hypot((pts[i] as V2)[0] - (pts[i - 1] as V2)[0], (pts[i] as V2)[1] - (pts[i - 1] as V2)[1]);
	const h = length / (n - 1);
	const at = (i: number): V2 => {
		if (ring) return pts[(((i % (n - 1)) + (n - 1)) % (n - 1)) as number] as V2;
		return pts[Math.min(Math.max(i, 0), n - 1)] as V2;
	};
	const P = new Float64Array(n * 2);
	const T = new Float64Array(n * 2);
	const bend = new Float64Array(n);
	// (its bend: the turn of points 2 m either side, to the left over 0)
	const k2 = Math.max(1, Math.round(2 / h));
	for (let i = 0; i < n; i++) {
		const p = pts[i] as V2;
		const a = at(i - 2);
		const b = at(i + 2);
		const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const t: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
		P[i * 2] = p[0];
		P[i * 2 + 1] = p[1];
		T[i * 2] = t[0];
		T[i * 2 + 1] = t[1];
		const c = at(i - k2);
		const d = at(i + k2);
		const span = k2 * h;
		// (the second difference, to the left of the way along: a bend's curvature, its sign which way it turns)
		const ddx = c[0] - 2 * p[0] + d[0];
		const ddz = c[1] - 2 * p[1] + d[1];
		bend[i] = (ddx * -t[1] + ddz * t[0]) / (span * span);
	}
	// (rolled smooth: the curve's pieces meet with their bends a step apart)
	const kappa = smoothed(bend, 2 / h, ring);
	// (the car: as fast as each bend lets it, driving up to it, braking for it, round a ring twice)
	const v = new Float64Array(n);
	for (let i = 0; i < n; i++) v[i] = Math.min(V_TOP, Math.sqrt(A_TURN / Math.max(Math.abs(kappa[i] as number), 1e-6)));
	const top = Float64Array.from(v);
	const laps = ring ? 2 : 1;
	const last = ring ? n - 1 : n;
	for (let lap = 0; lap < laps; lap++)
		for (let k = 1; k < last + (ring ? 1 : 0); k++) {
			const i = k % last;
			const j = (k - 1) % last;
			v[i] = Math.min(top[i] as number, Math.sqrt((v[j] as number) ** 2 + 2 * A_DRIVE * h));
		}
	for (let lap = 0; lap < laps; lap++)
		for (let k = last - 2 + (ring ? 1 : 0); k >= 0; k--) {
			const i = k % last;
			const j = (k + 1) % last;
			v[i] = Math.min(v[i] as number, Math.sqrt((v[j] as number) ** 2 + 2 * A_BRAKE * h));
		}
	if (ring) v[n - 1] = v[0] as number;
	const raw = new Float64Array(n);
	const turnRaw = new Float64Array(n);
	const brakeRaw = new Float64Array(n);
	const exitRaw = new Float64Array(n);
	const outRaw = new Float64Array(n);
	const vAt = (i: number) => (ring ? v[((i % last) + last) % last] : v[Math.min(Math.max(i, 0), n - 1)]) as number;
	for (let i = 0; i < n; i++) {
		const lon = (vAt(i + 1) ** 2 - vAt(i - 1) ** 2) / (4 * h);
		const brake = clamp01(-lon / A_BRAKE);
		const drive = clamp01(lon / A_DRIVE);
		const turn = clamp01(((v[i] as number) ** 2 * Math.abs(kappa[i] as number)) / A_TURN);
		turnRaw[i] = turn;
		brakeRaw[i] = brake;
		exitRaw[i] = drive * turn;
		// (the outside of the bend, as much as it turns: 1 left, -1 right)
		outRaw[i] = ((kappa[i] as number) >= 0 ? -1 : 1) * turn;
		// (the rubber laid: a little all along, the most where the tyres slide, at their limits most of all)
		raw[i] = Math.min(1, 0.08 + 0.85 * brake ** 1.5 + 0.35 * drive ** 1.5 + 0.75 * turn * turn + 0.4 * drive * turn);
	}
	// (spread along: the cars brake and turn in a little here and there)
	const laid = smoothed(raw, 5 / h, ring);
	const turn = smoothed(turnRaw, 2 / h, ring);
	const brake = smoothed(brakeRaw, 2 / h, ring);
	const exit = smoothed(exitRaw, 3 / h, ring).map((x) => Math.min(1, x * 2));
	// (smooth, no step where a bend turns the other way)
	const outSmooth = smoothed(outRaw, 3 / h, ring);
	const outExit = smoothed(
		exitRaw.map((x, i) => x * ((kappa[i] as number) >= 0 ? -1 : 1)),
		3 / h,
		ring,
	);
	const outside = outSmooth.map((x) => (x >= 0 ? 1 : -1));
	const W = m.width;
	const middle = new Float64Array(n);
	const spread = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		// (out of a bend the cars run wide, to its outside; narrow at its apex; spread out on the straights)
		middle[i] = W * 0.24 * Math.max(-1, Math.min(1, outExit[i] as number));
		spread[i] = W * (0.1 + 0.14 * (1 - (turn[i] as number)) + 0.08 * (exit[i] as number));
	}
	const mesh = W * SPREAD;
	return {
		index,
		wear: m.wear,
		width: W,
		ring,
		n,
		h,
		length,
		P,
		T,
		laid,
		turn,
		brake,
		exit,
		outside,
		middle,
		spread,
		half: W * 0.3,
		tyre: W * 0.08,
		mesh,
		nx: Math.ceil(mesh / TEXEL_ACROSS) + 2 * GUTTER,
	};
}

/** A row's place along a line of metres a (round a ring; past an open line's ends, its ends): its row and how far on to the next. */
function rowAt(l: Line, a: number): [number, number] {
	let x = a / l.h;
	if (l.ring) x = ((x % (l.n - 1)) + (l.n - 1)) % (l.n - 1);
	else x = Math.min(Math.max(x, 0), l.n - 1);
	const i = Math.min(Math.floor(x), l.n - 2);
	return [i, x - i];
}

const lerpOf = (arr: Float64Array, i: number, f: number) => (arr[i] as number) * (1 - f) + (arr[i + 1] as number) * f;

/** How much rubber a line's cars lay at s metres to the left of its middle, a metres along (0 to 1, smooth: the two tyre lanes of the cars' line, as much as is
 * laid there). */
function smoothRubber(l: Line, s: number, a: number): number {
	const [i, f] = rowAt(l, a);
	const c = lerpOf(l.middle, i, f);
	const sp = lerpOf(l.spread, i, f);
	const sig2 = 2 * (sp * sp + 0.25 * l.tyre * l.tyre);
	const g = (x: number) => Math.exp((-x * x) / sig2);
	const lane = Math.min(1, g(s - c - l.half) + g(s - c + l.half));
	return lane * (0.25 + 0.75 * lerpOf(l.laid, i, f)) * LAID[l.wear].most * endsOf(l, a);
}

/** An open line's rubber coming in over its first metres and going out over its last. */
const endsOf = (l: Line, a: number) => (l.ring ? 1 : smoothstep(0, 4, a) * smoothstep(0, 4, l.length - a));

// ---- the weights where marks meet ----------------------------------------------------------------------------------

/** metres a cell of the rows' index is */
const CELL = 4;

/** Every line's rows, found by where they are. */
class RowIndex {
	private readonly cells = new Map<string, [number, number][]>();

	constructor(readonly lines: readonly Line[]) {
		lines.forEach((l, m) => {
			for (let i = 0; i < l.n; i++) {
				const k = `${Math.floor((l.P[i * 2] as number) / CELL)},${Math.floor((l.P[i * 2 + 1] as number) / CELL)}`;
				const c = this.cells.get(k);
				if (c) c.push([m, i]);
				else this.cells.set(k, [[m, i]]);
			}
		});
	}

	/** Each other line's row nearest (x, z), among those within a cell of it, if near enough to be over it. */
	near(x: number, z: number, but: number, reach: number): Map<number, number> {
		const best = new Map<number, { i: number; d: number }>();
		const cx = Math.floor(x / CELL);
		const cz = Math.floor(z / CELL);
		for (let i = cx - 1; i <= cx + 1; i++)
			for (let j = cz - 1; j <= cz + 1; j++)
				for (const [m, k] of this.cells.get(`${i},${j}`) ?? []) {
					if (m === but) continue;
					const l = this.lines[m] as Line;
					const d = ((l.P[k * 2] as number) - x) ** 2 + ((l.P[k * 2 + 1] as number) - z) ** 2;
					const r = reach + l.mesh / 2;
					if (d > r * r) continue;
					const b = best.get(m);
					if (!b || d < b.d) best.set(m, { i: k, d });
				}
		return new Map([...best].map(([m, b]) => [m, b.i]));
	}
}

/** Where (x, z) is on a line, from its row i on: metres to the left of it and along it, and the row it is at; null off its mesh. */
function onLine(l: Line, x: number, z: number, i0: number): [number, number, number] | null {
	let i = i0;
	for (let step = 0; step < 40; step++) {
		const dx = x - (l.P[i * 2] as number);
		const dz = z - (l.P[i * 2 + 1] as number);
		const t = dx * (l.T[i * 2] as number) + dz * (l.T[i * 2 + 1] as number);
		let j = i;
		if (t > l.h / 2) j = i + 1;
		else if (t < -l.h / 2) j = i - 1;
		if (l.ring) j = ((j % (l.n - 1)) + (l.n - 1)) % (l.n - 1);
		else if (j < 0 || j > l.n - 1) j = i;
		if (j === i) {
			const s = dx * -(l.T[i * 2 + 1] as number) + dz * (l.T[i * 2] as number);
			const a = i * l.h + t;
			if (Math.abs(s) > l.mesh / 2) return null;
			if (!l.ring && (a < 0 || a > l.length)) return null;
			return [s, a, i];
		}
		i = j;
	}
	return null;
}

/** Each line's weights at its rows (n of them) and points across (every COARSE texels): its share of each point of the road (0 to 1) among
 * the lines over it. */
function weightsOf(lines: readonly Line[]): Float32Array[] {
	const index = new RowIndex(lines);
	return lines.map((l, m) => {
		const across = Math.floor((l.nx - 2 * GUTTER) / COARSE) + 1;
		const w = new Float32Array(l.n * across).fill(1);
		for (let i = 0; i < l.n; i++) {
			const px = l.P[i * 2] as number;
			const pz = l.P[i * 2 + 1] as number;
			const others = index.near(px, pz, m, l.mesh / 2 + 1);
			if (!others.size) continue;
			const lx = -(l.T[i * 2 + 1] as number);
			const lz = l.T[i * 2] as number;
			const hint = new Map(others);
			for (let c = 0; c < across; c++) {
				const s = -l.mesh / 2 + c * COARSE * TEXEL_ACROSS;
				const x = px + lx * s;
				const z = pz + lz * s;
				const mine = smoothRubber(l, s, i * l.h) - LATER * m;
				const scores: number[] = [mine];
				for (const [o, i0] of hint) {
					const ol = lines[o] as Line;
					const on = onLine(ol, x, z, i0);
					if (!on) continue;
					hint.set(o, on[2]);
					scores.push(smoothRubber(ol, on[0], on[1]) - LATER * o);
				}
				if (scores.length < 2) continue;
				const top = Math.max(...scores);
				const e = scores.map((x) => Math.exp(SHARP * (x - top)));
				const sum = e.reduce((a, b) => a + b, 0);
				let kept = 0;
				let own = 0;
				for (const [k, x] of e.entries()) {
					const share = x / sum;
					if (share < LEAST) continue;
					kept += share;
					if (k === 0) own = share;
				}
				w[i * across + c] = own / kept;
			}
		}
		return w;
	});
}

// ---- a mark's picture -----------------------------------------------------------------------------------------------

/** One car's pass along a line (over all of it), its tyres' faint traces: how far off the cars' line it wanders (in their spread), how far apart its tyres are
 * and how wide, how dark, where along it lays (its braking a little earlier or later than the others), the lines of rubber in its tyres' traces. */
interface Pass {
	bias: number;
	wander: Along;
	wobble: Along;
	gate: Along;
	half: number;
	tyre: number;
	dark: number;
	shift: number;
	lines: Float32Array;
}

/** One slide of a car's tyres, the marks it leaves (most of the rubber you see): braking (locking), through a bend (sliding wide) or out of it (spinning): from
 * a0, len metres, off the cars' line (z, in its spread), drifting across (m a metre, to the bend's outside), coming in over fin metres and fading over its last
 * share fout; how dark each tyre's mark is (its right, its left: the inside tyre lighter in a bend, a kart's lifting), how wide and how far apart, the lines of
 * rubber in it. */
interface Streak {
	a0: number;
	len: number;
	z: number;
	drift: number;
	fin: number;
	fout: number;
	right: number;
	left: number;
	tyre: number;
	half: number;
	lines: Float32Array;
	id: number;
}

const LINES = 12;
/** metres a slide's mark is at the longest */
const LONGEST = 22;

function linesOf(rnd: () => number, gaps: number): Float32Array {
	const lines = new Float32Array(LINES);
	for (let j = 0; j < LINES; j++) lines[j] = rnd() < gaps ? 0.45 : 0.78 + 0.22 * rnd();
	return lines;
}

function passesOf(l: Line, seed: number): Pass[] {
	const w = LAID[l.wear];
	const rnd = randomOf(seed);
	return Array.from({ length: w.passes }, (_, k) => ({
		// (each driver a line of their own, wandering off it lap to lap)
		bias: (rnd() + rnd() + rnd() - 1.5) * 1.6,
		wander: new Along(seed * 131 + k * 7 + 1, 30, l.length, l.ring),
		wobble: new Along(seed * 131 + k * 7 + 2, 3, l.length, l.ring),
		gate: new Along(seed * 131 + k * 7 + 3, 16, l.length, l.ring),
		half: l.half * (1 + 0.06 * (rnd() - 0.5)),
		tyre: l.tyre * (0.85 + 0.3 * rnd()),
		dark: w.mark * (0.4 + 0.6 * rnd()),
		shift: (rnd() - 0.5) * 14,
		lines: linesOf(rnd, 0),
	}));
}

/** The slides along a line: the more the harder its tyres work there (braking, turning, driving out), most of them old and light, a few fresh and dark; sorted
 * by where they start (on a ring, those over its start twice: once each side). */
function streaksOf(l: Line, seed: number): Streak[] {
	const w = LAID[l.wear];
	const rnd = randomOf(seed ^ 0x5bd1e995);
	const normal = () => rnd() + rnd() + rnd() - 1.5;
	const out: Streak[] = [];
	const end = l.ring ? l.n - 1 : l.n;
	let id = 0;
	for (let i = 0; i < end; i++) {
		const brake = l.brake[i] as number;
		const turn = (l.turn[i] as number) ** 1.5;
		const exit = l.exit[i] as number;
		const work = clamp01(0.9 * brake + 0.8 * turn + 0.8 * exit);
		// (a few here and there even on a straight: a twitch, a car put off line)
		const rate = (w.streaks * work * work + 0.08) * l.h;
		let count = Math.floor(rate) + (rnd() < rate % 1 ? 1 : 0);
		while (count-- > 0) {
			const outside = l.outside[i] as number;
			const kind = brake >= Math.max(turn, exit) ? "brake" : exit > turn ? "exit" : "turn";
			const len = kind === "brake" ? 2 + 12 * rnd() : kind === "exit" ? 4 + 16 * rnd() : 3 + 15 * rnd();
			const drift =
				kind === "brake"
					? (rnd() - 0.5) * 0.02 + outside * 0.01 * turn
					: outside * (kind === "exit" ? 0.015 + 0.05 * rnd() : (0.02 + 0.07 * rnd()) * Math.max(0.3, turn));
			// (old and light the most of them, a few fresh and dark)
			const dark = w.streak * (0.15 + 0.85 * rnd() ** 2);
			const inner = dark * (kind === "brake" ? 0.6 + 0.4 * rnd() : 0.1 + 0.5 * rnd());
			const one = kind === "brake" && rnd() < 0.25;
			// (the right tyre at s < 0: the outer one where the bend's outside is to the right)
			const [right, left] = outside < 0 ? [dark, inner] : [inner, dark];
			const a0 = i * l.h + (rnd() - 0.5) * l.h - (kind === "brake" ? rnd() * len * 0.5 : 0);
			out.push({
				a0,
				len,
				z: normal() * 1.7,
				drift,
				fin: 0.15 + 0.8 * rnd(),
				fout: 0.3 + 0.4 * rnd(),
				right: one && rnd() < 0.5 ? 0 : right,
				left: one && right > 0 ? 0 : left,
				tyre: l.tyre * (0.85 + 0.3 * rnd()) * (1 + 0.5 * turn * rnd()),
				half: l.half * (1 + 0.05 * (rnd() - 0.5)),
				lines: linesOf(rnd, 0.05),
				id: id++,
			});
		}
	}
	if (l.ring) {
		const n = out.length;
		for (let k = 0; k < n; k++) {
			const s = out[k] as Streak;
			if (s.a0 + s.len > l.length) out.push({ ...s, a0: s.a0 - l.length });
			if (s.a0 < 0) out.push({ ...s, a0: s.a0 + l.length });
		}
	}
	return out.sort((x, y) => x.a0 - y.a0);
}

/** Value noise over the band (s across, a along), its cells cs by ca metres (0 to 1); round a ring along. */
function noise2(s: number, a: number, cs: number, ca: number, seed: number, around: number): number {
	const x = s / cs;
	const y = a / ca;
	const i = Math.floor(x);
	const j = Math.floor(y);
	const fx = x - i;
	const fy = y - j;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const jj = (k: number) => (around > 0 ? ((k % around) + around) % around : k);
	const h = (p: number, q: number) => hash(p + 7777, jj(q), seed);
	return (h(i, j) * (1 - sx) + h(i + 1, j) * sx) * (1 - sy) + (h(i, j + 1) * (1 - sx) + h(i + 1, j + 1) * sx) * sy;
}

/** A mark's rubber for texel rows (along it; past its ends, round a ring), each nx texels across: its opacity (0 to 1) at each, as laid, before any weight. */
class Painter {
	private readonly passes: Pass[];
	private readonly streaks: Streak[];
	private readonly starts: Float64Array;
	private readonly ragged: Along[];
	private readonly clear: Float64Array;
	private readonly seed: number;
	/** the film's blotches' cells round a ring (0: not a ring) */
	private readonly around: [number, number];

	constructor(readonly l: Line) {
		this.seed = 7919 * (l.index + 1);
		this.passes = passesOf(l, this.seed);
		this.streaks = streaksOf(l, this.seed);
		this.starts = Float64Array.from(this.streaks, (s) => s.a0);
		// (the film's edges: ragged along, each side its own)
		this.ragged = [0, 1, 2, 3].map((k) => new Along(this.seed + 17 + k, k < 2 ? 2.5 : 9, l.length, l.ring));
		this.clear = new Float64Array(l.nx);
		this.around = l.ring ? [Math.max(1, Math.round(l.length / 0.7)), Math.max(1, Math.round(l.length / 2.5))] : [0, 0];
	}

	/** texel x's metres to the left of the line's middle */
	sOf = (x: number) => (x + 0.5 - this.l.nx / 2) * TEXEL_ACROSS;

	/** A tyre's mark across the row: its middle c, tyre wide, as dark as dark, the lines of rubber in it (its shoulders the darker, shoulder of them). */
	private lay(c: number, tyre: number, dark: number, lines: Float32Array, shoulder = 0) {
		if (dark <= 0.003) return;
		const { nx } = this.l;
		const lo = c - tyre / 2;
		const x0 = Math.max(0, Math.floor(lo / TEXEL_ACROSS + nx / 2 - 1));
		const x1 = Math.min(nx - 1, Math.ceil((c + tyre / 2) / TEXEL_ACROSS + nx / 2));
		const clear = this.clear;
		for (let x = x0; x <= x1; x++) {
			const s = this.sOf(x);
			// (its edges crisp: a texel of them)
			const edge = clamp01((tyre / 2 - Math.abs(s - c)) / TEXEL_ACROSS + 0.5);
			if (edge <= 0) continue;
			let g = lines[Math.min(LINES - 1, Math.max(0, Math.floor(((s - lo) / tyre) * LINES)))] as number;
			if (shoulder) g *= 1 + shoulder * (smoothstep(0.55, 1, Math.abs(s - c) / (tyre / 2)) - 0.3);
			clear[x] = (clear[x] as number) * (1 - Math.min(1, dark * edge * g));
		}
	}

	/** The opacities of texel row y (into out, nx long). */
	row(y: number, out: Float32Array) {
		const l = this.l;
		const a = (y + 0.5) * TEXEL_ALONG;
		out.fill(0);
		if (!l.ring && (a < 0 || a > l.length)) return;
		const am = l.ring ? ((a % l.length) + l.length) % l.length : a;
		const w = LAID[l.wear];
		const [i, f] = rowAt(l, a);
		const c = lerpOf(l.middle, i, f);
		const sp = lerpOf(l.spread, i, f);
		const turn = lerpOf(l.turn, i, f);
		const exit = lerpOf(l.exit, i, f);
		const laid = lerpOf(l.laid, i, f);
		const outside = (l.outside[f < 0.5 ? i : i + 1] as number) || 1;
		const ends = endsOf(l, a);
		this.clear.fill(1);
		// (the passes: each its two tyres' faint traces, as dark as the rubber laid where it is, a little before or after)
		for (const p of this.passes) {
			const gate = smoothstep(0.3, 0.55, p.gate.at(a));
			if (gate <= 0) continue;
			const [j, g] = rowAt(l, a + p.shift);
			const here = lerpOf(l.laid, j, g);
			const z = 0.7 * p.bias + 1.6 * (p.wander.at(a) - 0.5);
			const o = c + sp * z + (p.wobble.at(a) - 0.5) * 0.012 * l.width;
			const tyre = p.tyre * (1 + 0.5 * turn);
			const dark = p.dark * gate * (0.15 + 0.85 * here) * ends;
			this.lay(o - p.half, tyre, dark, p.lines);
			this.lay(o + p.half, tyre, dark, p.lines);
		}
		// (the slides over this row: each its tyres' marks, coming in, flickering as the tyres load and unload, fading)
		const starts = this.starts;
		let k0 = 0;
		let k1 = starts.length;
		while (k0 < k1) {
			const m = (k0 + k1) >> 1;
			if ((starts[m] as number) < am - LONGEST) k0 = m + 1;
			else k1 = m;
		}
		for (let k = k0; k < starts.length && (starts[k] as number) <= am; k++) {
			const st = this.streaks[k] as Streak;
			const t = am - st.a0;
			if (t > st.len) continue;
			const tail = st.len * (1 - st.fout);
			let on = smoothstep(0, st.fin, t) * (1 - smoothstep(tail, st.len, t));
			const q = t / 0.9;
			const qi = Math.floor(q);
			const qf = q - qi;
			on *= 0.6 + 0.4 * (hash(qi, st.id, this.seed) * (1 - qf) + hash(qi + 1, st.id, this.seed) * qf);
			if (on <= 0) continue;
			const o = c + sp * st.z + st.drift * t;
			const tyre = st.tyre * (0.8 + 0.2 * on);
			this.lay(o - st.half, tyre, st.right * on * ends, st.lines, 0.6);
			this.lay(o + st.half, tyre, st.left * on * ends, st.lines, 0.6);
		}
		// (the film of dust, blotchy; the stones; the marbles: each texel)
		const sig2 = 2 * (sp * sp + 0.25 * l.tyre * l.tyre);
		const gl = (x: number) => Math.exp((-x * x) / sig2);
		const left = 1 + 0.5 * (this.ragged[0] as Along).at(a) + 0.4 * (this.ragged[2] as Along).at(a) - 0.45;
		const right = 1 + 0.5 * (this.ragged[1] as Along).at(a) + 0.4 * (this.ragged[3] as Along).at(a) - 0.45;
		const marbles = w.marbles * turn * (0.4 + 0.6 * exit) * ends;
		const edgeOut = l.half + 1.2 * Math.sqrt(sig2 / 2);
		const yy = y + 1000003;
		const [r1, r2] = this.around;
		for (let x = 0; x < l.nx; x++) {
			const s = this.sOf(x);
			const lane = Math.min(1, gl(s - c - l.half) + gl(s - c + l.half));
			let film = 0;
			if (lane > 0.02) {
				const blot = 0.6 * noise2(s, am, 0.18, 0.7, this.seed + 3, r1) + 0.4 * noise2(s, am, 0.6, 2.5, this.seed + 4, r2);
				film = w.film * lane * (0.3 + 0.7 * laid) * (s >= c ? left : right) * (0.25 + 1.1 * blot) * ends;
			}
			let alpha = 1 - (this.clear[x] as number) * (1 - Math.min(1, film));
			// (the stones' tops through it: the rubber in the asphalt's pores)
			const st = hash(x, yy, this.seed);
			alpha *= 1 - w.stones * smoothstep(0.5, 1, st);
			// (the marbles: bits of rubber thrown off outside the bend, fewer the further out)
			if (marbles > 0.01) {
				const beyond = outside * (s - c) - edgeOut;
				if (beyond > -0.05 * l.width) {
					const p = marbles * Math.exp(-Math.max(0, beyond) / (0.14 * l.width)) * 0.16;
					const hm = hash(x >> 1, yy, this.seed + 1);
					if (hm < p) alpha = 1 - (1 - alpha) * (1 - (0.45 + 0.4 * hash(x >> 1, yy, this.seed + 2)));
				}
			}
			out[x] = Math.min(w.most, alpha);
		}
	}
}

// ---- the pages and the meshes ---------------------------------------------------------------------------------------

/** A stretch of a line's rows (i0 to i1) drawn: at x0, y0 of its page (its gutters round it), its texel rows from ty0. */
interface Placed {
	line: number;
	i0: number;
	i1: number;
	page: number;
	x0: number;
	y0: number;
	ty0: number;
	rows: number;
}

/** The stretches of a line it draws anything in (its weight over none somewhere across them), a row round each. */
function runsOf(l: Line, w: Float32Array): [number, number][] {
	const across = w.length / l.n;
	const shown: boolean[] = [];
	for (let i = 0; i < l.n; i++) {
		let any = false;
		for (let c = 0; c < across && !any; c++) any = (w[i * across + c] as number) > 0;
		shown.push(any);
	}
	const runs: [number, number][] = [];
	let i = 0;
	while (i < l.n) {
		if (!shown[i]) {
			i++;
			continue;
		}
		const a = Math.max(0, i - 1);
		while (i < l.n && shown[i]) i++;
		const b = Math.min(l.n - 1, i);
		// (a gap of a few metres: one stretch, not two)
		const prev = runs.at(-1);
		if (prev && a - prev[1] < 12) prev[1] = b;
		else runs.push([a, b]);
	}
	return runs;
}

/** The weight of a line at s metres to the left of it, a metres along (between its weights' points). */
function weightAt(l: Line, w: Float32Array, s: number, a: number): number {
	const across = w.length / l.n;
	const [i, f] = rowAt(l, a);
	const cx = Math.min(Math.max((s + l.mesh / 2) / (COARSE * TEXEL_ACROSS), 0), across - 1);
	const c = Math.min(Math.floor(cx), across - 2);
	const g = across > 1 ? cx - c : 0;
	const at = (r: number, k: number) => w[r * across + Math.min(k, across - 1)] as number;
	return (at(i, c) * (1 - g) + at(i, c + 1) * g) * (1 - f) + (at(i + 1, c) * (1 - g) + at(i + 1, c + 1) * g) * f;
}

/** Each mark's rubber: its pieces' meshes (draped on the floor, NaN off it: none there) and the pages of pictures they are drawn from; where marks lie over one
 * another, the road shown as their blend there (never darker than the darkest). page: a page's texels high and at most wide. */
export function layRubber(marks: readonly RubberLine[], floor: (x: number, z: number) => number, page = RUBBER_PAGE): RubberLaid {
	const all = marks.map((m, i) => lineOf(m, i));
	const lines = all.filter((l): l is Line => !!l);
	if (!lines.length) return { pages: [], pieces: [] };
	const weights = weightsOf(lines);
	// (each stretch drawn put on the pages: in columns as wide as the widest line's picture, down each column)
	const col = Math.max(...lines.map((l) => l.nx));
	const cols = Math.max(1, Math.floor(page / col));
	const placed: Placed[] = [];
	let at = { page: 0, col: 0, y: 0 };
	const next = () => {
		at = at.col + 1 < cols ? { page: at.page, col: at.col + 1, y: 0 } : { page: at.page + 1, col: 0, y: 0 };
	};
	for (const [k, l] of lines.entries())
		for (const [r0, r1] of runsOf(l, weights[k] as Float32Array)) {
			let i = r0;
			while (i < r1) {
				const room = Math.floor(((page - at.y - 2 * GUTTER - 2) * TEXEL_ALONG) / l.h);
				if (room < 8) {
					next();
					continue;
				}
				const i1 = Math.min(r1, i + room);
				const ty0 = Math.floor((i * l.h) / TEXEL_ALONG) - GUTTER;
				const ty1 = Math.ceil((i1 * l.h) / TEXEL_ALONG) + GUTTER;
				placed.push({ line: k, i0: i, i1, page: at.page, x0: at.col * col, y0: at.y, ty0, rows: ty1 - ty0 });
				at.y += ty1 - ty0;
				i = i1;
			}
		}
	// (the pages: as wide as their columns need, a power of two)
	const used = new Map<number, number>();
	for (const p of placed) used.set(p.page, Math.max(used.get(p.page) ?? 0, p.x0 + col));
	const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(4, n)));
	const pages: RubberPage[] = [...used.keys()]
		.sort((a, b) => a - b)
		.map((p) => {
			const width = Math.min(page, pow2(used.get(p) as number));
			return { width, height: page, rgba: new Uint8Array(width * page * 4) };
		});
	const [r0, g0, b0] = RUBBER.rgb;
	const painters = lines.map((l) => new Painter(l));
	const row = new Float32Array(col);
	for (const p of placed) {
		const l = lines[p.line] as Line;
		const w = weights[p.line] as Float32Array;
		const pg = pages[p.page] as RubberPage;
		const painter = painters[p.line] as Painter;
		for (let r = 0; r < p.rows; r++) {
			const y = p.ty0 + r;
			painter.row(y, row);
			const a = (y + 0.5) * TEXEL_ALONG;
			const base = ((p.y0 + r) * pg.width + p.x0) * 4;
			for (let x = 0; x < l.nx; x++) {
				let alpha = row[x] as number;
				if (alpha <= 0) continue;
				const k = weightAt(l, w, painter.sOf(x), a);
				if (k <= 0) continue;
				if (k < 1) alpha = 1 - (1 - alpha) ** k;
				// (thin rubber a little lighter: a dark grey, not brown)
				const thin = 1 - Math.min(1, (row[x] as number) / 0.6);
				const o = base + x * 4;
				pg.rgba[o] = Math.round(r0 + 14 * thin);
				pg.rgba[o + 1] = Math.round(g0 + 14 * thin);
				pg.rgba[o + 2] = Math.round(b0 + 14 * thin);
				pg.rgba[o + 3] = Math.round(255 * alpha);
			}
		}
	}
	// (the meshes: each stretch's rows, ACROSS points across, draped on the floor)
	const pieces: RubberPiece[] = placed.map((p) => {
		const l = lines[p.line] as Line;
		const pg = pages[p.page] as RubberPage;
		return { mark: l.index, page: p.page, mesh: meshOf(l, p, pg, floor) };
	});
	return { pages, pieces: pieces.filter((x) => x.mesh.F.length) };
}

function meshOf(l: Line, p: Placed, pg: RubberPage, floor: (x: number, z: number) => number): RubberMesh {
	const P: number[] = [];
	const UV: number[] = [];
	const ok: boolean[] = [];
	const inner = l.nx - 2 * GUTTER;
	const mesh = inner * TEXEL_ACROSS;
	for (let i = p.i0; i <= p.i1; i++) {
		const px = l.P[i * 2] as number;
		const pz = l.P[i * 2 + 1] as number;
		const lx = -(l.T[i * 2 + 1] as number);
		const lz = l.T[i * 2] as number;
		const v = (p.y0 + (i * l.h) / TEXEL_ALONG - p.ty0) / pg.height;
		for (let k = 0; k < ACROSS; k++) {
			const s = -mesh / 2 + (mesh * k) / (ACROSS - 1);
			const x = px + lx * s;
			const z = pz + lz * s;
			const y = floor(x, z);
			ok.push(!Number.isNaN(y));
			P.push(x, (Number.isNaN(y) ? 0 : y) + RUBBER_LIFT, z);
			UV.push((p.x0 + s / TEXEL_ACROSS + l.nx / 2) / pg.width, v);
		}
	}
	const F: number[] = [];
	const face = (a: number, b: number, c: number) => {
		if (!(ok[a] && ok[b] && ok[c])) return;
		// (facing up, as the paint's: the cross product's y over 0)
		const ux = (P[b * 3] as number) - (P[a * 3] as number);
		const uz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
		const vx = (P[c * 3] as number) - (P[a * 3] as number);
		const vz = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
		if (uz * vx - ux * vz < 0) F.push(c, b, a);
		else F.push(a, b, c);
	};
	for (let r = 0; r < p.i1 - p.i0; r++)
		for (let k = 0; k < ACROSS - 1; k++) {
			const a = r * ACROSS + k;
			const b = a + ACROSS;
			face(a, b, b + 1);
			face(a, b + 1, a + 1);
		}
	return { P: Float64Array.from(P), UV: Float64Array.from(UV), F: Int32Array.from(F) };
}

/** One mark's rubber on its own (width wide on a straight, as dark as wear), page texels high. */
export function rubberAlone(
	line: Pick<RubberMark, "curve" | "closed">,
	width: number,
	floor: (x: number, z: number) => number,
	wear: RubberWear = "used",
	page = 1024,
): RubberLaid {
	return layRubber([{ ...line, width, wear }], floor, page);
}
