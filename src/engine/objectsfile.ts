// A track's objects file (objects.json, version 3) as the engine reads and writes it: read for the page as it is; the page's checked, rounded and written back,
// the file before kept. A file of version 2 read as version 3 (written so when saved); a track without the file has its objects read from its models (seeded),
// so saving them as read moves nothing.
import { legacyCurve } from "../editing/marks";
import { cleanLightOptions, LightOptionsError } from "./lightoptions";
import { byCodePoint } from "./order";
import type { HostFiles } from "./placehost";
import { type PyJson, PyNumber, pyFloat, readPyJson } from "./pyjson";
import { backup, pyRound, writePyJsonFile } from "./trackfiles";

export const VERSION = 3;
/** decimals kept: millimetres; a heading's */
const ROUND = 3;
const ROUND_HEADING = 4;
const FITS = ["place", "bend"];
/** a single object's: nothing, a box, knocked about, or its model's own walls and surfaces ('model': a building's) */
const SINGLE_COLLISIONS = ["none", "static", "dynamic", "model"];
const CURVE_COLLISIONS = ["none", "wall"];
const MARK_WIDTH = 0.1;
const DASH = 0.5;
const GAP = 0.5;
const COLOURS = ["white", "yellow"];
const STYLES = ["solid", "dotted"];
/** a layout's start line: chequered, or a single solid white line */
const START_LINE_STYLES = ["checker", "line"];

export class ObjectsError extends Error {}

type J = { [k: string]: unknown };
const isObj = (v: unknown): v is J => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof PyNumber);
const num = (v: unknown): number | null => (v instanceof PyNumber ? v.value : typeof v === "number" ? v : null);

/** A float as Python's: written as its repr (10.0, not 10). */
export const f = (x: number) => new PyNumber(x, pyFloat(x));

function _num(v: unknown, where: string): number {
	const n = num(v);
	if (n === null || typeof v === "boolean" || !Number.isFinite(n)) throw new ObjectsError(`${where}: not a number`);
	return n;
}

/** math.remainder(x, tau): x less the nearest whole number of turns (ties to the even). */
export function remainderTau(x: number): number {
	const tau = 2 * Math.PI;
	const q = x / tau;
	let k = Math.round(q);
	if (Math.abs(q % 1) === 0.5 && k % 2 !== 0) k -= 1;
	return x - k * tau;
}

const heading = (v: unknown, where: string) => f(pyRound(remainderTau(_num(v ?? 0, where)), ROUND_HEADING));

function _list(v: unknown, where: string): unknown[] {
	if (v === null || v === undefined) return [];
	if (!Array.isArray(v)) throw new ObjectsError(`${where}: not a list`);
	return v;
}

function _pair(v: unknown, where: string) {
	if (!Array.isArray(v) || v.length !== 2) throw new ObjectsError(`${where}: [x, z]`);
	return [f(pyRound(_num(v[0], where), ROUND)), f(pyRound(_num(v[1], where), ROUND))];
}

function _spot(s: unknown, where: string, withHeading = true): J {
	if (!isObj(s)) throw new ObjectsError(`${where}: not an object`);
	let out: J = { x: f(pyRound(_num(s.x, `${where}.x`), ROUND)), z: f(pyRound(_num(s.z, `${where}.z`), ROUND)) };
	if (withHeading) out.heading = heading(s.heading, `${where}.heading`);
	if ("name" in s) out = { name: String(s.name), ...out };
	return out;
}

function _curve(v: unknown, w: string): J[] {
	const curve = _list(v, `${w}.curve`).map((n, j) => {
		const at = `${w}.curve[${j}]`;
		if (!isObj(n)) throw new ObjectsError(`${at}: {p, in, out}`);
		const node: J = {
			p: _pair(n.p, `${at}.p`),
			in: _pair(n.in ?? [0, 0], `${at}.in`),
			out: _pair(n.out ?? [0, 0], `${at}.out`),
		};
		if (n.corner) node.corner = true;
		return node;
	});
	if (!curve.length) throw new ObjectsError(`${w}.curve: no nodes`);
	return curve;
}

/** Whether a number is a Python int (as the page's JSON reaches Python: whole, written without a point). */
const isInt = (v: unknown) => typeof v !== "boolean" && (v instanceof PyNumber ? !/[.eE]/.test(v.text) : typeof v === "number" && Number.isInteger(v));

function _object(o: unknown, w: string): J {
	if (!isObj(o) || !o.name) throw new ObjectsError(`${w}: {name, model, curve, ...}`);
	const model = o.model;
	if (typeof model !== "string" || !model) throw new ObjectsError(`${w}.model: a model of the catalogue`);
	const curve = _curve(o.curve, w);
	const out: J = { name: String(o.name), model, curve };
	const single = curve.length === 1;
	if (single) out.heading = heading(o.heading, `${w}.heading`);
	else out.closed = Boolean(num(o.closed) ?? o.closed ?? false);
	if (o.spacing !== undefined && o.spacing !== null) {
		const spacing = _num(o.spacing, `${w}.spacing`);
		if (spacing <= 0) throw new ObjectsError(`${w}.spacing: more than 0, please`);
		out.spacing = f(pyRound(spacing, ROUND));
	}
	const rows = o.rows ?? 1;
	if (!isInt(rows) || (num(rows) as number) < 1) throw new ObjectsError(`${w}.rows: a whole number, 1 or more`);
	if (!single) {
		out.rows = num(rows);
		const fit = o.fit ?? "place";
		if (!FITS.includes(fit as string)) throw new ObjectsError(`${w}.fit: ${FITS.join(" or ")}`);
		out.fit = fit;
	}
	const scale = o.scale;
	if (scale !== undefined && scale !== null) {
		if (!Array.isArray(scale) || scale.length !== 3) throw new ObjectsError(`${w}.scale: [across, up, deep], each 1 as the model is`);
		const sc = scale.map((v, i) => pyRound(_num(v, `${w}.scale[${i}]`), ROUND));
		if (sc.some((v) => v <= 0)) throw new ObjectsError(`${w}.scale: more than 0, please`);
		if (sc.some((v) => v !== 1)) out.scale = sc.map(f);
	}
	const allowed = single ? SINGLE_COLLISIONS : CURVE_COLLISIONS;
	const collision = o.collision ?? "none";
	if (!allowed.includes(collision as string)) throw new ObjectsError(`${w}.collision: ${allowed.join(" or ")} for ${single ? "one" : "a curve of them"}`);
	out.collision = collision;
	const layouts = o.layouts;
	if (layouts !== undefined && layouts !== null) {
		if (!Array.isArray(layouts) || !layouts.every((x) => typeof x === "string" && x))
			throw new ObjectsError(`${w}.layouts: a list of layouts' names (none: every layout)`);
		out.layouts = [...new Set(layouts as string[])].sort(byCodePoint);
	}
	// (a board's own text, as its card says it: none, its name's)
	if (o.text !== undefined && o.text !== null) {
		if (typeof o.text !== "string") throw new ObjectsError(`${w}.text: what its card says, as text`);
		const text = o.text.trim();
		if (text.length > 40) throw new ObjectsError(`${w}.text: 40 letters at most, please`);
		if (text) out.text = text;
	}
	// (its own lights: those not as their series are, by their place among its model's lights)
	try {
		const lights = cleanLightOptions(o.lights, `${w}.lights`, (x) => f(pyRound(x, ROUND)));
		if (lights) out.lights = lights;
	} catch (e) {
		throw e instanceof LightOptionsError ? new ObjectsError(e.message) : e;
	}
	return out;
}

/** An area (a car park, a lane): a paved surface of its own shape, laid as a road's top is; its corners in order. */
function _area(a: unknown, w: string): J {
	if (!isObj(a) || !a.name) throw new ObjectsError(`${w}: {name, material, points}`);
	if (typeof a.material !== "string" || !a.material) throw new ObjectsError(`${w}.material: its material's name`);
	const pts = _list(a.points, `${w}.points`);
	if (pts.length < 3) throw new ObjectsError(`${w}.points: three corners at least`);
	return { name: String(a.name), material: a.material, points: pts.map((p, i) => _pair(p, `${w}.points[${i}]`)) };
}

/** A mark's curve: its own, else (as older files have it: from p, length metres along heading) one straight from p. */
function markCurve(m: J, w: string): J[] {
	if (m.curve !== undefined && m.curve !== null) {
		const curve = _curve(m.curve, w);
		if (curve.length < 2) throw new ObjectsError(`${w}.curve: two nodes at least`);
		return curve;
	}
	const length = _num(m.length, `${w}.length`);
	if (length <= 0) throw new ObjectsError(`${w}: its length more than 0, please`);
	const [x, z] = _pair(m.p, `${w}.p`).map(Number) as [number, number];
	return _curve(legacyCurve({ p: [x, z], heading: _num(m.heading ?? 0, `${w}.heading`), length }), w);
}

function _mark(m: unknown, w: string): J {
	if (!isObj(m) || !m.name) throw new ObjectsError(`${w}: {name, curve, width, colour, style}`);
	const curve = markCurve(m, w);
	const width = _num(m.width ?? MARK_WIDTH, `${w}.width`);
	if (width <= 0) throw new ObjectsError(`${w}: its width more than 0, please`);
	const colour = m.colour ?? "white";
	const style = m.style ?? "solid";
	if (!COLOURS.includes(colour as string)) throw new ObjectsError(`${w}.colour: ${COLOURS.join(" or ")}`);
	if (!STYLES.includes(style as string)) throw new ObjectsError(`${w}.style: ${STYLES.join(" or ")}`);
	const out: J = { name: String(m.name), curve };
	if (curve.length > 2 && (num(m.closed) ?? m.closed)) out.closed = true;
	Object.assign(out, { width: f(pyRound(width, ROUND)), colour, style });
	if (style === "dotted")
		for (const [k, d] of [
			["dash", DASH],
			["gap", GAP],
		] as const) {
			const v = _num(m[k] ?? d, `${w}.${k}`);
			if (v <= 0) throw new ObjectsError(`${w}.${k}: more than 0, please`);
			out[k] = f(pyRound(v, ROUND));
		}
	return out;
}

/** a rubber mark's darkness: one of these */
const RUBBER_WEARS = ["almost_new", "used", "very_used"];

/** Rubber laid on the roads: {name, curve (two nodes at least), closed, width (m, more than 0), wear}. */
function _rubber(m: unknown, w: string): J {
	if (!isObj(m) || !m.name) throw new ObjectsError(`${w}: {name, curve, width, wear}`);
	const curve = _curve(m.curve, w);
	if (curve.length < 2) throw new ObjectsError(`${w}.curve: two nodes at least`);
	const width = _num(m.width, `${w}.width`);
	if (width <= 0) throw new ObjectsError(`${w}: its width more than 0, please`);
	if (!RUBBER_WEARS.includes(m.wear as string)) throw new ObjectsError(`${w}.wear: ${RUBBER_WEARS.join(", ")}`);
	const out: J = { name: String(m.name), curve };
	if (curve.length > 2 && (num(m.closed) ?? m.closed)) out.closed = true;
	return Object.assign(out, { width: f(pyRound(width, ROUND)), wear: m.wear });
}

// ---------------------------------------------------------------- version 2, read as version 3

/** a heading as version 2's spots have it: math.remainder(h, tau), 4 decimals (a plain number, to be cleaned again) */
const headingOf = (v: unknown, where: string) => pyRound(remainderTau(_num(v ?? 0, where)), ROUND_HEADING);

/** A spot of version 2 (objects.py's _clean_spot): its numbers plain. */
function spotV2(s: unknown, where: string, withHeading = true): J {
	if (!isObj(s)) throw new ObjectsError(`${where}: not an object`);
	let out: J = { x: pyRound(_num(s.x, `${where}.x`), ROUND), z: pyRound(_num(s.z, `${where}.z`), ROUND) };
	if (withHeading) out.heading = headingOf(s.heading, `${where}.heading`);
	if ("name" in s) out = { name: String(s.name), ...out };
	return out;
}

const POLE_NAME = /^POLE_\d+$/;
/** version 2's scenery, by kind as it had them (its static objects among the sheds): each read as its model alone */
const SCENERY = ["trees", "fences", "sheds", "gantries", "karts"];
/** metres between stacks, a wall of one stack's */
const SPACING = 0.65;
/** metres: a cone or a board this near one of another layout's is that one, in both */
const SAME_PLACE = 0.05;

function wallV2(t: unknown, w: string): J {
	if (!isObj(t) || !t.name) throw new ObjectsError(`${w}: {name, curve, closed, spacing, rows, collision}`);
	const curve = _curve(t.curve, w).map((n) => ({
		...n,
		p: (n.p as PyNumber[]).map(Number),
		in: (n.in as PyNumber[]).map(Number),
		out: (n.out as PyNumber[]).map(Number),
	}));
	const spacing = _num(t.spacing ?? SPACING, `${w}.spacing`);
	if (spacing <= 0) throw new ObjectsError(`${w}.spacing: more than 0, please`);
	const rows = t.rows ?? 1;
	if (!isInt(rows) || (num(rows) as number) < 1) throw new ObjectsError(`${w}.rows: a whole number, 1 or more`);
	return {
		name: String(t.name),
		curve,
		closed: Boolean(num(t.closed) ?? t.closed ?? false),
		spacing: pyRound(spacing, ROUND),
		rows: num(rows),
		collision: Boolean(num(t.collision) ?? t.collision ?? true),
	};
}

/** Objects of version 2 checked and rounded, as they were written (objects.py's clean_v2): what convertV2 makes version 3 of. */
function cleanV2(objects: unknown): J {
	if (!isObj(objects) || !isObj(objects.layouts ?? {})) throw new ObjectsError("objects: {layouts, poles, tyres}");
	const layouts: J = {};
	for (const [name, lay] of Object.entries((objects.layouts ?? {}) as J)) {
		const w = `layouts.${name}`;
		if (!isObj(lay)) throw new ObjectsError(`${w}: not an object`);
		const hot = lay.hotlap;
		const list = (k: string, heading = true) => _list(lay[k], `${w}.${k}`).map((s, i) => spotV2(s, `${w}.${k}[${i}]`, heading));
		layouts[String(name)] = {
			grid: list("grid"),
			pits: list("pits"),
			hotlap: hot === null || hot === undefined ? null : spotV2(hot, `${w}.hotlap`),
			timing: _list(lay.timing, `${w}.timing`).map((g, i) => ({
				name: `AC_TIME_${i}`,
				left: spotV2(isObj(g) ? g.left : null, `${w}.timing[${i}].left`, false),
				right: spotV2(isObj(g) ? g.right : null, `${w}.timing[${i}].right`, false),
			})),
			cones: list("cones", false),
			boards: list("boards"),
		};
	}
	// (a pole the build cannot move is none: its parts are POLE_<n>_*; an old POLE_KIDS read before is dropped)
	const poles = _list(objects.poles, "poles")
		.map((s, i) => spotV2(s, `poles[${i}]`))
		.filter((p) => !("name" in p) || POLE_NAME.test(p.name as string));
	const walls = _list(objects.tyre_walls, "tyre_walls").map((t, i) => wallV2(t, `tyre_walls[${i}]`));
	const marks = _list(objects.marks, "marks").map((m, i) => _mark(m, `marks[${i}]`));
	const names = [...poles.filter((p) => "name" in p).map((p) => p.name), ...walls.map((t) => t.name), ...marks.map((m) => m.name)] as string[];
	const dup = names.find((n, i) => names.indexOf(n) !== i);
	if (dup) throw new ObjectsError(`two objects are named ${dup}`);
	const sc = objects.scenery ?? {};
	if (!isObj(sc)) throw new ObjectsError("scenery: not an object");
	const scenery = Object.fromEntries(
		SCENERY.map((k) => [
			k,
			_list(sc[k], `scenery.${k}`).map((p, i) => {
				const model = isObj(p) ? p.model : null;
				if (typeof model !== "string" || !model) throw new ObjectsError(`scenery.${k}[${i}].model: not a model`);
				return { model, ...spotV2(p, `scenery.${k}[${i}]`) };
			}),
		]),
	);
	const out: J = { version: 2 };
	if (isObj(objects.templates)) out.templates = objects.templates;
	return { ...out, layouts, poles, tyre_walls: walls, marks, scenery };
}

const single = (x: number, z: number) => [{ p: [x, z], in: [0, 0], out: [0, 0] }];

/** Objects of version 2 as version 3's (objects.py's convert): every tyre wall (one of a single stack and a wall to hit: a static one), pole, cone, board and
 * piece of scenery an object of the catalogue's model; a cone or a board in several layouts at one place (within SAME_PLACE; a board of the same name too) one
 * object listing them (none listed: in every layout); the layouts their grid, pits, hotlap and timing alone; the marks as they were. Names kept, made unique (a
 * second _2) across the objects and the marks. */
export function convertV2(objects: unknown): J {
	const v2 = cleanV2(objects);
	const taken = new Set((v2.marks as J[]).map((m) => m.name as string));
	const own = (name: string) => {
		let [n, k] = [name, 2];
		while (taken.has(n)) [n, k] = [`${name}_${k}`, k + 1];
		taken.add(n);
		return n;
	};
	const free = (prefix: string) => {
		let k = 0;
		while (taken.has(`${prefix}${k}`)) k++;
		taken.add(`${prefix}${k}`);
		return `${prefix}${k}`;
	};
	const out: J[] = [];
	for (const t of v2.tyre_walls as J[])
		out.push({
			name: own(t.name as string),
			model: "tyre_stack",
			curve: t.curve,
			closed: t.closed,
			spacing: t.spacing,
			rows: t.rows,
			fit: "place",
			collision: t.collision ? ((t.curve as unknown[]).length > 1 ? "wall" : "static") : "none",
		});
	for (const p of v2.poles as J[])
		out.push({
			name: p.name ? own(p.name as string) : free("POLE_"),
			model: "light_pole",
			curve: single(p.x as number, p.z as number),
			heading: p.heading,
			collision: "none",
		});
	const lays = v2.layouts as Record<string, J>;
	const every = Object.keys(lays).sort(byCodePoint);
	for (const [kind, model, prefix] of [
		["cones", "cone", "CONE_"],
		["boards", "board", "BOARD_"],
	] as const) {
		const groups: (J & { layouts: string[] })[] = [];
		for (const [name, lay] of Object.entries(lays))
			for (const spot of lay[kind] as J[]) {
				// (a board the same one only of its name too: two boards at one place say different things)
				const g = groups.find(
					(g) =>
						Math.abs((g.x as number) - (spot.x as number)) <= SAME_PLACE &&
						Math.abs((g.z as number) - (spot.z as number)) <= SAME_PLACE &&
						g.name === spot.name,
				);
				if (!g) groups.push({ ...spot, layouts: [name] });
				else if (!g.layouts.includes(name)) g.layouts.push(name);
			}
		for (const g of groups) {
			const obj: J = {
				name: g.name ? own(g.name as string) : free(prefix),
				model,
				curve: single(g.x as number, g.z as number),
				heading: g.heading ?? 0,
				collision: "dynamic",
			};
			const ls = [...g.layouts].sort(byCodePoint);
			if (ls.join("\0") !== every.join("\0")) obj.layouts = ls;
			out.push(obj);
		}
	}
	for (const kind of SCENERY)
		for (const p of (v2.scenery as Record<string, J[]>)[kind] as J[])
			out.push({
				name: free(`${(p.model as string).toUpperCase()}_`),
				model: p.model,
				curve: single(p.x as number, p.z as number),
				heading: p.heading,
				collision: "none",
			});
	const v3: J = { version: VERSION };
	if ("templates" in v2) v3.templates = v2.templates;
	v3.layouts = Object.fromEntries(Object.entries(lays).map(([n, l]) => [n, { grid: l.grid, pits: l.pits, hotlap: l.hotlap, timing: l.timing }]));
	return { ...v3, objects: out, marks: v2.marks };
}

/** The objects as the track's models have them now (objects.py's read_models, version 2, then converted): each layout (its model, vp_*.glb) its places as the
 * places file has them (places.json, where the track's build keeps a layout's markers and physics objects). The markers inside a layout's model (before the
 * track's format step 2b) and the poles' and tyres' meshes (empty since the track's e014f13: they are objects.json's) are not read. */
export async function seedObjects(files: HostFiles, models: string): Promise<J> {
	const placed = `${models}/places.json`;
	const places = (await files.exists(placed))
		? (((JSON.parse(new TextDecoder().decode(await files.read(placed))) as J).layouts ?? {}) as Record<string, J>)
		: {};
	const layouts: J = {};
	const stems = (await files.exists(models)) ? (await files.list(models)).filter((f) => /^vp_.*\.glb$/.test(f)) : [];
	for (const f of stems.sort(byCodePoint)) {
		const stem = f.slice(0, -4);
		layouts[stem] = places[stem] ? layoutPlaces(places[stem]) : { grid: [], pits: [], hotlap: null, timing: [], cones: [], boards: [] };
	}
	return {
		version: 2,
		layouts,
		poles: [],
		tyre_walls: [],
		marks: [],
		scenery: Object.fromEntries(SCENERY.map((k) => [k, []])),
	};
}

/** A layout's objects as the track's places file has them (objects.py's _layout_places). */
function layoutPlaces(places: J): J {
	const starts = new Map<number, J>();
	const pits = new Map<number, J>();
	const times = new Map<number, J>();
	let hotlap: J | null = null;
	const spot = (x: number, z: number, h: number) => ({
		x: pyRound(x, ROUND),
		z: pyRound(z, ROUND),
		heading: pyRound(h, ROUND_HEADING),
	});
	const point = (x: number, z: number) => ({ x: pyRound(x, ROUND), z: pyRound(z, ROUND) });
	for (const p of (places.spots as J[] | undefined) ?? []) {
		const name = `AC_${String(p.name ?? "")}`;
		const at = [p.x as number, p.z as number, (p.heading as number | undefined) ?? 0] as const;
		const start = /^AC_START_(\d+)$/.exec(name);
		const pit = /^AC_PIT_(\d+)$/.exec(name);
		const time = /^AC_TIME_(\d+)_([LR])$/.exec(name);
		if (start) starts.set(Number(start[1]), spot(...at));
		else if (pit) pits.set(Number(pit[1]), spot(...at));
		else if (name === "AC_HOTLAP_START_0") hotlap = spot(...at);
		else if (time) {
			const g = times.get(Number(time[1])) ?? {};
			g[time[2] === "L" ? "left" : "right"] = point(p.x as number, p.z as number);
			times.set(Number(time[1]), g);
		}
	}
	const objs = (places.objects as J[] | undefined) ?? [];
	const sorted = (m: Map<number, J>) => [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k) as J);
	const gates = sorted(times).filter((g) => "left" in g && "right" in g);
	return {
		grid: sorted(starts),
		pits: sorted(pits),
		hotlap,
		timing: gates.map((g, k) => ({ name: `AC_TIME_${k}`, ...g })),
		cones: objs.filter((o) => o.model === "cone").map((o) => point(o.x as number, o.z as number)),
		boards: objs
			.filter((o) => o.model === "board")
			.map((o) => ({
				name: String(o.name),
				...spot(o.x as number, o.z as number, (o.heading as number | undefined) ?? 0),
			})),
	};
}

/** a layout's racing lines (TRACK_FORMAT's "Racing lines"): its lap's, and its pit lane's */
const LINES = ["fast", "pit"];

/** A layout's racing lines (objects.py's _clean_lines): each a curve in the objects' form (no heights: the floor's), closed or not (the fast line closed, by
 * default; the pit line not). */
function _lines(v: unknown, w: string): J {
	if (!isObj(v) || Object.keys(v).some((k) => !LINES.includes(k))) throw new ObjectsError(`${w}: {${LINES.join(", ")}}`);
	const out: J = {};
	for (const k of LINES) {
		const line = v[k];
		if (line === null || line === undefined) continue;
		if (!isObj(line)) throw new ObjectsError(`${w}.${k}: {curve, closed}`);
		const o: J = {
			curve: _curve(line.curve, `${w}.${k}`),
			closed: Boolean(num(line.closed) ?? line.closed ?? k === "fast"),
		};
		// (where it forks off the fast line and merges back into it: metres along it from its start; joins less than leaves where the pit lane crosses the start
		// line)
		if (k === "pit")
			for (const e of ["leaves", "joins"]) {
				if (line[e] === null || line[e] === undefined) continue;
				const m = _num(line[e], `${w}.pit.${e}`);
				if (m < 0) throw new ObjectsError(`${w}.pit.${e}: metres along the fast line, 0 or more`);
				o[e] = f(pyRound(m, ROUND));
			}
		out[k] = o;
	}
	return out;
}

/** Whether objects are of version 2 or before (objects.py's is_v2). */
export function isV2(objects: unknown): boolean {
	if (!isObj(objects)) return false;
	const old = ["poles", "tyre_walls", "scenery"].some((k) => k in objects);
	return old || !("objects" in objects) || Math.trunc(num(objects.version) ?? 2) < VERSION;
}

/** The objects checked and rounded, as they are written (objects.py's clean, version 3). */
export function cleanObjects(given: unknown): J {
	// (version 2 given: checked as it was, then converted)
	const objects = isV2(given) ? convertV2(given) : given;
	if (!isObj(objects) || !isObj(objects.layouts ?? {})) throw new ObjectsError("objects: {layouts, objects, marks}");
	const layouts: J = {};
	for (const [name, lay] of Object.entries((objects.layouts ?? {}) as J)) {
		const w = `layouts.${name}`;
		if (!isObj(lay)) throw new ObjectsError(`${w}: not an object`);
		const hot = lay.hotlap;
		const timing = _list(lay.timing, `${w}.timing`).map((g, i) => ({
			name: `AC_TIME_${i}`,
			left: _spot(isObj(g) ? g.left : null, `${w}.timing[${i}].left`, false),
			right: _spot(isObj(g) ? g.right : null, `${w}.timing[${i}].right`, false),
		}));
		const out: J = {
			grid: _list(lay.grid, `${w}.grid`).map((s, i) => _spot(s, `${w}.grid[${i}]`)),
			pits: _list(lay.pits, `${w}.pits`).map((s, i) => _spot(s, `${w}.pits[${i}]`)),
			hotlap: hot === null || hot === undefined ? null : _spot(hot, `${w}.hotlap`),
			timing,
		};
		if (lay.lines !== null && lay.lines !== undefined) out.lines = _lines(lay.lines, `${w}.lines`);
		// (its start line painted across the road at the front of its grid: chequered, or a solid white line; none: none)
		if (lay.start_line !== null && lay.start_line !== undefined) {
			if (!START_LINE_STYLES.includes(lay.start_line as string))
				throw new ObjectsError(`${w}.start_line: ${START_LINE_STYLES.join(" or ")} (none: no start line)`);
			out.start_line = lay.start_line;
		}
		layouts[String(name)] = out;
	}
	const objs = _list(objects.objects, "objects").map((o, i) => _object(o, `objects[${i}]`));
	const marks = _list(objects.marks, "marks").map((m, i) => _mark(m, `marks[${i}]`));
	const rubber = _list(objects.rubber, "rubber").map((m, i) => _rubber(m, `rubber[${i}]`));
	const areas = _list(objects.areas, "areas").map((a, i) => _area(a, `areas[${i}]`));
	const names = [...objs.map((o) => o.name), ...marks.map((m) => m.name), ...rubber.map((m) => m.name), ...areas.map((a) => a.name)] as string[];
	const dup = names.find((n, i) => names.indexOf(n) !== i);
	if (dup) throw new ObjectsError(`two objects are named ${dup}`);
	const out: J = { version: VERSION };
	if (isObj(objects.templates)) out.templates = objects.templates;
	const wear = _wear(objects.wear);
	const ai = _ai(objects.ai);
	const surface = _surface(objects.surface);
	const ground = _ground(objects.ground);
	return {
		...out,
		...(ground ? { ground } : {}),
		...(surface ? { surface } : {}),
		...(wear ? { wear } : {}),
		...(ai ? { ai } : {}),
		layouts,
		objects: objs,
		marks,
		...(rubber.length ? { rubber } : {}),
		...(areas.length ? { areas } : {}),
	};
}

const WEARS = ["new", "almost_new", "used", "very_used"];

/** How worn the track looks: its paint's and its rubber's wear (each one of WEARS; none: new). */
function _wear(v: unknown): J | null {
	if (v === undefined || v === null) return null;
	if (!isObj(v)) throw new ObjectsError("wear: {paint, rubber}");
	const out: J = {};
	for (const k of ["paint", "rubber"]) {
		if (v[k] === undefined || v[k] === null) continue;
		if (!WEARS.includes(v[k] as string)) throw new ObjectsError(`wear.${k}: ${WEARS.join(", ")}`);
		out[k] = v[k];
	}
	return Object.keys(out).length ? out : null;
}

/** The ground's picture in the games: the photo (none said), or generated. */
function _ground(v: unknown): J | null {
	if (v === undefined || v === null) return null;
	if (!isObj(v)) throw new ObjectsError("ground: {picture}");
	if (v.picture === undefined || v.picture === null || v.picture === "photo") return null;
	if (v.picture !== "generated") throw new ObjectsError("ground.picture: photo or generated");
	return { picture: "generated" };
}

/** The roads' surface made imperfect: each of its millimetres 0 to 100, its seed a whole number; none of it: none. */
function _surface(v: unknown): J | null {
	if (v === undefined || v === null) return null;
	if (!isObj(v)) throw new ObjectsError("surface: {waves, bumps, ripple, camber, seed}");
	const out: J = {};
	for (const k of ["waves", "bumps", "ripple", "camber"]) {
		if (v[k] === undefined || v[k] === null) continue;
		const mm = _num(v[k], `surface.${k}`);
		if (mm < 0 || mm > 100) throw new ObjectsError(`surface.${k}: millimetres, 0 to 100`);
		if (mm > 0) out[k] = f(pyRound(mm, 2));
	}
	if (v.seed !== undefined && v.seed !== null) {
		if (!isInt(v.seed)) throw new ObjectsError("surface.seed: a whole number");
		out.seed = num(v.seed);
	}
	if (v.map !== undefined && v.map !== null) {
		out.map = _list(v.map, "surface.map").map((p, i) => {
			if (!Array.isArray(p) || p.length !== 3) throw new ObjectsError(`surface.map[${i}]: [x, z, k]`);
			const [x, z, k] = p.map((q, j) => _num(q, `surface.map[${i}][${j}]`)) as [number, number, number];
			if (k < 0 || k > 10) throw new ObjectsError(`surface.map[${i}]: its k 0 to 10`);
			return [f(pyRound(x, 2)), f(pyRound(z, 2)), f(pyRound(k, 2))];
		});
	}
	return Object.keys(out).some((k) => k !== "seed" && k !== "map") ? out : null;
}

/** What the AI lines are made for: its cars' width (metres, more than 0). */
function _ai(v: unknown): J | null {
	if (v === undefined || v === null) return null;
	if (!isObj(v)) throw new ObjectsError("ai: {width}");
	if (v.width === undefined || v.width === null) return null;
	const w = _num(v.width, "ai.width");
	if (w <= 0 || w > 4) throw new ObjectsError("ai.width: metres, more than 0 and no more than 4");
	return { width: f(pyRound(w, ROUND)) };
}

/** Objects of version 3 with their marks as the page has them: each a curve (one of an older file, from p, length metres along heading: straight from p, as
 * saving writes it). */
export function withCurvedMarks<T>(given: T): T {
	if (!isObj(given) || !Array.isArray(given.marks) || given.marks.every((m) => !isObj(m) || "curve" in m)) return given;
	return { ...given, marks: given.marks.map((m, i) => (isObj(m) && !("curve" in m) ? _mark(m, `marks[${i}]`) : m)) };
}

/** The objects file as the page has it (objects.py's ObjectsStore.load): version 3 as it is; version 2 read as version 3 (converted); none, read from the
 * models (seeded). */
export async function loadObjects(files: HostFiles, path: string, models: string): Promise<{ objects: PyJson; seeded: boolean; converted: boolean }> {
	if (await files.exists(path)) {
		const given = readPyJson(new TextDecoder().decode(await files.read(path)));
		return isV2(given)
			? { objects: cleanObjects(given) as PyJson, seeded: false, converted: true }
			: { objects: withCurvedMarks(given), seeded: false, converted: false };
	}
	return { objects: cleanObjects(await seedObjects(files, models)) as PyJson, seeded: true, converted: false };
}

/** The page's objects written back as the Python writes them (checked, rounded, version 2 converted; the file before kept): what was written. */
export async function saveObjects(files: HostFiles, path: string, backups: string, given: unknown) {
	const out = cleanObjects(given);
	await backup(files, path, backups, "objects");
	await writePyJsonFile(files, path, out);
	return out;
}
