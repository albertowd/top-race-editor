// Characters as an LED display's seven segments, the way the track's screens show their numbers in every game: AC's scripts write them in its digital font,
// BeamNG's board is made of a shape for each (beamng/board.ts), and rFactor 2, which runs no script, has them drawn into its screens' pictures (drawSegments).
import type { Picture } from "./dds";

/** the characters there are segments for */
export const SEGMENT_CHARS = "0123456789:.";

/** The lit rectangles of a character (x0, z0, x1, z1), a character 1 high and 0.5 wide, centred: seven segments as an LED display's. */
export function segments(ch: string): [number, number, number, number][] {
	const [w, h, t, g] = [0.19, 0.43, 0.075, 0.012];
	const seg: Record<string, [number, number, number, number]> = {
		a: [-w + g, h - t, w - g, h],
		d: [-w + g, -h, w - g, -h + t],
		g: [-w + g, -t / 2, w - g, t / 2],
		f: [-w, g, -w + t, h - g],
		b: [w - t, g, w, h - g],
		e: [-w, -h + g, -w + t, -g],
		c: [w - t, -h + g, w, -g],
	};
	const lit: Record<string, string> = {
		"0": "abcdef",
		"1": "bc",
		"2": "abdeg",
		"3": "abcdg",
		"4": "bcfg",
		"5": "acdfg",
		"6": "acdefg",
		"7": "abc",
		"8": "abcdefg",
		"9": "abcdfg",
	};
	if (ch in lit) return [...(lit[ch] as string)].map((s) => seg[s] as [number, number, number, number]);
	const d = t * 0.9;
	if (ch === ":")
		return [
			[-d / 2, 0.16 - d / 2, d / 2, 0.16 + d / 2],
			[-d / 2, -0.16 - d / 2, d / 2, -0.16 + d / 2],
		];
	if (ch === ".") return [[-d / 2, -h, d / 2, -h + d]];
	throw new Error(`no glyph ${ch}`);
}

/** how far a segment leans right for each of its heights up (beamng/board.ts's glyphs') */
export const SLANT = 0.08;

/** A line of characters drawn into an RGBA picture as AC's display.text lays them out: each in a cell of letter pixels (width, height) from (x, y) on, its
 * segments in colour; a character with no segments (a space) left blank. */
export function drawSegments(
	pic: Picture,
	text: string,
	at: [number, number],
	letter: [number, number],
	colour: [number, number, number],
	slant = SLANT,
): void {
	if (pic.mode !== "RGBA") throw new Error("segments are drawn on an RGBA picture");
	const [lw, lh] = letter;
	// (pixels a unit across and up: a character 0.5 wide in its cell, 1 high)
	const sx = lw / 0.5;
	const sy = lh;
	[...text].forEach((ch, i) => {
		if (!SEGMENT_CHARS.includes(ch)) return;
		const cx = at[0] + (i + 0.5) * lw;
		const cy = at[1] + lh / 2;
		for (const [x0, z0, x1, z1] of segments(ch)) {
			// (each row of pixels the segment covers: its span there, leaning by its height)
			const top = Math.max(0, Math.ceil(cy - z1 * sy - 0.5));
			const bottom = Math.min(pic.height - 1, Math.floor(cy - z0 * sy - 0.5));
			for (let py = top; py <= bottom; py++) {
				const z = (cy - (py + 0.5)) / sy;
				const left = Math.max(0, Math.ceil(cx + (x0 + z * slant) * sx - 0.5));
				const right = Math.min(pic.width - 1, Math.floor(cx + (x1 + z * slant) * sx - 0.5));
				for (let px = left; px <= right; px++) pic.data.set([...colour, 255], (py * pic.width + px) * 4);
			}
		}
	});
}
