// A layout's placed objects in rFactor 2, as Joesville's cones are: a GMT each, about its place (its position), its model turned by its heading; an instance of
// it knocked about. The location's pictures' parts: a TGA as the samples', which way a lap runs, where it starts, the GDB naming the venue's icon.
import { describe, expect, it } from "vitest";
import type { TemplatePart } from "../templates";
import { diffuseMaterial, gmtMeshOf, staticGmt } from "./build";
import { readGmt, writeGmt } from "./gmt";
import { OBJECT_FAR, objectGmt, objectInstance, turnedMesh } from "./objects";
import { clockwise, layoutPictureFiles, mapLine, roadMap, startOn, tga, venueIconFile } from "./pictures";
import { gdbText, scnText } from "./text";

/** A part of one triangle: its corners eleven numbers each (place, normal, u v, tangent). */
const part = (pts: number[][]): TemplatePart => {
	const V = new Float64Array(pts.length * 11);
	pts.forEach((p, i) => {
		V.set([p[0] as number, p[1] as number, p[2] as number, 0, 1, 0, i / 2, 0, 1, 0, 0], i * 11);
	});
	return { part: "cone", V, F: Int32Array.from([0, 1, 2]), material: "OutCone" };
};

describe("rFactor 2's placed objects", () => {
	it("turns a model by its heading about its own origin, as the AC build places it", () => {
		const m = turnedMesh(
			part([
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1],
			]),
			Math.PI / 2,
		);
		// (a quarter turn: x to -z, z to x; up stays)
		const at = (k: number) => Array.from(m.v.slice(k * 8, k * 8 + 3)).map((x) => Math.round(x * 1e6) / 1e6 + 0);
		expect(at(0)).toEqual([0, 0, -1]);
		expect(at(1)).toEqual([0, 1, 0]);
		expect(at(2)).toEqual([1, 0, 0]);
		expect(Array.from(m.v.slice(3, 6)).map((x) => Math.round(x) + 0)).toEqual([0, 1, 0]);
	});

	it("makes a cone's GMT about its place, that place its position, drawn as Joesville's cones", () => {
		const mesh = gmtMeshOf(
			turnedMesh(
				part([
					[0.2, 0, 0],
					[0, 0.6, 0],
					[0, 0, 0.2],
				]),
				0,
			),
			0,
		);
		const g = objectGmt("cone_abc", { x: 10, y: 1, z: -20 }, [mesh as NonNullable<typeof mesh>], [diffuseMaterial("c", "cone.dds")], staticGmt);
		// (rFactor's axes: x, y, -z)
		expect(g.position).toEqual([10, 1, 20]);
		expect(g.lod).toEqual([0, OBJECT_FAR]);
		// (its box about the pivot, not the world)
		expect(Math.max(...g.box.corners.flat().map(Math.abs))).toBeLessThan(1);
		const back = readGmt(writeGmt(g));
		expect(back.kind === "gmt" && back.position).toEqual([10, 1, 20]);
	});

	it("puts it in a scene knocked about, hit and casting its shadow", () => {
		const scn = scnText({ searchPaths: ["."], instances: [objectInstance("cone_abc")], lights: [] });
		expect(scn).toMatch(
			/Instance=cone_abc\r?\n\{\r?\n {2}Moveable=True\r?\n {2}MeshFile=cone_abc\.gmt CollTarget=True HATTarget=False ShadowCaster=\(Static, Solid\)/,
		);
	});
});

describe("rFactor 2's pictures", () => {
	it("writes a TGA as the samples are: 32 bits, its rows from the bottom, eight bits of alpha", () => {
		const px = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 9, 9, 255]);
		const b = tga({ width: 2, height: 2, mode: "RGBA", data: px });
		expect([b[2], b[12], b[14], b[16], b[17]]).toEqual([2, 2, 2, 32, 8]);
		// (the bottom row first, blue green red alpha)
		expect(Array.from(b.slice(18, 26))).toEqual([255, 0, 0, 0, 9, 9, 9, 255]);
		expect(Array.from(b.slice(26, 34))).toEqual([0, 0, 255, 255, 0, 255, 0, 128]);
	});

	it("knows which way a lap runs and where it starts, the way it runs there", () => {
		// (a square lap, the track's x y z: north is -z; east, then north, then west: anticlockwise seen from above)
		const pts = [0, 0, 0, 10, 0, 0, 10, 0, -10, 0, 0, -10];
		const line = mapLine(pts).map((v) => v + 0);
		expect(line).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
		expect(clockwise(line)).toBe(false);
		expect(clockwise([0, 0, 0, 10, 10, 10, 10, 0])).toBe(true);
		// (a start facing backwards along the lap turned to run with it)
		const s = startOn(line, { x: 5, y: 0, z: 0, heading: -Math.PI / 2 });
		expect(s.at.map((v) => v + 0)).toEqual([5, 0]);
		expect(s.fwd.map((v) => Math.round(v) + 0)).toEqual([1, 0]);
	});

	it("maps the venue's roads once: a second layout's shared road left out, its shortcut and a loop apart kept", () => {
		// (a 100 m square lap, a point a metre; a second the same but cutting across at y = 50; a loop far off)
		const square: number[] = [];
		for (let i = 0; i < 100; i++) square.push(i, 0);
		for (let i = 0; i < 100; i++) square.push(100, i);
		for (let i = 100; i > 0; i--) square.push(i, 100);
		for (let i = 100; i > 0; i--) square.push(0, i);
		const cut: number[] = [];
		for (let i = 0; i < 100; i++) cut.push(i, 0);
		for (let i = 0; i < 50; i++) cut.push(100, i);
		for (let i = 100; i > 0; i--) cut.push(i, 50);
		for (let i = 50; i > 0; i--) cut.push(0, i);
		const loop = [500, 500, 520, 500, 520, 520, 500, 520];
		const map = roadMap([square, cut, loop]);
		expect(map.laps).toEqual([square, loop]);
		expect(map.runs).toHaveLength(1);
		const run = map.runs[0] as number[];
		// (the shortcut across, from the square's side to its other side, a point into each)
		const ys = new Set<number>();
		for (let i = 1; i < run.length; i += 2) ys.add(run[i] as number);
		expect([...ys].filter((y) => y === 50).length).toBe(1);
		expect(Math.max(...run.filter((_, i) => i % 2 === 0))).toBeGreaterThanOrEqual(94);
		expect(Math.min(...run.filter((_, i) => i % 2 === 0))).toBeLessThanOrEqual(6);
	});

	it("names its pictures as rFactor's tracks do, the venue's icon in each GDB", () => {
		expect(layoutPictureFiles("vp_1500")).toEqual({
			icon: "vp_1500icon.tga",
			thumb: "vp_1500Thmb.tga",
			tile: "vp_1500SMicon.dds",
			wheel: "swheel_trackmap.dds",
			loading: "vp_1500_loading.jpg",
		});
		const gdb = gdbText({
			id: "vp_1500",
			trackName: "T",
			eventName: "T",
			venueName: "V",
			length: 1000,
			tdf: "..\\v.tdf",
			venueIcon: `v\\${venueIconFile("v")}`,
		});
		expect(gdb).toContain("  VenueIcon = v\\vIcon.dds\r\n");
	});
});
