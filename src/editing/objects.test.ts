import { produce } from "immer";
import { describe, expect, it } from "vitest";
import type { TrackObjects } from "../domain/types";
import { someObjects } from "../test/fixtures";
import {
	addObject,
	along,
	countOf,
	exists,
	freeName,
	headingOf,
	inLayout,
	kindOfModel,
	moveObject,
	objectAt,
	objectsOf,
	poseOf,
	positionOf,
	removeObject,
	reorderObject,
	setLayouts,
	sharing,
	spotOf,
	turnAll,
	turned,
	turnObject,
} from "./objects";

// (the fixture's objects, by their place in the list)
const TYRES = 0;
const POLE = 1;
const CONE = 2;
const BOARD = 3;

const edit = (o: TrackObjects, fn: (d: TrackObjects) => unknown) => produce(o, (d) => void fn(d));
describe("headings", () => {
	it("look from +z towards +x, and turn points the same way", () => {
		expect(along(0)).toEqual([0, 1]);
		expect(along(Math.PI / 2)[0]).toBeCloseTo(1, 9);
		expect(headingOf(1, 0)).toBeCloseTo(Math.PI / 2, 9);
		const [x, z] = turned(0, 1, 0, 0, Math.PI / 2);
		expect([x, z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 0]);
	});
});

describe("what is where", () => {
	it("counts, finds and places each kind; an object by its model, in the layouts it lists", () => {
		const o = someObjects();
		expect(["grid", "pits", "hotlap", "timing", "cones", "boards", "poles", "tyres", "trees", "karts"].map((k) => countOf(o, "vp_a", k as never))).toEqual([
			2, 1, 1, 1, 1, 1, 1, 1, 1, 1,
		]);
		expect(countOf(o, "none", "grid")).toBe(0);
		expect(kindOfModel("light_pole")).toBe("poles");
		// (a building a shed; a thing standing as it is that is not one, or a model the catalogue has not, a static object)
		expect(["pit_building", "farm_house", "blue_shed"].map(kindOfModel)).toEqual(["sheds", "sheds", "sheds"]);
		expect(["marshal_post", "chair", "bins", "globe_lamp", "no_such_model"].map(kindOfModel)).toEqual(Array(5).fill("statics"));
		expect(spotOf(o, "vp_a", { kind: "grid", i: 1, j: -1 })).toMatchObject({ x: 4, z: 2 });
		expect(spotOf(o, "vp_a", { kind: "cones", i: CONE, j: -1 })).toBeNull();
		expect(poseOf(o, "vp_a", { kind: "boards", i: BOARD, j: -1 })).toEqual({ x: 70, z: 6, heading: -Math.PI / 2 });
		expect(poseOf(o, "vp_a", { kind: "tyres", i: TYRES, j: -1 })).toBeNull();
		expect(positionOf(o, "vp_a", { kind: "timing", i: 0, j: -1 })).toEqual({ x: 30, z: 0 });
		expect(positionOf(o, "vp_a", { kind: "timing", i: 0, j: 1 })).toEqual({ x: 30, z: -4 });
		expect(positionOf(o, "vp_a", { kind: "tyres", i: TYRES, j: -1 })).toEqual({ x: 0.7, z: -10 });
		expect(positionOf(o, "vp_a", { kind: "tyres", i: TYRES, j: 1 })).toEqual({ x: 1.4, z: -10 });
		expect(exists(o, "vp_a", { kind: "grid", i: 5, j: -1 })).toBe(false);
		// (an object of another kind at that place in the list: not the one picked; one of another layout still is, to be put in this one too)
		expect(exists(o, "vp_a", { kind: "poles", i: CONE, j: -1 })).toBe(false);
		const only = edit(o, (d) => {
			(d.objects[CONE] as TrackObjects["objects"][number]).layouts = ["vp_b"];
		});
		expect(exists(only, "vp_a", { kind: "cones", i: CONE, j: -1 })).toBe(true);
		const cone = (only.objects[CONE] as TrackObjects["objects"][number]).curve[0]?.p as [number, number];
		expect(objectAt(only, "vp_a", cone[0], cone[1], 0.1)).toEqual({ kind: "cones", i: CONE, j: -1 });
		// (where one of the layout shown is as near, that one)
		const both = edit(only, (d) => {
			d.objects.push({
				...(d.objects[CONE] as TrackObjects["objects"][number]),
				name: "CONE_HERE",
				layouts: undefined,
			});
		});
		expect(objectAt(both, "vp_a", cone[0], cone[1], 0.1)).toEqual({ kind: "cones", i: both.objects.length - 1, j: -1 });
		expect(countOf(only, "vp_a", "cones")).toBe(0);
		expect(objectsOf(only, "vp_b", "cones")).toEqual([CONE]);
	});

	it("picks the nearest under the mouse: a curve by its node, else by its line", () => {
		const o = someObjects();
		expect(objectAt(o, "vp_a", 4.2, 2.1, 0.5)).toEqual({ kind: "grid", i: 1, j: -1 });
		expect(objectAt(o, "vp_a", 30, 3.9, 0.1)).toEqual({ kind: "timing", i: 0, j: 0 });
		expect(objectAt(o, "vp_a", 1.4, -10, 0.1)).toEqual({ kind: "tyres", i: TYRES, j: 1 });
		expect(objectAt(o, "vp_a", 0.7, -10.1, 0.1)).toEqual({ kind: "tyres", i: TYRES, j: -1 });
		// (on its line, by a node: the node, not the whole wall the line is nearer as)
		expect(objectAt(o, "vp_a", 1.3, -10, 0.1)).toEqual({ kind: "tyres", i: TYRES, j: 1 });
		expect(objectAt(o, "vp_a", 0.2, -10.05, 0.1)).toEqual({ kind: "tyres", i: TYRES, j: 0 });
		const picked = { kind: "tyres" as const, i: TYRES, j: -1 };
		expect(objectAt(o, "vp_a", 1.4 / 3, -10, 0.1, undefined, { picked })).toEqual({
			kind: "tyres",
			i: TYRES,
			j: 0,
			h: "out",
		});
		expect(positionOf(o, "vp_a", { kind: "tyres", i: TYRES, j: 1, h: "in" })?.x).toBeCloseTo(1.4 - 1.4 / 3, 9);
		expect(objectAt(o, "vp_a", 40, 5, 0.1)).toEqual({ kind: "cones", i: CONE, j: -1 });
		expect(objectAt(o, "vp_a", 40, 5, 0.1, ["grid"])).toBeNull();
		expect(objectAt(o, "vp_a", 500, 500, 1)).toBeNull();
	});
});

describe("the edits", () => {
	it("moves one, a part, or all of a kind", () => {
		const o = someObjects();
		const a = edit(o, (d) => moveObject(d, "vp_a", { kind: "grid", i: 0, j: -1 }, 1, 2));
		expect(a.layouts.vp_a.grid.map((s) => [s.x, s.z])).toEqual([
			[11, 2],
			[4, 2],
		]);
		const b = edit(o, (d) => moveObject(d, "vp_a", { kind: "grid", i: 0, j: -1 }, 1, 0, true));
		expect(b.layouts.vp_a.grid.map((s) => s.x)).toEqual([11, 5]);
		const c = edit(o, (d) => moveObject(d, "vp_a", { kind: "timing", i: 0, j: 1 }, 0, -1));
		expect([c.layouts.vp_a.timing[0].left.z, c.layouts.vp_a.timing[0].right.z]).toEqual([4, -5]);
		const t = edit(o, (d) => moveObject(d, "vp_a", { kind: "tyres", i: TYRES, j: 0 }, 0, 1));
		expect(t.objects[TYRES]?.curve.map((n) => n.p)).toEqual([
			[0, -9],
			[1.4, -10],
		]);
		expect(t.objects[TYRES]?.curve[0]?.out).toEqual([1.4 / 3, 0]);
		const tw = edit(o, (d) => moveObject(d, "vp_a", { kind: "tyres", i: TYRES, j: -1 }, 0, 1));
		expect(tw.objects[TYRES]?.curve.map((n) => n.p[1])).toEqual([-9, -9]);
		const cones = edit(o, (d) => moveObject(d, "vp_a", { kind: "cones", i: CONE, j: -1 }, 1, 1, true));
		expect(cones.objects[CONE]?.curve[0]?.p).toEqual([41, 6]);
		expect(cones.objects[POLE]).toBe(o.objects[POLE]);
	});

	it("turns one, or all of a kind about it", () => {
		const o = someObjects();
		const one = edit(o, (d) => turnObject(d, "vp_a", { kind: "pits", i: 0, j: -1 }, 7));
		expect(one.layouts.vp_a.pits[0].heading).toBeCloseTo(7 - 2 * Math.PI, 9);
		const all = edit(o, (d) => turnObject(d, "vp_a", { kind: "grid", i: 0, j: -1 }, Math.PI, true));
		const second = all.layouts.vp_a.grid[1];
		expect(second.heading).toBeCloseTo(Math.PI, 9);
		expect(second.x).toBeCloseTo(12, 9);
		expect(second.z).toBeCloseTo(6, 9);
		const pole = edit(o, (d) => turnObject(d, "vp_a", { kind: "poles", i: POLE, j: -1 }, 1));
		expect(pole.objects[POLE]?.heading).toBe(1);
		const gates = edit(o, (d) => turnAll(d, "vp_a", { kind: "timing", i: 0, j: -1 }, Math.PI, 30, 0));
		expect(gates.layouts.vp_a.timing[0].left.z).toBeCloseTo(-4, 9);
		const walls = edit(o, (d) => turnAll(d, "vp_a", { kind: "tyres", i: TYRES, j: -1 }, Math.PI, 0, -10));
		expect(walls.objects[TYRES]?.curve[1]?.p[0]).toBeCloseTo(-1.4, 9);
		expect(walls.objects[TYRES]?.curve[0]?.out[0]).toBeCloseTo(-1.4 / 3, 9);
		const cones = edit(o, (d) => turnAll(d, "vp_a", { kind: "cones", i: CONE, j: -1 }, Math.PI, 40, 0));
		expect(cones.objects[CONE]?.curve[0]?.p[1]).toBeCloseTo(-5, 9);
	});

	it("adds each kind, named; a cone or a board to the layout, the rest to every one", () => {
		let o = someObjects();
		const add = (kind: Parameters<typeof addObject>[2], extra = {}) => {
			let p: ReturnType<typeof addObject> | undefined;
			o = edit(o, (d) => {
				p = addObject(d, "vp_a", kind, 1, 2, 0.5, extra);
			});
			return p;
		};
		expect(add("grid")).toEqual({ kind: "grid", i: 2, j: -1 });
		expect(add("poles")).toEqual({ kind: "poles", i: 6, j: -1 });
		expect(o.objects[6]).toEqual({
			name: "POLE_1",
			model: "light_pole",
			curve: [{ p: [1, 2], in: [0, 0], out: [0, 0] }],
			heading: 0.5,
			collision: "none",
		});
		expect(add("boards")).toEqual({ kind: "boards", i: 7, j: -1 });
		expect(o.objects[7]).toMatchObject({ name: "BOARD_0", collision: "dynamic", layouts: ["vp_a"] });
		add("hotlap");
		expect(o.layouts.vp_a.hotlap).toEqual({ x: 1, z: 2, heading: 0.5 });
		expect(countOf(o, "vp_a", "safety_car")).toBe(0);
		expect(add("safety_car")).toEqual({ kind: "safety_car", i: 0, j: -1 });
		expect(o.layouts.vp_a.safety_car).toEqual({ x: 1, z: 2, heading: 0.5 });
		expect(countOf(o, "vp_a", "safety_car")).toBe(1);
		expect(spotOf(o, "vp_a", { kind: "safety_car", i: 0, j: -1 })).toEqual({ x: 1, z: 2, heading: 0.5 });
		// (taken away: no field left, the build's guess on the pit lane again)
		o = edit(o, (d) => {
			expect(removeObject(d, "vp_a", { kind: "safety_car", i: 0, j: -1 })).toBe(true);
			expect(removeObject(d, "vp_a", { kind: "safety_car", i: 0, j: -1 })).toBe(false);
		});
		expect("safety_car" in o.layouts.vp_a).toBe(false);
		add("timing");
		expect(o.layouts.vp_a.timing[1]).toEqual({ left: { x: -3, z: 2 }, right: { x: 5, z: 2 } });
		add("cones");
		expect(o.objects[8]).toMatchObject({ name: "CONE_1", model: "cone", layouts: ["vp_a"] });
		expect(add("tyres")).toEqual({ kind: "tyres", i: 9, j: 0 });
		expect(o.objects[9]).toMatchObject({
			name: "TYRES_1",
			model: "tyre_stack",
			curve: [{ p: [1, 2], in: [0, 0], out: [0, 0] }],
			spacing: 0.7,
			collision: "static",
		});
		expect(add("trees", { model: "palm_n1" })).toEqual({ kind: "trees", i: 10, j: -1 });
		expect(o.objects[10]).toMatchObject({ name: "PALM_N1_0", model: "palm_n1" });
		// (a node added to the one stack: a wall of them, hit as a wall)
		expect(add("tyres", { within: 9 })).toEqual({ kind: "tyres", i: 9, j: 1 });
		expect(o.objects[9]).toMatchObject({ collision: "wall", closed: false, rows: 1, fit: "place" });
		expect(o.objects[9]?.heading).toBeUndefined();
		expect(add("tyres", { within: TYRES })).toEqual({ kind: "tyres", i: TYRES, j: 2 });
	});

	it("removes, reorders, names, finds the layouts sharing a set and sets an object’s layouts", () => {
		let o = someObjects();
		o = edit(o, (d) => {
			expect(removeObject(d, "vp_a", { kind: "tyres", i: TYRES, j: 0 })).toBe(true);
			expect(removeObject(d, "vp_a", { kind: "hotlap", i: 0, j: -1 })).toBe(true);
			expect(removeObject(d, "vp_a", { kind: "hotlap", i: 0, j: -1 })).toBe(false);
		});
		// (one node left: one stack, a box to hit, facing as its curve went)
		expect(o.objects[TYRES]).toMatchObject({ curve: [{ p: [1.4, -10] }], collision: "static" });
		expect(o.objects[TYRES]?.heading).toBeCloseTo(Math.PI / 2, 9);
		o = edit(o, (d) => {
			expect(removeObject(d, "vp_a", { kind: "tyres", i: TYRES, j: 0 })).toBe(true);
			expect(removeObject(d, "vp_a", { kind: "poles", i: 0, j: -1 })).toBe(true);
		});
		expect(o.objects.map((t) => t.name)).toEqual(["CONE_0", "BOARD_100", "TREE_BROADLEAF_0", "KART_0"]);
		o = edit(o, (d) => {
			expect(reorderObject(d, "vp_a", { kind: "grid", i: 0, j: -1 }, 1)).toEqual({ kind: "grid", i: 1, j: -1 });
			expect(reorderObject(d, "vp_a", { kind: "grid", i: 0, j: -1 }, -1)).toBeNull();
			expect(reorderObject(d, "vp_a", { kind: "hotlap", i: 0, j: -1 }, 1)).toBeNull();
			expect(reorderObject(d, "vp_a", { kind: "cones", i: 0, j: -1 }, 1)).toBeNull();
		});
		expect(o.layouts.vp_a.grid[0].x).toBe(4);
		expect(sharing(o, "vp_a", "pits")).toEqual(["vp_b"]);
		expect(sharing(o, "vp_a", "grid")).toEqual([]);
		expect(sharing(o, "vp_a", "poles")).toEqual([]);
		expect(freeName("P_", ["P_0", "P_2"])).toBe("P_1");
		const it = { ...someObjects().objects[CONE] } as TrackObjects["objects"][number];
		setLayouts(it, ["vp_b"], ["vp_a", "vp_b"]);
		expect([it.layouts, inLayout(it, "vp_a")]).toEqual([["vp_b"], false]);
		setLayouts(it, ["vp_b", "vp_a"], ["vp_a", "vp_b"]);
		expect(it.layouts).toBeUndefined();
	});
});
