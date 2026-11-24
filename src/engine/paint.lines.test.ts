// @vitest-environment node
// The roads' edge lines laid on the floor as merged, on made-up roads: a road whose lines meet a branch leaving it (each over the other's surface at the fork),
// its own rumble and a run-off beside it, each line painted along its whole length as the editor draws it, every dash of a dotted one, over whatever floor is
// there; and the paint hidden under a rumble only where its raised part truly lies over the line.
import { describe, expect, it } from "vitest";
import { localFiller, type Mesh, merge, type Region } from "./merge";
import { DASH, GAP, kerbGeometry, LINE_LIFT, LINE_PAD, type Line, layPaint, type PaintMesh, type Roads } from "./paint";
import { asBuilt, fine, interp, mesh, priority, type RoadDesc } from "./roads";
import { crop, floorOf, roadsTop, surfaceOf } from "./roadshost";
import { triangle } from "./velopark-fixture";

type P2 = [number, number];
const node = (p: P2, inn: P2, out: P2, w: number) => ({ p, in: inn, out, left: w, right: w });
const straight = (z: number, lines: Line[], kerbs: Roads[string]["kerbs"] = []) => ({
	curve: [node([0, z], [0, 0], [20, 0], 4), node([60, z], [-20, 0], [0, 0], 4)],
	lines,
	kerbs,
});

/** The roads merged as the track's floor is (trackfloor.ts): the rumbles over all, the roads by their order, the ground (level, at 0) under them; each region's
 * mesh. */
async function mergedFloor(roads: Roads): Promise<Record<string, Mesh>> {
	const ground = () => 0;
	const built = priority(roads).map((name) => ({ name, m: mesh(asBuilt(roads[name] as RoadDesc, roads), ground) }));
	const window = { x0: -10, z0: -30, x1: 70, z1: 60 };
	const top = roadsTop(built);
	const regions: Region[] = [];
	for (const { name } of built) {
		const r = roads[name] as Roads[string];
		if (r.along) continue;
		(r.kerbs ?? []).forEach((k, i) => {
			for (const g of kerbGeometry(r, k, roads, top, undefined, ground)) {
				const c = crop({ P: g.P, U: g.U, F: g.F }, window);
				if (c) regions.push({ name: `KERB_${name}_${i}`, ...c });
			}
		});
	}
	for (const { name, m } of built) {
		const c = crop(m, window);
		if (c) regions.push({ name, ...c });
	}
	regions.push({ name: "ground", ground: { height: ground, uv: (x, z) => [x / 50, z / 50], spacing: 2 } });
	return merge(regions, window, localFiller(await triangle()));
}

/** The paint laid on them, as the track's build lays it: on the roads and rumbles as merged. */
function paintOn(roads: Roads, meshes: Record<string, Mesh>): Promise<PaintMesh[]> {
	return layPaint(roads, floorOf(Object.fromEntries(Object.entries(meshes).filter(([n]) => n !== "ground"))));
}

/** Where along a road's line (metres along it) the paint is seen: at its middle and either side of it, a face of paint of its colour over the floor there (its
 * own, or another's painted as one with it), at least half LINE_LIFT over the floor's top. */
function seen(road: RoadDesc, line: Line, paint: PaintMesh[], meshes: Record<string, Mesh>) {
	const on = paint.filter((p) => p.colour === (line.colour ?? "white")).map((p) => surfaceOf(p));
	const top = floorOf(Object.fromEntries(Object.entries(meshes).filter(([n]) => n !== "ground")));
	const f = fine(road);
	const sgn = line.side === "left" ? 1 : -1;
	return (s: number) => {
		const mx = interp(s, f.at, f.mx);
		const mz = interp(s, f.at, f.mz);
		const lx = interp(s, f.at, f.lx);
		const lz = interp(s, f.at, f.lz);
		const o = sgn * (interp(s, f.at, sgn > 0 ? f.wl : f.wr) - (line.pad ?? LINE_PAD));
		return [-0.05, 0, 0.05].every((d) => {
			const x = mx + lx * (o + d);
			const z = mz + lz * (o + d);
			const h = Math.max(...on.map((S) => S.y(x, z)).filter((y) => !Number.isNaN(y)));
			const t = top.y(x, z);
			return Number.isFinite(h) && !Number.isNaN(t) && h >= t + LINE_LIFT / 2;
		});
	};
}

/** Metres along (every 5 cm) from a to b where the paint is not seen. */
function missing(at: (s: number) => boolean, a: number, b: number): number[] {
	const out: number[] = [];
	for (let s = a + 0.025; s < b; s += 0.05) if (!at(s)) out.push(Math.round(s * 1000) / 1000);
	return out;
}

describe("the edge lines laid on the floor as merged", () => {
	it("paints each line whole over the branch, the rumble and the run-off it meets; every dash", async () => {
		// (M along +x, a solid line on its left, a dotted one on its right; its rumble on its left from 20 to 40, a run-off beside it there; B leaving it to its
		// right from x 10, over M's right side at first, its lines whole)
		const roads: Roads = {
			M: {
				name: "M",
				...straight(
					0,
					[
						{ name: "M_L", side: "left" },
						{ name: "M_R", side: "right", style: "dotted" },
					],
					[{ side: "left", from: 20, to: 40, kind: "ramp", width: 1, start: "triangle", end: "triangle", taper: 2 }],
				),
			},
			R: { name: "R", along: { road: "M", side: "left", from: 15, to: 45 }, width: 3 },
			B: {
				name: "B",
				joins: ["M", null],
				curve: [node([10, -2], [0, 0], [15, 0], 3), node([50, -16], [-12, 4], [0, 0], 3)],
				lines: [
					{ name: "B_L", side: "left" },
					{ name: "B_R", side: "right" },
				],
			},
		};
		const meshes = await mergedFloor(roads);
		const paint = await paintOn(roads, meshes);
		const M = roads.M as RoadDesc;
		const B = roads.B as RoadDesc;
		const end = (r: RoadDesc) => fine(r).at.at(-1) as number;
		// (the floor there as merged: B over M's right side by the fork, the rumble and the run-off beside M's left)
		const lines = (M as Roads[string]).lines as Line[];
		const [mL, mR] = lines as [Line, Line];
		const [bL, bR] = (roads.B as Roads[string]).lines as [Line, Line];
		// (M's solid line along its whole length, by the rumble and the run-off)
		expect(missing(seen(M, mL, paint, meshes), 0, end(M))).toEqual([]);
		// (every dash of its dotted line, over B where B lies on it)
		const dashes: [number, number][] = [];
		for (let a = 0; a < end(M) - 1e-6; a += DASH + GAP) dashes.push([a, Math.min(a + DASH, end(M))]);
		const mr = seen(M, mR, paint, meshes);
		expect(dashes.filter(([a, b]) => missing(mr, a + 0.05, b - 0.05).length)).toEqual([]);
		// (and between the dashes, no paint)
		expect(dashes.slice(0, -1).filter(([, b]) => mr(b + GAP / 2))).toEqual([]);
		// (B's lines whole, from its start inside M)
		expect(missing(seen(B, bL, paint, meshes), 0, end(B))).toEqual([]);
		expect(missing(seen(B, bR, paint, meshes), 0, end(B))).toEqual([]);
	}, 60_000);

	it("hides the paint under a rumble only where its raised part lies over the line", async () => {
		// (a rumble set 0.5 m in from the road's edge: its ramp over the line, LINE_PAD in, from 20 to 40)
		const roads: Roads = {
			H: {
				name: "H",
				...straight(
					0,
					[{ name: "H_L", side: "left" }],
					[
						{
							side: "left",
							from: 20,
							to: 40,
							kind: "ramp",
							width: 1,
							inset: 0.5,
							start: "triangle",
							end: "triangle",
							taper: 2,
						},
					],
				),
			},
		};
		const meshes = await mergedFloor(roads);
		const paint = await paintOn(roads, meshes);
		const H = roads.H as RoadDesc;
		const at = seen(H, (roads.H as Roads[string]).lines?.[0] as Line, paint, meshes);
		expect(missing(at, 0, 19.5)).toEqual([]);
		expect(missing(at, 40.5, 60)).toEqual([]);
		// (none where the rumble lies over it, risen)
		for (let s = 22; s < 38; s += 0.5) expect(at(s), `${s}`).toBe(false);
	}, 60_000);
});
