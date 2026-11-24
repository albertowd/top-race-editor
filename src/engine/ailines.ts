// A layout's first racing lines (TRACK_FORMAT's "Racing lines"), read once from the AI files the track has now (AC's ai/fast_lane.ai and ai/pit_lane.ai, in
// track/ac/<layout> where the steps leave them, else source/track/<layout>): each the points AC drives along (about every third of a metre) fitted with a curve
// in the objects' form, its nodes as few as keep it within FIT_TOL of them; the fast line closed, the pit line where it leaves and joins it (metres along the
// fast line from its start: the AI file's own distances).
import type { HostFiles } from "./placehost";
import type { TrackSettings } from "./trackfiles";

/** metres the fitted curve keeps to the AI file's points within */
export const FIT_TOL = 0.05;
/** metres apart a curve's nodes start (then more where it strays), and the least they come to */
export const FIT_START = 20;
export const FIT_LEAST = 1;

type V2 = [number, number];
export interface LineNode {
	p: V2;
	in: V2;
	out: V2;
}
export interface RacingLine {
	curve: LineNode[];
	closed: boolean;
	leaves?: number;
	joins?: number;
}
export interface RacingLines {
	fast?: RacingLine;
	pit?: RacingLine;
}

/** An AI file's points (x, z) and how far along each is (AC's: its own distances), as AC writes them (version 7: a header of four numbers, then x, y, z,
 * distance and its index each). */
export function readAi(b: Uint8Array): { P: V2[]; s: number[] } {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	const n = dv.getInt32(4, true);
	if (n <= 1 || 16 + n * 20 > b.length) throw new Error(`not an AI line (${n} points in ${b.length} bytes)`);
	const P: V2[] = [];
	const s: number[] = [];
	for (let i = 0; i < n; i++) {
		const at = 16 + i * 20;
		P.push([dv.getFloat32(at, true), dv.getFloat32(at + 8, true)]);
		s.push(dv.getFloat32(at + 12, true));
	}
	return { P, s };
}

const bez = (a: LineNode, b: LineNode, t: number): V2 => {
	const u = 1 - t;
	const P1 = [a.p[0] + a.out[0], a.p[1] + a.out[1]];
	const P2 = [b.p[0] + b.in[0], b.p[1] + b.in[1]];
	return [
		u * u * u * a.p[0] + 3 * u * u * t * (P1[0] as number) + 3 * u * t * t * (P2[0] as number) + t * t * t * b.p[0],
		u * u * u * a.p[1] + 3 * u * u * t * (P1[1] as number) + 3 * u * t * t * (P2[1] as number) + t * t * t * b.p[1],
	];
};

/** The farthest of points P[i0..i1] from the piece a to b: how far, and which. */
function strays(P: V2[], i0: number, i1: number, a: LineNode, b: LineNode): { d: number; at: number } {
	const n = Math.max(32, (i1 - i0) * 16);
	const C: V2[] = Array.from({ length: n + 1 }, (_, k) => bez(a, b, k / n));
	let worst = { d: 0, at: i0 };
	let k = 0;
	for (let i = i0; i <= i1; i++) {
		const q = P[i] as V2;
		// (the piece's samples go the points' way: the nearest a little on from the last)
		let best = Infinity;
		for (let m = Math.max(0, k - 16); m <= n; m++) {
			const c = C[m] as V2;
			const d = Math.hypot(c[0] - q[0], c[1] - q[1]);
			if (d < best) {
				best = d;
				k = m;
			} else if (d > best + 1) break;
		}
		if (best > worst.d) worst = { d: best, at: i };
	}
	return worst;
}

/** A curve through some of the points P (closed: round to its first again), each node's handles along the points' way there, a third of the way to the next
 * node and the one before; nodes added where it strays more than tol from the points between, until it does nowhere. */
export function fitLine(P: V2[], closed: boolean, tol = FIT_TOL): LineNode[] {
	const pts = closed && P.length > 2 && Math.hypot(...sub(P[0] as V2, P.at(-1) as V2)) < 0.5 ? P.slice(0, -1) : P;
	const n = pts.length;
	const s = [0];
	for (let i = 1; i < n; i++) s.push((s[i - 1] as number) + Math.hypot(...sub(pts[i] as V2, pts[i - 1] as V2)));
	const total = (s[n - 1] as number) + (closed ? Math.hypot(...sub(pts[0] as V2, pts[n - 1] as V2)) : 0);
	const at = (i: number) => pts[((i % n) + n) % n] as V2;
	// (the way at a point: over about a metre either side)
	const way = (i: number): V2 => {
		const k = Math.max(1, Math.round(1 / Math.max(total / n, 1e-3)));
		const a = closed ? at(i - k) : (pts[Math.max(0, i - k)] as V2);
		const b = closed ? at(i + k) : (pts[Math.min(n - 1, i + k)] as V2);
		const d = sub(b, a);
		const m = Math.hypot(...d) || 1;
		return [d[0] / m, d[1] / m];
	};
	const gap = (i: number, j: number) => (j > i ? (s[j] as number) - (s[i] as number) : total - (s[i] as number) + (s[j] as number));
	let nodes: number[] = [0];
	for (let i = 1; i < n; i++) if ((s[i] as number) - (s[nodes.at(-1) as number] as number) >= FIT_START) nodes.push(i);
	if (!closed && nodes.at(-1) !== n - 1) nodes.push(n - 1);
	const make = (): LineNode[] =>
		nodes.map((i, k) => {
			const t = way(i);
			const prev = nodes[k - 1] ?? (closed ? (nodes.at(-1) as number) : null);
			const next = nodes[k + 1] ?? (closed ? (nodes[0] as number) : null);
			const dIn = prev === null ? 0 : gap(prev, i) / 3;
			const dOut = next === null ? 0 : gap(i, next) / 3;
			return { p: at(i), in: [-t[0] * dIn, -t[1] * dIn], out: [t[0] * dOut, t[1] * dOut] };
		});
	for (let round = 0; round < 40; round++) {
		const curve = make();
		const more: number[] = [];
		const pieces = closed ? nodes.length : nodes.length - 1;
		for (let k = 0; k < pieces; k++) {
			const i0 = nodes[k] as number;
			const i1 = k + 1 < nodes.length ? (nodes[k + 1] as number) : n;
			const span = i1 - i0;
			if (span < 2 || gap(i0, i1 % n) < 2 * FIT_LEAST) continue;
			const idx = Array.from({ length: span + 1 }, (_, m) => (i0 + m) % n);
			const Q = idx.map((i) => at(i));
			const w = strays(Q, 0, Q.length - 1, curve[k] as LineNode, curve[(k + 1) % curve.length] as LineNode);
			if (w.d > tol) more.push((i0 + Math.round(span / 2)) % n);
		}
		if (!more.length) return round3(curve);
		nodes = [...new Set([...nodes, ...more])].sort((a, b) => a - b);
	}
	return round3(make());
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
const round3 = (c: LineNode[]): LineNode[] =>
	c.map((nd) => ({
		p: [r3(nd.p[0]), r3(nd.p[1])],
		in: [r3(nd.in[0]), r3(nd.in[1])],
		out: [r3(nd.out[0]), r3(nd.out[1])],
	}));

/** How far along a line (its points P, their distances s) the point of it nearest q is. */
function along(P: V2[], s: number[], q: V2): number {
	let best = 0;
	let bd = Infinity;
	P.forEach((p, i) => {
		const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
		if (d < bd) {
			bd = d;
			best = i;
		}
	});
	return s[best] as number;
}

/** A layout's first lines, from the AI files the track has for it (null where it has none). */
export async function firstLines(files: HostFiles, s: TrackSettings, layout: string): Promise<RacingLines | null> {
	const dirs = [`${s.project}/track/ac/${layout}/ai`, `${s.project}/source/track/${layout}/ai`];
	let dir: string | null = null;
	for (const d of dirs)
		if (await files.exists(`${d}/fast_lane.ai`)) {
			dir = d;
			break;
		}
	if (!dir) return null;
	const fast = readAi(await files.read(`${dir}/fast_lane.ai`));
	const out: RacingLines = { fast: { curve: fitLine(fast.P, true), closed: true } };
	if (await files.exists(`${dir}/pit_lane.ai`)) {
		const pit = readAi(await files.read(`${dir}/pit_lane.ai`));
		out.pit = {
			curve: fitLine(pit.P, false),
			closed: false,
			leaves: r3(along(fast.P, fast.s, pit.P[0] as V2)),
			joins: r3(along(fast.P, fast.s, pit.P.at(-1) as V2)),
		};
	}
	return out;
}
