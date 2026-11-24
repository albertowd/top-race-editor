// @vitest-environment node
// A placed object's own lights (lightoptions.ts): kept on it only where they differ from their series, checked as the objects are written (objectsfile.ts),
// laid as it has them (trackobjects.ts: one off left out, its own values with the rest), and AC's config made of them (aclights.ts: a series of its own for
// each light changed, as its series but that).
import { describe, expect, it } from "vitest";
import { acLightsText, type LightsData } from "./aclights";
import { type LaidObject, layObject } from "./laying";
import { cleanLightOptions, lightValues, objectLit, withLightOption } from "./lightoptions";
import { cleanObjects, ObjectsError } from "./objectsfile";
import type { HostFiles } from "./placehost";
import { dumpPyJson, plain, readPyJson } from "./pyjson";
import { writeObjects } from "./trackobjects";

const FLOOD = { colour: [1, 0.93, 0.82], strength: 1.69, range: 125, spot: 170 };
const SPILL = { colour: [1, 0.93, 0.82], strength: 0.29, range: 70, spot: 178 };
const POLE = [
	{ series: "Pole flood beams", at: [0, 16, 0.4], facing: [0, -0.8, 0.6] },
	{ series: "Pole spill", at: [0, 16, 0.4], facing: [0, -1, 0] },
];

describe("an object's own lights", () => {
	it("keep only what differs from their series", () => {
		let o = withLightOption(undefined, 1, { on: false }, SPILL);
		expect(o).toEqual({ "1": { on: false } });
		o = withLightOption(o, 0, { strength: 2.5, range: 125 }, FLOOD);
		expect(o).toEqual({ "0": { strength: 2.5 }, "1": { on: false } });
		expect(lightValues(FLOOD, o?.["0"])).toEqual({ on: true, strength: 2.5, colour: [1, 0.93, 0.82], range: 125 });
		// (back as their series: nothing kept)
		o = withLightOption(o, 0, { strength: 1.69 }, FLOOD);
		o = withLightOption(o, 1, { on: true }, SPILL);
		expect(o).toBeUndefined();
		expect(withLightOption(undefined, 0, { colour: [1, 0.93, 0.82] }, FLOOD)).toBeUndefined();
	});

	it("are checked and kept as the objects are written", () => {
		const objects = {
			version: 3,
			layouts: {},
			marks: [],
			objects: [
				{
					name: "POLE_0",
					model: "light_pole",
					curve: [{ p: [0, 0] }],
					heading: 0,
					collision: "none",
					lights: { "1": { on: false }, "0": { strength: 2, colour: [1, 0.5, 0], on: true }, "2": {} },
				},
			],
		};
		const out = cleanObjects(objects) as { objects: { lights?: unknown }[] };
		expect(plain(out.objects[0]?.lights as never)).toEqual({
			"0": { strength: 2, colour: [1, 0.5, 0] },
			"1": { on: false },
		});
		// (written as Python writes them: floats with their point)
		expect(dumpPyJson(out.objects[0]?.lights)).toBe('{"0": {"strength": 2.0, "colour": [1.0, 0.5, 0.0]}, "1": {"on": false}}');
		const bad = (lights: unknown) => () => cleanObjects({ ...objects, objects: [{ ...objects.objects[0], lights }] });
		expect(bad({ x: {} })).toThrow(ObjectsError);
		expect(bad({ "0": { strength: -1 } })).toThrow(/strength/);
		expect(bad({ "0": { colour: [2, 0, 0] } })).toThrow(/colour/);
		expect(bad({ "0": { range: 0 } })).toThrow(/range/);
		expect(cleanLightOptions({ "0": { on: true } }, "lights", (x) => x)).toBeUndefined();
	});

	it("are laid as the object has them: one off left out, its own values with the rest", () => {
		expect(objectLit(POLE, { "1": { on: false }, "0": { range: 90 } })).toEqual([{ ...POLE[0], range: 90 }]);
		// (laid with its own lights, as objects.json has them)
		const placed = { name: "POLE_2", model: "light_pole", curve: [{ p: [0, 0] as [number, number] }], heading: 0 };
		expect(layObject({ ...placed, lights: { "1": { on: false } } }, { size: [1, 17, 1] }, [], () => 0).lights).toEqual({
			"1": { on: false },
		});
		const blank = () => ({ root: { children: [] } }) as never;
		const pole = (name: string, x: number, lights?: LaidObject["lights"]): LaidObject => ({
			name,
			model: "light_pole",
			collision: "none",
			places: [[x, 0, 0]],
			size: [1, 17, 1],
			parts: [],
			...(lights ? { lights } : {}),
		});
		const w = writeObjects(
			[pole("POLE_0", 0), pole("POLE_1", 10, { "0": { strength: 3 }, "1": { on: false } })],
			blank(),
			{},
			{},
			() => POLE,
			() => 1,
		);
		// (by series, in the objects' order: the second pole's spill off, its flood its own strength)
		expect(w.lights).toEqual([
			{ series: "Pole flood beams", at: [0, 17, 0.4], facing: [0, -0.8, 0.6] },
			{ series: "Pole flood beams", at: [10, 17, 0.4], facing: [0, -0.8, 0.6], strength: 3 },
			{ series: "Pole spill", at: [0, 17, 0.4], facing: [0, -1, 0] },
		]);
	});

	it("make AC's config a series of their own for each light changed", async () => {
		const text: Record<string, string> = {
			"P/source/track/extension/ext_config.ini": "[BASIC]\nIGNORE_OTHER_CONFIGS = 0\n",
			"P/source/materials.json": '{"materials": {}}',
		};
		const files: HostFiles = {
			read: async (p) => new TextEncoder().encode(text[p] ?? ""),
			list: async () => [],
			size: async () => 0,
			exists: async (p) => p in text,
			write: async () => {},
		};
		const library = { nodeIn: () => [""] } as never;
		const dt: LightsData = {
			// (as source/lights.json writes them)
			series: readPyJson(
				'{"Pole flood beams": {"colour": [1.0, 0.93, 0.82], "strength": 1.69, "range": 125.0, "spot": 170.0},' +
					' "Pole spill": {"colour": [1.0, 0.93, 0.82], "strength": 0.29, "range": 70.0, "spot": 178.0}}',
			) as LightsData["series"],
			lights: [
				{ series: "Pole flood beams", at: [0, 17, 0.4], facing: [0, -0.8, 0.6] },
				{ series: "Pole flood beams", at: [10, 17, 0.4], facing: [0, -0.8, 0.6], strength: 3, colour: [1, 0, 0] },
				{ series: "Pole flood beams", at: [20, 17, 0.4], facing: [0, -0.8, 0.6], strength: 3, colour: [1, 0, 0] },
				{ series: "Pole spill", at: [0, 17, 0.4], facing: [0, -1, 0] },
				{ series: "Pole spill", at: [10, 17, 0.4], facing: [0, -1, 0], range: 40 },
			],
			screens: [],
		};
		const ini = await acLightsText(files, "P", "M", library, dt, "S");
		const sections = ini.split("\n\n").filter((s) => s.startsWith("[LIGHT_SERIES_"));
		expect(sections.map((s) => s.split("\n")[2])).toEqual([
			"DESCRIPTION = Pole flood beams",
			"DESCRIPTION = Pole spill",
			"DESCRIPTION = Pole flood beams, its own colour 1, 0, 0, strength 3",
			"DESCRIPTION = Pole spill, its own range 40",
		]);
		// (the series as it is, with its lights that are as it is)
		expect(sections[0]).toContain("COLOR = 1, 0.93, 0.82, 1.69");
		expect(sections[0]).toContain("POSITION_0 = 0.000, 17.000, 0.400");
		expect(sections[0]).not.toContain("POSITION_1");
		// (those changed: their series but what they changed, the two of the same values in one)
		expect(sections[2]).toMatch(/^\[LIGHT_SERIES_2\]/);
		expect(sections[2]).toContain("COLOR = 1, 0, 0, 3");
		expect(sections[2]).toContain("RANGE = 125");
		expect(sections[2]).toContain("POSITION_1 = 20.000, 17.000, 0.400");
		expect(sections[3]).toContain("RANGE = 40");
		expect(sections[3]).toContain("COLOR = 1, 0.93, 0.82, 0.29");
	});
});
