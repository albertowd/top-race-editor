// The whole of a kn5 model (Assetto Corsa's, version 5 and 6) as plain data, and back to the same bytes: the track's kn5tree.py.
//
// A dummy (kind 1) has a matrix: 16 floats as stored, rows of a matrix that takes row vectors (v' = v m). A mesh (kind 2) has its vertices, 11 floats each
// (position, normal, uv, tangent) in its parent's space, and its faces, three corners each.
import { latin1, Reader, Writer } from "./bin";

export const MAGIC = "sc6969";
/** floats a vertex has: position 3, normal 3, uv 2, tangent 3 */
export const VERT = 11;

export interface Kn5Texture {
	name: string;
	active: number;
	data: Uint8Array;
}

export interface Kn5Prop {
	name: string;
	value: number;
	/** the 36 bytes after the value */
	rest: Uint8Array;
}

export interface Kn5Slot {
	sampler: string;
	slot: number;
	name: string;
}

export interface Kn5Material {
	name: string;
	shader: string;
	blend: number;
	alpha_tested: number;
	depth_mode: number | null;
	props: Kn5Prop[];
	textures: Kn5Slot[];
	/** an editor's model's own (made with it, its pictures inside it): kept as it is, never the material library's of its name */
	own?: boolean;
}

interface NodeBase {
	name: string;
	active: number;
	children: Kn5Node[];
}

export interface Kn5Dummy extends NodeBase {
	kind: 1;
	matrix: number[];
}

export interface Kn5Mesh extends NodeBase {
	kind: 2;
	cast_shadows: number;
	visible: number;
	transparent: number;
	/** VERT floats a vertex */
	verts: Float32Array;
	/** three corners a face */
	faces: Uint16Array;
	material: number;
	layer: number;
	lod_in: number;
	lod_out: number;
	/** its middle and radius */
	sphere: number[];
	renderable: number;
	/** grass grows on it (the track's, not the kn5's: AC's GRASS_MESHES) */
	grass?: boolean;
}

export type Kn5Node = Kn5Dummy | Kn5Mesh;

export interface Kn5 {
	version: number;
	/** past version 5, the int after the version */
	extra: number | null;
	textures: Kn5Texture[];
	materials: Kn5Material[];
	root: Kn5Node;
}

export function parse(b: Uint8Array): Kn5 {
	const r = new Reader(b);
	if (latin1.decode(r.raw(6)) !== MAGIC) throw new Error("not a kn5");
	const version = r.i32();
	const extra = version > 5 ? r.i32() : null;
	const textures: Kn5Texture[] = [];
	for (let n = r.i32(); n > 0; n--) {
		const active = r.i32();
		const name = r.str();
		textures.push({ name, active, data: r.raw(r.i32()) });
	}
	const materials: Kn5Material[] = [];
	for (let n = r.i32(); n > 0; n--) {
		const name = r.str();
		const shader = r.str();
		const blend = r.u8();
		const alpha_tested = r.u8();
		const depth_mode = version > 4 ? r.i32() : null;
		const props: Kn5Prop[] = [];
		for (let k = r.i32(); k > 0; k--) {
			const pname = r.str();
			props.push({ name: pname, value: r.f32(), rest: r.raw(36) });
		}
		const slots: Kn5Slot[] = [];
		for (let k = r.i32(); k > 0; k--) {
			const sampler = r.str();
			slots.push({ sampler, slot: r.i32(), name: r.str() });
		}
		materials.push({ name, shader, blend, alpha_tested, depth_mode, props, textures: slots });
	}
	const root = node(r);
	if (r.p !== b.length) throw new Error(`kn5 has ${b.length - r.p} bytes past its node tree`);
	return { version, extra, textures, materials, root };
}

function node(r: Reader): Kn5Node {
	const kind = r.i32();
	const name = r.str();
	const kids = r.i32();
	const active = r.u8();
	let n: Kn5Node;
	if (kind === 1) n = { kind, name, active, matrix: r.f32s(16), children: [] };
	else if (kind === 2) {
		const cast_shadows = r.u8();
		const visible = r.u8();
		const transparent = r.u8();
		const vc = r.i32();
		const verts = new Float32Array(r.raw(vc * VERT * 4).buffer);
		const ic = r.i32();
		const faces = new Uint16Array(r.raw(ic * 2).buffer);
		const material = r.i32();
		const layer = r.i32();
		const lod_in = r.f32();
		const lod_out = r.f32();
		const sphere = r.f32s(4);
		const renderable = r.u8();
		n = {
			kind,
			name,
			active,
			cast_shadows,
			visible,
			transparent,
			verts,
			faces,
			material,
			layer,
			lod_in,
			lod_out,
			sphere,
			renderable,
			children: [],
		};
	} else throw new Error(`kn5 node ${JSON.stringify(name)} is of kind ${kind}, which is not read`);
	for (let k = 0; k < kids; k++) n.children.push(node(r));
	return n;
}

export function dump(k: Kn5): Uint8Array<ArrayBuffer> {
	const w = new Writer().bytes(latin1.encode(MAGIC)).i32(k.version);
	if (k.version > 5) w.i32(k.extra ?? 0);
	w.i32(k.textures.length);
	for (const t of k.textures) w.i32(t.active).str(t.name).i32(t.data.length).bytes(t.data);
	w.i32(k.materials.length);
	for (const m of k.materials) {
		w.str(m.name).str(m.shader).u8(m.blend).u8(m.alpha_tested);
		if (k.version > 4) w.i32(m.depth_mode ?? 0);
		w.i32(m.props.length);
		for (const p of m.props) w.str(p.name).f32(p.value).bytes(p.rest);
		w.i32(m.textures.length);
		for (const t of m.textures) w.str(t.sampler).i32(t.slot).str(t.name);
	}
	dumpNode(k.root, w);
	return w.done();
}

function dumpNode(n: Kn5Node, w: Writer): void {
	w.i32(n.kind).str(n.name).i32(n.children.length).u8(n.active);
	if (n.kind === 1) for (const v of n.matrix) w.f32(v);
	else {
		if (n.verts.length % VERT || n.verts.length / VERT >= 65536) throw new Error(`${n.name}: too many vertices`);
		w.u8(n.cast_shadows).u8(n.visible).u8(n.transparent);
		w.i32(n.verts.length / VERT).bytes(new Uint8Array(n.verts.buffer, n.verts.byteOffset, n.verts.byteLength));
		w.i32(n.faces.length).bytes(new Uint8Array(n.faces.buffer, n.faces.byteOffset, n.faces.byteLength));
		w.i32(n.material).i32(n.layer).f32(n.lod_in).f32(n.lod_out);
		for (const v of n.sphere) w.f32(v);
		w.u8(n.renderable);
	}
	for (const c of n.children) dumpNode(c, w);
}

/** A 4x4 matrix taking row vectors, its rows one after another. */
export type Mat4 = Float64Array;

export const identity = (): Mat4 => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** a b: a first, then b (row vectors). */
export function mul(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
	const out = new Float64Array(16);
	for (let i = 0; i < 4; i++)
		for (let j = 0; j < 4; j++) {
			let s = 0;
			for (let k = 0; k < 4; k++) s += (a[i * 4 + k] as number) * (b[k * 4 + j] as number);
			out[i * 4 + j] = s;
		}
	return out;
}

/** Every node with the matrix taking its vertices to the model's space (row vectors). */
export function* walk(n: Kn5Node, parent?: Mat4): Generator<[Kn5Node, Mat4]> {
	let m = parent ?? identity();
	if (n.kind === 1) m = mul(n.matrix, m);
	yield [n, m];
	for (const c of n.children) yield* walk(c, m);
}
