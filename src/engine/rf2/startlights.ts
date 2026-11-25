// A working start gantry's lamps as rFactor 2 lights them, as LochDrummond's are: the gantry's lamps (its KS_START_LIGHT_<n> meshes, AC's) in a GMT of their own
// named StartLight, its instance named StartLight in the layout's scene. Each lamp has its own material, its texture two frames (off, on: <name>00.dds,
// <name>01.dds; no <name>.dds, as LochDrummond has none) that the game steps through as the start counts down: each lamp lit in turn, then all out at once, the
// start. The GDB's NumStartingLights is how many steps that is. The materials are LochDrummond's (its RDLTA to RDLTE) but for their frames' name.
import type { Picture } from "../dds";
import { floatWord, type GmtMaterial } from "./gmt";

/** a working gantry's lamp, AC's name for it (its number its place in the sequence) */
export const START_LAMP = /^KS_START_LIGHT_(\d+)$/;
/** the instance the game lights the start with (its name the game's), and its GMT's own name */
export const START_LIGHT = "StartLight";
/** the lamps' texture: <name>.dds named in the materials, its frames <name>00.dds (off) and <name>01.dds (on) the files */
export const LAMP_TEXTURE = "startlamp";
/** the lamps' frames' side, in pixels (LochDrummond's are 256) */
const LAMP_SIDE = 64;

/** The steps of a start with so many lamps: each lit in turn, then all out (LochDrummond's five lamps: 6). */
export const startingLights = (lamps: number): number => lamps + 1;

/** Which frame a lamp shows at each step (0 off, 1 on), from before the first to after the start: lamp i (from 0) lit from step i + 1 until all go out. */
export function lampFrames(i: number, lamps: number): number[] {
	return Array.from({ length: startingLights(lamps) + 1 }, (_, step) => (step > i && step <= lamps ? 1 : 0));
}

/** A lamp's material, LochDrummond's: its dashboard shader (L2DASHBOARD, lit on its own, as bright at night) and its texture's two frames stepped by the start. */
export function lampMaterial(name: string, i: number, lamps: number): GmtMaterial {
	const words = [floatWord(5), floatWord(0.1), floatWord(0.9)];
	return {
		name,
		flags: 0x68902003,
		ambient: [1, 1, 1, 0],
		diffuse: [1, 1, 1, 1],
		specular: [0, 0, 0, 0],
		emissive: [1, 1, 1, 0],
		srcBlend: 2,
		destBlend: 1,
		specularPower: 1,
		word144: 0,
		shaders: [
			{
				name: "L2DASHBOARD",
				params: [...words, 0, 0, 0, 0, 0, 0, 0, 0],
				textures: [
					{
						name: `${LAMP_TEXTURE}.dds`,
						flags: 0x18,
						flags2: 0x20,
						word68: -1,
						count: 2,
						settings: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, floatWord(0.1), floatWord(0.9), floatWord(5), ...new Array(13).fill(0)],
						animation: { frames: lampFrames(i, lamps), next: 5, rate: 1 },
					},
				],
			},
		],
	};
}

/** The lamps' frames: off (dark red glass) and on (bright red), each a square of its colour. */
export function lampPictures(): { off: Picture; on: Picture } {
	const square = (rgb: [number, number, number]): Picture => {
		const data = new Uint8Array(LAMP_SIDE * LAMP_SIDE * 4);
		for (let k = 0; k < LAMP_SIDE * LAMP_SIDE; k++) data.set([...rgb, 255], k * 4);
		return { width: LAMP_SIDE, height: LAMP_SIDE, mode: "RGBA", data };
	};
	return { off: square([48, 6, 6]), on: square([255, 24, 16]) };
}
