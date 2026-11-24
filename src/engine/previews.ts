// The page's looks at the roads as the build makes them (geometry.py's mesh and surface), level (no heights read: the seams and cuts are what they are for): a
// road's mesh, cut where the roads above it lie; the surface merged in a window of the map, proved.

import { ClipType } from "clipper2-js";
import { area2, check, type Filler, MergeCache, type Mesh, merge, metres, type Poly, type Pt, polysOf, toPaths, unit } from "./merge";
import type { Roads } from "./paint";
import { asBuilt, centre, mesh, outline, priority, type RoadDesc } from "./roads";
import { roadRegions } from "./roadshost";
import { type Box, TileIndex } from "./tiles";

/** square metres: a face this small has no normal to speak of (geometry.py's THIN) */
export const THIN = 1e-6;
/** wrong faces said, at most, of each kind (geometry.py's WRONG_MAX) */
export const WRONG_MAX = 2000;

const level = () => 0;

/** A mesh's faces that would be wrong in the game: those facing down or on edge (a road's face looks up), and those with no area to speak of (no normal of
 * their own). Their indices. */
export function wrongFaces(P: ArrayLike<number>, F: ArrayLike<number>): { down: number[]; thin: number[] } {
	const down: number[] = [];
	const thin: number[] = [];
	for (let f = 0; f * 3 < F.length; f++) {
		const [a, b, c] = [F[f * 3] as number, F[f * 3 + 1] as number, F[f * 3 + 2] as number];
		const u = [0, 1, 2].map((k) => (P[b * 3 + k] as number) - (P[a * 3 + k] as number)) as [number, number, number];
		const v = [0, 1, 2].map((k) => (P[c * 3 + k] as number) - (P[a * 3 + k] as number)) as [number, number, number];
		const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] as const;
		const area = Math.hypot(n[0], n[1], n[2]) / 2;
		if (area < THIN) {
			if (thin.length < WRONG_MAX) thin.push(f);
		} else if (n[1] <= 1e-9 * Math.max(area, 1e-12) && down.length < WRONG_MAX) down.push(f);
	}
	return { down, thin };
}

/** A road's extent (x0, z0, x1, z1), with its widths (roads.py's box). */
function extent(road: RoadDesc, roads: Record<string, RoadDesc>): [number, number, number, number] {
	const { C } = centre(asBuilt(road, roads));
	let w = -Infinity;
	const b = [Infinity, Infinity, -Infinity, -Infinity] as [number, number, number, number];
	for (const c of C) {
		w = Math.max(w, c[2] as number, c[3] as number);
		b[0] = Math.min(b[0], c[0] as number);
		b[1] = Math.min(b[1], c[1] as number);
		b[2] = Math.max(b[2], c[0] as number);
		b[3] = Math.max(b[3], c[1] as number);
	}
	w += 0.5;
	return [b[0] - w, b[1] - w, b[2] + w, b[3] + w];
}

/** The roads joined end to end to a road's ends (its curve's nodes' joints). */
const joinedTo = (road: RoadDesc) => new Set(((road.curve ?? []) as { joint?: { road?: string } }[]).flatMap((n) => (n.joint?.road ? [n.joint.road] : [])));

/** The roads built before a road whose extent meets its own, but those joined end to end to it: those it is cut by where it lies
 * under them (roads.py's above). */
export function above(road: RoadDesc, roads: Record<string, RoadDesc>): string[] {
	const order = priority(roads);
	const at = order.indexOf(road.name);
	if (at < 0) return [];
	const mine = extent(road, roads);
	const ends = joinedTo(road);
	const out: string[] = [];
	for (const x of order.slice(0, at)) {
		const r = roads[x] as RoadDesc;
		if (ends.has(x) || joinedTo(r).has(road.name)) continue;
		const b = extent(r, roads);
		if (b[0] < mine[2] && b[2] > mine[0] && b[1] < mine[3] && b[3] > mine[1]) out.push(x);
	}
	return out;
}

const ringOf = (pts: number[][]): Pt[] => pts.map(([x, z]) => [unit(x as number), unit(z as number)] as Pt);
const polyOf = (pts: number[][]): Poly => ({ outer: ringOf(pts), holes: [] });
const polysArea = (ps: Poly[]) => ps.reduce((s, p) => s + area2(p.outer) + p.holes.reduce((h, r) => h + area2(r), 0), 0) / 2;

/** grid units² (twice the area) under which a piece of a face cut is no face (THIN: a sliver an edge above left passing by its corner) */
const SLIVER2 = (2 * THIN) / 1e-8;
/** grid units: the cells the shape above is cut in, at the least (2 m), and its points a cell at the most */
const LEAF = 20000;
const LEAF_POINTS = 48;

/** A simple ring (grid points, anticlockwise) in triangles, ear by ear: of the ears, the roundest first; none a sliver. */
function ears(r: Pt[]): [Pt, Pt, Pt][] {
	const out: [Pt, Pt, Pt][] = [];
	const v = [...r];
	const cross = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
	const within = (p: Pt, a: Pt, b: Pt, c: Pt) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
	const d2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
	while (v.length > 3) {
		let best = -1;
		let quality = -1;
		for (let i = 0; i < v.length; i++) {
			const a = v[(i + v.length - 1) % v.length] as Pt;
			const b = v[i] as Pt;
			const c = v[(i + 1) % v.length] as Pt;
			const area = cross(a, b, c);
			if (area < SLIVER2) continue;
			if (v.some((p) => p !== a && p !== b && p !== c && within(p, a, b, c))) continue;
			const q = area / (d2(a, b) + d2(b, c) + d2(c, a));
			if (q > quality) {
				quality = q;
				best = i;
			}
		}
		if (best < 0) {
			// (none but where three points lie in line, or as near as a sliver: the middle one of the nearest dropped)
			let i = -1;
			let least = SLIVER2;
			v.forEach((b, j) => {
				const c = Math.abs(cross(v[(j + v.length - 1) % v.length] as Pt, b, v[(j + 1) % v.length] as Pt));
				if (c < least) {
					least = c;
					i = j;
				}
			});
			if (i < 0) break;
			v.splice(i, 1);
			continue;
		}
		out.push([v[(best + v.length - 1) % v.length] as Pt, v[best] as Pt, v[(best + 1) % v.length] as Pt]);
		v.splice(best, 1);
	}
	if (v.length === 3) out.push([v[0] as Pt, v[1] as Pt, v[2] as Pt]);
	return out;
}

type Bounds = [number, number, number, number];
const boxPoly = ([x0, z0, x1, z1]: Bounds): Poly => ({
	outer: [
		[x0, z0],
		[x1, z0],
		[x1, z1],
		[x0, z1],
	],
	holes: [],
});
const pointsOf = (ps: Poly[]) => ps.reduce((n, p) => n + p.outer.length + p.holes.reduce((h, r) => h + r.length, 0), 0);

/** A shape cut in cells, each halved till its part has few points or is small (its part all the cell, or not). */
function leaves(polys: Poly[], b: Bounds, out: { b: Bounds; polys: Poly[]; full: boolean }[], depth = 0): void {
	if (!polys.length) return;
	const area = (b[2] - b[0]) * (b[3] - b[1]);
	const full = Math.abs(polysArea(polys) - area) < 1;
	if (full || pointsOf(polys) <= LEAF_POINTS || b[2] - b[0] <= LEAF || depth > 20) {
		out.push({ b, polys: full ? [boxPoly(b)] : polys, full });
		return;
	}
	const mx = Math.round((b[0] + b[2]) / 2);
	const mz = Math.round((b[1] + b[3]) / 2);
	for (const q of [
		[b[0], b[1], mx, mz],
		[mx, b[1], b[2], mz],
		[b[0], mz, mx, b[3]],
		[mx, mz, b[2], b[3]],
	] as Bounds[])
		leaves(polysOf(ClipType.Intersection, toPaths(polys), toPaths([boxPoly(q)])), q, out, depth + 1);
}

/** A level mesh (points x y z, faces) with the part under a shape cut out: the faces across its edge kept as their parts outside it (restyle_paddock's
 * clip_in), one mesh still. Its points (x, z) and faces. The shape cut in cells first: a face in none kept, one wholly in a cell it fills gone, any other
 * clipped by the cells' parts it meets. */
function cutOut(P: Float64Array, F: Int32Array, over: Poly[]): { P: number[]; F: number[] } {
	const all: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
	for (const p of over)
		for (const [x, z] of p.outer) {
			all[0] = Math.min(all[0], x);
			all[1] = Math.min(all[1], z);
			all[2] = Math.max(all[2], x);
			all[3] = Math.max(all[3], z);
		}
	const cells: { b: Bounds; polys: Poly[]; full: boolean }[] = [];
	if (Number.isFinite(all[0])) leaves(over, all, cells);
	const index = new TileIndex<number>(LEAF * 2);
	cells.forEach((c, i) => {
		index.add({ x0: c.b[0], z0: c.b[1], x1: c.b[2], z1: c.b[3] }, i);
	});
	// (its own points as they are, each a grid point's too; the cut's new points after them)
	const outP: number[] = [];
	const ids = new Map<string, number>();
	for (let i = 0; i < P.length; i += 3) {
		outP.push(P[i] as number, P[i + 2] as number);
		const k = `${unit(P[i] as number)},${unit(P[i + 2] as number)}`;
		if (!ids.has(k)) ids.set(k, i / 3);
	}
	const outF: number[] = [];
	const id = (x: number, z: number) => {
		const k = `${x},${z}`;
		let i = ids.get(k);
		if (i === undefined) {
			i = outP.length / 2;
			ids.set(k, i);
			outP.push(metres(x), metres(z));
		}
		return i;
	};
	const keep = (f: number) => outF.push(F[f] as number, F[f + 1] as number, F[f + 2] as number);
	for (let f = 0; f < F.length; f += 3) {
		const t = [F[f], F[f + 1], F[f + 2]].map((v) => [unit(P[(v as number) * 3] as number), unit(P[(v as number) * 3 + 2] as number)] as Pt) as [Pt, Pt, Pt];
		const x0 = Math.min(t[0][0], t[1][0], t[2][0]);
		const x1 = Math.max(t[0][0], t[1][0], t[2][0]);
		const z0 = Math.min(t[0][1], t[1][1], t[2][1]);
		const z1 = Math.max(t[0][1], t[1][1], t[2][1]);
		const near = index
			.find({ x0, z0, x1, z1 })
			.map((i) => cells[i] as (typeof cells)[number])
			.filter(({ b }) => b[0] < x1 && b[2] > x0 && b[1] < z1 && b[3] > z0);
		const a = area2(t);
		if (!near.length || a === 0) {
			keep(f);
			continue;
		}
		if (near.some(({ b, full }) => full && b[0] <= x0 && b[2] >= x1 && b[1] <= z0 && b[3] >= z1)) continue;
		const ring = a > 0 ? t : ([t[0], t[2], t[1]] as [Pt, Pt, Pt]);
		const left = polysOf(ClipType.Difference, toPaths([{ outer: ring, holes: [] }]), toPaths(near.flatMap((c) => c.polys)));
		if (Math.abs(polysArea(left) - Math.abs(a) / 2) < 1) {
			keep(f);
			continue;
		}
		// (its parts outside, each facing as the face did; a part with a hole would need a road above narrower than a face: none is)
		for (const piece of left)
			for (const [p, q, r] of ears(piece.outer)) {
				// (none a sliver, nor turned over, as its points are written: the face's own as they are, a hair off the grid)
				const [i, j, k] = (a > 0 ? [p, q, r] : [p, r, q]).map((s) => id(s[0], s[1])) as [number, number, number];
				const ux = (outP[j * 2] as number) - (outP[i * 2] as number);
				const uz = (outP[j * 2 + 1] as number) - (outP[i * 2 + 1] as number);
				const vx = (outP[k * 2] as number) - (outP[i * 2] as number);
				const vz = (outP[k * 2 + 1] as number) - (outP[i * 2 + 1] as number);
				if ((Math.sign(a) * (ux * vz - uz * vx)) / 2 >= THIN) outF.push(i, j, k);
			}
	}
	// (the points no face has left out)
	const used = new Int32Array(outP.length / 2).fill(-1);
	const P2: number[] = [];
	const F2 = outF.map((v) => {
		if ((used[v] as number) < 0) {
			used[v] = P2.length / 2;
			P2.push(outP[v * 2] as number, outP[v * 2 + 1] as number);
		}
		return used[v] as number;
	});
	return { P: P2, F: F2 };
}

const round = (x: number, n: number) => Math.round(x * 10 ** n) / 10 ** n;

/** A road's mesh as the build makes it, level: cut where it lies under the roads above it (the page's order); its points (x, z), faces, the roads it is cut
 * under, its faces that would be wrong in the game (geometry.py's mesh). */
export function roadPreview(given: RoadDesc, list: RoadDesc[]) {
	const { heights: _h, ...road } = given;
	const roads: Record<string, RoadDesc> = Object.fromEntries(list.map((r) => [r.name, { ...r, heights: null }]));
	roads[road.name] = road;
	const m = mesh(asBuilt(road, roads), level);
	const ups = above(road, roads);
	let P: number[] = [];
	let F: number[] = Array.from(m.F);
	for (let i = 0; i < m.P.length; i += 3) P.push(m.P[i] as number, m.P[i + 2] as number);
	if (ups.length) {
		// (the roads above, only near it: quick)
		const mine = polysOf(ClipType.Union, toPaths([polyOf(outline(road, roads))]), null);
		const all = polysOf(ClipType.Union, toPaths(ups.map((x) => polyOf(outline(roads[x] as RoadDesc, roads)))), null);
		// (within its box and half a metre: Shapely's buffer of it, the Python's, clipper2-js's offset gets wrong)
		const [x0, z0, x1, z1] = extent(road, roads).map(unit) as Bounds;
		const over = polysOf(ClipType.Intersection, toPaths(all), toPaths([boxPoly([x0, z0, x1, z1])]));
		const under = polysOf(ClipType.Intersection, toPaths(over), toPaths(mine));
		if (polysArea(under) * 1e-8 > 1e-3) ({ P, F } = cutOut(m.P, m.F, over));
	}
	const P3 = new Float64Array((P.length / 2) * 3);
	for (let i = 0; i < P.length / 2; i++) {
		P3[i * 3] = P[i * 2] as number;
		P3[i * 3 + 2] = P[i * 2 + 1] as number;
	}
	return { P: P.map((x) => round(x, 3)), F, under: ups, wrong: wrongFaces(P3, F) };
}

const caches = new Map<string, MergeCache>();

/** The surface in a window of the map as the build makes it, level (the seams are what it is for): each region's faces (x, z) and kind, its problems
 * (geometry.py's surface). */
export async function surfacePreview(list: RoadDesc[], window: [number, number, number, number], filler: Filler, key = "") {
	const t0 = performance.now();
	const roads: Record<string, RoadDesc> = Object.fromEntries(list.map((r) => [r.name, { ...r, heights: null }]));
	const [x0, z0, x1, z1] = window.map(Number) as [number, number, number, number];
	const w: Box = { x0, z0, x1, z1 };
	const built = priority(roads).map((n) => ({ name: n, m: mesh(asBuilt(roads[n] as RoadDesc, roads), level) }));
	const regions = roadRegions(roads as Roads, built, w, level);
	const kinds = new Map<string, string>(regions.map((r) => [r.name, built.some((b) => b.name === r.name) ? "road" : "rumble"]));
	regions.push({ name: "ground", ground: { height: level, uv: (x, z) => [x / 50, z / 50], spacing: 2 } });
	kinds.set("ground", "ground");
	let cache = caches.get(key);
	if (!cache) {
		cache = new MergeCache();
		caches.set(key, cache);
	}
	const out: Record<string, Mesh> = await merge(regions, w, filler, { cache });
	const issues: [string, number, number, number][] = check(out, w).map((i) => [i.what, i.x, i.z, i.much]);
	// (and its faces that would be wrong in the game: down, or with no area; ringed as the seams are)
	for (const m of Object.values(out)) {
		const bad = wrongFaces(m.P, m.F);
		for (const [what, ids] of [
			["face down", bad.down],
			["face without area", bad.thin],
		] as const)
			for (const f of ids.slice(0, 200)) {
				const v = [m.F[f * 3], m.F[f * 3 + 1], m.F[f * 3 + 2]] as number[];
				const c = (k: number) => v.reduce((s, i) => s + (m.P[i * 3 + k] as number), 0) / 3;
				issues.push([what, c(0), c(2), 0]);
			}
	}
	return {
		regions: Object.entries(out).map(([name, m]) => {
			const P: number[] = [];
			for (let i = 0; i < m.P.length; i += 3) P.push(round(m.P[i] as number, 4), round(m.P[i + 2] as number, 4));
			return { name, kind: kinds.get(name) ?? "road", P, F: Array.from(m.F) };
		}),
		issues: issues.map(([w, x, z, h]) => [w, round(x, 3), round(z, 3), round(h, 4)]),
		window: [x0, z0, x1, z1],
		seconds: round((performance.now() - t0) / 1000, 1),
	};
}
