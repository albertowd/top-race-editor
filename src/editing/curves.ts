// Edits to a road's curve. These change roads in place: call them on drafts, with geometry (samples) from the roads as they were before the edit.

import { DEFAULT_MATERIAL, RUNOFF_WIDTH } from "../domain/constants";
import type { CurveNode, Kerb, PaintLine, Road, Vec2 } from "../domain/types";
import { splitPiece } from "../geometry/bezier";
import { alongWidth } from "../geometry/roads";
import type { Samples } from "../geometry/samples";
import { nearestOn, pointAt } from "../geometry/samples";
import { endIndex } from "./joints";

/** Handles along the way through each node's neighbours (as a Catmull-Rom curve), a third of each piece long. */
export function autoHandles(road: Road, only = -1): void {
	const c = road.curve;
	if (!c) return;
	c.forEach((nd, i) => {
		if (only >= 0 && i !== only) return;
		const a = c[Math.max(0, i - 1)].p;
		const b = c[Math.min(c.length - 1, i + 1)].p;
		let tx = b[0] - a[0];
		let tz = b[1] - a[1];
		const m = Math.hypot(tx, tz) || 1;
		tx /= m;
		tz /= m;
		const dIn = i > 0 ? Math.hypot(nd.p[0] - c[i - 1].p[0], nd.p[1] - c[i - 1].p[1]) / 3 : 0;
		const dOut = i < c.length - 1 ? Math.hypot(c[i + 1].p[0] - nd.p[0], c[i + 1].p[1] - nd.p[1]) / 3 : 0;
		nd.in = [-tx * dIn, -tz * dIn];
		nd.out = [tx * dOut, tz * dOut];
		delete nd.corner;
	});
}

/** A node in piece seg at t, the curve kept as it is: its index. */
export function splitAt(road: Road, seg: number, t: number): number {
	const c = road.curve;
	if (!c) return -1;
	const { node, aOut, bIn } = splitPiece(c[seg], c[seg + 1], t);
	c[seg].out = aOut;
	c[seg + 1].in = bIn;
	c.splice(seg + 1, 0, node);
	return seg + 1;
}

export type AddNodeResult = { ok: true; n: number } | { ok: false; why: string };

/** A node at (x, z): on the road (split there, the curve kept), or past one of its ends (the road goes on to there). o: the road's samples before. */
export function addNode(road: Road, o: Samples, x: number, z: number): AddNodeResult {
	const c = road.curve;
	if (!c) return { ok: false, why: "Not a curve." };
	const near = nearestOn(o, x, z);
	const last = o.X.length - 1;
	if ((near.i === 0 || near.i === last) && near.d > 1) {
		const end = near.i === 0 ? 0 : c.length - 1;
		const nd = c[end];
		if (nd.joint)
			return {
				ok: false,
				why: `That end is joined to ${nd.joint.road}: unjoin it first to make the road longer there.`,
			};
		const d: Vec2 = [(x - nd.p[0]) / 3, (z - nd.p[1]) / 3];
		const nn: CurveNode = { p: [x, z], in: [0, 0], out: [0, 0], left: nd.left, right: nd.right };
		if (end === 0) {
			nn.out = [-d[0], -d[1]];
			nd.in = [d[0], d[1]];
			c.unshift(nn);
			return { ok: true, n: 0 };
		}
		nn.in = [-d[0], -d[1]];
		nd.out = [d[0], d[1]];
		c.push(nn);
		return { ok: true, n: c.length - 1 };
	}
	return { ok: true, n: splitAt(road, o.SEG[near.i], o.T[near.i]) };
}

/** A width point more on a run-off at s along its road: its index, or -1 off its stretch. */
export function addProfilePoint(road: Road, s: number): number {
	const al = road.along;
	if (!al || s <= al.from || s >= al.to) return -1;
	const w = Math.round(alongWidth(road, s) * 100) / 100;
	if (!road.profile?.length) road.profile = [[(al.from + al.to) / 2, road.width ?? RUNOFF_WIDTH]];
	road.profile.push([s, w]);
	road.profile.sort((a, b) => a[0] - b[0]);
	return road.profile.findIndex((q) => q[0] === s);
}

const flipped = <T extends PaintLine | Kerb>(item: T, length: number): void => {
	item.side = item.side === "left" ? "right" : "left";
	const f = item.from;
	const t = item.to;
	item.from = t == null ? 0 : length - t;
	item.to = f ? length - f : null;
};

/** The joints naming a road's ends told the road now runs the other way. */
function flipJointsTo(roads: readonly Road[], c: CurveNode[]): void {
	for (const n of [c[0], c.at(-1)]) {
		const jt = n?.joint;
		const other = jt && roads.find((r) => r.name === jt.road);
		if (!jt || !other?.curve) continue;
		const back = other.curve[endIndex(other, jt.node)].joint;
		if (back) back.node = back.node === "start" ? "end" : "start";
	}
}

/** Its end rows swapped and turned round. */
function flipEndRows(road: Road): void {
	const sl = road.end_left && ([-road.end_left[0], -road.end_left[1]] as Vec2);
	const el = road.start_left && ([-road.start_left[0], -road.start_left[1]] as Vec2);
	if (sl) road.start_left = sl;
	else delete road.start_left;
	if (el) road.end_left = el;
	else delete road.end_left;
}

/** The road the other way: its nodes, sides, lines and rumbles, and the joints naming its ends. */
export function reverseRoad(roads: readonly Road[], road: Road, length: number): void {
	const c = road.curve;
	if (!c) return;
	flipJointsTo(roads, c);
	if (road.start_left || road.end_left) flipEndRows(road);
	c.reverse();
	for (const n of c) {
		[n.in, n.out] = [n.out, n.in];
		[n.left, n.right] = [n.right, n.left];
	}
	for (const l of road.lines ?? []) flipped(l, length);
	for (const k of road.kerbs ?? []) flipped(k, length);
}

/** End node nd (the first: i 0) onto another road's centre line (its samples o), along it, as wide as it is. */
function snapEnd(nd: CurveNode, i: number, o: Samples): void {
	const q = pointAt(o, nearestOn(o, nd.p[0], nd.p[1]).s);
	const tx = q.nz; // (its way along: the left turned back)
	const tz = -q.nx;
	const h = i === 0 ? nd.out : nd.in;
	const len = Math.hypot(h[0], h[1]) || 3;
	const way = i === 0 ? 1 : -1;
	const sgn = Math.sign(tx * h[0] * way + tz * h[1] * way) || 1;
	nd.p = [q.x, q.z];
	const dir: Vec2 = [tx * sgn, tz * sgn];
	if (i === 0) nd.out = [dir[0] * len, dir[1] * len];
	else nd.in = [-dir[0] * len, -dir[1] * len];
	const same = sgn > 0;
	nd.left = same ? q.l : q.r;
	nd.right = same ? q.r : q.l;
}

/** Its first and last nodes onto the centre lines of the roads it joins (road.joins), along them, as wide as they are. geoOf: the samples of a road by name
 * (before the edit). */
export function snapEnds(road: Road, geoOf: (name: string) => Samples | null): void {
	const c = road.curve;
	if (!c) return;
	const j = road.joins ?? [];
	const ends: [number, string | null | undefined][] = [
		[0, j[0]],
		[c.length - 1, j[1]],
	];
	for (const [i, name] of ends) {
		const o = name ? geoOf(name) : null;
		if (o) snapEnd(c[i], i, o);
	}
}

/** A new road through points, smooth, 4 m each side. */
export function newRoad(name: string, points: Vec2[]): Road {
	const road: Road = {
		name,
		material: DEFAULT_MATERIAL,
		map: "flat",
		curve: points.map((p) => ({ p, in: [0, 0], out: [0, 0], left: 4, right: 4 })),
		lines: [],
		kerbs: [],
		moved: true,
	};
	autoHandles(road);
	return road;
}

/** A handle's length set, its way kept. */
export function setHandleLength(h: Vec2, v: number): Vec2 {
	const m = Math.hypot(h[0], h[1]) || 1;
	return [(h[0] / m) * v, (h[1] / m) * v];
}
