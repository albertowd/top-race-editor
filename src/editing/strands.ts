// What is laid along nodes: a road, a tyre wall, a fence, a paint or rubber mark, a paved area, a racing line. Each is edited the same way,
// whatever it is: a node added where clicked (Add Node, A, or a double click on it while selecting), a node deleted
// with the whole still picked, a node that has to stay kept (and why), its handles smoothed (S).
import { CATEGORIES, type Category } from '../domain/categories';
import type { ObjectKind, ObjectPick, Road, TrackObjects, Vec2 } from '../domain/types';
import { geo, lookup } from '../geometry/roads';
import { nearestOn, pointAt } from '../geometry/samples';
import { addCorner, inside, nearestEdge } from './areas';
import { addLineNode, FORK, isLineKind, lineOf, MERGE } from './lines';
import { addObject, CURVED_KINDS, isMarkKind, isModelKind, marksOf, OBJECT_LABELS } from './objects';
import { nearestOnWall, smoothWall } from './walls';

/** The objects' kinds laid along nodes. */
export const NODE_KINDS: ReadonlySet<ObjectKind> = new Set<ObjectKind>([
  ...CURVED_KINDS,
  'marks',
  'rubber',
  'areas',
  'fast',
  'pit',
]);

export const hasNodes = (kind: ObjectKind): boolean => NODE_KINDS.has(kind);

/** One of them, picked: a road (its index), or an object (its kind and index). */
export type Strand = { of: 'road'; r: number } | { of: 'object'; kind: ObjectKind; i: number };

/** Whether placing a kind lays it along nodes, one click a node (a tyre wall, a fence, a paint mark, an area): its
 * first click makes one, the next add to it. */
export const placedAlong = (kind: ObjectKind): boolean =>
  (isModelKind(kind) && CURVED_KINDS.has(kind)) || isMarkKind(kind) || kind === 'areas';

/** The object placing adds the next node to: the one of the kind placed that placing made, while it is still picked
 * (one picked before placing began is left alone: the next click makes a new one). */
export function placingInto(s: {
  place: ObjectKind;
  obj: ObjectPick | null;
  placing: { kind: ObjectKind; i: number } | null;
}): number | undefined {
  const { place, obj, placing } = s;
  if (!placedAlong(place) || placing?.kind !== place || obj?.kind !== place || obj.i !== placing.i) return undefined;
  return placing.i;
}

/** What is picked, if it is laid along nodes (a road: in a category its shape is worked on in). */
export function strandOf(s: { obj: ObjectPick | null; sel: { r: number }; focus: Category }): Strand | null {
  if (s.obj) return hasNodes(s.obj.kind) ? { of: 'object', kind: s.obj.kind, i: s.obj.i } : null;
  return s.sel.r >= 0 && CATEGORIES[s.focus].roads === 'shape' ? { of: 'road', r: s.sel.r } : null;
}

/** What the strand is on: the roads, the objects, the layout shown. */
export interface StrandWorld {
  roads: readonly Road[];
  objects: TrackObjects | null;
  layout: string;
}

/** Where its nodes are. */
export function nodesOf(w: StrandWorld, st: Strand): Vec2[] {
  if (st.of === 'road') return w.roads[st.r]?.curve?.map((n) => n.p) ?? [];
  const o = w.objects;
  if (!o) return [];
  if (st.kind === 'areas') return o.areas?.[st.i]?.points ?? [];
  if (isMarkKind(st.kind)) return marksOf(o, st.kind)[st.i]?.curve.map((n) => n.p) ?? [];
  if (isLineKind(st.kind)) return lineOf(o.layouts[w.layout], st.kind)?.curve.map((n) => n.p) ?? [];
  return o.objects[st.i]?.curve.map((n) => n.p) ?? [];
}

/** How far (x, z) is off it: off a road's edges, an area's edges (none inside it), a curve (one node: off it). */
export function offStrand(w: StrandWorld, st: Strand, x: number, z: number): number {
  if (st.of === 'road') {
    const road = w.roads[st.r];
    const g = road && geo(road, lookup(w.roads));
    if (!g) return Infinity;
    const n = nearestOn(g, x, z);
    const q = pointAt(g, n.s);
    return Math.max(0, n.d - Math.max(q.l, q.r));
  }
  const o = w.objects;
  if (!o) return Infinity;
  if (st.kind === 'areas') {
    const a = o.areas?.[st.i];
    if (!a) return Infinity;
    return inside(a.points, x, z) ? 0 : nearestEdge(a.points, x, z).d;
  }
  const c = curveOf(o, w.layout, st.kind, st.i);
  if (!c?.curve.length) return Infinity;
  if (c.curve.length === 1) {
    const [p] = c.curve;
    return p ? Math.hypot(p.p[0] - x, p.p[1] - z) : Infinity;
  }
  return nearestOnWall(c, x, z).d;
}

/** Whether (x, z) is within tol of one of its nodes. */
export const onNode = (w: StrandWorld, st: Strand, x: number, z: number, tol: number): boolean =>
  nodesOf(w, st).some(([px, pz]) => Math.hypot(px - x, pz - z) <= tol);

/** The curve of an object laid along one: a racing line's, a paint mark's, a tyre wall's or a fence's. */
function curveOf(o: TrackObjects, layout: string, kind: ObjectKind, i: number) {
  if (isLineKind(kind)) return lineOf(o.layouts[layout], kind);
  if (isMarkKind(kind)) return marksOf(o, kind)[i];
  return isModelKind(kind) ? o.objects[i] : undefined;
}

/** A node added at (x, z) to an object laid along nodes (on a draft): a tyre wall, a fence or a paint mark (into it
 * where within tol of it, else on past its nearer end), an area (a corner on its nearest edge), a racing line (into it, else on past
 * its nearer end). The node's pick, or null. */
export function addObjectNode(
  o: TrackObjects,
  layout: string,
  kind: ObjectKind,
  i: number,
  x: number,
  z: number,
  tol: number,
): ObjectPick | null {
  if (kind === 'areas') {
    const a = o.areas?.[i];
    const j = a ? addCorner(a, x, z, Infinity) : null;
    return j === null ? null : { kind, i, j };
  }
  if (isLineKind(kind)) {
    const lay = o.layouts[layout];
    const j = lay ? addLineNode(lay, kind, x, z, tol) : null;
    return j === null ? null : { kind, i: 0, j };
  }
  if (
    ((isModelKind(kind) && CURVED_KINDS.has(kind)) || isMarkKind(kind)) &&
    (isMarkKind(kind) ? marksOf(o, kind)[i] : o.objects[i])
  )
    return addObject(o, layout, kind, x, z, 0, { within: i, tol });
  return null;
}

/** Its handles smoothed (on a draft): the node j's, else every node's. Whether it has any (an area has not). */
export function smoothObject(o: TrackObjects, layout: string, kind: ObjectKind, i: number, j = -1): boolean {
  const c = curveOf(o, layout, kind, i);
  if (!c || c.curve.length < 2) return false;
  smoothWall(c, j);
  return true;
}

/** Why a node picked was not taken away. */
export function keptWhy(p: ObjectPick | { of: 'road' }): string {
  if ('of' in p) return 'a road keeps two nodes at least (to take it away: Shift+Delete)';
  if (p.kind === 'areas') return 'an area keeps three corners at least (to take it away: pick it inside, then Delete)';
  if (p.j === FORK || p.j === MERGE)
    return 'the pit line forks off and merges into the fast line there: drag them along it (to take the pit line away: pick its curve, then Delete)';
  if (p.kind === 'fast') return 'the fast line keeps three nodes at least';
  if (p.kind === 'pit') return 'the pit line keeps its ends and one node between them';
  if (p.kind === 'marks') return 'a paint mark keeps two nodes at least';
  if (p.kind === 'rubber') return 'a rubber mark keeps two nodes at least';
  return `that node of the ${OBJECT_LABELS[p.kind].one.toLowerCase()} is kept`;
}
