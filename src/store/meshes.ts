import type { Road, Selection } from '../domain/types';
import type { Lookup } from '../geometry/roads';

/** The roads whose wireframes show: the selected one and those joined to its ends. */
export function wiredRoads(roads: readonly Road[], sel: Selection, find: Lookup): Road[] {
  const road = roads[sel.r];
  if (!road) return [];
  const out = [road];
  for (const nd of road.curve ?? []) {
    const r2 = nd.joint && find(nd.joint.road);
    if (r2 && !out.includes(r2)) out.push(r2);
  }
  return out;
}

/**
 * What a road's mesh is made of: its shape, its place in the list (it is cut under the roads above it), a
 * run-off's road. A road whose lines or rumbles change keeps its mesh.
 */
export function meshDeps(road: Road, roads: readonly Road[], find: Lookup): unknown[] {
  const parent = road.along ? find(road.along.road) : undefined;
  return [
    road.curve,
    road.along,
    road.profile,
    road.width,
    road.ease,
    road.start_left,
    road.end_left,
    road.map,
    road.joins,
    roads.indexOf(road),
    parent?.curve,
    parent?.start_left,
    parent?.end_left,
  ];
}

export const sameDeps = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);
