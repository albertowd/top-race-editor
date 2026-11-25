// The terrain's editor: its description (the filters, the areas, the edits), the rasters the brushes paint, what the engine worked out of them (the grids, the
// heights and why the filters took them out) and how they are shown. Each change asks the engine again (a moment after, the last one asked winning); a brush's
// strokes show at once, the ground as last worked out with the raster's change since added to it.

import { castDraft, produce } from "immer";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Vec2 } from "../domain/types";
import type { DocToSend, TerrainApi, Want } from "./api";
import { type Brush, type CellBox, covering, dab, dabsAlong } from "./brush";
import { gridFrom, pointsFrom, rasterAt, rasterFrom, rasterJson, sample } from "./codec";
import { centroid, roundPoint } from "./rings";
import type { Grid, GridName, LayersJson, Points, Raster, RingEditType, TerrainArea, TerrainDoc, TerrainEdit, TerrainFilters, TerrainInfo } from "./types";

/** The layer shown: one of the grids, or what the filters took out (original less filtered). */
export type ShownLayer = "none" | GridName | "removed";

export interface Show {
	layer: ShownLayer;
	/** the ground lit from the north-west */
	relief: boolean;
	/** coloured by height (the change, the removed: by how much, up red and down blue) */
	colour: boolean;
	/** metres between contour lines (0: none) */
	contours: number;
	/** how many times taller the relief makes the ground look */
	exaggerate: number;
	opacity: number;
	/** the heights, coloured by why the filters took them out (those whose why is shown) */
	points: boolean;
	why: Record<string, boolean>;
	/** the picture of the ground round the track, under the rest */
	picture: boolean;
	/** shown in the other categories too */
	everywhere: boolean;
}

/** select: pick and move rings; area: draw one (ground or not); a ring edit drawn; brush: paint a raster. */
export type TerrainTool = "select" | "ground" | "not_ground" | RingEditType | "brush";

export interface TerrainPick {
	kind: "area" | "edit";
	i: number;
}

interface Snap {
	doc: TerrainDoc;
	rasters: Record<string, Raster>;
}

export interface TerrainState {
	/** none: the track has no terrain (reason in message) */
	status: "idle" | "loading" | "ready" | "none" | "error";
	message: string;
	info: TerrainInfo | null;
	/** the picture of the ground round the track, its URL ('' till it is known) */
	picture: string;
	doc: TerrainDoc | null;
	rasters: Record<string, Raster>;
	grids: Partial<Record<GridName, Grid | null>>;
	points: Points | null;
	counts: Record<string, number>;
	/** the engine working out a change */
	working: boolean;
	show: Show;
	tool: TerrainTool;
	brush: Brush;
	pick: TerrainPick | null;
	/** a ring being drawn: its points so far */
	draft: Vec2[] | null;
	undo: Snap[];
	redo: Snap[];
	dirty: boolean;
	saving: boolean;
	/** each brush dab shown counts one (the grids' values changed where they are) */
	painted: number;
}

const UNDO_DEPTH = 60;
const DELAY = 250;
const ALL: readonly Want[] = ["original", "filtered", "ground", "change", "points"];
const FOR_FILTERS: readonly Want[] = ["filtered", "ground", "change", "points"];
const FOR_EDITS: readonly Want[] = ["ground", "change"];

export const WHY_COLOURS: Record<string, string> = {
	"0": "#f2f2f2",
	"1": "#86d96b",
	"2": "#2f9e5b",
	"3": "#ff6b6b",
	"4": "#ffad3b",
	"5": "#ffe066",
	"6": "#c79bff",
};

/** What a new ring edit is made with. */
export const EDIT_DEFAULTS: Record<RingEditType, (ring: Vec2[]) => TerrainEdit> = {
	flat: (ring) => ({ type: "flat", name: "", ring, at: roundPoint(centroid(ring)), plus: 0, ease_m: 5 }),
	offset: (ring) => ({ type: "offset", name: "", ring, by: 1, ease_m: 5 }),
	smooth: (ring) => ({ type: "smooth", name: "", ring, sigma_m: 3, ease_m: 5 }),
};

export const EDIT_LABELS: Record<TerrainEdit["type"], string> = {
	raster: "Brushed",
	flat: "Flat",
	offset: "Raised",
	smooth: "Smoothed",
};

const clone = <T>(v: T): T => structuredClone(v);

/** A raster's metres at (x, z) as they were when the ground was last worked out (was: its values then); 0 where it had none, or had another size. */
const rasterWasAt = (r: Raster, was: Float32Array | undefined, x: number, z: number): number =>
	was?.length === r.v.length ? rasterAt({ ...r, v: was }, x, z) : 0;

export interface TerrainOptions {
	/** ms a change waits for the next before the engine is asked */
	delay?: number;
}

export type Terrain = ReturnType<typeof createTerrain>;

export function createTerrain(api: TerrainApi, options: TerrainOptions = {}) {
	const delay = options.delay ?? DELAY;
	const store: StoreApi<TerrainState> = createStore<TerrainState>()(() => ({
		status: "idle",
		message: "",
		info: null,
		picture: "",
		doc: null,
		rasters: {},
		grids: {},
		points: null,
		counts: {},
		working: false,
		show: {
			layer: "ground",
			relief: true,
			colour: true,
			contours: 0,
			exaggerate: 4,
			opacity: 0.6,
			points: false,
			why: Object.fromEntries(Object.keys(WHY_COLOURS).map((k) => [k, true])),
			picture: true,
			everywhere: false,
		},
		tool: "select",
		brush: { mode: "raise", radius: 6, strength: 0.4, target: 0 },
		pick: null,
		draft: null,
		undo: [],
		redo: [],
		dirty: false,
		saving: false,
		painted: 0,
	}));
	const get = store.getState;
	const set = store.setState;

	// (as last saved: what differs is not saved)
	let savedDoc = "";
	let savedRasters: Record<string, Raster> = {};
	// (the rasters' values the grids were worked out with: a stroke's change since is added to them as shown)
	let based: Record<string, Float32Array> = {};
	let groundBase: Float32Array | null = null;
	let changeBase: Float32Array | null = null;
	// (the world painted since the renderer last looked)
	let touched: { xmin: number; zmin: number; xmax: number; zmax: number } | null = null;

	const isDirty = (doc = get().doc, rasters = get().rasters) =>
		!!doc && (JSON.stringify(doc) !== savedDoc || Object.keys(rasters).some((f) => rasters[f] !== savedRasters[f] && usesRaster(doc, f)));
	const usesRaster = (doc: TerrainDoc, file: string) => doc.edits.some((e) => e.type === "raster" && e.file === file);

	// ---------------------------------------------------------------- the engine asked

	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending = new Set<Want>();
	let asked = 0;
	let controller: AbortController | null = null;
	let rasterVersion = 0;

	/** The description as the engine takes it: the rasters changed since saved with their data. */
	function toSend(doc: TerrainDoc, rasters: Record<string, Raster>): DocToSend {
		return {
			...doc,
			edits: doc.edits.map((e) =>
				e.type === "raster" && rasters[e.file] && rasters[e.file] !== savedRasters[e.file] ? { ...e, data: rasterJson(rasters[e.file]) } : e,
			),
		};
	}

	function apply(out: LayersJson, rasters: Record<string, Raster>) {
		const grids = { ...get().grids };
		for (const [k, g] of Object.entries(out.grids) as [GridName, LayersJson["grids"][GridName]][]) grids[k] = g ? gridFrom(g) : null;
		if ("ground" in out.grids) {
			groundBase = grids.ground ? grids.ground.v.slice() : null;
			changeBase = grids.change ? grids.change.v.slice() : null;
			based = Object.fromEntries(Object.entries(rasters).map(([f, r]) => [f, r.v.slice()]));
		}
		set({
			grids,
			...(out.points ? { points: pointsFrom(out.points) } : {}),
			...(out.counts ? { counts: out.counts } : {}),
			painted: 0,
		});
	}

	async function ask(want: readonly Want[], saved = false) {
		const { doc, rasters } = get();
		if (!doc) return;
		const n = ++asked;
		const version = rasterVersion;
		controller?.abort();
		controller = new AbortController();
		set({ working: true });
		try {
			const out = await api.layers(saved ? null : toSend(doc, rasters), want, controller.signal);
			if (n !== asked) return;
			// (painted meanwhile: what came is of a raster no longer there)
			if (version !== rasterVersion) {
				want.forEach((w) => {
					pending.add(w);
				});
				schedule();
				return;
			}
			apply(out, rasters);
			set({ working: false, message: `worked out in ${out.seconds.toFixed(1)} s` });
		} catch (err) {
			if ((err as Error).name === "AbortError" || n !== asked) return;
			set({ working: false, message: `the engine: ${(err as Error).message}` });
		}
	}

	function schedule(want: readonly Want[] = []) {
		want.forEach((w) => {
			pending.add(w);
		});
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			const w = [...pending];
			pending = new Set();
			if (w.length) void ask(w);
		}, delay);
	}

	/** Done once nothing is waiting (for the tests). */
	async function settle() {
		while (timer || get().working) await new Promise((r) => setTimeout(r, Math.max(5, delay)));
	}

	// ---------------------------------------------------------------- loading and saving

	async function load() {
		set({ status: "loading", message: "loading the terrain…" });
		try {
			const info = await api.info();
			if (!info.exists || !info.doc) {
				set({ status: "none", info, message: info.reason ?? "the track has no terrain" });
				return;
			}
			const doc = info.doc;
			const files = doc.edits.flatMap((e) => (e.type === "raster" ? [e.file] : []));
			const rasters = Object.fromEntries(await Promise.all(files.map(async (f): Promise<[string, Raster]> => [f, rasterFrom(await api.raster(f))])));
			savedDoc = JSON.stringify(doc);
			savedRasters = rasters;
			// (the picture asked for once: the engine window's is made for it, as a blob's URL)
			if (!get().picture)
				api.picture().then(
					(picture) => set({ picture }),
					() => {},
				);
			set({ info, doc, rasters, status: "ready", undo: [], redo: [], dirty: false, pick: null, draft: null });
			await ask(ALL, true);
		} catch (err) {
			set({ status: "error", message: `the terrain: ${(err as Error).message}` });
		}
	}

	async function save() {
		const { doc, rasters, saving } = get();
		if (!doc || saving) return;
		set({ saving: true, message: "saving the terrain…" });
		try {
			const out = await api.save(toSend(doc, rasters));
			const saved = out.doc ?? doc;
			savedDoc = JSON.stringify(saved);
			savedRasters = { ...rasters };
			set({
				info: { ...get().info, ...out },
				doc: saved,
				saving: false,
				dirty: isDirty(saved, rasters),
				message: "saved: the next build starts from it",
			});
			await ask(ALL, true);
		} catch (err) {
			set({ saving: false, message: `not saved: ${(err as Error).message}` });
		}
	}

	// ---------------------------------------------------------------- history

	function remember() {
		const { doc, rasters, undo } = get();
		if (!doc) return;
		set({ undo: [...undo, { doc, rasters }].slice(-UNDO_DEPTH), redo: [] });
	}

	function restore(to: Snap, undo: Snap[], redo: Snap[]) {
		const filters = JSON.stringify(to.doc.filters) !== JSON.stringify(get().doc?.filters);
		rasterVersion++;
		set({ doc: to.doc, rasters: to.rasters, undo, redo, dirty: isDirty(to.doc, to.rasters), pick: fitPick(to.doc) });
		schedule(filters ? FOR_FILTERS : FOR_EDITS);
	}

	const fitPick = (doc: TerrainDoc): TerrainPick | null => {
		const p = get().pick;
		if (!p) return null;
		const n = p.kind === "area" ? doc.filters.areas.length : doc.edits.length;
		return p.i < n ? p : null;
	};

	function undo() {
		const { undo: u, redo: r, doc, rasters } = get();
		const to = u.at(-1);
		if (to && doc) restore(to, u.slice(0, -1), [...r, { doc, rasters }]);
	}

	function redo() {
		const { undo: u, redo: r, doc, rasters } = get();
		const to = r.at(-1);
		if (to && doc) restore(to, [...u, { doc, rasters }], r.slice(0, -1));
	}

	// ---------------------------------------------------------------- the description edited

	/** The description changed (remembered first unless told not to); the engine asked again. */
	function change(recipe: (d: TerrainDoc) => void, filters = false, keep = true) {
		const { doc } = get();
		if (!doc) return;
		if (keep) remember();
		const next = produce(doc, (d) => {
			recipe(d as TerrainDoc);
		});
		set({ doc: next, dirty: isDirty(next) });
		schedule(filters ? FOR_FILTERS : FOR_EDITS);
	}

	const setFilters = (patch: Partial<TerrainFilters>) =>
		change((d) => {
			Object.assign(d.filters, castDraft(patch));
		}, true);

	const setTreeRule = (rule: "picture_trees" | "photo_trees", patch: Partial<TerrainFilters["picture_trees"]>) =>
		change((d) => {
			Object.assign(d.filters[rule], patch);
		}, true);

	function addArea(kind: TerrainArea["kind"], ring: Vec2[]) {
		change((d) => {
			const n = d.filters.areas.length + 1;
			d.filters.areas.push({
				name: `${kind === "ground" ? "ground" : "not ground"} ${n}`,
				kind,
				ring: ring.map(roundPoint),
			});
		}, true);
		set({ pick: { kind: "area", i: (get().doc?.filters.areas.length ?? 1) - 1 } });
	}

	const setArea = (i: number, patch: Partial<TerrainArea>) =>
		change((d) => {
			Object.assign(d.filters.areas[i], castDraft(patch));
		}, true);

	function removeArea(i: number) {
		change((d) => {
			d.filters.areas.splice(i, 1);
		}, true);
		set({ pick: null });
	}

	function addEdit(e: TerrainEdit) {
		change((d) => {
			d.edits.push(castDraft({ ...e, name: e.name || freeName(d.edits, EDIT_LABELS[e.type].toLowerCase()) }));
		});
		set({ pick: { kind: "edit", i: (get().doc?.edits.length ?? 1) - 1 } });
	}

	const setEdit = (i: number, patch: Partial<TerrainEdit>) =>
		change((d) => {
			Object.assign(d.edits[i], castDraft(patch));
		});

	/** A flat edit's way of saying its height: a height, or a point's and some metres over it. */
	function setFlatHeight(i: number, how: "height" | "at") {
		change((d) => {
			const e = d.edits[i];
			if (e.type !== "flat") return;
			if (how === "height") {
				const at = e.at ?? centroid(e.ring);
				const g = get().grids.ground;
				e.height = Math.round(((g ? sample(g, at[0], at[1]) : 0) + (e.plus ?? 0) || 0) * 100) / 100;
				delete e.at;
				delete e.plus;
			} else {
				e.at = roundPoint(centroid(e.ring));
				e.plus = 0;
				delete e.height;
			}
		});
	}

	/** An edit turned off (the ground as it is without it) or on again. */
	const toggleEdit = (i: number) =>
		change((d) => {
			const e = d.edits[i];
			if (e.off) delete e.off;
			else e.off = true;
		});

	function removeEdit(i: number) {
		change((d) => {
			d.edits.splice(i, 1);
		});
		set({ pick: null });
	}

	/** An edit moved up (-1) or down (+1) the list: each is made over what those before it left. */
	function moveEdit(i: number, by: -1 | 1) {
		const n = get().doc?.edits.length ?? 0;
		const j = i + by;
		if (j < 0 || j >= n) return;
		change((d) => {
			const [e] = d.edits.splice(i, 1);
			d.edits.splice(j, 0, e);
		});
		const p = get().pick;
		if (p?.kind === "edit" && p.i === i) set({ pick: { kind: "edit", i: j } });
	}

	/** A ring (an area's or an edit's) with a point moved, added after i, taken out, or all moved by (dx, dz). */
	function ringOf(d: TerrainDoc, p: TerrainPick): Vec2[] | null {
		if (p.kind === "area") return d.filters.areas[p.i]?.ring ?? null;
		const e = d.edits[p.i];
		return e && e.type !== "raster" ? e.ring : null;
	}

	function editRing(p: TerrainPick, recipe: (ring: Vec2[], d: TerrainDoc) => void, keep = true) {
		change(
			(d) => {
				const ring = ringOf(d, p);
				if (ring) recipe(ring, d);
			},
			p.kind === "area",
			keep,
		);
	}

	const movePoint = (p: TerrainPick, j: number, to: Vec2, keep = false) =>
		editRing(
			p,
			(ring) => {
				ring[j] = roundPoint(to);
			},
			keep,
		);

	const addPoint = (p: TerrainPick, after: number, at: Vec2) =>
		editRing(p, (ring) => {
			ring.splice(after + 1, 0, roundPoint(at));
		});

	function removePoint(p: TerrainPick, j: number) {
		const d = get().doc;
		if (!d || (ringOf(d, p)?.length ?? 0) <= 3) return;
		editRing(p, (ring) => {
			ring.splice(j, 1);
		});
	}

	/** A ring moved whole, (a flat edit's point with it). */
	const moveRing = (p: TerrainPick, dx: number, dz: number, keep = false) =>
		editRing(
			p,
			(ring, d) => {
				ring.forEach((q, k) => {
					ring[k] = roundPoint([q[0] + dx, q[1] + dz]);
				});
				const e = p.kind === "edit" ? d.edits[p.i] : null;
				if (e?.type === "flat" && e.at) e.at = roundPoint([e.at[0] + dx, e.at[1] + dz]);
			},
			keep,
		);

	// ---------------------------------------------------------------- drawing a ring

	const setTool = (tool: TerrainTool) => set({ tool, draft: null });

	function draftPoint(p: Vec2) {
		const q = roundPoint(p);
		const draft = get().draft ?? [];
		const last = draft.at(-1);
		// (a double-click's second press: the same point again)
		if (last && Math.hypot(last[0] - q[0], last[1] - q[1]) < 1e-3) return;
		set({ draft: [...draft, q] });
	}

	/** The ring drawn made what the tool draws (three points at least). */
	function finishDraft() {
		const { draft, tool } = get();
		set({ draft: null });
		if (!draft || draft.length < 3) return;
		if (tool === "ground" || tool === "not_ground") addArea(tool, draft);
		else if (tool === "flat" || tool === "offset" || tool === "smooth") addEdit(EDIT_DEFAULTS[tool](draft));
	}

	// ---------------------------------------------------------------- brushing

	let stroke: { file: string; last: Vec2 } | null = null;

	/** The raster edit picked, if one is. */
	function pickedRaster(): string | null {
		const { doc, pick } = get();
		const picked = pick?.kind === "edit" ? doc?.edits[pick.i] : undefined;
		return picked?.type === "raster" ? picked.file : null;
	}

	/** A new raster edit at the end of the list, for the brush (remembered for undo): its file. */
	function newRaster(): string {
		const { doc } = get();
		const taken = new Set(doc?.edits.flatMap((e) => (e.type === "raster" ? [e.file] : [])));
		let n = 1;
		while (taken.has(`brush_${n}.npz`)) n++;
		const file = `brush_${n}.npz`;
		addEdit({ type: "raster", name: `brushed ${n}`, file });
		return file;
	}

	/** The ground as shown now at (x, z): as last worked out, with the raster's change since. */
	function liveHeight(file: string, x: number, z: number): number {
		const g = get().grids.ground;
		if (!g) return 0;
		const base = groundBase ? { ...g, v: groundBase } : g;
		const r = get().rasters[file];
		const was = based[file];
		const y = sample(base, x, z);
		if (Number.isNaN(y)) return 0;
		return r ? y + rasterAt(r, x, z) - rasterWasAt(r, was, x, z) : y;
	}

	/** The grids shown made again where the raster changed (cells: the raster's), the ground's base kept. */
	function repaint(file: string, r: Raster, cells: CellBox) {
		const { grids } = get();
		const pad = grids.ground?.cell ?? 0;
		const x0 = r.x0 + cells.i0 * r.cell - pad;
		const x1 = r.x0 + cells.i1 * r.cell + pad;
		const z0 = r.z0 + cells.j0 * r.cell - pad;
		const z1 = r.z0 + cells.j1 * r.cell + pad;
		const was = based[file];
		const before = (x: number, z: number) => rasterWasAt(r, was, x, z);
		for (const name of ["ground", "change"] as const) {
			const G = grids[name];
			const base = name === "ground" ? groundBase : changeBase;
			if (!G || base?.length !== G.v.length) continue;
			const i0 = Math.max(0, Math.floor((x0 - G.x0) / G.cell));
			const i1 = Math.min(G.nx - 1, Math.ceil((x1 - G.x0) / G.cell));
			const j0 = Math.max(0, Math.floor((z0 - G.z0) / G.cell));
			const j1 = Math.min(G.nz - 1, Math.ceil((z1 - G.z0) / G.cell));
			for (let j = j0; j <= j1; j++)
				for (let i = i0; i <= i1; i++) {
					const x = G.x0 + i * G.cell;
					const z = G.z0 + j * G.cell;
					const k = j * G.nx + i;
					G.v[k] = base[k] + rasterAt(r, x, z) - before(x, z);
				}
		}
		touched = {
			xmin: Math.min(touched?.xmin ?? x0, x0),
			zmin: Math.min(touched?.zmin ?? z0, z0),
			xmax: Math.max(touched?.xmax ?? x1, x1),
			zmax: Math.max(touched?.zmax ?? z1, z1),
		};
	}

	function paintAt(file: string, at: Vec2) {
		const { brush, rasters } = get();
		const R = brush.radius;
		let r = rasters[file] ?? null;
		const grown = covering(r, at[0] - R, at[1] - R, at[0] + R, at[1] + R);
		if (grown !== r) {
			r = grown;
			set({ rasters: { ...get().rasters, [file]: r } });
		}
		const cells = dab(r, at[0], at[1], brush, (x, z) => liveHeight(file, x, z));
		rasterVersion++;
		if (cells) repaint(file, r, cells);
	}

	/** A stroke begun at a point, on the raster picked or a new one: the raster copied first (undo keeps the one before). */
	function beginStroke(at: Vec2) {
		if (!get().doc) return;
		const picked = pickedRaster();
		if (picked) remember();
		const file = picked ?? newRaster();
		const r = get().rasters[file];
		if (r) set({ rasters: { ...get().rasters, [file]: { ...r, v: r.v.slice() } } });
		stroke = { file, last: at };
		paintAt(file, at);
		set({ painted: get().painted + 1, dirty: true });
	}

	function strokeTo(at: Vec2) {
		if (!stroke) return;
		for (const p of dabsAlong(stroke.last, at, get().brush.radius)) {
			paintAt(stroke.file, p);
			stroke.last = p;
		}
		set({ painted: get().painted + 1 });
	}

	function endStroke() {
		if (!stroke) return;
		stroke = null;
		set({ dirty: isDirty() });
		schedule(FOR_EDITS);
	}

	/** The world painted since last asked, and forgotten. */
	function takeTouched() {
		const t = touched;
		touched = null;
		return t;
	}

	return {
		store,
		api,
		get,
		set: (patch: Partial<TerrainState>) => set(patch),
		load,
		save,
		settle,
		refresh: () => schedule(ALL),
		undo,
		redo,
		setShow: (patch: Partial<Show>) => set({ show: { ...get().show, ...patch } }),
		setBrush: (patch: Partial<Brush>) => set({ brush: { ...get().brush, ...patch } }),
		setTool,
		pickThing: (pick: TerrainPick | null) => set({ pick }),
		setFilters,
		setTreeRule,
		addArea,
		setArea,
		removeArea,
		addEdit,
		setEdit,
		setFlatHeight,
		toggleEdit,
		removeEdit,
		moveEdit,
		movePoint,
		addPoint,
		removePoint,
		moveRing,
		remember,
		draftPoint,
		finishDraft,
		cancelDraft: () => set({ draft: null }),
		beginStroke,
		strokeTo,
		endStroke,
		stroking: () => !!stroke,
		takeTouched,
		liveHeight,
		ringOf: (p: TerrainPick) => {
			const d = get().doc;
			return d ? ringOf(d, p) : null;
		},
	};
}

/** A name like base 1, base 2... not yet taken. */
function freeName(edits: readonly TerrainEdit[], base: string): string {
	const taken = new Set(edits.map((e) => e.name));
	let n = 1;
	while (taken.has(`${base} ${n}`)) n++;
	return `${base} ${n}`;
}

export const clonedDoc = clone;
