// The engine's grids and rasters to and from what the page works with, and their values read between points.

import type { Grid, GridJson, Points, Raster, RasterJson } from "./types";

function bytesOf(s: string): Uint8Array<ArrayBuffer> {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

const CHUNK = 0x8000;

function base64Of(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	return btoa(bin);
}

/** (the engine sends little-endian values, as every browser's typed arrays are) */
export const float32Of = (s: string) => new Float32Array(bytesOf(s).buffer);
export const base64OfFloat32 = (a: Float32Array) => base64Of(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

export function gridFrom(g: GridJson): Grid {
	const u = new Uint16Array(bytesOf(g.data).buffer);
	const k = (g.hi - g.lo) / 65535;
	const v = new Float32Array(u.length);
	for (let i = 0; i < u.length; i++) v[i] = g.lo + u[i] * k;
	return { x0: g.x0, z0: g.z0, cell: g.cell, nx: g.nx, nz: g.nz, v, lo: g.lo, hi: g.hi };
}

export const rasterFrom = (r: RasterJson): Raster => ({
	x0: r.x0,
	z0: r.z0,
	cell: r.cell,
	nx: r.nx,
	nz: r.nz,
	v: float32Of(r.d),
});

export const rasterJson = (r: Raster): RasterJson => ({
	x0: r.x0,
	z0: r.z0,
	cell: r.cell,
	nx: r.nx,
	nz: r.nz,
	d: base64OfFloat32(r.v),
});

export function pointsFrom(p: { count: number; x: string; z: string; y: string; why: string }): Points {
	return { x: float32Of(p.x), z: float32Of(p.z), y: float32Of(p.y), why: bytesOf(p.why) };
}

/** A grid's value at (x, z), linear between its points; NaN off it. */
export function sample(g: Pick<Grid, "x0" | "z0" | "cell" | "nx" | "nz" | "v">, x: number, z: number): number {
	const fx = (x - g.x0) / g.cell;
	const fz = (z - g.z0) / g.cell;
	if (!(fx >= 0 && fz >= 0 && fx <= g.nx - 1 && fz <= g.nz - 1)) return Number.NaN;
	// (a grid one point wide one way: linear the other way only)
	const i = g.nx > 1 ? Math.min(Math.floor(fx), g.nx - 2) : 0;
	const j = g.nz > 1 ? Math.min(Math.floor(fz), g.nz - 2) : 0;
	const di = g.nx > 1 ? 1 : 0;
	const dj = g.nz > 1 ? g.nx : 0;
	const tx = fx - i;
	const tz = fz - j;
	const k = j * g.nx + i;
	const a = g.v[k];
	const b = g.v[k + di];
	const c = g.v[k + dj];
	const d = g.v[k + dj + di];
	return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** A raster's metres added at (x, z), as the track's tool reads it: linear between its points, 0 off it. */
export function rasterAt(r: Raster, x: number, z: number): number {
	const v = sample(r, x, z);
	return Number.isNaN(v) ? 0 : v;
}

/** A grid's extent: the middles of its first and last points. */
export const gridBox = (g: Pick<Grid, "x0" | "z0" | "cell" | "nx" | "nz">) => ({
	xmin: g.x0,
	zmin: g.z0,
	xmax: g.x0 + (g.nx - 1) * g.cell,
	zmax: g.z0 + (g.nz - 1) * g.cell,
});
