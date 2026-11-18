import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { MapInteractions, type Pointer } from '../canvas/interactions';
import { toScreen } from '../canvas/viewport';
import { loadedEditor } from '../test/fixtures';
import { boxMarks, LINE_UPS, type LineUp, lineUp, spacingOf } from './lineup';

type Ed = Awaited<ReturnType<typeof loadedEditor>>['ed'];

/** The mouse at (x, z); not snapping (Ctrl) unless asked. */
const at = (ed: Ed, x: number, z: number, snap = false): Pointer => {
  const [sx, sy] = toScreen(ed.get().view, ed.get().size, x, z);
  return { sx, sy, button: 0, shift: false, alt: false, ctrl: !snap };
};

async function setup() {
  const t = await loadedEditor();
  t.ed.set({ view: { cx: 50, cz: 0, ppm: 10 }, size: { w: 1000, h: 800 } });
  return { ...t, mouse: new MapInteractions(t.ed) };
}

const click = (ed: Ed, mouse: MapInteractions, x: number, z: number) => {
  mouse.down(at(ed, x, z));
  mouse.up();
};

const plan = (u: Partial<LineUp> = {}): LineUp => ({ ...LINE_UPS.grid, ...u });

describe('a line-up', () => {
  it('in one file: from the first the way of the line, apart as asked or fit to it; facing back or along', () => {
    const one = lineUp(plan({ count: 3, rows: 1, spacing: 5, stagger: false }), [0, 0], [100, 0]);
    expect(one.map((s) => [s.x, s.z])).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
    // (facing back to the line's start: along -x)
    expect(one[0].heading).toBeCloseTo(-Math.PI / 2, 4);
    const fit = plan({ count: 3, rows: 1, fit: true, facing: 'along', stagger: false });
    expect(spacingOf(fit, [0, 0], [100, 0])).toBe(50);
    const spread = lineUp(fit, [0, 0], [100, 0]);
    expect(spread.at(-1)?.x).toBe(100);
    expect(spread[0].heading).toBeCloseTo(Math.PI / 2, 4);
    expect(lineUp(fit, [1, 1], [1, 1])).toEqual([]);
  });

  it('in rows: side by side, the first on its side, staggered; leaning off the line', () => {
    // (facing back, along -x: their left is +z)
    const rows = lineUp(plan({ count: 4, rows: 2, spacing: 6, across: 2, stagger: true }), [0, 0], [100, 0]);
    expect(rows.map((s) => [s.x, s.z])).toEqual([
      [0, 1],
      [3, -1],
      [6, 1],
      [9, -1],
    ]);
    const right = lineUp(plan({ count: 2, rows: 2, across: 2, stagger: false, first: 'right' }), [0, 0], [100, 0]);
    expect(right.map((s) => s.z)).toEqual([-1, 1]);
    const lean = lineUp(plan({ count: 1, rows: 1, facing: 'along', lean: 45 }), [0, 0], [0, 10]);
    expect(lean[0].heading).toBeCloseTo(Math.PI / 4, 4);
  });

  it('painted: a box round each, open at its back, or a line across its front', () => {
    const spot = [{ x: 0, z: 0, heading: 0 }];
    const box = { shape: 'box', width: 2, length: 4, line: 0.1, colour: 'white' } as const;
    const marks = boxMarks(spot, box, 'MARK_GRID_');
    expect(marks.map((m) => m.name)).toEqual(['MARK_GRID_1', 'MARK_GRID_2', 'MARK_GRID_3', 'MARK_GRID_4']);
    // (its front: across, at z 2, 2 m long)
    expect(marks[0]).toMatchObject({ p: [1, 2], length: 2, width: 0.1, colour: 'white', style: 'solid' });
    expect(boxMarks(spot, { ...box, shape: 'open' }, 'X')).toHaveLength(3);
    expect(boxMarks(spot, { ...box, shape: 'front' }, 'X')).toHaveLength(1);
    // (a bracket: its front, and its ends turned back half a metre, as the old grid marks were: [ )
    const bracket = boxMarks(spot, { ...box, shape: 'bracket', arm: 0.5 }, 'X');
    expect(bracket).toHaveLength(3);
    expect(bracket.slice(1).map((m) => [m.p, m.length])).toEqual([
      [[1, 2], 0.5],
      [[-1, 2], 0.5],
    ]);
    // (the paint's default for the grid and the pit boxes: white brackets)
    expect(LINE_UPS.gridPaint.box).toMatchObject({ shape: 'bracket', colour: 'white' });
    expect(LINE_UPS.pitPaint.box).toMatchObject({ shape: 'bracket', colour: 'white' });
  });
});

describe('laying out along a line', () => {
  it("puts down the layout's grid (and the same set's), drawn on the map; its paint apart, replaced when laid again", async () => {
    const { ed, mouse } = await setup();
    ed.setLining('grid', { count: 6, rows: 2, spacing: 5, across: 2, stagger: false });
    ed.drawLine();
    click(ed, mouse, 80, 0);
    mouse.move(at(ed, 60, 0));
    expect(ed.get().lining.lines.grid).toEqual({ a: [80, 0], b: [60, 0] });
    click(ed, mouse, 20, 0);
    expect(ed.get().lining.drawing).toBe(false);
    ed.placeLining();
    const grid = ed.get().objects?.layouts.vp_a.grid ?? [];
    expect(grid).toHaveLength(6);
    expect(grid[0]).toMatchObject({ x: 80, z: -1 });
    expect(grid[0].heading).toBeCloseTo(Math.PI / 2, 4);
    expect(ed.get().objects?.layouts.vp_b.grid).toEqual(grid);
    // (its paint: a line of its own, nothing laid out till asked)
    ed.setLining('gridPaint', { count: 2, rows: 1 });
    expect(ed.get().lining.lines.gridPaint).toEqual({ a: null, b: null });
    const marks = ed.get().objects?.marks.length ?? 0;
    ed.drawLine();
    click(ed, mouse, 30, 0);
    click(ed, mouse, 10, 0);
    ed.placeLining();
    expect(ed.get().objects?.marks.length).toBe(marks + 6);
    ed.placeLining();
    expect(ed.get().objects?.marks.length).toBe(marks + 6);
    // (round the layout's own slots: the paint along the line, away from them, kept; numbered on)
    ed.paintRoundSpots();
    const painted = () => ed.get().objects?.marks.filter((m) => m.name.startsWith('MARK_GRID_')) ?? [];
    expect(painted()).toHaveLength(18 + 6);
    expect(new Set(painted().map((m) => m.name)).size).toBe(24);
    ed.paintRoundSpots();
    expect(painted()).toHaveLength(24);
    // (Esc stops drawing first)
    ed.drawLine();
    ed.escape();
    expect(ed.get().lining.drawing).toBe(false);
  });

  it('paints a line across a road, edge to edge', async () => {
    const { ed, mouse } = await setup();
    ed.paintAcross();
    expect(ed.get()).toMatchObject({ mode: 'place', place: 'marks', markAcross: true });
    click(ed, mouse, 70, 1);
    const m = ed.get().objects?.marks.at(-1);
    expect(m).toMatchObject({ name: 'MARK_START_1', width: 0.3, length: 8 });
    expect(ed.get().obj).toMatchObject({ kind: 'marks', j: -1 });
    // (off the roads: nothing)
    const n = ed.get().objects?.marks.length;
    click(ed, mouse, 70, 300);
    expect(ed.get().objects?.marks.length).toBe(n);
    ed.setPlace('marks');
    expect(ed.get().markAcross).toBe(false);
  });

  it('is set in the panel: the grid and pits in Grid, timing & lines, their paint in Paint', async () => {
    const { ed } = await setup();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<App editor={ed} />);
    const sidebar = screen.getByRole('navigation', { name: 'Categories' });
    await userEvent.click(within(sidebar).getByRole('button', { name: /Grid, timing & lines/ }));
    const panel = screen.getByRole('region', { name: 'Lay Out Along a Line' });
    await userEvent.click(within(panel).getByRole('button', { name: 'One Line' }));
    expect(ed.get().lining.plans.grid.rows).toBe(1);
    expect(within(panel).getByRole('button', { name: /Place 12 Grid Slots/ })).toBeDisabled();
    await userEvent.click(within(panel).getByRole('button', { name: 'Draw the Line' }));
    expect(ed.get().lining.drawing).toBe(true);
    await userEvent.click(within(panel).getByRole('button', { name: 'Pit Boxes' }));
    expect(ed.get().lining.kind).toBe('pits');
    await userEvent.click(within(sidebar).getByRole('button', { name: /Paint/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Paint Marks' }));
    expect(ed.get().lining.kind).toBe('gridPaint');
    expect(screen.getByRole('button', { name: "Paint Round vp_a's 2" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paint a Line Across a Road' })).toBeInTheDocument();
  });
});
