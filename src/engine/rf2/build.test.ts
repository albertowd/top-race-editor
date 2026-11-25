// @vitest-environment node
// The rFactor 2 location's pieces (rf2/build.ts): a track mesh as a GMT's in rFactor's axes, wound as rFactor's faces are; a timing beam; the plain diffuse
// material. And the Velopark's whole location, read back GMT by GMT, only when asked (TOP_RACE_VELOPARK=1) and where the Velopark is next to the editor.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { TrackMesh } from "../beamng/trackmodel";
import { ddsOf } from "../dds";
import type { HostFiles } from "../placehost";
import { beamGmt, buildRf2, diffuseMaterial, GmtFill, gmtMeshOf, gmtPieces, nightLights, powerOfTwoDds, staticGmt, tileSize, tilesOf } from "./build";
import { type GmtVertex, readGmt, type Vec3, wordFloat, writeGmt } from "./gmt";

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** (b - a) x (c - a) of each face, against its first corner's normal: rFactor's faces all have it negative */
const windings = (vs: GmtVertex[], I: number[]) => {
	const out: number[] = [];
	for (let t = 0; t < I.length; t += 3) {
		const [a, b, c] = [I[t], I[t + 1], I[t + 2]].map((i) => vs[i as number] as GmtVertex);
		out.push(Math.sign(dot(cross(sub(b?.position as Vec3, a?.position as Vec3), sub(c?.position as Vec3, a?.position as Vec3)), a?.normal as Vec3)));
	}
	return out;
};

/** a track mesh of the corners given (x y z, normal, uv) and faces */
const mesh = (corners: number[][], f: number[]): TrackMesh => ({
	name: "M",
	role: "surface",
	surface: null,
	visible: true,
	draw: [0, null],
	shadows: false,
	grass: false,
	material: "Asphalt",
	v: new Float32Array(corners.flat()),
	f: new Uint32Array(f),
});

describe("the rFactor 2 location's pieces", () => {
	it("make a track mesh a GMT's: z turned round, its faces wound as rFactor's, the degenerate left out", () => {
		// (a square of the track facing up, wound as glTF winds its fronts; one face of it twice its corner)
		const m = mesh(
			[
				[0, 0, 0, 0, 1, 0, 0, 0],
				[0, 0, 2, 0, 1, 0, 0, 1],
				[2, 0, 2, 0, 1, 0, 1, 1],
				[2, 0, 0, 0, 1, 0, 1, 0],
			],
			[0, 1, 2, 0, 2, 3, 1, 1, 2],
		);
		const g = gmtMeshOf(m, 3);
		expect(g?.material).toBe(3);
		expect(g?.vertices.map((v) => v.position)).toEqual([
			[0, 0, -0],
			[0, 0, -2],
			[2, 0, -2],
			[2, 0, -0],
		]);
		expect(g?.vertices[0]?.normal).toEqual([0, 1, 0]);
		expect(g?.vertices[1]?.uv[0]).toEqual([0, 1]);
		expect(g?.indices.length).toBe(6);
		expect(windings(g?.vertices ?? [], g?.indices ?? [])).toEqual([-1, -1]);
		// (one wound the other way: turned to agree)
		const back = gmtMeshOf(
			mesh(
				[
					[0, 0, 0, 0, 1, 0, 0, 0],
					[2, 0, 0, 0, 1, 0, 0, 0],
					[0, 0, 2, 0, 1, 0, 0, 0],
				],
				[0, 1, 2],
			),
			0,
		);
		expect(windings(back?.vertices ?? [], back?.indices ?? [])).toEqual([-1]);
		expect(gmtMeshOf(mesh([[0, 0, 0, 0, 1, 0, 0, 0]], [0, 0, 0]), 0)).toBeNull();
	});

	it("write a static GMT and read it back", () => {
		const g = gmtMeshOf(
			mesh(
				[
					[0, 0, 0, 0, 1, 0, 0, 0],
					[0, 0, 2, 0, 1, 0, 0, 1],
					[2, 0, 2, 0, 1, 0, 1, 1],
				],
				[0, 1, 2],
			),
			0,
		);
		const gmt = staticGmt("road_0", [g as NonNullable<typeof g>], [diffuseMaterial("road_Asphalt", "asphalt.dds")]);
		// (as written: its numbers 32-bit, read and written again the same bytes)
		const bytes = writeGmt(gmt);
		const back = readGmt(bytes);
		expect(writeGmt(back)).toEqual(bytes);
		if (back.kind !== "gmt") throw new Error("scrambled");
		expect(back.name).toBe("road_0");
		expect(back.meshes[0]?.indices).toEqual(gmt.meshes[0]?.indices);
		expect(back.faces).toHaveLength(1);
		expect(back.position).toEqual([0, 0, 0]);
		expect(back.planes[0]?.normal).toEqual([0, 1, 0]);
		const s = back.materials[0]?.shaders[0];
		expect(s?.name).toBe("L2DIFFUSET0");
		expect(s?.textures[0]?.name).toBe("ASPHALT.DDS");
		expect(s?.params.slice(0, 3).map(wordFloat)).toEqual([5, 0.1, 0.9].map(Math.fround));
		// (see-through: blended, as rFactor's glass)
		const glass = diffuseMaterial("glass", "glass.dds", "blend");
		expect([glass.flags, glass.srcBlend, glass.destBlend]).toEqual([0x68902023, 5, 6]);
	});

	it("keep each GMT within the samples' limits: its faces and corners cut, one mesh a material, 16 at most", () => {
		// (a strip of 100 quads: 202 corners, 200 faces)
		const corners: number[][] = [];
		const f: number[] = [];
		for (let i = 0; i <= 100; i++) corners.push([i, 0, 0, 0, 1, 0, i, 0], [i, 0, 1, 0, 1, 0, i, 1]);
		for (let i = 0; i < 100; i++) f.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
		const m = gmtMeshOf(mesh(corners, f), 0) as NonNullable<ReturnType<typeof gmtMeshOf>>;
		const pieces = gmtPieces(m, 1000, 30);
		expect(pieces.every((p) => p.indices.length / 3 <= 30 && p.vertices.length <= 1000)).toBe(true);
		expect(pieces.reduce((n, p) => n + p.indices.length / 3, 0)).toBe(200);
		// (each piece's faces the same places as the whole's)
		const at = (p: typeof m, t: number) => [0, 1, 2].map((k) => p.vertices[p.indices[t * 3 + k] as number]?.position);
		expect(at(pieces[1] as typeof m, 0)).toEqual(at(m, 30));
		expect(gmtPieces(m)).toEqual([m]);
		// (filled: a mesh a material, the corners of a second piece after the first's)
		const asphalt = diffuseMaterial("road_A", "a.dds");
		const fill = new GmtFill();
		fill.add(pieces[0] as typeof m, asphalt);
		fill.add(pieces[1] as typeof m, asphalt);
		expect(fill.meshes).toHaveLength(1);
		expect(fill.meshes[0]?.indices.length).toBe(180);
		expect(Math.max(...(fill.meshes[0]?.indices ?? []))).toBe((fill.meshes[0]?.vertices.length ?? 0) - 1);
		for (let k = 1; k < 16; k++) fill.add(pieces[2] as typeof m, diffuseMaterial(`m${k}`, "a.dds"));
		expect(fill.materials).toHaveLength(16);
		expect(fill.fits(pieces[2] as typeof m, asphalt)).toBe(true);
		expect(fill.fits(pieces[2] as typeof m, diffuseMaterial("m16", "a.dds"))).toBe(false);
	});

	it("cut meshes in tiles, drawn near or far as their model says; cut-out materials alpha tested", () => {
		// (two triangles 300 m apart: two tiles of 250 m, each its own corners)
		const two = mesh(
			[
				[0, 0, 0, 0, 1, 0, 0, 0],
				[1, 0, 0, 0, 1, 0, 0, 0],
				[0, 0, 1, 0, 1, 0, 0, 0],
				[300, 0, 0, 0, 1, 0, 0, 0],
				[301, 0, 0, 0, 1, 0, 0, 0],
				[300, 0, 1, 0, 1, 0, 0, 0],
			],
			[0, 1, 2, 3, 4, 5],
		);
		const tiles = tilesOf(two, 250);
		expect([...tiles.keys()]).toEqual(["0,0", "1,0"]);
		expect([...(tiles.get("1,0")?.f ?? [])]).toEqual([0, 1, 2]);
		expect(tiles.get("1,0")?.v[0]).toBe(300);
		// (one tile: the mesh as it is)
		expect(tilesOf(two, 1000).get("0,0")).toBe(two);
		expect([tileSize(45), tileSize(400), tileSize(2000)]).toEqual([50, 150, 250]);
		const g = gmtMeshOf(two, 0) as NonNullable<ReturnType<typeof gmtMeshOf>>;
		expect(staticGmt("t", [g], [diffuseMaterial("m", "m.dds")], 2000, 45).lod).toEqual([45, 2000]);
		// (cut out: drawn opaque, its texture's flag 0x80; blended: as glass)
		const leaves = diffuseMaterial("leaves", "l.dds", "mask");
		expect([leaves.flags, leaves.srcBlend, leaves.destBlend, leaves.shaders[0]?.textures[0]?.flags]).toEqual([0x68902003, 2, 1, 0x98]);
		expect(diffuseMaterial("m", "m.dds").shaders[0]?.textures[0]?.flags).toBe(0x18);
	});

	it("make the track's lamps rFactor's omni lights, those near one another one", () => {
		const lights = nightLights({
			series: {
				flood: { colour: [1, 0.9, 0.8], strength: 2, range: 125 },
				spill: { colour: [1, 0.9, 0.8], strength: 0.3, range: 70 },
				lamp: { colour: [1, 1, 1], strength: 0.5, range: 10 },
			},
			lights: [
				// (a pole's beam and spill, at its top: one light)
				{ series: "flood", at: [0, 16, 0] },
				{ series: "spill", at: [0, 16, 0.4] },
				// (a building's lamps 4 m apart: one; one off: none)
				{ series: "lamp", at: [100, 3, 0] },
				{ series: "lamp", at: [104, 3, 0], strength: 1 },
				{ series: "lamp", at: [300, 3, 0], on: false },
			],
			screens: [],
		});
		expect(lights.map((l) => l.name)).toEqual(["NightLight00", "NightLight01"]);
		expect(lights[0]).toMatchObject({ range: 125 + 7.5, intensity: 8, colour: [255, 230, 204] });
		expect(lights[0]?.pos.map((v) => Math.round(v * 10) / 10)).toEqual([0, 16, -0.2]);
		expect(lights[1]).toMatchObject({ pos: [102, 3, -0], intensity: 4 });
	});

	it("keep textures of sides powers of two, 32 bits a pixel where uncompressed", () => {
		const pic = (width: number, height: number) => ({
			width,
			height,
			mode: "RGBA" as const,
			data: new Uint8Array(width * height * 4).fill(255),
		});
		expect(powerOfTwoDds(ddsOf(pic(256, 64)))).toBe(true);
		expect(powerOfTwoDds(ddsOf(pic(2048, 320)))).toBe(false);
		// (an uncompressed one 32 bits a pixel: its pixel format's bit count)
		const d = ddsOf(pic(4, 4));
		expect(new DataView(d.buffer).getUint32(88, true)).toBe(32);
	});

	it("make a timing beam across from its left to its right, both sides, never drawn", () => {
		const b = beamGmt({ name: "xfinish", left: [0, 1, 0], right: [10, 1, 0], score: 0, gate: "AC_TIME_0" });
		expect(b.name).toBe("xfinish");
		expect(b.flags).toBe(0);
		const m = b.meshes[0];
		expect(m?.vertices.length).toBe(8);
		expect(windings(m?.vertices ?? [], m?.indices ?? [])).toEqual([-1, -1, -1, -1]);
		expect(b.box.min).toEqual([0, -9, 0]);
		expect(b.box.max).toEqual([10, 16, 0]);
		const bytes = writeGmt(b);
		expect(writeGmt(readGmt(bytes))).toEqual(bytes);
	});
});

const VELOPARK = "D:/projects/kart-velopark";
const asked = process.env.TOP_RACE_VELOPARK === "1" && existsSync(`${VELOPARK}/tools/reference/track.json`);

describe.skipIf(!asked)("the Velopark's rFactor 2 location", () => {
	it("is made of every layout, each GMT read back", { timeout: 900_000 }, async () => {
		const files: HostFiles = {
			read: async (p) => new Uint8Array(readFileSync(p)),
			list: async (d) => readdirSync(d),
			size: async (p) => statSync(p).size,
			exists: async (p) => existsSync(p),
			write: async (p, b) => {
				mkdirSync(dirname(p), { recursive: true });
				writeFileSync(p, b);
			},
		};
		const built = await buildRf2(files, { project: VELOPARK });
		expect(built.skipped).toEqual({});
		const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(`${d}/${f}`).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
		const all = walk(built.location);
		const gmts = all.filter((p) => p.endsWith(".gmt"));
		for (const p of gmts) expect(readGmt(new Uint8Array(readFileSync(p))).kind).toBe("gmt");
		for (const l of built.layouts)
			for (const f of [`${l}.scn`, `${l}.gdb`, `${l}.AIW`, `${l}.wet`, "xfinish.gmt", "xsector1.gmt", "xsector2.gmt"])
				expect(all).toContain(`${built.location}/${l}/${f}`);
	});
});
