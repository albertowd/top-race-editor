import type { KerbKind } from './types';

/** The rumbles (kerbs) the track has, by their material: what each looks like. */
export const KERB_KINDS: readonly { kind: KerbKind; label: string; what: string }[] = [
  {
    kind: 'ramp',
    label: 'Ramp',
    what: 'Red and white painted kerb sloping up from the road edge (KerbRamp, as at T1 entry)',
  },
  {
    kind: 'floor',
    label: 'Floor',
    what: 'Flat painted kerb, level with the road, orange and white (KerbFloor, as outside the hairpin)',
  },
  {
    kind: 'concrete',
    label: 'Concrete',
    what: 'Plain raised concrete kerb, shown blue (KerbConcrete, as at the T1 kink)',
  },
  { kind: 'round', label: 'Round', what: 'Yellow rounded kerb, a bump along the edge (KerbRound, as at S1 exit)' },
  {
    kind: 'ramp_concrete',
    label: 'Ramp + concrete',
    what: 'A ramp with a concrete kerb behind it: one piece in KerbConcrete, as the old concrete kerbs (the ramp painted, rising; the concrete behind it sloping back to the ground)',
  },
];

export const KERB_COLOURS: Record<KerbKind, [string, string]> = {
  ramp: ['#d23a3a', '#f2f2f2'],
  floor: ['#e07a1f', '#f2f2f2'],
  concrete: ['#3f6fc0', '#5d88d2'],
  round: ['#f2c200', '#c99f00'],
  ramp_concrete: ['#d23a3a', '#f2f2f2'],
};

/** metres up at each kind's outer edge (the track's build_kerbs profiles' last points) */
export const KERB_END_RISE: Record<KerbKind, number> = {
  ramp: 0.05,
  floor: 0,
  concrete: 0.03,
  round: -0.01,
  ramp_concrete: -0.008,
};
/** metres: a rumble part higher than this over its road stands up from it (build_kerbs.RAISED) */
export const RAISED = 0.005;
/** metres behind a rumble's outer edge it goes down to its road's height, unless it says: an edge (the old kerbs'
 * dropped straight down, 5 to 10 cm; a surface has one height a point, so a centimetre for it) */
export const BACK_RAMP = 0.01;
/** a rumble's back ramp as drawn: the road's grey, a shade lighter */
export const BACK_RAMP_COLOUR = '#8e8e93';

/** A kerb's kind as the editor has it ('yellow' was the round kerb's old name; anything else unknown: a ramp). */
export function kindOf(kind: unknown): KerbKind {
  if (kind === 'yellow') return 'round';
  return typeof kind === 'string' && kind in KERB_COLOURS ? (kind as KerbKind) : 'ramp';
}

/** metres: a dotted line's dashes and the gaps between them, unless it says */
export const DASH = 0.5;
export const GAP = 0.5;
/** metres: a ramp + concrete rumble's concrete, behind its ramp, unless it says */
export const BACK = 0.75;
/** metres from a road's end over which its rows turn into its end row (as the track's roads.py) */
export const END_BLEND = 4;
/** where a road turns tighter than it is wide, its inner side at most this much of the curve's radius */
export const INSIDE = 0.97;
/** metres its turning is measured over, at least */
export const TURN_BASE = 0.2;

export const LINE_PAD = 0.2;
export const LINE_WIDTH = 0.12;
/** metres a rumble is wide, unless it says (a new one's width) */
export const KERB_WIDTH = 0.6;
export const KERB_TAPER = 2;
export const RUNOFF_WIDTH = 2;
export const RUNOFF_EASE = 8;

export const DEFAULT_MATERIAL = 'Tarmac Dark';

export const MATERIAL_COLOURS: Record<string, string> = {
  'Tarmac Dark': 'rgba(30,32,38,0.45)',
  'Tarmac Light': 'rgba(85,88,96,0.45)',
  Pavers: 'rgba(150,105,70,0.45)',
  Concrete: 'rgba(175,175,170,0.45)',
};

export const CONTEXT_COLOURS: Record<string, string> = {
  road: 'rgba(0,220,255,0.75)',
  runoff: 'rgba(255,170,60,0.7)',
  kerb: 'rgba(255,70,70,0.8)',
  line: 'rgba(255,255,255,0.9)',
  tyre: 'rgba(0,0,0,0.85)',
  paddock: 'rgba(200,120,255,0.6)',
  kids: 'rgba(120,255,140,0.7)',
};

export const SURFACE_COLOURS: Record<string, string> = {
  rumble: 'rgba(255,90,90,0.8)',
  road: 'rgba(255,255,255,0.5)',
  ground: 'rgba(120,230,120,0.35)',
};

/** pixels: a dragged point snaps to what is this near */
export const SNAP_PX = 10;
/** metres: J joins a road's end to another road's end at most this far */
export const JOIN_REACH = 20;
/** metres: the surface checked is at most this across */
export const SURFACE_WINDOW = 150;
export const UNDO_DEPTH = 150;
export const MIN_PPM = 0.3;
export const MAX_PPM = 400;
