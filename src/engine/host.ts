// The engine's calls, answered on a message port: each call {id, method, params}, each answer {id, ok, result} or
// {id, ok: false, error}. The engine window answers the editor's windows so (one port each); the tests, with Node's
// own ports.

import { buildAc } from './acbuild';
import { type ApiCall, type ApiHost, answerApi } from './api';
import type { Filler, MergeOptions } from './merge';
import { type PlaceHost, placeOf } from './placehost';
import { mergeRoads } from './roadshost';
import type { Box } from './tiles';

/** What the engine is handed by where it runs (the engine window's preload, Node, a test). */
export interface HostEnv {
  version: string;
  processors(): number;
  freeMemory(): number;
  totalMemory(): number;
  /** the disk, the engine's cache folder and a picture decoder, where it has them (the engine window) */
  place?: PlaceHost;
  /** the editor's own models (models/: their .glb and catalogue.json), where it has them */
  modelsDir?: string;
  /** what the page's calls ask of where the engine runs (api.ts): a picture's tiles, the tracks opened before */
  apiHost?: ApiHost;
  /** what fills the merge's faces and makes its outlines (the engine window's workers) */
  filler?: Filler;
  outliner?: MergeOptions['outliner'];
  /** the track open (its folder), where the engine keeps it (the desktop app's engine window): another opened */
  project?: { get(): string | null; set(folder: string): void };
}

export interface Call {
  id: number;
  method: string;
  params?: unknown;
}

export type Answer = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** A port as both the browser and Node have one. */
export interface PortLike {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
}

/** What the engine says of itself and the computer it runs on. */
export interface EngineInfo {
  version: string;
  processors: number;
  memory: { free: number; total: number };
}

type Method = (env: HostEnv, params: never) => unknown;

/** A track's ground at points: its place worked out (or kept from before), each point's height. */
export interface PlaceHeights {
  key: string;
  /** whether its layers were kept from before */
  kept: boolean;
  /** milliseconds it took */
  ms: number;
  heights: number[];
}

const METHODS: Record<string, Method> = {
  info: (env): EngineInfo => ({
    version: env.version,
    processors: env.processors(),
    memory: { free: env.freeMemory(), total: env.totalMemory() },
  }),
  /** params: {project: its root, terrain: its terrain's folder from there (by default tools/reference/terrain),
   * points: x, z pairs} */
  'place.heights': async (env, p: { project: string; terrain?: string; points: number[] }): Promise<PlaceHeights> => {
    if (!env.place) throw new Error('the engine has no disk here: the desktop app’s engine window has');
    const t0 = performance.now();
    const place = await placeOf(env.place, p.project, p.terrain);
    return {
      key: place.key,
      kept: place.kept,
      ms: Math.round(performance.now() - t0),
      heights: [...place.ground.ys(p.points)],
    };
  },
  /** the track open (its folder), where the engine keeps it; null where it has none open */
  project: (env): string | null => env.project?.get() ?? null,
  /** params: {folder, path, body}: a call of the page's (api.ts); its folder by default the track open */
  api: async (env, p: ApiCall) => {
    const folder = p.folder || env.project?.get();
    if (!env.place) throw new Error('the engine has no disk here: the desktop app’s engine window has');
    if (!folder) throw new Error('no track is open');
    return answerApi(
      env.place.files,
      { ...p, folder },
      {
        filler: env.filler,
        outliner: env.outliner,
        place: env.place,
        modelsDir: env.modelsDir,
        ...(env.project ? { open: (f: string) => env.project?.set(f) } : {}),
        ...env.apiHost,
      },
    );
  },
  /** params: {project, roads: its roads.json (by default tools/reference/roads.json), terrain, window: a box (by
   * default round every road), check: the merge proved too} — the roads merged with the ground, what the last merge
   * made kept: what each region came to and what it took */
  'roads.merge': async (
    env,
    p: { project: string; roads?: string; terrain?: string; window?: Box; check?: boolean },
  ) => {
    if (!env.place || !env.filler) throw new Error('the engine has no disk here: the desktop app’s engine window has');
    return mergeRoads(
      env.place,
      env.filler,
      { ...p, meshes: false, models: env.modelsDir },
      { outliner: env.outliner },
    );
  },
  /** params: {project, everything: every model made again} — the track built for AC as the track's build makes it
   * (build/ac/content/tracks/<its folder>; only what changed made again): where, what it made, how long */
  'build.ac': async (env, p: { project: string; everything?: boolean }) => {
    if (!env.place) throw new Error('the engine has no disk here: the desktop app’s engine window has');
    return buildAc(env.place.files, { project: p.project, everything: p.everything, editorModels: env.modelsDir });
  },
};

/** The engine's calls answered on a port. */
export function answer(port: PortLike, env: HostEnv): void {
  port.onmessage = async (e) => {
    const call = e.data as Call;
    if (!call || typeof call.id !== 'number') return;
    try {
      const method = METHODS[call.method];
      if (!method) throw new Error(`the engine has no ${call.method}`);
      port.postMessage({ id: call.id, ok: true, result: await method(env, call.params as never) } satisfies Answer);
    } catch (err) {
      port.postMessage({
        id: call.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies Answer);
    }
  };
}
