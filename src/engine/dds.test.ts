// @vitest-environment node
// The textures made DDS for AC: a block encoded by hand.
import { describe, expect, it } from 'vitest';
import { bcn } from './dds';

describe('the textures made DDS for AC', () => {
  it('encodes a block: its two colours, its pixels nearest them', () => {
    // (a 4x4 of black to white across: DXT1's max (white) first, then min (black); each row's 2-bit indices)
    const data = new Uint8Array(16 * 3);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) data.fill([0, 85, 170, 255][x] as number, (y * 4 + x) * 3, (y * 4 + x) * 3 + 3);
    const got = bcn({ width: 4, height: 4, mode: 'RGB', data }, 'DXT1');
    expect([...got.subarray(0, 4)]).toEqual([0xff, 0xff, 0, 0]);
    // (x 0: min (1), x 1: a third of the way up (3: 2/3 min + 1/3 max), x 2: two thirds (2), x 3: max (0))
    const row = 1 | (3 << 2) | (2 << 4) | (0 << 6);
    expect([...got.subarray(4)]).toEqual([row, row, row, row]);
  });
});
