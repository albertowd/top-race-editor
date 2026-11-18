import { CATEGORIES } from '../domain/categories';
import { RUNOFF_WIDTH, SNAP_PX } from '../domain/constants';
import type { ObjectPick, Road, Vec2 } from '../domain/types';
import { keepEdge } from '../editing/ends';
import { type HitContext, hitTest, type ItemHit, itemAt } from '../editing/hit';
import { touch } from '../editing/joints';
import {
  headingOf,
  moveObject,
  moveObjectEnd,
  moveObjectHandle,
  objectAt,
  poseOf,
  turnObject,
} from '../editing/objects';
import { snapPoint } from '../editing/snap';
import { continuation } from '../geometry/paint';
import { geo, type Lookup, lookup } from '../geometry/roads';
import { nearestOn, pointAt, span } from '../geometry/samples';
import type { Editor } from '../store/editor';
import type { EditorState } from '../store/state';
import { turnHandle } from './objects';
import { panned, type Size, toScreen, toWorld, type View, zoomAt } from './viewport';

/** A mouse event as the map has it: where on the map (CSS pixels), which button, which keys. */
export interface Pointer {
  sx: number;
  sy: number;
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

interface ItemDrag {
  kind: 'item';
  which: 'line' | 'kerb';
  idx: number;
  road: number;
  s: number;
  from0: number;
  to0: number;
  toEnd: boolean;
  moved: boolean;
}

interface HandleDrag {
  kind: 'handle';
  handle: string;
  n: number;
  road: number;
  alt: boolean;
  moved: boolean;
}

/** An object dragged (whole: all of its kind, or its whole wall or gate), or turned (whole: its kind as one). */
interface ObjectDragOf<K extends 'object' | 'turn'> {
  kind: K;
  pick: ObjectPick;
  whole: boolean;
  /** (a tyre wall's handle: Alt made its node a corner) */
  alt: boolean;
  last: Vec2;
  moved: boolean;
  /** (a mark just placed, its far end dragged: kept as placed if it is not) */
  placed?: boolean;
}
type ObjectDrag = ObjectDragOf<'object'> | ObjectDragOf<'turn'>;

type Drag =
  | { kind: 'pan'; sx: number; sy: number; from: View; click: boolean }
  | { kind: 'measure' }
  | ItemDrag
  | HandleDrag
  | ObjectDragOf<'object'>
  | ObjectDragOf<'turn'>;

/** A handle being dragged to (wx, wz): what each kind of handle does with it. */
interface HandleMove {
  ed: Editor;
  s: EditorState;
  find: Lookup;
  road: Road;
  d: HandleDrag;
  wx: number;
  wz: number;
  p: Pointer;
  snap: (wx: number, wz: number, exclude: string | null) => ReturnType<typeof snapPoint>;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** A node moved, snapping to another road's end, centre line or edge (Ctrl: not). */
function moveNode({ ed, road, d, wx, wz, snap }: HandleMove) {
  const sp = snap(wx, wz, road.name);
  ed.set({ snapMark: sp });
  ed.edit((rs) => {
    const nd = rs[d.road].curve?.[d.n];
    if (!nd) return;
    nd.p = sp ? [sp.x, sp.z] : [wx, wz];
    touch(rs, rs[d.road]);
  });
}

/** A handle turned and stretched; the other follows (a smooth node), unless Alt makes it a corner. An end's edge
 * turns with its handle. */
function moveArm({ ed, d, wx, wz, p }: HandleMove) {
  const arm = d.handle === 'in' ? 'in' : 'out';
  const other = arm === 'in' ? 'out' : 'in';
  ed.edit((rs) => {
    const road = rs[d.road];
    const nd = road.curve?.[d.n];
    if (!nd) return;
    // (an end's handle turns its edge with it)
    keepEdge(road, d.n, () => {
      const v: Vec2 = [wx - nd.p[0], wz - nd.p[1]];
      nd[arm] = v;
      if (d.alt || p.alt) nd.corner = true;
      const ol = Math.hypot(nd[other][0], nd[other][1]);
      const m = Math.hypot(v[0], v[1]) || 1;
      if (!nd.corner && ol > 0) nd[other] = [(-v[0] / m) * ol, (-v[1] / m) * ol];
    });
    touch(rs, road);
  });
}

/** A side's width at a node (Shift: both sides). */
function moveWidth({ ed, find, road, d, wx, wz, p }: HandleMove) {
  const o = geo(road, find);
  const nd = road.curve?.[d.n];
  if (!o || !nd) return;
  const q = pointAt(o, o.s[o.nodeAt[d.n]]);
  const left = d.handle === 'wl';
  const w = r2(Math.max(0.2, ((wx - nd.p[0]) * q.nx + (wz - nd.p[1]) * q.nz) * (left ? 1 : -1)));
  ed.edit((rs) => {
    const n = rs[d.road].curve?.[d.n];
    if (!n) return;
    if (p.shift) {
      n.left = w;
      n.right = w;
    } else n[left ? 'left' : 'right'] = w;
    touch(rs, rs[d.road]);
  });
}

/** A run-off's ends along its road's edge, its width points out from it (and along it). */
function moveRunOff({ ed, find, road, d, wx, wz }: HandleMove) {
  const al = road.along;
  const parent = al && find(al.road);
  const op = parent && geo(parent, find);
  if (!al || !op) return;
  const n = nearestOn(op, wx, wz);
  const at = r1(n.s);
  const sgn = al.side === 'left' ? 1 : -1;
  const q = pointAt(op, n.s);
  const edge = sgn > 0 ? q.l : q.r;
  const w = Math.max(
    0.1,
    r2(((wx - (q.x + q.nx * sgn * edge)) * q.nx + (wz - (q.z + q.nz * sgn * edge)) * q.nz) * sgn),
  );
  ed.edit((rs) => {
    const r = rs[d.road];
    if (!r.along) return;
    if (d.handle === 'afrom') r.along.from = Math.min(at, r.along.to - 1);
    else if (d.handle === 'ato') r.along.to = Math.max(at, r.along.from + 1);
    else {
      if (!r.profile?.length) r.profile = [[(r.along.from + r.along.to) / 2, r.width ?? RUNOFF_WIDTH]];
      r.profile[d.n] = [Math.min(Math.max(at, r.along.from), r.along.to), w];
    }
    touch(rs, r);
  });
}

/** A rumble's end along its road, or on along another road whose edge goes on from its road's. */
function moveKerbEnd({ ed, s, find, road, d, wx, wz }: HandleMove) {
  const kerb = s.sel.kerb;
  const k = road.kerbs?.[kerb];
  const o = geo(road, find);
  if (!k || !o) return;
  const isStart = d.handle === 'kfrom';
  const n = nearestOn(o, wx, wz);
  const qn = pointAt(o, n.s);
  const onIt = n.d <= Math.max(qn.l, qn.r) + 0.3 && (isStart ? n.s > 0.05 : n.s < o.length - 0.05);
  const c = onIt ? null : continuation(road, k, isStart, wx, wz, s.roads, find);
  const key = isStart ? 'before' : 'after';
  const at = r1(n.s);
  ed.edit((rs) => {
    const kb = rs[d.road].kerbs?.[kerb];
    if (!kb) return;
    if (c) kb[key] = c;
    else if (onIt || !kb[key]) {
      delete kb[key];
      if (isStart) kb.from = Math.min(at, (kb.to ?? o.length) - 0.2);
      else kb.to = at >= o.length - 0.05 ? null : Math.max(at, (kb.from ?? 0) + 0.2);
    }
  });
}

/** A line's end along its road (to its end: none). */
function moveLineEnd({ ed, s, find, road, d, wx, wz }: HandleMove) {
  const o = geo(road, find);
  if (!o) return;
  const at = r1(nearestOn(o, wx, wz).s);
  const line = s.sel.line;
  ed.edit((rs) => {
    const ln = rs[d.road].lines?.[line];
    if (!ln) return;
    if (d.handle === 'lfrom') ln.from = at;
    else ln.to = at >= o.length - 0.05 ? null : at;
  });
}

const HANDLE_MOVES: Record<string, (m: HandleMove) => void> = {
  p: moveNode,
  in: moveArm,
  out: moveArm,
  wl: moveWidth,
  wr: moveWidth,
  afrom: moveRunOff,
  ato: moveRunOff,
  aw: moveRunOff,
  kfrom: (m) => {
    if (m.s.sel.kerb >= 0) moveKerbEnd(m);
  },
  kto: (m) => {
    if (m.s.sel.kerb >= 0) moveKerbEnd(m);
  },
  lfrom: moveLineEnd,
  lto: moveLineEnd,
};

/** The map's mouse: selecting, dragging nodes, handles, widths, lines and rumbles, panning, measuring. */
export class MapInteractions {
  private drag: Drag | null = null;

  constructor(private readonly ed: Editor) {}

  private size(): Size {
    return this.ed.get().size;
  }

  /** What can be picked: the category worked on's own things only. */
  private hitContext(): HitContext {
    const s = this.ed.get();
    const c = CATEGORIES[s.focus];
    return {
      roads: s.roads,
      find: lookup(s.roads),
      sel: s.sel,
      layers: { lines: s.layers.lines && c.lines, kerbs: s.layers.kerbs && c.kerbs },
      pickRoads: c.roads !== 'none',
      shape: c.roads === 'shape',
      ppm: s.view.ppm,
      toScreen: (x, z) => toScreen(s.view, this.size(), x, z),
    };
  }

  private world(p: Pointer): [number, number] {
    return toWorld(this.ed.get().view, this.size(), p.sx, p.sy);
  }

  private snap(wx: number, wz: number, exclude: string | null, p: Pointer) {
    if (p.ctrl) return null;
    const s = this.ed.get();
    return snapPoint(s.roads, lookup(s.roads), wx, wz, exclude, SNAP_PX / s.view.ppm);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  private pan(p: Pointer, click = false): Drag {
    return { kind: 'pan', sx: p.sx, sy: p.sy, from: this.ed.get().view, click };
  }

  down(p: Pointer): void {
    const s = this.ed.get();
    const [wx, wz] = this.world(p);
    if (p.button === 1 || p.button === 2 || s.space) {
      this.drag = this.pan(p);
      return;
    }
    if (s.routing) {
      // (a racing line being made: the road clicked added to it, or taken off)
      this.ed.routeAt(wx, wz, 6 / s.view.ppm);
      return;
    }
    if (s.lining.drawing) {
      // (a line to lay the grid or the pit boxes out along: its points clicked, snapping)
      const sp = this.snap(wx, wz, null, p);
      this.ed.linePoint(sp ? [sp.x, sp.z] : [wx, wz]);
      return;
    }
    if (s.mode === 'place') this.place(p, wx, wz);
    else if (s.mode === 'new') this.ed.addNewRoadPoint([wx, wz]);
    else if (s.mode === 'add') this.ed.addNodeAt(wx, wz);
    else if (s.mode === 'measure') {
      const sp = this.snap(wx, wz, null, p);
      const a: Vec2 = sp ? [sp.x, sp.z] : [wx, wz];
      this.ed.set({ measure: { a, b: a } });
      this.drag = { kind: 'measure' };
    } else this.pick(p, wx, wz);
  }

  /** A double click: while selecting, a node added where it is on what is picked (a road, a tyre wall, a fence, an
   * area, a racing line), not on one of its nodes. Whether one was. */
  double(p: Pointer): boolean {
    const s = this.ed.get();
    if (s.mode !== 'select' || s.routing || s.lining.drawing || p.button !== 0) return false;
    const [wx, wz] = this.world(p);
    return this.ed.doubleClickAt(wx, wz, 6 / s.view.ppm);
  }

  /** One of the kind being placed added there; a mark: its far end dragged on from there (its way and length). */
  private place(p: Pointer, wx: number, wz: number): void {
    this.ed.placeAt(wx, wz);
    const obj = this.ed.get().obj;
    if (this.ed.get().place !== 'marks' || obj?.kind !== 'marks' || this.ed.get().markAcross) return;
    const pick = { ...obj, j: 1 };
    this.ed.set({ obj: pick });
    this.drag = { kind: 'object', pick, whole: false, alt: p.alt, last: [wx, wz], moved: false, placed: true };
  }

  /** The object under the mouse (the objects shown), or the handle turning the one picked ('turn'). */
  private objectHit(p: Pointer, wx: number, wz: number): { pick: ObjectPick; turn: boolean } | null {
    const s = this.ed.get();
    const kinds = CATEGORIES[s.focus].kinds;
    if (!s.layers.objects || !s.objects || !kinds.length) return null;
    const h = turnHandle(s.objects, s.layout, s.obj, (x, z) => toScreen(s.view, this.size(), x, z));
    if (h && s.obj && Math.hypot(h[0] - p.sx, h[1] - p.sy) <= 8) return { pick: s.obj, turn: true };
    const pick = objectAt(s.objects, s.layout, wx, wz, 6 / s.view.ppm, kinds, s.obj);
    return pick && { pick, turn: false };
  }

  /** What the press is on: an object taken (or its turning handle), a road selected (then panning), a line or
   * rumble or handle taken, or nothing. */
  private pick(p: Pointer, wx: number, wz: number): void {
    const h = hitTest(this.hitContext(), p.sx, p.sy, wx, wz);
    const handle = h && h.kind !== 'road' && h.kind !== 'item';
    const o = handle ? null : this.objectHit(p, wx, wz);
    if (o) {
      this.ed.selectObject(o.pick);
      this.ed.remember();
      this.drag = {
        kind: o.turn ? 'turn' : 'object',
        pick: o.pick,
        whole: p.shift,
        alt: p.alt,
        last: [wx, wz],
        moved: false,
      };
      return;
    }
    if (!h) {
      this.drag = this.pan(p, true);
      return;
    }
    if (h.kind === 'road') {
      if (h.road !== this.ed.get().sel.r) this.ed.selectRoad(h.road);
      this.drag = this.pan(p);
      return;
    }
    if (h.kind === 'item') {
      this.pickItem(h);
      return;
    }
    this.ed.remember();
    const n = 'n' in h && h.n !== undefined ? h.n : -1;
    if (['p', 'in', 'out', 'wl', 'wr', 'aw'].includes(h.kind)) this.ed.select({ n });
    this.drag = { kind: 'handle', handle: h.kind, n, road: h.road, alt: p.alt, moved: false };
  }

  /** A line or rumble: selected, and dragged along its road as a whole. */
  private pickItem(h: ItemHit): void {
    const s = this.ed.get();
    const r = s.roads[h.road];
    const it = h.which === 'line' ? r.lines?.[h.idx] : r.kerbs?.[h.idx];
    const o = geo(r, lookup(s.roads));
    this.ed.select({ r: h.road, n: -1, line: h.which === 'line' ? h.idx : -1, kerb: h.which === 'kerb' ? h.idx : -1 });
    if (!it || !o) return;
    if ('kind' in it && (it.before || it.after)) {
      this.ed.status('this rumble goes on along another road: drag its ends (the triangles)');
      return;
    }
    this.ed.remember();
    const [from0, to0] = span(o, it.from, it.to);
    this.drag = {
      kind: 'item',
      which: h.which,
      idx: h.idx,
      road: h.road,
      s: h.s,
      from0,
      to0,
      toEnd: it.to == null,
      moved: false,
    };
  }

  /** The cursor to show. */
  move(p: Pointer): string | null {
    const ed = this.ed;
    const s = ed.get();
    const [wx, wz] = this.world(p);
    ed.set({ mouse: [wx, wz] });
    if (s.lining.drawing && !this.drag) {
      const sp = this.snap(wx, wz, null, p);
      ed.set({ snapMark: sp });
      ed.lineHover(sp ? [sp.x, sp.z] : [wx, wz]);
      return 'crosshair';
    }
    const d = this.drag;
    if (!d) return s.mode === 'select' && !s.space ? this.hoverCursor(wx, wz) : null;
    if (d.kind === 'measure') {
      const sp = this.snap(wx, wz, null, p);
      ed.set({ snapMark: sp, measure: { a: s.measure?.a ?? [wx, wz], b: sp ? [sp.x, sp.z] : [wx, wz] } });
      return null;
    }
    if (d.kind === 'pan') {
      ed.set({ view: panned(d.from, d.sx, d.sy, p.sx, p.sy) });
      if (Math.hypot(p.sx - d.sx, p.sy - d.sy) > 3) d.click = false;
      return null;
    }
    if (d.kind === 'object' || d.kind === 'turn') {
      this.dragObject(d, wx, wz, p.shift);
      return d.kind === 'object' ? 'grabbing' : null;
    }
    const road = s.roads[d.road];
    if (!road) return null;
    d.moved = true;
    if (d.kind === 'item') {
      this.dragItem(d, road, wx, wz);
      return 'grabbing';
    }
    const snap = (x: number, z: number, exclude: string | null) => this.snap(x, z, exclude, p);
    HANDLE_MOVES[d.handle]?.({ ed, s, find: lookup(s.roads), road, d, wx, wz, p, snap });
    return null;
  }

  private hoverCursor(wx: number, wz: number): string {
    const s = this.ed.get();
    const kinds = CATEGORIES[s.focus].kinds;
    const onObject =
      s.layers.objects && s.objects && objectAt(s.objects, s.layout, wx, wz, 6 / s.view.ppm, kinds, s.obj);
    return onObject || itemAt(this.hitContext(), wx, wz) ? 'grab' : 'default';
  }

  /** An object moved with the mouse, or turned to look at it. */
  private dragObject(d: ObjectDrag, wx: number, wz: number, shift: boolean) {
    const s = this.ed.get();
    const { layout } = s;
    if (d.kind === 'object' && d.pick.kind === 'marks' && d.pick.j >= 0) {
      this.ed.editObjects((o) => moveObjectEnd(o, d.pick, wx, wz, shift), {}, d.pick.kind);
    } else if (d.kind === 'object' && d.pick.h) {
      this.ed.editObjects((o) => moveObjectHandle(o, d.pick, wx, wz, d.alt, layout), {}, d.pick.kind);
    } else if (d.kind === 'object') {
      const [dx, dz] = [wx - d.last[0], wz - d.last[1]];
      d.last = [wx, wz];
      this.ed.editObjects((o) => moveObject(o, layout, d.pick, dx, dz, d.whole), {}, d.pick.kind);
    } else {
      const me = s.objects && poseOf(s.objects, layout, d.pick);
      if (!me || Math.hypot(wx - me.x, wz - me.z) < 1e-6) return;
      const heading = headingOf(wx - me.x, wz - me.z);
      this.ed.editObjects((o) => turnObject(o, layout, d.pick, heading, d.whole), {}, d.pick.kind);
    }
    d.moved = true;
  }

  /** The whole of a line or rumble along the road, as long as it was, within the road's ends. */
  private dragItem(d: ItemDrag, road: Road, wx: number, wz: number) {
    const o = geo(road, lookup(this.ed.get().roads));
    if (!o) return;
    const len = d.to0 - d.from0;
    const ds = nearestOn(o, wx, wz).s - d.s;
    const from = r1(Math.min(Math.max(d.from0 + ds, 0), Math.max(o.length - len, 0)));
    const to = d.toEnd && from + len >= o.length - 0.05 ? null : r1(from + len);
    this.ed.edit((rs) => {
      const it = d.which === 'line' ? rs[d.road].lines?.[d.idx] : rs[d.road].kerbs?.[d.idx];
      if (!it) return;
      it.from = from;
      it.to = to;
    });
  }

  up(): string | null {
    const ed = this.ed;
    const d = this.drag;
    this.drag = null;
    const mark = ed.get().snapMark;
    if (mark) ed.set({ snapMark: null, status: `snapped to ${mark.label}` });
    if (!d) return null;
    if (d.kind === 'pan' && d.click && ed.get().mode === 'select') ed.select({ r: -1, n: -1, line: -1, kerb: -1 });
    if (d.kind === 'item' || d.kind === 'handle') {
      if (d.moved) ed.wantMeshes();
      else ed.forget();
    }
    if ((d.kind === 'object' || d.kind === 'turn') && !d.moved && !d.placed) ed.forget();
    return d.kind === 'item' ? 'grab' : null;
  }

  wheel(sx: number, sy: number, deltaY: number): void {
    this.ed.set({ view: zoomAt(this.ed.get().view, this.size(), sx, sy, deltaY) });
  }
}
