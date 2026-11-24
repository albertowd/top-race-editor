// The objects laid (step 5; the track's place_objects.py, its game-neutral part): where each object's copies stand, each copy of its model as it lies there
// (shaped, placed or bent along its curve, on the floor under it), and its collision (a band along a wall, a box round each copy). What a game's build writes
// them as is its own (step 6).

import type { LightOptions } from "./lightoptions";
import { roundEven } from "./place";
import { distance } from "./polygon";
import { bezier, interp, linspace } from "./roads";
import { type CatalogueModel, type TemplatePart, world } from "./templates";

/** metres a model stands into the floor (the others: none): those standing on tyres, whose lowest edge curls in, so that no gap under it shows the stack's
 * inside */
export const SINKS: Record<string, number> = { tyre_stack: 0.03, gantry: 0.03 };
/** metres a wall's or a box's collision stands over its model */
export const COLLISION_OVER = 0.08;
/** metres: a collision wall's foot under the floor */
export const WALL_DOWN = 0.05;
/** metres: a tyre wall's spacing, unless it says */
export const SPACING = 0.62;

export type Floor = (x: number, z: number) => number;

/** An object of objects.json (version 3). */
export interface PlacedObject {
	name: string;
	model: string;
	curve: { p: [number, number]; in?: [number, number]; out?: [number, number] }[];
	heading?: number;
	closed?: boolean;
	spacing?: number;
	rows?: number;
	fit?: string;
	collision?: string;
	layouts?: string[];
	scale?: [number, number, number];
	/** its lights not as their series are (lightoptions.ts) */
	lights?: LightOptions;
}

/** A place a copy stands: x, z, heading. */
export type Place = [number, number, number];

/** np.gradient(P, axis=0) of points (x, z) evenly apart: halfway differences inside, one-sided at the ends. */
function gradient2(P: number[][]): number[][] {
	const n = P.length;
	const x = (i: number) => (P[i] as number[])[0] as number;
	const z = (i: number) => (P[i] as number[])[1] as number;
	return P.map((_, i) => {
		if (n < 2) return [0, 0];
		if (i === 0) return [x(1) - x(0), z(1) - z(0)];
		if (i === n - 1) return [x(n - 1) - x(n - 2), z(n - 1) - z(n - 2)];
		return [(x(i + 1) - x(i - 1)) / 2, (z(i + 1) - z(i - 1)) / 2];
	});
}

/** A curve's points (Bezier, every 0.02 m: roads.py's), closed back to its first; and its length to each. */
function curveOf(o: { curve: PlacedObject["curve"]; closed?: boolean }) {
	let nodes = o.curve.map((n) => ({ p: n.p, in: n.in ?? [0, 0], out: n.out ?? [0, 0], left: 0, right: 0 }));
	if (o.closed) nodes = [...nodes, { ...(nodes[0] as (typeof nodes)[number]) }];
	const P = bezier(nodes as never, 0.02).C.map((c) => [c[0] as number, c[1] as number]);
	const s = [0];
	for (let i = 1; i < P.length; i++) {
		const [ax, az] = P[i - 1] as [number, number];
		const [bx, bz] = P[i] as [number, number];
		s.push((s[i - 1] as number) + Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2));
	}
	return { P, s };
}

/** A wall's stacks (place_objects.wall_stacks): along its curve evenly, as many as make them no farther apart than spacing; an open one from its first node to
 * its last, a closed one round to its first again; rows to its right each a spacing further out. A single node: at it, turned to its heading. */
export function wallStacks(w: PlacedObject & { spacing?: number }): Place[] {
	if (!w.curve.length) return [];
	if (w.curve.length === 1) {
		const p = (w.curve[0] as PlacedObject["curve"][number]).p;
		return [[p[0], p[1], w.heading ?? 0]];
	}
	const { P, s } = curveOf(w);
	const L = s[s.length - 1] as number;
	const sp = Math.max(w.spacing ?? SPACING, 0.05);
	const n = Math.max(Math.ceil(L / sp - 1e-9), 1);
	const S = w.closed ? Array.from({ length: n }, (_, i) => i * (L / n)) : linspace(0, L, n + 1);
	const T = gradient2(P);
	const px = P.map((q) => q[0] as number);
	const pz = P.map((q) => q[1] as number);
	const tX = T.map((q) => q[0] as number);
	const tZ = T.map((q) => q[1] as number);
	const out: Place[] = [];
	const rows = Math.max(Math.trunc(w.rows ?? 1), 1);
	for (let r = 0; r < rows; r++) {
		const off = r * sp;
		for (const at of S) {
			const x = interp(at, s, px);
			const z = interp(at, s, pz);
			let a = interp(at, s, tX);
			let b = interp(at, s, tZ);
			const nrm = Math.hypot(a, b) + 1e-12;
			a /= nrm;
			b /= nrm;
			out.push([x + b * off, z - a * off, Math.atan2(a, b)]);
		}
	}
	return out;
}

/** Where an object's copies stand ('place'): as a tyre wall's stacks, no farther apart than its spacing (its model's depth unless it says). */
export const objectPlaces = (o: PlacedObject, size: number[]): Place[] => wallStacks({ ...o, spacing: o.spacing || (size[2] as number) });

/** An object's model as it lays it (place_objects.shaped): scaled (its normals and tangents kept square to it) and, bent along a curve, turned so its length
 * lies along it (a model wider than deep, as a fence panel). */
export function shaped(o: PlacedObject, parts: TemplatePart[], size: number[]): { parts: TemplatePart[]; size: number[] } {
	const sc = o.scale ?? [1, 1, 1];
	const turn = o.fit === "bend" && o.curve.length > 1 && (size[0] as number) > (size[2] as number);
	const out = parts.map((p) => {
		const V = Float64Array.from(p.V);
		for (let i = 0; i < V.length; i += 11) {
			for (let c = 0; c < 3; c++) {
				V[i + c] = (V[i + c] as number) * (sc[c] as number);
				V[i + 3 + c] = (V[i + 3 + c] as number) / (sc[c] as number);
				V[i + 8 + c] = (V[i + 8 + c] as number) * (sc[c] as number);
			}
			if (turn)
				for (const [a, b] of [
					[0, 2],
					[3, 5],
					[8, 10],
				] as const) {
					const va = V[i + a] as number;
					V[i + a] = -(V[i + b] as number);
					V[i + b] = va;
				}
			for (const a of [3, 8]) {
				const x = V[i + a] as number;
				const y = V[i + a + 1] as number;
				const z = V[i + a + 2] as number;
				const m = Math.max(Math.sqrt(x * x + y * y + z * z), 1e-12);
				V[i + a] = x / m;
				V[i + a + 1] = y / m;
				V[i + a + 2] = z / m;
			}
		}
		return { ...p, V };
	});
	let sz = size.map((v, i) => v * (sc[i] as number));
	if (turn) sz = [sz[2] as number, sz[1] as number, sz[0] as number];
	return { parts: out, size: sz };
}

/** metres up from a model's lowest point its base reaches (what it stands on: wheels, legs, a mast's foot) */
export const BASE = 0.1;
/** of the way out from its base's middle to its corners, where it is taken to touch */
export const EDGE_IN = 0.9;

/** A model's parts to stand it by: those not its hull (all of them where it is all hull). */
const standing = (parts: TemplatePart[]) => {
	const own = parts.filter((p) => p.part !== "hull");
	return own.length ? own : parts;
};

/** How many pieces a model's base is in (place_objects.feet): its faces with every corner within BASE of its lowest point, those sharing a corner (where it is,
 * to the millimetre) one piece. */
export function feet(parts: TemplatePart[]): number {
	return baseCorners(parts).length;
}

/** A model's base, by its pieces (as feet counts them): each piece's points (x, z). */
function baseCorners(parts: TemplatePart[]): [number, number][][] {
	const own = standing(parts);
	let low = Infinity;
	for (const p of own) for (let i = 1; i < p.V.length; i += 11) low = Math.min(low, p.V[i] as number);
	low += BASE;
	const parent = new Map<string, string>();
	const root = (a: string): string => {
		if (!parent.has(a)) parent.set(a, a);
		let r = a;
		while (parent.get(r) !== r) {
			const up = parent.get(parent.get(r) as string) as string;
			parent.set(r, up);
			r = up;
		}
		return r;
	};
	for (const p of own) {
		const key = (v: number) =>
			`${Math.round((p.V[v * 11] as number) * 1000)},${Math.round((p.V[v * 11 + 1] as number) * 1000)},${Math.round((p.V[v * 11 + 2] as number) * 1000)}`;
		for (let f = 0; f < p.F.length; f += 3) {
			const c = [p.F[f] as number, p.F[f + 1] as number, p.F[f + 2] as number];
			if (!c.every((v) => (p.V[v * 11 + 1] as number) < low)) continue;
			const a = root(key(c[0] as number));
			for (const v of c.slice(1)) {
				const b = root(key(v));
				if (a !== b) parent.set(b, a);
			}
		}
	}
	const pieces = new Map<string, [number, number][]>();
	for (const k of parent.keys()) {
		const [x, , z] = k.split(",").map((v) => Number(v) / 1000) as [number, number, number];
		const r = root(k);
		const l = pieces.get(r) ?? [];
		l.push([x, z]);
		pieces.set(r, l);
	}
	// (pieces nearer each other than a tenth of the base's width (FOOT_GAP at least) one foot: a leg's posts and the tyres round them)
	const all = [...pieces.values()].flat();
	const span = Math.max(
		Math.max(...all.map((v) => v[0])) - Math.min(...all.map((v) => v[0])),
		Math.max(...all.map((v) => v[1])) - Math.min(...all.map((v) => v[1])),
	);
	const gap = Math.max(FOOT_GAP, span / 10);
	const feetOf: [number, number][][] = [];
	const box = (q: [number, number][]) =>
		[Math.min(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1])), Math.max(...q.map((v) => v[0])), Math.max(...q.map((v) => v[1]))] as const;
	const near = (a: readonly number[], b: readonly number[]) =>
		(a[0] as number) <= (b[2] as number) + gap &&
		(b[0] as number) <= (a[2] as number) + gap &&
		(a[1] as number) <= (b[3] as number) + gap &&
		(b[1] as number) <= (a[3] as number) + gap;
	for (const q of pieces.values()) {
		let into = q;
		for (let k = feetOf.length - 1; k >= 0; k--)
			if (near(box(feetOf[k] as [number, number][]), box(into))) {
				into = [...(feetOf[k] as [number, number][]), ...into];
				feetOf.splice(k, 1);
			}
		feetOf.push(into);
	}
	return feetOf;
}

/** metres between a model's base pieces that are one foot, at least (a tenth of its base's width where more) */
const FOOT_GAP = 0.3;

/** Where each copy of a model rests on the floor (place_objects.rest_heights): a model on feet (its base in two pieces or more) by the floor under each foot,
 * its middle and corners (EDGE_IN of the way out, turned to its heading): one on three or more (wheels, legs) on the highest any foot touches, as such a thing
 * rests; one on two (a gantry's legs, a sign's posts) on the lowest floor under either, the rest of both sunk in where the ground is higher, so no part of
 * either stands in the air (never on the open span between them, which a gantry over a road would be lifted by); one on a base of a piece (a tyre stack's, a
 * cone's, a mast's foot) on the floor under its middle. */
export function restHeights(parts: TemplatePart[], places: Place[], floor: Floor): number[] {
	const pieces = baseCorners(parts);
	if (pieces.length < 2) return places.map(([x, z]) => floor(x, z));
	// (each foot's middle and corners, EDGE_IN of the way out)
	const feetAt = pieces.map((q) => {
		const lo = [Math.min(...q.map((v) => v[0])), Math.min(...q.map((v) => v[1]))] as [number, number];
		const hi = [Math.max(...q.map((v) => v[0])), Math.max(...q.map((v) => v[1]))] as [number, number];
		const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2] as [number, number];
		const at = (c: 0 | 1, e: number) => mid[c] + (e - mid[c]) * EDGE_IN;
		const xs = [mid[0], at(0, lo[0]), at(0, lo[0]), at(0, hi[0]), at(0, hi[0])];
		const zs = [mid[1], at(1, lo[1]), at(1, hi[1]), at(1, lo[1]), at(1, hi[1])];
		const Q = new Float64Array(5 * 11);
		for (let k = 0; k < 5; k++) {
			Q[k * 11] = xs[k] as number;
			Q[k * 11 + 2] = zs[k] as number;
		}
		return Q;
	});
	return places.map(([x, z, h]) => {
		const ys = feetAt.flatMap((Q) => {
			const W = world(Q, x, z, 0, h);
			return [0, 1, 2, 3, 4].map((k) => floor(W[k * 11] as number, W[k * 11 + 2] as number));
		});
		return pieces.length === 2 ? Math.min(...ys) : Math.max(...ys);
	});
}

/** An object's model at each of its places (place_objects.object_placed): each copy resting on the floor (restHeights), less its sink (its hull out: a dynamic
 * one's alone). */
export function objectPlaced(o: PlacedObject, parts: TemplatePart[], places: Place[], floor: Floor): TemplatePart[] {
	const sink = SINKS[o.model] ?? 0;
	const ys = restHeights(parts, places, floor);
	return parts
		.filter((p) => p.part !== "hull")
		.map((p) => {
			const nv = p.V.length / 11;
			const V = new Float64Array(p.V.length * places.length);
			const F = new Int32Array(p.F.length * places.length);
			places.forEach(([x, z, h], k) => {
				V.set(world(p.V, x, z, (ys[k] as number) - sink, h), k * p.V.length);
				for (let i = 0; i < p.F.length; i++) F[k * p.F.length + i] = (p.F[i] as number) + k * nv;
			});
			return { ...p, V, F };
		});
}

/** An object's model bent along its curve ('bend'; place_objects.object_bent): as many copies end to end as fit it whole, each stretched to fill its share, its
 * points across it out to its right, on the floor there. */
export function objectBent(o: PlacedObject, parts: TemplatePart[], size: number[], floor: Floor): TemplatePart[] {
	const { P, s } = curveOf(o);
	const T = gradient2(P).map(([a, b]) => {
		const m = Math.max(Math.sqrt((a as number) ** 2 + (b as number) ** 2), 1e-12);
		return [(a as number) / m, (b as number) / m];
	});
	const px = P.map((q) => q[0] as number);
	const pz = P.map((q) => q[1] as number);
	const tX = T.map((q) => q[0] as number);
	const tZ = T.map((q) => q[1] as number);
	const vis = parts.filter((p) => p.part !== "hull");
	let z0 = Infinity;
	let z1 = -Infinity;
	for (const p of vis)
		for (let i = 2; i < p.V.length; i += 11) {
			z0 = Math.min(z0, p.V[i] as number);
			z1 = Math.max(z1, p.V[i] as number);
		}
	const Lm = Math.max(z1 - z0, 1e-6);
	const L = s[s.length - 1] as number;
	const n = Math.max(roundEven(L / Lm), 1);
	const k = L / (n * Lm);
	const sink = SINKS[o.model] ?? 0;
	const rows = Math.max(Math.trunc(o.rows ?? 1), 1);
	const across = o.spacing || (size[0] as number);
	return vis.map((p) => {
		const nv = p.V.length / 11;
		const V = new Float64Array(p.V.length * rows * n);
		const F = new Int32Array(p.F.length * rows * n);
		let c = 0;
		for (let r = 0; r < rows; r++)
			for (let i = 0; i < n; i++) {
				for (let v = 0; v < nv; v++) {
					const o0 = v * 11;
					const at = (i * L) / n + ((p.V[o0 + 2] as number) - z0) * k;
					const fx = interp(at, s, tX);
					const fz = interp(at, s, tZ);
					const rx = fz;
					const rz = -fx;
					const off = (p.V[o0] as number) + r * across;
					const d = (c * nv + v) * 11;
					for (let j = 0; j < 11; j++) V[d + j] = p.V[o0 + j] as number;
					V[d] = interp(at, s, px) + rx * off;
					V[d + 2] = interp(at, s, pz) + rz * off;
					V[d + 1] = floor(V[d] as number, V[d + 2] as number) + (p.V[o0 + 1] as number) - sink;
					for (const [a, b] of [
						[3, 5],
						[8, 10],
					] as const) {
						const va = p.V[o0 + a] as number;
						const vb = p.V[o0 + b] as number;
						V[d + a] = rx * va + fx * vb;
						V[d + b] = rz * va + fz * vb;
					}
				}
				for (let f = 0; f < p.F.length; f++) F[c * p.F.length + f] = (p.F[f] as number) + c * nv;
				c++;
			}
		return { ...p, V, F };
	});
}

/** A wall's collision: one closed solid round its stacks (from half out of the outermost rows on one side to half out of them on the other), from WALL_DOWN
 * under the floor to high over it: its two sides, its top, its bottom and its ends (none for a ring), every face one way only, facing out (as box's). Not two
 * open sheets hit from either side: a kart driven hard into one of those could be pushed through to its far side, into the hollow between them or out under the
 * track. Points (x, y, z), faces. */
export function wallBand(w: PlacedObject, stacks: Place[], half: number, high: number, floor: Floor) {
	const rows = Math.max(Math.trunc(w.rows ?? 1), 1);
	const first = rows > 1 ? stacks.slice(0, Math.trunc(stacks.length / rows)) : stacks;
	let line: number[][];
	if (first.length < 2) {
		const [x, z, h] = first[0] ?? [0, 0, 0];
		line = [
			[x - Math.sin(h) * half, z - Math.cos(h) * half],
			[x + Math.sin(h) * half, z + Math.cos(h) * half],
		];
	} else line = first.map(([x, z]) => [x, z]);
	const ring = !!w.closed && line.length > 2;
	const n = line.length;
	// (the way along at each point: a ring's round from the point before its first to the one after its last, each point once, its last joined to its first)
	const ways = ring
		? line.map((_, j) => {
				const a = line[(j + n - 1) % n] as number[];
				const b = line[(j + 1) % n] as number[];
				return [(b[0] as number) - (a[0] as number), (b[1] as number) - (a[1] as number)];
			})
		: gradient2(line);
	const t = ways.map(([a, b]) => {
		const m = Math.max(Math.sqrt((a as number) ** 2 + (b as number) ** 2), 1e-12);
		return [(a as number) / m, (b as number) / m];
	});
	const sp = w.spacing ?? SPACING;
	const P: number[] = [];
	const F: number[] = [];
	// (each point along: its bottom and top on the near side, then on the far side: four points, 4j to 4j + 3)
	const offs = [-half, (rows - 1) * sp + half];
	line.forEach((q, j) => {
		const tt = t[j] as number[];
		for (const off of offs) {
			const x = (q[0] as number) + (tt[1] as number) * off;
			const z = (q[1] as number) + -(tt[0] as number) * off;
			const y = floor(x, z);
			P.push(x, y - WALL_DOWN, z, x, y + high, z);
		}
	});
	const at = (k: number, c: number) => P[k * 3 + c] as number;
	// (a triangle wound to face out: its normal ((b - a) x (c - a), as box's) the way out says)
	const tri = (a: number, b: number, c: number, out: readonly number[]) => {
		const [ux, uy, uz] = [at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)];
		const [vx, vy, vz] = [at(c, 0) - at(a, 0), at(c, 1) - at(a, 1), at(c, 2) - at(a, 2)];
		const facing = (uy * vz - uz * vy) * (out[0] as number) + (uz * vx - ux * vz) * (out[1] as number) + (ux * vy - uy * vx) * (out[2] as number);
		if (facing < 0) F.push(a, c, b);
		else F.push(a, b, c);
	};
	const quad = (a: number, b: number, c: number, d: number, out: readonly number[]) => {
		tri(a, b, c, out);
		tri(a, c, d, out);
	};
	for (let j = 0; j < (ring ? n : n - 1); j++) {
		const [a, b] = [4 * j, 4 * ((j + 1) % n)];
		// (out of each side: across the line, away from the other; up; down)
		const tt = t[j] as number[];
		const across = [tt[1] as number, 0, -(tt[0] as number)];
		const away = [-(tt[1] as number), 0, tt[0] as number];
		quad(a, b, b + 1, a + 1, away);
		quad(a + 2, b + 2, b + 3, a + 3, across);
		quad(a + 1, b + 1, b + 3, a + 3, [0, 1, 0]);
		quad(a, b, b + 2, a + 2, [0, -1, 0]);
	}
	if (!ring) {
		// (its ends: back the way it came at its start, on at its end)
		const t0 = t[0] as number[];
		const t1 = t[n - 1] as number[];
		quad(0, 1, 3, 2, [-(t0[0] as number), 0, -(t0[1] as number)]);
		const e = 4 * (n - 1);
		quad(e, e + 1, e + 3, e + 2, [t1[0] as number, 0, t1[1] as number]);
	}
	return { P: Float64Array.from(P), F: Int32Array.from(F) };
}

/** A box's points (eight, x y z) and faces (twelve, facing out): place_objects.box. */
export function box(lo: number[], hi: number[]) {
	const P: number[] = [];
	for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) P.push(x as number, y as number, z as number);
	const F = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
	return { P, F };
}

/** An object laid: its copies' parts in the world, its collision (a wall's band; a static one's boxes), its places. */
export interface LaidObject {
	name: string;
	model: string;
	layouts?: string[];
	collision: string;
	places: Place[];
	size: number[];
	/** its parts in the world (none for a dynamic one: a game's build places its model as it takes it) */
	parts: (TemplatePart & { lod?: [number, number] })[];
	wall?: { P: Float64Array; F: Int32Array };
	/** a static one's boxes, each eight points (x, y, z) in the world */
	boxes?: number[][];
	/** its lights not as their series are (lightoptions.ts) */
	lights?: LightOptions;
}

/** An object laid on the floor (place_objects.objects' game-neutral part). */
export function layObject(o: PlacedObject, meta: CatalogueModel, template: TemplatePart[], floor: Floor): LaidObject {
	const { parts, size } = shaped(o, template, meta.size);
	const single = o.curve.length === 1;
	const coll = o.collision || "none";
	const places: Place[] = single
		? [[(o.curve[0] as PlacedObject["curve"][number]).p[0], (o.curve[0] as PlacedObject["curve"][number]).p[1], o.heading ?? 0]]
		: objectPlaces(o, size);
	const out: LaidObject = {
		name: o.name,
		model: o.model,
		layouts: o.layouts,
		collision: coll,
		places,
		size,
		parts: [],
		...(o.lights ? { lights: o.lights } : {}),
	};
	if (coll === "dynamic" && single) return out;
	const laid = o.fit === "bend" && !single ? objectBent(o, parts, size, floor) : objectPlaced(o, parts, places, floor);
	out.parts = laid.map((p) => ({ ...p, lod: meta.lods?.[p.part] ?? meta.draw }));
	if (coll === "wall" && !single) out.wall = wallBand(o, places, (size[0] as number) / 2, (size[1] as number) + COLLISION_OVER, floor);
	else if (coll === "static" || coll === "wall") {
		const hull = parts.find((p) => p.part === "hull");
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (const p of hull ? [hull] : parts)
			for (let i = 0; i < p.V.length; i += 11)
				for (let c = 0; c < 3; c++) {
					lo[c] = Math.min(lo[c] as number, p.V[i + c] as number);
					hi[c] = Math.max(hi[c] as number, p.V[i + c] as number);
				}
		hi[1] = (hi[1] as number) + COLLISION_OVER;
		const { P } = box(lo, hi);
		const W = new Float64Array(8 * 11);
		for (let i = 0; i < 8; i++) {
			W.set(P.slice(i * 3, i * 3 + 3), i * 11);
			W[i * 11 + 4] = 1;
		}
		// (as high as the copies rest)
		const ys = restHeights(parts, places, floor);
		out.boxes = places.map(([x, z, h], k) => {
			const B = world(W, x, z, ys[k] as number, h);
			const pts: number[] = [];
			for (let i = 0; i < 8; i++) pts.push(B[i * 11] as number, B[i * 11 + 1] as number, B[i * 11 + 2] as number);
			return pts;
		});
	}
	return out;
}

/** metres round a solid object (a static box, a wall) no tree stands */
export const TREE_CLEAR = 0.5;

/** A tree of a track's forest (velopark_trees.json's trees): its variant, x, y, z, and the rest. */
export type Tree = [string, number, number, number, ...number[]];

/** The trees whose trunks stand on a solid object's ground, TREE_CLEAR round it (place_objects.clear_trees' gone): a static object's boxes' footprints, a
 * wall's band (half its model's width each side of its places' line). Their places in the list. (shapely's buffer draws its rounded corners in short straight
 * pieces: a trunk within a hair of one may fall the other side.) */
export function treesGone(trees: Tree[], laid: LaidObject[]): number[] {
	const rings: number[][][] = [];
	const lines: { P: [number, number][]; r: number }[] = [];
	for (const o of laid) {
		for (const b of o.boxes ?? []) rings.push([0, 1, 5, 4].map((i) => [b[i * 3] as number, b[i * 3 + 2] as number]));
		if (o.wall && o.places.length > 1) lines.push({ P: o.places.map(([x, z]) => [x, z]), r: (o.size[0] as number) / 2 });
	}
	const toSegment = (x: number, z: number, a: [number, number], b: [number, number]) => {
		const dx = b[0] - a[0];
		const dz = b[1] - a[1];
		const L2 = dx * dx + dz * dz;
		const t = L2 > 0 ? Math.min(Math.max(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0), 1) : 0;
		return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
	};
	const out: number[] = [];
	trees.forEach((t, i) => {
		const x = t[1];
		const z = t[3];
		const onBox = rings.some((r) => distance(r, x, z) <= TREE_CLEAR);
		const onWall =
			!onBox &&
			lines.some(({ P, r }) => {
				for (let k = 0; k + 1 < P.length; k++) if (toSegment(x, z, P[k] as [number, number], P[k + 1] as [number, number]) <= r + TREE_CLEAR) return true;
				return false;
			});
		if (onBox || onWall) out.push(i);
	});
	return out;
}
