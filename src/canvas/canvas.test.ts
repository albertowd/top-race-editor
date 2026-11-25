import { describe, expect, it, vi } from "vitest";
import { RETRY_MS, TileCache, visibleTiles } from "./tiles";
import { panned, toScreen, toWorld, viewBox, zoomAt } from "./viewport";

const size = { w: 800, h: 600 };

describe("the view", () => {
	const v = { cx: 10, cz: 20, ppm: 4 };

	it("turns the world into the screen and back, x growing to the left", () => {
		expect(toScreen(v, size, 10, 20)).toEqual([400, 300]);
		expect(toScreen(v, size, 11, 20)).toEqual([396, 300]);
		expect(toWorld(v, size, ...toScreen(v, size, 3.5, -7))).toEqual([3.5, -7]);
	});

	it("knows what it shows", () => {
		expect(viewBox(v, size)).toEqual({ xmin: -90, xmax: 110, zmin: -55, zmax: 95 });
		expect(viewBox(v, size, 40).xmin).toBe(-100);
	});

	it("zooms at the cursor, the point under it kept", () => {
		const z = zoomAt(v, size, 100, 100, -200);
		expect(z.ppm).toBeGreaterThan(v.ppm);
		const [x0, z0] = toWorld(v, size, 100, 100);
		const [x1, z1] = toWorld(z, size, 100, 100);
		expect(x1).toBeCloseTo(x0, 9);
		expect(z1).toBeCloseTo(z0, 9);
		expect(zoomAt(v, size, 0, 0, 1e6).ppm).toBe(0.3);
		expect(zoomAt(v, size, 0, 0, -1e6).ppm).toBe(400);
	});

	it("pans as dragged", () => {
		expect(panned(v, 0, 0, 40, -8)).toEqual({ cx: 20, cz: 18, ppm: 4 });
	});
});

describe("satellite tiles", () => {
	const sat = { span: 1000, px: 4096, tile: 512 };

	it("cover the view at the level the zoom wants", () => {
		const near = visibleTiles({ cx: 0, cz: 0, ppm: 4 }, size, sat);
		expect(new Set(near.map((t) => t.level))).toEqual(new Set([0]));
		expect(near.length).toBeGreaterThan(0);
		const far = visibleTiles({ cx: 0, cz: 0, ppm: 0.5 }, size, sat);
		expect(far[0].level).toBe(3);
		expect(far).toHaveLength(1);
		expect(far[0]).toMatchObject({ tx: 0, ty: 0, x: 500, z: 500 });
		expect(visibleTiles({ cx: 5000, cz: 0, ppm: 4 }, size, sat)).toEqual([]);
	});

	it("are kept once asked for, the oldest forgotten", () => {
		const url = vi.fn((l: number, x: number, y: number) => `/t/${l}/${x}/${y}`);
		const cache = new TileCache(url, () => {}, 2);
		const a = cache.get(0, 0, 0);
		expect(cache.get(0, 0, 0)).toBe(a);
		cache.get(0, 1, 0);
		cache.get(0, 2, 0);
		expect(cache.size).toBe(2);
		expect(url).toHaveBeenCalledTimes(3);
		expect(a.src).toContain("/t/0/0/0");
	});

	it("asks again for one not had, and draws the map again a moment later", async () => {
		vi.useFakeTimers();
		try {
			let fail = true;
			const url = vi.fn(() => (fail ? Promise.reject(new Error("busy")) : Promise.resolve("/t/ok")));
			const redraw = vi.fn();
			const cache = new TileCache(url, redraw);
			const a = cache.get(0, 0, 0);
			await vi.runAllTicks();
			await Promise.resolve();
			// (forgotten at once; the map drawn again after RETRY_MS, which asks for it again)
			expect(cache.size).toBe(0);
			expect(redraw).not.toHaveBeenCalled();
			vi.advanceTimersByTime(RETRY_MS);
			expect(redraw).toHaveBeenCalledTimes(1);
			fail = false;
			const b = cache.get(0, 0, 0);
			expect(b).not.toBe(a);
			expect(url).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("a fence picked", () => {
	it("keeps its panels plain, its points and handles marked as a road’s over its line", async () => {
		const { drawObjectsWorld } = await import("./objects");
		const { someObjects } = await import("../test/fixtures");
		// (a context that keeps each fill's and stroke's colour, and what it drew)
		const done: { op: string; style: unknown }[] = [];
		const g = new Proxy({} as Record<string, unknown>, {
			get: (t, k: string) => {
				if (k in t) return t[k];
				if (k === "fill" || k === "fillRect") return () => done.push({ op: "fill", style: t.fillStyle });
				if (k === "stroke") return () => done.push({ op: "stroke", style: t.strokeStyle });
				if (k === "drawImage") return () => done.push({ op: "image", style: null });
				return () => {};
			},
			set: (t, k: string, v) => {
				t[k] = v;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		const o = someObjects();
		const fence = {
			name: "FENCE_0",
			model: "fence_steel",
			collision: "model" as const,
			curve: [
				{ p: [0, 0] as [number, number], in: [0, 0] as [number, number], out: [4, 0] as [number, number] },
				{ p: [20, 0] as [number, number], in: [-4, 0] as [number, number], out: [0, 0] as [number, number] },
			],
		};
		drawObjectsWorld({
			g,
			o: { ...o, objects: [fence] },
			layout: "vp_a",
			picked: { kind: "fences", i: 0, j: 1 },
			b: { xmin: -100, zmin: -100, xmax: 100, zmax: 100 },
			ppm: 10,
		});
		// (no pictures of its panels, none of them blue: the line along it the one blue stroke)
		expect(done.some((d) => d.op === "image")).toBe(false);
		const strokes = done.filter((d) => d.op === "stroke").map((d) => d.style);
		expect(strokes.filter((s) => s === "#4fa3ff")).toHaveLength(1);
		expect(strokes.filter((s) => s === "#c3ccd6").length).toBeGreaterThan(3);
		// (its points white but the one taken, blue; its two handles light blue; each edged black)
		const fills = done.filter((d) => d.op === "fill").map((d) => d.style);
		expect(fills.filter((s) => s === "#ffffff")).toHaveLength(1);
		expect(fills.filter((s) => s === "#4fa3ff")).toHaveLength(1);
		expect(fills.filter((s) => s === "#cfe6ff")).toHaveLength(2);
		expect(strokes.filter((s) => s === "#000")).toHaveLength(4);
	});
});

describe("the objects not in the layout shown", () => {
	it("are drawn, faint, their strokes dotted", async () => {
		const { drawObjectsWorld } = await import("./objects");
		const { someObjects } = await import("../test/fixtures");
		const { RecordingPath } = await import("../test/legacy");
		const was = globalThis.Path2D;
		globalThis.Path2D = RecordingPath as unknown as typeof Path2D;
		try {
			// (a context that keeps the dash patterns and how faint each stroke was drawn)
			const strokes: { dash: number[]; alpha: number }[] = [];
			let dash: number[] = [];
			const kept: { dash: number[]; alpha: number }[] = [];
			const g = new Proxy({ globalAlpha: 1 } as Record<string, unknown>, {
				get: (t, k: string) => {
					if (k in t) return t[k];
					if (k === "setLineDash") return (d: number[]) => (dash = d);
					if (k === "save") return () => kept.push({ dash, alpha: t.globalAlpha as number });
					if (k === "restore")
						return () => {
							const s = kept.pop();
							if (s) [dash, t.globalAlpha] = [s.dash, s.alpha];
						};
					if (k === "stroke") return () => strokes.push({ dash, alpha: t.globalAlpha as number });
					return () => {};
				},
				set: (t, k: string, v) => {
					t[k] = v;
					return true;
				},
			}) as unknown as CanvasRenderingContext2D;
			const o = someObjects();
			// (the tyre wall only in the other layout; what the layout itself draws, without it, apart)
			const wall = { ...(o.objects[0] as (typeof o.objects)[number]), layouts: ["vp_b"] };
			const frame = { g, picked: null, b: { xmin: -100, zmin: -100, xmax: 100, zmax: 100 }, ppm: 10 };
			const draw = (objects: (typeof o.objects)[number][], layout: string) => {
				drawObjectsWorld({ ...frame, o: { ...o, objects }, layout });
				return strokes.splice(0);
			};
			const bare = draw([], "vp_a").length;
			const shown = draw([wall], "vp_b");
			const away = draw([wall], "vp_a");
			// (in its layout: its strokes as they are; not: as many, all faint and dotted)
			expect(shown.length).toBeGreaterThan(bare);
			expect(shown.every((s) => s.alpha === 1)).toBe(true);
			expect(away).toHaveLength(shown.length);
			expect(away.filter((s) => s.alpha === 0.4 && s.dash.length === 2)).toHaveLength(shown.length - bare);
		} finally {
			globalThis.Path2D = was;
		}
	});
});
