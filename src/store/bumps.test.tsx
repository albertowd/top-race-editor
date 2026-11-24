import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MapInteractions, type Pointer } from "../canvas/interactions";
import { drawFrame, RenderCache } from "../canvas/renderer";
import { toScreen } from "../canvas/viewport";
import { BumpsPanel } from "../components/BumpsPanel";
import { BUMP_A_DAB, bumpAt, bumpsFrom } from "../editing/bumps";
import { handleKey } from "../hooks/useShortcuts";
import { loadedEditor, road } from "../test/fixtures";
import { RecordingPath } from "../test/legacy";
import { EditorProvider } from "./EditorContext";

async function setup() {
	const t = await loadedEditor([road("A", [0, 0], [100, 0])]);
	t.ed.set({ view: { cx: 20, cz: 0, ppm: 20 }, size: { w: 1000, h: 800 } });
	return { ...t, mouse: new MapInteractions(t.ed) };
}

type Ed = Awaited<ReturnType<typeof setup>>["ed"];
const at = (ed: Ed, x: number, z: number, extra: Partial<Pointer> = {}): Pointer => {
	const [sx, sy] = toScreen(ed.get().view, ed.get().size, x, z);
	return { sx, sy, button: 0, shift: false, alt: false, ctrl: false, ...extra };
};

describe("the roads’ bumps in the editor", () => {
	const Path2DWas = globalThis.Path2D;
	beforeAll(() => {
		globalThis.Path2D = RecordingPath as unknown as typeof Path2D;
	});
	afterAll(() => {
		globalThis.Path2D = Path2DWas;
	});

	it("raises the road under a brush dragged over it, undone at once, saved with the track", async () => {
		const { ed, mouse, engine } = await setup();
		handleKey(ed, { key: "u", ctrlKey: false, metaKey: false, shiftKey: false });
		expect(ed.get()).toMatchObject({ mode: "bumps", focus: "roads" });
		ed.setBumpBrush({ mode: "raise", radius: 1, strength: 1 });
		mouse.down(at(ed, 10, 0));
		mouse.move(at(ed, 12, 0));
		mouse.up();
		// (a dab every quarter of its reach along the drag: those near a point each raise it some)
		const b = ed.get().bumps;
		const here = bumpAt(b, 10, 0);
		expect(here).toBeGreaterThan(BUMP_A_DAB);
		expect(bumpAt(b, 11, 0)).toBeGreaterThan(here);
		expect(bumpAt(b, 15, 0)).toBe(0);
		expect(ed.get().undo).toHaveLength(1);
		// (drawn over the roads)
		const calls: string[] = [];
		const g = new Proxy({} as Record<string, unknown>, {
			get: (t, k: string) => (k in t ? t[k] : k === "measureText" ? () => ({ width: 10 }) : (..._a: unknown[]) => calls.push(k)),
			set: (t, k: string, v) => {
				t[k] = v;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		drawFrame({ g, size: ed.get().size, dpr: 1, state: ed.get(), tiles: null, cache: new RenderCache() });
		// (the brush's reach ringed at the mouse)
		expect(calls).toContain("arc");
		await ed.save();
		expect(bumpAt(bumpsFrom(engine.bumps), 10, 0)).toBeCloseTo(here, 6);
		ed.undo();
		expect(bumpAt(ed.get().bumps, 10, 0)).toBe(0);
	});

	it("bumps a point of a road’s mesh dragged up or down, or typed", async () => {
		const { ed, mouse } = await setup();
		ed.setMode("bumps");
		// (the road's mesh as loaded: its points, x z)
		ed.set({ meshes: { A: { deps: [], state: "ready", P: Float32Array.from([10, 1, 10.5, 1]) } } });
		mouse.down(at(ed, 10.05, 1));
		expect(ed.get().bumpPick).toEqual([10, 1]);
		// (20 pixels up: 10 mm up)
		const p = at(ed, 10.05, 1);
		mouse.move({ ...p, sy: p.sy - 20 });
		mouse.up();
		expect(bumpAt(ed.get().bumps, 10, 1)).toBeCloseTo(0.01, 4);
		expect(bumpAt(ed.get().bumps, 10.5, 1)).toBe(0);
		expect(ed.get().undo).toHaveLength(1);
		render(
			<EditorProvider editor={ed}>
				<BumpsPanel />
			</EditorProvider>,
		);
		const mm = screen.getByLabelText("Bump (mm)");
		await userEvent.clear(mm);
		await userEvent.type(mm, "-5{Enter}");
		expect(bumpAt(ed.get().bumps, 10, 1)).toBeCloseTo(-0.005, 4);
		await userEvent.click(screen.getByRole("button", { name: "Clear All Bumps" }));
		expect(bumpAt(ed.get().bumps, 10, 1)).toBe(0);
		// (no point near: the road there picked instead)
		mouse.down(at(ed, 40, 0));
		mouse.up();
		expect(ed.get().sel.r).toBe(0);
	});
});
