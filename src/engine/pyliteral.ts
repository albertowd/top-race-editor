// A Python literal's text as data (what ast.literal_eval reads): dicts, lists and tuples (as lists), strings, numbers, True, False, None. Blender writes a
// custom property it cannot hold as such (a dict of lists, say) as the Python text of it; the track's tools read it back so.

export type PyValue = null | boolean | number | string | PyValue[] | { [k: string]: PyValue };

/** A number's text at the start: its sign, its digits (with a point, or from one) and its exponent. */
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
/** inf or nan at the start, signed or not. */
const NOT_A_NUMBER = /^[-+]?(?:inf|nan)/;

export function parsePyLiteral(text: string): PyValue {
	let p = 0;
	const fail = (what: string): never => {
		throw new SyntaxError(`${what} at ${p} in a Python literal`);
	};
	const space = () => {
		while (p < text.length && /\s/.test(text[p] as string)) p++;
	};
	const value = (): PyValue => {
		space();
		const c = text[p];
		if (c === "{") return dict();
		if (c === "[" || c === "(") return list(c === "[" ? "]" : ")");
		if (c === "'" || c === '"') return string();
		for (const [word, v] of [
			["True", true],
			["False", false],
			["None", null],
		] as const)
			if (text.startsWith(word, p)) {
				p += word.length;
				return v;
			}
		const rest = text.slice(p);
		const m = NUMBER.exec(rest) ?? NOT_A_NUMBER.exec(rest);
		if (!m) return fail("no value");
		p += m[0].length;
		return Number(m[0].replace("inf", "Infinity").replace("nan", "NaN"));
	};
	const items = (close: string, one: () => void) => {
		p++;
		space();
		while (text[p] !== close) {
			one();
			space();
			if (text[p] === ",") {
				p++;
				space();
			} else if (text[p] !== close) fail(`no , or ${close}`);
		}
		p++;
	};
	const list = (close: string): PyValue[] => {
		const out: PyValue[] = [];
		items(close, () => out.push(value()));
		return out;
	};
	const dict = (): { [k: string]: PyValue } => {
		const out: { [k: string]: PyValue } = {};
		items("}", () => {
			const k = value();
			space();
			if (text[p] !== ":") fail("no :");
			p++;
			out[String(k as string | number | boolean | null)] = value();
		});
		return out;
	};
	const ESC: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0" };
	const string = (): string => {
		const q = text[p++] as string;
		let s = "";
		while (p < text.length && text[p] !== q) {
			const c = text[p++] as string;
			if (c !== "\\") s += c;
			else {
				const e = text[p++] as string;
				if (e === "x" || e === "u") {
					const n = e === "x" ? 2 : 4;
					// (its 16 bits, as one UTF-16 unit: what is no hex, 0)
					s += String.fromCodePoint(Number.parseInt(text.slice(p, p + n), 16) & 0xffff);
					p += n;
				} else s += ESC[e] ?? `\\${e}`;
			}
		}
		if (text[p] !== q) fail("no end to a string");
		p++;
		return s;
	};
	const out = value();
	space();
	if (p !== text.length) fail("more after the value");
	return out;
}
