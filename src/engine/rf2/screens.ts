// The track's screens in rFactor 2. AC draws a screen live, a script on its material's picture (aclights.ts); rFactor 2 runs no script on a track, so a screen
// is a still picture there instead. The start gantry's board (the screen showing start_board): its own picture with the track's name and the layout's lettered
// over the screen's area, in the red AC's board draws its times in; the gantry is shared by the layouts it stands in, so each layout has its own board, its own
// name on it. A prices screen: its prices in seven segments, laid out as AC's script (models/scripts/ac/screens/prices.lua) lays them out.
import type { LightsData } from "../aclights";
import type { Picture } from "../dds";
import { drawSegments } from "../segments";

/** what the gantry's board shows in AC (its script, models/scripts/ac/screens/start_board.lua) */
export const START_BOARD = "start_board";

/** A board's screen: its material, the picture's pixels it is laid out on, and its area there (x, y, width, height). */
export interface BoardScreen {
	material: string;
	pixels: [number, number];
	area: [number, number, number, number];
}

/** The track's boards' screens (lights.json's screens showing start_board), by their material. */
export function boardScreens(data: Pick<LightsData, "screens">): Map<string, BoardScreen> {
	const out = new Map<string, BoardScreen>();
	for (const s of data.screens) {
		if (s.shows !== START_BOARD || typeof s.material !== "string") continue;
		const px = s.pixels as number[] | undefined;
		if (!px || px.length < 2) continue;
		const pixels: [number, number] = [Number(px[0]), Number(px[1])];
		const a = s.area as number[] | undefined;
		const area: [number, number, number, number] = a?.length === 4 ? [Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3])] : [0, 0, pixels[0], pixels[1]];
		out.set(s.material, { material: s.material, pixels, area });
	}
	return out;
}

/** what a fuel station's prices screen shows in AC (its script, prices.lua) */
export const PRICES = "prices";

/** A prices screen: its material, its picture's pixels, its background (0 to 1 each) and its prices. */
export interface PriceScreen {
	material: string;
	pixels: [number, number];
	background: [number, number, number];
	prices: string[];
}

/** The track's prices screens (lights.json's screens showing prices), by their material. */
export function priceScreens(data: Pick<LightsData, "screens">): Map<string, PriceScreen> {
	const out = new Map<string, PriceScreen>();
	for (const s of data.screens) {
		if (s.shows !== PRICES || typeof s.material !== "string") continue;
		const px = (s.pixels as number[] | undefined) ?? [512, 1024];
		const bg = (s.background as number[] | undefined) ?? [0, 0, 0];
		const prices = ((s.data as { prices?: unknown[] } | undefined)?.prices ?? []).map(String);
		out.set(s.material, {
			material: s.material,
			pixels: [Number(px[0]), Number(px[1])],
			background: [Number(bg[0] ?? 0), Number(bg[1] ?? 0), Number(bg[2] ?? 0)],
			prices,
		});
	}
	return out;
}

/** prices.lua's: each price's cells, its right edge and its rows' tops (on its 512 x 1024 display) */
const PRICE_LETTER: [number, number] = [104, 250];
const PRICE_RIGHT = 482;
const PRICE_ROW = 512;
const PRICE_TOP = 130;
/** AC's screens' red (rgbm(1, .06, .04)) */
const RED_RGB: [number, number, number] = [255, 15, 10];

/** A prices screen's picture: its background, each price in seven segments where prices.lua writes it, right-aligned a row each. */
export function pricesPicture(s: PriceScreen): Picture {
	const [width, height] = s.pixels;
	const data = new Uint8Array(width * height * 4);
	const bg = s.background.map((c) => Math.round(Math.min(Math.max(c, 0), 1) * 255));
	for (let k = 0; k < width * height; k++) data.set([bg[0] as number, bg[1] as number, bg[2] as number, 255], k * 4);
	const pic: Picture = { width, height, mode: "RGBA", data };
	// (laid out on prices.lua's display, scaled to the picture's pixels)
	const sx = width / 512;
	const sy = height / 1024;
	s.prices.forEach((p, i) => {
		const at: [number, number] = [(PRICE_RIGHT - PRICE_LETTER[0] * p.length) * sx, (i * PRICE_ROW + PRICE_TOP) * sy];
		drawSegments(pic, p, at, [PRICE_LETTER[0] * sx, PRICE_LETTER[1] * sy], RED_RGB);
	});
	return pic;
}

/** What a layout's board says: the track's name over the layout's (the layout's alone where it is the track's). */
export function boardLines(trackName: string, layout: string): string[] {
	const t = trackName.trim();
	const l = layout.trim();
	return !l || l === t ? [t] : [t, l];
}

/** A board to letter: its own picture (a PNG or JPEG), its screen, and the lines it says. */
export interface BoardLettering {
	picture: Uint8Array;
	screen: BoardScreen;
	lines: string[];
}

/** Draws a board's picture with its lines on it, a PNG (where the engine runs: Chromium's canvas). */
export type BoardPainter = (b: BoardLettering) => Promise<Uint8Array>;

/** AC's board's red (start_board.lua's rgbm(1, .06, .04)) */
const RED = "rgb(255, 15, 10)";
/** the share of a board's area its lines are lettered over, from its top: start_board.lua's clock ends 234 pixels down its 320, the lamps below it */
const BOARD_TOP = 0.74;
const FONT = (size: number) => `bold ${size}px "Bahnschrift Condensed", "Bahnschrift SemiCondensed", Bahnschrift, "Arial Narrow", Arial, sans-serif`;

/** The sizes each line is drawn at to fit the area (w, h): the last line, the layout's, the largest; each as large as fits 90% of the width (measure: a line's
 * width at a size). */
export function boardSizes(lines: string[], w: number, h: number, measure: (line: string, size: number) => number): number[] {
	// (shares of the height: the track's name smaller over the layout's)
	const shares = lines.length === 1 ? [0.62] : [0.3, 0.46];
	const probe = 100;
	return lines.map((l, i) => {
		const tall = h * (shares[i] ?? 0.3);
		const wide = (probe * w * 0.9) / Math.max(measure(l, probe), 1);
		return Math.max(4, Math.min(tall, wide));
	});
}

/** The board drawn on Chromium's canvas: its picture as it is, its lines in capitals over its screen's area, red with a glow as lamps are. */
export const canvasBoard: BoardPainter = async ({ picture, screen, lines }) => {
	if (typeof OffscreenCanvas === "undefined") throw new Error("no canvas here to letter the gantry's board on");
	const bitmap = await createImageBitmap(new Blob([picture as BlobPart]));
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const g = canvas.getContext("2d");
	if (!g) throw new Error("no canvas to letter the gantry's board on");
	g.drawImage(bitmap, 0, 0);
	// (the screen's area, laid out on its pixels, on the picture as large as it is)
	const sx = bitmap.width / screen.pixels[0];
	const sy = bitmap.height / screen.pixels[1];
	// (over the area's top only: below it, under AC's clock, the gantry's lamps hang in front of the board)
	const [ax, ay, aw, ah] = [screen.area[0] * sx, screen.area[1] * sy, screen.area[2] * sx, screen.area[3] * sy * BOARD_TOP];
	const caps = lines.map((l) => l.toUpperCase());
	const sizes = boardSizes(caps, aw, ah, (l, s) => {
		g.font = FONT(s);
		return g.measureText(l).width;
	});
	const total = sizes.reduce((a, s) => a + s * 1.12, 0);
	let y = ay + (ah - total) / 2;
	g.textAlign = "center";
	g.textBaseline = "middle";
	g.fillStyle = RED;
	g.shadowColor = RED;
	caps.forEach((l, i) => {
		const s = sizes[i] as number;
		g.font = FONT(s);
		g.shadowBlur = s * 0.18;
		g.fillText(l, ax + aw / 2, y + (s * 1.12) / 2);
		y += s * 1.12;
	});
	const blob = await canvas.convertToBlob({ type: "image/png" });
	return new Uint8Array(await blob.arrayBuffer());
};
