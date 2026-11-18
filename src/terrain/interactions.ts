// The terrain's mouse on the map, while it is worked on: picking rings and dragging them (a point, or whole),
// drawing a ring point by point, brushing. What it does not take (a press on nothing, any but the left button,
// Space held) the map's own mouse has: panning.

import type { Pointer } from '../canvas/interactions';
import type { Size, View } from '../canvas/viewport';
import { toWorld } from '../canvas/viewport';
import type { Vec2 } from '../domain/types';
import { ringAt } from './render';
import { pointNear, sideNear } from './rings';
import type { Terrain, TerrainPick } from './store';

/** pixels the mouse may be off a ring's point or side and be on it */
const NEAR_PX = 7;
/** pixels from a ring's first point that end it when clicked */
const CLOSE_PX = 9;

type Drag =
  | { kind: 'point'; pick: TerrainPick; j: number; moved: boolean }
  | { kind: 'ring'; pick: TerrainPick; last: Vec2; moved: boolean }
  | { kind: 'brush' };

export interface MapView {
  view: View;
  size: Size;
  space: boolean;
}

export class TerrainInteractions {
  private drag: Drag | null = null;

  constructor(
    private readonly t: Terrain,
    private readonly map: () => MapView,
  ) {}

  get dragging(): boolean {
    return !!this.drag;
  }

  private world(p: Pointer): Vec2 {
    const { view, size } = this.map();
    return toWorld(view, size, p.sx, p.sy);
  }

  /** A press on the map: true if the terrain took it. */
  down(p: Pointer): boolean {
    const m = this.map();
    if (p.button !== 0 || m.space) return false;
    const s = this.t.get();
    if (!s.doc) return false;
    const at = this.world(p);
    const tol = NEAR_PX / m.view.ppm;
    switch (s.tool) {
      case 'brush':
        if (p.alt) {
          // (Alt: the height under the mouse taken as flattening's)
          this.t.setBrush({ target: Math.round(this.t.liveHeight('', at[0], at[1]) * 100) / 100, mode: 'flatten' });
          return true;
        }
        this.t.beginStroke(at);
        this.drag = { kind: 'brush' };
        return true;
      case 'select':
        return this.pickAt(at, tol, p);
      default: {
        const draft = s.draft ?? [];
        if (draft.length >= 3 && Math.hypot(draft[0][0] - at[0], draft[0][1] - at[1]) <= CLOSE_PX / m.view.ppm) {
          this.t.finishDraft();
          return true;
        }
        this.t.draftPoint(at);
        return true;
      }
    }
  }

  private pickAt(at: Vec2, tol: number, p: Pointer): boolean {
    const s = this.t.get();
    const doc = s.doc;
    if (!doc) return false;
    // (the picked ring's points first: Alt takes one out; its sides then: Shift adds one there)
    if (s.pick) {
      const ring = this.t.ringOf(s.pick);
      if (ring) {
        const j = pointNear(ring, at[0], at[1], tol);
        if (j >= 0) {
          if (p.alt) this.t.removePoint(s.pick, j);
          else {
            this.t.remember();
            this.drag = { kind: 'point', pick: s.pick, j, moved: false };
          }
          return true;
        }
        const side = p.shift ? sideNear(ring, at[0], at[1], tol) : null;
        if (side) {
          this.t.addPoint(s.pick, side.i, side.p);
          this.drag = { kind: 'point', pick: s.pick, j: side.i + 1, moved: true };
          return true;
        }
      }
    }
    const hit = ringAt(doc, s.pick, at[0], at[1]);
    if (!hit) {
      if (s.pick) this.t.pickThing(null);
      return false;
    }
    this.t.pickThing(hit);
    this.t.remember();
    this.drag = { kind: 'ring', pick: hit, last: at, moved: false };
    return true;
  }

  /** The mouse moved: a drag goes on; the cursor wanted (null: the map's own). */
  move(p: Pointer): string | null {
    const d = this.drag;
    const at = this.world(p);
    if (!d) return this.t.get().tool === 'select' ? null : 'crosshair';
    if (d.kind === 'brush') {
      this.t.strokeTo(at);
      return 'crosshair';
    }
    if (d.kind === 'point') {
      d.moved = true;
      this.t.movePoint(d.pick, d.j, at);
      return 'grabbing';
    }
    const dx = at[0] - d.last[0];
    const dz = at[1] - d.last[1];
    if (dx || dz) {
      d.moved = true;
      this.t.moveRing(d.pick, dx, dz);
      d.last = at;
    }
    return 'grabbing';
  }

  /** The press let go; the cursor wanted. */
  up(): string | null {
    const d = this.drag;
    this.drag = null;
    if (!d) return null;
    if (d.kind === 'brush') this.t.endStroke();
    // (a ring picked, not moved: nothing to undo)
    else if (!d.moved) {
      const u = this.t.get().undo;
      this.t.set({ undo: u.slice(0, -1) });
    }
    return null;
  }
}
