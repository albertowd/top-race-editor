// How worn the track looks: its paint (objects.json's `wear`: new, almost new, used or very used) and the rubber its cars have laid on the roads (its rubber
// marks, each almost new, used or very used). The build makes the paint's picture (a tile that repeats): never bright white, the asphalt's grain showing
// through it, worn off in patches and dirtied the more it is used. The paint's meshes take the paint's materials; each rubber mark a band of rubber draped on
// the floor over the road, its paint and its rumbles, its pictures its own all along (rubber.ts; in the paint's model: every layout's).

import type { Wear } from "../domain/types";
import type { Kn5, Kn5Material } from "./kn5tree";
import { pngRgba } from "./pictures";

/** pixels a side of the paint's picture: a metre square of it (its meshes mapped a metre a picture) */
export const WEAR_PICTURE = 512;
/** metres the rubber lies over the floor: over the paint (LINE_LIFT) */
export const RUBBER_LIFT = 0.009;

/** the paint's colours, as the paint's meshes are named by (paint.ts's colour): their materials and pictures */
export const PAINT_WORN = {
	white: { material: "PaintWhite", picture: "PaintWhite_worn.png", rgb: [198, 198, 192] },
	yellow: { material: "PaintYellow", picture: "PaintYellow_worn.png", rgb: [212, 168, 40] },
} as const;
/** Whether a picture is the paint's (one of PAINT_WORN's). */
export const isPaintPicture = (name: string): boolean => Object.values(PAINT_WORN).some((p) => p.picture.toLowerCase() === name.toLowerCase());
/** the asphalt's grey the paint is dirtied toward (and that shows through it) */
export const ASPHALT_GREY = 92;
/** the rubber's colour: a tyre's dark grey, not black (near black, a layer shows only the sun's sheen on it, yellow at low sun, where the road under it shows
 * the sky's blue in its grey too) */
export const RUBBER = { material: "Rubber", rgb: [22, 22, 22] } as const;
/** The rubber's n-th page of pictures (from 0): its material and picture (Rubber_1, Rubber_1.png). */
export const rubberPage = (n: number) => ({ material: `${RUBBER.material}_${n + 1}`, picture: `Rubber_${n + 1}.png` });
/** Whether a picture is a page of the rubber's (AC's build makes it a DDS with an alpha of its own). */
export const isRubberPage = (name: string): boolean => /^Rubber_\d+\.(png|dds)$/i.test(name);

/** Each wear's paint: how much of it is the asphalt's grain showing through (a share of it), worn off in patches (a share), dirtied (a share of the way to the
 * asphalt's grey), and how opaque it is. */
const PAINT_WEAR: Record<Wear, { grain: number; patches: number; dirt: number; alpha: number }> = {
	new: { grain: 0.05, patches: 0, dirt: 0.04, alpha: 0.93 },
	almost_new: { grain: 0.1, patches: 0.08, dirt: 0.12, alpha: 0.88 },
	used: { grain: 0.18, patches: 0.2, dirt: 0.24, alpha: 0.8 },
	very_used: { grain: 0.28, patches: 0.34, dirt: 0.34, alpha: 0.72 },
};

/** Each wear's rubber: how dark it is at its darkest (its opacity). New: none. */
const RUBBER_WEAR: Record<Wear, { alpha: number } | null> = {
	new: null,
	almost_new: { alpha: 0.34 },
	used: { alpha: 0.56 },
	very_used: { alpha: 0.78 },
};

/** How dark a wear's rubber is at its darkest (its opacity; new: none). */
export const rubberAlpha = (w: Wear): number => RUBBER_WEAR[w]?.alpha ?? 0;

// ---- noise that repeats with its picture ---------------------------------------------------------------------------

/** A lattice of random values, period wide either way (the same for the same seed). */
function lattice(period: number, seed: number): Float32Array {
	let s = seed >>> 0 || 1;
	const out = new Float32Array(period * period);
	for (let i = 0; i < out.length; i++) {
		// (mulberry32)
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	return out;
}

/** Value noise of a lattice, periodX by periodY cells over the picture (u, v: 0 to 1), smooth between its values, repeating at the picture's edges: 0 to 1. */
function noiseAt(lat: Float32Array, period: number, u: number, v: number, px = period, pz = period): number {
	const x = u * px;
	const z = v * pz;
	const i = Math.floor(x);
	const j = Math.floor(z);
	const fx = x - i;
	const fz = z - j;
	const sx = fx * fx * (3 - 2 * fx);
	const sz = fz * fz * (3 - 2 * fz);
	const at = (a: number, b: number) => lat[(((b % pz) + pz) % pz) * period + (((a % px) + px) % px)] as number;
	return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sz) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sz;
}

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

// ---- the pictures ----------------------------------------------------------------------------------------------------

/** The paint's picture (a metre square of it, repeating), of a colour and a wear: its colour never bright, shaded by the asphalt's grain under it, the grain
 * showing through where the paint does not cover it, worn off in patches and dirtied, the more the more it is used. RGBA, row after row. */
export function paintPicture(colour: keyof typeof PAINT_WORN, wear: Wear, size = WEAR_PICTURE): Uint8Array {
	const w = PAINT_WEAR[wear];
	const [r0, g0, b0] = PAINT_WORN[colour].rgb;
	const coarse = lattice(64, colour === "white" ? 11 : 12);
	const fine = lattice(128, colour === "white" ? 21 : 22);
	const mid = lattice(16, 31);
	const big = lattice(4, 41);
	const out = new Uint8Array(size * size * 4);
	// (the grain's level a share of the picture lies under: its pits)
	const pits = 0.32 + w.grain * 0.6;
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const u = x / size;
			const v = y / size;
			// (the stones: clumps of a centimetre or two, rough at their edges)
			const grain = 0.6 * noiseAt(coarse, 64, u, v) + 0.4 * noiseAt(fine, 128, u, v);
			const m = noiseAt(mid, 16, u, v);
			const p = 0.6 * noiseAt(big, 4, u, v) + 0.4 * m;
			// (shaded by the stones under it; dirtier where the mid noise is low)
			const shade = 0.9 + 0.16 * (grain - 0.5);
			const dirt = w.dirt * (0.6 + 0.8 * (0.5 - m));
			const mix = (c: number) => Math.round(Math.min(255, Math.max(0, (c * (1 - dirt) + ASPHALT_GREY * dirt) * shade)));
			let a = w.alpha;
			// (the grain's pits: the asphalt there; worn patches: the paint thin there)
			a *= 0.25 + 0.75 * smoothstep(pits - 0.08, pits + 0.04, grain);
			if (w.patches > 0) a *= 1 - 0.85 * smoothstep(1 - w.patches - 0.1, 1 - w.patches + 0.1, 1 - p);
			out.set([mix(r0), mix(g0), mix(b0), Math.round(255 * Math.min(1, Math.max(0, a)))], (y * size + x) * 4);
		}
	return out;
}

/** A material of its own (its picture in the model), drawn over the floor as the paint is: blended, not writing the depth; with the sheen given (its strength
 * and tightness, and its ambient where not the diffuse's share). */
export function wornMaterial(
	name: string,
	picture: string,
	diffuse: number,
	sheen: { specular: number; exp: number; ambient?: number } = { specular: 0.04, exp: 6 },
): Kn5Material {
	const props: [string, number][] = [
		["ksAmbient", sheen.ambient ?? diffuse * 0.55],
		["ksDiffuse", diffuse],
		["ksSpecular", sheen.specular],
		["ksSpecularEXP", sheen.exp],
		["ksEmissive", 0],
		["ksAlphaRef", 1],
	];
	return {
		name,
		shader: "ksPerPixel",
		blend: 1,
		alpha_tested: 0,
		depth_mode: 1,
		props: props.map(([n, value]) => ({ name: n, value, rest: new Uint8Array(36) })),
		textures: [{ sampler: "txDiffuse", slot: 0, name: picture }],
		own: true,
	};
}

/** A model given a material of its own and its picture (made once a model). */
export async function giveMaterial(
	k: Kn5,
	material: string,
	picture: string,
	rgba: () => Uint8Array | null,
	diffuse: number,
	sheen?: { specular: number; exp: number; ambient?: number },
	width = WEAR_PICTURE,
): Promise<boolean> {
	if (k.materials.some((m) => m.name === material)) return true;
	const px = rgba();
	if (!px) return false;
	// (width wide, as many rows as it has)
	if (!k.textures.some((t) => t.name === picture)) k.textures.push({ name: picture, active: 1, data: await pngRgba(px, width, px.length / 4 / width) });
	k.materials.push(wornMaterial(material, picture, diffuse, sheen));
	return true;
}

/** the paint's materials' diffuse: less than the library's old paint's (0.55), never glaring */
export const PAINT_DIFFUSE = 0.42;
/** The rubber's light in AC: the road's (the library's tarmac: ambient and diffuse 0.2, its specular 0.4 and its exponent 25 times its maps' 0.22), so a mark
 * only darkens the road's colour and keeps its sheen as it is. Shinier than the road, smooth over it, it shows the sun as oil does; matt, it blots the road's
 * sheen out. */
export const RUBBER_DIFFUSE = 0.2;
export const RUBBER_SHEEN = { ambient: 0.2, specular: 0.09, exp: 6 };
/** The rubber's roughness in BeamNG: the road's (the library's tarmac's roughness maps, 0.78 on average). Rougher, a mark's broad sheen shows the low sun where
 * the road does not. */
export const RUBBER_ROUGHNESS = 0.78;
