// The track's renders, as the games' own tracks show their layouts: each layout's picture (AC's preview.png, BeamNG's spawns' and races') the gantry its lap
// runs under, seen from the track before it; a layout whose lap runs under none, its place from above at a slant, all of its lap in it. Drawn of the AC build's
// models (its kn5s, each layout's models_<layout>.ini's) with the grass AC's grass grows near the eye, in AC's axes (y up, -z north), by a host that has a GPU
// (the app's engine window: WebGL).
import { type Kn5, parse, walk } from "./kn5tree";
import { byCodePoint } from "./order";
import type { HostFiles } from "./placehost";
import { type GrassConfig, grassConfig } from "./rendergrass";

export type V3 = [number, number, number];

/** The models a render draws: each kn5 of the track by its file's name. */
export interface TrackScene {
	models: Record<string, Kn5>;
	/** where grass grows (the track's ext_config.ini's [GRASS_FX]); none: no grass */
	grass?: GrassConfig | null;
}

/** A picture of the scene: from eye to target (AC's axes), fov degrees up and down, the models drawn, the sun (the way to it), the shadows cast round the
 * target so many metres; its size and kind. */
export interface Shot {
	eye: V3;
	target: V3;
	fov: number;
	models: string[];
	sun: V3;
	shadow: number;
	size: [number, number];
	format: "png" | "jpeg";
	/** the grass grown round (x, z) so many metres (none: no grass) */
	grass?: { at: [number, number]; radius: number };
}

/** A view of a shot (where it looks from and to, its sun and shadows, its grass). */
export type View = Pick<Shot, "eye" | "target" | "fov" | "sun" | "shadow" | "grass">;

/** What draws the renders (a GPU's). */
export interface RenderHost {
	render(scene: TrackScene, shots: Shot[]): Promise<Uint8Array[]>;
}

/** A point of the map's axes (x east, y north, z up) in AC's (y up, -z north). */
export const acPoint = (p: readonly number[]): V3 => [p[0] as number, p[2] as number, -(p[1] as number)];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
	const l = Math.hypot(...a) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};
const rad = (deg: number) => (deg * Math.PI) / 180;

/** The way to the sun: so many degrees up, its bearing so many degrees round from behind the eye (the place lit from a side, its shadows falling across the
 * picture). */
export function sunFor(look: V3, round = 50, up = 40): V3 {
	const back = unit([-look[0], 0, -look[2]]);
	const a = rad(round);
	const h: V3 = [back[0] * Math.cos(a) - back[2] * Math.sin(a), 0, back[0] * Math.sin(a) + back[2] * Math.cos(a)];
	return unit([h[0] * Math.cos(rad(up)), Math.sin(rad(up)), h[2] * Math.cos(rad(up))]);
}

/** Where a point is in a view's picture (x, y each -1..1; null: behind the eye). */
function projected(p: V3, eye: V3, fwd: V3, right: V3, up: V3, t: number, aspect: number): [number, number] | null {
	const d = sub(p, eye);
	const z = dot(d, fwd);
	if (z <= 0) return null;
	return [dot(d, right) / (z * t * aspect), dot(d, up) / (z * t)];
}

/** AC's preview of a layout: its lap (its line, AC's axes) seen from above at a slant (pitch degrees down) across its length, from its south, as near as has
 * all of it in the picture (margin its share left round it). */
export function overview(line: V3[], o: { size: [number, number]; fov?: number; pitch?: number; margin?: number }): View {
	const fov = o.fov ?? 36;
	const pitch = rad(o.pitch ?? 45);
	const margin = o.margin ?? 0.1;
	const n = line.length || 1;
	const c: V3 = [0, 0, 0];
	for (const p of line) for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (p[k] as number) / n;
	// (its length's way: the line's points' main axis, flat)
	let xx = 0;
	let zz = 0;
	let xz = 0;
	for (const p of line) {
		const dx = p[0] - c[0];
		const dz = p[2] - c[2];
		xx += dx * dx;
		zz += dz * dz;
		xz += dx * dz;
	}
	const along = 0.5 * Math.atan2(2 * xz, xx - zz);
	// (looked at across its length, from the south side: the eye's way north-ish)
	let d: V3 = [-Math.sin(along), 0, Math.cos(along)];
	if (d[2] > 0) d = [-d[0], 0, -d[2]];
	const fwd = unit([d[0] * Math.cos(pitch), -Math.sin(pitch), d[2] * Math.cos(pitch)]);
	const right = unit(cross(fwd, [0, 1, 0]));
	const up = cross(right, fwd);
	const t = Math.tan(rad(fov) / 2);
	const aspect = o.size[0] / o.size[1];
	const fits = (dist: number, shift: [number, number]) => {
		const eye = add(add(add(c, fwd, -dist), right, shift[0]), up, shift[1]);
		let lo: [number, number] = [Infinity, Infinity];
		let hi: [number, number] = [-Infinity, -Infinity];
		for (const p of line) {
			const q = projected(p, eye, fwd, right, up, t, aspect);
			if (!q) return null;
			lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
			hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
		}
		return { lo, hi, eye };
	};
	// (as near as it all fits, then moved so it is in the middle, its sides alike)
	let lo = 1;
	let hi = 1e5;
	let shift: [number, number] = [0, 0];
	for (let i = 0; i < 3; i++) {
		lo = 1;
		hi = 1e5;
		for (let k = 0; k < 50; k++) {
			const mid = Math.sqrt(lo * hi);
			const f = fits(mid, shift);
			if (f && Math.max(-f.lo[0], f.hi[0], -f.lo[1], f.hi[1]) <= 1 - margin) hi = mid;
			else lo = mid;
		}
		const f = fits(hi, shift);
		if (!f) break;
		// (the picture's middle where the line's is: the eye moved across by as much, at that distance)
		const off: [number, number] = [(f.lo[0] + f.hi[0]) / 2, (f.lo[1] + f.hi[1]) / 2];
		shift = [shift[0] + off[0] * hi * t * aspect, shift[1] + off[1] * hi * t];
	}
	const eye = add(add(add(c, fwd, -hi), right, shift[0]), up, shift[1]);
	let reach = 0;
	for (const p of line) reach = Math.max(reach, Math.hypot(p[0] - c[0], p[2] - c[2]));
	return { eye, target: add(eye, fwd, hi), fov, sun: sunFor(fwd, 70, 42), shadow: reach * 1.3 + 30 };
}

/** A start's picture: its place seen from just behind it and above (at: where it is, fwd: the way it faces, AC's axes), as a driver about to start sees it from
 * a little higher. */
export function startView(at: V3, fwd: V3, fov = 55): View {
	const f = unit([fwd[0], 0, fwd[2]]);
	const eye = add(add(at, f, -9), [0, 1, 0], 3.6);
	const target = add(add(at, f, 22), [0, 1, 0], 0.4);
	return { eye, target, fov, sun: sunFor(sub(target, eye), 65, 35), shadow: 140, grass: grassFor(eye, target) };
}

/** the grass of a view from near the ground: round between its eye and target, and some way past */
const grassFor = (eye: V3, target: V3): Shot["grass"] => ({
	at: [(eye[0] + target[0]) / 2, (eye[2] + target[2]) / 2],
	radius: Math.hypot(target[0] - eye[0], target[2] - eye[2]) / 2 + 45,
});

/** A model's box (its seen meshes' corners where they stand); none seen: null. */
export function modelBox(kn5: Kn5): [V3, V3] | null {
	const lo: V3 = [Infinity, Infinity, Infinity];
	const hi: V3 = [-Infinity, -Infinity, -Infinity];
	for (const [n, m] of walk(kn5.root)) {
		if (n.kind !== 2 || !n.visible || !n.active) continue;
		for (let i = 0; i + 2 < n.verts.length; i += 11)
			for (let j = 0; j < 3; j++) {
				const v =
					(n.verts[i] as number) * (m[j] as number) +
					(n.verts[i + 1] as number) * (m[4 + j] as number) +
					(n.verts[i + 2] as number) * (m[8 + j] as number) +
					(m[12 + j] as number);
				lo[j] = Math.min(lo[j] as number, v);
				hi[j] = Math.max(hi[j] as number, v);
			}
	}
	return lo[0] <= hi[0] ? [lo, hi] : null;
}

/** The gantries' models among a track's (a gantry the build stands still where a layout has it so, <model>_still: it and the one working of its name). */
export function gantryModels(files: Iterable<string>): string[] {
	const all = new Set(files);
	const out = new Set<string>();
	for (const f of all) {
		const still = /^(.*)_still\.kn5$/i.exec(f);
		if (!still) continue;
		out.add(f);
		const working = `${still[1]}.kn5`;
		if (all.has(working)) out.add(working);
	}
	return [...out].sort(byCodePoint);
}

/** how near a gantry's middle a lap must run to run under it, metres */
export const UNDER = 20;

/** A gantry's picture: seen from the track before it (its lap's line, AC's axes), a little to a side and a driver's height up, all its width in the picture;
 * the lap running under it nowhere: null. */
export function gantryView(box: [V3, V3], line: V3[], size: [number, number], fov = 50): View | null {
	const [lo, hi] = box;
	const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
	let k = -1;
	let best = UNDER;
	line.forEach((p, i) => {
		const d = Math.hypot(p[0] - c[0], p[2] - c[2]);
		if (d < best) {
			best = d;
			k = i;
		}
	});
	if (k < 0) return null;
	const n = line.length;
	const a = line[(k - 3 + n) % n] as V3;
	const b = line[(k + 3) % n] as V3;
	const f = unit([b[0] - a[0], 0, b[2] - a[2]]);
	const side: V3 = [-f[2], 0, f[0]];
	const ground = (line[k] as V3)[1];
	// (as far off as has its width in two thirds of the picture)
	const width = Math.hypot(hi[0] - lo[0], hi[2] - lo[2]);
	const across = Math.tan(rad(fov) / 2) * (size[0] / size[1]);
	const far = Math.max(8, width / 2 / (across * 0.66));
	const at: V3 = [c[0], ground + (hi[1] - ground) * 0.55, c[2]];
	const eye = add(add(add([c[0], ground, c[2]], f, -far), side, far * 0.18), [0, 1, 0], 1.7);
	return { eye, target: at, fov, sun: sunFor(sub(at, eye), 65, 35), shadow: 140, grass: grassFor(eye, at) };
}

/** A layout's picture's view: the gantry its lap runs under (the nearest its line of those given), else its lap from above at a slant. */
export function layoutView(line: V3[], gantries: [V3, V3][], size: [number, number]): View {
	const under = gantries
		.map((g) => ({
			g,
			d: Math.min(...line.map((p) => Math.hypot(p[0] - (g[0][0] + g[1][0]) / 2, p[2] - (g[0][2] + g[1][2]) / 2))),
		}))
		.filter((x) => x.d < UNDER)
		.sort((a, b) => a.d - b.d);
	for (const { g } of under) {
		const v = gantryView(g, line, size);
		if (v) return v;
	}
	return overview(line, { size });
}

/** The models each layout draws (its models_<layout>.ini's files, else models.ini's) and the scene of all of them, out the AC build's track; a layout with
 * none: left out. */
export async function trackScene(files: HostFiles, out: string, layouts: string[]): Promise<{ scene: TrackScene; drawn: Record<string, string[]> }> {
	const dec = (b: Uint8Array) => new TextDecoder().decode(b);
	const listed = async (p: string) =>
		(await files.exists(p)) ? [...dec(await files.read(p)).matchAll(/^\s*FILE\s*=\s*(.+?)\s*$/gim)].map((m) => m[1] as string) : null;
	const drawn: Record<string, string[]> = {};
	const all = await listed(`${out}/models.ini`);
	for (const lay of layouts) {
		const own = (await listed(`${out}/models_${lay}.ini`)) ?? all;
		if (own?.length) drawn[lay] = own;
	}
	const models: Record<string, Kn5> = {};
	for (const f of new Set(Object.values(drawn).flat())) {
		const p = `${out}/${f}`;
		if (await files.exists(p)) models[f] = parse(await files.read(p));
	}
	for (const lay of Object.keys(drawn)) drawn[lay] = (drawn[lay] as string[]).filter((f) => models[f]);
	const ext = `${out}/extension/ext_config.ini`;
	const grass = (await files.exists(ext)) ? grassConfig(dec(await files.read(ext))) : null;
	return { scene: { models, grass }, drawn };
}

/** Each layout's picture's view (layoutView), its lap's line given (AC's axes): the gantries among the models it draws. */
export function layoutViews(scene: TrackScene, drawn: Record<string, string[]>, lines: Map<string, V3[]>, size: [number, number]): Map<string, View> {
	const gantries = gantryModels(Object.keys(scene.models));
	const boxes = new Map<string, [V3, V3] | null>();
	const boxOf = (f: string) => {
		if (!boxes.has(f)) boxes.set(f, scene.models[f] ? modelBox(scene.models[f] as Kn5) : null);
		return boxes.get(f) ?? null;
	};
	const out = new Map<string, View>();
	for (const [lay, line] of lines) {
		const own = (drawn[lay] ?? []).filter((f) => gantries.includes(f));
		out.set(
			lay,
			layoutView(
				line,
				own.map(boxOf).filter((b): b is [V3, V3] => !!b),
				size,
			),
		);
	}
	return out;
}
