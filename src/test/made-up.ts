// The made-up track of src/test/fixtures (a small terrain, a few roads), and its pictures made grey on Node, for the engine's tests.
import { fileURLToPath } from "node:url";
import { readPng } from "../engine/dds";
import { type Grey, greyOf } from "../engine/pictures";

/** the fixtures' folder */
export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

/** A PNG's bytes made grey (what the engine window's decoding gives). */
export async function greyOfPng(bytes: Uint8Array): Promise<Grey> {
	const p = await readPng(bytes);
	return greyOf(p.data, p.width, p.height, p.mode === "RGBA" ? 4 : 3);
}
