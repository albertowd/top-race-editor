// The editor's categories: each one kind of thing to work on, alone, with its own tools and inspector. The map
// still shows the rest (as it is, faded or not at all), but only the category's own things can be picked.

import { countOf } from '../editing/objects';
import type { Mode, ObjectKind, Road, TrackObjects } from './types';

export type Category =
  | 'all'
  | 'roads'
  | 'rumbles'
  | 'paint'
  | 'race'
  | 'poles'
  | 'tyres'
  | 'props'
  | 'scenery'
  | 'buildings'
  | 'statics'
  | 'terrain';

/** How the things of the other categories are shown while one is worked on. */
export type Others = 'show' | 'dim' | 'hide';

export interface CategoryInfo {
  id: Category;
  label: string;
  /** the sidebar's group */
  group: 'Track' | 'Surface' | 'Objects' | 'Ground';
  /** what it holds, in a line */
  what: string;
  /** the objects it works on */
  kinds: readonly ObjectKind[];
  /** what can be done to the roads: their shape (nodes, widths, joints), only picking one, or nothing */
  roads: 'shape' | 'pick' | 'none';
  lines: boolean;
  kerbs: boolean;
  /** the tools it offers */
  modes: readonly Mode[];
}

const ALL_KINDS: readonly ObjectKind[] = [
  'grid',
  'pits',
  'hotlap',
  'timing',
  'cones',
  'boards',
  'poles',
  'tyres',
  'marks',
  'trees',
  'fences',
  'sheds',
  'statics',
  'gantries',
  'karts',
  'fast',
  'pit',
  'areas',
];

export const CATEGORIES: Record<Category, CategoryInfo> = {
  all: {
    id: 'all',
    label: 'Overview',
    group: 'Track',
    what: 'Everything at once: any road, rumble, line or object can be picked.',
    kinds: ALL_KINDS,
    roads: 'shape',
    lines: true,
    kerbs: true,
    modes: ['select', 'add', 'new', 'measure', 'place'],
  },
  roads: {
    id: 'roads',
    label: 'Roads',
    group: 'Surface',
    what: 'The roads’ shapes: nodes, widths, joints, branches and run-offs; and paved areas of their own shape (car parks, lanes).',
    kinds: ['areas'],
    roads: 'shape',
    lines: false,
    kerbs: false,
    modes: ['select', 'add', 'new', 'measure', 'place'],
  },
  rumbles: {
    id: 'rumbles',
    label: 'Rumbles',
    group: 'Surface',
    what: 'The kerbs along the roads’ edges: where they start and end, their kind and size.',
    kinds: [],
    roads: 'pick',
    lines: false,
    kerbs: true,
    modes: ['select', 'measure'],
  },
  paint: {
    id: 'paint',
    label: 'Paint',
    group: 'Surface',
    what: 'The lines painted along the roads, and the paint marks laid on them.',
    kinds: ['marks'],
    roads: 'pick',
    lines: true,
    kerbs: false,
    modes: ['select', 'measure', 'place'],
  },
  race: {
    id: 'race',
    label: 'Grid, timing & lines',
    group: 'Objects',
    what: 'Each layout’s grid slots, pit boxes, hotlap start, timing gates, start line and racing lines (the fast line, the pit lane); the start gantries.',
    kinds: ['grid', 'pits', 'hotlap', 'timing', 'gantries', 'fast', 'pit'],
    roads: 'none',
    lines: false,
    kerbs: false,
    modes: ['select', 'add', 'measure', 'place'],
  },
  poles: {
    id: 'poles',
    label: 'Light poles',
    group: 'Objects',
    what: 'The light poles of every layout, facing the way their lights look.',
    kinds: ['poles'],
    roads: 'none',
    lines: false,
    kerbs: false,
    modes: ['select', 'measure', 'place'],
  },
  tyres: {
    id: 'tyres',
    label: 'Tyre walls',
    group: 'Objects',
    what: 'Tyre stacks: one, or a wall of them along a curve, in the layouts each lists.',
    kinds: ['tyres'],
    roads: 'none',
    lines: false,
    kerbs: false,
    modes: ['select', 'add', 'measure', 'place'],
  },
  props: {
    id: 'props',
    label: 'Cones & boards',
    group: 'Objects',
    what: 'The loose cones, and the distance and pit boards: each in the layouts it lists.',
    kinds: ['cones', 'boards'],
    roads: 'none',
    lines: false,
    kerbs: false,
    modes: ['select', 'measure', 'place'],
  },
  scenery: {
    id: 'scenery',
    label: 'Scenery',
    group: 'Objects',
    what: 'Trees and fences: models placed as they are, or a fence along a curve.',
    kinds: ['trees', 'fences'],
    roads: 'none',
    lines: false,
    kerbs: false,
    modes: ['select', 'add', 'measure', 'place'],
  },
  buildings: {
    id: 'buildings',
    label: 'Buildings',
    group: 'Objects',
    what: 'Buildings, big and small: sheds, towers, the paddock’s and the farm’s buildings, houses; placed as they are.',
    kinds: ['sheds'],
    roads: 'none',
    lines: false,
    kerbs: false,
    modes: ['select', 'add', 'measure', 'place'],
  },
  statics: {
    id: 'statics',
    label: 'Static objects',
    group: 'Objects',
    what: 'Things standing as they are that are not buildings (shelters, tables, banners, bins, gates) and parked karts.',
    kinds: ['statics', 'karts'],
    roads: 'none',
    lines: false,
    kerbs: false,
    modes: ['select', 'add', 'measure', 'place'],
  },
  terrain: {
    id: 'terrain',
    label: 'Terrain',
    group: 'Ground',
    what: 'The ground the track lies on: its heights, the filters that find it among them, and the edits to it.',
    kinds: [],
    roads: 'none',
    lines: false,
    kerbs: false,
    modes: ['select', 'measure'],
  },
};

/** In the sidebar's order (their place is their key, along the number row: 1 for the Overview, 2 for Roads... 0 for
 * the tenth, then - and =). */
export const CATEGORY_ORDER: readonly Category[] = [
  'all',
  'roads',
  'rumbles',
  'paint',
  'race',
  'poles',
  'tyres',
  'props',
  'scenery',
  'buildings',
  'statics',
  'terrain',
];

/** the number row's keys, in order */
const ROW_KEYS = '1234567890-=';

/** A category's key: its place in the sidebar, along the number row (0 for the tenth, then - and =). */
export const categoryKey = (c: Category): string => ROW_KEYS[CATEGORY_ORDER.indexOf(c)] ?? '';

/** Categories that count no things of their own. */
export const UNCOUNTED: ReadonlySet<Category> = new Set(['all', 'terrain']);

/** The category an object kind is worked on in. */
export function categoryOf(kind: ObjectKind): Category {
  return CATEGORY_ORDER.find((c) => c !== 'all' && CATEGORIES[c].kinds.includes(kind)) ?? 'all';
}

/** How opaque the other categories' things are drawn. */
export const othersAlpha = (others: Others): number => {
  if (others === 'hide') return 0;
  return others === 'dim' ? 0.28 : 1;
};

/** How many things a category has (in the layout shown, for a layout's own). */
export function countIn(c: Category, roads: readonly Road[], o: TrackObjects | null, layout: string): number {
  const lay = o?.layouts[layout];
  const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);
  switch (c) {
    case 'roads':
      return roads.length;
    case 'rumbles':
      return sum(roads.map((r) => r.kerbs?.length ?? 0));
    case 'paint':
      return sum(roads.map((r) => r.lines?.length ?? 0)) + (o?.marks.length ?? 0);
    case 'race':
      return (
        (lay ? lay.grid.length + lay.pits.length + (lay.hotlap ? 1 : 0) + lay.timing.length : 0) +
        (o ? countOf(o, layout, 'gantries') : 0)
      );
    case 'poles':
    case 'tyres':
    case 'props':
    case 'scenery':
    case 'buildings':
    case 'statics':
      return o ? sum(CATEGORIES[c].kinds.map((k) => countOf(o, layout, k))) : 0;
    default:
      return 0;
  }
}

/** What a road is, as people see it (not its name, kept for the game's files). */
export function roadKind(r: Road): string {
  if (r.along) return 'Run-off';
  if (r.joins?.some(Boolean)) return 'Branch';
  return 'Road';
}
