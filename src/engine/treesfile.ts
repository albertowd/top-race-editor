// The track's trees (TRACK_FORMAT's step 7: the track file's `trees`), as the engine reads and writes them: each a
// placement of a tree of the catalogue (its kind "tree"), {model, x, z, heading, scale}, its height the floor's (the
// build's); checked and rounded as the objects are, written into the track file.
import { f, ObjectsError, remainderTau } from './objectsfile';
import type { HostFiles } from './placehost';
import { type PyJson, PyNumber } from './pyjson';
import { readPart, writePart } from './trackdoc';
import { pyRound, type TrackSettings } from './trackfiles';

/** decimals kept: millimetres; a heading's and a scale's */
const ROUND = 3;
const ROUND_HEADING = 4;
const ROUND_SCALE = 4;

/** A tree where it stands: its model (of the catalogue), x, z, heading (radians, as the objects'), scale. */
export interface TreePlacement {
  model: string;
  x: number;
  z: number;
  heading: number;
  scale: number;
}

type J = { [k: string]: unknown };
const num = (v: unknown): number | null =>
  v instanceof PyNumber ? v.value : typeof v === 'number' && Number.isFinite(v) ? v : null;

function _num(v: unknown, where: string): number {
  const n = num(v);
  if (n === null) throw new ObjectsError(`${where}: not a number`);
  return n;
}

/** The trees checked and rounded, as they are written (trees.py's clean). */
export function cleanTrees(given: unknown): J[] {
  if (given === null || given === undefined) return [];
  if (!Array.isArray(given)) throw new ObjectsError('trees: a list, please');
  return given.map((t, i) => {
    const w = `trees[${i}]`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new ObjectsError(`${w}: not an object`);
    const o = t as J;
    if (typeof o.model !== 'string' || !o.model) throw new ObjectsError(`${w}.model: its model's name, please`);
    const scale = o.scale === undefined || o.scale === null ? 1 : _num(o.scale, `${w}.scale`);
    if (!(scale > 0)) throw new ObjectsError(`${w}.scale: more than 0, please`);
    return {
      model: o.model,
      x: f(pyRound(_num(o.x, `${w}.x`), ROUND)),
      z: f(pyRound(_num(o.z, `${w}.z`), ROUND)),
      heading: f(pyRound(remainderTau(_num(o.heading ?? 0, `${w}.heading`)), ROUND_HEADING)),
      scale: f(pyRound(scale, ROUND_SCALE)),
    };
  });
}

/** The track's trees as written (none where it has none). */
export async function loadTrees(files: HostFiles, s: TrackSettings): Promise<PyJson[]> {
  const v = await readPart(files, s, 'trees');
  return Array.isArray(v) ? v : [];
}

/** The page's trees written into the track file (checked, rounded; the file before kept): what was written. */
export async function saveTrees(files: HostFiles, s: TrackSettings, backups: string, given: unknown, now?: Date) {
  const out = cleanTrees(given);
  await writePart(files, s, 'trees', out as PyJson, backups, now);
  return out;
}
