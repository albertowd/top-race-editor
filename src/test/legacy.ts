// The editor this one was made from (kart-velopark's tools/road_editor/editor.js, kept in legacy/), run in a sandbox, as an oracle: the same roads through both
// must give the same geometry.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const TRACK = join(__dirname, "..", "..", "..", "kart-velopark");
/** the old page, kept here as it was when the editor moved (legacy/README.md) */
export const LEGACY_JS = join(__dirname, "legacy", "editor.js");
export const ROADS_JSON = join(TRACK, "tools", "reference", "roads.json");
export const haveLegacy = existsSync(LEGACY_JS) && existsSync(ROADS_JSON);

/** A Path2D that keeps its points: each subpath its [x, z] list. */
export class RecordingPath {
	parts: [number, number][][] = [];
	moveTo(x: number, z: number) {
		this.parts.push([[x, z]]);
	}
	lineTo(x: number, z: number) {
		if (!this.parts.length) this.parts.push([]);
		this.parts[this.parts.length - 1].push([x, z]);
	}
	closePath() {}
	arc() {}
	rect() {}
	addPath(p: RecordingPath) {
		this.parts.push(...p.parts);
	}
}

// (anything at all: every property, call and construction gives itself back)
const anything: unknown = new Proxy(() => {}, {
	get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === "then" ? undefined : anything),
	apply: () => anything,
	construct: () => anything as object,
	set: () => true,
});

export const MAP_W = 1200;
export const MAP_H = 800;

// biome-ignore lint/suspicious/noExplicitAny: the old editor is plain JavaScript
export type Legacy = Record<string, any>;

export function loadLegacy(): Legacy {
	const code = readFileSync(LEGACY_JS, "utf-8");
	const canvas = new Proxy(
		{ width: MAP_W, height: MAP_H, getBoundingClientRect: () => ({ width: MAP_W, height: MAP_H, left: 0, top: 0 }) },
		{ get: (t, k) => (k in t ? t[k as keyof typeof t] : anything) },
	);
	const document = {
		getElementById: (id: string) => (id === "map" ? canvas : anything),
		querySelectorAll: () => [],
		querySelector: () => null,
		createElement: () => anything,
		activeElement: null,
	};
	const names = ["document", "window", "devicePixelRatio", "requestAnimationFrame", "fetch", "Path2D", "Image", "alert", "confirm", "prompt"];
	const exported = [
		"S",
		"geo",
		"shapes",
		"sampleCurve",
		"at",
		"nearestOn",
		"kerbPieces",
		"snapPoint",
		"nodeHandles",
		"endHandles",
		"alongHandles",
		"splitAt",
		"autoHandles",
		"follow",
		"itemAt",
		"hit",
		"toScreen",
		"toWorld",
		"alongWidth",
		"continuation",
	];
	const run = new Function(...names, `${code}\nreturn { ${exported.join(", ")} };`);
	return run(
		document,
		anything,
		1,
		() => 0,
		() => new Promise(() => {}),
		RecordingPath,
		anything,
		() => {},
		() => false,
		() => null,
	) as Legacy;
}

/** The track's roads as the old page had them (each with its version, its name as loaded). */
export function legacyRoads(): Record<string, unknown>[] {
	const roads = JSON.parse(readFileSync(ROADS_JSON, "utf-8")).roads as Record<string, unknown>[];
	return roads.map((r) => {
		const { heights: _h, points: _p, ...rest } = r;
		return { ...rest, was: r.name };
	});
}
