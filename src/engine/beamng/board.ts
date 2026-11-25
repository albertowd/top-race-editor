// The start gantry's board and lamps for the BeamNG.drive level (the track's beamng_board.py), as the Custom Shaders Patch script in the track's ext_config.ini
// draws them in Assetto Corsa.
//
// BeamNG draws no text on a texture without a web page, so the board is made the way its own fuel price signs and drag strip timing boards are: a small shape
// for each character, glowing red like LEDs, which the level's Lua (the editor's models/scripts/beamng/board.lua, as lua/ge/extensions/<level>/board.lua) swaps
// as the times change. This makes those shapes, one a character, and board.json: where each character of each row stands on each face of each gantry, laid out
// as the patch script lays out its text on the board's texture, carried onto the board by its mesh's uvs. The start lamps and the flag lamp are shapes of their
// own with a material whose glow BeamNG multiplies by the object's instance colour, as its traffic signals are: the Lua lights them by setting that colour.

import { byCodePoint } from "../order";
import { SLANT, segments } from "../segments";
import type { DaeMesh } from "./dae";
import { CORNER, type TrackMesh } from "./trackmodel";

/** the patch script's board: its display on the texture, and the text on the display, in pixels */
const TEXTURE: [number, number] = [2048, 320];
const DISPLAY_POS: [number, number] = [306, 8];
const LETTER: [number, number] = [30, 60];
const CLOCK_LETTER: [number, number] = [48, 88];
const CLOCK_POS: [number, number] = [609, 146];
const CLOCK_CELLS = 5;
const RANK_X = 0;
const NUMBER_X = LETTER[0] * 2.2;
const TIME_X = LETTER[0] * 5.2;
export const CELLS = { rank: 2, number: 2, time: 8 };
/** metres the characters stand out of the board */
const LIFT_OFF = 0.004;
export const LAMPS = /^(KS|NO)_START_LIGHT_(\d+)$/;
export const FLAGS = /^(GANTRY|STATIC)_FLAG$/;
export const BOARD = "GANTRY_BOARD";
export { SEGMENT_CHARS as GLYPHS } from "../segments";
export const SHAPES = "board";

type V3 = [number, number, number];

/** Where the patch script writes a row on its display: places 1 to 4 on the left, 5 and 6 in the middle, 7 to 10 on the right. */
function rowAt(rank: number): [number, number] {
	if (rank <= 4) return [10, 8 + (rank - 1) * 74];
	if (rank <= 6) return [490, 8 + (rank - 5) * 74];
	return [968, 8 + (rank - 7) * 74];
}

export const glyphName = (ch: string) => ({ ":": "colon", ".": "dot" })[ch] ?? ch;

/** A character's shape in its own axes: x across, z up, facing -y. */
export function glyphMesh(ch: string, slant = SLANT): DaeMesh {
	const P: number[] = [];
	const F: number[] = [];
	for (const [x0, z0, x1, z1] of segments(ch)) {
		const k = P.length / 3;
		for (const [x, z] of [
			[x0, z0],
			[x1, z0],
			[x1, z1],
			[x0, z1],
		] as [number, number][])
			P.push(x + z * slant, 0, z);
		// (seen from -y: x to the right, z up)
		F.push(k, k + 2, k + 1, k, k + 3, k + 2);
	}
	const n = P.length / 3;
	return {
		name: "glyph",
		material: "velopark_led",
		P,
		N: Array.from({ length: n }, () => [0, -1, 0]).flat(),
		U: new Array<number>(n * 2).fill(0),
		F,
	};
}

/** The characters' glow and the lamps' (lit by their instance colour). */
export function boardMaterials(level: string): Record<string, unknown> {
	const white = `/levels/${level}/art/shapes/${SHAPES}/white.png`;
	const base = { class: "Material", version: 1.5, castShadows: false };
	return {
		velopark_led: {
			...base,
			name: "velopark_led",
			mapTo: "velopark_led",
			doubleSided: true,
			persistentId: "6f2b1e50-6d1a-4f83-9a55-0b1d7c3e2a01",
			Stages: [
				{
					baseColorFactor: [0.02, 0, 0, 1],
					roughnessFactor: 1,
					metallicFactor: 0,
					emissive: true,
					emissiveFactor: [1, 0.06, 0.04],
					emissiveMap: white,
					emissiveIntensityNits: 2500,
				},
				{},
				{},
				{},
			],
		},
		velopark_lamp: lampMaterial("velopark_lamp", "6f2b1e50-6d1a-4f83-9a55-0b1d7c3e2a02", white),
	};
}

/** A lamp's glow, lit by its instance colour: through its own picture (a start lamp's glass, seen lit or not) when it has one, else plain dark with a white
 * glow (the flag lamp's). */
export function lampMaterial(name: string, persistentId: string, white: string, picture?: string) {
	return {
		class: "Material",
		version: 1.5,
		castShadows: false,
		name,
		mapTo: name,
		persistentId,
		Stages: [
			{
				...(picture ? { baseColorMap: picture } : { baseColorFactor: [0.06, 0.06, 0.06, 1] }),
				roughnessFactor: 0.4,
				metallicFactor: 0,
				emissive: true,
				emissiveFactor: [1, 1, 1],
				emissiveMap: picture ?? white,
				emissiveIntensityNits: 5000,
				instanceEmissive: true,
			},
			{},
			{},
			{},
		],
	};
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A face of the board: from a point of its texture to where it is (BeamNG's axes). */
class Face {
	constructor(
		readonly tris: [V3, V3, V3][],
		readonly uvs: [[number, number], [number, number], [number, number]][],
	) {}

	at(u: number, v: number): V3 | null {
		for (let k = 0; k < this.tris.length; k++) {
			const [a, b, c] = this.uvs[k] as [[number, number], [number, number], [number, number]];
			const m = [b[0] - a[0], c[0] - a[0], b[1] - a[1], c[1] - a[1]] as [number, number, number, number];
			const det = m[0] * m[3] - m[1] * m[2];
			if (Math.abs(det) < 1e-12) continue;
			const ru = u - a[0];
			const rv = v - a[1];
			const l1 = (ru * m[3] - m[1] * rv) / det;
			const l2 = (m[0] * rv - m[2] * ru) / det;
			if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6) {
				const t = this.tris[k] as [V3, V3, V3];
				return add(t[0], add(mul(sub(t[1], t[0]), l1), mul(sub(t[2], t[0]), l2)));
			}
		}
		return null;
	}

	/** A character's cell of size (w, h) pixels with its top left at (x, y) on the display. */
	cell(x: number, y: number, size: [number, number]) {
		const tx = DISPLAY_POS[0] + x + size[0] / 2;
		const ty = DISPLAY_POS[1] + y + size[1] / 2;
		const u = tx / TEXTURE[0];
		const v = ty / TEXTURE[1];
		const du = 0.5 / TEXTURE[0];
		const dv = 0.5 / TEXTURE[1];
		const p = this.at(u, v);
		const r0 = this.at(u + du, v);
		const r1 = this.at(u - du, v);
		const u0 = this.at(u, v - dv);
		const u1 = this.at(u, v + dv);
		if (!p || !r0 || !r1 || !u0 || !u1) return null;
		let right = sub(r0, r1);
		let up = sub(u0, u1);
		const px = len(up) / (2 * dv) / TEXTURE[1];
		right = mul(right, 1 / len(right));
		up = mul(up, 1 / len(up));
		const out = cross(right, up);
		return { pos: add(p, mul(out, LIFT_OFF)), right, up, size: size[1] * px };
	}
}

/** The board's faces in a gantry model: its triangles grouped by which way they face. */
function faces(board: TrackMesh, toBeamng: (x: number, y: number, z: number) => V3, lift: number): Face[] {
	const groups = new Map<string, { tris: [V3, V3, V3][]; uvs: [[number, number], [number, number], [number, number]][] }>();
	const v = board.v;
	for (let f = 0; f < board.f.length; f += 3) {
		const c = [board.f[f] as number, board.f[f + 1] as number, board.f[f + 2] as number];
		const p = c.map((k) => {
			const q = toBeamng(v[k * CORNER] as number, v[k * CORNER + 1] as number, v[k * CORNER + 2] as number);
			return [q[0], q[1], q[2] + lift] as V3;
		}) as [V3, V3, V3];
		const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
		if (len(n) < 1e-9) continue;
		const key = mul(n, 1 / len(n))
			.map((x) => Math.round(x * 10) / 10 + 0)
			.join(",");
		const g = groups.get(key) ?? { tris: [], uvs: [] };
		g.tris.push(p);
		g.uvs.push(c.map((k) => [v[k * CORNER + 6] as number, v[k * CORNER + 7] as number]) as [[number, number], [number, number], [number, number]]);
		groups.set(key, g);
	}
	return [...groups.values()].map((g) => new Face(g.tris, g.uvs));
}

/** A gantry's entry in board.json: its lamps and flags (the shapes' names), and the cells of each face's rows and clock; its board's middle. */
export function gantry(name: string, meshes: TrackMesh[], toBeamng: (x: number, y: number, z: number) => V3, lift: number, lamps: string[], flags: string[]) {
	const board = meshes.find((m) => m.name === BOARD) as TrackMesh;
	const out = faces(board, toBeamng, lift).map((face) => {
		const rows: unknown[] = [];
		for (let rank = 1; rank <= 10; rank++) {
			const [x, y] = rowAt(rank);
			const cells: unknown[] = [];
			for (const [col, x0] of [
				["rank", RANK_X],
				["number", NUMBER_X],
				["time", TIME_X],
			] as [keyof typeof CELLS, number][])
				for (let k = 0; k < CELLS[col]; k++) cells.push(face.cell(x + x0 + k * LETTER[0], y, LETTER));
			rows.push(cells);
		}
		const clock = Array.from({ length: CLOCK_CELLS }, (_, k) => face.cell(CLOCK_POS[0] + k * CLOCK_LETTER[0], CLOCK_POS[1], CLOCK_LETTER));
		return { rows, clock };
	});
	const lo: V3 = [Infinity, Infinity, Infinity];
	const hi: V3 = [-Infinity, -Infinity, -Infinity];
	for (let k = 0; k < board.v.length; k += CORNER) {
		const q = toBeamng(board.v[k] as number, board.v[k + 1] as number, board.v[k + 2] as number);
		for (let i = 0; i < 3; i++) {
			lo[i] = Math.min(lo[i] as number, q[i] as number);
			hi[i] = Math.max(hi[i] as number, q[i] as number);
		}
	}
	const centre: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2 + lift];
	return { name, centre, lamps, flags, faces: out, layouts: [] as string[], default: null as string | null };
}

/** board.json: the gantries, each with the layouts whose race starts within 40 m of it, the one it shows before any is raced first (the first of those it works
 * in, as the track's build made it: workingIn(its model), else the first). races: {layout: start position}. */
export function boardConfig(gantries: ReturnType<typeof gantry>[], races: Record<string, number[]>, workingIn: (model: string) => string[] = () => []): string {
	for (const g of gantries) {
		const near = Object.entries(races)
			.filter(([, at]) => Math.hypot((at[0] as number) - g.centre[0], (at[1] as number) - g.centre[1]) < 40)
			.map(([lay]) => lay)
			.sort(byCodePoint);
		const own = workingIn(g.name);
		g.layouts = near;
		g.default = near.find((l) => own.includes(l)) ?? near[0] ?? null;
	}
	return JSON.stringify({ cells: CELLS, gantries });
}
