// The layouts' places as every game's build reads them (TRACK_FORMAT.md's places.json; place_objects.py's `layouts` and its physics objects, version 3): each
// layout's grid slots, pit boxes, hotlap start and timing gates where they stand, on the floor, and its physics objects (the knockable cones and boards:
// objects.json's dynamic ones). Each game's build makes its own of them (AC's empty nodes AC_START_0 ..., its AC_POBJECT_n, its pit boxes' number).
//
// A spot stands as high over the floor as it stood before (the Python's `set_spot`, which keeps its marker's height over the floor): its height over the floor
// taken from the places before, by its name; one not there before as high as the last of its kind, else on the floor. One that has not moved (by MOVED) stays
// exactly where it was.
import { SINKS } from "./laying";
import { type PyJson, PyNumber, pyFloat } from "./pyjson";

/** metres, radians: less than this, not moved (place_objects.py's MOVED) */
export const MOVED = 1e-4;
/** metres every spot stands over the floor under it, once the format says so (agreed with the track's tools: AC drops a car onto the ground from its start
 * node, so a little above is safe and below is not); till then each as it stood */
export const SPOT_LIFT = 0.5;

export interface Spot {
	name: string;
	x: number;
	y: number;
	z: number;
	heading: number;
}

export interface PhysicsObject {
	name: string;
	model: string;
	x: number;
	y: number;
	z: number;
	heading: number;
	/** a board's own text (none: its name's, boardfaces.boardText) */
	text?: string;
}

export interface LayoutPlaces {
	spots: Spot[];
	/** its pit boxes */
	pits: number;
	objects: PhysicsObject[];
}

export interface PlacesDoc {
	version: number;
	layouts: Record<string, LayoutPlaces>;
	/** the catalogue objects' lights where each stands (place_objects.py's object_lights: {series, at, facing}) */
	lights?: unknown[];
}

type At = { x: number; z: number; heading?: number };
interface LayoutIn {
	grid?: At[];
	pits?: At[];
	hotlap?: At | null;
	timing?: { left?: { x: number; z: number }; right?: { x: number; z: number } }[];
}
interface ObjectIn {
	name: string;
	model: string;
	curve?: { p: [number, number] }[];
	heading?: number;
	collision?: string;
	layouts?: string[];
	text?: string;
}
export interface ObjectsIn {
	layouts?: Record<string, LayoutIn>;
	objects?: ObjectIn[];
}

/** The floor's height at a point. */
export type FloorAt = (x: number, z: number) => number;

/** x less the nearest whole number of turns (math.remainder(x, tau)). */
function remainderTau(x: number): number {
	const tau = 2 * Math.PI;
	const q = x / tau;
	let k = Math.round(q);
	if (Math.abs(q % 1) === 0.5 && k % 2 !== 0) k -= 1;
	return x - k * tau;
}

/** A spot's kind: its name without its numbers (START, PIT, HOTLAP_START, TIME_L / TIME_R). */
const kindOf = (name: string) => name.replace(/_\d+/g, "");

/** Each layout's places (its spots, its pit boxes, its physics objects), from objects.json (version 3) on the floor: the layouts' in their order, then any only
 * an object names. known: the catalogue's models (an object of another is not placed, as it is not laid); before: the places made before (each spot's height
 * over the floor kept). */
export function layoutPlaces(
	objects: ObjectsIn,
	floor: FloorAt,
	known: (model: string) => boolean,
	before?: PlacesDoc | null,
	/** every spot this high over the floor (SPOT_LIFT), not as it stood before */
	lift?: number,
): PlacesDoc {
	const out: Record<string, LayoutPlaces> = {};
	for (const [layout, L] of Object.entries(objects.layouts ?? {})) {
		const was = new Map((before?.layouts?.[layout]?.spots ?? []).map((s) => [s.name, s]));
		const lastUp = new Map<string, number>();
		const spots: Spot[] = [];
		const put = (name: string, at: { x: number; z: number }, heading: number | undefined) => {
			if (lift !== undefined) {
				spots.push({
					name,
					x: at.x,
					y: floor(at.x, at.z) + lift,
					z: at.z,
					heading: heading ?? was.get(name)?.heading ?? 0,
				});
				return;
			}
			const prev = was.get(name);
			const kind = kindOf(name);
			if (prev) lastUp.set(kind, prev.y - floor(prev.x, prev.z));
			const turned = heading !== undefined && prev ? Math.abs(remainderTau(prev.heading - heading)) >= MOVED : false;
			if (prev && Math.abs(prev.x - at.x) < MOVED && Math.abs(prev.z - at.z) < MOVED && !turned) {
				spots.push({ ...prev, name });
				return;
			}
			const up = prev ? prev.y - floor(prev.x, prev.z) : (lastUp.get(kind) ?? 0);
			lastUp.set(kind, up);
			spots.push({ name, x: at.x, y: floor(at.x, at.z) + up, z: at.z, heading: heading ?? prev?.heading ?? 0 });
		};
		(L.grid ?? []).forEach((s, i) => {
			put(`START_${i}`, s, s.heading ?? 0);
		});
		(L.pits ?? []).forEach((s, i) => {
			put(`PIT_${i}`, s, s.heading ?? 0);
		});
		if (L.hotlap) put("HOTLAP_START_0", L.hotlap, L.hotlap.heading ?? 0);
		(L.timing ?? []).forEach((g, i) => {
			if (g.left) put(`TIME_${i}_L`, g.left, undefined);
			if (g.right) put(`TIME_${i}_R`, g.right, undefined);
		});
		out[layout] = { spots, pits: (L.pits ?? []).length, objects: [] };
	}
	// (a dynamic single object: a physics object of each layout it is in (none named: every layout), on the floor less its sink, in objects.json's order)
	const all = Object.keys(objects.layouts ?? {});
	for (const o of objects.objects ?? []) {
		if (!o.curve?.length || !known(o.model) || o.collision !== "dynamic" || o.curve.length !== 1) continue;
		const p = o.curve[0]?.p;
		if (!p) continue;
		const [x, z] = p;
		const y = floor(x, z) - (SINKS[o.model] ?? 0);
		for (const lay of (o.layouts ?? all).filter((l) => all.includes(l))) {
			out[lay] ??= { spots: [], pits: 0, objects: [] };
			out[lay].objects.push({
				name: o.name,
				model: o.model,
				x,
				y,
				z,
				heading: o.heading ?? 0,
				...(o.text?.trim() ? { text: o.text.trim() } : {}),
			});
		}
	}
	return { version: 1, layouts: out };
}

/** The places as the Python writes them: their numbers floats (repr), the pit boxes a whole number. */
export function placesJson(doc: PlacesDoc): PyJson {
	const f = (v: number) => new PyNumber(v, pyFloat(v));
	const at = (s: Spot | PhysicsObject) => ({ x: f(s.x), y: f(s.y), z: f(s.z), heading: f(s.heading) });
	return {
		version: doc.version,
		layouts: Object.fromEntries(
			Object.entries(doc.layouts).map(([k, L]) => [
				k,
				{
					spots: L.spots.map((s) => ({ name: s.name, ...at(s) })),
					pits: L.pits,
					objects: L.objects.map((o) => ({
						name: o.name,
						model: o.model,
						...at(o),
						...(o.text ? { text: o.text } : {}),
					})),
				},
			]),
		),
	};
}
