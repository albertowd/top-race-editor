// The track's source in one file (TRACK_FORMAT's step 7): tools/reference/track.json, with one `version`, holding its settings and its parts: `roads`
// (roads.json's list), `objects` (objects.json's body: layouts, objects, marks), `terrain` (terrain.json's description, its raster edits' files named from the
// track's root) and `trees` (the placements). Until a part moves in, its key names its own file (a path from the track's root), or is not there (its file where
// it always was). A part is read from wherever it is, in its own file's form (what the stores work on); it is written only into the track file, the one before
// kept in the backups, as Python's json writes it (pyjson), byte for byte, as the track's own tools read it.
import { cleanObjects, isV2, seedObjects, withCurvedMarks } from "./objectsfile";
import type { HostFiles } from "./placehost";
import { type PyJson, readPyJson } from "./pyjson";
import { backup, mergeRoads, type Road, type TrackSettings, writePyJsonFile } from "./trackfiles";

/** the track file's version once it holds its parts */
export const TRACK_VERSION = 1;
/** the objects' and the terrain's versions in their own files (inline: the track file's) */
export const OBJECTS_VERSION = 3;
export const TERRAIN_VERSION = 1;
/** the terrain's folder, from the track's root: its edits' files and what it makes (its pictures, heights) */
export const TERRAIN_DIR = "tools/reference/terrain";

export type PartName = "roads" | "objects" | "terrain" | "trees";

/** each part's own file, from the track's root, where the track file names none (the trees have none) */
export const PART_FILES: Record<PartName, string | null> = {
	roads: "tools/reference/roads.json",
	objects: "tools/reference/objects.json",
	terrain: `${TERRAIN_DIR}/terrain.json`,
	trees: null,
};

type Dict = { [k: string]: PyJson };
const isDict = (v: unknown): v is Dict => !!v && typeof v === "object" && !Array.isArray(v);

/** Where a part is, as the track file (track) has it: in it (inline), or in its own file (its path). */
export function partAt(s: TrackSettings, name: PartName, track: Record<string, unknown> = s.track): { inline: boolean; file: string | null } {
	const v = track[name];
	if (v !== undefined && v !== null && typeof v !== "string") return { inline: true, file: null };
	const rel = typeof v === "string" && v ? v : PART_FILES[name];
	return { inline: false, file: rel ? `${s.project}/${rel}` : null };
}

/** The track file as written (its numbers kept as written), {} where there is none. */
async function rawTrack(files: HostFiles, s: TrackSettings): Promise<Dict> {
	if (!(await files.exists(s.trackFile))) return {};
	const doc = readPyJson(new TextDecoder().decode(await files.read(s.trackFile)));
	return isDict(doc) ? doc : {};
}

const inTerrain = `${TERRAIN_DIR}/`;

/** A part as the track file holds it, in its own file's form. */
export function fromInline(name: PartName, v: PyJson): PyJson {
	if (name === "roads") return { roads: v };
	if (name === "objects") return { version: OBJECTS_VERSION, ...(isDict(v) ? v : {}) };
	if (name === "terrain") {
		const d = isDict(v) ? v : {};
		const out: Dict = { version: TERRAIN_VERSION, ...d };
		if (Array.isArray(d.edits))
			out.edits = d.edits.map((e) =>
				isDict(e) && typeof e.file === "string" && e.file.startsWith(inTerrain) ? { ...e, file: e.file.slice(inTerrain.length) } : e,
			);
		return out;
	}
	return v;
}

/** A part in its own file's form, as the track file holds it (the file's version the track file's own). */
export function toInline(name: PartName, doc: PyJson): PyJson {
	if (name === "roads") return isDict(doc) ? (doc.roads ?? []) : [];
	if (name === "objects" || name === "terrain") {
		const { version: _v, ...rest } = isDict(doc) ? doc : {};
		if (name === "terrain" && Array.isArray(rest.edits))
			rest.edits = rest.edits.map((e) => (isDict(e) && typeof e.file === "string" && !e.file.includes("/") ? { ...e, file: inTerrain + e.file } : e));
		return rest;
	}
	return doc;
}

/** A part in its own file's form (its numbers as written), as the track file (raw) has it: from it, or from its own file (null where neither has it). */
async function partIn(files: HostFiles, s: TrackSettings, name: PartName, raw: Dict): Promise<PyJson | null> {
	const at = partAt(s, name, raw);
	if (at.inline) return fromInline(name, raw[name] as PyJson);
	if (!at.file || !(await files.exists(at.file))) return null;
	return readPyJson(new TextDecoder().decode(await files.read(at.file)));
}

/** A part in its own file's form, wherever it is now (a part written since the settings were read: where it was written). */
export async function readPart(files: HostFiles, s: TrackSettings, name: PartName): Promise<PyJson | null> {
	return partIn(files, s, name, await rawTrack(files, s));
}

/** each track file's writes, one after another (a part read, changed and written whole) */
const writing = new Map<string, Promise<unknown>>();

/** The track file changed (change: given its parts as written, its version first, and a way to read a part as it is now), the one before kept in the backups
 * (track-<stamp>.json); one change at a time. What change returns. */
export function changeTrack<T>(
	files: HostFiles,
	s: TrackSettings,
	backups: string,
	change: (doc: Dict, part: (name: PartName) => Promise<PyJson | null>) => T | Promise<T>,
	now?: Date,
): Promise<T> {
	const before = writing.get(s.trackFile) ?? Promise.resolve();
	const done = before
		.catch(() => {})
		.then(async () => {
			const raw = await rawTrack(files, s);
			const out: Dict = { version: TRACK_VERSION };
			for (const [k, v] of Object.entries(raw)) if (k !== "version") out[k] = v;
			const result = await change(out, (name) => partIn(files, s, name, raw));
			await backup(files, s.trackFile, backups, "track", now);
			await writePyJsonFile(files, s.trackFile, out);
			return result;
		});
	writing.set(s.trackFile, done);
	return done;
}

/** A part written into the track file, from its own file's form. */
export function writePart(files: HostFiles, s: TrackSettings, name: PartName, doc: PyJson, backups: string, now?: Date): Promise<void> {
	return changeTrack(
		files,
		s,
		backups,
		(out) => {
			out[name] = toInline(name, doc);
		},
		now,
	);
}

// ---- the parts as the stores have them ---------------------------------------------------------------------------

const roadsOf = (doc: PyJson | null): Road[] => (isDict(doc) && Array.isArray(doc.roads) ? (doc.roads as Road[]) : []);

/** The track's roads as written (its numbers kept as written), wherever they are. */
export async function trackRoads(files: HostFiles, s: TrackSettings): Promise<Road[]> {
	return roadsOf(await readPart(files, s, "roads"));
}

/** The page's roads written into the track file (roads_store.py's save, over the roads as they are then): the names of those changed in shape. */
export function saveTrackRoads(files: HostFiles, s: TrackSettings, backups: string, pageRoads: Road[], deleted: string[] = [], now?: Date): Promise<string[]> {
	return changeTrack(
		files,
		s,
		backups,
		async (out, part) => {
			const [roads, changed] = mergeRoads(roadsOf(await part("roads")), pageRoads, deleted);
			out.roads = toInline("roads", { roads });
			return changed;
		},
		now,
	);
}

/** The track's objects as the page has them (objects.py's ObjectsStore.load): version 3 as written; version 2 read as version 3 (converted); none, read from
 * the models (seeded). */
export async function trackObjects(files: HostFiles, s: TrackSettings, models: string): Promise<{ objects: PyJson; seeded: boolean; converted: boolean }> {
	const given = await readPart(files, s, "objects");
	if (given !== null)
		return isV2(given)
			? { objects: cleanObjects(given) as PyJson, seeded: false, converted: true }
			: { objects: withCurvedMarks(given), seeded: false, converted: false };
	return { objects: cleanObjects(await seedObjects(files, models)) as PyJson, seeded: true, converted: false };
}

/** The page's objects written into the track file (checked, rounded, version 2 converted): what was written. */
export async function saveTrackObjects(files: HostFiles, s: TrackSettings, backups: string, given: unknown, now?: Date): Promise<PyJson> {
	const out = cleanObjects(given) as PyJson;
	await writePart(files, s, "objects", out, backups, now);
	return out;
}
