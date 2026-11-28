// The roads' surface made imperfect all over, as real asphalt is (objects.json's `surface`, millimetres): long waves (8 to 20 m), bumps (1.5 to 4 m) and a
// ripple (a third to most of a metre: what makes a kart tremble), each noise in the world's own coordinates; and every bend lower on its inside, the tighter
// the more, down to its inside edge. One function of where a point is (the same in every mesh at a point: no seam opens), full on the roads and easing to
// nothing a metre past their edges and their free ends (the grass, the far ground as they are). Where roads meet, a point takes each one's the more the further
// in it it is, so the one turns into the other; a road's part under one built before it (as a road running into another lies under it) is not read.

import type { SurfaceRoughness } from "../domain/types";
import { fine, priority, type RoadDesc } from "./roads";

/** Ready-made levels (millimetres): none of it, a little, a used track's, an old one's. */
export const ROUGH_LEVELS: Record<"light" | "medium" | "heavy", Required<Omit<SurfaceRoughness, "seed" | "map">>> = {
	light: { waves: 6, bumps: 2.5, ripple: 0.8, camber: 15 },
	medium: { waves: 12, bumps: 5, ripple: 1.5, camber: 30 },
	heavy: { waves: 18, bumps: 8, ripple: 2.5, camber: 45 },
};

/** metres between the rows of a road it reads (its fine rows are every 0.1 m) */
const ROW = 0.5;
/** metres either side of a row its bend is read over */
const BEND = 4;
/** metres: a bend this tight (its radius) or tighter has its inside down by the whole camber */
const TIGHT = 12;
/** metres past a road's edge (and its free end) the roughness eases to nothing over */
const EASE = 1;
/** metres: a point so much further in one road than in another (from its edges) takes e (2.7) times as much of that one's roughness: where two roads meet,
 * the one's turns into the other's over a metre or so, never at once */
const SOFT = 0.5;
/** metres a cell of the rows' index is */
const CELL = 4;
/** metres from a point of the roughness map it counts; how much it may scale the roughness, at least and at most */
const MAP_REACH = 6;
const MAP_LEAST = 0.3;
const MAP_MOST = 2.5;

/** How rough each place is by the map (videos'): the points within MAP_REACH, the nearer the more; none near: 1. */
function mapOf(points: [number, number, number][] | undefined): (x: number, z: number) => number {
	if (!points?.length) return () => 1;
	const cells = new Map<string, [number, number, number][]>();
	for (const p of points) {
		const key = `${Math.floor(p[0] / MAP_REACH)},${Math.floor(p[1] / MAP_REACH)}`;
		const l = cells.get(key);
		if (l) l.push(p);
		else cells.set(key, [p]);
	}
	return (x, z) => {
		const ci = Math.floor(x / MAP_REACH);
		const cj = Math.floor(z / MAP_REACH);
		let sum = 0;
		let wsum = 0;
		for (let di = -1; di <= 1; di++)
			for (let dj = -1; dj <= 1; dj++)
				for (const [px, pz, k] of cells.get(`${ci + di},${cj + dj}`) ?? []) {
					const d = Math.hypot(px - x, pz - z);
					if (d > MAP_REACH) continue;
					// (fading to nothing at the reach: where the map ends, the levels as they are)
					const w = (1 - d / MAP_REACH) ** 2;
					sum += w * k;
					wsum += w;
				}
		const k = wsum ? (sum + Math.max(0, 1 - wsum)) / Math.max(wsum, 1) : 1;
		return Math.min(MAP_MOST, Math.max(MAP_LEAST, k));
	};
}

/** A hash of a lattice point (and a seed) to 0..1. */
function hash(i: number, j: number, seed: number): number {
	// (the sum made 32 bits by the ^ and >>> on it)
	const s = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647);
	let h = Math.imul(s ^ (s >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/** Smooth value noise at (x, z) on a lattice so many metres apart: -1 to 1. */
function noise(x: number, z: number, metres: number, seed: number): number {
	const u = x / metres;
	const v = z / metres;
	const i = Math.floor(u);
	const j = Math.floor(v);
	const fu = u - i;
	const fv = v - j;
	const su = fu * fu * fu * (fu * (fu * 6 - 15) + 10);
	const sv = fv * fv * fv * (fv * (fv * 6 - 15) + 10);
	const a = hash(i, j, seed);
	const b = hash(i + 1, j, seed);
	const c = hash(i, j + 1, seed);
	const d = hash(i + 1, j + 1, seed);
	return ((a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv) * 2 - 1;
}

/** A road's rows as read: middle, its left (unit), its way (unit), its widths left and right, its bend (1/m, + turning left), whether it is a free end's (no
 * road going on from it), its road's place in the order the roads are built in (priority's: the first over those after it). */
interface Row {
	road: number;
	x: number;
	z: number;
	lx: number;
	lz: number;
	tx: number;
	tz: number;
	wl: number;
	wr: number;
	k: number;
	end: -1 | 0 | 1;
}

/** Which open end of its road the k-th of its rows is at (last: the last row's k): -1 its first, unless joined there; 1 its last, unless joined there; else 0. */
function endOf(k: number, last: number, joins: (string | null)[]): Row["end"] {
	if (k === 0 && !joins[0]) return -1;
	return k === last && !joins[1] ? 1 : 0;
}

function rowsOf(road: RoadDesc, place: number): Row[] {
	const f = fine(road);
	const n = f.at.length;
	if (n < 2) return [];
	const pick: number[] = [];
	for (let i = 0, next = 0; i < n; i++)
		if ((f.at[i] as number) >= next || i === n - 1) {
			pick.push(i);
			next = (f.at[i] as number) + ROW;
		}
	// (its way at each fine row: its left turned back, (lz, -lx))
	const way = (i: number): [number, number] => [f.lz[i] as number, -(f.lx[i] as number)];
	const along = (i: number, d: number) => {
		const target = (f.at[i] as number) + d;
		let j = i;
		if (d > 0) while (j < n - 1 && (f.at[j] as number) < target) j++;
		else while (j > 0 && (f.at[j] as number) > target) j--;
		return j;
	};
	const joins = (road as { joins?: (string | null)[] }).joins ?? [];
	return pick.map((i, k) => {
		const a = along(i, -BEND);
		const b = along(i, BEND);
		const ta = way(a);
		const tb = way(b);
		const ds = (f.at[b] as number) - (f.at[a] as number);
		const t = way(i);
		return {
			road: place,
			x: f.mx[i] as number,
			z: f.mz[i] as number,
			lx: f.lx[i] as number,
			lz: f.lz[i] as number,
			tx: t[0],
			tz: t[1],
			wl: f.wl[i] as number,
			wr: f.wr[i] as number,
			// (the turn from a to b over the way between: its cross product's sine over the length)
			k: ds > 1e-6 ? (ta[0] * tb[1] - ta[1] * tb[0]) / ds : 0,
			end: endOf(k, pick.length - 1, joins),
		} satisfies Row;
	});
}

/** Where (x, z) is to a row: across it (+ to its left), its road's width on that side, how far out of its road (by its edge, its free end or the row: the
 * rows beyond it cut away under another road, or the road going on into another; less than 0 inside it), how far past it (0 inside it). */
function placed(r: Row, x: number, z: number): { o: number; w: number; out: number; past: number } {
	const dx = x - r.x;
	const dz = z - r.z;
	const o = dx * r.lx + dz * r.lz;
	const a = dx * r.tx + dz * r.tz;
	const w = o >= 0 ? r.wl : r.wr;
	const reach = r.end !== 0 && Math.sign(a) === r.end ? ROW : 2 * ROW;
	const out = Math.max(Math.abs(o) - w, Math.abs(a) - reach);
	return { o, w, out, past: Math.max(0, out) };
}

/** The rows in each cell, by its key. */
function cellsOf(rows: Row[]): Map<string, number[]> {
	const cells = new Map<string, number[]>();
	rows.forEach((r, i) => {
		const key = `${Math.floor(r.x / CELL)},${Math.floor(r.z / CELL)}`;
		const l = cells.get(key);
		if (l) l.push(i);
		else cells.set(key, [i]);
	});
	return cells;
}

/** Each road's nearest row to (x, z) among the rows in the cells within three of its own (cells: the rows in each, by its key); of the roads built before
 * place only, where given. */
function nearestByRoad(rows: Row[], cells: Map<string, number[]>, x: number, z: number, before = Infinity): number[] {
	const ci = Math.floor(x / CELL);
	const cj = Math.floor(z / CELL);
	const nearest = new Map<number, [number, number]>();
	for (let di = -3; di <= 3; di++)
		for (let dj = -3; dj <= 3; dj++)
			for (const i of cells.get(`${ci + di},${cj + dj}`) ?? []) {
				const r = rows[i] as Row;
				if (r.road >= before) continue;
				const d = (r.x - x) ** 2 + (r.z - z) ** 2;
				const n = nearest.get(r.road);
				if (!n || d < n[1]) nearest.set(r.road, [i, d]);
			}
	return [...nearest.values()].map(([i]) => i);
}

/** Whether a row's middle is on a road built before its own (by that road's nearest row). */
function onEarlier(rows: Row[], cells: Map<string, number[]>, row: Row): boolean {
	return nearestByRoad(rows, cells, row.x, row.z, row.road).some((i) => placed(rows[i] as Row, row.x, row.z).past === 0);
}

/** The roughness of the roads described (run-offs left out: they go with their road), in metres at (x, z); null where the track has none. */
export function roughnessOf(roads: RoadDesc[], s: SurfaceRoughness | undefined): ((x: number, z: number) => number) | null {
	const waves = (s?.waves ?? 0) / 1000;
	const bumps = (s?.bumps ?? 0) / 1000;
	const ripple = (s?.ripple ?? 0) / 1000;
	const camber = (s?.camber ?? 0) / 1000;
	if (!(waves || bumps || ripple || camber)) return null;
	const seed = s?.seed ?? 1;
	const rough = mapOf(s?.map);
	const order = priority(Object.fromEntries(roads.map((r) => [r.name, r])));
	const read: Row[] = roads.filter((r) => !r.along).flatMap((r) => rowsOf(r, order.indexOf(r.name)));
	// (a road's rows on a road built before it out: it is cut away under that one, as a road running into another is, and its bend is not the floor's there)
	const readCells = cellsOf(read);
	const rows = read.filter((r) => !onEarlier(read, readCells, r));
	const cells = cellsOf(rows);
	return (x, z) => {
		// (the roads near it, each by its nearest row, the further in it the more it counts)
		const near = nearestByRoad(rows, cells, x, z).flatMap((i) => {
			const r = rows[i] as Row;
			const p = placed(r, x, z);
			return p.past < EASE ? [{ r, ...p }] : [];
		});
		if (!near.length) return 0;
		const least = Math.min(...near.map((p) => p.out));
		// (as rough here as the videos say: the bumps and ripple by it, the long waves by its square root)
		const k = rough(x, z);
		const n =
			Math.sqrt(k) * waves * (noise(x, z, 14, seed) * 0.7 + noise(x, z, 7, seed + 1) * 0.3) +
			k * bumps * (noise(x, z, 2.6, seed + 2) * 0.65 + noise(x, z, 1.4, seed + 3) * 0.35) +
			k * ripple * (noise(x, z, 0.5, seed + 4) * 0.6 + noise(x, z, 0.27, seed + 5) * 0.4);
		let sum = 0;
		let weights = 0;
		for (const { r, o, w, out, past } of near) {
			const mask = 1 - past / EASE;
			// (a bend's inside down: the tighter, the more, the more so the nearer its inside edge)
			let down = 0;
			if (camber && r.k !== 0 && Math.sign(o) === Math.sign(r.k)) {
				const share = Math.min(1, Math.abs(o) / Math.max(w, 0.5));
				down = camber * Math.min(1, Math.abs(r.k) * TIGHT) * share ** 1.3;
			}
			// (its share: the further in it, the more; none a metre past its edge)
			const weight = Math.exp(-(out - least) / SOFT) * mask;
			sum += weight * mask * (n - down);
			weights += weight;
		}
		return weights > 0 ? sum / weights : 0;
	};
}
