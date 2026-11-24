// @vitest-environment node
// The renders' views: a layout's picture the gantry its lap runs under, seen from the track before it; a layout whose
// lap runs under none, all of it from above; a start's place from just behind it.
import { describe, expect, it } from 'vitest';
import { gantryModels, gantryView, layoutView, overview, startView, type V3 } from './trackrender';

/** a ring of n points round the middle, r across (AC's axes, y up), running anticlockwise from above */
const ring = (r: number, n = 80): V3[] =>
  Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), 0, -r * Math.sin((2 * Math.PI * i) / n)]);

/** a gantry 16 m across standing over (x, z), 5 m high */
const gantry = (x: number, z: number): [V3, V3] => [
  [x - 1, 0, z - 8],
  [x + 1, 5, z + 8],
];

describe("a layout's picture", () => {
  it('is its gantry seen from the track before it, all its width in view', () => {
    const line = ring(100);
    const v = gantryView(gantry(100, 0), line, [800, 450]);
    expect(v).not.toBeNull();
    const { eye, target } = v as NonNullable<typeof v>;
    // (the lap runs north there, -z: the eye south of it, a driver's height up, looking at it)
    expect(eye[2]).toBeGreaterThan(10);
    expect(eye[1]).toBeGreaterThan(1);
    expect(eye[1]).toBeLessThan(3);
    expect(target).toEqual([100, expect.closeTo(2.75, 5), 0]);
    expect(v?.grass?.radius).toBeGreaterThan(45);
  });

  it('is all its lap from above where it runs under no gantry', () => {
    const line = ring(100);
    expect(gantryView(gantry(300, 0), line, [800, 450])).toBeNull();
    const far = layoutView(line, [gantry(300, 0)], [800, 450]);
    expect(far).toEqual(overview(line, { size: [800, 450] }));
    expect(far.eye[1]).toBeGreaterThan(50);
    // (the gantry it runs under, of those given)
    expect(layoutView(line, [gantry(300, 0), gantry(100, 0)], [800, 450]).target[0]).toBe(100);
  });

  it("knows a track's gantries by their still twins", () => {
    expect(
      gantryModels(['track.kn5', 'track_gantry_a.kn5', 'track_gantry_a_still.kn5', 'track_gate_still.kn5', 'x.kn5']),
    ).toEqual(['track_gantry_a.kn5', 'track_gantry_a_still.kn5', 'track_gate_still.kn5']);
  });

  it("is a start's place seen from behind it where it has no line", () => {
    const v = startView([10, 0, 0], [0, 0, -1]);
    expect(v.eye[2]).toBeGreaterThan(0);
    expect(v.target[2]).toBeLessThan(0);
    expect(v.grass).toBeDefined();
  });
});
