// The terrain on the map: its picture of the ground round the track, a layer of heights (lit, coloured, with contours; a change in red and blue), the heights
// as points coloured by why the filters took them out, and the rings of the areas and edits, the one being drawn, the brush.

import type { Size, View } from "../canvas/viewport";
import { toScreen, viewBox } from "../canvas/viewport";
import type { Vec2 } from "../domain/types";
import { gridBox } from "./codec";
import { inRing } from "./rings";
import type { Show, TerrainPick, TerrainState } from "./store";
import { WHY_COLOURS } from "./store";
import type { Grid, TerrainDoc } from "./types";

type Ctx = CanvasRenderingContext2D;
type Box = { xmin: number; zmin: number; xmax: number; zmax: number };

/** the ground's colours, low to high */
const RAMP: readonly [number, [number, number, number]][] = [
	[0, [38, 92, 58]],
	[0.25, [96, 158, 82]],
	[0.5, [214, 200, 112]],
	[0.75, [176, 118, 64]],
	[1, [244, 240, 232]],
];
const UP: [number, number, number] = [229, 72, 77];
const DOWN: [number, number, number] = [59, 130, 246];
/** metres of change shown fully coloured, at least */
const CHANGE_FULL = 0.25;
const SUN: [number, number, number] = (() => {
	// (from the north-west, 45 degrees up: x grows west, z north)
	const alt = Math.PI / 4;
	const h = Math.cos(alt) / Math.SQRT2;
	return [h, Math.sin(alt), h];
})();

export const AREA_COLOURS = { ground: "#3fd0e0", not_ground: "#ff5fb0" } as const;
export const EDIT_COLOURS = { raster: "#ffd166", flat: "#6ea8ff", offset: "#ff9f43", smooth: "#5ee0b5" } as const;

function ramp(t: number): [number, number, number] {
	const c = Math.min(1, Math.max(0, t));
	for (let k = 1; k < RAMP.length; k++) {
		const [b, cb] = RAMP[k];
		if (c <= b) {
			const [a, ca] = RAMP[k - 1];
			const u = (c - a) / (b - a);
			return [ca[0] + (cb[0] - ca[0]) * u, ca[1] + (cb[1] - ca[1]) * u, ca[2] + (cb[2] - ca[2]) * u];
		}
	}
	return RAMP[RAMP.length - 1][1];
}

/** What a layer's picture is made from: its grid, whether it is a change (red up, blue down), the heights' range its colours go over. */
interface LayerOf {
	grid: Grid;
	change: boolean;
	lo: number;
	hi: number;
}

/** The layer shown's grid ('removed': the original less the filtered, made once for each pair). */
export function layerOf(s: Pick<TerrainState, "grids">, show: Show, made: Map<string, Grid>): LayerOf | null {
	const { grids } = s;
	const f = grids.filtered;
	const g = grids.ground;
	const lo = Math.min(f?.lo ?? Number.POSITIVE_INFINITY, g?.lo ?? Number.POSITIVE_INFINITY);
	const hi = Math.max(f?.hi ?? Number.NEGATIVE_INFINITY, g?.hi ?? Number.NEGATIVE_INFINITY);
	const range = (G: Grid) => (Number.isFinite(lo) && Number.isFinite(hi) ? { lo, hi } : { lo: G.lo, hi: G.hi });
	switch (show.layer) {
		case "none":
			return null;
		case "change":
			return grids.change ? { grid: grids.change, change: true, lo: 0, hi: 0 } : null;
		case "removed": {
			const o = grids.original;
			if (!o || !f || o.v.length !== f.v.length) return null;
			let G = made.get("removed");
			if (!G || made.get("removed-of-o") !== o || made.get("removed-of-f") !== f) {
				const v = new Float32Array(o.v.length);
				let a = 0;
				let b = 0;
				for (let i = 0; i < v.length; i++) {
					v[i] = o.v[i] - f.v[i];
					a = Math.min(a, v[i]);
					b = Math.max(b, v[i]);
				}
				G = { ...o, v, lo: a, hi: b };
				made.set("removed", G);
				made.set("removed-of-o", o);
				made.set("removed-of-f", f);
			}
			return { grid: G, change: true, lo: 0, hi: 0 };
		}
		default: {
			const G = grids[show.layer];
			return G ? { grid: G, change: false, ...range(G) } : null;
		}
	}
}

/** A layer's picture: one pixel a point of its grid, north up and west on the left; made again where painted. */
class LayerImage {
	canvas: HTMLCanvasElement | null = null;
	private ctx: Ctx | null = null;
	private data: ImageData | null = null;
	key = "";

	constructor(
		readonly L: LayerOf,
		readonly show: Show,
	) {
		const { nx, nz } = L.grid;
		if (typeof document === "undefined") return;
		const c = document.createElement("canvas");
		c.width = nx;
		c.height = nz;
		const ctx = c.getContext("2d");
		if (!ctx) return;
		this.canvas = c;
		this.ctx = ctx;
		this.data = ctx.createImageData(nx, nz);
		this.paint(0, nx - 1, 0, nz - 1);
	}

	/** The points from (i0, j0) to (i1, j1) (of the grid) painted again. */
	paint(i0: number, i1: number, j0: number, j1: number) {
		const { data, ctx } = this;
		if (!data || !ctx) return;
		const { grid: G, change, lo, hi } = this.L;
		const { nx, nz, v, cell } = G;
		const { relief, colour, contours, exaggerate } = this.show;
		const px = data.data;
		const at = (i: number, j: number) => v[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
		const m = Math.max(CHANGE_FULL, Math.abs(G.lo), Math.abs(G.hi));
		const span = Math.max(hi - lo, 1e-6);
		for (let j = j0; j <= j1; j++)
			for (let i = i0; i <= i1; i++) {
				const y = v[j * nx + i];
				const o = ((nz - 1 - j) * nx + (nx - 1 - i)) * 4;
				let r: number;
				let g: number;
				let b: number;
				let a = 255;
				if (change) {
					const t = Math.min(1, Math.abs(y) / m);
					[r, g, b] = y >= 0 ? UP : DOWN;
					a = t < 0.02 ? 0 : Math.round(90 + 165 * t);
				} else {
					[r, g, b] = colour ? ramp((y - lo) / span) : [200, 200, 200];
					if (relief) {
						const dx = ((at(i + 1, j) - at(i - 1, j)) / (2 * cell)) * exaggerate;
						const dz = ((at(i, j + 1) - at(i, j - 1)) / (2 * cell)) * exaggerate;
						const n = Math.hypot(dx, 1, dz);
						const lit = Math.max(0, (-dx * SUN[0] + SUN[1] - dz * SUN[2]) / n);
						const k = 0.35 + 0.65 * (lit / SUN[1]);
						r *= k;
						g *= k;
						b *= k;
					}
					if (contours > 0) {
						const band = Math.floor(y / contours);
						if (Math.floor(at(i + 1, j) / contours) !== band || Math.floor(at(i, j + 1) / contours) !== band) {
							r *= 0.45;
							g *= 0.45;
							b *= 0.45;
						}
					}
				}
				px[o] = Math.min(255, r);
				px[o + 1] = Math.min(255, g);
				px[o + 2] = Math.min(255, b);
				px[o + 3] = a;
			}
		// (the pixels: x falls left to right, z top to bottom)
		const x = nx - 1 - i1;
		const yTop = nz - 1 - j1;
		ctx.putImageData(data, 0, 0, x, yTop, i1 - i0 + 1, j1 - j0 + 1);
	}

	/** The world painted (a box) painted again, a cell more each way (the relief looks at its neighbours). */
	repaint(box: Box) {
		const G = this.L.grid;
		const i0 = Math.max(0, Math.floor((box.xmin - G.x0) / G.cell) - 1);
		const i1 = Math.min(G.nx - 1, Math.ceil((box.xmax - G.x0) / G.cell) + 1);
		const j0 = Math.max(0, Math.floor((box.zmin - G.z0) / G.cell) - 1);
		const j1 = Math.min(G.nz - 1, Math.ceil((box.zmax - G.z0) / G.cell) + 1);
		if (i0 <= i1 && j0 <= j1) this.paint(i0, i1, j0, j1);
	}
}

/** What the terrain's drawing keeps between frames: the layer's picture, the wide picture of the ground. */
export class TerrainRenderCache {
	private layer: LayerImage | null = null;
	private made = new Map<string, Grid>();
	private picture: HTMLImageElement | null = null;
	private pictureUrl = "";

	constructor(private readonly onLoad: () => void = () => {}) {}

	image(s: Pick<TerrainState, "grids">, show: Show, touched: Box | null): LayerImage | null {
		const L = layerOf(s, show, this.made);
		if (!L) return null;
		const key = `${show.layer} ${show.relief} ${show.colour} ${show.contours} ${show.exaggerate} ${L.lo} ${L.hi}`;
		if (!this.layer || this.layer.L.grid !== L.grid || this.layer.key !== key) {
			this.layer = new LayerImage(L, show);
			this.layer.key = key;
		} else if (touched) this.layer.repaint(touched);
		return this.layer;
	}

	pictureOf(url: string): HTMLImageElement | null {
		if (typeof Image === "undefined") return null;
		if (url !== this.pictureUrl) {
			this.pictureUrl = url;
			this.picture = new Image();
			this.picture.onload = this.onLoad;
			this.picture.src = url;
		}
		return this.picture?.complete && this.picture.naturalWidth ? this.picture : null;
	}
}

export interface TerrainDraw {
	g: Ctx;
	view: View;
	size: Size;
	s: TerrainState;
	cache: TerrainRenderCache;
	/** the world painted since the last frame */
	touched: Box | null;
	pictureUrl: string;
	/** the terrain is worked on (its rings, the brush, the points shown) */
	focused: boolean;
	mouse: Vec2 | null;
}

/** The picture of the ground round the track and the layer, under the roads (drawn in pixels). */
export function drawTerrainUnder({ g, view, size, s, cache, touched, pictureUrl }: TerrainDraw) {
	const { show, info } = s;
	const scr = (x: number, z: number) => toScreen(view, size, x, z);
	const area = info?.image?.area_x_z;
	if (show.picture && area && info?.image) {
		const im = cache.pictureOf(pictureUrl);
		if (im) {
			const [[, xb], [, zb]] = area;
			const k = (info.image.size?.[0] ?? im.naturalWidth) / im.naturalWidth;
			const m = info.image.metres_a_pixel * k;
			const [sx, sy] = scr(xb, zb);
			g.drawImage(im, sx, sy, im.naturalWidth * m * view.ppm, im.naturalHeight * m * view.ppm);
		}
	}
	const layer = cache.image(s, show, touched);
	if (layer?.canvas) {
		const G = layer.L.grid;
		const b = gridBox(G);
		const [sx, sy] = scr(b.xmax + G.cell / 2, b.zmax + G.cell / 2);
		g.save();
		g.globalAlpha = show.opacity;
		g.imageSmoothingEnabled = true;
		g.drawImage(layer.canvas, sx, sy, G.nx * G.cell * view.ppm, G.nz * G.cell * view.ppm);
		g.restore();
	}
}

/** A ring's path in pixels. */
function ringPath(g: Ctx, ring: readonly Vec2[], scr: (x: number, z: number) => Vec2, closed = true) {
	g.beginPath();
	ring.forEach(([x, z], k) => {
		const [sx, sy] = scr(x, z);
		if (k) g.lineTo(sx, sy);
		else g.moveTo(sx, sy);
	});
	if (closed) g.closePath();
}

const samePick = (a: TerrainPick | null, kind: TerrainPick["kind"], i: number) => a?.kind === kind && a.i === i;

/** The points, the rings, the ring being drawn, the brush: over the rest (drawn in pixels). */
export function drawTerrainOver({ g, view, size, s, focused, mouse }: TerrainDraw) {
	const { doc, show, pick, points } = s;
	if (!doc) return;
	const scr = (x: number, z: number) => toScreen(view, size, x, z);
	if (show.points && points && focused) drawPoints(g, view, size, s);
	if (!focused) return;
	g.save();
	g.lineWidth = 1.5;
	doc.filters.areas.forEach((a, i) => {
		const picked = samePick(pick, "area", i);
		ringPath(g, a.ring, scr);
		g.fillStyle = `${AREA_COLOURS[a.kind]}${picked ? "40" : "22"}`;
		g.fill();
		g.setLineDash(a.kind === "ground" ? [] : [6, 4]);
		g.strokeStyle = AREA_COLOURS[a.kind];
		g.lineWidth = picked ? 2.5 : 1.5;
		g.stroke();
	});
	g.setLineDash([]);
	doc.edits.forEach((e, i) => {
		const picked = samePick(pick, "edit", i);
		g.setLineDash(e.off ? [2, 5] : []);
		g.strokeStyle = EDIT_COLOURS[e.type];
		g.lineWidth = picked ? 2.5 : 1.5;
		if (e.type === "raster") {
			const r = s.rasters[e.file];
			if (!r || !picked) return;
			const b = gridBox(r);
			g.setLineDash([3, 3]);
			ringPath(
				g,
				[
					[b.xmin, b.zmin],
					[b.xmax, b.zmin],
					[b.xmax, b.zmax],
					[b.xmin, b.zmax],
				],
				scr,
			);
			g.stroke();
			g.setLineDash([]);
			return;
		}
		ringPath(g, e.ring, scr);
		if (picked) {
			g.fillStyle = `${EDIT_COLOURS[e.type]}30`;
			g.fill();
		}
		g.stroke();
		if (e.ease_m > 0 && picked) {
			g.save();
			g.globalAlpha = 0.5;
			g.setLineDash([2, 4]);
			g.lineWidth = Math.max(1, 2 * e.ease_m * view.ppm);
			g.globalAlpha = 0.15;
			g.stroke();
			g.restore();
		}
		if (e.type === "flat" && e.at) {
			const [sx, sy] = scr(e.at[0], e.at[1]);
			g.beginPath();
			g.arc(sx, sy, 4, 0, Math.PI * 2);
			g.fillStyle = EDIT_COLOURS.flat;
			g.fill();
		}
	});
	// (the picked ring's points)
	const ring = pick ? pickedRing(doc, pick) : null;
	if (ring) {
		g.fillStyle = "#ffffff";
		g.strokeStyle = "#1d2a3a";
		g.lineWidth = 1;
		for (const [x, z] of ring) {
			const [sx, sy] = scr(x, z);
			g.fillRect(sx - 4, sy - 4, 8, 8);
			g.strokeRect(sx - 4, sy - 4, 8, 8);
		}
	}
	if (s.draft) {
		const pts = mouse ? [...s.draft, mouse] : s.draft;
		ringPath(g, pts, scr, false);
		g.strokeStyle = "#ffffff";
		g.setLineDash([5, 4]);
		g.lineWidth = 1.5;
		g.stroke();
		g.setLineDash([]);
		for (const [x, z] of s.draft) {
			const [sx, sy] = scr(x, z);
			g.fillStyle = "#ffffff";
			g.fillRect(sx - 3, sy - 3, 6, 6);
		}
	}
	if (s.tool === "brush" && mouse) {
		const [sx, sy] = scr(mouse[0], mouse[1]);
		g.beginPath();
		g.arc(sx, sy, Math.max(2, s.brush.radius * view.ppm), 0, Math.PI * 2);
		g.strokeStyle = "#ffffff";
		g.lineWidth = 1.5;
		g.stroke();
		g.beginPath();
		g.arc(sx, sy, Math.max(1, (s.brush.radius * view.ppm) / 2), 0, Math.PI * 2);
		g.setLineDash([3, 3]);
		g.strokeStyle = "rgba(255,255,255,0.6)";
		g.stroke();
		g.setLineDash([]);
	}
	g.restore();
}

export function pickedRing(doc: TerrainDoc, p: TerrainPick): Vec2[] | null {
	if (p.kind === "area") return doc.filters.areas[p.i]?.ring ?? null;
	const e = doc.edits[p.i];
	return e && e.type !== "raster" ? e.ring : null;
}

function drawPoints(g: Ctx, view: View, size: Size, s: TerrainState) {
	const P = s.points;
	if (!P) return;
	const b = viewBox(view, size, 4);
	const d = view.ppm < 0.6 ? 2 : 3;
	const byWhy = new Map<number, number[]>();
	for (let k = 0; k < P.x.length; k++) {
		const x = P.x[k];
		const z = P.z[k];
		if (x < b.xmin || x > b.xmax || z < b.zmin || z > b.zmax || !s.show.why[String(P.why[k])]) continue;
		const list = byWhy.get(P.why[k]);
		if (list) list.push(k);
		else byWhy.set(P.why[k], [k]);
	}
	for (const [why, ks] of byWhy) {
		g.fillStyle = WHY_COLOURS[String(why)] ?? "#ffffff";
		for (const k of ks) {
			const [sx, sy] = toScreen(view, size, P.x[k], P.z[k]);
			g.fillRect(sx - d / 2, sy - d / 2, d, d);
		}
	}
}

/** The area or edit (a ring) at (x, z): the picked first, then the edits from the last, then the areas. */
export function ringAt(doc: TerrainDoc, pick: TerrainPick | null, x: number, z: number): TerrainPick | null {
	if (pick) {
		const r = pickedRing(doc, pick);
		if (r && inRing(r, x, z)) return pick;
	}
	for (let i = doc.edits.length - 1; i >= 0; i--) {
		const e = doc.edits[i];
		if (e.type !== "raster" && inRing(e.ring, x, z)) return { kind: "edit", i };
	}
	for (let i = doc.filters.areas.length - 1; i >= 0; i--) if (inRing(doc.filters.areas[i].ring, x, z)) return { kind: "area", i };
	return null;
}
