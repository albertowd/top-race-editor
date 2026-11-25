// rFactor 2's pictures of a location, drawn as its own tracks' are (rf2/pictures.ts says which): by Chromium's canvas, each at a few times its size and made
// smaller for smooth edges (mappreview.ts's finished), a PNG (the loading screen a JPEG). A render of the track, where there is one, under the venue's icon and
// the loading screen.
import type { LoadingPanel, Rf2Picture } from "../engine/rf2/pictures";
import { RF2_PICTURE_SIZE } from "../engine/rf2/pictures";
import { finished } from "./mappreview";

type G = OffscreenCanvasRenderingContext2D;
type P = [number, number];

/** the samples' lettering: tall and narrow (Windows' Bahnschrift, condensed) */
const FONT = '"Bahnschrift Condensed", "Bahnschrift SemiCondensed", Bahnschrift, "Arial Narrow", "DejaVu Sans Condensed", sans-serif';
const PANEL = "rgba(28, 52, 80, 0.62)";
const PANEL_LIGHT = "rgba(190, 214, 232, 0.36)";
const ORANGE = "rgb(226, 104, 68)";
const MAP_RED = "rgb(222, 86, 54)";
const YELLOW = "rgb(246, 226, 0)";

/** The lines fitted into a box (x, y, w, h): their points' place in it, north up; turned a quarter where the box is taller than they are wide (a wheel's
 * screen). */
function fitLines(lines: number[][], box: [number, number, number, number], turn = false): (x: number, y: number) => P {
	let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const l of lines)
		for (let i = 0; i + 1 < l.length; i += 2) {
			x0 = Math.min(x0, l[i] as number);
			x1 = Math.max(x1, l[i] as number);
			y0 = Math.min(y0, l[i + 1] as number);
			y1 = Math.max(y1, l[i + 1] as number);
		}
	const [bx, by, bw, bh] = box;
	const rot = turn && x1 - x0 > y1 - y0;
	const [w, h] = rot ? [y1 - y0, x1 - x0] : [x1 - x0, y1 - y0];
	const s = Math.min(bw / (w || 1), bh / (h || 1));
	const mx = (x0 + x1) / 2;
	const my = (y0 + y1) / 2;
	return (x, y) => (rot ? [bx + bw / 2 + (y - my) * s, by + bh / 2 + (x - mx) * s] : [bx + bw / 2 + (x - mx) * s, by + bh / 2 - (y - my) * s]);
}

function lapPath(g: G, line: number[], px: (x: number, y: number) => P, open = false): void {
	g.beginPath();
	g.moveTo(...px(line[0] as number, line[1] as number));
	for (let i = 2; i + 1 < line.length; i += 2) g.lineTo(...px(line[i] as number, line[i + 1] as number));
	if (!open) g.closePath();
}

/** The lines stroked over one another, widest first: each [colour, width]. */
function strokeLaps(g: G, lines: number[][], px: (x: number, y: number) => P, strokes: [string, number][], runs: number[][] = []): void {
	g.lineJoin = "round";
	g.lineCap = "round";
	// (the runs open; each stroke of every line before the next, so where they meet they are one road)
	const all = [...lines.map((l) => [l, false] as const), ...runs.map((l) => [l, true] as const)];
	for (const [colour, width] of strokes)
		for (const [l, open] of all) {
			if (l.length < 4) continue;
			lapPath(g, l, px, open);
			g.strokeStyle = colour;
			g.lineWidth = width;
			g.stroke();
		}
}

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number): void {
	g.beginPath();
	g.roundRect(x, y, w, h, r);
}

/** An arrow at a point the way given (screen's axes), its length size: white edged dark. */
function arrow(g: G, at: P, dir: P, size: number, fill = "white", edge = "rgba(0, 0, 0, 0.8)"): void {
	const L = Math.hypot(...dir) || 1;
	const f: P = [dir[0] / L, dir[1] / L];
	const s: P = [-f[1], f[0]];
	const p = (a: number, b: number): P => [at[0] + f[0] * a + s[0] * b, at[1] + f[1] * a + s[1] * b];
	const pts = [
		p(size / 2, 0),
		p(0, size * 0.42),
		p(0, size * 0.16),
		p(-size / 2, size * 0.16),
		p(-size / 2, -size * 0.16),
		p(0, -size * 0.16),
		p(0, -size * 0.42),
	];
	g.beginPath();
	g.moveTo(...(pts[0] as P));
	for (const q of pts.slice(1)) g.lineTo(...q);
	g.closePath();
	g.lineJoin = "round";
	g.lineWidth = size * 0.12;
	g.strokeStyle = edge;
	g.stroke();
	g.fillStyle = fill;
	g.fill();
}

function font(g: G, px: number, weight = 600): void {
	g.font = `${weight} ${px}px ${FONT}`;
	g.fontStretch = "condensed";
}

/** A small dark tag with its text (a chequered square before START), its left middle at a point. */
function tag(g: G, text: string, at: P, h: number, chequered: boolean): void {
	font(g, h * 0.72);
	const pad = h * 0.18;
	const icon = chequered ? h * 0.7 : 0;
	const w = g.measureText(text).width + pad * 2 + (icon ? icon + pad : 0);
	roundRect(g, at[0], at[1] - h / 2, w, h, h * 0.15);
	g.fillStyle = "rgba(20, 20, 20, 0.85)";
	g.fill();
	if (icon) {
		const c = icon / 4;
		for (let i = 0; i < 4; i++)
			for (let j = 0; j < 4; j++) {
				g.fillStyle = (i + j) % 2 ? "black" : "white";
				g.fillRect(at[0] + pad + i * c, at[1] - icon / 2 + j * c, c, c);
			}
	}
	g.fillStyle = "white";
	g.textBaseline = "middle";
	g.fillText(text, at[0] + pad + (icon ? icon + pad : 0), at[1] + h * 0.04);
}

/** Where the lap starts and its pits, tagged, and an arrow beside its start the way it runs. */
function places(g: G, spec: Rf2Picture, px: (x: number, y: number) => P, scale: number): void {
	if (spec.start && spec.fwd) {
		const at = px(...spec.start);
		const ahead = px(spec.start[0] + spec.fwd[0], spec.start[1] + spec.fwd[1]);
		const dir: P = [ahead[0] - at[0], ahead[1] - at[1]];
		const L = Math.hypot(...dir) || 1;
		const side: P = [(dir[1] / L) * 26 * scale, (-dir[0] / L) * 26 * scale];
		arrow(g, [at[0] - side[0], at[1] - side[1]], dir, 26 * scale);
		tag(g, "START", [at[0] + 10 * scale, at[1] + 22 * scale], 16 * scale, true);
	}
	if (spec.pit) {
		const at = px(...spec.pit);
		tag(g, "PIT", [at[0] + 10 * scale, at[1] - 4 * scale], 16 * scale, false);
	}
}

async function bitmap(b: Uint8Array): Promise<ImageBitmap> {
	return createImageBitmap(new Blob([b as Uint8Array<ArrayBuffer>]));
}

/** A picture drawn covering the canvas (cut to its shape, its middle kept). */
function cover(g: G, im: ImageBitmap, w: number, h: number): void {
	const s = Math.max(w / im.width, h / im.height);
	const dw = im.width * s;
	const dh = im.height * s;
	g.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export async function rf2Picture(spec: Rf2Picture): Promise<Uint8Array> {
	const size = RF2_PICTURE_SIZE[spec.kind];
	if (spec.kind === "loading") return loading(spec, size);
	// (the small ones drawn four times larger, the rest twice)
	const K = size[0] < 256 ? 4 : 2;
	const w = size[0] * K;
	const h = size[1] * K;
	const big = new OffscreenCanvas(w, h);
	const g = big.getContext("2d") as G;
	const lap = spec.lines.slice(0, 1);
	if (spec.kind === "tile") {
		roundRect(g, 0, 0, w, h, w * 0.2);
		const grad = g.createLinearGradient(0, 0, 0, h);
		grad.addColorStop(0, "rgb(92, 92, 92)");
		grad.addColorStop(0.55, "rgb(46, 46, 46)");
		grad.addColorStop(1, "rgb(60, 60, 60)");
		g.fillStyle = grad;
		g.fill();
		const px = fitLines(lap, [w * 0.08, h * 0.12, w * 0.84, h * 0.76]);
		strokeLaps(g, lap, px, [
			["rgb(20, 20, 20)", 15 * K],
			["rgb(205, 205, 205)", 11 * K],
			["rgb(70, 70, 70)", 3 * K],
		]);
	} else if (spec.kind === "icon") {
		roundRect(g, 0, 0, w, h, w * 0.12);
		const grad = g.createLinearGradient(0, 0, w, h);
		grad.addColorStop(0, "rgb(226, 30, 30)");
		grad.addColorStop(1, "rgb(140, 0, 0)");
		g.fillStyle = grad;
		g.fill();
		const px = fitLines(lap, [w * 0.1, h * 0.14, w * 0.8, h * 0.72]);
		strokeLaps(g, lap, px, [
			["white", 3.6 * K],
			["rgb(180, 10, 10)", 1.2 * K],
		]);
	} else if (spec.kind === "thumb") {
		const px = fitLines(lap, [w * 0.12, h * 0.1, w * 0.76, h * 0.8]);
		strokeLaps(g, lap, px, [
			["rgba(70, 60, 0, 0.9)", 7 * K],
			[YELLOW, 5 * K],
		]);
		places(g, spec, px, K * 0.42);
	} else if (spec.kind === "wheel") {
		const grad = g.createLinearGradient(0, 0, 0, h);
		grad.addColorStop(0, "rgb(170, 170, 168)");
		grad.addColorStop(1, "rgb(140, 140, 138)");
		g.fillStyle = grad;
		g.fillRect(0, 0, w, h);
		const px = fitLines(lap, [w * 0.1, h * 0.06, w * 0.8, h * 0.88], true);
		strokeLaps(g, lap, px, [
			["rgb(25, 25, 25)", 5 * K],
			["rgb(225, 225, 225)", 2 * K],
		]);
		if (spec.start) {
			const at = px(...spec.start);
			g.beginPath();
			g.arc(at[0], at[1], 4 * K, 0, Math.PI * 2);
			g.fillStyle = "rgb(25, 25, 25)";
			g.fill();
		}
	} else {
		// (the venue: the track seen, darkened toward its foot, its laps' map over it)
		if (spec.backdrop) cover(g, await bitmap(spec.backdrop), w, h);
		else {
			g.fillStyle = "rgb(46, 54, 48)";
			g.fillRect(0, 0, w, h);
		}
		g.fillStyle = "rgba(0, 0, 0, 0.42)";
		g.fillRect(0, 0, w, h);
		const fade = g.createLinearGradient(0, h * 0.62, 0, h);
		fade.addColorStop(0, "rgba(0, 0, 0, 0)");
		fade.addColorStop(1, "rgba(0, 0, 0, 0.95)");
		g.fillStyle = fade;
		g.fillRect(0, 0, w, h);
		const runs = spec.runs ?? [];
		const px = fitLines([...spec.lines, ...runs], [w * 0.08, h * 0.1, w * 0.84, h * 0.62]);
		strokeLaps(
			g,
			spec.lines,
			px,
			[
				["rgba(30, 30, 30, 0.9)", 15 * K],
				["rgb(140, 140, 140)", 11 * K],
				["rgba(80, 80, 80, 0.9)", 1.5 * K],
			],
			runs,
		);
		places(g, spec, px, K);
	}
	return finished(big, size, "png");
}

/** The loading screen: the track seen from its start, its data, its name and layout, its map and which way it runs, in panels over it (as LochDrummond's). */
async function loading(spec: Rf2Picture, size: [number, number]): Promise<Uint8Array> {
	const [w, h] = size;
	const c = new OffscreenCanvas(w, h);
	const g = c.getContext("2d") as G;
	if (spec.backdrop) cover(g, await bitmap(spec.backdrop), w, h);
	else {
		const sky = g.createLinearGradient(0, 0, 0, h);
		sky.addColorStop(0, "rgb(44, 82, 118)");
		sky.addColorStop(1, "rgb(150, 186, 210)");
		g.fillStyle = sky;
		g.fillRect(0, 0, w, h);
	}
	const panel = spec.panel as LoadingPanel;
	// (the band across, behind the name and the way it runs)
	g.fillStyle = "rgba(28, 52, 80, 0.42)";
	g.fillRect(0, 522, w, 146);
	// (the track's data)
	heading(g, "TRACK DATA", 430, 105, 405);
	g.fillStyle = PANEL;
	g.fillRect(430, 145, 405, 377);
	font(g, 30, 500);
	g.textBaseline = "middle";
	panel.rows.slice(0, 7).forEach(([k, v], i) => {
		const y = 197 + i * 47;
		g.fillStyle = "white";
		g.textAlign = "left";
		g.fillText(k.toUpperCase(), 443, y);
		g.textAlign = "right";
		fitText(g, v, 822, y, 230);
	});
	g.textAlign = "left";
	// (its name where the samples have their logo)
	g.fillStyle = "white";
	g.fillRect(430, 522, 405, 146);
	g.fillStyle = "rgb(22, 52, 150)";
	g.textAlign = "center";
	name(g, panel.venue, 632, 595, 370, 126);
	g.textAlign = "left";
	// (the layout, on an orange bar)
	g.beginPath();
	g.moveTo(430, 672);
	g.lineTo(1270, 672);
	g.lineTo(1300, 690);
	g.lineTo(1270, 708);
	g.lineTo(430, 708);
	g.closePath();
	g.fillStyle = ORANGE;
	g.fill();
	font(g, 28, 500);
	g.fillStyle = "white";
	g.fillText("LAYOUT", 443, 691);
	g.textAlign = "right";
	fitText(g, panel.layout, 822, 691, 280);
	g.textAlign = "left";
	// (its map)
	heading(g, "TRACK MAP", 1075, 105, 415);
	g.fillStyle = PANEL_LIGHT;
	g.fillRect(1075, 145, 415, 523);
	if (spec.lines.length) {
		const lap = spec.lines.slice(0, 1);
		const px = fitLines(lap, [1105, 175, 355, 330]);
		strokeLaps(g, lap, px, [[MAP_RED, 9]]);
		pin(g, spec.start ? px(...spec.start) : null, "START", 1);
		pin(g, spec.pit ? px(...spec.pit) : null, "PIT", -1);
	}
	// (which way it runs)
	direction(g, 1398, 595, 58, panel.clockwise);
	const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
	return new Uint8Array(await blob.arrayBuffer());
}

/** A panel's title over its top, on a tab with its right end slanted. */
function heading(g: G, text: string, x: number, y: number, w: number): void {
	g.beginPath();
	g.moveTo(x, y);
	g.lineTo(x + w * 0.86, y);
	g.lineTo(x + w, y + 40);
	g.lineTo(x, y + 40);
	g.closePath();
	g.fillStyle = "rgba(28, 52, 80, 0.5)";
	g.fill();
	font(g, 40, 500);
	g.fillStyle = "white";
	g.textBaseline = "middle";
	g.fillText(text, x + 3, y + 22);
}

/** Text no wider than given: made smaller to fit. */
function fitText(g: G, text: string, x: number, y: number, most: number): void {
	const was = g.font;
	const width = g.measureText(text).width;
	if (width > most) {
		const px = Number(/(?<!\d)(\d+(?:\.\d+)?)px/.exec(was)?.[1] ?? 30);
		font(g, (px * most) / width, 500);
	}
	g.fillText(text, x, y);
	g.font = was;
	g.fontStretch = "condensed";
}

/** The venue's name, as large as fits its box, on two lines where that makes it larger. */
function name(g: G, text: string, x: number, y: number, w: number, h: number): void {
	const words = text.toUpperCase().split(/\s+/);
	const tries: string[][] = [[words.join(" ")]];
	for (let i = 1; i < words.length; i++) tries.push([words.slice(0, i).join(" "), words.slice(i).join(" ")]);
	let best: { lines: string[]; size: number } = { lines: tries[0] as string[], size: 10 };
	for (const lines of tries) {
		font(g, 100, 700);
		const widest = Math.max(...lines.map((l) => g.measureText(l).width));
		const size = Math.min((100 * w) / widest, (h * 0.9) / (lines.length * 1.05));
		if (size > best.size) best = { lines, size };
	}
	font(g, best.size, 700);
	g.textBaseline = "middle";
	const lh = best.size * 1.05;
	best.lines.forEach((l, i) => {
		g.fillText(l, x, y + (i - (best.lines.length - 1) / 2) * lh);
	});
}

/** A place on the map: a white dot, a stem down (or up) from it and its name at the stem's end. */
function pin(g: G, at: P | null, text: string, down: 1 | -1): void {
	if (!at) return;
	g.strokeStyle = "white";
	g.lineWidth = 2;
	g.beginPath();
	g.moveTo(at[0], at[1]);
	g.lineTo(at[0], at[1] + down * 70);
	g.stroke();
	g.beginPath();
	g.arc(at[0], at[1], 6, 0, Math.PI * 2);
	g.fillStyle = "white";
	g.fill();
	font(g, 28, 500);
	g.textAlign = "center";
	g.textBaseline = "middle";
	g.fillText(text, at[0], at[1] + down * 88);
	g.textAlign = "left";
}

/** A ring with DIRECTION in it, its arrowheads turning the way the lap runs. */
function direction(g: G, x: number, y: number, r: number, clockwise: boolean): void {
	g.strokeStyle = "white";
	g.lineWidth = 3;
	g.beginPath();
	g.arc(x, y, r, 0, Math.PI * 2);
	g.stroke();
	// (a head each side: clockwise, up on the left and down on the right; else the other way)
	const s = clockwise ? 1 : -1;
	for (const [side, dy] of [
		[-1, -s],
		[1, s],
	] as [number, number][]) {
		const hx = x + side * r;
		g.beginPath();
		g.moveTo(hx - 11, y - dy * 4);
		g.lineTo(hx, y + dy * 10);
		g.lineTo(hx + 11, y - dy * 4);
		g.stroke();
	}
	font(g, 22, 500);
	g.fillStyle = "white";
	g.textAlign = "center";
	g.textBaseline = "middle";
	fitText(g, "DIRECTION", x, y + 1, r * 1.5);
	g.textAlign = "left";
}
