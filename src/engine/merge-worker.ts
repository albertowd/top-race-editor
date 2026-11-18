// The merge's jobs on a worker: faces filled, each worker with its own Triangle (its memory is its own and fixed), the
// Triangle's code read once, the way the worker's host reads files.
import { geosReady } from './geos';
import { type Filled, type FillJob, fill, type Outline, outlineOf } from './merge';
import type { Part, Pool } from './pool';
import { Triangle } from './triangle';

/** The jobs a worker serves, Triangle's code got by read the first time one needs it. */
export function mergeJobs(read: () => Promise<Uint8Array>) {
  let tri: Promise<Triangle> | null = null;
  return {
    'merge.fill': async (jobs: FillJob[]): Promise<{ filled: Filled[] }> => {
      tri ??= read().then((b) => Triangle.load(b));
      const t = await tri;
      return { filled: jobs.map((j) => fill(j, t)) };
    },
    /** roads' outlines (their triangles on the grid, six numbers each) */
    'merge.outline': async (Ts: Float64Array[]): Promise<{ outlines: Outline[] }> => {
      // (GEOS, for a folded one's union: loaded once)
      await geosReady();
      return { outlines: Ts.map((T) => outlineOf(T, T.length / 6)) };
    },
  };
}

/** Outlines made on a pool's workers: a road a part (the big ones take the longest: given out first). */
export function poolOutliner(pool: Pool) {
  return async (Ts: (Float64Array | Int32Array)[]): Promise<Outline[]> => {
    const order = Ts.map((_, i) => i).sort((a, b) => (Ts[b] as Float64Array).length - (Ts[a] as Float64Array).length);
    const outs = await Promise.all(
      order.map((i) =>
        pool.run<{ outlines: Outline[] }>({
          job: 'merge.outline',
          input: [Float64Array.from(Ts[i] as Float64Array)],
          bytes: 64 * 2 ** 20 + (Ts[i] as Float64Array).length * 8 * 40,
          label: 'an outline',
        }),
      ),
    );
    const out: Outline[] = new Array(Ts.length);
    order.forEach((i, k) => {
      out[i] = (outs[k] as { outlines: Outline[] }).outlines[0] as Outline;
    });
    return out;
  };
}

/** bytes a face's filling may take, beyond Triangle's own memory: generous, from its size */
const bytesOf = (j: FillJob) => (j.outer.length + j.holes.reduce((a, h) => a + h.length, 0) + j.T.length) * 8 * 40;

/** Faces filled on a pool's workers, several faces a part (about `per` bytes of them), the parts at once. */
export function poolFiller(pool: Pool, per = 4 * 2 ** 20) {
  return async (jobs: FillJob[]): Promise<Filled[]> => {
    const parts: { part: Part<FillJob[]>; at: number[] }[] = [];
    let cur: { part: Part<FillJob[]>; at: number[] } | null = null;
    jobs.forEach((j, i) => {
      const b = bytesOf(j);
      if (!cur || cur.part.bytes + b > per) {
        cur = { part: { job: 'merge.fill', input: [], bytes: 32 * 2 ** 20, label: 'faces filled' }, at: [] };
        parts.push(cur);
      }
      cur.part.input.push(j);
      cur.part.bytes += b;
      cur.at.push(i);
    });
    const outs = await pool.all<{ filled: Filled[] }>(parts.map((p) => p.part));
    const out: Filled[] = new Array(jobs.length);
    outs.forEach((o, k) => {
      (parts[k] as { at: number[] }).at.forEach((i, m) => {
        out[i] = o.filled[m] as Filled;
      });
    });
    return out;
  };
}
