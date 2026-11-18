// The terrain as the track's terrain.json has it (tools/reference/terrain, kart-velopark's tools/terrain.py), and
// as the engine works it out for the page: grids of heights, the heights with why the filters took them out.

import type { Vec2 } from '../domain/types';

export interface TreeRule {
  /** darker than this */
  lum: number;
  /** more uneven than this, over 9 m */
  sd: number;
}

/** An area drawn: the ground (whatever the rules find), or not. */
export interface TerrainArea {
  name: string;
  kind: 'ground' | 'not_ground';
  ring: Vec2[];
}

export interface TerrainFilters {
  picture_trees: TreeRule;
  photo_trees: TreeRule;
  tree_near_m: number;
  tree_share: number;
  over_m: number;
  opening_m: number;
  wide_over_m: number;
  wide_opening_m: number;
  fills_m: number[];
  enough_a_cell: number;
  areas: TerrainArea[];
}

interface EditBase {
  name: string;
  /** turned off: the ground as it is without it */
  off?: boolean;
}

/** Metres added on a grid of its own (an .npz of the terrain's folder): the brushes paint them. */
export interface RasterEdit extends EditBase {
  type: 'raster';
  file: string;
}

interface RingEdit extends EditBase {
  ring: Vec2[];
  /** metres out of the ring it eases to nothing over */
  ease_m: number;
}

export interface OffsetEdit extends RingEdit {
  type: 'offset';
  by: number;
}

/** Flat at a height (the track's y), or at a point's height and plus metres over it; sloped from that point. */
export interface FlatEdit extends RingEdit {
  type: 'flat';
  height?: number;
  at?: Vec2;
  plus?: number;
  slope?: Vec2;
}

export interface SmoothEdit extends RingEdit {
  type: 'smooth';
  sigma_m: number;
}

export type TerrainEdit = RasterEdit | OffsetEdit | FlatEdit | SmoothEdit;
export type EditType = TerrainEdit['type'];
export type RingEditType = Exclude<EditType, 'raster'>;

export interface TerrainDoc {
  version: number;
  place: { location: string };
  image: { file: string; area_x_z: [Vec2, Vec2]; metres_a_pixel: number; source?: string };
  photo?: { file: string; size_m: number } | null;
  heights: { files: string[]; offset_m: number; source?: string };
  buildings?: { files: string[]; buffer_m: number };
  grid: { area_x_z: [Vec2, Vec2]; cell_m: number };
  filters: TerrainFilters;
  edits: TerrainEdit[];
  [key: string]: unknown;
}

/** The terrain as saved (GET /api/terrain). */
export interface TerrainInfo {
  exists: boolean;
  reason?: string;
  doc?: TerrainDoc;
  /** each code's meaning (points' why) */
  why?: Record<string, string>;
  ground_cell?: number;
  folder?: string;
  image?: { area_x_z: [Vec2, Vec2]; metres_a_pixel: number; size: [number, number] | null };
}

/** A grid of heights as the engine sends it: rows along z from z0, columns along x from x0; 16 bit, lo to hi. */
export interface GridJson {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  lo: number;
  hi: number;
  data: string;
}

/** A raster edit's values as the engine sends and takes them: float32. */
export interface RasterJson {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  d: string;
}

export interface LayersJson {
  grids: Partial<Record<GridName, GridJson | null>>;
  points?: { count: number; x: string; z: string; y: string; why: string };
  counts?: Record<string, number>;
  seconds: number;
}

/** A grid of values: v[iz * nx + ix] at (x0 + ix * cell, z0 + iz * cell). */
export interface Grid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  v: Float32Array;
  lo: number;
  hi: number;
}

/** A raster edit's metres added, as a grid. */
export type Raster = Omit<Grid, 'lo' | 'hi'>;

export interface Points {
  x: Float32Array;
  z: Float32Array;
  y: Float32Array;
  why: Uint8Array;
}

/** original: every height; filtered: those the filters keep; ground: the edits on them; change: what the edits
 * change (ground less filtered, only where they do). */
export type GridName = 'original' | 'filtered' | 'ground' | 'change';
