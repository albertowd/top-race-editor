// @vitest-environment node
// The marks and the start lines painted on a made-up road: a layout's start line along its start and finish gate (else across the road its grid is on, just
// ahead of its first slot), chequered or a single solid line.
import { describe, expect, it } from "vitest";
import { paintChains, straightThrough } from "../editing/marks";
import { cleanObjects, ObjectsError, withCurvedMarks } from "./objectsfile";
import {
	CHECKER,
	CHECKER_IN,
	CHECKER_ROWS,
	edgeLine,
	kerbsToDrive,
	LINE_LIFT,
	LINE_W,
	layPaint,
	MARK_STEP,
	markPaint,
	type Roads,
	START_AHEAD,
	START_GATE,
	START_LINE_W,
	startLineAt,
	startLinePaint,
} from "./paint";
import type { RoadDesc } from "./roads";
import { surfaceOf } from "./roadshost";

/** the area of a mesh's faces, seen from above */
const areaOf = (m: { P: Float64Array; F: Int32Array } | undefined) => {
	let a = 0;
	const P = m?.P ?? new Float64Array();
	const F = m?.F ?? new Int32Array();
	for (let f = 0; f < F.length; f += 3) {
		const [i, j, k] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
		a +=
			((P[j * 3 + 2] as number) - (P[i * 3 + 2] as number)) * ((P[k * 3] as number) - (P[i * 3] as number)) -
			((P[j * 3] as number) - (P[i * 3] as number)) * ((P[k * 3 + 2] as number) - (P[i * 3 + 2] as number));
	}
	return a / 2;
};
const straight = (a: [number, number], b: [number, number]) => [
	{ p: a, in: [0, 0] as [number, number], out: [(b[0] - a[0]) / 3, (b[1] - a[1]) / 3] as [number, number] },
	{ p: b, in: [(a[0] - b[0]) / 3, (a[1] - b[1]) / 3] as [number, number], out: [0, 0] as [number, number] },
];

describe("the marks and the start lines painted", () => {
	// (a straight road along +x, 4 m each side of its middle, the floor level at 1 m)
	const road = {
		name: "S",
		curve: [
			{
				p: [0, 0] as [number, number],
				in: [0, 0] as [number, number],
				out: [10, 0] as [number, number],
				left: 4,
				right: 4,
			},
			{
				p: [40, 0] as [number, number],
				in: [-10, 0] as [number, number],
				out: [0, 0] as [number, number],
				left: 4,
				right: 4,
			},
		],
	};
	const onRoad = (_x: number, z: number) => Math.abs(z) < 4;
	const floor = () => 1;

	it("paints a mark only where there is road under it, LINE_LIFT over the floor, its faces up; dotted, in its dashes", async () => {
		// (across the road from z -6 to 6: its 2 m off the road's edge each side not painted)
		const [m] = await markPaint([{ name: "M", curve: straight([20, -6], [20, 6]), width: 0.1 }], onRoad, floor);
		expect(m?.name).toBe("M");
		const zs = new Set<number>();
		for (let f = 0; f < (m?.F.length ?? 0); f++) zs.add(m?.P[(m.F[f] as number) * 3 + 2] as number);
		expect(Math.min(...zs)).toBeGreaterThanOrEqual(-4 - 1e-9);
		expect(Math.max(...zs)).toBeLessThanOrEqual(4 + 1e-9);
		expect(areaOf(m)).toBeCloseTo(8 * 0.1, 6);
		expect([...(m?.P ?? [])].filter((_, i) => i % 3 === 1).every((y) => Math.abs(y - (1 + LINE_LIFT)) < 1e-12)).toBe(true);
		// (no piece longer than a cell: each on the floor under it)
		const P = m?.P as Float64Array;
		const F = m?.F as Int32Array;
		for (let f = 0; f < F.length; f += 3) {
			const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
			const up =
				((P[b * 3 + 2] as number) - (P[a * 3 + 2] as number)) * ((P[c * 3] as number) - (P[a * 3] as number)) -
				((P[b * 3] as number) - (P[a * 3] as number)) * ((P[c * 3 + 2] as number) - (P[a * 3 + 2] as number));
			expect(up).toBeGreaterThan(0);
			for (const [i, j] of [
				[a, b],
				[b, c],
			] as const)
				expect(Math.hypot((P[i * 3] as number) - (P[j * 3] as number), (P[i * 3 + 2] as number) - (P[j * 3 + 2] as number))).toBeLessThanOrEqual(
					MARK_STEP * Math.SQRT2 + 1e-9,
				);
		}
		// (dotted: 1 m dashes, 1 m gaps, along the road from x 5: five dashes over 9 m; an older file's mark, from p)
		const [d] = await markPaint([{ p: [5, 0], heading: Math.PI / 2, length: 9, style: "dotted", dash: 1, gap: 1 }], onRoad, floor);
		expect(d?.name).toBe("MARK_1");
		expect(areaOf(d)).toBeCloseTo(5 * 1 * LINE_W, 6);
	});

	it("paints marks of one paint that meet as one, their corners mitred, painted once where they overlap", async () => {
		// (an L of two marks meeting at (10, 0), 0.2 m wide: the corner's square whole, once)
		const L = await markPaint(
			[
				{ name: "A", curve: straight([6, 0], [10, 0]), width: 0.2 },
				{ name: "B", curve: straight([10, 0], [10, 3]), width: 0.2 },
			],
			onRoad,
			floor,
		);
		expect(L.map((m) => m.name)).toEqual(["A"]);
		expect(areaOf(L[0])).toBeCloseTo(4 * 0.2 + 3 * 0.2, 6);
		// (two overlapping halfway: as much paint as one 6 m long)
		const over = await markPaint(
			[
				{ name: "C", curve: straight([0, 1], [4, 1]) },
				{ name: "D", curve: straight([2, 1], [6, 1]) },
			],
			onRoad,
			floor,
		);
		expect(over.map((m) => m.name)).toEqual(["C"]);
		expect(areaOf(over[0])).toBeCloseTo(6 * LINE_W, 6);
		// (a later yellow over a white: the white cut away under it; apart, each its own)
		const two = await markPaint(
			[
				{ name: "W", curve: straight([0, -1], [4, -1]), width: 0.1 },
				{ name: "Y", curve: straight([2, -2], [2, 0]), width: 0.1, colour: "yellow" },
				{ name: "W2", curve: straight([30, -1], [34, -1]), width: 0.1 },
			],
			onRoad,
			floor,
		);
		expect(two.map((m) => [m.name, m.colour])).toEqual([
			["W", "white"],
			["Y", "yellow"],
			["W2", "white"],
		]);
		expect(areaOf(two[0])).toBeCloseTo(4 * 0.1 - 0.1 * 0.1, 6);
		expect(areaOf(two[1])).toBeCloseTo(2 * 0.1, 6);
		// (a box of four marks: one ring, its hole not painted)
		const box = await markPaint(
			[
				{ name: "S1", curve: straight([0, 0], [2, 0]) },
				{ name: "S2", curve: straight([2, 0], [2, 2]) },
				{ name: "S3", curve: straight([2, 2], [0, 2]) },
				{ name: "S4", curve: straight([0, 2], [0, 0]) },
			],
			onRoad,
			floor,
		);
		expect(box).toHaveLength(1);
		expect(areaOf(box[0])).toBeCloseTo((2 + LINE_W) ** 2 - (2 - LINE_W) ** 2, 6);
	});

	// (a grid facing +x along it, its first slot at x 18; another road beside it, apart)
	const grid = [
		{ x: 18, z: 1, heading: Math.PI / 2 },
		{ x: 15, z: -1, heading: Math.PI / 2 },
	];
	const beside = {
		...road,
		name: "T",
		curve: road.curve.map((n) => ({ ...n, p: [n.p[0], 30] as [number, number] })),
	};
	const roads = { S: road, T: beside };
	const extent = (P: Float64Array) => {
		const xs = [...P].filter((_, i) => i % 3 === 0);
		const zs = [...P].filter((_, i) => i % 3 === 2);
		return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
	};

	it("paints a layout’s chequered start line across the road just ahead of its grid, square to it", () => {
		const [s, ...more] = startLinePaint({ vp_a: { grid, start_line: "checker" } }, roads, floor);
		expect(more).toHaveLength(0);
		expect(s?.name).toBe("START_VP_A");
		const e = extent(s?.P as Float64Array);
		// (its front START_AHEAD in front of the first slot, its rows back towards the grid)
		expect(e.x1).toBeCloseTo(18 + START_AHEAD, 9);
		expect(e.x0).toBeCloseTo(18 + START_AHEAD - CHECKER * CHECKER_ROWS, 9);
		// (across from 0.3 in from each edge, whole squares, the road's middle in the middle)
		const n = Math.floor((8 - 2 * CHECKER_IN) / CHECKER);
		expect(e.z1 - e.z0).toBeCloseTo(n * CHECKER, 9);
		expect(e.z1 + e.z0).toBeCloseTo(0, 9);
		// (white and the road by turns: half the squares, two triangles each; on the floor)
		expect((s?.F.length ?? 0) / 6).toBe(Math.ceil((n * CHECKER_ROWS) / 2));
		expect(s?.P[1]).toBeCloseTo(1 + LINE_LIFT, 9);
	});

	it("paints a single solid white line instead, as wide as START_LINE_W; none where a layout has none", () => {
		const [s] = startLinePaint({ vp_a: { grid, start_line: "line" }, vp_b: { grid } }, roads, floor);
		expect(s?.name).toBe("START_VP_A");
		const e = extent(s?.P as Float64Array);
		expect(e.x1).toBeCloseTo(18 + START_AHEAD, 9);
		expect(e.x0).toBeCloseTo(18 + START_AHEAD - START_LINE_W, 9);
		expect(e.z1 - e.z0).toBeCloseTo(8 - 2 * CHECKER_IN, 9);
		// (one strip across, in pieces of MARK_STEP)
		expect((s?.F.length ?? 0) / 6).toBe(Math.ceil((8 - 2 * CHECKER_IN) / MARK_STEP));
		expect(startLinePaint({ vp_b: { grid } }, roads, floor)).toHaveLength(0);
	});

	it("finds the grid’s road by its outline, and the way it faces; none off every road", () => {
		// (the grid on the road beside, facing -x: the line on that road, ahead of it the other way)
		const there = grid.map((g) => ({ x: 40 - g.x, z: 30 + g.z, heading: -Math.PI / 2 }));
		const at = startLineAt(there[0] as (typeof there)[0], roads);
		expect(at?.road).toBe("T");
		expect(at?.a[0]).toBeCloseTo(22 - START_AHEAD, 9);
		expect(at?.back[0]).toBeCloseTo(1, 9);
		expect(Math.abs(at?.u[1] ?? 0)).toBeCloseTo(1, 9);
		const [s] = startLinePaint({ vp_a: { grid: there, start_line: "line" } }, roads, floor);
		const e = extent(s?.P as Float64Array);
		expect(e.x0).toBeCloseTo(22 - START_AHEAD, 9);
		expect(e.z0).toBeGreaterThan(26);
		expect(startLineAt({ x: 18, z: 15, heading: 0 }, roads)).toBeNull();
	});

	it("is painted along the layout’s start and finish gate, between its posts, on the road only", () => {
		// (the gate across S at x 20, its posts 2 m off the road each side, a little askew; the grid facing +x)
		const timing = [
			{ name: "AC_TIME_1", left: { x: 30, z: -6 }, right: { x: 30, z: 6 } },
			{ name: START_GATE, left: { x: 20, z: -6 }, right: { x: 21, z: 6 } },
		];
		const [s] = startLinePaint({ vp_a: { grid, timing, start_line: "checker" } }, roads, floor);
		const e = extent(s?.P as Float64Array);
		// (on the road between the posts: from CHECKER_IN in from its edges, square to the gate, not to the road)
		expect(e.z0).toBeGreaterThanOrEqual(-4 + CHECKER_IN - 1e-9);
		expect(e.z1).toBeLessThanOrEqual(4 - CHECKER_IN + 1e-9);
		expect(e.z1 - e.z0).toBeGreaterThan(8 - 2 * CHECKER_IN - CHECKER - 0.1);
		// (its rows behind the gate, the way the grid's karts come from: towards -x; its front on the gate)
		const front = (z: number) => 20 + (z + 6) / 12;
		const P = s?.P as Float64Array;
		for (let i = 0; i < P.length; i += 3) {
			const x = P[i] as number;
			const z = P[i + 2] as number;
			expect(x).toBeLessThanOrEqual(front(z) + 1e-9);
			expect(x).toBeGreaterThanOrEqual(front(z) - CHECKER * CHECKER_ROWS - 0.05);
		}
		// (a gate across no road: nothing; without the start gate: ahead of the grid as before)
		const off = [{ name: START_GATE, left: { x: 20, z: 10 }, right: { x: 21, z: 20 } }];
		expect(startLinePaint({ vp_a: { grid, timing: off, start_line: "line" } }, roads, floor)).toHaveLength(0);
		const [g] = startLinePaint({ vp_a: { grid, timing: [timing[0]] as never, start_line: "line" } }, roads, floor);
		expect(extent(g?.P as Float64Array).x1).toBeCloseTo(18 + START_AHEAD, 9);
	});

	it("crosses every road where they meet (a merge: the grid on the narrower), stopping where the road does", () => {
		// (a lane 2 m wide overlapping S's left edge, its middle at z 4.5: the road 4 + 5.5 m wide there, from -4 to 5.5)
		const lane = {
			...road,
			name: "U",
			curve: road.curve.map((n) => ({ ...n, p: [n.p[0], 4.5] as [number, number], left: 1, right: 1 })),
		};
		const merge = { S: road, T: beside, U: lane };
		const onLane = [{ x: 18, z: 4.8, heading: Math.PI / 2 }];
		expect(startLineAt(onLane[0] as (typeof onLane)[0], merge)?.road).toBe("U");
		const [s] = startLinePaint({ vp_a: { grid: onLane, start_line: "line" } }, merge, floor);
		const e = extent(s?.P as Float64Array);
		// (from CHECKER_IN in from S's far edge to as far in from the lane's: not the lane's 2 m alone; not to T, apart)
		expect(e.z0).toBeCloseTo(-4 + CHECKER_IN, 9);
		expect(e.z1).toBeCloseTo(5.5 - CHECKER_IN, 9);
	});
});

describe("a layout’s start line", () => {
	it("is kept as the objects are written: chequered or a line, none left out; another refused", () => {
		const lay = (start_line?: unknown) => ({ grid: [], pits: [], hotlap: null, timing: [], start_line });
		const out = cleanObjects({
			version: 3,
			layouts: { a: lay("checker"), b: lay("line"), c: lay() },
			objects: [],
			marks: [],
		}) as { layouts: Record<string, { start_line?: string }> };
		expect(out.layouts.a?.start_line).toBe("checker");
		expect(out.layouts.b?.start_line).toBe("line");
		expect("start_line" in (out.layouts.c ?? {})).toBe(false);
		expect(() => cleanObjects({ version: 3, layouts: { a: lay("dots") }, objects: [], marks: [] })).toThrow(ObjectsError);
	});
});

describe("a paint mark as the objects are written", () => {
	const plainOf = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (x && typeof x === "object" && "value" in x ? x.value : x)));

	it("is written as its curve; one of an older file (from p, along its heading) read as a straight one", () => {
		const old = {
			name: "OLD",
			p: [1, 2],
			heading: Math.PI / 2,
			length: 3,
			width: 0.1,
			colour: "white",
			style: "solid",
		};
		const out = plainOf(cleanObjects({ version: 3, layouts: {}, objects: [], marks: [old] })) as {
			marks: { name: string; curve: { p: number[]; in: number[]; out: number[] }[]; p?: unknown }[];
		};
		const [m] = out.marks;
		expect(m?.name).toBe("OLD");
		expect(m && "p" in m).toBe(false);
		expect(m?.curve.map((n) => n.p)).toEqual([
			[1, 2],
			[4, 2],
		]);
		expect(m?.curve[0]?.out).toEqual([1, 0]);
		// (the page given it as a curve when the file is read; one already a curve as it is)
		const curved = {
			name: "NEW",
			curve: [
				{ p: [0, 0], in: [0, 0], out: [1, 0] },
				{ p: [3, 0], in: [-1, 0], out: [0, 0] },
			],
			closed: false,
			width: 0.1,
			colour: "white",
			style: "solid",
		};
		const read = withCurvedMarks({ version: 3, layouts: {}, objects: [], marks: [old, curved] }) as {
			marks: unknown[];
		};
		expect(plainOf(read.marks[0])).toMatchObject({ name: "OLD", curve: [{ p: [1, 2] }, { p: [4, 2] }] });
		expect(read.marks[1]).toBe(curved);
		// (a ring kept closed; a mark of one node refused)
		const ring = plainOf(
			cleanObjects({
				version: 3,
				layouts: {},
				objects: [],
				marks: [{ ...curved, curve: [...curved.curve, { p: [3, 3], in: [0, 0], out: [0, 0] }], closed: true }],
			}),
		) as { marks: { closed?: boolean }[] };
		expect(ring.marks[0]?.closed).toBe(true);
		expect(() => cleanObjects({ version: 3, layouts: {}, objects: [], marks: [{ ...curved, curve: [curved.curve[0]] }] })).toThrow(ObjectsError);
	});
});

describe("the edge lines painted with the marks", () => {
	type P2 = [number, number];
	const node = (p: P2, inn: P2, out: P2) => ({ p, in: inn, out, left: 4, right: 4 });
	// (an oval of two roads, each joining the other's end smoothly: A up its right, B back down its left)
	const roads: Roads = {
		A: {
			name: "A",
			curve: [node([0, 0], [0, 0], [22, 0]), node([0, 40], [22, 0], [0, 0])],
			lines: [
				{ name: "A_IN", side: "left" },
				{ name: "A_OUT", side: "right" },
			],
		},
		B: {
			name: "B",
			curve: [node([0, 40], [0, 0], [-22, 0]), node([0, 0], [-22, 0], [0, 0])],
			lines: [
				{ name: "B_IN", side: "left" },
				{ name: "B_OUT", side: "right", colour: "yellow" },
			],
		},
	};
	// (the floor: level at 2, wide enough for all of it)
	const floor = surfaceOf({
		P: Float64Array.from([-60, 2, -40, 60, 2, -40, 60, 2, 80, -60, 2, 80]),
		F: Int32Array.from([0, 2, 1, 0, 3, 2]),
	});

	it("joins a road’s line and the next road’s whose ends meet into one, round to a ring where they close", async () => {
		const lines = [...(roads.A?.lines ?? []), ...(roads.B?.lines ?? [])].map((l, i) => edgeLine((i < 2 ? roads.A : roads.B) as RoadDesc, l));
		const chains = paintChains(lines.filter((l) => l !== null));
		// (the two inner lines: one ring; the outer ones of two colours, apart)
		expect(chains.map((c) => [c.marks, c.closed])).toEqual([
			[[0, 2], true],
			[[1], false],
			[[3], false],
		]);
		const paint = await layPaint(roads, floor, [{ name: "M", curve: straight([-1, 20], [1, 20]), width: 0.1, colour: "yellow" }]);
		expect(paint.map((p) => [p.name, p.colour])).toEqual([
			["A_IN", "white"],
			["A_OUT", "white"],
			["B_OUT", "yellow"],
			["M", "yellow"],
		]);
		// (the ring as much paint as its middle's length, as wide as a line: no ends, no overlap; on the floor)
		const ring = chains[0] as (typeof chains)[0];
		let around = 0;
		ring.points.forEach((q, k) => {
			const n = ring.points[(k + 1) % ring.points.length] as P2;
			around += Math.hypot(n[0] - q[0], n[1] - q[1]);
		});
		expect(areaOf(paint[0])).toBeCloseTo(around * LINE_W, 3);
		expect(paint[0]?.P[1]).toBeCloseTo(2 + LINE_LIFT, 9);
	});
});

describe("paint of two kinds meeting end to end", () => {
	it("is painted each its side of a mitred seam: no gap, no overlap", async () => {
		const onRoad = () => true;
		const level = () => 0;
		const paint = await markPaint(
			[
				{ name: "W", curve: straight([6, 0], [10, 0]), width: 0.1 },
				{ name: "Y", curve: straight([10, 0], [10, 3]), width: 0.1, colour: "yellow" },
			],
			onRoad,
			level,
		);
		expect(paint.map((p) => p.name)).toEqual(["W", "Y"]);
		expect(areaOf(paint[0])).toBeCloseTo(4 * 0.1, 6);
		expect(areaOf(paint[1])).toBeCloseTo(3 * 0.1, 6);
		// (a U of yellow whose end goes straight on into a white line: its seam across there cuts off none of the U's other arm, though that runs on past the
		// seam's line)
		const u = await markPaint(
			[
				{
					name: "U",
					curve: straightThrough([
						[0, -5],
						[0, 10],
						[2, 10],
						[2, 0],
					]),
					width: 0.1,
					colour: "yellow",
				},
				{ name: "W", curve: straight([2, 0], [2, -5]), width: 0.1 },
			],
			onRoad,
			level,
		);
		expect(u.map((p) => p.name)).toEqual(["U", "W"]);
		expect(areaOf(u[0])).toBeCloseTo((15 + 2 + 10) * 0.1, 6);
		expect(areaOf(u[1])).toBeCloseTo(5 * 0.1, 6);
	});
});

describe("the rumbles a car may drive over", () => {
	// (a straight along +x, 4 m each side; a rumble on its left of each kind, from 10 to 30)
	const road = (kind: string): Roads => ({
		S: {
			name: "S",
			curve: [
				{ p: [0, 0], in: [0, 0], out: [10, 0], left: 4, right: 4 },
				{ p: [40, 0], in: [-10, 0], out: [0, 0], left: 4, right: 4 },
			],
			kerbs: [{ side: "left", from: 10, to: 30, kind, width: 0.6, back: 0.75 }],
		},
	});
	// (across it from its inner edge (the road's left: whichever side of +x that is), at x 20)
	const across = (kind: string) => {
		const on = kerbsToDrive(road(kind));
		return (d: number) => on(20, 4 + d) || on(20, -(4 + d));
	};

	it("takes a ramp’s whole width, a ramp + concrete’s ramp but not its concrete, a concrete one none", () => {
		const ramp = across("ramp");
		expect(ramp(0.1)).toBe(true);
		expect(ramp(0.5)).toBe(true);
		expect(ramp(0.9)).toBe(false);
		const both = across("ramp_concrete");
		expect(both(0.3)).toBe(true);
		expect(both(0.9)).toBe(false);
		const concrete = across("concrete");
		expect(concrete(0.1)).toBe(false);
		expect(concrete(0.4)).toBe(false);
	});
});
