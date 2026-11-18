import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { BuildJob } from '../api/types';
import { createEditor } from '../store/editor';
import { fakeDialogs, fakeEngine } from '../test/fixtures';
import { BuildProgress, builtLine, logKind } from './BuildDialog';

describe('the build for Assetto Corsa', () => {
  it('is asked for in its dialog (saved first, if asked), followed to its archive', async () => {
    const fe = fakeEngine();
    const dialogs = fakeDialogs({ confirm: true });
    const ed = createEditor(fe.client, { dialogs, meshDelay: 0, pollMs: 5 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<App editor={ed} />);
    await waitFor(() => expect(ed.get().roads).toHaveLength(3));
    ed.set({ dirty: true, roads: [...ed.get().roads] });
    await userEvent.click(screen.getByRole('button', { name: 'Build for the games' }));
    const box = await screen.findByRole('dialog', { name: 'Build for the Games' });
    expect(box).toHaveTextContent('test_track_ac.7z');
    expect(box).toHaveTextContent("The editor's engine makes the track's models again from what is saved");
    // (the games: Assetto Corsa ticked, BeamNG.drive offered; installing only with Assetto Corsa)
    const ac = screen.getByRole('checkbox', { name: 'Assetto Corsa' });
    const beamng = screen.getByRole('checkbox', { name: 'BeamNG.drive (one map, each layout its activities)' });
    expect(ac).toBeChecked();
    expect(beamng).not.toBeChecked();
    expect(box).toHaveTextContent('test_track_beamng.zip');
    await userEvent.click(ac);
    expect(screen.getByLabelText(/Install in the game too/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Build' })).toBeDisabled();
    await userEvent.click(ac);
    await userEvent.click(beamng);
    expect(box).toHaveTextContent('building saves them first');
    // (AC's archive made whatever is asked, unless it is installed; BeamNG's level put in its mods where asked)
    const pack = screen.getByLabelText(/Make its archive too/);
    expect([pack]).toEqual([expect.objectContaining({ checked: true, disabled: true })]);
    await userEvent.click(screen.getByLabelText(/Install in the game too/));
    expect(pack).toBeEnabled();
    await userEvent.click(pack);
    const mods = screen.getByLabelText(/Install in BeamNG's mods too/);
    expect(mods).toHaveAccessibleName(/BeamNG\.drive\/current\/mods/);
    await userEvent.click(mods);
    await userEvent.click(screen.getByRole('button', { name: 'Build' }));
    // (saved, then built: install asked)
    const paths = fe.calls.map((c) => c.path);
    expect(paths.indexOf('/api/save')).toBeLessThan(paths.lastIndexOf('/api/build'));
    expect(fe.calls.filter((c) => c.path === '/api/build').at(-1)?.body).toEqual({
      games: ['ac', 'beamng'],
      install: true,
      installBeamng: true,
      installRf2: false,
      packAc: false,
      all: false,
    });
    // (done: green)
    expect(await screen.findByText(/Built in 1 min 35 s: .*test_track_ac\.7z \(12\.3 MB\)/)).toHaveClass('build-done');
    expect(ed.get().status).toBe('built: D:/tracks/test/build/dist/test_track_ac.7z');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Build for the Games' })).toBeNull();
  });
});

describe("a build's end", () => {
  it('says the archives made and where each game has it, and nothing packed where nothing was', () => {
    const done = {
      id: 'b',
      state: 'done',
      step: 'pack',
      steps: [],
      now: '',
      log: [],
      error: '',
      archive: '',
      size: 0,
      install: true,
      seconds: 65,
    } as BuildJob;
    expect(
      builtLine({
        ...done,
        archives: [{ game: 'beamng', path: 'D:/t/x_beamng.zip', size: 2.5e6 }],
        installed: [
          { game: 'ac', path: 'D:/ac/tracks/x' },
          { game: 'beamng', path: 'C:/mods/x_beamng.zip' },
        ],
      }),
    ).toBe(
      'Built in 65 s: D:/t/x_beamng.zip (2.5 MB); installed in Assetto Corsa: D:/ac/tracks/x; installed in BeamNG: C:/mods/x_beamng.zip',
    );
    expect(builtLine({ ...done, install: false, archives: [] })).toBe('Built in 65 s: nothing packed');
  });
});

describe("a build's log", () => {
  it('marks its errors, its warnings and its end; the rest as it is', () => {
    expect(logKind('failed: Assetto Corsa is running: close it before installing.')).toBe('error');
    expect(logKind('Error: ENOENT: no such file or directory')).toBe('error');
    expect(logKind('a warning: 3 trees off the floor')).toBe('warn');
    expect(logKind('built for Assetto Corsa: D:/x/track_ac.7z (12.3 MB)')).toBe('done');
    expect(logKind('installed in BeamNG.drive: C:/mods/track_beamng.zip')).toBe('done');
    expect(logKind('the floor: 163 regions, 1892728 faces')).toBeNull();
  });
});

describe("a build's progress", () => {
  const job = (over: Partial<BuildJob>): BuildJob => ({
    id: 'b',
    state: 'running',
    step: 'models',
    steps: ['models', 'pack'],
    now: 'drape_track',
    log: [],
    error: '',
    archive: '',
    size: 0,
    install: false,
    seconds: 754,
    fraction: 0.452,
    left: 545,
    percent: null,
    stages: [
      { name: 'terrain', kind: 'step', label: 'terrain', state: 'cached', expected: 40, seconds: 0 },
      { name: 'drape_track', kind: 'step', label: 'drape track', state: 'running', expected: 300, seconds: 151 },
      { name: 'check_holes', kind: 'step', label: 'check holes', state: 'skipped', expected: 20, seconds: 0 },
      { name: 'pack', kind: 'pack', label: 'packed', state: 'waiting', expected: 120, seconds: 0 },
    ],
    activity: { stage: 'drape track', line: 'draping 1ROAD_12', quiet: 3, alive: true },
    ...over,
  });

  it('says how far it is, what it does now and how long ago it last said so, every stage as it went', () => {
    const { rerender } = render(<BuildProgress job={job({})} />);
    expect(screen.getByRole('progressbar', { name: 'How far the build is' })).toHaveAttribute('value', '45');
    expect(screen.getByText(/so far/)).toHaveTextContent(
      '45% · drape track · 12 min 34 s so far · about 9 min 5 s left',
    );
    expect(screen.getByText('Last said 3 s ago:')).toBeInTheDocument();
    // (running: blue)
    expect(screen.getByText('Last said 3 s ago:')).toHaveClass('build-running');
    expect(screen.getByText('draping 1ROAD_12')).toBeInTheDocument();
    const stages = screen.getByRole('list', { name: 'Its stages' });
    expect(stages).toHaveTextContent('terrainas before');
    expect(stages).toHaveTextContent('drape trackrunning2 min 31 s of about 5 min 0 s');
    expect(stages).toHaveTextContent('check holesleft out');
    expect(stages).toHaveTextContent('packedto doabout 2 min 0 s');
    // (quiet a long while, its process alive: busy; gone: said)
    rerender(<BuildProgress job={job({ activity: { stage: 'drape track', line: '', quiet: 130, alive: true } })} />);
    // (quiet a long while: a warning, yellow; its process gone: an error, red)
    expect(screen.getByText(/Nothing said for 2 min 10 s: its process is alive/)).toHaveClass('build-warn');
    rerender(<BuildProgress job={job({ activity: { stage: 'drape track', line: '', quiet: 5, alive: false } })} />);
    expect(screen.getByText(/Its process is not running any more/)).toHaveClass('build-error');
    // (packing: 7-Zip's own percentage)
    rerender(
      <BuildProgress
        job={job({ step: 'pack', percent: 62, activity: { stage: 'packed', line: '', quiet: 0, alive: true } })}
      />,
    );
    expect(screen.getByText(/so far/)).toHaveTextContent('packed 62%');
  });
});
