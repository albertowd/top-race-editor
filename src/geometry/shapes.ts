import { BACK_RAMP_COLOUR, DASH, GAP, KERB_COLOURS, kindOf } from "../domain/constants";
import type { Kerb, PaintLine, Road, Vec2 } from "../domain/types";
import { backRampOf, band, kerbPieces, lineOffsets, pieceOffsets } from "./paint";
import { geo, type Lookup } from "./roads";
import { type Samples, span } from "./samples";

/** A road's shapes in metres: its outline, its sides, its middle, its lines, its rumbles by colour. */
export interface RoadShapes {
	outline: Vec2[];
	/** its edges and its free ends (a joined end open: the road goes on there) */
	sides: Vec2[][];
	mid: Vec2[];
	white: Vec2[][];
	yellow: Vec2[][];
	kerbs: Map<string, Vec2[][]>;
}

interface Entry {
	o: Samples;
	deps: (Samples | null)[];
	shapes: RoadShapes;
}
const cache = new WeakMap<Road, Entry>();

function paintDeps(road: Road, find: Lookup): (Samples | null)[] {
	const deps: (Samples | null)[] = [];
	for (const k of road.kerbs ?? []) {
		for (const c of [k.before, k.after]) {
			if (!c) continue;
			const r = find(c.road);
			deps.push(r ? geo(r, find) : null);
		}
	}
	return deps;
}

/** A road's shapes, kept while it and the roads its rumbles go on along stay the same. */
export function roadShapes(road: Road, find: Lookup): RoadShapes | null {
	const o = geo(road, find);
	if (!o || o.X.length < 2) return null;
	const deps = paintDeps(road, find);
	const hit = cache.get(road);
	if (hit?.o === o && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.shapes;
	const shapes = makeShapes(road, o, find);
	cache.set(road, { o, deps, shapes });
	return shapes;
}

/** Its edges: left, right, its middle and its free ends (a joined end open: the road goes on there). */
function edges(road: Road, o: Samples): Pick<RoadShapes, "outline" | "sides" | "mid"> {
	const left: Vec2[] = [];
	const right: Vec2[] = [];
	const mid: Vec2[] = [];
	for (let i = 0; i < o.X.length; i++) {
		left.push([o.X[i] + o.nx[i] * o.L[i], o.Z[i] + o.nz[i] * o.L[i]]);
		right.push([o.X[i] - o.nx[i] * o.R[i], o.Z[i] - o.nz[i] * o.R[i]]);
		mid.push([o.X[i], o.Z[i]]);
	}
	const n = left.length;
	const free = (i: number) => !road.curve?.[i]?.joint;
	const sides: Vec2[][] = [left, right];
	if (free(0)) sides.push([left[0], right[0]]);
	if (road.curve && free(road.curve.length - 1)) sides.push([left[n - 1], right[n - 1]]);
	return { outline: left.concat(right.toReversed()), sides, mid };
}

/** A line's pieces (one, or its dashes). */
function lineBands(o: Samples, ln: PaintLine): Vec2[][] {
	const [s0, s1] = span(o, ln.from, ln.to);
	if (s1 <= s0) return [];
	const off = lineOffsets(ln);
	if (ln.style !== "dotted") return [band(o, s0, s1, off.a, off.b)];
	const dash = Math.max(ln.dash ?? DASH, 0.05);
	const gap = Math.max(ln.gap ?? GAP, 0.05);
	const out: Vec2[][] = [];
	for (let a = s0; a < s1 - 1e-6; a += dash + gap) out.push(band(o, a, Math.min(a + dash, s1), off.a, off.b, 0.1));
	return out;
}

/** A rumble's pieces, each with its colour: its stripes (a concrete one, one piece), a ramp's concrete, and its back ramp down to the road. */
function kerbBands(road: Road, k: Kerb, find: Lookup): [string, Vec2[]][] {
	const kind = kindOf(k.kind);
	const cols = KERB_COLOURS[kind];
	const out: [string, Vec2[]][] = [];
	for (const pc of kerbPieces(road, k, find)) {
		const off = pieceOffsets(k, pc);
		const step = kind === "concrete" ? pc.s1 - pc.s0 : 1;
		for (let s = pc.s0, j = 0; s < pc.s1 - 1e-6; s += step, j++) out.push([cols[j % 2], band(pc.o, s, Math.min(s + step, pc.s1), off.a, off.m, 0.25)]);
		if (kind === "ramp_concrete") out.push([KERB_COLOURS.concrete[0], band(pc.o, pc.s0, pc.s1, off.m, off.b, 0.25)]);
		if (backRampOf(k) > 0) out.push([BACK_RAMP_COLOUR, band(pc.o, pc.s0, pc.s1, off.b, off.c, 0.25)]);
	}
	return out;
}

function makeShapes(road: Road, o: Samples, find: Lookup): RoadShapes {
	const sh: RoadShapes = { ...edges(road, o), white: [], yellow: [], kerbs: new Map() };
	if (road.along) return sh;
	for (const ln of road.lines ?? []) (ln.colour === "yellow" ? sh.yellow : sh.white).push(...lineBands(o, ln));
	for (const k of road.kerbs ?? [])
		for (const [col, pts] of kerbBands(road, k, find)) {
			const list = sh.kerbs.get(col);
			if (list) list.push(pts);
			else sh.kerbs.set(col, [pts]);
		}
	return sh;
}
