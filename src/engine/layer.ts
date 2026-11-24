// A layer laid over a surface (the ground, a road's top): d metres over it along the surface's normal (asphalt ROAD over the ground, a rumble's profile over
// its road), as a height at the same x, z, so that a layer's points and its neighbours' stay where they are and the layer keeps the surface's shape and
// normals: the surface's height plus d over how upright the surface is there (its normal's y), the normal the surface's own over NORMAL_SPAN metres either side
// (smooth across its own faces' edges).

/** metres either side of a point a surface's normal is taken over */
export const NORMAL_SPAN = 0.5;

/** How upright a surface is at (x, z): its normal's y (1 flat; where it cannot be told, 1). */
export function upright(surface: (x: number, z: number) => number, x: number, z: number): number {
	const h = NORMAL_SPAN;
	const gx = (surface(x + h, z) - surface(x - h, z)) / (2 * h);
	const gz = (surface(x, z + h) - surface(x, z - h)) / (2 * h);
	if (!Number.isFinite(gx) || !Number.isFinite(gz)) return 1;
	return 1 / Math.hypot(gx, 1, gz);
}

/** A point d metres over a surface along its normal, as a height at (x, z) (NaN where the surface has none). */
export function above(surface: (x: number, z: number) => number, x: number, z: number, d: number): number {
	const y = surface(x, z);
	return d ? y + d / upright(surface, x, z) : y;
}
