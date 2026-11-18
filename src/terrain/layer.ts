// The terrain as one more layer of the map (see renderer.ts's ExtraLayer): drawn while it is worked on, or
// everywhere if asked; its message over the map.

import type { ExtraLayer } from '../canvas/renderer';
import type { EditorState } from '../store/state';
import { drawTerrainOver, drawTerrainUnder, type TerrainDraw, type TerrainRenderCache } from './render';
import type { Terrain, TerrainState } from './store';

/** What the map says while the terrain is worked on. */
export function terrainMessage(s: TerrainState): string {
  if (s.status === 'loading') return 'Loading the terrain…';
  switch (s.tool) {
    case 'brush':
      return `Brush (${s.brush.mode}): drag on the map to paint; Alt-click takes the height there; Esc to stop`;
    case 'ground':
    case 'not_ground':
      return `Area (${s.tool === 'ground' ? 'ground' : 'not ground'}): click its points; Enter, a double-click or its first point ends it; Esc drops it`;
    case 'flat':
    case 'offset':
    case 'smooth':
      return 'Edit: click its ring’s points; Enter, a double-click or its first point ends it; Esc drops it';
    default:
      return '';
  }
}

export function terrainLayer(t: Terrain, es: EditorState, cache: TerrainRenderCache): ExtraLayer | undefined {
  const s = t.get();
  const focused = es.focus === 'terrain';
  if (!s.doc || !(focused || s.show.everywhere)) return undefined;
  const d: TerrainDraw = {
    g: null as unknown as CanvasRenderingContext2D,
    view: es.view,
    size: es.size,
    s,
    cache,
    touched: t.takeTouched(),
    pictureUrl: s.picture,
    focused,
    mouse: es.mouse,
  };
  return {
    under: (g) => drawTerrainUnder({ ...d, g }),
    over: (g) => drawTerrainOver({ ...d, g }),
    message: () => (focused ? terrainMessage(s) : ''),
  };
}
