// The track's layouts managed in the editor: one made as the shown one is (its spots, gates, lines, the objects in it, its models with its own model as its
// own); renamed, the objects listing it following; taken away, with the objects only it had; saved, their models into the track file's layouts. A bad name
// refused; undone.
import { describe, expect, it } from "vitest";
import { loadedEditor } from "../test/fixtures";

describe("the layouts", () => {
	it("are made, renamed, taken away and saved", async () => {
		const { ed, engine } = await loadedEditor(undefined, { confirm: true });
		ed.setLayout("vp_a");
		const grid = ed.get().objects?.layouts.vp_a?.grid;
		expect(ed.newLayout("Bad Name")).toMatch(/lower case/);
		expect(ed.newLayout("vp_a")).toMatch(/already/);
		expect(ed.newLayout("vp_c")).toBeNull();
		const o = ed.get().objects;
		expect(ed.get().layout).toBe("vp_c");
		expect(o?.layouts.vp_c?.grid).toEqual(grid);
		expect(o?.lists?.vp_c).toEqual({ models: ["track", "vp_c"], from: "vp_a" });
		// (the objects of vp_a's own, in vp_c too)
		const own = (l: string) => (ed.get().objects?.objects ?? []).filter((it) => it.layouts?.includes(l)).map((it) => it.name);
		expect(own("vp_c")).toEqual(own("vp_a"));
		// (renamed: its place kept, the objects following)
		expect(ed.renameShownLayout("vp_main")).toBeNull();
		expect(Object.keys(ed.get().objects?.layouts ?? {})).toEqual(["vp_a", "vp_b", "vp_main"]);
		expect(ed.get().objects?.lists?.vp_main).toEqual({ models: ["track", "vp_main"], from: "vp_a" });
		expect(own("vp_main")).toEqual(own("vp_a"));
		// (saved: the models into the track file's layouts, the objects without them)
		await ed.save();
		expect(engine.layouts.vp_main).toEqual({ models: ["track", "vp_main"], from: "vp_a" });
		const sent = engine.calls.find((c) => c.path === "/api/objects" && c.body) as { body: { objects: object } };
		expect("lists" in sent.body.objects).toBe(false);
		// (taken away, with the objects only it had)
		ed.setLayout("vp_b");
		const before = own("vp_b");
		ed.removeShownLayout();
		expect(Object.keys(ed.get().objects?.layouts ?? {})).toEqual(["vp_a", "vp_main"]);
		expect(ed.get().objects?.lists?.vp_b).toBeUndefined();
		for (const n of before) {
			const it = ed.get().objects?.objects.find((x) => x.name === n);
			if (it) expect(it.layouts).not.toContain("vp_b");
		}
		// (undone: back)
		ed.undo();
		expect(Object.keys(ed.get().objects?.layouts ?? {})).toEqual(["vp_a", "vp_b", "vp_main"]);
	});
});
