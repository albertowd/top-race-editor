// @vitest-environment node
// A racing line made AC's AI line (aimake.ts), on a made-up flat oval with a road 8 m wide: a point every STEP metres; round its bends as fast as GRIP lets it,
// no faster than TOP down its straights, braking into the bends; its way the line's; the road 4 m either side; which way it turns as AC has it.
import { describe, expect, it } from "vitest";
import { readAiFile, writeAiFile } from "./acai";
import type { LineNode, RacingLine } from "./ailines";
import { aiLineOf, GRIP, PIT_OVERLAP, PIT_SIDE, PIT_SPEED, pitRunsBackwards, STEP, TOP } from "./aimake";

/** An oval: two 200 m straights along z and bends of radius 30 m, its nodes' handles a circle's (kappa). */
function oval(): RacingLine {
	const r = 30;
	const L = 100;
	const k = 0.5523 * r;
	const curve: LineNode[] = [
		{ p: [r, -L], in: [0, -k], out: [0, k] },
		{ p: [r, L], in: [0, -100], out: [0, k] },
		{ p: [0, L + r], in: [k, 0], out: [-k, 0] },
		{ p: [-r, L], in: [0, k], out: [0, -k] },
		{ p: [-r, -L], in: [0, 100], out: [0, -k] },
		{ p: [0, -L - r], in: [-k, 0], out: [k, 0] },
	];
	return { curve, closed: true };
}

describe("a racing line made an AI line", () => {
	it("has the road to AC’s left first: towards (fz, -fx), as the recorded lines have it", () => {
		// (a straight up +z at x 30 on a road from x 28 to 36: AC's left, +x, 6 m; its right 2 m)
		const line: RacingLine = {
			curve: [
				{ p: [30, -100], in: [0, 0], out: [0, 50] },
				{ p: [30, 100], in: [0, -50], out: [0, 0] },
			],
			closed: false,
		};
		const ai = aiLineOf(
			line,
			() => 0,
			(x) => x >= 28 && x <= 36,
			STEP,
		);
		const mid = Math.floor(ai.along.length / 2);
		expect(ai.extra[mid * 18 + 13]).toBeCloseTo(0, 6);
		expect(ai.extra[mid * 18 + 15]).toBeCloseTo(1, 6);
		expect(ai.extra[mid * 18 + 5]).toBeCloseTo(6, 0);
		expect(ai.extra[mid * 18 + 6]).toBeCloseTo(2, 0);
	});

	it("is driven round the oval as a kart would", () => {
		const line = oval();
		const flat = () => 0.5;
		const road = (x: number) => Math.abs(Math.abs(x) - 30) <= 4 || Math.hypot(x, 0) < 30;
		const ai = aiLineOf(line, flat, (x, z) => (Math.abs(z) <= 100 ? Math.abs(Math.abs(x) - 30) <= 4 : road(x)), STEP);
		const n = ai.along.length;
		const E = (i: number, k: number) => ai.extra[i * 18 + k] as number;
		expect(n).toBeGreaterThan(800);
		// (a point every half metre, on the floor)
		expect((ai.along[1] as number) - (ai.along[0] as number)).toBeCloseTo(STEP, 1);
		expect(ai.points[1]).toBeCloseTo(0.5, 6);
		// (the middle of the far bend: as fast as its grip lets it; the middle of a straight: faster, no more than TOP)
		const at = (x: number, z: number) => {
			let best = 0;
			let bd = Infinity;
			for (let i = 0; i < n; i++) {
				const d = Math.hypot((ai.points[i * 3] as number) - x, (ai.points[i * 3 + 2] as number) - z);
				if (d < bd) {
					bd = d;
					best = i;
				}
			}
			return best;
		};
		const bend = at(0, 130);
		const straight = at(30, 0);
		expect(E(bend, 4)).toBeCloseTo(30, -1);
		expect(E(bend, 0)).toBeCloseTo(Math.sqrt(GRIP * 30), 0);
		expect(E(straight, 0)).toBeGreaterThan(E(bend, 0) + 5);
		expect(E(straight, 0)).toBeLessThanOrEqual(TOP);
		// (braking before the bend, the throttle open after it)
		const before = at(30, 95);
		expect(E(before, 2)).toBeGreaterThan(0);
		expect(E(at(-30, 90), 1)).toBe(1);
		// (on the straight: the road 4 m either side, its way up +z, flat)
		expect(E(straight, 5)).toBeCloseTo(4, 0);
		expect(E(straight, 6)).toBeCloseTo(4, 0);
		expect([E(straight, 13), E(straight, 14), E(straight, 15)].map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 1]);
		expect([E(straight, 9), E(straight, 10), E(straight, 11)]).toEqual([-0, 1, -0]);
		// (the oval goes round to its left: AC's -1)
		expect(E(bend, 8)).toBe(-1);
		// (written as AC reads it)
		const back = readAiFile(writeAiFile(ai.points, ai.along, ai.extra, true));
		expect(back.points.length / 3).toBe(n);
		expect(back.extra?.[bend * 18]).toBeCloseTo(E(bend, 0), 4);
	});

	it("drives a pit lane on its own road, at the pit speed, on the lap at either end", () => {
		// (beside the oval's straight at x 30, out to x 40 and back; the pit road and the track one asphalt from x 26 to 46, as where they meet; drawn from the lap
		// and back onto it, on it at neither end)
		const pit: RacingLine = {
			curve: [
				{ p: [30, -60], in: [0, 0], out: [0, 15] },
				{ p: [40, -30], in: [0, -15], out: [0, 15] },
				{ p: [40, 30], in: [0, -15], out: [0, 15] },
				{ p: [30, 60], in: [0, -15], out: [0, 0] },
			],
			closed: false,
		};
		const ai = aiLineOf(
			pit,
			() => 0,
			(x) => x >= 26 && x <= 46,
			STEP,
			{ fast: oval() },
		);
		const n = ai.along.length;
		const E = (i: number, k: number) => ai.extra[i * 18 + k] as number;
		for (let i = 0; i < n; i++) {
			expect(E(i, 5)).toBeLessThanOrEqual(PIT_SIDE);
			expect(E(i, 6)).toBeLessThanOrEqual(PIT_SIDE);
			expect(E(i, 0)).toBeLessThanOrEqual(PIT_SPEED + 1e-6);
		}
		// (on the lap's line, x 30, for PIT_OVERLAP metres at least before it leaves and after it joins; no more than a step or so past that)
		const onLap = (i: number) => Math.abs((ai.points[i * 3] as number) - 30) <= 0.5;
		let lead = 0;
		while (onLap(lead)) lead++;
		let tail = 0;
		while (onLap(n - 1 - tail)) tail++;
		for (const run of [lead, tail]) {
			expect(run * STEP).toBeGreaterThanOrEqual(PIT_OVERLAP);
			expect(run * STEP).toBeLessThan(PIT_OVERLAP + 2);
		}
	});
});

describe("a pit lane against the lap", () => {
	// (the oval's fast line, and pit lanes as AI points at so many metres along it)
	const fast = aiLineOf(
		oval(),
		() => 0,
		() => true,
	);
	const pts = (s: number[]) => {
		const out = new Float32Array(s.length * 3);
		s.forEach((d, k) => {
			let i = 0;
			while (i < fast.along.length - 1 && (fast.along[i] as number) < d) i++;
			out.set([fast.points[i * 3] as number, 0, fast.points[i * 3 + 2] as number], k * 3);
		});
		return { points: out };
	};

	it("is not backwards when it rejoins ahead of where it leaves", () => {
		expect(pitRunsBackwards(fast, pts([20, 40, 60]))).toBe(false);
	});

	it("is backwards when it rejoins behind where it leaves", () => {
		expect(pitRunsBackwards(fast, pts([60, 40, 20]))).toBe(true);
	});

	it("is not backwards across the start of the lap", () => {
		const lap = fast.along[fast.along.length - 1] as number;
		expect(pitRunsBackwards(fast, pts([lap - 30, lap - 5, 20]))).toBe(false);
	});
});
