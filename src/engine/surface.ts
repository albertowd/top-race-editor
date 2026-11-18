// The top of some triangles over points, through a grid of cells: the track's build_paths.Surface. A point's cell
// is found by its position, then only the few triangles over that cell are tried: no search of the whole map.
//
// Triangles are nine numbers each (three corners, x y z), y up. Heights are NaN where no triangle is over a point.
// The arithmetic is the Python's, in the same order, so the heights come out the same.

export const CELL = 4;
const KEY = 1000003;

export class Surface {
  /** each cell's triangles, by gx * KEY + gz */
  private readonly grid = new Map<number, number[]>();

  constructor(
    readonly t: Float64Array,
    readonly cell = CELL,
  ) {
    const n = t.length / 9;
    for (let k = 0; k < n; k++) {
      const xs = [t[k * 9] as number, t[k * 9 + 3] as number, t[k * 9 + 6] as number];
      const zs = [t[k * 9 + 2] as number, t[k * 9 + 5] as number, t[k * 9 + 8] as number];
      const x0 = Math.floor(Math.min(...xs) / cell);
      const x1 = Math.floor(Math.max(...xs) / cell);
      const z0 = Math.floor(Math.min(...zs) / cell);
      const z1 = Math.floor(Math.max(...zs) / cell);
      for (let gx = x0; gx <= x1; gx++)
        for (let gz = z0; gz <= z1; gz++) {
          const key = gx * KEY + gz;
          const list = this.grid.get(key);
          if (list) list.push(k);
          else this.grid.set(key, [k]);
        }
    }
  }

  /** The triangles over a point's cell. */
  private over(x: number, z: number): number[] {
    return this.grid.get(Math.floor(x / this.cell) * KEY + Math.floor(z / this.cell)) ?? [];
  }

  /** Triangle k's height at (x, z), or NaN when the point is not within it. */
  private heightIn(k: number, x: number, z: number): number {
    const T = this.t;
    const o = k * 9;
    const ax = T[o] as number;
    const ay = T[o + 1] as number;
    const az = T[o + 2] as number;
    const bx = T[o + 3] as number;
    const by = T[o + 4] as number;
    const bz = T[o + 5] as number;
    const cx = T[o + 6] as number;
    const cy = T[o + 7] as number;
    const cz = T[o + 8] as number;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (!(Math.abs(d) >= 1e-12)) return Number.NaN;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (!(Math.min(Math.min(l1, l2), l3) >= -1e-6)) return Number.NaN;
    return l1 * ay + l2 * by + l3 * cy;
  }

  /** The top at (x, z): the highest triangle over it. */
  y(x: number, z: number): number {
    let best = Number.NaN;
    for (const k of this.over(x, z)) {
      const h = this.heightIn(k, x, z);
      if (!Number.isNaN(h) && !(h <= best)) best = h;
    }
    return best;
  }

  /** y() for points (x, z pairs). */
  ys(P: ArrayLike<number>): Float64Array {
    const n = P.length / 2;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.y(P[i * 2] as number, P[i * 2 + 1] as number);
    return out;
  }

  /** Whether any triangle over each point (x, z pairs) has its top within tol of Y there. */
  near(P: ArrayLike<number>, Y: ArrayLike<number>, tol: number): Uint8Array {
    const n = P.length / 2;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = P[i * 2] as number;
      const z = P[i * 2 + 1] as number;
      for (const k of this.over(x, z))
        if (Math.abs(this.heightIn(k, x, z) - (Y[i] as number)) <= tol) {
          out[i] = 1;
          break;
        }
    }
    return out;
  }

  /**
   * For each point (x, z pairs), of the triangles over it, the height nearest Y there (the surface a point at Y lies
   * on, where some lie one over another); NaN where none is within tol. Of two as near, the later triangle.
   */
  nearestY(P: ArrayLike<number>, Y: ArrayLike<number>, tol: number): Float64Array {
    const n = P.length / 2;
    const out = new Float64Array(n).fill(Number.NaN);
    for (let i = 0; i < n; i++) {
      const x = P[i * 2] as number;
      const z = P[i * 2 + 1] as number;
      let gap = Infinity;
      let got = Number.NaN;
      for (const k of this.over(x, z)) {
        const h = this.heightIn(k, x, z);
        if (Number.isNaN(h)) continue;
        const g = Math.abs(h - (Y[i] as number));
        if (g <= gap) {
          gap = g;
          got = h;
        }
      }
      if (gap <= tol) out[i] = got;
    }
    return out;
  }
}
