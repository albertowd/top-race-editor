import type { BuildInfo, BuildJob, ContextItem, Drawings, RoadMesh, SurfaceRegion, SurfaceResponse, TrackEntry, TrackInfo, WrongFaces } from "../api/types";
import type { Size, View } from "../canvas/viewport";
import type { Category, Others } from "../domain/categories";
import type { TrackCatalogue } from "../domain/models";
import {
	type Layers,
	type LineKind,
	type Mode,
	type ModelKind,
	NO_SELECTION,
	type ObjectKind,
	type ObjectPick,
	type Road,
	type Selection,
	type TrackObjects,
	type Vec2,
} from "../domain/types";
import { BUMP_BRUSH, type BumpBrush, type Bumps, noBumps } from "../editing/bumps";
import { LINE_UPS, type LineUp, type LineUpKind } from "../editing/lineup";
import { firstModel, MODEL_KINDS } from "../editing/objects";
import type { SnapMark } from "../editing/snap";
import type { LightSeries } from "../engine/lightoptions";

/** A road's wireframe (its mesh as the track's build makes it), for what it was made of. */
export interface MeshEntry {
	deps: readonly unknown[];
	state: "loading" | "ready" | "error";
	/** points x z x z ... */
	P?: Float32Array;
	F?: Uint32Array;
	/** its faces that would be wrong in the game (the engine checks each mesh made) */
	wrong?: WrongFaces;
}

/** The surface checked where one looked: its window, its regions, its problems, whether out of date. */
export interface SurfaceCheck {
	window: [number, number, number, number];
	regions: SurfaceRegion[];
	issues: SurfaceResponse["issues"];
	stale: boolean;
}

export interface Measure {
	a: Vec2;
	b: Vec2;
}

export interface NewRoadDraft {
	name: string;
	points: Vec2[];
}

export interface BringState {
	open: boolean;
	loading: boolean;
	meshes: RoadMesh[];
}

/** What undo puts back: the roads and the objects as they were. */
export interface Snapshot {
	roads: Road[];
	objects: TrackObjects | null;
	bumps: Bumps;
}

const NO_LINE: LineOf = Object.freeze({ a: null, b: null });

export interface Lining {
	kind: LineUpKind;
	/** each kind's way of laying out, as last set */
	plans: Record<LineUpKind, LineUp>;
	/** each kind's line: where the first stands, and the way the rest go */
	lines: Record<LineUpKind, LineOf>;
	/** the line of the kind laid out being clicked on the map */
	drawing: boolean;
}

export interface LineOf {
	a: Vec2 | null;
	b: Vec2 | null;
}

/** Something the editor is waiting on (the engine working): blocking, the window waits with it (a loading screen); else it goes on (a note at the top). */
export interface Task {
	id: number;
	label: string;
	blocking: boolean;
	/** when it began (ms) */
	since: number;
}

export interface EditorState {
	track: TrackInfo | null;
	roads: Road[];
	/** names of roads deleted since the last save */
	deleted: string[];
	context: ContextItem[];
	drawings: Drawings;
	view: View;
	/** the map's size (CSS pixels) */
	size: Size;
	/** Space held: dragging pans */
	space: boolean;
	sel: Selection;
	mode: Mode;
	/** the roads' bumps made by hand (editing/bumps.ts) */
	bumps: Bumps;
	/** how the bumps are made: a point at a time, or a brush */
	bumpBrush: BumpBrush;
	/** the point of a road's mesh picked to bump (Bumps, a point at a time) */
	bumpPick: Vec2 | null;
	/** the category worked on: only its things can be picked */
	focus: Category;
	/** how the other categories' things are shown meanwhile */
	others: Others;
	/** the categories' sidebar shown */
	sidebar: boolean;
	/** a category's list of everything placed shown (else only what is picked, with more room) */
	objectList: boolean;
	layers: Layers;
	surface: SurfaceCheck | null;
	snapMark: SnapMark | null;
	measure: Measure | null;
	/** what the editor is waiting on */
	tasks: Task[];
	/** the track being opened at the start: its roads not in yet */
	booting: boolean;
	/** another track being opened (the engine started again on it) */
	opening: TrackEntry | null;
	/** the track built for Assetto Corsa: the dialog, what the engine says of it, the build running or last */
	building: { open: boolean; info: BuildInfo | null; job: BuildJob | null; error: string };
	/** grid slots or pit boxes laid out along a line: how, and the line (drawing: its points being clicked) */
	lining: Lining;
	/** a racing line being made from roads: the line, the roads clicked so far, in the order the lap takes them */
	routing: { kind: LineKind; roads: string[] } | null;
	newRoad: NewRoadDraft | null;
	/** the mouse in the world */
	mouse: Vec2 | null;
	/** the objects placed (null: the engine has none to give) */
	objects: TrackObjects | null;
	/** they were read from the track's models: the track has no objects file until they are saved */
	objectsSeeded: boolean;
	/** the layout whose objects are shown and edited */
	layout: string;
	/** the object picked */
	obj: ObjectPick | null;
	/** what placing adds */
	place: ObjectKind;
	/** the object laid along nodes (a tyre wall, a fence, a paint mark, an area) that placing made: its next clicks add its nodes while it is picked; anything
	 * picked before placing began is left as it is (placing makes a new one) */
	placing: { kind: ObjectKind; i: number } | null;
	/** placing a paint mark: a line across the road clicked, edge to edge (a start line) */
	markAcross: boolean;
	/** the model placing adds, of each kind of model */
	models: Record<ModelKind, string>;
	/** the track's own catalogue of models (their lights, the fits and collisions they allow) */
	catalogue: TrackCatalogue | null;
	/** the track's light series (its source/lights.json's): what its models' lights are, unless an object says otherwise */
	lightSeries: Record<string, LightSeries>;
	/** a layout's set edited with every other layout's that is the same */
	together: boolean;
	undo: Snapshot[];
	redo: Snapshot[];
	dirty: boolean;
	status: string;
	meshes: Record<string, MeshEntry>;
	bring: BringState;
	helpOpen: boolean;
}

export const initialState = (): EditorState => ({
	track: null,
	roads: [],
	deleted: [],
	context: [],
	drawings: {},
	view: { cx: 80, cz: 40, ppm: 4 },
	size: { w: 800, h: 600 },
	space: false,
	sel: { ...NO_SELECTION },
	mode: "select",
	bumps: noBumps(),
	bumpBrush: { ...BUMP_BRUSH },
	bumpPick: null,
	focus: "all",
	others: "dim",
	sidebar: true,
	objectList: false,
	layers: {
		sat: true,
		ctx: true,
		draw: false,
		wire: true,
		lines: true,
		kerbs: true,
		names: false,
		surface: true,
		objects: true,
	},
	surface: null,
	snapMark: null,
	measure: null,
	tasks: [],
	booting: false,
	opening: null,
	building: { open: false, info: null, job: null, error: "" },
	routing: null,
	lining: {
		kind: "grid",
		plans: { ...LINE_UPS },
		lines: { grid: NO_LINE, pits: NO_LINE, gridPaint: NO_LINE, pitPaint: NO_LINE },
		drawing: false,
	},
	newRoad: null,
	mouse: null,
	objects: null,
	objectsSeeded: false,
	layout: "",
	obj: null,
	place: "grid",
	placing: null,
	markAcross: false,
	models: Object.fromEntries(MODEL_KINDS.map((k) => [k, firstModel(k)])) as Record<ModelKind, string>,
	catalogue: null,
	lightSeries: {},
	together: true,
	undo: [],
	redo: [],
	dirty: false,
	status: "loading…",
	meshes: {},
	bring: { open: false, loading: false, meshes: [] },
	helpOpen: false,
});
