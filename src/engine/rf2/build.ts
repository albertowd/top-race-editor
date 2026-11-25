// The track as an rFactor 2 location, made from the track's data (TRACK_FORMAT.md's build_rf2), not from another game's build: build/rf2/Locations/<venue>, as
// Studio 397's own tracks are laid out (ModDev/Locations/Joesville):
//
//   <venue>/<venue>.tdf                 the grounds (rf2/text.ts), its materials matched by the start of their names
//   <venue>/Assets/GMT/*.gmt            each model's meshes (rf2/gmt.ts), a GMT for each kind of them (driven on, hit
//                                       unseen, only seen) up to 65536 corners, in rFactor's axes (rf2/aiw.ts's
//                                       TRACK_TO_RF2: x, y, -z), at their places (a static object's GMT is in the
//                                       world's coordinates, its pivot nought)
//   <venue>/Assets/Maps/*.dds           their textures (the AC build's DDS of each: the same file)
//   <venue>/<layout>/<layout>.gdb .scn .AIW .wet, and its timing beams (xfinish, xsector1, xsector2, xpitin,
//                                       xpitout: unseen quads across the lap where its timing gates are, rf2/aiw.ts)
//
// Each layout's scene loads the GMTs of its models (track.json's layouts.<layout>.models) and its own beams; its AIW is made from its racing lines on the floor
// of its models (aimake.ts, as AC's AI lines are). A material is drawn with rFactor's plain diffuse shader (L2DIFFUSET0, as Joesville's buildings are),
// see-through ones blended; one driven on is named after its ground (surfaces.json's targets.rf2) so the TDF finds it. Each layout's placed objects (its cones
// and its marker board, its card drawn on it as the AC build's) are knocked about as Joesville's cones (rf2/objects.ts); the venue's and each layout's
// pictures, its loading screen among them, are drawn as rFactor's own tracks' are where the engine has a canvas (rf2/pictures.ts). Not yet: the trackside
// cameras, packing into a MAS and an rFCMP (ModMgr).

import type { LayoutObjects } from "../../domain/types";
import { acFolder, digestOf } from "../acbuild";
import { type LightsData, lightsData } from "../aclights";
import type { RacingLine, RacingLines } from "../ailines";
import { aiLineOf, STEP } from "../aimake";
import { CORNER, groundOf as meshGround, type OwnMaterial, type TrackMesh, trackModel } from "../beamng/trackmodel";
import {
	BOARD_SHEET_MATERIAL,
	boardText,
	CARDS_MATERIAL,
	CARDS_PICTURE,
	type CardPainter,
	type CardSheet,
	canvasCards,
	cardSheet,
	onCards,
} from "../boardfaces";
import { acDds, convert, ddsChain, ddsOf, isDds, isPng, readPicture, resizeLanczos, type TextureAc } from "../dds";
import { FLAG } from "../gantries";
import { layoutTitle } from "../layoutmap";
import type { HostFiles } from "../placehost";
import type { PhysicsObject, PlacesDoc } from "../places";
import { type PyJson, plain } from "../pyjson";
import { Surface } from "../surface";
import { type CatalogueSource, catalogue, editorModelsOf, loadTemplate, type TemplatePart } from "../templates";
import { readPart } from "../trackdoc";
import { settingsOf } from "../trackfiles";
import { layoutViews, type Shot, trackScene, type View } from "../trackrender";
import { type Axes, aiwText, aiwTiming, type Beam, TRACK_TO_RF2, type V3 } from "./aiw";
import { boxOf, facesOf, floatWord, type Gmt, type GmtMaterial, type GmtMesh, type GmtVertex, writeGmt } from "./gmt";
import { objectGmt, objectInstance, objectKey, objectName, turnedMesh } from "./objects";
import {
	clockwise,
	type LoadingPanel,
	layoutPictureFiles,
	mapLine,
	RF2_PICTURE_SIZE,
	type Rf2Picture,
	type Rf2PictureHost,
	rf2File,
	roadMap,
	startOn,
	venueIconFile,
} from "./pictures";
import { type BoardPainter, type BoardScreen, boardLines, boardScreens, canvasBoard, type PriceScreen, priceScreens, pricesPicture } from "./screens";
import { LAMP_TEXTURE, lampMaterial, lampPictures, START_LAMP, START_LIGHT, startingLights } from "./startlights";
import { type Ground, gdbText, groundOf, type Instance, type Light, MAX_VEHICLES, materialName, scnText, tdfText, wetText } from "./text";

/** a GMT's corners at most (its faces name them by 16-bit numbers) */
export const GMT_CORNERS = 65535;
/** a GMT's faces at most: none of the samples has 65536 or more (64,800 the most), the game counting them in 16 bits (more crashed it as a session began) */
export const GMT_FACES = 64000;
/** a GMT's materials (and so its meshes, one a material) at most: the samples have 9 at most, 35 meshes */
export const GMT_MATERIALS = 16;
/** metres a mesh is drawn to where its model does not say */
const DRAW_FAR = 2000;
/** metres what is only seen (a building, a tree) is drawn to where its model does not say */
const SEEN_FAR = 800;
/** the grounds RealRoad rubbers in and wets (their TDF prefixes): the roads and rumbles */
const DEFORMED = new Set(["road", "rmbl"]);
/** a timing beam's reach below and above the floor (as LochDrummond's, about) */
const BEAM_DOWN = 10;
const BEAM_UP = 15;
/** the grounds the AI lines keep to (their sides end where these do) */
const ROADS = new Set(["asphalt", "rumble", "kerb"]);
const WHITE = "tsvp_white.dds";

export interface Rf2Options {
	project: string;
	/** where the location is written: <out>/Locations/<venue> (by default build/rf2) */
	out?: string;
	/** the layouts made (by default every one with a racing line) */
	layouts?: string[];
	/** rFactor 2's folder: the location copied into its ModDev/Locations as well, to try in its Mod Mode */
	install?: string;
	axes?: Axes;
	/** the editor's models (the placed objects' catalogue) */
	editorModels?: string;
	/** the boards' cards drawn (by default on Chromium's canvas) */
	cards?: CardPainter;
	/** the gantries' boards lettered with each layout's name (by default on Chromium's canvas where there is one; none: the boards' pictures as they are) */
	boards?: BoardPainter;
	/** what draws the location's pictures, and renders the track under some (none: no pictures) */
	pictures?: Rf2PictureHost;
	/** the AC build's track, its models rendered under the pictures */
	acTrack?: string;
	log?: (line: string) => void;
}

export interface Rf2Built {
	location: string;
	venue: string;
	layouts: string[];
	gmts: number;
	textures: number;
	/** layouts left out, and why */
	skipped: Record<string, string>;
	installed: string | null;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const fileName = (t: string) => t.replace(/[^A-Za-z0-9_.-]/g, "_");
/** a file's name without its extension */
const withoutExtension = (t: string) => t.replace(/\.[^.]*$/, "");
/** a path without the slashes and backslashes it ends in */
function trimSlashes(p: string): string {
	let end = p.length;
	while (end > 0 && (p[end - 1] === "/" || p[end - 1] === "\\")) end--;
	return p.slice(0, end);
}
const words = (...xs: number[]) => xs.map(floatWord);

/** How a material shows what is behind it: not at all; through the holes its texture's alpha cuts (leaves, wire: its texture's flag 0x80, as LochDrummond's
 * fences have it, drawn opaque); or blended (glass). */
export type Alpha = "opaque" | "mask" | "blend";

/** A material as rFactor's plain diffuse shader draws it (Joesville's buildings': L2DIFFUSET0, one texture). */
export function diffuseMaterial(name: string, texture: string, alpha: Alpha = "opaque"): GmtMaterial {
	const blend = alpha === "blend";
	return {
		name,
		flags: blend ? 0x68902023 : 0x68902003,
		ambient: [1, 1, 1, 1],
		diffuse: [1, 1, 1, 1],
		specular: [0.2, 0.2, 0.2, 1],
		emissive: [0, 0, 0, 1],
		srcBlend: blend ? 5 : 2,
		destBlend: blend ? 6 : 1,
		specularPower: 1,
		word144: 0,
		shaders: [
			{
				name: "L2DIFFUSET0",
				params: [...words(5, 0.1, 0.9), 0, 0, 0, 0, 0, 0, 0, 0],
				textures: [
					{
						name: texture.toUpperCase(),
						flags: alpha === "mask" ? 0x98 : 0x18,
						flags2: 0x20,
						word68: -1,
						count: 1,
						settings: [1, 3, floatWord(1), 0, 0, 0, 1, 0, floatWord(1), 0, ...words(0.1, 0.9, 5), ...new Array(13).fill(0)],
					},
				],
			},
		],
	};
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
	const m = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / m, a[1] / m, a[2] / m];
};

/** A corner as a GMT's: its place and normal in rFactor's axes, its uv as it is (both V down), a tangent and binormal across its normal (the plain shader reads
 * none). */
function vertexOf(position: V3, normal: V3, uv: [number, number]): GmtVertex {
	const n = unit(normal);
	const t = unit(Math.abs(n[1]) < 0.9 ? cross([0, 1, 0], n) : cross(n, [0, 0, 1]));
	return {
		position,
		normal: n,
		colour: 0xffffffff,
		colour2: 0,
		bones: [0, 0, 0, 0],
		weights: [255, 0, 0, 0],
		tangent: t,
		binormal: cross(n, t),
		uv: [uv, [0, 0], [0, 0], [0, 0]],
	};
}

/** A track mesh as a GMT's (rFactor's axes): its faces wound as rFactor's are ((b - a) x (c - a) against their corners' normals), the degenerate left out; null
 * where none is left. */
export function gmtMeshOf(m: TrackMesh, material: number, axes: Axes = TRACK_TO_RF2): GmtMesh | null {
	const n = m.v.length / CORNER;
	const vertices: GmtVertex[] = [];
	for (let k = 0; k < n; k++) {
		const o = k * CORNER;
		const p = axes(m.v[o] as number, m.v[o + 1] as number, m.v[o + 2] as number);
		// (a normal is a way, not a place: the axes' mirror, not their move)
		const q = axes(m.v[o + 3] as number, m.v[o + 4] as number, m.v[o + 5] as number);
		const z = axes(0, 0, 0);
		vertices.push(vertexOf(p, [q[0] - z[0], q[1] - z[1], q[2] - z[2]], [m.v[o + 6] as number, m.v[o + 7] as number]));
	}
	const indices: number[] = [];
	for (let f = 0; f < m.f.length; f += 3) {
		let [a, b, c] = [m.f[f] as number, m.f[f + 1] as number, m.f[f + 2] as number];
		if (a === b || b === c || a === c) continue;
		const [A, B, C] = [a, b, c].map((i) => (vertices[i] as GmtVertex).position) as [V3, V3, V3];
		const g = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
		if (Math.hypot(g[0], g[1], g[2]) < 1e-12) continue;
		let d = 0;
		for (const i of [a, b, c]) {
			const nn = (vertices[i] as GmtVertex).normal;
			d += g[0] * nn[0] + g[1] * nn[1] + g[2] * nn[2];
		}
		if (d > 0) [b, c] = [c, b];
		indices.push(a, b, c);
	}
	if (!indices.length) return null;
	return { flags: 0x4080, material, vertices, indices, palette: [] };
}

/** A GMT's mesh cut into pieces each within GMT_CORNERS corners and GMT_FACES faces (its corners renumbered in each, its faces in their order). */
export function gmtPieces(m: GmtMesh, corners = GMT_CORNERS, faces = GMT_FACES): GmtMesh[] {
	if (m.vertices.length <= corners && m.indices.length / 3 <= faces) return [m];
	const out: GmtMesh[] = [];
	let at = new Map<number, number>();
	let piece: GmtMesh = { ...m, vertices: [], indices: [] };
	for (let t = 0; t < m.indices.length; t += 3) {
		const tri = [m.indices[t], m.indices[t + 1], m.indices[t + 2]] as number[];
		const fresh = tri.filter((i, k) => !at.has(i) && tri.indexOf(i) === k).length;
		if (piece.vertices.length + fresh > corners || piece.indices.length / 3 + 1 > faces) {
			out.push(piece);
			at = new Map();
			piece = { ...m, vertices: [], indices: [] };
		}
		for (const i of tri) {
			let k = at.get(i);
			if (k === undefined) {
				k = piece.vertices.length;
				at.set(i, k);
				piece.vertices.push(m.vertices[i] as GmtVertex);
			}
			piece.indices.push(k);
		}
	}
	if (piece.indices.length) out.push(piece);
	return out;
}

/** A GMT being filled: one mesh a material (its pieces' corners after one another), within the samples' limits. */
export class GmtFill {
	readonly meshes: GmtMesh[] = [];
	readonly materials: GmtMaterial[] = [];
	private corners = 0;
	private faces = 0;

	get empty(): boolean {
		return !this.meshes.length;
	}

	/** Whether a piece of the material goes in, within GMT_CORNERS, GMT_FACES and GMT_MATERIALS. */
	fits(piece: GmtMesh, material: GmtMaterial): boolean {
		if (this.empty) return true;
		const known = this.materials.includes(material);
		return (
			this.corners + piece.vertices.length <= GMT_CORNERS &&
			this.faces + piece.indices.length / 3 <= GMT_FACES &&
			(known || this.materials.length < GMT_MATERIALS)
		);
	}

	/** A piece put in: into its material's mesh, its corners after that mesh's. */
	add(piece: GmtMesh, material: GmtMaterial): void {
		let mi = this.materials.indexOf(material);
		if (mi < 0) {
			this.materials.push(material);
			mi = this.materials.length - 1;
			this.meshes.push({ flags: piece.flags, material: mi, vertices: [], indices: [], palette: [] });
		}
		const mesh = this.meshes.find((m) => m.material === mi) as GmtMesh;
		const first = mesh.vertices.length;
		for (const v of piece.vertices) mesh.vertices.push(v);
		for (const i of piece.indices) mesh.indices.push(first + i);
		this.corners += piece.vertices.length;
		this.faces += piece.indices.length / 3;
	}
}

/** A static object's GMT (its corners where they are, its pivot nought) of its meshes and materials. */
export function staticGmt(name: string, meshes: GmtMesh[], materials: GmtMaterial[], far = DRAW_FAR, near = 0): Gmt {
	const { faces, planes } = facesOf(meshes);
	return {
		kind: "gmt",
		layout: "new",
		bits: 32,
		flags: 0x04000000,
		name: name.slice(0, 63),
		box: boxOf(meshes),
		lod: [near, far],
		distance2: 0,
		position: [0, 0, 0],
		meshes,
		faces,
		planes,
		bones: [],
		materials,
	};
}

/** A timing beam's GMT: a quad across from its left to its right, BEAM_DOWN under the floor to BEAM_UP over it, seen from both sides (as Joesville's are),
 * never drawn. */
export function beamGmt(beam: Beam): Gmt {
	const { left: L, right: R } = beam;
	const corners: V3[] = [
		[L[0], L[1] - BEAM_DOWN, L[2]],
		[R[0], R[1] - BEAM_DOWN, R[2]],
		[R[0], R[1] + BEAM_UP, R[2]],
		[L[0], L[1] + BEAM_UP, L[2]],
	];
	const across: V3 = [R[0] - L[0], 0, R[2] - L[2]];
	const face = unit(cross(across, [0, 1, 0]));
	const back: V3 = [-face[0], -face[1], -face[2]];
	const uv: [number, number][] = [
		[0, 1],
		[1, 1],
		[1, 0],
		[0, 0],
	];
	const vertices = [
		...corners.map((p, i) => vertexOf(p, face, uv[i] as [number, number])),
		...corners.map((p, i) => vertexOf(p, back, uv[i] as [number, number])),
	];
	const mesh: GmtMesh = { flags: 0x4080, material: 0, vertices, indices: [], palette: [] };
	// (each side wound as rFactor's: (b - a) x (c - a) against its normal)
	for (const [side, quad] of [
		[face, [0, 1, 2, 0, 2, 3]],
		[back, [4, 5, 6, 4, 6, 7]],
	] as const)
		for (let t = 0; t < 6; t += 3) {
			let [a, b, c] = [quad[t], quad[t + 1], quad[t + 2]] as [number, number, number];
			const [A, B, C] = [a, b, c].map((i) => (vertices[i] as GmtVertex).position) as [V3, V3, V3];
			const g = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
			if (g[0] * side[0] + g[1] * side[1] + g[2] * side[2] > 0) [b, c] = [c, b];
			mesh.indices.push(a, b, c);
		}
	const g = staticGmt(beam.name, [mesh], [diffuseMaterial(beam.name, WHITE)], 10000);
	return { ...g, flags: 0 };
}

const pow2 = (v: number) => v > 0 && (v & (v - 1)) === 0;
type Picture = Awaited<ReturnType<typeof readPicture>>;

/** A picture as it is where its sides are powers of two, else resized to them (each the next up, at most 4096). */
function powerOfTwoSized(img: Picture): Picture {
	const up = (n: number) => Math.min(4096, 2 ** Math.ceil(Math.log2(Math.max(n, 4))));
	return pow2(img.width) && pow2(img.height) ? img : resizeLanczos(img, up(img.width), up(img.height));
}

/** Whether a DDS's sides are powers of two (as every texture of rFactor's own tracks is). */
export function powerOfTwoDds(dds: Uint8Array): boolean {
	const v = new DataView(dds.buffer, dds.byteOffset, dds.byteLength);
	return pow2(v.getUint32(12, true)) && pow2(v.getUint32(16, true));
}

/** A picture (PNG, or a JPEG by the browser's decoder) made a DDS of sides powers of two (each the next up, at most 4096), with its mips: in the library's DXT
 * format, else DXT5. */
export async function squareDds(pic: Uint8Array, fmt: string): Promise<Uint8Array> {
	const sized = powerOfTwoSized(await readPicture(pic));
	return ddsChain(sized, fmt === "DXT1" || fmt === "DXT3" || fmt === "DXT5" ? fmt : "DXT5");
}

/** metres within which lamps are one light (a pole's flood beams and spill, a building's row of lamps) */
export const LAMP_MERGE = 15;
/** rFactor's intensity of a light of the track's strength (Joesville's lamps 1.5, LochDrummond's 10) */
const INTENSITY = 4;

/** The track's lights (aclights.ts's lightsData: lights.json's, the placed objects', the buildings') as rFactor's omni lights, as its own tracks have only
 * those, lit at night (named NightLight as theirs): those within LAMP_MERGE of one another one light, as strong and reaching as far as the strongest and
 * furthest of them (from their middle), its colour theirs. */
export function nightLights(data: LightsData, axes: Axes = TRACK_TO_RF2): Light[] {
	type Lamp = { at: V3; strength: number; range: number; colour: V3; n: number };
	const lamps: Lamp[] = [];
	for (const l of data.lights) {
		const s = (data.series[String(l.series as string | number | undefined)] ?? {}) as Record<string, unknown>;
		const pick = <T>(k: string, d: T): T => (l[k] ?? s[k] ?? d) as T;
		if (l.on === false) continue;
		// (numbers as the track's JSON reads them: made plain)
		const at = (l.at as unknown[] | undefined)?.map(Number) as V3 | undefined;
		if (!at) continue;
		const lamp: Lamp = {
			at,
			strength: Number(pick("strength", 1)),
			range: Number(pick("range", 30)),
			colour: pick<unknown[]>("colour", [1, 1, 1]).map(Number) as V3,
			n: 1,
		};
		const near = lamps.find((o) => Math.hypot(o.at[0] - at[0], o.at[1] - at[1], o.at[2] - at[2]) < LAMP_MERGE);
		if (!near) {
			lamps.push(lamp);
			continue;
		}
		const n = near.n + 1;
		near.at = near.at.map((v, k) => (v * near.n + (at[k] as number)) / n) as V3;
		near.colour = near.colour.map((v, k) => (v * near.n + (lamp.colour[k] as number)) / n) as V3;
		near.strength = Math.max(near.strength, lamp.strength);
		near.range = Math.max(near.range, lamp.range);
		near.n = n;
	}
	return lamps.map((l, i) => ({
		name: `NightLight${String(i).padStart(2, "0")}`,
		pos: axes(l.at[0], l.at[1], l.at[2]),
		// (reaching its lamps' furthest from their middle, the merged ones' spread too)
		range: l.range + (l.n > 1 ? LAMP_MERGE / 2 : 0),
		intensity: Math.min(20, Math.max(0.5, l.strength * INTENSITY)),
		colour: l.colour.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)) as V3,
	}));
}

/** What a model's meshes are to rFactor: driven on (and stood on), hit unseen, or only seen. */
type Kind = "surface" | "wall" | "visual";

interface Group {
	kind: Kind;
	visible: boolean;
	shadows: boolean;
	/** metres it is drawn from and to */
	near: number;
	far: number;
	/** RealRoad's (rubbered in, wetted) */
	deformable: boolean;
	meshes: { mesh: TrackMesh; ground: Ground | null }[];
}

/** metres a tile's side, by how far its meshes are drawn: a mesh drawn only near (a tyre stack's detail) in small tiles, so only those near are drawn; the rest
 * in larger */
export const tileSize = (far: number): number => {
	if (far <= 100) return 50;
	return far <= 600 ? 150 : 250;
};

/** The tile a mesh's face's middle falls in (x, z): its key. */
function cellOf(m: TrackMesh, f: number, size: number): string {
	let x = 0;
	let z = 0;
	for (let k = 0; k < 3; k++) {
		const o = (m.f[f + k] as number) * CORNER;
		x += m.v[o] as number;
		z += m.v[o + 2] as number;
	}
	return `${Math.floor(x / 3 / size)},${Math.floor(z / 3 / size)}`;
}

/** A mesh's faces (by their first corners' places in its faces) as a mesh of their own, their corners renumbered. */
function meshOfFaces(m: TrackMesh, faces: number[]): TrackMesh {
	const at = new Map<number, number>();
	const v: number[] = [];
	const f: number[] = [];
	for (const first of faces)
		for (let k = 0; k < 3; k++) {
			const i = m.f[first + k] as number;
			let j = at.get(i);
			if (j === undefined) {
				j = v.length / CORNER;
				at.set(i, j);
				for (let c = 0; c < CORNER; c++) v.push(m.v[i * CORNER + c] as number);
			}
			f.push(j);
		}
	return { ...m, v: new Float32Array(v), f: new Uint32Array(f) };
}

/** A mesh cut by the tiles its faces' middles fall in (x, z): each tile's faces, their corners renumbered. */
export function tilesOf(m: TrackMesh, size: number): Map<string, TrackMesh> {
	const cells = new Map<string, number[]>();
	for (let f = 0; f < m.f.length; f += 3) {
		const cell = cellOf(m, f, size);
		const l = cells.get(cell);
		if (l) l.push(f);
		else cells.set(cell, [f]);
	}
	const out = new Map<string, TrackMesh>();
	if (cells.size === 1) {
		out.set(cells.keys().next().value as string, m);
		return out;
	}
	for (const [cell, faces] of cells) out.set(cell, meshOfFaces(m, faces));
	return out;
}

/** A layout's lap, for its pictures: its line (the map's axes), its points (the track's), its length, title and place. */
interface Lap {
	line: number[];
	points: Float32Array;
	lap: number;
	title: string;
	location?: string;
}

/** The location's pictures (rf2/pictures.ts), drawn by the host over renders of the AC build's track where it has a GPU: the venue's icon (its longest lap's
 * place, all its laps' map) and each layout's. */
async function drawPictures(
	files: HostFiles,
	host: Rf2PictureHost,
	o: {
		out: string;
		venue: string;
		trackName: string;
		layouts: string[];
		laps: Map<string, Lap>;
		placed: PlacesDoc["layouts"];
		acTrack?: string;
		put: (path: string, data: Uint8Array) => Promise<void>;
		log: (line: string) => void;
	},
): Promise<void> {
	const { laps, placed, log } = o;
	const placesOf = (l: string) => {
		const sp = new Map((placed[l]?.spots ?? []).map((s) => [s.name, s]));
		const start = (l.includes("hotlap") ? sp.get("HOTLAP_START_0") : undefined) ?? sp.get("START_0") ?? null;
		const pit = sp.get("PIT_0") ?? null;
		const line = laps.get(l)?.line ?? [];
		const on = start && line.length > 6 ? startOn(line, start) : null;
		const pm = pit ? mapLine([pit.x, pit.y, pit.z]) : null;
		return {
			start: on?.at ?? null,
			fwd: on?.fwd ?? null,
			pit: pm ? ([pm[0], pm[1]] as [number, number]) : null,
		};
	};
	const drawn = o.layouts.filter((l) => (laps.get(l)?.line.length ?? 0) > 6);
	if (!drawn.length) return;
	const main = drawn.reduce((a, b) => ((laps.get(b)?.lap ?? 0) > (laps.get(a)?.lap ?? 0) ? b : a), drawn[0] as string);
	// (rendered under the venue's icon and the loading screens where the engine has a GPU: the gantry each lap runs under, else all its lap from above, as the AC
	// and BeamNG pictures are)
	const backdrops = new Map<string, Uint8Array>();
	let venueBackdrop: Uint8Array | undefined;
	if (host.render && o.acTrack && (await files.exists(o.acTrack))) {
		try {
			const { scene, drawn: models } = await trackScene(files, o.acTrack, drawn);
			const shown = drawn.filter((l) => models[l]?.length);
			const acLine = (l: string): V3[] => {
				const P = laps.get(l)?.points ?? new Float32Array(0);
				const out: V3[] = [];
				for (let i = 0; i + 2 < P.length; i += 3) out.push([P[i] as number, P[i + 1] as number, P[i + 2] as number]);
				return out;
			};
			const lines = new Map(shown.map((l) => [l, acLine(l)]));
			const wide = layoutViews(scene, models, lines, RF2_PICTURE_SIZE.loading);
			const square = layoutViews(scene, models, lines, RF2_PICTURE_SIZE.venue);
			const loads = shown.filter((l) => wide.has(l));
			const shots: Shot[] = loads.map((l) => ({
				...(wide.get(l) as View),
				models: models[l] as string[],
				size: RF2_PICTURE_SIZE.loading,
				format: "jpeg",
			}));
			const venueShot = square.has(main) && !!models[main]?.length;
			if (venueShot)
				shots.push({
					...(square.get(main) as View),
					models: models[main] as string[],
					size: RF2_PICTURE_SIZE.venue,
					format: "jpeg",
				});
			const made = await host.render(scene, shots);
			loads.forEach((l, i) => {
				backdrops.set(l, made[i] as Uint8Array);
			});
			if (venueShot) venueBackdrop = made.at(-1);
		} catch (e) {
			log(`  pictures: the track not rendered (${(e as Error).message}), drawn without it`);
		}
	}
	const draw = (spec: Rf2Picture) => host.picture(spec);
	await o.put(
		`${o.out}/${venueIconFile(o.venue)}`,
		await rf2File(
			"venue",
			await draw({
				kind: "venue",
				// (its roads each once: its longest lap whole, of the others what they run on alone)
				...(() => {
					const map = roadMap([main, ...drawn.filter((l) => l !== main)].map((l) => laps.get(l)?.line ?? []));
					return { lines: map.laps, runs: map.runs };
				})(),
				...placesOf(main),
				backdrop: venueBackdrop,
			}),
		),
	);
	for (const l of drawn) {
		const lap = laps.get(l) as Lap;
		const base = { lines: [lap.line], ...placesOf(l) };
		const f = layoutPictureFiles(l);
		for (const kind of ["icon", "thumb", "tile", "wheel"] as const) await o.put(`${o.out}/${l}/${f[kind]}`, await rf2File(kind, await draw({ kind, ...base })));
		const km = lap.lap / 1000;
		const panel: LoadingPanel = {
			rows: [
				["Track", o.trackName],
				["Type", "Road Course"],
				["Length", `${km.toFixed(2)} km / ${(km / 1.609344).toFixed(2)} mi`],
				...(lap.location ? ([["Location", lap.location]] as [string, string][]) : []),
				["Max vehicles", String(MAX_VEHICLES)],
				["Default start", "Standing"],
			],
			venue: o.trackName,
			// (the layout's own name: the track's is in the panel above it)
			layout: layoutTitle(lap.title, o.trackName, l),
			clockwise: clockwise(lap.line),
		};
		await o.put(`${o.out}/${l}/${f.loading}`, await draw({ kind: "loading", ...base, backdrop: backdrops.get(l), panel }));
	}
	log(`  pictures: the venue's icon; ${drawn.length} layouts' icons, thumbnails, wheel maps and loading screens (${backdrops.size} over the track rendered)`);
}

/** The track's library: each material's colour picture, how it shows through and its ground. */
type Library = Record<string, { colour?: string; alpha?: string; surface?: string }>;
/** surfaces.json's grounds, each with what it is called in rFactor */
type Surfaces = Record<string, { targets?: { rf2?: string } }>;
/** objects.json's layouts: their racing lines among the rest */
type LayoutsObjects = Record<string, LayoutObjects & { lines?: RacingLines }>;
/** A working gantry's lamp: its place in the start's order, its mesh. */
type StartLamp = { at: number; mesh: TrackMesh };

/** A location being written: where its files go, the track's library its materials are of, and what of it is written and made so far. */
interface Rf2Job {
	files: HostFiles;
	project: string;
	out: string;
	maps: string;
	gmtDir: string;
	axes: Axes;
	log: (line: string) => void;
	lib: Library;
	texAc: Record<string, TextureAc>;
	/** each texture's DDS, by its source */
	textures: Map<string, string>;
	/** every file written, in order */
	written: string[];
	gmts: number;
	/** whether the start lamps' frames are written */
	lampTextures: boolean;
	/** the prices screens, by material: drawn in seven segments (rf2/screens.ts), not as their library pictures */
	prices: ReadonlyMap<string, PriceScreen>;
}

/** A JSON file read (a byte-order mark at its start passed over). */
async function readJson<T>(files: HostFiles, p: string): Promise<T> {
	return JSON.parse(dec(await files.read(p)).replace(/^﻿/, "")) as T;
}

/** A file of the location written, and kept for copying into rFactor 2's ModDev. */
async function put(job: Rf2Job, path: string, data: Uint8Array | string): Promise<void> {
	await job.files.write(path, typeof data === "string" ? enc(data) : data);
	job.written.push(path);
}

/** How a library material shows what is behind it (opaque where it says neither blended nor masked). */
function alphaOf(alpha: string | undefined): Alpha {
	if (alpha === "blend" || alpha === "mask") return alpha;
	return "opaque";
}

/** What a mesh's role makes it to rFactor (only seen where it is neither driven on nor a wall). */
function kindOf(role: string): Kind {
	if (role === "surface" || role === "wall") return role;
	return "visual";
}

/** A library colour as the AC build's DDS of it, once (the model's own folder's before the library's; white where there is none). */
async function textureOf(job: Rf2Job, png: string | undefined, stem: string): Promise<string> {
	if (!png) return WHITE;
	const { files, project, textures, texAc } = job;
	const own = `${project}/source/textures/${stem}/${png}`;
	const isOwn = await files.exists(own);
	const src = isOwn ? own : `${project}/source/textures/${png}`;
	const prefix = isOwn ? `${stem}_` : "";
	const name = fileName(`${prefix}${withoutExtension(png)}.dds`);
	if (textures.has(src)) return textures.get(src) as string;
	if (!(await files.exists(src))) {
		job.log(`  ${png}: no such texture, drawn white`);
		textures.set(src, WHITE);
		return WHITE;
	}
	const b = await files.read(src);
	const fmt = texAc[png]?.ac ?? "DXT1";
	const key = await digestOf([b, enc(fmt), new Uint8Array([texAc[png]?.normal ? 1 : 0])]);
	const kept = `${project}/build/cache/dds/${key}.dds`;
	// (a cached one that is no DDS made again: AC's build passes a library's JPEG on as it is)
	let dds: Uint8Array | null = (await files.exists(kept)) ? await files.read(kept) : null;
	if (!dds || !isDds(dds)) {
		dds = isPng(b) ? await acDds(`${withoutExtension(png)}.dds`, b, texAc) : await squareDds(b, fmt);
		await files.write(kept, dds);
	}
	if (!powerOfTwoDds(dds)) dds = await squareDds(b, fmt);
	await put(job, `${job.maps}/${name}`, dds);
	textures.set(src, name);
	return name;
}

/** An editor's model's own picture (inside its model) as a DDS of sides powers of two, once a picture: DXT5 where it shows through, else DXT1. */
async function ownTextureOf(job: Rf2Job, own: OwnMaterial): Promise<string> {
	const pic = own.colour;
	if (!pic) return WHITE;
	const { textures } = job;
	const hash = await digestOf([pic.data]);
	const src = `own:${hash}`;
	if (textures.has(src)) return textures.get(src) as string;
	const name = fileName(`own_${hash.slice(0, 8)}_${withoutExtension(pic.name)}.dds`);
	let img: Picture;
	try {
		img = await readPicture(pic.data);
	} catch (e) {
		job.log(`  ${pic.name}: ${(e as Error).message}, drawn white`);
		textures.set(src, WHITE);
		return WHITE;
	}
	await put(job, `${job.maps}/${name}`, ddsChain(convert(powerOfTwoSized(img), "RGBA"), own.alpha === "opaque" ? "DXT1" : "DXT5"));
	textures.set(src, name);
	return name;
}

/** A working gantry's lamps as its StartLight: a GMT of them, each its own material stepped by the start (rf2/startlights.ts), their frames written once. */
async function startLightOf(job: Rf2Job, stem: string, lamps: StartLamp[]): Promise<Instance> {
	if (!job.lampTextures) {
		const { off, on } = lampPictures();
		await put(job, `${job.maps}/${LAMP_TEXTURE}00.dds`, ddsChain(off, "DXT5"));
		await put(job, `${job.maps}/${LAMP_TEXTURE}01.dds`, ddsChain(on, "DXT5"));
		job.lampTextures = true;
	}
	const order = [...lamps].sort((a, b) => a.at - b.at);
	const materials = order.map((_, i) => lampMaterial(`STARTLAMP${i}`, i, order.length));
	const meshes = order.flatMap(({ mesh }, i) => gmtMeshOf(mesh, i, job.axes) ?? []);
	const name = fileName(`${stem}_startlight`);
	await put(job, `${job.gmtDir}/${name}.gmt`, writeGmt(staticGmt(START_LIGHT, meshes, materials, SEEN_FAR, 0)));
	job.gmts++;
	return { name: START_LIGHT, mesh: `${name}.gmt`, collide: false, hat: false, shadows: false };
}

/** A model's meshes sorted for its GMTs: its groups (by kind, how they are drawn, and tile), its floor and roads (the AI lines'), and a working gantry's
 * lamps and board (each layout's own, rf2/screens.ts). */
interface ModelParts {
	groups: Map<string, Group>;
	floor: Float64Array[];
	road: Float64Array[];
	lamps: StartLamp[];
	boards: TrackMesh[];
}

/** A mesh's faces' corners' places, three numbers a corner (the floor the AI lines are laid on). */
function floorOf(m: TrackMesh): Float64Array {
	const T = new Float64Array(m.f.length * 3);
	for (let i = 0; i < m.f.length; i++) for (let j = 0; j < 3; j++) T[i * 3 + j] = m.v[(m.f[i] as number) * CORNER + j] as number;
	return T;
}

/** A mesh put in its model's groups (its ground among the location's grounds), and in its floor and roads where it is driven on. */
function addMesh(parts: ModelParts, m: TrackMesh, lib: Library, surfaces: Surfaces, grounds: Map<string, Ground>): void {
	const kind = kindOf(m.role);
	const g0 = kind === "visual" ? null : meshGround(m, lib);
	const ground = g0 ? groundOf(g0, surfaces) : null;
	if (ground) grounds.set(ground.prefix, ground);
	if (kind === "surface") {
		const T = floorOf(m);
		parts.floor.push(T);
		if (g0 && ROADS.has(g0)) parts.road.push(T);
	}
	const near = m.draw[0] ?? 0;
	// (as far as its model says; else the ground and what is driven on to the horizon, the rest not so far)
	const far = m.draw[1] ?? (kind === "surface" ? DRAW_FAR : SEEN_FAR);
	// (only the roads and rumbles rubbered in and wetted by RealRoad, as Joesville's race surface: not the grass)
	const deformable = kind === "surface" && !!ground && DEFORMED.has(ground.prefix);
	// (in tiles, each its own GMTs: rFactor culls and draws near or far by a whole GMT, so each keeps to its tile)
	for (const [cell, part] of tilesOf(m, tileSize(far))) {
		const key = `${kind}|${m.visible}|${m.shadows}|${near}|${far}|${deformable}|${cell}`;
		let g = parts.groups.get(key);
		if (!g) {
			g = { kind, visible: m.visible, shadows: m.shadows, near, far, deformable, meshes: [] };
			parts.groups.set(key, g);
		}
		g.meshes.push({ mesh: part, ground });
	}
}

/** A model's meshes sorted (see ModelParts), the empty left out; a board only seen, of a board's screen's material (screens), kept apart. */
function modelParts(
	meshes: TrackMesh[],
	lib: Library,
	surfaces: Surfaces,
	grounds: Map<string, Ground>,
	screens: ReadonlyMap<string, BoardScreen> = new Map(),
): ModelParts {
	const parts: ModelParts = { groups: new Map(), floor: [], road: [], lamps: [], boards: [] };
	for (const m of meshes) {
		if (!m.f.length) continue;
		// (a working gantry's lamps: the StartLight's, lit by the start)
		const lamp = START_LAMP.exec(m.name);
		if (lamp) parts.lamps.push({ at: Number(lamp[1]), mesh: m });
		// (its flag lamp: none, as no script shows it here; it stands where the lamps are and would hide them)
		else if (m.name === FLAG) continue;
		else if (m.visible && kindOf(m.role) === "visual" && screens.has(m.material ?? "")) parts.boards.push(m);
		else addMesh(parts, m, lib, surfaces, grounds);
	}
	return parts;
}

/** A mesh's texture: white where it is unseen; an editor's model's own picture; else its library colour's. */
async function meshTexture(job: Rf2Job, stem: string, visible: boolean, mesh: TrackMesh): Promise<string> {
	if (!visible) return WHITE;
	const prices = job.prices.get(mesh.material ?? "");
	if (prices) return pricesTexture(job, prices);
	if (mesh.own) return ownTextureOf(job, mesh.own);
	return textureOf(job, job.lib[mesh.material ?? ""]?.colour, stem);
}

/** A prices screen's picture, its prices in seven segments (rf2/screens.ts), a DDS once. */
async function pricesTexture(job: Rf2Job, s: PriceScreen): Promise<string> {
	const src = `prices:${s.material}`;
	const known = job.textures.get(src);
	if (known) return known;
	const name = fileName(`screen_${s.material}.dds`);
	await put(job, `${job.maps}/${name}`, ddsChain(powerOfTwoSized(pricesPicture(s)), "DXT1"));
	job.textures.set(src, name);
	return name;
}

/** How a mesh shows what is behind it: an editor's model's own alpha, never the library's of its name; else its library material's. */
function meshAlpha(mesh: TrackMesh, lib: Library): string | undefined {
	if (mesh.own) return mesh.own.alpha;
	return mesh.material ? lib[mesh.material]?.alpha : undefined;
}

/** A mesh's material's name, before its ground's: an editor's model's own named after its picture. */
function meshMaterialName(mesh: TrackMesh): string {
	const own = mesh.own;
	if (!own) return mesh.material ?? "hidden";
	const picture = own.colour ? withoutExtension(own.colour.name) : "";
	return `${mesh.material ?? "material"}_own_${picture}`;
}

/** A mesh's material, made once for its model. */
async function meshMaterial(job: Rf2Job, stem: string, g: Group, mesh: TrackMesh, ground: Ground | null, made: Map<string, GmtMaterial>): Promise<GmtMaterial> {
	const name = materialName(meshMaterialName(mesh), ground);
	let mat = made.get(name);
	if (!mat) {
		const tex = await meshTexture(job, stem, g.visible, mesh);
		mat = diffuseMaterial(name, tex, alphaOf(meshAlpha(mesh, job.lib)));
		made.set(name, mat);
	}
	return mat;
}

/** A group's filled GMT written: its instance in the scene. */
async function groupGmt(job: Rf2Job, name: string, g: Group, fill: GmtFill): Promise<Instance> {
	await put(job, `${job.gmtDir}/${name}.gmt`, writeGmt(staticGmt(name, fill.meshes, fill.materials, g.far, g.near)));
	job.gmts++;
	return {
		name,
		mesh: `${name}.gmt`,
		collide: g.kind !== "visual",
		hat: g.kind === "surface",
		deformable: g.deformable,
		render: g.visible ? undefined : false,
		// (a surface casts none: rFactor drops Deformable from a shadow caster, as the samples' race surfaces cast none; nor does a mesh drawn only near, a
		// tyre stack's detail: its far stand-in casts its shadow)
		shadows: g.visible && g.shadows && g.kind !== "surface" && g.far > 100,
	};
}

/** A group's GMT filled so far written, where it has anything, its instance after the model's others (and numbered by them). */
async function flushFill(job: Rf2Job, stem: string, g: Group, fill: GmtFill, inst: Instance[]): Promise<void> {
	if (!fill.empty) inst.push(await groupGmt(job, fileName(`${stem}_${g.kind}_${inst.length}`), g, fill));
}

/** A model's groups as GMTs, each filled up to the samples' limits (a new GMT after; one mesh a material, each material made once for the model): their
 * instances. */
async function groupGmts(job: Rf2Job, stem: string, groups: Map<string, Group>): Promise<Instance[]> {
	const inst: Instance[] = [];
	const made = new Map<string, GmtMaterial>();
	for (const g of groups.values()) {
		let fill = new GmtFill();
		for (const { mesh, ground } of g.meshes) {
			const mat = await meshMaterial(job, stem, g, mesh, ground, made);
			const gm = gmtMeshOf(mesh, 0, job.axes);
			if (!gm) continue;
			for (const piece of gmtPieces(gm)) {
				if (!fill.fits(piece, mat)) {
					await flushFill(job, stem, g, fill, inst);
					fill = new GmtFill();
				}
				fill.add(piece, mat);
			}
		}
		await flushFill(job, stem, g, fill, inst);
	}
	return inst;
}

/** The models' GMTs written: each model's instances, its floor and roads, the grounds driven on, each working gantry's lamps (how many, by its model) and its
 * board's meshes (each layout's own written with the layout). */
interface ModelsBuilt {
	instancesOf: Map<string, Instance[]>;
	floorParts: Map<string, { floor: Float64Array[]; road: Float64Array[] }>;
	grounds: Map<string, Ground>;
	lampsOf: Map<string, number>;
	boardsOf: Map<string, TrackMesh[]>;
}

/** Each model's meshes as GMTs, a GMT for each kind of them (a model not there left out); its boards of the screens' materials kept for the layouts. */
async function modelGmts(job: Rf2Job, stems: string[], models: string, surfaces: Surfaces, screens: ReadonlyMap<string, BoardScreen>): Promise<ModelsBuilt> {
	const built: ModelsBuilt = { instancesOf: new Map(), floorParts: new Map(), grounds: new Map(), lampsOf: new Map(), boardsOf: new Map() };
	for (const stem of stems) {
		const path = `${models}/${stem}.glb`;
		if (!(await job.files.exists(path))) {
			job.log(`  ${stem}: no model ${path}, left out`);
			built.instancesOf.set(stem, []);
			continue;
		}
		const parts = modelParts(trackModel(await job.files.read(path)), job.lib, surfaces, built.grounds, screens);
		built.floorParts.set(stem, { floor: parts.floor, road: parts.road });
		if (parts.boards.length) built.boardsOf.set(stem, parts.boards);
		const inst = await groupGmts(job, stem, parts.groups);
		if (parts.lamps.length) {
			inst.push(await startLightOf(job, stem, parts.lamps));
			built.lampsOf.set(stem, parts.lamps.length);
		}
		built.instancesOf.set(stem, inst);
		job.log(`  ${stem}: ${inst.length} GMT${inst.length === 1 ? "" : "s"}`);
	}
	return built;
}

/** The placed objects being made: the catalogue and its models' parts, the boards' cards, and each object's GMT and material made once. */
interface Placing {
	job: Rf2Job;
	src: CatalogueSource;
	cat: Awaited<ReturnType<typeof catalogue>>;
	parts: Map<string, Promise<TemplatePart[]>>;
	cards: { sheet: CardSheet; texture: string } | null;
	objects: Map<string, string>;
	materials: Map<string, GmtMaterial>;
}

/** A catalogue model's parts, loaded once. */
function partsFor(p: Placing, model: string): Promise<TemplatePart[]> {
	let ps = p.parts.get(model);
	if (!ps) {
		const meta = p.cat[model];
		if (!meta) throw new Error(`a placed object of a model the catalogue has not: ${model}`);
		ps = loadTemplate(p.src, meta);
		p.parts.set(model, ps);
	}
	return ps;
}

/** The boards' cards: one sheet of every board's text, as the AC build draws it, and its texture (none where there is no board, or it is not drawn). */
async function boardCards(job: Rf2Job, boards: PhysicsObject[], painter: CardPainter | undefined): Promise<Placing["cards"]> {
	if (!boards.length) return null;
	const sheet = cardSheet(boards.map((ob) => boardText(ob.name, ob.text)));
	try {
		const png = await (painter ?? canvasCards)(sheet);
		const cards = { sheet, texture: await ownTextureOf(job, { colour: { name: CARDS_PICTURE, data: png }, alpha: "opaque" }) };
		job.log(`  the boards' cards: ${sheet.texts.map((t) => JSON.stringify(t)).join(", ") || "blank"}`);
		return cards;
	} catch (e) {
		job.log(`  the boards' cards: ${(e as Error).message}, left blank`);
		return null;
	}
}

/** A placed object's part's material, made once (the boards' cards drawn on their sheet's texture). */
async function objectMaterial(p: Placing, part: TemplatePart, model: string): Promise<GmtMaterial> {
	const key = part.material;
	let m = p.materials.get(key);
	if (!m) {
		const e = p.job.lib[part.material];
		const tex = part.material === CARDS_MATERIAL && p.cards ? p.cards.texture : await textureOf(p.job, e?.colour, model);
		m = diffuseMaterial(materialName(part.material, null), tex, alphaOf(e?.alpha));
		p.materials.set(key, m);
	}
	return m;
}

/** A placed object's GMT, written once for the same object in any layout: its name. */
async function objectOf(p: Placing, ob: PhysicsObject): Promise<string> {
	const { job } = p;
	const key = objectKey(ob);
	const had = p.objects.get(key);
	if (had) return had;
	const name = objectName(ob.model, await digestOf([enc(key)]));
	const own = (await partsFor(p, ob.model)).filter((pt) => pt.part !== "hull");
	const shown = p.cards && p.cat[ob.model]?.kind === "boards" ? onCards(own, BOARD_SHEET_MATERIAL, p.cards.sheet, boardText(ob.name, ob.text)) : own;
	const meshes: GmtMesh[] = [];
	const materials: GmtMaterial[] = [];
	for (const pt of shown) {
		const mat = await objectMaterial(p, pt, ob.model);
		let k = materials.indexOf(mat);
		if (k < 0) k = materials.push(mat) - 1;
		const gm = gmtMeshOf(turnedMesh(pt, ob.heading), k, job.axes);
		if (gm) meshes.push(gm);
	}
	await put(job, `${job.gmtDir}/${name}.gmt`, writeGmt(objectGmt(name, ob, meshes, materials, staticGmt, job.axes)));
	job.gmts++;
	p.objects.set(key, name);
	return name;
}

/** Each layout's placed objects (places.json: its cones, its marker board), knocked about: a GMT each, the same object in two layouts one; their instances
 * by layout (none where no layout has any). */
async function placedObjects(job: Rf2Job, o: Rf2Options, layouts: string[], placed: PlacesDoc["layouts"]): Promise<Map<string, Instance[]>> {
	const objectsOf = new Map<string, Instance[]>();
	if (!layouts.some((l) => placed[l]?.objects?.length)) return objectsOf;
	const { files, project } = job;
	const src: CatalogueSource = {
		read: (f) => files.read(f),
		exists: (f) => files.exists(f),
		editorModels: editorModelsOf(project, o.editorModels),
		textures: `${project}/source/textures`,
	};
	const cat = await catalogue(src);
	const boards = layouts.flatMap((l) => (placed[l]?.objects ?? []).filter((ob) => cat[ob.model]?.kind === "boards"));
	const cards = await boardCards(job, boards, o.cards);
	const p: Placing = { job, src, cat, parts: new Map(), cards, objects: new Map(), materials: new Map() };
	for (const l of layouts) {
		const list: Instance[] = [];
		const seen = new Set<string>();
		for (const ob of placed[l]?.objects ?? []) {
			if (!cat[ob.model]) {
				job.log(`  ${l}: ${ob.name}, a ${ob.model} the catalogue has not, left out`);
				continue;
			}
			const name = await objectOf(p, ob);
			if (seen.has(name)) continue;
			seen.add(name);
			list.push(objectInstance(name));
		}
		objectsOf.set(l, list);
	}
	job.log(`  placed objects: ${p.objects.size} GMTs, knocked about in ${objectsOf.size} layouts`);
	return objectsOf;
}

/** Floor triangles of several meshes as one surface. */
function together(parts: Float64Array[]): Surface {
	const all = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
	let at = 0;
	for (const p of parts) {
		all.set(p, at);
		at += p.length;
	}
	return new Surface(all);
}

/** A layout's ui_track.json (empty where it has none). */
async function uiOf(files: HostFiles, project: string, l: string): Promise<Record<string, string>> {
	const p = `${project}/source/track/ui/${l}/ui_track.json`;
	return (await files.exists(p)) ? await readJson<Record<string, string>>(files, p) : {};
}

/** A layout's timing beams' GMTs written: their instances, a pit lane's ends pit stops', the rest timing's. */
async function beamInstances(job: Rf2Job, dir: string, beams: Beam[]): Promise<Instance[]> {
	const out: Instance[] = [];
	for (const b of beams) {
		await put(job, `${dir}/${b.name}.gmt`, writeGmt(beamGmt(b)));
		out.push({
			name: b.name,
			mesh: `${b.name}.gmt`,
			collide: true,
			hat: false,
			render: false,
			response: b.name === "xpitin" || b.name === "xpitout" ? "VEHICLE,PITSTOP" : "VEHICLE,TIMING",
		});
	}
	return out;
}

/** Where a layout's fixed reflections are seen from: the middle of its start line (else of its first beam), 2 m over it. */
function reflectionsCentre(beams: Beam[]): [number, number, number] | undefined {
	const finish = beams.find((b) => b.name === "xfinish") ?? beams[0];
	if (!finish) return undefined;
	return [(finish.left[0] + finish.right[0]) / 2, (finish.left[1] + finish.right[1]) / 2 + 2, (finish.left[2] + finish.right[2]) / 2];
}

/** What every layout's files are made of: the venue, its TDF, the models' GMTs, the placed objects, the lights at night and what letters the boards. */
interface LayoutSources {
	venue: string;
	trackName: string;
	tdf: string;
	pictures: boolean;
	lists: Record<string, string[]>;
	layouts: LayoutsObjects | undefined;
	models: ModelsBuilt;
	objectsOf: Map<string, Instance[]>;
	lights: Light[];
	boards: { screens: ReadonlyMap<string, BoardScreen>; painter: BoardPainter } | null;
}

/** A board's own picture: its model's, else its library material's (none: null). */
async function boardPicture(job: Rf2Job, mesh: TrackMesh): Promise<Uint8Array | null> {
	if (mesh.own) return mesh.own.colour?.data ?? null;
	const png = job.lib[mesh.material ?? ""]?.colour;
	const p = `${job.project}/source/textures/${png}`;
	return png && (await job.files.exists(p)) ? job.files.read(p) : null;
}

/** A board's picture lettered with its lines (rf2/screens.ts), a DDS once for the same picture and lines; its picture as it is where it cannot be lettered. */
async function boardTexture(job: Rf2Job, stem: string, mesh: TrackMesh, boards: NonNullable<LayoutSources["boards"]>, lines: string[]): Promise<string> {
	const screen = boards.screens.get(mesh.material ?? "") as BoardScreen;
	const picture = await boardPicture(job, mesh);
	if (!picture) return meshTexture(job, stem, true, mesh);
	const key = await digestOf([picture, enc(JSON.stringify([screen, lines]))]);
	const src = `board:${key}`;
	const known = job.textures.get(src);
	if (known) return known;
	let drawn: Picture;
	try {
		drawn = await readPicture(await boards.painter({ picture, screen, lines }));
	} catch (e) {
		job.log(`  ${stem}'s board: ${(e as Error).message}, its picture as it is`);
		return meshTexture(job, stem, true, mesh);
	}
	const name = fileName(`${stem}_board_${key.slice(0, 8)}.dds`);
	await put(job, `${job.maps}/${name}`, ddsChain(convert(powerOfTwoSized(drawn), "RGBA"), "DXT1"));
	job.textures.set(src, name);
	return name;
}

/** A layout's own boards on its models' gantries: each a GMT of the board's meshes, its picture lettered with the track's and the layout's names. */
async function layoutBoards(job: Rf2Job, l: string, models: string[], s: LayoutSources, lines: string[]): Promise<Instance[]> {
	const out: Instance[] = [];
	if (!s.boards) return out;
	for (const stem of models) {
		const meshes = s.models.boardsOf.get(stem) ?? [];
		const board = meshes.length ? await modelBoard(job, `${stem}_board_${l}`, stem, meshes, s.boards, lines) : null;
		if (board) out.push(board);
	}
	return out;
}

/** A model's board in a layout: a GMT named name of its meshes (the first's drawing kept), its picture lettered with the lines; none where none is drawn. */
async function modelBoard(
	job: Rf2Job,
	named: string,
	stem: string,
	meshes: TrackMesh[],
	boards: NonNullable<LayoutSources["boards"]>,
	lines: string[],
): Promise<Instance | null> {
	const first = meshes[0] as TrackMesh;
	const name = fileName(named);
	const material = diffuseMaterial(name, await boardTexture(job, stem, first, boards, lines));
	const fill = new GmtFill();
	for (const m of meshes) {
		const gm = gmtMeshOf(m, 0, job.axes);
		if (gm) for (const piece of gmtPieces(gm)) fill.add(piece, material);
	}
	if (fill.empty) return null;
	const far = first.draw[1] ?? SEEN_FAR;
	await put(job, `${job.gmtDir}/${name}.gmt`, writeGmt(staticGmt(name, fill.meshes, fill.materials, far, first.draw[0] ?? 0)));
	job.gmts++;
	return { name, mesh: `${name}.gmt`, collide: false, hat: false, shadows: first.shadows && far > 100 };
}

/** A layout's scene, GDB, weather, AIW and timing beams written: its lap, for its pictures. */
async function writeLayout(job: Rf2Job, l: string, s: LayoutSources): Promise<Lap> {
	const { venue, trackName, tdf } = s;
	const dir = `${job.out}/${l}`;
	const lay = s.layouts?.[l] as LayoutObjects & { lines: RacingLines };
	const models = s.lists[l] ?? [];
	const parts = models.map((m) => s.models.floorParts.get(m) ?? { floor: [], road: [] });
	const F = together(parts.flatMap((p) => p.floor));
	const R = together(parts.flatMap((p) => p.road));
	const floor = (x: number, z: number) => F.y(x, z);
	const onRoad = (x: number, z: number) => !Number.isNaN(R.y(x, z));
	const fast = aiLineOf(lay.lines.fast as RacingLine, floor, onRoad);
	const pit = lay.lines.pit?.curve?.length ? aiLineOf(lay.lines.pit, floor, onRoad, STEP, {}) : null;
	const input = { layout: lay, fast, pit, floor, axes: job.axes };
	await put(job, `${dir}/${l}.AIW`, aiwText(input));
	const timing = aiwTiming(input);
	const beams = await beamInstances(job, dir, timing.beams);
	// (its fixed reflections seen from the middle of its start line, 2 m over it)
	const centre = reflectionsCentre(timing.beams);
	const ui = await uiOf(job.files, job.project, l);
	const title = ui.name || `${trackName} ${l}`;
	const location = ui.city && ui.country ? `${ui.city}, ${ui.country}` : undefined;
	const boards = await layoutBoards(job, l, models, s, boardLines(trackName, layoutTitle(title, trackName, l)));
	await put(
		job,
		`${dir}/${l}.scn`,
		scnText({
			searchPaths: [".", venue, `${venue}\\${l}`, String.raw`${venue}\Assets\GMT`, String.raw`${venue}\Assets\Maps`],
			instances: oneStartLight([...models.flatMap((m) => s.models.instancesOf.get(m) ?? []), ...boards, ...(s.objectsOf.get(l) ?? []), ...beams]),
			lights: s.lights,
			centre,
		}),
	);
	await put(
		job,
		`${dir}/${l}.gdb`,
		gdbText({
			id: l,
			trackName: title,
			eventName: title,
			venueName: trackName,
			length: timing.lap,
			tdf: `..\\${tdf}`,
			location,
			venueIcon: s.pictures ? `${venue}\\${venueIconFile(venue)}` : undefined,
			startingLights: startingLightsOf(models, s.models.lampsOf),
		}),
	);
	await put(job, `${dir}/${l}.wet`, wetText());
	job.log(`  ${l}: ${(timing.lap / 1000).toFixed(3)} km, ${beams.length} timing beams`);
	return { line: mapLine(fast.points), points: fast.points, lap: timing.lap, title, location };
}

/** The layouts made: those asked for (else every one of track.json's), each with models and a racing line; the rest in skipped, with why. */
function layoutsMade(
	asked: string[] | undefined,
	lists: Record<string, string[]>,
	objects: LayoutsObjects | undefined,
	skipped: Record<string, string>,
): string[] {
	return (asked ?? Object.keys(lists)).filter((l) => {
		if (!lists[l]?.length) skipped[l] = "no models in track.json";
		else if (!objects?.[l]?.lines?.fast?.curve?.length) skipped[l] = "no racing line (its AIW is made of it)";
		return !skipped[l];
	});
}

/** The location made (see the module's note). */
export async function buildRf2(files: HostFiles, o: Rf2Options): Promise<Rf2Built> {
	const log = o.log ?? (() => {});
	const project = trimSlashes(o.project);
	const track = await readJson<{ name?: string; models?: string; layouts?: Record<string, { models?: string[] }> }>(
		files,
		`${project}/tools/reference/track.json`,
	);
	const trackName = track.name ?? "Track";
	const venue = acFolder(trackName);
	const root = trimSlashes(o.out ?? `${project}/build/rf2`);
	const out = `${root}/Locations/${venue}`;
	const models = `${project}/${track.models || "track/models"}`;
	const libDoc = await readJson<{ materials: Library; textures?: Record<string, TextureAc> }>(files, `${project}/source/materials.json`);
	const surfaces = (await files.exists(`${project}/source/surfaces.json`))
		? ((await readJson<{ surfaces?: Surfaces }>(files, `${project}/source/surfaces.json`)).surfaces ?? {})
		: {};
	const objects = plain((await readPart(files, await settingsOf(files, project), "objects")) ?? ({} as PyJson)) as { layouts?: LayoutsObjects };
	const lists = Object.fromEntries(Object.entries(track.layouts ?? {}).map(([k, v]) => [k, v.models ?? []]));
	const skipped: Record<string, string> = {};
	const layouts = layoutsMade(o.layouts, lists, objects.layouts, skipped);
	if (!layouts.length) throw new Error(`no layout to make: ${JSON.stringify(skipped)}`);
	// (the track's lights and screens: its lamps lit at night, its screens drawn still, rf2/screens.ts)
	const lightsDoc = await lightsData(files, project, models);
	const job: Rf2Job = {
		files,
		project,
		out,
		maps: `${out}/Assets/Maps`,
		gmtDir: `${out}/Assets/GMT`,
		axes: o.axes ?? TRACK_TO_RF2,
		log,
		lib: libDoc.materials,
		texAc: libDoc.textures ?? {},
		textures: new Map(),
		written: [],
		gmts: 0,
		lampTextures: false,
		prices: priceScreens(lightsDoc),
	};

	// ---- textures: each library colour as the AC build's DDS of it, once
	// (32 bits a pixel: Direct3D 11, rFactor's, has no 24-bit format)
	await put(job, `${job.maps}/${WHITE}`, ddsOf({ width: 4, height: 4, mode: "RGBA", data: new Uint8Array(64).fill(255) }));

	// ---- the gantries' boards lettered where there is a canvas (rf2/screens.ts)
	const painter = o.boards ?? (typeof OffscreenCanvas === "undefined" ? undefined : canvasBoard);
	const boards = painter ? { screens: boardScreens(lightsDoc), painter } : null;
	if (!painter) log("  boards: none lettered here (no canvas): the gantries' boards as their pictures are");

	// ---- each model's meshes as GMTs, a GMT for each kind of them
	const built = await modelGmts(job, [...new Set(layouts.flatMap((l) => lists[l] ?? []))], models, surfaces, boards?.screens ?? new Map());

	// ---- each layout's placed objects (places.json: its cones, its marker board), knocked about: a GMT each, the same object in two layouts one
	const placesFile = `${models}/places.json`;
	const placed = (await files.exists(placesFile)) ? (await readJson<PlacesDoc>(files, placesFile)).layouts : {};
	const objectsOf = await placedObjects(job, o, layouts, placed);

	// ---- the grounds
	// ---- the lamps, lit at night (the track's, as the AC build has them)
	const lights = nightLights(lightsDoc, job.axes);
	log(`  ${lights.length} lights at night`);

	const tdf = `${venue}.tdf`;
	await put(job, `${out}/${tdf}`, tdfText([...built.grounds.values()]));

	// ---- each layout: its scene, GDB, weather, AIW and timing beams
	const sources: LayoutSources = { venue, trackName, tdf, pictures: !!o.pictures, lists, layouts: objects.layouts, models: built, objectsOf, lights, boards };
	const laps = new Map<string, Lap>();
	for (const l of layouts) laps.set(l, await writeLayout(job, l, sources));

	// ---- the pictures: the venue's icon, each layout's icons, thumbnail, wheel map and loading screen
	if (o.pictures)
		await drawPictures(files, o.pictures, {
			out,
			venue,
			trackName,
			layouts,
			laps,
			placed,
			acTrack: o.acTrack,
			put: (path, data) => put(job, path, data),
			log,
		});
	else log("  pictures: none drawn here (no canvas): the game shows none, and loads on black");

	// ---- tried in rFactor 2's Mod Mode: the location copied into its ModDev/Locations
	let installed: string | null = null;
	if (o.install) {
		installed = `${trimSlashes(o.install)}/ModDev/Locations/${venue}`;
		for (const p of job.written) await files.write(`${installed}${p.slice(out.length)}`, await files.read(p));
		log(`  copied into ${installed}`);
	}
	return { location: out, venue, layouts, gmts: job.gmts, textures: job.textures.size + 1, skipped, installed };
}

/** A scene's instances with one StartLight at most (the first: a layout lights its start with one gantry, the game's name for it its only one). */
export function oneStartLight(instances: Instance[]): Instance[] {
	let had = false;
	return instances.filter((i) => {
		if (i.name !== START_LIGHT) return true;
		if (had) return false;
		had = true;
		return true;
	});
}

/** A layout's start's steps: its first working gantry's lamps, and all out (none where it has no working gantry: the game's own count). */
export function startingLightsOf(models: string[], lampsOf: ReadonlyMap<string, number>): number | undefined {
	const lamps = models.map((m) => lampsOf.get(m)).find((n) => n !== undefined);
	return lamps === undefined ? undefined : startingLights(lamps);
}
