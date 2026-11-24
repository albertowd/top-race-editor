// The paint as the map draws it, as the build lays it: the roads' edge lines and the paint marks made into lines together (editing/marks.ts paintChains: those
// of one paint whose ends meet, one line, its corners mitred, round to a ring where they close; of two paints meeting end to end, each its side of a mitred
// seam). The roads draw the lines with an edge line in them; the objects, those of marks alone.

import type { Box, PaintMark, Road } from "../domain/types";
import { type PaintChain, paintChains, pastSeam } from "../editing/marks";
import { edgeLinePoints } from "../geometry/paint";
import { geo, type Lookup } from "../geometry/roads";
import { boxesMeet, emptyBox, grow } from "../geometry/samples";

/** A line of paint drawn: its line, its box, whether a road's edge line is in it, the marks in it (their places). */
export interface PaintDrawn {
	chain: PaintChain;
	box: Box;
	roads: boolean;
	marks: number[];
}

const made = new WeakMap<readonly Road[], WeakMap<readonly PaintMark[], PaintDrawn[]>>();
const NO_MARKS: readonly PaintMark[] = [];

/** The lines the roads' edge lines and the marks are painted as; kept while the roads and the marks are the same. */
export function paintOf(roads: readonly Road[], marks: readonly PaintMark[] | null | undefined, find: Lookup) {
	const ms = marks ?? NO_MARKS;
	let byMarks = made.get(roads);
	if (!byMarks) {
		byMarks = new WeakMap();
		made.set(roads, byMarks);
	}
	let out = byMarks.get(ms);
	if (!out) {
		const lines = roads.flatMap((r) => {
			const o = !r.along && r.lines?.length ? geo(r, find) : null;
			return o ? (r.lines ?? []).flatMap((ln) => edgeLinePoints(o, ln) ?? []) : [];
		});
		const n = lines.length;
		out = paintChains([...lines, ...ms]).map((chain) => {
			const box = emptyBox();
			for (const q of chain.points) grow(box, q[0], q[1], chain.width);
			return {
				chain,
				box,
				roads: chain.marks.some((i) => i < n),
				marks: chain.marks.filter((i) => i >= n).map((i) => i - n),
			};
		});
		byMarks.set(ms, out);
	}
	return out;
}

/** metres: as far as the map's clip round a seam's cut reaches (all of the world) */
const ALL = 1e6;

/** A line of paint stroked in its colour (its corners mitred, dotted in its dashes; no thinner than least), but what each seam it has cuts off (its end carried
 * on past the seam: the line of the other paint's side of it). */
export function strokePaint(g: CanvasRenderingContext2D, c: PaintChain, colour: string, least: number) {
	g.save();
	for (const cut of c.cuts ?? []) {
		// (everything, less the square past the seam: even-odd)
		g.beginPath();
		g.rect(-ALL, -ALL, 2 * ALL, 2 * ALL);
		const [p0, ...rest] = pastSeam(cut);
		if (p0) g.moveTo(p0[0], p0[1]);
		for (const q of rest) g.lineTo(q[0], q[1]);
		g.closePath();
		g.clip("evenodd");
	}
	g.strokeStyle = colour;
	g.lineWidth = Math.max(c.width, least);
	g.lineCap = "butt";
	g.lineJoin = "miter";
	g.miterLimit = 5;
	g.setLineDash(c.style === "dotted" ? [c.dash, c.gap] : []);
	g.beginPath();
	for (const [k, q] of c.points.entries()) {
		if (k) g.lineTo(q[0], q[1]);
		else g.moveTo(q[0], q[1]);
	}
	if (c.closed) g.closePath();
	g.stroke();
	g.restore();
}

/** Those of the lines in view, of the roads' or the marks' alone (and, of the roads', any with the mark again). */
export const paintInView = (all: readonly PaintDrawn[], b: Box, roads: boolean, mark = -1) =>
	all.filter((p) => (p.roads === roads || (mark >= 0 && p.marks.includes(mark))) && boxesMeet(p.box, b));
