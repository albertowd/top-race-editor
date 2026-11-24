// A baseline JPEG read into its pixels (the models' textures as Blender and the tracks keep them: Huffman-coded, 8-bit, grey or YCbCr, any sampling), for the
// models' pictures (model-pictures.mjs). Progressive JPEGs are not read.

const ZIGZAG = [
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22,
	15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

/** cos((2x + 1) u pi / 16), with the 1/sqrt(2) of u 0, for the inverse DCT */
const COS = new Float32Array(64);
for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);

/** A Huffman table as lookups by code length: each length's first code, its last, and where its symbols start. */
function huffman(counts, symbols) {
	const max = new Int32Array(18).fill(-1);
	const first = new Int32Array(17);
	const at = new Int32Array(17);
	let code = 0;
	let k = 0;
	for (let len = 1; len <= 16; len++) {
		at[len] = k;
		first[len] = code;
		code += counts[len - 1];
		k += counts[len - 1];
		if (counts[len - 1]) max[len] = code - 1;
		code <<= 1;
	}
	max[17] = 0x7fffffff;
	return { max, first, at, symbols };
}

/** A JPEG's pixels: { width, height, data } (RGBA, its alpha 255). */
export function readJpeg(b) {
	const quant = [];
	const dc = [];
	const ac = [];
	let frame = null;
	let restart = 0;
	let p = 2;
	if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error("not a JPEG");
	const u16 = (i) => (b[i] << 8) | b[i + 1];
	while (p < b.length) {
		if (b[p] !== 0xff) throw new Error("a JPEG out of step");
		const m = b[p + 1];
		if (m === 0xff) {
			p++;
			continue;
		}
		if (m === 0xd9) break;
		const len = u16(p + 2);
		const s = p + 4;
		const e = p + 2 + len;
		if (m === 0xdb) {
			// (quantisation tables: 8- or 16-bit, in zigzag order)
			for (let i = s; i < e; ) {
				const wide = b[i] >> 4;
				const id = b[i] & 15;
				const t = new Int32Array(64);
				for (let k = 0; k < 64; k++) t[ZIGZAG[k]] = wide ? u16(i + 1 + k * 2) : b[i + 1 + k];
				quant[id] = t;
				i += 1 + 64 * (wide ? 2 : 1);
			}
		} else if (m === 0xc4) {
			for (let i = s; i < e; ) {
				const cls = b[i] >> 4;
				const id = b[i] & 15;
				const counts = b.subarray(i + 1, i + 17);
				const n = counts.reduce((a, c) => a + c, 0);
				(cls ? ac : dc)[id] = huffman(counts, b.subarray(i + 17, i + 17 + n));
				i += 17 + n;
			}
		} else if (m === 0xc0 || m === 0xc1) {
			const comps = [];
			for (let k = 0; k < b[s + 5]; k++) {
				const o = s + 6 + k * 3;
				comps.push({ id: b[o], h: b[o + 1] >> 4, v: b[o + 1] & 15, q: b[o + 2] });
			}
			frame = { height: u16(s + 1), width: u16(s + 3), comps };
		} else if (m >= 0xc2 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
			throw new Error("a JPEG not baseline (progressive or lossless)");
		} else if (m === 0xdd) {
			restart = u16(s);
		} else if (m === 0xda) {
			if (!frame) throw new Error("a JPEG scan before its frame");
			for (let k = 0; k < b[s]; k++) {
				const c = frame.comps.find((x) => x.id === b[s + 1 + k * 2]);
				c.dc = dc[b[s + 2 + k * 2] >> 4];
				c.ac = ac[b[s + 2 + k * 2] & 15];
			}
			p = scan(b, e, frame, quant, restart);
			continue;
		}
		p = e;
	}
	if (!frame) throw new Error("a JPEG without a frame");
	return pixels(frame);
}

/** The scan's blocks decoded into each component's samples; where it ends. */
function scan(b, start, frame, quant, restart) {
	const hmax = Math.max(...frame.comps.map((c) => c.h));
	const vmax = Math.max(...frame.comps.map((c) => c.v));
	const mcuX = Math.ceil(frame.width / (8 * hmax));
	const mcuY = Math.ceil(frame.height / (8 * vmax));
	for (const c of frame.comps) {
		c.w = mcuX * c.h * 8;
		c.hgt = mcuY * c.v * 8;
		c.out = new Uint8Array(c.w * c.hgt);
		c.pred = 0;
	}
	let p = start;
	let bits = 0;
	let nbits = 0;
	const bit = () => {
		if (!nbits) {
			let x = b[p++];
			if (x === 0xff) {
				// (a stuffed 0xff its zero skipped; a marker not read past: nothing but zeros there)
				if (b[p] === 0) p++;
				else {
					p--;
					x = 0;
				}
			}
			bits = x;
			nbits = 8;
		}
		nbits--;
		return (bits >> nbits) & 1;
	};
	const receive = (n) => {
		let v = 0;
		for (let i = 0; i < n; i++) v = (v << 1) | bit();
		return v;
	};
	const extend = (v, n) => (n && v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
	const decode = (t) => {
		let code = 0;
		for (let len = 1; len <= 16; len++) {
			code = (code << 1) | bit();
			if (t.max[len] >= 0 && code <= t.max[len]) return t.symbols[t.at[len] + code - t.first[len]];
		}
		throw new Error("a JPEG code not in its table");
	};
	const coef = new Float32Array(64);
	const tmp = new Float32Array(64);
	const block = (c, bx, by) => {
		coef.fill(0);
		const q = quant[c.q];
		const s = decode(c.dc);
		c.pred += extend(receive(s), s);
		coef[0] = c.pred * q[0];
		for (let k = 1; k < 64; ) {
			const rs = decode(c.ac);
			const r = rs >> 4;
			const n = rs & 15;
			if (!n) {
				if (r !== 15) break;
				k += 16;
				continue;
			}
			k += r;
			if (k > 63) break;
			coef[ZIGZAG[k]] = extend(receive(n), n) * q[ZIGZAG[k]];
			k++;
		}
		// (the inverse DCT, rows then columns)
		for (let y = 0; y < 8; y++)
			for (let x = 0; x < 8; x++) {
				let sum = 0;
				for (let u = 0; u < 8; u++) sum += COS[x * 8 + u] * coef[y * 8 + u];
				tmp[y * 8 + x] = sum / 2;
			}
		for (let x = 0; x < 8; x++)
			for (let y = 0; y < 8; y++) {
				let sum = 0;
				for (let v = 0; v < 8; v++) sum += COS[y * 8 + v] * tmp[v * 8 + x];
				const val = Math.round(sum / 2 + 128);
				c.out[(by + y) * c.w + bx + x] = Math.max(0, Math.min(255, val));
			}
	};
	const single = frame.comps.length === 1;
	const total = single ? Math.ceil(frame.width / 8) * Math.ceil(frame.height / 8) : mcuX * mcuY;
	for (let n = 0; n < total; n++) {
		if (restart && n && n % restart === 0) {
			// (a restart: the bits left dropped, past its marker, each DC from 0 again)
			nbits = 0;
			while (p < b.length && !(b[p] === 0xff && b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7)) p++;
			p += 2;
			for (const c of frame.comps) c.pred = 0;
		}
		if (single) {
			const c = frame.comps[0];
			const per = Math.ceil(frame.width / 8);
			block(c, (n % per) * 8, Math.floor(n / per) * 8);
			continue;
		}
		const mx = n % mcuX;
		const my = Math.floor(n / mcuX);
		for (const c of frame.comps) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, (mx * c.h + h) * 8, (my * c.v + v) * 8);
	}
	// (on to the marker after the scan's data)
	while (p < b.length && !(b[p] === 0xff && b[p + 1] !== 0 && !(b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7))) p++;
	frame.hmax = hmax;
	frame.vmax = vmax;
	return p;
}

/** The components' samples as RGBA pixels (YCbCr made RGB; a component sampled less, stretched). */
function pixels(frame) {
	const { width, height, comps } = frame;
	const data = new Uint8Array(width * height * 4);
	const at = (c, x, y) => c.out[Math.floor((y * c.v) / frame.vmax) * c.w + Math.floor((x * c.h) / frame.hmax)];
	const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			const Y = at(comps[0], x, y);
			if (comps.length < 3) {
				data[o] = Y;
				data[o + 1] = Y;
				data[o + 2] = Y;
			} else {
				const cb = at(comps[1], x, y) - 128;
				const cr = at(comps[2], x, y) - 128;
				data[o] = clamp(Y + 1.402 * cr);
				data[o + 1] = clamp(Y - 0.344136 * cb - 0.714136 * cr);
				data[o + 2] = clamp(Y + 1.772 * cb);
			}
			data[o + 3] = 255;
		}
	return { width, height, data };
}
