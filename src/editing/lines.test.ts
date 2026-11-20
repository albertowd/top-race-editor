// A layout's racing lines edited (lines.ts, and through the objects' edits): the pit line's ends kept on the fast line
// where it leaves and joins it, their handles as given; the fork and the merge dragged along the fast line; the pit
// line following the fast line moved; nodes added and taken away, as many kept as a line needs.
import { describe, expect, it } from 'vitest';
import type { LayoutObjects, RacingLine, TrackObjects, WallNode } from '../domain/types';
import { addLineNode, FORK, forkAndMerge, keepPitOn, MERGE, pointAlong, removeLineNode } from './lines';
import { emptyLayout, moveObject, objectAt, removeObject } from './objects';
import { smoothWall, wallPath } from './walls';

/** A round lap of radius r about the origin, n nodes, its handles smooth. */
function lap(r = 50, n = 8): RacingLine {
  const curve: WallNode[] = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return { p: [r * Math.cos(a), r * Math.sin(a)], in: [0, 0], out: [0, 0] };
  });
  const line: RacingLine = { curve, closed: true };
  smoothWall(line);
  return line;
}

function layout(): LayoutObjects {
  const lay = emptyLayout();
  lay.lines = {
    fast: lap(),
    pit: {
      curve: [
        { p: [0, 0], in: [0, 0], out: [0, 0] },
        { p: [60, 20], in: [-3, -3], out: [3, 3] },
        { p: [0, 0], in: [0, 0], out: [0, 0] },
      ],
      closed: false,
      leaves: 10,
      joins: 70,
    },
  };
  keepPitOn(lay.lines);
  return lay;
}

const objectsOf = (lay: LayoutObjects): TrackObjects => ({ version: 3, layouts: { a: lay }, objects: [], marks: [] });

describe('the racing lines', () => {
  it('keeps the pit line’s ends on the fast line where it leaves and joins it, new handles along it', () => {
    const lay = layout();
    const pit = lay.lines?.pit as RacingLine;
    const fast = lay.lines?.fast as RacingLine;
    const at = pointAlong(fast, 10);
    const first = pit.curve[0] as WallNode;
    expect(first.p[0]).toBeCloseTo(at.p[0], 9);
    expect(first.p[1]).toBeCloseTo(at.p[1], 9);
    expect(first.in).toEqual([0, 0]);
    // (its handle along the fast line's way there)
    const m = Math.hypot(...first.out);
    expect(first.out[0] / m).toBeCloseTo(at.t[0], 6);
    expect(first.out[1] / m).toBeCloseTo(at.t[1], 6);
    const last = pit.curve.at(-1) as WallNode;
    const b = pointAlong(fast, 70);
    expect(last.p[0]).toBeCloseTo(b.p[0], 9);
    expect(last.out).toEqual([0, 0]);
    expect(-last.in[0] / Math.hypot(...last.in)).toBeCloseTo(b.t[0], 6);
    // (round again past the lap's end)
    const L = wallPath(fast, 0.25).length;
    expect(pointAlong(fast, L + 10).p[0]).toBeCloseTo(at.p[0], 6);
  });

  it('drags the fork and the merge along the fast line, and the pit line follows the fast line moved', () => {
    const lay = layout();
    const o = objectsOf(lay);
    const fm = forkAndMerge(lay.lines);
    if (!fm) throw new Error('no fork');
    // (the diamond picked before the line under it)
    expect(objectAt(o, 'a', fm.fork[0] + 0.3, fm.fork[1], 0.5, ['fast', 'pit'])).toEqual({
      kind: 'pit',
      i: 0,
      j: FORK,
    });
    // (dragged along it, further on)
    const ahead = pointAlong(lay.lines?.fast as RacingLine, 25).p;
    moveObject(o, 'a', { kind: 'pit', i: 0, j: FORK }, ahead[0] - fm.fork[0], ahead[1] - fm.fork[1], false);
    expect(lay.lines?.pit?.leaves).toBeCloseTo(25, 0);
    const first = lay.lines?.pit?.curve?.[0] as WallNode;
    expect(first.p[0]).toBeCloseTo(ahead[0], 1);
    // (the fast line moved whole: the pit line's ends with it, its own node not)
    const mid = [...(lay.lines?.pit?.curve?.[1]?.p ?? [])];
    moveObject(o, 'a', { kind: 'fast', i: 0, j: -1 }, 5, 0, false);
    const moved = lay.lines?.pit?.curve?.[0] as WallNode;
    expect(moved.p[0]).toBeCloseTo((ahead[0] as number) + 5, 1);
    expect(lay.lines?.pit?.curve?.[1]?.p).toEqual(mid);
    // (the merge too)
    const m = forkAndMerge(lay.lines)?.merge as [number, number];
    moveObject(o, 'a', { kind: 'pit', i: 0, j: MERGE }, 0.01, 0, false);
    expect(lay.lines?.pit?.joins).toBeCloseTo(70, 0);
    expect(forkAndMerge(lay.lines)?.merge[0]).toBeCloseTo(m[0], 1);
  });

  it('adds nodes and takes them away, as many kept as a line needs', () => {
    const lay = emptyLayout();
    // (no fast line yet: no pit line)
    expect(addLineNode(lay, 'pit', 0, 0, 0.5)).toBeNull();
    expect(addLineNode(lay, 'fast', 50, 0, 0.5)).toBe(0);
    addLineNode(lay, 'fast', 0, 50, 0.5);
    addLineNode(lay, 'fast', -50, 0, 0.5);
    expect(lay.lines?.fast?.curve).toHaveLength(3);
    expect(lay.lines?.fast?.closed).toBe(true);
    addLineNode(lay, 'fast', 0, -50, 0.5);
    expect(lay.lines?.fast?.curve).toHaveLength(4);
    // (a pit line made through the click, forking before it and merging after)
    expect(addLineNode(lay, 'pit', 0, 60, 0.5)).toBe(1);
    const pit = lay.lines?.pit as RacingLine;
    expect(pit.curve).toHaveLength(3);
    expect((pit.joins as number) - (pit.leaves as number)).toBeCloseTo(60, 0);
    // (a pit line's ends are not taken away; a node between, once it has more than one)
    expect(removeLineNode(lay, 'pit', 0)).toBe(false);
    expect(removeLineNode(lay, 'pit', 1)).toBe(false);
    addLineNode(lay, 'pit', 5, 62, 0.5);
    expect(removeLineNode(lay, 'pit', 1)).toBe(true);
    // (the fast line keeps three nodes; taken away whole, the pit line with it)
    expect(removeLineNode(lay, 'fast', 0)).toBe(true);
    expect(removeLineNode(lay, 'fast', 0)).toBe(false);
    const o = objectsOf(lay);
    expect(removeObject(o, 'a', { kind: 'fast', i: 0, j: -1 })).toBe(true);
    expect(lay.lines).toBeUndefined();
  });

  it('adds a pit line’s node where it is clicked on it, between its ends, its shape kept', () => {
    const lay = layout();
    const pit = lay.lines?.pit as RacingLine;
    const before = wallPath(pit, 0.25);
    // (a point on its curve, a third of the way along)
    const k = Math.round(before.P.length / 3);
    const [x, z] = before.P[k] as [number, number];
    const i = addLineNode(lay, 'pit', x, z, 0.5) as number;
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(pit.curve.length - 1);
    expect(pit.curve[i]?.p[0]).toBeCloseTo(x, 1);
    expect(pit.curve[i]?.p[1]).toBeCloseTo(z, 1);
    expect(wallPath(pit, 0.25).length).toBeCloseTo(before.length, 0);
    // (its ends still the fork and the merge)
    const fm = forkAndMerge(lay.lines);
    expect(pit.curve[0]?.p[0]).toBeCloseTo(fm?.fork[0] as number, 9);
    expect(pit.curve.at(-1)?.p[0]).toBeCloseTo(fm?.merge[0] as number, 9);
  });

  it('keeps the way and the pull a pit line’s ends are given, their places on the fast line', async () => {
    const { moveObjectHandle } = await import('./objects');
    const lay = layout();
    const o = objectsOf(lay);
    const pit = lay.lines?.pit as RacingLine;
    const first = pit.curve[0] as WallNode;
    // (its fork's handle turned out and made longer, by dragging its end)
    const aim: [number, number] = [first.p[0] + 6, first.p[1] + 8];
    moveObjectHandle(o, { kind: 'pit', i: 0, j: 0, h: 'out' }, aim[0], aim[1], false, 'a');
    expect(first.out[0]).toBeCloseTo(6, 6);
    expect(first.out[1]).toBeCloseTo(8, 6);
    // (the fork dragged along the fast line: there, its handle as given)
    const ahead = pointAlong(lay.lines?.fast as RacingLine, 20).p;
    const fm = forkAndMerge(lay.lines) as { fork: [number, number] };
    moveObject(o, 'a', { kind: 'pit', i: 0, j: FORK }, ahead[0] - fm.fork[0], ahead[1] - fm.fork[1], false);
    expect(first.p[0]).toBeCloseTo(ahead[0], 1);
    expect(first.out).toEqual([6, 8]);
    // (one with none: along the fast line)
    first.out = [0, 0];
    keepPitOn(lay.lines);
    expect(Math.hypot(...first.out)).toBeGreaterThan(0);
  });
});
