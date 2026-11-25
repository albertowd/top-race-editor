// A track's place where the engine runs: its files read through what it is handed (the engine window's preload: the disk), its pictures decoded there, its
// layers kept in the engine's cache folder (not the track's), and the place kept in memory while its key stays the same.

import { byCodePoint } from "./order";
import type { Grey } from "./pictures";
import { makePlace, type Place, type PlaceCache, type PlaceSource, placeKey, type TerrainDoc } from "./place";
import { plain } from "./pyjson";
import { readPart, TERRAIN_DIR } from "./trackdoc";
import { settingsOf } from "./trackfiles";

/** The disk, as the engine is handed it. */
export interface HostFiles {
	read(path: string): Promise<Uint8Array>;
	list(dir: string): Promise<string[]>;
	size(path: string): Promise<number>;
	exists(path: string): Promise<boolean>;
	write(path: string, bytes: Uint8Array): Promise<void>;
	/** a file taken out (none there: nothing done), where the host lets its engine */
	remove?(path: string): Promise<void>;
}

export interface PlaceHost {
	files: HostFiles;
	/** the engine's own cache folder */
	cacheDir: string;
	decodeGrey(bytes: Uint8Array): Promise<Grey>;
}

const absolute = (p: string) => /^([A-Za-z]:)?[\\/]/.test(p);

/** A track's files as the place reads them: paths from its project's root. */
export function placeSource(host: PlaceHost, project: string, folder: string): PlaceSource & { size(p: string): Promise<number> } {
	const at = (p: string) => (absolute(p) ? p : `${project}/${p}`);
	return {
		folder,
		read: (p) => host.files.read(at(p)),
		size: (p) => host.files.size(at(p)),
		glob: async (pattern) => {
			const cut = pattern.lastIndexOf("/");
			const dir = cut < 0 ? "." : pattern.slice(0, cut);
			const body = pattern
				.slice(cut + 1)
				.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
				.replaceAll("*", "[^/]*")
				.replaceAll("?", ".");
			const re = new RegExp(`^${body}$`);
			if (!(await host.files.exists(at(dir)))) return [];
			return (await host.files.list(at(dir)))
				.filter((n) => re.test(n))
				.sort(byCodePoint)
				.map((n) => `${dir}/${n}`);
		},
		grey: async (p) => host.decodeGrey(await host.files.read(at(p))),
	};
}

/** The place's layers kept in the engine's cache folder, by their key. */
export function placeCache(host: PlaceHost): PlaceCache {
	const file = (key: string) => `${host.cacheDir}/place/${key}.bin`;
	return {
		get: async (key) => ((await host.files.exists(file(key))) ? host.files.read(file(key)) : null),
		put: (key, bytes) => host.files.write(file(key), bytes),
	};
}

const places = new Map<string, Promise<Place>>();

/** A track's place: its terrain (folder, from its root) worked out, or kept from before. */
export async function placeOf(host: PlaceHost, project: string, folder = TERRAIN_DIR): Promise<Place> {
	const src = placeSource(host, project, folder);
	// (the track's own terrain wherever it keeps it: its track file, or terrain.json; another folder's, its file's)
	const saved = folder === TERRAIN_DIR ? await readPart(host.files, await settingsOf(host.files, project), "terrain") : null;
	const doc = (saved !== null ? plain(saved) : JSON.parse(new TextDecoder().decode(await src.read(`${folder}/terrain.json`)))) as TerrainDoc;
	const key = `${project}|${await placeKey(doc, src)}`;
	let p = places.get(key);
	if (!p) {
		for (const k of places.keys()) if (k.startsWith(`${project}|`)) places.delete(k);
		p = makePlace(doc, src, placeCache(host));
		places.set(key, p);
		p.catch(() => places.delete(key));
	}
	return p;
}
