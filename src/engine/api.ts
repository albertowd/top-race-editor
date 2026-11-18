// The editor's engine calls answered where the engine runs (the desktop app's engine window): each the page's client
// asks, by its path. A call there is no route for, or one needing what the host does not have, fails saying so.

import { firstLines } from './ailines';
import { type BeamngHost, buildBeamng } from './beamng/level';
import { type BringSettings, bringIn, roadMeshesOffered } from './bringin';
import { builderOf, normalPath, type SystemHost, toolsOf } from './build';
import { trackContext } from './context';
import { lightSeriesOf } from './lightoptions';
import { libraryOf } from './materials';
import type { Filler, MergeOptions } from './merge';
import type { HostFiles, PlaceHost } from './placehost';
import { roadPreview, surfacePreview } from './previews';
import { Keys, type WizardHost } from './providers';
import { dumpPyJson, type PyJson, plain } from './pyjson';
import type { RoadDesc } from './roads';
import { editorModelsOf, pageCatalogue } from './templates';
import {
  IMAGE_QUALITY,
  IMAGE_SIDE,
  imageSize,
  saveTerrain,
  terrainImage,
  terrainInfo,
  terrainLayers,
  terrainRaster,
} from './terrain';
import { buildTrack } from './trackbuild';
import { changeTrack, saveTrackObjects, saveTrackRoads, trackObjects, trackRoads } from './trackdoc';
import { fitCurve, forPage, type Road, settingsOf, settingsPaths, type TrackSettings } from './trackfiles';
import { loadTrees, saveTrees } from './treesfile';
import type { Triangle } from './triangle';
import { terrainHere, Wizard } from './wizard';

/** A call of the page's: its track's folder, its path (with its query), its body (a POST's). */
export interface ApiCall {
  folder: string;
  path: string;
  body?: unknown;
}

/** What the engine's host has of its own for the calls (the engine window's: Chromium's pictures, the app's place). */
export interface ApiHost {
  /** a tile (a level each half the one before; TILE pixels a side) of a picture as JPEG, null where it has none */
  tile?(path: string, level: number, x: number, y: number): Promise<Uint8Array | null>;
  /** the file of the tracks opened before (kept with the wizard's keys) */
  recent?: string;
  /** what fills the merge's faces (the engine window's workers) */
  filler?: Filler;
  /** the disk, the engine's cache folder and a picture decoder (the terrain's layers worked out) */
  place?: PlaceHost;
  /** a picture made smaller, its longer side side pixels at most, as JPEG of quality 0-1 (Chromium's) */
  picture?(path: string, side: number, quality: number): Promise<Uint8Array>;
  /** the computer as a build needs it: its programs run (the track's tools, 7-Zip), the game's folder */
  system?: SystemHost;
  /** the editor's own models (their .glb and catalogue.json) */
  modelsDir?: string;
  /** the new-track wizard's: the network, pictures decoded and made JPEG; the file its keys are kept in */
  wizard?: { host: WizardHost; keys: string };
  /** another track opened, where the engine keeps the track open (the desktop app's engine window) */
  open?(folder: string): void;
  /** a triangulator on the engine's own thread (the far ground's) */
  triangle?: () => Promise<Triangle>;
  /** what makes the merge's outlines (the engine window's workers) */
  outliner?: MergeOptions['outliner'];
  /** the BeamNG level's: pictures read and made, a start's map drawn (Chromium's) */
  beamng?: BeamngHost;
}

/** What the host has of its own for a call, else an error saying what is missing (the desktop app's engine window
 * has each). */
function needs<T>(had: T | undefined, what: string): T {
  if (had === undefined) throw new Error(`the engine has no ${what} here: the desktop app’s engine window has`);
  return had;
}

const wizards = new Map<string, Wizard>();

/** The new-track wizard of the track open (its tracks made next to it, with its tools), kept while the engine runs. */
function wizardOf(files: HostFiles, s: TrackSettings, host: ApiHost): Wizard {
  const wizard = needs(host.wizard, 'new-track wizard');
  const place = needs(host.place, 'disk');
  const root = s.project
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .split('/')
    .slice(0, -1)
    .join('/');
  const tools = toolsOf(s);
  const key = `${root}|${tools}|${wizard.keys}`;
  let w = wizards.get(key);
  if (!w || w.files !== files) {
    w = new Wizard(root, tools, new Keys(files, wizard.keys), wizard.host, files, terrainHere(place));
    wizards.set(key, w);
  }
  return w;
}

/** The builds of the track: the track made by the engine (its place, its workers and a triangulator, the computer to
 * run 7-Zip on), its BeamNG level too where the host can read and make pictures. */
function builder(files: HostFiles, s: TrackSettings, host: ApiHost) {
  const system = needs(host.system, 'computer to build on');
  const place = needs(host.place, 'disk');
  const filler = needs(host.filler, 'merge workers');
  needs(host.triangle, 'triangulator');
  const beamng = host.beamng;
  return builderOf(files, system, s, {
    editorModels: host.modelsDir,
    makeTrack: async (log) => {
      await buildTrack(place, filler, {
        project: s.project,
        editorModels: host.modelsDir,
        log,
        more: { outliner: host.outliner },
      });
    },
    makeBeamng: beamng
      ? async ({ layout, ai, log }) => {
          await buildBeamng(files, beamng, { project: s.project, layout, ai, editorModels: host.modelsDir, log });
        }
      : undefined,
  });
}

/** levels of the satellite picture's tiles (satellite.py's MAX_LEVEL) */
export const MAX_LEVEL = 8;
/** tracks opened before, kept (tracks.py's RECENT) */
export const RECENT = 12;

/** pixels a tile of the satellite picture (satellite.py's TILE) */
export const TILE = 512;

/** A picture's width from its header alone (a JPEG's frame, a PNG's IHDR); fallback where neither is read. */
export function imageWidth(b: Uint8Array, fallback = 8192): number {
  return imageSize(b)?.[0] ?? fallback;
}

/** Where a track's road meshes are read from, to be brought in (config.py's meshes_from, road_models). */
const bringSettings = (files: HostFiles, s: TrackSettings): BringSettings => ({
  project: s.project,
  models: settingsPaths(s).models,
  roads: settingsPaths(s).roads,
  described: async () => (await trackRoads(files, s)).map((r) => ({ name: String(r.name), mesh: r.mesh as string })),
  meshesFrom:
    typeof s.track.meshes_from === 'string'
      ? `${s.project}/${s.track.meshes_from}`
      : `${s.project}/build/cache/floors_before_merge`,
  roadModels: Array.isArray(s.track.road_models) ? (s.track.road_models as string[]) : undefined,
});

const widths = new Map<string, number>();

/** The track's one map, where it has one: its tiles' folder and what its map.json says (metres it spans, pixels a side
 * at its whole precision, pixels a tile). */
async function mapOf(
  files: HostFiles,
  s: TrackSettings,
): Promise<{ dir: string; span: number; px: number; tile: number } | null> {
  const dir = settingsPaths(s).map;
  if (!dir || !(await files.exists(`${dir}/map.json`))) return null;
  const m = JSON.parse(new TextDecoder().decode(await files.read(`${dir}/map.json`))) as {
    span: number;
    px: number;
    tile: number;
  };
  return { dir, span: m.span, px: m.px, tile: m.tile };
}

/** The track as the page is told of it: its one map's, where it has one, else its satellite
 * picture's. */
async function trackInfo(files: HostFiles, s: TrackSettings) {
  const p = settingsPaths(s);
  const map = await mapOf(files, s);
  if (map)
    return { name: p.name, folder: s.project, span: map.span, px: map.px, tile: map.tile, materials: p.materials };
  let px = widths.get(p.satellite);
  if (px === undefined) {
    px = (await files.exists(p.satellite)) ? imageWidth(await files.read(p.satellite)) : 8192;
    widths.set(p.satellite, px);
  }
  return { name: p.name, folder: s.project, span: p.span, px, tile: TILE, materials: p.materials };
}

type Route = (
  files: HostFiles,
  s: TrackSettings,
  query: URLSearchParams,
  body: unknown,
  host: ApiHost,
) => Promise<unknown>;

/** A folder's track (its name and folder), if it has a track file (tracks.py's track_of). */
async function trackOf(files: HostFiles, folder: string) {
  const f = `${folder}/tools/reference/track.json`;
  if (!(await files.exists(f))) return null;
  try {
    const t = JSON.parse(new TextDecoder().decode(await files.read(f))) as { name?: string };
    return { name: String(t.name || folder.split(/[\\/]/).filter(Boolean).pop()), folder };
  } catch {
    return null;
  }
}

/** A folder as one compared with another: its separators one way, no trailing one, its case as Windows takes it. */
const folderKey = (a: string) =>
  a
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
const same = (a: string, b: string) => folderKey(a) === folderKey(b);

const GET: Record<string, Route> = {
  '/api/track': (files, s) => trackInfo(files, s),
  '/api/roads': async (files, s) => {
    const roads = await forPage(await trackRoads(files, s), fitCurve);
    return { roads, ...(await trackInfo(files, s)) };
  },

  // (a tile of the satellite picture: cut by the host, Chromium's)
  '/api/tile': async (files, s, q, _b, host) => {
    const [l, x, y] = ['l', 'x', 'y'].map((k) => Number(q.get(k)));
    if (![l, x, y].every((v) => Number.isInteger(v))) throw new Error('a tile is ?l=&x=&y=');
    // (the track's one map: its tiles as they are, cut already)
    const map = await mapOf(files, s);
    if (map) {
      const f = `${map.dir}/${l}/${x}_${y}.jpg`;
      if (!(await files.exists(f))) throw new Error('no such tile');
      return files.read(f);
    }
    const tile = needs(host.tile, 'way to cut the satellite picture');
    const got =
      (l as number) >= 0 && (l as number) <= MAX_LEVEL && (x as number) >= 0 && (y as number) >= 0
        ? await tile(settingsPaths(s).satellite, l as number, x as number, y as number)
        : null;
    if (!got) throw new Error('no such tile');
    return got;
  },
  // (the track open, and the others found: those opened before first, then the folders next to it (tracks.py))
  '/api/tracks': async (files, s, _q, _b, host) => {
    const here = s.project;
    const recent: string[] = [];
    if (host.recent && (await files.exists(host.recent)))
      try {
        const d = JSON.parse(new TextDecoder().decode(await files.read(host.recent)));
        if (Array.isArray(d)) for (const f of d) if (typeof f === 'string') recent.push(f);
      } catch {
        // (the list is a help, not a need)
      }
    const parent = here.split(/[\\/]/).slice(0, -1).join('/');
    let next: string[] = [];
    try {
      next = (await files.list(parent)).sort().map((n) => `${parent}/${n}`);
    } catch {
      next = [];
    }
    const out: { name: string; folder: string; open: boolean }[] = [];
    for (const folder of [here, ...recent, ...next]) {
      const t = await trackOf(files, folder);
      if (t && !out.some((o) => same(o.folder, t.folder))) out.push({ ...t, open: same(t.folder, here) });
    }
    return {
      open: { name: settingsPaths(s).name, folder: here },
      tracks: out,
    };
  },
  // (the road drawings the page shows under the roads: the track file's own, else their file as it is, none where
  // there is none)
  '/api/drawings': async (files, s) => {
    const given = s.track.drawings;
    if (given && typeof given === 'object') return given as PyJson;
    const p = settingsPaths(s).drawings;
    return (await files.exists(p)) ? JSON.parse(new TextDecoder().decode(await files.read(p))) : {};
  },
  // (the objects file of version 3 as it is; one of version 2 converted; none yet, read from the models)
  '/api/objects': (files, s) => trackObjects(files, s, settingsPaths(s).models),
  '/api/trees': async (files, s) => ({ trees: await loadTrees(files, s) }),
  // (each layout's models, in the order a game loads them, and the layout it was made from: the track file's)
  '/api/layouts': async (_files, s) => ({ layouts: (s.track.layouts ?? {}) as PyJson }),
  // (a layout's first racing lines, from the AI files the track has for it: null where it has none)
  '/api/lines/first': async (files, s, q) => ({ lines: await firstLines(files, s, q.get('layout') ?? '') }),
  // (the track as its models have it now, under the roads: kept until they change)
  '/api/context': async (files, s) => {
    const given = s.track.context_models as [string, string[], string][] | undefined;
    return trackContext(files, settingsPaths(s).models, await libraryOf(files, s.project), given);
  },
  // (the roads in the track's models not described yet, the biggest first)
  '/api/meshes': async (files, s) => ({
    meshes: await roadMeshesOffered(files, bringSettings(files, s), await libraryOf(files, s.project)),
  }),
  // (the terrain as saved; its picture, made smaller by the host (Chromium); a raster edit's file)
  '/api/terrain': (files, s) => terrainInfo(files, s.project),
  '/api/terrain/image': async (files, s, _q, _b, host) => {
    const picture = needs(host.picture, 'way to make pictures smaller');
    return picture(await terrainImage(files, s.project), IMAGE_SIDE, IMAGE_QUALITY);
  },
  '/api/terrain/raster': (files, s, q) => terrainRaster(files, s.project, q.get('file') ?? ''),
  // (the new-track wizard: its providers and keys, a place found, a tile of its map, a job's state)
  '/api/wizard': (files, s, _q, _b, host) => wizardOf(files, s, host).info(),
  '/api/wizard/search': async (files, s, q, _b, host) => ({
    places: await wizardOf(files, s, host).search(q.get('q') ?? ''),
  }),
  '/api/wizard/tile': async (files, s, q, _b, host) => {
    const w = wizardOf(files, s, host);
    const [z, x, y] = ['z', 'x', 'y'].map((k) => q.get(k) ?? '');
    if (![z, x, y].every((v) => /^-?\d+$/.test(v as string))) throw new Error('a tile is ?p=&z=&x=&y=');
    return w.tile(q.get('p') ?? 'esri', Number(z), Number(x), Number(y));
  },
  '/api/wizard/job': async (files, s, q, _b, host) => wizardOf(files, s, host).job(q.get('id') ?? ''),
  // (the track built: whether it can be here, its last build; a build's state)
  '/api/build': (files, s, _q, _b, host) => builder(files, s, host).info(),
  '/api/build/job': (files, s, q, _b, host) => builder(files, s, host).job(q.get('id') ?? ''),
  // (the catalogue the build lays the objects with, the editor's: a glb template's outline from above with it, for the
  // map, read with the track's library and textures; the track's light series, what its models' lights are unless an
  // object says otherwise)
  '/api/objects/catalogue': async (files, s, _q, _b, host) => ({
    models: await pageCatalogue(
      files,
      editorModelsOf(s.project, host.modelsDir),
      (await libraryOf(files, s.project)) ?? undefined,
      `${s.project}/source/textures`,
    ),
    series: await lightSeriesOf(files, s.project),
  }),
};

/** A track's folder as it is kept: whole, its separators /, no . or .. (tracks.py's resolve). */
const absolute = (p: string) => /^([A-Za-z]:)?[\\/]/.test(p);

/** A track opened, first among those opened before (tracks.py's remember: the list a help, not a need). */
async function remember(files: HostFiles, recent: string | undefined, folder: string) {
  if (!recent) return;
  let had: string[] = [];
  try {
    const d = JSON.parse(new TextDecoder().decode(await files.read(recent)));
    if (Array.isArray(d)) had = d.filter((f): f is string => typeof f === 'string');
  } catch {
    had = [];
  }
  const keep = [folder, ...had.filter((f) => !same(f, folder))].slice(0, RECENT);
  try {
    await files.write(recent, new TextEncoder().encode(dumpPyJson(keep, 1)));
  } catch {
    // (not kept: the list is a help, not a need)
  }
}

const POST: Record<string, Route> = {
  // (another track opened: the engine keeps it open from now on (tracks.py's open, without starting it again))
  '/api/open': async (files, _s, _q, body, host) => {
    const open = needs(host.open, 'way to open another track');
    const given = String((body as { folder?: unknown } | undefined)?.folder ?? '').trim();
    if (!given || !absolute(given)) throw new Error('a track is opened by its whole folder');
    const folder = normalPath(given);
    const t = await trackOf(files, folder);
    if (!t) throw new Error(`${folder} has no track file (tools/reference/track.json)`);
    await remember(files, host.recent, t.folder);
    open(t.folder);
    return { ok: true, ...t };
  },
  // (the wizard's: a key kept or forgotten, a plan estimated, made, stopped)
  '/api/wizard/keys': async (files, s, _q, body, host) => {
    const b = (body ?? {}) as { name?: unknown; value?: unknown };
    const v = b.value === undefined || b.value === null ? null : String(b.value);
    return wizardOf(files, s, host).setKey(String(b.name ?? ''), v);
  },
  '/api/wizard/estimate': async (files, s, _q, body, host) =>
    wizardOf(files, s, host).estimate((body as { plan?: unknown } | undefined)?.plan),
  '/api/wizard/start': async (files, s, _q, body, host) =>
    wizardOf(files, s, host).start((body as { plan?: unknown } | undefined)?.plan),
  '/api/wizard/cancel': async (files, s, _q, body, host) =>
    wizardOf(files, s, host).cancel(String((body as { id?: unknown } | undefined)?.id ?? '')),
  // (a build begun: the games, installed in AC, every step made again; a build stopped)
  '/api/build': async (files, s, _q, body, host) => {
    const b = (body ?? {}) as {
      install?: unknown;
      all?: unknown;
      games?: unknown;
      installBeamng?: unknown;
      installRf2?: unknown;
      packAc?: unknown;
    };
    return builder(files, s, host).start(!!b.install, !!b.all, b.games ?? ['ac'], {
      installBeamng: !!b.installBeamng,
      installRf2: !!b.installRf2,
      packAc: b.packAc !== false,
    });
  },
  '/api/build/cancel': async (files, s, _q, body, host) =>
    builder(files, s, host).cancel(String((body as { id?: unknown } | undefined)?.id ?? '')),
  // (the looks at the roads as built, level: a road's mesh cut under those above it; the surface in a window)
  '/api/mesh': async (_files, _s, _q, body) => {
    const b = (body ?? {}) as { road?: RoadDesc; roads?: RoadDesc[] };
    if (!b.road) throw new Error('needs: road');
    return roadPreview(b.road, b.roads ?? []);
  },
  // (a road mesh of the track's models brought in: described, its curve fitted, not saved)
  '/api/bring': async (files, s, _q, body) => {
    const b = (body ?? {}) as { model?: string; name?: string };
    if (!b.model || !b.name) throw new Error('needs: model, name');
    return bringIn(files, bringSettings(files, s), b.model, b.name, await libraryOf(files, s.project));
  },
  // (a road given by points, its curve fitted: as /api/roads fits them)
  '/api/fit': async (_files, _s, _q, body) => {
    const road = (body as { road?: Road } | undefined)?.road;
    if (!road) throw new Error('needs: road');
    return { curve: fitCurve(road) };
  },
  '/api/surface': async (_files, s, _q, body, host) => {
    const filler = needs(host.filler, 'merge workers');
    const b = (body ?? {}) as { roads?: RoadDesc[]; window?: number[] };
    if (!Array.isArray(b.roads) || !Array.isArray(b.window) || b.window.length !== 4)
      throw new Error('needs: roads, window [x0, z0, x1, z1]');
    return surfacePreview(b.roads, b.window as [number, number, number, number], filler, s.project);
  },
  // (the terrain worked out for a description not saved yet, or as saved; and saved)
  '/api/terrain/layers': async (_files, s, _q, body, host) => {
    const place = needs(host.place, 'disk');
    const b = (body ?? {}) as { doc?: unknown; want?: unknown };
    return terrainLayers(place, s.project, b.doc, b.want);
  },
  '/api/terrain': async (_files, s, _q, body, host) => {
    const place = needs(host.place, 'disk');
    const doc = (body as { doc?: unknown } | undefined)?.doc;
    if (doc === undefined) throw new Error('needs: doc');
    return saveTerrain(place, s.project, settingsPaths(s).backups, doc);
  },
  '/api/objects': async (files, s, _q, body) => {
    const given = (body as { objects?: unknown } | undefined)?.objects;
    if (given === undefined) throw new Error('needs: objects');
    return { ok: true, objects: await saveTrackObjects(files, s, settingsPaths(s).backups, given) };
  },
  '/api/layouts': async (files, s, _q, body) => {
    const given = (body as { layouts?: unknown } | undefined)?.layouts;
    if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error('needs: layouts {name: {models}}');
    const out: Record<string, PyJson> = {};
    for (const [name, v] of Object.entries(given as Record<string, { models?: unknown; from?: unknown }>)) {
      if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`a layout's name: lower case letters, digits and _, not ${name}`);
      if (!Array.isArray(v?.models) || v.models.some((m) => typeof m !== 'string'))
        throw new Error(`layouts.${name}.models: its models' names, please`);
      out[name] = { models: v.models as string[], ...(typeof v.from === 'string' && v.from ? { from: v.from } : {}) };
    }
    await changeTrack(files, s, settingsPaths(s).backups, (doc) => {
      doc.layouts = out;
    });
    return { ok: true, layouts: out };
  },
  '/api/trees': async (files, s, _q, body) => {
    const given = (body as { trees?: unknown } | undefined)?.trees;
    if (given === undefined) throw new Error('needs: trees');
    return { ok: true, trees: await saveTrees(files, s, settingsPaths(s).backups, given) };
  },
  '/api/save': async (files, s, _q, body) => {
    const b = (body ?? {}) as { roads?: Road[]; deleted?: string[] };
    if (!Array.isArray(b.roads)) throw new Error('needs: roads');
    const changed = await saveTrackRoads(files, s, settingsPaths(s).backups, b.roads, b.deleted ?? []);
    return { ok: true, changed, roads: await forPage(await trackRoads(files, s), fitCurve) };
  },
};

/** A call of the page's answered (its folder's track's settings read each time: a track file edited is taken as it
 * is); one the engine has no route for fails saying so. */
export async function answerApi(files: HostFiles, call: ApiCall, host: ApiHost = {}): Promise<unknown> {
  const u = new URL(call.path, 'http://engine');
  const post = call.body !== undefined;
  const route = (post ? POST : GET)[u.pathname];
  if (!route) throw new Error(`the engine has no call ${post ? 'POST' : 'GET'} ${u.pathname}`);
  const s = await settingsOf(files, call.folder);
  const result = await route(files, s, u.searchParams, call.body, host);
  // (its numbers plain again: a PyNumber across a port would come as an object)
  return plain(result as PyJson);
}
