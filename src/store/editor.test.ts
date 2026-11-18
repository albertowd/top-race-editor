import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Road } from '../domain/types';
import { loadedEditor, road, threeRoads } from '../test/fixtures';
import { createEditor } from './editor';

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('the editor', () => {
  it('loads the track: its roads, the track now, the view on the first road', async () => {
    const { ed } = await loadedEditor([
      { ...road('A', [5, 6], [100, 0]), kerbs: [{ side: 'left', kind: 'yellow' as never }] },
    ]);
    const s = ed.get();
    expect(s.track?.name).toBe('Test');
    expect(s.roads[0].was).toBe('A');
    expect(s.roads[0].kerbs?.[0].kind).toBe('round');
    expect(s.context).toHaveLength(1);
    expect([s.view.cx, s.view.cz]).toEqual([5, 6]);
    expect(s.status).toBe('loaded 1 roads');
    expect(s.dirty).toBe(false);
  });

  it('says so when it cannot load', async () => {
    const { ed, engine } = await loadedEditor();
    engine.fail['/api/roads'] = 'down';
    await ed.load();
    expect(ed.get().status).toBe('could not load: down');
  });

  it('changes the selected road, remembered: undone and done again', async () => {
    const { ed } = await loadedEditor();
    ed.selectRoad(0);
    const before = ed.get().roads;
    ed.change((r) => {
      r.material = 'Pavers';
    });
    expect(ed.get().roads[0].material).toBe('Pavers');
    expect(ed.get().roads[0].moved).toBeUndefined();
    expect(ed.get().roads[1]).toBe(before[1]);
    expect(ed.get().dirty).toBe(true);
    ed.undo();
    expect(ed.get().roads).toBe(before);
    ed.redo();
    expect(ed.get().roads[0].material).toBe('Pavers');
    ed.redo();
    ed.change((r) => {
      if (r.curve) r.curve[0].left = 6;
    }, true);
    expect(ed.get().roads[0].moved).toBe(true);
    expect(ed.get().undo).toHaveLength(2);
  });

  it('saves: what changed in shape, the roads deleted; names must differ', async () => {
    const { ed, engine, dialogs } = await loadedEditor();
    ed.selectRoad(2);
    ed.deleteRoad();
    ed.selectRoad(0);
    ed.change((r) => {
      if (r.curve) r.curve[0].p = [1, 1];
    }, true);
    await ed.save();
    const body = engine.calls.find((c) => c.path === '/api/save')?.body as { roads: Road[]; deleted: string[] };
    expect(body.deleted).toEqual(['C']);
    expect(body.roads.map((r) => r.name)).toEqual(['A', 'B']);
    expect(ed.get().status).toBe('saved — heights recorded again at the next build for: A');
    expect(ed.get().dirty).toBe(false);
    expect(ed.get().deleted).toEqual([]);
    expect(ed.get().sel.r).toBe(0);

    ed.rename('B');
    await ed.save();
    expect(dialogs.alerts).toEqual(['Two roads are named B.']);
    engine.fail['/api/save'] = 'disk full';
    ed.rename('A');
    await ed.save();
    expect(dialogs.alerts[1]).toBe('Not saved: disk full');
  });

  it('renames a road, the joints naming it too', async () => {
    const { ed } = await loadedEditor();
    ed.selectRoad(1);
    ed.set({ sel: { r: 1, n: 0, line: -1, kerb: -1 } });
    ed.joinNearest();
    expect(ed.get().status).toBe("joined B's start to A's end");
    ed.selectRoad(0);
    ed.rename(' A2 ');
    expect(ed.get().roads[1].curve?.[0].joint?.road).toBe('A2');
    ed.rename('');
    expect(ed.get().roads[0].name).toBe('A2');
  });

  it('tells why it cannot join', async () => {
    const { ed, dialogs } = await loadedEditor();
    ed.set({ sel: { r: 2, n: 0, line: -1, kerb: -1 } });
    ed.joinNearest();
    expect(dialogs.alerts[0]).toMatch(/within 20 m/);
    expect(ed.get().undo).toHaveLength(0);
  });

  it('adds nodes, run-off width points, and deletes what is selected', async () => {
    const { ed, dialogs } = await loadedEditor([
      ...threeRoads(),
      { name: 'R', along: { road: 'A', side: 'left', from: 10, to: 50 }, width: 2 },
    ]);
    ed.selectRoad(0);
    ed.addNodeAt(40, 1);
    expect(ed.get().roads[0].curve).toHaveLength(3);
    expect(ed.get().sel.n).toBe(1);
    ed.deleteSelected();
    expect(ed.get().roads[0].curve).toHaveLength(2);
    ed.deleteSelected(); // (nothing selected: nothing done)
    expect(ed.get().undo).toHaveLength(2);

    ed.selectRoad(3);
    ed.addNodeAt(20, 6);
    const profile = ed.get().roads[3].profile ?? [];
    expect(profile).toHaveLength(2);
    expect(profile[0][0]).toBeCloseTo(20, 0);
    expect(profile[1]).toEqual([30, 2]);
    ed.set({ sel: { ...ed.get().sel, n: 0 } });
    ed.deleteSelected();
    ed.set({ sel: { ...ed.get().sel, n: 0 } });
    ed.deleteSelected();
    expect(ed.get().roads[3].profile).toBeUndefined();
    expect(ed.get().roads[3].width).toBe(2);

    ed.selectRoad(1);
    ed.set({ sel: { r: 1, n: 0, line: -1, kerb: -1 } });
    ed.joinNearest();
    ed.addNodeAt(80, 0);
    expect(ed.get().roads[1].curve).toHaveLength(2);
    expect(dialogs.alerts).toEqual(['That end is joined to A: unjoin it first to make the road longer there.']);
  });

  it('adds, selects and removes lines and rumbles', async () => {
    const { ed } = await loadedEditor();
    ed.selectRoad(0);
    ed.addLine('left');
    ed.addKerb('right');
    const r = ed.get().roads[0];
    expect(r.lines?.[0]).toEqual({ name: 'LINE_ROAD_A_L', side: 'left', from: 0, to: null, colour: 'white' });
    expect(r.kerbs?.[0]).toMatchObject({ side: 'right', from: 0, to: 10, kind: 'ramp' });
    expect(ed.get().sel).toMatchObject({ line: -1, kerb: 0 });
    ed.selectItem('line', 0);
    ed.deleteSelected();
    expect(ed.get().roads[0].lines).toEqual([]);
    ed.removeItem('kerb', 0);
    expect(ed.get().roads[0].kerbs).toEqual([]);
  });

  it('reorders, reverses, smooths and deletes roads', async () => {
    const { ed } = await loadedEditor([], { confirm: false });
    ed.set({ roads: threeRoads() });
    ed.selectRoad(0);
    ed.moveRoad(1);
    expect(ed.get().roads.map((r) => r.name)).toEqual(['B', 'A', 'C']);
    expect(ed.get().sel.r).toBe(1);
    ed.moveRoad(5);
    ed.reverse();
    expect(ed.get().roads[1].curve?.[0].p).toEqual([100, 0]);
    ed.smooth(-1);
    expect(ed.get().roads[1].moved).toBe(true);
    ed.deleteRoad();
    expect(ed.get().roads).toHaveLength(3);
    ed.set({ sel: { r: -1, n: -1, line: -1, kerb: -1 } });
    ed.deleteRoad();
    expect(ed.get().status).toBe('select a road to delete first');
  });

  it('draws a new road through clicked points', async () => {
    const { ed } = await loadedEditor();
    ed.setMode('new');
    ed.addNewRoadPoint([0, 50]);
    ed.addNewRoadPoint([30, 60]);
    ed.addNewRoadPoint([60, 50]);
    ed.finishNewRoad();
    const r = ed.get().roads[3];
    expect(r.name).toBe('1ROAD_NEW_4');
    expect(r.curve).toHaveLength(3);
    expect(ed.get().sel.r).toBe(3);
    expect(ed.get().mode).toBe('select');
    ed.setMode('new');
    ed.addNewRoadPoint([0, 0]);
    ed.finishNewRoad();
    expect(ed.get().roads).toHaveLength(4);
  });

  it('names a new road itself, with a name no road has (no prompt: the desktop app has none)', async () => {
    const { ed, dialogs } = await loadedEditor();
    for (const k of [0, 1]) {
      ed.setMode('new');
      ed.addNewRoadPoint([0, k * 10]);
      ed.addNewRoadPoint([30, k * 10]);
      ed.finishNewRoad();
    }
    expect(
      ed
        .get()
        .roads.map((r) => r.name)
        .slice(3),
    ).toEqual(['1ROAD_NEW_4', '1ROAD_NEW_5']);
    // (one named so already: the next free name)
    ed.setMode('new');
    ed.addNewRoadPoint([0, 50]);
    expect(ed.get().newRoad?.name).toBe('1ROAD_NEW_6');
    expect(dialogs.alerts).toEqual([]);
  });

  it('brings in a road the track has, read from its mesh', async () => {
    const { ed } = await loadedEditor();
    await ed.openBring();
    expect(ed.get().bring).toMatchObject({ open: true, loading: false });
    expect(ed.get().bring.meshes.map((m) => m.name)).toEqual(['1ROAD_X']);
    await ed.bringIn(ed.get().bring.meshes[0]);
    const s = ed.get();
    expect(s.roads[3]).toMatchObject({ name: '1ROAD_X', moved: true, lines: [], kerbs: [] });
    expect(s.sel.r).toBe(3);
    expect(s.bring.open).toBe(false);
    expect([s.view.cx, s.view.cz]).toEqual([5, 5]);
    expect(s.status).toBe('brought in 1ROAD_X (read from its outline); not saved yet');
  });

  it('checks the surface where one looks, then knows it out of date', async () => {
    const { ed } = await loadedEditor();
    ed.set({ view: { cx: 0, cz: 0, ppm: 1 }, size: { w: 1000, h: 100 } });
    await ed.checkSurface();
    const sf = ed.get().surface;
    expect(sf?.window).toEqual([-75, -50, 75, 50]);
    expect(sf?.issues).toHaveLength(1);
    expect(ed.get().status).toMatch(/^1 seam problems here/);
    ed.selectRoad(0);
    ed.change((r) => {
      r.material = 'Pavers';
    });
    expect(ed.get().surface?.stale).toBe(true);
  });

  it('asks for the wireframes of the selected road and those joined to it, once each shape', async () => {
    const { ed, engine } = await loadedEditor();
    ed.set({ sel: { r: 1, n: 0, line: -1, kerb: -1 } });
    ed.joinNearest();
    await flush();
    await flush();
    const asked = () =>
      engine.calls.filter((c) => c.path === '/api/mesh').map((c) => (c.body as { road: Road }).road.name);
    expect(asked()).toEqual(['B', 'A']);
    expect(ed.get().meshes.B.state).toBe('ready');
    ed.change((r) => {
      r.material = 'Pavers';
    });
    await flush();
    expect(asked()).toEqual(['B', 'A']);
    // (the wireframe not shown, the meshes still made again: each is checked for faces wrong in the game)
    ed.setLayer('wire', false);
    ed.change((r) => {
      if (r.curve) r.curve[1].left = 7;
    }, true);
    await flush();
    await flush();
    expect(asked()).toEqual(['B', 'A', 'B', 'A']);
  });

  it('cancels what it was doing on Escape: the dialog first', async () => {
    const { ed } = await loadedEditor();
    ed.set({
      bring: { open: true, loading: false, meshes: [] },
      mode: 'measure',
      sel: { r: 0, n: 1, line: 0, kerb: -1 },
    });
    ed.escape();
    expect(ed.get().bring.open).toBe(false);
    expect(ed.get().mode).toBe('measure');
    ed.escape();
    expect(ed.get().mode).toBe('select');
    expect(ed.get().sel).toEqual({ r: 0, n: -1, line: -1, kerb: -1 });
    ed.toggleHelp();
    expect(ed.get().helpOpen).toBe(true);
  });

  it('keeps the undo list to its depth', () => {
    const ed = createEditor(undefined as never, { meshDelay: 1e9 });
    ed.set({ roads: threeRoads(), sel: { r: 0, n: -1, line: -1, kerb: -1 } });
    for (let i = 0; i < 160; i++)
      ed.change((r) => {
        r.material = String(i);
      });
    expect(ed.get().undo).toHaveLength(150);
  });
});
