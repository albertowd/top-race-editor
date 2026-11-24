// The objects placed on the track: what is where, what the mouse is on, and the edits (on drafts: they change what they are given). A layout's grid, pits,
// hotlap and timing are its own; everything else is one list of objects (objects.json, version 3), each a model of the catalogue, one of it or copies along a
// curve, in the layouts it lists.

import { modelInfo, modelsOf } from "../domain/models";
import type {
	Gate,
	LayoutKind,
	LayoutObjects,
	MarkKind,
	ModelKind,
	ObjectCollision,
	ObjectKind,
	ObjectPick,
	PaintMark,
	PlacedObject,
	Point,
	RubberMark,
	Spot,
	TrackKind,
	TrackObjects,
	Vec2,
} from "../domain/types";
import { addArea, addCorner, areaName, inside, middleOf, moveArea, nearestEdge, removeCorner } from "./areas";
import { addLineNode, FORK, forkAndMerge, isLineKind, keepPitOn, lineOf, MERGE, moveForkOrMerge, moveLine, removeLineNode } from "./lines";
import { markMiddle, moveMarkNode, newMark, newRubber, offMark } from "./marks";
import { addWallNode, handleAt, moveWallHandle, nearestOnWall, TYRE_R, TYRE_SPACING } from "./walls";

export const LAYOUT_KINDS: readonly LayoutKind[] = ["grid", "pits", "hotlap", "timing"];
export const TRACK_KINDS: readonly TrackKind[] = ["marks", "rubber", "areas"];

/** a rubber mark's width (m: a kart's band) and darkness where nothing says */
export const NEW_RUBBER: Pick<RubberMark, "width" | "wear"> = { width: 1.5, wear: "used" };

/** Whether a kind is laid along a curve on the roads: paint marks, rubber marks. */
export const isMarkKind = (k: ObjectKind): k is MarkKind => k === "marks" || k === "rubber";

/** A mark kind's marks as they are (the rubber: none yet, none). */
export const marksOf = (o: TrackObjects, kind: MarkKind): readonly (PaintMark | RubberMark)[] => (kind === "marks" ? o.marks : (o.rubber ?? []));

/** A mark kind's list to change (the rubber's made where there is none yet). */
function markList(o: TrackObjects, kind: MarkKind): (PaintMark | RubberMark)[] {
	if (kind === "marks") return o.marks;
	o.rubber ??= [];
	return o.rubber;
}
export const MODEL_KINDS: readonly ModelKind[] = ["cones", "boards", "poles", "tyres", "trees", "fences", "sheds", "statics", "gantries", "karts"];
export const OBJECT_KINDS: readonly ObjectKind[] = [...LAYOUT_KINDS, "cones", "boards", "poles", "tyres", "marks", "rubber", "areas", ...MODEL_KINDS.slice(4)];

export const OBJECT_LABELS: Record<ObjectKind, { one: string; many: string; what: string }> = {
	grid: { one: "Grid slot", many: "Grid", what: "the race's grid, first slot to last (AC_START_n)" },
	pits: { one: "Pit box", many: "Pits", what: "the pit boxes, where a race starts and stops in the pits (AC_PIT_n)" },
	hotlap: { one: "Hotlap start", many: "Hotlap", what: "where a hotlap starts (AC_HOTLAP_START_0)" },
	timing: { one: "Timing gate", many: "Timing", what: "the timing lines: a post either side (AC_TIME_n_L, _R)" },
	cones: { one: "Cone", many: "Cones", what: "the loose cones" },
	boards: { one: "Board", many: "Boards", what: "the distance and pit boards, facing the way they are read" },
	poles: { one: "Light pole", many: "Poles", what: "the light poles, facing the way their lights look" },
	tyres: { one: "Tyre wall", many: "Tyre walls", what: "tyre stacks: one, or a wall of them along a curve" },
	marks: {
		one: "Paint mark",
		many: "Marks",
		what: "paint on the roads: a line along a curve; lines of one paint whose ends meet are painted as one",
	},
	rubber: {
		one: "Rubber mark",
		many: "Rubber",
		what: "rubber the cars have laid on the roads (in every layout): a dark band along a curve, as dark as its wear",
	},
	trees: { one: "Tree", many: "Trees", what: "trees: eucalyptus, broad leaf, palms and bamboo" },
	fences: { one: "Fence", many: "Fences", what: "fence panels: one, or a fence of them along a curve" },
	sheds: {
		one: "Building",
		many: "Buildings",
		what: "buildings, big and small: a white shed, the judges' tower, the paddock's buildings, the farm's, the houses",
	},
	statics: {
		one: "Static object",
		many: "Static objects",
		what: "things standing as they are that are not buildings: a marshal's shelter, a chair, a timing table, banners, flagpoles, bins",
	},
	gantries: {
		one: "Start gantry",
		many: "Gantries",
		what: "the start gantry over the track, its lights facing the grid",
	},
	karts: { one: "Kart", many: "Karts", what: "parked karts, nose the way they face" },
	areas: {
		one: "Paved area",
		many: "Paved areas",
		what: "paved areas of their own shape (a car park, a lane): laid as a road, paint marks on them; drag a corner, Add Node (A) on an edge adds one",
	},
	fast: { one: "Fast line", many: "Fast line", what: "the way round the lap a car takes at speed (closed)" },
	pit: {
		one: "Pit lane line",
		many: "Pit lane line",
		what: "the way through the pits: off the fast line and back onto it (drag its fork and merge along it)",
	},
};

export const isModelKind = (k: ObjectKind): k is ModelKind => (MODEL_KINDS as readonly string[]).includes(k);
export const isLayoutKind = (k: ObjectKind): k is LayoutKind => (LAYOUT_KINDS as readonly string[]).includes(k);

/** The kind a model is (the catalogue's; one it does not have: a static object's, a thing standing as it is). */
export const kindOfModel = (model: string): ModelKind => {
	const k = modelInfo(model)?.kind;
	return k && (MODEL_KINDS as readonly string[]).includes(k) ? (k as ModelKind) : "statics";
};

/** The model a new one of a kind is, unless said: its kind's first. */
export const firstModel = (kind: ModelKind): string => modelsOf(kind)[0]?.id ?? kind;

/** Whether an object is in a layout (none listed: in every one). */
export const inLayout = (o: PlacedObject, layout: string): boolean => !o.layouts || o.layouts.includes(layout);

/** Whether an object is copies along a curve (more than one node), not one of its model. */
export const isCurve = (o: PlacedObject): boolean => o.curve.length > 1;

/** The objects of a kind in a layout: their places in the list. */
export function objectsOf(o: TrackObjects, layout: string, kind: ModelKind): number[] {
	const out: number[] = [];
	o.objects.forEach((it, i) => {
		if (kindOfModel(it.model) === kind && inLayout(it, layout)) out.push(i);
	});
	return out;
}

/** The object picked, if what is picked is one. */
export const objectOf = (o: TrackObjects, p: ObjectPick): PlacedObject | undefined => (isModelKind(p.kind) ? o.objects[p.i] : undefined);

/** The most an object's copies are apart along its curve: its own, else its model's depth (a tyre stack's: as the track's). */
export const spacingOf = (it: PlacedObject): number =>
	it.spacing ?? (kindOfModel(it.model) === "tyres" ? TYRE_SPACING : (modelInfo(it.model)?.size[2] ?? TYRE_SPACING) * (it.scale?.[2] ?? 1));

/** metres from a racing line's fork or merge within which the mouse is on it (its nodes and curve: half) */
const LINE_REACH = 1.5;

/** metres from a single object within which the mouse is on it */
const REACH: Record<ModelKind, number> = {
	cones: 0.2,
	boards: 0.3,
	poles: 0.525,
	tyres: 0.32,
	trees: 1.5,
	fences: 1.3,
	sheds: 2.5,
	statics: 2.5,
	gantries: 3,
	karts: 1,
};

/** How big each is seen from above (m): across, along. */
export const OBJECT_SIZES = {
	grid: [1.2, 1.9],
	pits: [1.6, 2.6],
	hotlap: [1.2, 1.9],
	board: [0.6, 0.12],
	cone: 0.2,
	pole: 0.35,
	post: 0.3,
} as const;

export { TYRE_R, TYRE_SPACING, wallStacks } from "./walls";

export const emptyLayout = (): LayoutObjects => ({ grid: [], pits: [], hotlap: null, timing: [] });

/** The way a heading looks (x, z). */
export const along = (heading: number): Vec2 => [Math.sin(heading), Math.cos(heading)];

/** The heading looking along (dx, dz). */
export const headingOf = (dx: number, dz: number): number => Math.atan2(dx, dz);

/** A point turned by d about (cx, cz) (as headings turn: from +z towards +x). */
export function turned(x: number, z: number, cx: number, cz: number, d: number): Vec2 {
	const c = Math.cos(d);
	const s = Math.sin(d);
	const ox = x - cx;
	const oz = z - cz;
	return [cx + ox * c + oz * s, cz - ox * s + oz * c];
}

const wrap = (h: number) => Math.atan2(Math.sin(h), Math.cos(h));

/** How many of a kind (a layout's, or the objects in it). */
export function countOf(o: TrackObjects, layout: string, kind: ObjectKind): number {
	if (isMarkKind(kind)) return marksOf(o, kind).length;
	if (kind === "areas") return o.areas?.length ?? 0;
	if (isModelKind(kind)) return objectsOf(o, layout, kind).length;
	const lay = o.layouts[layout];
	if (!lay) return 0;
	if (isLineKind(kind)) return lineOf(lay, kind) ? 1 : 0;
	return kind === "hotlap" ? (lay.hotlap ? 1 : 0) : lay[kind].length;
}

/** The spots of a layout's kind that has them (grid, pits; the hotlap as one), or null. */
function spotsOf(o: TrackObjects, layout: string, kind: ObjectKind): Spot[] | null {
	const lay = o.layouts[layout];
	if (!lay) return null;
	if (kind === "grid" || kind === "pits") return lay[kind];
	if (kind === "hotlap") return lay.hotlap ? [lay.hotlap] : [];
	return null;
}

/** The spot picked, if what is picked is a layout's spot (a grid slot, a pit box, the hotlap's start). */
export function spotOf(o: TrackObjects, layout: string, p: ObjectPick): Spot | null {
	return spotsOf(o, layout, p.kind)?.[p.i] ?? null;
}

/** Where what is picked stands and the way it looks, if it is one that turns: a layout's spot, or a single object. */
export function poseOf(o: TrackObjects, layout: string, p: ObjectPick): Spot | null {
	const spot = spotOf(o, layout, p);
	if (spot) return spot;
	const it = objectOf(o, p);
	if (!it || isCurve(it)) return null;
	const n = it.curve[0];
	return n ? { x: n.p[0], z: n.p[1], heading: it.heading ?? 0 } : null;
}

export const gateMiddle = (g: Gate): Point => ({ x: (g.left.x + g.right.x) / 2, z: (g.left.z + g.right.z) / 2 });

function curveMiddle(it: PlacedObject): Point {
	const c = it.curve;
	if (!c.length) return { x: 0, z: 0 };
	return { x: c.reduce((a, n) => a + n.p[0], 0) / c.length, z: c.reduce((a, n) => a + n.p[1], 0) / c.length };
}

/** Where what is picked is: its middle, or its part's. */
export function positionOf(o: TrackObjects, layout: string, p: ObjectPick): Point | null {
	const spot = spotOf(o, layout, p);
	if (spot) return spot;
	const lay = o.layouts[layout];
	if (isMarkKind(p.kind)) {
		const m = marksOf(o, p.kind)[p.i];
		if (!m) return null;
		const n = m.curve[p.j];
		const [x, z] = n ? (p.h ? handleAt(n, p.h) : n.p) : markMiddle(m);
		return { x, z };
	}
	if (p.kind === "areas") {
		const a = o.areas?.[p.i];
		if (!a) return null;
		const [x, z] = (p.j >= 0 ? a.points[p.j] : undefined) ?? middleOf(a.points);
		return { x, z };
	}
	if (p.kind === "timing") {
		const g = lay?.timing[p.i];
		if (!g) return null;
		if (p.j === 0) return g.left;
		return p.j === 1 ? g.right : gateMiddle(g);
	}
	if (isLineKind(p.kind)) {
		const line = lineOf(lay, p.kind);
		if (!line) return null;
		const fm = p.kind === "pit" && (p.j === FORK || p.j === MERGE) ? forkAndMerge(lay?.lines) : null;
		if (fm) {
			const [x, z] = p.j === FORK ? fm.fork : fm.merge;
			return { x, z };
		}
		const n = line.curve[p.j];
		if (!n) return curveMiddle({ curve: line.curve } as PlacedObject);
		const [x, z] = p.h ? handleAt(n, p.h) : n.p;
		return { x, z };
	}
	const it = objectOf(o, p);
	if (!it) return null;
	const n = it.curve[p.j];
	if (!n) return curveMiddle(it);
	const [x, z] = p.h ? handleAt(n, p.h) : n.p;
	return { x, z };
}

/** Whether a pick is still there (an object: of its kind still, in the layout shown or not: one of another layout is picked to be put in this one too). */
export function exists(o: TrackObjects, layout: string, p: ObjectPick): boolean {
	if (isModelKind(p.kind)) {
		const it = o.objects[p.i];
		return !!it && kindOfModel(it.model) === p.kind;
	}
	return positionOf(o, layout, p) !== null;
}

/** How far (x, z) is off a single object's footprint from above (its model's size across and deep, scaled, turned its way): 0 on it. */
export function offFootprint(it: PlacedObject, x: number, z: number): number {
	const n = it.curve[0];
	if (!n) return Infinity;
	const size = modelInfo(it.model)?.size ?? [0, 0, 0];
	const [sx, , sz] = it.scale ?? [1, 1, 1];
	const [fx, fz] = along(it.heading ?? 0);
	const dx = x - n.p[0];
	const dz = z - n.p[1];
	// (along its front, and across it: its right is the front turned a quarter clockwise)
	const front = dx * fx + dz * fz;
	const right = dx * fz - dz * fx;
	const a = Math.max(0, Math.abs(right) - ((size[0] ?? 0) * sx) / 2);
	const b = Math.max(0, Math.abs(front) - ((size[2] ?? 0) * sz) / 2);
	return Math.hypot(a, b);
}

const half = (k: ObjectKind): number => {
	if (k === "grid" || k === "hotlap") return OBJECT_SIZES.grid[1] / 2;
	if (k === "pits") return OBJECT_SIZES.pits[1] / 2;
	if (isModelKind(k)) return REACH[k];
	return OBJECT_SIZES.cone;
};

/** The object under (wx, wz), within tol metres of it (or of its own size), the nearest; of the kinds shown. A curve's node picks that node (j); its curve, the
 * whole of it (j -1); the handles of the curve picked, that handle (h). A part dragged to edit (a node, a handle, a post, a corner, an end) is taken within
 * grab metres (by default tol): its mark's reach on the screen. */
export function objectAt(
	o: TrackObjects,
	layout: string,
	wx: number,
	wz: number,
	tol: number,
	kinds: readonly ObjectKind[] = OBJECT_KINDS,
	picked: ObjectPick | null = null,
	grab = tol,
): ObjectPick | null {
	let best: ObjectPick | null = null;
	let bd = Infinity;
	// (rank: a part before the whole it is on, whatever is nearer: within its reach, a curve's handle or node is taken before its curve, which runs through its
	// nodes and is always as near)
	const consider = (kind: ObjectKind, i: number, j: number, d: number, reach: number, h?: "in" | "out", rank = 0) => {
		const within = Math.max(h || j !== -1 ? grab : tol, reach);
		const score = d - rank * within;
		if (d <= within && score < bd) {
			bd = score;
			best = h ? { kind, i, j, h } : { kind, i, j };
		}
	};
	const lay = o.layouts[layout];
	const wanted = new Set(kinds);
	for (const kind of kinds) {
		if (kind === "timing") {
			lay?.timing.forEach((g, i) => {
				consider(kind, i, 0, Math.hypot(g.left.x - wx, g.left.z - wz), OBJECT_SIZES.post);
				consider(kind, i, 1, Math.hypot(g.right.x - wx, g.right.z - wz), OBJECT_SIZES.post);
			});
		} else if (kind === "areas") {
			(o.areas ?? []).forEach((a, i) => {
				// (its corners first, then its edges and inside: the whole)
				a.points.forEach(([x, z], j) => {
					consider(kind, i, j, Math.hypot(x - wx, z - wz), OBJECT_SIZES.post, undefined, 1);
				});
				const e = nearestEdge(a.points, wx, wz);
				consider(kind, i, -1, inside(a.points, wx, wz) ? 0 : e.d, 0.5);
			});
		} else if (isMarkKind(kind)) {
			marksOf(o, kind).forEach((m, i) => {
				// (the picked one's handles and its nodes, the nearest (its ends before the rest), then its line: a straight one's handles lie on it, near its nodes)
				if (picked?.kind === kind && picked.i === i)
					m.curve.forEach((n, j) => {
						for (const h of ["in", "out"] as const) {
							if (Math.hypot(n[h][0], n[h][1]) < 1e-6) continue;
							const [x, z] = handleAt(n, h);
							consider(kind, i, j, Math.hypot(x - wx, z - wz), 0, h, 1);
						}
					});
				m.curve.forEach((n, j) => {
					const end = j === 0 || j === m.curve.length - 1;
					consider(kind, i, j, Math.hypot(n.p[0] - wx, n.p[1] - wz) - (end ? 1e-6 : 0), OBJECT_SIZES.post, undefined, 1);
				});
				consider(kind, i, -1, offMark(m, wx, wz), m.width / 2);
			});
		} else if (isLineKind(kind)) {
			const line = lineOf(lay, kind);
			if (!line) continue;
			// (the pit line's fork and merge first, then the picked line's handles, its nodes, then its curve)
			const fm = kind === "pit" ? forkAndMerge(lay?.lines) : null;
			if (fm) {
				consider(kind, 0, FORK, Math.hypot(fm.fork[0] - wx, fm.fork[1] - wz), LINE_REACH, undefined, 3);
				consider(kind, 0, MERGE, Math.hypot(fm.merge[0] - wx, fm.merge[1] - wz), LINE_REACH, undefined, 3);
			}
			if (picked?.kind === kind)
				line.curve.forEach((n, j) => {
					for (const h of ["in", "out"] as const) {
						if (Math.hypot(n[h][0], n[h][1]) < 1e-6) continue;
						const [x, z] = handleAt(n, h);
						consider(kind, 0, j, Math.hypot(x - wx, z - wz), 0, h, 2);
					}
				});
			line.curve.forEach((n, j) => {
				// (a pit line's ends are its fork and merge)
				if (kind === "pit" && fm && (j === 0 || j === line.curve.length - 1)) return;
				consider(kind, 0, j, Math.hypot(n.p[0] - wx, n.p[1] - wz), LINE_REACH / 2, undefined, 1);
			});
			if (line.curve.length > 1) consider(kind, 0, -1, nearestOnWall(line, wx, wz).d, LINE_REACH / 2);
		} else if (!isModelKind(kind)) {
			spotsOf(o, layout, kind)?.forEach((s, i) => {
				consider(kind, i, -1, Math.hypot(s.x - wx, s.z - wz), half(kind));
			});
		}
	}
	o.objects.forEach((it, i) => {
		const kind = kindOfModel(it.model);
		if (!wanted.has(kind)) return;
		// (one not in the layout shown picked too, but after one that is, where both are near)
		const away = inLayout(it, layout) ? 0 : -1;
		if (!isCurve(it)) {
			const n = it.curve[0];
			// (a gantry: anywhere over its beam, across the road)
			const d = n && (kind === "gantries" ? offFootprint(it, wx, wz) : Math.hypot(n.p[0] - wx, n.p[1] - wz));
			if (n && d !== undefined) consider(kind, i, -1, d, REACH[kind], undefined, away);
			return;
		}
		// (the picked curve's handles first, then its nodes, then its curve: the curve only away from them)
		if (picked?.kind === kind && picked.i === i)
			it.curve.forEach((n, j) => {
				for (const h of ["in", "out"] as const) {
					if (Math.hypot(n[h][0], n[h][1]) < 1e-6) continue;
					const [x, z] = handleAt(n, h);
					consider(kind, i, j, Math.hypot(x - wx, z - wz), 0, h, 2);
				}
			});
		it.curve.forEach((n, j) => {
			consider(kind, i, j, Math.hypot(n.p[0] - wx, n.p[1] - wz), TYRE_R, undefined, 1 + away);
		});
		consider(kind, i, -1, nearestOnWall(it, wx, wz).d, TYRE_R, undefined, away);
	});
	return best;
}

// ---------------------------------------------------------------- edits (on drafts)

/** The objects of a kind in a layout. */
const sameKind = (o: TrackObjects, layout: string, kind: ModelKind) => objectsOf(o, layout, kind).map((i) => o.objects[i] as PlacedObject);

/** What is picked moved by (dx, dz): a part of it (a gate's post, a curve's node), the whole of it, or (whole) all of its kind in the layout (a single object),
 * the whole curve. */
export function moveObject(o: TrackObjects, layout: string, p: ObjectPick, dx: number, dz: number, whole = false) {
	const by = (q: Point) => {
		q.x += dx;
		q.z += dz;
	};
	const lay = o.layouts[layout];
	if (isMarkKind(p.kind)) {
		const m = markList(o, p.kind)[p.i];
		if (!m) return;
		if (!whole && p.j >= 0 && !p.h) {
			const n = m.curve[p.j];
			if (n) moveMarkNode(m, p.j, n.p[0] + dx, n.p[1] + dz);
		} else for (const n of m.curve) n.p = [n.p[0] + dx, n.p[1] + dz];
		return;
	}
	if (p.kind === "areas") {
		const a = o.areas?.[p.i];
		if (a) moveArea(a, whole ? -1 : p.j, dx, dz);
		return;
	}
	if (isLineKind(p.kind)) {
		if (!lay) return;
		// (the fork or the merge: along the fast line, to the point of it nearest where it is dragged to)
		const fm = p.kind === "pit" && (p.j === FORK || p.j === MERGE) ? forkAndMerge(lay.lines) : null;
		if (fm) {
			const [x, z] = p.j === FORK ? fm.fork : fm.merge;
			moveForkOrMerge(lay.lines, p.j, x + dx, z + dz);
		} else moveLine(lay, p.kind, whole ? -1 : p.j, dx, dz);
		return;
	}
	if (isModelKind(p.kind)) {
		const it = o.objects[p.i];
		if (!it) return;
		const all = whole && !isCurve(it) ? sameKind(o, layout, p.kind).filter((x) => !isCurve(x)) : [it];
		for (const x of all)
			x.curve.forEach((n, j) => {
				if (whole || p.j < 0 || j === p.j || !isCurve(x)) n.p = [n.p[0] + dx, n.p[1] + dz];
			});
		return;
	}
	if (p.kind === "timing") {
		const gates = whole ? (lay?.timing ?? []) : [lay?.timing[p.i]];
		for (const g of gates) {
			if (!g) continue;
			if (whole || p.j !== 1) by(g.left);
			if (whole || p.j !== 0) by(g.right);
		}
		return;
	}
	const spots = spotsOf(o, layout, p.kind) ?? [];
	for (const s of whole ? spots : [spots[p.i]]) if (s) by(s);
}

/** What is picked (a spot, a single object) turned to look along heading; whole: all of its kind turned with it as one, about it. */
export function turnObject(o: TrackObjects, layout: string, p: ObjectPick, heading: number, whole = false) {
	const me = poseOf(o, layout, p);
	if (!me) return;
	if (whole) turnAll(o, layout, p, wrap(heading - me.heading), me.x, me.z);
	else {
		const spot = spotOf(o, layout, p);
		const it = objectOf(o, p);
		if (spot) spot.heading = wrap(heading);
		else if (it) it.heading = wrap(heading);
	}
}

/** A kind's whole (a layout's, or the objects of a kind in it; a curve: that one) turned by d about (cx, cz). */
export function turnAll(o: TrackObjects, layout: string, p: ObjectPick, d: number, cx: number, cz: number) {
	const lay = o.layouts[layout];
	const pt = (q: Point) => {
		[q.x, q.z] = turned(q.x, q.z, cx, cz, d);
	};
	if (isMarkKind(p.kind)) {
		for (const m of markList(o, p.kind))
			for (const n of m.curve) {
				n.p = turned(n.p[0], n.p[1], cx, cz, d);
				n.in = turned(n.in[0], n.in[1], 0, 0, d);
				n.out = turned(n.out[0], n.out[1], 0, 0, d);
			}
		return;
	}
	if (isModelKind(p.kind)) {
		const it = o.objects[p.i];
		const all = it && isCurve(it) ? [it] : sameKind(o, layout, p.kind).filter((x) => !isCurve(x));
		for (const x of all) {
			for (const n of x.curve) {
				n.p = turned(n.p[0], n.p[1], cx, cz, d);
				n.in = turned(n.in[0], n.in[1], 0, 0, d);
				n.out = turned(n.out[0], n.out[1], 0, 0, d);
			}
			if (!isCurve(x)) x.heading = wrap((x.heading ?? 0) + d);
		}
	} else if (p.kind === "timing") {
		for (const g of lay?.timing ?? []) {
			pt(g.left);
			pt(g.right);
		}
	} else {
		for (const s of spotsOf(o, layout, p.kind) ?? []) {
			pt(s);
			s.heading = wrap(s.heading + d);
		}
	}
}

/** A name not taken: prefix and the first number free. */
export function freeName(prefix: string, taken: Iterable<string>, from = 0): string {
	const have = new Set(taken);
	let n = from;
	while (have.has(`${prefix}${n}`)) n++;
	return `${prefix}${n}`;
}

/** Every name taken: the objects' and the marks' (one each, across both). */
export const names = (o: TrackObjects): string[] => [
	...o.objects.map((t) => t.name),
	...o.marks.map((m) => m.name),
	...(o.rubber ?? []).map((m) => m.name),
	...(o.areas ?? []).map((a) => a.name),
];

/** What a new one of a kind is called: its kind's own start (a piece of scenery: its model's), and a number. */
const PREFIX: Partial<Record<ModelKind, string>> = {
	cones: "CONE_",
	boards: "BOARD_",
	poles: "POLE_",
	tyres: "TYRES_",
};
const prefixOf = (kind: ModelKind, model: string) => PREFIX[kind] ?? `${model.toUpperCase()}_`;

/** What a new one of a kind is hit as: a cone or a board knocked about; one tyre stack a box; the rest not. */
const COLLISION: Partial<Record<ModelKind, ObjectCollision>> = { cones: "dynamic", boards: "dynamic", tyres: "static" };

/** Of a curve gained or lost: what it is hit as, as a single one is or a curve is (a box as one, a wall along). */
function collisionFor(it: PlacedObject): ObjectCollision {
	if (isCurve(it)) return it.collision === "static" ? "wall" : it.collision === "dynamic" ? "none" : it.collision;
	return it.collision === "wall" ? "static" : it.collision;
}

/** The kinds a new node is added to with one of them picked: those laid along a curve. */
export const CURVED_KINDS: ReadonlySet<ModelKind> = new Set(["tyres", "fences"]);

function median(v: number[]): number {
	const s = [...v].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] as number;
}

/** A new object of a kind at (x, z), looking along heading; within: the object (a curve's, of its kind) to add a node to (walls.ts's addWallNode, within tol of
 * its curve); gate: its posts (a timing gate). What was added. */
export function addObject(
	o: TrackObjects,
	layout: string,
	kind: ObjectKind,
	x: number,
	z: number,
	heading: number,
	extra: {
		within?: number;
		gate?: Gate;
		name?: string;
		tol?: number;
		model?: string;
		/** a new rubber mark's width and darkness */
		rubber?: Pick<RubberMark, "width" | "wear">;
	} = {},
): ObjectPick {
	const spot = (name?: string): Spot => ({ ...(name ? { name } : {}), x, z, heading: wrap(heading) });
	if (kind === "areas") {
		// (into the area picked, on its edge where clicked; else a new one, a rectangle there)
		const a = extra.within === undefined ? undefined : o.areas?.[extra.within];
		const j = a ? addCorner(a, x, z, Math.max(extra.tol ?? 0.5, 0.5)) : null;
		if (a && j !== null) return { kind, i: extra.within as number, j };
		return { kind, i: addArea(o, x, z, heading, extra.name ?? areaName(names(o)), extra.model), j: -1 };
	}
	if (isMarkKind(kind)) {
		// (into the mark picked: a node on its curve where clicked, else on past its nearer end; else a new one, its far end picked to drag on)
		const list = markList(o, kind);
		const m = extra.within === undefined ? undefined : list[extra.within];
		if (m && extra.within !== undefined) return { kind, i: extra.within, j: addWallNode(m, x, z, extra.tol ?? 0.5) };
		if (kind === "rubber") list.push(newRubber(extra.name ?? freeName("RUBBER_", names(o), 1), x, z, heading, extra.rubber ?? NEW_RUBBER));
		else list.push(newMark(extra.name ?? freeName("MARK_", names(o), 1), x, z, heading));
		return { kind, i: list.length - 1, j: 1 };
	}
	if (isModelKind(kind)) {
		const w = extra.within === undefined ? undefined : o.objects[extra.within];
		if (w && extra.within !== undefined && kindOfModel(w.model) === kind) {
			const j = addWallNode(w, x, z, extra.tol ?? 0.5);
			w.collision = collisionFor(w);
			if (isCurve(w)) {
				w.closed ??= false;
				w.rows ??= 1;
				w.fit ??= "place";
				delete w.heading;
			}
			return { kind, i: extra.within, j };
		}
		const model = extra.model ?? firstModel(kind);
		const it: PlacedObject = {
			name: extra.name ?? freeName(prefixOf(kind, model), names(o)),
			model,
			curve: [{ p: [x, z], in: [0, 0], out: [0, 0] }],
			heading: wrap(heading),
			collision: COLLISION[kind] ?? "none",
		};
		if (kind === "tyres") {
			const walls = o.objects.filter((t) => kindOfModel(t.model) === "tyres" && t.spacing);
			it.spacing = walls.length ? median(walls.map((t) => t.spacing as number)) : TYRE_SPACING;
		}
		// (a cone or a board: this layout's own, as before; anything else: every layout's)
		if (kind === "cones" || kind === "boards") it.layouts = [layout];
		o.objects.push(it);
		return { kind, i: o.objects.length - 1, j: kind === "tyres" ? 0 : -1 };
	}
	o.layouts[layout] ??= emptyLayout();
	const lay = o.layouts[layout];
	if (isLineKind(kind)) {
		const j = addLineNode(lay, kind, x, z, extra.tol ?? 0.5);
		return { kind, i: 0, j: j ?? -1 };
	}
	if (kind === "hotlap") {
		lay.hotlap = spot();
		return { kind, i: 0, j: -1 };
	}
	if (kind === "timing") {
		lay.timing.push(extra.gate ?? { left: { x: x - 4, z }, right: { x: x + 4, z } });
		return { kind, i: lay.timing.length - 1, j: -1 };
	}
	lay[kind].push(spot());
	return { kind, i: lay[kind].length - 1, j: -1 };
}

/** What is picked taken away (a curve's node: that node, the object with its last); whether anything was. */
export function removeObject(o: TrackObjects, layout: string, p: ObjectPick): boolean {
	if (isMarkKind(p.kind)) {
		// (a node, of a mark with more than two: that node; else the whole mark)
		const list = markList(o, p.kind);
		const m = list[p.i];
		if (!m) return false;
		if (p.j >= 0 && !p.h && m.curve.length > 2) {
			m.curve.splice(p.j, 1);
			if (m.curve.length < 3) delete m.closed;
			return true;
		}
		const gone = list.splice(p.i, 1).length > 0;
		if (p.kind === "rubber" && !list.length) delete o.rubber;
		return gone;
	}
	if (p.kind === "areas") return removeCorner(o, p.i, p.h ? -1 : p.j);
	if (isModelKind(p.kind)) {
		const it = o.objects[p.i];
		if (!it) return false;
		if (p.j >= 0 && isCurve(it)) {
			it.curve.splice(p.j, 1);
			if (!isCurve(it)) {
				// (one node left: one of it, facing as its curve went)
				const n = it.curve[0];
				it.heading = n ? headingOf(n.out[0] || -n.in[0], n.out[1] || -n.in[1]) : 0;
				it.collision = collisionFor(it);
			}
		} else o.objects.splice(p.i, 1);
		return true;
	}
	const lay = o.layouts[layout];
	if (!lay) return false;
	// (the pit line's fork and merge are where it leaves and joins the fast line: they stay; the line is taken away whole, picked on its curve)
	if (isLineKind(p.kind)) return p.j !== FORK && p.j !== MERGE && removeLineNode(lay, p.kind, p.j);
	if (p.kind === "hotlap") {
		const had = lay.hotlap !== null;
		lay.hotlap = null;
		return had;
	}
	return lay[p.kind].splice(p.i, 1).length > 0;
}

/** A grid slot, pit box, gate, object... earlier (by -1) or later among its kind: their numbers are their order. The pick where it went, or null. */
export function reorderObject(o: TrackObjects, layout: string, p: ObjectPick, by: number): ObjectPick | null {
	if (isModelKind(p.kind)) {
		const mine = objectsOf(o, layout, p.kind);
		const at = mine.indexOf(p.i);
		const j = mine[at + by];
		if (at < 0 || j === undefined) return null;
		[o.objects[p.i], o.objects[j]] = [o.objects[j] as PlacedObject, o.objects[p.i] as PlacedObject];
		return { ...p, i: j };
	}
	let list: unknown[] | undefined;
	if (isLineKind(p.kind)) return null;
	if (p.kind === "areas") return null;
	if (isMarkKind(p.kind)) list = markList(o, p.kind);
	else if (p.kind !== "hotlap") list = o.layouts[layout]?.[p.kind];
	const j = p.i + by;
	if (!list || j < 0 || j >= list.length) return null;
	[list[p.i], list[j]] = [list[j], list[p.i]];
	return { ...p, i: j };
}

/** The set of a kind a layout has, as one string (to compare two layouts' sets). */
export const setKey = (lay: LayoutObjects | undefined, kind: LayoutKind): string => JSON.stringify(lay?.[kind] ?? null);

/** The other layouts with the same set of a kind as this one. */
export function sharing(o: TrackObjects, layout: string, kind: ObjectKind): string[] {
	if (!isLayoutKind(kind)) return [];
	const key = setKey(o.layouts[layout], kind);
	return Object.keys(o.layouts).filter((l) => l !== layout && setKey(o.layouts[l], kind) === key);
}

/** The handle picked of a curve's node (h) to (x, z); the other follows unless the node is a corner, or corner makes it one. */
export function moveObjectHandle(o: TrackObjects, p: ObjectPick, x: number, z: number, corner = false, layout = "") {
	if (isLineKind(p.kind)) {
		const lay = o.layouts[layout];
		const n = p.h ? lineOf(lay, p.kind)?.curve[p.j] : undefined;
		if (n && p.h) moveWallHandle(n, p.h, x, z, corner);
		keepPitOn(lay?.lines);
		return;
	}
	const c = isMarkKind(p.kind) ? markList(o, p.kind)[p.i] : objectOf(o, p);
	const n = p.h ? c?.curve[p.j] : undefined;
	if (n && p.h) moveWallHandle(n, p.h, x, z, corner);
}

/** The node picked of a mark to (x, z): the pieces either side that ran straight still straight (snap, a mark of two nodes: its way to whole 15 degrees). */
export function moveObjectEnd(o: TrackObjects, p: ObjectPick, x: number, z: number, snap = false) {
	const m = isMarkKind(p.kind) && p.j >= 0 && !p.h ? markList(o, p.kind)[p.i] : undefined;
	if (m) moveMarkNode(m, p.j, x, z, snap);
}

/** An object's layouts set: every one (none listed), or those (in the file's order of layouts). */
export function setLayouts(it: PlacedObject, layouts: string[] | null, all: readonly string[]) {
	if (!layouts || all.every((l) => layouts.includes(l))) delete it.layouts;
	else it.layouts = all.filter((l) => layouts.includes(l));
}
