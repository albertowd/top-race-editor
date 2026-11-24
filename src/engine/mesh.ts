// A model's meshes and their triangles in the model's space, and a mesh's sphere: the track's build_paths.py helpers (meshes, triangles, sphere, split).
import { type Kn5, type Kn5Mesh, type Mat4, VERT, walk } from "./kn5tree";

/** Every mesh of a model with the matrix taking it to the model's space. */
export function meshes(k: Kn5): [Kn5Mesh, Mat4][] {
	const out: [Kn5Mesh, Mat4][] = [];
	for (const [n, m] of walk(k.root)) if (n.kind === 2) out.push([n, m]);
	return out;
}

/** A mesh's faces on three corners as triangles in the model's space: nine numbers each (three corners, x y z), in 64-bit floats. */
export function triangles(n: Kn5Mesh, m: Mat4): Float64Array {
	const V = n.verts;
	const F = n.faces;
	const nv = V.length / VERT;
	const P = new Float64Array(nv * 3);
	for (let v = 0; v < nv; v++) {
		const x = V[v * VERT] as number;
		const y = V[v * VERT + 1] as number;
		const z = V[v * VERT + 2] as number;
		for (let j = 0; j < 3; j++) P[v * 3 + j] = x * (m[j] as number) + y * (m[4 + j] as number) + z * (m[8 + j] as number) + (m[12 + j] as number);
	}
	const keep: number[] = [];
	for (let k = 0; k < F.length; k += 3) if (F[k] !== F[k + 1] && F[k + 1] !== F[k + 2] && F[k] !== F[k + 2]) keep.push(k);
	const out = new Float64Array(keep.length * 9);
	keep.forEach((k, t) => {
		for (let c = 0; c < 3; c++) {
			const v = F[k + c] as number;
			out.set(P.subarray(v * 3, v * 3 + 3), t * 9 + c * 3);
		}
	});
	return out;
}

/** Triangles of several meshes as one array. */
export function concat(parts: Float64Array[]): Float64Array {
	const out = new Float64Array(parts.reduce((a, p) => a + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** A mesh's sphere measured again round its corners (64-bit floats, as build_paths.sphere). */
export function sphere(n: Kn5Mesh): void {
	const V = n.verts;
	const nv = V.length / VERT;
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (let v = 0; v < nv; v++)
		for (let i = 0; i < 3; i++) {
			const x = V[v * VERT + i] as number;
			if (x < (lo[i] as number)) lo[i] = x;
			if (x > (hi[i] as number)) hi[i] = x;
		}
	const mid = [0, 1, 2].map((i) => ((lo[i] as number) + (hi[i] as number)) / 2);
	let r = 0;
	for (let v = 0; v < nv; v++) {
		const d = Math.sqrt(
			((V[v * VERT] as number) - (mid[0] as number)) ** 2 +
				((V[v * VERT + 1] as number) - (mid[1] as number)) ** 2 +
				((V[v * VERT + 2] as number) - (mid[2] as number)) ** 2,
		);
		if (d > r) r = d;
	}
	n.sphere = [...mid, r];
}

/** The faces marked out taken from the mesh: their vertices and faces, numbered afresh; the mesh keeps the rest. */
export function split(n: Kn5Mesh, out: (face: number) => boolean): { verts: Float32Array; faces: Uint32Array } {
	const V = n.verts;
	const F = n.faces;
	const part = (sel: (k: number) => boolean) => {
		const faces: number[] = [];
		for (let k = 0; k < F.length / 3; k++) if (sel(k)) faces.push(k);
		const used = [...new Set(faces.flatMap((k) => [F[k * 3] as number, F[k * 3 + 1] as number, F[k * 3 + 2] as number]))].sort((a, b) => a - b);
		const remap = new Map(used.map((v, i) => [v, i]));
		const verts = new Float32Array(used.length * VERT);
		used.forEach((v, i) => {
			verts.set(V.subarray(v * VERT, (v + 1) * VERT), i * VERT);
		});
		const fs = new Uint32Array(faces.length * 3);
		faces.forEach((k, i) => {
			for (let c = 0; c < 3; c++) fs[i * 3 + c] = remap.get(F[k * 3 + c] as number) as number;
		});
		return { verts, faces: fs };
	};
	const taken = part(out);
	const kept = part((k) => !out(k));
	n.verts = kept.verts;
	n.faces = Uint16Array.from(kept.faces);
	sphere(n);
	return taken;
}
