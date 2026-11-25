import { MARK_PX } from "../domain/constants";
import { modelInfo, type TrackCatalogue } from "../domain/models";
import type {
	Box,
	LineColour,
	ModelKind,
	ObjectKind,
	ObjectPick,
	PlacedObject,
	RacingLine,
	RubberMark,
	Spot,
	TrackObjects,
	Vec2,
	WallNode,
} from "../domain/types";
import { FORK, forkAndMerge, LINE_KINDS, MERGE } from "../editing/lines";
import { boxMarks, isPaint, lineUp } from "../editing/lineup";
import { isRing, markPath } from "../editing/marks";
import { along, inLayout, isCurve, kindOfModel, OBJECT_SIZES, objectsOf, poseOf, spacingOf } from "../editing/objects";
import { handleAt, TYRE_R, wallPath, wallStacks } from "../editing/walls";
import { objectLit } from "../engine/lightoptions";
import { RUBBER, rubberAlpha } from "../engine/wear";
import { boxesMeet, emptyBox, grow, inBox } from "../geometry/samples";
import type { Lining } from "../store/state";
import { type PaintDrawn, paintInView, paintOf, strokePaint } from "./paint";
import { topPicture } from "./pictures";

/** What each kind is drawn in. */
export const OBJECT_COLOURS: Record<ObjectKind, string> = {
	grid: "#ffffff",
	pits: "#ffb347",
	hotlap: "#7dff9a",
	safety_car: "#c9a6ff",
	timing: "#ff5cf0",
	cones: "#ff7a1a",
	boards: "#ffe14d",
	poles: "#d8dce4",
	tyres: "#9aa3b5",
	marks: "#f2f2f2",
	rubber: "#3a3633",
	trees: "#6fcf7a",
	fences: "#c3ccd6",
	sheds: "#f2f2f2",
	statics: "#f2f2f2",
	gantries: "#ff6b6b",
	karts: "#ffcc4d",
	fast: "#40e0ff",
	pit: "#ff9f40",
	areas: "#9aa6b8",
};

/** A mark's paint. */
const PAINT = { white: "#f2f2f2", yellow: "#ffd400" } as const;

const PICKED = "#4fa3ff";
/** a picked curve's handles and their arms, as a road's (renderer.ts) */
const HANDLE = "#cfe6ff";
const ARM = "rgba(79,163,255,0.8)";
/** a light's beam */
const LIGHT = "rgba(255,236,120,0.85)";
/** pixels from a spot to the handle that turns it */
export const TURN_PX = 30;
/** pixels a metre from which numbers and names are shown */
const LABELS_PPM = 7;

type Scr = (x: number, z: number) => Vec2;

const same = (p: ObjectPick | null, kind: ObjectKind, i: number) => !!p && p.kind === kind && p.i === i;

/** The handle that turns the spot or single object picked: where it is on the map (CSS pixels), or null. */
export function turnHandle(o: TrackObjects, layout: string, p: ObjectPick | null, scr: Scr): Vec2 | null {
	const s = p && poseOf(o, layout, p);
	if (!s) return null;
	const [sx, sy] = scr(s.x, s.z);
	const [dx, dz] = along(s.heading);
	return [sx - dx * TURN_PX, sy - dz * TURN_PX];
}

/** A box (across by long) round a spot, turned its way, with a notch at its front: drawn in metres. */
function spotBox(g: CanvasRenderingContext2D, s: Spot, across: number, long: number) {
	const [ax, az] = along(s.heading);
	const [nx, nz] = [az, -ax];
	const hw = across / 2;
	const hl = long / 2;
	const at = (u: number, v: number): Vec2 => [s.x + nx * u + ax * v, s.z + nz * u + az * v];
	const pts = [at(-hw, -hl), at(hw, -hl), at(hw, hl * 0.6), at(0, hl), at(-hw, hl * 0.6)];
	g.beginPath();
	g.moveTo(...pts[0]);
	for (const q of pts.slice(1)) g.lineTo(...q);
	g.closePath();
}

function circle(g: CanvasRenderingContext2D, x: number, z: number, r: number) {
	g.beginPath();
	g.arc(x, z, r, 0, Math.PI * 2);
}

interface ObjectsFrame {
	g: CanvasRenderingContext2D;
	o: TrackObjects;
	layout: string;
	picked: ObjectPick | null;
	/** the world in view */
	b: Box;
	ppm: number;
	/** the kinds drawn (default: all) */
	kinds?: ReadonlySet<ObjectKind>;
	/** the track's own catalogue (its models' lights) */
	catalogue?: TrackCatalogue | null;
	/** the paint as drawn, the roads' edge lines and the marks together (none: the marks alone) */
	paint?: readonly PaintDrawn[];
}

const drawn = (f: ObjectsFrame, kind: ObjectKind) => !f.kinds || f.kinds.has(kind);

/** An object as it is drawn: its curve's points, where its copies stand (and the way each looks), its box; kept while the object is the same. */
const shapes = new WeakMap<PlacedObject, { path: Vec2[]; at: [number, number, number][]; box: Box }>();

function shapeOf(it: PlacedObject) {
	let d = shapes.get(it);
	if (!d) {
		const box = emptyBox();
		let path: Vec2[] = [];
		let at: [number, number, number][];
		if (isCurve(it)) {
			const w = { ...it, spacing: spacingOf(it) };
			path = wallPath(w, 0.25).P;
			at = wallStacks(w).map((q, i, all) => {
				const next = all[i + 1] ?? q;
				const prev = all[i - 1] ?? q;
				return [q[0], q[1], Math.atan2(next[0] - prev[0], next[1] - prev[1]) + Math.PI / 2];
			});
			for (const n of it.curve) {
				grow(box, n.p[0] + n.in[0], n.p[1] + n.in[1]);
				grow(box, n.p[0] + n.out[0], n.p[1] + n.out[1]);
			}
		} else {
			const n = it.curve[0];
			at = n ? [[n.p[0], n.p[1], it.heading ?? 0]] : [];
		}
		const reach = ((modelInfo(it.model)?.top ?? 2) / 2) * Math.max(1, ...(it.scale ?? [1]));
		for (const q of [...path, ...at]) grow(box, q[0], q[1], reach + 1);
		d = { path, at, box };
		shapes.set(it, d);
	}
	return d;
}

/** Where one copy of an object stands, the way it looks, and whether it is drawn as the one picked. */
interface Stand {
	x: number;
	z: number;
	heading: number;
	me: boolean;
}

/** One copy of an object's model where it stands, turned its way, as its kind is drawn (scenery: its picture from above, at scale; a dot
 * until it has loaded). */
function drawOne(f: ObjectsFrame, kind: ModelKind, it: Pick<PlacedObject, "model" | "scale">, at: Stand) {
	if (kind === "tyres") drawTyre(f, at);
	else if (kind === "cones") drawCone(f, at);
	else if (kind === "boards") drawBoard(f, at);
	else if (kind === "poles") drawPole(f, at);
	else if (kind === "fences") drawFence(f, it.model, at);
	else drawModel(f, kind, it.model, it.scale ?? [1, 1, 1], at);
}

/** A tyre: a dark disc edged in its colour. */
function drawTyre(f: ObjectsFrame, { x, z, me }: Stand) {
	const { g, ppm } = f;
	const px = 1 / ppm;
	circle(g, x, z, Math.max(TYRE_R, 1.5 * px));
	g.fillStyle = "rgba(30,33,40,0.7)";
	g.fill();
	g.strokeStyle = me ? PICKED : OBJECT_COLOURS.tyres;
	g.lineWidth = px;
	g.stroke();
}

/** A cone: a dot in its colour. */
function drawCone(f: ObjectsFrame, { x, z, me }: Stand) {
	const { g, ppm } = f;
	const px = 1 / ppm;
	circle(g, x, z, Math.max(OBJECT_SIZES.cone, 2 * px));
	g.fillStyle = me ? PICKED : OBJECT_COLOURS.cones;
	g.fill();
}

/** A board: a bar across it, a line out the way it faces. */
function drawBoard(f: ObjectsFrame, { x, z, heading, me }: Stand) {
	const { g, ppm } = f;
	const px = 1 / ppm;
	const [ax, az] = along(heading);
	const [nx, nz] = [az, -ax];
	const hw = Math.max(OBJECT_SIZES.board[0] / 2, 4 * px);
	g.strokeStyle = me ? PICKED : OBJECT_COLOURS.boards;
	g.lineWidth = Math.max(OBJECT_SIZES.board[1], 3 * px);
	g.beginPath();
	g.moveTo(x - nx * hw, z - nz * hw);
	g.lineTo(x + nx * hw, z + nz * hw);
	g.moveTo(x, z);
	g.lineTo(x + ax * hw * 1.5, z + az * hw * 1.5);
	g.stroke();
}

/** A pole: a line out the way it faces, a dot over it. */
function drawPole(f: ObjectsFrame, { x, z, heading, me }: Stand) {
	const { g, ppm } = f;
	const px = 1 / ppm;
	const [ax, az] = along(heading);
	g.strokeStyle = "rgba(255,243,160,0.8)";
	g.lineWidth = 2 * px;
	g.beginPath();
	g.moveTo(x, z);
	g.lineTo(x + ax * 4, z + az * 4);
	g.stroke();
	circle(g, x, z, Math.max(OBJECT_SIZES.pole, 3 * px));
	g.fillStyle = me ? PICKED : OBJECT_COLOURS.poles;
	g.fill();
}

/** A fence's panel: a line as long as it, no picture of its posts and mesh, so its curve's points show over it. */
function drawFence(f: ObjectsFrame, model: string, { x, z, heading, me }: Stand) {
	const { g, ppm } = f;
	const px = 1 / ppm;
	const [ax, az] = along(heading);
	const half = (modelInfo(model)?.size[0] ?? 2.6) / 2;
	g.strokeStyle = me ? PICKED : OBJECT_COLOURS.fences;
	g.lineWidth = 2 * px;
	g.beginPath();
	g.moveTo(x - az * half, z + ax * half);
	g.lineTo(x + az * half, z - ax * half);
	g.stroke();
}

/** Any other model: its picture from above, a building's outline round it, a track's tree its crown; a dot while none of them shows; the one picked ringed. */
function drawModel(f: ObjectsFrame, kind: ModelKind, model: string, scale: readonly number[], { x, z, heading, me }: Stand) {
	const { g, ppm } = f;
	const px = 1 / ppm;
	const info = modelInfo(model);
	const across = info?.top ?? 2;
	// (a tree the catalogue has not: no picture of it)
	const im = info?.track ? null : topPicture(model);
	const [sx, , sz] = scale as [number, number, number];
	// (a building: its outline round its picture, its edges sharp on the map (filled while its picture loads))
	const outline = f.catalogue?.[model]?.outline;
	if (im) {
		// (the picture's top is the model's front; on the map, as the world turns, turned half round more)
		g.save();
		g.translate(x, z);
		g.rotate(Math.PI - heading);
		g.drawImage(im, (-across * sx) / 2, (-across * sz) / 2, across * sx, across * sz);
		g.restore();
	}
	if (outline?.length) drawOutline(f, kind, outline, [sx, sz], !im, { x, z, heading, me });
	if (!im && info?.track && kind === "trees") {
		// (a tree of the track's: its crown, as wide as the tree)
		circle(g, x, z, Math.max(((info.size[0] ?? 2) / 2) * sx, 2 * px));
		g.fillStyle = "rgba(111,207,122,0.35)";
		g.fill();
		g.strokeStyle = me ? PICKED : OBJECT_COLOURS.trees;
		g.lineWidth = px;
		g.stroke();
	}
	if (!im && !outline?.length && !info?.track) {
		circle(g, x, z, Math.max(Math.min(across / 4, 2), 3 * px));
		g.fillStyle = OBJECT_COLOURS[kind];
		g.fill();
	}
	if (me) {
		circle(g, x, z, Math.max(Math.min(across / 2, 6), 8 * px));
		g.strokeStyle = PICKED;
		g.lineWidth = 2 * px;
		g.stroke();
	}
}

/** A building's outline, its rings at its scale (sx, sz) turned its way; filled while its picture is not there. */
function drawOutline(f: ObjectsFrame, kind: ModelKind, outline: OutlineOf, [sx, sz]: [number, number], fill: boolean, at: Stand) {
	const { g, ppm } = f;
	const { x, z, heading, me } = at;
	const px = 1 / ppm;
	const sn = Math.sin(heading);
	const cs = Math.cos(heading);
	g.beginPath();
	for (const ring of outline) {
		for (let k = 0; k + 1 < ring.length; k += 2) {
			const u = (ring[k] as number) * sx;
			const w = (ring[k + 1] as number) * sz;
			const px = x + u * cs + w * sn;
			const pz = z - u * sn + w * cs;
			if (k) g.lineTo(px, pz);
			else g.moveTo(px, pz);
		}
		g.closePath();
	}
	if (fill) {
		g.fillStyle = "rgba(200,205,215,0.35)";
		g.fill("evenodd");
	}
	g.strokeStyle = me ? PICKED : OBJECT_COLOURS[kind];
	g.lineWidth = (me ? 2 : 1) * px;
	g.stroke();
}

/** a model's outline as the track's catalogue has it */
type OutlineOf = NonNullable<NonNullable<TrackCatalogue[string]>["outline"]>;

/** An object's lights (its model's, the track's catalogue's, as it has them: those it has off not drawn) where they shine on the map: from each lamp, the way
 * it faces seen from above, to where its beam meets the ground (one facing down, or all round: a ring round the lamp). */
function drawLights(f: ObjectsFrame, it: PlacedObject, x: number, z: number, heading: number) {
	const lights = objectLit(f.catalogue?.[it.model]?.lights ?? [], it.lights);
	if (!lights.length) return;
	const { g, ppm } = f;
	const px = 1 / ppm;
	const [fx, fz] = along(heading);
	const [rx, rz] = [Math.cos(heading), -Math.sin(heading)];
	g.strokeStyle = LIGHT;
	g.lineWidth = 1.5 * px;
	for (const l of lights) {
		const [ar, ay, af] = l.at;
		const [dr, dy, df] = l.facing ?? [0, -1, 0];
		const lx = x + rx * ar + fx * af;
		const lz = z + rz * ar + fz * af;
		const flat = Math.hypot(dr, df);
		if (flat < 0.2) {
			circle(g, lx, lz, 3);
			g.stroke();
			continue;
		}
		const reach = Math.min(30, (ay * flat) / Math.max(-dy, 0.05));
		const ex = lx + ((rx * dr + fx * df) / flat) * reach;
		const ez = lz + ((rz * dr + fz * df) / flat) * reach;
		g.beginPath();
		g.moveTo(lx, lz);
		g.lineTo(ex, ez);
		g.stroke();
		circle(g, ex, ez, 4 * px);
		g.fillStyle = LIGHT;
		g.fill();
	}
}

/** The objects: each copy where it stands; a curve's line (dashed where it is not hit) and its nodes, the picked one's handles; a pole's lights. Those not in
 * the layout shown faint, their strokes dotted, a filled one ringed dotted (picked as the rest, after those of the layout where both are near). */
function drawPlaced(f: ObjectsFrame) {
	const { g, o, layout, ppm } = f;
	const px = 1 / ppm;
	o.objects.forEach((it, i) => {
		const kind = kindOfModel(it.model);
		if (!drawn(f, kind)) return;
		if (inLayout(it, layout)) {
			drawPlacedOne(f, it, i, kind, false);
			return;
		}
		g.save();
		g.globalAlpha *= AWAY_ALPHA;
		g.setLineDash([1.5 * px, 2.5 * px]);
		drawPlacedOne(f, it, i, kind, true);
		g.restore();
	});
}

/** how faint an object not in the layout shown is drawn */
const AWAY_ALPHA = 0.4;

/** One object as drawPlaced draws it (away: not in the layout shown, its strokes left as dotted as they are set). */
function drawPlacedOne(f: ObjectsFrame, it: PlacedObject, i: number, kind: ReturnType<typeof kindOfModel>, away: boolean) {
	const { g, picked, b, ppm } = f;
	const px = 1 / ppm;
	const { path, at, box } = shapeOf(it);
	if (!boxesMeet(box, b)) return;
	const me = same(picked, kind, i);
	drawCopies(f, it, kind, at, me, away);
	if (!isCurve(it)) {
		drawSingleMarks(f, it, kind, me, away);
		return;
	}
	g.strokeStyle = me ? PICKED : OBJECT_COLOURS[kind];
	g.lineWidth = (me ? 2.5 : 1.5) * px;
	if (!away) g.setLineDash(it.collision === "none" ? [4 * px, 3 * px] : []);
	pathOf(g, path, false);
	g.stroke();
	if (!away) g.setLineDash([]);
	if (me) drawCurveMarks(f, it);
	else drawCurvePoints(f, it, kind);
}

/** A curve object not picked: each of its points in view a small square in its kind's colour. */
function drawCurvePoints(f: ObjectsFrame, it: PlacedObject, kind: ReturnType<typeof kindOfModel>) {
	const { g, b, ppm } = f;
	const px = 1 / ppm;
	const hs = 2.5 * px;
	for (const n of it.curve) {
		const q = n.p;
		if (!inBox(b, q[0], q[1], 1)) continue;
		g.fillStyle = OBJECT_COLOURS[kind];
		g.fillRect(q[0] - hs, q[1] - hs, hs * 2, hs * 2);
	}
}

/** An object's copies in view (a fence picked: its panels as they are, its curve's line, points and handles what show it picked); a filled one (a cone, a
 * pole) of another layout a dotted ring round it, its fill shows no stroke. */
function drawCopies(
	f: ObjectsFrame,
	it: PlacedObject,
	kind: ReturnType<typeof kindOfModel>,
	at: readonly [number, number, number][],
	me: boolean,
	away: boolean,
) {
	const { g, b, ppm } = f;
	const px = 1 / ppm;
	const copyMe = me && !(kind === "fences" && isCurve(it));
	const ringed = away && (kind === "cones" || kind === "poles");
	for (const [x, z, h] of at) {
		if (!inBox(b, x, z, 3)) continue;
		drawOne(f, kind, it, { x, z, heading: h, me: copyMe });
		if (!ringed) continue;
		const r = Math.max(kind === "cones" ? OBJECT_SIZES.cone : OBJECT_SIZES.pole, 3 * px) + 2 * px;
		circle(g, x, z, r);
		g.strokeStyle = me ? PICKED : OBJECT_COLOURS[kind];
		g.lineWidth = 1.5 * px;
		g.stroke();
	}
}

/** A single object's own marks: a pole's lights (in the layout shown), a tyre picked ringed. */
function drawSingleMarks(f: ObjectsFrame, it: PlacedObject, kind: ReturnType<typeof kindOfModel>, me: boolean, away: boolean) {
	const { g, ppm } = f;
	const px = 1 / ppm;
	const n = it.curve[0];
	if (kind === "poles" && n && !away) drawLights(f, it, n.p[0], n.p[1], it.heading ?? 0);
	if (me && kind === "tyres" && n) {
		circle(g, n.p[0], n.p[1], Math.max(TYRE_R + 0.15, 6 * px));
		g.strokeStyle = PICKED;
		g.lineWidth = 2 * px;
		g.stroke();
	}
}

/** The picked curve's points and handles as a road's are marked (renderer.ts): the handles' arms, each handle a light blue circle, each point a white square
 * (the one taken blue), all edged black so they show over its line. */
function drawCurveMarks(f: ObjectsFrame, it: { curve: readonly WallNode[] }) {
	const { g, picked, b, ppm } = f;
	const px = 1 / ppm;
	g.strokeStyle = ARM;
	g.lineWidth = px;
	for (const n of it.curve) drawArms(g, n);
	g.strokeStyle = "#000";
	for (const [j, n] of it.curve.entries()) {
		drawHandleDots(f, n, j);
		const q = n.p;
		if (!inBox(b, q[0], q[1], 1)) continue;
		g.beginPath();
		g.rect(q[0] - (MARK_PX.node / 2) * px, q[1] - (MARK_PX.node / 2) * px, MARK_PX.node * px, MARK_PX.node * px);
		g.fillStyle = picked?.j === j && !picked.h ? PICKED : "#ffffff";
		g.fill();
		g.stroke();
	}
}

/** A picked curve's node's handles, each a light blue circle (the one taken blue), in the stroke set (a handle at the node: none). */
function drawHandleDots(f: ObjectsFrame, n: WallNode, j: number) {
	const { g, picked, ppm } = f;
	const px = 1 / ppm;
	for (const h of HANDLES) {
		if (Math.hypot(n[h][0], n[h][1]) < 1e-6) continue;
		const [x, z] = handleAt(n, h);
		circle(g, x, z, MARK_PX.dot * px);
		g.fillStyle = picked?.j === j && picked.h === h ? PICKED : HANDLE;
		g.fill();
		g.stroke();
	}
}

/** a curve node's two handles */
const HANDLES = ["in", "out"] as const;

/** A curve node's handles' arms, each a line from the node to its handle, in the stroke set (a handle at the node: none). */
function drawArms(g: CanvasRenderingContext2D, n: WallNode) {
	for (const h of HANDLES) {
		if (Math.hypot(n[h][0], n[h][1]) < 1e-6) continue;
		const [x, z] = handleAt(n, h);
		g.beginPath();
		g.moveTo(n.p[0], n.p[1]);
		g.lineTo(x, z);
		g.stroke();
	}
}

/** The paved areas: each its shape filled as asphalt is; the one picked its corners. */
function drawAreas(f: ObjectsFrame) {
	const { g, o, picked, ppm } = f;
	if (!drawn(f, "areas")) return;
	const px = 1 / ppm;
	(o.areas ?? []).forEach((a, i) => {
		const me = same(picked, "areas", i);
		g.beginPath();
		a.points.forEach(([x, z], k) => {
			if (k) g.lineTo(x, z);
			else g.moveTo(x, z);
		});
		g.closePath();
		g.fillStyle = "rgba(60,64,72,0.55)";
		g.fill();
		g.strokeStyle = me ? PICKED : OBJECT_COLOURS.areas;
		g.lineWidth = (me ? 2.5 : 1.5) * px;
		g.stroke();
		if (!me) return;
		const hs = (MARK_PX.node / 2) * px;
		a.points.forEach(([x, z], j) => {
			g.fillStyle = picked?.j === j ? "#ffffff" : PICKED;
			g.fillRect(x - hs, z - hs, hs * 2, hs * 2);
		});
	});
}

/** A racing line's points as drawn, kept while the line is the same. */
const linePaths = new WeakMap<RacingLine, Vec2[]>();

/** The layout's racing lines: each its curve; the one picked its nodes and handles; the pit line's fork off the fast line and merge back into it, diamonds on
 * it. */
function drawLines(f: ObjectsFrame) {
	const { o, layout } = f;
	const lines = o.layouts[layout]?.lines;
	if (!lines) return;
	for (const kind of LINE_KINDS) {
		const line = lines[kind];
		if (!line || !drawn(f, kind) || line.curve.length < 1) continue;
		drawLine(f, kind, line);
	}
	const fm = drawn(f, "pit") ? forkAndMerge(lines) : null;
	if (fm) drawForkAndMerge(f, fm);
}

/** One racing line: its curve, the pit line's dashed; picked, its nodes and handles. */
function drawLine(f: ObjectsFrame, kind: (typeof LINE_KINDS)[number], line: RacingLine) {
	const { g, picked, ppm } = f;
	const px = 1 / ppm;
	const path = linePathOf(line);
	const me = picked?.kind === kind;
	g.strokeStyle = me ? PICKED : OBJECT_COLOURS[kind];
	g.lineWidth = (me ? 3 : 2) * px;
	g.setLineDash(kind === "pit" ? [6 * px, 3 * px] : []);
	pathOf(g, path, false);
	g.stroke();
	g.setLineDash([]);
	if (me) drawLineNodes(f, kind, line);
}

/** A racing line's points as drawn (made once, then kept). */
function linePathOf(line: RacingLine): Vec2[] {
	let path = linePaths.get(line);
	if (!path) {
		path = wallPath(line, 0.5).P;
		linePaths.set(line, path);
	}
	return path;
}

/** The picked racing line's nodes and handles; a pit line's ends their handles (the way it leaves and joins), their places the fork's and merge's diamonds. */
function drawLineNodes(f: ObjectsFrame, kind: (typeof LINE_KINDS)[number], line: RacingLine) {
	const { g, picked, ppm } = f;
	const px = 1 / ppm;
	const hs = (MARK_PX.node / 2) * px;
	for (const [j, n] of line.curve.entries()) {
		const end = kind === "pit" && (j === 0 || j === line.curve.length - 1);
		g.strokeStyle = "#cfe6ff";
		g.lineWidth = px;
		drawLineHandles(f, n, j);
		if (end) continue;
		g.fillStyle = picked?.j === j && !picked.h ? "#ffffff" : PICKED;
		g.fillRect(n.p[0] - hs, n.p[1] - hs, hs * 2, hs * 2);
	}
}

/** A picked racing line's node's handles, each its arm and a pale blue circle (the one taken white), in the stroke set (a handle at the node: none). */
function drawLineHandles(f: ObjectsFrame, n: WallNode, j: number) {
	const { g, picked, ppm } = f;
	const px = 1 / ppm;
	for (const h of HANDLES) {
		if (Math.hypot(n[h][0], n[h][1]) < 1e-6) continue;
		const [x, z] = handleAt(n, h);
		g.beginPath();
		g.moveTo(n.p[0], n.p[1]);
		g.lineTo(x, z);
		g.stroke();
		circle(g, x, z, MARK_PX.dot * px);
		g.fillStyle = picked?.j === j && picked.h === h ? "#ffffff" : "#cfe6ff";
		g.fill();
	}
}

/** The pit line's fork off the fast line and merge back into it: a diamond at each. */
function drawForkAndMerge(f: ObjectsFrame, fm: NonNullable<ReturnType<typeof forkAndMerge>>) {
	const { g, picked, ppm } = f;
	const px = 1 / ppm;
	for (const [j, q] of [
		[FORK, fm.fork],
		[MERGE, fm.merge],
	] as const) {
		const r = MARK_PX.point * px;
		g.beginPath();
		g.moveTo(q[0], q[1] - r);
		g.lineTo(q[0] + r, q[1]);
		g.lineTo(q[0], q[1] + r);
		g.lineTo(q[0] - r, q[1]);
		g.closePath();
		g.fillStyle = picked?.kind === "pit" && picked.j === j ? "#ffffff" : OBJECT_COLOURS.pit;
		g.fill();
		g.strokeStyle = "#000000";
		g.lineWidth = px;
		g.stroke();
	}
}

/** A line of points: its path begun (closed: round to its first). */
function pathOf(g: CanvasRenderingContext2D, P: readonly Vec2[], closed: boolean) {
	g.beginPath();
	for (const [k, q] of P.entries()) {
		if (k) g.lineTo(q[0], q[1]);
		else g.moveTo(q[0], q[1]);
	}
	if (closed) g.closePath();
}

/** The marks as painted: each line of them in its paint, its corners mitred, dotted in its dashes; the one picked outlined under its paint, its nodes and
 * handles over it. */
function drawMarks(f: ObjectsFrame) {
	const { g, o, picked, b, ppm } = f;
	const px = 1 / ppm;
	const all = f.paint ?? paintOf([], o.marks, () => undefined);
	const me = picked?.kind === "marks" ? o.marks[picked.i] : undefined;
	g.lineCap = "butt";
	g.lineJoin = "miter";
	g.miterLimit = 5;
	if (me) {
		g.strokeStyle = PICKED;
		g.lineWidth = Math.max(me.width, 1.5 * px) + 4 * px;
		const P = markPath(me).P;
		pathOf(g, isRing(me) ? P.slice(0, -1) : P, isRing(me));
		g.stroke();
	}
	// (and a line of a road's with the picked mark in it again, over its outline)
	for (const { chain: c } of paintInView(all, b, false, me ? (picked?.i ?? -1) : -1)) strokePaint(g, c, PAINT[c.colour as LineColour] ?? PAINT.white, 1.5 * px);
	g.lineJoin = "round";
	if (me) drawCurveMarks(f, me);
}

/** each rubber mark's line and box, kept while the mark is the same */
const rubberShapes = new WeakMap<RubberMark, { P: Vec2[]; box: Box }>();

function rubberShape(m: RubberMark) {
	let d = rubberShapes.get(m);
	if (!d) {
		const P = markPath(m).P;
		const box = emptyBox();
		for (const [x, z] of P) grow(box, x, z, m.width);
		d = { P: isRing(m) ? P.slice(0, -1) : P, box };
		rubberShapes.set(m, d);
	}
	return d;
}

/** the layer the rubber is drawn on first (as large as the map's canvas), kept for the next frame */
let rubberLayer: OffscreenCanvasRenderingContext2D | null = null;

function layerAs(c: { width: number; height: number }): OffscreenCanvasRenderingContext2D | null {
	if (typeof OffscreenCanvas === "undefined") return null;
	if (rubberLayer?.canvas.width !== c.width || rubberLayer.canvas.height !== c.height) rubberLayer = new OffscreenCanvas(c.width, c.height).getContext("2d");
	return rubberLayer;
}

/** The rubber as laid: each mark a dark band its width wide, as dark as its wear (as the build lays it, but for its widening in tight turns and its cores);
 * where marks meet, as dark as the darker of them (each drawn on a layer of its own in grey, the darker kept, the layer then multiplied over the map); the one
 * picked outlined under it, its nodes and handles over it. */
function drawRubber(f: ObjectsFrame) {
	const { g, o, picked, b, ppm } = f;
	const all = o.rubber ?? [];
	if (!all.length) return;
	const px = 1 / ppm;
	const me = picked?.kind === "rubber" ? all[picked.i] : undefined;
	g.lineCap = "butt";
	g.lineJoin = "round";
	if (me) {
		const { P } = rubberShape(me);
		g.strokeStyle = PICKED;
		g.lineWidth = Math.max(me.width, 1.5 * px) + 4 * px;
		pathOf(g, P, isRing(me));
		g.stroke();
	}
	const layer = layerAs(g.canvas);
	const on: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D = layer ?? g;
	if (layer) {
		layer.setTransform(1, 0, 0, 1, 0, 0);
		layer.globalCompositeOperation = "source-over";
		layer.fillStyle = "#ffffff";
		layer.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
		layer.setTransform(g.getTransform());
		layer.globalCompositeOperation = "darken";
		layer.lineCap = "butt";
		layer.lineJoin = "round";
	}
	const [r, gr, bl] = RUBBER.rgb;
	for (const m of all) {
		const { P, box } = rubberShape(m);
		if (!boxesMeet(box, b)) continue;
		const a = Math.max(0.15, rubberAlpha(m.wear));
		// (on the layer: the grey multiplying the map as the rubber would darken it)
		const grey = (c: number) => Math.round(255 - a * (255 - c));
		on.strokeStyle = layer ? `rgb(${grey(r)},${grey(gr)},${grey(bl)})` : `rgba(${r},${gr},${bl},${a})`;
		on.lineWidth = Math.max(m.width, 1.5 * px);
		pathOf(on as CanvasRenderingContext2D, P, isRing(m));
		on.stroke();
	}
	if (layer) {
		g.save();
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.globalCompositeOperation = "multiply";
		g.drawImage(layer.canvas, 0, 0);
		g.restore();
	}
	if (me) drawCurveMarks(f, me);
}

/** The objects drawn in metres (the canvas in the world's transform). */
export function drawObjectsWorld(f: ObjectsFrame) {
	const { g, o, layout, picked, b, ppm } = f;
	const px = 1 / ppm;
	const lay = o.layouts[layout];
	g.lineJoin = "round";
	drawAreas(f);
	drawLines(f);
	drawPlaced(f);
	// the marks: paint on the roads (under the rest), as the build paints them; the picked one outlined, its nodes
	if (drawn(f, "marks")) drawMarks(f);
	// the rubber, over the paint as the build lays it
	if (drawn(f, "rubber")) drawRubber(f);
	if (!lay) return;
	const spots = (kind: "grid" | "pits", list: Spot[], across: number, long: number) => {
		list.forEach((s, i) => {
			if (!drawn(f, kind) || !inBox(b, s.x, s.z, 3)) return;
			const me = same(picked, kind, i);
			spotBox(g, s, Math.max(across, 3 * px), Math.max(long, 3 * px));
			g.fillStyle = me ? "rgba(79,163,255,0.45)" : "rgba(0,0,0,0.25)";
			g.fill();
			g.strokeStyle = me ? PICKED : OBJECT_COLOURS[kind];
			g.lineWidth = (me ? 2.5 : 1.5) * px;
			g.stroke();
		});
	};
	spots("pits", lay.pits, ...OBJECT_SIZES.pits);
	spots("grid", lay.grid, ...OBJECT_SIZES.grid);
	// the hotlap's start and the safety car's: each its box, filled
	for (const kind of ["hotlap", "safety_car"] as const) {
		const s = lay[kind];
		if (!drawn(f, kind) || !s || !inBox(b, s.x, s.z, 6)) continue;
		const me = same(picked, kind, 0);
		spotBox(g, s, Math.max(OBJECT_SIZES[kind][0], 4 * px), Math.max(OBJECT_SIZES[kind][1], 6 * px));
		g.fillStyle = me ? PICKED : OBJECT_COLOURS[kind];
		g.fill();
	}
	// the timing gates: the line between their posts
	lay.timing.forEach((t, i) => {
		if (!drawn(f, "timing")) return;
		if (!inBox(b, t.left.x, t.left.z, 20) && !inBox(b, t.right.x, t.right.z, 20)) return;
		const me = same(picked, "timing", i);
		g.strokeStyle = me ? PICKED : OBJECT_COLOURS.timing;
		g.lineWidth = 2 * px;
		g.setLineDash([6 * px, 4 * px]);
		g.beginPath();
		g.moveTo(t.left.x, t.left.z);
		g.lineTo(t.right.x, t.right.z);
		g.stroke();
		g.setLineDash([]);
		for (const [j, q] of [t.left, t.right].entries()) {
			circle(g, q.x, q.z, Math.max(OBJECT_SIZES.post, 3 * px));
			g.fillStyle = me && (picked?.j === j || picked?.j === -1) ? PICKED : OBJECT_COLOURS.timing;
			g.fill();
		}
	});
}

function label(g: CanvasRenderingContext2D, text: string, [x, y]: Vec2, colour: string) {
	g.fillStyle = "rgba(0,0,0,0.65)";
	const w = g.measureText(text).width;
	g.fillRect(x - w / 2 - 2, y - 7, w + 4, 14);
	g.fillStyle = colour;
	g.fillText(text, x, y);
}

/** The objects' numbers and names, and the handle that turns the spot picked: drawn in pixels. */
export function drawObjectsScreen(f: ObjectsFrame, scr: Scr) {
	const { g, o, layout, ppm } = f;
	const lay = o.layouts[layout];
	g.font = "11px system-ui, sans-serif";
	g.textAlign = "center";
	g.textBaseline = "middle";
	if (ppm >= LABELS_PPM && lay) drawLayoutLabels(f, lay, scr);
	if (ppm >= LABELS_PPM / 2) drawPoleLabels(f, scr);
	drawTurning(f, scr);
}

/** The layout's numbers and names: its grid slots', pit boxes', timing gates', boards', hotlap start's and safety car start's. */
function drawLayoutLabels(f: ObjectsFrame, lay: NonNullable<TrackObjects["layouts"][string]>, scr: Scr) {
	const { g, o, layout, b } = f;
	lay.grid.forEach((s, i) => {
		if (drawn(f, "grid") && inBox(b, s.x, s.z)) label(g, String(i + 1), scr(s.x, s.z), OBJECT_COLOURS.grid);
	});
	lay.pits.forEach((s, i) => {
		if (drawn(f, "pits") && inBox(b, s.x, s.z)) label(g, `P${i + 1}`, scr(s.x, s.z), OBJECT_COLOURS.pits);
	});
	lay.timing.forEach((t, i) => {
		const [lx, ly] = scr(t.left.x, t.left.z);
		if (drawn(f, "timing") && inBox(b, t.left.x, t.left.z)) label(g, `T${i}`, [lx, ly - 14], OBJECT_COLOURS.timing);
	});
	for (const i of objectsOf(o, layout, "boards")) {
		const it = o.objects[i] as PlacedObject;
		const n = it.curve[0];
		if (!n || !drawn(f, "boards") || !inBox(b, n.p[0], n.p[1])) continue;
		const [x, y] = scr(n.p[0], n.p[1]);
		label(g, it.name.replace(/^BOARD_/, ""), [x, y - 14], OBJECT_COLOURS.boards);
	}
	for (const [kind, name] of [
		["hotlap", "hotlap"],
		["safety_car", "safety car"],
	] as const) {
		const s = lay[kind];
		if (!drawn(f, kind) || !s || !inBox(b, s.x, s.z)) continue;
		const [x, y] = scr(s.x, s.z);
		label(g, name, [x, y - 16], OBJECT_COLOURS[kind]);
	}
}

/** The poles' numbers. */
function drawPoleLabels(f: ObjectsFrame, scr: Scr) {
	const { g, o, layout, b } = f;
	for (const [k, i] of objectsOf(o, layout, "poles").entries()) {
		const n = (o.objects[i] as PlacedObject).curve[0];
		if (!n || !drawn(f, "poles") || !inBox(b, n.p[0], n.p[1])) continue;
		const [x, y] = scr(n.p[0], n.p[1]);
		label(g, `pole ${k + 1}`, [x, y - 14], OBJECT_COLOURS.poles);
	}
}

/** The handle that turns the spot or single object picked, and its arm from it. */
function drawTurning(f: ObjectsFrame, scr: Scr) {
	const { g, o, layout, picked } = f;
	const h = picked && drawn(f, picked.kind) ? turnHandle(o, layout, picked, scr) : null;
	const s = picked && poseOf(o, layout, picked);
	if (h && s) {
		const c = scr(s.x, s.z);
		g.strokeStyle = PICKED;
		g.lineWidth = 1.5;
		g.beginPath();
		g.moveTo(...c);
		g.lineTo(...h);
		g.stroke();
		g.beginPath();
		g.arc(h[0], h[1], 6, 0, Math.PI * 2);
		g.fillStyle = "#ffffff";
		g.fill();
		g.stroke();
	}
}

/** The line the grid, the pit boxes or their paint are laid out along, and what it lays out (not put down yet): drawn in metres. */
export function drawLining(g: CanvasRenderingContext2D, lining: Lining, ppm: number) {
	const { kind, plans, lines } = lining;
	const { a, b } = lines[kind];
	if (!a || !b) return;
	const px = 1 / ppm;
	g.strokeStyle = "#3ee8ff";
	g.lineWidth = 1.5 * px;
	g.setLineDash([6 * px, 4 * px]);
	g.beginPath();
	g.moveTo(...a);
	g.lineTo(...b);
	g.stroke();
	g.setLineDash([]);
	const spots = lineUp(plans[kind], a, b);
	const box = plans[kind].box;
	if (isPaint(kind) && box) {
		g.strokeStyle = box.colour === "yellow" ? "#ffd400" : "#f2f2f2";
		g.lineWidth = Math.max(box.line, 2 * px);
		g.lineCap = "butt";
		g.lineJoin = "miter";
		for (const m of boxMarks(spots, box, "")) {
			const P = markPath(m).P;
			pathOf(g, isRing(m) ? P.slice(0, -1) : P, isRing(m));
			g.stroke();
		}
		g.lineJoin = "round";
		return;
	}
	const [across, long] = kind === "pits" ? OBJECT_SIZES.pits : OBJECT_SIZES.grid;
	for (const s of spots) {
		spotBox(g, s, Math.max(across, 3 * px), Math.max(long, 3 * px));
		g.fillStyle = "rgba(62,232,255,0.25)";
		g.fill();
		g.strokeStyle = "#3ee8ff";
		g.lineWidth = 1.5 * px;
		g.stroke();
	}
}
