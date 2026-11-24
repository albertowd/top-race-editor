// The track built for Assetto Corsa where the engine runs, as the track's own build makes it (build_tracks.py's
// build_ac, ac_places.py, ac_lights.py): each model the track's steps made (its track file's models: track/models)
// read with the material library (its meshes' AC names and flags
// made from what each is), a layout's places put in as AC's own nodes (an empty node a spot, AC_START_0 ...; a physics
// object AC_POBJECT_n, its hull unseen, its model under it), its PNG textures made DDS (the last DDS of an unchanged
// texture kept in build/cache/dds, as the track's build keeps it), written as a .kn5; source/track copied beside them,
// with AC's files the steps changed (track/ac: the layouts' model lists, AI lines) over it and the Custom Shaders
// Patch config made from its own settings and the track's lights and screens (aclights.ts); each layout's pit boxes
// in its ui_track.json. Only what changed since the last build is made again.

import type { AiSettings } from '../domain/types';
import { writeAiFile } from './acai';
import { AC_LIGHTS, acLightsText, lightsData } from './aclights';
import { AI_WIDTH, CLEAR_MORE } from './aiclear';
import type { RacingLine, RacingLines } from './ailines';
import { aiLineOf, pitRunsBackwards, STEP } from './aimake';
import {
  BOARD_SHEET_MATERIAL,
  boardText,
  CARDS_MATERIAL,
  CARDS_PICTURE,
  type CardPainter,
  type CardSheet,
  canvasCards,
  cardSheet,
  onCards,
} from './boardfaces';
import { acDds, type TextureAc } from './dds';
import { libraryMaterial, loadKn5, type MaterialLibrary, pictureMaterial } from './gltf';
import { dump, type Kn5, type Kn5Material, type Kn5Mesh, VERT } from './kn5tree';
import { libraryOf } from './materials';
import { meshes, sphere, triangles } from './mesh';
import { byCodePoint } from './order';
import { kerbsToDrive, type Roads } from './paint';
import type { HostFiles } from './placehost';
import type { LayoutPlaces, PlacesDoc } from './places';
import { type PyJson, plain } from './pyjson';
import type { RoadDesc } from './roads';
import { Surface } from './surface';
import {
  type CatalogueModel,
  type CatalogueSource,
  catalogue,
  editorModelsOf,
  loadTemplate,
  scriptsOf,
  type TemplatePart,
} from './templates';
import { dedupeTextures } from './texturepool';
import { readPart, trackRoads } from './trackdoc';
import { settingsOf } from './trackfiles';
import { isRubberPage } from './wear';

export interface AcBuildOptions {
  project: string;
  /** the track's folder in AC's content/tracks (by default its name, lower case, words joined by _) */
  folder?: string;
  /** where the track is built (by default build/ac/content/tracks/<folder>) */
  out?: string;
  /** the layouts' places (by default the models' places.json's) */
  places?: PlacesDoc | null;
  /** the editor's own models (their .glb and catalogue.json) */
  editorModels?: string;
  /** every model made again, whatever was made before */
  everything?: boolean;
  /** each layout's AI lines (ai/fast_lane.ai, data/ideal_line.ai, ai/pit_lane.ai) made from its racing lines (the
   * track file's objects), where it has them; else the recorded ones (track/ac's, source/track's) */
  aiFromLines?: boolean;
  /** what it is doing, as it does it */
  log?: (line: string) => void;
  /** where the work is shared out: the textures made DDS (by default here, one after another) */
  dds?: (name: string, data: Uint8Array, textures: Record<string, TextureAc>) => Promise<Uint8Array>;
  /** the boards' cards drawn (by default on Chromium's canvas) */
  cards?: CardPainter;
}

export interface AcBuilt {
  out: string;
  models: number;
  made: string[];
  copied: number;
  ms: number;
}

/** A layout's model list as AC reads it (models_<layout>.ini; track_data.ac_models): each model a [MODEL_n] of its
 * .kn5, where it is. */
export const acModels = (models: string[]) =>
  models.map((m, i) => `[MODEL_${i}]\r\nFILE=${m}.kn5\r\nPOSITION=0,0,0\r\nROTATION=0,0,0\r\n`).join('\r\n');

/** A track's folder for AC from its name: lower case, each run of anything but letters and digits a _. */
export const acFolder = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** A node's matrix turned to heading (its +z along (sin, 0, cos)) and moved to x, y, z (ac_places.matrix). */
export function placeMatrix(x: number, y: number, z: number, heading: number): number[] {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1];
}

/** A mesh's name: its object's, its part's after it where its model has more than one (place_objects.part_name). */
export const partName = (name: string, part: string, parts: number) =>
  parts === 1 ? name : `${name}_${part.toUpperCase()}`;

/** Where a material not in a model is brought from: the other models of the track, read as they are. */
export interface MaterialSources {
  models(): Promise<Kn5[]>;
  /** a material no model has, made from the material library, with its pictures; null where the library has none */
  library?(name: string): Promise<{ material: Kn5Material; textures: Kn5['textures'] } | null>;
}

/** A material's index in model k: brought in, with its textures, from the model it is of (from: an editor's model, its
 * own), else the first model that has it, if k has none of it (place_objects.material_of). */
async function materialOf(k: Kn5, name: string, sources: MaterialSources, from?: Kn5): Promise<number> {
  const at = k.materials.findIndex((m) => m.name === name);
  if (at >= 0) return at;
  const own = from?.materials.some((m) => m.name === name && m.own) ? [from as Kn5] : [];
  for (const src of [...own, ...(await sources.models())]) {
    const m = src.materials.find((x) => x.name === name);
    if (!m) continue;
    const have = new Set(k.textures.map((t) => t.name));
    for (const t of m.textures)
      if (!have.has(t.name)) {
        const tex = src.textures.find((x) => x.name === t.name);
        if (tex) k.textures.push({ ...tex, data: new Uint8Array(tex.data) });
        have.add(t.name);
      }
    k.materials.push(structuredClone(m));
    return k.materials.length - 1;
  }
  // (none: the library's, with its pictures)
  const made = await sources.library?.(name);
  if (made) {
    const have = new Set(k.textures.map((t) => t.name));
    for (const t of made.textures) if (!have.has(t.name)) k.textures.push(t);
    k.materials.push(made.material);
    return k.materials.length - 1;
  }
  throw new Error(`no model has the material ${name}, nor the material library`);
}

/** A mesh node of model k (place_objects.mesh): its points (eleven numbers each), faces, material by its name; seen
 * from lod[0] to lod[1] metres away (0, 0: always). */
async function meshOf(
  k: Kn5,
  name: string,
  part: TemplatePart,
  sources: MaterialSources,
  renderable = true,
  lod: [number, number] = [0, 0],
): Promise<Kn5Mesh> {
  const n = part.V.length / VERT;
  if (n >= 65536) throw new Error(`${name}: ${n} points, more than a kn5 mesh of 16-bit faces holds`);
  const n0: Kn5Mesh = {
    kind: 2,
    name,
    active: 1,
    children: [],
    verts: Float32Array.from(part.V),
    faces: Uint16Array.from(part.F),
    material: await materialOf(k, part.material, sources, part.from),
    cast_shadows: renderable ? 1 : 0,
    visible: 1,
    transparent: 0,
    layer: 0,
    lod_in: lod[0],
    lod_out: lod[1],
    renderable: renderable ? 1 : 0,
    sphere: [0, 0, 0, 0],
  };
  sphere(n0);
  return n0;
}

/** A layout's places put into its model k (ac_places.add): its spots and gates, empty nodes; its physics objects, each
 * an AC_POBJECT_n of its model's hull (unseen) and its seen parts under a node named after it. */
export async function addPlaces(
  k: Kn5,
  here: LayoutPlaces,
  cat: Record<string, CatalogueModel>,
  parts: (model: string) => Promise<TemplatePart[]>,
  sources: MaterialSources,
  /** the boards' cards (boardfaces.ts): each board's face on its own text's card */
  cards?: { sheet: CardSheet; png: Uint8Array },
): Promise<void> {
  const board = (model: string) => !!cards && cat[model]?.kind === 'boards';
  if (cards && here.objects.some((o) => board(o.model)) && !k.materials.some((m) => m.name === CARDS_MATERIAL)) {
    if (!k.textures.some((t) => t.name === CARDS_PICTURE))
      k.textures.push({ name: CARDS_PICTURE, active: 1, data: cards.png });
    k.materials.push(pictureMaterial(CARDS_MATERIAL, CARDS_PICTURE));
  }
  for (const s of here.spots)
    k.root.children.push({
      kind: 1,
      name: `AC_${s.name}`,
      active: 1,
      matrix: placeMatrix(s.x, s.y, s.z, s.heading),
      children: [],
    });
  for (const [i, o] of here.objects.entries()) {
    const own = await parts(o.model);
    const all =
      cards && board(o.model) ? onCards(own, BOARD_SHEET_MATERIAL, cards.sheet, boardText(o.name, o.text)) : own;
    const lods = cat[o.model]?.lods ?? {};
    const top: Kn5['root'] = {
      kind: 1,
      name: `AC_POBJECT_${i}`,
      active: 1,
      matrix: placeMatrix(o.x, o.y, o.z, o.heading),
      children: [],
    };
    const hull = all.find((p) => p.part === 'hull');
    if (hull) top.children.push(await meshOf(k, top.name, hull, sources, false));
    const seen = all.filter((p) => p.part !== 'hull');
    const node: Kn5['root'] = {
      kind: 1,
      name: o.name,
      active: 1,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      children: [],
    };
    for (const p of seen)
      node.children.push(
        await meshOf(k, partName(o.name, p.part, seen.length), p, sources, true, lods[p.part] ?? [0, 0]),
      );
    top.children.push(node);
    k.root.children.push(top);
  }
}

/** the pictures' pooling, as a model's signature has it (a change to how they are pooled makes every model again) */
const POOL = 2;

/** The karts a race of a layout takes (its ui_track.json's pitboxes): one for each grid slot that has a pit box too;
 * more pit boxes than slots would let the game start the rest from the boxes. A layout with no grid: its pit boxes. */
export function raceKarts(here: { spots?: { name: string }[]; pits?: number }): number {
  const grid = (here.spots ?? []).filter((s) => /^START_\d+$/.test(s.name)).length;
  return grid ? Math.min(here.pits ?? 0, grid) : (here.pits ?? 0);
}

/** A layout's pit boxes set in the built track's ui/<layout>/ui_track.json (ac_places.pitboxes): whether it has one. */
export async function setPitboxes(files: HostFiles, out: string, layout: string, n: number): Promise<boolean> {
  const p = `${out}/ui/${layout}/ui_track.json`;
  if (!(await files.exists(p))) return false;
  let text = new TextDecoder().decode(await files.read(p));
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const next = text.replace(/("pitboxes"\s*:\s*")\d+(")/g, `$1${n}$2`);
  if (next !== text) await files.write(p, new TextEncoder().encode(next));
  return true;
}

export async function sha1(parts: Uint8Array[]): Promise<string> {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A folder's files, all the way down (paths relative to it, with /). */
export async function filesUnder(files: HostFiles, dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const name of (await files.list(`${dir}${rel ? `/${rel}` : ''}`)).sort(byCodePoint)) {
    const r = rel ? `${rel}/${name}` : name;
    // (a folder is what lists; a file what does not)
    let kids: string[] | null = null;
    try {
      kids = await files.list(`${dir}/${r}`);
    } catch {
      kids = null;
    }
    if (kids) out.push(...(await filesUnder(files, dir, r)));
    else out.push(r);
  }
  return out;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The track built for AC (build_tracks.build_ac). */
/** the floor's meshes (their tops: the ground, roads and kerbs), and of them the roads' (a line's sides end where
 * they do) */
const FLOOR_MESH = /^(1GRASS|1ROAD|1KERB|GRASS)/;
const ROAD_MESH = /^(1ROAD|1KERB)/;
/** the roads a car's AI keeps its wheels on (aiclear.ts), and its sides end where they do: the roads but their
 * kerbs (their low ramps given back from the roads' description: paint.ts's kerbsToDrive), which throw a car */
const CLEAR_MESH = /^1ROAD(?!_KERB)/;

/** Each layout's AI lines made from its racing lines and written into the track built (aimake.ts, acai.ts), on the
 * floor of its models: how many files written. */
async function aiFromLines(
  files: HostFiles,
  project: string,
  models: string,
  library: MaterialLibrary,
  out: string,
  layouts: string[],
  log: (line: string) => void,
): Promise<number> {
  const settings = await settingsOf(files, project);
  const doc = await readPart(files, settings, 'objects');
  const read = plain((doc ?? {}) as PyJson) as {
    layouts?: Record<string, { lines?: RacingLines }>;
    ai?: AiSettings;
  };
  const lines = read.layouts ?? {};
  // (the cars' width: half of it, and a little, kept clear of the edges and of the rumbles' raised parts)
  const width = read.ai?.width ?? AI_WIDTH;
  const margin = width / 2 + CLEAR_MORE;
  const want = layouts.filter((l) => lines[l]?.lines?.fast?.curve?.length);
  if (!want.length) {
    log('  no racing lines: the recorded AI lines kept');
    return 0;
  }
  const floor: Float64Array[] = [];
  const road: Float64Array[] = [];
  const clearRoad: Float64Array[] = [];
  for (const f of (await files.list(models)).filter((x) => x.endsWith('.glb')))
    for (const [n, m] of meshes(await loadKn5(files, `${models}/${f}`, library))) {
      if (!n.faces.length || !FLOOR_MESH.test(n.name)) continue;
      const T = triangles(n as Kn5Mesh, m);
      floor.push(T);
      if (ROAD_MESH.test(n.name)) road.push(T);
      if (CLEAR_MESH.test(n.name)) clearRoad.push(T);
    }
  const together = (parts: Float64Array[]) => {
    const all = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return new Surface(all);
  };
  const F = together(floor);
  const R = together(road);
  const y = (x: number, z: number) => F.y(x, z);
  const onRoad = (x: number, z: number) => !Number.isNaN(R.y(x, z));
  const C = together(clearRoad);
  // (and the rumbles' low ramps: a car may run over those, not over their concrete nor off their backs)
  const described = plain((await trackRoads(files, settings)) as unknown as PyJson) as unknown as RoadDesc[];
  const ramps = kerbsToDrive(Object.fromEntries(described.map((r) => [r.name, r])) as Roads);
  const clear = (x: number, z: number) => !Number.isNaN(C.y(x, z)) || ramps(x, z);
  let written = 0;
  for (const l of want) {
    const L = lines[l]?.lines as RacingLines;
    const fast = aiLineOf(L.fast as RacingLine, y, onRoad, STEP, undefined, clear, margin);
    const lap = writeAiFile(fast.points, fast.along, fast.extra, true);
    await files.write(`${out}/${l}/ai/fast_lane.ai`, lap);
    await files.write(`${out}/${l}/data/ideal_line.ai`, lap);
    written += 2;
    let said = `  ${l}: its AI lines from its racing lines (${fast.along.length} points`;
    if (L.pit?.curve?.length) {
      const pit = aiLineOf(L.pit, y, onRoad, STEP, { fast: L.fast as RacingLine }, clear, margin);
      if (pitRunsBackwards(fast, pit)) {
        // (none: its AI karts don't pit, and a driver's pit lane is the track's own; any pit_lane.ai a build before
        // left is taken away)
        if (await files.exists(`${out}/${l}/ai/pit_lane.ai`)) await files.remove?.(`${out}/${l}/ai/pit_lane.ai`);
        said += ', no pit lane (it rejoins the track behind where it leaves it, which AC takes for the whole lap)';
      } else {
        await files.write(`${out}/${l}/ai/pit_lane.ai`, writeAiFile(pit.points, pit.along, pit.extra, false));
        written++;
        said += `, its pit lane ${pit.along.length}`;
      }
    }
    log(`${said})`);
  }
  return written;
}

export async function buildAc(files: HostFiles, opts: AcBuildOptions): Promise<AcBuilt> {
  const t0 = performance.now();
  const log = opts.log ?? (() => {});
  const project = opts.project.replace(/[\\/]+$/, '');
  const read = async (p: string) => JSON.parse(new TextDecoder().decode(await files.read(p)));
  const track = (await read(`${project}/tools/reference/track.json`)) as {
    name?: string;
    models?: string;
    layouts?: Record<string, { models?: string[]; from?: string }>;
  };
  const folder = opts.folder ?? acFolder(track.name ?? project.split(/[\\/]/).pop() ?? 'track');
  const out = opts.out ?? `${project}/build/ac/content/tracks/${folder}`;
  const models = `${project}/${track.models || 'source/models'}`;
  const acMade = `${project}/track/ac`;
  const libFile = `${project}/source/materials.json`;
  const library = (await libraryOf(files, project)) as MaterialLibrary;
  if (!library) throw new Error('the track has no material library (source/materials.json)');
  const textures = ((await read(libFile)) as { textures?: Record<string, TextureAc> }).textures ?? {};
  const placesFile = `${models}/places.json`;
  const placesDoc =
    opts.places !== undefined
      ? opts.places
      : (await files.exists(placesFile))
        ? ((await read(placesFile)) as PlacesDoc)
        : null;
  const placed = placesDoc?.layouts ?? {};
  const stems = (await files.list(models))
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.slice(0, -4))
    .sort(byCodePoint);
  // (what each model was made of last time: its model, the library, its places, its textures, by their SHA-1)
  const stateFile = `${project}/build/ac/models.editor.json`;
  const state: Record<string, string> =
    !opts.everything && (await files.exists(stateFile)) ? ((await read(stateFile)) as Record<string, string>) : {};
  const libBytes = await files.read(libFile);
  const src: CatalogueSource = {
    read: (f) => files.read(f),
    exists: (f) => files.exists(f),
    editorModels: editorModelsOf(project, opts.editorModels),
    library,
    textures: `${project}/source/textures`,
  };
  const cat = Object.keys(placed).length ? await catalogue(src) : {};
  const partsOf = new Map<string, Promise<TemplatePart[]>>();
  const parts = (model: string) => {
    let p = partsOf.get(model);
    if (!p) {
      const meta = cat[model];
      if (!meta) throw new Error(`a physics object of a model the catalogue has not: ${model}`);
      p = loadTemplate(src, meta);
      partsOf.set(model, p);
    }
    return p;
  };
  let all: Promise<Kn5[]> | null = null;
  const sources: MaterialSources = {
    models: () => {
      all ??= Promise.all(stems.map((s) => loadKn5(files, `${models}/${s}.glb`, library)));
      return all;
    },
    library: async (name) => {
      const x = library.get(name);
      if (!x) return null;
      const material = libraryMaterial(name, x);
      const textures: Kn5['textures'] = [];
      for (const slot of material.textures) {
        // (its picture as the track keeps it: X.png for X.dds, else as named)
        const dir = `${project}/source/textures`;
        const png = `${dir}/${slot.name.replace(/\.dds$/i, '.png')}`;
        const p = (await files.exists(png)) ? png : `${dir}/${slot.name}`;
        if (await files.exists(p)) textures.push({ name: slot.name, active: 1, data: await files.read(p) });
      }
      return { material, textures };
    },
  };
  const ddsOf = opts.dds ?? ((name: string, data: Uint8Array, t: Record<string, TextureAc>) => acDds(name, data, t));
  const cache = `${project}/build/cache/dds`;
  const made: string[] = [];
  // (the boards' cards: one sheet of every board's text, drawn once where any layout has a board)
  const boardsPlaced = Object.values(placed).flatMap((L) => L.objects.filter((o) => cat[o.model]?.kind === 'boards'));
  let cards: { sheet: CardSheet; png: Uint8Array } | undefined;
  if (boardsPlaced.length) {
    const sheet = cardSheet(boardsPlaced.map((o) => boardText(o.name, o.text)));
    cards = { sheet, png: await (opts.cards ?? canvasCards)(sheet) };
    log(`  the boards' cards: ${sheet.texts.map((t) => JSON.stringify(t)).join(', ') || 'blank'}`);
  }
  // (every model as it goes into the game: read, its layout's places in it)
  const loaded = new Map<string, Kn5>();
  for (const stem of stems) {
    const k = await loadKn5(files, `${models}/${stem}.glb`, library);
    if (placed[stem]) await addPlaces(k, placed[stem], cat, parts, sources, cards);
    loaded.set(stem, k);
  }
  // (each model's pictures once: a twin under another name one. Each keeps its own: AC finds none in another model)
  let twins = 0;
  for (const k of loaded.values()) twins += dedupeTextures(k).renamed;
  if (twins) log(`  pictures: ${twins} material slots named after a twin picture of their model`);
  // (the rubber's pages: DDS of their own alpha (DXT5), their mips made, not PNG the game draws as they are)
  const acTextures: Record<string, TextureAc> = { ...textures };
  for (const k of loaded.values())
    for (const tex of k.textures) {
      if (!isRubberPage(tex.name) || !tex.name.toLowerCase().endsWith('.png')) continue;
      const dds = `${tex.name.slice(0, -4)}.dds`;
      for (const m of k.materials) for (const slot of m.textures) if (slot.name === tex.name) slot.name = dds;
      acTextures[tex.name] = { ac: 'DXT5' };
      tex.name = dds;
    }
  for (const stem of stems) {
    const glb = `${models}/${stem}.glb`;
    const kn5File = `${out}/${stem}.kn5`;
    const k = loaded.get(stem) as Kn5;
    // (made again when its model, the library, its places, its pictures (held, or named) or the pool changed)
    const sig = await sha1([
      await files.read(glb),
      libBytes,
      new TextEncoder().encode(JSON.stringify(placed[stem] ?? null)),
      new TextEncoder().encode(
        JSON.stringify({ pool: POOL, slots: k.materials.map((m) => m.textures.map((s) => s.name)) }),
      ),
      ...k.textures.flatMap((t) => [new TextEncoder().encode(t.name), t.data]),
    ]);
    if (state[stem] === sig && (await files.exists(kn5File))) continue;
    const t = performance.now();
    for (const tex of k.textures) {
      // (kept as PNG: AC's DDS made here, the last of an unchanged texture kept, as the track's build keeps it)
      const png = tex.data[0] === 0x89 && tex.data[1] === 0x50 && tex.name.toLowerCase().endsWith('.dds');
      if (!png) continue;
      const base = tex.name.split(/[\\/]/).pop() as string;
      const e = acTextures[`${base.slice(0, -4)}.png`] ?? {};
      const fmt = e.ac ?? 'DXT1';
      const key = await sha1([tex.data, new TextEncoder().encode(fmt), new Uint8Array([e.normal ? 1 : 0])]);
      const kept = `${cache}/${key}.dds`;
      if (await files.exists(kept)) tex.data = await files.read(kept);
      else {
        tex.data = await ddsOf(tex.name, tex.data, acTextures);
        await files.write(kept, tex.data);
      }
    }
    await files.write(kn5File, dump(k));
    state[stem] = sig;
    made.push(stem);
    log(`  ${`${stem}.kn5`.padEnd(32)} ${((performance.now() - t) / 1000).toFixed(1)} s`);
  }
  for (const s of Object.keys(state)) if (!stems.includes(s)) delete state[s];
  // (the kn5s and the Custom Shaders Patch config are this build's own; the layouts' model lists and AI lines as the
  // steps made them (track/ac); the rest is source/track as it is)
  let copied = 0;
  const trackDir = `${project}/source/track`;
  // (each layout's model list the track file's (TRACK_FORMAT's step 6), written here: track/ac's own lists not taken)
  const lists = Object.fromEntries(
    Object.entries(track.layouts ?? {}).map(([lay, v]): [string, string[]] => [lay, [...(v.models ?? [])]]),
  );
  const listed = new Set(Object.keys(lists).map((lay) => `models_${lay}.ini`));
  const over = ((await files.exists(acMade)) ? await filesUnder(files, acMade) : []).filter(
    (rel) => !listed.size || !(rel.split('/').pop() as string).startsWith('models_'),
  );
  const own = new Set([...over, ...listed, AC_LIGHTS]);
  const given = (await files.exists(trackDir)) ? await filesUnder(files, trackDir) : [];
  const put = async (from: string, rel: string) => {
    const a = await files.read(`${from}/${rel}`);
    const b = `${out}/${rel}`;
    if ((await files.exists(b)) && same(a, await files.read(b))) return;
    await files.write(b, a);
    copied++;
  };
  // (a layout's own files: <layout>/... and ui/<layout>/...; a layout the track file no longer has left out, one it
  // has but source/track not given the files of the one it was made from, its name its own)
  const layoutOf = (rel: string) => {
    const p = rel.split('/');
    return p[0] === 'ui' && p.length > 2 ? (p[1] as string) : p.length > 1 ? (p[0] as string) : null;
  };
  const folders = new Set(given.flatMap((rel) => (/^ui\/[^/]+\/ui_track\.json$/.test(rel) ? [rel.split('/')[1]] : [])));
  const gone = (rel: string) => {
    const l = layoutOf(rel);
    return !!l && folders.has(l) && Object.keys(lists).length > 0 && !(l in lists);
  };
  for (const rel of given) if (!own.has(rel) && !gone(rel)) await put(trackDir, rel);
  for (const rel of over) if (!gone(rel)) await put(acMade, rel);
  for (const [lay, v] of Object.entries(track.layouts ?? {})) {
    const from = v.from;
    if (!from || folders.has(lay) || from === lay) continue;
    const as = (rel: string) =>
      rel.startsWith(`ui/${from}/`)
        ? `ui/${lay}/${rel.slice(from.length + 4)}`
        : `${lay}/${rel.slice(from.length + 1)}`;
    for (const [dir, rels] of [
      [trackDir, given],
      [acMade, over],
    ] as const)
      for (const rel of rels) {
        if (layoutOf(rel) !== from || (own.has(rel) && dir === trackDir)) continue;
        let bytes = await files.read(`${dir}/${rel}`);
        // (its name in the game: its own)
        if (rel === `ui/${from}/ui_track.json`) {
          const ui = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
          ui.name = lay;
          bytes = new TextEncoder().encode(JSON.stringify(ui, null, 2));
        }
        const b = `${out}/${as(rel)}`;
        if ((await files.exists(b)) && same(bytes, await files.read(b))) continue;
        await files.write(b, bytes);
        copied++;
      }
    log(`  ${lay}: its AC files made as ${from}'s`);
  }
  if (opts.aiFromLines) copied += await aiFromLines(files, project, models, library, out, Object.keys(lists), log);
  for (const [lay, names] of Object.entries(lists)) {
    const missing = names.filter((m) => !stems.includes(m));
    if (missing.length)
      throw new Error(`${lay} lists ${missing.join(', ')}, which ${track.models || 'source/models'} does not have`);
    const text = new TextEncoder().encode(acModels(names));
    const at = `${out}/models_${lay}.ini`;
    if ((await files.exists(at)) && same(text, await files.read(at))) continue;
    await files.write(at, text);
    copied++;
  }
  const ini = new TextEncoder().encode(
    await acLightsText(
      files,
      project,
      models,
      library,
      await lightsData(files, project, models, placesDoc),
      scriptsOf(src.editorModels),
    ),
  );
  if (!((await files.exists(`${out}/${AC_LIGHTS}`)) && same(ini, await files.read(`${out}/${AC_LIGHTS}`)))) {
    await files.write(`${out}/${AC_LIGHTS}`, ini);
    copied++;
  }
  // (and what source/track has no more taken out, but the kn5s of the models and the build's own: sync's keep)
  if (files.remove) {
    const keep = new Set([...given, ...own, ...stems.map((s) => `${s}.kn5`)]);
    for (const rel of await filesUnder(files, out))
      if (!keep.has(rel)) {
        await files.remove(`${out}/${rel}`);
        copied++;
      }
  }
  for (const [layout, here] of Object.entries(placed)) await setPitboxes(files, out, layout, raceKarts(here));
  await files.write(stateFile, new TextEncoder().encode(JSON.stringify(state, null, 1)));
  const ms = Math.round(performance.now() - t0);
  log(
    `AC: ${made.length} of ${stems.length} models made, ${copied} track files updated, in ${(ms / 1000).toFixed(1)} s: ${out}`,
  );
  return { out, models: stems.length, made, copied, ms };
}
