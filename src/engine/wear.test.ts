// @vitest-environment node
// How worn the track looks: the paint's pictures (never bright, the asphalt through it, the more the more used), the rubber's bands on the floor along a racing
// line (darker the more used, the most in the bends, marks over one another shown as one, never darker than the darkest).
import { describe, expect, it } from "vitest";
import { WEARS } from "../domain/types";
import { cleanObjects, ObjectsError } from "./objectsfile";
import { layRubber, RUBBER_STEP, type RubberLaid, type RubberLine, rubberAlone } from "./rubber";
import { isRubberPage, paintPicture, RUBBER, RUBBER_DIFFUSE, RUBBER_LIFT, RUBBER_SHEEN, rubberPage, wornMaterial } from "./wear";

const SIZE = 64;
/** a picture's mean of a channel (0 red ... 3 alpha), 0 to 255 */
const mean = (px: Uint8Array, ch: number) => {
	let s = 0;
	for (let i = ch; i < px.length; i += 4) s += px[i] as number;
	return s / (px.length / 4);
};

describe("the paint as it wears", () => {
	it("is never bright white, and thinner and dirtier the more it is used", () => {
		const p = WEARS.map((w) => paintPicture("white", w, SIZE));
		for (const px of p) expect(mean(px, 0)).toBeLessThan(205);
		const alpha = p.map((px) => mean(px, 3));
		const red = p.map((px) => mean(px, 0));
		for (let i = 1; i < alpha.length; i++) {
			expect(alpha[i]).toBeLessThan(alpha[i - 1] as number);
			expect(red[i]).toBeLessThan(red[i - 1] as number);
		}
		// (even new: the asphalt's grain through it, here and there)
		const a = p[0] as Uint8Array;
		let low = 0;
		for (let i = 3; i < a.length; i += 4) if ((a[i] as number) < 128) low++;
		expect(low).toBeGreaterThan(0);
		// (yellow: yellow)
		const y = paintPicture("yellow", "used", SIZE);
		expect(mean(y, 2)).toBeLessThan(mean(y, 1) / 2);
	});
});

type N = { p: [number, number]; in: [number, number]; out: [number, number] };
/** a straight from (x0, z0) to (x1, z1) */
const straight = (x0: number, z0: number, x1: number, z1: number): N[] => {
	const [dx, dz] = [(x1 - x0) / 3, (z1 - z0) / 3];
	return [
		{ p: [x0, z0], in: [0, 0], out: [dx, dz] },
		{ p: [x1, z1], in: [-dx, -dz], out: [0, 0] },
	];
};
/** 120 m up +z, a quarter circle of 10 m to the right, 40 m on along +x */
const K = 0.5523 * 10;
const corner: N[] = [
	{ p: [0, 0], in: [0, 0], out: [0, 13] },
	{ p: [0, 120], in: [0, -40], out: [0, K] },
	{ p: [10, 130], in: [-K, 0], out: [13, 0] },
	{ p: [50, 130], in: [-13, 0], out: [0, 0] },
];
const flat = () => 0;
const PAGE = 1024;
type Page = RubberLaid["pages"][number];

/** How dark the rubber is at (x, z), as the game blends its pieces over the road: one less what shows through them all (each piece's picture where its face
 * over the point maps it). */
function darkness(laid: RubberLaid, x: number, z: number): number {
	let through = 1;
	for (const { mesh, page } of laid.pieces) {
		const pg = laid.pages[page] as Page;
		const { P, UV, F } = mesh;
		for (let f = 0; f < F.length; f += 3) {
			const [i, j, l] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
			const [ax, az] = [P[i * 3] as number, P[i * 3 + 2] as number];
			const [bx, bz] = [P[j * 3] as number, P[j * 3 + 2] as number];
			const [cx, cz] = [P[l * 3] as number, P[l * 3 + 2] as number];
			const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
			const b1 = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / d;
			const b2 = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / d;
			if (b1 < 0 || b2 < 0 || b1 + b2 > 1) continue;
			const b0 = 1 - b1 - b2;
			const u = b0 * (UV[i * 2] as number) + b1 * (UV[j * 2] as number) + b2 * (UV[l * 2] as number);
			const v = b0 * (UV[i * 2 + 1] as number) + b1 * (UV[j * 2 + 1] as number) + b2 * (UV[l * 2 + 1] as number);
			const tx = Math.min(pg.width - 1, Math.floor(u * pg.width));
			const ty = Math.min(pg.height - 1, Math.floor(v * pg.height));
			through *= 1 - (pg.rgba[(ty * pg.width + tx) * 4 + 3] as number) / 255;
			break;
		}
	}
	return 1 - through;
}

/** The mean darkness across a band at z (x from x0 to x1, a centimetre apart). */
const across = (laid: RubberLaid, z: number, x0: number, x1: number) => {
	let s = 0;
	let n = 0;
	for (let x = x0; x <= x1; x += 0.01, n++) s += darkness(laid, x, z);
	return s / n;
};
const faces = (l: RubberLaid) => l.pieces.reduce((n, p) => n + p.mesh.F.length, 0);

describe("the rubber along a rubber mark", () => {
	it("is a band over the mark on the floor, wider than it for its fanning and marbles, each face up", () => {
		expect(rubberAlone({ curve: straight(0, 0, 0, 40) }, 0, () => 1).pieces).toEqual([]);
		const laid = rubberAlone({ curve: straight(0, 0, 0, 40) }, 1.54, () => 1, "used", PAGE);
		expect(laid.pieces.length).toBeGreaterThan(0);
		const { P, UV, F } = (laid.pieces[0] as RubberLaid["pieces"][number]).mesh;
		const xs = [...P].filter((_, i) => i % 3 === 0);
		expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.54 * 1.5);
		expect(P[1]).toBeCloseTo(1 + RUBBER_LIFT, 9);
		// (its picture on its page, a power of two wide)
		for (const t of UV) expect(t >= 0 && t <= 1).toBe(true);
		const pg = laid.pages[0] as Page;
		expect(Math.log2(pg.width) % 1).toBe(0);
		expect(pg.rgba).toHaveLength(pg.width * pg.height * 4);
		for (let f = 0; f < F.length; f += 3) {
			const [i, j, l] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
			const up =
				((P[j * 3 + 2] as number) - (P[i * 3 + 2] as number)) * ((P[l * 3] as number) - (P[i * 3] as number)) -
				((P[j * 3] as number) - (P[i * 3] as number)) * ((P[l * 3 + 2] as number) - (P[i * 3 + 2] as number));
			expect(up).toBeGreaterThan(0);
		}
		// (off the floor: none there)
		const half = rubberAlone({ curve: straight(0, 0, 0, 40) }, 1.54, (_x, z) => (z < 20 ? 1 : Number.NaN));
		expect(faces(half) / faces(laid)).toBeCloseTo(0.5, 1);
	});

	it("is its own all along, not a picture repeating", () => {
		const laid = rubberAlone({ curve: straight(0, 0, 0, 40) }, 1.5, flat, "very_used", PAGE);
		const row = (z: number) => Array.from({ length: 150 }, (_, i) => darkness(laid, -0.75 + i * 0.01, z));
		const [a, b] = [row(12), row(20)];
		expect(a.some((x, i) => Math.abs(x - (b[i] as number)) > 0.05)).toBe(true);
	});

	it("is darker the more it is used, the darkest in a bend, little on a straight", () => {
		// (the bend: 45 degrees round it)
		const c = 10 - 10 * Math.cos(Math.PI / 4);
		const zb = 120 + 10 * Math.sin(Math.PI / 4);
		const dark = (["almost_new", "used", "very_used"] as const).map((w) => across(rubberAlone({ curve: corner }, 1.5, flat, w, PAGE), zb, c - 1, c + 1));
		expect(dark[1]).toBeGreaterThan(dark[0] as number);
		expect(dark[2]).toBeGreaterThan(dark[1] as number);
		const laid = rubberAlone({ curve: corner }, 1.5, flat, "very_used", PAGE);
		// (the straight: well before the braking)
		expect(dark[2]).toBeGreaterThan(2 * across(laid, 12, -1, 1));
		// (none past its edges)
		expect(darkness(laid, 3, 6)).toBe(0);
	});

	it("is a neutral dark grey, never near black, lit in AC as the road under it is", () => {
		const laid = rubberAlone({ curve: corner }, 1.5, flat, "very_used", PAGE);
		let seen = 0;
		let wrong = 0;
		for (const pg of laid.pages)
			for (let i = 0; i < pg.rgba.length; i += 4) {
				if (!pg.rgba[i + 3]) continue;
				seen++;
				const r = pg.rgba[i] as number;
				if (pg.rgba[i + 1] !== r || pg.rgba[i + 2] !== r || r < RUBBER.rgb[0]) wrong++;
			}
		expect(seen).toBeGreaterThan(0);
		expect(wrong).toBe(0);
		expect(RUBBER.rgb[0]).toBeGreaterThanOrEqual(20);
		// (the library's tarmac's: ambient and diffuse 0.2, a broad low sheen)
		const props = Object.fromEntries(wornMaterial("Rubber_1", "Rubber_1.png", RUBBER_DIFFUSE, RUBBER_SHEEN).props.map((p) => [p.name, p.value]));
		expect(props).toMatchObject({ ksAmbient: 0.2, ksDiffuse: 0.2, ksSpecular: 0.09, ksSpecularEXP: 6 });
	});
});

describe("rubber marks over one another", () => {
	const line = straight(0, 0, 0, 40);

	it("draws one of two on the same line: the darker, or the first of as dark", () => {
		const same = layRubber(
			[
				{ curve: line, width: 1.5, wear: "used" },
				{ curve: line, width: 1.5, wear: "used" },
			],
			flat,
			PAGE,
		);
		expect(new Set(same.pieces.map((p) => p.mark))).toEqual(new Set([0]));
		const alone = rubberAlone({ curve: line }, 1.5, flat, "very_used", PAGE);
		const darker = layRubber(
			[
				{ curve: line, width: 1.5, wear: "almost_new" },
				{ curve: line, width: 1.5, wear: "very_used" },
			],
			flat,
			PAGE,
		);
		// (the darker's rubber, as it is alone, where the cars lay it)
		expect(across(darker, 20, -0.6, 0.6)).toBeCloseTo(across(alone, 20, -0.6, 0.6), 2);
	});

	it("is never darker than the darkest of them where two lines run side by side", () => {
		const marks: RubberLine[] = [
			{ curve: line, width: 1.5, wear: "used" },
			{ curve: straight(0.5, 0, 0.5, 40), width: 1.5, wear: "used" },
		];
		const both = layRubber(marks, flat, PAGE);
		expect(new Set(both.pieces.map((p) => p.mark))).toEqual(new Set([0, 1]));
		const [a, b] = marks.map((m) => layRubber([m], flat, PAGE)) as [RubberLaid, RubberLaid];
		let over = 0;
		for (let x = -1.2; x <= 1.7; x += 0.01)
			for (const z of [12, 20, 28]) {
				const most = Math.max(darkness(a, x, z), darkness(b, x, z));
				over = Math.max(over, darkness(both, x, z) - most);
			}
		// (a texel's give, where one's picture is sampled beside the other's)
		expect(over).toBeLessThan(0.08);
	});

	it("lays both where two cross", () => {
		const laid = layRubber(
			[
				{ curve: line, width: 1.5, wear: "used" },
				{ curve: straight(-20, 20, 20, 20), width: 1.5, wear: "used" },
			],
			flat,
			PAGE,
		);
		expect(new Set(laid.pieces.map((p) => p.mark))).toEqual(new Set([0, 1]));
	});

	it("names its pages as the AC build knows them", () => {
		expect(rubberPage(0)).toEqual({ material: "Rubber_1", picture: "Rubber_1.png" });
		expect(isRubberPage("Rubber_2.png")).toBe(true);
		expect(isRubberPage("Rubber_used.png")).toBe(false);
		expect(RUBBER_STEP).toBe(0.25);
	});
});

describe("the wear and the cars’ width as the objects are written", () => {
	const base = { version: 3, layouts: {}, objects: [], marks: [] };
	it("are kept, checked; none said, none written", () => {
		const out = JSON.parse(
			JSON.stringify(cleanObjects({ ...base, wear: { paint: "used", rubber: "very_used" }, ai: { width: 1.8 } }), (_k, v) =>
				v && typeof v === "object" && "value" in v ? v.value : v,
			),
		);
		expect(out.wear).toEqual({ paint: "used", rubber: "very_used" });
		expect(out.ai).toEqual({ width: 1.8 });
		const none = cleanObjects(base) as Record<string, unknown>;
		expect("wear" in none || "ai" in none).toBe(false);
		expect(() => cleanObjects({ ...base, wear: { paint: "shiny" } })).toThrow(ObjectsError);
	});

	it("keeps the rubber marks, each checked; none, none written", () => {
		const curve = [
			{ p: [0, 0], in: [0, 0], out: [0, 3] },
			{ p: [0, 9], in: [0, -3], out: [0, 0] },
		];
		const out = JSON.parse(
			JSON.stringify(cleanObjects({ ...base, rubber: [{ name: "RUBBER_1", curve, closed: true, width: 1.54, wear: "used" }] }), (_k, v) =>
				v && typeof v === "object" && "value" in v ? v.value : v,
			),
		);
		// (a ring of two nodes is none)
		expect(out.rubber).toEqual([{ name: "RUBBER_1", curve, width: 1.54, wear: "used" }]);
		expect("rubber" in (cleanObjects(base) as Record<string, unknown>)).toBe(false);
		const bad = (m: Record<string, unknown>) => () => cleanObjects({ ...base, rubber: [{ name: "RUBBER_1", curve, width: 1.5, wear: "used", ...m }] });
		expect(bad({ wear: "new" })).toThrow(ObjectsError);
		expect(bad({ width: 0 })).toThrow(ObjectsError);
		expect(bad({ curve: curve.slice(0, 1) })).toThrow(ObjectsError);
		// (its name one of the objects', as a mark's)
		expect(() =>
			cleanObjects({
				...base,
				marks: [{ name: "RUBBER_1", curve, width: 0.1, colour: "white", style: "solid" }],
				rubber: [{ name: "RUBBER_1", curve, width: 1.5, wear: "used" }],
			}),
		).toThrow(ObjectsError);
		expect(() => cleanObjects({ ...base, ai: { width: 0 } })).toThrow(ObjectsError);
	});
});
