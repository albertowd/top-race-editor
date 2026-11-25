// A placed object's own lights (a light pole's): its model's lights (the catalogue's, each of a series of source/lights.json) as they are, unless the object
// says otherwise of one: not lit, or its strength, colour or range its own. The object keeps only what differs from its series (objects.json's `lights`, by
// each light's place among its model's lights: {"1": {"on": false}}); the build lays each light as its object says (trackobjects.ts), and the games' builds
// make a series of each light changed so (aclights.ts).

/** A light of an object as the object has it, where it is not as its series is: off, or its own values. */
export interface LightOption {
	/** false: not lit (lit: not kept) */
	on?: boolean;
	/** its strength, as its series' (a multiplier of its colour) */
	strength?: number;
	/** red, green, blue: 0 to 1 */
	colour?: [number, number, number];
	/** metres it reaches */
	range?: number;
}

/** An object's lights that are not as their series: by the light's place among its model's lights ("0", "1"...). */
export type LightOptions = Record<string, LightOption>;

/** What of a light can be its own: its series' values (source/lights.json). */
export interface LightSeries {
	colour: number[];
	strength?: number;
	range?: number;
	spot?: number;
	sharpness?: number;
	facing?: number[];
	night_only?: boolean;
}

/** a series' strength and range where it does not say (the AC config's) */
export const STRENGTH = 1;
export const RANGE = 50;

/** A light's values: its own where its object says, else its series'. */
export function lightValues(
	series: LightSeries | undefined,
	option: LightOption | undefined,
): { on: boolean; strength: number; colour: [number, number, number]; range: number } {
	const c = series?.colour ?? [1, 1, 1];
	return {
		on: option?.on !== false,
		strength: option?.strength ?? series?.strength ?? STRENGTH,
		colour: option?.colour ?? [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1],
		range: option?.range ?? series?.range ?? RANGE,
	};
}

const sameColour = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** An object's lights with one of them (k) changed (a value undefined: back to its series'); each value its series' left out, a light as its series is left
 * out, none left out: undefined. */
export function withLightOption(
	options: LightOptions | undefined,
	k: number,
	change: Partial<Record<keyof LightOption, unknown>>,
	series: LightSeries | undefined,
): LightOptions | undefined {
	const was = options?.[String(k)] ?? {};
	const next: LightOption = { ...was };
	for (const [key, v] of Object.entries(change) as [keyof LightOption, unknown][]) {
		if (v === undefined || v === null) delete next[key];
		else (next as Record<string, unknown>)[key] = v;
	}
	const own = lightValues(series, undefined);
	if (next.on !== false) delete next.on;
	if (next.strength === own.strength) delete next.strength;
	if (next.range === own.range) delete next.range;
	if (next.colour && sameColour(next.colour, own.colour)) delete next.colour;
	const out: LightOptions = { ...options };
	if (Object.keys(next).length) out[String(k)] = next;
	else delete out[String(k)];
	return Object.keys(out).length ? out : undefined;
}

/** A model's lights as an object has them: those it has off left out, the rest with its own values (as given: the series' where it says nothing). */
export function objectLit<L extends object>(lights: readonly L[], options: LightOptions | null | undefined): (L & Omit<LightOption, "on">)[] {
	const out: (L & Omit<LightOption, "on">)[] = [];
	lights.forEach((l, k) => {
		const o = options?.[String(k)];
		if (o?.on === false) return;
		const own: Omit<LightOption, "on"> = {};
		if (o?.strength !== undefined) own.strength = o.strength;
		if (o?.colour !== undefined) own.colour = [...o.colour];
		if (o?.range !== undefined) own.range = o.range;
		out.push({ ...l, ...own });
	});
	return out;
}

export class LightOptionsError extends Error {}

const numberOf = (v: unknown): number | null => {
	if (typeof v === "boolean" || v === null || v === undefined) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/** An object's lights checked (where: its place in the objects, for what is wrong): each light's place a whole number, on a boolean (only off kept), strength 0
 * or more, range more than 0, colour three numbers 0 to 1; each light with nothing of its own left out, in the order of their places; none: undefined. Each
 * number given to round. */
export function cleanLightOptions<N>(v: unknown, where: string, round: (x: number) => N): Record<string, Record<string, unknown>> | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v !== "object" || Array.isArray(v)) throw new LightOptionsError(`${where}: {"<light>": {on, strength, colour, range}}`);
	const out: Record<string, Record<string, unknown>> = {};
	const keys = Object.keys(v).sort((a, b) => Number(a) - Number(b));
	for (const key of keys) {
		const w = `${where}.${key}`;
		if (!/^\d+$/.test(key)) throw new LightOptionsError(`${w}: a light's place among its model's lights (0, 1...)`);
		const o = (v as Record<string, unknown>)[key];
		if (!o || typeof o !== "object" || Array.isArray(o)) throw new LightOptionsError(`${w}: {on, strength, colour, range}`);
		const one = cleanLight(o as Record<string, unknown>, w, round);
		if (Object.keys(one).length) out[key] = one;
	}
	return Object.keys(out).length ? out : undefined;
}

/** A light's options checked (w: where it is, for what is wrong): on, strength, colour and range, each it gives (only off kept), each number given to round. */
function cleanLight<N>(L: Record<string, unknown>, w: string, round: (x: number) => N): Record<string, unknown> {
	const one: Record<string, unknown> = {};
	if (L.on !== undefined && L.on !== null) {
		if (typeof L.on !== "boolean") throw new LightOptionsError(`${w}.on: true or false`);
		if (!L.on) one.on = false;
	}
	if (L.strength !== undefined && L.strength !== null) one.strength = round(strengthOf(L.strength, w));
	if (L.colour !== undefined && L.colour !== null) one.colour = colourOf(L.colour, w).map((x) => round(x));
	if (L.range !== undefined && L.range !== null) {
		const r = numberOf(L.range);
		if (r === null || r <= 0) throw new LightOptionsError(`${w}.range: metres, more than 0`);
		one.range = round(r);
	}
	return one;
}

/** A light's strength checked: a number, 0 or more. */
function strengthOf(v: unknown, w: string): number {
	const s = numberOf(v);
	if (s === null || s < 0) throw new LightOptionsError(`${w}.strength: a number, 0 or more`);
	return s;
}

/** A light's colour checked: three numbers, each 0 to 1. */
function colourOf(c: unknown, w: string): number[] {
	const ok = Array.isArray(c) && c.length === 3 && c.every((x) => (numberOf(x) ?? -1) >= 0 && (numberOf(x) ?? 2) <= 1);
	if (!ok) throw new LightOptionsError(`${w}.colour: [red, green, blue], each 0 to 1`);
	return (c as unknown[]).map((x) => numberOf(x) as number);
}

/** The track's light series (source/lights.json's `series`), as plain numbers; none where it has no such file. */
export async function lightSeriesOf(
	files: { exists(p: string): Promise<boolean>; read(p: string): Promise<Uint8Array> },
	project: string,
): Promise<Record<string, LightSeries>> {
	const at = `${project}/source/lights.json`;
	if (!(await files.exists(at))) return {};
	const doc = JSON.parse(new TextDecoder().decode(await files.read(at))) as { series?: Record<string, LightSeries> };
	return doc.series ?? {};
}
