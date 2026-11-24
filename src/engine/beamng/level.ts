// The track as a BeamNG.drive level, made from the track's data (the track's export_beamng.py, TRACK_FORMAT.md), not from another game's build: one map of
// every layout, the models they load (track/models) each once, their materials from the library (source/materials.json) and their textures (source/textures),
// written as build/beamng/levels/<level> with the meshes as Collada shapes, their textures and materials, and the level's objects; packed as
// build/dist/<level>_beamng.zip, beside the Assetto Corsa archive, to drop in BeamNG's mods folder. Only the models and textures that changed since the last
// run are written again.
//
// What each mesh is comes from the model (extras.track): the surfaces are solid, with the BeamNG ground model of their ground (surfaces.json's targets.beamng);
// the walls solid and unseen; all else only seen. What vehicles hit is not what is drawn: the solid meshes and the walls made coarse and cut in tiles of their
// own (collision.ts), as BeamNG's own tracks are, else BeamNG takes a minute working the floor's millions of triangles out. The paint and the rubber lie
// millimetres over the floor as BeamNG's own road marks do, casting no shadow: the paint cut out and drawn with the floor, the rubber blended over it (both
// blended, the one drawn over the other changed as the camera moved: they flickered). The layouts' knockable cones (places.json) are BeamNG's own loose cones,
// which each race spawns, its own layout's, and its marker boards a vehicle of their own. A mesh drawn only near, with a simpler one only far (the tyre
// stacks), is a shape of its own with both as its detail levels. Karts start on the grid's first slot of each layout, facing the way its lap runs; the layouts'
// racing lines (the AC build's AI lines) are BeamNG's road network (waypoints and map.json), for its map and AI, one road where layouts share it. The track's
// lights are spot lights, lit at night only. The level stands LIFT metres up, above BeamNG's ground. Each layout's race is a time trial mission; the gantry
// board and lamps are run by the level's Lua (the editor's models/scripts/beamng, under the level's own names: levelScripts). The models every layout loads are
// the map's (a gantry still in some layouts, working in others, is its working one: <gantry> and <gantry>_still, as the track's build writes them); those only
// some layouts load are spawned by their activities (its races' prefabs), with their cones.

import { readAiFile } from "../acai";
import { acFolder, digestOf, filesUnder, placeMatrix } from "../acbuild";
import { boardText, type CardPainter, canvasCards, cardSheet, cardUv } from "../boardfaces";
import { acDds, type Picture, readPng, resizeLanczos, type TextureAc } from "../dds";
import { STILL } from "../gantries";
import { layoutTitle, type MapSpec, mapPoint, type OutlineSpec, racingLine, startFacing, startSpot } from "../layoutmap";
import { writeZip } from "../npz";
import { byCodePoint } from "../order";
import type { HostFiles } from "../placehost";
import type { LayoutPlaces, PlacesDoc, Spot } from "../places";
import { type CatalogueSource, catalogue, editorModelsOf, loadTemplate, scriptsOf } from "../templates";
import { acPoint, layoutViews, type RenderHost, type Shot, startView, trackScene } from "../trackrender";
import { ASPHALT_GREY, isPaintPicture, isRubberPage, RUBBER_ROUGHNESS } from "../wear";
import { BOARD, boardConfig, boardMaterials, FLAGS, GLYPHS, gantry, glyphMesh, glyphName, LAMPS, lampMaterial, SHAPES } from "./board";
import { collisionTiles, GROUND_ERROR, ROAD_ERROR, type Solid } from "./collision";
import { type DaeMesh, writeDae } from "./dae";
import { bladesTexture, grassClumps, grassPlaces } from "./grass";
import { opacityPng, overGreyPng, rgbPng, writePng } from "./images";
import { roadNetwork, routeRaces, type Waypoint } from "./network";
import { aiMission, aiPath, type Board, type ConeSet, coneParts, conePrefab, mission, type RacePath, racePath, uuid5, type V3 } from "./races";
import { CORNER, groundOf, type OwnMaterial, type TrackMesh, trackModel } from "./trackmodel";

/** the level's own ground models: BeamNG's GRASS is a soft layer 5 cm deep that wheels sink into, which hides half a kart's tyre; this is its grass with a
 * layer of 1 cm (surfaces.json's grass: targets.beamng VELOPARK_GRASS) */
const GROUND_MODELS = {
	VELOPARK_GRASS: {
		staticFrictionCoefficient: 0.61,
		slidingFrictionCoefficient: 0.65,
		hydrodynamicFriction: 0.005,
		stribeckVelocity: 4,
		strength: 1,
		roughnessCoefficient: 0.43,
		fluidDensity: 8000,
		flowConsistencyIndex: 1500,
		flowBehaviorIndex: 0.7,
		dragAnisotropy: 0,
		shearStrength: 4000,
		defaultDepth: 0.01,
		collisiontype: "GRASS",
		skidMarks: false,
	},
};
const WOOD = "WOOD";
/** the grounds the map of each start shows, as roads */
const ROADS = new Set(["asphalt", "rumble", "kerb"]);
/** how far up the level stands: a level without terrain has BeamNG's ground at height 0 */
export const LIFT = 50;
const LIGHT_INTENSITY = 15000;
const LIGHT_GAIN = 4;
/** pixels on screen per metre of a shape's radius at a metre away (1080 high, BeamNG's 60 degrees) */
const SCREEN = 1080 / (2 * Math.tan(Math.PI / 6));
/** raised when the shapes or textures are written differently: a level built before made again */
const FORMAT = 3;
/** of 255: the paint cut out where it shows less than half */
const PAINT_ALPHA_REF = 128;
const BOARD_MATERIAL = "MarkerBoards";
const FOREST_WIND = {
	windScale: 0.25,
	branchAmp: 0.03,
	detailAmp: 0.05,
	detailFreq: 4,
	trunkBendScale: 0.02,
	mass: 40,
	rigidity: 20,
	tightnessCoefficient: 4,
};
const WAYPOINT_LIFT = 0.3;

/** What the level needs of where it is made: pictures read and made (Chromium's, in the app), a start's map drawn. */
export interface BeamngHost {
	decodeRgb(bytes: Uint8Array): Promise<Picture>;
	encodeJpeg(rgb: Picture, quality: number): Promise<Uint8Array>;
	/** the track rendered (trackrender.ts: its starts' places, AC's layouts' views), where there is a GPU */
	render?: RenderHost["render"];
	/** a start's map (JPEG; layoutmap's MapSpec, BeamNG's x, y), where the track cannot be rendered */
	mapPreview?(spec: MapSpec): Promise<Uint8Array>;
	/** a layout's outline (AC's outline.png), drawn by the same host for the AC build */
	outline?(spec: OutlineSpec): Promise<Uint8Array>;
}

/** a start's picture's size in the level (rendered) */
const PREVIEW_SIZE: [number, number] = [800, 450];

export interface BeamngOptions {
	project: string;
	/** the boards' cards drawn (by default on Chromium's canvas) */
	cards?: CardPainter;
	/** the layout BeamNG starts the level on (its spawn, its picture); every layout is the level's, its models, starts and races */
	layout: string;
	/** the AC build's track (its <layout>/ai/fast_lane.ai, pit_lane.ai: the racing lines) */
	ai: string;
	/** the level's folder (by default build/beamng) and the archive's (build/dist) */
	out?: string;
	dist?: string;
	editorModels?: string;
	/** the roads off the laps the map draws too (paths across the infield): their points (the track's x, z), half width; and each pit lane's half width by layout
	 * (else PIT_RADIUS) */
	sidePaths?: Record<string, { points: [number, number][]; radius: number }>;
	pitRadius?: Record<string, number>;
	/** the layouts a vehicle can be put at the start of when the level loads (by default the track file's beamng.spawns, else every layout); every layout keeps
	 * its races and time trials */
	spawns?: string[];
	pack?: boolean;
	log?: (line: string) => void;
}

export interface BeamngBuilt {
	level: string;
	zip: string | null;
	size: number;
	materials: number;
	/** the layouts' starts (each its picture, its races), and those of them one can spawn at */
	starts: number;
	spawns: number;
	waypoints: number;
}

const PIT_RADIUS = 5;
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const fileName = (t: string) => t.replace(/[^A-Za-z0-9_.-]/g, "_");
const ident = (t: string) => t.replace(/[^A-Za-z0-9_]/g, "_");

/** The track's y up to BeamNG's z up: x stays, -z is north, y is up (the layouts' maps' axes). */
export const toBeamng: (x: number, y: number, z: number) => V3 = mapPoint;

/** A mesh's points, normals, uvs and faces in BeamNG's axes, facing the way its normals do (none left: null). */
function meshArrays(m: TrackMesh): Omit<DaeMesh, "name" | "material"> | null {
	const faces: number[] = [];
	for (let f = 0; f < m.f.length; f += 3) {
		const [a, b, c] = [m.f[f] as number, m.f[f + 1] as number, m.f[f + 2] as number];
		if (a === b || b === c || a === c) continue;
		faces.push(a, b, c);
	}
	if (!faces.length) return null;
	const nv = m.v.length / CORNER;
	const P = new Float64Array(nv * 3);
	const N = new Float64Array(nv * 3);
	const U = new Float64Array(nv * 2);
	for (let k = 0; k < nv; k++) {
		const o = k * CORNER;
		P.set(toBeamng(m.v[o] as number, m.v[o + 1] as number, m.v[o + 2] as number), k * 3);
		N.set(toBeamng(m.v[o + 3] as number, m.v[o + 4] as number, m.v[o + 5] as number), k * 3);
		// (the track's v runs down the texture, Collada's up)
		U[k * 2] = m.v[o + 6] as number;
		U[k * 2 + 1] = 1 - (m.v[o + 7] as number);
	}
	facing(P, N, faces);
	return { P, N, U, F: faces };
}

/** Faces turned (in place) to face the way their corners' normals do. */
function facing(P: ArrayLike<number>, N: ArrayLike<number>, F: number[]): void {
	for (let f = 0; f < F.length; f += 3) {
		const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
		const u = [0, 1, 2].map((i) => (P[b * 3 + i] as number) - (P[a * 3 + i] as number));
		const w = [0, 1, 2].map((i) => (P[c * 3 + i] as number) - (P[a * 3 + i] as number));
		const g = [
			(u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number),
			(u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number),
			(u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number),
		];
		let dot = 0;
		for (const k of [a, b, c]) for (let i = 0; i < 3; i++) dot += (g[i] as number) * (N[k * 3 + i] as number);
		if (dot < 0) [F[f + 1], F[f + 2]] = [c, b];
	}
}

const bounds = (P: ArrayLike<number>): { lo: V3; hi: V3; mid: V3 } => {
	const lo: V3 = [Infinity, Infinity, Infinity];
	const hi: V3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < P.length; i += 3)
		for (let j = 0; j < 3; j++) {
			lo[j] = Math.min(lo[j] as number, P[i + j] as number);
			hi[j] = Math.max(hi[j] as number, P[i + j] as number);
		}
	return { lo, hi, mid: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] };
};

const shifted = (P: ArrayLike<number>, by: V3) => {
	const out = new Float64Array(P.length);
	for (let i = 0; i < P.length; i += 3) for (let j = 0; j < 3; j++) out[i + j] = (P[i + j] as number) - (by[j] as number);
	return out;
};

/** The ground's triangles (BeamNG's axes) by 4 m cells: the height of the road under a point, the highest under it no more than a metre over it. */
class Ground {
	private readonly cells = new Map<string, number[]>();
	constructor(readonly T: Float64Array) {
		for (let t = 0; t < T.length / 9; t++) {
			const xs = [T[t * 9] as number, T[t * 9 + 3] as number, T[t * 9 + 6] as number];
			const ys = [T[t * 9 + 1] as number, T[t * 9 + 4] as number, T[t * 9 + 7] as number];
			for (let gx = Math.floor(Math.min(...xs) / 4); gx <= Math.floor(Math.max(...xs) / 4); gx++)
				for (let gy = Math.floor(Math.min(...ys) / 4); gy <= Math.floor(Math.max(...ys) / 4); gy++) {
					const k = `${gx},${gy}`;
					const l = this.cells.get(k);
					if (l) l.push(t);
					else this.cells.set(k, [t]);
				}
		}
	}
	/** A point put on the road under it (as it is, where none). */
	on(p: V3): V3 {
		const T = this.T;
		let best = -Infinity;
		for (const t of this.cells.get(`${Math.floor(p[0] / 4)},${Math.floor(p[1] / 4)}`) ?? []) {
			const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from(T.subarray(t * 9, t * 9 + 9)) as number[];
			const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
			if (Math.abs(d) <= 1e-6) continue;
			const l1 = ((by - cy) * (p[0] - cx) + (cx - bx) * (p[1] - cy)) / d;
			const l2 = ((cy - ay) * (p[0] - cx) + (ax - cx) * (p[1] - cy)) / d;
			const l3 = 1 - l1 - l2;
			if (l1 < 0 || l2 < 0 || l3 < 0) continue;
			const z = l1 * (az as number) + l2 * (bz as number) + l3 * (cz as number);
			if (z < p[2] + 1 && z > best) best = z;
		}
		return Number.isFinite(best) ? [p[0], p[1], best] : p;
	}
}

/** The level made (see the module's note). */
export async function buildBeamng(files: HostFiles, host: BeamngHost, o: BeamngOptions): Promise<BeamngBuilt> {
	const log = o.log ?? (() => {});
	const project = o.project.replace(/[\\/]+$/, "");
	const readJson = async <T>(p: string): Promise<T> => JSON.parse(dec(await files.read(p))) as T;
	const exists = (p: string) => files.exists(p);
	const track = await readJson<{
		name?: string;
		models?: string;
		layouts?: Record<string, { models?: string[] }>;
		/** the level's own data: the paths off the laps its map draws ({name: {points: [x, z], radius}}), each pit lane's half width by layout, the layouts one can
		 * spawn at */
		beamng?: { side_paths?: BeamngOptions["sidePaths"]; pit_radius?: Record<string, number>; spawns?: string[] };
	}>(`${project}/tools/reference/track.json`);
	const trackName = track.name ?? "track";
	// (named as the AC track's folder is: its archive beside AC's, <level>_beamng.zip)
	const LEVEL = acFolder(trackName);
	const out = o.out ?? `${project}/build/beamng`;
	const level = `${out}/levels/${LEVEL}`;
	const shapes = `${level}/art/shapes`;
	const models = `${project}/${track.models || "track/models"}`;
	const ui = `${project}/source/track/ui`;
	const libDoc = await readJson<{
		materials: Record<string, { colour?: string; normal?: string; roughness?: string; alpha?: string; surface?: string; covers_grass?: boolean }>;
		textures?: Record<string, TextureAc>;
	}>(`${project}/source/materials.json`);
	const lib = libDoc.materials;
	const texAc = libDoc.textures ?? {};
	const surfaces = (await exists(`${project}/source/surfaces.json`))
		? ((await readJson<{ surfaces?: Record<string, { targets?: { beamng?: string } }> }>(`${project}/source/surfaces.json`)).surfaces ?? {})
		: {};
	const groundType = (kind: string) => surfaces[kind]?.targets?.beamng ?? "ASPHALT";
	const lists = Object.fromEntries(Object.entries(track.layouts ?? {}).map(([k, v]) => [k, v.models ?? []]));
	if (!lists[o.layout]?.length) throw new Error(`the track has no layout ${o.layout} (its model list in track.json)`);
	const { stems, shared, ownOf } = levelModels(lists, o.layout);
	const placesDoc = await readJson<PlacesDoc>(`${models}/places.json`);
	const places = placesDoc.layouts;
	const uiOf = async (lay: string) => {
		const p = `${ui}/${lay}/ui_track.json`;
		if (!(await exists(p))) return {} as Record<string, string>;
		return JSON.parse(dec(await files.read(p)).replace(/^﻿/, "")) as Record<string, string>;
	};
	// (what was written last time: each model's shapes and each texture by what they were made from)
	const stateFile = `${out}/models.editor.json`;
	let state: Record<string, unknown> = (await exists(stateFile)) ? await readJson(stateFile) : {};
	if (state.format !== FORMAT) state = { format: FORMAT };
	delete state.layout;
	state.textures ??= {};
	const texState = state.textures as Record<string, string>;
	const written = new Set<string>();
	const put = async (path: string, data: Uint8Array | string) => {
		written.add(path);
		await files.write(path, typeof data === "string" ? enc(data) : data);
	};
	const keep = (path: string) => written.add(path);

	// ---- textures: each written once into art/shapes/textures/track, again only when its PNG changed
	const texDir = `${shapes}/textures/track`;
	const texSrc = async (png: string, model?: string) => {
		const own = model ? `${project}/source/textures/${model}/${png}` : null;
		return own && (await exists(own)) ? { path: own, own: true } : { path: `${project}/source/textures/${png}`, own: false };
	};
	const putTexture = async (f0: string, png: string, kind: string, make: (b: Uint8Array) => Promise<Uint8Array>, model?: string) => {
		const src = await texSrc(png, model);
		const f = src.own && model ? `${fileName(model)}_${f0}` : f0;
		const outPath = `${texDir}/${f}`;
		const bytes = await files.read(src.path);
		const key = `${kind}:${await digestOf([bytes])}`;
		if (texState[f] !== key || !(await exists(outPath))) {
			await files.write(outPath, await make(bytes));
			texState[f] = key;
		}
		written.add(outPath);
		return `/levels/${LEVEL}/art/shapes/textures/track/${f}`;
	};
	const ddsCache = `${project}/build/cache/dds`;
	const colourTexture = (png: string, model?: string) => {
		const fmt = texAc[png]?.ac ?? "DXT1";
		// (a library's JPEG as it is, as an editor's model's own: BeamNG reads it so, and it is no PNG to make a DDS of)
		if (["DXT1", "DXT3", "DXT5"].includes(fmt) && /\.png$/i.test(png))
			return putTexture(
				fileName(`${png.replace(/\.[^.]*$/, "")}.dds`),
				png,
				`colour ${fmt}`,
				async (b) => {
					// (the AC build's DDS of it where it made one: the same file)
					const key = await digestOf([b, enc(fmt), new Uint8Array([texAc[png]?.normal ? 1 : 0])]);
					const kept = `${ddsCache}/${key}.dds`;
					if (await exists(kept)) return files.read(kept);
					const made = await acDds(`${png.replace(/\.[^.]*$/, "")}.dds`, b, texAc);
					await files.write(kept, made);
					return made;
				},
				model,
			);
		return pngTexture(png, model);
	};
	const pngTexture = (png: string, model?: string) => putTexture(fileName(png), png, "png", async (b) => b, model);
	const opacityTexture = (png: string, model?: string) => putTexture(fileName(`${png.replace(/\.[^.]*$/, "")}_opacity.png`), png, "opacity", opacityPng, model);

	/** An editor's model's own picture (inside its model) as it is, what shows through it, or its colour as it shows over the asphalt (the paint's, drawn cut
	 * out); written once a picture. */
	const ownTexture = async (pic: { name: string; data: Uint8Array }, as: "colour" | "opacity" | "over" = "colour") => {
		const hash = await digestOf([pic.data]);
		const stemOf = pic.name.replace(/\.[^.]*$/, "");
		const f = fileName(`own_${hash.slice(0, 8)}_${as === "opacity" ? `${stemOf}_opacity.png` : as === "over" ? `${stemOf}_over.png` : pic.name}`);
		const outPath = `${texDir}/${f}`;
		const key = `own ${as}:${hash}`;
		if (texState[f] !== key || !(await exists(outPath))) {
			const made = as === "opacity" ? await opacityPng(pic.data) : as === "over" ? await overGreyPng(pic.data, ASPHALT_GREY) : pic.data;
			await files.write(outPath, made);
			texState[f] = key;
		}
		written.add(outPath);
		return `/levels/${LEVEL}/art/shapes/textures/track/${f}`;
	};

	// ---- materials
	const materials: Record<string, unknown> = {};
	const material = async (name: string | null, kind: string | null, hidden: boolean, stem: string, own?: OwnMaterial): Promise<string> => {
		// (an editor's model's own: its picture and alpha, never the library's of its name)
		const e: (typeof lib)[string] = own ? { alpha: own.alpha } : ((name ? lib[name] : undefined) ?? {});
		const key =
			ident(own ? `tsvp_own_${name ?? "none"}_${own.colour?.name ?? ""}` : `tsvp_${name ?? "none"}`) + (kind ? `_${kind}` : "") + (hidden ? "_hidden" : "");
		if (key in materials) return key;
		const stage: Record<string, unknown> = {};
		// (what lies on the floor, a few millimetres over it: the paint and the rubber, drawn as BeamNG's own road marks are)
		const paint = !!own?.colour && isPaintPicture(own.colour.name);
		const rubber = !!own?.colour && isRubberPage(own.colour.name);
		if (hidden) {
			stage.baseColorFactor = [1, 1, 1, 0];
			stage.opacityFactor = 0;
		} else if (own) {
			// (the rubber's pages as rough as the road under them: only its colour darkened, its sheen as it is)
			stage.roughnessFactor = rubber ? RUBBER_ROUGHNESS : 1;
			stage.metallicFactor = 0;
			if (own.colour) {
				stage.baseColorMap = await ownTexture(own.colour, paint ? "over" : "colour");
				if (own.alpha !== "opaque" && own.colour.name.toLowerCase().endsWith(".png")) stage.opacityMap = await ownTexture(own.colour, "opacity");
			}
		} else {
			// (rough and not metal unless its maps say: BeamNG's default shines like glass)
			stage.roughnessFactor = 1;
			stage.metallicFactor = 0;
			if (e.colour) {
				stage.baseColorMap = await colourTexture(e.colour, stem);
				// (BeamNG takes what shows through from its own map, not the colour's alpha)
				if (e.alpha === "mask" || e.alpha === "blend") stage.opacityMap = await opacityTexture(e.colour, stem);
			}
			if (e.normal) stage.normalMap = await pngTexture(e.normal, stem);
			if (e.roughness) stage.roughnessMap = await pngTexture(e.roughness, stem);
		}
		const mat: Record<string, unknown> = {
			name: key,
			mapTo: key,
			class: "Material",
			persistentId: uuid5(`${LEVEL}/${key}`),
			version: 1.5,
			Stages: [stage, {}, {}, {}],
		};
		if (paint) {
			// (cut out where it is thinner than half, as BeamNG's own painted lines: drawn with the floor, not sorted with the rubber over it, which drawn blended
			// would be over it one frame and under it the next)
			Object.assign(mat, { alphaTest: true, alphaRef: PAINT_ALPHA_REF, castShadows: false });
		} else {
			if (e.alpha === "mask") Object.assign(mat, { alphaTest: true, alphaRef: 100 });
			if (e.alpha === "blend" || hidden) mat.translucent = true;
		}
		// (the rubber blended over the paint and the floor, casting no shadow on what is millimetres under it, writing no depth: its marks over one another, at one
		// height, of one colour, the same drawn either way round; in the shadows that fall on the floor as it is, as BeamNG's own marks on a road: else lit by the
		// sun under a car's shadow)
		if (rubber) Object.assign(mat, { castShadows: false, translucentZWrite: false, translucentRecvShadows: true });
		// (a mesh's material names its ground in groundType, or BeamNG drives it as asphalt)
		if (kind) mat.groundType = groundType(kind);
		materials[key] = mat;
		return key;
	};
	/** A start lamp's glow through its own glass (its model's own picture, else its library material's); none: the plain lamp's. */
	const lampOf = async (m: TrackMesh, stem: string): Promise<string> => {
		const pic = m.own?.colour;
		const colour = m.own ? undefined : m.material ? lib[m.material]?.colour : undefined;
		if (!m.material || (!pic && !colour)) return "velopark_lamp";
		const key = ident(`velopark_lamp_${m.material}${pic ? `_own_${pic.name}` : ""}`);
		if (!(key in materials)) {
			const white = `/levels/${LEVEL}/art/shapes/${SHAPES}/white.png`;
			const map = pic ? await ownTexture(pic) : await colourTexture(colour as string, stem);
			materials[key] = lampMaterial(key, uuid5(`${LEVEL}/${key}`), white, map);
		}
		return key;
	};

	// ---- the shapes of each model the layout loads
	const libBytes = await files.read(`${project}/source/materials.json`);
	const surfBytes = (await exists(`${project}/source/surfaces.json`)) ? await files.read(`${project}/source/surfaces.json`) : new Uint8Array(0);
	const statics: {
		/** the model it is of */
		stem: string;
		name: string;
		shapeName: string;
		collisionType: string;
		/** what decals are laid on (by default its collision, if it has one) */
		decalType?: string;
		position?: V3;
		extra?: Record<string, unknown>;
	}[] = [];
	const ground: Float64Array[] = [];
	const roadMap: number[] = [];
	const meshesOf = new Map<string, TrackMesh[]>();
	const hashes: string[] = [];
	const lamps = new Map<string, string[]>();
	const gantries: ReturnType<typeof gantry>[] = [];
	const forestModel = stems.find((s) => s.endsWith("_trees"));
	const forestFile = forestModel ? `${models}/${forestModel}.json` : null;
	const forestData =
		forestFile && (await exists(forestFile)) ? (await readJson<{ trees: [string, number, number, number, number, number][] }>(forestFile)).trees : null;
	const shapeName = (f: string) => `/levels/${LEVEL}/art/shapes/${f}`;
	const madeBefore = await filesUnder(files, shapes).catch(() => [] as string[]);
	for (const stem of stems) {
		const glb = `${models}/${stem}.glb`;
		if (!(await exists(glb))) continue;
		const raw = await files.read(glb);
		const h = await digestOf([raw, libBytes, surfBytes]);
		const fresh = state[stem] !== h;
		const ms = trackModel(raw);
		meshesOf.set(stem, ms);
		hashes.push(h);
		const parts: Record<"solid" | "seen", DaeMesh[]> = { solid: [], seen: [] };
		/** what vehicles hit: the solid meshes and the walls, each as near its own as its ground needs */
		const hits: Solid[] = [];
		const seen: [TrackMesh, DaeMesh][] = [];
		// (BeamNG's forest stands every tree of the trees' model)
		if (!(forestData && stem === forestModel))
			for (const m of ms) {
				const arrays = meshArrays(m);
				if (!arrays) continue;
				const kind = groundOf(m, lib);
				if (kind && !m.visible) {
					const mesh = { name: m.name, material: await material(m.material, kind, true, stem, m.own), ...arrays };
					hits.push({ mesh, error: ROAD_ERROR });
				} else if (kind) {
					const mesh = { name: m.name, material: await material(m.material, kind, false, stem, m.own), ...arrays };
					parts.solid.push(mesh);
					hits.push({ mesh, error: ROADS.has(kind) ? ROAD_ERROR : GROUND_ERROR });
					const T = new Float64Array(arrays.F.length * 3);
					for (let k = 0; k < arrays.F.length; k++)
						T.set((arrays.P as Float64Array).subarray((arrays.F[k] as number) * 3, (arrays.F[k] as number) * 3 + 3), k * 3);
					ground.push(T);
					if (ROADS.has(kind)) for (let k = 0; k < T.length; k += 3) roadMap.push(T[k] as number, T[k + 1] as number);
				} else if (!m.visible) continue;
				else if (LAMPS.test(m.name) || FLAGS.test(m.name)) {
					// (the gantry's lamps: shapes of their own, which the level's Lua lights)
					const { mid } = bounds(arrays.P);
					const f = `${stem}_${m.name}.dae`;
					const path = `${shapes}/${f}`;
					const glow = LAMPS.test(m.name) ? await lampOf(m, stem) : "velopark_lamp";
					if (fresh || !(await exists(path)))
						await put(
							path,
							writeDae([{ name: m.name, material: glow, ...arrays, P: shifted(arrays.P, mid) }], {
								sizes: [1],
							}),
						);
					else keep(path);
					statics.push({
						stem,
						name: f.slice(0, -4),
						shapeName: shapeName(f),
						collisionType: "None",
						position: mid,
						extra: { useInstanceRenderData: true, instanceColor: [0, 0, 0, 1] },
					});
					lamps.set(stem, [...(lamps.get(stem) ?? []), m.name]);
				} else seen.push([m, { name: m.name, material: await material(m.material, null, false, stem, m.own), ...arrays }]);
			}
		// (the meshes drawn only far, each with the near mesh it takes over from: a shape of their own)
		const swaps: [number, DaeMesh, DaeMesh][] = [];
		const used = new Set<DaeMesh>();
		for (const [far, fm] of seen) {
			if (far.draw[0] <= 0) continue;
			const fc = bounds(fm.P).mid;
			const near = seen.find(
				([m, x]) =>
					m.draw[0] <= 0 &&
					m.draw[1] === far.draw[0] &&
					m.material === far.material &&
					!used.has(x) &&
					Math.hypot(...(bounds(x.P).mid.map((v, i) => v - (fc[i] as number)) as V3)) < 0.5,
			);
			if (near) {
				swaps.push([far.draw[0], near[1], fm]);
				used.add(near[1]);
				used.add(fm);
			}
		}
		// (the far-only ones with no near one left out: they would be drawn over what is near)
		parts.seen = seen.filter(([m, x]) => m.draw[0] <= 0 && !used.has(x)).map(([, x]) => x);
		for (const [part, list] of Object.entries(parts) as ["solid" | "seen", DaeMesh[]][]) {
			if (!list.length) continue;
			const f = `${stem}_${part}.dae`;
			const path = `${shapes}/${f}`;
			if (fresh || !(await exists(path))) await put(path, writeDae(list));
			else keep(path);
			statics.push({
				stem,
				name: `${stem}_${part}`,
				shapeName: shapeName(f),
				collisionType: "None",
				// (decals laid on the floor as it is drawn, as when it was what vehicles hit too)
				...(part === "solid" ? { decalType: "Visible Mesh" } : {}),
			});
			log(
				`  ${stem.padEnd(28)} ${part.padEnd(5)} ${String(list.length).padStart(4)} meshes, ${String(list.reduce((a, x) => a + x.F.length / 3, 0)).padStart(7)} triangles${fresh ? "" : ", as before"}`,
			);
		}
		// (what vehicles hit: shapes of their own, drawn not at all, as BeamNG's own invisible collision is)
		if (hits.length) {
			const prefix = `${stem}_collision_`;
			const tileNo = (f: string) => (f.startsWith(prefix) && /^\d+\.dae$/.test(f.slice(prefix.length)) ? Number.parseInt(f.slice(prefix.length), 10) : -1);
			let names = madeBefore.filter((f) => tileNo(f) >= 0).sort((a, b) => tileNo(a) - tileNo(b));
			if (fresh || !names.length) {
				const tiles = collisionTiles(hits);
				names = tiles.map((_, k) => `${prefix}${k}.dae`);
				for (const [k, t] of tiles.entries()) await put(`${shapes}/${names[k]}`, writeDae([], { collision: t }));
				const made = tiles.flat().reduce((a, x) => a + x.F.length / 3, 0);
				const from = hits.reduce((a, x) => a + x.mesh.F.length / 3, 0);
				log(`  ${stem.padEnd(28)} hit   ${String(tiles.length).padStart(4)} tiles,  ${String(made).padStart(7)} triangles (of ${from})`);
			} else for (const f of names) keep(`${shapes}/${f}`);
			for (const f of names)
				statics.push({
					stem,
					name: f.slice(0, -4),
					shapeName: shapeName(f),
					collisionType: "Collision Mesh",
					decalType: "None",
					extra: { isRenderEnabled: false },
				});
		}
		for (const [dist, near, far] of swaps) {
			const all = new Float64Array(near.P.length + far.P.length);
			all.set(Array.from(near.P), 0);
			all.set(Array.from(far.P), near.P.length);
			const { mid } = bounds(all);
			let radius = 0;
			for (let i = 0; i < all.length; i += 3)
				radius = Math.max(radius, Math.hypot((all[i] as number) - mid[0], (all[i + 1] as number) - mid[1], (all[i + 2] as number) - mid[2]));
			const f = `${stem}_lod_${ident(near.name)}.dae`;
			const path = `${shapes}/${f}`;
			if (fresh || !(await exists(path)))
				await put(
					path,
					writeDae(
						[
							{ ...near, P: shifted(near.P, mid) },
							{ ...far, P: shifted(far.P, mid) },
						],
						{ sizes: [Math.max(2, Math.round((radius * SCREEN) / (dist + radius))), 1] },
					),
				);
			else keep(path);
			statics.push({ stem, name: f.slice(0, -4), shapeName: shapeName(f), collisionType: "None", position: mid });
		}
		if (swaps.length)
			log(
				`  ${stem.padEnd(28)} lod   ${String(swaps.length).padStart(4)} shapes, near ${swaps.reduce((a, [, n]) => a + n.F.length / 3, 0)}, far ${swaps.reduce((a, [, , f]) => a + f.F.length / 3, 0)} triangles${fresh ? "" : ", as before"}`,
			);
		if (ms.some((m) => m.name === BOARD)) {
			const names = [...(lamps.get(stem) ?? [])].sort(byCodePoint);
			gantries.push(
				gantry(
					stem,
					ms,
					toBeamng,
					LIFT,
					names
						.filter((n) => LAMPS.test(n))
						.sort((a, b) => Number(LAMPS.exec(a)?.[2]) - Number(LAMPS.exec(b)?.[2]))
						.map((n) => `${stem}_${n}`),
					names.filter((n) => FLAGS.test(n)).map((n) => `${stem}_${n}`),
				),
			);
		}
		state[stem] = h;
	}

	// ---- grass where the models say it grows, along every layout's racing line
	const layouts = Object.keys(lists)
		.filter((lay) => lay in places)
		.sort(byCodePoint);
	const aiOf = new Map<string, Uint8Array>();
	for (const lay of layouts) {
		const p = `${o.ai}/${lay}/ai/fast_lane.ai`;
		if (await exists(p)) aiOf.set(lay, await files.read(p));
	}
	const grassKey = await digestOf([enc(`${hashes.join(" ")} grass 1`), ...[...aiOf.values()]]);
	const grassDir = `${shapes}/textures/grass`;
	const tiles = (await exists(shapes)) ? (await files.list(shapes)).filter((f) => f.startsWith("grass_") && f.endsWith(".dae")) : [];
	// (made again when what it hangs on changed, or its tiles are gone: none made last time, none to be gone)
	if (state.grass !== grassKey || (!tiles.length && state.grassTiles !== 0)) {
		const blades = await bladesTexture();
		await put(`${grassDir}/blades.png`, blades.png);
		await put(`${grassDir}/blades_opacity.png`, blades.opacity);
		const line: [number, number][] = [];
		for (const b of aiOf.values()) {
			const ai = readAiFile(b);
			for (let i = 0; i < ai.points.length; i += 3) line.push([ai.points[i] as number, ai.points[i + 2] as number]);
		}
		const photos = new Map<string, Picture | undefined>();
		for (const ms of meshesOf.values())
			for (const m of ms) {
				const c = m.material ? lib[m.material]?.colour : undefined;
				if (!m.grass || !c || photos.has(c)) continue;
				const p = `${project}/source/textures/${c}`;
				photos.set(c, (await exists(p)) ? await host.decodeRgb(await files.read(p)).catch(() => undefined) : undefined);
			}
		const at = grassPlaces([...meshesOf.values()], lib, (t) => photos.get(t), line);
		const clumps = grassClumps(at, toBeamng);
		for (const f of tiles) if (!clumps.has(f.slice("grass_".length, -".dae".length))) await files.remove?.(`${shapes}/${f}`);
		for (const [key, mesh] of clumps) await put(`${shapes}/grass_${key}.dae`, writeDae([mesh]));
		state.grass = grassKey;
		state.grassTiles = clumps.size;
		log(`  grass: ${at.length} clumps`);
	} else {
		keep(`${grassDir}/blades.png`);
		keep(`${grassDir}/blades_opacity.png`);
	}
	for (const f of (await files.list(shapes)).filter((x) => x.startsWith("grass_") && x.endsWith(".dae")).sort(byCodePoint)) {
		keep(`${shapes}/${f}`);
		// (the grass: the map's, of no model)
		statics.push({ stem: "", name: f.slice(0, -4), shapeName: shapeName(f), collisionType: "None" });
	}
	materials.velopark_grass = {
		name: "velopark_grass",
		mapTo: "velopark_grass",
		class: "Material",
		persistentId: uuid5(`${LEVEL}/grass`),
		version: 1.5,
		Stages: [
			{
				roughnessFactor: 1,
				metallicFactor: 0,
				baseColorMap: `/levels/${LEVEL}/art/shapes/textures/grass/blades.png`,
				opacityMap: `/levels/${LEVEL}/art/shapes/textures/grass/blades_opacity.png`,
			},
			{},
			{},
			{},
		],
		alphaTest: true,
		alphaRef: 90,
		doubleSided: true,
		castShadows: false,
	};

	// ---- the forest: each tree made once, a shape with its trunk to hit, and the placings that stand it
	const src: CatalogueSource = {
		read: (f) => files.read(f),
		exists: (f) => files.exists(f),
		editorModels: editorModelsOf(project, o.editorModels),
	};
	const cat = await catalogue(src).catch(() => ({}) as Awaited<ReturnType<typeof catalogue>>);
	if (forestData) {
		const fshapes = `${shapes}/forest`;
		const tex = `/levels/${LEVEL}/art/shapes/forest/`;
		const items: Record<string, unknown> = {};
		const fmats: Record<string, string> = {};
		const forestMaterial = async (mat: string) => {
			const name = ident(`velopark_forest_${mat}`);
			if (fmats[mat]) return name;
			fmats[mat] = name;
			const e = lib[mat] ?? {};
			const stage: Record<string, unknown> = { roughnessFactor: 1, metallicFactor: 0 };
			const m: Record<string, unknown> = {
				name,
				mapTo: name,
				class: "Material",
				persistentId: uuid5(`${LEVEL}/forest/${mat}`),
				version: 1.5,
				annotation: "NATURE",
				Stages: [stage, {}, {}, {}],
			};
			if (e.colour) {
				const p = (await texSrc(e.colour)).path;
				const b = await files.read(p);
				await put(`${fshapes}/${e.colour}`, await rgbPng(b));
				stage.baseColorMap = tex + e.colour;
				if (e.alpha === "mask" || e.alpha === "blend") {
					const op = `${e.colour.replace(/\.[^.]*$/, "")}_opacity.png`;
					await put(`${fshapes}/${op}`, await opacityPng(b));
					stage.opacityMap = tex + op;
					Object.assign(m, { alphaTest: true, alphaRef: 100 });
				}
			}
			if (mat === "EucaBark") m.groundType = WOOD;
			materials[name] = m;
			return name;
		};
		for (const model of [...new Set(forestData.map((t) => t[0]))].sort(byCodePoint)) {
			const meta = cat[model];
			if (!meta) continue;
			const meshes: DaeMesh[] = [];
			const collision: DaeMesh[] = [];
			let r = 0.3;
			for (const p of await loadTemplate(src, meta)) {
				const nv = p.V.length / 11;
				const P = new Float64Array(nv * 3);
				const N = new Float64Array(nv * 3);
				const U = new Float64Array(nv * 2);
				for (let k = 0; k < nv; k++) {
					P.set(toBeamng(p.V[k * 11] as number, p.V[k * 11 + 1] as number, p.V[k * 11 + 2] as number), k * 3);
					N.set(toBeamng(p.V[k * 11 + 3] as number, p.V[k * 11 + 4] as number, p.V[k * 11 + 5] as number), k * 3);
					U[k * 2] = p.V[k * 11 + 6] as number;
					U[k * 2 + 1] = 1 - (p.V[k * 11 + 7] as number);
				}
				const F = Array.from(p.F);
				if (p.part === "hull") {
					facing(P, N, F);
					collision.push({
						name: "trunk",
						material: await forestMaterial(p.material),
						P,
						N,
						U: new Float64Array(nv * 2),
						F,
					});
					r = 0;
					for (let k = 0; k < nv; k++) r = Math.max(r, Math.hypot(p.V[k * 11] as number, p.V[k * 11 + 2] as number));
				} else {
					// (the leaves' cards are both ways round already, each way its own triangles)
					if (p.part === "bark") facing(P, N, F);
					meshes.push({ name: p.part, material: await forestMaterial(p.material), P, N, U, F });
				}
			}
			await put(`${fshapes}/${model}.dae`, writeDae(meshes, { sizes: meshes.map(() => 2), ...(collision.length ? { collision } : {}) }));
			items[model] = {
				name: model,
				internalName: model,
				class: "TSForestItemData",
				persistentId: uuid5(`${LEVEL}/forest/${model}`),
				radius: r,
				shapeFile: `levels/${LEVEL}/art/shapes/forest/${model}.dae`,
				...FOREST_WIND,
			};
		}
		await put(`${level}/art/forest/managedItemData.json`, JSON.stringify(items, null, 1));
		const lines = new Map<string, string[]>();
		for (const [name, x, y, z, yaw, scale] of forestData) {
			if (!(name in items)) continue;
			// (its turn about the track's up made BeamNG's about its up; the rotationMatrix lists the axes x, y, z in turn)
			const c = Math.cos(yaw);
			const s = Math.sin(yaw);
			const pos = toBeamng(x, y, z);
			pos[2] += LIFT;
			const rot = [c, -s, 0, s, c, 0, 0, 0, 1];
			const l = lines.get(name) ?? [];
			l.push(JSON.stringify({ ctxid: 0, pos, rotationMatrix: rot, scale, type: name }));
			lines.set(name, l);
		}
		for (const [name, l] of lines) await put(`${level}/forest/${name}.forest4.json`, `${l.join("\n")}\n`);
		log(`  forest: ${forestData.length} trees of ${Object.keys(items).length} kinds`);
	}

	// ---- the gantry board's characters and the lamps' glow
	await put(`${shapes}/${SHAPES}/white.png`, await writePng(new Uint8Array(4 * 4 * 3).fill(255), 4, 4, 3));
	for (const ch of GLYPHS) await put(`${shapes}/${SHAPES}/glyph_${glyphName(ch)}.dae`, writeDae([glyphMesh(ch)], { sizes: [1] }));
	Object.assign(materials, boardMaterials(LEVEL));

	// ---- what the layout no longer loads out
	for (const f of await filesUnder(files, `${shapes}`).catch(() => [] as string[])) {
		const path = `${shapes}/${f}`;
		if ((f.endsWith(".dae") || f.startsWith("textures/")) && !written.has(path)) await files.remove?.(path);
	}
	for (const f of Object.keys(texState)) if (!written.has(`${texDir}/${f}`)) delete texState[f];
	for (const k of Object.keys(state)) if (!["format", "grass", "grassTiles", "textures"].includes(k) && !stems.includes(k)) delete state[k];
	await put(`${shapes}/main.materials.json`, JSON.stringify(materials, null, 1));

	/** A model's shape as the level's object: in the level (its MissionGroup), or in a race's prefab (tag: whose). */
	const staticItem = (st: (typeof statics)[number], tag: string, parent: string) => {
		const p = st.position ?? [0, 0, 0];
		return {
			class: "TSStatic",
			name: st.name,
			persistentId: uuid5(`${tag}/object/${st.name}`),
			__parent: parent,
			shapeName: st.shapeName,
			collisionType: st.collisionType,
			position: [p[0], p[1], p[2] + LIFT],
			decalType: st.decalType ?? (st.collisionType !== "None" ? "Collision Mesh" : "None"),
			...(st.extra ?? {}),
		};
	};

	// ---- the starts, the races and the roads
	const all = new Float64Array(ground.reduce((a, t) => a + t.length, 0));
	let at0 = 0;
	for (const t of ground) {
		all.set(t, at0);
		at0 += t.length;
	}
	const road = new Ground(all);
	log(`  the ground under the starts: ${all.length / 9} triangles`);
	const onRoad = (p: V3) => road.on(p);
	await put(`${level}/groundModels/velopark.json`, JSON.stringify(GROUND_MODELS, null, 1));
	// (the boards' cards: one sheet of every layout's boards' texts, each board's face on its own text's card)
	const boardsPlaced = Object.values(places).flatMap((L) => (L.objects ?? []).filter((ob) => cat[ob.model]?.kind === "boards"));
	const sheet = cardSheet(boardsPlaced.map((ob) => boardText(ob.name, ob.text)));
	const boardTexture = boardsPlaced.length ? await (o.cards ?? canvasCards)(sheet) : null;
	// (every layout's start: its picture, its races; the level's spawns those of them listed)
	const starts: { name: string; title: string; at: V3; fwd: V3 }[] = [];
	const roads: Record<string, { line: V3[]; sides: [number, number][] | null }> = {};
	const races: {
		layout: string;
		title: string;
		description: string;
		author: string;
		path: RacePath;
		length: number;
		trigger: [V3, V3];
		cones: V3[];
		boards: Board[];
		grid: [V3, V3][];
	}[] = [];
	const spotAt = (s: { x: number; y: number; z: number }): V3 => toBeamng(s.x, s.y, s.z);
	for (const lay of layouts) {
		const b = aiOf.get(lay);
		if (!b) continue;
		const here = places[lay] as LayoutPlaces;
		const found = new Map(here.spots.map((s) => [s.name, s]));
		const { line, sides } = racingLine(b);
		roads[lay] = { line, sides };
		const placed = (s: Spot | null | undefined): [V3, V3] | null => {
			if (!s) return null;
			const at = onRoad(spotAt(s));
			return [at, startFacing(line, at, s.heading)];
		};
		const hotlap = placed(found.get("HOTLAP_START_0"));
		const slots: [V3, V3][] = [];
		for (let s = placed(found.get("START_0")); s; s = placed(found.get(`START_${slots.length + 1}`))) slots.push(s);
		const start = placed(startSpot(lay, found));
		if (!start) continue;
		const [at, fwd] = start;
		const u = await uiOf(lay);
		const title = layoutTitle(u.name, trackName, lay);
		starts.push({ name: `spawn_${lay}`, title, at, fwd });
		const gates: [V3, V3][] = [];
		while (found.has(`TIME_${gates.length}_L`) && found.has(`TIME_${gates.length}_R`))
			gates.push([spotAt(found.get(`TIME_${gates.length}_L`) as never), spotAt(found.get(`TIME_${gates.length}_R`) as never)]);
		if (gates.length && !lay.includes("hotlap")) {
			const { path, length } = racePath(line, sides, gates, [[at[0] + fwd[0], at[1] + fwd[1], at[2]], fwd], hotlap ?? start, onRoad, LIFT);
			const { cones, boards } = await physicsObjects(here.objects ?? []);
			races.push({
				layout: lay,
				title: `${trackName} ${title}`,
				description: u.description ?? "",
				author: u.author ?? "",
				path,
				length,
				trigger: [[at[0], at[1], at[2] + LIFT], fwd],
				cones: cones.map((c) => {
					const p = onRoad([c[0], c[1], c[2] + 0.5]);
					return [p[0], p[1], p[2] + LIFT];
				}),
				boards,
				grid: slots.map(([a, f]) => [[a[0], a[1], a[2] + LIFT], f]),
			});
		}
	}
	const listed = o.spawns ?? track.beamng?.spawns;
	const unknown = (listed ?? []).filter((l) => !(l in lists));
	if (unknown.length) throw new Error(`beamng.spawns lists ${unknown.join(", ")}, which the track has no layout of`);
	const spawns = listed ? starts.filter((s) => listed.includes(s.name.slice("spawn_".length))) : starts;
	if (!spawns.length) throw new Error("the level has no layout to spawn at (none with a start)");
	// (it loads at the layout asked for where one can spawn there, else at the first one can)
	const home = spawns.some((s) => s.name === `spawn_${o.layout}`) ? `spawn_${o.layout}` : (spawns[0] as (typeof spawns)[number]).name;

	/** A layout's knockable objects: each cone's foot, and each marker board (its hull's corners, its mesh drawn), in BeamNG's axes and the level's place. */
	async function physicsObjects(objects: LayoutPlaces["objects"]): Promise<{ cones: V3[]; boards: Board[] }> {
		const cones: V3[] = [];
		const boards: Board[] = [];
		for (const ob of objects) {
			const meta = cat[ob.model];
			if (!meta) continue;
			const parts = await loadTemplate(src, meta);
			const m = placeMatrix(ob.x, ob.y, ob.z, ob.heading);
			const at = (V: Float64Array, k: number): V3 => {
				const [x, y, z] = [V[k * 11] as number, V[k * 11 + 1] as number, V[k * 11 + 2] as number];
				return [
					x * (m[0] as number) + y * (m[4] as number) + z * (m[8] as number) + (m[12] as number),
					x * (m[1] as number) + y * (m[5] as number) + z * (m[9] as number) + (m[13] as number),
					x * (m[2] as number) + y * (m[6] as number) + z * (m[10] as number) + (m[14] as number),
				];
			};
			const hull = parts.find((p) => p.part === "hull");
			if (!hull) continue;
			const hp = Array.from({ length: hull.V.length / 11 }, (_, k) => at(hull.V, k));
			if (hull.material !== BOARD_MATERIAL) {
				const xs = hp.map((p) => p[0]);
				const zs = hp.map((p) => p[2]);
				const c: V3 = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...hp.map((p) => p[1])), (Math.min(...zs) + Math.max(...zs)) / 2];
				cones.push(toBeamng(c[0], c[1], c[2]));
				continue;
			}
			for (const p of parts) {
				if (p.part === "hull" || p.material !== BOARD_MATERIAL) continue;
				const nv = p.V.length / 11;
				const P: number[] = [];
				const N: number[] = [];
				const U: number[] = [];
				for (let k = 0; k < nv; k++) {
					const q = at(p.V, k);
					const b = toBeamng(q[0], q[1], q[2]);
					P.push(b[0], b[1], b[2] + LIFT);
					const [nx, ny, nz] = [p.V[k * 11 + 3] as number, p.V[k * 11 + 4] as number, p.V[k * 11 + 5] as number];
					const n: V3 = [
						nx * (m[0] as number) + ny * (m[4] as number) + nz * (m[8] as number),
						nx * (m[1] as number) + ny * (m[5] as number) + nz * (m[9] as number),
						nx * (m[2] as number) + ny * (m[6] as number) + nz * (m[10] as number),
					];
					N.push(...toBeamng(n[0], n[1], n[2]));
					// (its face on its text's card)
					const [cu, cv] = cardUv(p.V[k * 11 + 6] as number, p.V[k * 11 + 7] as number, sheet, boardText(ob.name, ob.text));
					U.push(cu, 1 - cv);
				}
				const F = Array.from(p.F);
				facing(P, N, F);
				boards.push({ box: hp.map((q) => plusLift(toBeamng(q[0], q[1], q[2]))), P, N, U, F });
			}
		}
		return { cones, boards };
	}

	// (a start's map, where the track cannot be rendered: framed round the layouts' racing lines and a little more, not every road the site has: those far off
	// cut)
	const rm = Float32Array.from(roadMap);
	const frame: [[number, number], [number, number]] = [
		[Infinity, Infinity],
		[-Infinity, -Infinity],
	];
	const lapPoints = Object.values(roads).flatMap((r) => r.line.flatMap((p) => [p[0], p[1]]));
	const framed = lapPoints.length ? lapPoints : Array.from(rm);
	for (let i = 0; i + 1 < framed.length; i += 2) {
		frame[0][0] = Math.min(frame[0][0], framed[i] as number);
		frame[0][1] = Math.min(frame[0][1], framed[i + 1] as number);
		frame[1][0] = Math.max(frame[1][0], framed[i] as number);
		frame[1][1] = Math.max(frame[1][1], framed[i + 1] as number);
	}
	const more = 0.08 * Math.max(frame[1][0] - frame[0][0], frame[1][1] - frame[0][1]);
	if (lapPoints.length) {
		frame[0][0] -= more;
		frame[0][1] -= more;
		frame[1][0] += more;
		frame[1][1] += more;
	}
	log(`  ${starts.length} starts (${spawns.length} to spawn at), ${races.length} races`);
	const previews = new Map<string, Uint8Array>();
	const layOf = (s: { name: string }) => s.name.slice("spawn_".length);
	// (each start's picture rendered of the AC build's models: the gantry its lap runs under, else all its lap from above; a layout with no line, its start's
	// place from just behind it)
	if (host.render) {
		const { scene, drawn } = await trackScene(files, o.ai, starts.map(layOf));
		const shown = starts.filter((s) => drawn[layOf(s)]?.length);
		const lines = new Map<string, V3[]>();
		for (const s of shown) {
			const line = roads[layOf(s)]?.line ?? [];
			if (line.length > 2) lines.set(layOf(s), line.map(acPoint));
		}
		const views = layoutViews(scene, drawn, lines, PREVIEW_SIZE);
		const shots = shown.map(
			(s): Shot => ({
				...(views.get(layOf(s)) ?? startView(acPoint(s.at), acPoint(s.fwd))),
				models: drawn[layOf(s)] as string[],
				size: PREVIEW_SIZE,
				format: "jpeg",
			}),
		);
		const made = await host.render(scene, shots);
		shown.forEach((s, i) => {
			previews.set(layOf(s), made[i] as Uint8Array);
		});
		log(`  ${shown.length} starts' pictures rendered`);
	}
	// (where nothing can render it, a map of where it is, its layout's racing line on it: the roads as runs of the picture's pixels, not their own triangles, a
	// canvas filling a path of the floor's millions of triangles for ever)
	const unrendered = starts.filter((s) => !previews.has(layOf(s)));
	const cover = host.mapPreview && rm.length && unrendered.length ? roadCover(rm, frame) : null;
	if (host.mapPreview && cover)
		for (const s of unrendered) {
			const lay = layOf(s);
			previews.set(
				lay,
				await host.mapPreview({
					roads: cover,
					line: (roads[lay]?.line ?? []).flatMap((p) => [p[0], p[1]]),
					at: [s.at[0], s.at[1]],
					fwd: [s.fwd[0], s.fwd[1]],
					title: s.title,
					frame,
				}),
			);
			log(`  ${lay}: its map (nothing here renders the track)`);
		}
	for (const s of starts) {
		const at = `${level}/${s.name}_preview.jpg`;
		const jpg = previews.get(layOf(s));
		if (jpg && spawns.includes(s)) await put(at, jpg);
		// (a layout no longer spawned at: its picture from before gone)
		else if (await exists(at)) await files.remove?.(at);
	}

	// (the layouts' racing lines as BeamNG's road network; the paths and pit lanes off them; each race's checkpoints on its own layout's road)
	const side: Record<string, { line: V3[]; radius: number }> = {};
	for (const [name, { points, radius }] of Object.entries(o.sidePaths ?? track.beamng?.side_paths ?? {})) {
		const dense: [number, number][] = [points[0] as [number, number]];
		for (let i = 0; i + 1 < points.length; i++) {
			const p = points[i] as [number, number];
			const q = points[i + 1] as [number, number];
			const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])));
			for (let k = 1; k <= n; k++) dense.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
		}
		side[name] = {
			line: dense.map(([x, z]) => {
				const p = onRoad(toBeamng(x, 1000, z));
				return [p[0], p[1], p[2] + WAYPOINT_LIFT] as V3;
			}),
			radius,
		};
	}
	const lanes: V3[][] = [];
	for (const lay of layouts) {
		const p = `${o.ai}/${lay}/ai/pit_lane.ai`;
		if (!(await exists(p))) continue;
		const { line } = racingLine(await files.read(p));
		// (layouts sharing pits have lanes alike to a few centimetres)
		if (lanes.some((l) => l.length === line.length && l.every((q, i) => Math.max(...q.map((v, j) => Math.abs(v - ((line[i] as V3)[j] as number)))) < 0.5)))
			continue;
		lanes.push(line);
		side[`pits_${lay}`] = { line, radius: o.pitRadius?.[lay] ?? track.beamng?.pit_radius?.[lay] ?? PIT_RADIUS };
	}
	const net = roadNetwork(roads, side);
	routeRaces(races, net.laps, net.waypoints, net.segments, LIFT, log);
	const date = Math.floor(Date.now() / 1000);
	const sets: ConeSet[] = [];
	const gameplay = `${out}/gameplay/missions/${LEVEL}`;
	for (const top of [`${gameplay}/timeTrial`, `${gameplay}/aiRace`, `${level}/quickrace`])
		for (const f of await filesUnder(files, top).catch(() => [] as string[])) await files.remove?.(`${top}/${f}`);
	for (const [k, r] of races.entries()) {
		const folder = `${LEVEL}/timeTrial/${String(k + 1).padStart(3, "0")}-${r.layout}`;
		const d = `${out}/gameplay/missions/${folder}`;
		await put(`${d}/info.json`, JSON.stringify(mission(LEVEL, folder, r, date), null, 1));
		await put(`${d}/race.race.json`, JSON.stringify(r.path, null, 1));
		// (its prefab: its cones, and the models only its layout loads)
		let prefab: string | null = null;
		const own = statics
			.filter((st) => ownOf(r.layout).includes(st.stem))
			.map((st) => `${JSON.stringify(staticItem(st, `${LEVEL}/${r.layout}`, "SimGroup_"))}\n`)
			.join("");
		if (r.cones.length || r.boards.length) {
			const made = conePrefab(`${LEVEL}/${r.layout}/cones`, r.cones, r.boards);
			prefab = own + made.prefab;
			sets.push(made.set);
		} else if (own) prefab = `${own}${JSON.stringify({ name: "SimGroup_", class: "SimGroup", groupPosition: "0 0 0" })}\n`;
		if (prefab) await put(`${d}/mainPrefab.prefab.json`, prefab);
		const jpg = previews.get(r.layout);
		let thumb: Uint8Array | null = null;
		if (jpg) {
			await put(`${d}/preview.jpg`, jpg);
			const pic = await host.decodeRgb(jpg);
			thumb = await host.encodeJpeg(resizeLanczos(pic, 320, Math.round((320 * pic.height) / pic.width)), 0.9);
			await put(`${d}/thumbnail.jpg`, thumb);
		}
		// (the time trial: the race's path with its name, its picture and its cones)
		const race = {
			...r.path,
			name: r.title,
			description: r.description,
			authors: r.author,
			ignoreAsMission: true,
			prefabs: [],
		};
		if (prefab) await put(`${level}/quickrace/${r.layout}.prefab.json`, prefab);
		await put(`${level}/quickrace/${r.layout}.race.json`, JSON.stringify(race, null, 1));
		if (jpg) await put(`${level}/quickrace/${r.layout}.jpg`, jpg);
		// (the AI race: against karts, from the layout's grid)
		if (r.grid.length > 1) {
			const af = `${LEVEL}/aiRace/${String(k + 1).padStart(3, "0")}-${r.layout}`;
			const a = `${out}/gameplay/missions/${af}`;
			await put(`${a}/info.json`, JSON.stringify(aiMission(LEVEL, af, r, r.grid.length, date), null, 1));
			await put(`${a}/race.race.json`, JSON.stringify(aiPath(r.path, r.grid), null, 1));
			if (prefab) await put(`${a}/deco.prefab.json`, prefab);
			if (jpg) await put(`${a}/preview.jpg`, jpg);
			if (thumb) await put(`${a}/thumbnail.jpg`, thumb);
		}
	}
	// (the gantries' boards, each showing the races that start under it, and the Lua that runs them)
	await put(
		`${level}/board.json`,
		boardConfig(
			gantries,
			Object.fromEntries(races.map((r) => [r.layout, (r.path.pathnodes.find((p) => p.oldId === r.path.startNode)?.pos ?? [0, 0, 0]) as number[]])),
			// (a gantry's model working in the layouts that list it as it is, not still)
			(stem) => Object.keys(lists).filter((l) => lists[l]?.includes(stem)),
		),
	);
	// (the Lua: the editor's, under the level's own names)
	const lua = `${scriptsOf(editorModelsOf(project, o.editorModels))}/beamng`;
	for (const top of ["lua", "scripts"])
		for (const f of await filesUnder(files, `${out}/${top}`).catch(() => [] as string[])) await files.remove?.(`${out}/${top}/${f}`);
	const made = levelScripts({ board: dec(await files.read(`${lua}/board.lua`)), modScript: dec(await files.read(`${lua}/modScript.lua`)) }, LEVEL, trackName);
	for (const [f, text] of Object.entries(made)) await put(`${out}/${f}`, text);
	// (the cones: each layout's one vehicle, a part of the cones prop of the level's own)
	for (const f of await filesUnder(files, `${out}/vehicles`).catch(() => [] as string[])) await files.remove?.(`${out}/vehicles/${f}`);
	for (const [name, data] of coneParts(sets, boardTexture)) await put(`${out}/${name}`, data);

	// ---- the level's objects
	const obj = (cls: string, name: string, kw: Record<string, unknown> = {}) => ({
		class: cls,
		name,
		persistentId: uuid5(`${LEVEL}/object/${name}`),
		__parent: "MissionGroup",
		...kw,
	});
	const items: unknown[] = [
		obj("LevelInfo", "theLevelInfo", {
			gravity: -9.81,
			visibleDistance: 1500,
			canvasClearColor: [0, 0, 0, 255],
			globalEnviromentMap: "BNG_Sky_02_cubemap",
		}),
		obj("TimeOfDay", "tod", { time: 0.1, play: false, dayLength: 1200, azimuthOverride: 0 }),
		obj("ScatterSky", "sunsky", { position: [0, 0, 0] }),
	];
	// (BeamNG's vehicles face their -y; the rotationMatrix lists the axes x, y, z in turn)
	for (const s of spawns)
		items.push(
			obj("SpawnSphere", s.name, {
				dataBlock: "SpawnSphereMarker",
				position: [s.at[0], s.at[1], s.at[2] + LIFT + 0.5],
				rotationMatrix: [-s.fwd[1], s.fwd[0], 0, -s.fwd[0], -s.fwd[1], 0, 0, 0, 1],
				radius: 1,
			}),
		);
	for (const [name, p, r] of net.waypoints as Waypoint[]) items.push(obj("BeamNGWaypoint", name, { position: [p[0], p[1], p[2] + LIFT], scale: [r, r, r] }));
	items.push(...(await lightObjects(files, project, models, obj)));
	if (forestData) {
		const mx = forestData.reduce((a, t) => a + t[1], 0) / forestData.length;
		const my = forestData.reduce((a, t) => a + t[2], 0) / forestData.length;
		const mz = forestData.reduce((a, t) => a + t[3], 0) / forestData.length;
		const mid = toBeamng(mx, my, mz);
		items.push(
			obj("Forest", "theForest", { lodReflectScalar: 0.15 }),
			obj("ForestWindEmitter", "velopark_wind", { position: [mid[0], mid[1], mid[2] + LIFT], strength: 0.15 }),
		);
	}
	for (const st of statics) if (!st.stem || shared.includes(st.stem)) items.push(staticItem(st, LEVEL, "MissionGroup"));
	await put(
		`${level}/main/items.level.json`,
		JSON.stringify({
			class: "SimGroup",
			name: "MissionGroup",
			persistentId: uuid5(`${LEVEL}/MissionGroup`),
			enabled: "1",
		}),
	);
	await put(`${level}/main/MissionGroup/items.level.json`, items.map((i) => `${JSON.stringify(i)}\n`).join(""));
	const lui = await uiOf(o.layout);
	const preview = `${ui}/${o.layout}/preview.png`;
	if (await exists(preview)) await put(`${level}/${LEVEL}_preview.png`, await files.read(preview));
	await put(
		`${level}/info.json`,
		JSON.stringify(
			{
				title: trackName,
				description: lui.description ?? "",
				authors: lui.author ?? "",
				previews: [`${LEVEL}_preview.png`],
				size: [1024, 1024],
				country: lui.country ?? "",
				// (a kart track has no road traffic: the road network is for the map and the AI of the cars one picks)
				supportsTraffic: false,
				spawnPoints: spawns.map((s) => ({
					objectname: s.name,
					translationId: s.title,
					preview: `${s.name}_preview.jpg`,
				})),
				defaultSpawnPointName: home,
			},
			null,
			1,
		),
	);
	await put(
		`${level}/map.json`,
		JSON.stringify(
			{
				segments: Object.fromEntries(Object.entries(net.segments).map(([k, nodes]) => [k, { nodes, drivability: 1, autoJunction: false }])),
			},
			null,
			1,
		),
	);
	await files.write(stateFile, enc(JSON.stringify(state, null, 1)));
	const counts = `${Object.keys(materials).length} materials, ${spawns.length} spawns, ${net.waypoints.length} waypoints`;
	if (o.pack === false) {
		log(`${counts}; level in ${level}`);
		return {
			level,
			zip: null,
			size: 0,
			materials: Object.keys(materials).length,
			starts: starts.length,
			spawns: spawns.length,
			waypoints: net.waypoints.length,
		};
	}
	// ---- packed: every file dated now (BeamNG keeps the shapes it converted while they are newer than the zip's)
	const dist = o.dist ?? `${project}/build/dist`;
	const zipPath = `${dist}/${LEVEL}_beamng.zip`;
	log(`${counts}; packing ${zipPath.split("/").pop()}`);
	const entries: { name: string; data: Uint8Array }[] = [];
	for (const top of [`levels/${LEVEL}`, "gameplay", "lua", "scripts", "vehicles"])
		for (const f of await filesUnder(files, `${out}/${top}`).catch(() => [] as string[]))
			entries.push({ name: `${top}/${f}`, data: await files.read(`${out}/${top}/${f}`) });
	const zip = await writeZip(entries, new Date());
	await files.write(zipPath, zip);
	log(`packed ${zipPath} (${(zip.length / 2 ** 20).toFixed(1)} MB)`);
	return {
		level,
		zip: zipPath,
		size: zip.length,
		materials: Object.keys(materials).length,
		starts: starts.length,
		spawns: spawns.length,
		waypoints: net.waypoints.length,
	};
}

const plusLift = (p: V3): V3 => [p[0], p[1], p[2] + LIFT];

/** cells a side of a start's map's roads (its picture drawn at 1600 pixels wide) */
const COVER_CELLS = 1600;

/** The roads (triangles, x y each corner) as the cells of a grid over the frame they are in, cells pixels along its longer side, whose middles are on a road:
 * each row's runs of them as rectangles (two triangles each, x y each corner), half a cell over on every side (drawn a few at a time, they leave no seam
 * between them). As many as the picture has edges of roads, however many triangles the roads are made of. */
export function roadCover(T: ArrayLike<number>, frame: [[number, number], [number, number]], cells = COVER_CELLS): Float32Array {
	const [[x0, y0], [x1, y1]] = frame;
	const cell = Math.max(x1 - x0, y1 - y0) / cells || 1;
	const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
	const ny = Math.max(1, Math.ceil((y1 - y0) / cell));
	const on = new Uint8Array(nx * ny);
	for (let t = 0; t + 5 < T.length; t += 6) {
		const xs = [T[t] as number, T[t + 2] as number, T[t + 4] as number];
		const ys = [T[t + 1] as number, T[t + 3] as number, T[t + 5] as number];
		const j0 = Math.max(0, Math.ceil((Math.min(...ys) - y0) / cell - 0.5));
		const j1 = Math.min(ny - 1, Math.floor((Math.max(...ys) - y0) / cell - 0.5));
		for (let j = j0; j <= j1; j++) {
			const yc = y0 + (j + 0.5) * cell;
			// (where the row's middle crosses the triangle's edges)
			let lo = Infinity;
			let hi = -Infinity;
			for (let e = 0; e < 3; e++) {
				const [ax, ay, bx, by] = [xs[e] as number, ys[e] as number, xs[(e + 1) % 3] as number, ys[(e + 1) % 3] as number];
				if ((yc < ay && yc < by) || (yc > ay && yc > by)) continue;
				if (ay === by) {
					lo = Math.min(lo, ax, bx);
					hi = Math.max(hi, ax, bx);
					continue;
				}
				const x = ax + ((yc - ay) * (bx - ax)) / (by - ay);
				lo = Math.min(lo, x);
				hi = Math.max(hi, x);
			}
			const i0 = Math.max(0, Math.ceil((lo - x0) / cell - 0.5));
			const i1 = Math.min(nx - 1, Math.floor((hi - x0) / cell - 0.5));
			if (i0 <= i1) on.fill(1, j * nx + i0, j * nx + i1 + 1);
		}
	}
	const out: number[] = [];
	for (let j = 0; j < ny; j++) {
		// (each run of cells on along the row one rectangle)
		let i = 0;
		while (i < nx) {
			if (!on[j * nx + i]) {
				i++;
				continue;
			}
			let k = i;
			while (k + 1 < nx && on[j * nx + k + 1]) k++;
			const [a, b, c, d] = [x0 + (i - 0.5) * cell, y0 + (j - 0.5) * cell, x0 + (k + 1.5) * cell, y0 + (j + 1.5) * cell];
			out.push(a, b, c, b, c, d, a, b, c, d, a, d);
			i = k + 1;
		}
	}
	return Float32Array.from(out);
}

/** A level's folder name as its Lua extension's folder is named (BeamNG's ge extensions: camelCase): techspeed_velopark as techspeedVelopark. */
export const extensionFolder = (level: string): string => level.toLowerCase().replace(/[^a-z0-9]+([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** The level's Lua (the editor's scripts/beamng: the gantry board's extension and the mod's script that loads it) under the level's own names, by their paths
 * in the mod: lua/ge/extensions/<its camelCase>/board.lua, the extension <its camelCase>_board, and scripts/<level>/modScript.lua; {{track}}, {{level}} and
 * {{extension}} in them filled. */
export function levelScripts(scripts: { board: string; modScript: string }, level: string, track: string): Record<string, string> {
	const folder = extensionFolder(level);
	const fill = (s: string) =>
		s.replace(/\{\{(track|level|extension)\}\}/g, (_, k: string) => (k === "track" ? track : k === "level" ? level : `${folder}_board`));
	return {
		[`lua/ge/extensions/${folder}/board.lua`]: fill(scripts.board),
		[`scripts/${level}/modScript.lua`]: fill(scripts.modScript),
	};
}

/** The models of the level of every layout, each once (the first layout's first): a still gantry left out where another layout has it working (the same gantry,
 * its lamps); the map's, those every layout loads (a gantry still or working); and each layout's own, the rest it loads. */
export function levelModels(lists: Record<string, string[]>, first: string): { stems: string[]; shared: string[]; ownOf: (layout: string) => string[] } {
	const order = [
		first,
		...Object.keys(lists)
			.filter((k) => k !== first)
			.sort(byCodePoint),
	];
	const union = [...new Set(order.flatMap((k) => lists[k] ?? []))];
	const stems = union.filter((s) => !(s.endsWith(STILL) && union.includes(s.slice(0, -STILL.length))));
	const everywhere = (s: string) => order.every((k) => lists[k]?.includes(s) || lists[k]?.includes(`${s}${STILL}`));
	const shared = stems.filter(everywhere);
	return {
		stems,
		shared,
		ownOf: (layout) => stems.filter((s) => !shared.includes(s) && lists[layout]?.includes(s)),
	};
}

/** The track's lights (source/lights.json, then the places' and the buildings'), as BeamNG spot lights: each where it stands, pointing its own way or its
 * series', reaching as far as its range, its colour, strength and range its own where its object's options give them (else its series'); lit at night only. */
async function lightObjects(
	files: HostFiles,
	project: string,
	models: string,
	obj: (cls: string, name: string, kw?: Record<string, unknown>) => unknown,
): Promise<unknown[]> {
	type Series = {
		colour: number[];
		strength?: number;
		spot?: number;
		sharpness?: number;
		facing?: number[];
		range?: number;
	};
	// (a light's own colour, strength and range, where its object's options change them from its series')
	type Light = {
		series: string;
		at: number[];
		facing?: number[];
		colour?: number[];
		strength?: number;
		range?: number;
	};
	const read = async (p: string): Promise<{ series?: Record<string, Series>; lights?: Light[] }> =>
		(await files.exists(p)) ? JSON.parse(new TextDecoder().decode(await files.read(p))) : {};
	const srcDoc = await read(`${project}/source/lights.json`);
	const series = srcDoc.series ?? {};
	const lights = [...(srcDoc.lights ?? [])];
	for (const made of [await read(`${models}/places.json`), await read(`${models}/lights_outside.json`)]) lights.push(...(made.lights ?? []));
	const out: unknown[] = [];
	Object.entries(series).forEach(([name, s], n) => {
		const spot = s.spot ?? 90;
		const outer = Math.min(spot, 170);
		const inner = outer * (1 - (s.sharpness ?? 0.5) * 0.5);
		const common = s.facing ?? [0, -1, 0];
		lights
			.filter((l) => l.series === name)
			.forEach((l, k) => {
				const f = l.facing ?? common;
				const d = toBeamng(f[0] as number, f[1] as number, f[2] as number);
				const L = Math.hypot(...d) || 1;
				const y: V3 = [d[0] / L, d[1] / L, d[2] / L];
				// (a light shines along its own y: x and z square to it, z as near up as it goes)
				let x: V3 = Math.abs(y[2]) < 0.99 ? [y[1], -y[0], 0] : [1, 0, 0];
				const lx = Math.hypot(...x) || 1;
				x = [x[0] / lx, x[1] / lx, x[2] / lx];
				const z: V3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
				const at = toBeamng(l.at[0] as number, l.at[1] as number, l.at[2] as number);
				const colour = [...(l.colour ?? s.colour), l.strength ?? s.strength ?? 1];
				out.push(
					obj("SpotLight", `light_${n}_${k}`, {
						position: [at[0], at[1], at[2] + LIFT],
						rotationMatrix: [...x, ...y, ...z],
						color: [...colour.slice(0, 3), 1],
						brightness: (colour[3] as number) * LIGHT_GAIN,
						intensity: LIGHT_INTENSITY,
						attenuationRatio: [1, 0, 0],
						range: l.range ?? s.range ?? 50,
						innerAngle: inner,
						outerAngle: outer,
						castShadows: false,
						isEnabled: false,
						nightLight: "1",
					}),
				);
			});
	});
	return out;
}

export type { Picture };
export const _forTests = { meshArrays, racingLine, readPng };
