import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MapInteractions, type Pointer } from '../canvas/interactions';
import { turnHandle } from '../canvas/objects';
import { drawFrame, RenderCache } from '../canvas/renderer';
import { toScreen } from '../canvas/viewport';
import { ObjectForm, ObjectsPanel } from '../components/ObjectsPanel';
import type { TrackObjects } from '../domain/types';
import { countOf } from '../editing/objects';
import { handleKey } from '../hooks/useShortcuts';
import { loadedEditor, road } from '../test/fixtures';
import { RecordingPath } from '../test/legacy';
import { EditorProvider } from './EditorContext';

type Ed = Awaited<ReturnType<typeof loadedEditor>>['ed'];

async function setup() {
  const t = await loadedEditor([road('A', [0, 0], [100, 0])]);
  t.ed.set({ view: { cx: 20, cz: 0, ppm: 10 }, size: { w: 1000, h: 800 } });
  return { ...t, mouse: new MapInteractions(t.ed) };
}

const at = (ed: Ed, x: number, z: number, extra: Partial<Pointer> = {}): Pointer => {
  const [sx, sy] = toScreen(ed.get().view, ed.get().size, x, z);
  return { sx, sy, button: 0, shift: false, alt: false, ctrl: false, ...extra };
};

describe('the objects in the editor', () => {
  const Path2DWas = globalThis.Path2D;
  beforeAll(() => {
    globalThis.Path2D = RecordingPath as unknown as typeof Path2D;
  });
  afterAll(() => {
    globalThis.Path2D = Path2DWas;
  });

  it('loads them with the roads, the first layout shown', async () => {
    const { ed } = await setup();
    expect(ed.get().objects?.layouts.vp_a.grid).toHaveLength(2);
    expect(ed.get().layout).toBe('vp_a');
    expect(ed.get().objectsSeeded).toBe(false);
    ed.setLayout('vp_b');
    expect(ed.get().layout).toBe('vp_b');
    ed.setLayout('nope');
    expect(ed.get().layout).toBe('vp_b');
  });

  it('says so when they are read from the models, or cannot be had', async () => {
    const t = await loadedEditor();
    t.engine.seeded = true;
    await t.ed.load();
    expect(t.ed.get().status).toMatch(/objects read from the models/);
    t.engine.fail['/api/objects'] = 'old engine';
    await t.ed.load();
    expect(t.ed.get().objects).toBeNull();
    expect(t.ed.get().status).toBe('loaded 3 roads; could not load the objects: old engine');
  });

  it('places one of the kind picked, facing as the last; the layouts with the same set follow', async () => {
    const { ed, mouse } = await setup();
    ed.setPlace('pits');
    expect(ed.get().mode).toBe('place');
    mouse.down(at(ed, 22, 10));
    mouse.up();
    const pits = ed.get().objects?.layouts;
    expect(pits?.vp_a.pits).toHaveLength(2);
    expect(pits?.vp_b.pits).toHaveLength(2);
    expect(ed.get().obj).toEqual({ kind: 'pits', i: 1, j: -1 });
    expect(ed.get().status).toBe('Pit box added to vp_a; not saved yet');
    ed.setTogether(false);
    mouse.down(at(ed, 24, 10));
    expect(ed.get().objects?.layouts.vp_a.pits).toHaveLength(3);
    expect(ed.get().objects?.layouts.vp_b.pits).toHaveLength(2);
    // (a gate across the road; the first cone along it)
    ed.setPlace('timing');
    mouse.down(at(ed, 50, 1));
    const gate = ed.get().objects?.layouts.vp_a.timing[1];
    expect(gate?.left.z).toBeCloseTo(4, 6);
    expect(gate?.right.z).toBeCloseTo(-4, 6);
    const o = ed.get().objects as TrackObjects;
    ed.set({ objects: { ...o, objects: o.objects.filter((t) => t.model !== 'light_pole') } });
    ed.setPlace('poles');
    mouse.down(at(ed, 60, 10));
    expect(ed.get().objects?.objects.find((t) => t.model === 'light_pole')?.heading).toBeCloseTo(Math.PI / 2, 6);
  });

  it('adds nodes to the tyre wall picked, bends it by a handle, smooths it with S', async () => {
    const { ed, mouse } = await setup();
    ed.selectObject({ kind: 'tyres', i: 0, j: -1 });
    ed.setMode('add');
    mouse.down(at(ed, 0.7, -10));
    expect(ed.get().objects?.objects[0].curve).toHaveLength(3);
    expect(ed.get().obj).toEqual({ kind: 'tyres', i: 0, j: 1 });
    ed.setMode('select');
    // (its first node's out handle: a third of the way to the next node before the split, half that after)
    const out = ed.get().objects?.objects[0].curve[0].out ?? [0, 0];
    mouse.down(at(ed, out[0], -10 + out[1]));
    expect(ed.get().obj).toEqual({ kind: 'tyres', i: 0, j: 0, h: 'out' });
    mouse.move(at(ed, 0.3, -9.5));
    mouse.up();
    const first = ed.get().objects?.objects[0].curve[0];
    expect(first?.out[0]).toBeCloseTo(0.3, 6);
    expect(first?.out[1]).toBeCloseTo(0.5, 6);
    ed.selectObject({ kind: 'tyres', i: 0, j: -1 });
    handleKey(ed, { key: 's', ctrlKey: false, metaKey: false, shiftKey: false });
    expect(ed.get().objects?.objects[0].curve[0].out[1]).toBeCloseTo(0, 6);
  });

  it('drags an object, all of its kind with Shift, and turns it by its handle', async () => {
    const { ed, mouse } = await setup();
    mouse.down(at(ed, 10, 0));
    expect(ed.get().obj).toEqual({ kind: 'grid', i: 0, j: -1 });
    mouse.move(at(ed, 11, 1));
    mouse.up();
    expect(ed.get().objects?.layouts.vp_a.grid[0]).toMatchObject({ x: 11, z: 1 });
    expect(ed.get().objects?.layouts.vp_b.grid[0]).toMatchObject({ x: 11, z: 1 });
    expect(ed.get().undo).toHaveLength(1);
    mouse.down(at(ed, 4, 2, { shift: true }));
    mouse.move(at(ed, 4, 3, { shift: true }));
    mouse.up();
    expect(ed.get().objects?.layouts.vp_a.grid.map((s) => s.z)).toEqual([2, 3]);
    // (the handle, TURN_PX along its heading; dragged round to look along -z)
    const s = ed.get();
    const h = turnHandle(s.objects as never, s.layout, s.obj, (x, z) => toScreen(s.view, s.size, x, z)) as [
      number,
      number,
    ];
    mouse.down({ sx: h[0], sy: h[1], button: 0, shift: false, alt: false, ctrl: false });
    mouse.move(at(ed, 4, -5));
    mouse.up();
    expect(ed.get().objects?.layouts.vp_a.grid[1].heading).toBeCloseTo(Math.PI, 6);
    // (a press that moved nothing is forgotten)
    const undo = ed.get().undo.length;
    mouse.down(at(ed, 40, 5));
    mouse.up();
    expect(ed.get().undo).toHaveLength(undo);
    expect(mouse.move(at(ed, 40, 5))).toBe('grab');
  });

  it('undoes an object edit with the roads as they were; deletes and reorders the one picked', async () => {
    const { ed } = await setup();
    const before = ed.get().objects;
    ed.selectObject({ kind: 'grid', i: 0, j: -1 });
    ed.deleteSelected();
    expect(ed.get().objects?.layouts.vp_a.grid).toHaveLength(1);
    expect(ed.get().obj).toBeNull();
    ed.undo();
    expect(ed.get().objects).toBe(before);
    ed.redo();
    expect(ed.get().objects?.layouts.vp_a.grid).toHaveLength(1);
    ed.undo();
    ed.setTogether(false);
    ed.selectObject({ kind: 'grid', i: 0, j: -1 });
    ed.reorder(1);
    expect(ed.get().obj).toEqual({ kind: 'grid', i: 1, j: -1 });
    expect(ed.get().objects?.layouts.vp_a.grid[1].x).toBe(10);
    ed.reorder(1);
    expect(ed.get().undo).toHaveLength(1);
    ed.copyFrom('vp_b', 'grid');
    expect(ed.get().objects?.layouts.vp_a.grid[0].x).toBe(10);
    expect(ed.spotPicked()).toBeNull();
  });

  it('saves only the objects when only they changed; the roads too when they did', async () => {
    const { ed, engine } = await setup();
    ed.selectObject({ kind: 'cones', i: 2, j: -1 });
    ed.deleteObject();
    await ed.save();
    expect(engine.calls.filter((c) => c.path === '/api/save')).toHaveLength(0);
    const sent = engine.calls.find((c) => c.path === '/api/objects' && c.body) as {
      body: { objects: TrackObjects };
    };
    expect(sent.body.objects.objects.filter((t) => t.model === 'cone')).toHaveLength(0);
    // (the broad leaf tree placed among the objects saved as one of the track's trees now)
    expect(ed.get().status).toBe('objects and 1 trees saved');
    expect(ed.get().dirty).toBe(false);
    ed.selectRoad(0);
    ed.change((r) => {
      r.material = 'Pavers';
    });
    await ed.save();
    expect(engine.calls.filter((c) => c.path === '/api/save')).toHaveLength(1);
    expect(engine.calls.filter((c) => c.path === '/api/objects' && c.body)).toHaveLength(1);
    expect(ed.get().status).toBe('saved');
  });

  it('edits the track’s trees among the objects and saves them apart, as the track keeps them', async () => {
    const t = await loadedEditor([road('A', [0, 0], [100, 0])]);
    t.engine.trees = [
      { model: 'euca_6', x: 10, z: 20, heading: 1, scale: 1.5 },
      { model: 'euca_2', x: 30, z: 40, heading: 0, scale: 1 },
    ];
    await t.ed.load();
    const ed = t.ed;
    const trees = () => (ed.get().objects?.objects ?? []).filter((o) => /^TREE_\d+$/.test(o.name));
    // (among the objects as single ones of the trees' kind, sized alike every way)
    expect(trees().map((o) => [o.name, o.model, o.curve[0]?.p, o.heading, o.scale])).toEqual([
      ['TREE_0', 'euca_6', [10, 20], 1, [1.5, 1.5, 1.5]],
      ['TREE_1', 'euca_2', [30, 40], 0, undefined],
    ]);
    // (and the broad leaf tree the objects have)
    expect(countOf(ed.get().objects as TrackObjects, 'vp_a', 'trees')).toBe(3);
    const i = ed.get().objects?.objects.findIndex((o) => o.name === 'TREE_1') ?? -1;
    ed.selectObject({ kind: 'trees', i, j: -1 });
    ed.deleteObject();
    await ed.save();
    // (the objects saved without them; the trees as the track keeps them)
    const sent = t.engine.calls.find((c) => c.path === '/api/objects' && c.body) as { body: { objects: TrackObjects } };
    expect(sent.body.objects.objects.some((o) => o.model.startsWith('euca'))).toBe(false);
    expect(t.engine.trees).toEqual([
      { model: 'broad_1', x: 120, z: 30, heading: 0, scale: 1 },
      { model: 'euca_6', x: 10, z: 20, heading: 1, scale: 1.5 },
    ]);
    expect(ed.get().status).toBe('objects and 2 trees saved');
    expect(trees().map((o) => o.model)).toEqual(['broad_1', 'euca_6']);
  });

  it('does not save the trees when they could not be read', async () => {
    const t = await loadedEditor([road('A', [0, 0], [100, 0])]);
    t.engine.trees = [{ model: 'euca_6', x: 10, z: 20, heading: 1, scale: 1 }];
    t.engine.fail['/api/trees'] = 'old engine';
    await t.ed.load();
    expect(t.ed.get().status).toMatch(/could not load the trees \(they are not saved\): old engine/);
    t.ed.selectObject({ kind: 'cones', i: 2, j: -1 });
    t.ed.deleteObject();
    await t.ed.save();
    expect(t.engine.calls.filter((c) => c.path === '/api/trees' && c.body)).toHaveLength(0);
    expect(t.engine.trees).toHaveLength(1);
  });

  it('draws them, their numbers and the picked one’s handle', async () => {
    const { ed } = await setup();
    ed.selectObject({ kind: 'grid', i: 0, j: -1 });
    ed.set({ mode: 'place', place: 'tyres', obj: { kind: 'tyres', i: 0, j: 0 }, placing: { kind: 'tyres', i: 0 } });
    const calls = new Map<string, number>();
    const g = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) =>
        k in t
          ? t[k]
          : k === 'measureText'
            ? () => ({ width: 10 })
            : () => {
                calls.set(k, (calls.get(k) ?? 0) + 1);
              },
      set: (t, k: string, v) => {
        t[k] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const msg = drawFrame({ g, size: ed.get().size, dpr: 1, state: ed.get(), tiles: null, cache: new RenderCache() });
    expect(msg).toBe('Place: click to add a tyre wall (on TYRES_0); Esc to stop');
    expect(calls.get('arc')).toBeGreaterThan(5);
    expect(calls.get('fillText')).toBeGreaterThan(3);
    ed.selectObject({ kind: 'grid', i: 0, j: -1 });
    drawFrame({
      g,
      size: ed.get().size,
      dpr: 1,
      state: { ...ed.get(), mode: 'select' },
      tiles: null,
      cache: new RenderCache(),
    });
    ed.setLayer('objects', false);
    const before = calls.get('arc') ?? 0;
    drawFrame({ g, size: ed.get().size, dpr: 1, state: ed.get(), tiles: null, cache: new RenderCache() });
    expect(calls.get('arc')).toBe(before);
  });

  it('draws a mark by dragging from its start to its end, carries it on by clicks; snaps its end onto another, Shift by 15 degrees', async () => {
    const { ed, mouse } = await setup();
    const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
    const nodes = (i: number) => ed.get().objects?.marks[i]?.curve.map((n) => n.p.map(r6));
    ed.setPlace('marks');
    mouse.down(at(ed, 10, 1));
    mouse.move(at(ed, 13, 1));
    mouse.up();
    expect(ed.get().objects?.marks[1]).toMatchObject({ name: 'MARK_2' });
    expect(nodes(1)).toEqual([
      [10, 1],
      [13, 1],
    ]);
    expect(ed.get().undo).toHaveLength(1);
    // (a click while it is picked: carried on to there)
    mouse.down(at(ed, 13, 4));
    mouse.up();
    expect(nodes(1)).toEqual([
      [10, 1],
      [13, 1],
      [13, 4],
    ]);
    expect(ed.get().undo).toHaveLength(2);
    // (a drag: a new one)
    mouse.down(at(ed, 20, 1));
    mouse.move(at(ed, 22, 1));
    mouse.up();
    expect(nodes(2)).toEqual([
      [20, 1],
      [22, 1],
    ]);
    ed.setMode('select');
    // (its end turned by 15 degrees with Shift)
    mouse.down(at(ed, 22, 1));
    expect(ed.get().obj).toEqual({ kind: 'marks', i: 2, j: 1 });
    mouse.move(at(ed, 22, 3.9, { shift: true }));
    mouse.up();
    const [a, b] = ed.get().objects?.marks[2]?.curve.map((n) => n.p) ?? [];
    expect(Math.atan2((b?.[0] ?? 0) - (a?.[0] ?? 0), (b?.[1] ?? 0) - (a?.[1] ?? 0))).toBeCloseTo(Math.PI / 6, 6);
    // (dragged near another mark's end: onto it, so the two are painted as one line)
    mouse.down(at(ed, b?.[0] ?? 0, b?.[1] ?? 0));
    mouse.move(at(ed, 13.3, 4.2));
    mouse.up();
    expect(nodes(2)?.[1]).toEqual([13, 4]);
    expect(ed.get().status).toMatch(/snapped to MARK_2's end/);
    // (its line, picked by nothing: the whole of it moved)
    ed.set({ obj: null });
    mouse.down(at(ed, 16.5, 2.5));
    expect(ed.get().obj).toEqual({ kind: 'marks', i: 2, j: -1 });
    mouse.move(at(ed, 16.5, 3.5));
    mouse.up();
    expect(nodes(2)).toEqual([
      [20, 2],
      [13, 5],
    ]);
    ed.deleteSelected();
    expect(ed.get().objects?.marks).toHaveLength(2);
    ed.set({ mode: 'place', place: 'marks' });
    const msg = drawFrame({
      g: new Proxy({} as Record<string, unknown>, {
        get: (t, k: string) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
        set: (t, k: string, v) => {
          t[k] = v;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D,
      size: ed.get().size,
      dpr: 1,
      state: { ...ed.get(), obj: { kind: 'marks', i: 0, j: 0 } },
      tiles: null,
      cache: new RenderCache(),
    });
    expect(msg).toBe('Place: drag from its start to its end (Shift: its way by 15°) to add a paint mark; Esc to stop');
  });

  it('O places and stops placing', async () => {
    const { ed } = await setup();
    handleKey(ed, { key: 'o', ctrlKey: false, metaKey: false, shiftKey: false });
    expect(ed.get().mode).toBe('place');
    handleKey(ed, { key: 'o', ctrlKey: false, metaKey: false, shiftKey: false });
    expect(ed.get().mode).toBe('select');
  });
});

describe('the objects panel', () => {
  it('shows the layout, each kind and places it; copies a set from another layout', async () => {
    const { ed } = await setup();
    render(
      <EditorProvider editor={ed}>
        <ObjectsPanel />
        <ObjectForm />
      </EditorProvider>,
    );
    expect(screen.getAllByText('same in 1').length).toBeGreaterThan(3);
    await userEvent.click(screen.getAllByRole('button', { name: 'Place' })[0]);
    expect(ed.get().mode).toBe('place');
    expect(ed.get().place).toBe('grid');
    await userEvent.click(screen.getByRole('button', { name: 'Placing' }));
    expect(ed.get().mode).toBe('select');
    await userEvent.selectOptions(screen.getByLabelText('Layout'), 'vp_b');
    expect(ed.get().layout).toBe('vp_b');
    await userEvent.click(screen.getByRole('button', { name: 'Kind to copy: Grid' }));
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Kind to copy' })).getByRole('button', { name: /Pits/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(ed.get().status).toBe("Pits of vp_b made as vp_a's; not saved yet");
  });

  it('sets the layout’s start line: chequered, a solid line, none; saved with the layout', async () => {
    const { ed, engine } = await setup();
    // (with the paint: every layout's, each its own)
    render(
      <EditorProvider editor={ed}>
        <ObjectsPanel kinds={['marks']} />
      </EditorProvider>,
    );
    const field = screen.getByLabelText('Start line of vp_a');
    expect(field).toHaveValue('none');
    await userEvent.selectOptions(field, 'checker');
    expect(ed.get().objects?.layouts.vp_a.start_line).toBe('checker');
    expect(ed.get().objects?.layouts.vp_b.start_line).toBeUndefined();
    await userEvent.selectOptions(field, 'line');
    expect(ed.get().objects?.layouts.vp_a.start_line).toBe('line');
    await ed.save();
    const sent = engine.calls.findLast((c) => c.path === '/api/objects' && c.body) as {
      body: { objects: TrackObjects };
    };
    expect(sent.body.objects.layouts.vp_a.start_line).toBe('line');
    await userEvent.selectOptions(field, 'none');
    expect('start_line' in (ed.get().objects?.layouts.vp_a ?? {})).toBe(false);
    ed.undo();
    expect(ed.get().objects?.layouts.vp_a.start_line).toBe('line');
  });

  it('edits the object picked: where, heading, name, layouts; a gate’s posts; a wall’s points and stacks', async () => {
    const { ed } = await setup();
    render(
      <EditorProvider editor={ed}>
        <ObjectForm />
      </EditorProvider>,
    );
    act(() => ed.selectObject({ kind: 'boards', i: 3, j: -1 }));
    expect(screen.getByRole('heading')).toHaveTextContent('Board 1 of 1');
    const heading = screen.getByLabelText('Heading (degrees)');
    await userEvent.clear(heading);
    await userEvent.type(heading, '90{Enter}');
    expect(ed.get().objects?.objects[3]?.heading).toBeCloseTo(Math.PI / 2, 6);
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'BOARD_50{Enter}');
    expect(ed.get().objects?.objects[3]?.name).toBe('BOARD_50');
    const x = screen.getByLabelText('x, z x');
    await userEvent.clear(x);
    await userEvent.type(x, '71{Enter}');
    expect(ed.get().objects?.objects[3]?.curve[0]?.p[0]).toBe(71);
    // (its layouts: every one, then vp_a alone, then every one again)
    await userEvent.click(screen.getByLabelText('every layout'));
    expect(ed.get().objects?.objects[3]?.layouts).toEqual(['vp_a']);
    expect(screen.getByLabelText('vp_a')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('vp_b'));
    expect(ed.get().objects?.objects[3]?.layouts).toBeUndefined();
    await userEvent.selectOptions(screen.getByLabelText('Collision'), 'static');
    expect(ed.get().objects?.objects[3]?.collision).toBe('static');
    // (its scale: across, then back as the model is)
    const sx = screen.getByLabelText('Scale across');
    await userEvent.clear(sx);
    await userEvent.type(sx, '1.5{Enter}');
    expect(ed.get().objects?.objects[3]?.scale).toEqual([1.5, 1, 1]);
    await userEvent.clear(sx);
    await userEvent.type(sx, '1{Enter}');
    expect(ed.get().objects?.objects[3]?.scale).toBeUndefined();
    act(() => ed.selectObject({ kind: 'timing', i: 0, j: -1 }));
    expect(screen.getByText('8.00 m')).toBeInTheDocument();
    const lz = screen.getByLabelText('Left z');
    await userEvent.clear(lz);
    await userEvent.type(lz, '5{Enter}');
    expect(ed.get().objects?.layouts.vp_a.timing[0].left.z).toBe(5);
    act(() => ed.selectObject({ kind: 'cones', i: 2, j: -1 }));
    const cz = screen.getByLabelText('x, z z');
    await userEvent.clear(cz);
    await userEvent.type(cz, '6{Enter}');
    expect(ed.get().objects?.objects[2]?.curve[0]?.p[1]).toBe(6);
    // (a pole: what the track's catalogue says of it, its lights)
    act(() => ed.selectObject({ kind: 'poles', i: 1, j: -1 }));
    expect(screen.getByText('A light pole, 17 m high.')).toBeInTheDocument();
    expect(screen.getByText('Pole flood beams: 53° down, along its heading')).toBeInTheDocument();
    expect(screen.getByText('Pole spill: straight down')).toBeInTheDocument();
    // (its lights its own: one off, another stronger; only what differs from their series kept on it)
    const pole = () => ed.get().objects?.objects[1];
    expect(screen.getByLabelText('Light 1 strength')).toHaveValue(1.69);
    expect(screen.getByLabelText('Light 2 range (m)')).toHaveValue(70);
    await userEvent.click(screen.getByLabelText(/Pole spill: straight down/));
    expect(pole()?.lights).toEqual({ '1': { on: false } });
    expect(screen.queryByLabelText('Light 2 strength')).toBeNull();
    const strength = screen.getByLabelText('Light 1 strength');
    await userEvent.clear(strength);
    await userEvent.type(strength, '2.5{Enter}');
    expect(pole()?.lights).toEqual({ '0': { strength: 2.5 }, '1': { on: false } });
    fireEvent.change(screen.getByLabelText('Light 1 colour'), { target: { value: '#ff0000' } });
    fireEvent.blur(screen.getByLabelText('Light 1 colour'));
    expect(pole()?.lights?.['0']).toEqual({ strength: 2.5, colour: [1, 0, 0] });
    await userEvent.click(screen.getByRole('button', { name: 'As its series' }));
    await userEvent.click(screen.getByLabelText(/Pole spill: straight down/));
    expect(pole()?.lights).toBeUndefined();
    act(() => ed.selectObject({ kind: 'tyres', i: 0, j: 1 }));
    expect(screen.getByText('2 nodes, 3 along it')).toBeInTheDocument();
    const rows = screen.getByLabelText('Rows');
    await userEvent.clear(rows);
    await userEvent.type(rows, '2{Enter}');
    expect(screen.getByText('2 nodes, 6 along it')).toBeInTheDocument();
    const px = screen.getByLabelText('Node 2 x');
    await userEvent.clear(px);
    await userEvent.type(px, '2.1{Enter}');
    expect(ed.get().objects?.objects[0].curve[1].p[0]).toBe(2.1);
    await userEvent.click(screen.getByLabelText('corner'));
    expect(ed.get().objects?.objects[0].curve[1].corner).toBe(true);
    await userEvent.click(screen.getByLabelText('corner'));
    expect(ed.get().objects?.objects[0].curve[1].corner).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Smooth node' }));
    const spacing = screen.getByLabelText('Spacing (m)');
    await userEvent.clear(spacing);
    await userEvent.type(spacing, '0.5{Enter}');
    expect(ed.get().objects?.objects[0].spacing).toBe(0.5);
    await userEvent.click(screen.getByLabelText(/closed/));
    await userEvent.selectOptions(screen.getByLabelText('Collision'), 'none');
    expect(ed.get().objects?.objects[0]).toMatchObject({ closed: true, collision: 'none' });
    act(() => ed.selectObject({ kind: 'marks', i: 0, j: -1 }));
    expect(screen.getByRole('heading')).toHaveTextContent('Paint mark 1 of 1');
    expect(screen.getByText(/2 nodes, 4 m long/)).toBeInTheDocument();
    const mw = screen.getByLabelText('Width (m)');
    await userEvent.clear(mw);
    await userEvent.type(mw, '0.2{Enter}');
    expect(ed.get().objects?.marks[0].width).toBe(0.2);
    act(() => ed.selectObject({ kind: 'marks', i: 0, j: 1 }));
    const nz = screen.getByLabelText('Node 2 z');
    await userEvent.clear(nz);
    await userEvent.type(nz, '1{Enter}');
    // (its piece still straight: its handles along it)
    const [n0, n1] = ed.get().objects?.marks[0].curve ?? [];
    expect(n1?.p).toEqual([54, 1]);
    expect(n0?.out.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([4 / 3, 1].map((v) => Math.round(v * 1e6) / 1e6));
    await userEvent.selectOptions(screen.getByLabelText('Colour'), 'yellow');
    await userEvent.selectOptions(screen.getByLabelText('Style'), 'dotted');
    const gap = screen.getByLabelText('Gap (m)');
    await userEvent.clear(gap);
    await userEvent.type(gap, '0.25{Enter}');
    expect(ed.get().objects?.marks[0]).toMatchObject({ colour: 'yellow', style: 'dotted', gap: 0.25 });
    await userEvent.selectOptions(screen.getByLabelText('Style'), 'solid');
    expect(ed.get().objects?.marks[0].gap).toBeUndefined();
    act(() => ed.selectObject({ kind: 'tyres', i: 0, j: 0 }));
    await userEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(ed.get().objects?.objects[0].curve).toHaveLength(1);
  });
});
