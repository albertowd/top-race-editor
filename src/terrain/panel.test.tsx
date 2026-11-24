import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EditorProvider } from "../store/EditorContext";
import { loadedEditor } from "../test/fixtures";
import { fakeTerrainEngine } from "../test/terrain";
import { createTerrain } from "./store";
import { TerrainProvider } from "./TerrainContext";
import { TerrainPanel } from "./TerrainPanel";

async function shown() {
	const { ed } = await loadedEditor();
	const engine = fakeTerrainEngine();
	const t = createTerrain(engine.api, { delay: 1 });
	render(
		<EditorProvider editor={ed}>
			<TerrainProvider terrain={t}>
				<TerrainPanel />
			</TerrainProvider>
		</EditorProvider>,
	);
	await act(() => t.settle());
	await screen.findByRole("button", { name: "Save terrain" });
	return { ed, t, engine };
}

describe("the terrain panel", () => {
	it("loads the terrain the first time it is shown, then shows its layers, edits and filters", async () => {
		const { t } = await shown();
		expect(t.get().status).toBe("ready");
		expect(screen.getByRole("button", { name: "Save terrain" })).toBeDisabled();
		await userEvent.selectOptions(screen.getByLabelText("The layer shown"), "filtered");
		expect(t.get().show.layer).toBe("filtered");
		const edits = screen.getByRole("list", { name: "Edits" });
		expect(within(edits).getByText("paddock")).toBeInTheDocument();
		expect(screen.getByText("Trees in the picture")).toBeInTheDocument();
	});

	it("edits the edit picked, and saves it", async () => {
		const { t, engine } = await shown();
		act(() => {
			t.addEdit({
				type: "offset",
				name: "",
				ring: [
					[0, 0],
					[5, 0],
					[5, 5],
				],
				by: 1,
				ease_m: 2,
			});
		});
		const by = await screen.findByLabelText("Metres the ground is raised by (less than 0: lowered)");
		await userEvent.clear(by);
		await userEvent.type(by, "-0.5{Enter}");
		expect(t.get().doc?.edits[1]).toMatchObject({ type: "offset", name: "raised 1", by: -0.5 });
		await userEvent.click(screen.getByRole("button", { name: "Save terrain" }));
		await act(() => t.settle());
		expect(engine.saved.doc.edits[1]).toMatchObject({ by: -0.5 });
		await userEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(t.get().doc?.edits).toHaveLength(1);
	});

	it("says so when the track has no terrain", async () => {
		const { ed } = await loadedEditor();
		const engine = fakeTerrainEngine();
		engine.saved.doc = null as never;
		const t = createTerrain(
			{
				...engine.api,
				info: async () => ({ exists: false, reason: "no terrain yet (tools/reference/terrain/terrain.json)" }),
			} as never,
			{ delay: 1 },
		);
		render(
			<EditorProvider editor={ed}>
				<TerrainProvider terrain={t}>
					<TerrainPanel />
				</TerrainProvider>
			</EditorProvider>,
		);
		expect(await screen.findByText(/This track has no terrain: no terrain yet/)).toBeInTheDocument();
	});
});
