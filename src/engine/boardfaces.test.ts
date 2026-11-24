// @vitest-environment node
// The marker boards' cards (boardfaces.ts): what each board says (its text, else its name's), the sheet of cards (a card a text, a blank one last, sides powers
// of two), each board's face on its text's card and its back on the blank one, the text sized to fit its card.
import { describe, expect, it } from "vitest";
import { BOARD_SHEET_MATERIAL, boardText, CARD, CARDS_ACROSS, CARDS_MATERIAL, cardSheet, cardUv, fitSize, onCards } from "./boardfaces";

describe("the boards' cards", () => {
	it("says its own text, else what its name says", () => {
		expect(boardText("BOARD_PIT")).toBe("PIT");
		expect(boardText("BOARD_PIT_2")).toBe("PIT");
		expect(boardText("BOARD_50_3")).toBe("50");
		expect(boardText("BOARD_PIT_IN")).toBe("PIT IN");
		expect(boardText("BOARD_PIT_2", "  NO ENTRY ")).toBe("NO ENTRY");
		expect(boardText("BOARD_PIT_2", "")).toBe("PIT");
		expect(boardText("BOARD")).toBe("");
	});

	it("puts a card a text on one sheet, a blank one last, its sides powers of two", () => {
		const sheet = cardSheet(["PIT", "50", "PIT", "", "100", "150", "200"]);
		expect(sheet.texts).toEqual(["100", "150", "200", "50", "PIT"]);
		expect(sheet.blank).toBe(5);
		expect(sheet.cardOf("PIT")).toBe(4);
		expect(sheet.cardOf("none such")).toBe(sheet.blank);
		// (six cards, four a row: two rows)
		expect([sheet.across, sheet.down]).toEqual([CARDS_ACROSS, 2]);
		// (nine cards: three rows, four down)
		expect(cardSheet(["a", "b", "c", "d", "e", "f", "g", "h"]).down).toBe(4);
		expect(cardSheet([]).down).toBe(1);
	});

	it("puts a board's face on its text's card, its back on the blank one, where each point is in its cell", () => {
		const sheet = cardSheet(["50", "PIT"]);
		// (the old sheet's front cell, u 0 to 0.5 and v 0 to 0.25; its back cell, v 0.75 to 1)
		const pit = sheet.cardOf("PIT");
		const [u0, v0] = cardUv(0.01, 0.01, sheet, "PIT");
		const [u1, v1] = cardUv(0.49, 0.24, sheet, "PIT");
		expect(u0).toBeCloseTo((pit % 4) / 4 + 0.02 / 4, 6);
		expect(v0).toBeCloseTo(0.04 / sheet.down, 6);
		expect(u1).toBeCloseTo((pit % 4) / 4 + 0.98 / 4, 6);
		expect(v1).toBeCloseTo(0.96 / sheet.down, 6);
		const [ub, vb] = cardUv(0.25, 0.875, sheet, "PIT");
		expect(ub).toBeCloseTo((sheet.blank % 4) / 4 + 0.5 / 4, 6);
		expect(vb).toBeCloseTo((Math.floor(sheet.blank / 4) + 0.5) / sheet.down, 6);
	});

	it("gives a board's face the cards' material, its hull as it is", () => {
		const sheet = cardSheet(["PIT"]);
		const V = new Float64Array(11);
		V[6] = 0.25;
		V[7] = 0.125;
		const parts = [
			{ part: "board", material: BOARD_SHEET_MATERIAL, V },
			{ part: "hull", material: BOARD_SHEET_MATERIAL, V },
		];
		const [face, hull] = onCards(parts, BOARD_SHEET_MATERIAL, sheet, "PIT");
		expect(face?.material).toBe(CARDS_MATERIAL);
		expect([face?.V[6], face?.V[7]]).toEqual([0.125, 0.5]);
		expect(hull).toBe(parts[1]);
		// (the template's own points untouched)
		expect([V[6], V[7]]).toEqual([0.25, 0.125]);
	});

	it("sizes a text to fit its card: across a long one, down a short one", () => {
		// (each letter as wide as half its size)
		const measure = (l: string, s: number) => l.length * s * 0.5;
		const long = fitSize(["PIT ENTRY"], measure);
		expect(long * 9 * 0.5).toBeCloseTo(CARD * 0.84, 6);
		const short = fitSize(["P"], measure);
		expect(short).toBeCloseTo((CARD * 0.7) / 1.1, 6);
		// (two lines: each its share of the height)
		expect(fitSize(["PIT", "IN"], measure)).toBeLessThanOrEqual((CARD * 0.7) / 2.2 + 1e-9);
	});
});
