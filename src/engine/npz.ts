// numpy's .npz files (a zip of .npy arrays, stored or deflated) read and written: the terrain's raster edits are kept so.

import { crc32, deflate, Writer } from "./bin";

export interface NpyArray {
	dtype: string;
	shape: number[];
	/** its values as 64-bit floats, in C order (none for text) */
	data: Float64Array;
	/** its text, for an array of unicode strings ('<Un': n characters each, UTF-32): its first */
	text?: string;
}

const le = (b: Uint8Array, at: number, n: 2 | 4) => {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	return n === 2 ? dv.getUint16(at, true) : dv.getUint32(at, true);
};

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A zipped file's bytes by its method: stored (0) as they are, deflated (8) inflated; any other: null. */
async function unzipped(method: number, raw: Uint8Array): Promise<Uint8Array | null> {
	if (method === 0) return raw;
	if (method === 8) return inflate(raw);
	return null;
}

/** A .npy file's array. */
export function readNpy(b: Uint8Array): NpyArray {
	if (b[0] !== 0x93 || String.fromCodePoint(...b.subarray(1, 6)) !== "NUMPY") throw new Error("not a .npy");
	const major = b[6] as number;
	const headLen = major === 1 ? le(b, 8, 2) : le(b, 8, 4);
	const start = (major === 1 ? 10 : 12) + headLen;
	const head = new TextDecoder().decode(b.subarray(major === 1 ? 10 : 12, start));
	const dtype = /'descr':\s*'([^']+)'/.exec(head)?.[1] ?? "";
	if (/'fortran_order':\s*True/.test(head)) throw new Error("a .npy in Fortran order is not read");
	const shape = (/'shape':\s*\(([^)]*)\)/.exec(head)?.[1] ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map(Number);
	const n = shape.reduce((a, x) => a * x, 1);
	if (dtype.startsWith("<U")) {
		// (numpy's unicode: n characters a string, each a 32-bit code point, the end padded with nothing)
		const w = Number(dtype.slice(2));
		const dv = new DataView(b.buffer, b.byteOffset + start, w * 4);
		let text = "";
		for (let i = 0; i < w; i++) {
			const c = dv.getUint32(i * 4, true);
			if (!c) break;
			text += String.fromCodePoint(c);
		}
		return { dtype, shape, data: new Float64Array(0), text };
	}
	const body = b.slice(start, start + n * Number(dtype.slice(2)));
	const typed: Record<string, (buf: ArrayBuffer) => ArrayLike<number>> = {
		"<f8": (x) => new Float64Array(x),
		"<f4": (x) => new Float32Array(x),
		"<i8": (x) => Float64Array.from(new BigInt64Array(x), Number),
		"<i4": (x) => new Int32Array(x),
		"<i2": (x) => new Int16Array(x),
		"|u1": (x) => new Uint8Array(x),
		"<u2": (x) => new Uint16Array(x),
	};
	const make = typed[dtype];
	if (!make) throw new Error(`a .npy of ${dtype} is not read`);
	return { dtype, shape, data: Float64Array.from(make(body.buffer)) };
}

/** A .npz file's arrays, by name (without .npy). */
export async function readNpz(b: Uint8Array): Promise<Record<string, NpyArray>> {
	// (the end of the central directory, then its entries)
	let eocd = -1;
	for (let i = b.length - 22; i >= 0; i--)
		if (le(b, i, 4) === 0x06054b50) {
			eocd = i;
			break;
		}
	if (eocd < 0) throw new Error("not a zip");
	const count = le(b, eocd + 10, 2);
	let p = le(b, eocd + 16, 4);
	const out: Record<string, NpyArray> = {};
	for (let k = 0; k < count; k++) {
		const method = le(b, p + 10, 2);
		const size = le(b, p + 20, 4);
		const nameLen = le(b, p + 28, 2);
		const extraLen = le(b, p + 30, 2);
		const commentLen = le(b, p + 32, 2);
		const local = le(b, p + 42, 4);
		const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
		const dataAt = local + 30 + le(b, local + 26, 2) + le(b, local + 28, 2);
		const raw = b.subarray(dataAt, dataAt + size);
		const file = await unzipped(method, raw);
		if (!file) throw new Error(`${name}: zipped in a way not read (${method})`);
		out[name.replace(/\.npy$/, "")] = readNpy(file);
		p += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}

/** An array to write: little-endian 64- or 32-bit floats (C order), of a shape (none: one number). */
export interface NpyOut {
	dtype: "<f8" | "<f4";
	shape: number[];
	data: ArrayLike<number>;
}

/** A .npy file of an array, as numpy writes one (its header padded to 64 bytes and a newline). */
export function writeNpy(a: NpyOut): Uint8Array {
	const shape = a.shape.length === 1 ? `(${a.shape[0]},)` : `(${a.shape.join(", ")})`;
	let head = `{'descr': '${a.dtype}', 'fortran_order': False, 'shape': ${shape}, }`;
	head = `${head}${" ".repeat(63 - ((10 + head.length) % 64))}\n`;
	const values = a.dtype === "<f8" ? Float64Array.from(a.data) : Float32Array.from(a.data);
	const out = new Uint8Array(10 + head.length + values.byteLength);
	out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, head.length & 0xff, head.length >> 8]);
	out.set(new TextEncoder().encode(head), 10);
	out.set(new Uint8Array(values.buffer), 10 + head.length);
	return out;
}

/** A zip of files (each deflated; dated 1980-01-01, as zipfile's, unless a date is given), each named with / (no zip64: under 4 GB). */
export async function writeZip(entries: Iterable<{ name: string; data: Uint8Array }>, date?: Date): Promise<Uint8Array> {
	// (MS-DOS's time and date, of the local clock: 2 s steps, years from 1980)
	const dosTime = date ? (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1) : 0;
	const dosDate = date ? ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() : 0x21;
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let at = 0;
	for (const { name, data } of entries) {
		const packed = await deflate(data, "deflate-raw");
		const fname = new TextEncoder().encode(name);
		const crc = crc32(data);
		const fields = (sig: number, central: boolean) => {
			const w = new Writer().u32(sig);
			if (central) w.u16(20);
			w.u16(20).u16(0).u16(8).u16(dosTime).u16(dosDate).u32(crc).u32(packed.length).u32(data.length).u16(fname.length).u16(0);
			if (central) w.u16(0).u16(0).u16(0).u32(0).u32(at);
			return w.bytes(fname).done();
		};
		const local = fields(0x04034b50, false);
		central.push(fields(0x02014b50, true));
		parts.push(local, packed);
		at += local.length + packed.length;
	}
	const size = central.reduce((s, c) => s + c.length, 0);
	const n = central.length;
	const end = new Writer().u32(0x06054b50).u16(0).u16(0).u16(n).u16(n).u32(size).u32(at).u16(0).done();
	const out = new Uint8Array(at + size + end.length);
	let p = 0;
	for (const b of [...parts, ...central, end]) {
		out.set(b, p);
		p += b.length;
	}
	return out;
}

/** A .npz file of arrays by name (np.savez_compressed's: each a deflated .npy in a zip). */
export function writeNpz(arrays: Record<string, NpyOut>): Promise<Uint8Array> {
	return writeZip(Object.entries(arrays).map(([name, a]) => ({ name: `${name}.npy`, data: writeNpy(a) })));
}
