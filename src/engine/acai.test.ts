// @vitest-environment node
// AC's AI files read and written (acai.ts): a lap's line and a pit line written back as they were read, byte for byte, the lap's grid made again from its
// points (a made-up pair; the Velopark's, where it is next to the editor).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aiGrid, readAiFile, writeAiFile } from "./acai";

const AI = "D:/projects/kart-velopark/track/ac/vp_kids";

describe("AC’s AI files", () => {
	it("writes a line as it reads it, its grid made from its points", () => {
		const n = 200;
		const P = new Float32Array(n * 3);
		const along = new Float32Array(n);
		const extra = new Float32Array(n * 18);
		for (let i = 0; i < n; i++) {
			const a = (i / n) * 2 * Math.PI;
			P.set([40 * Math.cos(a), 1, 30 * Math.sin(a)], i * 3);
			along[i] = i * 1.1;
			extra[i * 18] = 20;
		}
		const lap = writeAiFile(P, along, extra, true);
		const back = readAiFile(lap);
		expect([back.version, back.points.length / 3, back.extra?.length]).toEqual([7, n, n * 18]);
		expect(back.grid?.cells.length).toBe((back.grid?.nx ?? 0) * (back.grid?.nz ?? 0) * 10);
		expect(writeAiFile(back.points, back.along, back.extra, aiGrid(back.points))).toEqual(lap);
		const pit = writeAiFile(P, along, null, false);
		expect(readAiFile(pit).grid).toBeNull();
		expect(pit.length).toBe(16 + n * 20 + 4);
	});

	it.skipIf(!existsSync(`${AI}/ai/fast_lane.ai`))(
		"gives the Velopark’s back byte for byte",
		() => {
			for (const [f, lap] of [
				["ai/fast_lane.ai", true],
				["ai/pit_lane.ai", false],
			] as const) {
				const b = new Uint8Array(readFileSync(`${AI}/${f}`));
				const r = readAiFile(b);
				expect(writeAiFile(r.points, r.along, r.extra, lap), f).toEqual(b);
			}
		},
		60_000,
	);
});
