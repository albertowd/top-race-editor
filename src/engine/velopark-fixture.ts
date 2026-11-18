// For the tests and for timing the engine by hand, not part of the engine: the editor's folder, where the tests by
// hand write what they made to look at (test-out/), Triangle loaded on Node, and faces filled on Node's workers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Filler, localFiller, type MergeOptions } from './merge';
import { poolFiller, poolOutliner } from './merge-worker';
import { nodeMachine, nodeWorker } from './node-pool';
import { Pool } from './pool';
import { Triangle } from './triangle';

export const EDITOR = fileURLToPath(new URL('../..', import.meta.url));
export const OUT = join(EDITOR, 'test-out');

const WASM = join(EDITOR, 'node_modules/triangle-wasm/triangle.out.wasm');
export const triangle = () => Triangle.load(new Uint8Array(readFileSync(WASM)));

/** Faces filled on Node's worker threads (as many as the computer takes), or here with workers 0. */
export async function nodeFiller(workers?: number): Promise<{
  filler: Filler;
  outliner?: MergeOptions['outliner'];
  close(): void;
  workers: number;
}> {
  if (workers === 0) return { filler: localFiller(await triangle()), close: () => {}, workers: 0 };
  const script = new URL('./merge-worker-node.mjs', import.meta.url);
  const pool = new Pool(() => nodeWorker(script, { workerData: { wasm: WASM } }), nodeMachine, { max: workers });
  return { filler: poolFiller(pool), outliner: poolOutliner(pool), close: () => pool.close(), workers: pool.limit() };
}
