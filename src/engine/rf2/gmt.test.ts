// @vitest-environment node
// rFactor 2's GMT (rf2/gmt.ts): every one of ModDev's samples read and written again byte for byte (where rFactor 2 is here), and a textured quad made from
// nothing, written and read back field by field: made as the simplest of the samples of static geometry is (LochDrummond's xfinish.gmt: one mesh of 4 vertices,
// one L2DIFFUSET0 material of one DDS), with the commonest settings of the samples' visible objects.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boxOf, facesOf, floatWord, type Gmt, type GmtMaterial, type GmtMesh, type GmtVertex, readGmt, type Vec3, wordFloat, writeGmt } from "./gmt";

const MODDEV = "D:/SteamLibrary/steamapps/common/rFactor 2/ModDev";
const XFINISH = `${MODDEV}/Locations/LochDrummond/Assets/GMTs/xfinish.gmt`;

function* gmts(dir: string): Generator<string> {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) yield* gmts(p);
		else if (/\.gmt$/i.test(f)) yield p;
	}
}

/** where two byte arrays first differ (-1: nowhere) */
function differAt(a: Uint8Array, b: Uint8Array): number {
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
	return -1;
}

// ---------------------------------------------------------------- the quad

function vertex(position: Vec3, uv: [number, number]): GmtVertex {
	return {
		position,
		normal: [0, 1, 0],
		colour: 0xffffffff,
		colour2: 0,
		bones: [0, 0, 0, 0],
		weights: [255, 0, 0, 0],
		tangent: [1, 0, 0],
		binormal: [0, 0, -1],
		uv: [uv, [0, 0], [0, 0], [0, 0]],
	};
}

/** 2 m square, lying flat and facing up; its texture once over it (V downwards, as the samples' are) */
function quadMesh(): GmtMesh {
	return {
		flags: 0x4080,
		material: 0,
		vertices: [vertex([-1, 0, -1], [0, 0]), vertex([1, 0, -1], [1, 0]), vertex([1, 0, 1], [1, -1]), vertex([-1, 0, 1], [0, -1])],
		// (wound as the samples' faces: (c - a) x (b - a) is their planes' normal, up here)
		indices: [0, 1, 2, 2, 3, 0],
		palette: [],
	};
}

const words = (...xs: number[]) => xs.map(floatWord);

function quadMaterial(): GmtMaterial {
	return {
		name: "QUAD",
		flags: 0x68902003,
		ambient: [1, 1, 1, 1],
		diffuse: [1, 1, 1, 1],
		specular: [0, 0, 0, 1],
		emissive: [0, 0, 0, 1],
		srcBlend: 2,
		destBlend: 1,
		specularPower: 1,
		word144: 0,
		shaders: [
			{
				name: "L2DIFFUSET0",
				params: [...words(5, 0.1, 0.9), 0, 0, 0, 0, 0, 0, 0, 0],
				textures: [
					{
						name: "QUAD.DDS",
						flags: 0x18,
						flags2: 0x20,
						word68: -1,
						count: 1,
						settings: [1, 3, floatWord(1), 0, 0, 0, 1, 0, floatWord(1), 0, ...words(0.1, 0.9, 5), ...new Array(13).fill(0)],
					},
				],
			},
		],
	};
}

function quad(): Gmt {
	const meshes = [quadMesh()];
	const { faces, planes } = facesOf(meshes);
	return {
		kind: "gmt",
		layout: "new",
		bits: 32,
		flags: 0x04000000,
		name: "quad",
		box: boxOf(meshes),
		lod: [0, 500],
		distance2: 0,
		position: [0, 0, 0],
		meshes,
		faces,
		planes,
		bones: [],
		materials: [quadMaterial()],
	};
}

describe("a GMT made from nothing", () => {
	it("is a textured quad written and read back field by field", () => {
		const g = quad();
		const bytes = writeGmt(g);
		const back = readGmt(bytes);
		expect(back).toEqual(g);
		if (back.kind !== "gmt") throw new Error("read as scrambled");
		// (each field on its own, so a difference names itself)
		expect(back.name).toBe("quad");
		expect(back.flags).toBe(0x04000000);
		expect(back.box).toEqual(g.box);
		expect(back.position).toEqual([0, 0, 0]);
		const [m] = back.meshes;
		expect(m?.vertices).toEqual(g.meshes[0]?.vertices);
		expect(m?.indices).toEqual([0, 1, 2, 2, 3, 0]);
		expect(m?.material).toBe(0);
		expect(m?.raw).toBeUndefined();
		expect(back.faces).toEqual(g.faces);
		expect(back.planes).toEqual([{ normal: [0, 1, 0], flags: 1 }]);
		expect(back.materials[0]?.shaders[0]?.name).toBe("L2DIFFUSET0");
		expect(back.materials[0]?.shaders[0]?.textures.map((t) => t.name)).toEqual(["QUAD.DDS"]);
		expect(back.materials[0]?.shaders[0]?.params.slice(0, 3).map(wordFloat)).toEqual(words(5, 0.1, 0.9).map(wordFloat));
		expect(back.header).toBeUndefined();
	});

	it("has the shape of the samples: their box and faces, their header table, the exporter’s mark", () => {
		const g = quad();
		expect(g.box.min).toEqual([-1, 0, -1]);
		expect(g.box.max).toEqual([1, 0, 1]);
		expect(g.box.corners[0]).toEqual([-1, 0, -1]);
		expect(g.box.corners[6]).toEqual([1, 0, 1]);
		expect(g.box.centre).toEqual([0, 0, 0]);
		expect(g.box.radius).toBe(Math.fround(Math.SQRT2));
		expect(g.faces.map((f) => [f.corners, f.axis, f.plane])).toEqual([
			[[0, 1, 2], 2, 0],
			[[2, 3, 0], 2, 0],
		]);
		const b = writeGmt(g);
		const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
		// (as xfinish.gmt: the same counts, so the same places and size)
		expect(b).toHaveLength(1964);
		expect(dv.getUint32(0, true)).toBe(1516);
		const table = Array.from({ length: 12 }, (_, i) => dv.getUint32(0x13c + i * 4, true));
		expect(table).toEqual([4, 0x460, 6, 0x5e0, 1, 0x374, 2, 0x410, 1, 0x450, 0, 0x460]);
		expect(Buffer.from(b.subarray(0x1bc, 0x1cc)).toString("hex")).toBe("c8cfd2d8ced8e6c3d6ded8bebbabc190");
		expect(Buffer.from(b.subarray(0x17c, 0x181)).toString("latin1")).toBe("quad\0");
	});

	it("refuses what its layout cannot hold", () => {
		const long = quad();
		long.name = "x".repeat(64);
		expect(() => writeGmt(long)).toThrow(/longer than 63/);
		const far = quad();
		(far.meshes[0] as GmtMesh).indices[0] = 70_000;
		expect(() => writeGmt(far)).toThrow(/16 bits/);
	});
});

describe.skipIf(!existsSync(MODDEV))("ModDev's GMTs", () => {
	it("are each read and written again byte for byte", { timeout: 600_000 }, () => {
		const files = [...gmts(MODDEV)];
		expect(files.length).toBeGreaterThanOrEqual(762);
		const differ: string[] = [];
		let scrambled = 0;
		let largest = 0;
		for (const p of files) {
			const b = new Uint8Array(readFileSync(p));
			largest = Math.max(largest, b.length);
			let at: number;
			try {
				const g = readGmt(b);
				if (g.kind === "encrypted") scrambled++;
				at = differAt(writeGmt(g), b);
			} catch (e) {
				differ.push(`${p}: ${(e as Error).message}`);
				continue;
			}
			if (at >= 0) differ.push(`${p}: differs from byte ${at}`);
		}
		expect(differ).toEqual([]);
		// (Joesville's pcrew_maps/PIT_HELMET.GMT, kept as its bytes)
		expect(scrambled).toBe(1);
		expect(largest).toBeGreaterThan(8_000_000);
	});

	it("read xfinish.gmt, the smallest, as the quad is made", () => {
		const g = readGmt(new Uint8Array(readFileSync(XFINISH)));
		if (g.kind !== "gmt") throw new Error("read as scrambled");
		expect(g.name).toBe("xfinish");
		expect(g.layout).toBe("new");
		expect(g.bits).toBe(32);
		expect(g.meshes.map((m) => [m.vertices.length, m.indices.length, m.flags])).toEqual([[4, 6, 0x4080]]);
		expect(g.faces).toHaveLength(2);
		expect(g.planes).toHaveLength(1);
		const [m] = g.materials;
		expect(m?.name).toBe("SWHEEL_TRACKMAP");
		expect(m?.shaders.map((s) => [s.name, s.textures.map((t) => t.name)])).toEqual([["L2DIFFUSET0", ["SWHEEL_TRACKMAP.DDS"]]]);
		// (its records all made again from their fields: nothing kept as stored)
		expect(g.header).toBeUndefined();
		expect(g.meshes[0]?.raw).toBeUndefined();
		expect(m?.raw).toBeUndefined();
		// (its box and planes as boxOf and facesOf make them, and its faces' corners and axes; their middles near the exporter's, which are near the corners' mean
		// but not it)
		expect(boxOf(g.meshes)).toEqual(g.box);
		const made = facesOf(g.meshes);
		expect(made.planes).toEqual(g.planes);
		expect(made.faces.map((f) => [f.mesh, f.corners, f.axis, f.plane])).toEqual(g.faces.map((f) => [f.mesh, f.corners, f.axis, f.plane]));
		for (const [i, f] of made.faces.entries()) {
			const s = g.faces[i];
			const off = Math.hypot(...f.centre.map((x, k) => x - (s?.centre[k] ?? Number.NaN)));
			expect(off).toBeLessThan(0.01 * (s?.radius ?? 0));
			expect(Math.abs(f.radius - (s?.radius ?? 0))).toBeLessThan(0.01 * (s?.radius ?? 0));
		}
		// (the quad's material is xfinish's but for its name and flags, 0x68900003 there and on the older exporter's, 0x68902003 on most: the same settings word
		// for word)
		const q = quadMaterial();
		expect(m?.flags).toBe(0x68900003);
		expect({ ...m, name: q.name, flags: q.flags, shaders: [] }).toEqual({ ...q, shaders: [] });
		expect(m?.shaders[0]?.params).toEqual(q.shaders[0]?.params);
		expect(m?.shaders[0]?.textures[0]?.settings).toEqual(q.shaders[0]?.textures[0]?.settings);
	});
});
