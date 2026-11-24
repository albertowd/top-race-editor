// The track as its models have it now, seen from above, to show under the roads (geometry.py's context): each mesh of the track's context models whose name
// starts as the track file says, its faces seen from above (no wall faces), as its outline (its edges of one face only, chained into lines, kept within SIMPLE
// of themselves), a tyre wall's as a circle a stack. Kept until the models change.
import type { MaterialLibrary } from "./gltf";
import { loadKn5 } from "./gltf";
import { meshes, triangles } from "./mesh";
import type { HostFiles } from "./placehost";

/** metres the outlines are kept within (geometry.py's SIMPLE) */
export const SIMPLE = 0.02;
/** metres: points closer than this are one point (geometry.py's WELD) */
export const WELD = 0.005;
/** what the page is told, as the Python's: its version */
export const CONTEXT_VERSION = 3;

/** The context's models by default (config.py's DEFAULT_CONTEXT_MODELS): [file, name prefixes, kind]. */
export const DEFAULT_CONTEXT_MODELS: [string, string[], string][] = [
	["velopark.glb", ["1ROAD", "1KERB", "1WALL"], "road"],
	["velopark_runoffs.glb", ["1ROAD"], "runoff"],
	["velopark_kerbs.glb", ["1ROAD_KERB", "KERB", "1KERB"], "kerb"],
	["velopark_lines.glb", ["LINE_", "GRID_"], "line"],
	["velopark_tyres.glb", ["TYRES", "1WALL_TYRE"], "tyre"],
	["velopark_paddock.glb", ["1ROAD", "BLD", "1WALL"], "paddock"],
];

export interface ContextItem {
	name: string;
	kind: string;
	material: string;
	/** its outline: x z x z ... each line */
	lines?: number[][];
	/** a tyre wall's stacks: x z r each */
	rings?: number[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A polyline kept within tol of itself (Douglas-Peucker, each point's distance from the segment: GEOS's; its ends kept). Points x z x z ... */
export function simplify(P: number[], tol: number): number[] {
	const n = P.length / 2;
	if (n < 3) return P;
	const keep = new Uint8Array(n);
	keep[0] = 1;
	keep[n - 1] = 1;
	const stack: [number, number][] = [[0, n - 1]];
	while (stack.length) {
		const [a, b] = stack.pop() as [number, number];
		const ax = P[a * 2] as number;
		const az = P[a * 2 + 1] as number;
		const dx = (P[b * 2] as number) - ax;
		const dz = (P[b * 2 + 1] as number) - az;
		const l2 = dx * dx + dz * dz;
		let worst = -1;
		let at = -1;
		for (let i = a + 1; i < b; i++) {
			const px = (P[i * 2] as number) - ax;
			const pz = (P[i * 2 + 1] as number) - az;
			// (from the segment, as GEOS's: a line that folds back keeps its far part)
			const t = l2 > 0 ? Math.min(Math.max((px * dx + pz * dz) / l2, 0), 1) : 0;
			const d = Math.hypot(px - t * dx, pz - t * dz);
			if (d > worst) {
				worst = d;
				at = i;
			}
		}
		if (worst > tol) {
			keep[at] = 1;
			stack.push([a, at], [at, b]);
		}
	}
	const out: number[] = [];
	for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i * 2] as number, P[i * 2 + 1] as number);
	return out;
}

/** Edges chained into lines through the points two of them meet at (shapely's linemerge): the rest a line's ends; a loop closed (its first point again at its
 * end). Each line its points' indices. */
export function chains(edges: [number, number][]): number[][] {
	const at = new Map<number, number[]>();
	edges.forEach(([a, b], i) => {
		for (const p of [a, b]) {
			const l = at.get(p);
			if (l) l.push(i);
			else at.set(p, [i]);
		}
	});
	const used = new Uint8Array(edges.length);
	const out: number[][] = [];
	const walk = (start: number, first: number) => {
		const line = [start];
		let p = start;
		let e = first;
		for (;;) {
			used[e] = 1;
			const [a, b] = edges[e] as [number, number];
			p = a === p ? b : a;
			line.push(p);
			const next = (at.get(p) ?? []).filter((x) => !used[x]);
			if ((at.get(p) ?? []).length !== 2 || !next.length) break;
			e = next[0] as number;
		}
		out.push(line);
	};
	for (const [p, es] of at) if (es.length !== 2) for (const e of es) if (!used[e]) walk(p, e);
	edges.forEach(([a], e) => {
		if (!used[e]) walk(a, e);
	});
	return out;
}

/** A mesh seen from above (its triangles x z, six numbers each): a tyre wall's a circle a stack, else its outline. */
export function contextItem(name: string, kind: string, material: string, T: number[]): ContextItem | null {
	// (points closer than WELD one point: the last of them stands for them, as numpy's)
	const ids = new Map<string, number>();
	const P: number[] = [];
	const F: number[] = [];
	for (let i = 0; i < T.length; i += 2) {
		const x = T[i] as number;
		const z = T[i + 1] as number;
		const k = `${Math.round(x / WELD)},${Math.round(z / WELD)}`;
		let j = ids.get(k);
		if (j === undefined) {
			j = P.length / 2;
			ids.set(k, j);
			P.push(x, z);
		} else {
			P[j * 2] = x;
			P[j * 2 + 1] = z;
		}
		F.push(j);
	}
	const item: ContextItem = { name, kind, material };
	if (kind === "tyre") {
		// (each stack: the points its faces join; its middle and its farthest point from it)
		const parent = Array.from({ length: P.length / 2 }, (_, i) => i);
		const find = (i: number): number => {
			while (parent[i] !== i) {
				parent[i] = parent[parent[i] as number] as number;
				i = parent[i] as number;
			}
			return i;
		};
		for (let f = 0; f < F.length; f += 3) {
			const a = find(F[f] as number);
			parent[find(F[f + 1] as number)] = a;
			parent[find(F[f + 2] as number)] = a;
		}
		const groups = new Map<number, number[]>();
		for (let i = 0; i < P.length / 2; i++) {
			const g = find(i);
			const l = groups.get(g);
			if (l) l.push(i);
			else groups.set(g, [i]);
		}
		const rings: number[] = [];
		for (const g of [...groups.keys()].sort((a, b) => a - b)) {
			const pts = groups.get(g) as number[];
			const xs = pts.map((i) => P[i * 2] as number);
			const zs = pts.map((i) => P[i * 2 + 1] as number);
			const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
			const mz = (Math.min(...zs) + Math.max(...zs)) / 2;
			const r = Math.max(...pts.map((i) => Math.hypot((P[i * 2] as number) - mx, (P[i * 2 + 1] as number) - mz)));
			rings.push(r2(mx), r2(mz), r2(r));
		}
		item.rings = rings;
		return item;
	}
	const count = new Map<string, number>();
	for (let f = 0; f < F.length; f += 3)
		for (let e = 0; e < 3; e++) {
			const a = F[f + e] as number;
			const b = F[f + ((e + 1) % 3)] as number;
			const k = a < b ? `${a},${b}` : `${b},${a}`;
			count.set(k, (count.get(k) ?? 0) + 1);
		}
	const edges: [number, number][] = [];
	for (const [k, n] of count) if (n === 1) edges.push(k.split(",").map(Number) as [number, number]);
	if (!edges.length) return null;
	item.lines = chains(edges)
		.map((line) => line.flatMap((i) => [P[i * 2] as number, P[i * 2 + 1] as number]))
		.filter((L) => {
			let len = 0;
			for (let i = 2; i < L.length; i += 2) len += Math.hypot((L[i] as number) - (L[i - 2] as number), (L[i + 1] as number) - (L[i - 1] as number));
			return len > 0.05;
		})
		.map((L) => simplify(L, SIMPLE).map(r2));
	return item;
}

const cached = new Map<string, { key: string; items: ContextItem[] }>();

async function keyOf(files: HostFiles, paths: string[]): Promise<string> {
	const parts: string[] = [];
	for (const p of paths) {
		if (!(await files.exists(p))) {
			parts.push(`${p}:none`);
			continue;
		}
		const h = new Uint8Array(await crypto.subtle.digest("SHA-256", (await files.read(p)) as Uint8Array<ArrayBuffer>));
		parts.push(`${p}:${[...h].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
	}
	return parts.join("|");
}

/** The track now, as its context models have it (models: its models' folder; given: the track file's context_models, else DEFAULT_CONTEXT_MODELS): kept until
 * those models change. */
export async function trackContext(
	files: HostFiles,
	models: string,
	library: MaterialLibrary | undefined,
	given?: [string, string[], string][],
): Promise<{ version: number; items: ContextItem[] }> {
	const list = given?.length ? given : DEFAULT_CONTEXT_MODELS;
	const paths = list.map(([f]) => `${models}/${f}`);
	const key = await keyOf(files, paths);
	const kept = cached.get(models);
	if (kept && kept.key === key) return { version: CONTEXT_VERSION, items: kept.items };
	const items: ContextItem[] = [];
	for (const [i, [, prefixes, kind]] of list.entries()) {
		const path = paths[i] as string;
		if (!(await files.exists(path))) continue;
		const k = await loadKn5(files, path, library);
		for (const [n, m] of meshes(k)) {
			if (!n.faces.length || !prefixes.some((p) => n.name.startsWith(p))) continue;
			const tris = triangles(n, m);
			// (seen from above: no wall faces)
			const T: number[] = [];
			for (let t = 0; t < tris.length; t += 9) {
				const ax = tris[t] as number;
				const az = tris[t + 2] as number;
				const bx = tris[t + 3] as number;
				const bz = tris[t + 5] as number;
				const cx = tris[t + 6] as number;
				const cz = tris[t + 8] as number;
				if (Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2 > 1e-5) T.push(ax, az, bx, bz, cx, cz);
			}
			const it = T.length ? contextItem(n.name, kind, k.materials[n.material]?.name ?? "", T) : null;
			if (it) items.push(it);
		}
	}
	cached.set(models, { key, items });
	return { version: CONTEXT_VERSION, items };
}
