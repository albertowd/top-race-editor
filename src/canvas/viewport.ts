import { MAX_PPM, MIN_PPM } from '../domain/constants';
import type { Box, Vec2 } from '../domain/types';

/** What the map shows: its middle (world) and how many pixels a metre. */
export interface View {
  cx: number;
  cz: number;
  ppm: number;
}

/** The map's size in CSS pixels. */
export interface Size {
  w: number;
  h: number;
}

// The map is seen from above with x growing to the left (west) and z up (north).

export const toScreen = (v: View, size: Size, x: number, z: number): Vec2 => [
  size.w / 2 + (v.cx - x) * v.ppm,
  size.h / 2 + (v.cz - z) * v.ppm,
];

export const toWorld = (v: View, size: Size, sx: number, sy: number): Vec2 => [
  v.cx - (sx - size.w / 2) / v.ppm,
  v.cz - (sy - size.h / 2) / v.ppm,
];

/** The world the map shows, pad pixels more each side. */
export function viewBox(v: View, size: Size, pad = 0): Box {
  const [x0, z0] = toWorld(v, size, -pad, size.h + pad);
  const [x1, z1] = toWorld(v, size, size.w + pad, -pad);
  return { xmin: Math.min(x0, x1), xmax: Math.max(x0, x1), zmin: Math.min(z0, z1), zmax: Math.max(z0, z1) };
}

/** Zoomed by a wheel's deltaY, the point under (sx, sy) kept there. */
export function zoomAt(v: View, size: Size, sx: number, sy: number, deltaY: number): View {
  const [wx, wz] = toWorld(v, size, sx, sy);
  const ppm = Math.min(MAX_PPM, Math.max(MIN_PPM, v.ppm * Math.exp(-deltaY * 0.0015)));
  const moved = { ...v, ppm };
  const [nx, nz] = toWorld(moved, size, sx, sy);
  return { cx: v.cx + wx - nx, cz: v.cz + wz - nz, ppm };
}

/** Panned: dragged from (sx0, sy0), the view then, to (sx, sy). */
export const panned = (from: View, sx0: number, sy0: number, sx: number, sy: number): View => ({
  ...from,
  cx: from.cx + (sx - sx0) / from.ppm,
  cz: from.cz + (sy - sy0) / from.ppm,
});
