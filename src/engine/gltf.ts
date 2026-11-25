// A track's source models: kn5 models as glTF binaries (.glb), and back: the track's gltf_source.py.
//
// Everything a kn5 holds that glTF has no place for is kept in the glTF "extras" under "kn5", so kn5 -> glb -> kn5 gives the same bytes. A model made or edited
// in Blender (no kn5 data) comes back as well: its materials plain ksPerPixel ones, its tangents worked out, its meshes' spheres measured. Where numpy works in
// 32-bit floats (normals, tangents, spheres), this does too, one operation at a time, so the bytes come out the same as the track's tools make them.
import { bytesOf, own, sha1, Writer } from "./bin";
import { type Kn5, type Kn5Material, type Kn5Mesh, type Kn5Node, type Kn5Slot, type Kn5Texture, VERT, walk } from "./kn5tree";
import { type PyValue, parsePyLiteral } from "./pyliteral";

const f = Math.fround;

export const GLB = 0x46546c67;
export const JSON_CHUNK = 0x4e4f534a;
export const BIN_CHUNK = 0x004e4942;
export const FLOAT = 5126;
export const USHORT = 5123;
export const UINT = 5125;
export const UBYTE = 5121;
export const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const MESH_KEYS = ["cast_shadows", "visible", "transparent", "layer", "lod_in", "lod_out", "renderable"] as const;
/** what Blender adds to a name it has seen before */
export const BLENDER_COPY = /\.\d{3,}$/;
const DEFAULT_PROPS: [string, number][] = [
	["ksAmbient", 0.5],
	["ksDiffuse", 0.5],
	["ksSpecular", 0],
	["ksSpecularEXP", 1],
	["ksEmissive", 0],
	["ksAlphaRef", 0],
];
export const GENERATOR = "top-race-editor";

/** kn5 data in a glTF object's extras */
export type Kx = { [k: string]: PyValue };
type Extras = { kn5?: PyValue; [k: string]: PyValue | undefined };

export interface GltfAccessor {
	bufferView: number;
	byteOffset?: number;
	componentType: number;
	count: number;
	type: string;
	normalized?: boolean;
	min?: number[];
	max?: number[];
}
export interface GltfView {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
	byteStride?: number;
	target?: number;
}
export interface GltfPrimitive {
	attributes: Record<string, number>;
	indices?: number;
	material?: number;
	mode?: number;
}
export interface GltfNode {
	name?: string;
	mesh?: number;
	children?: number[];
	matrix?: number[];
	translation?: number[];
	rotation?: number[];
	scale?: number[];
	extras?: Extras;
}
export interface GltfMaterial {
	name?: string;
	extras?: Extras;
	pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicFactor?: number; roughnessFactor?: number };
	normalTexture?: { index: number };
	alphaMode?: string;
}
export interface GltfImage {
	name?: string;
	uri?: string;
	bufferView?: number;
	mimeType?: string;
}
export interface GltfDoc {
	asset: { version: string; generator?: string };
	scene?: number;
	scenes: { nodes: number[] }[];
	nodes?: GltfNode[];
	meshes?: { name?: string; primitives: GltfPrimitive[] }[];
	materials?: GltfMaterial[];
	textures?: { source: number }[];
	images?: GltfImage[];
	buffers?: { byteLength: number }[];
	bufferViews?: GltfView[];
	accessors?: GltfAccessor[];
	extras?: Extras;
}

// ---- small things ---------------------------------------------------------------------------------------------

/** urllib.parse.quote: all but letters, digits, _.-~ and / percent-encoded (UTF-8). */
export function quote(s: string): string {
	let out = "";
	for (const b of new TextEncoder().encode(s)) {
		const c = String.fromCodePoint(b);
		out += /[A-Za-z0-9_.\-~/]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
	}
	return out;
}

/** urllib.parse.unquote: %XX runs decoded as UTF-8 (what is not one, kept). */
export function unquote(s: string): string {
	return s.replace(/(%[0-9A-Fa-f]{2})+/g, (run) => {
		try {
			return decodeURIComponent(run);
		} catch {
			return run;
		}
	});
}

/** os.path.basename on Windows: the part after the last / or \. */
export const basename = (p: string): string => p.split(/[\\/]/).pop() ?? "";

/** A mesh's vertices and faces as the track's tools hash them (to tell whether it changed). */
export function meshHash(verts: Float32Array, faces: ArrayLike<number>): string {
	return sha1(bytesOf(verts), bytesOf(Uint32Array.from(faces))).slice(0, 16);
}

const numbers = (v: PyValue | undefined): number[] => (Array.isArray(v) ? v.map(Number) : []);

/** The kn5 data in a glTF object's extras (Blender's Python text of it read back). */
export function kn5Of(g: { extras?: Extras } | undefined): Kx {
	const fix = (v: PyValue): PyValue => {
		if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
			try {
				return fix(parsePyLiteral(v));
			} catch {
				return v;
			}
		}
		if (Array.isArray(v)) return v.map(fix);
		if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
		return v;
	};
	const x = fix(g?.extras?.kn5 ?? null);
	return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

// ---- kn5 -> glb ------------------------------------------------------------------------------------------------

class Bin {
	parts: Uint8Array[] = [];
	size = 0;
	views: GltfView[] = [];
	accessors: GltfAccessor[] = [];

	/** rows of cols numbers (data: their bytes as stored); its accessor's index. */
	add(data: Uint8Array, rows: number, cols: number, ctype: number, kind: string, target?: number, minmax?: Float32Array) {
		const view: GltfView = { buffer: 0, byteOffset: this.size, byteLength: data.length };
		if (target) view.target = target;
		this.parts.push(data);
		this.size += data.length;
		const pad = -this.size & 3;
		this.parts.push(new Uint8Array(pad));
		this.size += pad;
		this.views.push(view);
		if (kind === "RAW") return this.views.length - 1;
		const acc: GltfAccessor = {
			bufferView: this.views.length - 1,
			componentType: ctype,
			count: kind !== "SCALAR" ? rows : rows * cols,
			type: kind,
		};
		if (minmax) [acc.min, acc.max] = bounds(minmax, rows, cols);
		this.accessors.push(acc);
		return this.accessors.length - 1;
	}
}

/** The least and the most of each column of rows of cols numbers (an accessor's min and max). */
function bounds(v: Float32Array, rows: number, cols: number): [number[], number[]] {
	const lo = new Array<number>(cols).fill(Infinity);
	const hi = new Array<number>(cols).fill(-Infinity);
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++) {
			const x = v[r * cols + c] as number;
			if (x < (lo[c] as number)) lo[c] = x;
			if (x > (hi[c] as number)) hi[c] = x;
		}
	return [lo, hi];
}

/** Columns [a, b) of rows of n floats, as a packed array. */
function columns(v: Float32Array, n: number, a: number, b: number): Float32Array {
	const rows = v.length / n;
	const out = new Float32Array(rows * (b - a));
	for (let r = 0; r < rows; r++) for (let c = a; c < b; c++) out[r * (b - a) + c - a] = v[r * n + c] as number;
	return out;
}

/** A face on the same three corners as one before it (the back of a two-sided face) given corners of its own, copies of those: Blender keeps one face of a set
 * of corners only. Returns the corners, the faces and, for each corner added, the one it copies. */
export function splitRepeats(verts: Float32Array, faces: ArrayLike<number>) {
	const nf = faces.length / 3;
	const seen = new Set<string>();
	const again: number[] = [];
	for (let k = 0; k < nf; k++) {
		const t = [faces[k * 3] as number, faces[k * 3 + 1] as number, faces[k * 3 + 2] as number].sort((a, b) => a - b);
		const key = t.join(",");
		if (!seen.has(key)) seen.add(key);
		else if (t[0] !== t[1] && t[1] !== t[2]) again.push(k);
	}
	if (!again.length) return { verts, faces: Uint32Array.from(faces), copies: [] as number[] };
	const n0 = verts.length / VERT;
	const copies: number[] = [];
	const out = Uint32Array.from(faces);
	for (const k of again)
		for (let c = 0; c < 3; c++) {
			copies.push(faces[k * 3 + c] as number);
			out[k * 3 + c] = n0 + copies.length - 1;
		}
	const v = new Float32Array(verts.length + copies.length * VERT);
	v.set(verts);
	copies.forEach((c, i) => {
		v.set(verts.subarray(c * VERT, (c + 1) * VERT), (n0 + i) * VERT);
	});
	return { verts: v, faces: out, copies };
}

/** A parsed kn5 as (glTF document, binary chunk). texUri(texture) gives the uri the glb points at for each of the kn5's textures; null: the texture is kept in
 * the glb itself (a picture the track's textures do not hold, as the editor's models bring theirs). */
/** A track's material library (its source/materials.json): a material's kn5 data by its name, where a model holds only its name; and a model's own kept there
 * as it is written (drawn: a mesh with faces, renderable and not a marker, uses it). gltf_source's LIBRARY hook. */
export interface MaterialLibrary {
	get(name: string): Kx | null;
	put(name: string, x: Kx, drawn: boolean): void;
	/** a mesh as kept: its own name, what it is to every game (extras.track), what only AC's round trip needs */
	nodeOut?(name: string, x: Kx): [string, Kx, Kx];
	/** a mesh as the tools have it, from how it is kept: AC's name and flags */
	nodeIn?(name: string, track: Kx, x: Kx): [string, Kx];
}

/** A kn5 material as a glTF one (its kn5 data in its extras; with a library, its name only, an editor's model's own its data with it too), and its kn5 data.
 * byName gives a texture's place by its name. */
function materialOut(m: Kn5Material, byName: Map<string, number>, library?: MaterialLibrary): [GltfMaterial, Kx] {
	const x: Kx = {
		shader: m.shader,
		blend: m.blend,
		alpha_tested: m.alpha_tested,
		depth_mode: m.depth_mode,
		props: m.props.map((p) => [p.name, p.value]),
		textures: m.textures.map((t) => [t.sampler, t.slot, t.name]),
	};
	const rest: Kx = {};
	for (const p of m.props) if (p.rest.some(Boolean)) rest[p.name] = [...p.rest].map((v) => v.toString(16).padStart(2, "0")).join("");
	if (Object.keys(rest).length) x.rest = rest;
	const g: GltfMaterial = {
		name: m.name,
		extras: { kn5: x },
		pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 },
	};
	// (with a library: its name only, its kn5 data kept there; an editor's model's own: its data with it, marked own)
	if (library) g.extras = m.own ? { track: { material: m.name, own: true }, kn5: x } : { track: { material: m.name } };
	const slots = new Map(m.textures.map((t) => [t.sampler, t.name]));
	const diffuse = byName.get(slots.get("txDiffuse") ?? "\0");
	const normal = byName.get(slots.get("txNormal") ?? "\0");
	if (diffuse !== undefined && g.pbrMetallicRoughness) g.pbrMetallicRoughness.baseColorTexture = { index: diffuse };
	if (normal !== undefined) g.normalTexture = { index: normal };
	if (m.alpha_tested) g.alphaMode = "MASK";
	else if (m.blend === 1) g.alphaMode = "BLEND";
	return [g, x];
}

/** What toGltf gathers as it goes down a kn5's nodes: the binary chunk, the glTF nodes and meshes, the material library. */
interface GltfOut {
	b: Bin;
	nodes: GltfNode[];
	meshes: NonNullable<GltfDoc["meshes"]>;
	library?: MaterialLibrary;
}

/** A kn5 mesh into its glTF node g: its flags into its kn5 data x, its corners and faces into the binary chunk as a glTF mesh (one of no faces kept as the node
 * alone, with what it would hold). */
function meshOut(o: GltfOut, n: Kn5Mesh, g: GltfNode, x: Kx) {
	for (const key of MESH_KEYS) x[key] = n[key];
	x.sphere = n.sphere;
	x.sphere_of = meshHash(n.verts, n.faces);
	// (grass grows on it: extras.track `grass`, with a library)
	if (n.grass) x.grass = true;
	if (!(n.verts.length && n.faces.length)) {
		// (glTF has no empty mesh: kept as a node, with what it would hold)
		x.empty = true;
		x.material = n.material;
		x.verts = n.verts.length / VERT;
		return;
	}
	const s = splitRepeats(n.verts, n.faces);
	if (s.copies.length) {
		// (undone on the way back while the mesh stays as it is here)
		x.copies = s.copies;
		x.copies_of = meshHash(s.verts, s.faces);
	}
	const b = o.b;
	const nv = s.verts.length / VERT;
	const tan = new Float32Array(nv * 4);
	for (let r = 0; r < nv; r++) {
		tan.set(s.verts.subarray(r * VERT + 8, r * VERT + 11), r * 4);
		tan[r * 4 + 3] = 1;
	}
	const pos = columns(s.verts, VERT, 0, 3);
	const attributes = {
		POSITION: b.add(bytesOf(pos), nv, 3, FLOAT, "VEC3", 34962, pos),
		NORMAL: b.add(bytesOf(columns(s.verts, VERT, 3, 6)), nv, 3, FLOAT, "VEC3", 34962),
		TEXCOORD_0: b.add(bytesOf(columns(s.verts, VERT, 6, 8)), nv, 2, FLOAT, "VEC2", 34962),
		TANGENT: b.add(bytesOf(tan), nv, 4, FLOAT, "VEC4", 34962),
	};
	const small = nv < 65536;
	const idx = small ? Uint16Array.from(s.faces) : s.faces;
	const indices = b.add(bytesOf(idx), s.faces.length, 1, small ? USHORT : UINT, "SCALAR", 34963);
	o.meshes.push({ name: n.name, primitives: [{ attributes, indices, material: n.material, mode: 4 }] });
	g.mesh = o.meshes.length - 1;
}

/** A kn5 node and those under it as glTF nodes, in order; its own one's index. */
function nodeOut(o: GltfOut, n: Kn5Node): number {
	const i = o.nodes.length;
	const g: GltfNode = { name: n.name };
	o.nodes.push(g);
	const x: Kx = { active: n.active };
	if (n.kind === 1) {
		if (n.matrix.some((v, j) => v !== IDENTITY[j])) g.matrix = n.matrix;
	} else meshOut(o, n, g, x);
	g.extras = { kn5: x };
	if (n.kind === 2 && o.library?.nodeOut) {
		// (what the mesh is, as every game reads it: its own name, its role; AC's name and flags made from them)
		const [own, track, rest] = o.library.nodeOut(n.name, x);
		g.name = own;
		g.extras = { kn5: rest, track };
		if (g.mesh !== undefined) (o.meshes[g.mesh] as { name?: string }).name = own;
	}
	const kids = n.children.map((c) => nodeOut(o, c));
	if (kids.length) g.children = kids;
	return i;
}

/** The materials a mesh with a face on three corners uses (as Blender drops the rest). */
function usedMaterials(root: Kn5Node): Set<number> {
	const used = new Set<number>();
	for (const [n] of walk(root)) {
		if (n.kind !== 2) continue;
		const F = n.faces;
		for (let j = 0; j < F.length; j += 3)
			if (F[j] !== F[j + 1] && F[j + 1] !== F[j + 2] && F[j] !== F[j + 2]) {
				used.add(n.material);
				break;
			}
	}
	return used;
}

/** The materials a drawn mesh uses: one with faces, renderable and not a marker (so a marker's left-over one stands for none). */
function drawnMaterials(root: Kn5Node): Set<number> {
	const drawn = new Set<number>();
	for (const [n] of walk(root)) if (n.kind === 2 && n.faces.length && (n.renderable ?? 1) && !n.name.startsWith("AC_")) drawn.add(n.material);
	return drawn;
}

export function toGltf(k: Kn5, texUri: (t: Kn5Texture) => string | null, library?: MaterialLibrary): { doc: GltfDoc; bin: Uint8Array } {
	const b = new Bin();
	// (with a library, textures are kept as PNG: an AC name's file X.dds is X.png)
	const uriOf = (t: Kn5Texture) => {
		const u = texUri(t);
		if (u === null) return null;
		return library && u.toLowerCase().endsWith(".dds") ? `${u.slice(0, -4)}.png` : u;
	};
	// (an editor's model's own pictures: always inside it, never a file of the track's of their name)
	const ownTex = new Set(k.materials.filter((m) => m.own).flatMap((m) => m.textures.map((s) => s.name)));
	const images: GltfImage[] = k.textures.map((t) => {
		const u = ownTex.has(t.name) ? null : uriOf(t);
		if (u !== null) return { name: t.name, uri: quote(u) };
		return { name: t.name, bufferView: b.add(t.data, t.data.length, 1, 0, "RAW") as number, mimeType: mimeOf(t.data) };
	});
	const kept: Kx[] = [];
	const byName = new Map<string, number>();
	k.textures.forEach((t, i) => {
		if (!byName.has(t.name)) byName.set(t.name, i);
	});
	// (python's dict: the last of a name wins)
	k.textures.forEach((t, i) => {
		byName.set(t.name, i);
	});
	const textures = images.map((_, i) => ({ source: i }));
	const materials: GltfMaterial[] = k.materials.map((m) => {
		const [g, x] = materialOut(m, byName, library);
		kept.push(x);
		return g;
	});
	const nodes: GltfNode[] = [];
	const meshes: NonNullable<GltfDoc["meshes"]> = [];
	const root = nodeOut({ b, nodes, meshes, library }, k.root);
	// (used: by a mesh with a face on three corners, as Blender drops the rest)
	const used = usedMaterials(k.root);
	if (library) {
		// (each material's kn5 data into the library: a drawn mesh's, so a marker's left-over one stands for none)
		const drawn = drawnMaterials(k.root);
		materials.forEach((g, i) => {
			library.put(g.name ?? "", kept[i] as Kx, drawn.has(i) && used.has(i));
		});
	}
	const top: Kx = {
		version: k.version,
		extra: k.extra,
		// (a texture kept in the glb: no uri, its image by its name)
		textures: k.textures.map((t, i) => [t.name, t.active, images[i]?.uri ?? ""]),
		// (as Blender drops a material no mesh uses)
		unused_materials: materials.flatMap((g, i) => (used.has(i) ? [] : [[g.name ?? "", g.extras?.kn5 ?? null]])),
	};
	// (on the root node too: Blender drops the file's own extras, but keeps a node's)
	const rootKn5 = nodes[root]?.extras?.kn5 as Kx;
	rootKn5.file = top;
	const doc: GltfDoc = {
		asset: { version: "2.0", generator: GENERATOR },
		scene: 0,
		scenes: [{ nodes: [root] }],
		nodes,
		meshes,
		materials,
		textures,
		images,
		buffers: [{ byteLength: b.size }],
		bufferViews: b.views,
		accessors: b.accessors,
		extras: { kn5: top },
	};
	for (const key of ["meshes", "materials", "textures", "images", "bufferViews", "accessors"] as const) if (!doc[key]?.length) delete doc[key];
	const w = new Writer();
	for (const p of b.parts) w.bytes(p);
	return { doc, bin: w.done() };
}

/** A picture's media type by its first bytes (PNG, JPEG, else DDS: what a kn5 holds). */
function mimeOf(d: Uint8Array): string {
	if (d[0] === 0x89 && d[1] === 0x50) return "image/png";
	if (d[0] === 0xff && d[1] === 0xd8) return "image/jpeg";
	return "image/vnd-ms.dds";
}

export function writeGlb(doc: GltfDoc, bin: Uint8Array): Uint8Array {
	const js = new TextEncoder().encode(JSON.stringify(doc));
	const jsPad = -js.length & 3;
	const binPad = -bin.length & 3;
	const w = new Writer()
		.u32(GLB)
		.u32(2)
		.u32(12 + 8 + js.length + jsPad + 8 + bin.length + binPad);
	w.u32(js.length + jsPad)
		.u32(JSON_CHUNK)
		.bytes(js)
		.bytes(new Uint8Array(jsPad).fill(0x20));
	w.u32(bin.length + binPad)
		.u32(BIN_CHUNK)
		.bytes(bin)
		.bytes(new Uint8Array(binPad));
	return w.done();
}

export function readGlb(b: Uint8Array): { doc: GltfDoc; bin: Uint8Array } {
	const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
	if (dv.getUint32(0, true) !== GLB) throw new Error("not a glTF binary");
	let p = 12;
	let doc: GltfDoc | null = null;
	let bin: Uint8Array = new Uint8Array(0);
	while (p < b.length) {
		const n = dv.getUint32(p, true);
		const kind = dv.getUint32(p + 4, true);
		const chunk = b.subarray(p + 8, p + 8 + n);
		if (kind === JSON_CHUNK) doc = JSON.parse(new TextDecoder().decode(chunk)) as GltfDoc;
		else if (kind === BIN_CHUNK) bin = chunk;
		p += 8 + n;
	}
	if (!doc) throw new Error("a glTF binary without its document");
	return { doc, bin };
}

// ---- glb -> kn5 ------------------------------------------------------------------------------------------------

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** An accessor's numbers: rows of its components; floats (or normalized) as 32-bit floats. */
export function accessor(doc: GltfDoc, bin: Uint8Array, i: number): { data: Float32Array | Uint32Array; n: number } {
	const a = doc.accessors?.[i];
	const v = a && doc.bufferViews?.[a.bufferView];
	if (!a || !v) throw new Error(`no accessor ${i}`);
	const n = COMPONENTS[a.type] ?? 1;
	const size: Record<number, number> = { 5126: 4, 5123: 2, 5125: 4, 5121: 1, 5120: 1, 5122: 2 };
	const item = size[a.componentType] ?? 4;
	const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
	const stride = v.byteStride || item * n;
	const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
	const read: Record<number, (o: number) => number> = {
		5126: (o) => dv.getFloat32(o, true),
		5123: (o) => dv.getUint16(o, true),
		5125: (o) => dv.getUint32(o, true),
		5121: (o) => dv.getUint8(o),
		5120: (o) => dv.getInt8(o),
		5122: (o) => dv.getInt16(o, true),
	};
	const get = read[a.componentType] ?? read[5126];
	const max: Record<number, number> = { 5123: 65535, 5125: 4294967295, 5121: 255, 5120: 127, 5122: 32767 };
	const float = a.componentType === FLOAT || a.normalized;
	const out = float ? new Float32Array(a.count * n) : new Uint32Array(a.count * n);
	for (let r = 0; r < a.count; r++)
		for (let c = 0; c < n; c++) {
			const x = (get as (o: number) => number)(start + r * stride + c * item);
			out[r * n + c] = a.normalized && a.componentType !== FLOAT ? x / (max[a.componentType] ?? 1) : x;
		}
	return { data: out, n };
}

/** A glTF node's local matrix, as kn5 stores one: 16 floats, rows taking row vectors. */
export function nodeMatrix(g: GltfNode): number[] {
	if (g.matrix) return g.matrix.map(Number);
	const t = g.translation ?? [0, 0, 0];
	const [x, y, z, w] = (g.rotation ?? [0, 0, 0, 1]) as [number, number, number, number];
	const s = g.scale ?? [1, 1, 1];
	const r = [
		[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
		[2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
		[2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
	].map((row) => row.map((v, j) => v * (s[j] as number)));
	const m = [
		[...(r[0] as number[]), t[0] as number],
		[...(r[1] as number[]), t[1] as number],
		[...(r[2] as number[]), t[2] as number],
		[0, 0, 0, 1],
	];
	// (its transpose, row after row)
	const out: number[] = [];
	for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) out.push((m[i] as number[])[j] as number);
	return out;
}

const cornerOf = (faces: ArrayLike<number>, k: number, c: number) => faces[k * 3 + c] as number;

/** Per-vertex tangents from the uv layout, square to the normals (32-bit floats, as numpy works them out: the faces' added to their corners in order, the first
 * corners of every face first). */
export function tangents(pos: Float32Array, nor: Float32Array, uv: Float32Array, faces: ArrayLike<number>): Float32Array {
	const nv = pos.length / 3;
	const nf = faces.length / 3;
	const tan = new Float32Array(nv * 3);
	const t = new Float32Array(nf * 3);
	const tiny = f(1e-12);
	for (let k = 0; k < nf; k++) {
		const a = cornerOf(faces, k, 0);
		const b = cornerOf(faces, k, 1);
		const c = cornerOf(faces, k, 2);
		const e1 = [0, 1, 2].map((i) => f((pos[b * 3 + i] as number) - (pos[a * 3 + i] as number)));
		const e2 = [0, 1, 2].map((i) => f((pos[c * 3 + i] as number) - (pos[a * 3 + i] as number)));
		const d1 = [0, 1].map((i) => f((uv[b * 2 + i] as number) - (uv[a * 2 + i] as number)));
		const d2 = [0, 1].map((i) => f((uv[c * 2 + i] as number) - (uv[a * 2 + i] as number)));
		const det = f(f((d1[0] as number) * (d2[1] as number)) - f((d2[0] as number) * (d1[1] as number)));
		const ok = Math.abs(det) > tiny;
		for (let i = 0; i < 3; i++) {
			const x = f(f(f((e1[i] as number) * (d2[1] as number)) - f((e2[i] as number) * (d1[1] as number))) / (ok ? det : 1));
			t[k * 3 + i] = ok ? x : (e1[i] as number);
		}
	}
	for (let c = 0; c < 3; c++)
		for (let k = 0; k < nf; k++) {
			const v = cornerOf(faces, k, c);
			for (let i = 0; i < 3; i++) tan[v * 3 + i] = f((tan[v * 3 + i] as number) + (t[k * 3 + i] as number));
		}
	return squareToNormals(tan, nor);
}

/** Tangents made square to the normals and unit (32-bit floats, as numpy); [1, 0, 0] where none is left. */
function squareToNormals(tan: Float32Array, nor: Float32Array): Float32Array {
	const nv = tan.length / 3;
	const out = new Float32Array(nv * 3);
	const tiny = f(1e-9);
	for (let v = 0; v < nv; v++) {
		const T = [0, 1, 2].map((i) => tan[v * 3 + i] as number);
		const N = [0, 1, 2].map((i) => nor[v * 3 + i] as number);
		const dot = f(f(f((T[0] as number) * (N[0] as number)) + f((T[1] as number) * (N[1] as number))) + f((T[2] as number) * (N[2] as number)));
		const S = [0, 1, 2].map((i) => f((T[i] as number) - f((N[i] as number) * dot)));
		const ln = f(Math.sqrt(f(f(f((S[0] as number) ** 2) + f((S[1] as number) ** 2)) + f((S[2] as number) ** 2))));
		if (ln > tiny) for (let i = 0; i < 3; i++) out[v * 3 + i] = f((S[i] as number) / Math.max(ln, tiny));
		else out[v * 3] = 1;
	}
	return out;
}

/** Vertex normals from the faces round them (32-bit floats, as numpy: each face's cross added to its corners). */
function vertexNormals(pos: Float32Array, faces: ArrayLike<number>): Float32Array {
	const nv = pos.length / 3;
	const nf = faces.length / 3;
	const fn = new Float32Array(nf * 3);
	for (let k = 0; k < nf; k++) {
		const a = cornerOf(faces, k, 0);
		const b = cornerOf(faces, k, 1);
		const c = cornerOf(faces, k, 2);
		const u = [0, 1, 2].map((i) => f((pos[b * 3 + i] as number) - (pos[a * 3 + i] as number)));
		const w = [0, 1, 2].map((i) => f((pos[c * 3 + i] as number) - (pos[a * 3 + i] as number)));
		for (let i = 0; i < 3; i++) {
			const j = (i + 1) % 3;
			const l = (i + 2) % 3;
			fn[k * 3 + i] = f(f((u[j] as number) * (w[l] as number)) - f((u[l] as number) * (w[j] as number)));
		}
	}
	const nor = new Float32Array(nv * 3);
	for (let c = 0; c < 3; c++)
		for (let k = 0; k < nf; k++) {
			const v = cornerOf(faces, k, c);
			for (let i = 0; i < 3; i++) nor[v * 3 + i] = f((nor[v * 3 + i] as number) + (fn[k * 3 + i] as number));
		}
	const tiny = f(1e-12);
	for (let v = 0; v < nv; v++) {
		const ln = f(Math.sqrt(f(f(f((nor[v * 3] as number) ** 2) + f((nor[v * 3 + 1] as number) ** 2)) + f((nor[v * 3 + 2] as number) ** 2))));
		for (let i = 0; i < 3; i++) nor[v * 3 + i] = f((nor[v * 3 + i] as number) / Math.max(ln, tiny));
	}
	return nor;
}

/** A mesh's sphere: measured round its corners (32-bit floats, as numpy). */
export function measureSphere(verts: Float32Array): number[] {
	const n = verts.length / VERT;
	if (!n) return [0, 0, 0, 0];
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (let v = 0; v < n; v++)
		for (let i = 0; i < 3; i++) {
			const x = verts[v * VERT + i] as number;
			if (x < (lo[i] as number)) lo[i] = x;
			if (x > (hi[i] as number)) hi[i] = x;
		}
	const c = [0, 1, 2].map((i) => f(f((lo[i] as number) + (hi[i] as number)) / 2));
	let r = 0;
	for (let v = 0; v < n; v++) {
		const d = [0, 1, 2].map((i) => f((verts[v * VERT + i] as number) - (c[i] as number)));
		const len = f(Math.sqrt(f(f(f((d[0] as number) ** 2) + f((d[1] as number) ** 2)) + f((d[2] as number) ** 2))));
		if (len > r) r = len;
	}
	return [...c, r];
}

/** The kn5's own sphere while the mesh is as it was, else one measured round it. */
function sphereOf(verts: Float32Array, faces: Uint16Array, x: Kx, moved: boolean): number[] {
	if (!moved && "sphere" in x && x.sphere_of === meshHash(verts, faces)) return numbers(x.sphere);
	return measureSphere(verts);
}

/** A mesh split into pieces each within the 65536 corners a kn5 mesh can index. */
export function* chunks(verts: Float32Array, faces: Uint32Array): Generator<[Float32Array, Uint16Array]> {
	const nv = verts.length / VERT;
	if (nv < 65536) {
		yield [verts, Uint16Array.from(faces)];
		return;
	}
	const nf = faces.length / 3;
	let start = 0;
	while (start < nf) {
		const { v, fs, end } = chunkAt(verts, faces, start);
		yield [v, fs];
		start = end;
	}
}

/** The piece of a mesh from face start on, as many faces as fit in 65536 corners: its corners (numbered anew as its faces reach them), its faces, and the face
 * after its last. */
function chunkAt(verts: Float32Array, faces: Uint32Array, start: number): { v: Float32Array; fs: Uint16Array; end: number } {
	const nf = faces.length / 3;
	const used = new Map<number, number>();
	let end = start;
	while (end < nf && used.size + 3 <= 65535) {
		for (let c = 0; c < 3; c++) {
			const v = faces[end * 3 + c] as number;
			if (!used.has(v)) used.set(v, used.size);
		}
		end++;
	}
	const v = new Float32Array(used.size * VERT);
	for (const [old, i] of used) v.set(verts.subarray(old * VERT, (old + 1) * VERT), i * VERT);
	const fs = new Uint16Array((end - start) * 3);
	for (let j = start * 3; j < end * 3; j++) fs[j - start * 3] = used.get(faces[j] as number) as number;
	return { v, fs, end };
}

/** A material of the library (its data, library.get's) as a kn5's. */
export const libraryMaterial = (name: string, x: Kx): Kn5Material => material(name, x);

/** A name of the kn5 data (a shader's, a prop's, a sampler's, a texture's) as text: one is text, as the kn5 data holds it. */
const text = (v: PyValue | undefined): string => String(v as string);

function material(name: string, x: Kx): Kn5Material {
	const rest = (x.rest ?? {}) as Kx;
	const hex = (s: string) => Uint8Array.from((s.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
	return {
		name,
		shader: text(x.shader),
		blend: Number(x.blend),
		alpha_tested: Number(x.alpha_tested),
		depth_mode: x.depth_mode == null ? null : Number(x.depth_mode),
		props: ((x.props ?? []) as PyValue[][]).map(([n, v]) => {
			const prop = text(n);
			return {
				name: prop,
				value: Number(v),
				rest: typeof rest[prop] === "string" ? hex(rest[prop] as string) : new Uint8Array(36),
			};
		}),
		textures: ((x.textures ?? []) as PyValue[][]).map(([s, i, t]) => ({
			sampler: text(s),
			slot: Number(i),
			name: text(t),
		})),
	};
}

const defaultProps = () => DEFAULT_PROPS.map(([name, value]) => ({ name, value, rest: new Uint8Array(36) }));

/** A plain material of one picture (ksPerPixel, opaque, the default props), as a model made with none is given. */
export const pictureMaterial = (name: string, picture: string): Kn5Material => ({
	name,
	shader: "ksPerPixel",
	blend: 0,
	alpha_tested: 0,
	depth_mode: 0,
	props: defaultProps(),
	textures: [{ sampler: "txDiffuse", slot: 0, name: picture }],
});

/** A dummy's or a mesh's flag, as the kn5 data has it, else its default. */
const flag = (x: Kx, key: string, d: number) => (x[key] == null ? d : Number(x[key]));

/** The kn5 file's own data: the document's extras, else (Blender drops the file's own extras, but keeps a node's) a node's. */
function fileData(doc: GltfDoc): Kx {
	const own = kn5Of(doc);
	if (Object.keys(own).length) return own;
	for (const n of doc.nodes ?? []) {
		const x = kn5Of(n);
		if ("file" in x) return x.file as Kx;
	}
	return {};
}

/** An image's bytes: its file's (readTexture's), else those the glb holds of it. */
async function imageData(doc: GltfDoc, bin: Uint8Array, img: GltfImage, readTexture: (uri: string) => Promise<Uint8Array>): Promise<Uint8Array> {
	if (img.uri !== undefined) return readTexture(unquote(img.uri));
	const v = doc.bufferViews?.[img.bufferView ?? -1];
	if (!v) throw new Error("an image with no data");
	const at = v.byteOffset ?? 0;
	return bin.slice(at, at + v.byteLength);
}

/** An image's texture name: its own, its file's, else by its place among the document's images. */
const imageName = (images: GltfImage[], img: GltfImage) => img.name || basename(unquote(img.uri ?? "")) || `texture${images.indexOf(img)}.png`;

/** The kn5's textures, the kn5's own in their order (the file data's list of them), then any the model gained; and their names. */
async function readTextures(
	doc: GltfDoc,
	bin: Uint8Array,
	top: Kx,
	readTexture: (uri: string) => Promise<Uint8Array>,
): Promise<{ texs: Kn5Texture[]; names: string[] }> {
	const images = doc.images ?? [];
	const texs: Kn5Texture[] = [];
	const names: string[] = [];
	for (const [name, active, uri] of (top.textures ?? []) as [string, number, string][]) {
		const inside = uri ? undefined : images.find((img) => img.uri === undefined && imageName(images, img) === name);
		texs.push({ name, active, data: inside ? await imageData(doc, bin, inside, readTexture) : await readTexture(unquote(uri)) });
		names.push(name);
	}
	for (const img of images)
		if (!names.includes(imageName(images, img))) {
			texs.push({ name: imageName(images, img), active: 1, data: await imageData(doc, bin, img, readTexture) });
			names.push(imageName(images, img));
		}
	return { texs, names };
}

/** The texture name of a material's picture (its texture's image's), null: none. */
function texName(doc: GltfDoc, info?: { index: number }): string | null {
	if (!info) return null;
	const images = doc.images ?? [];
	const img = images[doc.textures?.[info.index]?.source ?? -1];
	return img ? imageName(images, img) : null;
}

/** A material with no kn5 data (one made in Blender) as a plain ksPerPixel one: its pictures, its alpha mode, the default props. */
function plainMaterial(doc: GltfDoc, g: GltfMaterial, name: string): Kn5Material {
	const diffuse = texName(doc, g.pbrMetallicRoughness?.baseColorTexture);
	const normal = texName(doc, g.normalTexture);
	const alpha = g.alphaMode === "MASK";
	const slots: [string, string | null][] = [["txDiffuse", diffuse], ...(normal ? [["txNormal", normal] as [string, string]] : [])];
	return {
		name,
		shader: `ksPerPixel${alpha ? "AT" : ""}${normal ? "_NM" : ""}`,
		blend: g.alphaMode === "BLEND" ? 1 : 0,
		alpha_tested: alpha ? 1 : 0,
		depth_mode: 0,
		props: defaultProps(),
		textures: slots.flatMap(([sampler, t], slot) => (t ? [{ sampler, slot, name: t }] : [])),
	};
}

/** The kn5's materials: the document's (by their kn5 data, the library's, else plain ones), then those no mesh uses (as Blender drops them); one by default
 * where there are none. */
function readMaterials(doc: GltfDoc, top: Kx, library?: MaterialLibrary): Kn5Material[] {
	const mats: Kn5Material[] = [];
	for (const g of doc.materials ?? []) {
		let x = kn5Of(g);
		const name = (g.name ?? "material").replace(BLENDER_COPY, "");
		// (a model holding only its material's name: the library's data)
		if (!Object.keys(x).length && library) x = library.get(name) ?? {};
		mats.push(Object.keys(x).length ? material(name, x) : plainMaterial(doc, g, name));
		if ((g.extras as { track?: { own?: boolean } } | undefined)?.track?.own) (mats.at(-1) as Kn5Material).own = true;
	}
	for (const [name, x] of (top.unused_materials ?? []) as [string, Kx | null][])
		if (!mats.some((m) => m.name === name) && (x || library?.get(name))) mats.push(material(name, x ?? (library?.get(name) as Kx)));
	if (!mats.length)
		mats.push({
			name: "default",
			shader: "ksPerPixel",
			blend: 0,
			alpha_tested: 0,
			depth_mode: 0,
			props: defaultProps(),
			textures: [],
		});
	return mats;
}

/** The bytes of a texture material m names that the model lacks, as findTexture finds them; null: not found, where the document lists its textures (else
 * that is an error). */
async function missingTexture(m: Kn5Material, t: Kn5Slot, listed: boolean, findTexture?: (name: string) => Promise<Uint8Array>): Promise<Uint8Array | null> {
	if (!findTexture) {
		if (listed) return null;
		throw new Error(`material ${m.name} names texture ${t.name}, which the model lacks`);
	}
	try {
		return await findTexture(t.name);
	} catch (e) {
		if (listed) return null;
		throw e;
	}
}

/** A glTF document being read as a kn5: the document, its binary chunk, the material library. */
interface GltfIn {
	doc: GltfDoc;
	bin: Uint8Array;
	library?: MaterialLibrary;
}

/** A primitive's nv corners as a kn5 mesh's (point, normal, uv and tangent in each; normals and tangents worked out where it has none), its node's local
 * matrix baked in when it moves them; and its faces. */
function primVerts(c: GltfIn, prim: GltfPrimitive, local: number[], moved: boolean): { verts: Float32Array; faces: Uint32Array; nv: number } {
	const { doc, bin } = c;
	const at = prim.attributes;
	let pos: Float32Array = Float32Array.from(accessor(doc, bin, at.POSITION as number).data);
	const nv = pos.length / 3;
	const faces = prim.indices !== undefined ? Uint32Array.from(accessor(doc, bin, prim.indices).data) : Uint32Array.from({ length: nv }, (_, i) => i);
	let nor: Float32Array | null = at.NORMAL !== undefined ? Float32Array.from(accessor(doc, bin, at.NORMAL).data) : null;
	const uv = at.TEXCOORD_0 !== undefined ? Float32Array.from(accessor(doc, bin, at.TEXCOORD_0).data) : new Float32Array(nv * 2);
	let tan: Float32Array | null = null;
	if (at.TANGENT !== undefined) tan = columns(Float32Array.from(accessor(doc, bin, at.TANGENT).data), 4, 0, 3);
	if (moved) [pos, nor, tan] = moveBy(local, pos, nor, tan);
	nor ??= vertexNormals(pos, faces);
	tan ??= tangents(pos, nor, uv, faces);
	const verts = new Float32Array(nv * VERT);
	for (let v = 0; v < nv; v++) {
		verts.set(pos.subarray(v * 3, v * 3 + 3), v * VERT);
		verts.set(nor.subarray(v * 3, v * 3 + 3), v * VERT + 3);
		verts.set(uv.subarray(v * 2, v * 2 + 2), v * VERT + 6);
		verts.set(tan.subarray(v * 3, v * 3 + 3), v * VERT + 8);
	}
	return { verts, faces, nv };
}

/** A piece of a mesh as a kn5 mesh: its flags from its kn5 data x, its sphere the kn5's own while it is as it was. */
function kn5Mesh(name: string, x: Kx, v: Float32Array, fs: Uint16Array, mat: number, moved: boolean): Kn5Mesh {
	const n: Kn5Mesh = {
		kind: 2,
		name,
		active: flag(x, "active", 1),
		children: [],
		verts: v,
		faces: fs,
		material: mat,
		cast_shadows: flag(x, "cast_shadows", 1),
		visible: flag(x, "visible", 1),
		transparent: flag(x, "transparent", 0),
		layer: flag(x, "layer", 0),
		lod_in: flag(x, "lod_in", 0),
		lod_out: flag(x, "lod_out", 0),
		renderable: flag(x, "renderable", 1),
		sphere: [],
	};
	if (x.grass) n.grass = true;
	n.sphere = sphereOf(v, fs, x, moved);
	return n;
}

/** The kn5 meshes of a glTF node with a mesh, its local matrix baked in. */
function meshNodes(c: GltfIn, g: GltfNode, name: string, x: Kx, local: number[]): Kn5Mesh[] {
	const out: Kn5Mesh[] = [];
	const moved = local.some((v, j) => v !== IDENTITY[j]);
	const prims = c.doc.meshes?.[g.mesh ?? -1]?.primitives ?? [];
	for (const prim of prims) {
		if ((prim.mode ?? 4) !== 4) throw new Error(`${name}: only triangles can go into a kn5`);
		const p = primVerts(c, prim, local, moved);
		let verts = p.verts;
		let F = p.faces;
		const copies = numbers(x.copies);
		if (copies.length && !moved && prims.length === 1 && x.copies_of === meshHash(verts, F)) {
			// (the corners added for the backs of two-sided faces, taken out again)
			const n0 = p.nv - copies.length;
			const back = (i: number) => (i < n0 ? i : (copies[i - n0] as number));
			F = F.map(back);
			verts = verts.slice(0, n0 * VERT);
		}
		for (const [v, fs] of chunks(verts, F)) out.push(kn5Mesh(name, x, v, fs, prim.material ?? 0, moved));
	}
	return out;
}

/** A glTF node and those under it as kn5 nodes: a mesh's (with a dummy for the nodes under it), an empty mesh kept as a node, or a dummy. */
function nodesIn(c: GltfIn, i: number): Kn5Node[] {
	const g = c.doc.nodes?.[i] ?? {};
	let name = (g.name ?? `node${i}`).replace(BLENDER_COPY, "");
	let x = kn5Of(g);
	const track = (g.extras as { track?: Kx } | undefined)?.track;
	// (AC's name and flags, from what the mesh is)
	if (track && c.library?.nodeIn) [name, x] = c.library.nodeIn(name, track, x);
	const local = nodeMatrix(g);
	const kids = (g.children ?? []).flatMap((k) => nodesIn(c, k));
	if (g.mesh !== undefined) {
		const own: Kn5Node[] = meshNodes(c, g, name, x, local);
		// (a mesh with nodes under it: they stay where they were, under a dummy that moves them)
		if (kids.length) own.push({ kind: 1, name, active: 1, matrix: local, children: kids });
		return own;
	}
	if (x.empty) {
		const n: Kn5Mesh = {
			kind: 2,
			name,
			active: flag(x, "active", 1),
			children: kids,
			verts: new Float32Array(0),
			faces: new Uint16Array(0),
			material: flag(x, "material", 0),
			sphere: x.sphere ? numbers(x.sphere) : [0, 0, 0, 0],
			cast_shadows: flag(x, "cast_shadows", 1),
			visible: flag(x, "visible", 1),
			transparent: flag(x, "transparent", 0),
			layer: flag(x, "layer", 0),
			lod_in: flag(x, "lod_in", 0),
			lod_out: flag(x, "lod_out", 0),
			renderable: flag(x, "renderable", 1),
		};
		if (x.grass) n.grass = true;
		return [n];
	}
	return [{ kind: 1, name, active: flag(x, "active", 1), matrix: local, children: kids }];
}

/** The kn5's extra number, as its file data has it (none there: 0). */
function extraOf(top: Kx): number | null {
	if (!("extra" in top)) return 0;
	return top.extra == null ? null : Number(top.extra);
}

/** A glTF document as a kn5. readTexture(uri) gives a texture file's bytes; findTexture(name), if given, those of a texture a material names that the document
 * does not point at, as after Blender, which can leave the textures out. */
export async function fromGltf(
	doc: GltfDoc,
	bin: Uint8Array,
	readTexture: (uri: string) => Promise<Uint8Array>,
	findTexture?: (name: string) => Promise<Uint8Array>,
	library?: MaterialLibrary,
): Promise<Kn5> {
	const top = fileData(doc);
	// (the kn5's own textures in their order, then any the model gained)
	const { texs, names } = await readTextures(doc, bin, top, readTexture);
	const mats = readMaterials(doc, top, library);
	// (the textures the materials name and the model lacks, found where the track keeps them: when the document lost its list of them, as after Blender, every
	// one must be; else (a material the model gained by name, as the engine adds paint and objects) those found. The game draws a texture a kn5 lacks with
	// another of its pictures)
	const listed = !!(top.textures as PyValue[] | undefined)?.length;
	for (const m of mats)
		for (const t of m.textures) {
			if (names.includes(t.name)) continue;
			const data = await missingTexture(m, t, listed, findTexture);
			if (data === null) continue;
			texs.push({ name: t.name, active: 1, data });
			names.push(t.name);
		}

	const c: GltfIn = { doc, bin, library };
	const roots = (doc.scenes[doc.scene ?? 0]?.nodes ?? []).flatMap((i) => nodesIn(c, i));
	const root: Kn5Node = roots.length === 1 && roots[0]?.kind === 1 ? roots[0] : { kind: 1, name: "root", active: 1, matrix: [...IDENTITY], children: roots };
	return {
		version: top.version == null ? 6 : Number(top.version),
		extra: extraOf(top),
		textures: texs,
		materials: mats,
		root,
	};
}

/** A matrix's number in row i, column j (16 floats, row after row). */
const cell = (m: number[], i: number, j: number) => m[i * 4 + j] as number;

/** A mesh's points, normals and tangents moved by a node's matrix (kn5's: rows taking row vectors). */
function moveBy(m: number[], pos: Float32Array, nor: Float32Array | null, tan: Float32Array | null): [Float32Array, Float32Array | null, Float32Array | null] {
	const n = pos.length / 3;
	const P = new Float32Array(n * 3);
	for (let v = 0; v < n; v++)
		for (let j = 0; j < 3; j++) {
			let s = 0;
			for (let i = 0; i < 3; i++) s += (pos[v * 3 + i] as number) * cell(m, i, j);
			P[v * 3 + j] = s + cell(m, 3, j);
		}
	return [P, nor ? moveNormals(m, nor, n) : null, tan ? turnBy(m, tan, n) : null];
}

/** n normals moved by a node's matrix: by the inverse's transpose of its turn, made unit. */
function moveNormals(m: number[], nor: Float32Array, n: number): Float32Array {
	const a = [0, 1, 2].map((i) => [0, 1, 2].map((j) => cell(m, i, j)));
	const r = (i: number, j: number) => (a[i] as number[])[j] as number;
	const det =
		r(0, 0) * (r(1, 1) * r(2, 2) - r(1, 2) * r(2, 1)) - r(0, 1) * (r(1, 0) * r(2, 2) - r(1, 2) * r(2, 0)) + r(0, 2) * (r(1, 0) * r(2, 1) - r(1, 1) * r(2, 0));
	const cof = (i: number, j: number) => {
		const rows = [0, 1, 2].filter((x) => x !== i);
		const cols = [0, 1, 2].filter((x) => x !== j);
		const [r0, r1] = rows as [number, number];
		const [c0, c1] = cols as [number, number];
		return ((i + j) % 2 ? -1 : 1) * (r(r0, c0) * r(r1, c1) - r(r0, c1) * r(r1, c0));
	};
	// (inv(a).T[i][j] = inv(a)[j][i] = cof(i, j) / det)
	const invT = (i: number, j: number) => cof(i, j) / det;
	const N = new Float32Array(n * 3);
	for (let v = 0; v < n; v++) {
		const out = [0, 1, 2].map((j) => {
			let s = 0;
			for (let i = 0; i < 3; i++) s += (nor[v * 3 + i] as number) * invT(i, j);
			return s;
		});
		const len = Math.max(Math.hypot(...out), 1e-12);
		for (let j = 0; j < 3; j++) N[v * 3 + j] = (out[j] as number) / len;
	}
	return N;
}

/** n directions (tangents) turned by a node's matrix: by its turn alone, not its move. */
function turnBy(m: number[], tan: Float32Array, n: number): Float32Array {
	const T = new Float32Array(n * 3);
	for (let v = 0; v < n; v++)
		for (let j = 0; j < 3; j++) {
			let s = 0;
			for (let i = 0; i < 3; i++) s += (tan[v * 3 + i] as number) * cell(m, i, j);
			T[v * 3 + j] = s;
		}
	return T;
}

// ---- files -----------------------------------------------------------------------------------------------------

/** What the engine reads a track's files through (the engine window's disk, Node's, a test's). */
export interface Files {
	read(path: string): Promise<Uint8Array>;
	exists(path: string): Promise<boolean>;
}

/** Paths joined and tidied ('..' and '.' taken out), with / between their parts. */
export function joinPath(...parts: string[]): string {
	const out: string[] = [];
	for (const seg of parts.join("/").split(/[\\/]+/)) {
		if (seg === "." || (seg === "" && out.length)) continue;
		if (seg === ".." && out.length && out.at(-1) !== ".." && !/^[A-Za-z]:$/.test(out.at(-1) ?? "")) out.pop();
		else out.push(seg);
	}
	return out.join("/");
}

export const dirname = (p: string): string => joinPath(p, "..");

/** A model as kn5 data, its textures read from where it points: ../textures beside its folder (source/textures, beside source/models); where there is none (a
 * model the track's steps made, in track/models), the track's source/textures, given or two folders up (gltf_source's textures_of, texture_at). */
export async function loadKn5(files: Files, glbPath: string, library?: MaterialLibrary, sourceTextures?: string): Promise<Kn5> {
	const { doc, bin } = readGlb(own(await files.read(glbPath)));
	const base = dirname(glbPath);
	const stem = basename(glbPath).replace(/\.[^.]*$/, "");
	const near = joinPath(base, "..", "textures");
	const textures = (await files.exists(near)) ? near : (sourceTextures ?? joinPath(base, "..", "..", "source", "textures"));
	// (a uri into ../textures read from the textures it means)
	const at = (uri: string) => {
		const p = joinPath(base, uri);
		return p.startsWith(`${near}/`) ? `${textures}${p.slice(near.length)}` : p;
	};
	// (a texture kept as PNG where its AC name is DDS: X.dds as X.png)
	const kept = async (p: string) =>
		!(await files.exists(p)) && p.toLowerCase().endsWith(".dds") && (await files.exists(`${p.slice(0, -4)}.png`)) ? `${p.slice(0, -4)}.png` : p;
	const find = async (name: string) => {
		// (one this model holds a version of its own of first, as the extraction left them)
		for (const p of [joinPath(textures, stem, name), joinPath(textures, name)]) {
			const q = await kept(p);
			if (await files.exists(q)) return files.read(q);
		}
		throw new Error(`texture ${name} of ${stem} is not in source/textures`);
	};
	return fromGltf(doc, bin, async (uri) => files.read(await kept(at(uri))), find, library);
}

export { f32sOf } from "./bin";
