import { isDraft } from "immer";
import { RUNOFF_EASE, RUNOFF_WIDTH } from "../domain/constants";
import type { Road, Vec2 } from "../domain/types";
import { smooth } from "./bezier";
import { endsTurned, finishSamples, pointAt, type RawSamples, type Samples, sampleCurve } from "./samples";

/** A road by its name, among the roads it was made for. */
export type Lookup = (name: string) => Road | undefined;

const lookups = new WeakMap<readonly Road[], Lookup>();

export function lookup(roads: readonly Road[]): Lookup {
	if (isDraft(roads)) return (name) => roads.find((r) => r.name === name);
	let found = lookups.get(roads);
	if (!found) {
		const byName = new Map<string, Road>();
		for (const r of roads) if (!byName.has(r.name)) byName.set(r.name, r);
		found = (name) => byName.get(name);
		lookups.set(roads, found);
	}
	return found;
}

/** A road's samples, kept while what they are made of stays the same (the roads are never changed in place: a changed road is a new object, its unchanged parts
 * the same objects). */
interface CurveEntry {
	start_left?: Vec2;
	end_left?: Vec2;
	geo: Samples;
}
interface AlongEntry {
	parent: Samples | null;
	profile?: Vec2[];
	width?: number;
	ease?: number;
	geo: Samples | null;
}
const curveCache = new WeakMap<object, CurveEntry>();
const alongCache = new WeakMap<object, AlongEntry>();

/** A road's samples: its curve's, or a run-off's along its road's edge; null with no shape. */
export function geo(road: Road, find: Lookup): Samples | null {
	return road.along ? alongGeo(road, road.along, find) : curveGeo(road);
}

function alongGeo(road: Road, along: NonNullable<Road["along"]>, find: Lookup): Samples | null {
	const parentRoad = find(along.road);
	const parent = parentRoad && !parentRoad.along ? geo(parentRoad, find) : null;
	if (isDraft(road)) return parent ? sampleAlong(road, parent) : null;
	const hit = alongCache.get(along);
	const same = hit?.parent === parent && hit.profile === road.profile && hit.width === road.width && hit.ease === road.ease;
	if (hit && same) return hit.geo;
	const out = parent ? sampleAlong(road, parent) : null;
	alongCache.set(along, { parent, profile: road.profile, width: road.width, ease: road.ease, geo: out });
	return out;
}

function curveGeo(road: Road): Samples | null {
	const curve = road.curve;
	if (!curve || curve.length < 2) return null;
	if (isDraft(road)) return endsTurned(road, sampleCurve(curve));
	const hit = curveCache.get(curve);
	if (hit && hit.start_left === road.start_left && hit.end_left === road.end_left) return hit.geo;
	const out = endsTurned(road, sampleCurve(curve));
	curveCache.set(curve, { start_left: road.start_left, end_left: road.end_left, geo: out });
	return out;
}

/** A run-off's width along its road (s on that road): its profile's ([[s, width], ...], eased from point to point), or its width all along; as the track's
 * roads.py along_width (before the ease at its ends). */
export function alongWidth(road: Road, s: number): number {
	const prof = (road.profile ?? []).slice().sort((a, b) => a[0] - b[0]);
	if (!prof.length) return road.width ?? RUNOFF_WIDTH;
	if (s <= prof[0][0] || prof.length === 1) return prof[0][1];
	const last = prof.at(-1) ?? prof[0];
	if (s >= last[0]) return last[1];
	let i = 0;
	while (prof[i + 1][0] < s) i++;
	const t = (s - prof[i][0]) / Math.max(prof[i + 1][0] - prof[i][0], 1e-9);
	return prof[i][1] + (prof[i + 1][1] - prof[i][1]) * smooth(t);
}

/** A run-off as samples: its middle on its road's edge, all its width outward. */
export function sampleAlong(road: Road, parent: Samples): Samples | null {
	const al = road.along;
	if (!al) return null;
	const sgn = al.side === "left" ? 1 : -1;
	const ease = Math.max(road.ease ?? RUNOFF_EASE, 1e-6);
	const o: RawSamples = { X: [], Z: [], L: [], R: [], SEG: [], T: [], nodeAt: [] };
	const ss: number[] = [];
	for (let s = al.from; s < al.to; s += 0.5) ss.push(s);
	ss.push(al.to);
	for (const s of ss) {
		const q = pointAt(parent, s);
		const wside = sgn > 0 ? q.l : q.r;
		const e = Math.min(Math.max(Math.min(s - al.from, al.to - s) / ease, 0), 1);
		const w = alongWidth(road, s) * smooth(e);
		o.X.push(q.x + q.nx * sgn * wside);
		o.Z.push(q.z + q.nz * sgn * wside);
		o.L.push(sgn > 0 ? w : 0);
		o.R.push(sgn > 0 ? 0 : w);
		o.SEG.push(0);
		o.T.push(0);
	}
	return finishSamples(o);
}

export type AlongHandleKind = "afrom" | "ato" | "aw";
export interface AlongHandle {
	kind: AlongHandleKind;
	n?: number;
	x: number;
	z: number;
}

/** A run-off's handles: its ends on its road's edge, its width points on its outer edge. */
export function alongHandles(road: Road | undefined, find: Lookup): AlongHandle[] {
	const al = road?.along;
	const parentRoad = al && find(al.road);
	const o = parentRoad && geo(parentRoad, find);
	if (!road || !al || !o) return [];
	const sgn = al.side === "left" ? 1 : -1;
	const edge = (s: number, w: number) => {
		const q = pointAt(o, s);
		const e = (sgn > 0 ? q.l : q.r) + w;
		return { x: q.x + q.nx * sgn * e, z: q.z + q.nz * sgn * e };
	};
	const out: AlongHandle[] = [
		{ kind: "afrom", ...edge(al.from, 0) },
		{ kind: "ato", ...edge(al.to, 0) },
	];
	const prof: Vec2[] = road.profile?.length ? road.profile : [[(al.from + al.to) / 2, road.width ?? RUNOFF_WIDTH]];
	prof.forEach(([s, w], n) => {
		out.push({ kind: "aw", n, ...edge(s, w) });
	});
	return out;
}
