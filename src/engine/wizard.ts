// The new-track wizard, where the engine runs: a track made where the page says, from the providers it picks
// (providers.ts), as a folder the editor opens.
//
// A plan says what to make: the track's name and folder, its origin on the Earth (latitude, longitude), the area round
// it (metres across, x, and deep, z), the picture's provider and metres a pixel, the heights' provider and how far
// apart, whether to take OpenStreetMap's buildings, and how wide the editor's map picture is. Made (a job, in the
// background, one at a time, its progress asked for), the folder has:
//
//     tools/reference/track.json                  the editor's track file, all of its data in it (no roads yet; its
//                                                 tools: the project's the editor has open)
//     tools/reference/elevation/location.json     its place (geotag its origin, theta 0: x west, z north)
//     tools/reference/elevation/heights_*.json    the heights: rows of x, z, latitude, longitude, height, resolution
//     tools/reference/surroundings/picture.jpg    the picture of the area (north up, west on the left), and its .json
//     tools/reference/surroundings/osm_*.json     OpenStreetMap's buildings (if asked for)
//     tools/reference/terrain/                    terrain.json (the track tools' terrain.new()) and its layers
//                                                 (their terrain.write(): terrain.ts's)
//     source/textures/satellite.jpg               the editor's map picture: the middle of the picture, its span square

import { normalPath as normal } from './build';
import type { Picture } from './dds';
import type { HostFiles, PlaceHost } from './placehost';
import {
  type Area,
  buildings,
  GOOGLE_BATCH,
  gridPoints,
  heights,
  KEY_NAMES,
  type Keys,
  keyFor,
  metresAPixel,
  Place,
  PROVIDERS,
  ProviderError,
  picture,
  provider,
  providersForPage,
  search,
  tileJpeg,
  tilesOver,
  type WizardHost,
  zoomFor,
} from './providers';
import { dumpPyJson, PyNumber, pyFloat, readPyJson } from './pyjson';
import { makeTerrain, TERRAIN } from './terrain';
import { pyRound } from './trackfiles';

/** metres the terrain's grid reaches past the picture (terrain.new()'s margin_m) */
const MARGIN = 100;
/** metres, the terrain's grid */
const CELL = 10;
/** metres an area's side may be */
export const AREA: [number, number] = [100, 8000];
/** metres a pixel the picture may be */
export const MPP: [number, number] = [0.25, 10];
/** metres apart the heights may be */
export const STEP: [number, number] = [2, 200];
const MAX_PIXELS = 160_000_000;
const MAX_POINTS = 2_000_000;
const MAX_GOOGLE_POINTS = 200_000;
/** lines of a job's log kept */
const LOG = 200;
/** the terrain's filters for a new track (the track tools' terrain.FILTERS) */
const FILTERS = {
  picture_trees: { lum: 75, sd: 12 },
  photo_trees: { lum: 84, sd: 13 },
  tree_near_m: 7,
  tree_share: 0.3,
  over_m: 1.5,
  opening_m: 55,
  wide_over_m: 4,
  wide_opening_m: 250,
  fills_m: [20, 40, 80, 160, 320],
  enough_a_cell: 0.16,
  areas: [],
};

/** A plan that cannot be made: why. */
export class WizardError extends Error {}

/** A float as Python writes it (4.0, not 4). */
const F = (x: number) => new PyNumber(x, pyFloat(x));
/** a value's floats as Python's (every number of it a float) */
const floats = (v: unknown): unknown =>
  typeof v === 'number'
    ? F(v)
    : Array.isArray(v)
      ? v.map(floats)
      : v && typeof v === 'object' && !(v instanceof PyNumber)
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, floats(x)]))
        : v;

export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'new-track';
}

/** Python's '%g' of a number. */
function g(x: number): string {
  if (x === 0) return '0';
  const [m, e] = x.toExponential(5).split('e') as [string, string];
  const exp = Number(e);
  const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (exp < -4 || exp >= 6) return `${trim(m)}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  return trim(x.toFixed(5 - exp));
}

function num(v: unknown, what: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WizardError(`${what}: not a number`);
  if (!(lo <= v && v <= hi)) throw new WizardError(`${what}: ${g(v)} is not within ${g(lo)} to ${g(hi)}`);
  return v;
}

const absolute = (p: string) => /^([A-Za-z]:)?[\\/]/.test(p);

export interface Plan {
  name: string;
  folder: string;
  place: Place;
  width: number;
  depth: number;
  image: string;
  mpp: number;
  heights: string;
  step: number;
  buildings: boolean;
  span: number;
}

const areaOf = (p: Plan): Area => [
  [-p.width / 2, p.width / 2],
  [-p.depth / 2, p.depth / 2],
];

/** The terrain's grid (the picture's area and MARGIN), and a step more. */
const heightsArea = (p: Plan): Area => {
  const m = MARGIN + p.step;
  const [[xa, xb], [za, zb]] = areaOf(p);
  return [
    [xa - m, xb + m],
    [za - m, zb + m],
  ];
};

/** A plan as the page gives it, checked: its folder in root unless a whole path. */
export async function planOf(body: unknown, root: string, files: HostFiles): Promise<Plan> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WizardError('plan: not an object');
  const b = body as Record<string, unknown>;
  const name = String(b.name ?? '').trim();
  if (!name) throw new WizardError('name: the track needs one');
  const given = String(b.folder ?? '').trim();
  const folder = normal(given && absolute(given) ? given : `${root}/${given || slug(name)}`);
  const lat = num(b.lat, 'latitude', -84, 84);
  const lon = num(b.lon, 'longitude', -180, 180);
  const width = num(b.width, 'width', ...AREA);
  const depth = num(b.depth, 'depth', ...AREA);
  const image = String(b.image || 'esri');
  const hp = String(b.heights || 'terrarium');
  provider(image, 'image');
  provider(hp, 'heights');
  const mpp = num(b.mpp ?? 1, 'metres a pixel', ...MPP);
  const step = num(b.step ?? 10, 'metres between heights', ...STEP);
  const span = num(b.span ?? Math.min(width, depth), "the map picture's span", 50, Math.min(width, depth));
  const p: Plan = {
    name,
    folder,
    place: new Place(lat, lon),
    width,
    depth,
    image,
    mpp,
    heights: hp,
    step,
    buildings: b.buildings === undefined ? true : !!b.buildings,
    span,
  };
  const est = await estimate(p, files);
  if (est.image.pixels > MAX_PIXELS)
    throw new WizardError(
      `the picture would be ${est.image.size[0]} by ${est.image.size[1]} pixels: take a coarser one or a smaller area`,
    );
  const limit = hp === 'google-elevation' ? MAX_GOOGLE_POINTS : MAX_POINTS;
  if (est.heights.points > limit)
    throw new WizardError(`${est.heights.points} heights: take them further apart or a smaller area`);
  return p;
}

/** Python's round of a number to n digits (half to even, as its float has it). */
const round = (x: number, n = 0) => pyRound(x, n);

/** What making a plan asks of its providers: the picture's tiles and size, the heights' points and requests. */
export async function estimate(p: Plan, files: HostFiles) {
  const img = PROVIDERS[p.image] as (typeof PROVIDERS)[string];
  const z = zoomFor(p.place.lat, p.mpp, img.top);
  const tiles = tilesOver(p.place, areaOf(p), z).length;
  const size = [round(p.width / p.mpp), round(p.depth / p.mpp)] as [number, number];
  const hp = PROVIDERS[p.heights] as (typeof PROVIDERS)[string];
  const [x] = gridPoints(heightsArea(p), p.step);
  const hts: { points: number; requests: number; apart_m?: number } =
    hp.id === 'google-elevation'
      ? { points: x.length, requests: Math.ceil(x.length / GOOGLE_BATCH) }
      : {
          points: x.length,
          requests: tilesOver(p.place, heightsArea(p), hp.top).length,
          apart_m: round(metresAPixel(p.place.lat, hp.top), 1),
        };
  return {
    image: {
      zoom: z,
      requests: tiles,
      size,
      pixels: size[0] * size[1],
      metres_a_pixel: round(metresAPixel(p.place.lat, z), 3),
    },
    heights: hts,
    folder: p.folder,
    exists: await taken(files, p.folder),
  };
}

async function taken(files: HostFiles, folder: string): Promise<boolean> {
  if (!(await files.exists(folder))) return false;
  try {
    return (await files.list(folder)).length > 0;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- a job: the plan made

export const STEPS = ['place', 'picture', 'heights', 'buildings', 'terrain', 'track'] as const;

/** The command that opens a track made in the editor (the desktop app, on it). */
export const openCommand = (folder: string) => `npm run desktop -- --project "${folder}"`;

export class Job {
  state: 'running' | 'done' | 'failed' | 'stopped' = 'running';
  step: string = 'place';
  done = 0;
  total = 0;
  error = '';
  stop = false;
  log: string[] = [];

  constructor(
    readonly id: string,
    readonly plan: Plan,
    readonly started = Date.now() / 1000,
  ) {}

  say(line: string): void {
    this.log.push(line);
    this.log.splice(0, Math.max(0, this.log.length - LOG));
  }

  progress(done: number, total: number): void {
    this.done = done;
    this.total = total;
  }

  page() {
    return {
      id: this.id,
      state: this.state,
      step: this.step,
      steps: [...STEPS],
      done: this.done,
      total: this.total,
      error: this.error,
      log: [...this.log],
      folder: this.plan.folder,
      seconds: Math.round((Date.now() / 1000 - this.started) * 10) / 10,
      open: openCommand(this.plan.folder),
    };
  }
}

/** A path from root (inside it). */
const rel = (p: string, root: string) => p.slice(root.length + 1);

/** The tools' folder as the track file names it: relative to its project, or whole (on another drive). */
export function toolsFrom(root: string, tools: string): string {
  const a = normal(root).split('/');
  const b = normal(tools).split('/');
  if ((a[0] as string).toLowerCase() !== (b[0] as string).toLowerCase()) return normal(tools);
  let i = 0;
  while (i < a.length && i < b.length && (a[i] as string).toLowerCase() === (b[i] as string).toLowerCase()) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
}

const median = (v: number[]) => {
  const s = [...v].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
};

/** A file of JSON as Python's json writes it, its lines (indented) ended as Python's on Windows ends them. */
const json = (v: unknown, indent?: number) =>
  new TextEncoder().encode(indent === undefined ? dumpPyJson(v) : dumpPyJson(v, indent).split('\n').join('\r\n'));

/** The terrain made: its description (the track tools' terrain.new()) written, then its layers (terrain.write()). */
export type BuildTerrain = (args: TerrainArgs, job: Job) => Promise<void>;

export interface TerrainArgs {
  location: string;
  image: { file: string; area_x_z: Area; metres_a_pixel: number; source: string };
  heights: string[];
  offset_m: number;
  buildings: string[];
  cell_m: number;
  margin_m: number;
  geotag: [number, number];
}

/** terrain.new(): a terrain's description for a new track, no edits yet. */
export function newTerrain(a: TerrainArgs) {
  const [[xa, xb], [za, zb]] = a.image.area_x_z;
  const m = a.margin_m;
  return {
    version: 1,
    place: { location: a.location },
    image: { ...a.image, area_x_z: floats(a.image.area_x_z), metres_a_pixel: F(a.image.metres_a_pixel) },
    photo: null,
    heights: { files: [...a.heights], offset_m: F(a.offset_m) },
    buildings: { files: [...a.buildings], buffer_m: F(10) },
    grid: {
      area_x_z: floats([
        [xa - m, xb + m],
        [za - m, zb + m],
      ]),
      cell_m: F(a.cell_m),
    },
    filters: floats(FILTERS),
    edits: [],
  };
}

/** The terrain made where the engine runs: its description written, then its layers. */
export const terrainHere =
  (host: PlaceHost): BuildTerrain =>
  async (a, job) => {
    const root = job.plan.folder;
    await host.files.write(`${root}/${TERRAIN}/terrain.json`, json(newTerrain(a), 1));
    job.say(`terrain.json written (${TERRAIN}/terrain.json); its layers being made`);
    await makeTerrain(host, root, (line) => job.say(line));
  };

/** A plan made into its folder, step by step (the job says where it is). */
export async function make(
  job: Job,
  tools: string,
  keys: Keys,
  host: WizardHost,
  files: HostFiles,
  build: BuildTerrain,
  today = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const p = job.plan;
  const root = p.folder;
  const ref = `${root}/tools/reference`;
  const elev = `${ref}/elevation`;
  const sur = `${ref}/surroundings`;
  const stopped = () => job.stop;
  const step = (name: string) => {
    if (job.stop) throw new ProviderError('stopped');
    job.step = name;
    job.done = 0;
    job.total = 0;
  };
  const progress = (d: number, t: number) => job.progress(d, t);
  const area = areaOf(p);

  step('place');
  if (await taken(files, root)) throw new WizardError(`${root} is there already, and not empty`);
  await files.write(
    `${elev}/location.json`,
    json(floats(p.place.location(today, "the editor's new-track wizard")) as object, 1),
  );
  job.say(`the track at ${p.place.lat.toFixed(6)}, ${p.place.lon.toFixed(6)}: x runs west, z north`);

  step('picture');
  const ip = provider(p.image, 'image');
  const [rgb, z] = await picture(ip, await keyFor(ip, keys), p.place, area, p.mpp, host, progress, stopped);
  const pic = `${sur}/picture.jpg`;
  await files.write(pic, await host.encodeJpeg(rgb, 0.9));
  const source = `${ip.label}, zoom ${z}, fetched ${today} (${ip.attribution})`;
  await files.write(
    `${sur}/picture.json`,
    json(
      {
        source,
        area_x_z: floats(area),
        metres_a_pixel: F(p.mpp),
        size: [rgb.width, rgb.height],
      },
      1,
    ),
  );
  job.say(`the picture: ${rgb.width} by ${rgb.height} pixels, ${g(p.mpp)} m a pixel, from ${ip.label} (zoom ${z})`);

  step('heights');
  const hp = provider(p.heights, 'heights');
  const [x, zz] = gridPoints(heightsArea(p), p.step);
  const [h, res] = await heights(hp, await keyFor(hp, keys), p.place, x, zz, host, progress, stopped);
  const [[xa, xb], [za, zb]] = heightsArea(p);
  const shape = [new Set(zz).size, new Set(x).size];
  const rows = x.map((xi, i) => {
    const [lat, lon] = p.place.latlon(xi, zz[i] as number);
    return [
      F(round(xi, 3)),
      F(round(zz[i] as number, 3)),
      F(round(lat, 7)),
      F(round(lon, 7)),
      F(round(h[i] as number, 3)),
      F(round(res[i] as number, 2)),
    ];
  });
  const hfile = `${elev}/heights_${hp.id}_${today}.json`;
  await files.write(
    hfile,
    json({
      source: `${hp.label} (${hp.attribution})`,
      fetched: today,
      grid_m: F(p.step),
      area_x_z: floats([
        [xa, xb],
        [za, zb],
      ]),
      shape,
      location: 'location.json',
      columns: ['x', 'z', 'lat', 'lon', 'elevation', 'resolution'],
      rows,
    }),
  );
  const near = h.filter((_, i) => Math.hypot(x[i] as number, zz[i] as number) <= p.step * 1.01);
  const offset = near.length ? median(near) : median(h);
  job.say(
    `${rows.length} heights, ${g(p.step)} m apart, from ${hp.label}: ${Math.min(...h).toFixed(1)} to ` +
      `${Math.max(...h).toFixed(1)} m over the sea; the track's y 0 at ${offset.toFixed(2)} m`,
  );

  const osm: string[] = [];
  step('buildings');
  if (p.buildings) {
    try {
      const got = await buildings(p.place, heightsArea(p), host);
      const f = `${sur}/osm_${today}.json`;
      await files.write(f, json(readPyJson(got)));
      osm.push(rel(f, root));
      const elements = (JSON.parse(got) as { elements?: { type?: string }[] }).elements ?? [];
      job.say(`${elements.filter((e) => e.type === 'way').length} buildings from OpenStreetMap`);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      job.say(`no buildings: ${err.message}`);
    }
  } else job.say('no buildings asked for');

  step('terrain');
  await build(
    {
      location: rel(`${elev}/location.json`, root),
      image: { file: rel(pic, root), area_x_z: area, metres_a_pixel: p.mpp, source },
      heights: [rel(hfile, root)],
      offset_m: round(offset, 3),
      buildings: osm,
      cell_m: CELL,
      margin_m: MARGIN,
      geotag: [p.place.lat, p.place.lon],
    },
    job,
  );

  step('track');
  const w = round(p.span / p.mpp);
  const left = Math.floor((rgb.width - w) / 2);
  const top = Math.floor((rgb.height - w) / 2);
  await files.write(`${root}/source/textures/satellite.jpg`, await host.encodeJpeg(cut(rgb, left, top, w), 0.9));
  await files.write(
    `${ref}/track.json`,
    json(
      {
        name: p.name,
        satellite: 'source/textures/satellite.jpg',
        satellite_span: F(p.span),
        roads: [],
        models: 'source/models',
        context_models: [],
        tools: toolsFrom(root, tools),
        made: `${today}, by the editor's new-track wizard`,
      },
      1,
    ),
  );
  job.say(`the editor's map: ${g(p.span)} m square; open the track with: ${openCommand(root)}`);
}

/** A square of a picture, from (left, top), side w. */
function cut(im: Picture, left: number, top: number, w: number): Picture {
  const data = new Uint8Array(w * w * 3);
  for (let r = 0; r < w; r++)
    for (let c = 0; c < w; c++) {
      const y = top + r;
      const x = left + c;
      if (y < 0 || x < 0 || y >= im.height || x >= im.width) continue;
      const a = (y * im.width + x) * 3;
      data.set(im.data.subarray(a, a + 3), (r * w + c) * 3);
    }
  return { width: w, height: w, mode: 'RGB', data };
}

// ---------------------------------------------------------------- the wizard the engine serves

/** The page's wizard: the providers and the keys, a place found, a tile for its map, a plan estimated and made (one
 * job at a time). */
export class Wizard {
  readonly jobs = new Map<string, Job>();
  /** each job's end, for the tests */
  readonly ends = new Map<string, Promise<void>>();
  private tiles = new Map<string, Promise<Uint8Array>>();

  constructor(
    readonly root: string,
    readonly tools: string,
    readonly keys: Keys,
    readonly host: WizardHost,
    readonly files: HostFiles,
    readonly build: BuildTerrain,
  ) {}

  async info() {
    const running = [...this.jobs.values()].find((j) => j.state === 'running')?.id ?? null;
    return {
      ...(await providersForPage(this.keys)),
      root: this.root,
      tools: this.tools,
      keys_file: this.keys.path,
      running,
      limits: { area: AREA, mpp: MPP, step: STEP },
    };
  }

  async setKey(name: string, value: string | null | undefined) {
    if (!(name in KEY_NAMES)) throw new WizardError(`no key '${name}'`);
    await this.keys.set(name, value);
    return this.info();
  }

  search(text: string) {
    return search(text, this.host);
  }

  async tile(pid: string, z: number, x: number, y: number): Promise<Uint8Array> {
    const p = provider(pid, 'image');
    if (!(z >= 0 && z <= p.top && x >= 0 && x < 2 ** z && y >= 0 && y < 2 ** z)) throw new WizardError('no such tile');
    const k = `${pid}/${z}/${x}/${y}`;
    let got = this.tiles.get(k);
    if (!got) {
      got = (async () => tileJpeg(p, await keyFor(p, this.keys), z, x, y, this.host))();
      if (this.tiles.size > 2000) this.tiles.clear();
      this.tiles.set(k, got);
      got.catch(() => this.tiles.delete(k));
    }
    return got;
  }

  async estimate(body: unknown) {
    return estimate(await planOf(body, this.root, this.files), this.files);
  }

  async start(body: unknown) {
    const p = await planOf(body, this.root, this.files);
    if (await taken(this.files, p.folder)) throw new WizardError(`${p.folder} is there already, and not empty`);
    if ([...this.jobs.values()].some((j) => j.state === 'running'))
      throw new WizardError('a track is being made already');
    const job = new Job(`job${this.jobs.size + 1}`, p);
    this.jobs.set(job.id, job);
    this.ends.set(job.id, this.run(job));
    return job.page();
  }

  private async run(job: Job): Promise<void> {
    try {
      await make(job, this.tools, this.keys, this.host, this.files, this.build);
      job.state = 'done';
      job.say('made');
    } catch (err) {
      job.state = job.stop ? 'stopped' : 'failed';
      job.error = job.stop ? 'stopped' : (err instanceof Error ? err.message : String(err)) || 'Error';
      job.say(`${job.state}: ${job.error}`);
    }
  }

  job(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw new WizardError(`no job '${id}'`);
    return j.page();
  }

  cancel(id: string) {
    const j = this.jobs.get(id);
    if (!j) throw new WizardError(`no job '${id}'`);
    j.stop = true;
    return j.page();
  }
}
