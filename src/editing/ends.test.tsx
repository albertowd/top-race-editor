import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MapInteractions, type Pointer } from '../canvas/interactions';
import { toScreen } from '../canvas/viewport';
import { NodeForm } from '../components/NodeForm';
import type { Road } from '../domain/types';
import { EditorProvider } from '../store/EditorContext';
import { loadedEditor, road } from '../test/fixtures';
import { EDGE_MAX, edgeAngle, keepEdge, squareLeft, turnEdge } from './ends';

type Ed = Awaited<ReturnType<typeof loadedEditor>>['ed'];

const at = (ed: Ed, x: number, z: number): Pointer => {
  const [sx, sy] = toScreen(ed.get().view, ed.get().size, x, z);
  return { sx, sy, button: 0, shift: false, alt: false, ctrl: false };
};

const twoRoads = () => [road('A', [0, 0], [100, 0]), road('B', [100, 0], [200, 0])];

async function setup(roads: Road[] = twoRoads()) {
  const t = await loadedEditor(roads);
  t.ed.set({ view: { cx: 50, cz: 0, ppm: 10 }, size: { w: 1000, h: 800 } });
  t.ed.setFocus('roads');
  t.ed.selectRoad(0);
  return { ...t, mouse: new MapInteractions(t.ed) };
}

/** The start's handle of road A (at a third of its length) dragged round to look along +z. */
function turnStartHandle(ed: Ed, mouse: MapInteractions) {
  mouse.down(at(ed, 100 / 3, 0));
  mouse.move(at(ed, 0, 100 / 3));
  mouse.up();
}

describe("a road's end edge", () => {
  it('is turned off square, as far as it may; square again within a degree and a half, or asked', () => {
    const r = road('A', [0, 0], [100, 0]);
    expect(squareLeft(r, 0)).toEqual([-0, 1]);
    turnEdge(r, 0, 30);
    expect(edgeAngle(r, 0)).toBeCloseTo(30, 4);
    turnEdge(r, 1, 120);
    expect(edgeAngle(r, 1)).toBeCloseTo(EDGE_MAX, 4);
    turnEdge(r, 0, 1);
    expect(r.start_left).toBeUndefined();
    turnEdge(r, 1, null);
    expect(r.end_left).toBeUndefined();
    // (a node between has no edge)
    const three = road('C', [0, 0], [10, 0]);
    three.curve?.splice(1, 0, { p: [5, 0], in: [-1, 0], out: [1, 0], left: 4, right: 4 });
    turnEdge(three, 1, 20);
    expect(edgeAngle(three, 1)).toBe(0);
  });

  it('turns with its end handle: square, or as far off square as it was', async () => {
    const { ed, mouse } = await setup();
    turnStartHandle(ed, mouse);
    const a = ed.get().roads[0];
    expect(a.curve?.[0].out[0]).toBeCloseTo(0, 6);
    // (square: no edge kept, it follows the road)
    expect(a.start_left).toBeUndefined();
    expect(squareLeft(a, 0)).toEqual([-1, 0]);
    // (turned off square: turned with it, as far off)
    const { ed: ed2, mouse: mouse2 } = await setup();
    ed2.change((r) => turnEdge(r, 0, 20), true);
    const before = ed2.get().roads[0].start_left as [number, number];
    turnStartHandle(ed2, mouse2);
    const b = ed2.get().roads[0];
    expect(edgeAngle(b, 0)).toBeCloseTo(20, 4);
    const [x, z] = b.start_left as [number, number];
    expect(x).toBeCloseTo(-before[1], 5);
    expect(z).toBeCloseTo(before[0], 5);
  });

  it('leaves a joined end to its joint', () => {
    const r = road('A', [0, 0], [100, 0]);
    r.start_left = [0.5, 0.5];
    const nd = r.curve?.[0];
    if (nd) nd.joint = { road: 'X', node: 'end' };
    keepEdge(r, 0, () => {
      if (nd) nd.out = [0, 10];
    });
    expect(r.start_left).toEqual([0.5, 0.5]);
  });
});

describe("the node form's edge", () => {
  it("at either end: its angle off square typed, made square again; a joined end's, square", async () => {
    const { ed } = await setup();
    render(
      <EditorProvider editor={ed}>
        <NodeForm />
      </EditorProvider>,
    );
    act(() => ed.set({ sel: { r: 0, n: 0, line: -1, kerb: -1 } }));
    const field = screen.getByLabelText('Start edge, degrees off square');
    expect(field).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'Square' })).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, '-25{Enter}');
    expect(edgeAngle(ed.get().roads[0], 0)).toBeCloseTo(-25, 4);
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    expect(ed.get().roads[0].start_left).toBeUndefined();
    // (the end's too)
    act(() => ed.set({ sel: { r: 0, n: 1, line: -1, kerb: -1 } }));
    const end = screen.getByLabelText('End edge, degrees off square');
    await userEvent.clear(end);
    await userEvent.type(end, '15{Enter}');
    expect(edgeAngle(ed.get().roads[0], 1)).toBeCloseTo(15, 4);
    // (joined: square, as the road it is joined to)
    act(() => ed.joinNearest(1));
    expect(screen.getByText(/square, as the road it is joined to/)).toBeInTheDocument();
    expect(screen.queryByLabelText('End edge, degrees off square')).toBeNull();
  });
});
