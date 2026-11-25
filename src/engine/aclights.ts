// Assetto Corsa's Custom Shaders Patch config (extension/ext_config.ini) as the track's AC build makes it (its ac_lights.py, on track_lights.py's data): AC's
// own settings as kept in source/track/extension/ext_config.ini, its grass on the meshes the models say it grows on too (extras.track `grass`), then what the
// track's data has (TRACK_FORMAT.md, "Lights and screens"): each light series as a LIGHT_SERIES with its lights, each material that glows only at night and
// each with a night response as a MATERIAL_ADJUSTMENT, each screen as a SCRIPTABLE_DISPLAY (its script the editor's, models/scripts/ac/screens/<shows>.lua, the
// screen's data, the track's, put in for its `-- @data` line).
//
// The numbers are written as the Python writes them: a float of the files by %g, an integer as it is.

import type { Kx, MaterialLibrary } from "./gltf";
import { byCodePoint } from "./order";
import type { HostFiles } from "./placehost";
import { dumpPyJson, type PyJson, PyNumber, plain, readPyJson } from "./pyjson";
import { pyRound } from "./trackfiles";

/** the config, in the built track */
export const AC_LIGHTS = "extension/ext_config.ini";

type J = { [k: string]: PyJson };

/** A text without the run of c (one character) at its end. */
function trimEnd(s: string, c: string): string {
	let end = s.length;
	while (end > 0 && s[end - 1] === c) end--;
	return s.slice(0, end);
}

/** A number's digits without the zeros after its point, nor the point where nothing is left after it. */
function trimZeros(s: string): string {
	if (!s.includes(".")) return s;
	const t = trimEnd(s, "0");
	return t.endsWith(".") ? t.slice(0, -1) : t;
}

/** Python's '%g' of a float: 6 significant digits, exponent form below 1e-4 and from 1e6, no trailing zeros. */
export function pyG(x: number): string {
	if (Number.isNaN(x)) return "nan";
	if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
	if (x === 0) return Object.is(x, -0) ? "-0" : "0";
	const [m, e] = x.toExponential(5).split("e") as [string, string];
	const exp = Number(e);
	if (exp < -4 || exp >= 6) return `${trimZeros(m)}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
	return trimZeros(x.toFixed(5 - exp));
}

/** A value as ac_lights' num: a float by %g, anything else as Python's str. */
function num(v: PyJson | undefined): string {
	if (v instanceof PyNumber) return /[.eEnN]/.test(v.text) ? pyG(v.value) : v.text;
	if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyG(v);
	if (typeof v === "boolean") return v ? "True" : "False";
	if (typeof v === "object" && v !== null) return JSON.stringify(v);
	return String(v);
}

const nums = (v: PyJson[]) => v.map(num).join(", ");

/** Python's '%.3f' (its tie to the even, its sign kept for a negative that rounds to 0). */
const f3 = (v: PyJson) => {
	const x = Number(v);
	const r = pyRound(Math.abs(x), 3).toFixed(3);
	return x < 0 || Object.is(x, -0) ? `-${r}` : r;
};

/** Python's '%d' of a number (its whole part). */
const d = (v: PyJson | undefined) => String(Math.trunc(Number(v)));

const isList = (v: unknown): v is PyJson[] => Array.isArray(v);
const isDict = (v: unknown): v is J => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof PyNumber);
/** Python's truth of a value */
function truthy(v: unknown): boolean {
	if (isList(v)) return v.length > 0;
	if (isDict(v)) return Object.keys(v).length > 0;
	if (v instanceof PyNumber) return v.value !== 0;
	return !!v;
}

/** A list of lists as Lua: a table of one row a line. */
const luaRows = (list: PyJson[]) => list.map((x) => `{${(x as PyJson[]).map(lua).join(",")}}`).join(",\n");

/** A string as Lua: quoted, its backslashes and double quotes escaped, its single quotes made backticks. */
function luaString(v: string): string {
	const escaped = v.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`).replaceAll("'", "`");
	return `"${escaped}"`;
}

/** A JSON value as Lua: lists as tables (a list of lists one row a line), strings quoted. */
export function lua(v: PyJson): string {
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "string") return luaString(v);
	if (typeof v === "number" || v instanceof PyNumber) return num(v);
	if (isDict(v))
		return `{ ${Object.entries(v)
			.map(([k, x]) => `${k} = ${lua(x)}`)
			.join(", ")} }`;
	const list = v as PyJson[];
	if (list.length && list.every(isList)) return `{\n${luaRows(list)}\n}`;
	return `{ ${list.map(lua).join(", ")} }`;
}

/** The track's lights and screens (track_lights.data): source/lights.json's, then the made ones' (the layouts' places' `lights`: the catalogue's models' own,
 * the buildings' among them), in that order. */
export interface LightsData {
	series: J;
	lights: J[];
	screens: J[];
}

const readJson = async (files: HostFiles, p: string): Promise<J> =>
	(await files.exists(p)) ? (readPyJson(new TextDecoder().decode(await files.read(p))) as J) : {};

/** The lights and screens of a track (made: the folder of the models its steps make; places: its places.json as given, else read there). */
export async function lightsData(
	files: HostFiles,
	project: string,
	made: string,
	places?: { lights?: unknown; screens?: unknown } | null,
): Promise<LightsData> {
	const src = await readJson(files, `${project}/source/lights.json`);
	const out: LightsData = {
		series: { ...(src.series as J | undefined) },
		lights: [...((src.lights as J[]) ?? [])],
		screens: [...((src.screens as J[]) ?? [])],
	};
	const placed = places !== undefined ? ((places ?? {}) as J) : await readJson(files, `${made}/places.json`);
	// (the buildings' lights_outside.json no longer: their lamps are their catalogue models' own, their screens source/lights.json's)
	out.lights.push(...((placed.lights as J[] | undefined) ?? []));
	out.screens.push(...((placed.screens as J[] | undefined) ?? []));
	return out;
}

/** what of a light its object may make its own (lightoptions.ts), its series' otherwise */
const OWN = ["colour", "strength", "range"] as const;

const given = (v: PyJson | undefined): v is PyJson => v !== undefined && v !== null;

/** A light's own values (its object's), as a key: '' for none (it shines as its series). */
const ownKey = (L: J) => (OWN.some((k) => given(L[k])) ? JSON.stringify(OWN.map((k) => (given(L[k]) ? plain(L[k] as PyJson) : null))) : "");

/** Each light series as AC's LIGHT_SERIES, with its lights, in source/lights.json's order; then, series by series, the lights their objects made their own
 * (their colour, strength or range): a series of their own for each such values, as their series is but those. */
function series(dt: LightsData): string[] {
	const entries = Object.entries(dt.series);
	const out = entries.map(([name, s0], i) =>
		section(
			i,
			name,
			s0 as J,
			dt.lights.filter((L) => L.series === name && !ownKey(L)),
		),
	);
	for (const [name, s0] of entries)
		for (const lights of ownGroups(dt.lights, name).values()) {
			const { s, changed } = ownSeries(s0 as J, lights[0] as J);
			out.push(section(out.length, `${name}, its own ${changed.join(", ")}`, s, lights));
		}
	return out;
}

/** The lights of a series their objects made their own, by their own values (ownKey), in the order first met. */
function ownGroups(lights: J[], name: string): Map<string, J[]> {
	const groups = new Map<string, J[]>();
	for (const L of lights) {
		const key = L.series === name ? ownKey(L) : "";
		if (key) groups.set(key, [...(groups.get(key) ?? []), L]);
	}
	return groups;
}

/** A series as its lights' objects made it their own (those of first, as all of them): its values, and what of them changed, as its description says. */
function ownSeries(s0: J, first: J): { s: J; changed: string[] } {
	const s: J = { ...s0 };
	const changed: string[] = [];
	for (const k of OWN) {
		const v = first[k];
		if (!given(v)) continue;
		s[k] = v;
		changed.push(`${k} ${isList(v) ? nums(v) : num(v)}`);
	}
	return { s, changed };
}

/** A series as AC's LIGHT_SERIES (its place among them i), with its lights. */
function section(i: number, name: string, s: J, lights: J[]): string {
	const rows = [
		`[LIGHT_SERIES_${i}]`,
		"ACTIVE = 1",
		`DESCRIPTION = ${name}`,
		`COLOR = ${nums(s.colour as PyJson[])}, ${num(s.strength ?? new PyNumber(1, "1.0"))}`,
	];
	if (truthy(s.facing)) rows.push(`DIRECTION = ${nums(s.facing as PyJson[])}`);
	rows.push(`SPOT = ${num(s.spot ?? 180)}`);
	if ("sharpness" in s) rows.push(`SPOT_SHARPNESS = ${num(s.sharpness)}`);
	rows.push(`RANGE = ${num(s.range ?? 50)}`);
	for (const [k, v] of Object.entries(((s.targets as J | undefined)?.ac as J | undefined) ?? {})) rows.push(`${k} = ${isList(v) ? nums(v) : num(v)}`);
	if (truthy(s.night_only)) rows.push("CONDITION = NIGHT_SMOOTH");
	lights.forEach((L, k) => {
		rows.push(`POSITION_${k} = ${(L.at as PyJson[]).map(f3).join(", ")}`);
		if (truthy(L.facing)) rows.push(`DIRECTION_${k} = ${(L.facing as PyJson[]).map(f3).join(", ")}`);
	});
	return rows.join("\n");
}

/** np.round / round(): halves to the even */
const roundEven = (v: number) => {
	const r = Math.round(v);
	return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

function adjustments(lib: J): string[] {
	const out: string[] = [];
	for (const [name, m0] of Object.entries(lib)) {
		const m = m0 as J;
		if (truthy(m.glow) && truthy(m.night_only)) {
			const c = (m.glow as PyJson[]).map((x) => String(roundEven(Number(x) * 255)));
			out.push(
				[
					"[MATERIAL_ADJUSTMENT_...]",
					"ACTIVE = 1",
					`DESCRIPTION = ${name} glows at night`,
					`MATERIALS = ${name}`,
					"CONDITION = NIGHT_SMOOTH",
					"KEY_0 = ksEmissive",
					`VALUE_0 = ${c.join(", ")}, ${pyG(Number(m.glow_strength ?? 1))}`,
					"VALUE_0_OFF = 0, 0, 0",
				].join("\n"),
			);
		}
	}
	const groups = new Map<string, { night: J; names: string[] }>();
	for (const [name, m] of Object.entries(lib)) {
		const night = (((m as J).targets as J | undefined)?.ac as J | undefined)?.night;
		if (truthy(night)) {
			const key = dumpPyJson(night);
			const g = groups.get(key) ?? { night: night as J, names: [] };
			g.names.push(name);
			groups.set(key, g);
		}
	}
	for (const { night, names } of groups.values()) {
		const rows = [
			"[MATERIAL_ADJUSTMENT_...]",
			"ACTIVE = 1",
			`DESCRIPTION = Night response: ${names.join(", ")}`,
			`MATERIALS = ${names.join(", ")}`,
			"CONDITION = NIGHT_SMOOTH",
		];
		Object.entries(night).forEach(([k, v], i) => {
			const [atNight, byDay] = v as PyJson[];
			rows.push(`KEY_${i} = ${k}`, `VALUE_${i} = ${num(atNight)}`, `VALUE_${i}_OFF = ${num(byDay)}`);
		});
		out.push(rows.join("\n"));
	}
	return out;
}

/** A text as Python reads it (universal newlines). */
const lines = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\r\n?/g, "\n");

async function screens(files: HostFiles, scripts: string, dt: LightsData, lib: J): Promise<string[]> {
	const out: string[] = [];
	for (const sc of dt.screens) {
		const [w, h] = sc.pixels as PyJson[];
		const [x, y, aw, ah] = truthy(sc.area) ? (sc.area as PyJson[]) : [0, 0, w as PyJson, h as PyJson];
		const shows = sc.shows as string;
		const material = sc.material as string;
		const file = `${scripts}/ac/screens/${shows}.lua`;
		const text = trimEnd(lines(await files.read(file)), "\n");
		const data = Object.entries(truthy(sc.data) ? (sc.data as J) : {})
			.map(([k, v]) => `local ${k.toUpperCase()} = ${lua(v)}`)
			.join("\n");
		// (its data put in for its -- @data line; its comment lines left out: CSP takes the script between single quotes, with no way to write one inside, so a
		// comment's apostrophe would end it early ("unfinished string"))
		const script = text
			.split("-- @data")
			.join(data)
			.split("\n")
			.filter((l) => !/^\s*--/.test(l))
			.join("\n");
		const quote = script.split("\n").find((l) => l.includes("'"));
		if (quote !== undefined) throw new Error(`the ${shows} screen's script has an apostrophe, which ends the AC config's quoted script: ${quote.trim()}`);
		out.push(
			[
				"[SCRIPTABLE_DISPLAY_...]",
				`MATERIALS = ${material}`,
				`RESOLUTION = ${d(w)}, ${d(h)}`,
				`DISPLAY_POS = ${d(x)}, ${d(y)}`,
				`DISPLAY_SIZE = ${d(aw)}, ${d(ah)}`,
				"SCRIPT = '",
				`${script}'`,
				`BACKGROUND = ${nums((sc.background as PyJson[] | undefined) ?? [0, 0, 0])}, 1`,
			].join("\n"),
		);
		if (truthy((lib[material] as J | undefined)?.glow))
			out.push(
				[
					"[CustomEmissive]",
					"ACTIVE = 1",
					`DESCRIPTION = ${material} glows as drawn`,
					`MATERIALS = ${material}`,
					`Resolution = ${d(w)}, ${d(h)}`,
					`@ = CustomEmissive_Rect, Channel = 0, Start = "${d(x)}, ${d(y)}", Size = "${d(aw)}, ${d(ah)}", CornerRadius = 0.0`,
				].join("\n"),
			);
	}
	return out;
}

/** The meshes grass grows on (extras.track `grass`) in the models (.glb) of a folder, by AC's names. */
export async function grassMeshes(files: HostFiles, models: string, library: MaterialLibrary): Promise<string[]> {
	const out: string[] = [];
	for (const f of (await files.list(models)).filter((n) => n.endsWith(".glb")).sort(byCodePoint)) {
		const b = await files.read(`${models}/${f}`);
		const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(12, true);
		const g = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + n))) as {
			nodes?: { name: string; extras?: { track?: Kx } }[];
		};
		for (const node of g.nodes ?? []) {
			const track = node.extras?.track ?? {};
			if (track.grass && library.nodeIn) out.push(library.nodeIn(node.name, track, {})[0]);
		}
	}
	return out;
}

/** The whole config: AC's own settings (grass also on the meshes the models of the folder models say it grows on), then the lights, the materials' night and
 * the screens. */
export async function acLightsText(
	files: HostFiles,
	project: string,
	models: string,
	library: MaterialLibrary,
	dt: LightsData,
	/** the editor's scripts (models/scripts): each screen's, ac/screens/<shows>.lua */
	scripts: string,
): Promise<string> {
	let base = trimEnd(lines(await files.read(`${project}/source/track/extension/ext_config.ini`)), "\n");
	const lib = ((await readJson(files, `${project}/source/materials.json`)).materials as J | undefined) ?? {};
	// (grass on the meshes the models say it grows on; kept off the materials that cover it: the library's covers_grass, in its order; each after what AC's own
	// settings name already)
	const lists: [string, string[]][] = [
		["GRASS_MESHES", await grassMeshes(files, models, library)],
		["OCCLUDING_MATERIALS", Object.entries(lib).flatMap(([n, x]) => ((x as J | null)?.covers_grass ? [n] : []))],
	];
	for (const [key, more] of lists) {
		const m = new RegExp(`^${key} *= *(.*)$`, "m").exec(base);
		if (!m || !more.length) continue;
		const have = (m[1] as string)
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean);
		const start = m.index + m[0].length - (m[1] as string).length;
		base =
			base.slice(0, start) +
			// (each name once: a mesh cut in pieces has its name on each)
			[...new Set([...have, ...more])].join(", ") +
			base.slice(m.index + m[0].length);
	}
	const parts = [
		base,
		"; ---- Lights, night materials and screens, from source/lights.json and materials.json ----",
		...series(dt),
		...adjustments(lib),
		...(await screens(files, scripts, dt, lib)),
	];
	return `${parts.join("\n\n")}\n`;
}
