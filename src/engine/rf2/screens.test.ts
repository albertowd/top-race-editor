// The start gantry's board in rFactor 2 (rf2/screens.ts): found by its screen (the one showing start_board), its area as AC lays it out, and what each layout's
// says.
import { describe, expect, it } from "vitest";
import { boardLines, boardScreens, boardSizes, PRICES, priceScreens, pricesPicture, START_BOARD } from "./screens";

describe("rFactor 2's gantry boards", () => {
	it("finds the boards' screens by what they show, their area as AC's", () => {
		const screens = boardScreens({
			screens: [
				{ material: "GantryBoard", pixels: [2048, 320], area: [306, 8, 1436, 304], shows: START_BOARD },
				{ material: "OutFuelPrices", pixels: [512, 1024], shows: "prices" },
				{ material: "Plain", pixels: [256, 64], shows: START_BOARD },
			],
		});
		expect([...screens.keys()]).toEqual(["GantryBoard", "Plain"]);
		expect(screens.get("GantryBoard")).toEqual({ material: "GantryBoard", pixels: [2048, 320], area: [306, 8, 1436, 304] });
		// (no area: the whole picture)
		expect(screens.get("Plain")?.area).toEqual([0, 0, 256, 64]);
	});

	it("draws a prices screen's prices in seven segments, where AC's script writes them", () => {
		const screens = priceScreens({
			screens: [{ material: "OutFuelPrices", shows: PRICES, pixels: [512, 1024], background: [0, 0, 0], data: { prices: ["8.88", "1"] } }],
		});
		const s = screens.get("OutFuelPrices");
		expect(s?.prices).toEqual(["8.88", "1"]);
		const pic = pricesPicture(s as NonNullable<typeof s>);
		expect([pic.width, pic.height]).toEqual([512, 1024]);
		const red = (x: number, y: number) => pic.data[(y * pic.width + x) * 4] === 255;
		// (the first row's last 8, its cell 378 to 482 across, 130 to 380 down: its middle bar lit, the hole above it not)
		expect(red(430, 255)).toBe(true);
		expect(red(430, 200)).toBe(false);
		// (the second row's 1, right-aligned: its right bars lit, its left side dark)
		expect(red(466, 700)).toBe(true);
		expect(red(400, 700)).toBe(false);
		// (nothing over the rows)
		expect(red(256, 40)).toBe(false);
	});

	it("says the track's name over the layout's", () => {
		expect(boardLines("Velopark", "1500 Short")).toEqual(["Velopark", "1500 Short"]);
		expect(boardLines("Velopark", "Velopark")).toEqual(["Velopark"]);
		expect(boardLines("Velopark", "")).toEqual(["Velopark"]);
	});

	it("letters the layout's name the larger, each line within the area", () => {
		// (a letter as wide as half its size)
		const measure = (l: string, s: number) => l.length * s * 0.5;
		const [track, layout] = boardSizes(["VELOPARK", "1500"], 1000, 300, measure);
		expect(layout).toBeGreaterThan(track as number);
		expect(layout).toBeCloseTo(300 * 0.46);
		// (a long name made smaller to fit 90% of the width)
		const [long] = boardSizes(["A VERY LONG TRACK NAME INDEED"], 400, 300, measure);
		expect(measure("A VERY LONG TRACK NAME INDEED", long as number)).toBeCloseTo(400 * 0.9);
	});
});
