// The engine's terrain API (under /api/terrain: src/engine/terrain.ts, in the engine window).

import { engine } from '../api/client';
import type { GridName, LayersJson, RasterJson, TerrainDoc, TerrainInfo } from './types';

/** A description as the engine takes it: a raster edit not saved yet with its data. */
export type DocToSend = Omit<TerrainDoc, 'edits'> & { edits: (TerrainDoc['edits'][number] & { data?: RasterJson })[] };

export type Want = GridName | 'points';

/** The engine as the terrain asks it (the page's EngineClient): a call, and bytes to show as a URL. */
export interface TerrainEngine {
  ask<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  blob(path: string, type: string): Promise<string>;
}

export class TerrainApi {
  constructor(private readonly engine: TerrainEngine) {}

  info(): Promise<TerrainInfo> {
    return this.engine.ask('/api/terrain');
  }

  layers(doc: DocToSend | null, want: readonly Want[], signal?: AbortSignal): Promise<LayersJson> {
    return this.engine.ask('/api/terrain/layers', doc ? { doc, want } : { want }, signal);
  }

  raster(file: string): Promise<RasterJson> {
    return this.engine.ask(`/api/terrain/raster?file=${encodeURIComponent(file)}`);
  }

  save(doc: DocToSend): Promise<TerrainInfo & { ok: boolean }> {
    return this.engine.ask('/api/terrain', { doc });
  }

  /** The picture of the ground round the track, its URL (a blob's). */
  picture(): Promise<string> {
    return this.engine.blob('/api/terrain/image', 'image/jpeg');
  }
}

export const terrainApi = new TerrainApi(engine);
