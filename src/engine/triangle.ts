// Shewchuk's Triangle (the C library the track's Python uses through its `triangle` package), built for WebAssembly (the triangle-wasm package's
// triangle.out.wasm), run with glue of our own: the same in Node and in the engine window, its file handed in (no fetching), an error of Triangle's an
// exception here (not the end of the process), and an instance made again after one (its memory, 16 MB, is fixed: a fill that needs more fails, and is made
// smaller).

/** Triangle's triangulateio: 23 32-bit fields, each a pointer or a count. */
const IO = {
	pointlist: 0,
	pointmarkerlist: 2,
	numberofpoints: 3,
	trianglelist: 5,
	numberoftriangles: 9,
	numberofcorners: 10,
	segmentlist: 12,
	segmentmarkerlist: 13,
	numberofsegments: 14,
	holelist: 15,
	numberofholes: 16,
	edgelist: 19,
	edgemarkerlist: 20,
	normlist: 21,
} as const;
const IO_FIELDS = 23;

export interface TriangleInput {
	/** x, y pairs */
	points: ArrayLike<number>;
	/** index pairs */
	segments?: ArrayLike<number>;
	/** a point in each hole, x, y pairs */
	holes?: ArrayLike<number>;
}

export interface TriangleOutput {
	/** x, y pairs: the input's first, in order, then any Triangle added */
	points: Float64Array;
	/** index triples */
	triangles: Int32Array;
}

export class TriangleError extends Error {}

class Exit extends Error {}

interface Exports {
	h: () => void;
	i: (n: number) => number;
	j: (p: number) => void;
	k: (switches: number, input: number, output: number, vorout: number) => void;
}

export class Triangle {
	private exports!: Exports;
	private memory!: WebAssembly.Memory;
	private said = "";

	private constructor(private readonly module: WebAssembly.Module) {
		this.start();
	}

	/** Triangle from its .wasm file's bytes. */
	static async load(wasm: Uint8Array): Promise<Triangle> {
		return new Triangle(await WebAssembly.compile(wasm as Uint8Array<ArrayBuffer>));
	}

	private start(): void {
		this.memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
		const u8 = () => new Uint8Array(this.memory.buffer);
		const i32 = () => new Int32Array(this.memory.buffer);
		const instance = new WebAssembly.Instance(this.module, {
			a: {
				a: this.memory,
				// gettimeofday
				b: (ptr: number) => {
					const now = Date.now();
					i32()[ptr >> 2] = Math.trunc(now / 1000);
					i32()[(ptr + 4) >> 2] = Math.trunc((now % 1000) * 1000);
					return 0;
				},
				// fd_write: what Triangle says (its errors), kept for the exception
				c: (_fd: number, iov: number, iovcnt: number, pnum: number) => {
					let n = 0;
					for (let i = 0; i < iovcnt; i++) {
						const ptr = i32()[(iov + i * 8) >> 2] as number;
						const len = i32()[(iov + i * 8 + 4) >> 2] as number;
						this.said += new TextDecoder().decode(u8().subarray(ptr, ptr + len));
						n += len;
					}
					i32()[pnum >> 2] = n;
					return 0;
				},
				// memcpy_big
				d: (dest: number, src: number, num: number) => {
					u8().copyWithin(dest, src, src + num);
				},
				// resize_heap: its memory is fixed (malloc then says no, and Triangle stops)
				e: () => 0,
				// exit: Triangle stopped
				f: (status: number) => {
					throw new Exit(`Triangle stopped (${status})`);
				},
			},
		});
		this.exports = instance.exports as unknown as Exports;
		this.exports.h();
	}

	private put(values: ArrayLike<number>, kind: "f64" | "i32"): number {
		if (!values.length) return 0;
		const bytes = values.length * (kind === "f64" ? 8 : 4);
		const ptr = this.exports.i(bytes);
		if (!ptr) throw new TriangleError("Triangle has no memory left for its input");
		if (kind === "f64") new Float64Array(this.memory.buffer, ptr, values.length).set(values);
		else new Int32Array(this.memory.buffer, ptr, values.length).set(values);
		return ptr;
	}

	/** A new triangulateio, its fields all 0. */
	private io(): number {
		const p = this.exports.i(IO_FIELDS * 4);
		new Int32Array(this.memory.buffer, p, IO_FIELDS).fill(0);
		return p;
	}

	/** A triangulateio's field. */
	private field(base: number, k: number): number {
		return new Int32Array(this.memory.buffer, base, IO_FIELDS)[k] as number;
	}

	/** A triangulateio's field given its value. */
	private setField(base: number, k: number, v: number): void {
		new Int32Array(this.memory.buffer, base, IO_FIELDS)[k] = v;
	}

	/** The input's points, segments and holes into a triangulateio. */
	private give(inp: number, input: TriangleInput): void {
		this.setField(inp, IO.pointlist, this.put(input.points, "f64"));
		this.setField(inp, IO.numberofpoints, input.points.length >> 1);
		if (input.segments?.length) {
			this.setField(inp, IO.segmentlist, this.put(input.segments, "i32"));
			this.setField(inp, IO.numberofsegments, input.segments.length >> 1);
		}
		if (input.holes?.length) {
			this.setField(inp, IO.holelist, this.put(input.holes, "f64"));
			this.setField(inp, IO.numberofholes, input.holes.length >> 1);
		}
	}

	/** What Triangle made, and what was given it, freed (the holes' list is the input's, shared); the triangulateios and the switches with them. */
	private free(inp: number, out: number, sp: number): void {
		for (const k of [IO.pointlist, IO.pointmarkerlist, IO.trianglelist, IO.segmentlist, IO.segmentmarkerlist, IO.edgelist, IO.edgemarkerlist, IO.normlist]) {
			const p = this.field(out, k);
			if (p) this.exports.j(p);
		}
		for (const k of [IO.pointlist, IO.segmentlist, IO.holelist]) {
			const p = this.field(inp, k);
			if (p) this.exports.j(p);
		}
		this.exports.j(inp);
		this.exports.j(out);
		this.exports.j(sp);
	}

	/** Triangle's triangulate with its switches (as the Python passes them; 'z' added: indices from 0). */
	triangulate(switches: string, input: TriangleInput): TriangleOutput {
		const sw = switches.includes("z") ? switches : `z${switches}`;
		this.said = "";
		try {
			const inp = this.io();
			const out = this.io();
			this.give(inp, input);
			const s = new TextEncoder().encode(`${sw}\0`);
			const sp = this.exports.i(s.length);
			new Uint8Array(this.memory.buffer, sp, s.length).set(s);
			this.exports.k(sp, inp, out, 0);
			const np = this.field(out, IO.numberofpoints);
			const nt = this.field(out, IO.numberoftriangles);
			const corners = this.field(out, IO.numberofcorners) || 3;
			const points = new Float64Array(np * 2);
			points.set(new Float64Array(this.memory.buffer, this.field(out, IO.pointlist), np * 2));
			const tris = new Int32Array(this.memory.buffer, this.field(out, IO.trianglelist), nt * corners);
			const triangles = new Int32Array(nt * 3);
			for (let t = 0; t < nt; t++) for (let c = 0; c < 3; c++) triangles[t * 3 + c] = tris[t * corners + c] as number;
			this.free(inp, out, sp);
			return { points, triangles };
		} catch (e) {
			// (stopped part way: its memory as it was left, so a new instance for the next)
			const said = this.said.trim();
			this.start();
			const why = said ? `: ${said}` : "";
			throw new TriangleError(`${e instanceof Error ? e.message : String(e)}${why}`);
		}
	}
}
