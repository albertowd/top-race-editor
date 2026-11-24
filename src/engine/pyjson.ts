// JSON as Python's json module reads and writes it, so a file the track's tools wrote comes back byte for byte when written again: a number keeps the text it
// was read with (4.0 stays 4.0, not 4), a new one is written as Python would (repr: 1e-05, not 0.00001; an integer as it is); non-ASCII escaped (ensure_ascii);
// json.dumps' separators and indent.

/** A number as it was read: its value, and the text it was written with. */
export class PyNumber {
	constructor(
		readonly value: number,
		readonly text: string,
	) {}

	valueOf(): number {
		return this.value;
	}

	toJSON(): number {
		return this.value;
	}
}

export type PyJson = null | boolean | number | PyNumber | string | PyJson[] | { [k: string]: PyJson };

/** JSON read, each number kept with its text (PyNumber). */
export function readPyJson(text: string): PyJson {
	return JSON.parse(text, (_k, v, ctx?: { source?: string }) => (typeof v === "number" ? new PyNumber(v, ctx?.source ?? String(v)) : v)) as PyJson;
}

/** A value with its numbers plain again (PyNumber: its value). */
export function plain(v: PyJson): unknown {
	if (v instanceof PyNumber) return v.value;
	if (ArrayBuffer.isView(v)) return v;
	if (Array.isArray(v)) return v.map(plain);
	if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
	return v;
}

/** Python's repr of a float: its shortest digits, in exponent form below 1e-4 and from 1e16 (two-digit exponent). */
export function pyFloat(n: number): string {
	if (Number.isNaN(n)) return "NaN";
	if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
	if (Number.isInteger(n) && Math.abs(n) < 1e16) return `${n}.0`;
	const a = Math.abs(n);
	if (a !== 0 && (a < 1e-4 || a >= 1e16)) {
		const [m, e] = n.toExponential().split("e") as [string, string];
		const sign = e.startsWith("-") ? "-" : "+";
		const digits = e.replace(/^[+-]/, "");
		return `${m}e${sign}${digits.padStart(2, "0")}`;
	}
	return String(n);
}

/** A number as Python writes it: an integer as one (the page's numbers come as JSON, read by Python as int where whole), else as its float's repr. */
const pyNumber = (n: number) => (Number.isInteger(n) && Math.abs(n) < 2 ** 53 ? String(n) : pyFloat(n));

/** A string as json.dumps writes it (ensure_ascii; or, not, only what JSON must have escaped). */
function pyStringOf(s: string, ascii = true): string {
	let out = '"';
	for (const ch of s) {
		const c = ch.codePointAt(0) as number;
		if (ch === '"') out += '\\"';
		else if (ch === "\\") out += "\\\\";
		else if (ch === "\n") out += "\\n";
		else if (ch === "\r") out += "\\r";
		else if (ch === "\t") out += "\\t";
		else if (ch === "\b") out += "\\b";
		else if (ch === "\f") out += "\\f";
		else if (c < 0x20 || (ascii && c > 0x7e)) {
			// (a character past the BMP as its surrogate pair, each escaped)
			const units = c > 0xffff ? [0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)] : [c];
			for (const u of units) out += `\\u${u.toString(16).padStart(4, "0")}`;
		} else out += ch;
	}
	return `${out}"`;
}

/** How json.dumps is asked to write: ensure_ascii (true unless false), its separators (between items, after a key). */
export interface PyDumps {
	ascii?: boolean;
	separators?: [string, string];
}

/** A value as json.dumps(value, indent=indent) writes it (indent undefined: on one line, ', ' and ': '). */
export function dumpPyJson(v: PyJson | unknown, indent?: number, opts: PyDumps = {}): string {
	const nl = (depth: number) => (indent === undefined ? "" : `\n${" ".repeat(indent * depth)}`);
	const sep = opts.separators?.[0] ?? (indent === undefined ? ", " : ",");
	const colon = opts.separators?.[1] ?? ": ";
	const pyString = (s: string) => pyStringOf(s, opts.ascii ?? true);
	const go = (x: unknown, depth: number): string => {
		if (x === null || x === undefined) return "null";
		if (x instanceof PyNumber) return x.text;
		if (typeof x === "boolean") return x ? "true" : "false";
		if (typeof x === "number") return pyNumber(x);
		if (typeof x === "string") return pyString(x);
		if (Array.isArray(x)) {
			if (!x.length) return "[]";
			return `[${x.map((y) => nl(depth + 1) + go(y, depth + 1)).join(sep)}${nl(depth)}]`;
		}
		const entries = Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined);
		if (!entries.length) return "{}";
		return `{${entries.map(([k, y]) => `${nl(depth + 1)}${pyString(k)}${colon}${go(y, depth + 1)}`).join(sep)}${nl(depth)}}`;
	};
	return go(v, 0);
}
