// @vitest-environment node
// The roads' surface made imperfect: noise on the road, nothing a metre past it, a bend's inside lower; none of it: none; its settings kept as the objects are
// written.
import { describe, expect, it } from "vitest";
import { cleanObjects, ObjectsError } from "./objectsfile";
import type { RoadDesc } from "./roads";
import { ROUGH_LEVELS, roughnessOf } from "./roughness";

type P2 = [number, number];
const node = (p: P2, inn: P2, out: P2) => ({ p, in: inn, out, left: 4, right: 4 });
// (a straight along +x, then a tight bend round (40, 15), radius 15)
const straight: RoadDesc = { name: "S", curve: [node([0, 0], [0, 0], [10, 0]), node([40, 0], [-10, 0], [0, 0])] };
const bend: RoadDesc = {
	name: "B",
	curve: [node([0, 0], [0, 0], [8.3, 0]), node([15, 15], [0, -8.3], [0, 0])],
};

describe("the roads’ surface made imperfect", () => {
	it("is none where the track asks none", () => {
		expect(roughnessOf([straight], undefined)).toBeNull();
		expect(roughnessOf([straight], { waves: 0, bumps: 0 })).toBeNull();
	});

	it("is noise on the road, of about its millimetres, and nothing a metre past its edges", () => {
		const r = roughnessOf([straight], { waves: 10, bumps: 4, ripple: 1.5 }) as (x: number, z: number) => number;
		const on: number[] = [];
		for (let x = 1; x < 39; x += 0.37) for (let z = -3.5; z <= 3.5; z += 0.7) on.push(r(x, z));
		const most = Math.max(...on.map(Math.abs));
		expect(most).toBeGreaterThan(0.004);
		expect(most).toBeLessThan(0.016);
		expect(new Set(on.map((v) => v.toFixed(5))).size).toBeGreaterThan(on.length / 2);
		for (const z of [5.2, -5.2, 9]) expect(r(20, z)).toBe(0);
		expect(r(20, 30)).toBe(0);
	});

	it("puts a tight bend’s inside lower, the more the nearer its inside edge", () => {
		const r = roughnessOf([bend], { camber: 30 }) as (x: number, z: number) => number;
		// (half way round: the middle at about (10.6, 4.4); its inside towards the bend's middle (0, 15))
		const mid: P2 = [15 * Math.sin(Math.PI / 4), 15 - 15 * Math.cos(Math.PI / 4)];
		const towards = (d: number): P2 => [mid[0] + (0 - mid[0]) * (d / 15), mid[1] + (15 - mid[1]) * (d / 15)];
		const inside = r(...towards(3.5));
		const outside = r(...towards(-3.5));
		expect(inside).toBeLessThan(-0.01);
		expect(outside).toBeCloseTo(0, 6);
		expect(r(...towards(1.5))).toBeGreaterThan(inside);
	});

	it("leaves a bend’s inside as it is where a road built after it starts on its middle, with no step there", () => {
		// (a road going out from the bend's middle, half way round, as a road running into another starts: under it there)
		const mid: P2 = [15 * Math.sin(Math.PI / 4), 15 - 15 * Math.cos(Math.PI / 4)];
		const away: P2 = [Math.SQRT1_2, -Math.SQRT1_2];
		const out: RoadDesc = {
			name: "O",
			curve: [node(mid, [0, 0], [away[0] * 4, away[1] * 4]), node([mid[0] + away[0] * 20, mid[1] + away[1] * 20], [-away[0] * 4, -away[1] * 4], [0, 0])],
		};
		const alone = roughnessOf([bend], { camber: 30 }) as (x: number, z: number) => number;
		const both = roughnessOf([bend, out], { camber: 30 }) as (x: number, z: number) => number;
		// (round the bend 3 m in from its middle, across where the other road starts)
		const inside: number[] = [];
		for (let t = Math.PI / 4 - 0.15; t <= Math.PI / 4 + 0.15; t += 0.005) {
			const [x, z]: P2 = [12 * Math.sin(t), 15 - 12 * Math.cos(t)];
			expect(both(x, z)).toBeCloseTo(alone(x, z), 4);
			inside.push(both(x, z));
		}
		expect(Math.min(...inside)).toBeLessThan(-0.01);
		for (let i = 1; i < inside.length; i++) expect(Math.abs((inside[i] as number) - (inside[i - 1] as number))).toBeLessThan(0.001);
	});

	it("turns one road’s roughness into the next’s where they meet, never at once", () => {
		// (a straight running into the bend's inside, square to it, half way round: the bend's inside down, the straight not)
		const mid: P2 = [15 * Math.sin(Math.PI / 4), 15 - 15 * Math.cos(Math.PI / 4)];
		const inward: P2 = [-Math.SQRT1_2, Math.SQRT1_2];
		const start: P2 = [mid[0] + inward[0] * 12, mid[1] + inward[1] * 12];
		const into: RoadDesc = {
			name: "I",
			curve: [node(start, [0, 0], [-inward[0] * 3, -inward[1] * 3]), node(mid, [inward[0] * 3, inward[1] * 3], [0, 0])],
		};
		const r = roughnessOf([bend, into], { camber: 30 }) as (x: number, z: number) => number;
		const h = 0.1;
		let most = 0;
		for (let x = 0; x < 15; x += h) for (let z = 0; z < 15; z += h) most = Math.max(most, Math.abs(r(x + h, z) - r(x, z)), Math.abs(r(x, z + h) - r(x, z)));
		expect(most).toBeLessThan(0.005);
	});

	it("is kept as the objects are written: its millimetres and its seed; out of range, refused", () => {
		const base = { version: 3, layouts: {}, objects: [], marks: [] };
		const out = JSON.parse(
			JSON.stringify(cleanObjects({ ...base, surface: { ...ROUGH_LEVELS.medium, seed: 3 } }), (_k, v) =>
				v && typeof v === "object" && "value" in v ? v.value : v,
			),
		);
		expect(out.surface).toEqual({ ...ROUGH_LEVELS.medium, seed: 3 });
		expect("surface" in (cleanObjects({ ...base, surface: { waves: 0 } }) as object)).toBe(false);
		expect(() => cleanObjects({ ...base, surface: { waves: 500 } })).toThrow(ObjectsError);
	});
});
