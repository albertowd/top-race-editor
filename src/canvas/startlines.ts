// The layouts' start lines on the map, as the build paints them on the ground (engine/paint.ts's startLinePaint: along each layout's start and finish gate):
// every layout's, as every one of them is painted on the track and seen in all; one where layouts share it. Worked out once for the objects and roads as they
// are (both kept as they are until edited).

import type { Box, Road, TrackObjects } from "../domain/types";
import { type Roads, START_GATE, startLinePaint } from "../engine/paint";

/** A start line: its triangles (x z, three corners each), its box, the layouts that paint it. */
export interface StartLineShape {
	layouts: string[];
	tris: Float64Array;
	box: Box;
}

const made = new WeakMap<object, WeakMap<object, StartLineShape[]>>();

/** Every layout's start line, those the same (to the centimetre) once. */
export function startLinesOf(o: TrackObjects, roads: readonly Road[]): StartLineShape[] {
	let byRoads = made.get(o.layouts);
	if (!byRoads) {
		byRoads = new WeakMap();
		made.set(o.layouts, byRoads);
	}
	const kept = byRoads.get(roads);
	if (kept) return kept;
	// (as the last ones where neither the roads near a start nor a layout's start changed: a road dragged far off)
	const near = nearStarts(o, roads);
	const starts = JSON.stringify(Object.entries(o.layouts).map(([k, l]) => [k, l.start_line ?? null, l.grid?.[0] ?? null, gateOf(l) ?? null]));
	if (last?.starts === starts && last.near.length === near.length && last.near.every((r, i) => r === near[i])) {
		byRoads.set(roads, last.lines);
		return last.lines;
	}
	const byName = Object.fromEntries(near.map((r) => [r.name, r])) as unknown as Roads;
	const out: StartLineShape[] = [];
	const seen = new Map<string, StartLineShape>();
	// (all at once: the roads' outlines worked out once; each mesh named START_<its layout>)
	const meshes = new Map(startLinePaint(o.layouts, byName, () => 0).map((m) => [m.name, m]));
	for (const layout of Object.keys(o.layouts)) {
		const mesh = meshes.get(`START_${layout.toUpperCase()}`);
		if (!mesh) continue;
		const tris = new Float64Array(mesh.F.length * 2);
		const box = { xmin: Infinity, zmin: Infinity, xmax: -Infinity, zmax: -Infinity };
		for (let i = 0; i < mesh.F.length; i++) {
			const k = (mesh.F[i] as number) * 3;
			const x = mesh.P[k] as number;
			const z = mesh.P[k + 2] as number;
			tris[i * 2] = x;
			tris[i * 2 + 1] = z;
			box.xmin = Math.min(box.xmin, x);
			box.xmax = Math.max(box.xmax, x);
			box.zmin = Math.min(box.zmin, z);
			box.zmax = Math.max(box.zmax, z);
		}
		const key = Array.from(tris, (v) => Math.round(v * 100)).join(",");
		const same = seen.get(key);
		if (same) {
			same.layouts.push(layout);
			continue;
		}
		const shape = { layouts: [layout], tris, box };
		seen.set(key, shape);
		out.push(shape);
	}
	byRoads.set(roads, out);
	last = { starts, near, lines: out };
	return out;
}

/** the start lines last worked out, of what */
let last: { starts: string; near: readonly Road[]; lines: StartLineShape[] } | null = null;

/** metres round a start line's places (its gate's posts, its grid's first slot) a road may reach and cross it (the painter's own reach, and more) */
const NEAR = 30;

/** A layout's start and finish gate (the one its start line is painted along). */
const gateOf = (l: TrackObjects["layouts"][string]) => l.timing?.find((t) => t.name === START_GATE);

/** The roads a start line may be on: those whose nodes' box (with their handles), grown by NEAR, holds a place of a layout's start line (its gate's posts, its
 * first grid slot); and those they join (their outlines meet them). The painter outlines each road, so those far off are left out. */
function nearStarts(o: TrackObjects, roads: readonly Road[]): Road[] {
	const firsts = Object.values(o.layouts).flatMap((l) => {
		if (!(l as { start_line?: string }).start_line) return [];
		const gate = gateOf(l);
		return [...(gate ? [gate.left, gate.right] : []), ...(l.grid?.[0] ? [l.grid[0]] : [])];
	});
	const near = new Set<string>();
	for (const r of roads) {
		const [x0, x1, z0, z1] = nodesBox(r);
		if (firsts.some((g) => g.x > x0 - NEAR && g.x < x1 + NEAR && g.z > z0 - NEAR && g.z < z1 + NEAR)) near.add(r.name);
	}
	for (const r of roads) if (near.has(r.name)) for (const j of r.joins ?? []) if (j) near.add(j);
	return roads.filter((r) => near.has(r.name) || (r.along && near.has(r.along.road)));
}

/** A road's nodes' box with their handles: x from, x to, z from, z to. */
function nodesBox(r: Road): [number, number, number, number] {
	let x0 = Infinity;
	let x1 = -Infinity;
	let z0 = Infinity;
	let z1 = -Infinity;
	for (const n of r.curve ?? [])
		for (const q of [n.p, [n.p[0] + n.in[0], n.p[1] + n.in[1]], [n.p[0] + n.out[0], n.p[1] + n.out[1]]]) {
			x0 = Math.min(x0, q[0] as number);
			x1 = Math.max(x1, q[0] as number);
			z0 = Math.min(z0, q[1] as number);
			z1 = Math.max(z1, q[1] as number);
		}
	return [x0, x1, z0, z1];
}

/** pixels a metre the start lines' names are written from (nearer in: legible, not in the way) */
export const LABELS_PPM = 1.5;

/** Each start line in view named by its layouts (lines on one gate apart, each its own label a row lower), beside its end; scr: the world to the screen. */
export function drawStartLineLabels(
	g: CanvasRenderingContext2D,
	lines: readonly StartLineShape[],
	b: Box,
	scr: (x: number, z: number) => [number, number],
): void {
	g.font = "11px system-ui, sans-serif";
	g.textBaseline = "middle";
	const used = new Map<string, number>();
	for (const l of lines) {
		if (l.box.xmax < b.xmin || l.box.xmin > b.xmax || l.box.zmax < b.zmin || l.box.zmin > b.zmax) continue;
		const [x, y] = scr(l.box.xmax, (l.box.zmin + l.box.zmax) / 2);
		// (lines whose labels would fall on one another: each a row lower)
		const key = `${Math.round(x / 40)},${Math.round(y / 40)}`;
		const row = used.get(key) ?? 0;
		used.set(key, row + 1);
		const text = `start: ${l.layouts.join(", ")}`;
		const w = g.measureText(text).width;
		const ty = y + row * 15;
		g.fillStyle = "rgba(0,0,0,0.65)";
		g.fillRect(x + 6, ty - 7, w + 8, 14);
		g.fillStyle = "#f2f2f2";
		g.fillText(text, x + 10, ty);
	}
}

/** The start lines in view, filled white as the paint is. */
export function drawStartLines(g: CanvasRenderingContext2D, lines: readonly StartLineShape[], b: Box): void {
	g.fillStyle = "#f2f2f2";
	for (const l of lines) {
		if (l.box.xmax < b.xmin || l.box.xmin > b.xmax || l.box.zmax < b.zmin || l.box.zmin > b.zmax) continue;
		g.beginPath();
		for (let i = 0; i + 5 < l.tris.length; i += 6) {
			g.moveTo(l.tris[i] as number, l.tris[i + 1] as number);
			g.lineTo(l.tris[i + 2] as number, l.tris[i + 3] as number);
			g.lineTo(l.tris[i + 4] as number, l.tris[i + 5] as number);
			g.closePath();
		}
		g.fill();
	}
}
