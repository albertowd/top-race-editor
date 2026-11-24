// The paved areas in the editor: placed as a rectangle where clicked, of the track's first material; a corner added on the picked one's edge where clicked; a
// corner dragged; a corner taken away (three kept); saved as the store checks them; the whole taken away.
import { describe, expect, it } from "vitest";
import { areaOf } from "../editing/areas";
import { markLength } from "../editing/marks";
import { loadedEditor, road } from "../test/fixtures";

describe("the paved areas", () => {
	it("are placed, shaped and saved", async () => {
		const { ed, engine } = await loadedEditor([road("A", [0, 0], [100, 0])]);
		ed.set({ place: "areas", mode: "place" });
		ed.placeAt(50, 50);
		const a = () => ed.get().objects?.areas?.[0];
		expect(a()?.name).toBe("AREA_1");
		expect(a()?.material).toBe(ed.get().track?.materials[0]);
		expect(a()?.points).toHaveLength(4);
		expect(areaOf(a()?.points ?? [])).toBeCloseTo(200, 6);
		expect(ed.get().obj).toEqual({ kind: "areas", i: 0, j: -1 });
		// (a row of parking bays along its longest edge: 8 bays of 2.5 m in 20 m, 9 lines 5 m into it; again: anew)
		const parks = () => (ed.get().objects?.marks ?? []).filter((m) => m.name.startsWith("PARK_AREA_1_"));
		ed.parkArea(2.5, 5);
		expect(parks()).toHaveLength(9);
		expect(parks().every((m) => Math.abs(markLength(m) - 5) < 1e-9 && m.colour === "white")).toBe(true);
		ed.parkArea(2.5, 5);
		expect(parks()).toHaveLength(9);
		// (the picked one: a corner added on its edge, where clicked)
		const [p0, p1] = a()?.points ?? [];
		const mid: [number, number] = [((p0?.[0] ?? 0) + (p1?.[0] ?? 0)) / 2, ((p0?.[1] ?? 0) + (p1?.[1] ?? 0)) / 2];
		ed.placeAt(mid[0], mid[1]);
		expect(a()?.points).toHaveLength(5);
		expect(a()?.points[1]?.[0]).toBeCloseTo(mid[0], 6);
		expect(ed.get().obj).toEqual({ kind: "areas", i: 0, j: 1 });
		// (that corner taken away, and another: three kept)
		ed.deleteObject();
		expect(a()?.points).toHaveLength(4);
		expect(ed.get().obj).toEqual({ kind: "areas", i: 0, j: -1 });
		ed.selectObject({ kind: "areas", i: 0, j: 0 });
		ed.deleteObject();
		ed.selectObject({ kind: "areas", i: 0, j: 0 });
		ed.deleteObject();
		expect(a()?.points).toHaveLength(3);
		// (saved: as the store keeps them)
		await ed.save();
		const sent = engine.calls.find((c) => c.path === "/api/objects" && c.body) as {
			body: { objects: { areas?: { name: string; points: number[][] }[] } };
		};
		expect(sent.body.objects.areas?.[0]?.points).toHaveLength(3);
		// (the whole taken away)
		ed.selectObject({ kind: "areas", i: 0, j: -1 });
		ed.deleteObject();
		expect(ed.get().objects?.areas).toBeUndefined();
	});
});
