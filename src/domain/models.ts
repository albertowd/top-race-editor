// The models the editor places (models/catalogue.json, each model's .glb beside it): what each is, and its pictures
// (public/models, made by scripts/model-pictures.mjs: its icon, and the map's picture of it from above, at scale).

import catalogue from '../../models/catalogue.json';
import type { ObjectKind } from './types';

export interface ModelInfo {
  id: string;
  /** the kind it is placed as */
  kind: string;
  label: string;
  description?: string;
  /** its file in models/ */
  file: string;
  /** metres: across (x), high (y), deep (z); its front looks along +z */
  size: number[];
  triangles: number;
  /** where it was made from */
  source: string;
  /** metres across its picture from above (the origin in its middle) */
  top?: number;
  /** a tree the track has placed that the catalogue has not (no pictures of it) */
  track?: boolean;
}

export const MODELS: readonly ModelInfo[] = catalogue.models;

/** the trees the track has placed of models the catalogue has not, learned as the track is read */
const TRACK_MODELS = new Map<string, ModelInfo>();

/** The trees the track has placed of models the catalogue has not, learned (their names, from what it has placed):
 * placed as trees, after the catalogue's. */
export function learnTrackTrees(models: readonly string[]): void {
  for (const id of models) {
    if (TRACK_MODELS.has(id) || MODELS.some((e) => e.id === id)) continue;
    TRACK_MODELS.set(id, {
      id,
      kind: 'trees',
      label: id,
      file: '',
      size: [2, 10, 2],
      triangles: 0,
      source: 'the track’s trees',
      track: true,
    });
  }
}

const BASE = import.meta.env.BASE_URL;

/** The models of a kind, in the catalogue's order (then the track's trees it has not). */
export const modelsOf = (kind: ObjectKind): readonly ModelInfo[] => [
  ...MODELS.filter((m) => m.kind === kind),
  ...[...TRACK_MODELS.values()].filter((m) => m.kind === kind),
];

export const modelInfo = (id: string): ModelInfo | undefined => MODELS.find((m) => m.id === id) ?? TRACK_MODELS.get(id);

/** A model's icon: seen from its front-left and above (one the catalogue has not: its kind's). */
export const modelIcon = (id: string): string => {
  const t = TRACK_MODELS.get(id);
  return t ? kindIcon(t.kind as ObjectKind) : `${BASE}models/${id}.png`;
};

/** A model seen from straight above, as the map shows it (its top the way its front looks). */
export const modelTop = (id: string): string => `${BASE}models/${id}.top.png`;

/** The kinds whose icon is one of their models' (a static object: the chair's). */
const KIND_MODEL_ICONS: Partial<Record<ObjectKind, string>> = { statics: 'chair' };

/** A kind's icon (a grid slot: a kart on its box...). */
export const kindIcon = (kind: ObjectKind): string => {
  const model = KIND_MODEL_ICONS[kind];
  return model ? `${BASE}models/${model}.png` : `${BASE}models/kind-${kind}.webp`;
};

/** A light of a model (the track's catalogue's): where its lamp is and the way it faces, in the model's own frame
 * (right, up, forward: forward along its heading, metres over the floor). */
export interface ModelLight {
  series: string;
  at: [number, number, number];
  /** none: all round (a building's lamp) */
  facing?: [number, number, number];
}

/** A model as the track's build makes it (the editor's catalogue, models/catalogue.json, as the engine gives it):
 * what it is, the fits and collisions it allows, its lights. */
export interface TrackModel {
  /** what it is (a tree: "tree") */
  kind?: string;
  label?: string;
  description?: string;
  size?: number[];
  fits?: string[];
  collision?: string[];
  lights?: ModelLight[];
  /** its outline from above, in its own frame (x across, z forward): rings x z x z ... (a building's) */
  outline?: number[][];
}

/** The track's catalogue, by model id (empty where the track has none). */
export type TrackCatalogue = Record<string, TrackModel>;
