// @vitest-environment node
// A tyre wall's collision: one closed solid round its stacks, every face facing out, so a kart driven into it is pushed back the way it came, never through it
// into the hollow of two open sheets or out under the track.
import { describe, expect, it } from "vitest";
import { type Place, type PlacedObject, SPACING, WALL_DOWN, wallBand } from "./laying";

const wall = (extra: Partial<PlacedObject> = {}): PlacedObject =>
	({ name: "TYRES_1", model: "tyre_stack", curve: [], collision: "wall", ...extra }) as PlacedObject;

/** stacks along a line from (0, 0) on x, SPACING apart */
const along = (n: number): Place[] => Array.from({ length: n }, (_, i) => [i * SPACING, 0, Math.PI / 2] as Place);

/** stacks round a circle of radius r */
const round = (n: number, r: number): Place[] =>
	Array.from({ length: n }, (_, i) => {
		const a = (2 * Math.PI * i) / n;
		return [r * Math.cos(a), r * Math.sin(a), 0] as Place;
	});

/** Every edge of its faces in two of them, run opposite ways in each (closed, each face turned as its neighbours). */
function closedAndTurnedAlike(F: Int32Array): boolean {
	const edges = new Map<string, number>();
	for (let f = 0; f < F.length; f += 3)
		for (let k = 0; k < 3; k++) {
			const key = `${F[f + k]},${F[f + ((k + 1) % 3)]}`;
			edges.set(key, (edges.get(key) ?? 0) + 1);
		}
	for (const [key, count] of edges) {
		const [a, b] = key.split(",");
		if (count !== 1 || edges.get(`${b},${a}`) !== 1) return false;
	}
	return true;
}

/** The volume it holds (the divergence theorem): more than 0 when every face faces out. */
function volume(P: Float64Array, F: Int32Array): number {
	let v = 0;
	for (let f = 0; f < F.length; f += 3) {
		const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number].map((i) => [
			P[i * 3] as number,
			P[i * 3 + 1] as number,
			P[i * 3 + 2] as number,
		]) as [number[], number[], number[]];
		v +=
			((a[0] as number) * ((b[1] as number) * (c[2] as number) - (b[2] as number) * (c[1] as number)) -
				(a[1] as number) * ((b[0] as number) * (c[2] as number) - (b[2] as number) * (c[0] as number)) +
				(a[2] as number) * ((b[0] as number) * (c[1] as number) - (b[1] as number) * (c[0] as number))) /
			6;
	}
	return v;
}

/** No face twice, once each way (an open sheet hit from either side). */
function noSheets(F: Int32Array): boolean {
	const seen = new Set<string>();
	for (let f = 0; f < F.length; f += 3) seen.add([F[f], F[f + 1], F[f + 2]].map(Number).sort().join(","));
	return seen.size === F.length / 3;
}

describe("a tyre wall’s collision", () => {
	const floor = () => 2;
	const half = 0.31;
	const high = 0.9;

	it("is one closed solid along a wall, its faces out: as long, as wide and as high as the wall", () => {
		const { P, F } = wallBand(wall(), along(6), half, high, floor);
		expect(closedAndTurnedAlike(F)).toBe(true);
		expect(noSheets(F)).toBe(true);
		// (its length: from the first stack to the last; across it: its stacks' width; WALL_DOWN under the floor to high)
		const length = 5 * SPACING;
		const want = length * 2 * half * (high + WALL_DOWN);
		expect(volume(P, F)).toBeCloseTo(want, 6);
		const ys = [...P].filter((_, i) => i % 3 === 1);
		expect(Math.min(...ys)).toBeCloseTo(2 - WALL_DOWN, 9);
		expect(Math.max(...ys)).toBeCloseTo(2 + high, 9);
	});

	it("holds every row of a wall of more than one", () => {
		const one = along(6);
		const two = [...one, ...one.map(([x, z, h]) => [x, z - SPACING, h] as Place)];
		const { P, F } = wallBand(wall({ rows: 2 }), two, half, high, floor);
		expect(closedAndTurnedAlike(F)).toBe(true);
		expect(volume(P, F)).toBeCloseTo(5 * SPACING * (2 * half + SPACING) * (high + WALL_DOWN), 6);
	});

	it("is a closed ring round a ring of stacks, with no ends", () => {
		const { P, F } = wallBand(wall({ closed: true }), round(24, 6), half, high, floor);
		expect(closedAndTurnedAlike(F)).toBe(true);
		expect(noSheets(F)).toBe(true);
		expect(volume(P, F)).toBeGreaterThan(0);
	});

	it("is a closed box for a wall of one stack", () => {
		const { P, F } = wallBand(wall(), [[0, 0, 0]], half, high, floor);
		expect(closedAndTurnedAlike(F)).toBe(true);
		expect(volume(P, F)).toBeGreaterThan(0);
	});
});
