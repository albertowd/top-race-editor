// Pictures decoded where the engine runs in a browser (the engine window): Chromium's own decoder, then made grey as Pillow makes them. Checked against Pillow
// on the Velopark's pictures (3300 x 3000 and 8192 x 8192): every pixel the same.
import { type Grey, greyOf } from "./pictures";

export async function decodeGrey(bytes: Uint8Array): Promise<Grey> {
	const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]), {
		colorSpaceConversion: "none",
		premultiplyAlpha: "none",
	});
	try {
		const canvas = new OffscreenCanvas(bmp.width, bmp.height);
		const g = canvas.getContext("2d", { willReadFrequently: true });
		if (!g) throw new Error("no canvas to decode a picture on");
		g.drawImage(bmp, 0, 0);
		return greyOf(g.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width, bmp.height);
	} finally {
		bmp.close();
	}
}
