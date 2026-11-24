import type { Kerb, PaintLine, Road, Selection } from "../domain/types";
import { kerbPieces, lineOffsets, type Offset, pieceOffsets } from "../geometry/paint";
import { geo, type Lookup } from "../geometry/roads";
import { pointAt, type Samples, span } from "../geometry/samples";

export type NodeHandleKind = "p" | "in" | "out" | "wl" | "wr";
export interface NodeHandle {
	kind: NodeHandleKind;
	n: number;
	x: number;
	z: number;
}

/** The road's node handles: each node, its handles in and out, its widths left and right. */
export function nodeHandles(road: Road | undefined, find: Lookup): NodeHandle[] {
	const out: NodeHandle[] = [];
	if (!road || road.along || !road.curve) return out;
	const o = geo(road, find);
	const last = road.curve.length - 1;
	road.curve.forEach((nd, i) => {
		out.push({ kind: "p", n: i, x: nd.p[0], z: nd.p[1] });
		if (i > 0) out.push({ kind: "in", n: i, x: nd.p[0] + nd.in[0], z: nd.p[1] + nd.in[1] });
		if (i < last) out.push({ kind: "out", n: i, x: nd.p[0] + nd.out[0], z: nd.p[1] + nd.out[1] });
		if (o) {
			const q = pointAt(o, o.s[o.nodeAt[i]]);
			out.push(
				{ kind: "wl", n: i, x: nd.p[0] + q.nx * nd.left, z: nd.p[1] + q.nz * nd.left },
				{ kind: "wr", n: i, x: nd.p[0] - q.nx * nd.right, z: nd.p[1] - q.nz * nd.right },
			);
		}
	});
	return out;
}

export type EndHandleKind = "lfrom" | "lto" | "kfrom" | "kto";
export interface EndHandle {
	kind: EndHandleKind;
	x: number;
	z: number;
	nx: number;
	nz: number;
}

/** A handle at s along a road (its samples o), in the middle of a strip between two offsets. */
function endAt(kind: EndHandleKind, o: Samples, s: number, off: { a: Offset; b: Offset }): EndHandle {
	const q = pointAt(o, s);
	const w = (off.a(q) + off.b(q)) / 2;
	return { kind, x: q.x + q.nx * w, z: q.z + q.nz * w, nx: q.nx, nz: q.nz };
}

function lineEnds(o: Samples, ln: PaintLine): EndHandle[] {
	const off = lineOffsets(ln);
	const [s0, s1] = span(o, ln.from, ln.to);
	return [endAt("lfrom", o, s0, off), endAt("lto", o, s1, off)];
}

/** A rumble's own ends: its first piece's start, its last piece's end (on another road where it goes on). */
function kerbEnds(road: Road, k: Kerb, find: Lookup): EndHandle[] {
	const pcs = kerbPieces(road, k, find);
	const first = pcs[0];
	const last = pcs.at(-1);
	if (!first || !last) return [];
	const s0 = first.role === "before" ? (first.outer ?? first.s0) : first.s0;
	const s1 = last.role === "after" ? (last.outer ?? last.s1) : last.s1;
	return [endAt("kfrom", first.o, s0, pieceOffsets(k, first)), endAt("kto", last.o, s1, pieceOffsets(k, last))];
}

/** The selected line's or rumble's ends (a rumble's own ends: on another road where it goes on along one). */
export function endHandles(road: Road | undefined, sel: Selection, find: Lookup): EndHandle[] {
	const o = road && geo(road, find);
	if (!road || !o || road.along) return [];
	const ln = sel.line >= 0 ? road.lines?.[sel.line] : undefined;
	const k = sel.kerb >= 0 ? road.kerbs?.[sel.kerb] : undefined;
	return [...(ln ? lineEnds(o, ln) : []), ...(k ? kerbEnds(road, k, find) : [])];
}
