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
import type { HostFiles, PlaceHost } from "./placehost";
import { layoutPlaces, type ObjectsIn, type PlacesDoc, SPOT_LIFT } from "./places";
import { earClip } from "./polygon";
import { dumpPyJson, type PyJson, plain } from "./pyjson";
import type { RoadDesc } from "./roads";
import { floorOf, surfaceOf } from "./roadshost";
import { layRubber } from "./rubber";
import type { Surface } from "./surface";
import { type CatalogueModel, type CatalogueSource, catalogue, editorModelsOf, loadTemplate, type TemplatePart } from "./templates";
import { changeTrack, readPart, trackRoads } from "./trackdoc";
import { settingsOf, settingsPaths, type TrackSettings } from "./trackfiles";
import { buildFloor, type FloorMade, GROUND } from "./trackfloor";
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

type Log = (line: string) => void;
type Height = (x: number, z: number) => number;

/** The objects' part of the track file as the build reads it. */
interface ObjectsDoc {
	marks?: Mark[];
	rubber?: RubberMark[];
	layouts?: Record<string, Parameters<typeof startLinePaint>[0][string]>;
	objects?: PlacedObject[];
	areas?: PavedAreaIn[];
	wear?: TrackWear;
	ai?: AiSettings;
	surface?: SurfaceRoughness;
}

/** The material library's materials as the build reads them: each one's picture, and the metres its picture is mapped every. */
type LibraryDoc = Record<string, { colour?: string; metres?: number }>;

/** The track file's layouts: each one's model list, and the layout it is made from. */
type TrackLayouts = Record<string, { models?: string[]; from?: string }>;

/** A path without the slashes it ends with. */
function withoutTrailingSlashes(p: string): string {
	let end = p.length;
	while (end > 0 && (p[end - 1] === "/" || p[end - 1] === "\\")) end--;
	return p.slice(0, end);
}

/** A model with nothing in it yet. */
const blank = (): Kn5 => ({
	version: 6,
	extra: 0,
	textures: [],
	materials: [],
	root: { kind: 1, name: "", active: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [] },
});

/** The ground's own picture, generated from the photo's covers where the track asks it (its photo Google's, or anyone's not to be handed on): made, or made
 * again, before the library is read, its material in it; that material, null where the track does not ask it. */
async function groundPicture(files: HostFiles, project: string, s: TrackSettings, log: Log): Promise<string | null> {
	const asked = plain(((await readPart(files, s, "objects")) ?? {}) as PyJson) as { ground?: { picture?: string } };
	if (asked.ground?.picture !== "generated") return null;
	const p0 = settingsPaths(s);
	const libDoc = JSON.parse(text(await files.read(`${project}/source/materials.json`))) as {
		materials?: Record<string, { colour?: string }>;
	};
	const photoName = p0.satellite.split("/").pop() ?? "";
	const photoMaterial = Object.entries(libDoc.materials ?? {}).find(([, m]) => m.colour === photoName)?.[0];
	if (!photoMaterial) throw new Error(`the material library (source/materials.json) has no material of the track's picture (${photoName})`);
	return await generatedGround(files, project, p0.satellite, photoMaterial, p0.span, log);
}

/** The material library's materials (source/materials.json), as the build reads them. */
async function libraryDoc(files: HostFiles, project: string): Promise<LibraryDoc> {
	return (
		(
			JSON.parse(text(await files.read(`${project}/source/materials.json`))) as {
				materials?: LibraryDoc;
			}
		).materials ?? {}
	);
}

/** The paved areas (car parks, lanes): paved floors of their own shape in the floor's model (main), merged as paving. */
function layAreas(models: Record<string, Kn5>, main: string, areas: PavedAreaIn[] | undefined, lib: LibraryDoc, log: Log) {
	for (const a of areas ?? []) {
		const m = areaMesh(a.points, lib[a.material]?.metres ?? 4);
		if (m) (models[main] as Kn5).root.children.push(meshNode(models[main] as Kn5, `1ROAD_${a.name}`, m, a.material, null, models));
	}
	if (areas?.length) log(`${areas.length} paved areas into ${main}`);
}

/** The ground's material: the generated picture's where there is one, else the library's material of the track's picture. */
function groundMaterialOf(generated: string | null, lib: LibraryDoc, picture: string): string {
	const groundMaterial = generated ?? Object.entries(lib).find(([, m]) => m.colour === picture)?.[0];
	if (!groundMaterial) throw new Error(`the material library (source/materials.json) has no material of the track's picture (${picture})`);
	return groundMaterial;
}

/** The floor as merged, all of it (the far ground too: trees stand on it). */
function wholeFloor(floor: FloorMade): Surface {
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
}

/** A floor's height where a point is, 0 past it. */
const heightOn =
	(all: Surface): Height =>
	(x, z) => {
		const y = all.y(x, z);
		return Number.isNaN(y) ? 0 : y;
	};

/** The paint: the edge lines and the marks, painted as one where they meet, on the roads and rumbles as merged; the start lines; into the paint's model
 * (paintFile), in the track's wear (its own pictures, the asphalt's grain showing through, worn and dirtied as it is used). Its lines. */
async function paintRoads(
	paintFile: string,
	byName: Roads,
	roadsOnly: Surface,
	objects: ObjectsDoc | null,
	top: Height,
	models: Record<string, Kn5>,
	log: Log,
) {
	const lines = await layPaint(byName, roadsOnly, objects?.marks ?? []);
	if (objects) lines.push(...startLinePaint(objects.layouts ?? {}, byName, top));
	const paintModel = models[paintFile] as Kn5;
	const wear = objects?.wear ?? {};
	const paintWear = wear.paint ?? "new";
	for (const c of ["white", "yellow"] as const)
		await giveMaterial(paintModel, PAINT_WORN[c].material, PAINT_WORN[c].picture, () => paintPicture(c, paintWear), PAINT_DIFFUSE);
	writeLines(paintModel, lines, models, { white: PAINT_WORN.white.material, yellow: PAINT_WORN.yellow.material });
	log(`the paint: ${lines.length} lines into ${paintFile}, ${paintWear.replace("_", " ")}`);
	return lines;
}

/** The rubber the cars have laid on the roads, each mark a band over the road, its paint and its rumbles, its pictures its own all along; in the paint's
 * model, as the paint is: every layout's. */
async function layRubberMarks(rubber: RubberMark[], roadsOnly: Surface, paintModel: Kn5, models: Record<string, Kn5>, log: Log) {
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
		const suffix = i ? `_${i + 1}` : "";
		const node = meshNode(paintModel, `${r.name}${suffix}`, piece.mesh, material, null, models);
		node.cast_shadows = 0;
		paintModel.root.children.push(node);
	}
	const shown = rubber.filter((_, k) => count.has(k)).length;
	const sizes = laid.pages.map((p) => `${p.width} x ${p.height}`).join(", ") || "no";
	log(
		`the rubber: ${laid.pieces.length} pieces of ${shown} of ${rubber.length} rubber marks (the others under them), ` +
			`${sizes} pictures, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
	);
}

/** The editor's catalogue, and its models' parts, each model's loaded once. */
async function catalogueOf(files: HostFiles, project: string, editorModels: string | undefined, library: MaterialLibrary) {
	const csrc: CatalogueSource = {
		read: (f) => files.read(f),
		exists: (f) => files.exists(f),
		editorModels: editorModelsOf(project, editorModels),
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
	return { cat, partsOf };
}

/** What the objects and the trees are laid with: the models made, the layouts, the editor's catalogue (its models' parts), the library, the floor's height. */
interface Laying {
	models: Record<string, Kn5>;
	layoutNames: string[];
	cat: Record<string, CatalogueModel>;
	partsOf: (model: string) => Promise<TemplatePart[]>;
	library: MaterialLibrary;
	top: Height;
	log: Log;
}

/** The objects laid: each one laid, how many of each model, their lights; by layout, the start gantries' models it lists, and the gantries' model files. */
interface ObjectsLaid {
	laid: LaidObject[];
	count: Record<string, number>;
	lights: unknown[];
	gantryLists: Record<string, string[]>;
	gantryFiles: Set<string>;
}

/** The objects, of the editor's catalogue: laid on the floor, into the shared model and the layouts' own; the start gantries each a model of its own. */
async function layObjects(b: Laying, objects: ObjectsDoc | null): Promise<ObjectsLaid> {
	const out: ObjectsLaid = { laid: [], count: {}, lights: [], gantryLists: {}, gantryFiles: new Set<string>() };
	if (!objects?.objects?.length) return out;
	const { models, cat } = b;
	const isGantry = (l: LaidObject) => cat[l.model]?.kind === GANTRIES && l.parts.length > 0;
	for (const ob of objects.objects) {
		const meta = cat[ob.model];
		if (!meta || !ob.curve?.length) continue;
		const l = layObject(ob, meta, await b.partsOf(ob.model), b.top);
		// (a static gantry's collision round its feet, the way under it left free)
		if (isGantry(l) && l.collision === "static") l.boxes = gantryFeet(l);
		out.laid.push(l);
	}
	const sharedFile = `${MODEL}_objects.glb`;
	models[sharedFile] = blank();
	const w = writeObjects(
		out.laid,
		models[sharedFile] as Kn5,
		Object.fromEntries(b.layoutNames.map((l) => [l, models[`${l}.glb`] as Kn5])),
		models,
		(m) => cat[m]?.lights as ModelLight[] | undefined,
		b.top,
		{ old: Object.values(models), apart: isGantry },
	);
	out.count = w.count;
	out.lights = w.lights;
	writeGantries(b, objects, out.laid.filter(isGantry), out);
	const each = Object.entries(out.count)
		.map(([m, n]) => `${n} ${m}`)
		.join(", ");
	b.log(`the objects: ${each}`);
	return out;
}

/** The start gantries: each a model of its own, working or still in each layout, each written once; by layout, the gantries' models it lists. */
function writeGantries(b: Laying, objects: ObjectsDoc, gantries: LaidObject[], out: ObjectsLaid) {
	const { models, layoutNames } = b;
	const working = workingGantries(
		gantries,
		Object.fromEntries(
			layoutNames.map((l) => {
				const lay = objects.layouts?.[l];
				return [l, lay ? startLine(lay) : null];
			}),
		),
	);
	const still = (m: string) => stillMaterials(m).find((n) => b.library.get(n)) ?? null;
	for (const g of gantries)
		for (const l of layoutNames) {
			if (g.layouts && !g.layouts.includes(l)) continue;
			const on = working[l] === g.name;
			const f = `${gantryModel(MODEL, g.name, on)}.glb`;
			if (!models[f]) {
				models[f] = blank();
				writeGantry(g, models[f] as Kn5, models, on, still);
				out.gantryFiles.add(f);
			}
			out.gantryLists[l] = [...(out.gantryLists[l] ?? []), f.slice(0, -".glb".length)];
		}
	if (gantries.length) {
		const each = layoutNames.map((l) => `${l} ${working[l] ?? "none"} working`).join(", ");
		b.log(`the gantries: ${each}`);
	}
}

/** The trees, of the catalogue's trees: into the trees' model, those on a solid object's ground (laid) left out; where each stands written beside its model
 * (another game's forest stands them so, BeamNG's). What was planted; null where the track has no trees. */
async function plantTrees(b: Laying, files: HostFiles, s: TrackSettings, out: string, all: Surface, laid: LaidObject[]): Promise<TreesWritten | null> {
	const trees = plain((await loadTrees(files, s)) as PyJson) as TreePlacement[];
	if (!trees.length) return null;
	const { cat, models } = b;
	const treeModels = [...new Set(trees.map((t) => t.model))].filter((m) => TREE_KINDS.has(cat[m]?.kind ?? ""));
	const shapes = new Map(await Promise.all(treeModels.map(async (m) => [m, await b.partsOf(m)] as const)));
	const treesFile = `${MODEL}_trees.glb`;
	models[treesFile] = blank();
	const planted = writeTrees(trees, models[treesFile] as Kn5, cat, shapes, (x, z) => all.y(x, z), laid, models);
	const n = Object.values(planted.count).reduce((sum, k) => sum + k, 0);
	b.log(
		`the trees: ${n} into ${treesFile} (${planted.meshes} meshes), ${planted.cleared} cleared` +
			(planted.offFloor ? `, ${planted.offFloor} off the floor` : "") +
			(planted.unknown.length ? `; not trees of the catalogue: ${planted.unknown.join(", ")}` : ""),
	);
	await files.write(`${out}/${treesFile.replace(/\.glb$/, ".json")}`, new TextEncoder().encode(JSON.stringify({ version: 1, trees: planted.planted })));
	return planted;
}

/** Every model written into out: a texture the track's source/textures holds (as X.png, or as named) pointed at there; one it does not (an editor's model's
 * own pictures) kept in the model itself. The files written. */
async function writeModels(files: HostFiles, project: string, out: string, models: Record<string, Kn5>, library: MaterialLibrary): Promise<string[]> {
	const inSource = new Map<string, boolean>();
	for (const k of Object.values(models))
		for (const t of k.textures)
			if (!inSource.has(t.name)) {
				const png = t.name.replace(/\.dds$/i, ".png");
				const dir = `${project}/source/textures`;
				inSource.set(t.name, (await files.exists(`${dir}/${png}`)) || (await files.exists(`${dir}/${t.name}`)));
			}
	const written: string[] = [];
	for (const [f, k] of Object.entries(models)) {
		const { doc, bin } = toGltf(k, (t) => (inSource.get(t.name) ? `../textures/${t.name.replace(/\.dds$/i, ".png")}` : null), library);
		doc.asset = { version: "2.0", generator: GENERATOR };
		await files.write(`${out}/${f}`, writeGlb(doc, bin));
		written.push(f);
	}
	return written;
}

/** Nothing in out but what is kept: a model or a file of a build before (the old hand-made models' copies) taken out. */
async function clearOut(files: HostFiles, out: string, keep: Set<string>) {
	if (!files.remove) return;
	for (const f of await files.list(out)) if ((f.endsWith(".glb") || f.endsWith(".json")) && !keep.has(f)) await files.remove(`${out}/${f}`);
}

/** Each layout's model list in the track file: the shared models and its own (the track's own models only: not where written elsewhere), its gantries'; the
 * track file changed where they are not so already. */
async function writeLayoutLists(
	files: HostFiles,
	s: TrackSettings,
	backups: string,
	written: string[],
	layoutNames: string[],
	trackLayouts: TrackLayouts,
	o: ObjectsLaid,
) {
	const main = `${MODEL}.glb`;
	const stem = (f: string) => f.replace(/\.glb$/, "");
	const shared = written.filter((f) => !layoutNames.some((l) => f === `${l}.glb`) && !o.gantryFiles.has(f)).map(stem);
	const lists = Object.fromEntries(
		layoutNames.map((l) => {
			const was = trackLayouts[l];
			const own = written.includes(`${l}.glb`) ? [l] : [];
			return [
				l,
				{
					models: [stem(main), ...own, ...shared.filter((m) => m !== stem(main)), ...(o.gantryLists[l] ?? [])],
					...(was?.from ? { from: was.from } : {}),
				},
			];
		}),
	);
	if (JSON.stringify(lists) !== JSON.stringify(Object.fromEntries(layoutNames.map((l) => [l, trackLayouts[l]]))))
		await changeTrack(files, s, backups, (doc) => {
			doc.layouts = lists as unknown as PyJson;
		});
}

/** The track's models made from its source (see the module's note). */
export async function buildTrack(host: PlaceHost, filler: Filler, o: TrackBuildOptions): Promise<TrackBuilt> {
	const t0 = performance.now();
	const log = o.log ?? (() => {});
	const files = host.files;
	const project = withoutTrailingSlashes(o.project);
	const s = await settingsOf(files, project);
	const out = o.out ?? settingsPaths(s).models;
	const generated = await groundPicture(files, project, s, log);
	const library = (await libraryOf(files, project)) as MaterialLibrary;
	if (!library) throw new Error("the track has no material library (source/materials.json)");
	// (the models, every one made here: the floor, its rumbles, the paint, each layout's own; the objects' and the trees' after)
	const main = `${MODEL}.glb`;
	const kerbsFile = `${MODEL}_kerbs.glb`;
	const linesFile = `${MODEL}_lines.glb`;
	const models: Record<string, Kn5> = { [main]: blank(), [kerbsFile]: blank(), [linesFile]: blank() };
	const objectsDoc = await readPart(files, s, "objects");
	const objects = (objectsDoc === null ? null : plain(objectsDoc)) as ObjectsDoc | null;
	const trackLayouts = (s.track.layouts ?? {}) as TrackLayouts;
	const layoutNames = [...new Set([...Object.keys(trackLayouts), ...Object.keys(objects?.layouts ?? {})])].sort(byCodePoint);
	for (const lay of layoutNames) models[`${lay}.glb`] = blank();
	const roads = plain((await trackRoads(files, s)) as PyJson) as unknown as RoadDesc[];
	const lib = await libraryDoc(files, project);
	// (the paved areas (car parks, lanes): paved floors of their own shape in the floor's model, merged as paving)
	layAreas(models, main, objects?.areas, lib, log);
	// (the paint's: each road by its name)
	const byName = Object.fromEntries(roads.map((r) => [r.name, r])) as Roads;
	// (the ground: the track's map, its satellite's square round the middle, the picture laid over it as the editor shows it; in the library's material of that
	// picture)
	const paths = settingsPaths(s);
	const half = paths.span / 2;
	const groundMaterial = groundMaterialOf(generated, lib, paths.satellite.split("/").pop() ?? "");
	const areaFloors = (objects?.areas ?? []).map((a) => `1ROAD_${a.name}`);
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
	const all = wholeFloor(floor);
	const top = heightOn(all);
	const lines = await paintRoads(linesFile, byName, roadsOnly, objects, top, models, log);
	const rubber = objects?.rubber ?? [];
	if (rubber.length) await layRubberMarks(rubber, roadsOnly, models[linesFile] as Kn5, models, log);
	// (the objects, of the editor's catalogue)
	const { cat, partsOf } = await catalogueOf(files, project, o.editorModels, library);
	const known = (m: string): boolean => m in cat;
	const laying: Laying = { models, layoutNames, cat, partsOf, library, top, log };
	const laid = await layObjects(laying, objects);
	const { count, lights } = laid;
	const planted = await plantTrees(laying, files, s, out, all, laid.laid);
	// (the layouts' places, on the floor; the objects' lights with them)
	const places: PlacesDoc = objects ? { ...layoutPlaces(objects as ObjectsIn, top, known, null, SPOT_LIFT), lights } : { version: 1, layouts: {}, lights };
	// (written: every model, the places, what the merge made; the layouts' model lists with the shared model)
	const written = await writeModels(files, project, out, models, library);
	await files.write(`${out}/places.json`, new TextEncoder().encode(dumpPyJson(places, 1)));
	await files.write(`${out}/merged_floors.json`, new TextEncoder().encode(dumpPyJson(floor.merged, 1)));
	// (nothing else there: a model or a file of a build before (the old hand-made models' copies) out)
	await clearOut(files, out, new Set([...written, "places.json", "merged_floors.json", `${MODEL}_trees.json`]));
	// (each layout's model list: the shared models and its own (the track's own models only: not where written elsewhere))
	if (!o.out) await writeLayoutLists(files, s, paths.backups, written, layoutNames, trackLayouts, laid);

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
		gantries: laid.gantryLists,
		ms,
	};
}
