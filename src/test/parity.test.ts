import { beforeAll, describe, expect, it } from 'vitest';
import type { View } from '../canvas/viewport';
import { toScreen } from '../canvas/viewport';
import { BACK_RAMP_COLOUR } from '../domain/constants';
import type { Road, Selection } from '../domain/types';
import { autoHandles, splitAt } from '../editing/curves';
import { endHandles, nodeHandles } from '../editing/handles';
import { hitTest } from '../editing/hit';
import { follow } from '../editing/joints';
import { snapPoint } from '../editing/snap';
import { continuation, kerbPieces } from '../geometry/paint';
import { alongHandles, geo, lookup } from '../geometry/roads';
import { nearestOn } from '../geometry/samples';
import { roadShapes } from '../geometry/shapes';
import { prepareRoads } from '../store/editor';
import { haveLegacy, type Legacy, legacyRoads, loadLegacy, MAP_H, MAP_W, type RecordingPath } from './legacy';

const close = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-9) => {
  expect(a).toHaveLength(b.length);
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tol) expect([i, a[i]]).toEqual([i, b[i]]);
};
const closePts = (a: [number, number][], b: [number, number][], tol = 1e-9) => close(a.flat(), b.flat(), tol);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe.skipIf(!haveLegacy)('the same as the editor it was made from, on the Velopark roads', () => {
  let L: Legacy;
  let roads: Road[];

  beforeAll(() => {
    L = loadLegacy();
    const raw = legacyRoads();
    L.S.roads = clone(raw).map((r: Record<string, unknown>) => ({ ...r, _v: 1 }));
    roads = prepareRoads(clone(raw) as Road[]);
  });

  it('samples every road the same', () => {
    const find = lookup(roads);
    expect(roads.length).toBeGreaterThan(5);
    roads.forEach((r, i) => {
      const a = geo(r, find);
      const b = L.geo(L.S.roads[i]);
      if (!b) {
        expect(a).toBeNull();
        return;
      }
      if (!a) throw new Error(`no samples for ${r.name}`);
      for (const k of ['X', 'Z', 'L', 'R', 's', 'nx', 'nz'] as const) close(a[k], b[k]);
      expect(a.length).toBeCloseTo(b.length, 9);
      expect(a.nodeAt).toEqual(b.nodeAt);
      for (const k of ['xmin', 'xmax', 'zmin', 'zmax'] as const) expect(a.box[k]).toBeCloseTo(b.box[k], 9);
    });
  });

  it('draws every road, its lines and rumbles the same', () => {
    const find = lookup(roads);
    let kerbs = 0;
    roads.forEach((r, i) => {
      const a = roadShapes(r, find);
      const b = L.shapes(L.S.roads[i]);
      if (!b || !a) {
        expect(!!a).toBe(!!b);
        return;
      }
      closePts(a.outline, (b.outline as RecordingPath).parts[0]);
      closePts(a.sides.flat(), (b.sides as RecordingPath).parts.flat());
      closePts(a.white.flat(), (b.white as RecordingPath).parts.flat());
      closePts(a.yellow.flat(), (b.yellow as RecordingPath).parts.flat());
      // (the back ramps behind the rumbles are this editor's: the old one had none)
      const own = [...a.kerbs].filter(([col]) => col !== BACK_RAMP_COLOUR);
      expect(own.map(([col]) => col).sort()).toEqual(Object.keys(b.kerbs).sort());
      for (const [col, list] of own) {
        closePts(list.flat(), (b.kerbs[col] as RecordingPath).parts.flat());
        kerbs += list.length;
      }
    });
    expect(kerbs).toBeGreaterThan(10);
  });

  it('places the rumbles going on along other roads the same', () => {
    const find = lookup(roads);
    let n = 0;
    roads.forEach((r, i) => {
      (r.kerbs ?? []).forEach((k, j) => {
        const a = kerbPieces(r, k, find);
        const b = L.kerbPieces(L.S.roads[i], L.S.roads[i].kerbs[j]);
        expect(a.map((p) => [p.road.name, p.s0, p.s1, p.side, p.t0, p.t1, p.role])).toEqual(
          b.map((p: Legacy) => [p.r.name, p.s0, p.s1, p.side, p.t0, p.t1, p.role]),
        );
        if (k.before || k.after) n++;
      });
    });
    expect(n).toBeGreaterThan(0);
  });

  it('finds where a rumble goes on along another road the same', () => {
    const find = lookup(roads);
    let found = 0;
    roads.forEach((r, i) => {
      (r.kerbs ?? []).forEach((k, j) => {
        for (const [c, isStart] of [
          [k.before, true],
          [k.after, false],
        ] as const) {
          const other = c && find(c.road);
          const o2 = other && geo(other, find);
          if (!c || !o2) continue;
          const plain = { ...k, before: undefined, after: undefined };
          for (const f of [0.2, 0.5, 0.8]) {
            const s = c.from + (c.to - c.from) * f;
            const at = o2.s.findIndex((v) => v >= s);
            const [wx, wz] = [o2.X[at], o2.Z[at]];
            const a = continuation(r, plain, isStart, wx, wz, roads, find);
            const b = L.continuation(
              L.S.roads[i],
              { ...L.S.roads[i].kerbs[j], before: undefined, after: undefined },
              isStart,
              wx,
              wz,
            );
            expect(a).toEqual(b);
            if (a) found++;
          }
        }
      });
    });
    expect(found).toBeGreaterThan(0);
  });

  it('gives every handle the same', () => {
    const find = lookup(roads);
    roads.forEach((r, i) => {
      const sel: Selection = { r: i, n: -1, line: (r.lines?.length ?? 0) > 0 ? 0 : -1, kerb: -1 };
      L.S.sel = { ...sel };
      const strip = (hs: Legacy[]) => hs.map((h) => [h.kind, h.n ?? null, h.x, h.z]);
      expect(strip(nodeHandles(r, find))).toEqual(strip(L.nodeHandles(L.S.roads[i])));
      expect(strip(alongHandles(r, find))).toEqual(strip(L.alongHandles(L.S.roads[i])));
      expect(strip(endHandles(r, sel, find))).toEqual(strip(L.endHandles(L.S.roads[i])));
      if (r.kerbs?.length) {
        const ks = { ...sel, line: -1, kerb: r.kerbs.length - 1 };
        L.S.sel = { ...ks };
        expect(strip(endHandles(r, ks, find))).toEqual(strip(L.endHandles(L.S.roads[i])));
      }
    });
  });

  it('snaps and hits the same', () => {
    const find = lookup(roads);
    const view: View = { cx: 0, cz: 0, ppm: 6 };
    const size = { w: MAP_W, h: MAP_H };
    let hits = 0;
    roads.forEach((r, i) => {
      const o = geo(r, find);
      if (!o) return;
      for (const f of [0.1, 0.5, 0.9]) {
        const k = Math.floor(o.X.length * f);
        const [x, z] = [o.X[k] + o.nx[k] * 0.7, o.Z[k] + o.nz[k] * 0.7];
        Object.assign(view, { cx: x + 3, cz: z - 2 });
        L.S.view = { ...view };
        L.S.sel = { r: i, n: -1, line: -1, kerb: -1 };
        const a = snapPoint(roads, find, x, z, null, 10 / view.ppm);
        const b = L.snapPoint(x, z, null);
        expect(a && [a.x, a.z, a.label]).toEqual(b && [b.x, b.z, b.label]);
        const [sx, sy] = toScreen(view, size, x, z);
        const ctx = {
          roads,
          find,
          sel: { r: i, n: -1, line: -1, kerb: -1 },
          layers: { lines: true, kerbs: true },
          ppm: view.ppm,
          toScreen: (px: number, pz: number) => toScreen(view, size, px, pz),
        };
        const h = hitTest(ctx, sx, sy, x, z);
        const hb = L.hit(sx, sy);
        const strip = (v: Legacy | null) =>
          v && { kind: v.kind, road: v.road, idx: v.idx, which: v.which, n: v.n, s: v.s };
        expect(strip(h)).toEqual(strip(hb));
        hits += h ? 1 : 0;
      }
    });
    expect(hits).toBeGreaterThan(10);
  });

  it('edits curves the same: a node split in, smooth handles, a joined end following', () => {
    const r = clone(roads.find((x) => (x.curve?.length ?? 0) > 3)) as Road;
    const old = clone(r);
    const n = splitAt(r, 1, 0.37);
    expect(L.splitAt(old, 1, 0.37)).toBe(n);
    expect(r.curve).toEqual(old.curve);
    autoHandles(r);
    L.autoHandles(old);
    expect(r.curve).toEqual(old.curve);
    const other = clone(roads.find((x) => x.curve && x.name !== r.name)) as Road;
    const otherOld = clone(other);
    follow(r, 0, other, 0);
    L.follow(old, 0, otherOld, 0);
    expect(other).toEqual(otherOld);
    expect([r.start_left, r.end_left]).toEqual([old.start_left, old.end_left]);
  });

  it('finds the nearest sample the same', () => {
    const find = lookup(roads);
    const o = geo(roads[0], find);
    if (!o) throw new Error('no samples');
    const p = [o.X[10] + 1.3, o.Z[10] - 0.4] as const;
    const a = nearestOn(o, p[0], p[1]);
    const b = L.nearestOn(L.geo(L.S.roads[0]), p[0], p[1]);
    expect([a.i, a.s]).toEqual([b.i, b.s]);
    expect(a.d).toBeCloseTo(b.d, 12);
  });
});
