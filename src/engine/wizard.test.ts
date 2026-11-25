// @vitest-environment node
// The new-track wizard (wizard.ts, providers.ts): its providers (with tiles and answers made here, no network), its keys, its plans, its jobs.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { crc32, deflate } from "./bin";
import { convert, type Picture, readPng } from "./dds";
import type { HostFiles } from "./placehost";
import {
	buildings,
	gridPoints,
	heights,
	Keys,
	keyFor,
	LOGO,
	metresAPixel,
	Place,
	PROVIDERS,
	picture,
	provider,
	providersForPage,
	quiet,
	search,
	TILE,
	tileJpeg,
	tilesOver,
	type WizardHost,
	worldPx,
	zoomFor,
} from "./providers";
import { estimate, planOf, slug, Wizard } from "./wizard";

const files: HostFiles = {
	read: async (p) => new Uint8Array(readFileSync(p)),
	list: async (d) => readdirSync(d),
	size: async (p) => statSync(p).size,
	exists: async (p) => existsSync(p),
	write: async (p, b) => {
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, b);
	},
	remove: async (p) => rmSync(p, { force: true }),
};

const tmps: string[] = [];
const tmp = () => {
	const d = mkdtempSync(join(tmpdir(), "wizard-test-")).replace(/\\/g, "/");
	tmps.push(d);
	return d;
};
afterAll(() => {
	for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

/** An 8-bit RGB PNG (filter 0 each row). */
async function pngRgb(im: Picture): Promise<Uint8Array> {
	const { width: w, height: h } = im;
	const rgb = convert(im, "RGB").data;
	const raw = new Uint8Array(h * (1 + w * 3));
	for (let r = 0; r < h; r++) raw.set(rgb.subarray(r * w * 3, (r + 1) * w * 3), r * (1 + w * 3) + 1);
	const chunk = (type: string, data: Uint8Array) => {
		const td = new Uint8Array(4 + data.length);
		td.set(new TextEncoder().encode(type));
		td.set(data, 4);
		const out = new Uint8Array(12 + data.length);
		const dv = new DataView(out.buffer);
		dv.setUint32(0, data.length);
		out.set(td, 4);
		dv.setUint32(8 + data.length, crc32(td));
		return out;
	};
	const head = new Uint8Array(13);
	new DataView(head.buffer).setUint32(0, w);
	new DataView(head.buffer).setUint32(4, h);
	head.set([8, 2, 0, 0, 0], 8);
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", head),
		chunk("IDAT", await deflate(raw, "deflate")),
		chunk("IEND", new Uint8Array()),
	];
	return new Uint8Array(Buffer.concat(parts));
}

const solid = (w: number, h: number, [r, g, b]: [number, number, number]): Picture => {
	const data = new Uint8Array(w * h * 3);
	for (let i = 0; i < w * h; i++) data.set([r, g, b], i * 3);
	return { width: w, height: h, mode: "RGB", data };
};

/** A provider's tile made here. */
function tile(url: string, uniform: boolean): Picture {
	const m = /\/(\d+)\/(\d+)\/(\d+)(?:\.png)?$/.exec(url);
	if (!m) throw new Error(`not here: ${url}`);
	const [a, b] = [Number(m[2]), Number(m[3])];
	const [tx, ty] = url.includes("arcgisonline") ? [b, a] : [a, b];
	const data = new Uint8Array(256 * 256 * 3);
	for (let row = 0; row < 256; row++)
		for (let col = 0; col < 256; col++) {
			const px = url.includes("terrarium")
				? [128, (Math.floor(col / 4) + ty) % 256, (row * 7) % 256]
				: uniform
					? [90, 120, 60]
					: [(col + tx * 16) % 256, (row * 2 + ty) % 256, (col ^ row) & 255];
			data.set(px, (row * 256 + col) * 3);
		}
	return { width: 256, height: 256, mode: "RGB", data };
}

const BUILDING = {
	elements: [
		{
			type: "way",
			id: 1,
			tags: { building: "yes" },
			geometry: [
				{ lat: -29.8223, lon: -51.3242 },
				{ lat: -29.8221, lon: -51.3242 },
				{ lat: -29.8221, lon: -51.3239 },
				{ lat: -29.8223, lon: -51.3239 },
				{ lat: -29.8223, lon: -51.3242 },
			],
		},
	],
};

/** The providers' answers, made here; each request kept. Pictures "made JPEG" here are PNGs (no JPEG in Node). */
function fakeHost(uniform = false, height?: number): WizardHost & { asked: string[] } {
	const asked: string[] = [];
	const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
	return {
		asked,
		fetch: async (url) => {
			asked.push(url);
			if (url.includes("interpreter")) return enc(BUILDING);
			if (url.includes("nominatim"))
				return enc([
					{
						display_name: "Velopark, Nova Santa Rita",
						lat: "-29.82",
						lon: "-51.32",
						boundingbox: ["-29.83", "-29.81", "-51.33", "-51.31"],
					},
				]);
			if (url.includes("staticmap")) return pngRgb(solid(2 * TILE, 2 * (TILE + LOGO), [10, 20, 30]));
			if (url.includes("elevation/json")) {
				const locs = (new URL(url).searchParams.get("locations") ?? "").split("|");
				return enc({ status: "OK", results: locs.map(() => ({ elevation: height ?? 123.5, resolution: 9.5 })) });
			}
			if (height !== undefined && url.includes("terrarium")) {
				const v = height + 32768;
				const r = Math.floor(v / 256);
				const g = Math.floor(v - r * 256);
				return pngRgb(solid(256, 256, [r, g, Math.round((v - r * 256 - g) * 256)]));
			}
			return pngRgb(tile(url, uniform));
		},
		decodeRgb: async (b) => convert(await readPng(b), "RGB"),
		encodeJpeg: (im) => pngRgb(im),
	};
}

const PLACE = new Place(-29.8224, -51.3243);
const plan = (over: Record<string, unknown> = {}) => ({
	name: "Test Park",
	lat: PLACE.lat,
	lon: PLACE.lon,
	width: 300,
	depth: 200,
	image: "esri",
	mpp: 2,
	heights: "terrarium",
	step: 20,
	buildings: true,
	span: 150,
	...over,
});

describe("the place and the tiles", () => {
	it("turns x and z to latitude and longitude and back", () => {
		const [lat0, lon0] = PLACE.latlon(100, 0);
		const [lat1] = PLACE.latlon(0, 250);
		// (x runs west: 100 m of x is west of the origin; z north)
		expect(lon0 < PLACE.lon && lat1 > PLACE.lat).toBe(true);
		const [x, z] = PLACE.xz(lat0, lon0);
		expect(Math.abs(x - 100) < 1e-6 && Math.abs(z) < 1e-6).toBe(true);
		const loc = PLACE.location("2026-11-15", "a test");
		expect([loc.geotag, loc.theta, loc.east, loc.north]).toEqual([[PLACE.lat, PLACE.lon], 0, 0, 0]);
	});

	it("finds the tiles and their zoom", () => {
		expect(metresAPixel(0, 0)).toBeCloseTo(156543.03, 1);
		const z = zoomFor(PLACE.lat, 1, 19);
		expect(metresAPixel(PLACE.lat, z) <= 1 && 1 < metresAPixel(PLACE.lat, z - 1)).toBe(true);
		expect(zoomFor(PLACE.lat, 0.01, 15)).toBe(15);
		expect(worldPx(0, 0, 1)).toEqual([256, 256]);
		const tiles = tilesOver(
			PLACE,
			[
				[-100, 100],
				[-100, 100],
			],
			17,
		);
		expect(tiles.length >= 1 && tiles.length <= 4).toBe(true);
	});

	it("shows a URL without its key", () => {
		expect(quiet("https://x.test/a?access_token=SECRET&z=1")).not.toContain("SECRET");
		expect(quiet("https://x.test/a?key=SECRET&z=1")).toContain("z=1");
	});
});

describe("the keys", () => {
	it("keeps them on this computer and forgets one blank", async () => {
		const d = tmp();
		const keys = new Keys(files, `${d}/sub/keys.json`);
		expect([await keys.get("google"), [...(await keys.names())]]).toEqual([undefined, []]);
		await keys.set("google", "  abc ");
		expect(await keys.get("google")).toBe("abc");
		await keys.set("google", "");
		expect([...(await keys.names())]).toEqual([]);
		writeFileSync(`${d}/bad.json`, "not json");
		expect([...(await new Keys(files, `${d}/bad.json`).names())]).toEqual([]);
	});

	it("lets the page see only whether a key is set", async () => {
		const keys = new Keys(files, `${tmp()}/keys.json`);
		await keys.set("mapbox", "S3CRET-77");
		const page = await providersForPage(keys);
		expect(page.keys.mapbox).toEqual({ label: "Mapbox access token", set: true });
		expect(JSON.stringify(page)).not.toContain("S3CRET-77");
		expect(Object.fromEntries([...page.image, ...page.heights].map((p) => [p.id, p.ready]))).toEqual({
			esri: true,
			mapbox: true,
			google: false,
			terrarium: true,
			"mapbox-dem": true,
			"google-elevation": false,
		});
		await expect(keyFor(PROVIDERS.google as never, keys)).rejects.toThrow("needs a Google Maps API key");
		expect(() => provider("terrarium", "image")).toThrow("no image provider");
	});
});

describe("the providers", () => {
	it("makes a picture of its tiles north up at its metres a pixel", async () => {
		const host = fakeHost(true);
		const [rgb, z] = await picture(
			PROVIDERS.esri as never,
			"",
			PLACE,
			[
				[-50, 50],
				[-25, 25],
			],
			2,
			host,
		);
		expect([rgb.width, rgb.height]).toEqual([50, 25]);
		expect([...rgb.data.subarray((10 * 50 + 10) * 3, (10 * 50 + 10) * 3 + 3)]).toEqual([90, 120, 60]);
		expect(host.asked.every((u) => u.includes("arcgisonline")) && host.asked[0]?.includes(`/tile/${z}/`)).toBe(true);
	});

	it("cuts Google’s logo off its tiles", async () => {
		const host = fakeHost();
		const im = await readPng(await tileJpeg(PROVIDERS.google as never, "k", 17, 1, 2, host));
		expect([im.width, im.height]).toEqual([TILE, TILE]);
		const q = new URL(host.asked[0] as string).searchParams;
		expect([q.get("size"), q.get("scale"), q.get("key")]).toEqual([`${TILE}x${TILE + 2 * LOGO}`, "2", "k"]);
	});

	it("reads heights from tiles and from Google’s answers", async () => {
		const host = fakeHost(false, 123.5);
		const [x, z] = gridPoints(
			[
				[-40, 40],
				[-40, 40],
			],
			20,
		);
		expect(x).toHaveLength(25);
		let [h, res] = await heights(PROVIDERS.terrarium as never, "", PLACE, x, z, host);
		expect(h.every((v) => Math.abs(v - 123.5) < 0.01) && (res[0] as number) > 0).toBe(true);
		[h, res] = await heights(PROVIDERS["google-elevation"] as never, "k", PLACE, x, z, host);
		expect(h.every((v) => v === 123.5) && res.every((v) => v === 9.5)).toBe(true);
	});

	it("finds buildings and places on OpenStreetMap", async () => {
		const host = fakeHost();
		expect(
			JSON.parse(
				await buildings(
					PLACE,
					[
						[-50, 50],
						[-50, 50],
					],
					host,
				),
			).elements[0].tags,
		).toEqual({
			building: "yes",
		});
		const found = await search("velopark", host);
		expect([found[0]?.name.startsWith("Velopark"), found[0]?.box]).toEqual([true, [-29.83, -29.81, -51.33, -51.31]]);
		expect(await search("  ", host)).toEqual([]);
	});
});

describe("plans", () => {
	it("checks a plan, its folder named after the track", async () => {
		const root = tmp();
		const p = await planOf(plan(), root, files);
		expect(p.folder).toBe(`${root}/test-park`);
		expect((await planOf(plan({ folder: `${root}/there` }), root, files)).folder).toBe(`${root}/there`);
		for (const [bad, says] of [
			[{ name: " " }, "name"],
			[{ lat: 91 }, "latitude"],
			[{ width: 20 }, "width"],
			[{ mpp: "a" }, "metres a pixel"],
			[{ image: "nope" }, "no image provider"],
			[{ span: 900 }, "map picture's span"],
			[{ width: 8000, depth: 8000, mpp: 0.25 }, "pixels"],
			[{ width: 8000, depth: 8000, step: 2, heights: "google-elevation" }, "heights"],
		] as [Record<string, unknown>, string][])
			await expect(planOf(plan(bad), root, files), says).rejects.toThrow(says);
		await expect(planOf([], root, files)).rejects.toThrow("not an object");
		expect([slug("  Ä Track!! 2 "), slug("!!")]).toEqual(["track-2", "new-track"]);
	});

	it("estimates what the providers are asked", async () => {
		const root = tmp();
		const est = await estimate(await planOf(plan(), root, files), files);
		expect(est.image.size).toEqual([150, 100]);
		expect([est.image.requests >= 1, est.heights.points, est.exists]).toEqual([true, 28 * 23, false]);
		const g = await estimate(await planOf(plan({ heights: "google-elevation" }), root, files), files);
		expect(g.heights.requests).toBe(2);
	});
});

describe("the wizard", () => {
	it("runs one job at a time, stops when asked, says why one failed", async () => {
		const root = tmp();
		let release = () => {};
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const w = new Wizard(root, `${root}/tools`, new Keys(files, `${root}/keys.json`), fakeHost(true), files, () => gate);
		const job = await w.start(plan({ buildings: false }));
		await expect(w.start(plan({ name: "Other" }))).rejects.toThrow("being made already");
		w.cancel(job.id);
		release();
		await w.ends.get(job.id);
		expect(w.job(job.id).state).toBe("stopped");
		const bad = await w.start(plan({ name: "Keyed", image: "google" }));
		await w.ends.get(bad.id);
		const page = w.job(bad.id);
		expect(page.state).toBe("failed");
		expect(page.error).toContain("needs a Google Maps API key");
		expect(() => w.job("nope")).toThrow("no job");
		expect((await w.info()).root).toBe(root);
		await expect(w.setKey("other", "x")).rejects.toThrow("no key");
		expect((await w.setKey("google", "g")).keys.google?.set).toBe(true);
		expect((await w.tile("esri", 3, 1, 1))[0]).toBe(0x89);
		await expect(w.tile("esri", 3, 9, 1)).rejects.toThrow("no such tile");
	});
});
