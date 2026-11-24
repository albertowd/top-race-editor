import { describe, expect, it } from "vitest";
import type { PaintMark } from "../domain/types";
import { edgeLinePoints } from "../geometry/paint";
import { geo, lookup } from "../geometry/roads";
import { road } from "../test/fixtures";
import { markThrough } from "./marks";
import { snapToMarks, snapToPaintEnd } from "./snap";

describe("paint snapped to", () => {
	// (a road along +x, 4 m each side, a white line on its left, LINE_PAD in from its edge)
	const r = { ...road("A", [0, 0], [20, 0]), lines: [{ side: "left" as const, to: 10 }] };
	const roads = [r];
	const marks: PaintMark[] = [
		markThrough(
			"M",
			[
				[30, 1],
				[34, 1],
			],
			{ width: 0.1, colour: "yellow" },
		),
	];

	it("takes the end of another line or mark, of any paint, but not the line's own", () => {
		const o = geo(r, lookup(roads));
		const end = (o && r.lines[0] && edgeLinePoints(o, r.lines[0])?.points.at(-1)) || [0, 0];
		expect(end[0]).toBeCloseTo(10, 6);
		expect(Math.abs(end[1])).toBeCloseTo(4 - 0.2, 6);
		const edge = end[1];
		const near = snapToPaintEnd(roads, lookup(roads), marks, 10.2, edge, null, 0.5);
		expect(near?.label).toBe("A's left line's end");
		expect([near?.x, near?.z]).toEqual(end);
		expect(snapToPaintEnd(roads, lookup(roads), marks, 10.2, edge, { road: 0, line: 0 }, 0.5)).toBeNull();
		expect(snapToPaintEnd(roads, lookup(roads), marks, 33.8, 1.1, { road: 0, line: 0 }, 0.5)?.label).toBe("M's end");
		// (a mark's node: onto a road's line's end too)
		expect(snapToMarks(marks, 10.1, edge, 0, 0.5, roads, lookup(roads))?.label).toBe("A's left line's end");
	});
});
