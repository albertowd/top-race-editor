// A Node worker thread serving the merge's jobs (merge-worker.ts), for the tests and timing by hand: the TypeScript
// loaded by jiti (a dev dependency). The engine window has its own, built by Vite.
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { mergeJobs } = await jiti.import('./merge-worker.ts');
const { serve } = await jiti.import('./pool.ts');
serve(
  mergeJobs(async () => new Uint8Array(readFileSync(workerData.wasm))),
  {
    onMessage: (fn) => parentPort.on('message', fn),
    post: (r, transfer) => parentPort.postMessage(r, transfer),
  },
);
