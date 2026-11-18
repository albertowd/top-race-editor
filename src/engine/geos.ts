// Polygons' unions, intersections and differences by GEOS (geos-wasm: the C library under the track's shapely), on the
// merge's grid: each result then put on the grid as the Python's set_precision(GRID) puts it (whole numbers of the grid,
// valid, what is thinner than it collapsed). Robust where clipper2-js is not: its booleans never end on some overlapping shapes (the Velopark's paddock).
// GEOS is loaded once where the engine runs (geosReady), then used at once (its calls are not awaited).

import initGeosJs from 'geos-wasm';
import type { Poly, Pt } from './merge';

type Geos = Awaited<ReturnType<typeof initGeosJs>>;
type G = number;

let geos: Geos | null = null;
let loading: Promise<Geos> | null = null;

/** GEOS, loaded (once). */
export function geosReady(): Promise<Geos> {
  loading ??= initGeosJs().then((g) => {
    geos = g;
    return g;
  });
  return loading;
}

const ready = (): Geos => {
  if (!geos) throw new Error('GEOS is not loaded: await geosReady() first');
  return geos;
};

/** twice a ring's area, anticlockwise positive */
const area2 = (r: Pt[]) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i] as Pt;
    const b = r[(i + 1) % r.length] as Pt;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
};

/** A ring as GEOS's (closed). */
function ringOf(g: Geos, r: Pt[]): G {
  const n = r.length + 1;
  const buf = g.Module._malloc(n * 16);
  const f = new Float64Array(g.Module.HEAPF64.buffer, buf, n * 2);
  r.forEach(([x, z], i) => {
    f[i * 2] = x;
    f[i * 2 + 1] = z;
  });
  f[r.length * 2] = (r[0] as Pt)[0];
  f[r.length * 2 + 1] = (r[0] as Pt)[1];
  const seq = g.GEOSCoordSeq_copyFromBuffer(buf, n, 0, 0);
  g.Module._free(buf);
  return g.GEOSGeom_createLinearRing(seq);
}

/** Polygons as one GEOS geometry (a collection of them), each first through fix where given (made valid). */
function geomOf(g: Geos, polys: Poly[], fix?: (p: G) => G): G {
  const parts: G[] = [];
  for (const p of polys) {
    if (p.outer.length < 3) continue;
    const shell = ringOf(g, p.outer);
    const holes = p.holes.filter((h) => h.length >= 3).map((h) => ringOf(g, h));
    const hp = g.Module._malloc(Math.max(1, holes.length) * 4);
    holes.forEach((h, i) => {
      g.Module.HEAP32[(hp >> 2) + i] = h;
    });
    const poly = g.GEOSGeom_createPolygon(shell, hp, holes.length);
    if (fix) {
      // (a fixed one is a new geometry: the collection holds it, the one it was made from let go)
      const fixed = fix(poly);
      g.GEOSGeom_destroy(poly);
      if (!fixed) throw new Error('GEOS: a polygon could not be made valid');
      parts.push(fixed);
    } else parts.push(poly);
    g.Module._free(hp);
  }
  const ptr = g.Module._malloc(Math.max(1, parts.length) * 4);
  parts.forEach((p, i) => {
    g.Module.HEAP32[(ptr >> 2) + i] = p;
  });
  // (7: a collection: its polygons may overlap, made one by a union before any other use)
  const out = g.GEOSGeom_createCollection(7, ptr, parts.length);
  g.Module._free(ptr);
  return out;
}

/** A GEOS ring's points (its last, the first again, left out). */
function pointsOf(g: Geos, ring: G): Pt[] {
  const seq = g.GEOSGeom_getCoordSeq(ring);
  const sp = g.Module._malloc(4);
  g.GEOSCoordSeq_getSize(seq, sp);
  const n = g.Module.getValue(sp, 'i32');
  g.Module._free(sp);
  if (n < 4) return [];
  const buf = g.Module._malloc(n * 16);
  g.GEOSCoordSeq_copyToBuffer(seq, buf, 0, 0);
  const f = new Float64Array(g.Module.HEAPF64.buffer, buf, n * 2);
  const out: Pt[] = [];
  for (let i = 0; i < n - 1; i++) out.push([Math.round(f[i * 2] as number), Math.round(f[i * 2 + 1] as number)]);
  g.Module._free(buf);
  return out;
}

/** A GEOS geometry's polygons: outer rings anticlockwise, holes clockwise. */
function polysOfGeom(g: Geos, geom: G, out: Poly[] = []): Poly[] {
  const type = g.GEOSGeomTypeId(geom);
  if (type === 3) {
    const outer = pointsOf(g, g.GEOSGetExteriorRing(geom));
    if (outer.length < 3 || area2(outer) === 0) return out;
    if (area2(outer) < 0) outer.reverse();
    const holes: Pt[][] = [];
    const nh = g.GEOSGetNumInteriorRings(geom);
    for (let i = 0; i < nh; i++) {
      const h = pointsOf(g, g.GEOSGetInteriorRingN(geom, i));
      if (h.length < 3 || area2(h) === 0) continue;
      if (area2(h) > 0) h.reverse();
      holes.push(h);
    }
    out.push({ outer, holes });
  } else if (type === 6 || type === 7) {
    const n = g.GEOSGetNumGeometries(geom);
    for (let i = 0; i < n; i++) polysOfGeom(g, g.GEOSGetGeometryN(geom, i), out);
  }
  return out;
}

export type GeosOp = 'union' | 'intersection' | 'difference';

/** a, made one, then with b (made one) by op; on the grid (whole numbers), as polygons. */
export function geosOp(op: GeosOp, a: Poly[], b: Poly[] | null = null): Poly[] {
  const g = ready();
  const made: G[] = [];
  const keep = (x: G) => {
    if (!x) throw new Error(`GEOS: the ${op} failed`);
    made.push(x);
    return x;
  };
  try {
    // (each polygon made valid first, as the Python's buffer(0) makes one: of a ring crossing itself, the area its
    // way round encloses (a loop the other way round, none); then all made one)
    const one = (ps: Poly[]) => keep(g.GEOSUnaryUnion(keep(geomOf(g, ps, (p) => g.GEOSBuffer(p, 0, 8)))));
    const A = one(a);
    let R: G;
    if (b === null) R = A;
    else {
      const B = one(b);
      R = keep(
        op === 'union' ? g.GEOSUnion(A, B) : op === 'intersection' ? g.GEOSIntersection(A, B) : g.GEOSDifference(A, B),
      );
    }
    // (then on the grid, as the Python's set_precision(GRID) puts it: whole numbers, valid, what is thinner than the
    // grid (a channel a unit wide between two edges almost meeting) collapsed)
    return polysOfGeom(g, keep(g.GEOSGeom_setPrecision(R, 1, 0)));
  } finally {
    for (const x of made) g.GEOSGeom_destroy(x);
  }
}

/** The union of triangles (six numbers each: three corners x, z, grid units), on the grid, as polygons. */
export function geosTriangles(T: ArrayLike<number>, n: number): Poly[] {
  const tris: Poly[] = [];
  for (let t = 0; t < n; t++) {
    const r: Pt[] = [
      [T[t * 6] as number, T[t * 6 + 1] as number],
      [T[t * 6 + 2] as number, T[t * 6 + 3] as number],
      [T[t * 6 + 4] as number, T[t * 6 + 5] as number],
    ];
    const a = area2(r);
    if (a === 0) continue;
    if (a < 0) r.reverse();
    tris.push({ outer: r, holes: [] });
  }
  return geosOp('union', tris);
}
