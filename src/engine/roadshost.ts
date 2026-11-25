// A track's roads merged where the engine runs: its roads.json read through what it is handed, each road's mesh (on its own heights, else laid on the place's
// ground), merged with the ground over a window (by default round every road) on the workers it is given, what the merge made kept for the next (a road edited:
// only the faces it reaches filled again).

import { type LaidObject, layObject, type PlacedObject } from "./laying";
import { check, type Filler, MergeCache, type MergeOptions, type Mesh, merge, type Region } from "./merge";
import { KERB_MATERIALS, kerbGeometry, layPaint, type Mark, type PaintMesh, pictureAspects, type Roads, startLinePaint } from "./paint";
import type { PlaceHost } from "./placehost";
import { placeOf } from "./placehost";
import { layoutPlaces, type ObjectsIn, type PlacesDoc, SPOT_LIFT } from "./places";
import { type PyJson, plain } from "./pyjson";
import { asBuilt, mesh, priority, type RoadDesc, type RoadMesh } from "./roads";
import { Surface } from "./surface";
import { type CatalogueSource, catalogue, editorModelsOf, loadTemplate, type TemplatePart } from "./templates";
import type { Box } from "./tiles";
import { type PartName, readPart } from "./trackdoc";
import { settingsOf, settingsPaths } from "./trackfiles";

/** metres round every road the window takes by default */
export const PAD = 10;

export interface RoadsMerged {
	window: Box;
	/** milliseconds in all, and each stage's */
	ms: number;
	stages: { stage: string; ms: number }[];
	/** each region's faces and area seen from above, by the roads' order (the ground last) */
	regions: { name: string; faces: number; area: number }[];
	/** faces filled, and taken from the merge before */
	filled: number;
	kept: number;
	/** the merge's proof, when asked for: its problems' count, the first few */
	problems?: number;
	first?: { what: string; x: number; z: number }[];
	/** the meshes, when asked for */
	meshes?: Record<string, Mesh>;
	/** the edge lines laid on it: how many, their faces; and themselves, with the meshes */
	paint: { lines: number; faces: number };
	lines?: PaintMesh[];
	/** objects.json's objects laid on it: how many, their faces, those its catalogue has not; themselves, with the meshes */
	objects?: { laid: number; faces: number; unknown: string[] };
	laid?: LaidObject[];
	/** the layouts' places made (TRACK_FORMAT's places.json): how many layouts, spots, physics objects; themselves, with the meshes */
	places?: { layouts: number; spots: number; objects: number };
	placed?: PlacesDoc;
}

const caches = new Map<string, MergeCache>();
/** each project's roads' meshes of its last merge, by the road as built (and the ground, where on it) */
const roadMeshes = new Map<string, Map<string, RoadMesh>>();
/** a mesh's triangles cropped to a window, by the mesh, the window and the margin */
const crops = new WeakMap<RoadMesh, Map<string, { tris: Float64Array; uvs: Float64Array } | null>>();

/** A mesh's surface: its triangles, nine numbers each. */
export function surfaceOf(m: { P: ArrayLike<number>; F: ArrayLike<number> }): Surface {
	const T = new Float64Array(m.F.length * 3);
	for (let i = 0; i < m.F.length; i++) {
		const v = m.F[i] as number;
		T[i * 3] = m.P[v * 3] as number;
		T[i * 3 + 1] = m.P[v * 3 + 1] as number;
		T[i * 3 + 2] = m.P[v * 3 + 2] as number;
	}
	return new Surface(T);
}

/** Every region's mesh as one (its points and faces). */
function meshesTogether(out: Record<string, Mesh>): { P: Float64Array; F: Int32Array } {
	let np = 0;
	let nf = 0;
	for (const m of Object.values(out)) {
		np += m.P.length;
		nf += m.F.length;
	}
	const P = new Float64Array(np);
	const F = new Int32Array(nf);
	let p = 0;
	let f = 0;
	for (const m of Object.values(out)) {
		const base = p / 3;
		P.set(m.P, p);
		for (let i = 0; i < m.F.length; i++) F[f + i] = (m.F[i] as number) + base;
		p += m.P.length;
		f += m.F.length;
	}
	return { P, F };
}

/** The merged surface the paint lies on: every region's mesh but the ground's. */
export function floorOf(out: Record<string, Mesh>): Surface {
	const parts = Object.entries(out).filter(([n]) => n !== "ground");
	let n = 0;
	for (const [, m] of parts) n += m.F.length;
	const T = new Float64Array(n * 3);
	let k = 0;
	for (const [, m] of parts)
		for (const v of m.F) {
			T[k++] = m.P[v * 3] as number;
			T[k++] = m.P[v * 3 + 1] as number;
			T[k++] = m.P[v * 3 + 2] as number;
		}
	return new Surface(T);
}

/** A mesh's triangles within margin metres of a window, and their texture places (track_surface.crop): nine numbers a triangle, six its
 * places; null for none. */
export function crop(m: RoadMesh, w: Box, margin = 2): { tris: Float64Array; uvs: Float64Array } | null {
	const key = `${w.x0},${w.z0},${w.x1},${w.z1},${margin}`;
	let mine = crops.get(m);
	if (!mine) {
		mine = new Map();
		crops.set(m, mine);
	}
	if (mine.has(key)) return mine.get(key) ?? null;
	const got = cropped(m, w, margin);
	mine.set(key, got);
	return got;
}

function cropped(m: RoadMesh, w: Box, margin: number): { tris: Float64Array; uvs: Float64Array } | null {
	const tris: number[] = [];
	const uvs: number[] = [];
	for (let f = 0; f < m.F.length; f += 3) {
		const v = [m.F[f] as number, m.F[f + 1] as number, m.F[f + 2] as number];
		const xs = v.map((i) => m.P[i * 3] as number);
		const zs = v.map((i) => m.P[i * 3 + 2] as number);
		if (Math.max(...xs) < w.x0 - margin || Math.min(...xs) > w.x1 + margin || Math.max(...zs) < w.z0 - margin || Math.min(...zs) > w.z1 + margin) continue;
		for (const i of v) {
			tris.push(m.P[i * 3] as number, m.P[i * 3 + 1] as number, m.P[i * 3 + 2] as number);
			uvs.push(m.U[i * 2] as number, m.U[i * 2 + 1] as number);
		}
	}
	return tris.length ? { tris: Float64Array.from(tris), uvs: Float64Array.from(uvs) } : null;
}

/** The roads' top where nothing else says: the surface of their meshes, the nearest of their points' height where none lies under
 * a point (merge_floor's top). */
export function roadsTop(built: { m: RoadMesh }[]): (x: number, z: number) => number {
	let n = 0;
	for (const { m } of built) n += m.F.length;
	const T = new Float64Array(n * 3);
	let k = 0;
	for (const { m } of built)
		for (const v of m.F) {
			T[k++] = m.P[v * 3] as number;
			T[k++] = m.P[v * 3 + 1] as number;
			T[k++] = m.P[v * 3 + 2] as number;
		}
	const S = new Surface(T);
	// (the points filed by metre cells, for the nearest)
	const cells = new Map<string, number[]>();
	for (let i = 0; i < T.length; i += 3) {
		const key = `${Math.floor(T[i] as number)},${Math.floor(T[i + 2] as number)}`;
		const l = cells.get(key);
		if (l) l.push(i);
		else cells.set(key, [i]);
	}
	return (x, z) => {
		const y = S.y(x, z);
		return Number.isNaN(y) ? nearestHeight(T, cells, x, z) : y;
	};
}

/** The nearest point so far to (x, z): where in the triangles' numbers it is (-1 for none yet), and how far. */
interface Nearest {
	x: number;
	z: number;
	best: number;
	bd: number;
}

/** Of the points (where in the triangles' numbers) in the cells r cells round (gx, gz), any nearer to the nearest's (x, z) than the nearest so far: that the
 * nearest. */
function nearerInRing(T: Float64Array, cells: Map<string, number[]>, gx: number, gz: number, r: number, near: Nearest) {
	const { x, z } = near;
	for (let ix = gx - r; ix <= gx + r; ix++)
		for (let iz = gz - r; iz <= gz + r; iz++) {
			if (Math.max(Math.abs(ix - gx), Math.abs(iz - gz)) !== r) continue;
			for (const i of cells.get(`${ix},${iz}`) ?? []) {
				const d = Math.hypot((T[i] as number) - x, (T[i + 2] as number) - z);
				if (d < near.bd) {
					near.bd = d;
					near.best = i;
				}
			}
		}
}

/** The height of the nearest to (x, z) of the points filed by metre cells, ring by ring out from its cell; 0 where there is none. */
function nearestHeight(T: Float64Array, cells: Map<string, number[]>, x: number, z: number): number {
	const near: Nearest = { x, z, best: -1, bd: Infinity };
	const gx = Math.floor(x);
	const gz = Math.floor(z);
	for (let r = 0; r < 4096 && (near.best < 0 || near.bd > r - 1); r++) nearerInRing(T, cells, gx, gz, r, near);
	return near.best < 0 ? 0 : (T[near.best + 1] as number);
}

/** The roads' regions for the merge, in its order (merge_floor's): their rumbles first, over everything, laid on the roads' meshes (roadsTop, unless another
 * top is given; their pictures' proportions kept, where aspectOf knows them); then the roads, each over those after it. Each its triangles within 2 m of the
 * window. */
export function roadRegions(
	roads: Roads,
	built: { name: string; m: RoadMesh }[],
	w: Box,
	top: (x: number, z: number) => number = roadsTop(built),
	aspectOf?: (material: string) => number | undefined,
	ground?: (x: number, z: number) => number,
): Region[] {
	const regions: Region[] = [];
	for (const { name } of built) {
		const r = roads[name];
		if (!r || r.along) continue;
		const num = name.replace(/^1(ROAD|KERB)_/, "");
		(r.kerbs ?? []).forEach((k, i) => {
			for (const g of kerbGeometry(r, k, roads, top, aspectOf, ground)) {
				const c = crop({ P: g.P, U: g.U, F: g.F }, w);
				if (c) regions.push({ name: `1ROAD_KERB_E_${num}_${i}${g.suffix}`, ...c });
			}
		});
	}
	for (const { name, m } of built) {
		const c = crop(m, w);
		if (c) regions.push({ name, ...c });
	}
	return regions;
}

function areaOf(m: Mesh): number {
	let s = 0;
	for (let f = 0; f < m.F.length; f += 3) {
		const [a, b, c] = [m.F[f] as number, m.F[f + 1] as number, m.F[f + 2] as number];
		s +=
			Math.abs(
				((m.P[b * 3] as number) - (m.P[a * 3] as number)) * ((m.P[c * 3 + 2] as number) - (m.P[a * 3 + 2] as number)) -
					((m.P[c * 3] as number) - (m.P[a * 3] as number)) * ((m.P[b * 3 + 2] as number) - (m.P[a * 3 + 2] as number)),
			) / 2;
	}
	return s;
}

/** A part of the track (plain): from the file given, else wherever the track keeps it (trackdoc.ts); null where it has none. */
async function partOf(host: PlaceHost, project: string, name: PartName, file?: string): Promise<unknown> {
	if (file) return (await host.files.exists(file)) ? JSON.parse(new TextDecoder().decode(await host.files.read(file))) : null;
	const v = await readPart(host.files, await settingsOf(host.files, project), name);
	return v === null ? null : plain(v as PyJson);
}

/** The roads' meshes in the order they are built in, each on its own heights, else on the ground (its key, its height): each kept from the merge before where
 * it is built as it was, on the same ground. */
function builtMeshes(project: string, roads: Record<string, RoadDesc>, groundKey: string, ground: (x: number, z: number) => number) {
	const keptMeshes = roadMeshes.get(project);
	const nextMeshes = new Map<string, RoadMesh>();
	const built = priority(roads).map((n) => {
		const rr = asBuilt(roads[n] as RoadDesc, roads);
		const key = `${rr.heights ? "" : groundKey}|${JSON.stringify(rr)}`;
		const m = keptMeshes?.get(key) ?? (rr.heights ? mesh(rr) : mesh(rr, ground));
		nextMeshes.set(key, m);
		return { name: n, m };
	});
	roadMeshes.set(project, nextMeshes);
	return built;
}

/** Each region's faces and area seen from above, of those the merge made a mesh of. */
function regionsCount(regions: Region[], out: Record<string, Mesh>): { name: string; faces: number; area: number }[] {
	return regions.flatMap((r) => {
		const m = out[r.name];
		return m ? [{ name: r.name, faces: m.F.length / 3, area: Math.round(areaOf(m) * 10) / 10 }] : [];
	});
}

/** The window round every road's mesh, PAD over; round the origin where there are none. */
function windowRound(built: { m: RoadMesh }[]): Box {
	const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
	for (const { m } of built)
		for (let i = 0; i < m.P.length; i += 3) {
			b.x0 = Math.min(b.x0, m.P[i] as number);
			b.x1 = Math.max(b.x1, m.P[i] as number);
			b.z0 = Math.min(b.z0, m.P[i + 2] as number);
			b.z1 = Math.max(b.z1, m.P[i + 2] as number);
		}
	return Number.isFinite(b.x0)
		? {
				x0: Math.floor(b.x0 - PAD),
				z0: Math.floor(b.z0 - PAD),
				x1: Math.ceil(b.x1 + PAD),
				z1: Math.ceil(b.z1 + PAD),
			}
		: { x0: -PAD, z0: -PAD, x1: PAD, z1: PAD };
}

/** A project's merge cache, made the first time it is asked for. */
function cacheOf(project: string): MergeCache {
	let cache = caches.get(project);
	if (!cache) {
		cache = new MergeCache();
		caches.set(project, cache);
	}
	return cache;
}

/** Objects laid: whether the catalogue has a model, those laid, the names of those it has not. */
interface ObjectsLaid {
	known: (model: string) => boolean;
	laid: LaidObject[];
	unknown: string[];
}

/** No objects laid, the catalogue not read: no model known. */
const noneLaid = (): ObjectsLaid => ({ known: () => false, laid: [], unknown: [] });

/** objects.json's objects laid on the floor (top), of the editor's catalogue: each model's parts loaded once. */
async function layObjects(
	host: PlaceHost,
	project: string,
	models: string | undefined,
	objects: PlacedObject[],
	top: (x: number, z: number) => number,
): Promise<ObjectsLaid> {
	const laid: LaidObject[] = [];
	const unknown: string[] = [];
	const src: CatalogueSource = {
		read: (f) => host.files.read(f),
		exists: (f) => host.files.exists(f),
		editorModels: editorModelsOf(project, models),
	};
	const cat = await catalogue(src);
	const parts = new Map<string, Promise<TemplatePart[]>>();
	for (const o of objects) {
		const meta = cat[o.model];
		if (!meta || !o.curve?.length) {
			unknown.push(o.name);
			continue;
		}
		// (a knockable one standing alone: a layout's physics object, in its places, not laid; each game makes its own)
		if (o.collision === "dynamic" && o.curve.length === 1) continue;
		let t = parts.get(o.model);
		if (!t) {
			t = loadTemplate(src, meta);
			parts.set(o.model, t);
		}
		laid.push(layObject(o, meta, await t, top));
	}
	return { known: (m) => m in cat, laid, unknown };
}

/** The layouts' places made on the floor (top), each spot as high over it as it stood in the places before (the file given, else the track's models'
 * places.json). */
async function placesOf(
	host: PlaceHost,
	project: string,
	placesFile: string | undefined,
	objects: ObjectsIn,
	top: (x: number, z: number) => number,
	known: (model: string) => boolean,
): Promise<PlacesDoc> {
	const beforeFile = placesFile ?? `${settingsPaths(await settingsOf(host.files, project)).models}/places.json`;
	const before = (await host.files.exists(beforeFile)) ? (JSON.parse(new TextDecoder().decode(await host.files.read(beforeFile))) as PlacesDoc) : null;
	return layoutPlaces(objects, top, known, before, SPOT_LIFT);
}

/** How many layouts the places have, and their spots and physics objects. */
function placesCount(places: PlacesDoc): { layouts: number; spots: number; objects: number } {
	return {
		layouts: Object.keys(places.layouts).length,
		spots: Object.values(places.layouts).reduce((a, L) => a + L.spots.length, 0),
		objects: Object.values(places.layouts).reduce((a, L) => a + L.objects.length, 0),
	};
}

/** The roads of a track merged: params as the engine's call `roads.merge` takes them. */
export async function mergeRoads(
	host: PlaceHost,
	filler: Filler,
	p: {
		project: string;
		roads?: string;
		objects?: string;
		/** the layouts' places before (by default the track's models' places.json): each spot's height over the floor kept */
		places?: string;
		/** the editor's own models (their .glb and catalogue.json) */
		models?: string;
		terrain?: string;
		window?: Box;
		check?: boolean;
		meshes?: boolean;
	},
	/** more of the merge's own options (its tiles; what is looked at while it runs) */
	more: Omit<MergeOptions, "cache" | "log"> = {},
): Promise<RoadsMerged> {
	const t0 = performance.now();
	const doc = ((await partOf(host, p.project, "roads", p.roads)) ?? { roads: [] }) as { roads: RoadDesc[] };
	const roads = Object.fromEntries(doc.roads.map((r) => [r.name, r]));
	const place = await placeOf(host, p.project, p.terrain);
	const built = builtMeshes(p.project, roads, place.key, place.ground.y);
	const w = p.window ?? windowRound(built);
	const aspects = await pictureAspects(host.files, p.project, KERB_MATERIALS);
	const regions = roadRegions(roads as Roads, built, w, undefined, (m) => aspects[m], place.ground.y);
	regions.push({ name: "ground", ground: { height: place.ground.y, uv: (x, z) => [x / 50, z / 50], spacing: 2 } });
	const stages: { stage: string; ms: number }[] = [{ stage: "roads and the place", ms: performance.now() - t0 }];
	const cache = cacheOf(p.project);
	const out = await merge(regions, w, filler, {
		...more,
		cache,
		log: (stage, ms) => stages.push({ stage, ms: Math.round(ms) }),
	});
	const tLines = performance.now();
	// (the edge lines and the marks of its objects.json, if it has one, laid on it: on the roads and rumbles as merged, painted as one where they meet; and the
	// start lines, on the road only, LINE_LIFT over the floor)
	const floor = floorOf(out);
	const objects = (await partOf(host, p.project, "objects", p.objects)) as {
		marks?: Mark[];
		layouts?: Parameters<typeof startLinePaint>[0];
		objects?: PlacedObject[];
	} | null;
	// (the floor as merged: its height where a point is, 0 past it)
	const all = surfaceOf(meshesTogether(out));
	const top = (x: number, z: number) => {
		const y = all.y(x, z);
		return Number.isNaN(y) ? 0 : y;
	};
	const lines: PaintMesh[] = await layPaint(roads as Roads, floor, objects?.marks ?? []);
	if (objects) lines.push(...startLinePaint(objects.layouts ?? {}, roads as Roads, top));
	stages.push({ stage: "the lines laid", ms: performance.now() - tLines });
	// (and its objects laid on the floor, of the editor's catalogue)
	const tObjects = performance.now();
	const { known, laid, unknown } = objects?.objects?.length ? await layObjects(host, p.project, p.models, objects.objects, top) : noneLaid();
	// (the layouts' places: their spots and physics objects on the floor, each spot as high over it as it stood in the places before)
	let places: PlacesDoc | null = null;
	if (objects?.layouts || objects?.objects?.length) places = await placesOf(host, p.project, p.places, objects as ObjectsIn, top, known);
	stages.push({ stage: "the objects laid", ms: performance.now() - tObjects });
	const result: RoadsMerged = {
		window: w,
		ms: 0,
		stages: stages.map((s) => ({ ...s, ms: Math.round(s.ms) })),
		regions: regionsCount(regions, out),
		filled: cache.filled,
		kept: cache.kept,
		paint: { lines: lines.length, faces: lines.reduce((a, l) => a + l.F.length / 3, 0) },
		places: places ? placesCount(places) : undefined,
		objects: {
			laid: laid.length,
			faces: laid.reduce((a, o) => a + o.parts.reduce((b, x) => b + x.F.length / 3, 0), 0),
			unknown,
		},
	};
	if (p.check) {
		const issues = check(out, w);
		result.problems = issues.length;
		result.first = issues.slice(0, 10).map(({ what, x, z }) => ({ what, x, z }));
	}
	if (p.meshes) {
		result.meshes = out;
		result.lines = lines;
		result.laid = laid;
		result.placed = places ?? undefined;
	}
	result.ms = Math.round(performance.now() - t0);
	return result;
}
