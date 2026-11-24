import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditorProvider } from "../store/EditorContext";
import { loadedEditor } from "../test/fixtures";
import { MeshCheck } from "./RoadForm";

describe("a road's mesh, checked as it is made", () => {
	it("says it is right, or which of its faces would be wrong in the game", async () => {
		const { ed } = await loadedEditor();
		render(
			<EditorProvider editor={ed}>
				<MeshCheck name="A" />
			</EditorProvider>,
		);
		expect(screen.getByText("its mesh not made yet")).toBeInTheDocument();
		const mesh = { deps: [], P: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), F: new Uint32Array([0, 1, 2, 1, 3, 2]) };
		act(() => ed.set({ meshes: { A: { ...mesh, state: "ready", wrong: { down: [], thin: [] } } } }));
		expect(screen.getByText("2 faces, all facing up, none without area")).toBeInTheDocument();
		act(() => ed.set({ meshes: { A: { ...mesh, state: "ready", wrong: { down: [1], thin: [0] } } } }));
		expect(screen.getByRole("alert")).toHaveTextContent(
			"1 face facing down, 1 face without area of 2 faces (red on the map): the game's normals go wrong there",
		);
		act(() => ed.set({ meshes: { A: { deps: [], state: "loading" } } }));
		expect(screen.getByText("checking its mesh…")).toBeInTheDocument();
	});

	it("is made for the selected road whether the wireframe is shown or not", async () => {
		const { ed, engine } = await loadedEditor();
		ed.setLayer("wire", false);
		ed.selectRoad(0);
		await new Promise((r) => setTimeout(r, 20));
		expect(engine.calls.some((c) => c.path === "/api/mesh")).toBe(true);
	});
});
