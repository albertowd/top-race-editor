// @vitest-environment node
// The start gantries: in each layout the one over or by its start and finish line working, its lamps named as the games light them, the others still (their
// lamps named so none does, their board a still one's where the library has it); a static one's collision round its feet, the way under it free.
import { describe, expect, it } from "vitest";
import { gantryFeet, gantryModel, NEAR, STILL, startLine, stillMaterials, stillName, workingGantries, writeGantry } from "./gantries";
import type { Kn5 } from "./kn5tree";
import type { LaidObject } from "./laying";

const blank = (): Kn5 => ({
	version: 6,
	extra: 0,
	textures: [],
	materials: [],
	root: { kind: 1, name: "", active: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [] },
});

/** A part of a box from lo to hi (eleven numbers a point), in the world. */
function part(name: string, material: string, lo: number[], hi: number[]) {
	const V: number[] = [];
	for (const x of [lo[0], hi[0]])
		for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) V.push(x as number, y as number, z as number, 0, 1, 0, 0, 0, 1, 0, 0);
	return { part: name, material, V: Float64Array.from(V), F: Int32Array.from([0, 1, 3, 0, 3, 2]) };
}

/** A gantry across the way at (x, z), turned h: its feet either end, its board and lamps over the way. */
const laid = (name: string, x: number, z: number, h = 0, layouts?: string[]): LaidObject => ({
	name,
	model: "gantry",
	collision: "static",
	places: [[x, z, h]],
	size: [19, 5, 2.6],
	...(layouts ? { layouts } : {}),
	parts: [
		part("gantry_tyres", "TyreBarrier", [x - 9.5, 0, z - 1.3], [x - 8, 1.7, z + 1.3]),
		part("gantry_steel", "GantrySteel", [x + 8, 0, z - 1.2], [x + 9.5, 5.3, z + 1.2]),
		part("gantry_board", "GantryBoard", [x - 6.5, 2.9, z - 0.4], [x + 6.5, 5.3, z + 0.4]),
		part("gantry_flag", "GantryFlag", [x - 1, 3.1, z - 0.2], [x + 1, 3.5, z + 0.2]),
		part("ks_start_light_0", "StartLamp", [x, 3.2, z - 0.2], [x + 0.3, 3.5, z + 0.1]),
		part("ks_start_light_4", "StartLamp", [x - 1, 3.1, z - 0.1], [x - 0.6, 3.4, z + 0.2]),
	],
});

describe("the start gantries", () => {
	it("work in each layout over its start and finish line, the nearest gantry to it, none far from it", () => {
		const a = laid("GANTRY_1500", -7.4, 104.1);
		const b = laid("GANTRY_1000", -77.4, 104.7);
		// (the Velopark's lines: its first timing gate's ends)
		const line = (lx: number, lz: number, rx: number, rz: number) => startLine({ timing: [{ left: { x: lx, z: lz }, right: { x: rx, z: rz } }] });
		const [mx, mz] = line(-15.184, 115.335, 4.7, 113.003) as [number, number];
		expect([mx, mz].map((v) => Math.round(v * 1000) / 1000)).toEqual([-5.242, 114.169]);
		expect(startLine({})).toBeNull();
		const starts = {
			long: line(-15.184, 115.335, 4.7, 113.003),
			short: line(-71.785, 90.429, -86.699, 91.569),
			// (the kids' line, 140 m from either: neither works there)
			kids: line(-88.871, -42.672, -98.841, -36.055),
			none: null,
		};
		expect(workingGantries([a, b], starts)).toEqual({
			long: "GANTRY_1500",
			short: "GANTRY_1000",
			kids: null,
			none: null,
		});
		// (one standing only in some layouts not working in the others; none beyond NEAR)
		const only = laid("GANTRY_KIDS", -94, -40, 0, ["kids"]);
		expect(workingGantries([a, b, only], starts).kids).toBe("GANTRY_KIDS");
		expect(workingGantries([only], { long: [-94, -40] })).toEqual({ long: null });
		expect(workingGantries([a], { at: [-7.4 + NEAR + 1, 104.1] })).toEqual({ at: null });
	});

	it("are named after the track’s model, a still one after its working one", () => {
		expect(gantryModel("track", "GANTRY_1500")).toBe("track_gantry_1500");
		expect(gantryModel("track", "Gantry 1000", false)).toBe(`track_gantry_1000${STILL}`);
		expect(["KS_START_LIGHT_3", "GANTRY_FLAG", "GANTRY_BOARD"].map(stillName)).toEqual(["NO_START_LIGHT_3", "STATIC_FLAG", "GANTRY_BOARD"]);
	});

	it("light their lamps working, none still", () => {
		const g = laid("GANTRY_1500", -7, 104);
		g.boxes = gantryFeet(g);
		// (the library's still board: GantryStill; none of the steel's, though its name would do)
		const has = new Set(["GantryStill"]);
		const still = (m: string) => stillMaterials(m).find((n) => has.has(n)) ?? null;
		expect(stillMaterials("GantryBoard")).toEqual(["GantryBoardStill", "GantryStill"]);
		const on = blank();
		writeGantry(g, on, {}, true, still);
		const names = (k: Kn5) => k.root.children.map((c) => c.name);
		expect(names(on)).toEqual(["GANTRY_TYRES", "GANTRY_STEEL", "GANTRY_BOARD", "GANTRY_FLAG", "KS_START_LIGHT_0", "KS_START_LIGHT_4", "1WALL_GANTRY_1500"]);
		const off = blank();
		writeGantry(g, off, {}, false, still);
		expect(names(off)).toEqual(["GANTRY_TYRES", "GANTRY_STEEL", "GANTRY_BOARD", "STATIC_FLAG", "NO_START_LIGHT_0", "NO_START_LIGHT_4", "1WALL_GANTRY_1500"]);
		// (the working one's board the screen's material, the still one's its still one)
		const material = (k: Kn5, n: string) => k.materials[(k.root.children.find((c) => c.name === n) as { material: number }).material]?.name;
		expect([material(on, "GANTRY_BOARD"), material(off, "GANTRY_BOARD")]).toEqual(["GantryBoard", "GantryStill"]);
		expect(material(off, "GANTRY_STEEL")).toBe("GantrySteel");
	});

	it("are hit only at their feet, the way under them free", () => {
		const g = laid("GANTRY_1000", -77, 105, Math.PI / 2);
		// (turned a quarter: its across along z, as world() turns a model)
		g.parts = g.parts.map((p) => {
			const V = Float64Array.from(p.V);
			for (let i = 0; i < V.length; i += 11) {
				const dx = (V[i] as number) + 77;
				const dz = (V[i + 2] as number) - 105;
				V[i] = -77 + dz;
				V[i + 2] = 105 - dx;
			}
			return { ...p, V };
		});
		const feet = gantryFeet(g);
		expect(feet).toHaveLength(2);
		const zs = feet.map((b) => b.filter((_, i) => i % 3 === 2));
		const xs = feet.map((b) => b.filter((_, i) => i % 3 === 0));
		// (each foot either side of the middle, none across it)
		expect(zs.map((z) => Math.sign(Math.min(...z) - 105) * Math.sign(Math.max(...z) - 105))).toEqual([1, 1]);
		expect(Math.min(...(zs[0] as number[]))).toBeGreaterThan(105 + 7);
		expect(Math.max(...(zs[1] as number[]))).toBeLessThan(105 - 7);
		for (const x of xs) expect(Math.max(...x) - Math.min(...x)).toBeLessThan(3);
		for (const b of feet) expect(Math.max(...b.filter((_, i) => i % 3 === 1))).toBeLessThan(2.2);
	});
});
