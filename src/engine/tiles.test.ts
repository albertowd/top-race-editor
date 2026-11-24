// @vitest-environment node
import { describe, expect, it } from "vitest";
import { boxOf, TileIndex, tileBox, tileOf, tilesOver } from "./tiles";

describe("the map in tiles", () => {
	it("finds a point’s tile by its position, either side of the origin", () => {
		expect(tileOf(0, 0)).toEqual([0, 0]);
		expect(tileOf(63.9, 64)).toEqual([0, 1]);
		expect(tileOf(-0.1, -64)).toEqual([-1, -1]);
		expect(tileBox([-1, 2])).toEqual({ x0: -64, z0: 128, x1: 0, z1: 192 });
	});

	it("puts a box on every tile it lies on", () => {
		expect(tilesOver({ x0: -10, z0: 10, x1: 70, z1: 20 })).toEqual([
			[-1, 0],
			[0, 0],
			[1, 0],
		]);
		expect(boxOf([1, 2, -3, 5], 1)).toEqual({ x0: -4, z0: 1, x1: 2, z1: 6 });
		expect(boxOf([])).toBeNull();
	});

	it("finds what lies near a box, each thing once", () => {
		const idx = new TileIndex<string>();
		idx.add({ x0: 0, z0: 0, x1: 200, z1: 10 }, "a road along three tiles");
		idx.add({ x0: 300, z0: 300, x1: 310, z1: 310 }, "far away");
		expect(idx.find({ x0: 50, z0: 5, x1: 140, z1: 6 })).toEqual(["a road along three tiles"]);
		expect(idx.find({ x0: 0, z0: 20, x1: 10, z1: 30 })).toEqual([]);
		expect(idx.keys()).toHaveLength(5);
	});
});
