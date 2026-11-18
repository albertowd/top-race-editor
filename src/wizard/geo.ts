// The Earth as the wizard's map shows it: Web Mercator's pixels (256 a tile) of latitude and longitude, and a
// track's x and z (x west, z north, metres from its origin) on it, as the engine's providers.py has them.

export const TILE = 256;
export const EARTH = 6378137;
const DEG = Math.PI / 180;

/** World pixels (the whole world at zoom) of a latitude and longitude. */
export function toPx(lat: number, lon: number, zoom: number): [number, number] {
  const n = TILE * 2 ** zoom;
  const s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * DEG);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

/** The latitude and longitude of world pixels at zoom. */
export function fromPx(px: number, py: number, zoom: number): [number, number] {
  const n = TILE * 2 ** zoom;
  const lon = (px / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) / DEG;
  return [lat, lon];
}

/** A track's x and z (from its origin at lat0, lon0) to latitude and longitude. */
export function latLonOf(lat0: number, lon0: number, x: number, z: number): [number, number] {
  return [lat0 + z / EARTH / DEG, lon0 + -x / (EARTH * Math.cos(lat0 * DEG)) / DEG];
}

/** Metres of the ground a map pixel at zoom covers, at a latitude. */
export const metresAPixel = (lat: number, zoom: number): number =>
  (2 * Math.PI * EARTH * Math.cos(lat * DEG)) / (TILE * 2 ** zoom);

/** The zoom that shows metres across in pixels (whole, between min and max). */
export function zoomToShow(lat: number, metres: number, pixels: number, min = 2, max = 19): number {
  for (let z = max; z >= min; z--) if (metres / metresAPixel(lat, z) <= pixels) return z;
  return min;
}
