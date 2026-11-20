import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { EditorProvider } from '../store/EditorContext';
import { loadedEditor, road } from '../test/fixtures';
import { BringDialog } from './BringDialog';
import { formatNumber, NumberField } from './fields';
import { HelpDialog } from './HelpDialog';
import { NodeForm } from './NodeForm';
import { KerbsForm, kerbSwatch, LinesForm } from './PaintForms';
import { RoadForm } from './RoadForm';
import { RoadList, roadTag } from './RoadList';
import { alongText, StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

async function withEditor(ui: React.ReactNode, roads = [road('A', [0, 0], [100, 0]), road('B', [100, 0], [200, 0])]) {
  const t = await loadedEditor(roads);
  render(<EditorProvider editor={t.ed}>{ui}</EditorProvider>);
  return t;
}

describe('a number field', () => {
  it('gives the number once typing is done, and only if it changed', async () => {
    const onCommit = vi.fn();
    render(<NumberField label="Width" value={2} onCommit={onCommit} />);
    const box = screen.getByLabelText('Width');
    expect(box).toHaveValue(2);
    await userEvent.clear(box);
    await userEvent.type(box, '3.5{Enter}');
    expect(onCommit).toHaveBeenCalledWith(3.5);
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onCommit).toHaveBeenCalledTimes(1);
    await userEvent.clear(box);
    fireEvent.blur(box);
    expect(onCommit).toHaveBeenLastCalledWith(null);
    expect(formatNumber(1.23456)).toBe('1.235');
    expect(formatNumber(null)).toBe('');
  });
});

describe('the road list', () => {
  it('lists, filters and selects the roads', async () => {
    const { ed } = await withEditor(<RoadList />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.type(screen.getByLabelText('Filter roads'), 'b');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /Road 2/ }));
    expect(ed.get().sel.r).toBe(1);
    expect(ed.get().view.cx).toBeCloseTo(150, 6);
    expect(roadTag({ name: 'x', along: { road: 'A', side: 'left', from: 0, to: 1 } })).toBe('run-off');
    expect(roadTag({ name: 'x', joins: [null, 'A'] })).toBe('branch');
    expect(roadTag({ name: 'x', fitted: true })).toBe('fitted');
  });
});

describe('the toolbar', () => {
  it('picks tools and layers, undoes, saves, helps', async () => {
    const { ed, engine } = await withEditor(<Toolbar />);
    await userEvent.click(screen.getByRole('button', { name: /Measure/ }));
    expect(ed.get().mode).toBe('measure');
    expect(screen.getByRole('button', { name: /Measure/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.click(screen.getByLabelText('Drawings'));
    expect(ed.get().layers.draw).toBe(true);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    act(() => {
      ed.selectRoad(0);
      ed.change((r) => {
        r.material = 'Pavers';
      });
    });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('dirty');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(ed.get().roads[0].material).toBe('Tarmac Dark');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(engine.calls.some((c) => c.path === '/api/save')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(ed.get().helpOpen).toBe(true);
  });
});

describe('the road form', () => {
  it('renames, sets material, joins and order', async () => {
    const { ed } = await withEditor(<RoadForm />);
    expect(screen.queryByLabelText('Road')).toBeNull();
    act(() => ed.selectRoad(1));
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'B2{Enter}');
    expect(ed.get().roads[1].name).toBe('B2');
    await userEvent.selectOptions(screen.getByLabelText('Material'), 'Pavers');
    expect(ed.get().roads[1].material).toBe('Pavers');
    await userEvent.selectOptions(screen.getByLabelText('Leaves'), 'A');
    expect(ed.get().roads[1].joins).toEqual(['A', null]);
    expect(screen.getByText(/A branch/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Leaves'), '');
    expect(ed.get().roads[1].joins).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: '↑ up' }));
    expect(ed.get().roads[0].name).toBe('B2');
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  });

  it('shows a run-off as along its road', async () => {
    const { ed } = await withEditor(<RoadForm />, [
      road('A', [0, 0], [100, 0]),
      {
        name: 'R',
        along: { road: 'A', side: 'left', from: 10, to: 50 },
        width: 2,
        profile: [
          [20, 1],
          [30, 3],
        ],
      },
    ]);
    act(() => ed.selectRoad(1));
    expect(screen.getByText(/varies \(2 points\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'One width' }));
    expect(ed.get().roads[1]).toMatchObject({ width: 3, moved: true });
    expect(ed.get().roads[1].profile).toBeUndefined();
    await userEvent.selectOptions(screen.getByLabelText('Along side'), 'right');
    expect(ed.get().roads[1].along?.side).toBe('right');
  });
});

describe('the node form', () => {
  it('sets a node where it is, its widths and handles, and joins its end', async () => {
    const { ed } = await withEditor(<NodeForm />);
    act(() => ed.set({ sel: { r: 1, n: 0, line: -1, kerb: -1 } }));
    expect(screen.getByText('Node 1 of 2')).toBeInTheDocument();
    const left = screen.getByLabelText('Left width');
    await userEvent.clear(left);
    await userEvent.type(left, '5{Enter}');
    expect(ed.get().roads[1].curve?.[0].left).toBe(5);
    const out = screen.getByLabelText('Handle out');
    await userEvent.clear(out);
    await userEvent.type(out, '10{Enter}');
    expect(ed.get().roads[1].curve?.[0].out[0]).toBeCloseTo(10, 9);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(ed.get().roads[1].curve?.[0].corner).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: "Join to the nearest road's end" }));
    expect(screen.getByText("to Road 1's end")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unjoin' }));
    expect(ed.get().roads[1].curve?.[0].joint).toBeUndefined();
  });
});

describe('lines and rumbles', () => {
  it('are added, edited, selected and removed', async () => {
    const { ed } = await withEditor(
      <>
        <LinesForm />
        <KerbsForm />
      </>,
    );
    act(() => ed.selectRoad(0));
    await userEvent.click(screen.getByRole('button', { name: 'Add Left Line' }));
    await userEvent.selectOptions(screen.getByLabelText('Line style'), 'dotted');
    expect(ed.get().roads[0].lines?.[0].style).toBe('dotted');
    expect(screen.getByLabelText('Dashes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add Right Rumble' }));
    await userEvent.selectOptions(screen.getByLabelText('Rumble kind'), 'ramp_concrete');
    expect(screen.getByLabelText('Concrete')).toHaveValue(0.75);
    const lines = screen.getByRole('region', { name: 'Lines' });
    await userEvent.click(within(lines).getAllByRole('row')[1].querySelector('td') as HTMLElement);
    expect(ed.get().sel).toMatchObject({ line: 0, kerb: -1 });
    await userEvent.click(screen.getByRole('button', { name: 'Delete line 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete rumble 1' }));
    expect(ed.get().roads[0]).toMatchObject({ lines: [], kerbs: [] });
    expect(kerbSwatch('ramp')).toBe('#d23a3a');
    expect(kerbSwatch('ramp_concrete')).toMatch(/gradient/);
  });
});

describe('the dialogs and the status bar', () => {
  it('bring in a mesh from a filtered list', async () => {
    const { ed } = await withEditor(<BringDialog />);
    await act(() => ed.openBring());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Filter meshes'), 'zzz');
    expect(screen.getByText('none left')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Filter meshes'));
    await userEvent.click(screen.getByRole('button', { name: /1ROAD_X/ }));
    expect(ed.get().roads.at(-1)?.name).toBe('1ROAD_X');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('show the keys, and where the mouse is', async () => {
    const { ed } = await withEditor(
      <>
        <HelpDialog />
        <StatusBar />
      </>,
    );
    act(() => ed.toggleHelp(true));
    expect(screen.getByRole('dialog', { name: 'Keys and Mouse' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      ed.selectRoad(0);
      ed.set({ mouse: [25, 1] });
    });
    expect(screen.getByText('x 25.00, z 1.00')).toBeInTheDocument();
    expect(alongText(ed.get())).toBe('Road 1: s 25.00 m of 100.0, 1.00 m off its middle');
  });
});

describe('the app', () => {
  it('loads the track and shows its roads', async () => {
    const { ed } = await loadedEditor();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<App editor={ed} />);
    const sidebar = await screen.findByRole('navigation', { name: 'Categories' });
    await userEvent.click(within(sidebar).getByRole('button', { name: /Roads/ }));
    expect(ed.get().focus).toBe('roads');
    expect((await screen.findAllByText('Road 1')).length).toBeGreaterThan(0);
    expect(document.title).toBe('Test — Top Race editor');
    fireEvent.keyDown(window, { key: 'm' });
    expect(ed.get().mode).toBe('measure');
    fireEvent.keyDown(screen.getByLabelText('Filter roads'), { key: 'v' });
    expect(ed.get().mode).toBe('measure');
  });
});
