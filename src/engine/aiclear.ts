// A line's points kept clear of its road's edges, as aimake.ts makes AC's AI lines: AC's AI drives its line with its
// car's middle on it, and knows nothing of how wide the car is, so a line drawn within half a kart of an edge puts
// the kart's wheels over it (on a kerb, on a pit wall's nose). Each point is moved across the line as drawn so its
// road reaches CLEAR metres either side of it (to the middle of a road narrower than that), never more than MOST from
// where it was drawn. A move is held SPREAD metres either way along the line and eased off over as far again, so the
// line bends off an edge smoothly and a whole bend moves with its apex (moved alone, the apex would make the bend
// tighter); and where the line turns tighter than KINK (a pit line's turn drawn as a corner) it is smoothed: ROUNDS
// times, the last a move alone. Elsewhere it stays as drawn.

type V2 = [number, number];

/** metres a car is wide, where the track does not say (objects.json's ai.width): a kart's */
export const AI_WIDTH = 1.4;
/** metres of road beyond half a car's width its middle keeps from an edge */
export const CLEAR_MORE = 0.3;
/** metres of road either side of a car's middle, at least: half a kart (0.7) and CLEAR_MORE */
export const CLEAR = AI_WIDTH / 2 + CLEAR_MORE;
/** metres a point is moved at most from where it was drawn */
export const MOST = 3;
/** metres along the line either way a move is held for, before it eases off over as far again */
export const SPREAD = 8;
/** rounds of moving and smoothing; how much of the way to its neighbours' middle a point is smoothed each round */
export const ROUNDS = 12;
const SMOOTH = 0.5;
/** metres: a line turning tighter than this (over a metre either side) is smoothed, and how many points either side
 * with it */
export const KINK = 6;
const AROUND = 6;
/** metres between the road's samples across the line; how far across it a line off its road looks for it */
const LOOK = 0.1;
const REACH = 12;

/** The road across a point (its way t), as metres to its left (+) and right (-), each looked for no further than upTo:
 * the stretch of road under it, else the nearest within REACH (null: none). */
function across(p: V2, t: V2, clear: (x: number, z: number) => boolean, upTo: number): [number, number] | null {
  const lx = -t[1];
  const lz = t[0];
  const on = (d: number) => clear(p[0] + lx * d, p[1] + lz * d);
  // (from the road's stretch round d0, out to either end)
  const ends = (d0: number): [number, number] => {
    let a = d0;
    while (a - LOOK >= d0 - upTo && on(a - LOOK)) a -= LOOK;
    let b = d0;
    while (b + LOOK <= d0 + upTo && on(b + LOOK)) b += LOOK;
    return [a - LOOK / 2, b + LOOK / 2];
  };
  if (on(0)) return ends(0);
  for (let d = LOOK; d <= REACH; d += LOOK) {
    if (on(d)) return ends(d);
    if (on(-d)) return ends(-d);
  }
  return null;
}

/**
 * The points P (every step metres along a line; closed: round to the first again) kept CLEAR of the edges of the road
 * clear says is there. pinned: how many points at either end stay where they are (a pit lane's run on the fast line);
 * side: metres of road either side of the line counted at most (a pit lane's own road, not the track beside it).
 */
export function keepClear(
  P: V2[],
  closed: boolean,
  clear: (x: number, z: number) => boolean,
  opts: { pinned?: [number, number]; side?: number; margin?: number; step?: number } = {},
): V2[] {
  const n = P.length;
  if (n < 5) return P;
  const margin = opts.margin ?? CLEAR;
  const side = opts.side ?? Infinity;
  const step = opts.step ?? 0.5;
  const spread = Math.max(1, Math.round(SPREAD / step));
  const ease = Math.max(1, Math.ceil(spread / 2));
  const [pinA, pinB] = opts.pinned ?? [0, 0];
  const fixed = (i: number) => !closed && (i < Math.max(pinA, 1) || i >= n - Math.max(pinB, 1));
  const idx = (i: number) => (closed ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1));
  // (each point moved along its left as drawn, N, by o metres)
  const N: V2[] = P.map((_, i) => {
    const a = P[idx(i - 4)] as V2;
    const b = P[idx(i + 4)] as V2;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
  });
  const o = new Float64Array(n);
  const at = (i: number): V2 => {
    const j = idx(i);
    const p = P[j] as V2;
    const l = N[j] as V2;
    return [p[0] + l[0] * (o[j] as number), p[1] + l[1] * (o[j] as number)];
  };
  // (how far a point wants moving to its left (+) or right (-): none for less than half a sample of the road)
  const wanted = (i: number): number => {
    const q = at(i);
    const l = N[i] as V2;
    const t: V2 = [l[1], -l[0]];
    const near = across(q, t, clear, margin + LOOK);
    if (!near) return 0;
    if (near[0] < -margin && near[1] > margin) return 0;
    const road = across(q, t, clear, 2 * margin + MOST + LOOK);
    if (!road) return 0;
    // (from where it was drawn: its own road no further than side either way)
    const off = o[i] as number;
    const lo = Math.max(road[0], -side - off);
    const hi = Math.min(road[1], side - off);
    if (hi < lo) return 0;
    let w = hi - lo < 2 * margin ? (lo + hi) / 2 : Math.min(Math.max(0, lo + margin), hi - margin);
    w = Math.min(Math.max(w, -MOST - off), MOST - off);
    return Math.abs(w) < LOOK / 2 ? 0 : w;
  };
  // (over a window of half points either side: its most, or its mean; the line's ends as far as it goes)
  const pass = (v: Float64Array, half: number, most: boolean): Float64Array => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      let sum = 0;
      let k = 0;
      for (let d = -half; d <= half; d++) {
        const j = closed ? idx(i + d) : i + d;
        if (j < 0 || j >= n) continue;
        m = Math.max(m, v[j] as number);
        sum += v[j] as number;
        k++;
      }
      out[i] = most ? m : sum / (k || 1);
    }
    return out;
  };
  // (each way's moves: the most within spread either side, then averaged twice over ease either side, so a point
  // moves at least as far as it wants and the line eases into and out of the move)
  const spreadOut = (w: Float64Array): Float64Array => {
    const out = new Float64Array(n);
    for (const sign of [1, -1]) {
      const held = pass(
        w.map((x) => Math.max(0, sign * x)),
        spread,
        true,
      );
      const v = pass(pass(held, ease, false), ease, false);
      for (let i = 0; i < n; i++) out[i] = (out[i] as number) + sign * (v[i] as number);
    }
    return out;
  };
  const move = () => {
    const w = new Float64Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (fixed(i)) continue;
      w[i] = wanted(i);
      if (w[i]) any = true;
    }
    if (!any) return;
    const s = spreadOut(w);
    for (let i = 0; i < n; i++) if (!fixed(i)) o[i] = (o[i] as number) + (s[i] as number);
  };
  // (where it turns tighter than KINK, and AROUND points either side: each point a little towards its neighbours'
  // middle, across the line)
  const smooth = () => {
    const Q = Array.from({ length: n }, (_, i) => at(i));
    const q = (i: number) => Q[idx(i)] as V2;
    const want = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const a = q(i - 2);
      const p = q(i);
      const b = q(i + 2);
      const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
      if (Math.abs(cross) < 1e-9) continue;
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const r =
        (ab * Math.hypot(p[0] - a[0], p[1] - a[1]) * Math.hypot(b[0] - p[0], b[1] - p[1])) / (2 * Math.abs(cross));
      if (r >= KINK) continue;
      for (let d = -AROUND; d <= AROUND; d++) {
        const j = closed ? idx(i + d) : i + d;
        if (j >= 0 && j < n) want[j] = 1;
      }
    }
    for (let i = 0; i < n; i++) {
      if (fixed(i) || !want[i]) continue;
      const a = q(i - 1);
      const b = q(i + 1);
      const p = q(i);
      const l = N[i] as V2;
      o[i] = (o[i] as number) + SMOOTH * (((a[0] + b[0]) / 2 - p[0]) * l[0] + ((a[1] + b[1]) / 2 - p[1]) * l[1]);
    }
  };
  for (let r = 0; r < ROUNDS; r++) {
    move();
    if (r < ROUNDS - 1) smooth();
  }
  return Array.from({ length: n }, (_, i) => at(i));
}

/** Each of a pit lane's points P moved as the fast line's nearest point was (from F0 to F1, the fast line before and
 * after keepClear), all the way where it runs on it (within near) and less the further off it is, none from blend
 * metres off: so it leaves and joins the fast line as that runs now. */
export function followFast(P: V2[], F0: V2[], F1: V2[], near = 0.5, blend = 8): V2[] {
  return P.map((p) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < F0.length; i++) {
      const d = Math.hypot((F0[i] as V2)[0] - p[0], (F0[i] as V2)[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const k = bd <= near ? 1 : Math.max(0, 1 - (bd - near) / (blend - near));
    const a = F0[best] as V2;
    const b = F1[best] as V2;
    return [p[0] + (b[0] - a[0]) * k, p[1] + (b[1] - a[1]) * k];
  });
}
