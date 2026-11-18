// @vitest-environment node
// The place (the ground) of the small terrain made up for the tests (src/test/fixtures/terrain), kept between builds.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES, greyOfPng } from '../test/made-up';
import { makePlace, type PlaceSource, placeKey, type TerrainDoc } from './place';

const ROOT = join(FIXTURES, 'terrain');

function source(): PlaceSource & { size(path: string): Promise<number> } {
  const at = (p: string) => (isAbsolute(p) ? p : join(ROOT, p));
  return {
    size: async (p) => statSync(at(p)).size,
    folder: 'tools/reference/terrain',
    read: async (p) => readFileSync(at(p)),
    glob: async (pattern) => {
      const dir = posix.dirname(pattern);
      const re = new RegExp(
        `^${posix
          .basename(pattern)
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '.')}$`,
      );
      const full = join(ROOT, dir);
      return existsSync(full)
        ? readdirSync(full)
            .filter((n) => re.test(n))
            .sort()
            .map((n) => `${dir}/${n}`)
        : [];
    },
    grey: async (p) => greyOfPng(new Uint8Array(readFileSync(at(p)))),
  };
}

describe('the place kept between builds', () => {
  it('is worked out once, then read back the same; another description, another key', async () => {
    const src = source();
    const doc = JSON.parse(new TextDecoder().decode(await src.read(`${src.folder}/terrain.json`))) as TerrainDoc;
    const kept = new Map<string, Uint8Array>();
    const cache = {
      get: async (k: string) => kept.get(k) ?? null,
      put: async (k: string, b: Uint8Array) => void kept.set(k, b),
    };
    const first = await makePlace(doc, src, cache);
    const again = await makePlace(doc, src, cache);
    expect([first.kept, again.kept, kept.size]).toEqual([false, true, 1]);
    expect(again.layers.why).toEqual(first.layers.why);
    const P = [0, 0, -35.5, 12.25, 40, 17, 79, -69];
    expect(again.ground.ys(P)).toEqual(first.ground.ys(P));
    const other = { ...doc, filters: { ...doc.filters, over_m: 2 } };
    expect(await placeKey(other, src)).not.toBe(first.key);
  });
});
