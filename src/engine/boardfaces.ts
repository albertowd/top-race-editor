// The marker boards' faces made by the editor: each board's text (its own, else what its name says: BOARD_PIT_2, PIT)
// drawn on a card of its own, as large as fits it, the cards side by side on one sheet (BoardCards.png); each board's
// face pointed at its card, its back at a blank one.
//
// The board model's face is a cell of the old sheet of boards (MarkerBoards.png: two cells across, four down): its
// front the first cell of the first row (u 0 to 0.5, v 0 to 0.25), its back the first of the last row (v 0.75 to 1).
// Where its points are within those cells is kept within its card.

/** the board model's material: the old sheet of boards */
export const BOARD_SHEET_MATERIAL = 'MarkerBoards';
/** the material the cards are drawn with, and its picture */
export const CARDS_MATERIAL = 'BoardCards';
export const CARDS_PICTURE = 'BoardCards.png';
/** pixels a card's side; cards a row of the sheet */
export const CARD = 256;
export const CARDS_ACROSS = 4;

/** What a board says: its text, else its name's (BOARD_ and a trailing _<number> off, _ as spaces); '' for none. */
export function boardText(name: string, text?: string | null): string {
  const own = (text ?? '').trim();
  if (own) return own;
  return name
    .replace(/^BOARD_?/i, '')
    .replace(/_\d+$/, '')
    .replace(/_/g, ' ')
    .trim();
}

/** The sheet of cards for the texts given: each text's card (its place on the sheet), a blank card last (the boards'
 * backs, and a board with no text); the sheet's size in cards (its rows a power of two, its sides then powers of two). */
export interface CardSheet {
  texts: string[];
  /** a text's card; the blank card for one not on the sheet */
  cardOf(text: string): number;
  blank: number;
  across: number;
  down: number;
}

export function cardSheet(texts: Iterable<string>): CardSheet {
  const list = [...new Set([...texts].filter((t) => t.trim()))].sort();
  const blank = list.length;
  const used = Math.ceil((list.length + 1) / CARDS_ACROSS);
  const down = 2 ** Math.ceil(Math.log2(Math.max(used, 1)));
  const at = new Map(list.map((t, i) => [t, i]));
  return { texts: list, cardOf: (t) => at.get(t.trim()) ?? blank, blank, across: CARDS_ACROSS, down };
}

/** A board model's point's (u, v) on the old sheet, onto its card's on the cards' sheet: its front's onto the text's
 * card, its back's onto the blank one. */
export function cardUv(u: number, v: number, sheet: CardSheet, text: string): [number, number] {
  const back = v >= 0.5;
  const card = back ? sheet.blank : sheet.cardOf(text);
  // (where it is within its cell of the old sheet, 0 to 1 each way)
  const fu = Math.min(Math.max(u / 0.5, 0), 1);
  const fv = Math.min(Math.max((back ? v - 0.75 : v) / 0.25, 0), 1);
  const col = card % sheet.across;
  const row = Math.floor(card / sheet.across);
  return [(col + fu) / sheet.across, (row + fv) / sheet.down];
}

/** A board's parts with their faces on its card: each part in the old sheet's material (MarkerBoards) given its card's
 * (u, v) and the cards' material; the rest (its hull) as they are. Points eleven numbers each, u v at 6 and 7. */
export function onCards<P extends { V: Float64Array; material: string; part: string }>(
  parts: P[],
  boardMaterial: string,
  sheet: CardSheet,
  text: string,
): P[] {
  return parts.map((p) => {
    if (p.part === 'hull' || p.material !== boardMaterial) return p;
    const V = Float64Array.from(p.V);
    for (let k = 0; k < V.length; k += 11) {
      const [u, v] = cardUv(V[k + 6] as number, V[k + 7] as number, sheet, text);
      V[k + 6] = u;
      V[k + 7] = v;
    }
    return { ...p, V, material: CARDS_MATERIAL };
  });
}

/** Draws the sheet of cards as a PNG (where the engine runs: Chromium's canvas). */
export type CardPainter = (sheet: CardSheet) => Promise<Uint8Array>;

/** The size a line of text is drawn at to fit its card: as large as fits within 84% of it across and its share of 70%
 * of it down (measure: a line's width at a size). */
export function fitSize(lines: string[], measure: (line: string, size: number) => number, card = CARD): number {
  const tall = (card * 0.7) / (lines.length * 1.1);
  const probe = 100;
  const widest = Math.max(...lines.map((l) => measure(l, probe)), 1);
  return Math.max(4, Math.min(tall, (probe * card * 0.84) / widest));
}

const FONT = (size: number) => `bold ${size}px "Arial Narrow", Arial, Helvetica, sans-serif`;

/** The cards drawn on Chromium's canvas: each white with a grey edge, its text black in the middle, as large as fits
 * (lines split at a line break or a |). */
export const canvasCards: CardPainter = async (sheet) => {
  if (typeof OffscreenCanvas === 'undefined') throw new Error("no canvas here to draw the boards' cards on");
  const canvas = new OffscreenCanvas(sheet.across * CARD, sheet.down * CARD);
  const g = canvas.getContext('2d');
  if (!g) throw new Error("no canvas to draw the boards' cards on");
  g.fillStyle = '#d9d6cf';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const cards = [...sheet.texts, ''];
  cards.forEach((text, i) => {
    const x = (i % sheet.across) * CARD;
    const y = Math.floor(i / sheet.across) * CARD;
    g.fillStyle = '#f1efe9';
    g.fillRect(x, y, CARD, CARD);
    g.strokeStyle = '#b9b5ac';
    g.lineWidth = CARD * 0.03;
    g.strokeRect(x + CARD * 0.05, y + CARD * 0.06, CARD * 0.9, CARD * 0.88);
    if (!text) return;
    const lines = text.split(/\n|\|/).map((l) => l.trim());
    const size = fitSize(lines, (l, s) => {
      g.font = FONT(s);
      return g.measureText(l).width;
    });
    g.font = FONT(size);
    g.fillStyle = '#141414';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = size * 1.1;
    lines.forEach((l, k) => {
      g.fillText(l, x + CARD / 2, y + CARD / 2 + (k - (lines.length - 1) / 2) * step);
    });
  });
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
};
