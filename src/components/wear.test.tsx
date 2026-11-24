import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { WallNode } from "../domain/types";
import { EditorProvider } from "../store/EditorContext";
import { loadedEditor } from "../test/fixtures";
import { WearPanel } from "./WearPanel";

const node = (x: number, z: number): WallNode => ({ p: [x, z], in: [0, -3], out: [0, 3] });

describe("how worn the track looks, in the panels", () => {
	it("sets the paint’s wear, new rubber’s darkness and the cars’ width, undone as any edit", async () => {
		const { ed } = await loadedEditor();
		render(
			<EditorProvider editor={ed}>
				<WearPanel part="paint" />
				<WearPanel part="rubber" />
				<WearPanel part="lines" />
			</EditorProvider>,
		);
		await userEvent.selectOptions(screen.getByLabelText("Paint wear"), "used");
		await userEvent.selectOptions(screen.getByLabelText("New rubber's darkness"), "very_used");
		const w = screen.getByLabelText("Cars' width (m)");
		await userEvent.type(w, "1.8{Enter}");
		expect(ed.get().objects).toMatchObject({ wear: { paint: "used", rubber: "very_used" }, ai: { width: 1.8 } });
		ed.undo();
		expect(ed.get().objects?.ai).toBeUndefined();
	});

	it("lays rubber marks of the track’s along the layout’s racing lines, again: replaced", async () => {
		const { ed } = await loadedEditor();
		const layout = ed.get().layout;
		render(
			<EditorProvider editor={ed}>
				<WearPanel part="rubber" />
			</EditorProvider>,
		);
		// (no racing lines: nothing to lay along)
		const lay = screen.getByRole("button", { name: /Lay Rubber Along/ });
		expect(lay).toBeDisabled();
		ed.changeObjects((d) => {
			const l = d.layouts[layout];
			if (l)
				l.lines = {
					fast: { curve: [node(0, 0), node(0, 20), node(10, 20)], closed: true },
					pit: { curve: [node(5, 0), node(5, 10)], closed: false },
				};
			d.wear = { rubber: "almost_new" };
			d.ai = { width: 2 };
		});
		await userEvent.click(screen.getByRole("button", { name: /Lay Rubber Along/ }));
		const made = ed.get().objects?.rubber ?? [];
		const L = layout.toUpperCase();
		expect(made.map((m) => m.name)).toEqual([`RUBBER_${L}_FAST`, `RUBBER_${L}_PIT`]);
		// (as dark as new rubber is laid, as wide as such a band along cars 2 m wide; the fast line's ring kept)
		expect(made[0]).toMatchObject({ wear: "almost_new", width: 1.8, closed: true });
		expect(made[0]?.curve).toEqual([node(0, 0), node(0, 20), node(10, 20)]);
		expect(ed.get().obj).toEqual({ kind: "rubber", i: 0, j: -1 });
		// (the line's own curve not the mark's: moving one leaves the other)
		ed.changeObjects((d) => {
			const m = d.rubber?.[0]?.curve[0];
			if (m) m.p = [1, 1];
		});
		expect(ed.get().objects?.layouts[layout]?.lines?.fast?.curve[0]?.p).toEqual([0, 0]);
		// (again: the two replaced, not added)
		await userEvent.click(screen.getByRole("button", { name: /Lay Rubber Along/ }));
		expect(ed.get().objects?.rubber).toHaveLength(2);
		expect(ed.get().objects?.rubber?.[0]?.curve[0]?.p).toEqual([0, 0]);
	});
});
