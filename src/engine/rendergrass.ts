// The grass of the track's renders, as Assetto Corsa's grass (Custom Shaders Patch's GRASS_FX) grows it, near where a render looks: clumps of blades on the
// meshes it grows on (GRASS_MESHES), where nothing of the materials that keep it off (OCCLUDING_MATERIALS: roads, kerbs, buildings) lies over them, and where
// the ground's own colour is green (CSP's colour mask). Each clump two crossed quads, a little turned, sized and tilted at random (seeded: the same each time),
// tinted the colour of the ground under it. In AC's axes (y up).
import { seeded } from "./beamng/grass";
import type { V3 } from "./trackrender";

/** a clump's height and width, metres */
export const GRASS_HEIGHT: [number, number] = [0.22, 0.42];
export const GRASS_WIDTH = 0.55;
/** clumps a square metre */
export const GRASS_DENSITY = 5;
/** the cells of what lies over the ground, metres a side */
const CELL = 0.3;

/** Triangles where they stand: corners (x y z, three a triangle) and, for the ground, their uv (u v, three a triangle). */
export interface Tris {
	P: Float32Array;
	UV?: Float32Array;
}

/** The ground's settings (the track's ext_config.ini's [GRASS_FX]), each name. */
export interface GrassConfig {
	meshes: string[];
	occluding: string[];
}

/** A line of an ini with its comment out: from the first ; that no line break follows. */
function uncommented(l: string): string {
	const from = Math.max(l.lastIndexOf("\r"), l.lastIndexOf("\u2028"), l.lastIndexOf("\u2029")) + 1;
	const at = l.indexOf(";", from);
	return at < 0 ? l : l.slice(0, at);
}

/** A line of an ini as its key (capitals and _, before its =) and its value (trimmed, all on one line), or null. */
function keyValue(l: string): [string, string] | null {
	const t = l.trimStart();
	const key = /^[A-Z_]+/.exec(t)?.[0];
	if (!key) return null;
	const after = t.slice(key.length).trimStart();
	if (!after.startsWith("=")) return null;
	const value = after.slice(1).trim();
	return /[\n\r\u2028\u2029]/.test(value) ? null : [key, value];
}

/** [GRASS_FX]'s meshes and occluding materials, out an ext_config.ini (none: null). */
export function grassConfig(ini: string): GrassConfig | null {
	const lines = ini.split(/\r?\n/);
	const at = lines.findIndex((l) => l.trim().toUpperCase() === "[GRASS_FX]");
	if (at < 0) return null;
	const body = lines.slice(at + 1);
	const end = body.findIndex((l) => /^\s*\[/.test(l));
	const keys = new Map<string, string>();
	for (const l of end < 0 ? body : body.slice(0, end)) {
		const m = keyValue(uncommented(l));
		if (m) keys.set(m[0], m[1]);
	}
	const list = (k: string) =>
		(keys.get(k) ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	const meshes = list("GRASS_MESHES");
	return meshes.length ? { meshes, occluding: list("OCCLUDING_MATERIALS") } : null;
}

/** Whether the ground's colour (linear RGB, 0..1) is one grass grows on: green over its red and blue, not black. */
export function isGreen(c: V3): boolean {
	const [r, g, b] = c;
	return g > 0.004 && (g - Math.max(r, b)) / g > 0.08;
}

/** The clumps within radius of centre (x, z): as kn5 vertices (11 floats: position, normal up, uv, and its tint, the ground's colour, where a kn5 has its
 * tangent) and their faces. Each ground its triangles and its colour at a uv (linear RGB). */
export function grassAround(
	ground: { tris: Tris; colourAt: (u: number, v: number) => V3 }[],
	over: Tris[],
	centre: [number, number],
	radius: number,
	density = GRASS_DENSITY,
): { verts: Float32Array; faces: Uint32Array; clumps: number } {
	const [cx, cz] = centre;
	const x0 = cx - radius;
	const z0 = cz - radius;
	const n = Math.ceil((2 * radius) / CELL);
	// (the highest of what keeps grass off, each cell)
	const top = new Float32Array(n * n).fill(-Infinity);
	for (const t of over) rasterise(t.P, x0, z0, n, top);
	const f: Field = { cx, cz, radius, x0, z0, n, top, r: seeded(11), verts: [], faces: [] };
	let clumps = 0;
	for (const { tris, colourAt } of ground) {
		const { P, UV } = tris;
		if (!UV) continue;
		for (let i = 0; i + 8 < P.length; i += 9) clumps += growOn(f, P, UV, i, density, colourAt);
	}
	return { verts: new Float32Array(f.verts), faces: new Uint32Array(f.faces), clumps };
}

/** Where grass grows round a centre: the centre and the radius, the square's corner and its cells a side, the highest of what lies over each cell, the random
 * draws, and the clumps' vertices and faces so far. */
interface Field {
	cx: number;
	cz: number;
	radius: number;
	x0: number;
	z0: number;
	n: number;
	top: Float32Array;
	r: () => number;
	verts: number[];
	faces: number[];
}

/** The clumps on a ground's triangle (at i in P, its uv at i / 9 * 6 in UV): as many as its area at density, by chance, of those the ones that grow; how many
 * did (none off the square round the centre). */
function growOn(f: Field, P: Float32Array, UV: Float32Array, i: number, density: number, colourAt: (u: number, v: number) => V3): number {
	const { x0, z0, radius, r } = f;
	const ax = P[i] as number;
	const az = P[i + 2] as number;
	const bx = P[i + 3] as number;
	const bz = P[i + 5] as number;
	const qx = P[i + 6] as number;
	const qz = P[i + 8] as number;
	if (Math.max(ax, bx, qx) < x0 || Math.min(ax, bx, qx) > x0 + 2 * radius) return 0;
	if (Math.max(az, bz, qz) < z0 || Math.min(az, bz, qz) > z0 + 2 * radius) return 0;
	const area = Math.abs((bx - ax) * (qz - az) - (qx - ax) * (bz - az)) / 2;
	const want = area * density;
	let k = Math.floor(want) + (r() < want - Math.floor(want) ? 1 : 0);
	let grown = 0;
	for (; k > 0; k--) if (clumpOn(f, P, UV, i, colourAt)) grown++;
	return grown;
}

/** A clump at a point at random on a ground's triangle, where it grows: within the radius, nothing over it, the ground green there. Whether it grew. */
function clumpOn(f: Field, P: Float32Array, UV: Float32Array, i: number, colourAt: (u: number, v: number) => V3): boolean {
	const { cx, cz, radius, x0, z0, n, top, r } = f;
	let s = r();
	let w = r();
	if (s + w > 1) [s, w] = [1 - s, 1 - w];
	const at = (o: number) =>
		(P[i + o] as number) + s * ((P[i + 3 + o] as number) - (P[i + o] as number)) + w * ((P[i + 6 + o] as number) - (P[i + o] as number));
	const x = at(0);
	const y = at(1);
	const z = at(2);
	if (Math.hypot(x - cx, z - cz) > radius) return false;
	const cell = Math.floor((x - x0) / CELL) + Math.floor((z - z0) / CELL) * n;
	if ((top[cell] as number) > y - 0.12) return false;
	const j = (i / 9) * 6;
	const u = (UV[j] as number) + s * ((UV[j + 2] as number) - (UV[j] as number)) + w * ((UV[j + 4] as number) - (UV[j] as number));
	const v = (UV[j + 1] as number) + s * ((UV[j + 3] as number) - (UV[j + 1] as number)) + w * ((UV[j + 5] as number) - (UV[j + 1] as number));
	const c = colourAt(u, v);
	if (!isGreen(c)) return false;
	clump(f.verts, f.faces, [x, y, z], c, r);
	return true;
}

/** A clump's two quads (the texture's v down from its top, as a kn5's). */
function clump(verts: number[], faces: number[], p: V3, c: V3, r: () => number): void {
	const h = GRASS_HEIGHT[0] + r() * (GRASS_HEIGHT[1] - GRASS_HEIGHT[0]);
	const w = GRASS_WIDTH * (0.8 + r() * 0.4);
	const turn = r() * Math.PI;
	const tilt = [(r() - 0.5) * 0.25, (r() - 0.5) * 0.25];
	const shade = 0.85 + r() * 0.3;
	const tint = c.map((v) => v * shade);
	for (let q = 0; q < 2; q++) {
		const a = turn + (q * Math.PI) / 2;
		const dx = (Math.cos(a) * w) / 2;
		const dz = (Math.sin(a) * w) / 2;
		const base = verts.length / 11;
		const corners: [number, number, number, number, number][] = [
			[p[0] - dx, p[1] - 0.03, p[2] - dz, 0, 1],
			[p[0] + dx, p[1] - 0.03, p[2] + dz, 1, 1],
			[p[0] + dx + (tilt[0] as number) * h, p[1] + h, p[2] + dz + (tilt[1] as number) * h, 1, 0],
			[p[0] - dx + (tilt[0] as number) * h, p[1] + h, p[2] - dz + (tilt[1] as number) * h, 0, 0],
		];
		for (const [x, y, z, u, v] of corners) verts.push(x, y, z, 0, 1, 0, u, v, ...tint);
		faces.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
}

/** The highest point of each cell a triangle covers (its centre inside it), into top. */
function rasterise(P: Float32Array, x0: number, z0: number, n: number, top: Float32Array): void {
	for (let i = 0; i + 8 < P.length; i += 9) rasteriseOne(P, i, x0, z0, n, top);
}

/** The highest point of each cell one triangle (at i in P) covers, into top. */
function rasteriseOne(P: Float32Array, i: number, x0: number, z0: number, n: number, top: Float32Array): void {
	const ax = P[i] as number;
	const ay = P[i + 1] as number;
	const az = P[i + 2] as number;
	const bx = P[i + 3] as number;
	const by = P[i + 4] as number;
	const bz = P[i + 5] as number;
	const qx = P[i + 6] as number;
	const qy = P[i + 7] as number;
	const qz = P[i + 8] as number;
	const i0 = Math.max(0, Math.floor((Math.min(ax, bx, qx) - x0) / CELL));
	const i1 = Math.min(n - 1, Math.floor((Math.max(ax, bx, qx) - x0) / CELL));
	const k0 = Math.max(0, Math.floor((Math.min(az, bz, qz) - z0) / CELL));
	const k1 = Math.min(n - 1, Math.floor((Math.max(az, bz, qz) - z0) / CELL));
	if (i0 > i1 || k0 > k1) return;
	const d = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
	// (on edge from above, a wall's: covering nothing)
	if (Math.abs(d) < 1e-6) return;
	// (a cell its centre within half a cell of it: no seam of grass between two triangles)
	const e = -0.5 * (CELL / Math.max(Math.sqrt(Math.abs(d)), CELL));
	for (let k = k0; k <= k1; k++)
		for (let j = i0; j <= i1; j++) {
			const x = x0 + (j + 0.5) * CELL;
			const z = z0 + (k + 0.5) * CELL;
			const l1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / d;
			const l2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / d;
			const l3 = 1 - l1 - l2;
			if (l1 < e || l2 < e || l3 < e) continue;
			const y = l1 * ay + l2 * by + l3 * qy;
			const c = j + k * n;
			if (y > (top[c] as number)) top[c] = y;
		}
}
