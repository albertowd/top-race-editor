// @vitest-environment node
// What a track's export needs of its models and its layouts: a picture the track's textures lack kept in the model itself, and read back; a material's picture
// the model lacks found where the track keeps them (the game draws a missing one with another of the file's pictures); the ground mapped as the one it replaces
// (a picture over the whole place stays one); a race of a layout as many karts as grid slots with pit boxes.
import { describe, expect, it } from "vitest";
import { raceKarts } from "./acbuild";
import { fromGltf, toGltf } from "./gltf";
import { type Kn5, type Kn5Material, type Kn5Mesh, VERT } from "./kn5tree";
import { BACK_RAMP, CONCRETE_NOTCHES, FLOOR_DIPS, kerbGeometry } from "./paint";
import { flatMapping } from "./trackfloor";
import { byCell } from "./trackobjects";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const MAT = Float64Array.from(IDENTITY);

/** A flat square mesh of (x, z) corners, mapped by uv(x, z). */
function square(name: string, material: number, uv: (x: number, z: number) => [number, number], size = 10): Kn5Mesh {
	const corners: [number, number][] = [
		[0, 0],
		[size, 0],
		[size, size],
		[0, size],
	];
	const verts = new Float32Array(corners.length * VERT);
	corners.forEach(([x, z], i) => {
		verts.set([x, 0, z, 0, 1, 0, ...uv(x, z), 1, 0, 0], i * VERT);
	});
	return {
		kind: 2,
		name,
		active: 1,
		children: [],
		verts,
		faces: Uint16Array.from([0, 2, 1, 0, 3, 2]),
		material,
		cast_shadows: 1,
		visible: 1,
		transparent: 0,
		layer: 0,
		lod_in: 0,
		lod_out: 0,
		sphere: [size / 2, 0, size / 2, size],
		renderable: 1,
	};
}

const material = (name: string, texture: string): Kn5Material => ({
	name,
	shader: "ksPerPixel",
	blend: 0,
	alpha_tested: 0,
	depth_mode: 0,
	props: [],
	textures: [{ sampler: "txDiffuse", slot: 0, name: texture }],
});

const png = (n: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, n]);

function model(textures: Kn5["textures"], materials: Kn5Material[]): Kn5 {
	return {
		version: 6,
		extra: 0,
		textures,
		materials,
		root: {
			kind: 1,
			name: "root",
			active: 1,
			matrix: [...IDENTITY],
			children: materials.map((_, i) => square(`MESH_${i}`, i, (x, z) => [x, z])),
		},
	};
}

describe("the export's models", () => {
	it("keep a picture the track lacks inside the model, and read it back", async () => {
		const k = model([{ name: "kart_seat.jpg", active: 1, data: png(7) }], [material("seat", "kart_seat.jpg")]);
		const { doc, bin } = toGltf(k, () => null);
		expect(doc.images?.[0]).toMatchObject({ name: "kart_seat.jpg", mimeType: "image/png" });
		expect(doc.images?.[0]?.uri).toBeUndefined();
		const back = await fromGltf(doc, bin, async (uri) => {
			throw new Error(`no file ${uri}`);
		});
		expect(back.textures.map((t) => [t.name, [...t.data]])).toEqual([["kart_seat.jpg", [...png(7)]]]);
	});

	it("find a material's picture the model lacks where the track keeps them; skip one found nowhere", async () => {
		const k = model(
			[{ name: "LinePaint.dds", active: 1, data: png(1) }],
			[material("LinePaint", "LinePaint.dds"), material("PitLinePaint", "PitLinePaint.dds"), material("Gate", "Gate.dds")],
		);
		const { doc, bin } = toGltf(k, (t) => `../textures/${t.name}`);
		const back = await fromGltf(
			doc,
			bin,
			async () => png(1),
			async (name) => {
				if (name === "PitLinePaint.dds") return png(2);
				throw new Error(`${name} is not in source/textures`);
			},
		);
		expect(back.textures.map((t) => t.name)).toEqual(["LinePaint.dds", "PitLinePaint.dds"]);
		expect([...(back.textures[1]?.data ?? [])]).toEqual([...png(2)]);
	});

	it("map the ground as the one it replaces: a picture over the whole place stays one; else none", () => {
		const satellite = flatMapping(
			square("1GRASS_0", 0, (x, z) => [0.5 - x / 1060, 0.5 - z / 1060]),
			MAT,
		);
		expect(satellite?.(530, -530)[0]).toBeCloseTo(0, 6);
		expect(satellite?.(530, -530)[1]).toBeCloseTo(1, 6);
		// (a mapping that is not a plane over the ground: none)
		expect(
			flatMapping(
				square("1GRASS_0", 0, (x, z) => [x * z, z]),
				MAT,
			),
		).toBeNull();
	});
});

describe("a long object drawn only so near (a tyre wall)", () => {
	it("is cut in MERGE_CELL squares, by where each face is, its points its own", () => {
		// (two faces 30 m apart: two squares, three points each)
		const pt = (x: number, z: number) => [x, 0, z, 0, 1, 0, 0, 0, 1, 0, 0];
		const V = Float64Array.from([...pt(1, 1), ...pt(2, 1), ...pt(1, 2), ...pt(31, 1), ...pt(32, 1), ...pt(31, 2)]);
		const cells = byCell(V, [0, 1, 2, 3, 4, 5]);
		expect([...cells.keys()]).toEqual(["0_0", "1_0"]);
		expect(cells.get("1_0")?.F).toEqual([0, 1, 2]);
		expect(cells.get("1_0")?.V[0]).toBe(31);
	});
});

describe("a rumble's picture", () => {
	it("keeps its proportions along it: as long as the picture has its stripes, whatever its width", () => {
		const road = {
			name: "R",
			curve: [
				{
					p: [0, 0] as [number, number],
					in: [0, 0] as [number, number],
					out: [33, 0] as [number, number],
					left: 4,
					right: 4,
				},
				{
					p: [100, 0] as [number, number],
					in: [-33, 0] as [number, number],
					out: [0, 0] as [number, number],
					left: 4,
					right: 4,
				},
			],
		};
		const roads = { R: road };
		const uPerM = (width: number, aspect?: number) => {
			const [g] = kerbGeometry(
				road,
				{ side: "left", kind: "floor", from: 20, to: 60, width },
				roads,
				() => 0,
				() => aspect,
			);
			if (!g) throw new Error("no rumble");
			// (the u of its points along the road: its rise over x)
			let lo = Number.POSITIVE_INFINITY;
			let hi = Number.NEGATIVE_INFINITY;
			let ulo = 0;
			let uhi = 0;
			for (let i = 0; i < g.P.length / 3; i++) {
				const x = g.P[i * 3] as number;
				if (x < lo) [lo, ulo] = [x, g.U[i * 2] as number];
				if (x > hi) [hi, uhi] = [x, g.U[i * 2] as number];
			}
			return (uhi - ulo) / (hi - lo);
		};
		// (the floor kerb's picture: 4 to 1, the whole of it across: a quarter of its width's u a metre)
		expect(uPerM(1, 0.25)).toBeCloseTo(0.25, 2);
		expect(uPerM(0.5, 0.25)).toBeCloseTo(0.5, 2);
		// (no picture known: its kind's own u a metre)
		expect(uPerM(1)).toBeCloseTo(0.21, 2);
	});

	it("a floor rumble dipped under its picture's gaps, a ramp + concrete's concrete U-notched down to the ground; a raised one's edge straight down", () => {
		const road = {
			name: "R",
			curve: [
				{
					p: [0, 0] as [number, number],
					in: [0, 0] as [number, number],
					out: [33, 0] as [number, number],
					left: 4,
					right: 4,
				},
				{
					p: [100, 0] as [number, number],
					in: [-33, 0] as [number, number],
					out: [0, 0] as [number, number],
					left: 4,
					right: 4,
				},
			],
		};
		const roads = { R: road };
		const [floor] = kerbGeometry(
			road,
			{ side: "left", kind: "floor", from: 20, to: 60, width: 1 },
			roads,
			() => 0,
			() => 0.25,
		);
		if (!floor) throw new Error("no rumble");
		// (as the photo has it: level with the road; a V dip under each gap between the picture's bars, its lowest FLOOR_DIPS.deep down where the gap's middle is,
		// across the barred part only, nothing at the block's frame)
		const n0 = floor.P.length / 3;
		const ys0 = Array.from({ length: n0 }, (_, i) => floor.P[i * 3 + 1] as number);
		const us0 = Array.from({ length: n0 }, (_, i) => ((((floor.U[i * 2] as number) % 1) + 1) % 1) as number);
		const vs0 = Array.from({ length: n0 }, (_, i) => floor.U[i * 2 + 1] as number);
		expect(Math.min(...ys0)).toBeCloseTo(-FLOOR_DIPS.deep, 6);
		expect(Math.max(...ys0)).toBeCloseTo(0, 6);
		expect(vs0.every((v, i) => (v < 0.1 || v > 0.9 ? Math.abs(ys0[i] as number) < 1e-9 : true))).toBe(true);
		const lows = us0.filter((_, i) => (ys0[i] as number) < -FLOOR_DIPS.deep + 1e-6);
		expect(lows.every((u) => FLOOR_DIPS.at.some(([m]) => Math.abs(u - m) < 1e-6))).toBe(true);
		// (40 m at a quarter of the picture a metre: ten pictures, fourteen gaps each, but those at the strip's ends)
		const dips = new Set(
			Array.from({ length: n0 }, (_, i) => i)
				.filter((i) => (ys0[i] as number) < -FLOOR_DIPS.deep + 1e-6)
				.map((i) => Math.round((floor.U[i * 2] as number) * 1e4)),
		).size;
		expect(dips).toBeGreaterThan(10 * 14 - 4);
		expect(dips).toBeLessThanOrEqual(10 * 14 + 1);
		// (a ramp + concrete: its concrete's top edge notched, a notch every CONCRETE_NOTCHES.every metres, its foot on the ground (20 cm up there) whole)
		const [rc] = kerbGeometry(
			road,
			{ side: "left", kind: "ramp_concrete", from: 20, to: 60, width: 1, back: 0.5 },
			roads,
			(_x, z) => (Math.abs(z) <= 4 ? 0 : Number.NaN),
			undefined,
			() => 0.2,
		);
		if (!rc) throw new Error("no rumble");
		const at = (v: number) => Array.from({ length: rc.P.length / 3 }, (_, i) => i).filter((i) => Math.abs((rc.U[i * 2 + 1] as number) - v) < 1e-9);
		const edge = at(0.3).map((i) => rc.P[i * 3 + 1] as number);
		const foot = at(0.967).map((i) => rc.P[i * 3 + 1] as number);
		// (its edge: the ramp's 4.91 cm over the ground's rise there (a fifth of the way out), the notches 3 cm less)
		const lip = 0.0491 + 0.2 * (1 / 1.5);
		expect(Math.max(...edge)).toBeCloseTo(lip, 4);
		expect(Math.min(...edge)).toBeCloseTo(lip - CONCRETE_NOTCHES.deep, 4);
		// (a U: its flat bottom two rows deep)
		const notches = edge.filter((y) => Math.abs(y - (lip - CONCRETE_NOTCHES.deep)) < 1e-4).length / 2;
		expect(notches).toBeGreaterThan(40 / CONCRETE_NOTCHES.every - 3);
		expect(notches).toBeLessThan(40 / CONCRETE_NOTCHES.every + 3);
		expect(foot.every((y) => Math.abs(y - (0.2 - 0.008)) < 1e-9)).toBe(true);
		// (a ramp: from its top down to its road over a centimetre at its back)
		const [ramp] = kerbGeometry(road, { side: "left", kind: "ramp", from: 20, to: 60, width: 1 }, roads, () => 0);
		if (!ramp) throw new Error("no rumble");
		const outer = Math.max(...Array.from({ length: ramp.P.length / 3 }, (_, i) => ramp.P[i * 3 + 2] as number));
		const top = Math.max(...Array.from({ length: ramp.P.length / 3 }, (_, i) => ramp.P[i * 3 + 1] as number));
		const ys = (z: number) =>
			Array.from({ length: ramp.P.length / 3 }, (_, i) => i)
				.filter((i) => Math.abs((ramp.P[i * 3 + 2] as number) - z) < 1e-6)
				.map((i) => ramp.P[i * 3 + 1] as number);
		expect(Math.max(...ys(outer))).toBeCloseTo(0, 6);
		expect(Math.max(...ys(outer - BACK_RAMP))).toBeCloseTo(top, 2);
	});
});

describe("a layout's race", () => {
	it("takes as many karts as grid slots with a pit box", () => {
		const spots = (n: number) => [...Array.from({ length: n }, (_, i) => ({ name: `START_${i}` })), { name: "HOTLAP_START_0" }, { name: "TIME_0_L" }];
		expect(raceKarts({ spots: spots(30), pits: 36 })).toBe(30);
		expect(raceKarts({ spots: spots(30), pits: 16 })).toBe(16);
		expect(raceKarts({ spots: [], pits: 3 })).toBe(3);
	});
});
