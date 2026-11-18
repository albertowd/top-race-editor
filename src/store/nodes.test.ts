// Nodes on what is picked, the same whatever it is (strands.ts): added with Add Node (A) or a double click to a road, a
// tyre wall, a fence, an area, a racing line; deleted (picked by the node or by one of its handles) with the whole
// still picked; a node that is kept (a road's last two, an area's third corner, the pit line's fork) kept, and picked
// still; smoothed with S.
import { describe, expect, it } from 'vitest';
import { MapInteractions, type Pointer } from '../canvas/interactions';
import { toScreen } from '../canvas/viewport';
import { FORK } from '../editing/lines';
import { handleKey } from '../hooks/useShortcuts';
import { loadedEditor, road } from '../test/fixtures';

type Ed = Awaited<ReturnType<typeof loadedEditor>>['ed'];

async function setup() {
  const { ed } = await loadedEditor([road('A', [0, 0], [100, 0])]);
  ed.set({ view: { cx: 20, cz: 0, ppm: 10 }, size: { w: 1000, h: 800 } });
  return { ed, mouse: new MapInteractions(ed) };
}

const at = (ed: Ed, x: number, z: number): Pointer => {
  const [sx, sy] = toScreen(ed.get().view, ed.get().size, x, z);
  return { sx, sy, button: 0, shift: false, alt: false, ctrl: false };
};

const del = { key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false };

describe('the nodes of what is picked', () => {
  it('are added with Add Node, and deleted with the whole still picked', async () => {
    const { ed, mouse } = await setup();
    for (const [focus, kind] of [
      ['tyres', 'tyres'],
      ['scenery', 'fences'],
    ] as const) {
      ed.setFocus(focus);
      ed.set({ place: kind, mode: 'place', obj: null });
      mouse.down(at(ed, 10, -20));
      mouse.up();
      const i = ed.get().obj?.i ?? -1;
      const nodes = () => ed.get().objects?.objects[i]?.curve.length;
      // (Add Node: on past its end, then into it)
      ed.setMode('add');
      mouse.down(at(ed, 30, -20));
      mouse.up();
      expect(nodes()).toBe(2);
      mouse.down(at(ed, 20, -20));
      mouse.up();
      expect(nodes()).toBe(3);
      expect(ed.get().obj).toEqual({ kind, i, j: 1 });
      // (deleted by its handle: the node gone, the whole still picked)
      ed.selectObject({ kind, i, j: 1, h: 'out' });
      handleKey(ed, del);
      expect(nodes()).toBe(2);
      expect(ed.get().obj).toEqual({ kind, i, j: -1 });
      ed.setMode('select');
    }
  });

  it('adds a node with a double click on what is picked, whatever it is; not on a node, not off it', async () => {
    const { ed, mouse } = await setup();
    const click = (x: number, z: number) => {
      mouse.down(at(ed, x, z));
      mouse.up();
    };
    const double = (x: number, z: number) => {
      click(x, z);
      click(x, z);
      return mouse.double(at(ed, x, z));
    };
    // (a road: on it, a node there; on a node, or off it: none)
    ed.setFocus('roads');
    const roadNodes = () => ed.get().roads[0]?.curve?.length;
    expect(double(50, 0.5)).toBe(true);
    expect(roadNodes()).toBe(3);
    expect(ed.get().sel).toMatchObject({ r: 0, n: 1 });
    expect(double(50, 0)).toBe(false);
    expect(roadNodes()).toBe(3);
    // (a tyre wall)
    ed.setFocus('tyres');
    ed.set({ place: 'tyres', mode: 'place', obj: null });
    click(10, -20);
    click(30, -20);
    const i = ed.get().obj?.i ?? -1;
    ed.setMode('select');
    expect(double(20, -20)).toBe(true);
    expect(ed.get().objects?.objects[i]?.curve).toHaveLength(3);
    expect(ed.get().obj).toEqual({ kind: 'tyres', i, j: 1 });
    // (S: its handles smoothed, as a road's)
    ed.selectObject({ kind: 'tyres', i, j: -1 });
    handleKey(ed, { ...del, key: 's' });
    expect(ed.get().status).toMatch(/smoothed/);
    // (not while placing)
    ed.setMode('place');
    expect(mouse.double(at(ed, 15, -20))).toBe(false);
  });

  it('places a new one while another of its kind is picked; its next clicks go on laying the new one', async () => {
    const { ed, mouse } = await setup();
    const click = (x: number, z: number) => {
      mouse.down(at(ed, x, z));
      mouse.up();
    };
    for (const [focus, kind] of [
      ['tyres', 'tyres'],
      ['scenery', 'fences'],
    ] as const) {
      ed.setFocus(focus);
      ed.setPlace(kind);
      click(10, -20);
      click(30, -20);
      const first = ed.get().obj?.i ?? -1;
      const count = () => ed.get().objects?.objects.length ?? 0;
      const before = count();
      // (picked, then placing again: a new one, the one picked left as it was)
      ed.setMode('select');
      ed.selectObject({ kind, i: first, j: -1 });
      ed.setPlace(kind);
      click(10, -40);
      expect(count()).toBe(before + 1);
      const second = ed.get().obj?.i ?? -1;
      expect(second).not.toBe(first);
      expect(ed.get().objects?.objects[first]?.curve).toHaveLength(2);
      // (its next clicks: its nodes)
      click(30, -40);
      expect(count()).toBe(before + 1);
      expect(ed.get().objects?.objects[second]?.curve).toHaveLength(2);
      // (picked on the list while placing: placing makes a new one again)
      ed.selectObject({ kind, i: first, j: -1 });
      click(10, -60);
      expect(count()).toBe(before + 2);
      expect(ed.get().objects?.objects[first]?.curve).toHaveLength(2);
      // (Add Node still adds to the one picked)
      ed.selectObject({ kind, i: first, j: -1 });
      ed.setMode('add');
      click(40, -20);
      expect(ed.get().objects?.objects[first]?.curve).toHaveLength(3);
      ed.setMode('select');
    }
  });

  it('places a new area while another is picked', async () => {
    const { ed } = await setup();
    ed.setPlace('areas');
    ed.placeAt(50, 50);
    ed.setMode('select');
    ed.selectObject({ kind: 'areas', i: 0, j: -1 });
    ed.setPlace('areas');
    ed.placeAt(50, 50.5);
    expect(ed.get().objects?.areas).toHaveLength(2);
    expect(ed.get().objects?.areas?.[0]?.points).toHaveLength(4);
    expect(ed.get().obj).toEqual({ kind: 'areas', i: 1, j: -1 });
  });

  it("keeps a road's last two nodes, the road still selected", async () => {
    const { ed } = await setup();
    ed.setFocus('roads');
    ed.selectRoad(0);
    ed.select({ n: 0 });
    ed.deleteSelected();
    expect(ed.get().roads[0]?.curve).toHaveLength(2);
    expect(ed.get().sel.r).toBe(0);
    expect(ed.get().status).toMatch(/two nodes/);
  });

  it('adds an area corner on its nearest edge; keeps its third', async () => {
    const { ed } = await setup();
    ed.set({ place: 'areas', mode: 'place' });
    ed.placeAt(50, 50);
    ed.setMode('add');
    ed.addNodeAt(50, 80);
    expect(ed.get().objects?.areas?.[0]?.points).toHaveLength(5);
    for (const _ of [0, 1]) {
      ed.selectObject({ kind: 'areas', i: 0, j: 0 });
      ed.deleteObject();
    }
    ed.selectObject({ kind: 'areas', i: 0, j: 0 });
    ed.deleteObject();
    expect(ed.get().objects?.areas?.[0]?.points).toHaveLength(3);
    expect(ed.get().obj).toEqual({ kind: 'areas', i: 0, j: 0 });
    expect(ed.get().status).toMatch(/three corners/);
  });

  it("adds a racing line's node; keeps the pit line's fork", async () => {
    const { ed } = await setup();
    const layout = ed.get().layout;
    ed.set({ place: 'fast', mode: 'place' });
    for (const [x, z] of [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ] as const)
      ed.placeAt(x, z);
    const fast = () => ed.get().objects?.layouts[layout]?.lines?.fast?.curve.length;
    expect(fast()).toBe(4);
    ed.selectObject({ kind: 'fast', i: 0, j: -1 });
    ed.setMode('add');
    ed.addNodeAt(50, 0);
    expect(fast()).toBe(5);
    expect(ed.get().obj).toEqual({ kind: 'fast', i: 0, j: 1 });
    ed.set({ place: 'pit', mode: 'place', obj: null });
    ed.placeAt(50, 10);
    expect(ed.get().objects?.layouts[layout]?.lines?.pit).toBeDefined();
    ed.selectObject({ kind: 'pit', i: 0, j: FORK });
    ed.deleteObject();
    expect(ed.get().objects?.layouts[layout]?.lines?.pit).toBeDefined();
    expect(ed.get().obj).toEqual({ kind: 'pit', i: 0, j: FORK });
  });
});
