// @vitest-environment node
// Triangle as WebAssembly: an input it cannot take an exception, and it goes on after.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Triangle, TriangleError } from "./triangle";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const wasm = () => new Uint8Array(readFileSync(at("../../node_modules/triangle-wasm/triangle.out.wasm")));

describe("Triangle as WebAssembly", () => {
	it("says so of an input it cannot take, and goes on", async () => {
		const T = await Triangle.load(wasm());
		// (fewer than three points: Triangle stops)
		expect(() => T.triangulate("pQ", { points: [0, 0, 1, 0] })).toThrow(TriangleError);
		// (no segments, so not 'p': it would take away every triangle no segment keeps)
		const out = T.triangulate("Q", { points: [0, 0, 1, 0, 0, 1] });
		expect(out.triangles).toHaveLength(3);
		// (many times over: what it makes is freed)
		for (let i = 0; i < 2000; i++) expect(T.triangulate("Q", { points: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5] }).triangles).toHaveLength(12);
	});
});
