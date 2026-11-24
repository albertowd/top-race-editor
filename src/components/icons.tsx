import type { ReactNode } from 'react';
import type { Category } from '../domain/categories';
import type { Mode } from '../domain/types';

// The page's icons: 16 by 16, drawn in the text's colour with 1.5 px strokes (as the text's weight). The categories'
// icons are drawn the way the map draws their things (a rumble's red and white, a line's white and yellow...), so
// the sidebar and the map read as one.

const RUMBLE = '#d23a3a';
const PAINT_YELLOW = '#ffd21f';
const CONE = '#ff7a1a';
const LIGHT = '#fff3a0';
const LEAF = '#6fcf7a';
const EARTH = '#d6b36a';

const PATHS = {
  sidebar: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M6 3v10" />
    </>
  ),
  select: <path d="M4 2.5v10l2.6-2.4 1.8 4 1.7-.8-1.8-3.9H12z" strokeLinejoin="round" />,
  add: (
    <>
      <path d="M1.5 12.5c3-1 4.5-4 7-6" />
      <rect x="9" y="3.5" width="3.5" height="3.5" rx=".5" />
      <path d="M12.5 10v4M10.5 12h4" />
    </>
  ),
  new: (
    <>
      <path d="M10.8 2.2l3 3-7.6 7.6-3.7.8.8-3.7z" strokeLinejoin="round" />
      <path d="M9.3 3.7l3 3" />
    </>
  ),
  measure: (
    <>
      <rect x="1.5" y="5.5" width="13" height="5" rx="1" />
      <path d="M4.5 5.5v2M7 5.5v3M9.5 5.5v2M12 5.5v3" />
    </>
  ),
  place: (
    <>
      <path d="M8 14.5s4.5-4.3 4.5-8a4.5 4.5 0 0 0-9 0c0 3.7 4.5 8 4.5 8z" strokeLinejoin="round" />
      <path d="M8 4.5v4M6 6.5h4" />
    </>
  ),
  bumps: (
    <>
      <path d="M1.5 11.5c1.5 0 1.8-3 3.3-3s1.6 2 3 2 1.7-5 3.3-5 1.6 6 3.4 6" strokeLinejoin="round" />
      <path d="M1.5 14h13" />
    </>
  ),
  bring: (
    <>
      <path d="M2 9.5v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
      <path d="M8 2v8M5 7l3 3 3-3" strokeLinejoin="round" />
    </>
  ),
  surface: (
    <>
      <path d="M8 1.8l5.5 2.2v3.6c0 3.3-2.4 5.6-5.5 6.6-3.1-1-5.5-3.3-5.5-6.6V4z" strokeLinejoin="round" />
      <path d="M5.5 8l1.8 1.8 3.3-3.6" strokeLinejoin="round" />
    </>
  ),
  undo: <path d="M5 3.5L2 6.5l3 3M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7" strokeLinejoin="round" />,
  redo: <path d="M11 3.5l3 3-3 3M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3" strokeLinejoin="round" />,
  view: (
    <>
      <path d="M8 2.5l6 3-6 3-6-3z" strokeLinejoin="round" />
      <path d="M2 8.5l6 3 6-3M2 11.5l6 3 6-3" strokeLinejoin="round" />
    </>
  ),
  package: (
    <>
      <path d="M8 1.75l5.75 3v6.5L8 14.25l-5.75-3v-6.5z" strokeLinejoin="round" />
      <path d="M2.25 4.75L8 7.75l5.75-3M8 7.75v6.5" strokeLinejoin="round" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8h12.5M8 1.75c-2.2 2.4-2.2 10.1 0 12.5M8 1.75c2.2 2.4 2.2 10.1 0 12.5" />
    </>
  ),
  help: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1V10" />
      <circle cx="8" cy="12" r=".4" fill="currentColor" />
    </>
  ),
  trash: (
    <>
      <path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5" />
      <path d="M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6" strokeLinejoin="round" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4L14 14" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  up: <path d="M4 10l4-4 4 4" strokeLinejoin="round" />,
  down: <path d="M4 6l4 4 4-4" strokeLinejoin="round" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  // the categories
  all: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1.2" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" />
    </>
  ),
  roads: (
    <>
      <path d="M3 14.5C3 9 6 7 6 1.5M13 14.5C13 9 10 7 10 1.5" />
      <path d="M8 14.5v-2M8 10V8M8 5.5v-2" />
    </>
  ),
  rumbles: (
    <>
      <path d="M2 11.5c2.5-.5 5-3.5 6-7.5" stroke="currentColor" />
      <path d="M5 13.5l.9-2.6M8.3 11.4l1.6-2.2M11.2 8l1.9-1.6" stroke={RUMBLE} strokeWidth="2.6" />
      <path d="M6.6 12.6l1.1-2.1M9.9 9.8l1.6-1.7" stroke="#fff" strokeWidth="2.6" />
    </>
  ),
  paint: (
    <>
      <path d="M3 14L8.5 2" strokeDasharray="2.4 1.6" />
      <path d="M8.5 14L14 2" stroke={PAINT_YELLOW} />
    </>
  ),
  race: (
    <>
      <path d="M3 14.5V2" />
      <path d="M3 2.5h10v7H3" strokeLinejoin="round" />
      <path
        d="M3 2.5h2.5v2.3H3zM8 2.5h2.5v2.3H8zM5.5 4.8H8v2.4H5.5zM10.5 4.8H13v2.4h-2.5zM3 7.2h2.5v2.3H3zM8 7.2h2.5v2.3H8z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  poles: (
    <>
      <path d="M6 14.5V3.5M4 14.5h4" />
      <path d="M6 3.5h3.5" />
      <path d="M10.5 4.5l3 1.5M10.5 3l3.2-.5M10.5 6l2.2 2.4" stroke={LIGHT} />
    </>
  ),
  tyres: (
    <>
      <circle cx="3.5" cy="8" r="2.25" />
      <circle cx="8" cy="8" r="2.25" />
      <circle cx="12.5" cy="8" r="2.25" />
    </>
  ),
  props: (
    <>
      <path d="M8 2l4 10.5H4z" stroke={CONE} strokeLinejoin="round" />
      <path d="M5.8 8h4.4" stroke="#fff" />
      <path d="M2.5 14h11" />
    </>
  ),
  scenery: (
    <>
      <circle cx="8" cy="6" r="4.5" stroke={LEAF} />
      <path d="M8 9.5v5M5.5 14.5h5" />
    </>
  ),
  buildings: (
    <>
      <path d="M1.75 7.5L8 2.25l6.25 5.25" strokeLinejoin="round" />
      <path d="M3.5 6.25v8.25h9V6.25" strokeLinejoin="round" />
      <path d="M6.75 14.5v-3.75h2.5v3.75" strokeLinejoin="round" />
    </>
  ),
  statics: (
    <>
      <path d="M5 1.75v12.75M5 8.5h6.5v6" strokeLinejoin="round" />
      <path d="M2.5 14.5h11" />
    </>
  ),
  terrain: (
    <>
      <path d="M1.5 13l4-6.5 2.6 3.6L10.5 6l4 7z" stroke={EARTH} strokeLinejoin="round" />
      <path d="M1.5 13h13" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export const MODE_ICONS: Record<Mode, IconName> = {
  select: 'select',
  add: 'add',
  new: 'new',
  measure: 'measure',
  place: 'place',
  bumps: 'bumps',
};

export const CATEGORY_ICONS: Record<Category, IconName> = {
  all: 'all',
  roads: 'roads',
  rumbles: 'rumbles',
  paint: 'paint',
  race: 'race',
  poles: 'poles',
  tyres: 'tyres',
  props: 'props',
  scenery: 'scenery',
  buildings: 'buildings',
  statics: 'statics',
  terrain: 'terrain',
};

/** An icon; decoration only (the control it is in carries the words). */
export function Icon({ name, size = 16 }: Readonly<{ name: IconName; size?: number }>) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
