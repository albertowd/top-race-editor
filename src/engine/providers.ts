// Where a new track's ground comes from: its picture (satellite imagery), its heights and its buildings, each from a provider the wizard picks, with the keys
// kept on this computer; and the arithmetic of the Earth's tiles and of a track's place (AC's x and z to latitude and longitude).
//
// A track's place is as its project's tools/reference/elevation/location.json says: east, north = R(theta) (-x, z) + (east, north), metres from its geotag
// (latitude, longitude), on a sphere of radius EARTH. A new track's geotag is its origin, theta 0: x runs west, z north.
//
// Pictures and heights in tiles are the Web Mercator's (z, x, y, 256 pixels a side). Every request names the editor alone as its user agent (no user's
// details), with a timeout (the host's fetch); a provider that needs a key is asked only with one. The pictures are decoded and made JPEG where the engine runs
// (Chromium's), made smaller as Pillow makes them (its LANCZOS).

import { convert, type Picture, resizeLanczos } from "./dds";
import type { HostFiles } from "./placehost";
import { dumpPyJson } from "./pyjson";

/** metres, WGS84's equator radius */
export const EARTH = 6378137;
/** pixels a Web Mercator tile's side */
export const TILE = 256;

export class ProviderError extends Error {}

/** What the wizard asks of where it runs: the network (the editor's user agent, a timeout, a failure that may pass tried again), and pictures decoded and made
 * JPEG. */
export interface WizardHost {
	/** an answer's bytes: url, a POST's body, headers; throws where none came */
	fetch(url: string, data?: Uint8Array | null, headers?: Record<string, string>): Promise<Uint8Array>;
	/** a picture (JPEG, PNG) as RGB */
	decodeRgb(bytes: Uint8Array): Promise<Picture>;
	/** a picture as JPEG of quality 0-1 */
	encodeJpeg(rgb: Picture, quality: number): Promise<Uint8Array>;
}

/** A URL as it may be shown: its key out. */
export function quiet(url: string): string {
	const u = new URL(url);
	for (const k of u.searchParams.keys()) if (["key", "access_token", "token", "apikey"].includes(k.toLowerCase())) u.searchParams.set(k, "…");
	return u.toString().replaceAll("%E2%80%A6", "…");
}

// ---------------------------------------------------------------- the keys, kept on this computer

/** The providers' keys, by the provider's key name: read from the file each time, written whole; never given back to the page (only whether each is set). */
export class Keys {
	constructor(
		private readonly files: HostFiles,
		readonly path: string,
	) {}

	private async read(): Promise<Record<string, string>> {
		try {
			const d = JSON.parse(new TextDecoder().decode(await this.files.read(this.path)));
			if (!d || typeof d !== "object" || Array.isArray(d)) return {};
			return Object.fromEntries(Object.entries(d).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]));
		} catch {
			return {};
		}
	}

	async get(name: string): Promise<string | undefined> {
		return (await this.read())[name];
	}

	async names(): Promise<Set<string>> {
		return new Set(Object.keys(await this.read()));
	}

	/** A key kept (or, none or blank, forgotten). */
	async set(name: string, value: string | null | undefined): Promise<void> {
		const keys = await this.read();
		if (value?.trim()) keys[name] = value.trim();
		else delete keys[name];
		await this.files.write(this.path, new TextEncoder().encode(dumpPyJson(keys, 1)));
	}
}

// ---------------------------------------------------------------- a track's place, and the Earth's tiles

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** A track's origin on the Earth (latitude, longitude, degrees); x runs west, z north, in metres from it. */
export class Place {
	constructor(
		readonly lat: number,
		readonly lon: number,
	) {}

	latlon(x: number, z: number): [number, number] {
		return [this.lat + deg(z / EARTH), this.lon + deg(-x / (EARTH * Math.cos(rad(this.lat))))];
	}

	xz(lat: number, lon: number): [number, number] {
		return [-rad(lon - this.lon) * EARTH * Math.cos(rad(this.lat)), rad(lat - this.lat) * EARTH];
	}

	/** Its location.json, as the track's tools read it. */
	location(made: string, source: string) {
		return {
			about:
				"AC's (x, z) to the Earth: east, north = R(theta) (-x, z) + (east, north), in metres from geotag; lat, lon " +
				"from them on a sphere of radius 6378137 m",
			made,
			source,
			geotag: [this.lat, this.lon],
			theta: 0,
			theta_degrees: 0,
			east: 0,
			north: 0,
			origin_latlon: [this.lat, this.lon],
		};
	}
}

/** Web Mercator pixels (of the whole world at zoom) of a latitude and longitude. */
export function worldPx(lat: number, lon: number, zoom: number): [number, number] {
	const n = TILE * 2 ** zoom;
	const l = Math.min(Math.max(lat, -85.05112878), 85.05112878);
	const s = Math.sin(rad(l));
	return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

/** How many metres of the ground a pixel of a tile at zoom covers, at a latitude. */
export const metresAPixel = (lat: number, zoom: number) => (2 * Math.PI * EARTH * Math.cos(rad(lat))) / (TILE * 2 ** zoom);

/** The least zoom (at most top) whose pixels are as fine as mpp metres. */
export function zoomFor(lat: number, mpp: number, top: number): number {
	for (let z = 0; z <= top; z++) if (metresAPixel(lat, z) <= mpp * 1.001) return z;
	return top;
}

export type Area = [[number, number], [number, number]];

/** The tiles (x, y) at zoom an area (AC's x and z) lies on. */
export function tilesOver(place: Place, area: Area, zoom: number): [number, number][] {
	const [[xa, xb], [za, zb]] = area;
	const px: number[] = [];
	const py: number[] = [];
	for (const [x, z] of [
		[xa, za],
		[xb, za],
		[xa, zb],
		[xb, zb],
	] as [number, number][]) {
		const [lat, lon] = place.latlon(x, z);
		const [a, b] = worldPx(lat, lon, zoom);
		px.push(a);
		py.push(b);
	}
	const out: [number, number][] = [];
	for (let ty = Math.floor(Math.min(...py) / TILE); ty <= Math.floor(Math.max(...py) / TILE); ty++)
		for (let tx = Math.floor(Math.min(...px) / TILE); tx <= Math.floor(Math.max(...px) / TILE); tx++) out.push([tx, ty]);
	return out;
}

/** A mosaic: rows of cols values, channels a pixel; its first pixel the world pixel (x0, y0). */
export interface Mosaic {
	rows: number;
	cols: number;
	channels: number;
	data: Float64Array | Float32Array | Uint8Array;
	x0: number;
	y0: number;
}

/** A mosaic's values at a world pixel, linearly between its pixels (a pixel's value at its middle; past its edge, the edge's: scipy's map_coordinates, order 1,
 * mode nearest), channel by channel into out. */
export function sampleAt(m: Mosaic, px: number, py: number, out: number[]): void {
	const at = (c: number, n: number): [number, number, number] => {
		const v = Math.min(Math.max(c, 0), n - 1);
		const i = Math.floor(v);
		return [i, Math.min(i + 1, n - 1), v - i];
	};
	const [r0, r1, fr] = at(py - m.y0 - 0.5, m.rows);
	const [c0, c1, fc] = at(px - m.x0 - 0.5, m.cols);
	const ch = m.channels;
	for (let k = 0; k < ch; k++) {
		const v = (r: number, c: number) => m.data[(r * m.cols + c) * ch + k] as number;
		out[k] = (1 - fr) * ((1 - fc) * v(r0, c0) + fc * v(r0, c1)) + fr * ((1 - fc) * v(r1, c0) + fc * v(r1, c1));
	}
}

// ---------------------------------------------------------------- the providers

/** A source of pictures (kind image) or heights (kind heights): its tiles' URL (z, x, y, key), the key it needs (by name), its finest zoom, what it says of
 * itself. */
export interface Provider {
	id: string;
	kind: "image" | "heights";
	label: string;
	about: string;
	attribution: string;
	key: string | null;
	top: number;
	url: string;
	/** heights in tiles: terrarium or terrain-rgb */
	decode?: "terrarium" | "terrain-rgb";
}

/** A provider from its fields: its tiles' URL "" where it has none, and its fields in this order (decode among them, though not given). */
const P = ({ id, kind, label, about, attribution, key, top, url = "", decode }: Omit<Provider, "url"> & { url?: string }): Provider => ({
	id,
	kind,
	label,
	about,
	attribution,
	key,
	top,
	url,
	decode,
});

export const PROVIDERS: Record<string, Provider> = Object.fromEntries(
	[
		P({
			id: "esri",
			kind: "image",
			label: "Esri World Imagery",
			about: "Satellite and aerial pictures; no key needed.",
			attribution: "Esri, Maxar, Earthstar Geographics",
			key: null,
			top: 19,
			url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		}),
		P({
			id: "mapbox",
			kind: "image",
			label: "Mapbox Satellite",
			about: "Satellite pictures; needs a Mapbox access token.",
			attribution: "© Mapbox, © Maxar",
			key: "mapbox",
			top: 19,
			url: "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token={key}",
		}),
		P({
			id: "google",
			kind: "image",
			label: "Google Maps",
			about: "Google's satellite pictures (the Maps Static API); needs a Google Maps API key.",
			attribution: "Imagery © Google",
			key: "google",
			top: 20,
		}),
		P({
			id: "terrarium",
			kind: "heights",
			label: "AWS Terrain Tiles",
			about: "Heights of the ground from SRTM and other surveys, some 5 to 30 m apart; no key needed.",
			attribution: "Mapzen, AWS Open Data",
			key: null,
			top: 15,
			url: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
			decode: "terrarium",
		}),
		P({
			id: "mapbox-dem",
			kind: "heights",
			label: "Mapbox Terrain",
			about: "Heights in Mapbox Terrain-RGB tiles; needs a Mapbox access token.",
			attribution: "© Mapbox",
			key: "mapbox",
			top: 15,
			url: "https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token={key}",
			decode: "terrain-rgb",
		}),
		P({
			id: "google-elevation",
			kind: "heights",
			label: "Google Elevation",
			about: "Google's heights (the Elevation API), as the Velopark's came; needs a Google Maps API key.",
			attribution: "© Google",
			key: "google",
			top: 0,
		}),
	].map((p) => [p.id, p]),
);

export const KEY_NAMES: Record<string, string> = { google: "Google Maps API key", mapbox: "Mapbox access token" };

const pageOf = (p: Provider, keys: Set<string>) => ({
	id: p.id,
	kind: p.kind,
	label: p.label,
	about: p.about,
	attribution: p.attribution,
	key: p.key,
	ready: p.key === null || keys.has(p.key),
	top: p.top,
});

export async function providersForPage(keys: Keys) {
	const have = await keys.names();
	const all = Object.values(PROVIDERS);
	return {
		image: all.filter((p) => p.kind === "image").map((p) => pageOf(p, have)),
		heights: all.filter((p) => p.kind === "heights").map((p) => pageOf(p, have)),
		keys: Object.fromEntries(Object.entries(KEY_NAMES).map(([k, v]) => [k, { label: v, set: have.has(k) }])),
	};
}

const pyRepr = (s: string) => {
	const escaped = s.replaceAll("\\", String.raw`\\`).replaceAll("'", String.raw`\'`);
	return `'${escaped}'`;
};

export function provider(pid: string, kind: Provider["kind"]): Provider {
	const p = PROVIDERS[pid];
	if (p?.kind !== kind) throw new ProviderError(`no ${kind} provider ${pyRepr(pid)}`);
	return p;
}

export async function keyFor(p: Provider, keys: Keys): Promise<string> {
	if (p.key === null) return "";
	const k = await keys.get(p.key);
	if (!k) throw new ProviderError(`${p.label} needs a ${KEY_NAMES[p.key]}: set it first`);
	return k;
}

const GOOGLE_STATIC = "https://maps.googleapis.com/maps/api/staticmap";
const GOOGLE_ELEVATION = "https://maps.googleapis.com/maps/api/elevation/json";
/** pixels at the top and the bottom of a Google picture asked for over a tile (its logo, its notes) */
export const LOGO = 24;
/** points a request (Google takes 512, its URLs up to 16 kB) */
export const GOOGLE_BATCH = 400;

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** A picture cut: its pixels from (left, top), w by h. */
function crop(im: Picture, left: number, top: number, w: number, h: number): Picture {
	const rgb = convert(im, "RGB");
	const data = new Uint8Array(w * h * 3);
	for (let r = 0; r < h; r++) {
		const y = top + r;
		if (y < 0 || y >= rgb.height) continue;
		for (let c = 0; c < w; c++) {
			const x = left + c;
			if (x < 0 || x >= rgb.width) continue;
			const a = (y * rgb.width + x) * 3;
			data.set(rgb.data.subarray(a, a + 3), (r * w + c) * 3);
		}
	}
	return { width: w, height: h, mode: "RGB", data };
}

/** A tile of a picture provider as it gives it (JPEG or PNG). Google's: a picture of the tile's middle, scale 2 (a tile a zoom finer), a strip more at its top
 * and bottom where its logo and notes go, cut off. */
export async function tileBytes(p: Provider, key: string, z: number, x: number, y: number, host: WizardHost) {
	if (p.id === "google") {
		const n = 2 ** z;
		const lon = ((x + 0.5) / n) * 360 - 180;
		const lat = deg(Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))));
		const q = new URLSearchParams({
			center: `${lat.toFixed(7)},${lon.toFixed(7)}`,
			zoom: String(z),
			size: `${TILE}x${TILE + 2 * LOGO}`,
			scale: "2",
			maptype: "satellite",
			format: "jpg",
			key,
		});
		const im = await host.decodeRgb(await host.fetch(`${GOOGLE_STATIC}?${q}`, null, {}));
		const cut = crop(im, 0, 2 * LOGO, 2 * TILE, 2 * TILE);
		return host.encodeJpeg(resizeLanczos(cut, TILE, TILE), 0.92);
	}
	return host.fetch(p.url.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)).replace("{key}", encodeURIComponent(key)), null, {});
}

/** A picture provider's tile as JPEG (for the page's map). */
export async function tileJpeg(p: Provider, key: string, z: number, x: number, y: number, host: WizardHost) {
	const data = await tileBytes(p, key, z, x, y, host);
	if (isJpeg(data)) return data;
	return host.encodeJpeg(convert(await host.decodeRgb(data), "RGB"), 0.9);
}

export type Progress = (done: number, total: number) => void;

/** The tiles at z fetched (a few at once) into one mosaic (RGB, 0-255), its first pixel's world pixel. */
/** A long fetch's progress told, and whether it is to stop. */
export interface Running {
	progress?: Progress;
	stop?: () => boolean;
}

export async function mosaic(
	p: Provider,
	key: string,
	tiles: [number, number][],
	z: number,
	host: WizardHost,
	{ progress = () => {}, stop = () => false, workers = 6 }: Running & { workers?: number } = {},
): Promise<Mosaic> {
	const xs = tiles.map((t) => t[0]);
	const ys = tiles.map((t) => t[1]);
	const x0 = Math.min(...xs);
	const y0 = Math.min(...ys);
	const cols = (Math.max(...xs) - x0 + 1) * TILE;
	const rows = (Math.max(...ys) - y0 + 1) * TILE;
	const out = new Uint8Array(rows * cols * 3);
	let done = 0;
	let next = 0;
	const one = async (t: [number, number]) => {
		if (stop()) return;
		let im = convert(await host.decodeRgb(await tileBytes(p, key, z, t[0], t[1], host)), "RGB");
		if (im.width !== TILE || im.height !== TILE) im = resizeLanczos(im, TILE, TILE);
		const r0 = (t[1] - y0) * TILE;
		const c0 = (t[0] - x0) * TILE;
		for (let r = 0; r < TILE; r++) out.set(im.data.subarray(r * TILE * 3, (r + 1) * TILE * 3), ((r0 + r) * cols + c0) * 3);
		progress(++done, tiles.length);
	};
	await Promise.all(
		Array.from({ length: Math.min(workers, tiles.length) }, async () => {
			while (next < tiles.length) await one(tiles[next++] as [number, number]);
		}),
	);
	if (stop()) throw new ProviderError("stopped");
	return { rows, cols, channels: 3, data: out, x0: x0 * TILE, y0: y0 * TILE };
}

/** numpy's round (half to even) of a value. */
const roundEven = (v: number) => {
	const r = Math.round(v);
	return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** The picture of an area (AC's x and z), mpp metres a pixel, north up and west on the left (its first pixel at x max, z max), from a picture provider's tiles;
 * and the zoom they were fetched at. */
export async function picture(
	p: Provider,
	key: string,
	place: Place,
	area: Area,
	mpp: number,
	host: WizardHost,
	{ progress, stop }: Running = {},
): Promise<[Picture, number]> {
	const z = zoomFor(place.lat, mpp, p.top);
	const m = await mosaic(p, key, tilesOver(place, area, z), z, host, { progress, stop });
	// (sampled as float32, as numpy has the mosaic)
	const f = { ...m, data: Float32Array.from(m.data) };
	const [[xa, xb], [za, zb]] = area;
	const w = roundEven((xb - xa) / mpp);
	const h = roundEven((zb - za) / mpp);
	const data = new Uint8Array(w * h * 3);
	const v = [0, 0, 0];
	for (let r = 0; r < h; r++) {
		const zz = zb - (r + 0.5) * mpp;
		for (let c = 0; c < w; c++) {
			const [lat, lon] = place.latlon(xb - (c + 0.5) * mpp, zz);
			const [px, py] = worldPx(lat, lon, z);
			sampleAt(f, px, py, v);
			for (let k = 0; k < 3; k++) data[(r * w + c) * 3 + k] = Math.min(255, Math.max(0, roundEven(Math.fround(v[k] as number))));
		}
	}
	return [{ width: w, height: h, mode: "RGB", data }, z];
}

/** A height tile's pixels as heights (metres). */
export function decodeHeights(r: number, g: number, b: number, how: Provider["decode"]): number {
	if (how === "terrarium") return r * 256 + g + b / 256 - 32768;
	if (how === "terrain-rgb") return -10000 + (r * 65536 + g * 256 + b) * 0.1;
	throw new ProviderError(`heights of no known coding: ${how}`);
}

/** A grid's points over an area, step metres apart (x and z, row after row along z: np.arange's). */
export function gridPoints(area: Area, step: number): [number[], number[]] {
	const [[xa, xb], [za, zb]] = area;
	const range = (a: number, b: number) => Array.from({ length: Math.max(0, Math.ceil((b + step * 0.01 - a) / step)) }, (_, i) => a + i * step);
	const xs = range(xa, xb);
	const zs = range(za, zb);
	const X: number[] = [];
	const Z: number[] = [];
	for (const z of zs)
		for (const x of xs) {
			X.push(x);
			Z.push(z);
		}
	return [X, Z];
}

/** The ground's heights (metres over the sea) at points (AC's x and z), and how far apart the provider's heights are there (metres). */
export async function heights(
	p: Provider,
	key: string,
	place: Place,
	x: number[],
	z: number[],
	host: WizardHost,
	{ progress = () => {}, stop = () => false }: Running = {},
): Promise<[number[], number[]]> {
	const ll = x.map((xi, i) => place.latlon(xi, z[i] as number));
	if (p.id === "google-elevation") {
		const h = new Array<number>(x.length).fill(0);
		const res = new Array<number>(x.length).fill(0);
		const batches = Math.ceil(x.length / GOOGLE_BATCH);
		for (let k = 0; k < batches; k++) {
			if (stop()) throw new ProviderError("stopped");
			const i = k * GOOGLE_BATCH;
			const locs = ll
				.slice(i, i + GOOGLE_BATCH)
				.map(([a, b]) => `${a.toFixed(7)},${b.toFixed(7)}`)
				.join("|");
			const ans = JSON.parse(new TextDecoder().decode(await host.fetch(`${GOOGLE_ELEVATION}?${new URLSearchParams({ locations: locs, key })}`, null, {}))) as {
				status?: string;
				error_message?: string;
				results: { elevation: number; resolution?: number }[];
			};
			if (ans.status !== "OK") throw new ProviderError(`Google Elevation: ${ans.status} ${ans.error_message ?? ""}`.trim());
			ans.results.forEach((r, j) => {
				h[i + j] = r.elevation;
				res[i + j] = r.resolution ?? 0;
			});
			progress(k + 1, batches);
		}
		return [h, res];
	}
	const zt = p.top;
	const area: Area = [
		[Math.min(...x), Math.max(...x)],
		[Math.min(...z), Math.max(...z)],
	];
	const m = await mosaic(p, key, tilesOver(place, area, zt), zt, host, { progress, stop });
	const H = new Float64Array(m.rows * m.cols);
	for (let i = 0; i < H.length; i++) H[i] = decodeHeights(m.data[i * 3] as number, m.data[i * 3 + 1] as number, m.data[i * 3 + 2] as number, p.decode);
	const hm: Mosaic = { ...m, channels: 1, data: H };
	const v = [0];
	const h = ll.map(([lat, lon]) => {
		const [px, py] = worldPx(lat, lon, zt);
		sampleAt(hm, px, py, v);
		return v[0] as number;
	});
	return [h, new Array<number>(x.length).fill(metresAPixel(place.lat, zt))];
}

// ---------------------------------------------------------------- buildings, and finding a place

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** OpenStreetMap's buildings over an area (Overpass, its ways with their points), as the track's tools read them: the answer's text. */
export async function buildings(place: Place, area: Area, host: WizardHost): Promise<string> {
	const [[xa, xb], [za, zb]] = area;
	const a = place.latlon(xa, za);
	const b = place.latlon(xb, zb);
	const [s, n] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
	const [w, e] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
	const q = `[out:json][timeout:90];(way["building"](${s.toFixed(7)},${w.toFixed(7)},${n.toFixed(7)},${e.toFixed(7)}););out geom;`;
	let last: unknown = null;
	for (const url of OVERPASS) {
		try {
			const t = new TextDecoder().decode(await host.fetch(url, new TextEncoder().encode(new URLSearchParams({ data: q }).toString()), {}));
			JSON.parse(t);
			return t;
		} catch (err) {
			last = err;
		}
	}
	throw new ProviderError(`no Overpass server answered: ${last instanceof Error ? last.message : last}`);
}

/** Places named so (OpenStreetMap's Nominatim): name, latitude, longitude, the box round it. */
export async function search(text: string, host: WizardHost) {
	const t = text.trim();
	if (!t) return [];
	const q = new URLSearchParams({ q: t, format: "jsonv2", limit: "6" });
	const got = JSON.parse(new TextDecoder().decode(await host.fetch(`${NOMINATIM}?${q}`, null, { "Accept-Language": "en" }))) as {
		display_name?: string;
		lat: string;
		lon: string;
		boundingbox?: string[];
	}[];
	return got.map((r) => ({
		name: r.display_name ?? "",
		lat: Number(r.lat),
		lon: Number(r.lon),
		box: r.boundingbox?.length ? r.boundingbox.map(Number) : null,
	}));
}
