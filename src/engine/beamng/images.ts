// The level's own pictures: an 8-bit PNG of grey, RGB or RGBA (as Pillow saves one), and what shows of a colour texture as its own grey map (BeamNG reads what
// shows from a map's colour, not from the colour's alpha).
import { crc32, deflate } from "../bin";
import { readPng } from "../dds";

/** The PNG colour type of each channel count: grey, RGB, RGBA. */
const COLOUR_TYPE: Record<1 | 3 | 4, number> = { 1: 0, 3: 2, 4: 6 };

/** An 8-bit PNG: rows of width pixels of channels bytes (1 grey, 3 RGB, 4 RGBA), row after row. */
export async function writePng(data: Uint8Array, width: number, height: number, channels: 1 | 3 | 4): Promise<Uint8Array> {
	const stride = width * channels;
	const raw = new Uint8Array(height * (1 + stride));
	for (let r = 0; r < height; r++) raw.set(data.subarray(r * stride, (r + 1) * stride), r * (1 + stride) + 1);
	const chunk = (type: string, body: Uint8Array) => {
		const td = new Uint8Array(4 + body.length);
		td.set(new TextEncoder().encode(type));
		td.set(body, 4);
		const w = new Uint8Array(12 + body.length);
		const dv = new DataView(w.buffer);
		dv.setUint32(0, body.length);
		w.set(td, 4);
		dv.setUint32(8 + body.length, crc32(td));
		return w;
	};
	const head = new Uint8Array(13);
	const hv = new DataView(head.buffer);
	hv.setUint32(0, width);
	hv.setUint32(4, height);
	head[8] = 8;
	head[9] = COLOUR_TYPE[channels];
	const parts = [
		Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", head),
		chunk("IDAT", await deflate(raw, "deflate")),
		chunk("IEND", new Uint8Array(0)),
	];
	const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** What shows of a PNG (its alpha) as a grey PNG; one with no alpha all showing. */
export async function opacityPng(png: Uint8Array): Promise<Uint8Array> {
	const p = await readPng(png);
	const n = p.width * p.height;
	const a = new Uint8Array(n).fill(255);
	if (p.mode === "RGBA") for (let i = 0; i < n; i++) a[i] = p.data[i * 4 + 3] as number;
	return writePng(a, p.width, p.height, 1);
}

/** A PNG as RGB, each pixel its colour as it shows over a ground of one grey (its alpha's share of it over the grey's): a blended picture drawn cut out
 * instead, looking as it did where it is not cut. */
export async function overGreyPng(png: Uint8Array, grey: number): Promise<Uint8Array> {
	const p = await readPng(png);
	if (p.mode !== "RGBA") return rgbPng(png);
	const n = p.width * p.height;
	const rgb = new Uint8Array(n * 3);
	for (let i = 0; i < n; i++) {
		const a = (p.data[i * 4 + 3] as number) / 255;
		for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round((p.data[i * 4 + c] as number) * a + grey * (1 - a));
	}
	return writePng(rgb, p.width, p.height, 3);
}

/** A PNG as RGB (its alpha left out), as Pillow's convert('RGB') saves it. */
export async function rgbPng(png: Uint8Array): Promise<Uint8Array> {
	const p = await readPng(png);
	if (p.mode === "RGB") return png;
	const n = p.width * p.height;
	const rgb = new Uint8Array(n * 3);
	for (let i = 0; i < n; i++) rgb.set(p.data.subarray(i * 4, i * 4 + 3), i * 3);
	return writePng(rgb, p.width, p.height, 3);
}
