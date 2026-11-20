// A track's roads as the editor has them (the engine's roads.json, see ROADS.md of the track).
// World: x grows west, z north, metres. Left and right are as seen going along a road from its first node.

import type { LightOptions } from '../engine/lightoptions';

export type Vec2 = [number, number];
export type Side = 'left' | 'right';
export type RoadEnd = 'start' | 'end';

/** A road's end bound to another road's end: one point, one going straight on into the other. */
export interface Joint {
  road: string;
  node: RoadEnd;
}

/** A node of a road's middle: a cubic Bezier piece runs from each node to the next, by their handles. */
export interface CurveNode {
  p: Vec2;
  in: Vec2;
  out: Vec2;
  left: number;
  right: number;
  /** its handles apart (else the one follows the other) */
  corner?: boolean;
  joint?: Joint;
}

export type LineColour = 'white' | 'yellow';
export type LineStyle = 'solid' | 'dotted';

/** A painted line along a road's edge, from / to metres along the road (to: null for its end). */
export interface PaintLine {
  name?: string;
  side: Side;
  from?: number | null;
  to?: number | null;
  colour?: LineColour;
  style?: LineStyle;
  /** its middle in from the road's edge (m) */
  pad?: number;
  /** how wide (m) */
  w?: number;
  dash?: number;
  gap?: number;
}

export type KerbKind = 'ramp' | 'floor' | 'concrete' | 'round' | 'ramp_concrete';
export type KerbEnd = 'square' | 'triangle';

/** A rumble going on along another road whose edge carries on from its road's. */
export interface KerbContinuation {
  road: string;
  side: Side;
  from: number;
  to: number;
  /** which end of that stretch is the rumble's own end */
  outer: 'from' | 'to';
}

/** A rumble (kerb) outside a road's edge, going outward. */
export interface Kerb {
  side: Side;
  from?: number | null;
  to?: number | null;
  kind: KerbKind;
  width?: number;
  inset?: number;
  start?: KerbEnd;
  end?: KerbEnd;
  taper?: number;
  /** a ramp + concrete rumble's concrete, behind its ramp (m) */
  back?: number;
  /** metres behind it, ramping down to its road's height (a kind ending raised; 0: none) */
  back_ramp?: number;
  before?: KerbContinuation;
  after?: KerbContinuation;
}

/** A run-off: asphalt along another road's edge. */
export interface Along {
  road: string;
  side: Side;
  from: number;
  to: number;
}

export type TextureMap = 'along' | 'flat';

export interface Road {
  name: string;
  material?: string;
  map?: TextureMap;
  curve?: CurveNode[];
  lines?: PaintLine[];
  kerbs?: Kerb[];
  along?: Along;
  width?: number;
  ease?: number;
  /** a run-off's width along its road: [s, width] */
  profile?: Vec2[];
  /** the roads it leaves and joins (a branch) */
  joins?: (string | null)[];
  start_left?: Vec2;
  end_left?: Vec2;
  mesh?: string;
  // The page's own (the engine drops them when it saves):
  /** changed in shape since loaded */
  moved?: boolean;
  /** its curve fitted to its points by the engine */
  fitted?: boolean;
  /** its shape's key, as loaded */
  shape?: string;
  /** its name as loaded */
  was?: string;
  /** whatever else the track keeps on a road, kept as it is */
  [other: string]: unknown;
}

export interface Selection {
  r: number;
  n: number;
  line: number;
  kerb: number;
}

export const NO_SELECTION: Selection = Object.freeze({ r: -1, n: -1, line: -1, kerb: -1 });

export type Mode = 'select' | 'add' | 'new' | 'measure' | 'place';

export type LayerName = 'sat' | 'ctx' | 'draw' | 'wire' | 'lines' | 'kerbs' | 'names' | 'surface' | 'objects';
export type Layers = Record<LayerName, boolean>;

/** A box in the world: x and z, from and to. */
export interface Box {
  xmin: number;
  xmax: number;
  zmin: number;
  zmax: number;
}

// ---------------------------------------------------------------- the objects placed (the engine's objects.json)

/** A place something stands facing a way: heading in radians from +z towards +x (a kart's nose, a board's face). */
export interface Spot {
  x: number;
  z: number;
  heading: number;
  name?: string;
}

export interface Point {
  x: number;
  z: number;
}

/** A timing gate: the line between its left and right posts (AC_TIME_n_L, _R; named by its place, AC_TIME_n). */
export interface Gate {
  name?: string;
  left: Point;
  right: Point;
}

/** A layout's own spots and gates (the objects themselves list the layouts they are in). */
export interface LayoutObjects {
  /** the grid's slots, first to last (AC_START_n) */
  grid: Spot[];
  /** the pit boxes (AC_PIT_n) */
  pits: Spot[];
  /** the hotlap's start (AC_HOTLAP_START_0) */
  hotlap: Spot | null;
  timing: Gate[];
  /** its racing lines (TRACK_FORMAT's "Racing lines"; editing/lines.ts) */
  lines?: RacingLines;
  /** its start line painted across the road at the front of its grid: chequered, or a single solid white line (none:
   * none painted) */
  start_line?: StartLineStyle;
}

/** A layout's start line: chequered squares, or a single solid white line across the road. */
export type StartLineStyle = 'checker' | 'line';

/** A racing line: a curve as an object's (nodes with handles, no heights: the floor's), closed or not; the pit line's
 * fork off the fast line and merge back into it, metres along the fast line from its start. */
export interface RacingLine {
  curve: WallNode[];
  closed: boolean;
  leaves?: number;
  joins?: number;
}

/** A layout's fast line (closed: the way round its lap) and pit lane line. */
export interface RacingLines {
  fast?: RacingLine;
  pit?: RacingLine;
}

/** A node of an object's curve: as a road's, without widths. */
export type WallNode = Pick<CurveNode, 'p' | 'in' | 'out' | 'corner'>;

/** How copies of a model go along a curve: upright, turned along it (place), or the model bent along it (bend). */
export type ObjectFit = 'place' | 'bend';

/** What a car hits of an object: nothing; a box round it (static); it, knocked about (dynamic, as AC's cones);
 * along a curve of them, a band (wall). */
export type ObjectCollision = 'none' | 'static' | 'dynamic' | 'wall' | 'model';

/** Something placed (objects.json, version 3): a model of the catalogue (models/catalogue.json's id), one of it (a
 * curve of one node, turned to heading) or copies of it along a curve of Bezier pieces (as a road's middle): spacing
 * metres apart at most, evenly (none: the model's depth), rows deep to its right; closed: a last piece back to its
 * first node. In the layouts listed (none: every layout, those made later too). */
export interface PlacedObject {
  name: string;
  model: string;
  curve: WallNode[];
  /** radians from +z towards +x: the way a single one's front looks */
  heading?: number;
  closed?: boolean;
  spacing?: number;
  rows?: number;
  fit?: ObjectFit;
  collision: ObjectCollision;
  layouts?: string[];
  /** the model scaled: across, up, deep (each 1 as it is) */
  scale?: [number, number, number];
  /** its model's lights not as their series are (off, or their strength, colour, range their own), by each light's
   * place among its model's lights (engine/lightoptions.ts) */
  lights?: LightOptions;
  /** a board's: what its card says, drawn as large as fits it (none: what its name says, BOARD_PIT_2 says PIT) */
  text?: string;
}

/** Paint laid on the roads (every layout's): a line from p, length metres along heading, width wide; dotted: dash
 * metres painted, gap not. */
export interface PaintMark {
  name: string;
  p: Vec2;
  heading: number;
  length: number;
  width: number;
  colour: LineColour;
  style: LineStyle;
  dash?: number;
  gap?: number;
}

/** A layout's models (the track file's `layouts`): their names in the order a game loads them, and the layout it was
 * made from (its AC files and its own model that one's until it has its own). */
export interface LayoutModels {
  models: string[];
  from?: string;
}

/** A paved area of its own shape (a car park, a lane): laid as a road's top is, its corners in order (x, z), no lines
 * of its own (paint marks laid on it). */
export interface PavedArea {
  name: string;
  material: string;
  points: Vec2[];
}

export interface TrackObjects {
  version: number;
  /** the paved areas */
  areas?: PavedArea[];
  /** each layout's models (the page's, kept with the objects; saved apart, into the track file's layouts) */
  lists?: Record<string, LayoutModels>;
  /** the build's (the models it places), kept as they are */
  templates?: Record<string, unknown>;
  layouts: Record<string, LayoutObjects>;
  objects: PlacedObject[];
  marks: PaintMark[];
}

/** The kinds of model (the catalogue's): what the sidebar sorts the objects by. */
export type ModelKind =
  | 'cones'
  | 'boards'
  | 'poles'
  | 'tyres'
  | 'trees'
  | 'fences'
  | 'sheds'
  | 'statics'
  | 'gantries'
  | 'karts';
export type LayoutKind = 'grid' | 'pits' | 'hotlap' | 'timing';
export type TrackKind = 'marks' | 'areas';
/** a layout's racing lines: its fast line, its pit lane line */
export type LineKind = 'fast' | 'pit';
export type ObjectKind = LayoutKind | TrackKind | ModelKind | LineKind;

/** Something picked: its kind, which (i: of an object kind, its place in the objects' list), and a part of it (j): a
 * gate's post (0 left, 1 right), an object's node (h: one of its handles), a mark's end (0 its start, 1 its far end);
 * -1 the whole. */
export interface ObjectPick {
  kind: ObjectKind;
  i: number;
  j: number;
  h?: 'in' | 'out';
}
