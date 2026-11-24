// The track made by the engine from the editor's data alone (TRACK_FORMAT's "Source and what is made from it": track/ from the track's data): nothing of a
// hand-made model. One ground over the track's map (its satellite's square, the picture laid over it), merged with the roads described, their rumbles and the
// paved areas (trackfloor.ts); the paint laid on it (the roads' edge lines, the marks, the start lines); the objects laid on it (into the shared model and the
// layouts' own: trackobjects.ts; the start gantries each a model of its own, working over the start and finish lines they stand by, still elsewhere:
// gantries.ts); the trees; the layouts' places and the objects' lights (places.json). Every model written to the track's made models (track/models), nothing
// else left there; each layout's model list in the track file, made here: the shared models, its own and its gantries' (each working or still).

import type { AiSettings, RubberMark, SurfaceRoughness, TrackWear } from "../domain/types";
import { loadBumps } from "./bumpsfile";
import { meshNode } from "./floorwrite";
import { GANTRIES, gantryFeet, gantryModel, startLine, stillMaterials, workingGantries, writeGantry } from "./gantries";
import { GENERATOR, type MaterialLibrary, toGltf, writeGlb } from "./gltf";
import { generatedGround } from "./groundpicture";
import type { Kn5 } from "./kn5tree";
import { type LaidObject, layObject, type PlacedObject } from "./laying";
import { libraryOf } from "./materials";
import type { Filler, MergeOptions } from "./merge";
import { byCodePoint } from "./order";
import { layPaint, type Mark, type Roads, startLinePaint } from "./paint";
import type { PlaceHost } from "./placehost";
import { layoutPlaces, type ObjectsIn, type PlacesDoc, SPOT_LIFT } from "./places";
import { earClip } from "./polygon";
import { dumpPyJson, type PyJson, plain } from "./pyjson";
import type { RoadDesc } from "./roads";
import { floorOf, surfaceOf } from "./roadshost";
import { layRubber } from "./rubber";
import { type CatalogueModel, type CatalogueSource, catalogue, editorModelsOf, loadTemplate, type TemplatePart } from "./templates";
import { changeTrack, readPart, trackRoads } from "./trackdoc";
import { settingsOf, settingsPaths } from "./trackfiles";
import { buildFloor, GROUND } from "./trackfloor";
import { type ModelLight, writeLines, writeObjects } from "./trackobjects";
import { TREE_KINDS, type TreesWritten, writeTrees } from "./tracktrees";
import { loadTrees, type TreePlacement } from "./treesfile";
import { giveMaterial, PAINT_DIFFUSE, PAINT_WORN, paintPicture, RUBBER_DIFFUSE, RUBBER_SHEEN, rubberPage } from "./wear";

export interface TrackBuildOptions {
	project: string;
	/** the editor's own models (their .glb and catalogue.json) */
	editorModels?: string;
	log?: (line: string) => void;
	/** where the models are written (by default the track file's models: track/models) */
	out?: string;
	more?: Omit<MergeOptions, "cache" | "log">;
}

export interface TrackBuilt {
	out: string;
	models: string[];
	floor: { regions: number; faces: number };
	lines: number;
	objects: Record<string, number>;
	/** the trees planted (by model), cleared, off the floor; null where the track has none */
	trees: { count: Record<string, number>; cleared: number; offFloor: number } | null;
	places: { layouts: number; spots: number; objects: number; lights: number };
	/** by layout, the start gantries' models it lists (each working or still: <gantry>, <gantry>_still) */
	gantries: Record<string, string[]>;
	ms: number;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);
/** the made models' names: <MODEL>.glb (the floor), _kerbs (its rumbles), _lines (the paint), _objects, _trees; and each layout's, <layout>.glb */
export const MODEL = "track";

/** A paved area as the build has it (the objects' areas). */
interface PavedAreaIn {
	name: string;
	material: string;
	points: [number, number][];
}

/** A paved area's flat mesh (its heights the floor's, laid by it): its shape cut into triangles facing up, mapped every metres metres; null where it has no
 * area. */
function areaMesh(points: [number, number][], metres: number): { P: Float64Array; UV: Float64Array; F: Int32Array } | null {
	const idx = earClip(points);
	if (idx.length < 3) return null;
	const P = new Float64Array(points.length * 3);
	const UV = new Float64Array(points.length * 2);
	points.forEach(([x, z], i) => {
		P.set([x, 0, z], i * 3);
		UV.set([x / metres, z / metres], i * 2);
	});
	const F = Int32Array.from(idx);
	// (facing up: (b - a) x (c - a) its y over 0)
	for (let f = 0; f < F.length; f += 3) {
		const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
		const pa = points[a] as [number, number];
		const pb = points[b] as [number, number];
		const pc = points[c] as [number, number];
		const y = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
		if (y < 0) [F[f + 1], F[f + 2]] = [c, b];
	}
	return { P, UV, F };
}

/** The track's models made from its source (see the module's note). */
export async function buildTrack(host: PlaceHost, filler: Filler, o: TrackBuildOptions): Promise<TrackBuilt> {
	const t0 = performance.now();
	const log = o.log ?? (() => {});
	const files = host.files;
	const project = o.project.replace(/[\\/]+$/, "");
	const s = await settingsOf(files, project);
	const out = o.out ?? settingsPaths(s).models;
	// (the ground's own picture, generated from the photo's covers where the track asks it (its photo Google's, or anyone's not to be handed on): made, or made
	// again, before the library is read, its material in it)
	const asked = plain(((await readPart(files, s, "objects")) ?? {}) as PyJson) as { ground?: { picture?: string } };
	let generated: string | null = null;
	if (asked.ground?.picture === "generated") {
		const p0 = settingsPaths(s);
		const libDoc = JSON.parse(text(await files.read(`${project}/source/materials.json`))) as {
			materials?: Record<string, { colour?: string }>;
		};
		const photoName = p0.satellite.split("/").pop() ?? "";
		const photoMaterial = Object.entries(libDoc.materials ?? {}).find(([, m]) => m.colour === photoName)?.[0];
		if (!photoMaterial) throw new Error(`the material library (source/materials.json) has no material of the track's picture (${photoName})`);
		generated = await generatedGround(files, project, p0.satellite, photoMaterial, p0.span, log);
	}
	const library = (await libraryOf(files, project)) as MaterialLibrary;
	if (!library) throw new Error("the track has no material library (source/materials.json)");
	// (the models, every one made here: the floor, its rumbles, the paint, each layout's own; the objects' and the trees' after)
	const blank = (): Kn5 => ({
		version: 6,
		extra: 0,
		textures: [],
		materials: [],
		root: { kind: 1, name: "", active: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [] },
	});
	const main = `${MODEL}.glb`;
	const kerbsFile = `${MODEL}_kerbs.glb`;
	const linesFile = `${MODEL}_lines.glb`;
	const models: Record<string, Kn5> = { [main]: blank(), [kerbsFile]: blank(), [linesFile]: blank() };
	const objectsDoc = await readPart(files, s, "objects");
	const objects = (objectsDoc === null ? null : plain(objectsDoc)) as {
		marks?: Mark[];
		rubber?: RubberMark[];
		layouts?: Record<string, Parameters<typeof startLinePaint>[0][string]>;
		objects?: PlacedObject[];
		areas?: PavedAreaIn[];
		wear?: TrackWear;
		ai?: AiSettings;
		surface?: SurfaceRoughness;
	} | null;
	const trackLayouts = (s.track.layouts ?? {}) as Record<string, { models?: string[]; from?: string }>;
	const layoutNames = [...new Set([...Object.keys(trackLayouts), ...Object.keys(objects?.layouts ?? {})])].sort(byCodePoint);
	for (const lay of layoutNames) models[`${lay}.glb`] = blank();
	const roads = plain((await trackRoads(files, s)) as PyJson) as unknown as RoadDesc[];
	const lib =
		(
			JSON.parse(text(await files.read(`${project}/source/materials.json`))) as {
				materials?: Record<string, { colour?: string; metres?: number }>;
			}
		).materials ?? {};
	// (the paved areas (car parks, lanes): paved floors of their own shape in the floor's model, merged as paving)
	const areasDoc = objects?.areas;
	for (const a of areasDoc ?? []) {
		const m = areaMesh(a.points, lib[a.material]?.metres ?? 4);
		if (m) (models[main] as Kn5).root.children.push(meshNode(models[main] as Kn5, `1ROAD_${a.name}`, m, a.material, null, models));
	}
	if (areasDoc?.length) log(`${areasDoc.length} paved areas into ${main}`);
	// (the paint's: each road by its name)
	const byName = Object.fromEntries(roads.map((r) => [r.name, r])) as Roads;
	// (the ground: the track's map, its satellite's square round the middle, the picture laid over it as the editor shows it; in the library's material of that
	// picture)
	const paths = settingsPaths(s);
	const half = paths.span / 2;
	const picture = paths.satellite.split("/").pop() ?? "";
	const groundMaterial = generated ?? Object.entries(lib).find(([, m]) => m.colour === picture)?.[0];
	if (!groundMaterial) throw new Error(`the material library (source/materials.json) has no material of the track's picture (${picture})`);
	const areaFloors = (areasDoc ?? []).map((a) => `1ROAD_${a.name}`);
	const floor = await buildFloor(
		host,
		filler,
		{
			project,
			models: { [main]: models[main] as Kn5, [kerbsFile]: models[kerbsFile] as Kn5 },
			rumbles: kerbsFile,
			roads,
			log,
			own: areaFloors,
			window: { x0: -half, z0: -half, x1: half, z1: half },
			ground: { material: groundMaterial, uv: (x, z) => [0.5 - x / paths.span, 0.5 - z / paths.span] },
			bumps: await loadBumps(files, project),
			surface: objects?.surface,
		},
		o.more,
	);
	log(`the floor: ${floor.regions} regions, ${floor.faces} faces`);
	// (the floor as merged: the roads' and rumbles' own; all of it, its height where a point is, 0 past it)
	const roadsOnly = floorOf(Object.fromEntries(Object.entries(floor.meshes).filter(([n]) => n !== GROUND)));
	const all = (() => {
		// (the far ground too: trees stand on it)
		const parts = [...Object.values(floor.meshes), ...(floor.far ? [floor.far] : [])];
		const P = new Float64Array(parts.reduce((a, m) => a + m.P.length, 0));
		const F = new Int32Array(parts.reduce((a, m) => a + m.F.length, 0));
		let p = 0;
		let f = 0;
		for (const m of parts) {
			const base = p / 3;
			P.set(m.P, p);
			for (let i = 0; i < m.F.length; i++) F[f + i] = (m.F[i] as number) + base;
			p += m.P.length;
			f += m.F.length;
		}
		return surfaceOf({ P, F });
	})();
	const top = (x: number, z: number) => {
		const y = all.y(x, z);
		return Number.isNaN(y) ? 0 : y;
	};
	// (the paint: the edge lines and the marks, painted as one where they meet, on the roads and rumbles as merged; the start lines; into the paint's model)
	const lines = await layPaint(byName, roadsOnly, objects?.marks ?? []);
	if (objects) lines.push(...startLinePaint(objects.layouts ?? {}, byName, top));
	const id = MODEL;
	const paintModel = models[linesFile] as Kn5;
	// (in the track's wear: its own pictures, the asphalt's grain showing through, worn and dirtied as it is used)
	const wear = objects?.wear ?? {};
	const paintWear = wear.paint ?? "new";
	for (const c of ["white", "yellow"] as const)
		await giveMaterial(paintModel, PAINT_WORN[c].material, PAINT_WORN[c].picture, () => paintPicture(c, paintWear), PAINT_DIFFUSE);
	writeLines(paintModel, lines, models, { white: PAINT_WORN.white.material, yellow: PAINT_WORN.yellow.material });
	log(`the paint: ${lines.length} lines into ${linesFile}, ${paintWear.replace("_", " ")}`);
	// (the rubber the cars have laid on the roads, each mark a band over the road, its paint and its rumbles, its pictures its own all along; in the paint's
	// model, as the paint is: every layout's)
	const rubber = objects?.rubber ?? [];
	if (rubber.length) {
		const t0 = performance.now();
		const onFloor = (x: number, z: number) => roadsOnly.y(x, z);
		// (all at once: where marks lie over one another, the road shown as their blend there, never darker)
		const laid = layRubber(rubber, onFloor);
		for (const [n, pg] of laid.pages.entries()) {
			const { material, picture } = rubberPage(n);
			await giveMaterial(paintModel, material, picture, () => pg.rgba, RUBBER_DIFFUSE, RUBBER_SHEEN, pg.width);
		}
		const count = new Map<number, number>();
		for (const piece of laid.pieces) {
			const r = rubber[piece.mark] as RubberMark;
			const i = count.get(piece.mark) ?? 0;
			count.set(piece.mark, i + 1);
			const { material } = rubberPage(piece.page);
			const node = meshNode(paintModel, `${r.name}${i ? `_${i + 1}` : ""}`, piece.mesh, material, null, models);
			node.cast_shadows = 0;
			paintModel.root.children.push(node);
		}
		const shown = rubber.filter((_, k) => count.has(k)).length;
		log(
			`the rubber: ${laid.pieces.length} pieces of ${shown} of ${rubber.length} rubber marks (the others under them), ` +
				`${laid.pages.map((p) => `${p.width} x ${p.height}`).join(", ") || "no"} pictures, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
		);
	}
	// (the objects, of the editor's catalogue)
	const laid: LaidObject[] = [];
	let count: Record<string, number> = {};
	let lights: unknown[] = [];
	const sharedFile = `${id}_objects.glb`;
	const csrc: CatalogueSource = {
		read: (f) => files.read(f),
		exists: (f) => files.exists(f),
		editorModels: editorModelsOf(project, o.editorModels),
		library,
		textures: `${project}/source/textures`,
	};
	const cat = await catalogue(csrc);
	const parts = new Map<string, Promise<TemplatePart[]>>();
	const partsOf = (model: string) => {
		let t = parts.get(model);
		if (!t) {
			t = loadTemplate(csrc, cat[model] as CatalogueModel);
			parts.set(model, t);
		}
		return t;
	};
	const known = (m: string): boolean => m in cat;
	// (the start gantries: each a model of its own, working or still in each layout; by layout, the gantries' models it lists)
	const isGantry = (l: LaidObject) => cat[l.model]?.kind === GANTRIES && l.parts.length > 0;
	const gantryLists: Record<string, string[]> = {};
	const gantryFiles = new Set<string>();
	if (objects?.objects?.length) {
		for (const ob of objects.objects) {
			const meta = cat[ob.model];
			if (!meta || !ob.curve?.length) continue;
			const l = layObject(ob, meta, await partsOf(ob.model), top);
			// (a static gantry's collision round its feet, the way under it left free)
			if (isGantry(l) && l.collision === "static") l.boxes = gantryFeet(l);
			laid.push(l);
		}
		models[sharedFile] = blank();
		const w = writeObjects(
			laid,
			models[sharedFile] as Kn5,
			Object.fromEntries(layoutNames.map((l) => [l, models[`${l}.glb`] as Kn5])),
			models,
			(m) => cat[m]?.lights as ModelLight[] | undefined,
			top,
			Object.values(models),
			isGantry,
		);
		count = w.count;
		lights = w.lights;
		const gantries = laid.filter(isGantry);
		const working = workingGantries(
			gantries,
			Object.fromEntries(
				layoutNames.map((l) => {
					const lay = objects.layouts?.[l];
					return [l, lay ? startLine(lay) : null];
				}),
			),
		);
		const still = (m: string) => stillMaterials(m).find((n) => library.get(n)) ?? null;
		for (const g of gantries)
			for (const l of layoutNames) {
				if (g.layouts && !g.layouts.includes(l)) continue;
				const on = working[l] === g.name;
				const f = `${gantryModel(id, g.name, on)}.glb`;
				if (!models[f]) {
					models[f] = blank();
					writeGantry(g, models[f] as Kn5, models, on, still);
					gantryFiles.add(f);
				}
				gantryLists[l] = [...(gantryLists[l] ?? []), f.slice(0, -".glb".length)];
			}
		if (gantries.length) log(`the gantries: ${layoutNames.map((l) => `${l} ${working[l] ?? "none"} working`).join(", ")}`);
		log(
			`the objects: ${Object.entries(count)
				.map(([m, n]) => `${n} ${m}`)
				.join(", ")}`,
		);
	}
	// (the trees, of the catalogue's trees: into the trees' model, those on a solid object's ground left out)
	const trees = plain((await loadTrees(files, s)) as PyJson) as TreePlacement[];
	let planted: TreesWritten | null = null;
	if (trees.length) {
		const treeModels = [...new Set(trees.map((t) => t.model))].filter((m) => TREE_KINDS.has(cat[m]?.kind ?? ""));
		const shapes = new Map(await Promise.all(treeModels.map(async (m) => [m, await partsOf(m)] as const)));
		const treesFile = `${id}_trees.glb`;
		models[treesFile] = blank();
		planted = writeTrees(trees, models[treesFile] as Kn5, cat, shapes, (x, z) => all.y(x, z), laid, models);
		const n = Object.values(planted.count).reduce((a, b) => a + b, 0);
		log(
			`the trees: ${n} into ${treesFile} (${planted.meshes} meshes), ${planted.cleared} cleared` +
				(planted.offFloor ? `, ${planted.offFloor} off the floor` : "") +
				(planted.unknown.length ? `; not trees of the catalogue: ${planted.unknown.join(", ")}` : ""),
		);
		// (where each stands, beside its model: another game's forest stands them so, BeamNG's)
		await files.write(`${out}/${treesFile.replace(/\.glb$/, ".json")}`, new TextEncoder().encode(JSON.stringify({ version: 1, trees: planted.planted })));
	}
	// (the layouts' places, on the floor; the objects' lights with them)
	const places: PlacesDoc = objects ? { ...layoutPlaces(objects as ObjectsIn, top, known, null, SPOT_LIFT), lights } : { version: 1, layouts: {}, lights };
	// (written: every model, the places, what the merge made; the layouts' model lists with the shared model)
	const written: string[] = [];
	// (a texture the track's source/textures holds (as X.png, or as named): pointed at there; one it does not (an editor's model's own pictures): kept in the
	// model itself)
	const inSource = new Map<string, boolean>();
	for (const k of Object.values(models))
		for (const t of k.textures)
			if (!inSource.has(t.name)) {
				const png = t.name.replace(/\.dds$/i, ".png");
				const dir = `${project}/source/textures`;
				inSource.set(t.name, (await files.exists(`${dir}/${png}`)) || (await files.exists(`${dir}/${t.name}`)));
			}
	for (const [f, k] of Object.entries(models)) {
		const { doc, bin } = toGltf(k, (t) => (inSource.get(t.name) ? `../textures/${t.name.replace(/\.dds$/i, ".png")}` : null), library);
		doc.asset = { version: "2.0", generator: GENERATOR };
		await files.write(`${out}/${f}`, writeGlb(doc, bin));
		written.push(f);
	}
	await files.write(`${out}/places.json`, new TextEncoder().encode(dumpPyJson(places, 1)));
	await files.write(`${out}/merged_floors.json`, new TextEncoder().encode(dumpPyJson(floor.merged, 1)));
	// (nothing else there: a model or a file of a build before (the old hand-made models' copies) out)
	const keep = new Set([...written, "places.json", "merged_floors.json", `${id}_trees.json`]);
	if (files.remove) for (const f of await files.list(out)) if ((f.endsWith(".glb") || f.endsWith(".json")) && !keep.has(f)) await files.remove(`${out}/${f}`);
	// (each layout's model list: the shared models and its own (the track's own models only: not where written elsewhere))
	if (!o.out) {
		const stem = (f: string) => f.replace(/\.glb$/, "");
		const shared = written.filter((f) => !layoutNames.some((l) => f === `${l}.glb`) && !gantryFiles.has(f)).map(stem);
		const lists = Object.fromEntries(
			layoutNames.map((l) => {
				const was = trackLayouts[l];
				const own = written.includes(`${l}.glb`) ? [l] : [];
				return [
					l,
					{
						models: [stem(main), ...own, ...shared.filter((m) => m !== stem(main)), ...(gantryLists[l] ?? [])],
						...(was?.from ? { from: was.from } : {}),
					},
				];
			}),
		);
		if (JSON.stringify(lists) !== JSON.stringify(Object.fromEntries(layoutNames.map((l) => [l, trackLayouts[l]]))))
			await changeTrack(files, s, paths.backups, (doc) => {
				doc.layouts = lists as unknown as PyJson;
			});
	}

	const ms = Math.round(performance.now() - t0);
	const lay = Object.values(places.layouts);
	log(`the track made in ${(ms / 1000).toFixed(1)} s: ${written.length} models in ${out}`);
	return {
		out,
		models: written,
		floor: { regions: floor.regions, faces: floor.faces },
		lines: lines.length,
		objects: count,
		trees: planted && { count: planted.count, cleared: planted.cleared, offFloor: planted.offFloor },
		places: {
			layouts: lay.length,
			spots: lay.reduce((a, L) => a + L.spots.length, 0),
			objects: lay.reduce((a, L) => a + L.objects.length, 0),
			lights: lights.length,
		},
		gantries: gantryLists,
		ms,
	};
}
