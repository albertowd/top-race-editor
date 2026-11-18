// The track's trees (its track file's `trees`: {model, x, z, heading, scale} each) as the page edits them: objects of
// the kind "trees" among the others, one of its model each (named TREE_n as read, in every layout, sized alike every
// way), picked, moved, turned and deleted as any is; saved apart again, as the track keeps them.

import { learnTrackTrees } from '../domain/models';
import type { PlacedObject, TrackObjects } from '../domain/types';
import { isCurve, kindOfModel } from './objects';

/** A tree where it stands (the track file's). */
export interface TreePlacement {
  model: string;
  x: number;
  z: number;
  heading: number;
  scale: number;
}

/** Whether an object is one of the track's trees: a single one of a tree's model. */
export const isTree = (o: PlacedObject): boolean => !isCurve(o) && kindOfModel(o.model) === 'trees';

/** The trees among the objects (after them), their models learned (a tree's kind, one the catalogue has not). */
export function withTrees(o: TrackObjects, trees: readonly TreePlacement[]): TrackObjects {
  learnTrackTrees(trees.map((t) => t.model));
  if (!trees.length) return o;
  const taken = new Set(o.objects.map((it) => it.name));
  let n = 0;
  const name = () => {
    while (taken.has(`TREE_${n}`)) n++;
    taken.add(`TREE_${n}`);
    return `TREE_${n}`;
  };
  return {
    ...o,
    objects: [
      ...o.objects,
      ...trees.map(
        (t): PlacedObject => ({
          name: name(),
          model: t.model,
          curve: [{ p: [t.x, t.z], in: [0, 0], out: [0, 0] }],
          heading: t.heading,
          collision: 'static',
          ...(t.scale === 1 ? {} : { scale: [t.scale, t.scale, t.scale] as [number, number, number] }),
        }),
      ),
    ],
  };
}

/** The objects without their trees, and the trees as the track keeps them (a tree's scale: the most of its three). */
export function splitTrees(o: TrackObjects): { objects: TrackObjects; trees: TreePlacement[] } {
  const trees: TreePlacement[] = [];
  const rest: PlacedObject[] = [];
  for (const it of o.objects) {
    const p = it.curve[0];
    if (!isTree(it) || !p) {
      rest.push(it);
      continue;
    }
    trees.push({
      model: it.model,
      x: p.p[0],
      z: p.p[1],
      heading: it.heading ?? 0,
      scale: Math.max(...(it.scale ?? [1])),
    });
  }
  return { objects: rest.length === o.objects.length ? o : { ...o, objects: rest }, trees };
}
