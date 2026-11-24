// A track's own files where the engine runs, read and written as Python's json reads and writes them, byte for byte (pyjson, as the track's own tools read
// them): its track file and where it says its files are; its roads, for the page and back.
import type { HostFiles } from "./placehost";
import { dumpPyJson, type PyJson, plain, readPyJson } from "./pyjson";
import { bezier, centre, gradient } from "./roads";

// ---- the track's settings (config.py) ---------------------------------------------------------------------------

export const DEFAULT_MATERIALS = ["Tarmac Dark", "Tarmac Light", "Pavers", "Concrete"];
/** metres the satellite picture spans, unless the track file says */
export const DEFAULT_SPAN = 1060;

/** A track: its project folder, its track file's settings, where its cache is. */
export interface TrackSettings {
	project: string;
	trackFile: string;
	track: Record<string, unknown>;
	cache: string;
}

/** A path the track file names (from the project's root), or the default (where it names none, or holds the part itself: trackdoc.ts). */
export const at = (s: TrackSettings, key: string, def: string): string =>
	typeof s.track[key] === "string" && s.track[key] ? `${s.project}/${s.track[key]}` : def;

export const settingsPaths = (s: TrackSettings) => ({
	name: String(s.track.name ?? s.project.split("/").filter(Boolean).pop() ?? ""),
	roads: at(s, "roads", `${s.project}/tools/reference/roads.json`),
	objects: at(s, "objects", `${s.project}/tools/reference/objects.json`),
	drawings: at(s, "drawings", `${s.project}/tools/reference/road_drawings.json`),
	satellite: at(s, "satellite", `${s.project}/source/textures/GoogleMap.jpg`),
	/** the track's one map, cut in tiles (its map.json: span, px, tile, levels), where it has one */
	map: at(s, "map", ""),
	models: at(s, "models", `${s.project}/source/models`),
	span: Number(s.track.satellite_span ?? DEFAULT_SPAN),
	materials: (s.track.materials as string[] | undefined)?.length ? (s.track.materials as string[]) : DEFAULT_MATERIALS,
	backups: `${s.cache}/roads_backup`,
});

/** A track's settings from its project folder (its track file: tools/reference/track.json; its cache: build/cache). */
export async function settingsOf(files: HostFiles, project: string, trackFile?: string): Promise<TrackSettings> {
	const p = project.replace(/[\\/]+$/, "");
	const tf = trackFile ?? `${p}/tools/reference/track.json`;
	const track = (await files.exists(tf)) ? (plain(readPyJson(new TextDecoder().decode(await files.read(tf)))) as Record<string, unknown>) : {};
	return { project: p, trackFile: tf, track, cache: `${p}/build/cache` };
}

// ---- writing as Python does ------------------------------------------------------------------------------------

/** A file written as Python's json.dump(value, f, indent=1) in text mode writes it: its line endings the file's own (CRLF where it has them; a new file's:
 * CRLF, as Python's on Windows). */
export async function writePyJsonFile(files: HostFiles, path: string, value: unknown, crlf?: boolean): Promise<void> {
	let ends = crlf;
	if (ends === undefined) ends = (await files.exists(path)) ? new TextDecoder().decode(await files.read(path)).includes("\r\n") : true;
	const text = dumpPyJson(value, 1);
	await files.write(path, new TextEncoder().encode(ends ? text.split("\n").join("\r\n") : text));
}

/** time.strftime('%Y%m%d-%H%M%S') of the local time. */
export function stamp(t = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
}

/** A file kept before it is written over: <backups>/<prefix>-<stamp>.json, its bytes as they are. */
export async function backup(files: HostFiles, path: string, backups: string, prefix: string, now?: Date) {
	if (!(await files.exists(path))) return null;
	const target = `${backups}/${prefix}-${stamp(now)}.json`;
	await files.write(target, await files.read(path));
	return target;
}

// ---- the roads (roads_store.py) -----------------------------------------------------------------------------------

export type Road = { [k: string]: PyJson };
type FitOf = (road: Road) => PyJson[];

/** What a road's shape hangs on. */
const GEOMETRY = ["curve", "points", "start_left", "end_left"];

/** A road's shape as one string: the same for two roads of the same shape (the page's to tell them by; not the Python's own hash, which no one compares it
 * with). */
export async function geometryKey(road: Road): Promise<string> {
	const text = JSON.stringify(GEOMETRY.map((k) => plain(road[k] ?? null)));
	const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The roads as the page has them: each with a curve (fitted where it has only points: 'fitted'), its shape's key, no heights (kept here). */
export async function forPage(roads: Road[], fitOf: FitOf): Promise<Road[]> {
	const out: Road[] = [];
	for (const r of roads) {
		const q: Road = {};
		for (const [k, v] of Object.entries(r)) if (k !== "heights" && k !== "points") q[k] = v;
		if (!("along" in r) && !(Array.isArray(r.curve) && r.curve.length)) {
			q.curve = fitOf(r);
			q.fitted = true;
		}
		q.shape = await geometryKey(r);
		out.push(q);
	}
	return out;
}

/** A page's road as it is written, and whether it changed in shape (each key popped and put back as the Python's dict does, so the file's
 * keys keep its order). */
function merged(pageRoad: Road, was: Road | undefined): [Road, boolean] {
	const q: Road = { ...pageRoad };
	const moved = q.moved ?? false;
	delete q.moved;
	delete q.fitted;
	delete q.shape;
	if (was !== undefined && q.name !== was.name) q.mesh = "mesh" in was ? (was.mesh as PyJson) : (was.name as PyJson);
	const changed = was === undefined || Boolean(plain(moved));
	if (changed) {
		delete q.points;
		delete q.heights;
	} else {
		for (const k of [...GEOMETRY, "heights"]) {
			delete q[k];
			if (k in (was as Road)) q[k] = (was as Road)[k] as PyJson;
		}
	}
	if ("along" in q) delete q.curve;
	delete q.was;
	return [q, changed];
}

/** The roads to write and the names of those changed in shape: the page's, then those the page had not (added since it opened) unless deleted. */
export function mergeRoads(oldRoads: Road[], pageRoads: Road[], deleted: string[] = []): [Road[], string[]] {
	const old = new Map(oldRoads.map((r) => [String(r.name), r]));
	const out: Road[] = [];
	const changed: string[] = [];
	for (const pr of pageRoads) {
		const [q, moved] = merged(pr, old.get(String(pr.was || pr.name)));
		if (moved) changed.push(String(q.name));
		out.push(q);
	}
	const have = new Set([...pageRoads.map((q) => String(q.was || q.name)), ...pageRoads.map((q) => String(q.name))]);
	const gone = new Set(deleted);
	for (const [n, r] of old) if (!have.has(n) && !gone.has(n)) out.push(r);
	return [out, changed];
}

/** The roads file: its roads as written (their numbers kept as written). */
export async function loadRoads(files: HostFiles, path: string): Promise<Road[]> {
	if (!(await files.exists(path))) return [];
	const doc = readPyJson(new TextDecoder().decode(await files.read(path))) as { roads?: Road[] };
	return doc.roads ?? [];
}

/** The page's roads written back (the file before kept in backups): the names of those changed in shape. */
export async function saveRoads(files: HostFiles, path: string, backups: string, pageRoads: Road[], deleted: string[] = [], now?: Date): Promise<string[]> {
	const [out, changed] = mergeRoads(await loadRoads(files, path), pageRoads, deleted);
	await backup(files, path, backups, "roads", now);
	await writePyJsonFile(files, path, { roads: out });
	return changed;
}

// ---- a road's curve fitted to its points (geometry.fit_curve) ------------------------------------------------------

/** metres a fitted curve keeps to the road's middle (and widths) within */
export const FIT = 0.05;
export const FIT_ROUNDS = 400;

/** round(x, n) as Python's: from the float's exact value, its ties to the even. */
export function pyRound(x: number, n: number): number {
	const s = x.toFixed(60);
	const [int, frac = ""] = s.split(".");
	const tail = frac.slice(n);
	if (/^50*$/.test(tail)) {
		// (a tie: to the even last decimal)
		const kept = Number(n ? `${int}.${frac.slice(0, n)}` : int);
		const last = Number(n ? frac[n - 1] : (int as string).slice(-1));
		if (last % 2 === 0) return kept;
	}
	return Number(x.toFixed(n));
}

/** round(x, 4) as Python's. */
export const pyRound4 = (x: number): number => pyRound(x, 4);

/** metres a side of the cells points are filed in, for their nearest */
const NEAR_CELL = 0.5;

/** Points (x, z first) filed in cells: a point's nearest of them (its index, how far), searched ring by ring out. */
function nearestOf(B: number[][]): (x: number, z: number) => [number, number] {
	const cells = new Map<number, number[]>();
	const key = (i: number, j: number) => i * 1_000_003 + j;
	B.forEach((b, k) => {
		const c = key(Math.floor((b[0] as number) / NEAR_CELL), Math.floor((b[1] as number) / NEAR_CELL));
		const l = cells.get(c);
		if (l) l.push(k);
		else cells.set(c, [k]);
	});
	return (x, z) => {
		const ci = Math.floor(x / NEAR_CELL);
		const cj = Math.floor(z / NEAR_CELL);
		let best = Infinity;
		let at = 0;
		for (let r = 0; r < 1e6; r++) {
			// (a point in a cell r rings out is at least (r - 1) cells away: none nearer past there)
			if (best < (r - 1) * NEAR_CELL) break;
			if (r > 0 && cells.size && best === Infinity && r > 4096) break;
			for (let i = ci - r; i <= ci + r; i++)
				for (let j = cj - r; j <= cj + r; j++) {
					if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
					for (const k of cells.get(key(i, j)) ?? []) {
						const b = B[k] as number[];
						const d = Math.hypot((b[0] as number) - x, (b[1] as number) - z);
						if (d < best || (d === best && k < at)) {
							best = d;
							at = k;
						}
					}
				}
		}
		return [at, best];
	};
}

/** A road's middle as a curve of Bezier pieces: nodes where needed so it keeps within FIT of the road's middle and widths; each node's handles along the road's
 * way there, a third of the way to the next node each. */
export function fitCurve(road: Road): PyJson[] {
	const c = centre(plain(road) as never);
	const keep = c.C.map((_, i) => i === 0 || (c.s[i] as number) - (c.s[i - 1] as number) > 1e-9);
	const C = c.C.filter((_, i) => keep[i]);
	const s = Float64Array.from([...c.s].filter((_, i) => keep[i]));
	const gx = gradient(
		C.map((q) => q[0] as number),
		s,
	);
	const gz = gradient(
		C.map((q) => q[1] as number),
		s,
	);
	const T = C.map((_, i) => {
		const m = Math.max(Math.sqrt((gx[i] as number) ** 2 + (gz[i] as number) ** 2), 1e-9);
		return [(gx[i] as number) / m, (gz[i] as number) / m] as const;
	});
	const nodesOf = (idx: number[]): PyJson[] =>
		idx.map((i, j) => {
			const dIn = j ? (s[i] as number) - (s[idx[j - 1] as number] as number) : 0;
			const dOut = j < idx.length - 1 ? (s[idx[j + 1] as number] as number) - (s[i] as number) : 0;
			const t = T[i] as readonly [number, number];
			const p = C[i] as number[];
			return {
				p: [pyRound4(p[0] as number), pyRound4(p[1] as number)],
				in: [pyRound4((-t[0] * dIn) / 3), pyRound4((-t[1] * dIn) / 3)],
				out: [pyRound4((t[0] * dOut) / 3), pyRound4((t[1] * dOut) / 3)],
				left: pyRound4(p[2] as number),
				right: pyRound4(p[3] as number),
			};
		});
	let idx = [0, C.length - 1];
	for (let round = 0; round < FIT_ROUNDS; round++) {
		const B = bezier(plain(nodesOf(idx)) as never, 0.05).C;
		// (each point of the middle against the curve's nearest point: found by cells round it, out to where none nearer can be, as cKDTree's query finds it)
		const near = nearestOf(B);
		const err = C.map((q) => {
			const [j, best] = near(q[0] as number, q[1] as number);
			const b = B[j] as number[];
			return Math.max(best, Math.abs((b[2] as number) - (q[2] as number)), Math.abs((b[3] as number) - (q[3] as number)));
		});
		let worst = 0;
		let found: [number, number] | null = null;
		for (let k = 0; k + 1 < idx.length; k++) {
			const a = idx[k] as number;
			const b = idx[k + 1] as number;
			if (b - a < 3) continue;
			let m = a + 1;
			for (let i = a + 1; i < b; i++) if ((err[i] as number) > (err[m] as number)) m = i;
			if ((err[m] as number) > FIT && (err[m] as number) > worst) {
				worst = err[m] as number;
				found = [a, b];
			}
		}
		if (!found) break;
		const [a, b] = found;
		const half = ((s[a] as number) + (s[b] as number)) / 2;
		let mid = 0;
		while (mid < s.length && (s[mid] as number) < half) mid++;
		idx = [...new Set([...idx, Math.min(Math.max(mid, a + 1), b - 1)])].sort((u, v) => u - v);
	}
	return nodesOf(idx);
}
