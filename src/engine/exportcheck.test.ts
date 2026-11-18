// What a track must have before it is built (exportcheck.ts): each layout's lack said, a whole one nothing.
import { describe, expect, it } from 'vitest';
import { layoutsMissing } from './exportcheck';

const spot = { x: 0, z: 0, heading: 0 };
const lines = {
  fast: { curve: [{}, {}, {}], closed: true },
  pit: { curve: [{}, {}], closed: false },
};

describe('a track ready to build', () => {
  it('says what each layout lacks', () => {
    expect(layoutsMissing(null)).toEqual(['the track has no layouts: add one with its grid, pits and timing']);
    expect(
      layoutsMissing({
        layouts: {
          whole: { grid: [spot], pits: [spot], hotlap: spot, timing: [{}], lines },
          bare: { grid: [], pits: [], hotlap: null, timing: [] },
          short: { grid: [spot, spot], pits: [spot], hotlap: spot, timing: [{}], lines: { fast: lines.fast } },
        },
      }),
    ).toEqual([
      'bare: no fast line, no grid slot, no timing gate, no hotlap start',
      'short: no pit lane line, 1 pit boxes for 2 grid slots',
    ]);
  });
});
