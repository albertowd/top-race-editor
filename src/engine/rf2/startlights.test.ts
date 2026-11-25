// A working gantry's lamps in rFactor 2, as LochDrummond's: each lamp lit in turn, then all out; their materials' two frames stepped by the start; one StartLight a
// scene; the GDB counting its steps.
import { describe, expect, it } from "vitest";
import { gmtMeshOf, oneStartLight, startingLightsOf, staticGmt } from "./build";
import { readGmt, writeGmt } from "./gmt";
import { turnedMesh } from "./objects";
import { LAMP_TEXTURE, lampFrames, lampMaterial, START_LAMP, START_LIGHT, startingLights } from "./startlights";
import { gdbText, type Instance } from "./text";

describe("rFactor 2's start lights", () => {
	it("lights each lamp in turn, then puts them all out, as LochDrummond's five", () => {
		expect(startingLights(5)).toBe(6);
		expect(lampFrames(0, 5)).toEqual([0, 1, 1, 1, 1, 1, 0]);
		expect(lampFrames(2, 5)).toEqual([0, 0, 0, 1, 1, 1, 0]);
		expect(lampFrames(4, 5)).toEqual([0, 0, 0, 0, 0, 1, 0]);
	});

	it("knows a working gantry's lamps by AC's names, not a still one's", () => {
		expect(START_LAMP.exec("KS_START_LIGHT_3")?.[1]).toBe("3");
		expect(START_LAMP.test("NO_START_LIGHT_3")).toBe(false);
	});

	it("gives each lamp a material of two frames the start steps, kept so in its GMT", () => {
		const m = lampMaterial("STARTLAMP1", 1, 5);
		expect(m.shaders[0]?.name).toBe("L2DASHBOARD");
		const t = m.shaders[0]?.textures[0];
		expect(t?.name).toBe(`${LAMP_TEXTURE}.dds`);
		expect(t?.count).toBe(2);
		expect(t?.animation?.frames).toEqual([0, 0, 1, 1, 1, 1, 0]);
		expect(m.emissive).toEqual([1, 1, 1, 0]);
		const V = Float64Array.from([0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0]);
		const lamp = gmtMeshOf(turnedMesh({ part: "KS_START_LIGHT_1", V, F: Int32Array.from([0, 1, 2]), material: "StartLamp" }, 0), 0);
		const back = readGmt(writeGmt(staticGmt("track_gantry_startlight", [lamp as NonNullable<typeof lamp>], [m])));
		expect(back.kind === "gmt" && back.materials[0]?.shaders[0]?.textures[0]?.animation?.frames).toEqual([0, 0, 1, 1, 1, 1, 0]);
	});

	it("keeps one StartLight a scene, and counts the steps of the first working gantry's lamps", () => {
		const inst = (name: string, mesh: string): Instance => ({ name, mesh, collide: false, hat: false });
		const kept = oneStartLight([inst(START_LIGHT, "a.gmt"), inst("road", "road.gmt"), inst(START_LIGHT, "b.gmt")]);
		expect(kept.map((i) => i.mesh)).toEqual(["a.gmt", "road.gmt"]);
		const lamps = new Map([["track_gantry_1500", 5]]);
		expect(startingLightsOf(["track", "track_gantry_1000_still", "track_gantry_1500"], lamps)).toBe(6);
		expect(startingLightsOf(["track", "track_gantry_1500_still"], lamps)).toBeUndefined();
	});

	it("writes the steps in the GDB, 5 where it has no gantry of its own", () => {
		const base = { id: "vp", trackName: "T", eventName: "T", venueName: "V", length: 1000, tdf: "..\\v.tdf" };
		expect(gdbText({ ...base, startingLights: 6 })).toContain("  NumStartingLights = 6\r\n");
		expect(gdbText(base)).toContain("  NumStartingLights = 5\r\n");
	});
});
