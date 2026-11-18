// A model's pictures each held once: one picture under two names (the same bytes) is one, the materials naming the
// other named after the one kept. Every model keeps its own pictures: AC does not find a picture in another model of
// the track (tried: pooled in the model every layout loads first, every other model drew another picture). The
// materials themselves are left as they are: the Custom Shaders Patch's config names them.
//
// poolTextures pools across models; only its one-model form (dedupeTextures) is used by the build.
import type { Kn5, Kn5Texture } from './kn5tree';

export interface Pooled {
  /** pictures the shared model holds */
  pooled: number;
  /** pictures taken out of the other models (now found in the shared one) */
  moved: number;
  /** material slots renamed to a picture of the same bytes */
  renamed: number;
  /** names two models give different pictures: kept in each model */
  clashes: string[];
}

/** A quick hash of a picture's bytes (FNV-1a, with its length): pictures of the same hash are compared whole. */
function hashOf(d: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) {
    h ^= d[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}:${d.length}`;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** The models' pictures into shared (by its name in models), once (see the module's note). Changes the models. */
export function poolTextures(models: Map<string, Kn5>, shared: string): Pooled {
  const first = models.get(shared);
  if (!first) return { pooled: 0, moved: 0, renamed: 0, clashes: [] };
  // (the shared model's first, then the rest in their order: a picture's name is the first one it had)
  const order = [shared, ...[...models.keys()].filter((s) => s !== shared)];
  const byName = new Map<string, Kn5Texture>();
  const clashes = new Set<string>();
  for (const s of order)
    for (const t of (models.get(s) as Kn5).textures) {
      const had = byName.get(t.name);
      if (!had) byName.set(t.name, t);
      else if (!sameBytes(had.data, t.data)) clashes.add(t.name);
    }
  // (one picture under several names: the first name it had)
  const keptName = new Map<string, string>();
  const byHash = new Map<string, Kn5Texture[]>();
  for (const [name, t] of byName) {
    if (clashes.has(name)) continue;
    const list = byHash.get(hashOf(t.data)) ?? [];
    const twin = list.find((o) => sameBytes(o.data, t.data));
    if (twin) keptName.set(name, twin.name);
    else {
      list.push(t);
      byHash.set(hashOf(t.data), list);
    }
  }
  let renamed = 0;
  let moved = 0;
  for (const s of order) {
    const k = models.get(s) as Kn5;
    for (const m of k.materials)
      for (const slot of m.textures) {
        const to = keptName.get(slot.name);
        if (to) {
          slot.name = to;
          renamed++;
        }
      }
    if (s === shared) continue;
    const before = k.textures.length;
    k.textures = k.textures.filter((t) => clashes.has(t.name));
    moved += before - k.textures.length;
  }
  // (the shared model: every picture once, its own first, a clash's as it had it)
  const pool: Kn5Texture[] = [];
  const have = new Set<string>();
  for (const t of first.textures)
    if (!keptName.has(t.name) && !have.has(t.name)) {
      pool.push(t);
      have.add(t.name);
    }
  for (const [name, t] of byName)
    if (!clashes.has(name) && !keptName.has(name) && !have.has(name)) {
      pool.push(t);
      have.add(name);
    }
  first.textures = pool;
  return { pooled: pool.length, moved, renamed, clashes: [...clashes] };
}

/** A model's pictures each held once (one under two names: the first name; its materials renamed to it). */
export function dedupeTextures(k: Kn5): Pooled {
  return poolTextures(new Map([['model', k]]), 'model');
}

/** The model each of the layouts loads first, where they all load the same one (its stem); else null. */
export function sharedFirst(lists: Record<string, string[]>): string | null {
  const firsts = new Set(Object.values(lists).map((l) => l[0] ?? ''));
  const [one] = [...firsts];
  return firsts.size === 1 && one ? one : null;
}
