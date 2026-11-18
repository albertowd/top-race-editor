// @vitest-environment node
// A layout's AIW (rf2/aiw.ts), of a made-up layout: an oval (two 200 m straights along z, bends of 30 m) on a floor
// leaning across it, a pit lane forking off its first straight and merging back, two grid slots, two pit boxes and
// three timing gates. Written as Studio 397's own AIWs are (and, where rFactor 2 is here, as Joesville's is).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LayoutObjects } from '../../domain/types';
import type { LineNode, RacingLine } from '../ailines';
import { aiLineOf } from '../aimake';
import { type AiwInput, aiwText, aiwTiming, GRID_LEAD, orientation, PIT_LEAD, STARTING_GRID, type V3 } from './aiw';

const JOESVILLE =
  'D:/SteamLibrary/steamapps/common/rFactor 2/ModDev/Locations/Joesville/JoesVille_Speedway/Joesville_Speedway.AIW';

// ---------------------------------------------------------------- the made-up layout

function oval(): RacingLine {
  const r = 30;
  const L = 100;
  const k = 0.5523 * r;
  const curve: LineNode[] = [
    { p: [r, -L], in: [0, -k], out: [0, k] },
    { p: [r, L], in: [0, -100], out: [0, k] },
    { p: [0, L + r], in: [k, 0], out: [-k, 0] },
    { p: [-r, L], in: [0, k], out: [0, -k] },
    { p: [-r, -L], in: [0, 100], out: [0, -k] },
    { p: [0, -L - r], in: [-k, 0], out: [k, 0] },
  ];
  return { curve, closed: true };
}

/** off the first straight (x 30, run +z) at z -60, along x 21, back on at z 60 */
const pitLine = (): RacingLine => ({
  curve: [
    { p: [30, -60], in: [0, 0], out: [0, 8] },
    { p: [21, -30], in: [0, -8], out: [0, 8] },
    { p: [21, 30], in: [0, -8], out: [0, 8] },
    { p: [30, 60], in: [0, -8], out: [0, 0] },
  ],
  closed: false,
  leaves: 40,
  joins: 160,
});

/** the floor rising towards +x (the first straight's left: a car leans to its right there) */
const floor = (x: number) => 0.5 + 0.05 * x;
/** the roads: the first straight from x 26 to 36 (4 m to the line's right, 6 to its left), the other 8 m wide, the
 * bends 8 m wide, the pit lane from x 17 to 26 */
const onRoad = (x: number, z: number) => {
  if (Math.abs(z) <= 100)
    return (x >= 26 && x <= 36) || (x >= -34 && x <= -26) || (Math.abs(z) <= 64 && x >= 17 && x <= 26);
  return Math.abs(Math.hypot(x, z - Math.sign(z) * 100) - 30) <= 4;
};

const layout: Pick<LayoutObjects, 'grid' | 'pits' | 'timing'> = {
  grid: [
    { x: 31, z: -8, heading: 0 },
    { x: 29, z: -14, heading: 0 },
  ],
  pits: [
    { x: 18.5, z: -6, heading: 0 },
    { x: 18.5, z: 6, heading: 0 },
  ],
  timing: [
    { name: 'AC_TIME_0', left: { x: 36, z: 0 }, right: { x: 26, z: 0 } },
    { name: 'AC_TIME_1', left: { x: 0, z: 126 }, right: { x: 0, z: 136 } },
    { name: 'AC_TIME_2', left: { x: -36, z: 0 }, right: { x: -24, z: 0 } },
  ],
};

const input = (): AiwInput => ({
  layout,
  fast: aiLineOf(oval(), (x) => floor(x), onRoad),
  pit: aiLineOf(pitLine(), (x) => floor(x), onRoad),
  floor: (x) => floor(x),
});

// ---------------------------------------------------------------- reading an AIW

interface Parsed {
  lines: string[];
  sections: string[];
  /** each section's key=value lines, in order */
  body: Record<string, [string, string][]>;
  header: [string, string][];
  wps: [string, string][][];
}

const nums = (v: string) =>
  v
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((s) => Number(s));

function parse(text: string): Parsed {
  const lines = text.split('\r\n');
  const sections: string[] = [];
  const body: Record<string, [string, string][]> = {};
  const header: [string, string][] = [];
  const wps: [string, string][][] = [];
  let section = '';
  for (const raw of lines) {
    const line = raw.replace(/\s*\/\/.*$/, '');
    if (/^\[.*\]$/.test(line)) {
      section = line;
      sections.push(line);
      body[line] = [];
      continue;
    }
    const m = /^([A-Za-z_0-9]+)=(.*)$/.exec(line);
    if (!m || !section) continue;
    const kv: [string, string] = [m[1] as string, m[2] as string];
    (body[section] as [string, string][]).push(kv);
    if (section !== '[Waypoint]') continue;
    if (kv[0] === 'wp_pos') wps.push([]);
    if (wps.length) (wps.at(-1) as [string, string][]).push(kv);
    else header.push(kv);
  }
  return { lines, sections, body, header, wps };
}

const value = (wp: [string, string][], key: string) => nums((wp.find(([k]) => k === key) as [string, string])[1]);
const headerValue = (p: Parsed, key: string) => nums((p.header.find(([k]) => k === key) as [string, string])[1]);

const SECTIONS = ['[Features]', '[GRID]', '[ALTGRID]', '[TELEPORT]', '[PITS]', '[AUX]', '[Waypoint]'];
const pathKeys = (p: number) => [`wp_pathinfo2:${p}`, `wp_oriantation:${p}`, `wp_pathflags:${p}`];
const WP_KEYS = [
  'wp_pos',
  'wp_perp',
  'wp_normal',
  ...pathKeys(0),
  ...pathKeys(1),
  ...pathKeys(2),
  'wp_width',
  'wp_dwidth',
  'wp_lockedAlpha',
  'wp_test_speed',
  'wp_reverb',
  'wp_score',
  'wp_wpse',
  'wp_branchID',
  'wp_bitfields',
  'wp_pitlane',
  'WP_PTRS',
];
/** a waypoint's keys, each path's with its path */
const keysOf = (wp: [string, string][]) =>
  wp.map(([k, v]) => (/^wp_(pathinfo2|oriantation|pathflags)$/.test(k) ? `${k}:${nums(v)[0]}` : k));

// ---------------------------------------------------------------- the made-up layout's AIW

describe("a layout's AIW", () => {
  const text = aiwText(input());
  const p = parse(text);
  const W = p.wps.map((wp) => ({
    pos: value(wp, 'wp_pos') as V3,
    score: value(wp, 'wp_score'),
    branch: value(wp, 'wp_branchID')[0] as number,
    nonpath: value(wp, 'wp_bitfields')[0] === 1,
    ptrs: value(wp, 'WP_PTRS') as [number, number, number, number],
    width: value(wp, 'wp_width'),
  }));
  const main = W.filter((w) => w.branch === 0);
  const lap = headerValue(p, 'lap_length')[0] as number;

  it('has the sections and fields in the samples’ order and syntax', () => {
    expect(text.endsWith('\r\n\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(p.lines[0]).toMatch(/^\/\/\[\[gMa1\.002f \(c\)\d{4} {4}\]\] \[\[ {12}\]\]$/);
    expect(p.sections).toEqual(SECTIONS);
    // (a blank line before each section but the first)
    for (const s of SECTIONS.slice(1)) expect(p.lines[p.lines.indexOf(s) - 1]).toBe('');
    // (every line a key and a value: a number, a name, or numbers in brackets; a comment after some)
    for (const line of p.lines.slice(1))
      if (line && !line.startsWith('['))
        expect(line).toMatch(
          /^[A-Za-z_0-9]+=(\((-?\d+(\.\d+)?(e[+-]?\d+)?, ?)*-?\d+(\.\d+)?\)|-?\d+(\.\d+)?|[A-Z_]+)( +\/\/.*)?$/,
        );
    expect(p.body['[Features]']?.map(([k]) => k)).toEqual([
      'pitlanes',
      'startinggrid',
      'pitspots',
      'garagespots',
      'auxspots',
      'acceptabledriverlinenoise',
      'StartingStretch',
      'definepath',
      'pathtime',
      'definepath',
      'pathtime',
      'definepath',
      'pathtime',
    ]);
    expect(p.body['[Features]']?.filter(([k]) => k === 'definepath').map(([, v]) => v)).toEqual([
      'FASTEST',
      'LEFT',
      'RIGHT',
    ]);
    expect(p.body['[GRID]']?.map(([k]) => k)).toEqual(['GridIndex', 'Pos', 'Ori', 'GridIndex', 'Pos', 'Ori']);
    expect(p.body['[ALTGRID]']).toEqual([]);
    // (each team all three of its garage spots, as the samples have them: numbered 0 to 2)
    const team = ['TeamIndex', 'PitPos', 'PitOri', ...['GarPos', 'GarOri', 'GarPos', 'GarOri', 'GarPos', 'GarOri']];
    expect(p.body['[PITS]']?.map(([k]) => k)).toEqual([...team, ...team]);
    expect(
      p.body['[PITS]']?.filter(([k]) => k === 'GarPos').map(([, v]) => (v as string).replace(/^\(?(\d+),.*/, '$1')),
    ).toEqual(['0', '1', '2', '0', '1', '2']);
    expect(p.body['[AUX]']?.map(([k]) => k)).toEqual(['LocationIndex', 'Pos', 'Ori', 'LocationIndex', 'Pos', 'Ori']);
    expect(p.header.map(([k]) => k)).toEqual([
      'trackstate',
      'drivinglines',
      'autogengridf',
      'autogenaltgridf',
      'teleportwp',
      'pitlanepaths',
      'number_waypoints',
      'lap_length',
      'sector_1_length',
      'sector_2_length',
      'LeftHandedPits',
      'FuelUse',
      'AIBrakingStiffness',
      'slowwhenpushed',
      'DelayPitCrewLoad',
      'LaneSpacing',
      'ultracarefulyellow',
      'SafetyCarReleaseDist',
      'WorstAdjust',
      'MidAdjust',
      'BestAdjust',
      'AIRange',
      'AISpec',
      'AIDraftStickiness',
    ]);
    for (const wp of p.wps) expect(keysOf(wp)).toEqual(WP_KEYS);
    // (the first waypoint's lines say what they are, as the samples' do; the others not)
    expect(p.lines).toContain('wp_bitfields=(0) // 1 = nonpath waypoint.  ');
    expect(p.lines.filter((l) => l.startsWith('WP_PTRS=') && l.includes('//'))).toHaveLength(1);
  });

  it('puts the grid and the pit boxes on the floor, turned their way, in rFactor’s axes', () => {
    const grid = p.body['[GRID]'] as [string, string][];
    // (the track's z turned round; the floor's height; heading +z is rFactor's -z: yaw 0; the floor rising to the
    // car's left, +x: rolled right, by its slope)
    expect(nums((grid[1] as [string, string])[1])).toEqual([31, floor(31), 8].map((v) => Number(v.toFixed(3))));
    const ori = nums((grid[2] as [string, string])[1]);
    expect(ori[0]).toBeCloseTo(0, 3);
    expect(ori[1]).toBeCloseTo(0, 3);
    expect(ori[2]).toBeCloseTo(Math.atan(0.05), 3);
    expect(p.body['[TELEPORT]']).toEqual(grid);
    const pits = p.body['[PITS]'] as [string, string][];
    expect(nums((pits[1] as [string, string])[1])).toEqual([18.5, floor(18.5), 6].map((v) => Number(v.toFixed(3))));
    expect(nums((pits[3] as [string, string])[1])).toEqual([0, ...nums((pits[1] as [string, string])[1])]);
    // (the boxes to the pit lane's right: not left-handed)
    expect(headerValue(p, 'LeftHandedPits')).toEqual([0]);
    // (a main waypoint down the first straight, past the pit lane: the road 6 m to its left, 4 to its right; its
    // perp to its right (-x), down the floor's slope; its normal leaning that way)
    const w = p.wps[main.findIndex((m) => Math.abs((m.pos[2] as number) + 85) < 3 && (m.pos[0] as number) > 0)];
    expect(w).toBeDefined();
    const width = value(w as [string, string][], 'wp_width');
    expect(width[0]).toBeCloseTo(6, 0);
    expect(width[1]).toBeCloseTo(4, 0);
    const perp = value(w as [string, string][], 'wp_perp');
    expect(perp[0]).toBeLessThan(-0.99);
    expect(perp[1]).toBeLessThan(0);
    expect(value(w as [string, string][], 'wp_normal')[0]).toBeLessThan(0);
    expect(value(w as [string, string][], 'wp_pos')[1]).toBeCloseTo(floor(30) + 0.1, 2);
  });

  it('makes one closed main loop, the pit lane branching off it and back, the spots linked', () => {
    const M = main.length;
    expect(W.slice(0, M).every((w) => w.branch === 0 && !w.nonpath)).toBe(true);
    // (round the loop from the first by next, and back by prev)
    let i = 0;
    const seen = new Set<number>();
    do {
      seen.add(i);
      const next = (W[i] as (typeof W)[number]).ptrs[1];
      expect((W[next] as (typeof W)[number]).ptrs[0]).toBe(i);
      i = next;
    } while (i !== 0 && seen.size <= M);
    expect(seen.size).toBe(M);
    // (every waypoint's last pointer its own branch)
    for (const w of W) expect(w.ptrs[3]).toBe(w.branch);
    // (the pit lane: forking off the one main waypoint pointing at its first, back into the main loop at its last)
    const pit = W.map((w, k) => ({ ...w, k })).filter((w) => w.branch === 1);
    expect(pit.length).toBeGreaterThan(20);
    const first = pit[0] as (typeof pit)[number];
    const last = pit.at(-1) as (typeof pit)[number];
    const forks = main.map((w, k) => ({ ...w, k })).filter((w) => w.ptrs[2] === first.k);
    expect(forks).toHaveLength(1);
    const fork = forks[0] as (typeof forks)[number];
    expect(first.ptrs[0]).toBe(fork.k);
    pit.slice(1).forEach((w, j) => {
      expect(w.ptrs[0]).toBe((pit[j] as (typeof pit)[number]).k);
      expect((pit[j] as (typeof pit)[number]).ptrs[1]).toBe(w.k);
    });
    const merge = W[last.ptrs[1]] as (typeof W)[number];
    expect(merge.branch).toBe(0);
    // (the fork 60 m before the start, z -60 (rFactor's 60); the merge 60 m after; each near the pit lane's end)
    expect(fork.pos[2]).toBeGreaterThan(60);
    expect(fork.pos[2]).toBeLessThan(66);
    expect(merge.pos[2]).toBeLessThan(-60);
    expect(merge.pos[2]).toBeGreaterThan(-66);
    expect(Math.hypot(first.pos[0] - fork.pos[0], first.pos[2] - fork.pos[2])).toBeLessThan(10);
    // (nothing of the main loop points back at the pit lane's last)
    expect(main.some((w) => w.ptrs[2] === last.k)).toBe(false);
    // (its scores on from the fork's, round past the lap's end, to the merge's)
    const on = pit.map((w) => ((w.score[1] as number) - (fork.score[1] as number) + lap) % lap);
    for (let j = 1; j < on.length; j++) expect(on[j]).toBeGreaterThan(on[j - 1] as number);
    expect(on.at(-1)).toBeLessThan(((merge.score[1] as number) - (fork.score[1] as number) + lap) % lap);

    // (each grid slot and box: its spot, a dead end its lead-in goes on to, the lead-in a lane's waypoint's branch)
    const spot = (branch: number) => W.map((w, k) => ({ ...w, k })).filter((w) => w.branch === branch);
    for (const [g, lane, lead] of [
      [2, 0, GRID_LEAD],
      [3, 0, GRID_LEAD],
      [2 + STARTING_GRID, 1, PIT_LEAD],
      [3 + STARTING_GRID, 1, PIT_LEAD],
    ] as const) {
      const two = spot(g);
      expect(two).toHaveLength(2);
      const [S, B] = two as [(typeof two)[number], (typeof two)[number]];
      expect(S.nonpath && B.nonpath).toBe(true);
      expect(S.ptrs[1]).toBe(S.k);
      expect(S.ptrs[0]).toBe(B.k);
      expect(B.ptrs[1]).toBe(S.k);
      const from = W[B.ptrs[0]] as (typeof W)[number];
      expect(from.branch).toBe(lane);
      expect(from.ptrs[2]).toBe(B.k);
      // (the lead-in behind its spot, the lane's waypoint further behind)
      expect(Math.hypot(S.pos[0] - B.pos[0], S.pos[2] - B.pos[2])).toBeCloseTo(lead, 2);
      expect(B.pos[2]).toBeGreaterThan(S.pos[2]);
      expect(from.pos[2]).toBeGreaterThan(B.pos[2] + 5);
      // (a box's way out: the pit lane's next waypoint on; a slot's none)
      if (lane === 1) {
        const out = W[S.ptrs[2]] as (typeof W)[number];
        expect(out.branch).toBe(1);
        expect(out.pos[2]).toBeLessThan(S.pos[2]);
      } else expect(S.ptrs[2]).toBe(-1);
    }
    // (every link from a lane one waypoint's only)
    const links = W.map((w) => w.ptrs[2]).filter((l, k) => l >= 0 && (W[k] as (typeof W)[number]).branch < 2);
    expect(new Set(links).size).toBe(links.length);
  });

  it('agrees on its distances, sectors and number of waypoints', () => {
    expect(headerValue(p, 'number_waypoints')).toEqual([W.length]);
    const M = main.length;
    // (two straights and two half circles, the floor's lean adding a little; waypoints about 5 m apart)
    expect(lap).toBeGreaterThan(588);
    expect(lap).toBeLessThan(592);
    expect(lap / M).toBeCloseTo(5, 0);
    // (each score the chords' length from the start; the lap the loop's)
    let s = 0;
    for (let i = 0; i < M; i++) {
      const w = W[i] as (typeof W)[number];
      const next = W[(i + 1) % M] as (typeof W)[number];
      expect(w.score[1]).toBeCloseTo(s, 2);
      const chord = Math.hypot(...[0, 1, 2].map((c) => (next.pos[c] as number) - (w.pos[c] as number)));
      expect(chord).toBeGreaterThan(4);
      expect(chord).toBeLessThan(6);
      s += chord;
    }
    expect(lap).toBeCloseTo(s, 1);
    // (the lap from the start line, x 26 to 36 at z 0; sector 2 from the gate across the far bend, at its top; sector
    // 3 from the gate across the other straight)
    expect(W[0]?.score).toEqual([0, 0]);
    expect(W[0]?.pos[0]).toBeCloseTo(30, 1);
    expect(W[0]?.pos[2]).toBeCloseTo(0, 1);
    const s1 = headerValue(p, 'sector_1_length')[0] as number;
    const s2 = headerValue(p, 'sector_2_length')[0] as number;
    const at1 = main.find((w) => w.score[0] === 1) as (typeof W)[number];
    const at2 = main.find((w) => w.score[0] === 2) as (typeof W)[number];
    expect(at1.score[1]).toBeCloseTo(s1, 3);
    expect(at2.score[1]).toBeCloseTo(s2, 3);
    expect(at1.pos[0]).toBeCloseTo(0, 1);
    expect(at1.pos[2]).toBeCloseTo(-130, 0);
    expect(at2.pos[0]).toBeCloseTo(-30, 1);
    expect(at2.pos[2]).toBeCloseTo(0, 1);
    expect(s1).toBeCloseTo(100 + 15 * Math.PI, -1);
    expect(s2).toBeCloseTo(200 + 30 * Math.PI, -1);
    // (the sectors in order round the loop; every waypoint's sector the one its score is in)
    for (let i = 1; i < M; i++) expect(W[i]?.score[0]).toBeGreaterThanOrEqual(W[i - 1]?.score[0] as number);
    for (const w of W) {
      // (a score to the millimetre, the sectors' lengths finer: a sector's first waypoint may read a little short)
      const d = w.score[1] as number;
      const e = d + 0.0005;
      expect(w.score[0]).toBe(e < s1 ? 0 : e < s2 ? 1 : 2);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(lap);
    }
    // (the timing beams: the AIW's lap, the gates' posts on the floor in rFactor's axes, the pit lane's two)
    const t = aiwTiming(input());
    expect(t.lap).toBeCloseTo(lap, 5);
    expect(t.sector1).toBeCloseTo(s1, 5);
    expect(t.sector2).toBeCloseTo(s2, 5);
    expect(t.beams.map((b) => b.name)).toEqual(['xfinish', 'xsector1', 'xsector2', 'xpitin', 'xpitout']);
    const finish = t.beams[0];
    expect(finish?.gate).toBe('AC_TIME_0');
    expect(finish?.left.map((v) => Number(v.toFixed(3)))).toEqual([36, floor(36), -0].map((v) => Number(v.toFixed(3))));
    expect(t.beams[1]?.score).toBeCloseTo(s1, 5);
    // (xpitin before the first box (z -6, rFactor's 6), xpitout after the last)
    const [pin, pout] = [t.beams[3], t.beams[4]];
    expect(((pin?.left[2] as number) + (pin?.right[2] as number)) / 2).toBeGreaterThan(6);
    expect(((pout?.left[2] as number) + (pout?.right[2] as number)) / 2).toBeLessThan(-6);
  });
});

// ---------------------------------------------------------------- as Studio 397's

describe.skipIf(!existsSync(JOESVILLE))("Joesville Speedway's AIW", () => {
  const sample = parse(readFileSync(JOESVILLE, 'latin1'));
  const ours = parse(aiwText(input()));

  it('has the sections, fields and links ours has, in the same order', () => {
    expect(ours.sections).toEqual(sample.sections);
    expect(ours.body['[Features]']?.map(([k]) => k)).toEqual(sample.body['[Features]']?.map(([k]) => k));
    expect(ours.header.map(([k]) => k)).toEqual(sample.header.map(([k]) => k));
    for (const wp of sample.wps) expect(keysOf(wp)).toEqual(WP_KEYS);
    const keys = (s: string, p: Parsed) => [...new Set(p.body[s]?.map(([k]) => k))];
    for (const s of ['[GRID]', '[TELEPORT]', '[PITS]', '[AUX]']) expect(keys(s, ours)).toEqual(keys(s, sample));
    // (its first lines as ours: the editor's, then the features)
    expect(sample.lines[0]).toMatch(/^\/\/\[\[gMa1\.002f \(c\)\d{4} {4}\]\] \[\[ {12}\]\]$/);
    expect(sample.lines.filter((l) => l.includes('//')).length).toBe(ours.lines.filter((l) => l.includes('//')).length);
    // (its waypoints linked as ours: the last pointer its own branch; the main loop's scores its chords' length)
    const S = sample.wps.map((wp) => ({
      pos: value(wp, 'wp_pos'),
      branch: value(wp, 'wp_branchID')[0],
      ptrs: value(wp, 'WP_PTRS'),
      score: value(wp, 'wp_score')[1] as number,
    }));
    for (const w of S) expect(w.ptrs[3]).toBe(w.branch);
    expect(headerValue(sample, 'number_waypoints')).toEqual([S.length]);
    const main = S.filter((w) => w.branch === 0);
    let lap = 0;
    main.forEach((w, i) => {
      const next = S[w.ptrs[1] as number] as (typeof S)[number];
      expect(next.ptrs[0]).toBe(i);
      lap += Math.hypot(...[0, 1, 2].map((c) => (next.pos[c] as number) - (w.pos[c] as number)));
    });
    expect(lap).toBeCloseTo(headerValue(sample, 'lap_length')[0] as number, 1);
  });

  it('turns its waypoints as ours: perp the normal × the way, Ori (pitch, yaw, roll)', () => {
    let checked = 0;
    for (const wp of sample.wps) {
      if (value(wp, 'wp_branchID')[0] !== 0) continue;
      const pos = value(wp, 'wp_pos') as V3;
      const next = value(sample.wps[value(wp, 'WP_PTRS')[1] as number] as [string, string][], 'wp_pos') as V3;
      const way: V3 = [next[0] - pos[0], next[1] - pos[1], next[2] - pos[2]];
      const o = orientation(way, value(wp, 'wp_normal') as V3);
      const perp = value(wp, 'wp_perp') as V3;
      expect(o.perp[0] * perp[0] + o.perp[1] * perp[1] + o.perp[2] * perp[2]).toBeGreaterThan(0.99);
      // (its LEFT path's orientation, as its grid's Ori: the banking's roll, -0.18)
      const left = (wp.filter(([k]) => k === 'wp_oriantation')[1] as [string, string])[1];
      const [, pitch, yaw, roll] = nums(left) as [number, number, number, number];
      const turn = Math.abs(((o.ori[1] - yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(turn).toBeLessThan(0.15);
      expect(Math.abs(o.ori[0] - pitch)).toBeLessThan(0.03);
      expect(Math.abs(o.ori[2] - roll)).toBeLessThan(0.03);
      checked++;
    }
    expect(checked).toBe(124);
  });
});
