// The layouts' start lines on the map (canvas/startlines.ts): each painted line once, with the layouts that share it,
// worked out once for the objects and roads as they are; filled where in view.
import { describe, expect, it } from 'vitest';
import type { Road, TrackObjects } from '../domain/types';
import { drawStartLineLabels, drawStartLines, startLinesOf } from './startlines';

// (a straight road along +x, 4 m each side of its middle)
const road = {
  name: 'S',
  curve: [
    { p: [0, 0], in: [0, 0], out: [10, 0], left: 4, right: 4 },
    { p: [40, 0], in: [-10, 0], out: [0, 0], left: 4, right: 4 },
  ],
} as unknown as Road;
const grid = (x: number) => [{ x, z: 1, heading: Math.PI / 2 }];
const objects = {
  version: 3,
  marks: [],
  objects: [],
  layouts: {
    a: { grid: grid(18), pits: [], hotlap: null, timing: [], start_line: 'checker' },
    b: { grid: grid(18), pits: [], hotlap: null, timing: [], start_line: 'checker' },
    c: { grid: grid(30), pits: [], hotlap: null, timing: [], start_line: 'line' },
    d: { grid: grid(10), pits: [], hotlap: null, timing: [] },
  },
} as unknown as TrackObjects;

describe('the start lines on the map', () => {
  it('are every layout’s, one where layouts share it, none where a layout has none', () => {
    const roads = [road];
    const lines = startLinesOf(objects, roads);
    expect(lines.map((l) => l.layouts)).toEqual([['a', 'b'], ['c']]);
    // (across the road, ahead of the first slot)
    expect(lines[0]?.box.xmax).toBeCloseTo(19.5, 6);
    expect(lines[0]?.box.zmin).toBeGreaterThanOrEqual(-4);
    expect(lines[0]?.box.zmax).toBeLessThanOrEqual(4);
    // (worked out once for the same objects and roads; again where a road near a start changed, not one far off)
    expect(startLinesOf(objects, roads)).toBe(lines);
    const far = { ...road, name: 'F', curve: road.curve?.map((n) => ({ ...n, p: [n.p[0], 500] })) } as Road;
    expect(startLinesOf(objects, [road, far])).toBe(lines);
    const moved = { ...road, curve: road.curve?.map((n) => ({ ...n, left: 5 })) } as Road;
    expect(startLinesOf(objects, [moved])).not.toBe(lines);
  });

  it('are named by their layouts on the map, lines near one another a row apart', () => {
    const lines = startLinesOf(objects, [road]);
    const said: [string, number][] = [];
    const g = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) =>
        k in t
          ? t[k]
          : k === 'fillText'
            ? (s: string, _x: number, y: number) => said.push([s, y])
            : k === 'measureText'
              ? (s: string) => ({ width: s.length * 6 })
              : () => {},
      set: (t, k: string, v) => {
        t[k] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    // (the world at half a pixel a metre: the two lines 12 m apart, 6 px, in one cell of 40 px)
    drawStartLineLabels(g, lines, { xmin: 0, zmin: -10, xmax: 40, zmax: 10 }, (x, z) => [x / 2, z / 2]);
    expect(said.map(([s]) => s)).toEqual(['start: a, b', 'start: c']);
    expect(said[1]?.[1]).toBe((said[0]?.[1] ?? 0) + 15);
  });

  it('are filled where in view, each line in one path', () => {
    const lines = startLinesOf(objects, [road]);
    let fills = 0;
    const g = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : k === 'fill' ? () => fills++ : () => {}),
      set: (t, k: string, v) => {
        t[k] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    drawStartLines(g, lines, { xmin: 0, zmin: -10, xmax: 25, zmax: 10 });
    expect(fills).toBe(1);
    drawStartLines(g, lines, { xmin: 100, zmin: 100, xmax: 200, zmax: 200 });
    expect(fills).toBe(1);
  });
});
