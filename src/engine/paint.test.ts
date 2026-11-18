// @vitest-environment node
// The marks and the start lines painted on a made-up road: a layout's start line along its start and finish gate
// (else across the road its grid is on, just ahead of its first slot), chequered or a single solid line.
import { describe, expect, it } from 'vitest';
import { cleanObjects, ObjectsError } from './objectsfile';
import {
  CHECKER,
  CHECKER_IN,
  CHECKER_ROWS,
  LINE_LIFT,
  MARK_STEP,
  markPaint,
  START_AHEAD,
  START_GATE,
  START_LINE_W,
  startLineAt,
  startLinePaint,
} from './paint';

describe('the marks and the start lines painted', () => {
  // (a straight road along +x, 4 m each side of its middle, the floor level at 1 m)
  const road = {
    name: 'S',
    curve: [
      {
        p: [0, 0] as [number, number],
        in: [0, 0] as [number, number],
        out: [10, 0] as [number, number],
        left: 4,
        right: 4,
      },
      {
        p: [40, 0] as [number, number],
        in: [-10, 0] as [number, number],
        out: [0, 0] as [number, number],
        left: 4,
        right: 4,
      },
    ],
  };
  const onRoad = (_x: number, z: number) => Math.abs(z) < 4;
  const floor = () => 1;

  it('paints a mark only where there is road under it, LINE_LIFT over the floor; dotted, in its dashes', () => {
    // (across the road from z -6 to 6: its 4 m off the road's edge each side not painted)
    const [m] = markPaint([{ name: 'M', p: [20, -6], heading: 0, length: 12, width: 0.1 }], onRoad, floor);
    expect(m?.name).toBe('M');
    const zs = new Set<number>();
    for (let f = 0; f < (m?.F.length ?? 0); f++) zs.add(m?.P[(m.F[f] as number) * 3 + 2] as number);
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(-4);
    expect(Math.max(...zs)).toBeLessThanOrEqual(4);
    expect([...(m?.P ?? [])].filter((_, i) => i % 3 === 1).every((y) => Math.abs(y - (1 + LINE_LIFT)) < 1e-12)).toBe(
      true,
    );
    // (all its faces up)
    const P = m?.P as Float64Array;
    const F = m?.F as Int32Array;
    for (let f = 0; f < F.length; f += 3) {
      const [a, b, c] = [F[f] as number, F[f + 1] as number, F[f + 2] as number];
      const up =
        ((P[b * 3 + 2] as number) - (P[a * 3 + 2] as number)) * ((P[c * 3] as number) - (P[a * 3] as number)) -
        ((P[b * 3] as number) - (P[a * 3] as number)) * ((P[c * 3 + 2] as number) - (P[a * 3 + 2] as number));
      expect(up).toBeGreaterThan(0);
    }
    // (dotted: 1 m dashes, 1 m gaps, along the road from x 5: five dashes over 9 m)
    const [d] = markPaint(
      [{ p: [5, 0], heading: Math.PI / 2, length: 9, style: 'dotted', dash: 1, gap: 1 }],
      onRoad,
      floor,
    );
    expect(d?.name).toBe('MARK_1');
    expect((d?.F.length ?? 0) / 6).toBe(5 * 4);
  });

  // (a grid facing +x along it, its first slot at x 18; another road beside it, apart)
  const grid = [
    { x: 18, z: 1, heading: Math.PI / 2 },
    { x: 15, z: -1, heading: Math.PI / 2 },
  ];
  const beside = {
    ...road,
    name: 'T',
    curve: road.curve.map((n) => ({ ...n, p: [n.p[0], 30] as [number, number] })),
  };
  const roads = { S: road, T: beside };
  const extent = (P: Float64Array) => {
    const xs = [...P].filter((_, i) => i % 3 === 0);
    const zs = [...P].filter((_, i) => i % 3 === 2);
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  };

  it('paints a layout’s chequered start line across the road just ahead of its grid, square to it', () => {
    const [s, ...more] = startLinePaint({ vp_a: { grid, start_line: 'checker' } }, roads, floor);
    expect(more).toHaveLength(0);
    expect(s?.name).toBe('START_VP_A');
    const e = extent(s?.P as Float64Array);
    // (its front START_AHEAD in front of the first slot, its rows back towards the grid)
    expect(e.x1).toBeCloseTo(18 + START_AHEAD, 9);
    expect(e.x0).toBeCloseTo(18 + START_AHEAD - CHECKER * CHECKER_ROWS, 9);
    // (across from 0.3 in from each edge, whole squares, the road's middle in the middle)
    const n = Math.floor((8 - 2 * CHECKER_IN) / CHECKER);
    expect(e.z1 - e.z0).toBeCloseTo(n * CHECKER, 9);
    expect(e.z1 + e.z0).toBeCloseTo(0, 9);
    // (white and the road by turns: half the squares, two triangles each; on the floor)
    expect((s?.F.length ?? 0) / 6).toBe(Math.ceil((n * CHECKER_ROWS) / 2));
    expect(s?.P[1]).toBeCloseTo(1 + LINE_LIFT, 9);
  });

  it('paints a single solid white line instead, as wide as START_LINE_W; none where a layout has none', () => {
    const [s] = startLinePaint({ vp_a: { grid, start_line: 'line' }, vp_b: { grid } }, roads, floor);
    expect(s?.name).toBe('START_VP_A');
    const e = extent(s?.P as Float64Array);
    expect(e.x1).toBeCloseTo(18 + START_AHEAD, 9);
    expect(e.x0).toBeCloseTo(18 + START_AHEAD - START_LINE_W, 9);
    expect(e.z1 - e.z0).toBeCloseTo(8 - 2 * CHECKER_IN, 9);
    // (one strip across, in pieces of MARK_STEP)
    expect((s?.F.length ?? 0) / 6).toBe(Math.ceil((8 - 2 * CHECKER_IN) / MARK_STEP));
    expect(startLinePaint({ vp_b: { grid } }, roads, floor)).toHaveLength(0);
  });

  it('finds the grid’s road by its outline, and the way it faces; none off every road', () => {
    // (the grid on the road beside, facing -x: the line on that road, ahead of it the other way)
    const there = grid.map((g) => ({ x: 40 - g.x, z: 30 + g.z, heading: -Math.PI / 2 }));
    const at = startLineAt(there[0] as (typeof there)[0], roads);
    expect(at?.road).toBe('T');
    expect(at?.a[0]).toBeCloseTo(22 - START_AHEAD, 9);
    expect(at?.back[0]).toBeCloseTo(1, 9);
    expect(Math.abs(at?.u[1] ?? 0)).toBeCloseTo(1, 9);
    const [s] = startLinePaint({ vp_a: { grid: there, start_line: 'line' } }, roads, floor);
    const e = extent(s?.P as Float64Array);
    expect(e.x0).toBeCloseTo(22 - START_AHEAD, 9);
    expect(e.z0).toBeGreaterThan(26);
    expect(startLineAt({ x: 18, z: 15, heading: 0 }, roads)).toBeNull();
  });

  it('is painted along the layout’s start and finish gate, between its posts, on the road only', () => {
    // (the gate across S at x 20, its posts 2 m off the road each side, a little askew; the grid facing +x)
    const timing = [
      { name: 'AC_TIME_1', left: { x: 30, z: -6 }, right: { x: 30, z: 6 } },
      { name: START_GATE, left: { x: 20, z: -6 }, right: { x: 21, z: 6 } },
    ];
    const [s] = startLinePaint({ vp_a: { grid, timing, start_line: 'checker' } }, roads, floor);
    const e = extent(s?.P as Float64Array);
    // (on the road between the posts: from CHECKER_IN in from its edges, square to the gate, not to the road)
    expect(e.z0).toBeGreaterThanOrEqual(-4 + CHECKER_IN - 1e-9);
    expect(e.z1).toBeLessThanOrEqual(4 - CHECKER_IN + 1e-9);
    expect(e.z1 - e.z0).toBeGreaterThan(8 - 2 * CHECKER_IN - CHECKER - 0.1);
    // (its rows behind the gate, the way the grid's karts come from: towards -x; its front on the gate)
    const front = (z: number) => 20 + (z + 6) / 12;
    const P = s?.P as Float64Array;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i] as number;
      const z = P[i + 2] as number;
      expect(x).toBeLessThanOrEqual(front(z) + 1e-9);
      expect(x).toBeGreaterThanOrEqual(front(z) - CHECKER * CHECKER_ROWS - 0.05);
    }
    // (a gate across no road: nothing; without the start gate: ahead of the grid as before)
    const off = [{ name: START_GATE, left: { x: 20, z: 10 }, right: { x: 21, z: 20 } }];
    expect(startLinePaint({ vp_a: { grid, timing: off, start_line: 'line' } }, roads, floor)).toHaveLength(0);
    const [g] = startLinePaint({ vp_a: { grid, timing: [timing[0]] as never, start_line: 'line' } }, roads, floor);
    expect(extent(g?.P as Float64Array).x1).toBeCloseTo(18 + START_AHEAD, 9);
  });

  it('crosses every road where they meet (a merge: the grid on the narrower), stopping where the road does', () => {
    // (a lane 2 m wide overlapping S's left edge, its middle at z 4.5: the road 4 + 5.5 m wide there, from -4 to 5.5)
    const lane = {
      ...road,
      name: 'U',
      curve: road.curve.map((n) => ({ ...n, p: [n.p[0], 4.5] as [number, number], left: 1, right: 1 })),
    };
    const merge = { S: road, T: beside, U: lane };
    const onLane = [{ x: 18, z: 4.8, heading: Math.PI / 2 }];
    expect(startLineAt(onLane[0] as (typeof onLane)[0], merge)?.road).toBe('U');
    const [s] = startLinePaint({ vp_a: { grid: onLane, start_line: 'line' } }, merge, floor);
    const e = extent(s?.P as Float64Array);
    // (from CHECKER_IN in from S's far edge to as far in from the lane's: not the lane's 2 m alone; not to T, apart)
    expect(e.z0).toBeCloseTo(-4 + CHECKER_IN, 9);
    expect(e.z1).toBeCloseTo(5.5 - CHECKER_IN, 9);
  });
});

describe('a layout’s start line', () => {
  it('is kept as the objects are written: chequered or a line, none left out; another refused', () => {
    const lay = (start_line?: unknown) => ({ grid: [], pits: [], hotlap: null, timing: [], start_line });
    const out = cleanObjects({
      version: 3,
      layouts: { a: lay('checker'), b: lay('line'), c: lay() },
      objects: [],
      marks: [],
    }) as { layouts: Record<string, { start_line?: string }> };
    expect(out.layouts.a?.start_line).toBe('checker');
    expect(out.layouts.b?.start_line).toBe('line');
    expect('start_line' in (out.layouts.c ?? {})).toBe(false);
    expect(() => cleanObjects({ version: 3, layouts: { a: lay('dots') }, objects: [], marks: [] })).toThrow(
      ObjectsError,
    );
  });
});
