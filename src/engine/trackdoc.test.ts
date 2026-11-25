import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostFiles } from "./placehost";
import { plain, readPyJson } from "./pyjson";
import { fromInline, readPart, saveTrackObjects, saveTrackRoads, TRACK_VERSION, toInline, trackObjects, trackRoads } from "./trackdoc";
import { settingsOf } from "./trackfiles";
import { cleanTrees, loadTrees, saveTrees } from "./treesfile";

const files: HostFiles = {
	read: async (p) => new Uint8Array(readFileSync(p)),
	list: async (d) => readdirSync(d),
	size: async (p) => statSync(p).size,
	exists: async (p) => existsSync(p),
	write: async (p, b) => {
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, b);
	},
};

let root = "";
const at = (f: string) => join(root, f).replace(/\\/g, "/");
const put = (f: string, text: string) => {
	mkdirSync(dirname(at(f)), { recursive: true });
	writeFileSync(at(f), text.split("\n").join("\r\n"));
};
const track = () => readPyJson(readFileSync(at("tools/reference/track.json"), "utf-8")) as Record<string, unknown>;
const backups = () => at("build/cache/roads_backup");

const ROADS = '{\n "roads": [\n  {\n   "name": "1ROAD_1",\n   "width": 8.0,\n   "curve": [\n    1.50\n   ]\n  }\n ]\n}';

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trackdoc-")).replace(/\\/g, "/");
	put("tools/reference/track.json", '{\n "name": "Fake",\n "roads": "tools/reference/roads.json",\n "models": "track/models",\n "satellite_span": 1060.0\n}');
	put("tools/reference/roads.json", ROADS);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the track’s parts in the track file", () => {
	it("reads a part from the file the track file names, and moves it into the track file when it is saved", async () => {
		const s = await settingsOf(files, root);
		const roads = await trackRoads(files, s);
		expect(plain(roads as never)).toEqual([{ name: "1ROAD_1", width: 8, curve: [1.5] }]);
		const changed = await saveTrackRoads(files, s, backups(), [{ name: "1ROAD_2", width: 6, curve: [2] }]);
		expect(changed).toEqual(["1ROAD_2"]);
		const t = track();
		// (its version first, its settings where they were, the roads where their path was)
		expect(Object.keys(t)).toEqual(["version", "name", "roads", "models", "satellite_span"]);
		expect(plain(t.version as never)).toBe(TRACK_VERSION);
		expect((plain(t.roads as never) as { name: string }[]).map((r) => r.name)).toEqual(["1ROAD_2", "1ROAD_1"]);
		// (the old file not written; read now from the track file, even with the settings read before)
		expect(readFileSync(at("tools/reference/roads.json"), "utf-8")).toBe(ROADS.split("\n").join("\r\n"));
		expect((await trackRoads(files, s)).map((r) => r.name)).toEqual(["1ROAD_2", "1ROAD_1"]);
		// (numbers as they were written, the file's line endings kept; the one before in the backups)
		const text = readFileSync(at("tools/reference/track.json"), "utf-8");
		expect(text).toContain('"satellite_span": 1060.0');
		expect(text).toContain("\n    1.50\r\n");
		expect(readdirSync(backups()).filter((f) => f.startsWith("track-"))).toHaveLength(1);
	});

	it("keeps two saves at once", async () => {
		const s = await settingsOf(files, root);
		await Promise.all([
			saveTrackRoads(files, s, backups(), [{ name: "1ROAD_3", width: 5, curve: [0] }]),
			saveTrees(files, s, backups(), [{ model: "euca_0", x: 1, z: 2, heading: 0, scale: 1 }]),
			saveTrackObjects(files, s, backups(), { layouts: {}, objects: [], marks: [] }),
		]);
		const t = track();
		expect((plain(t.roads as never) as { name: string }[]).map((r) => r.name)).toEqual(["1ROAD_3", "1ROAD_1"]);
		expect(plain(t.trees as never) as unknown[]).toHaveLength(1);
		expect(plain(t.objects as never)).toEqual({ layouts: {}, objects: [], marks: [] });
	});

	it("keeps a part’s own file’s form both ways: the objects’ version, the terrain’s edits’ files", async () => {
		const s = await settingsOf(files, root);
		put("tools/reference/objects.json", '{\n "version": 3,\n "layouts": {},\n "objects": [],\n "marks": []\n}');
		expect(plain((await trackObjects(files, s, at("track/models"))).objects as never)).toEqual({
			version: 3,
			layouts: {},
			objects: [],
			marks: [],
		});
		await saveTrackObjects(files, s, backups(), { layouts: {}, objects: [], marks: [] });
		expect("version" in (track().objects as object)).toBe(false);
		expect(plain((await readPart(files, s, "objects")) as never)).toMatchObject({ version: 3 });

		const terrain = { version: 1, grid: { cell_m: 10 }, edits: [{ name: "a", type: "raster", file: "edit_3.npz" }] };
		const inline = toInline("terrain", terrain as never);
		expect(plain(inline as never)).toEqual({
			grid: { cell_m: 10 },
			edits: [{ name: "a", type: "raster", file: "tools/reference/terrain/edit_3.npz" }],
		});
		expect(plain(fromInline("terrain", inline) as never)).toEqual(terrain);
		expect(plain(fromInline("roads", toInline("roads", { roads: [] }) as never) as never)).toEqual({ roads: [] });
	});

	it("has no trees where the track file has none, and keeps those saved checked and rounded", async () => {
		const s = await settingsOf(files, root);
		expect(await loadTrees(files, s)).toEqual([]);
		const saved = await saveTrees(files, s, backups(), [
			{ model: "euca_6", x: -208.98509941, z: 322.63181560405565, heading: 3.623034803792262 + 2 * Math.PI },
			{ model: "broad_far_n2", x: 1, z: 2, heading: -0.5, scale: 1.01254092 },
		]);
		expect(plain(saved as never)).toEqual([
			// (a heading within half a turn of none: as the objects')
			{ model: "euca_6", x: -208.985, z: 322.632, heading: -2.6602, scale: 1 },
			{ model: "broad_far_n2", x: 1, z: 2, heading: -0.5, scale: 1.0125 },
		]);
		expect(readFileSync(at("tools/reference/track.json"), "utf-8")).toContain('"scale": 1.0\r\n');
		expect(plain((await loadTrees(files, s)) as never)).toEqual(plain(saved as never));
		expect(() => cleanTrees([{ x: 1, z: 2 }])).toThrow("trees[0].model");
		expect(() => cleanTrees([{ model: "a", x: "no", z: 2 }])).toThrow("trees[0].x: not a number");
		expect(() => cleanTrees([{ model: "a", x: 1, z: 2, scale: 0 }])).toThrow("trees[0].scale");
		expect(() => cleanTrees({})).toThrow("trees: a list");
	});
});
