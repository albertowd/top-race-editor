import { describe, expect, it } from "vitest";
import { type GltfDoc, groundByMaterial, type Kx } from "./gltf";
import { readLibrary } from "./materials";

const surfaces = {
	asphalt: { targets: { ac: "ROAD" } },
	rumble: { targets: { ac: "KERB" } },
	kerb: { targets: { ac: "KERB" } },
	wall: { targets: { ac: "WALL" } },
};
const library = readLibrary(
	{ materials: { Tarmac: { surface: "asphalt" }, KerbRamp: { surface: "rumble" }, Concrete: { surface: "wall" }, Paint: {} } },
	surfaces,
);
const doc: GltfDoc = {
	materials: [{ name: "Tarmac" }, { name: "KerbRamp" }, { name: "Concrete" }, { name: "Paint" }],
	meshes: [
		{ primitives: [{ material: 1 }] },
		{ primitives: [{ material: 0 }] },
		{ primitives: [{ material: 2 }] },
		{ primitives: [{ material: 0 }, { material: 1 }] },
	],
} as GltfDoc;
const road: Kx = { role: "surface", surface: "asphalt" };

/** AC's name for a node of the doc's mesh m kept as track. */
const acName = (m: number, track: Kx = road) => library.nodeIn?.("X", groundByMaterial({ doc, library }, { name: "X", mesh: m }, track), {})[0];

describe("the ground AC drives a mesh as", () => {
	it("is its material's where that has one: a rumble's kerb, whatever the mesh says", () => {
		expect(acName(0)).toBe("1KERB_X");
		expect(acName(1, { role: "surface", surface: "rumble" })).toBe("1ROAD_X");
	});

	it("is the mesh's own where its materials are a wall's or differ, and never makes what is not driven on a surface", () => {
		expect(acName(2)).toBe("1ROAD_X");
		expect(acName(3)).toBe("1ROAD_X");
		expect(acName(0, { role: "visual" })).toBe("X");
	});
});
