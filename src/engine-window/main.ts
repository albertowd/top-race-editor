// The engine window (the desktop app's, never shown): the engine's calls answered on each port the editor's windows
// are handed. What it needs of the computer comes from its preload (desktop/engine-preload.cjs: Node's own).

import triangleWasm from 'triangle-wasm/triangle.out.wasm?url';
import { onEnginePort } from '../api/engineport';
import type { SystemHost } from '../engine/build';
import { decodeGrey } from '../engine/decode';
import { answer, type HostEnv } from '../engine/host';
import { poolFiller, poolOutliner } from '../engine/merge-worker';
import type { HostFiles } from '../engine/placehost';
import { Pool, type Reply, type WorkerLike } from '../engine/pool';
import type { WizardHost } from '../engine/providers';
import { Triangle } from '../engine/triangle';
import { mapPreview } from './mappreview';
import { decodeRgb, encodeJpeg, satelliteTiles, scaledPictures } from './satellite';

declare global {
  interface Window {
    /** the engine window's preload's: the computer, and its disk */
    engineEnv?: Omit<HostEnv, 'place' | 'filler' | 'outliner' | 'apiHost'> & {
      files: HostFiles;
      cacheDir: string;
      system: SystemHost;
      fetch: WizardHost['fetch'];
      keysFile: string;
      project?: HostEnv['project'];
    };
  }
}

const given = window.engineEnv;
if (!given) throw new Error('the engine window opened without its preload');

/** A web worker of the merge's jobs, as the pool uses one. */
function mergeWorker(): WorkerLike {
  const w = new Worker(new URL('./merge-worker.ts', import.meta.url), { type: 'module' });
  return {
    send: (msg, transfer) => w.postMessage(msg, transfer ?? []),
    onReply: (fn) => {
      w.onmessage = (e: MessageEvent<Reply>) => fn(e.data);
    },
    onFail: (fn) => {
      w.onerror = (e) => fn(new Error(e.message || 'a worker failed'));
    },
    stop: () => w.terminate(),
  };
}

const pool = new Pool(mergeWorker, { processors: given.processors, freeMemory: given.freeMemory });
// (Triangle on this thread, loaded the first time it is asked for)
let triangleLoaded: Promise<Triangle> | null = null;
const triangleHere = (): Promise<Triangle> => {
  triangleLoaded ??= fetch(triangleWasm)
    .then((r) => r.arrayBuffer())
    .then((b) => Triangle.load(new Uint8Array(b)));
  return triangleLoaded;
};
const env: HostEnv = {
  ...given,
  place: { files: given.files, cacheDir: given.cacheDir, decodeGrey },
  filler: poolFiller(pool),
  outliner: poolOutliner(pool),
  // (the satellite's tiles cut here, the terrain's picture made smaller; the tracks opened before kept beside the
  // engine's cache, with the wizard's keys)
  apiHost: {
    tile: satelliteTiles(given.files),
    picture: scaledPictures(given.files),
    recent: `${given.cacheDir.replace(/\/cache$/, '')}/recent.json`,
    // (the builds: the track's own tools run, 7-Zip, the game's folder)
    system: given.system,
    // (a triangulator here too: the far ground's)
    triangle: triangleHere,
    // (the new-track wizard: the providers asked from Node, their pictures decoded and made JPEG by Chromium)
    wizard: { host: { fetch: given.fetch, decodeRgb, encodeJpeg }, keys: given.keysFile },
    // (the BeamNG level: its pictures read and made, its starts' maps drawn, by Chromium)
    beamng: { decodeRgb, encodeJpeg, mapPreview },
  },
};
onEnginePort((port) => answer(port, env));
