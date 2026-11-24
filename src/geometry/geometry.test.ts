import { describe, expect, it } from "vitest";
import { BACK_RAMP } from "../domain/constants";
import type { CurveNode, Kerb, Road } from "../domain/types";
import { road, straightCurve } from "../test/fixtures";
import { bezPoint, splitPiece } from "./bezier";
import { backRampOf, band, continuation, kerbOffsets, kerbPieces, lineOffsets } from "./paint";
import { alongHandles, alongWidth, geo, lookup, sampleAlong } from "./roads";
import { boxesMeet, endsTurned, interpAt, nearestOn, pointAt, sampleCurve, span } from "./samples";
import { roadShapes } from "./shapes";

describe("samples", () => {
	const o = sampleCurve(straightCurve([0, 0], [10, 0], 2));

	it("runs along the curve, its left to the left of the way it goes", () => {
		expect(o.length).toBeCloseTo(10, 9);
		expect(o.X[0]).toBe(0);
		expect(o.X[o.X.length - 1]).toBeCloseTo(10, 9);
		expect(o.nx[3]).toBeCloseTo(0, 9);
		expect(o.nz[3]).toBeCloseTo(1, 9);
		expect(o.nodeAt).toEqual([0, o.X.length - 1]);
		expect(o.box).toEqual({ xmin: -3, xmax: 13, zmin: -3, zmax: 3 });
	});

	it("is read anywhere along it", () => {
		const q = pointAt(o, 2.5);
		expect(q.x).toBeCloseTo(2.5, 6);
		expect([q.l, q.r]).toEqual([2, 2]);
		expect(interpAt(o, -1)).toEqual([0, 0]);
		expect(interpAt(o, 99)[0]).toBe(o.X.length - 1);
		expect(nearestOn(o, 5, 3).d).toBeCloseTo(3, 6);
		expect(span(o, -5, null)).toEqual([0, o.length]);
		expect(span(o, 2, 4)).toEqual([2, 4]);
	});

	it("keeps the inside of a tight curve from folding", () => {
		const tight: CurveNode[] = [
			{ p: [0, 0], in: [0, 0], out: [2, 0], left: 10, right: 10 },
			{ p: [3, 3], in: [0, -2], out: [0, 0], left: 10, right: 10 },
		];
		const t = sampleCurve(tight);
		expect(Math.min(...t.L)).toBeLessThan(10);
		expect(Math.min(...t.R)).toBe(10);
	});

	it("turns its end rows to the ways given", () => {
		const turned = endsTurned({ start_left: [1, 0] }, sampleCurve(straightCurve([0, 0], [10, 0], 2)));
		expect(turned.nx[0]).toBeCloseTo(1, 9);
		expect(turned.nz[turned.nz.length - 1]).toBeCloseTo(1, 9);
	});

	it("knows when boxes meet", () => {
		const a = { xmin: 0, xmax: 1, zmin: 0, zmax: 1 };
		expect(boxesMeet(a, { xmin: 1, xmax: 2, zmin: 0, zmax: 1 })).toBe(true);
		expect(boxesMeet(a, { xmin: 1.1, xmax: 2, zmin: 0, zmax: 1 })).toBe(false);
	});
});

describe("a piece split", () => {
	it("keeps the curve where it was", () => {
		const [a, b]: CurveNode[] = [
			{ p: [0, 0], in: [0, 0], out: [5, 5], left: 1, right: 3 },
			{ p: [10, 0], in: [0, 5], out: [0, 0], left: 3, right: 1 },
		];
		const { node, aOut, bIn } = splitPiece(a, b, 0.3);
		const at = bezPoint(a, b, 0.3);
		expect(node.p[0]).toBeCloseTo(at[0], 12);
		expect(node.p[1]).toBeCloseTo(at[1], 12);
		const first = { ...a, out: aOut };
		const mid = { ...node };
		expect(bezPoint(first, mid, 0.5)[0]).toBeCloseTo(bezPoint(a, b, 0.15)[0], 9);
		expect(bezPoint(mid, { ...b, in: bIn }, 1)).toEqual(b.p);
		expect(node.left).toBeGreaterThan(1);
	});
});

describe("roads", () => {
	const runoff: Road = { name: "R", along: { road: "A", side: "left", from: 10, to: 50 }, width: 3, ease: 5 };
	const roads = [road("A", [0, 0], [100, 0]), runoff];

	it("are found by name", () => {
		const find = lookup(roads);
		expect(find("R")).toBe(runoff);
		expect(find("none")).toBeUndefined();
		expect(lookup(roads)).toBe(find);
	});

	it("keep their samples while their shape stays the same", () => {
		const find = lookup(roads);
		const a = geo(roads[0], find);
		expect(geo({ ...roads[0], lines: [] }, find)).toBe(a);
		expect(geo({ ...roads[0], curve: straightCurve([0, 0], [50, 0]) }, find)).not.toBe(a);
		expect(geo(runoff, find)).toBe(geo(runoff, find));
		expect(geo({ name: "none" }, find)).toBeNull();
	});

	it("lay a run-off on its road edge, eased in at its ends", () => {
		const find = lookup(roads);
		const parent = geo(roads[0], find);
		if (!parent) throw new Error("no samples");
		const o = sampleAlong(runoff, parent);
		expect(o?.Z[0]).toBeCloseTo(4, 6);
		expect(o?.L[0]).toBe(0);
		expect(Math.max(...(o?.L ?? []))).toBeCloseTo(3, 6);
		expect(alongHandles(runoff, find).map((h) => h.kind)).toEqual(["afrom", "ato", "aw"]);
		expect(alongHandles(roads[0], find)).toEqual([]);
	});

	it("give a run-off its width from its profile", () => {
		const r: Road = {
			...runoff,
			profile: [
				[20, 1],
				[40, 3],
			],
		};
		expect(alongWidth(r, 0)).toBe(1);
		expect(alongWidth(r, 30)).toBeCloseTo(2, 9);
		expect(alongWidth(r, 99)).toBe(3);
		expect(alongWidth({ name: "x" }, 0)).toBe(2);
	});
});

describe("paint", () => {
	const find = lookup([road("A", [0, 0], [100, 0]), road("B", [100, 0], [200, 0])]);
	const a = find("A") as Road;
	const o = geo(a, find);
	if (!o) throw new Error("no samples");

	it("puts a line in from the edge", () => {
		const off = lineOffsets({ side: "right", pad: 0.5, w: 0.2 });
		const q = pointAt(o, 10);
		expect(off.a(q)).toBeCloseTo(-3.6, 9);
		expect(off.b(q)).toBeCloseTo(-3.4, 9);
		expect(band(o, 0, 10, off.a, off.b, 5)).toHaveLength(6);
	});

	it("tapers a rumble at its triangle ends", () => {
		const k: Kerb = { side: "left", kind: "ramp", width: 1, start: "triangle", taper: 2 };
		const off = kerbOffsets(k, 0, 10);
		const q = pointAt(o, 1);
		expect(off.a(q)).toBe(4);
		expect(off.m(q, 1)).toBeCloseTo(4.5, 9);
		expect(off.m(q, 5)).toBe(5);
		expect(kerbOffsets({ ...k, kind: "ramp_concrete", back: 0.5 }).b(q, 5)).toBe(5.5);
	});

	it("covers a back ramp behind a rumble ending raised, tapering with it", () => {
		// (a ramp ends 5 cm up: by default its edge straight down (BACK_RAMP, a centimetre); here 0.15 m down to the road behind it, the whole of it narrowed at
		// its tapering end)
		expect(backRampOf({ side: "left", kind: "ramp" })).toBe(BACK_RAMP);
		const k: Kerb = { side: "left", kind: "ramp", width: 1, start: "triangle", taper: 2, back_ramp: 0.15 };
		const q = pointAt(o, 1);
		expect(backRampOf(k)).toBe(0.15);
		expect(kerbOffsets(k, 0, 10).c(q, 5)).toBeCloseTo(5.15, 9);
		expect(kerbOffsets(k, 0, 10).c(q, 1)).toBeCloseTo(4.575, 9);
		expect(kerbOffsets({ ...k, back_ramp: 0.5 }).c(q, 5)).toBeCloseTo(5.5, 9);
		expect(backRampOf({ ...k, back_ramp: 0 })).toBe(0);
		// (those ending at the road's height or under it: none)
		for (const kind of ["floor", "round", "ramp_concrete"] as const) expect(backRampOf({ ...k, kind })).toBe(0);
		expect(backRampOf({ ...k, kind: "concrete", back_ramp: undefined })).toBe(BACK_RAMP);
		expect(kerbOffsets({ ...k, kind: "ramp_concrete", back: 0.5 }).c(q, 5)).toBe(5.5);
	});

	it("carries a rumble on along the next road", () => {
		const k: Kerb = {
			side: "right",
			kind: "ramp",
			from: 90,
			to: null,
			after: { road: "B", side: "right", from: 0, to: 10, outer: "to" },
		};
		const pcs = kerbPieces(a, k, find);
		expect(pcs.map((p) => [p.road.name, p.role, p.s0, p.s1])).toEqual([
			["A", "main", 90, o.length],
			["B", "after", 0, 10],
		]);
		const c = continuation(a, { side: "right", kind: "ramp", from: 80, to: null }, false, 110, -2, [...[a], find("B") as Road], find);
		expect(c).toMatchObject({ road: "B", side: "right", outer: "to" });
	});

	it("draws a road with its lines and rumbles", () => {
		const r: Road = {
			...a,
			lines: [
				{ side: "left", colour: "yellow" },
				{ side: "right", style: "dotted", from: 0, to: 3 },
			],
			kerbs: [{ side: "left", kind: "ramp_concrete", from: 0, to: 4 }],
		};
		const sh = roadShapes(r, find);
		expect(sh?.yellow).toHaveLength(1);
		expect(sh?.white).toHaveLength(3);
		expect([...(sh?.kerbs.keys() ?? [])]).toEqual(["#d23a3a", "#f2f2f2", "#3f6fc0"]);
		expect(sh?.sides).toHaveLength(4);
		expect(roadShapes(r, find)).toBe(sh);
	});
});
