import type { CurveNode, Vec2 } from "../domain/types";

/** Smoothstep: 0 to 1, flat at both ends (how widths change from node to node). */
export const smooth = (t: number): number => t * t * (3 - 2 * t);

export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

export const lerp2 = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** What a piece is drawn by: its nodes' points and handles (a road's nodes, a tyre wall's). */
export type BezierNode = Pick<CurveNode, "p" | "in" | "out">;

/** The four control points of the piece from node a to node b. */
export function controlPoints(a: BezierNode, b: BezierNode): [Vec2, Vec2, Vec2, Vec2] {
	const P0 = a.p;
	const P3 = b.p;
	return [P0, [P0[0] + a.out[0], P0[1] + a.out[1]], [P3[0] + b.in[0], P3[1] + b.in[1]], P3];
}

/** The point at t along the piece from node a to node b. */
export function bezPoint(a: BezierNode, b: BezierNode, t: number): Vec2 {
	const [P0, P1, P2, P3] = controlPoints(a, b);
	const u = 1 - t;
	return [
		u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
		u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1],
	];
}

/** The piece's way at t (B'(t), not unit). */
export function bezTangent(a: BezierNode, b: BezierNode, t: number): Vec2 {
	const [P0, P1, P2, P3] = controlPoints(a, b);
	const u = 1 - t;
	return [
		3 * u * u * (P1[0] - P0[0]) + 6 * u * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]),
		3 * u * u * (P1[1] - P0[1]) + 6 * u * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]),
	];
}

/** How long the piece's control polygon is: at least as long as the piece. */
export function hullLength(a: BezierNode, b: BezierNode): number {
	const [P0, P1, P2, P3] = controlPoints(a, b);
	return Math.hypot(P1[0] - P0[0], P1[1] - P0[1]) + Math.hypot(P2[0] - P1[0], P2[1] - P1[1]) + Math.hypot(P3[0] - P2[0], P3[1] - P2[1]);
}

/** The piece from a to b split at t (de Casteljau), the curve kept as it is: the new node between them and the handles a and b keep (a's out, b's in). */
export function splitPiece(a: CurveNode, b: CurveNode, t: number): { node: CurveNode; aOut: Vec2; bIn: Vec2 } {
	const [P0, P1, P2, P3] = controlPoints(a, b);
	const A = lerp2(P0, P1, t);
	const B = lerp2(P1, P2, t);
	const C = lerp2(P2, P3, t);
	const D = lerp2(A, B, t);
	const E = lerp2(B, C, t);
	const M = lerp2(D, E, t);
	const e = smooth(t);
	return {
		node: {
			p: M,
			in: [D[0] - M[0], D[1] - M[1]],
			out: [E[0] - M[0], E[1] - M[1]],
			left: a.left + (b.left - a.left) * e,
			right: a.right + (b.right - a.right) * e,
		},
		aOut: [A[0] - P0[0], A[1] - P0[1]],
		bIn: [C[0] - P3[0], C[1] - P3[1]],
	};
}
