// @vitest-environment node
// A DDS read back: what the build writes (DXT1, DXT5, uncompressed, a mip chain) comes back near the picture it was.
import { describe, expect, it } from "vitest";
import { ddsChain, ddsOf, type Picture } from "./dds";
import { readDds } from "./ddsread";

/** a picture of smooth colours (on a line, as DXT keeps a block's), a hard edge of alpha down its middle */
function picture(w: number, h: number, alpha: boolean): Picture {
	const n = alpha ? 4 : 3;
	const data = new Uint8Array(w * h * n);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const p = (y * w + x) * n;
			const t = Math.round(((y * w + x) * 255) / (w * h - 1));
			data[p] = t;
			data[p + 1] = 255 - t;
			data[p + 2] = 90;
			if (alpha) data[p + 3] = x < w / 2 ? 0 : 255;
		}
	return { width: w, height: h, mode: alpha ? "RGBA" : "RGB", data };
}

/** the largest difference of any channel between a picture and what was read */
function worst(a: Picture, b: Picture): number {
	const n = a.mode === "RGBA" ? 4 : 3;
	let d = 0;
	for (let i = 0; i < a.width * a.height; i++)
		for (let c = 0; c < n; c++) d = Math.max(d, Math.abs((a.data[i * n + c] as number) - (b.data[i * 4 + c] as number)));
	return d;
}

describe("a DDS read back", () => {
	it("is near what was written, DXT1 and DXT5 alike", () => {
		const rgb = picture(16, 8, false);
		const one = readDds(ddsOf(rgb, "DXT1"));
		expect(one).toMatchObject({ width: 16, height: 8, mode: "RGBA" });
		expect(worst(rgb, one as Picture)).toBeLessThan(40);
		const rgba = picture(16, 8, true);
		const five = readDds(ddsOf(rgba, "DXT5")) as Picture;
		expect(worst(rgba, five)).toBeLessThan(40);
		expect(five.data[3]).toBe(0);
		expect(five.data[(16 * 8 - 1) * 4 + 3]).toBe(255);
	});

	it("is exact uncompressed", () => {
		const rgba = picture(5, 3, true);
		expect(worst(rgba, readDds(ddsOf(rgba)) as Picture)).toBe(0);
		const rgb = picture(5, 3, false);
		expect(worst(rgb, readDds(ddsOf(rgb)) as Picture)).toBe(0);
	});

	it("is the largest level no bigger than asked", () => {
		const big = ddsChain(picture(64, 32, true), "DXT5");
		expect(readDds(big, 16)).toMatchObject({ width: 16, height: 8 });
		expect(readDds(big)).toMatchObject({ width: 64, height: 32 });
	});

	it("is nothing where it is not one it reads", () => {
		expect(readDds(new Uint8Array(10))).toBeNull();
		const dx10 = ddsOf(picture(8, 8, true), "DXT5");
		dx10.set([0x44, 0x58, 0x31, 0x30], 84);
		expect(readDds(dx10)).toBeNull();
	});
});
