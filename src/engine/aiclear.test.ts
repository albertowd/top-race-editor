// @vitest-environment node
// A line kept clear of its road's edges (aiclear.ts): moved off an edge it was drawn on, to a narrow road's middle, left where it is clear, a corner drawn in
// it rounded, a pit lane's ends left on the fast line.
import { describe, expect, it } from "vitest";
import { CLEAR, followFast, keepClear } from "./aiclear";

type V2 = [number, number];
/** points every half metre up +z at x, from z0 to z1 */
const straight = (x: number, z0: number, z1: number): V2[] => Array.from({ length: Math.round((z1 - z0) / 0.5) + 1 }, (_, i) => [x, z0 + i * 0.5]);

describe("a line kept clear of its road’s edges", () => {
	it("is moved off an edge it was drawn on, CLEAR of it", () => {
		// (a road from x 0 to 8, the line drawn 0.4 m in from its edge at x 0; the road read every 10 cm)
		const out = keepClear(straight(0.4, 0, 100), false, (x) => x >= 0 && x <= 8);
		const mid = out[100] as V2;
		expect(mid[0]).toBeGreaterThanOrEqual(CLEAR - 0.06);
		expect(mid[0]).toBeLessThan(CLEAR + 0.2);
		expect(mid[1]).toBeCloseTo(50, 1);
	});

	it("bends off an edge’s step smoothly, round no tighter than a gentle bend", () => {
		// (a road from x 0, its edge out to x 1 for 10 m: the line at x 1.5 moved to x 2 there, and eased in and out)
		const P = straight(1.5, 0, 100);
		const out = keepClear(P, false, (x, z) => x >= (z > 45 && z < 55 ? 1 : 0) && x <= 20);
		expect((out[100] as V2)[0]).toBeGreaterThanOrEqual(2 - 0.06);
		let tightest = Infinity;
		for (let i = 4; i < out.length - 4; i++) {
			const [a, p, b] = [out[i - 4], out[i], out[i + 4]] as [V2, V2, V2];
			const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
			if (Math.abs(cross) < 1e-9) continue;
			const r = (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(p[0] - a[0], p[1] - a[1]) * Math.hypot(b[0] - p[0], b[1] - p[1])) / (2 * Math.abs(cross));
			tightest = Math.min(tightest, r);
		}
		expect(tightest).toBeGreaterThan(30);
	});

	it("keeps half a wider car’s width and a little off an edge", () => {
		// (a car 2 m wide: 1.3 m off the edge, not a kart's 1)
		const out = keepClear(straight(0.4, 0, 100), false, (x) => x >= 0 && x <= 8, { margin: 2 / 2 + 0.3 });
		expect((out[100] as V2)[0]).toBeGreaterThanOrEqual(1.3 - 0.06);
		expect((out[100] as V2)[0]).toBeLessThan(1.5);
	});

	it("is left where it is clear", () => {
		const P = straight(4, 0, 50);
		const out = keepClear(P, false, (x) => x >= 0 && x <= 8);
		for (let i = 0; i < P.length; i++) expect((out[i] as V2)[0]).toBeCloseTo(4, 3);
	});

	it("keeps to the middle of a road too narrow for CLEAR either side", () => {
		const out = keepClear(straight(0.2, 0, 50), false, (x) => x >= 0 && x <= 1.5);
		expect(Math.abs((out[50] as V2)[0] - 0.75)).toBeLessThan(0.1);
	});

	it("takes the corner out of a line drawn with one", () => {
		// (up +z to z 50, then off along +x: a right angle, on a wide road)
		const P: V2[] = [...straight(0, 0, 50), ...Array.from({ length: 100 }, (_, i): V2 => [(i + 1) * 0.5, 50])];
		const out = keepClear(P, false, () => true);
		const k = 100;
		const a = out[k - 4] as V2;
		const b = out[k] as V2;
		const c = out[k + 4] as V2;
		// (the turn at the corner spread out: less than the right angle over its 4 m)
		const turn = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]));
		expect(turn).toBeLessThan(Math.PI / 3);
	});

	it("leaves its pinned ends where they are, and goes no further than side from where it was drawn", () => {
		const P = straight(0.2, 0, 50);
		const out = keepClear(P, false, (x) => x >= -10 && x <= 0.5, { pinned: [10, 10], side: 0.5 });
		expect(out[5]).toEqual(P[5]);
		expect(out.at(-3)).toEqual(P.at(-3));
		expect((out[50] as V2)[0]).toBeGreaterThan(-0.31);
	});

	it("moves a pit lane with the fast line where it runs on it, less the further off", () => {
		const F0 = straight(0, -50, 50);
		const F1 = F0.map((p): V2 => [p[0] + 1, p[1]]);
		const pit: V2[] = [
			[0, -10],
			[4, 0],
			[20, 10],
		];
		const out = followFast(pit, F0, F1, 0.5, 8);
		expect(out[0]).toEqual([1, -10]);
		expect((out[1] as V2)[0]).toBeGreaterThan(4);
		expect((out[1] as V2)[0]).toBeLessThan(5);
		expect(out[2]).toEqual([20, 10]);
	});
});
