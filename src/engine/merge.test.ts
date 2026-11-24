// @vitest-environment node
// The roads' merge: proved on two roads crossing over a sloping ground.
import { describe, expect, it } from "vitest";
import { check, localFiller, MergeCache, merge, type Region } from "./merge";
import { Surface } from "./surface";
import { triangle } from "./velopark-fixture";

/** A strip of triangles from (x0, z0) to (x1, z1), rows a metre apart, at height y. */
function strip(x0: number, z0: number, x1: number, z1: number, y: number): Region["tris"] {
	const out: number[] = [];
	for (let x = x0; x < x1 - 1e-9; x += 1)
		for (let z = z0; z < z1 - 1e-9; z += 1) {
			const a = [x, y, z];
			const b = [Math.min(x + 1, x1), y, z];
			const c = [Math.min(x + 1, x1), y, Math.min(z + 1, z1)];
			const d = [x, y, Math.min(z + 1, z1)];
			out.push(...a, ...b, ...c, ...a, ...c, ...d);
		}
	return Float64Array.from(out);
}

const uvsFor = (tris: Float64Array) => {
	const out = new Float64Array((tris.length / 9) * 6);
	for (let i = 0; i < tris.length / 3; i++) {
		out[i * 2] = (tris[i * 3] as number) / 5;
		out[i * 2 + 1] = (tris[i * 3 + 2] as number) / 5;
	}
	return out;
};

describe("the roads’ merge", () => {
	it("meets two roads crossing and the ground edge to edge, one height a point, the world covered once", async () => {
		const A = strip(2, 3, 18, 6, 1) as Float64Array;
		const B = strip(8.3, 0, 10.8, 10, 1.2) as Float64Array;
		const regions: Region[] = [
			{ name: "A", tris: A, uvs: uvsFor(A) },
			{ name: "B", tris: B, uvs: uvsFor(B) },
			{ name: "ground", ground: { height: (x) => 0.5 + 0.01 * x, uv: (x, z) => [x / 50, z / 50], spacing: 2 } },
		];
		const world = { x0: 0, z0: 0, x1: 20, z1: 10 };
		const out = await merge(regions, world, localFiller(await triangle()));
		expect(Object.keys(out).sort()).toEqual(["A", "B", "ground"]);
		expect(check(out, world)).toEqual([]);
		// (where B lies under A, A's; B's height where it is seen; the ground's own far from them)
		const top = (x: number, z: number) => {
			for (const n of ["A", "B", "ground"]) {
				const m = out[n];
				if (!m) continue;
				const T = new Float64Array(m.F.length * 3);
				m.F.forEach((v, i) => {
					T.set(m.P.subarray(v * 3, v * 3 + 3), i * 3);
				});
				const y = new Surface(T).y(x, z);
				if (!Number.isNaN(y)) return [n, y] as const;
			}
			return null;
		};
		expect(top(9.5, 4.5)).toEqual(["A", 1]);
		expect(top(9.5, 8)?.[0]).toBe("B");
		// (a point of the ground's own, past the ramp from the roads: its own height)
		expect(top(16, 8)?.[1]).toBeCloseTo(0.66, 9);
	});

	it("fills the ground a tile at a time, and again only what a road changed reaches", async () => {
		const A = strip(2, 3, 18, 6, 1) as Float64Array;
		const C = strip(100, 2, 110, 5, 0.8) as Float64Array;
		const ground: Region = {
			name: "ground",
			ground: { height: (x) => 0.5 + 0.01 * x, uv: (x, z) => [x / 50, z / 50], spacing: 2 },
		};
		const regionsWith = (B: Float64Array): Region[] => [
			{ name: "A", tris: A, uvs: uvsFor(A) },
			{ name: "B", tris: B, uvs: uvsFor(B) },
			{ name: "C", tris: C, uvs: uvsFor(C) },
			ground,
		];
		// (the world over three tiles: 0-64, 64-128, 128-140)
		const world = { x0: 0, z0: 0, x1: 140, z1: 10 };
		const cache = new MergeCache();
		const fill = localFiller(await triangle());
		const B = strip(8.3, 0, 10.8, 10, 1.2) as Float64Array;
		const first = await merge(regionsWith(B), world, fill, { cache });
		expect(check(first, world)).toEqual([]);
		const faces = cache.filled;
		expect(cache.kept).toBe(0);
		// (the same again: all of it kept, the same surface)
		const again = await merge(regionsWith(B), world, fill, { cache });
		expect([cache.filled, cache.kept]).toEqual([0, faces]);
		expect(again).toEqual(first);
		// (B moved: its faces, A's it crosses and the first tile's ground filled again; C's and the other tiles' kept)
		const moved = strip(8.6, 0, 11.1, 10, 1.2) as Float64Array;
		const after = await merge(regionsWith(moved), world, fill, { cache });
		expect(check(after, world)).toEqual([]);
		expect(cache.kept).toBeGreaterThanOrEqual(3);
		expect(cache.filled).toBeLessThan(faces - 2);
		expect(after.C).toEqual(first.C);
		const fresh = await merge(regionsWith(moved), world, fill);
		expect(after).toEqual(fresh);
	});
});
