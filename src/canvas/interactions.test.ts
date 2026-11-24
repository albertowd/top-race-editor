import { describe, expect, it } from "vitest";
import type { Road } from "../domain/types";
import { loadedEditor, road } from "../test/fixtures";
import { MapInteractions, type Pointer } from "./interactions";
import { toScreen } from "./viewport";

const at = (ed: Awaited<ReturnType<typeof loadedEditor>>["ed"], x: number, z: number, extra: Partial<Pointer> = {}): Pointer => {
	const [sx, sy] = toScreen(ed.get().view, ed.get().size, x, z);
	return { sx, sy, button: 0, shift: false, alt: false, ctrl: false, ...extra };
};

async function setup(roads?: Road[]) {
	const t = await loadedEditor(roads);
	t.ed.set({ view: { cx: 50, cz: 0, ppm: 10 }, size: { w: 1000, h: 800 } });
	return { ...t, mouse: new MapInteractions(t.ed) };
}

describe("the mouse on the map", () => {
	it("selects a road, then drags its node, snapping to another road", async () => {
		const { ed, mouse } = await setup();
		mouse.down(at(ed, 70, 1));
		mouse.up();
		expect(ed.get().sel.r).toBe(0);
		mouse.down(at(ed, 0, 0));
		expect(ed.get().sel.n).toBe(0);
		mouse.move(at(ed, 49.5, -20.3));
		expect(ed.get().snapMark?.label).toMatch(/^C's centre line, s 29\.\d$/);
		mouse.up();
		expect(ed.get().roads[0].curve?.[0].p[0]).toBeCloseTo(50, 6);
		expect(ed.get().roads[0].moved).toBe(true);
		expect(ed.get().status).toMatch(/^snapped to C's centre line/);
		expect(ed.get().undo).toHaveLength(1);
		mouse.down(at(ed, 100, 0, { ctrl: true }));
		mouse.move(at(ed, 99.5, 0.2, { ctrl: true }));
		mouse.up();
		expect(ed.get().roads[0].curve?.[1].p).toEqual([99.5, 0.2]);
	});

	it("forgets a press that moved nothing; a click on nothing selects nothing", async () => {
		const { ed, mouse } = await setup();
		ed.selectRoad(0);
		mouse.down(at(ed, 0, 0));
		mouse.up();
		expect(ed.get().undo).toHaveLength(0);
		mouse.down(at(ed, 30, 30));
		mouse.up();
		expect(ed.get().sel.r).toBe(-1);
	});

	it("pans on drag, zooms on the wheel", async () => {
		const { ed, mouse } = await setup();
		mouse.down({ ...at(ed, 50, 30), button: 2 });
		const p = at(ed, 50, 30);
		mouse.move({ ...p, sx: p.sx + 100 });
		mouse.up();
		expect(ed.get().view.cx).toBe(60);
		mouse.wheel(500, 400, -100);
		expect(ed.get().view.ppm).toBeGreaterThan(10);
	});

	it("turns a handle, the other following, unless Alt makes a corner", async () => {
		const { ed, mouse } = await setup([road("A", [0, 0], [30, 0]), road("Z", [0, 0], [-30, 0])]);
		ed.set({ view: { cx: 15, cz: 0, ppm: 10 } });
		ed.change(() => {});
		ed.selectRoad(0);
		ed.change((r) => {
			if (r.curve) r.curve.splice(1, 0, { p: [15, 0], in: [-3, 0], out: [3, 0], left: 4, right: 4 });
		}, true);
		mouse.down(at(ed, 18, 0));
		mouse.move(at(ed, 15, 5));
		mouse.up();
		const turned = ed.get().roads[0].curve?.[1];
		expect(turned?.out).toEqual([0, 5]);
		expect(turned?.in[0]).toBeCloseTo(0, 9);
		expect(turned?.in[1]).toBeCloseTo(-3, 9);
		mouse.down(at(ed, 15, 5));
		mouse.move(at(ed, 18, 5, { alt: true }));
		mouse.up();
		expect(ed.get().roads[0].curve?.[1].corner).toBe(true);
		mouse.down(at(ed, 0, 4));
		mouse.move(at(ed, 0, 6, { shift: true }));
		mouse.up();
		expect(ed.get().roads[0].curve?.[0]).toMatchObject({ left: 6, right: 6 });
	});

	it("slides a line along its road, and drags its end", async () => {
		const { ed, mouse } = await setup([road("A", [0, 0], [100, 0], { lines: [{ side: "left", from: 10, to: 20 }] })]);
		mouse.down(at(ed, 15, 3.8));
		expect(ed.get().sel).toMatchObject({ r: 0, line: 0 });
		expect(mouse.move(at(ed, 25, 3.8))).toBe("grabbing");
		expect(mouse.up()).toBe("grab");
		expect(ed.get().roads[0].lines?.[0]).toMatchObject({ from: 20, to: 30 });
		mouse.down(at(ed, 30, 3.8));
		mouse.move(at(ed, 40, 3.8));
		mouse.up();
		expect(ed.get().roads[0].lines?.[0]).toMatchObject({ from: 20, to: 40 });
	});

	it("measures, adds nodes and new roads in their modes", async () => {
		const { ed, mouse } = await setup();
		ed.setMode("measure");
		mouse.down(at(ed, 10, 10));
		mouse.move(at(ed, 13, 14));
		mouse.up();
		expect(ed.get().measure).toEqual({ a: [10, 10], b: [13, 14] });
		ed.selectRoad(0);
		ed.setMode("add");
		mouse.down(at(ed, 30, 0));
		expect(ed.get().roads[0].curve).toHaveLength(3);
		ed.setMode("new");
		mouse.down(at(ed, 0, 30));
		expect(ed.get().newRoad?.points).toEqual([[0, 30]]);
	});

	it("drags a run-off: its ends along its road, its width out", async () => {
		const runoff: Road = { name: "R", along: { road: "A", side: "left", from: 20, to: 60 }, width: 2 };
		const { ed, mouse } = await setup([road("A", [0, 0], [100, 0]), runoff]);
		ed.selectRoad(1);
		mouse.down(at(ed, 20, 4));
		mouse.move(at(ed, 10, 4));
		mouse.up();
		expect(ed.get().roads[1].along?.from).toBe(10);
		mouse.down(at(ed, 60, 4));
		mouse.move(at(ed, 5, 4));
		mouse.up();
		expect(ed.get().roads[1].along?.to).toBe(11);
		mouse.down(at(ed, 10.5, 6));
		expect(ed.get().sel.n).toBe(0);
		mouse.move(at(ed, 10.5, 7.5));
		mouse.up();
		const profile = ed.get().roads[1].profile ?? [];
		expect(profile[0][0]).toBeCloseTo(10.5, 0);
		expect(profile[0][1]).toBe(3.5);
		expect(ed.get().roads[1].moved).toBe(true);
	});

	it("drags a rumble's ends: along its road, then on along the next road", async () => {
		const { ed, mouse } = await setup([
			road("A", [0, 0], [100, 0], { kerbs: [{ side: "right", kind: "ramp", from: 80, to: null, width: 1 }] }),
			road("B", [100, 0], [150, 0]),
		]);
		ed.set({ sel: { r: 0, n: -1, line: -1, kerb: 0 } });
		mouse.down(at(ed, 80, -4.5));
		mouse.move(at(ed, 70, -4.5));
		mouse.up();
		expect(ed.get().roads[0].kerbs?.[0].from).toBe(70);
		mouse.down(at(ed, 100, -4.5));
		mouse.move(at(ed, 110, -3));
		mouse.up();
		expect(ed.get().roads[0].kerbs?.[0].after).toMatchObject({ road: "B", side: "right", from: 0, outer: "to" });
		mouse.down(at(ed, 70, -4.5));
		mouse.up();
		expect(ed.get().undo).toHaveLength(2);
		ed.set({ sel: { r: 0, n: -1, line: -1, kerb: -1 } });
		mouse.down(at(ed, 85, -4.5));
		expect(ed.get().status).toBe("this rumble goes on along another road: drag its ends (the triangles)");
		mouse.up();
	});

	it("pans with the middle button and with Space held", async () => {
		const { ed, mouse } = await setup();
		ed.set({ space: true });
		mouse.down(at(ed, 70, 1));
		const p = at(ed, 70, 1);
		mouse.move({ ...p, sx: p.sx - 50 });
		mouse.up();
		expect(ed.get().view.cx).toBe(45);
		expect(ed.get().sel.r).toBe(-1);
		ed.set({ space: false });
		mouse.down({ ...at(ed, 0, 0), button: 1 });
		expect(mouse.dragging).toBe(true);
		expect(mouse.move(at(ed, 0, 0))).toBeNull();
		expect(mouse.up()).toBeNull();
		expect(mouse.up()).toBeNull();
	});

	it("shows a hand over a line", async () => {
		const { ed, mouse } = await setup([road("A", [0, 0], [100, 0], { lines: [{ side: "left" }] })]);
		expect(mouse.move(at(ed, 30, 3.8))).toBe("grab");
		expect(mouse.move(at(ed, 30, 30))).toBe("default");
		expect(ed.get().mouse?.[0]).toBeCloseTo(30, 9);
	});
});
