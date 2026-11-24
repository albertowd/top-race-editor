// @vitest-environment node
// The renders' grass: where the track's ext_config.ini says it grows, kept off what lies over the ground and off ground that is not green, the same each time.
import { describe, expect, it } from "vitest";
import { grassAround, grassConfig, isGreen, type Tris } from "./rendergrass";
import type { V3 } from "./trackrender";

/** a flat square (x z from lo to hi, at height y) as two triangles, its uv 0..1 across it */
function square(lo: number, hi: number, y: number): Tris {
	const P = [lo, y, lo, hi, y, lo, hi, y, hi, lo, y, lo, hi, y, hi, lo, y, hi];
	const UV = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
	return { P: new Float32Array(P), UV: new Float32Array(UV) };
}

const green: V3 = [0.1, 0.2, 0.05];
const grey: V3 = [0.2, 0.2, 0.2];

describe("the renders' grass", () => {
	it("is where ext_config.ini's GRASS_FX says", () => {
		const ini = "[A]\nX=1\n\n[GRASS_FX]\nGRASS_MESHES = 1GRASS_0, 1GRASS_1 ; the ground\nOCCLUDING_MATERIALS = Tarmac, Kerb\n[B]\nGRASS_MESHES = no";
		expect(grassConfig(ini)).toEqual({ meshes: ["1GRASS_0", "1GRASS_1"], occluding: ["Tarmac", "Kerb"] });
		expect(grassConfig("[GRASS_FX]\nGRASS_MESHES =\n")).toBeNull();
		expect(grassConfig("[OTHER]\n")).toBeNull();
	});

	it("grows on green ground only", () => {
		expect(isGreen(green)).toBe(true);
		expect(isGreen(grey)).toBe(false);
		expect(isGreen([0, 0, 0])).toBe(false);
		const ground = [{ tris: square(-10, 10, 0), colourAt: (u: number) => (u < 0.5 ? green : grey) }];
		const { verts, faces, clumps } = grassAround(ground, [], [0, 0], 30, 2);
		// (about half the 400 m², two a square metre)
		expect(clumps).toBeGreaterThan(300);
		expect(clumps).toBeLessThan(500);
		expect(faces.length).toBe(clumps * 12);
		for (let i = 0; i < verts.length; i += 11) expect(verts[i] as number).toBeLessThan(0.8);
		// (the same each time)
		expect(grassAround(ground, [], [0, 0], 30, 2).verts).toEqual(verts);
	});

	it("is kept off what lies over the ground, and grows only within its radius", () => {
		const ground = [{ tris: square(-10, 10, 0), colourAt: () => green }];
		const road = square(-10, 0, 0.05);
		const { verts, clumps } = grassAround(ground, [road], [0, 0], 30, 2);
		// (none on the road's quarter, x and z both under 0)
		for (let i = 0; i < verts.length; i += 11) expect((verts[i] as number) < -0.7 && (verts[i + 2] as number) < -0.7).toBe(false);
		expect(clumps).toBeGreaterThan(100);
		const near = grassAround(ground, [], [10, 10], 5, 2);
		for (let i = 0; i < near.verts.length; i += 11) expect(Math.hypot((near.verts[i] as number) - 10, (near.verts[i + 2] as number) - 10)).toBeLessThan(6);
	});
});
