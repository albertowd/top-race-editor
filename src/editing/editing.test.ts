import { produce } from "immer";
import { describe, expect, it } from "vitest";
import type { Road } from "../domain/types";
import { geo, lookup } from "../geometry/roads";
import { road, threeRoads } from "../test/fixtures";
import { addNode, addProfilePoint, autoHandles, newRoad, reverseRoad, setHandleLength, snapEnds } from "./curves";
import { endHandles, nodeHandles } from "./handles";
import { hitTest, itemAt } from "./hit";
import { endOf, joinNearest, renameInJoints, touch, travelAt, unjoin } from "./joints";
import { snapPoint } from "./snap";

const nodeOf = (r: Road, i: number) => {
	const n = r.curve?.[i];
	if (!n) throw new Error(`no node ${i}`);
	return n;
};

const samples = (r: Road, roads: Road[] = [r]) => {
	const o = geo(r, lookup(roads));
	if (!o) throw new Error("no samples");
	return o;
};

describe("joints", () => {
	it("bind two ends: one point, straight on, as wide, both moved", () => {
		const roads = produce(threeRoads(), (d) => {
			nodeOf(d[1], 0).p = [101, 1];
			const res = joinNearest(d, d[1], 0);
			expect(res).toEqual({ ok: true, other: "A", otherEnd: "end", moved: Math.hypot(1, 1) });
		});
		const [a, b] = roads;
		expect(b.curve?.[0].p).toEqual([100, 0]);
		expect(a.curve?.[1].joint).toEqual({ road: "B", node: "start" });
		expect(b.curve?.[0].joint).toEqual({ road: "A", node: "end" });
		expect([a.moved, b.moved]).toEqual([true, true]);
		expect(a.end_left).toEqual([-0, 1]);
		expect(b.start_left).toEqual([-0, 1]);
	});

	it("refuse a node between, or an end far from any other", () => {
		produce(threeRoads(), (d) => {
			d[0].curve?.splice(1, 0, { p: [50, 0], in: [-1, 0], out: [1, 0], left: 4, right: 4 });
			expect(joinNearest(d, d[0], 1).ok).toBe(false);
			nodeOf(d[2], 0).p = [50, -500];
			expect(joinNearest(d, d[2], 0)).toMatchObject({ ok: false });
		});
	});

	it("follow when a joined road moves, and come apart", () => {
		const joined = produce(threeRoads(), (d) => {
			joinNearest(d, d[1], 0);
		});
		const moved = produce(joined, (d) => {
			nodeOf(d[0], 1).p = [105, 5];
			touch(d, d[0]);
		});
		expect(moved[1].curve?.[0].p).toEqual([105, 5]);
		expect(moved[1].moved).toBe(true);
		const apart = produce(moved, (d) => unjoin(d, d[0], 1));
		expect(apart[0].curve?.[1].joint).toBeUndefined();
		expect(apart[1].curve?.[0].joint).toBeUndefined();
	});

	it("name their roads again when one is renamed", () => {
		const roads = produce(threeRoads(), (d) => {
			joinNearest(d, d[1], 0);
			renameInJoints(d, "A", "A2");
		});
		expect(roads[1].curve?.[0].joint?.road).toBe("A2");
	});

	it("know the ends and the way there", () => {
		const r = road("A", [0, 0], [10, 0]);
		expect([endOf(r, 0), endOf(r, 1), endOf({ name: "x" }, 0)]).toEqual(["start", "end", null]);
		const [tx, tz] = travelAt(r, 1);
		expect([tx, Math.abs(tz)]).toEqual([1, 0]);
		const flat = {
			...r,
			curve: r.curve?.map((n) => ({ ...n, in: [0, 0] as [number, number], out: [0, 0] as [number, number] })),
		};
		expect(travelAt(flat, 0)).toEqual([1, 0]);
	});
});

describe("curves", () => {
	it("get a node: on the road (split), or past its end (longer)", () => {
		const r = road("A", [0, 0], [100, 0]);
		const o = samples(r);
		const split = produce(r, (d) => {
			expect(addNode(d, o, 30, 1)).toMatchObject({ ok: true, n: 1 });
		});
		expect(split.curve).toHaveLength(3);
		expect(split.curve?.[1].p[0]).toBeCloseTo(30, 0);
		const longer = produce(r, (d) => {
			expect(addNode(d, o, 120, 0)).toEqual({ ok: true, n: 2 });
			expect(addNode(d, o, -20, 0)).toEqual({ ok: true, n: 0 });
		});
		expect(longer.curve?.map((n) => n.p[0])).toEqual([-20, 0, 100, 120]);
		const joined = {
			...r,
			curve: r.curve?.map((n, i) => (i ? { ...n, joint: { road: "B", node: "start" as const } } : n)),
		};
		produce(joined, (d) => {
			expect(addNode(d, o, 120, 0)).toMatchObject({ ok: false });
		});
	});

	it("turn round, their lines and rumbles with them", () => {
		const r: Road = {
			...road("A", [0, 0], [100, 0]),
			start_left: [0, 1],
			lines: [{ side: "left", from: 10, to: null }],
			kerbs: [{ side: "right", kind: "ramp", from: 0, to: 30 }],
		};
		const back = produce([r], (d) => reverseRoad(d, d[0], 100))[0];
		expect(back.curve?.[0].p).toEqual([100, 0]);
		expect(back.end_left).toEqual([-0, -1]);
		expect(back.start_left).toBeUndefined();
		expect(back.lines?.[0]).toEqual({ side: "right", from: 0, to: 90 });
		expect(back.kerbs?.[0]).toMatchObject({ side: "left", from: 70, to: null });
	});

	it("smooth their handles", () => {
		const r = newRoad("N", [
			[0, 0],
			[10, 10],
			[20, 0],
		]);
		expect(r.curve?.[1].in[1]).toBeCloseTo(0, 9);
		expect(r.curve?.[1].out[0]).toBeCloseTo(Math.hypot(10, 10) / 3, 9);
		const one = produce(r, (d) => {
			if (d.curve) d.curve[1].corner = true;
			autoHandles(d, 1);
		});
		expect(one.curve?.[1].corner).toBeUndefined();
		expect(setHandleLength([3, 4], 10)).toEqual([6, 8]);
	});

	it("put a branch on the roads it joins", () => {
		const main = road("M", [0, 0], [100, 0], { curve: undefined });
		const m = { ...main, curve: road("M", [0, 0], [100, 0]).curve };
		const branch = road("X", [20, 5], [60, 20], { joins: ["M", null] });
		const out = produce(branch, (d) => snapEnds(d, (n) => (n === "M" ? samples(m) : null)));
		expect(out.curve?.[0].p[0]).toBeCloseTo(20, 1);
		expect(out.curve?.[0].p[1]).toBeCloseTo(0, 6);
		expect(out.curve?.[0].left).toBe(4);
		expect(out.curve?.[1].p).toEqual([60, 20]);
	});

	it("give a run-off more width points", () => {
		const r: Road = { name: "R", along: { road: "A", side: "left", from: 10, to: 50 }, width: 2 };
		const out = produce(r, (d) => {
			expect(addProfilePoint(d, 20)).toBe(0);
			expect(addProfilePoint(d, 60)).toBe(-1);
		});
		expect(out.profile).toEqual([
			[20, 2],
			[30, 2],
		]);
	});
});

describe("the mouse on the map", () => {
	const roads = threeRoads();
	roads[0] = {
		...roads[0],
		lines: [{ side: "left", from: 0, to: null }],
		kerbs: [{ side: "right", kind: "ramp", from: 10, to: 20 }],
	};
	const find = lookup(roads);
	const ctx = {
		roads,
		find,
		sel: { r: 0, n: -1, line: 0, kerb: -1 },
		layers: { lines: true, kerbs: true },
		ppm: 10,
		toScreen: (x: number, z: number): [number, number] => [-x * 10, -z * 10],
	};

	it("snaps to ends first, then middles and edges", () => {
		expect(snapPoint(roads, find, 100.5, 0.5, "C", 2)?.label).toBe("A's end");
		expect(snapPoint(roads, find, 30, 3.9, null, 0.5)?.label).toBe("A's left edge, s 30.0");
		expect(snapPoint(roads, find, 30, 20, null, 0.5)).toBeNull();
	});

	it("finds the handles of the selected road and its line", () => {
		expect(nodeHandles(roads[0], find).map((h) => h.kind)).toEqual(["p", "out", "wl", "wr", "p", "in", "wl", "wr"]);
		expect(endHandles(roads[0], ctx.sel, find).map((h) => h.kind)).toEqual(["lfrom", "lto"]);
		expect(endHandles(roads[0], { ...ctx.sel, line: -1, kerb: 0 }, find).map((h) => h.kind)).toEqual(["kfrom", "kto"]);
	});

	it("hits handles, lines, rumbles and roads", () => {
		const hit = (x: number, z: number) => hitTest(ctx, -x * 10, -z * 10, x, z);
		expect(hit(0, 0)).toMatchObject({ kind: "p", n: 0, road: 0 });
		expect(hit(30, 3.8)).toMatchObject({ kind: "item", which: "line", road: 0, idx: 0 });
		expect(itemAt(ctx, 15, -4.5)).toMatchObject({ which: "kerb", idx: 0 });
		expect(hit(70, 1)).toMatchObject({ kind: "road", road: 0 });
		expect(hit(50, 30)).toMatchObject({ kind: "road", road: 2 });
		expect(hit(300, 300)).toBeNull();
		expect(itemAt({ ...ctx, layers: { lines: false, kerbs: false } }, 30, 3.8)).toBeNull();
	});
});
