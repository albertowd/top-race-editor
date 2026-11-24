// A track's layouts made, renamed and taken away (on drafts): each its own grid, pits, hotlap, timing and racing lines (the objects'), the objects it lists,
// and its models (the track file's: the page's `lists`), in a game the layout's own folder. A layout made from another starts as a copy of it: its spots, gates
// and lines, the objects in it, its models (its own model the other's, as its own), its AC files the other's (`from`) until it has its own.

import type { TrackObjects } from "../domain/types";
import { emptyLayout } from "./objects";

/** a layout's name: as a game's folder takes it */
export const LAYOUT_NAME = /^[a-z0-9_]+$/;

function badName(o: TrackObjects, name: string): string | null {
	if (!LAYOUT_NAME.test(name)) return `a layout's name: lower case letters, digits and _ (${name || "none given"})`;
	if (o.layouts[name]) return `there is a layout ${name} already`;
	return null;
}

/** A layout named name made as from is; what is wrong with it if it cannot be (null: made). */
export function addLayout(o: TrackObjects, name: string, from: string): string | null {
	const bad = badName(o, name);
	if (bad) return bad;
	const src = o.layouts[from];
	o.layouts[name] = src ? (JSON.parse(JSON.stringify(src)) as typeof src) : emptyLayout();
	if (src) for (const it of o.objects) if (it.layouts?.includes(from)) it.layouts.push(name);
	const base = o.lists?.[from];
	o.lists ??= {};
	o.lists[name] = {
		models: (base?.models ?? []).map((m) => (m === from ? name : m)),
		from: base?.from ?? from,
	};
	return null;
}

/** A layout renamed (its place among them kept); what is wrong if it cannot be (null: renamed). */
export function renameLayout(o: TrackObjects, from: string, to: string): string | null {
	if (from === to) return null;
	const bad = badName(o, to);
	if (bad) return bad;
	if (!o.layouts[from]) return `there is no layout ${from}`;
	o.layouts = Object.fromEntries(Object.entries(o.layouts).map(([k, v]) => [k === from ? to : k, v]));
	for (const it of o.objects) if (it.layouts) it.layouts = it.layouts.map((l) => (l === from ? to : l));
	if (o.lists) {
		const was = o.lists[from];
		o.lists = Object.fromEntries(
			Object.entries(o.lists).map(([k, v]) => (k === from ? [to, { models: v.models.map((m) => (m === from ? to : m)), from: v.from ?? from }] : [k, v])),
		);
		if (!was) o.lists[to] = { models: [], from };
	}
	return null;
}

/** A layout taken away: its own, and the objects only it had. */
export function removeLayout(o: TrackObjects, name: string): void {
	delete o.layouts[name];
	if (o.lists) delete o.lists[name];
	o.objects = o.objects.filter((it) => {
		if (!it.layouts?.includes(name)) return true;
		it.layouts = it.layouts.filter((l) => l !== name);
		return it.layouts.length > 0;
	});
}
