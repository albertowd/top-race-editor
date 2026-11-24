import type { LayoutModels, RacingLines, Road, TrackObjects } from '../domain/types';
import type { BumpsJson } from '../editing/bumps';
import type { TreePlacement } from '../editing/trees';
import { engineChannel } from './engineport';
import type {
  BringResponse,
  BuildInfo,
  BuildJob,
  BuildOptions,
  CatalogueResponse,
  ContextResponse,
  Drawings,
  FitResponse,
  MeshResponse,
  ObjectsResponse,
  ObjectsSaveResponse,
  RoadMesh,
  RoadsResponse,
  SaveResponse,
  SurfaceResponse,
  TrackEntry,
  TrackInfo,
  TracksResponse,
  TreesResponse,
  TreesSaveResponse,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The engine window (the desktop app's): the page's calls (api) answered there. */
export interface LocalEngine {
  readonly connected: boolean;
  call<T>(method: string, params?: unknown): Promise<T>;
  /** whether it is there, once it is (the desktop app's port is handed over as the page loads) */
  whenReady?(): Promise<boolean>;
  /** the track it has open (its folder), where it keeps one */
  project?(): Promise<string | null>;
}

/** What a call waits for, or its signal's abort, whichever comes first. */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new DOMException('stopped', 'AbortError'));
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/** The engine's API (src/engine/api.ts), asked of the engine window by each call's path, on the track it has open. */
export class EngineClient {
  /** the open track's folder, as the engine window keeps it (what its answers are of) */
  private folder: Promise<string> | null = null;

  constructor(private readonly local: LocalEngine) {}

  /** A call of the engine window's: its answer, or what it failed with. */
  private async call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    if (!this.local.connected) await this.local.whenReady?.();
    if (!this.local.connected) throw new ApiError('no engine window: the editor runs in its desktop app', 503);
    const folder = await this.where();
    try {
      return await abortable(this.local.call<T>('api', { folder, path, body }), signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError(e instanceof Error ? e.message : String(e), 500);
    }
  }

  /** A call of the engine's (by its path, with a body if a POST). */
  ask<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.call(path, body, signal);
  }

  /** The open track's folder, as the engine window keeps it (once; again after another track is opened); '' where it
   * has none yet, its own then. */
  private where(): Promise<string> {
    this.folder ??= (async () => (this.local.project ? await this.local.project().catch(() => null) : null) ?? '')();
    return this.folder;
  }

  track(): Promise<TrackInfo> {
    return this.call('/api/track');
  }

  tracks(): Promise<TracksResponse> {
    return this.call('/api/tracks');
  }

  /** Another track opened: the engine window keeps it open from now on (the page is loaded again on it). */
  async openTrack(folder: string): Promise<TrackEntry & { ok: boolean }> {
    try {
      return await this.call('/api/open', { folder });
    } finally {
      // (the track open asked again after)
      this.folder = null;
    }
  }

  buildInfo(): Promise<BuildInfo> {
    return this.call('/api/build');
  }

  /** The track built for Assetto Corsa: begun (install: copied into the game; all: every step made again). */
  startBuild(opts: BuildOptions = {}): Promise<BuildJob> {
    return this.call('/api/build', opts);
  }

  buildJob(id: string): Promise<BuildJob> {
    return this.call(`/api/build/job?id=${encodeURIComponent(id)}`);
  }

  cancelBuild(id: string): Promise<BuildJob> {
    return this.call('/api/build/cancel', { id });
  }

  roads(): Promise<RoadsResponse> {
    return this.call('/api/roads');
  }

  context(): Promise<ContextResponse> {
    return this.call('/api/context');
  }

  drawings(): Promise<Drawings> {
    return this.call('/api/drawings');
  }

  async meshes(): Promise<RoadMesh[]> {
    return (await this.call<{ meshes: RoadMesh[] }>('/api/meshes')).meshes ?? [];
  }

  save(roads: Road[], deleted: string[]): Promise<SaveResponse> {
    return this.call('/api/save', { roads, deleted });
  }

  mesh(road: Road, roads: Road[], signal?: AbortSignal): Promise<MeshResponse> {
    return this.call('/api/mesh', { road, roads }, signal);
  }

  surface(roads: Road[], window: [number, number, number, number]): Promise<SurfaceResponse> {
    return this.call('/api/surface', { roads, window });
  }

  bring(model: string, name: string): Promise<BringResponse> {
    return this.call('/api/bring', { model, name });
  }

  fit(road: Road): Promise<FitResponse> {
    return this.call('/api/fit', { road });
  }

  objects(): Promise<ObjectsResponse> {
    return this.call('/api/objects');
  }

  /** The track's own catalogue of models (their lights, fits, collisions). */
  catalogue(): Promise<CatalogueResponse> {
    return this.call('/api/objects/catalogue');
  }

  saveObjects(objects: TrackObjects): Promise<ObjectsSaveResponse> {
    return this.call('/api/objects', { objects });
  }

  /** The roads' bumps made by hand (none: an empty set). */
  bumps(): Promise<BumpsJson> {
    return this.call('/api/bumps');
  }

  saveBumps(bumps: BumpsJson): Promise<{ ok: boolean; bumps: BumpsJson }> {
    return this.call('/api/bumps', { bumps });
  }

  /** A layout's first racing lines, read from the AI files the track has for it (null where it has none). */
  firstLines(layout: string): Promise<{ lines: RacingLines | null }> {
    return this.call(`/api/lines/first?layout=${encodeURIComponent(layout)}`);
  }

  /** Each layout's models (the track file's `layouts`). */
  layouts(): Promise<{ layouts: Record<string, LayoutModels> }> {
    return this.call('/api/layouts');
  }

  saveLayouts(layouts: Record<string, LayoutModels>): Promise<{ ok: boolean; layouts: Record<string, LayoutModels> }> {
    return this.call('/api/layouts', { layouts });
  }

  /** The track's trees (its track file's). */
  trees(): Promise<TreesResponse> {
    return this.call('/api/trees');
  }

  saveTrees(trees: TreePlacement[]): Promise<TreesSaveResponse> {
    return this.call('/api/trees', { trees });
  }

  /** A tile of the satellite picture to show: its JPEG as a blob's URL (to be let go when no longer shown). */
  tile(level: number, x: number, y: number): Promise<string> {
    return this.blob(`/api/tile?l=${level}&x=${x}&y=${y}`, 'image/jpeg');
  }

  /** What the engine answers in bytes (a picture) to show: a blob's URL of them (to be let go when no longer shown). */
  async blob(path: string, type: string): Promise<string> {
    const bytes = await this.call<Uint8Array>(path);
    if (!(bytes instanceof Uint8Array)) throw new ApiError(`${path}: no bytes`, 500);
    return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  }
}

export const engine = new EngineClient(engineChannel);
