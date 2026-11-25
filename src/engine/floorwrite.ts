// A mesh the engine made (a region of the merge, a line of paint, an object's part) as a node of a model: its points' normals and mapping, tangents from the
// mapping, in a material of the model's (brought from another model that has it, its textures with it), its flags after the node it takes the place of.

import { tangents } from "./gltf";
import { type Kn5, type Kn5Material, type Kn5Mesh, VERT } from "./kn5tree";
import { sphere } from "./mesh";

export type Kn5Model = Kn5;

/** A mesh: points (x, y, z), their mapping (u, v), faces (three corners each). */
export interface MadeMesh {
	P: ArrayLike<number>;
	UV: ArrayLike<number>;
	F: ArrayLike<number>;
}

/** A material of the model by name (its index), brought from another of models with its textures where the model has none of that name; a new one, by name
 * alone (the material library holds the rest), where none has. */
export function materialIn(k: Kn5, name: string, models: Record<string, Kn5> = {}): number {
	const i = k.materials.findIndex((m) => m.name === name);
	if (i >= 0) return i;
	for (const other of Object.values(models)) {
		const m = other.materials.find((x) => x.name === name);
		if (!m) continue;
		for (const slot of m.textures)
			if (!k.textures.some((t) => t.name === slot.name)) {
				const t = other.textures.find((x) => x.name === slot.name);
				if (t) k.textures.push({ ...t });
			}
		k.materials.push({ ...m, props: m.props.map((p) => ({ ...p })), textures: m.textures.map((s) => ({ ...s })) });
		return k.materials.length - 1;
	}
	const made: Kn5Material = {
		name,
		shader: "ksPerPixel",
		blend: 0,
		alpha_tested: 0,
		depth_mode: 0,
		props: [],
		textures: [],
	};
	k.materials.push(made);
	return k.materials.length - 1;
}

/** A made mesh's normals, one at each point, from normalAt. */
function normalsAt(m: MadeMesh, nv: number, normalAt: (x: number, z: number, y: number) => [number, number, number]): Float32Array {
	const nor = new Float32Array(nv * 3);
	for (let v = 0; v < nv; v++) {
		const n = normalAt(m.P[v * 3] as number, m.P[v * 3 + 2] as number, m.P[v * 3 + 1] as number);
		nor.set(n, v * 3);
	}
	return nor;
}

/** A made mesh's normals from its faces' own: each point's the sum of its faces' (as large as they are), made one long. */
function faceNormals(m: MadeMesh, nv: number): Float32Array {
	const nor = new Float32Array(nv * 3);
	for (let f = 0; f < m.F.length; f += 3) {
		const [a, b, c] = [m.F[f] as number, m.F[f + 1] as number, m.F[f + 2] as number];
		const u = [0, 1, 2].map((i) => (m.P[b * 3 + i] as number) - (m.P[a * 3 + i] as number));
		const w = [0, 1, 2].map((i) => (m.P[c * 3 + i] as number) - (m.P[a * 3 + i] as number));
		const n = [
			(u[1] as number) * (w[2] as number) - (u[2] as number) * (w[1] as number),
			(u[2] as number) * (w[0] as number) - (u[0] as number) * (w[2] as number),
			(u[0] as number) * (w[1] as number) - (u[1] as number) * (w[0] as number),
		];
		for (const v of [a, b, c]) for (let i = 0; i < 3; i++) nor[v * 3 + i] = (nor[v * 3 + i] as number) + (n[i] as number);
	}
	for (let v = 0; v < nv; v++) {
		const l = Math.hypot(nor[v * 3] as number, nor[v * 3 + 1] as number, nor[v * 3 + 2] as number) || 1;
		for (let i = 0; i < 3; i++) nor[v * 3 + i] = (nor[v * 3 + i] as number) / l;
	}
	return nor;
}

/** A made mesh as a node of k: its name, its material's, its flags as the template's (or a floor's: drawn, casting shadows), its normals from normalAt where
 * given (one at each point across seams), else its faces' own. */
export function meshNode(
	k: Kn5,
	name: string,
	m: MadeMesh,
	material: string,
	template: Kn5Mesh | null,
	models: Record<string, Kn5> = {},
	normalAt?: (x: number, z: number, y: number) => [number, number, number],
): Kn5Mesh {
	const nv = m.P.length / 3;
	const pos = new Float32Array(nv * 3);
	const uv = new Float32Array(nv * 2);
	for (let i = 0; i < nv * 3; i++) pos[i] = m.P[i] as number;
	for (let i = 0; i < nv * 2; i++) uv[i] = m.UV[i] as number;
	const nor = normalAt ? normalsAt(m, nv, normalAt) : faceNormals(m, nv);
	const tan = tangents(pos, nor, uv, m.F);
	const verts = new Float32Array(nv * VERT);
	for (let v = 0; v < nv; v++) {
		verts.set(pos.subarray(v * 3, v * 3 + 3), v * VERT);
		verts.set(nor.subarray(v * 3, v * 3 + 3), v * VERT + 3);
		verts.set(uv.subarray(v * 2, v * 2 + 2), v * VERT + 6);
		verts.set(tan.subarray(v * 3, v * 3 + 3), v * VERT + 8);
	}
	// (more points than a 16-bit index reaches: 32-bit, as glTF takes them; a kn5 is cut into pieces as it is read)
	const faces = (nv < 65536 ? Uint16Array.from(m.F) : Uint32Array.from(m.F)) as Uint16Array;
	const t = template;
	const node: Kn5Mesh = {
		kind: 2,
		name,
		active: t?.active ?? 1,
		children: [],
		verts,
		faces,
		material: materialIn(k, material, models),
		cast_shadows: t?.cast_shadows ?? 1,
		visible: t?.visible ?? 1,
		transparent: t?.transparent ?? 0,
		layer: t?.layer ?? 0,
		lod_in: t?.lod_in ?? 0,
		lod_out: t?.lod_out ?? 0,
		renderable: t?.renderable ?? 1,
		sphere: [0, 0, 0, 0],
	};
	if (t?.grass) node.grass = true;
	sphere(node);
	return node;
}
