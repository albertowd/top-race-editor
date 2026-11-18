// What the engine answers (src/engine/api.ts): the editor's contract with it.

import type { TrackCatalogue } from '../domain/models';
import type { CurveNode, Road, TrackObjects } from '../domain/types';
import type { TreePlacement } from '../editing/trees';
import type { LightSeries } from '../engine/lightoptions';

export interface TrackInfo {
  name: string;
  /** its project's folder (an engine before it did not say) */
  folder?: string;
  /** metres the satellite picture spans */
  span: number;
  /** its pixels across */
  px: number;
  /** pixels a tile */
  tile: number;
  materials: string[];
}

export interface RoadsResponse extends TrackInfo {
  roads: Road[];
}

/** A model's mesh seen from above: its outline's lines (x z x z ...), or its tyre stacks' rings (x z r ...). */
export interface ContextItem {
  name: string;
  kind: string;
  material: string;
  lines?: number[][];
  rings?: number[];
}

export interface ContextResponse {
  items: ContextItem[];
}

/** The drawings over the map: by label, strokes of each colour (each [x, z] points). */
export type Drawings = Record<string, Partial<Record<'blue' | 'yellow', [number, number][][]>>>;

/** A road mesh in the track's models not described yet. */
export interface RoadMesh {
  model: string;
  name: string;
  material: string;
  area: number;
  /** x0, z0, x1, z1 */
  box: [number, number, number, number];
}

export interface MeshResponse {
  /** points: x z x z ... */
  P: number[];
  /** faces: three points' indices each */
  F: number[];
  /** the roads above it, it is cut under */
  under: string[];
  /** its faces that would be wrong in the game (by index): facing down or on edge, or with no area (no normal) */
  wrong?: WrongFaces;
}

export interface WrongFaces {
  down: number[];
  thin: number[];
}

export interface SurfaceRegion {
  name: string;
  kind: string;
  P: number[];
  F: number[];
}

export interface SurfaceResponse {
  regions: SurfaceRegion[];
  /** [what, x, z, how big] */
  issues: [string, number, number, number][];
  window: [number, number, number, number];
  seconds: number;
}

export interface SaveResponse {
  ok: boolean;
  changed: string[];
  roads: Road[];
}

export interface BringResponse {
  roads: Road[];
  how: 'ring' | 'strip' | 'rows';
}

/** The objects placed; seeded: read from the track's models (it has no objects file yet); converted: its file is of
 * version 2, read as version 3 (written so when saved). */
export interface ObjectsResponse {
  objects: TrackObjects;
  seeded: boolean;
  converted?: boolean;
}

/** The track's own catalogue of the models its build makes (none: an empty one). */
export interface CatalogueResponse {
  models: TrackCatalogue;
  /** the track's light series (source/lights.json): its models' lights as they are, unless an object says otherwise */
  series?: Record<string, LightSeries>;
}

/** The track's trees (its track file's: none where it has none). */
export interface TreesResponse {
  trees: TreePlacement[];
}

export interface TreesSaveResponse {
  ok: boolean;
  trees: TreePlacement[];
}

export interface ObjectsSaveResponse {
  ok: boolean;
  objects: TrackObjects;
}

export interface FitResponse {
  curve: CurveNode[];
}

/** A track the editor can open: its name and its folder. */
export interface TrackEntry {
  name: string;
  folder: string;
  /** the one open now */
  open?: boolean;
}

/** The track open, and the others found (next to it, and opened before). */
export interface TracksResponse {
  open: TrackEntry;
  tracks: TrackEntry[];
}

/** A build of the track for the games (made by the engine, packed): how it goes. */
export interface BuildJob {
  id: string;
  state: 'running' | 'done' | 'failed' | 'stopped';
  /** models: the track being made; pack: its AC track packed */
  step: 'models' | 'pack';
  steps: string[];
  /** the build's step running now */
  now: string;
  log: string[];
  error: string;
  /** the archive made, and its bytes */
  archive: string;
  size: number;
  install: boolean;
  /** the BeamNG level's zip put in BeamNG's mods folder too */
  installBeamng?: boolean;
  /** the rFactor 2 location copied into rFactor 2's ModDev too */
  installRf2?: boolean;
  /** asked to stop, still at work until its stage says its next line */
  stopping?: boolean;
  /** the AC track packed (off: only installed in the game) */
  packAc?: boolean;
  /** where the build put each game's track */
  installed?: { game: GameId; path: string }[];
  seconds: number;
  /** its stages: the track made, the AC track made, the BeamNG level, the packing */
  stages?: BuildStage[];
  /** how far it is (0 to 1), and the seconds it may still take (from what each stage took the last time) */
  fraction?: number;
  left?: number;
  /** 7-Zip's percentage, packing */
  percent?: number | null;
  /** what it is doing now (running): its stage, its last line and how long ago, whether it is still at work */
  activity?: BuildActivity | null;
  /** the games it builds for, and the archive made for each */
  games?: GameId[];
  archives?: { game: GameId; path: string; size: number }[];
}

export type GameId = 'ac' | 'beamng' | 'rf2';

/** A game the track can be built for: its archive; whether the engine makes it here. */
export interface BuildGame {
  id: GameId;
  label: string;
  archive: string;
  available: boolean;
  /** BeamNG's: one level of every layout (its starts, races and own models); rFactor 2's: one location */
  everyLayout?: boolean;
}

export interface BuildStage {
  name: string;
  kind: 'step' | 'ac' | 'beamng' | 'rf2' | 'pack';
  label: string;
  /** cached: as before (nothing it hangs on changed) */
  state: 'waiting' | 'running' | 'cached' | 'done' | 'skipped' | 'failed' | 'stopped';
  /** seconds it took the last time */
  expected: number;
  /** seconds it took, or has taken so far */
  seconds: number;
}

export interface BuildActivity {
  stage: string;
  line: string;
  /** seconds since it last said anything */
  quiet: number;
  alive: boolean;
}

/** Whether the track can be built here (why not), its name in the game, where it is packed, its last build. */
export interface BuildInfo {
  available: boolean;
  why: string;
  track: string | null;
  archive: string;
  packer: string;
  /** AC's tracks folder (installing copies the track there): '' where none is found */
  game: string;
  /** BeamNG's mods folder (installing copies the level's zip there): null where none is found */
  beamngMods?: string | null;
  /** rFactor 2's folder (copying puts the location in its ModDev/Locations): null where none is found */
  rf2Folder?: string | null;
  /** another build is running (its lock file there) */
  locked: boolean;
  running: string | null;
  last: BuildJob | null;
  /** the games it can be built for */
  games?: BuildGame[];
}

/** A build asked for: the games (default Assetto Corsa), installed in AC too, every step made again. */
export interface BuildOptions {
  games?: GameId[];
  install?: boolean;
  /** BeamNG's level put in its mods folder too */
  installBeamng?: boolean;
  /** the rFactor 2 location copied into rFactor 2's ModDev too */
  installRf2?: boolean;
  /** the AC track packed too where it is installed (default on; always packed where it is not) */
  packAc?: boolean;
  all?: boolean;
}
