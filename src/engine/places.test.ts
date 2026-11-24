// @vitest-environment node
// The layouts' places (TRACK_FORMAT.md's places.json, its physics objects): on made-up layouts, what moves and what keeps where it stood.
import { describe, expect, it } from "vitest";
import { layoutPlaces, type ObjectsIn, type PlacesDoc } from "./places";

describe("the layouts’ places", () => {
	const tilted = (x: number, z: number) => 0.01 * x + 0.02 * z;

	it("stands each spot over the floor as it stood, one not moved exactly where it was", () => {
		const before: PlacesDoc = {
			version: 1,
			layouts: {
				L: {
					spots: [
						{ name: "START_0", x: 1, y: tilted(1, 2) + 0.5, z: 2, heading: 0.25 },
						{ name: "START_1", x: 3, y: tilted(3, 4) + 0.75, z: 4, heading: 0.25 },
						{ name: "TIME_0_L", x: 5, y: 9, z: 6, heading: 1.5 },
					],
					pits: 0,
					objects: [],
				},
			},
		};
		const objects: ObjectsIn = {
			layouts: {
				L: {
					// (START_0 as it was; START_1 moved; START_2 new: as high as the last of its kind)
					grid: [
						{ x: 1, z: 2, heading: 0.25 },
						{ x: 13, z: 4, heading: 0.25 },
						{ x: 20, z: 0, heading: 0 },
					],
					pits: [{ x: 7, z: 7, heading: 1 }],
					hotlap: null,
					timing: [{ left: { x: 6, z: 6 }, right: { x: 8, z: 6 } }],
				},
				M: { grid: [], pits: [], hotlap: { x: 0, z: 0, heading: 2 }, timing: [] },
			},
			objects: [
				{ name: "CONE_0", model: "cone", curve: [{ p: [10, 10] }], collision: "dynamic" },
				{ name: "STACK_0", model: "tyre_stack", curve: [{ p: [11, 10] }], collision: "dynamic", layouts: ["M", "X"] },
				{ name: "WALL_0", model: "tyre_stack", curve: [{ p: [0, 0] }, { p: [1, 0] }], collision: "wall" },
				{ name: "ODD_0", model: "unknown", curve: [{ p: [0, 0] }], collision: "dynamic" },
			],
		};
		const got = layoutPlaces(objects, tilted, (m) => m !== "unknown", before);
		const L = got.layouts.L;
		const M = got.layouts.M;
		if (!L || !M) throw new Error("no layout");
		expect(L.spots.map((s) => s.name)).toEqual(["START_0", "START_1", "START_2", "PIT_0", "TIME_0_L", "TIME_0_R"]);
		const [s0, s1, s2, p0, tl, tr] = L.spots;
		expect(s0).toEqual(before.layouts.L?.spots[0]);
		expect(s1?.y).toBeCloseTo(tilted(13, 4) + 0.75, 12);
		expect(s2?.y).toBeCloseTo(tilted(20, 0) + 0.75, 12);
		expect(p0?.y).toBeCloseTo(tilted(7, 7), 12);
		// (a gate's side keeps its heading; moved, its height over the floor as it was)
		expect([tl?.heading, tl?.y]).toEqual([1.5, tilted(6, 6) + (9 - tilted(5, 6))]);
		expect(tr).toEqual({ name: "TIME_0_R", x: 8, y: tilted(8, 6), z: 6, heading: 0 });
		expect(L.pits).toBe(1);
		// (a dynamic one in each layout it is in, on the floor less its sink; a wall, or one of no model known, none)
		expect(L.objects.map((o) => o.name)).toEqual(["CONE_0"]);
		expect(M.objects.map((o) => [o.name, o.y])).toEqual([
			["CONE_0", tilted(10, 10)],
			["STACK_0", tilted(11, 10) - 0.03],
		]);
		expect(M.spots).toEqual([{ name: "HOTLAP_START_0", x: 0, y: 0, z: 0, heading: 2 }]);
		// (with the format's lift: every spot that high over the floor, wherever it stood)
		const lifted = layoutPlaces(objects, tilted, (m) => m !== "unknown", before, 0.5);
		for (const s of lifted.layouts.L?.spots ?? []) expect(s.y - tilted(s.x, s.z)).toBeCloseTo(0.5, 12);
	});
});
