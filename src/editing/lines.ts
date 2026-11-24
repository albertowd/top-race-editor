// A layout's racing lines (TRACK_FORMAT's "Racing lines"): its fast line, the way round its lap a car takes at speed, closed; its pit lane line, forking from
// the fast line `leaves` metres along it from its start and merging back into it at `joins`. Each a curve as a tyre wall's (walls.ts): nodes with handles,
// edited one by one. The pit line's first node is the fast line's point where it leaves, its last where it joins, each with its handle along the fast line's
// way (no corner off it or back on): kept so whenever either line, or the fork or the merge, moves.

import type { LayoutObjects, LineKind, RacingLine, RacingLines, Vec2, WallNode } from "../domain/types";
import { fitLine } from "../engine/ailines";
import { nearestOnWall, smoothWall, splitWall, wallPath } from "./walls";

export type { LineKind } from "../domain/types";
export const LINE_KINDS: readonly LineKind[] = ["fast", "pit"];
export const isLineKind = (k: string): k is LineKind => (LINE_KINDS as readonly string[]).includes(k);

/** a pick's part of the pit line: its fork off the fast line, its merge back into it */
export const FORK = -2;
export const MERGE = -3;
/** metres a pit line's end handle is, where it has none */
const END_HANDLE = 4;
/** metres either side of a click a new pit line forks and merges */
const NEW_PIT = 30;

export const lineOf = (lay: LayoutObjects | undefined, kind: LineKind): RacingLine | undefined => lay?.lines?.[kind];

/** The point of a closed line at s metres along it (round again past its end), and its way there (unit). */
export function pointAlong(line: RacingLine, s: number): { p: Vec2; t: Vec2 } {
	const path = wallPath(line, 0.25);
	const L = path.length || 1;
	const at = ((s % L) + L) % L;
	let k = 0;
	while (k < path.P.length - 2 && (path.s[k + 1] as number) < at) k++;
	const a = path.P[k] as Vec2;
	const b = (path.P[k + 1] ?? a) as Vec2;
	const len = (path.s[k + 1] as number) - (path.s[k] as number) || 1;
	const f = Math.min(1, Math.max(0, (at - (path.s[k] as number)) / len));
	const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
	return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t: [(b[0] - a[0]) / d, (b[1] - a[1]) / d] };
}

/** How far along a line the point of it nearest (x, z) is, and how far off. */
export function along(line: RacingLine, x: number, z: number): { s: number; d: number; length: number } {
	const n = nearestOnWall(line, x, z);
	return { s: n.s, d: n.d, length: n.length };
}

/** Where the pit line forks off the fast line and merges back into it (null where it has not both). */
export function forkAndMerge(lines: RacingLines | undefined): { fork: Vec2; merge: Vec2 } | null {
	const fast = lines?.fast;
	const pit = lines?.pit;
	if (!fast || fast.curve.length < 3 || !pit || pit.leaves == null || pit.joins == null) return null;
	return { fork: pointAlong(fast, pit.leaves).p, merge: pointAlong(fast, pit.joins).p };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A line's curve made along the middles of roads (their samples, in the order the lap takes them; each turned to go on from the one before, at its nearer
 * end), fitted as the AI files' are (within 5 cm); a closed one round to its first again, from its point nearest start (the start line). */
export function lineFromRoads(paths: { X: number[]; Z: number[] }[], closed: boolean, start?: Vec2): WallNode[] {
	const P: Vec2[] = [];
	const d = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
	paths.forEach((path, i) => {
		let pts: Vec2[] = path.X.map((x, k) => [x, path.Z[k] as number]);
		if (pts.length < 2) return;
		const first = pts[0] as Vec2;
		const last = pts.at(-1) as Vec2;
		const next = paths[i + 1];
		if (!P.length && next && next.X.length) {
			// (the first road: its end the one nearer the next road's ends)
			const ends: Vec2[] = [
				[next.X[0] as number, next.Z[0] as number],
				[next.X.at(-1) as number, next.Z.at(-1) as number],
			];
			const near = (q: Vec2) => Math.min(...ends.map((e) => d(q, e)));
			if (near(first) < near(last)) pts = pts.reverse();
		} else if (P.length) {
			const was = P.at(-1) as Vec2;
			if (d(last, was) < d(first, was)) pts = pts.reverse();
		}
		for (const q of pts) if (!P.length || d(q, P.at(-1) as Vec2) > 0.3) P.push(q);
	});
	if (P.length < 2) return [];
	let pts = P;
	if (closed && start) {
		let k = 0;
		pts.forEach((q, i) => {
			if (d(q, start) < d(pts[k] as Vec2, start)) k = i;
		});
		pts = [...pts.slice(k), ...pts.slice(0, k)];
	}
	return fitLine(pts, closed).map((n) => ({ p: n.p, in: n.in, out: n.out }));
}

/** A pit line made along roads (lineFromRoads), forking off the fast line where its first point meets it and merging back where its last does; null where the
 * layout has no fast line. */
export function pitFromRoads(lines: RacingLines, paths: { X: number[]; Z: number[] }[]): RacingLine | null {
	const fast = lines.fast;
	if (!fast || fast.curve.length < 3) return null;
	const curve = lineFromRoads(paths, false);
	const a = curve[0];
	const b = curve.at(-1);
	if (!a || !b || curve.length < 2) return null;
	return { curve, closed: false, leaves: r3(along(fast, a.p[0], a.p[1]).s), joins: r3(along(fast, b.p[0], b.p[1]).s) };
}

// ---------------------------------------------------------------- edits (on drafts)

/** The pit line's ends put on the fast line, where it leaves and joins it; their handles as they are set (the way it leaves and joins, and how hard: edited as
 * any node's), one of none along the fast line END_HANDLE long. */
export function keepPitOn(lines: RacingLines | undefined): void {
	const fast = lines?.fast;
	const pit = lines?.pit;
	if (!fast || fast.curve.length < 3 || !pit || pit.curve.length < 2 || pit.leaves == null || pit.joins == null) return;
	const a = pointAlong(fast, pit.leaves);
	const b = pointAlong(fast, pit.joins);
	const first = pit.curve[0] as WallNode;
	const last = pit.curve[pit.curve.length - 1] as WallNode;
	first.p = a.p;
	first.in = [0, 0];
	if (Math.hypot(first.out[0], first.out[1]) < 1e-6) first.out = [a.t[0] * END_HANDLE, a.t[1] * END_HANDLE];
	last.p = b.p;
	last.out = [0, 0];
	if (Math.hypot(last.in[0], last.in[1]) < 1e-6) last.in = [-b.t[0] * END_HANDLE, -b.t[1] * END_HANDLE];
}

/** The fork (FORK) or the merge (MERGE) moved along the fast line to the point of it nearest (x, z). */
export function moveForkOrMerge(lines: RacingLines | undefined, which: number, x: number, z: number): void {
	const fast = lines?.fast;
	const pit = lines?.pit;
	if (!fast || !pit) return;
	const s = r3(along(fast, x, z).s);
	if (which === FORK) pit.leaves = s;
	else if (which === MERGE) pit.joins = s;
	keepPitOn(lines);
}

/** A node added to a line at (x, z), on it where it is within tol (else on past its nearer end); a layout with no such line gets one: a fast line from its
 * first node (closed once it has three), a pit line forking off the fast line NEW_PIT metres before the point of it nearest and merging NEW_PIT after, through
 * (x, z). The node's index. */
export function addLineNode(lay: LayoutObjects, kind: LineKind, x: number, z: number, tol: number): number | null {
	lay.lines ??= {};
	const lines = lay.lines;
	const line = lines[kind];
	if (!line) {
		if (kind === "fast") {
			lines.fast = { curve: [{ p: [x, z], in: [0, 0], out: [0, 0] }], closed: true };
			return 0;
		}
		const fast = lines.fast;
		if (!fast || fast.curve.length < 3) return null;
		const { s, length } = along(fast, x, z);
		const wrap = (v: number) => r3(((v % length) + length) % length);
		lines.pit = {
			curve: [
				{ p: [0, 0], in: [0, 0], out: [0, 0] },
				{ p: [x, z], in: [0, 0], out: [0, 0] },
				{ p: [0, 0], in: [0, 0], out: [0, 0] },
			],
			closed: false,
			leaves: wrap(s - NEW_PIT),
			joins: wrap(s + NEW_PIT),
		};
		keepPitOn(lines);
		smoothWall(lines.pit, 1);
		return 1;
	}
	const c = line.curve;
	// (a pit line's ends are the fast line's: a node between them only, where it is clicked; on it, the curve split there, its shape kept; off it, into the piece
	// nearest)
	if (kind === "pit") {
		const near = nearestOnWall(line, x, z);
		let i: number;
		if (near.d <= tol && near.t > 0 && near.t < 1) i = splitWall(line, near.seg, near.t);
		else {
			i = Math.min(Math.max(near.seg + 1, 1), c.length - 1);
			c.splice(i, 0, { p: [x, z], in: [0, 0], out: [0, 0] });
			smoothWall(line, i);
		}
		keepPitOn(lines);
		return i;
	}
	const before = c.length;
	const i = addNode(line, x, z, tol);
	if (kind === "fast" && before >= 2) line.closed = true;
	keepPitOn(lines);
	return i;
}

/** A node added to a line: a closed one's into the piece nearest (x, z), on it within tol (split there, the curve kept) or off it; an open one's on past its
 * end. */
function addNode(line: RacingLine, x: number, z: number, tol: number): number {
	const c = line.curve;
	if (line.closed && c.length >= 3) {
		const near = nearestOnWall(line, x, z);
		if (near.d <= tol && near.t > 0 && near.t < 1) return splitWall(line, near.seg, near.t);
		const i = near.seg + 1;
		c.splice(i, 0, { p: [x, z], in: [0, 0], out: [0, 0] });
		smoothWall(line, i);
		return i;
	}
	c.push({ p: [x, z], in: [0, 0], out: [0, 0] });
	smoothWall(line);
	return c.length - 1;
}

/** A line's node removed (the fast line keeps three, the pit line its ends and one between); the whole line (j < 0). Whether anything was. */
export function removeLineNode(lay: LayoutObjects, kind: LineKind, j: number): boolean {
	const lines = lay.lines;
	const line = lines?.[kind];
	if (!lines || !line) return false;
	if (j < 0) {
		delete lines[kind];
		// (no fast line: no pit line forking off it)
		if (kind === "fast") delete lines.pit;
		if (!lines.fast && !lines.pit) delete lay.lines;
		return true;
	}
	const c = line.curve;
	if (kind === "fast" ? c.length <= 3 : c.length <= 3 || j === 0 || j === c.length - 1) return false;
	c.splice(j, 1);
	keepPitOn(lines);
	return true;
}

/** A line's node, or the whole line, moved by (dx, dz) (a pit line's ends stay on the fast line; the pit line follows a fast line moved). */
export function moveLine(lay: LayoutObjects, kind: LineKind, j: number, dx: number, dz: number): void {
	const lines = lay.lines;
	const line = lines?.[kind];
	if (!line) return;
	line.curve.forEach((n, i) => {
		if (j < 0 || i === j) n.p = [n.p[0] + dx, n.p[1] + dz];
	});
	keepPitOn(lines);
}
