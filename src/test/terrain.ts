// A terrain's engine answering from memory, for the tests: what it was asked kept.

import { TerrainApi, type TerrainEngine } from "../terrain/api";
import { base64OfFloat32, rasterJson } from "../terrain/codec";
import type { GridJson, LayersJson, TerrainDoc, TerrainInfo } from "../terrain/types";

/** A grid as the engine sends it: its values 16 bit over lo to hi. */
export function gridJson(x0: number, z0: number, cell: number, nx: number, nz: number, f: (x: number, z: number) => number): GridJson {
	const v: number[] = [];
	for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) v.push(f(x0 + i * cell, z0 + j * cell));
	const lo = Math.min(...v);
	const hi = Math.max(...v);
	const u = new Uint16Array(v.map((y) => Math.round(((y - lo) / Math.max(hi - lo, 1e-9)) * 65535)));
	let bin = "";
	for (const b of new Uint8Array(u.buffer)) bin += String.fromCharCode(b);
	return { x0, z0, cell, nx, nz, lo, hi, data: btoa(bin) };
}

export const terrainDoc = (): TerrainDoc => ({
	version: 1,
	place: { location: "location.json" },
	image: {
		file: "picture.jpg",
		area_x_z: [
			[0, 40],
			[0, 20],
		],
		metres_a_pixel: 1,
	},
	heights: { files: ["h.json"], offset_m: 0 },
	grid: {
		area_x_z: [
			[0, 40],
			[0, 20],
		],
		cell_m: 10,
	},
	filters: {
		picture_trees: { lum: 75, sd: 12 },
		photo_trees: { lum: 84, sd: 13 },
		tree_near_m: 7,
		tree_share: 0.3,
		over_m: 1.5,
		opening_m: 55,
		wide_over_m: 4,
		wide_opening_m: 250,
		fills_m: [20, 40],
		enough_a_cell: 0.16,
		areas: [],
	},
	edits: [{ type: "raster", name: "paddock", file: "paddock.npz" }],
});

/** An engine answering the terrain from memory: what it was asked kept. */
export function fakeTerrainEngine() {
	const calls: { path: string; body?: Record<string, unknown> }[] = [];
	const saved = { doc: terrainDoc() };
	const ground = (x: number) => 1 + x / 100;
	const answer = (path: string, body?: Record<string, unknown>): unknown => {
		if (path === "/api/terrain" && !body)
			return {
				exists: true,
				doc: saved.doc,
				why: { "0": "ground", "4": "over" },
				ground_cell: 2,
			} satisfies TerrainInfo;
		if (path === "/api/terrain" && body) {
			saved.doc = JSON.parse(JSON.stringify(body.doc));
			for (const e of saved.doc.edits) delete (e as { data?: unknown }).data;
			return { ok: true, exists: true, doc: saved.doc };
		}
		if (path.startsWith("/api/terrain/raster")) return rasterJson({ x0: 0, z0: 0, cell: 1, nx: 2, nz: 2, v: new Float32Array([0, 0, 0, 0]) });
		if (path === "/api/terrain/layers") {
			const want = body?.want as string[];
			const out: LayersJson = { grids: {}, seconds: 0.1 };
			if (want.includes("original")) out.grids.original = gridJson(0, 0, 10, 5, 3, (x) => ground(x) + 2);
			if (want.includes("filtered")) out.grids.filtered = gridJson(0, 0, 10, 5, 3, ground);
			if (want.includes("ground")) out.grids.ground = gridJson(0, 0, 2, 21, 11, ground);
			if (want.includes("change")) out.grids.change = null;
			if (want.includes("points")) {
				out.points = {
					count: 1,
					x: base64OfFloat32(new Float32Array([5])),
					z: base64OfFloat32(new Float32Array([5])),
					y: base64OfFloat32(new Float32Array([3])),
					why: btoa("\x04"),
				};
				out.counts = { "0": 0, "4": 1 };
			}
			return out;
		}
		return null;
	};
	// (what comes across the engine window's port: copies)
	const copied = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
	const engine: TerrainEngine = {
		async ask<T>(path: string, given?: unknown): Promise<T> {
			const body = copied(given) as Record<string, unknown> | undefined;
			calls.push({ path, body });
			const out = answer(path, body);
			if (out === null) throw new Error("not found");
			return copied(out) as T;
		},
		blob: async (path) => `blob:${path}`,
	};
	return { api: new TerrainApi(engine), calls, saved };
}
