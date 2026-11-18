// A layout's racing lines made from roads clicked in the editor (the store's routing): the fast line along a
// triangle's three roads, round from its start line, closed; the pit lane along a fourth, forking off the fast line
// and merging back into it where its ends meet it; a click on the last road again takes it off.
import { describe, expect, it } from 'vitest';
import { forkAndMerge } from '../editing/lines';
import { loadedEditor, road } from '../test/fixtures';

describe('the racing lines made from roads', () => {
  it('makes the fast line round the lap clicked, then the pit lane off it', async () => {
    const { ed } = await loadedEditor([
      road('A', [0, 0], [100, 0]),
      road('B', [100, 0], [50, 80]),
      road('C', [50, 80], [0, 0]),
      road('PIT', [20, 2], [80, 2]),
    ]);
    const layout = ed.get().layout;
    // (no fast line yet: no pit lane)
    ed.startRouting('pit');
    expect(ed.get().routing).toBeNull();
    ed.startRouting('fast');
    // (the roads clicked in the lap's order, C the wrong way round: turned to go on)
    ed.routeAt(50, 0, 0.5);
    ed.routeAt(75, 40, 0.5);
    ed.routeAt(30, 50, 0.5);
    ed.routeAt(30, 50, 0.5);
    expect(ed.get().routing?.roads).toEqual(['A', 'B']);
    ed.routeAt(25, 40, 0.5);
    expect(ed.get().routing?.roads).toEqual(['A', 'B', 'C']);
    ed.makeRouted();
    const fast = ed.get().objects?.layouts[layout]?.lines?.fast;
    expect(fast?.closed).toBe(true);
    expect(fast?.curve.length).toBeGreaterThanOrEqual(3);
    // (from the start line: the layout's first timing gate, else its grid's first slot)
    const lay = ed.get().objects?.layouts[layout];
    const g = lay?.timing[0];
    const start = g ? [(g.left.x + g.right.x) / 2, (g.left.z + g.right.z) / 2] : [lay?.grid[0]?.x, lay?.grid[0]?.z];
    const first = fast?.curve[0]?.p as [number, number];
    const corners: [number, number][] = [
      [0, 0],
      [100, 0],
      [50, 80],
    ];
    // (on the lap, nearer the start than any corner of it is)
    expect(Math.hypot(first[0] - (start[0] as number), first[1] - (start[1] as number))).toBeLessThan(
      Math.min(...corners.map(([x, z]) => Math.hypot(x - (start[0] as number), z - (start[1] as number)))) + 1,
    );
    expect(ed.get().obj).toEqual({ kind: 'fast', i: 0, j: -1 });
    // (a node of it deleted: the line still picked)
    const nodes = fast?.curve.length ?? 0;
    if (nodes > 3) {
      ed.selectObject({ kind: 'fast', i: 0, j: 1 });
      ed.deleteObject();
      expect(ed.get().objects?.layouts[layout]?.lines?.fast?.curve.length).toBe(nodes - 1);
      expect(ed.get().obj).toEqual({ kind: 'fast', i: 0, j: -1 });
    }
    // (the pit lane along its road: forking off and merging into the fast line)
    ed.startRouting('pit');
    ed.routeAt(50, 2, 0.5);
    ed.makeRouted();
    const pit = ed.get().objects?.layouts[layout]?.lines?.pit;
    expect(pit?.closed).toBe(false);
    const fm = forkAndMerge(ed.get().objects?.layouts[layout]?.lines);
    expect(fm?.fork[1]).toBeCloseTo(0, 0);
    expect(fm?.merge[1]).toBeCloseTo(0, 0);
    expect(pit?.curve[0]?.p).toEqual(fm?.fork);
    expect(ed.get().dirty).toBe(true);
    // (undone: as it was)
    ed.undo();
    expect(ed.get().objects?.layouts[layout]?.lines?.pit).toBeUndefined();
  });
});
