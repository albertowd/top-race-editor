// The models' pictures from above (public/models/<id>.top.png), loaded as the map asks for them.

import { modelTop } from '../domain/models';

const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

/** Told when a picture has loaded (the map drawn again); gives back what stops it. */
export function onPicture(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A model's picture from above, once loaded (asked for the first time: loading it). */
export function topPicture(id: string): HTMLImageElement | null {
  let im = images.get(id);
  if (!im) {
    if (typeof Image === 'undefined') return null;
    im = new Image();
    im.onload = () => {
      for (const fn of listeners) fn();
    };
    im.src = modelTop(id);
    images.set(id, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}
