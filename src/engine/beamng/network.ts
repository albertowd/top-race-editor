// The layouts' racing lines as BeamNG's road network (the track's export_beamng.road_network, route_races): its waypoints and the roads between them, which
// BeamNG's map draws and its AI drives; and each race's checkpoints on its own layout's road of it. All in BeamNG's axes (z up).
//
// Where the layouts' racing lines run on the same road, one road of the network: a point of a line within JOIN_NEAR across a line before it, running its way,
// is that line's nearest waypoint (and keeps to that line until JOIN_LEAVE across), so the layouts share their road and part at junctions, as the real track's
// roads do. BeamNG's AI routes its race from checkpoint to checkpoint along the network: with each layout a loop of its own, laid over the others, a checkpoint
// took the nearest of them, often another layout's, which no road joined to the next.

import { byCodePoint } from "../order";
import type { RacePath, V3 } from "./races";

export const WAYPOINT_STEP = 5;
export const WAYPOINT_RADIUS: [number, number] = [2, 4.5];
const JOIN_NEAR = 1.5;
const JOIN_LEAVE = 2.5;
const JOIN_FACING = 0.8;
const SLACK = 3;

export type Waypoint = [string, V3, number];

/** Points of a set by square cells, to find those near one. */
class Cells {
	private readonly cells = new Map<string, number[]>();
	constructor(readonly size: number) {}
	private key(x: number, y: number) {
		return `${Math.floor(x / this.size)},${Math.floor(y / this.size)}`;
	}
	add(i: number, x: number, y: number) {
		const k = this.key(x, y);
		const l = this.cells.get(k);
		if (l) l.push(i);
		else this.cells.set(k, [i]);
	}
	near(x: number, y: number, r: number, at: (i: number) => [number, number]): number[] {
		const out: number[] = [];
		const cx = Math.floor(x / this.size);
		const cy = Math.floor(y / this.size);
		const reach = Math.ceil(r / this.size);
		for (let i = cx - reach; i <= cx + reach; i++)
			for (let j = cy - reach; j <= cy + reach; j++)
				for (const k of this.cells.get(`${i},${j}`) ?? []) {
					const p = at(k);
					if (Math.hypot(p[0] - x, p[1] - y) <= r) out.push(k);
				}
		return out;
	}
}

/** The points of a line every step metres along it (by its points' running length), its last too where open. */
function picksAlong(line: V3[], step: number, closed: boolean): number[] {
	const s = [0];
	for (let i = 1; i < line.length; i++) {
		const a = line[i - 1] as V3;
		const b = line[i] as V3;
		s.push((s[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
	}
	const total = s.at(-1) as number;
	const picks: number[] = [];
	let j = 0;
	for (let d = 0; d < total; d += step) {
		while (j < s.length && (s[j] as number) < d) j++;
		picks.push(Math.min(j, line.length - 1));
	}
	if (!closed && picks.at(-1) !== line.length - 1) picks.push(line.length - 1);
	return picks;
}

/** An edge between two waypoints as a key, the lower first. */
const edgeKey = (a: number, b: number) => `${Math.min(a, b)},${Math.max(a, b)}`;

/** The laps' waypoints as they are laid: their positions, radii and ways (unit, across the ground), by cells, and the edges between them so far. */
interface LapNet {
	pos: V3[];
	rad: number[];
	facing: [number, number][];
	cells: Cells;
	edges: Set<string>;
}

/** The roads off the laps as open segments of their own, their waypoints named by road. */
function addSideRoads(side: Record<string, { line: V3[]; radius: number }>, waypoints: Waypoint[], segments: Record<string, string[]>): void {
	for (const [name, { line, radius }] of Object.entries(side)) {
		const nodes: string[] = [];
		for (const i of picksAlong(line, WAYPOINT_STEP, false)) {
			const node = `wp_${name}_${nodes.length}`;
			const p = line[i] as V3;
			waypoints.push([node, [p[0], p[1], p[2] - 0.3], radius]);
			nodes.push(node);
		}
		segments[name] = nodes;
	}
}

/** A waypoint's radius: the road's half width there, within WAYPOINT_RADIUS (its widest where the sides are not known). */
function waypointRadius(sides: [number, number][] | null, i: number): number {
	if (!sides) return WAYPOINT_RADIUS[1];
	const w = sides[i] as [number, number];
	return Math.min(Math.max((w[0] + w[1]) / 2, WAYPOINT_RADIUS[0]), WAYPOINT_RADIUS[1]);
}

/** The waypoint of the lines before (those under known) a point running way d is on: the nearest running its way within JOIN_NEAR across (JOIN_LEAVE while
 * on one), null for none. */
function joinWaypoint(net: LapNet, known: number, at: V3, d: [number, number], on: boolean): number | null {
	if (!known) return null;
	let k: number | null = null;
	let best = Infinity;
	for (const j of net.cells.near(at[0], at[1], WAYPOINT_STEP, (q) => [(net.pos[q] as V3)[0], (net.pos[q] as V3)[1]])) {
		if (j >= known) continue;
		const f = net.facing[j] as [number, number];
		const rel = [at[0] - (net.pos[j] as V3)[0], at[1] - (net.pos[j] as V3)[1]] as [number, number];
		const along = rel[0] * f[0] + rel[1] * f[1];
		const across = Math.abs(rel[0] * f[1] - rel[1] * f[0]);
		const gap = Math.hypot(along, across);
		if (f[0] * d[0] + f[1] * d[1] > JOIN_FACING && Math.abs(along) < WAYPOINT_STEP * 0.6 && across < (on ? JOIN_LEAVE : JOIN_NEAR) && gap < best) {
			k = j;
			best = gap;
		}
	}
	return k;
}

/** A racing line laid on the network: the waypoints it runs through in turn, each one of the lines before it where it runs on theirs, else a new one. */
function lapSequence(net: LapNet, line: V3[], sides: [number, number][] | null): number[] {
	const n = line.length;
	const known = net.pos.length;
	const seq: number[] = [];
	let on = false;
	for (const i of picksAlong(line, WAYPOINT_STEP, true)) {
		const p = line[i] as V3;
		// (the racing line runs a little over the road)
		const at: V3 = [p[0], p[1], p[2] - 0.3];
		const a = line[(i + 2) % n] as V3;
		const b = line[(((i - 2) % n) + n) % n] as V3;
		let d: [number, number] = [a[0] - b[0], a[1] - b[1]];
		const L = Math.hypot(d[0], d[1]) || 1;
		d = [d[0] / L, d[1] / L];
		const r = waypointRadius(sides, i);
		let k = joinWaypoint(net, known, at, d, on);
		on = k !== null;
		if (k === null) {
			k = net.pos.length;
			net.pos.push(at);
			net.rad.push(r);
			net.facing.push(d);
			net.cells.add(k, at[0], at[1]);
		} else net.rad[k] = Math.max(net.rad[k] as number, r);
		if (seq.at(-1) !== k) seq.push(k);
	}
	if (seq.length > 1 && seq.at(-1) === seq[0]) seq.pop();
	return seq;
}

/** The waypoints each edge joins, both ways. */
function adjacency(edges: Set<string>): Map<number, Set<number>> {
	const adj = new Map<number, Set<number>>();
	for (const e of edges) {
		const [a, b] = e.split(",").map(Number) as [number, number];
		if (!adj.has(a)) adj.set(a, new Set());
		if (!adj.has(b)) adj.set(b, new Set());
		adj.get(a)?.add(b);
		adj.get(b)?.add(a);
	}
	return adj;
}

/** The waypoints between a and b along the roads joining them, within four steps of a: none where none reach b so near. */
function roadBetween(adj: Map<number, Set<number>>, a: number, b: number): number[] {
	const came = new Map<number, number | null>([[a, null]]);
	let todo = [a];
	for (let round = 0; round < 4 && !came.has(b); round++) {
		const nxt: number[] = [];
		for (const x of todo)
			for (const y of adj.get(x) ?? [])
				if (!came.has(y)) {
					came.set(y, x);
					nxt.push(y);
				}
		todo = nxt;
	}
	if (!came.has(b)) return [];
	const via: number[] = [];
	let x = came.get(b) as number;
	while (x !== a) {
		via.push(x);
		x = came.get(x) as number;
	}
	return via.toReversed();
}

/** A lap's waypoints with, between two of the lines before it (those under known) it reaches in turn, the waypoints of their road between them. */
function alongRoads(seq: number[], known: number, adj: Map<number, Set<number>>): number[] {
	const lap: number[] = [];
	seq.forEach((a, idx) => {
		const b = seq[(idx + 1) % seq.length] as number;
		lap.push(a);
		if (a < known && b < known && !adj.get(a)?.has(b)) lap.push(...roadBetween(adj, a, b));
	});
	return lap;
}

/** The edges of a lap, from each waypoint to the next (round to its first), added to a set. */
function addLapEdges(edges: Set<string>, lap: number[]): void {
	lap.forEach((a, idx) => {
		const b = lap[(idx + 1) % lap.length] as number;
		if (a !== b) edges.add(edgeKey(a, b));
	});
}

/** The waypoints of two lines still on one road, nearer than JOIN_NEAR and running its way, made one: each waypoint's own (the lowest of those made one), with
 * the widest radius of them. */
function mergeNear(pos: V3[], facing: [number, number][], rad: number[]): (x: number) => number {
	const root = pos.map((_, i) => i);
	const find = (x: number): number => {
		let y = x;
		while (root[y] !== y) {
			root[y] = root[root[y] as number] as number;
			y = root[y] as number;
		}
		return y;
	};
	const all = new Cells(JOIN_NEAR);
	pos.forEach((p, i) => {
		all.add(i, p[0], p[1]);
	});
	pos.forEach((p, a) => {
		for (const b of all.near(p[0], p[1], JOIN_NEAR, (q) => [(pos[q] as V3)[0], (pos[q] as V3)[1]])) {
			if (b <= a) continue;
			const fa = facing[a] as [number, number];
			const fb = facing[b] as [number, number];
			if (fa[0] * fb[0] + fa[1] * fb[1] > JOIN_FACING) {
				const ra = find(a);
				const rb = find(b);
				if (ra !== rb) root[Math.max(ra, rb)] = Math.min(ra, rb);
			}
		}
	});
	for (let x = 0; x < pos.length; x++) {
		const r = find(x);
		if (r !== x) rad[r] = Math.max(rad[r] as number, rad[x] as number);
	}
	return find;
}

/** A lap through the waypoints made one: each its own, none twice running, its last not its first again. */
function joinedLap(lap: number[], find: (x: number) => number): number[] {
	const out: number[] = [];
	for (const x0 of lap) {
		const x = find(x0);
		if (out.at(-1) !== x) out.push(x);
	}
	if (out.length > 1 && out.at(-1) === out[0]) out.pop();
	return out;
}

/** The stretches of the network between junctions (waypoints with other than two roads), each once: from the junctions first, in order, then the rest. */
function stretches(adj: Map<number, Set<number>>): number[][] {
	const junction = new Set([...adj].filter(([, v]) => v.size !== 2).map(([k]) => k));
	const seen = new Set<string>();
	const chains: number[][] = [];
	const starts = [...[...junction].sort((a, b) => a - b), ...[...adj.keys()].filter((k) => !junction.has(k)).sort((a, b) => a - b)];
	for (const start of starts)
		for (const nxt of [...(adj.get(start) ?? [])].sort((a, b) => a - b)) {
			if (seen.has(edgeKey(start, nxt))) continue;
			const chain = [start];
			let prev = start;
			let cur = nxt;
			seen.add(edgeKey(start, nxt));
			for (;;) {
				chain.push(cur);
				if (junction.has(cur) || cur === start) break;
				const other = [...(adj.get(cur) ?? [])].find((x) => x !== prev) as number;
				prev = cur;
				cur = other;
				seen.add(edgeKey(prev, cur));
			}
			chains.push(chain);
		}
	return chains;
}

/** Waypoints [(name, position, radius)], segments {name: [names]} and each layout's lap as the waypoints it runs through, for the racing lines {layout: (line,
 * sides)} laid on one network, longest first. Each stretch between junctions is one segment, given once. The roads off the laps {name: (line, half width)} are
 * open segments of their own, apart. */
export function roadNetwork(
	roads: Record<string, { line: V3[]; sides: [number, number][] | null }>,
	side: Record<string, { line: V3[]; radius: number }> = {},
): { waypoints: Waypoint[]; segments: Record<string, string[]>; laps: Record<string, string[]> } {
	const waypoints: Waypoint[] = [];
	const segments: Record<string, string[]> = {};
	addSideRoads(side, waypoints, segments);
	const net: LapNet = { pos: [], rad: [], facing: [], cells: new Cells(WAYPOINT_STEP), edges: new Set<string>() };
	const laps: Record<string, number[]> = {};
	for (const [lay, { line, sides }] of Object.entries(roads).sort((a, b) => b[1].line.length - a[1].line.length)) {
		const known = net.pos.length;
		const seq = lapSequence(net, line, sides);
		// (between two waypoints of the lines before it that it reaches in turn, it runs along their road, not across)
		const lap = alongRoads(seq, known, adjacency(net.edges));
		addLapEdges(net.edges, lap);
		laps[lay] = lap;
	}
	const find = mergeNear(net.pos, net.facing, net.rad);
	for (const [lay, lap] of Object.entries(laps)) laps[lay] = joinedLap(lap, find);
	const finalEdges = new Set<string>();
	for (const lap of Object.values(laps)) addLapEdges(finalEdges, lap);
	// (the stretches between junctions, each once)
	const adj = adjacency(finalEdges);
	const chains = stretches(adj);
	const name = (k: number) => `wp_lap_${k}`;
	for (const k of [...adj.keys()].sort((a, b) => a - b)) waypoints.push([name(k), net.pos[k] as V3, net.rad[k] as number]);
	chains.forEach((chain, k) => {
		segments[`road_${k}`] = chain.map(name);
	});
	return {
		waypoints,
		segments,
		laps: Object.fromEntries(Object.entries(laps).map(([lay, lap]) => [lay, lap.map(name)])),
	};
}

/** The network's roads as the races are routed on: each waypoint's place, the edges and the edges from each waypoint with their lengths, and whether a point
 * is near the roads off the laps. */
interface RouteMap {
	spot: (n: string) => V3;
	edges: [string, string][];
	adj: Map<string, [string, number][]>;
	nearOff: (q: V3) => boolean;
}

/** The point of segment a b nearest q: how far along it (0 to 1) and how far from q. */
function onSegment(q: V3, a: V3, b: V3): { t: number; d: number } {
	const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
	const t = Math.min(Math.max(((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1] + (q[2] - a[2]) * d[2]) / L2, 0), 1);
	return { t, d: Math.hypot(a[0] + d[0] * t - q[0], a[1] + d[1] * t - q[1], a[2] + d[2] * t - q[2]) };
}

/** The waypoint BeamNG's AI routes a point from: the nearer end of the edge nearest it. */
function nearestEnd(road: RouteMap, q: V3): string {
	let best = Infinity;
	let pick = road.edges[0]?.[0] as string;
	for (const [a, b] of road.edges) {
		const s = onSegment(q, road.spot(a), road.spot(b));
		if (s.d < best) {
			best = s.d;
			pick = s.t > 0.5 ? b : a;
		}
	}
	return pick;
}

/** The shortest way along the network from a to b; null where none joins them. */
function shortestWay(adj: Map<string, [string, number][]>, a: string, b: string): string[] | null {
	const best = new Map<string, number>([[a, 0]]);
	const prev = new Map<string, string>();
	const todo: [number, string][] = [[0, a]];
	while (todo.length) {
		todo.sort((x, y) => x[0] - y[0]);
		const [dist, x] = todo.shift() as [number, string];
		if (x === b) break;
		if (dist > (best.get(x) ?? Infinity)) continue;
		for (const [y, w] of adj.get(x) ?? [])
			if (dist + w < (best.get(y) ?? 1e18)) {
				best.set(y, dist + w);
				prev.set(y, x);
				todo.push([dist + w, y]);
			}
	}
	if (!best.has(b)) return null;
	const out = [b];
	while (out.at(-1) !== a) out.push(prev.get(out.at(-1) as string) as string);
	return out.reverse();
}

/** Whether a way leaves a lap: an edge of it not the lap's own with an end further than SLACK from the lap (across the ground). */
function strays(w: string[], own: Set<string>, lap: string[], spot: (n: string) => V3): boolean {
	const n = lap.length;
	for (let i = 0; i + 1 < w.length; i++) {
		const x = w[i] as string;
		const y = w[i + 1] as string;
		if (own.has([x, y].sort(byCodePoint).join("|"))) continue;
		for (const q of [spot(x), spot(y)]) {
			let m = Infinity;
			for (let k = 0; k < n; k++) {
				const a = spot(lap[k] as string);
				const b = spot(lap[(k + 1) % n] as string);
				m = Math.min(m, onSegment([q[0], q[1], 0], [a[0], a[1], 0], [b[0], b[1], 0]).d);
			}
			if (m > SLACK) return true;
		}
	}
	return false;
}

/** Where a checkpoint near q stands on a lap: on the nearest of its edges fit (by their first waypoints' place in it), between a quarter and three quarters
 * along, at q's height; and the edge's way. */
function standOn(q: V3, fit: number[], lap: string[], spot: (n: string) => V3): [V3, V3] {
	const n = lap.length;
	let best = Infinity;
	let out: [V3, V3] = [q, [1, 0, 0]];
	for (const i of fit) {
		const a = spot(lap[i] as string);
		const b = spot(lap[(i + 1) % n] as string);
		const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const L2 = d[0] * d[0] + d[1] * d[1] || 1;
		const t = Math.min(Math.max(((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / L2, 0.25), 0.75);
		const foot: V3 = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
		const dist = Math.hypot(foot[0] - q[0], foot[1] - q[1]);
		if (dist < best) {
			best = dist;
			const L = Math.hypot(...d) || 1;
			out = [
				[foot[0], foot[1], q[2]],
				[d[0] / L, d[1] / L, d[2] / L],
			];
		}
	}
	return out;
}

/** The first checkpoint (of the waypoints routed from, picks) whose route to the next leaves the lap or finds none; null for none. */
function firstStray(picks: string[], road: RouteMap, own: Set<string>, lap: string[]): number | null {
	for (let k = 0; k < picks.length; k++) {
		const w = shortestWay(road.adj, picks[k] as string, picks[(k + 1) % picks.length] as string);
		if (w === null || strays(w, own, lap, road.spot)) return k;
	}
	return null;
}

/** A race's checkpoints stood on its lap, with checkpoints added until its AI keeps to it, and its segments again: the checkpoint its route still leaves the
 * lap after (null for none) and how many were added; null where its lap is too short or has no edge to stand them on. */
function routeRace(path: RacePath, lap: string[], road: RouteMap): { wrong: number | null; added: number } | null {
	const { spot, adj } = road;
	const n = lap.length;
	if (n < 2) return null;
	const where = new Map(lap.map((x, i) => [x, i]));
	const own = new Set(lap.map((x, i) => [x, lap[(i + 1) % n] as string].sort(byCodePoint).join("|")));
	const fit = lap
		.map((_, i) => i)
		.filter((i) => {
			const a = lap[i] as string;
			const b = lap[(i + 1) % n] as string;
			return (adj.get(a)?.length ?? 0) === 2 && (adj.get(b)?.length ?? 0) === 2 && !road.nearOff(spot(a)) && !road.nearOff(spot(b));
		});
	if (!fit.length) return null;
	for (const p of path.pathnodes) p.pos = standOn(p.pos as V3, fit, lap, spot)[0];
	let added = 0;
	let wrong: number | null = null;
	for (let round = 0; round < 50; round++) {
		const nodes = path.pathnodes;
		const picks = nodes.map((p) => nearestEnd(road, p.pos as V3));
		wrong = firstStray(picks, road, own, lap);
		if (wrong === null) break;
		const a = picks[wrong] as string;
		const b = picks[(wrong + 1) % picks.length] as string;
		if (!where.has(a) || !where.has(b)) break;
		const i = where.get(a) as number;
		const j = where.get(b) as number;
		const mid = lap[(i + Math.floor(((((j - i) % n) + n) % n) / 2)) % n] as string;
		const node = nodes[wrong] as Record<string, unknown>;
		const [q, normal] = standOn([spot(mid)[0], spot(mid)[1], (node.pos as V3)[2]], fit, lap, spot);
		const ids = [...path.pathnodes, ...path.startPositions, ...path.segments].map((x) => x.oldId as number);
		const id = Math.max(...ids) + 1;
		nodes.splice(wrong + 1, 0, { ...node, oldId: id, name: `Checkpoint ${id}`, pos: q, normal, useAsSplit: false });
		added++;
	}
	// (the segments, from each checkpoint to the next, again)
	const top = Math.max(...[...path.pathnodes, ...path.startPositions].map((x) => x.oldId as number));
	path.segments = path.pathnodes.map((p, k) => ({
		capsules: {},
		from: p.oldId,
		mode: "waypoint",
		name: `Segment ${k + 1}`,
		oldId: top + k + 1,
		to: (path.pathnodes[(k + 1) % path.pathnodes.length] as Record<string, unknown>).oldId,
	}));
	return { wrong, added };
}

/** Each race's checkpoints on its own layout's road, and as many more as BeamNG's AI needs to keep to it: its route from each checkpoint is the nearer end of
 * the stretch nearest it, then the shortest way along the network to the next one's; where layouts take different corners between the same junctions, that way
 * took another layout's corner where it was shorter; so a checkpoint is added halfway along its own road there, until none leaves its lap. Checkpoints stand
 * between two of its waypoints, clear of junctions and of the roads off the laps. Warnings said. */
export function routeRaces(
	races: { layout: string; path: RacePath }[],
	laps: Record<string, string[]>,
	waypoints: Waypoint[],
	segments: Record<string, string[]>,
	lift: number,
	log: (line: string) => void = () => {},
	clear = 4,
): void {
	const at = new Map(waypoints.map(([n, p]) => [n, [p[0], p[1], p[2] + lift] as V3]));
	const spot = (n: string) => at.get(n) as V3;
	const edges: [string, string][] = [];
	for (const nodes of Object.values(segments)) for (let i = 0; i + 1 < nodes.length; i++) edges.push([nodes[i] as string, nodes[i + 1] as string]);
	const adj = new Map<string, [string, number][]>();
	for (const [a, b] of edges) {
		const w = Math.hypot(spot(a)[0] - spot(b)[0], spot(a)[1] - spot(b)[1], spot(a)[2] - spot(b)[2]);
		if (!adj.has(a)) adj.set(a, []);
		if (!adj.has(b)) adj.set(b, []);
		adj.get(a)?.push([b, w]);
		adj.get(b)?.push([a, w]);
	}
	const off = Object.entries(segments)
		.filter(([name]) => !name.startsWith("road_"))
		.flatMap(([, nodes]) => nodes.map(spot));
	const nearOff = (q: V3) => off.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < clear);
	const road: RouteMap = { spot, edges, adj, nearOff };
	let bad = 0;
	for (const r of races) {
		const routed = routeRace(r.path, laps[r.layout] ?? [], road);
		if (!routed) continue;
		if (routed.wrong !== null) {
			bad++;
			log(`warning: ${r.layout}: BeamNG's AI would leave its lap between checkpoints ${routed.wrong} and ${routed.wrong + 1}`);
		} else if (routed.added) log(`  ${r.layout}: ${routed.added} checkpoints added to keep its AI on its lap`);
	}
	if (!bad) log("  roads: every race’s AI route on its own lap");
}
