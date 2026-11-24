import { CATEGORIES } from "../domain/categories";
import { MARK_PX, RUNOFF_WIDTH, SNAP_PX } from "../domain/constants";
import type { ObjectPick, PaintLine, Road, Vec2 } from "../domain/types";
import { bumpAt } from "../editing/bumps";
import { keepEdge } from "../editing/ends";
import { type HitContext, hitTest, type ItemHit, itemAt } from "../editing/hit";
import { touch } from "../editing/joints";
import { headingOf, isMarkKind, marksOf, moveObject, moveObjectEnd, moveObjectHandle, objectAt, poseOf, turnObject } from "../editing/objects";
import { snapPoint, snapToMarks, snapToPaintEnd } from "../editing/snap";
import { placingInto } from "../editing/strands";
import { continuation, lineOffsets } from "../geometry/paint";
import { geo, type Lookup, lookup } from "../geometry/roads";
import { nearestOn, pointAt, type Samples, span } from "../geometry/samples";
import type { Editor } from "../store/editor";
import type { EditorState } from "../store/state";
import { turnHandle } from "./objects";
import { panned, type Size, toScreen, toWorld, type View, zoomAt } from "./viewport";

/** A mouse event as the map has it: where on the map (CSS pixels), which button, which keys. */
export interface Pointer {
	sx: number;
	sy: number;
	button: number;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

interface ItemDrag {
	kind: "item";
	which: "line" | "kerb";
	idx: number;
	road: number;
	s: number;
	from0: number;
	to0: number;
	toEnd: boolean;
	moved: boolean;
}

interface HandleDrag {
	kind: "handle";
	handle: string;
	n: number;
	road: number;
	alt: boolean;
	moved: boolean;
}

/** An object dragged (whole: all of its kind, or its whole wall or gate), or turned (whole: its kind as one). */
interface ObjectDragOf<K extends "object" | "turn"> {
	kind: K;
	pick: ObjectPick;
	whole: boolean;
	/** (a tyre wall's handle: Alt made its node a corner) */
	alt: boolean;
	last: Vec2;
	moved: boolean;
	/** (a mark just placed, its node dragged: kept as placed if it is not) */
	placed?: boolean;
}
type ObjectDrag = ObjectDragOf<"object"> | ObjectDragOf<"turn">;

type Drag =
	| { kind: "pan"; sx: number; sy: number; from: View; click: boolean }
	/** (placing marks, one placed picked: a click carries it on to there, a drag paints a new one from there) */
	| { kind: "mark"; at: Vec2; sx: number; sy: number; alt: boolean }
	/** (the bumps: a brush's stroke, its last dab; a point's, dragged up or down from its height when pressed) */
	| { kind: "bumpBrush"; last: Vec2 }
	| { kind: "bumpPoint"; sy: number; from: number; moved: boolean }
	| { kind: "measure" }
	| ItemDrag
	| HandleDrag
	| ObjectDragOf<"object">
	| ObjectDragOf<"turn">;

/** A handle being dragged to (wx, wz): what each kind of handle does with it. */
interface HandleMove {
	ed: Editor;
	s: EditorState;
	find: Lookup;
	road: Road;
	d: HandleDrag;
	wx: number;
	wz: number;
	p: Pointer;
	snap: (wx: number, wz: number, exclude: string | null) => ReturnType<typeof snapPoint>;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A node moved, snapping to another road's end, centre line or edge (Ctrl: not). */
function moveNode({ ed, road, d, wx, wz, snap }: HandleMove) {
	const sp = snap(wx, wz, road.name);
	ed.set({ snapMark: sp });
	ed.edit((rs) => {
		const nd = rs[d.road].curve?.[d.n];
		if (!nd) return;
		nd.p = sp ? [sp.x, sp.z] : [wx, wz];
		touch(rs, rs[d.road]);
	});
}

/** A handle turned and stretched; the other follows (a smooth node), unless Alt makes it a corner. An end's edge turns with its handle. */
function moveArm({ ed, d, wx, wz, p }: HandleMove) {
	const arm = d.handle === "in" ? "in" : "out";
	const other = arm === "in" ? "out" : "in";
	ed.edit((rs) => {
		const road = rs[d.road];
		const nd = road.curve?.[d.n];
		if (!nd) return;
		// (an end's handle turns its edge with it)
		keepEdge(road, d.n, () => {
			const v: Vec2 = [wx - nd.p[0], wz - nd.p[1]];
			nd[arm] = v;
			if (d.alt || p.alt) nd.corner = true;
			const ol = Math.hypot(nd[other][0], nd[other][1]);
			const m = Math.hypot(v[0], v[1]) || 1;
			if (!nd.corner && ol > 0) nd[other] = [(-v[0] / m) * ol, (-v[1] / m) * ol];
		});
		touch(rs, road);
	});
}

/** A side's width at a node (Shift: both sides). */
function moveWidth({ ed, find, road, d, wx, wz, p }: HandleMove) {
	const o = geo(road, find);
	const nd = road.curve?.[d.n];
	if (!o || !nd) return;
	const q = pointAt(o, o.s[o.nodeAt[d.n]]);
	const left = d.handle === "wl";
	const w = r2(Math.max(0.2, ((wx - nd.p[0]) * q.nx + (wz - nd.p[1]) * q.nz) * (left ? 1 : -1)));
	ed.edit((rs) => {
		const n = rs[d.road].curve?.[d.n];
		if (!n) return;
		if (p.shift) {
			n.left = w;
			n.right = w;
		} else n[left ? "left" : "right"] = w;
		touch(rs, rs[d.road]);
	});
}

/** A run-off's ends along its road's edge, its width points out from it (and along it). */
function moveRunOff({ ed, find, road, d, wx, wz }: HandleMove) {
	const al = road.along;
	const parent = al && find(al.road);
	const op = parent && geo(parent, find);
	if (!al || !op) return;
	const n = nearestOn(op, wx, wz);
	const at = r1(n.s);
	const sgn = al.side === "left" ? 1 : -1;
	const q = pointAt(op, n.s);
	const edge = sgn > 0 ? q.l : q.r;
	const w = Math.max(0.1, r2(((wx - (q.x + q.nx * sgn * edge)) * q.nx + (wz - (q.z + q.nz * sgn * edge)) * q.nz) * sgn));
	ed.edit((rs) => {
		const r = rs[d.road];
		if (!r.along) return;
		if (d.handle === "afrom") r.along.from = Math.min(at, r.along.to - 1);
		else if (d.handle === "ato") r.along.to = Math.max(at, r.along.from + 1);
		else {
			if (!r.profile?.length) r.profile = [[(r.along.from + r.along.to) / 2, r.width ?? RUNOFF_WIDTH]];
			r.profile[d.n] = [Math.min(Math.max(at, r.along.from), r.along.to), w];
		}
		touch(rs, r);
	});
}

/** A rumble's end along its road, or on along another road whose edge goes on from its road's. */
function moveKerbEnd({ ed, s, find, road, d, wx, wz }: HandleMove) {
	const kerb = s.sel.kerb;
	const k = road.kerbs?.[kerb];
	const o = geo(road, find);
	if (!k || !o) return;
	const isStart = d.handle === "kfrom";
	const n = nearestOn(o, wx, wz);
	const qn = pointAt(o, n.s);
	const onIt = n.d <= Math.max(qn.l, qn.r) + 0.3 && (isStart ? n.s > 0.05 : n.s < o.length - 0.05);
	const c = onIt ? null : continuation(road, k, isStart, wx, wz, s.roads, find);
	const key = isStart ? "before" : "after";
	const at = r1(n.s);
	ed.edit((rs) => {
		const kb = rs[d.road].kerbs?.[kerb];
		if (!kb) return;
		if (c) kb[key] = c;
		else if (onIt || !kb[key]) {
			delete kb[key];
			if (isStart) kb.from = Math.min(at, (kb.to ?? o.length) - 0.2);
			else kb.to = at >= o.length - 0.05 ? null : Math.max(at, (kb.from ?? 0) + 0.2);
		}
	});
}

/** A line's end along its road (to its end: none), to a tenth of a metre; near another line's or mark's end, onto it (where along its road its end comes
 * nearest that, to a millimetre: the two then painted as one; Ctrl: not). */
function moveLineEnd({ ed, s, find, road, d, wx, wz, p }: HandleMove) {
	const o = geo(road, find);
	const line = s.sel.line;
	const ln = road.lines?.[line];
	if (!o || !ln) return;
	const sp = p.ctrl ? null : snapToPaintEnd(s.roads, find, s.objects?.marks ?? [], wx, wz, { road: d.road, line }, SNAP_PX / s.view.ppm);
	ed.set({ snapMark: sp });
	const at = sp ? lineEndNearest(o, ln, sp.x, sp.z) : r1(nearestOn(o, wx, wz).s);
	ed.edit((rs) => {
		const ln = rs[d.road].lines?.[line];
		if (!ln) return;
		if (d.handle === "lfrom") ln.from = at;
		else ln.to = at >= o.length - (sp ? 0.0005 : 0.05) ? null : at;
	});
}

/** Where along its road (to a millimetre) a line's end comes nearest (x, z): its middle there, between its sides. */
function lineEndNearest(o: Samples, ln: PaintLine, x: number, z: number): number {
	const off = lineOffsets(ln);
	const dist = (s: number) => {
		const q = pointAt(o, s);
		const m = (off.a(q, s) + off.b(q, s)) / 2;
		return Math.hypot(q.x + q.nx * m - x, q.z + q.nz * m - z);
	};
	const near = nearestOn(o, x, z).s;
	let [lo, hi] = [Math.max(0, near - 2), Math.min(o.length, near + 2)];
	for (let k = 0; k < 60; k++) {
		const m1 = lo + (hi - lo) / 3;
		const m2 = hi - (hi - lo) / 3;
		if (dist(m1) < dist(m2)) hi = m2;
		else lo = m1;
	}
	return Math.round(((lo + hi) / 2) * 1000) / 1000;
}

/** pixels dragged a millimetre of bump, a point dragged up or down */
const BUMP_PX = 2;

const HANDLE_MOVES: Record<string, (m: HandleMove) => void> = {
	p: moveNode,
	in: moveArm,
	out: moveArm,
	wl: moveWidth,
	wr: moveWidth,
	afrom: moveRunOff,
	ato: moveRunOff,
	aw: moveRunOff,
	kfrom: (m) => {
		if (m.s.sel.kerb >= 0) moveKerbEnd(m);
	},
	kto: (m) => {
		if (m.s.sel.kerb >= 0) moveKerbEnd(m);
	},
	lfrom: moveLineEnd,
	lto: moveLineEnd,
};

/** The map's mouse: selecting, dragging nodes, handles, widths, lines and rumbles, panning, measuring. */
export class MapInteractions {
	private drag: Drag | null = null;

	constructor(private readonly ed: Editor) {}

	private size(): Size {
		return this.ed.get().size;
	}

	/** What can be picked: the category worked on's own things only. */
	private hitContext(): HitContext {
		const s = this.ed.get();
		const c = CATEGORIES[s.focus];
		return {
			roads: s.roads,
			find: lookup(s.roads),
			sel: s.sel,
			layers: { lines: s.layers.lines && c.lines, kerbs: s.layers.kerbs && c.kerbs },
			pickRoads: c.roads !== "none",
			shape: c.roads === "shape",
			ppm: s.view.ppm,
			toScreen: (x, z) => toScreen(s.view, this.size(), x, z),
		};
	}

	private world(p: Pointer): [number, number] {
		return toWorld(this.ed.get().view, this.size(), p.sx, p.sy);
	}

	private snap(wx: number, wz: number, exclude: string | null, p: Pointer) {
		if (p.ctrl) return null;
		const s = this.ed.get();
		return snapPoint(s.roads, lookup(s.roads), wx, wz, exclude, SNAP_PX / s.view.ppm);
	}

	get dragging(): boolean {
		return this.drag !== null;
	}

	private pan(p: Pointer, click = false): Drag {
		return { kind: "pan", sx: p.sx, sy: p.sy, from: this.ed.get().view, click };
	}

	down(p: Pointer): void {
		const s = this.ed.get();
		const [wx, wz] = this.world(p);
		if (p.button === 1 || p.button === 2 || s.space) {
			this.drag = this.pan(p);
			return;
		}
		if (s.routing) {
			// (a racing line being made: the road clicked added to it, or taken off)
			this.ed.routeAt(wx, wz, 6 / s.view.ppm);
			return;
		}
		if (s.lining.drawing) {
			// (a line to lay the grid or the pit boxes out along: its points clicked, snapping)
			const sp = this.snap(wx, wz, null, p);
			this.ed.linePoint(sp ? [sp.x, sp.z] : [wx, wz]);
			return;
		}
		if (s.mode === "place") this.place(p, wx, wz);
		else if (s.mode === "bumps") this.bumps(p, wx, wz);
		else if (s.mode === "new") this.ed.addNewRoadPoint([wx, wz]);
		else if (s.mode === "add") this.ed.addNodeAt(wx, wz);
		else if (s.mode === "measure") {
			const sp = this.snap(wx, wz, null, p);
			const a: Vec2 = sp ? [sp.x, sp.z] : [wx, wz];
			this.ed.set({ measure: { a, b: a } });
			this.drag = { kind: "measure" };
		} else this.pick(p, wx, wz);
	}

	/** The bumps: a brush dabbed where pressed (and along the drag); a point of a road's mesh picked there, dragged up or down to bump it (none there: the road
	 * there selected, its mesh's points shown). */
	private bumps(p: Pointer, wx: number, wz: number): void {
		const s = this.ed.get();
		if (s.bumpBrush.mode !== "point") {
			this.ed.bumpDabAt(wx, wz, true);
			this.drag = { kind: "bumpBrush", last: [wx, wz] };
			return;
		}
		if (this.ed.pickBumpPoint(wx, wz, MARK_PX.grab / s.view.ppm)) {
			const q = this.ed.get().bumpPick as Vec2;
			this.drag = { kind: "bumpPoint", sy: p.sy, from: bumpAt(this.ed.get().bumps, q[0], q[1]), moved: false };
			return;
		}
		this.pick(p, wx, wz);
	}

	/** A double click: while selecting, a node added where it is on what is picked (a road, a tyre wall, a fence, an area, a racing line), not on one of its
	 * nodes. Whether one was. */
	double(p: Pointer): boolean {
		const s = this.ed.get();
		if (s.mode !== "select" || s.routing || s.lining.drawing || p.button !== 0) return false;
		const [wx, wz] = this.world(p);
		return this.ed.doubleClickAt(wx, wz, 6 / s.view.ppm);
	}

	/** One of the kind being placed added there; a mark: the node added dragged on from there (a new one's far end: its way and length). */
	private place(p: Pointer, wx: number, wz: number): void {
		const s = this.ed.get();
		const marking = isMarkKind(s.place) && !(s.place === "marks" && s.markAcross);
		if (marking && placingInto(s) !== undefined) {
			this.drag = { kind: "mark", at: [wx, wz], sx: p.sx, sy: p.sy, alt: p.alt };
			return;
		}
		this.ed.placeAt(wx, wz);
		const obj = this.ed.get().obj;
		if (!marking || obj?.kind !== s.place || obj.j < 0) return;
		const pick = { kind: obj.kind, i: obj.i, j: obj.j };
		this.ed.set({ obj: pick });
		this.drag = { kind: "object", pick, whole: false, alt: p.alt, last: [wx, wz], moved: false, placed: true };
	}

	/** The object under the mouse (the objects shown), or the handle turning the one picked ('turn'). */
	private objectHit(p: Pointer, wx: number, wz: number): { pick: ObjectPick; turn: boolean } | null {
		const s = this.ed.get();
		const kinds = CATEGORIES[s.focus].kinds;
		if (!s.layers.objects || !s.objects || !kinds.length) return null;
		const h = turnHandle(s.objects, s.layout, s.obj, (x, z) => toScreen(s.view, this.size(), x, z));
		if (h && s.obj && Math.hypot(h[0] - p.sx, h[1] - p.sy) <= 8) return { pick: s.obj, turn: true };
		const pick = objectAt(s.objects, s.layout, wx, wz, 6 / s.view.ppm, kinds, s.obj, MARK_PX.grab / s.view.ppm);
		return pick && { pick, turn: false };
	}

	/** What the press is on: an object taken (or its turning handle), a road selected (then panning), a line or rumble or handle taken, or nothing. */
	private pick(p: Pointer, wx: number, wz: number): void {
		const h = hitTest(this.hitContext(), p.sx, p.sy, wx, wz);
		const handle = h && h.kind !== "road" && h.kind !== "item";
		const o = handle ? null : this.objectHit(p, wx, wz);
		if (o) {
			this.ed.selectObject(o.pick);
			this.ed.remember();
			this.drag = {
				kind: o.turn ? "turn" : "object",
				pick: o.pick,
				whole: p.shift,
				alt: p.alt,
				last: [wx, wz],
				moved: false,
			};
			return;
		}
		if (!h) {
			this.drag = this.pan(p, true);
			return;
		}
		if (h.kind === "road") {
			if (h.road !== this.ed.get().sel.r) this.ed.selectRoad(h.road);
			this.drag = this.pan(p);
			return;
		}
		if (h.kind === "item") {
			this.pickItem(h);
			return;
		}
		this.ed.remember();
		const n = "n" in h && h.n !== undefined ? h.n : -1;
		if (["p", "in", "out", "wl", "wr", "aw"].includes(h.kind)) this.ed.select({ n });
		this.drag = { kind: "handle", handle: h.kind, n, road: h.road, alt: p.alt, moved: false };
	}

	/** A line or rumble: selected, and dragged along its road as a whole. */
	private pickItem(h: ItemHit): void {
		const s = this.ed.get();
		const r = s.roads[h.road];
		const it = h.which === "line" ? r.lines?.[h.idx] : r.kerbs?.[h.idx];
		const o = geo(r, lookup(s.roads));
		this.ed.select({ r: h.road, n: -1, line: h.which === "line" ? h.idx : -1, kerb: h.which === "kerb" ? h.idx : -1 });
		if (!it || !o) return;
		if ("kind" in it && (it.before || it.after)) {
			this.ed.status("this rumble goes on along another road: drag its ends (the triangles)");
			return;
		}
		this.ed.remember();
		const [from0, to0] = span(o, it.from, it.to);
		this.drag = {
			kind: "item",
			which: h.which,
			idx: h.idx,
			road: h.road,
			s: h.s,
			from0,
			to0,
			toEnd: it.to == null,
			moved: false,
		};
	}

	/** The cursor to show. */
	move(p: Pointer): string | null {
		const ed = this.ed;
		const s = ed.get();
		const [wx, wz] = this.world(p);
		ed.set({ mouse: [wx, wz] });
		if (s.lining.drawing && !this.drag) {
			const sp = this.snap(wx, wz, null, p);
			ed.set({ snapMark: sp });
			ed.lineHover(sp ? [sp.x, sp.z] : [wx, wz]);
			return "crosshair";
		}
		const d = this.drag;
		if (!d) return s.mode === "select" && !s.space ? this.hoverCursor(wx, wz) : null;
		if (d.kind === "measure") {
			const sp = this.snap(wx, wz, null, p);
			ed.set({ snapMark: sp, measure: { a: s.measure?.a ?? [wx, wz], b: sp ? [sp.x, sp.z] : [wx, wz] } });
			return null;
		}
		if (d.kind === "bumpBrush") {
			// (a dab every quarter of the brush's reach along the drag)
			const step = Math.max(s.bumpBrush.radius / 4, 0.05);
			let [x, z] = d.last;
			for (let n = Math.floor(Math.hypot(wx - x, wz - z) / step); n > 0; n--) {
				const k = step / Math.hypot(wx - x, wz - z);
				[x, z] = [x + (wx - x) * k, z + (wz - z) * k];
				ed.bumpDabAt(x, z);
			}
			d.last = [x, z];
			return "crosshair";
		}
		if (d.kind === "bumpPoint") {
			// (up the screen: up; BUMP_PX pixels a millimetre, Shift a tenth as fast)
			const by = ((d.sy - p.sy) / BUMP_PX / 1000) * (p.shift ? 0.1 : 1);
			ed.setBumpAtPick(Math.round((d.from + by) * 1e4) / 1e4, !d.moved);
			d.moved = true;
			return "ns-resize";
		}
		if (d.kind === "mark") {
			// (dragged: a new mark from where it was pressed, its far end dragged on)
			if (Math.hypot(p.sx - d.sx, p.sy - d.sy) <= 3) return "crosshair";
			ed.set({ placing: null });
			this.drag = null;
			this.place({ ...p, alt: d.alt }, d.at[0], d.at[1]);
			const nd = this.drag as Drag | null;
			if (nd?.kind === "object") this.dragObject(nd, wx, wz, p);
			return "grabbing";
		}
		if (d.kind === "pan") {
			ed.set({ view: panned(d.from, d.sx, d.sy, p.sx, p.sy) });
			if (Math.hypot(p.sx - d.sx, p.sy - d.sy) > 3) d.click = false;
			return null;
		}
		if (d.kind === "object" || d.kind === "turn") {
			this.dragObject(d, wx, wz, p);
			return d.kind === "object" ? "grabbing" : null;
		}
		const road = s.roads[d.road];
		if (!road) return null;
		d.moved = true;
		if (d.kind === "item") {
			this.dragItem(d, road, wx, wz);
			return "grabbing";
		}
		const snap = (x: number, z: number, exclude: string | null) => this.snap(x, z, exclude, p);
		HANDLE_MOVES[d.handle]?.({ ed, s, find: lookup(s.roads), road, d, wx, wz, p, snap });
		return null;
	}

	private hoverCursor(wx: number, wz: number): string {
		const s = this.ed.get();
		const kinds = CATEGORIES[s.focus].kinds;
		const onObject = s.layers.objects && s.objects && objectAt(s.objects, s.layout, wx, wz, 6 / s.view.ppm, kinds, s.obj, MARK_PX.grab / s.view.ppm);
		return onObject || itemAt(this.hitContext(), wx, wz) ? "grab" : "default";
	}

	/** An object moved with the mouse, or turned to look at it. */
	private dragObject(d: ObjectDrag, wx: number, wz: number, p: Pointer) {
		const s = this.ed.get();
		const { layout } = s;
		if (d.kind === "object" && isMarkKind(d.pick.kind) && d.pick.j >= 0 && !d.pick.h) {
			// (onto another mark's end, a node or its line where near (Ctrl: not; Shift: its way by 15 degrees instead); a paint mark's onto the roads' edge lines
			// too, a rubber mark's onto the other rubber only)
			const paint = d.pick.kind === "marks";
			const sp =
				p.ctrl || p.shift || !s.objects
					? null
					: snapToMarks(marksOf(s.objects, d.pick.kind), wx, wz, d.pick.i, SNAP_PX / s.view.ppm, paint ? s.roads : [], paint ? lookup(s.roads) : undefined);
			this.ed.set({ snapMark: sp });
			const [x, z] = sp ? [sp.x, sp.z] : [wx, wz];
			this.ed.editObjects((o) => moveObjectEnd(o, d.pick, x, z, p.shift), {}, d.pick.kind);
		} else if (d.kind === "object" && d.pick.h) {
			this.ed.editObjects((o) => moveObjectHandle(o, d.pick, wx, wz, d.alt, layout), {}, d.pick.kind);
		} else if (d.kind === "object") {
			const [dx, dz] = [wx - d.last[0], wz - d.last[1]];
			d.last = [wx, wz];
			this.ed.editObjects((o) => moveObject(o, layout, d.pick, dx, dz, d.whole), {}, d.pick.kind);
		} else {
			const me = s.objects && poseOf(s.objects, layout, d.pick);
			if (!me || Math.hypot(wx - me.x, wz - me.z) < 1e-6) return;
			const heading = headingOf(wx - me.x, wz - me.z);
			this.ed.editObjects((o) => turnObject(o, layout, d.pick, heading, d.whole), {}, d.pick.kind);
		}
		d.moved = true;
	}

	/** The whole of a line or rumble along the road, as long as it was, within the road's ends. */
	private dragItem(d: ItemDrag, road: Road, wx: number, wz: number) {
		const o = geo(road, lookup(this.ed.get().roads));
		if (!o) return;
		const len = d.to0 - d.from0;
		const ds = nearestOn(o, wx, wz).s - d.s;
		const from = r1(Math.min(Math.max(d.from0 + ds, 0), Math.max(o.length - len, 0)));
		const to = d.toEnd && from + len >= o.length - 0.05 ? null : r1(from + len);
		this.ed.edit((rs) => {
			const it = d.which === "line" ? rs[d.road].lines?.[d.idx] : rs[d.road].kerbs?.[d.idx];
			if (!it) return;
			it.from = from;
			it.to = to;
		});
	}

	up(): string | null {
		const ed = this.ed;
		const d = this.drag;
		this.drag = null;
		const mark = ed.get().snapMark;
		if (mark) ed.set({ snapMark: null, status: `snapped to ${mark.label}` });
		if (!d) return null;
		// (placing marks, a click: the mark placed carried on to there)
		if (d.kind === "mark") ed.placeAt(d.at[0], d.at[1]);
		if (d.kind === "pan" && d.click && ed.get().mode === "select") ed.select({ r: -1, n: -1, line: -1, kerb: -1 });
		if (d.kind === "item" || d.kind === "handle") {
			if (d.moved) ed.wantMeshes();
			else ed.forget();
		}
		if ((d.kind === "object" || d.kind === "turn") && !d.moved && !d.placed) ed.forget();
		return d.kind === "item" ? "grab" : null;
	}

	wheel(sx: number, sy: number, deltaY: number): void {
		this.ed.set({ view: zoomAt(this.ed.get().view, this.size(), sx, sy, deltaY) });
	}
}
