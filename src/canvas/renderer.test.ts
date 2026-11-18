import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Road } from '../domain/types';
import { type EditorState, initialState } from '../store/state';
import { road, straightCurve } from '../test/fixtures';
import { RecordingPath } from '../test/legacy';
import { drawFrame, RenderCache } from './renderer';
import type { TileCache } from './tiles';

/** A 2D context that counts what it is asked to do. */
function recordingContext() {
  const calls = new Map<string, number>();
  const g = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) =>
      k in t
        ? t[k]
        : (..._args: unknown[]) => {
            calls.set(k, (calls.get(k) ?? 0) + 1);
          },
    set: (t, k: string, v) => {
      t[k] = v;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, calls };
}

const image = { complete: true, naturalWidth: 512, naturalHeight: 512 } as HTMLImageElement;
const tiles = { get: vi.fn(() => image) } as unknown as TileCache;

function scene(): EditorState {
  const roads: Road[] = [
    {
      ...road('A', [0, 0], [100, 0]),
      lines: [
        { side: 'left', colour: 'yellow' },
        { side: 'right', style: 'dotted', from: 0, to: 10 },
      ],
      kerbs: [{ side: 'right', kind: 'ramp_concrete', from: 10, to: 30, start: 'triangle' }],
      joins: ['B', null],
    },
    {
      ...road('B', [100, 0], [200, 0]),
      curve: straightCurve([100, 0], [200, 0]).map((n, i) =>
        i ? n : { ...n, joint: { road: 'A', node: 'end' as const } },
      ),
    },
    {
      name: 'R',
      along: { road: 'A', side: 'left', from: 10, to: 50 },
      width: 2,
      profile: [
        [20, 1],
        [30, 2],
      ],
    },
  ];
  const s = initialState();
  return {
    ...s,
    track: { name: 'T', span: 1000, px: 4096, tile: 512, materials: [] },
    roads,
    context: [
      { name: 'X', kind: 'road', material: 'm', lines: [[0, 5, 10, 5, 20, 6]] },
      { name: 'T', kind: 'tyre', material: 'm', rings: [5, 5, 1] },
    ],
    drawings: {
      a: {
        blue: [
          [
            [0, 0],
            [5, 5],
          ],
        ],
        yellow: [
          [
            [1, 1],
            [2, 2],
          ],
        ],
      },
    },
    view: { cx: 50, cz: 0, ppm: 8 },
    size: { w: 800, h: 600 },
    layers: { ...s.layers, draw: true },
    sel: { r: 0, n: 1, line: 0, kerb: -1 },
    surface: {
      window: [0, -10, 50, 10] as [number, number, number, number],
      regions: [{ name: 'A', kind: 'road', P: [0, 0, 1, 0, 0, 1], F: [0, 1, 2] }],
      issues: [['gap', 1, 1, 0.1] as [string, number, number, number]],
      stale: true,
    },
    snapMark: { x: 10, z: 0, label: "A's centre line" },
    measure: { a: [0, 0] as [number, number], b: [3, 4] as [number, number] },
    mouse: [5, 5] as [number, number],
  };
}

describe('the renderer', () => {
  const Path2DWas = globalThis.Path2D;
  beforeAll(() => {
    globalThis.Path2D = RecordingPath as unknown as typeof Path2D;
  });
  afterAll(() => {
    globalThis.Path2D = Path2DWas;
  });

  it('draws every layer, and says what the view wants', () => {
    const { g, calls } = recordingContext();
    const s = scene();
    const msg = drawFrame({ g, size: s.size, dpr: 1, state: s, tiles, cache: new RenderCache() });
    expect(msg).toBe('The surface shown is out of date: C to check again');
    expect(calls.get('drawImage')).toBeGreaterThan(0);
    expect(calls.get('fill')).toBeGreaterThan(10);
    expect(calls.get('fillText')).toBeGreaterThan(3);
    expect(calls.get('strokeRect')).toBe(1);
  });

  it('draws a run-off selected, the wireframe once it comes, and the modes', () => {
    const { g, calls } = recordingContext();
    const s = scene();
    const cache = new RenderCache();
    const runoff = { ...s, sel: { r: 2, n: 0, line: -1, kerb: -1 }, surface: null, mode: 'add' as const };
    expect(drawFrame({ g, size: s.size, dpr: 2, state: runoff, tiles: null, cache })).toBe(
      'Add node: click on R, or past one of its ends',
    );
    const wired = {
      ...s,
      sel: { r: 1, n: -1, line: -1, kerb: -1 },
      surface: null,
      mode: 'measure' as const,
      view: { cx: 50, cz: 0, ppm: 2 },
    };
    wired.meshes = {};
    expect(drawFrame({ g, size: s.size, dpr: 1, state: wired, tiles, cache })).toBe(
      'Measure: drag from one point to another (they snap; Ctrl: not), Esc to stop',
    );
    const drawing = {
      ...s,
      surface: null,
      newRoad: { name: 'N', points: [[0, 0] as [number, number]] },
      mode: 'new' as const,
    };
    expect(drawFrame({ g, size: s.size, dpr: 1, state: drawing, tiles, cache })).toBe(
      'New road: click its points, Enter to finish, Esc to drop it',
    );
    const none = { ...s, sel: { r: -1, n: -1, line: -1, kerb: -1 }, surface: null, mode: 'add' as const };
    expect(drawFrame({ g, size: s.size, dpr: 1, state: none, tiles, cache })).toBe('Add node: select a road first');
    expect(calls.get('fillRect')).toBeGreaterThan(3);
  });
});
