import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { MapInteractions, type Pointer } from '../canvas/interactions';
import { toScreen } from '../canvas/viewport';
import { CATEGORIES, categoryKey, categoryOf, countIn, othersAlpha, roadKind } from '../domain/categories';
import { kindIcon, modelInfo, modelsOf } from '../domain/models';
import type { TrackObjects } from '../domain/types';
import { firstModel, objectsOf } from '../editing/objects';
import { handleKey } from '../hooks/useShortcuts';
import { loadedEditor, someObjects, threeRoads } from '../test/fixtures';

type Ed = Awaited<ReturnType<typeof loadedEditor>>['ed'];

const at = (ed: Ed, x: number, z: number): Pointer => {
  const [sx, sy] = toScreen(ed.get().view, ed.get().size, x, z);
  return { sx, sy, button: 0, shift: false, alt: false, ctrl: false };
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

describe('the categories', () => {
  it('know their kinds, count their things, fade the rest', () => {
    expect(categoryOf('grid')).toBe('race');
    expect(categoryOf('marks')).toBe('paint');
    expect(categoryOf('cones')).toBe('props');
    const o = someObjects();
    const roads = threeRoads();
    roads[0].kerbs = [{ side: 'left', kind: 'ramp' }];
    expect(countIn('roads', roads, o, 'vp_a')).toBe(3);
    expect(countIn('rumbles', roads, o, 'vp_a')).toBe(1);
    expect(countIn('paint', roads, o, 'vp_a')).toBe(1);
    expect(countIn('race', roads, o, 'vp_a')).toBe(5);
    expect(countIn('props', roads, o, 'vp_a')).toBe(2);
    expect(countIn('poles', roads, null, 'vp_a')).toBe(0);
    expect([othersAlpha('show'), othersAlpha('hide')]).toEqual([1, 0]);
    expect(othersAlpha('dim')).toBeGreaterThan(0);
    expect(roadKind({ name: '1ROAD_1' })).toBe('Road');
    expect(roadKind({ name: 'x', along: { road: 'A', side: 'left', from: 0, to: 1 } })).toBe('Run-off');
  });
});

describe('working on one category', () => {
  it('puts down the tools it has not, lets go of what it cannot pick, places its own kinds', async () => {
    const { ed } = await setup();
    ed.selectRoad(0);
    ed.set({ sel: { r: 0, n: 1, line: -1, kerb: -1 } });
    ed.setMode('add');
    ed.setFocus('rumbles');
    expect(ed.get()).toMatchObject({ focus: 'rumbles', mode: 'select', sel: { r: 0, n: -1 } });
    ed.setFocus('race');
    expect(ed.get().sel.r).toBe(-1);
    expect(ed.get().place).toBe('grid');
    ed.setFocus('poles');
    expect(ed.get().place).toBe('poles');
    // (a tool or a kind of another category: that category worked on)
    ed.setMode('new');
    expect(ed.get()).toMatchObject({ focus: 'roads', mode: 'new' });
    ed.setPlace('cones');
    expect(ed.get()).toMatchObject({ focus: 'props', mode: 'place', place: 'cones' });
    ed.selectObject({ kind: 'marks', i: 0, j: -1 });
    expect(ed.get().focus).toBe('paint');
    ed.setFocus('all');
    ed.selectObject({ kind: 'poles', i: 0, j: -1 });
    expect(ed.get().focus).toBe('all');
  });

  it('picks only its own things on the map', async () => {
    const { ed, mouse } = await setup();
    // (the grid slot at 10, 0 lies on road A)
    ed.setFocus('roads');
    click(ed, mouse, 10, 0);
    expect(ed.get().obj).toBeNull();
    expect(ed.get().sel.r).toBe(0);
    ed.setFocus('race');
    click(ed, mouse, 10, 0);
    expect(ed.get().obj).toMatchObject({ kind: 'grid', i: 0 });
    click(ed, mouse, 80, 0);
    expect(ed.get().sel.r).toBe(-1);
    ed.setFocus('props');
    click(ed, mouse, 10, 0);
    expect(ed.get().obj).toBeNull();
    click(ed, mouse, 40, 5);
    expect(ed.get().obj).toMatchObject({ kind: 'cones', i: 2 });
    // (a road picked for its rumbles: its nodes are not taken)
    ed.setFocus('rumbles');
    click(ed, mouse, 70, 1);
    expect(ed.get().sel.r).toBe(0);
    mouse.down(at(ed, 0, 0));
    expect(ed.get().sel.n).toBe(-1);
    mouse.up();
  });

  it('is chosen by its number on the keyboard', async () => {
    const { ed } = await setup();
    handleKey(ed, { key: '5', ctrlKey: false, metaKey: false, shiftKey: false });
    expect(ed.get().focus).toBe('race');
    handleKey(ed, { key: '1', ctrlKey: false, metaKey: false, shiftKey: false });
    expect(ed.get().focus).toBe('all');
    handleKey(ed, { key: '\\', ctrlKey: false, metaKey: false, shiftKey: false });
    expect(ed.get().sidebar).toBe(false);
  });
});

describe('the sidebar and the inspector', () => {
  it('show each category with its own flow, things by their kind and number', async () => {
    const { ed } = await setup();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<App editor={ed} />);
    const sidebar = screen.getByRole('navigation', { name: 'Categories' });
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    // (the overview: the categories with their counts)
    expect(within(inspector).getByRole('button', { name: /Grid, timing & lines/ })).toHaveTextContent('5');
    await userEvent.click(within(sidebar).getByRole('button', { name: /Grid, timing & lines/ }));
    expect(within(sidebar).getByRole('button', { name: /Grid, timing & lines/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(inspector).getByRole('heading', { name: 'Grid, timing & lines' })).toBeInTheDocument();
    expect(within(inspector).queryByLabelText('Filter roads')).toBeNull();
    // (its tools: no New Road, but Place)
    const tools = screen.getByRole('toolbar', { name: 'Tools' });
    expect(within(tools).queryByRole('button', { name: 'New Road' })).toBeNull();
    expect(within(tools).getByRole('button', { name: 'Place' })).toBeInTheDocument();
    // (its things listed by kind and number; one picked, its form shown, its name only for the export)
    await userEvent.click(within(inspector).getByRole('button', { name: 'Grid slot 2' }));
    expect(ed.get().obj).toMatchObject({ kind: 'grid', i: 1 });
    expect(within(inspector).getByRole('heading', { name: 'Grid slot 2 of 2 — vp_a' })).toBeInTheDocument();
    // (the others: dimmed by default, hidden if asked)
    await userEvent.click(within(inspector).getByRole('button', { name: 'Hide' }));
    expect(ed.get().others).toBe('hide');
    // (paint: the road's lines, or the marks)
    await userEvent.click(within(sidebar).getByRole('button', { name: /Paint/ }));
    expect(within(inspector).getByText(/Pick a road/)).toBeInTheDocument();
    await userEvent.click(within(inspector).getByRole('button', { name: 'Paint Marks' }));
    await userEvent.click(within(inspector).getByRole('button', { name: 'Paint mark 1' }));
    expect(within(inspector).getByText('Export name')).toBeInTheDocument();
    // (roads: listed by what they are, the name kept in its tooltip)
    await userEvent.click(within(sidebar).getByRole('button', { name: /Roads/ }));
    const list = within(inspector).getByRole('list', { name: 'Roads' });
    expect(within(list).getAllByRole('button')[0]).toHaveAttribute('title', 'Exported as A');
    act(() => ed.toggleSidebar(false));
    expect(screen.queryByRole('navigation', { name: 'Categories' })).toBeNull();
  });
});

describe('the start lines', () => {
  it('are set with the paint, every layout’s, each its own', async () => {
    const { ed } = await setup();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<App editor={ed} />);
    const sidebar = screen.getByRole('navigation', { name: 'Categories' });
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    await userEvent.click(within(sidebar).getByRole('button', { name: /Paint/ }));
    await userEvent.click(within(inspector).getByRole('button', { name: 'Paint Marks' }));
    const table = within(inspector).getByRole('table', { name: 'Start lines' });
    // (a row a layout: the one not shown set too, the one shown left as it was)
    expect(ed.get().layout).toBe('vp_a');
    await userEvent.selectOptions(within(table).getByLabelText('Start line of vp_b'), 'line');
    expect(ed.get().objects?.layouts.vp_b?.start_line).toBe('line');
    expect(ed.get().objects?.layouts.vp_a?.start_line).toBeUndefined();
    await userEvent.selectOptions(within(table).getByLabelText('Start line of vp_a'), 'checker');
    expect(ed.get().objects?.layouts.vp_a?.start_line).toBe('checker');
    await userEvent.selectOptions(within(table).getByLabelText('Start line of vp_b'), 'none');
    expect(ed.get().objects?.layouts.vp_b?.start_line).toBeUndefined();
    // (where each is painted: along its start and finish gate)
    expect(within(table).getAllByText(/along its gate AC_TIME_0/)).toHaveLength(2);
    // (not in the grid's panel any more)
    await userEvent.click(within(sidebar).getByRole('button', { name: /Grid, timing & lines/ }));
    expect(within(inspector).queryByLabelText('Start line')).toBeNull();
  });
});

describe('the start gantries', () => {
  it('are the grid category’s: placed there, counted, picked over their beam, moved and turned', async () => {
    const { ed, mouse } = await setup();
    expect(categoryOf('gantries')).toBe('race');
    ed.setFocus('roads');
    ed.setPlace('gantries');
    expect(ed.get()).toMatchObject({ focus: 'race', mode: 'place', place: 'gantries' });
    click(ed, mouse, 40, 0);
    const gantries = () => objectsOf(ed.get().objects as TrackObjects, 'vp_a', 'gantries');
    expect(gantries()).toHaveLength(1);
    const i = gantries()[0] as number;
    expect(ed.get().objects?.objects[i]).toMatchObject({ model: 'gantry', curve: [{ p: [40, 0] }] });
    expect(countIn('race', [], ed.get().objects, 'vp_a')).toBe(6);
    // (its heading the road's: its beam across it; picked 8 m out along its beam, not 8 m in front of it)
    ed.selectObject({ kind: 'gantries', i, j: -1 });
    ed.changeObjects((o) => {
      const g = o.objects[i];
      if (g) g.heading = Math.PI / 2;
    });
    ed.setMode('select');
    ed.selectObject(null);
    click(ed, mouse, 40, 8);
    expect(ed.get().obj).toMatchObject({ kind: 'gantries', i });
    ed.selectObject(null);
    click(ed, mouse, 48, 0);
    expect(ed.get().obj?.kind).not.toBe('gantries');
    // (dragged: moved)
    mouse.down(at(ed, 40, 8));
    mouse.move(at(ed, 41, 8));
    mouse.up();
    expect(ed.get().objects?.objects[i]?.curve[0]?.p[0]).toBeCloseTo(41, 6);
  });
});

describe('the scenery', () => {
  it('is its own category: trees, fences; counted', () => {
    expect(CATEGORIES.scenery.kinds).toEqual(['trees', 'fences']);
    expect(categoryOf('gantries')).toBe('race');
    expect(categoryOf('trees')).toBe('scenery');
    expect(categoryOf('fences')).toBe('scenery');
    expect(countIn('scenery', threeRoads(), someObjects(), 'vp_a')).toBe(1);
    // (every kind has its models, the first placed unless another is chosen)
    for (const kind of ['trees', 'fences', 'sheds', 'statics', 'gantries', 'karts'] as const)
      expect(modelsOf(kind).length).toBeGreaterThan(0);
    expect(firstModel('gantries')).toBe('gantry');
    expect(firstModel('karts')).toBe('kart');
    expect(modelInfo('palm_n1')?.kind).toBe('trees');
  });

  it('is placed as the model chosen, picked, made another model, taken away', async () => {
    const { ed, mouse } = await setup();
    ed.setFocus('roads');
    ed.placeModel('trees', 'palm_n1');
    expect(ed.get()).toMatchObject({ focus: 'scenery', mode: 'place', place: 'trees' });
    click(ed, mouse, 20, 30);
    const trees = () =>
      objectsOf(ed.get().objects as TrackObjects, 'vp_a', 'trees').map((i) => ed.get().objects?.objects[i]);
    expect(trees()).toHaveLength(2);
    expect(trees()[1]).toMatchObject({ model: 'palm_n1', curve: [{ p: [20, 30] }] });
    expect(ed.get().obj).toMatchObject({ kind: 'trees', i: 6 });
    ed.setModel('bamboo_n0');
    expect(trees()[1]?.model).toBe('bamboo_n0');
    expect(ed.get().models.trees).toBe('bamboo_n0');
    ed.setMode('select');
    // (picked on the map within its reach; dragged)
    click(ed, mouse, 120.8, 30);
    expect(ed.get().obj).toMatchObject({ kind: 'trees', i: 4 });
    mouse.down(at(ed, 120, 30));
    mouse.move(at(ed, 125, 30));
    mouse.up();
    expect(trees()[0]).toMatchObject({ curve: [{ p: [125, 30] }] });
    ed.deleteObject();
    expect(trees().map((t) => t?.model)).toEqual(['bamboo_n0']);
    handleKey(ed, { key: '9', ctrlKey: false, metaKey: false, shiftKey: false });
    expect(ed.get().focus).toBe('scenery');
    // (a fence panel by a road faces it: it runs along it)
    ed.placeModel('fences', 'fence_steel');
    click(ed, mouse, 60, 3);
    const fence = ed.get().objects?.objects.find((t) => t.model === 'fence_steel');
    expect(fence?.model).toBe('fence_steel');
    expect(Math.abs(fence?.heading ?? 0)).toBeCloseTo(Math.PI);
  });

  it('shows each kind by its picture, chooses a model by its picture', async () => {
    const { ed } = await setup();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(<App editor={ed} />);
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Categories' })).getByRole('button', { name: /Scenery/ }),
    );
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    const kinds = within(inspector).getByRole('table', { name: 'Object kinds' });
    expect(kinds.querySelector('img[src$="models/kind-trees.webp"]')).not.toBeNull();
    // (the trees' model: a drop-down of pictures; one chosen, placing it)
    await userEvent.click(within(kinds).getByRole('button', { name: 'Tree to place: Eucalyptus 0' }));
    const choices = within(kinds).getByRole('group', { name: 'Tree to place' });
    expect(within(choices).getByRole('button', { name: /^Eucalyptus 0/, pressed: true })).toBeInTheDocument();
    await userEvent.click(within(choices).getByRole('button', { name: /^Palm n1/ }));
    expect(ed.get()).toMatchObject({ mode: 'place', place: 'trees', models: { trees: 'palm_n1' } });
    expect(within(kinds).queryByRole('group', { name: 'Tree to place' })).toBeNull();
    // (placed: listed by kind, number and model, with the model's picture)
    const placed = within(inspector).getByRole('list', { name: 'Placed' });
    await userEvent.click(within(placed).getByRole('button', { name: 'Tree 1 · broad leaf tree 1' }));
    expect(container.querySelector('img[src$="models/broad_1.png"]')).not.toBeNull();
    await userEvent.click(within(inspector).getByRole('button', { name: 'Model: Broad leaf tree 1' }));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(ed.get().objects?.objects[4]?.model).not.toBe('broad_1');
    expect(within(inspector).getByText(/m high \(models\//)).toBeInTheDocument();
  });
});

describe('the buildings and the static objects', () => {
  it('are categories of their own: the buildings the sheds, the static objects the rest and the karts; counted', () => {
    expect(CATEGORIES.buildings).toMatchObject({ label: 'Buildings', group: 'Objects', kinds: ['sheds'] });
    expect(CATEGORIES.statics).toMatchObject({
      label: 'Static objects',
      group: 'Objects',
      kinds: ['statics', 'karts'],
    });
    expect(CATEGORIES.statics.modes).toEqual(CATEGORIES.scenery.modes);
    expect(categoryOf('sheds')).toBe('buildings');
    expect(categoryOf('statics')).toBe('statics');
    expect(categoryOf('karts')).toBe('statics');
    // (the fixture's kart a static object; no building)
    expect(countIn('statics', threeRoads(), someObjects(), 'vp_a')).toBe(1);
    expect(countIn('buildings', threeRoads(), someObjects(), 'vp_a')).toBe(0);
    // (each kind's models: a building's a shed's, a marshal's shelter a static object's, the first placed)
    expect(modelsOf('sheds').map((m) => m.id)).toEqual(expect.arrayContaining(['open_passage', 'pit_building']));
    expect(modelsOf('sheds').map((m) => m.id)).not.toContain('marshal_post');
    expect(modelsOf('statics').map((m) => m.id)).toEqual(expect.arrayContaining(['marshal_post', 'chair', 'bins']));
    expect(firstModel('sheds')).toBe('open_passage');
    expect(firstModel('statics')).toBe('marshal_post');
    // (the static objects' kind shown by the chair's picture)
    expect(kindIcon('statics')).toMatch(/models\/chair\.png$/);
    expect(kindIcon('sheds')).toMatch(/models\/kind-sheds\.webp$/);
  });

  it('place each its own models, and pick only their own', async () => {
    const { ed, mouse } = await setup();
    const objects = () => ed.get().objects?.objects ?? [];
    // (a static object placed: the static objects worked on, counted there and not in the buildings)
    ed.setFocus('roads');
    ed.placeModel('statics', 'chair');
    expect(ed.get()).toMatchObject({ focus: 'statics', mode: 'place', place: 'statics' });
    click(ed, mouse, 60, 40);
    const chair = objects().findIndex((t) => t.model === 'chair');
    expect(objects()[chair]).toMatchObject({ curve: [{ p: [60, 40] }] });
    expect(ed.get().obj).toMatchObject({ kind: 'statics', i: chair });
    expect(countIn('statics', [], ed.get().objects, 'vp_a')).toBe(2);
    // (a building placed: the buildings worked on)
    ed.placeModel('sheds', 'pit_building');
    expect(ed.get()).toMatchObject({ focus: 'buildings', mode: 'place', place: 'sheds' });
    click(ed, mouse, 90, 40);
    const building = objects().findIndex((t) => t.model === 'pit_building');
    expect(ed.get().obj).toMatchObject({ kind: 'sheds', i: building });
    expect(countIn('buildings', [], ed.get().objects, 'vp_a')).toBe(1);
    expect(countIn('statics', [], ed.get().objects, 'vp_a')).toBe(2);
    // (in the buildings, the chair not picked; the building is)
    ed.setMode('select');
    ed.selectObject(null);
    click(ed, mouse, 60, 40);
    expect(ed.get().obj).toBeNull();
    click(ed, mouse, 90, 41);
    expect(ed.get().obj).toMatchObject({ kind: 'sheds', i: building });
    // (in the static objects, the chair and the kart picked)
    handleKey(ed, { key: '-', ctrlKey: false, metaKey: false, shiftKey: false });
    expect(ed.get().focus).toBe('statics');
    click(ed, mouse, 60.5, 40);
    expect(ed.get().obj).toMatchObject({ kind: 'statics', i: chair });
    click(ed, mouse, 130, -30);
    expect(ed.get().obj?.kind).toBe('karts');
    // (a building placed again: a new one, of the model last chosen)
    ed.setPlace('sheds');
    click(ed, mouse, 90, 80);
    expect(objects().filter((t) => t.model === 'pit_building')).toHaveLength(2);
  });

  it('follow the scenery on the keyboard, the terrain after them', async () => {
    const { ed } = await setup();
    const key = (k: string) => handleKey(ed, { key: k, ctrlKey: false, metaKey: false, shiftKey: false });
    expect((['scenery', 'buildings', 'statics', 'terrain'] as const).map(categoryKey)).toEqual(['9', '0', '-', '=']);
    key('0');
    expect(ed.get().focus).toBe('buildings');
    key('-');
    expect(ed.get().focus).toBe('statics');
    key('=');
    expect(ed.get().focus).toBe('terrain');
  });

  it('are listed in the sidebar’s objects, each with its kinds’ pictures', async () => {
    const { ed } = await setup();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<App editor={ed} />);
    const sidebar = screen.getByRole('navigation', { name: 'Categories' });
    const labels = within(sidebar)
      .getAllByRole('button')
      .map((b) => b.textContent?.replace(/\d+$/, ''));
    expect(labels.slice(-4)).toEqual(['Scenery', 'Buildings', 'Static objects', 'Terrain']);
    await userEvent.click(within(sidebar).getByRole('button', { name: /Static objects/ }));
    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    const kinds = within(inspector).getByRole('table', { name: 'Object kinds' });
    expect(kinds.querySelector('img[src$="models/chair.png"]')).not.toBeNull();
    expect(kinds.querySelector('img[src$="models/kind-karts.webp"]')).not.toBeNull();
    await userEvent.click(within(sidebar).getByRole('button', { name: /Buildings/ }));
    expect(
      within(screen.getByRole('complementary', { name: 'Inspector' }))
        .getByRole('table', { name: 'Object kinds' })
        .querySelector('img[src$="models/kind-sheds.webp"]'),
    ).not.toBeNull();
  });
});
