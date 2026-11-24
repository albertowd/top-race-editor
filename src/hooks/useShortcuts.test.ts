import { describe, expect, it, vi } from "vitest";
import type { Editor } from "../store/editor";
import { initialState } from "../store/state";
import { handleKey } from "./useShortcuts";

function fakeEditor() {
	const state = initialState();
	const fns = [
		"undo",
		"redo",
		"save",
		"escape",
		"finishNewRoad",
		"deleteRoad",
		"deleteSelected",
		"checkSurface",
		"openBring",
		"joinNearest",
		"setMode",
		"smoothPicked",
		"toggleHelp",
		"set",
	] as const;
	const ed = Object.fromEntries(fns.map((f) => [f, vi.fn()])) as Record<(typeof fns)[number], ReturnType<typeof vi.fn>>;
	return { ed, editor: { ...ed, get: () => state } as unknown as Editor, state };
}

const key = (key: string, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({
	key,
	ctrlKey: !!mods.ctrl,
	metaKey: false,
	shiftKey: !!mods.shift,
});

describe("the keys", () => {
	it("undo, redo and save with Ctrl", () => {
		const { ed, editor } = fakeEditor();
		handleKey(editor, key("z", { ctrl: true }));
		handleKey(editor, key("Z", { ctrl: true, shift: true }));
		handleKey(editor, key("y", { ctrl: true }));
		handleKey(editor, key("s", { ctrl: true }));
		expect(ed.undo).toHaveBeenCalledTimes(1);
		expect(ed.redo).toHaveBeenCalledTimes(2);
		expect(ed.save).toHaveBeenCalledTimes(1);
		expect(ed.smoothPicked).not.toHaveBeenCalled();
		expect(handleKey(editor, key("c", { ctrl: true }))).toBe(false);
		expect(ed.checkSurface).not.toHaveBeenCalled();
	});

	it("pick the tools", () => {
		const { ed, editor, state } = fakeEditor();
		for (const k of ["v", "a", "n", "m"]) handleKey(editor, key(k));
		expect(ed.setMode.mock.calls.map((c) => c[0])).toEqual(["select", "add", "new", "measure"]);
		state.mode = "measure";
		handleKey(editor, key("M"));
		expect(ed.setMode).toHaveBeenLastCalledWith("select");
	});

	it("do what the help says", () => {
		const { ed, editor, state } = fakeEditor();
		handleKey(editor, key("Delete"));
		handleKey(editor, key("Delete", { shift: true }));
		handleKey(editor, key("Escape"));
		handleKey(editor, key("c"));
		handleKey(editor, key("b"));
		handleKey(editor, key("j"));
		handleKey(editor, key("s"));
		handleKey(editor, key("?"));
		handleKey(editor, key(" "));
		expect(handleKey(editor, key("Enter"))).toBe(false);
		state.newRoad = { name: "N", points: [] };
		handleKey(editor, key("Enter"));
		expect(handleKey(editor, key("q"))).toBe(false);
		for (const f of [
			"deleteSelected",
			"deleteRoad",
			"escape",
			"checkSurface",
			"openBring",
			"joinNearest",
			"smoothPicked",
			"toggleHelp",
			"finishNewRoad",
		] as const)
			expect(ed[f]).toHaveBeenCalledTimes(1);
		expect(ed.set).toHaveBeenCalledWith({ space: true });
	});
});
