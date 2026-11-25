// A track's material library (its source/materials.json, the track's tools/materials.py): each material by its name, its Assetto Corsa data in its targets.ac,
// which a model holding only the name is read with (gltf_source's LIBRARY); and what each mesh is (its role, its ground, how far it is drawn, its shadows, its
// own name), AC's name and flags made from it (materials.py's Hook: node_out, node_in; grass grows on it), its grounds in source/surfaces.json.
import type { Kx, MaterialLibrary } from "./gltf";

interface LibraryDoc {
	version?: number;
	materials?: Record<string, { targets?: { ac?: Kx } } & Record<string, unknown>>;
	textures?: Record<string, { ac?: string; normal?: boolean }>;
}

/** The grounds a track is driven on, each with its name in each game (source/surfaces.json's surfaces). */
export type Surfaces = Record<string, { targets?: { ac?: string } }>;

/** AC's name for a mesh it drives on or hits: 1ROAD_<its own name> (materials.py's AC_NAME) */
const AC_NAME = /^(\d+)([A-Z]+)_(.+)$/s;
/** a prefix of AC's and the ground it stands for, the first that fits (materials.py's SURFACES) */
const SURFACES: [string, string][] = [
	["1ROAD_KERB", "rumble"],
	["1KERB", "kerb"],
	["1ROAD", "asphalt"],
	["1GRASS", "grass"],
	["1WALL", "wall"],
	["1SAND", "sand"],
];

/** A flag's value as a number: d where it has none. */
function num(v: unknown, d: number): number {
	if (typeof v === "number") return v;
	if (v === undefined || v === null) return d;
	return Number(v);
}

/** A mesh as kept: its own name (AC's prefix out), its role and what else every game reads of it, and what only AC's round trip needs (materials.py's
 * node_out). */
export function nodeOut(surfaces: Surfaces, name: string, given: Kx): [string, Kx, Kx] {
	const x: Kx = { ...given };
	const track: Kx = {};
	const m = AC_NAME.exec(name);
	const ac = (v: { targets?: { ac?: string } } | undefined) => v?.targets?.ac;
	let own = name;
	if (m?.[1] === "1" && (m[2] === "WALL" || Object.values(surfaces).some((v) => ac(v) === m[2]))) {
		own = m[3] as string;
		if (m[2] === "WALL") track.role = "wall";
		else {
			track.role = "surface";
			const hit = SURFACES.find(([k, v]) => name.startsWith(k) && ac(surfaces[v]) === m[2]);
			if (!hit) throw new Error(`${name}: no ground of surfaces.json is AC's ${m[2]} by its prefix`);
			track.surface = hit[1];
		}
	} else track.role = "visual";
	const lod = [num(x.lod_in, 0), num(x.lod_out, 0)] as [number, number];
	delete x.lod_in;
	delete x.lod_out;
	// (AC's far 0: no limit, null)
	if (lod[0] !== 0 || lod[1] !== 0) track.draw = [lod[0], lod[1] || null];
	if (!num(x.cast_shadows, 1)) track.shadows = false;
	delete x.cast_shadows;
	if (!num(x.renderable, 1)) track.visible = false;
	delete x.renderable;
	// (grass grows on it)
	const grass = x.grass;
	delete x.grass;
	if (grass) track.grass = true;
	return [own, track, x];
}

/** A mesh as the tools have it, from how it is kept: AC's name (its prefix from its role and ground) and flags (materials.py's node_in). */
export function nodeIn(surfaces: Surfaces, name: string, track: Kx, given: Kx): [string, Kx] {
	const x: Kx = { ...given };
	let out = name;
	if (track.role === "wall") out = `1WALL_${name}`;
	else if (track.role === "surface") {
		const surface = String(track.surface as string);
		const ac = surfaces[surface]?.targets?.ac;
		if (!ac) throw new Error(`${name}: its ground ${surface} has no name of AC's in surfaces.json`);
		out = `1${ac}_${name}`;
	}
	const draw = (Array.isArray(track.draw) ? track.draw : [0, 0]) as (number | null)[];
	x.lod_in = draw[0] ?? 0;
	x.lod_out = draw[1] || 0;
	x.cast_shadows = track.shadows === false ? 0 : 1;
	x.renderable = track.visible === false ? 0 : 1;
	if (track.grass) x.grass = true;
	return [out, x];
}

/** A track's material library, read only: what is put in it is dropped (the track's tools write it, the editor's engine does not). */
export function readLibrary(doc: LibraryDoc, surfaces: Surfaces = {}): MaterialLibrary {
	return {
		get: (name) => doc.materials?.[name]?.targets?.ac ?? null,
		put: () => {},
		nodeOut: (name, x) => nodeOut(surfaces, name, x),
		nodeIn: (name, track, x) => nodeIn(surfaces, name, track, x),
	};
}

/** A track's material library read from its project (source/materials.json, its grounds source/surfaces.json); none where it has none. */
export async function libraryOf(
	files: { read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> },
	project: string,
): Promise<MaterialLibrary | undefined> {
	const p = `${project}/source/materials.json`;
	if (!(await files.exists(p))) return undefined;
	const read = async (f: string) => JSON.parse(new TextDecoder().decode(await files.read(f)));
	const s = `${project}/source/surfaces.json`;
	const surfaces = (await files.exists(s)) ? (((await read(s)) as { surfaces?: Surfaces }).surfaces ?? {}) : {};
	return readLibrary((await read(p)) as LibraryDoc, surfaces);
}
