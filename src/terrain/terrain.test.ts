import { describe, expect, it } from "vitest";
import { handleKey } from "../hooks/useShortcuts";
import { createEditor } from "../store/editor";
import { fakeEngine } from "../test/fixtures";
import { fakeTerrainEngine, gridJson } from "../test/terrain";
import { covering, dab, dabsAlong, emptyRaster, falloff, RAISE_A_DAB } from "./brush";
import { gridFrom, rasterAt, rasterFrom, rasterJson, sample } from "./codec";
import { inRing, pointNear, sideNear } from "./rings";
import { createTerrain } from "./store";
import type { TerrainDoc } from "./types";

async function loaded() {
	const engine = fakeTerrainEngine();
	const t = createTerrain(engine.api, { delay: 1 });
	await t.load();
	return { t, ...engine };
}

const layerCalls = (calls: { path: string; body?: Record<string, unknown> }[]) =>
	calls.filter((c) => c.path === "/api/terrain/layers").map((c) => c.body ?? {});

describe("the grids and rasters", () => {
	it("come from the engine and go back to it as they were", () => {
		const g = gridFrom(gridJson(0, 0, 1, 3, 2, (x, z) => x + 10 * z));
		expect(Array.from(g.v).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, 2, 10, 11, 12]);
		expect(sample(g, 1.5, 0.5)).toBeCloseTo(6.5, 3);
		expect(sample(g, 5, 0)).toBeNaN();
		const r = { x0: 1, z0: 2, cell: 0.5, nx: 2, nz: 1, v: new Float32Array([0.25, -1.5]) };
		expect(rasterFrom(rasterJson(r))).toEqual(r);
		expect(rasterAt(r, 1.25, 2)).toBeCloseTo(-0.625, 6);
		expect(rasterAt(r, 0, 2)).toBe(0);
	});
});

describe("the brush", () => {
	it("raises most at its middle, nothing at its reach", () => {
		expect(falloff(0, 4)).toBe(1);
		expect(falloff(4, 4)).toBe(0);
		const r = emptyRaster(-10, -10, 21, 21);
		dab(r, 0, 0, { mode: "raise", radius: 4, strength: 1, target: 0 }, () => 0);
		expect(rasterAt(r, 0, 0)).toBeCloseTo(RAISE_A_DAB, 6);
		expect(rasterAt(r, 4, 0)).toBe(0);
		dab(r, 0, 0, { mode: "lower", radius: 4, strength: 0.5, target: 0 }, () => 0);
		expect(rasterAt(r, 0, 0)).toBeCloseTo(RAISE_A_DAB / 2, 6);
	});

	it("flattens to its height and smooths a bump", () => {
		const r = emptyRaster(-10, -10, 21, 21);
		dab(r, 0, 0, { mode: "flatten", radius: 4, strength: 1, target: 3 }, () => 1);
		expect(rasterAt(r, 0, 0)).toBeCloseTo(1, 6);
		const s = emptyRaster(-10, -10, 21, 21);
		const bump = (x: number, z: number) => (x === 0 && z === 0 ? 2 : 0);
		dab(s, 0, 0, { mode: "smooth", radius: 4, strength: 1, target: 0 }, bump);
		expect(rasterAt(s, 0, 0)).toBeLessThan(0);
		expect(rasterAt(s, 1, 0)).toBeGreaterThan(0);
	});

	it("grows its raster past its edge, keeping what it has", () => {
		const r = emptyRaster(0, 0, 4, 4);
		r.v[5] = 7;
		expect(covering(r, 1, 1, 2, 2)).toBe(r);
		const g = covering(r, -3, 0, 2, 2);
		expect(g.x0).toBeLessThanOrEqual(-3);
		expect(rasterAt(g, 1, 1)).toBe(7);
		const n = covering(null, 10.5, 20.5, 12, 22);
		expect(n.x0).toBeLessThan(10.5);
		expect(n.x0 + (n.nx - 1) * n.cell).toBeGreaterThan(12);
		expect(dabsAlong([0, 0], [4, 0], 4)).toEqual([
			[1, 0],
			[2, 0],
			[3, 0],
			[4, 0],
		]);
	});
});

describe("the rings", () => {
	const sq: [number, number][] = [
		[0, 0],
		[4, 0],
		[4, 4],
		[0, 4],
	];
	it("are found under the mouse: inside, a point, a side", () => {
		expect(inRing(sq, 2, 2)).toBe(true);
		expect(inRing(sq, 5, 2)).toBe(false);
		expect(pointNear(sq, 4.1, 3.9, 0.5)).toBe(2);
		expect(sideNear(sq, 2, 0.2, 0.5)).toEqual({ i: 0, p: [2, 0] });
	});
});

describe("the terrain editor", () => {
	it("loads the terrain as saved, its rasters and its grids", async () => {
		const { t, calls } = await loaded();
		const s = t.get();
		expect(s.status).toBe("ready");
		expect(Object.keys(s.rasters)).toEqual(["paddock.npz"]);
		expect(s.grids.ground?.nx).toBe(21);
		expect(s.points?.why[0]).toBe(4);
		expect(layerCalls(calls)[0]).toEqual({ want: ["original", "filtered", "ground", "change", "points"] });
	});

	it("asks again as the filters change, once for many changes", async () => {
		const { t, calls } = await loaded();
		t.setFilters({ over_m: 2 });
		t.setFilters({ over_m: 3 });
		await t.settle();
		const asked = layerCalls(calls);
		expect(asked).toHaveLength(2);
		expect((asked[1].doc as TerrainDoc).filters.over_m).toBe(3);
		expect(asked[1].want).toEqual(["filtered", "ground", "change", "points"]);
		expect(t.get().dirty).toBe(true);
		t.undo();
		t.undo();
		expect(t.get().dirty).toBe(false);
	});

	it("draws an area and an edit, point by point", async () => {
		const { t } = await loaded();
		t.setTool("not_ground");
		t.draftPoint([0, 0]);
		t.draftPoint([0, 0]);
		t.draftPoint([10, 0]);
		t.draftPoint([10, 10]);
		expect(t.get().draft).toHaveLength(3);
		t.finishDraft();
		expect(t.get().doc?.filters.areas).toEqual([
			{
				name: "not ground 1",
				kind: "not_ground",
				ring: [
					[0, 0],
					[10, 0],
					[10, 10],
				],
			},
		]);
		expect(t.get().pick).toEqual({ kind: "area", i: 0 });
		t.setTool("flat");
		for (const p of [
			[20, 0],
			[30, 0],
			[30, 9],
		] as [number, number][])
			t.draftPoint(p);
		t.finishDraft();
		const e = t.get().doc?.edits[1];
		expect(e).toMatchObject({ type: "flat", name: "flat 1", at: [26.667, 3], plus: 0, ease_m: 5 });
		t.moveRing({ kind: "edit", i: 1 }, 1, 1);
		expect(t.get().doc?.edits[1]).toMatchObject({
			ring: [
				[21, 1],
				[31, 1],
				[31, 10],
			],
			at: [27.667, 4],
		});
		t.toggleEdit(1);
		expect(t.get().doc?.edits[1].off).toBe(true);
		t.toggleEdit(1);
		expect(t.get().doc?.edits[1].off).toBeUndefined();
		t.moveEdit(1, -1);
		expect(t.get().doc?.edits.map((x) => x.type)).toEqual(["flat", "raster"]);
		expect(t.get().pick).toEqual({ kind: "edit", i: 0 });
	});

	it("brushes into a new raster edit, shown at once, sent with its data, saved", async () => {
		const { t, calls, saved } = await loaded();
		const groundAt = (x: number, z: number) => {
			const g = t.get().grids.ground;
			return g ? sample(g, x, z) : Number.NaN;
		};
		const before = groundAt(20, 10);
		t.setBrush({ mode: "raise", radius: 3, strength: 1 });
		t.beginStroke([20, 10]);
		t.strokeTo([22, 10]);
		t.endStroke();
		const s = t.get();
		expect(s.doc?.edits.at(-1)).toEqual({ type: "raster", name: "brushed 1", file: "brush_1.npz" });
		expect(groundAt(20, 10)).toBeGreaterThan(before + 0.1);
		expect(t.takeTouched()).not.toBeNull();
		await t.settle();
		const last = (layerCalls(calls).at(-1)?.doc ?? {}) as TerrainDoc & { edits: { data?: unknown }[] };
		expect(last.edits[0].data).toBeUndefined();
		expect(last.edits[1].data).toBeDefined();
		// (one undo takes the whole stroke and its new edit away)
		t.undo();
		expect(t.get().doc?.edits).toHaveLength(1);
		t.redo();
		expect(t.get().dirty).toBe(true);
		await t.save();
		expect(saved.doc.edits.map((e) => e.name)).toEqual(["paddock", "brushed 1"]);
		expect(t.get().dirty).toBe(false);
		const sent = (calls.find((c) => c.path === "/api/terrain" && c.body)?.body?.doc ?? {}) as {
			edits: { data?: unknown }[];
		};
		expect(sent.edits[1].data).toBeDefined();
		// (painted again: into the raster picked)
		t.pickThing({ kind: "edit", i: 1 });
		t.beginStroke([20, 10]);
		t.endStroke();
		expect(t.get().doc?.edits).toHaveLength(2);
		expect(t.get().dirty).toBe(true);
	});

	it("has its keys while it is worked on; = is its category", async () => {
		const { t } = await loaded();
		const ed = createEditor(fakeEngine().client);
		const key = (k: string, extra: Partial<KeyboardEvent> = {}) => handleKey(ed, { key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...extra }, t);
		key("=");
		expect(ed.get().focus).toBe("terrain");
		t.setTool("ground");
		for (const p of [
			[0, 0],
			[5, 0],
			[5, 5],
		] as [number, number][])
			t.draftPoint(p);
		key("Enter");
		expect(t.get().doc?.filters.areas).toHaveLength(1);
		key("z", { ctrlKey: true });
		expect(t.get().doc?.filters.areas).toHaveLength(0);
		key("Escape");
		expect(t.get().tool).toBe("select");
	});
});
