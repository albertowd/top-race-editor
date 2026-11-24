// @vitest-environment node
// A start's map drawn a few triangles a path at a time: Chromium takes ever longer for each triangle more a path has
// (100 000 in one, half a minute; a floor's million and a half, hours), so a path of them all never ends. Drawn here on
// a canvas that counts what each fill was given. And AC's outline, a PNG of the size asked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapPreview, outline } from './mappreview';

const fills: number[] = [];
/** each canvas made (its size), what was drawn on each, the type each was made into */
const made: { width: number; height: number; drawn: unknown[] }[] = [];
const blobs: unknown[] = [];

class CountingCanvas {
  readonly drawn: unknown[] = [];
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    made.push(this);
  }
  getContext() {
    let subpaths = 0;
    const noop = () => {};
    return {
      beginPath: () => {
        subpaths = 0;
      },
      moveTo: () => {
        subpaths++;
      },
      fill: () => fills.push(subpaths),
      lineTo: noop,
      closePath: noop,
      fillRect: noop,
      stroke: noop,
      arc: noop,
      fillText: noop,
      drawImage: (what: unknown) => this.drawn.push(what),
    };
  }
  async convertToBlob(o: { type: string }) {
    blobs.push(o.type);
    return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])]);
  }
}

describe("a start's map", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fills.length = 0;
    made.length = 0;
    blobs.length = 0;
  });

  it('fills its roads a few triangles a path at a time', async () => {
    vi.stubGlobal('OffscreenCanvas', CountingCanvas);
    const n = 25_000;
    const roads = new Float32Array(n * 6);
    for (let t = 0; t < n; t++) roads.set([t % 100, t / 100, (t % 100) + 1, t / 100, t % 100, t / 100 + 1], t * 6);
    const jpg = await mapPreview({
      roads,
      line: [0, 0, 50, 0, 50, 50],
      at: [0, 0],
      fwd: [1, 0],
      title: 'a layout',
      frame: [
        [0, 0],
        [100, 250],
      ],
    });
    expect([...jpg]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    // (every triangle filled, none in a path of thousands; the start's ring and arrow theirs)
    const roadFills = fills.filter((f) => f > 2);
    expect(roadFills.reduce((a, f) => a + f, 0)).toBe(n);
    expect(Math.max(...fills)).toBeLessThanOrEqual(1000);
  });

  it("is AC's outline: a PNG of the size asked", async () => {
    vi.stubGlobal('OffscreenCanvas', CountingCanvas);
    await outline({ line: [0, 0, 50, 0, 50, 50], size: [365, 192] });
    expect(made.at(-1)).toMatchObject({ width: 365, height: 192 });
    expect(blobs).toEqual(['image/png']);
  });
});
