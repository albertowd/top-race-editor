// rFactor 2's GMT, its meshes' binary file, as plain data and back to the same bytes. Its layout is not published (the only writer is Studio 397's 3ds Max
// plugin): what follows was worked out from ModDev's 762 samples, every one of which this reads and writes again byte for byte.
//
// Little-endian throughout; names in fixed fields, nul-ended (latin-1; what is past the nul is the exporter's memory, kept). Two layouts: "new" (750 samples:
// every track's and car's) and "old" (11: DevFiles/CamEd and FarSun); where they differ the old's is in brackets.
//
//   0x000  u32       where the materials are, from byte 4 (every offset in the file is from byte 4: the header,
//                    meshes, faces, planes, bones, vertices, indices and palettes are one block, then the materials)
//   0x004  u32       the object's flags: 0x04000000 on most (624 of 750), with 0x4000 skinned (bones), with 0x8
//                    billboards (crowds, 2D trees), 0x80000000 decals (lines, stripes, adverts), 0 on glows, shadow
//                    boxes and the timing beams (xfinish, xsector1, ...)
//   0x008  8 x 3f    the box's corners, from its least (bits x y z, 1 the most): 000 010 110 100 001 011 111 101
//   0x068  8 x 3f    the same again (on all but 12; zeros or turned on the old)
//   0x0c8  3f, 3f    the least and the most of the vertices' positions
//   0x0e0  f         the radius: the farthest vertex from the middle
//   0x0e4  3f, 3f    the middle ((least + most) / 2), twice
//   0x0fc  f         0
//   0x100  f, f      the distances it is drawn from and to (0 and 100 to 10000; 400 to 750 on LODs)
//   0x114  3f        its position (its pivot: the vertices are about it; 0 on most)
//   0x120  f         -0 on 51, else 0 (kept)
//   0x13c  6 x (u32 count, u32 pointer): vertices, indices, meshes, faces, planes, bones. Each pointer is where its part
//                    was in the exporter's memory (from byte 4): a 32-bit exporter's are the file's own; a 64-bit's
//                    (575 of LochDrummond's, their meshes' pointer 968) have its records' sizes in memory (header 968,
//                    mesh 224, face 40, bone 248); the old's bones pointer is an address. The game reads the parts in
//                    order and cannot need them (the 64-bit ones point nowhere in the file).
//   0x16c  4 x u32   0
//   0x17c  64 bytes  its name
//   0x1bc  16 bytes  the exporter's mark: c8cfd2d8ced8e6c3d6ded8bebbab c190 (new), ...bf90 (old). The same in every
//                    file of a layout whatever its content, name or size: not a checksum or hash, nor a GUID. Every
//                    byte has its top bit set (no hash looks so): most likely a version string scrambled (no simple
//                    sum or XOR turns it into text), its 15th byte 2 higher in the newer layout. Kept as the samples
//                    have it.
//   0x1ec  f         a second distance (50 to 500 on 304, else 0: what it limits is not known)
//   to 0x378 [0x2cc] 0
//
// Then, one after another:
//
//   meshes   156 [136] bytes each: u32 flags (0x4080 [0x80]; 0x20004080 on one skinned figure), u32 vertices,
//            u32 indices (at 12), u32 its first vertex (24) and first index (32) in the file's, u32 its material (36),
//            u32 its palette's bones (92) and a pointer to them (96: as the header's pointers); the rest 0 [the old's
//            words 14 (-1), 23 and 25 (addresses), kept]
//   faces    32 bytes each, one per triangle: u16 x 3 corners (the file's vertex numbers, within the face's mesh; the
//            same triangles as the index buffer's but in another order, and a corner may name another vertex at the
//            same place: welded), u16 the axis its plane's normal is nearest (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z),
//            u32 its mesh, u32 its plane, 3f its middle (near the corners' mean, not it: within 1% of the radius on
//            all but 180 of 2.48 million), f its radius (the farthest corner from that middle, in float32 steps:
//            exactly so on 99%; it covers the corners on all)
//   planes   16 bytes each: 3f the normal, (c - a) x (b - a) made whole (the faces are wound clockwise seen from the
//            front), u32 its smoothing groups (3ds Max's bits: 1 on most); shared by faces of one smoothing group,
//            listed as the faces first use them
//   bones    240 bytes each: u32 0, u32 its number, u32 its parent's (most 0xffffffff, none), 32 bytes its name,
//            196 bytes (its matrices: not read)
//   vertices 96 [128] bytes each: 3f position, 3f normal, u32 colour (ARGB, 0xffffffff), u32 a second (0,
//            0xffffffff, or 1.0 as a float on Joesville's), u8 x 4 bones (into its mesh's palette), u8 x 4: three
//            weights (255 the whole) and how many bones count (255 0 0 0 unskinned; four alike on crowds),
//            3f tangent, 3f binormal (0 where the exporter made none), then 2f x 4 [x 8] UV sets from 64
//   indices  u16, three a triangle, mesh by mesh, from the mesh's first vertex (at most 61702 vertices in a file)
//   palettes a u8 bone number each, mesh by mesh
//   u32      how many materials, then each:
//     64 bytes its name, u32 flags (0x68902003 on most; 0x68902023 blended), 4 x 4f colours (ambient, diffuse,
//     specular, emissive: so in 3ds Max's material, the order assumed), u32 x 2 its blending (Direct3D's: 2 1 opaque,
//     5 6 alpha), f its specular power, [new only] u32 0 (1 on two)
//     new: one shader: 64 bytes its name (L2DIFFUSET0, L2IBLSTANDARD, ...), 11 words (5.0 0.1 0.9 on most), u32 how
//       many textures, then its textures
//     old: three shader levels (L0, L1, L2), 264 bytes each: u32 its first texture, u32 how many, 64 bytes its name,
//       48 words; then 8 words, u32 how many textures in all, then them
//     a texture: 64 bytes its name (X.DDS, X.TGA), u16 flags (0x18 on most), u16 0x20 or 0, i32 -1, u32 1 or its
//       frames: where not 1, an animation (u32 n, n frame numbers, u32, f its rate), then 26 [24] words (on most
//       1 3 1.0 0 0 0 1 0 1.0 0 0.1 0.9 5.0 and 0s; the newer exporter's 1 0 ... with its stage, 0 1 2, at the
//       fourth)
//
// Not known, and not needed to read or write one again: what most flag bits mean, the shaders' and textures' words (beyond those above), what a bone's 196
// bytes hold, and the mark's plain text. The game loads the samples loose as they are (no signature beside them): a written GMT differs from the exporter's
// only in what it is given.
//
// One sample (Joesville's pcrew_maps/PIT_HELMET.GMT) is scrambled, as a protected mod's are: 16 bytes, then an old layout GMT XORed with a key of 8 bytes
// repeated, a new key every 64 bytes (from the file's byte 12); where the plain text is zeros the key shows, and so its header reads (408 vertices, its name
// pit_helmet, the old mark). Its keys come from no rule found here: it is kept as its bytes.
//
// Read, each record keeps its bytes (`raw`) only where its fields do not make them again: the junk after a name's nul, the header's words at 0x120, the old's
// addresses. Written, a record with no raw is made from its fields alone.
import { latin1 } from "../bin";

export type Vec3 = [number, number, number];
export type Rgba = [number, number, number, number];

/** the two layouts the samples have */
export type GmtLayout = "old" | "new";

interface Layout {
	/** where the header ends, the meshes begin */
	header: number;
	mesh: number;
	vertex: number;
	uvSets: number;
	texture: number;
	/** a material's shader levels (each with its textures) */
	levels: number;
	tag: string;
}

const LAYOUTS: Record<GmtLayout, Layout> = {
	old: {
		header: 0x2cc,
		mesh: 136,
		vertex: 128,
		uvSets: 8,
		texture: 172,
		levels: 3,
		tag: "c8cfd2d8ced8e6c3d6ded8bebbabbf90",
	},
	new: {
		header: 0x378,
		mesh: 156,
		vertex: 96,
		uvSets: 4,
		texture: 180,
		levels: 1,
		tag: "c8cfd2d8ced8e6c3d6ded8bebbabc190",
	},
};

const FACE = 32;
const PLANE = 16;
const BONE = 240;
/** a material's name, flags, colours and blending (and in the new layout one word more) */
const headSize = (L: Layout) => (L.levels === 1 ? 148 : 144);
const SHADER_NEW = 112;
const SHADER_OLD = 264;
const OLD_TAIL = 32;
const NAME = 64;
const BONE_NAME = 32;

export interface GmtVertex {
	position: Vec3;
	normal: Vec3;
	/** at 24, ARGB */
	colour: number;
	/** at 28 */
	colour2: number;
	/** at 32: four bone numbers (into the mesh's palette) */
	bones: number[];
	/** at 36: three weights (255 the whole) and how many bones count */
	weights: number[];
	tangent: Vec3;
	binormal: Vec3;
	/** from 64: 4 sets (new layout) or 8 (old) */
	uv: [number, number][];
}

export interface GmtFace {
	/** into the GMT's meshes */
	mesh: number;
	/** the file's vertex numbers (all its meshes' vertices in turn), within the face's mesh */
	corners: [number, number, number];
	/** the axis its normal is nearest: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z */
	axis: number;
	/** into the GMT's planes */
	plane: number;
	centre: Vec3;
	radius: number;
}

export interface GmtPlane {
	normal: Vec3;
	/** its faces' smoothing groups (bits) */
	flags: number;
}

export interface GmtMesh {
	/** word 0: 0x4080 (0x80 old) */
	flags: number;
	/** into the GMT's materials */
	material: number;
	vertices: GmtVertex[];
	/** its triangles as drawn, three each, from its first vertex (16-bit) */
	indices: number[];
	/** the bones its vertices name, into the GMT's bones */
	palette: number[];
	/** the record as stored, where it holds more than the fields above */
	raw?: Uint8Array;
}

export interface GmtBone {
	name: string;
	/** words 0, 1, 2: 0, its number, its parent's (0xffffffff none) */
	head: [number, number, number];
	/** from 44 to its end (240) */
	data: Uint8Array;
	raw?: Uint8Array;
}

export interface GmtAnimation {
	frames: number[];
	next: number;
	rate: number;
}

export interface GmtTexture {
	name: string;
	flags: number;
	flags2: number;
	/** at 68 */
	word68: number;
	/** at 72: 1, or the frames of an animated one */
	count: number;
	/** when count is not 1 */
	animation?: GmtAnimation;
	/** the words after (26 new, 24 old) */
	settings: number[];
	raw?: Uint8Array;
}

export interface GmtShader {
	name: string;
	/** the words after the name (11 new, 48 old) */
	params: number[];
	textures: GmtTexture[];
	raw?: Uint8Array;
}

export interface GmtMaterial {
	name: string;
	flags: number;
	ambient: Rgba;
	diffuse: Rgba;
	specular: Rgba;
	emissive: Rgba;
	srcBlend: number;
	destBlend: number;
	specularPower: number;
	word144: number;
	/** one (new layout) or three levels, L0 to L2 (old) */
	shaders: GmtShader[];
	/** old layout: the 8 words after the levels */
	tail?: number[];
	raw?: Uint8Array;
}

export interface GmtBox {
	corners: Vec3[];
	corners2: Vec3[];
	min: Vec3;
	max: Vec3;
	radius: number;
	centre: Vec3;
	centre2: Vec3;
}

export interface Gmt {
	kind: "gmt";
	layout: GmtLayout;
	/** the exporter's: the header's and the meshes' pointers (where each part was in its memory, from byte 4) made again from it */
	bits: 32 | 64;
	flags: number;
	name: string;
	box: GmtBox;
	/** the distances it is seen from and to */
	lod: [number, number];
	/** at 0x1ec */
	distance2: number;
	position: Vec3;
	meshes: GmtMesh[];
	faces: GmtFace[];
	planes: GmtPlane[];
	bones: GmtBone[];
	materials: GmtMaterial[];
	/** the header as stored (0x04 to its end), where it holds more than the fields above */
	header?: Uint8Array;
}

/** a GMT whose bytes are scrambled (a protected mod's), kept as it is */
export interface GmtEncrypted {
	kind: "encrypted";
	bytes: Uint8Array;
}

// ---- bytes ------------------------------------------------------------------------------------------------------

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (x) => Number.parseInt(x, 16));

function nameAt(b: Uint8Array, at: number, len: number): string {
	const s = b.subarray(at, at + len);
	const z = s.indexOf(0);
	return latin1.decode(z < 0 ? s : s.subarray(0, z));
}

function same(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** Numbers at places in a byte array. */
class Bytes {
	readonly v: DataView;
	constructor(readonly b: Uint8Array) {
		this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
	}
	u8 = (at: number) => this.v.getUint8(at);
	u16 = (at: number) => this.v.getUint16(at, true);
	u32 = (at: number) => this.v.getUint32(at, true);
	i32 = (at: number) => this.v.getInt32(at, true);
	f32 = (at: number) => this.v.getFloat32(at, true);
	vec3 = (at: number): Vec3 => [this.f32(at), this.f32(at + 4), this.f32(at + 8)];
	rgba = (at: number): Rgba => [this.f32(at), this.f32(at + 4), this.f32(at + 8), this.f32(at + 12)];
	u32s = (at: number, n: number) => Array.from({ length: n }, (_, i) => this.u32(at + i * 4));
	setU8 = (at: number, x: number) => this.v.setUint8(at, x);
	setU16 = (at: number, x: number) => this.v.setUint16(at, x, true);
	setU32 = (at: number, x: number) => this.v.setUint32(at, x >>> 0, true);
	setI32 = (at: number, x: number) => this.v.setInt32(at, x, true);
	setF32 = (at: number, x: number) => this.v.setFloat32(at, x, true);
	setFloats(at: number, xs: readonly number[]): void {
		for (const [i, x] of xs.entries()) this.setF32(at + i * 4, x);
	}
	setU32s(at: number, xs: readonly number[]): void {
		for (const [i, x] of xs.entries()) this.setU32(at + i * 4, x);
	}
	/** a name in a fixed field, nul-padded (left as it is where the field already reads as it: what was after the exporter's nul kept) */
	setName(at: number, len: number, s: string): void {
		if (nameAt(this.b, at, len) === s) return;
		const e = latin1.encode(s);
		if (e.length >= len) throw new Error(`${JSON.stringify(s)}: longer than ${len - 1} characters`);
		this.b.fill(0, at, at + len);
		this.b.set(e, at);
	}
}

/** A record: its bytes as stored where given (what the fields do not hold kept), else zeros, the fields written over. */
function record(size: number, raw: Uint8Array | undefined, put: (r: Bytes, fresh: boolean) => void): Uint8Array {
	const b = new Uint8Array(size);
	if (raw && raw.length === size) b.set(raw);
	put(new Bytes(b), !(raw && raw.length === size));
	return b;
}

/** The record's bytes kept only where the fields do not make them again. */
function rawUnless(stored: Uint8Array, again: Uint8Array): Uint8Array | undefined {
	return same(stored, again) ? undefined : stored.slice();
}

// ---- the records -------------------------------------------------------------------------------------------------

function readVertex(r: Bytes, at: number, uvSets: number): GmtVertex {
	const uv: [number, number][] = [];
	for (let k = 0; k < uvSets; k++) uv.push([r.f32(at + 64 + k * 8), r.f32(at + 68 + k * 8)]);
	return {
		position: r.vec3(at),
		normal: r.vec3(at + 12),
		colour: r.u32(at + 24),
		colour2: r.u32(at + 28),
		bones: [r.u8(at + 32), r.u8(at + 33), r.u8(at + 34), r.u8(at + 35)],
		weights: [r.u8(at + 36), r.u8(at + 37), r.u8(at + 38), r.u8(at + 39)],
		tangent: r.vec3(at + 40),
		binormal: r.vec3(at + 52),
		uv,
	};
}

function writeVertex(w: Bytes, at: number, v: GmtVertex, uvSets: number): void {
	w.setFloats(at, v.position);
	w.setFloats(at + 12, v.normal);
	w.setU32(at + 24, v.colour);
	w.setU32(at + 28, v.colour2);
	for (let k = 0; k < 4; k++) {
		w.setU8(at + 32 + k, v.bones[k] ?? 0);
		w.setU8(at + 36 + k, v.weights[k] ?? 0);
	}
	w.setFloats(at + 40, v.tangent);
	w.setFloats(at + 52, v.binormal);
	if (v.uv.length > uvSets) throw new Error(`a vertex has ${v.uv.length} UV sets, the layout ${uvSets}`);
	for (const [k, t] of v.uv.entries()) w.setFloats(at + 64 + k * 8, t);
}

function readFace(r: Bytes, at: number): GmtFace {
	return {
		corners: [r.u16(at), r.u16(at + 2), r.u16(at + 4)],
		axis: r.u16(at + 6),
		mesh: r.u32(at + 8),
		plane: r.u32(at + 12),
		centre: r.vec3(at + 16),
		radius: r.f32(at + 28),
	};
}

function writeFace(w: Bytes, at: number, f: GmtFace): void {
	for (const [i, c] of f.corners.entries()) w.setU16(at + i * 2, c);
	w.setU16(at + 6, f.axis);
	w.setU32(at + 8, f.mesh);
	w.setU32(at + 12, f.plane);
	w.setFloats(at + 16, f.centre);
	w.setF32(at + 28, f.radius);
}

/** what a mesh record's derived words are, where it is written */
interface MeshPlace {
	firstVertex: number;
	firstIndex: number;
	/** where its palette is (from byte 4) */
	palette: number;
}

function meshRecord(L: Layout, m: GmtMesh, at: MeshPlace, raw: Uint8Array | undefined): Uint8Array {
	return record(L.mesh, raw, (w, fresh) => {
		w.setU32(0, m.flags);
		w.setU32(4, m.vertices.length);
		w.setU32(12, m.indices.length);
		w.setU32(24, at.firstVertex);
		w.setU32(32, at.firstIndex);
		w.setU32(36, m.material);
		if (L === LAYOUTS.new) {
			w.setU32(92, m.palette.length);
			if (fresh) w.setU32(96, at.palette);
		} else if (m.palette.length) throw new Error("the old layout has no bones");
	});
}

function boneRecord(b: GmtBone, raw: Uint8Array | undefined): Uint8Array {
	return record(BONE, raw, (w) => {
		w.setU32s(0, b.head);
		w.setName(12, BONE_NAME, b.name);
		if (b.data.length !== BONE - 44) throw new Error(`bone ${b.name}: its data is ${b.data.length} bytes, not 196`);
		w.b.set(b.data, 44);
	});
}

function textureSize(L: Layout, t: GmtTexture): number {
	return L.texture + (t.animation ? 4 * (t.animation.frames.length + 3) : 0);
}

function textureRecord(L: Layout, t: GmtTexture, raw: Uint8Array | undefined): Uint8Array {
	if ((t.count !== 1) !== !!t.animation) throw new Error(`texture ${t.name}: an animation is had when its count is not 1`);
	return record(textureSize(L, t), raw, (w) => {
		w.setName(0, NAME, t.name);
		w.setU16(64, t.flags);
		w.setU16(66, t.flags2);
		w.setI32(68, t.word68);
		w.setU32(72, t.count);
		let at = 76;
		if (t.animation) {
			const a = t.animation;
			w.setU32(at, a.frames.length);
			w.setU32s(at + 4, a.frames);
			at += 4 + a.frames.length * 4;
			w.setU32(at, a.next);
			w.setF32(at + 4, a.rate);
			at += 8;
		}
		const n = (L.texture - 76) / 4;
		if (t.settings.length !== n) throw new Error(`texture ${t.name}: ${t.settings.length} settings, not ${n}`);
		w.setU32s(at, t.settings);
	});
}

function readTexture(L: Layout, r: Bytes, at: number): [GmtTexture, number] {
	const count = r.u32(at + 72);
	let p = at + 76;
	let animation: GmtAnimation | undefined;
	if (count !== 1) {
		const n = r.u32(p);
		if (n > 100_000) throw new Error(`a texture's animation of ${n} frames`);
		const frames = r.u32s(p + 4, n);
		p += 4 + n * 4;
		animation = { frames, next: r.u32(p), rate: r.f32(p + 4) };
		p += 8;
	}
	const settings = r.u32s(p, (L.texture - 76) / 4);
	const t: GmtTexture = {
		name: nameAt(r.b, at, NAME),
		flags: r.u16(at + 64),
		flags2: r.u16(at + 66),
		word68: r.i32(at + 68),
		count,
		settings,
	};
	if (animation) t.animation = animation;
	const size = textureSize(L, t);
	const stored = r.b.subarray(at, at + size);
	const raw = rawUnless(stored, textureRecord(L, t, undefined));
	if (raw) t.raw = raw;
	return [t, at + size];
}

function materialHead(L: Layout, m: GmtMaterial, raw: Uint8Array | undefined): Uint8Array {
	return record(headSize(L), raw, (w) => {
		w.setName(0, NAME, m.name);
		w.setU32(64, m.flags);
		w.setFloats(68, m.ambient);
		w.setFloats(84, m.diffuse);
		w.setFloats(100, m.specular);
		w.setFloats(116, m.emissive);
		w.setU32(132, m.srcBlend);
		w.setU32(136, m.destBlend);
		w.setF32(140, m.specularPower);
		if (L.levels === 1) w.setU32(144, m.word144);
		else if (m.word144) throw new Error(`material ${m.name}: the old layout has no word 144`);
	});
}

function shaderNew(s: GmtShader, raw: Uint8Array | undefined): Uint8Array {
	return record(SHADER_NEW, raw, (w) => {
		w.setName(0, NAME, s.name);
		if (s.params.length !== 11) throw new Error(`shader ${s.name}: ${s.params.length} params, not 11`);
		w.setU32s(64, s.params);
		w.setU32(108, s.textures.length);
	});
}

function shaderOld(s: GmtShader, first: number, raw: Uint8Array | undefined): Uint8Array {
	return record(SHADER_OLD, raw, (w) => {
		w.setU32(0, first);
		w.setU32(4, s.textures.length);
		w.setName(8, NAME, s.name);
		if (s.params.length !== 48) throw new Error(`shader ${s.name}: ${s.params.length} params, not 48`);
		w.setU32s(72, s.params);
	});
}

function readMaterial(L: Layout, r: Bytes, at: number): [GmtMaterial, number] {
	const m: GmtMaterial = {
		name: nameAt(r.b, at, NAME),
		flags: r.u32(at + 64),
		ambient: r.rgba(at + 68),
		diffuse: r.rgba(at + 84),
		specular: r.rgba(at + 100),
		emissive: r.rgba(at + 116),
		srcBlend: r.u32(at + 132),
		destBlend: r.u32(at + 136),
		specularPower: r.f32(at + 140),
		word144: L.levels === 1 ? r.u32(at + 144) : 0,
		shaders: [],
	};
	const raw = rawUnless(r.b.subarray(at, at + headSize(L)), materialHead(L, m, undefined));
	if (raw) m.raw = raw;
	let p = at + headSize(L);
	if (L === LAYOUTS.new) {
		const s: GmtShader = { name: nameAt(r.b, p, NAME), params: r.u32s(p + 64, 11), textures: [] };
		const n = r.u32(p + 108);
		const sraw = rawUnless(r.b.subarray(p, p + SHADER_NEW), shaderNew({ ...s, textures: new Array(n) }, undefined));
		if (sraw) s.raw = sraw;
		p += SHADER_NEW;
		for (let k = 0; k < n; k++) {
			const [t, q] = readTexture(L, r, p);
			s.textures.push(t);
			p = q;
		}
		m.shaders.push(s);
	} else {
		const spans: [number, number][] = [];
		for (let k = 0; k < L.levels; k++) {
			const first = r.u32(p);
			const n = r.u32(p + 4);
			const s: GmtShader = { name: nameAt(r.b, p + 8, NAME), params: r.u32s(p + 72, 48), textures: [] };
			const sraw = rawUnless(r.b.subarray(p, p + SHADER_OLD), shaderOld({ ...s, textures: new Array(n) }, first, undefined));
			if (sraw) s.raw = sraw;
			spans.push([first, n]);
			m.shaders.push(s);
			p += SHADER_OLD;
		}
		m.tail = r.u32s(p, OLD_TAIL / 4);
		p += OLD_TAIL;
		const total = r.u32(p);
		p += 4;
		const all: GmtTexture[] = [];
		for (let k = 0; k < total; k++) {
			const [t, q] = readTexture(L, r, p);
			all.push(t);
			p = q;
		}
		let next = 0;
		spans.forEach(([first, n], k) => {
			if (first !== next) throw new Error(`material ${m.name}: its level ${k}'s textures from ${first}, not ${next}`);
			m.shaders[k]?.textures.push(...all.slice(first, first + n));
			next += n;
		});
		if (next !== total) throw new Error(`material ${m.name}: ${total} textures, its levels ${next}`);
	}
	return [m, p];
}

function materialBytes(L: Layout, m: GmtMaterial): Uint8Array[] {
	const out = [materialHead(L, m, m.raw)];
	if (L === LAYOUTS.new) {
		if (m.shaders.length !== 1) throw new Error(`material ${m.name}: ${m.shaders.length} shaders, the layout 1`);
		for (const s of m.shaders) {
			out.push(shaderNew(s, s.raw));
			for (const t of s.textures) out.push(textureRecord(L, t, t.raw));
		}
	} else {
		if (m.shaders.length !== L.levels) throw new Error(`material ${m.name}: ${m.shaders.length} shaders, not 3`);
		let first = 0;
		for (const s of m.shaders) {
			out.push(shaderOld(s, first, s.raw));
			first += s.textures.length;
		}
		const tail = new Uint8Array(OLD_TAIL + 4);
		const w = new Bytes(tail);
		w.setU32s(0, m.tail ?? []);
		w.setU32(OLD_TAIL, first);
		out.push(tail);
		for (const s of m.shaders) for (const t of s.textures) out.push(textureRecord(L, t, t.raw));
	}
	return out;
}

// ---- the header --------------------------------------------------------------------------------------------------

/** the size of each part's record: in the file, or in an exporter's memory */
interface Sizes {
	header: number;
	mesh: number;
	face: number;
	bone: number;
	vertex: number;
}

const disk = (L: Layout): Sizes => ({ header: L.header - 4, mesh: L.mesh, face: FACE, bone: BONE, vertex: L.vertex });

/** a 64-bit exporter's memory (its pointers 8 bytes) */
const MEMORY_64: Sizes = { header: 968, mesh: 224, face: 40, bone: 248, vertex: 96 };

const memory = (L: Layout, bits: 32 | 64): Sizes => (bits === 64 ? MEMORY_64 : disk(L));

/** where each part is, from byte 4 */
interface Places {
	meshes: number;
	faces: number;
	planes: number;
	bones: number;
	vertices: number;
	indices: number;
	palettes: number;
	materials: number;
}

function places(s: Sizes, g: Gmt): Places {
	const meshes = s.header;
	const faces = meshes + g.meshes.length * s.mesh;
	const planes = faces + g.faces.length * s.face;
	const bones = planes + g.planes.length * PLANE;
	const vertices = bones + g.bones.length * s.bone;
	const indices = vertices + g.meshes.reduce((a, m) => a + m.vertices.length, 0) * s.vertex;
	const palettes = indices + g.meshes.reduce((a, m) => a + m.indices.length, 0) * 2;
	const materials = palettes + g.meshes.reduce((a, m) => a + m.palette.length, 0);
	return { meshes, faces, planes, bones, vertices, indices, palettes, materials };
}

function headerBytes(L: Layout, g: Gmt, at: Places, raw: Uint8Array | undefined): Uint8Array {
	// (the header's own offsets are the file's less 4: it begins at byte 4)
	return record(L.header - 4, raw, (w, fresh) => {
		const o = (x: number) => x - 4;
		w.setU32(o(0x04), g.flags);
		for (const [i, c] of g.box.corners.entries()) w.setFloats(o(0x08 + i * 12), c);
		for (const [i, c] of g.box.corners2.entries()) w.setFloats(o(0x68 + i * 12), c);
		w.setFloats(o(0xc8), g.box.min);
		w.setFloats(o(0xd4), g.box.max);
		w.setF32(o(0xe0), g.box.radius);
		w.setFloats(o(0xe4), g.box.centre);
		w.setFloats(o(0xf0), g.box.centre2);
		w.setFloats(o(0x100), g.lod);
		w.setF32(o(0x1ec), g.distance2);
		w.setFloats(o(0x114), g.position);
		const count = (f: (m: GmtMesh) => number) => g.meshes.reduce((a, m) => a + f(m), 0);
		const table: [number, number][] = [
			[count((m) => m.vertices.length), at.vertices],
			[count((m) => m.indices.length), at.indices],
			[g.meshes.length, at.meshes],
			[g.faces.length, at.faces],
			[g.planes.length, at.planes],
			[g.bones.length, at.bones],
		];
		table.forEach(([n, p], i) => {
			w.setU32(o(0x13c + i * 8), n);
			if (fresh) w.setU32(o(0x140 + i * 8), p);
		});
		w.setName(o(0x17c), NAME, g.name);
		if (fresh) w.b.set(unhex(L.tag), o(0x1bc));
	});
}

// ---- reading and writing -----------------------------------------------------------------------------------------

function layoutOf(b: Uint8Array): GmtLayout | null {
	if (b.length < 0x1cc) return null;
	const tag = hex(b.subarray(0x1bc, 0x1cc));
	for (const k of ["old", "new"] as const) if (LAYOUTS[k].tag === tag) return k;
	return null;
}

export function readGmt(bytes: Uint8Array): Gmt | GmtEncrypted {
	const layout = layoutOf(bytes);
	if (!layout) return { kind: "encrypted", bytes: bytes.slice() };
	const L = LAYOUTS[layout];
	const r = new Bytes(bytes);
	const table = r.u32s(0x13c, 12);
	const [vc, ic, mc, fc, pc, bc] = [0, 2, 4, 6, 8, 10].map((i) => table[i] ?? 0) as [number, number, number, number, number, number];
	let p = L.header;
	const recs: { at: number; vc: number; ic: number; fv: number; fi: number; palette: number }[] = [];
	for (let k = 0; k < mc; k++) {
		recs.push({
			at: p,
			vc: r.u32(p + 4),
			ic: r.u32(p + 12),
			fv: r.u32(p + 24),
			fi: r.u32(p + 32),
			palette: L === LAYOUTS.new ? r.u32(p + 92) : 0,
		});
		p += L.mesh;
	}
	const faces: GmtFace[] = [];
	for (let k = 0; k < fc; k++, p += FACE) faces.push(readFace(r, p));
	const planes: GmtPlane[] = [];
	for (let k = 0; k < pc; k++, p += PLANE) planes.push({ normal: r.vec3(p), flags: r.u32(p + 12) });
	const bones: GmtBone[] = [];
	for (let k = 0; k < bc; k++, p += BONE) {
		const bone: GmtBone = {
			name: nameAt(bytes, p + 12, BONE_NAME),
			head: [r.u32(p), r.u32(p + 4), r.u32(p + 8)],
			data: bytes.slice(p + 44, p + BONE),
		};
		const raw = rawUnless(bytes.subarray(p, p + BONE), boneRecord(bone, undefined));
		if (raw) bone.raw = raw;
		bones.push(bone);
	}
	const vat = p;
	p += vc * L.vertex;
	const iat = p;
	p += ic * 2;
	const meshes: GmtMesh[] = [];
	let fv = 0;
	let fi = 0;
	for (const [k, m] of recs.entries()) {
		if (m.fv !== fv || m.fi !== fi) throw new Error(`mesh ${k}: its vertices from ${m.fv}, indices from ${m.fi}`);
		const vertices: GmtVertex[] = [];
		for (let i = 0; i < m.vc; i++) vertices.push(readVertex(r, vat + (fv + i) * L.vertex, L.uvSets));
		const indices: number[] = [];
		for (let i = 0; i < m.ic; i++) indices.push(r.u16(iat + (fi + i) * 2));
		const palette = Array.from(bytes.subarray(p, p + m.palette));
		p += m.palette;
		const mesh: GmtMesh = {
			flags: r.u32(m.at),
			material: r.u32(m.at + 36),
			vertices,
			indices,
			palette,
		};
		meshes.push(mesh);
		fv += m.vc;
		fi += m.ic;
	}
	if (fv !== vc || fi !== ic) throw new Error(`the meshes have ${fv} of ${vc} vertices, ${fi} of ${ic} indices`);
	if (p - 4 !== r.u32(0)) throw new Error(`the materials at ${p - 4}, not ${r.u32(0)}`);
	const n = r.u32(p);
	p += 4;
	const materials: GmtMaterial[] = [];
	for (let k = 0; k < n; k++) {
		const [m, q] = readMaterial(L, r, p);
		materials.push(m);
		p = q;
	}
	if (p !== bytes.length) throw new Error(`${bytes.length - p} bytes past the materials`);
	const g: Gmt = {
		kind: "gmt",
		layout,
		bits: r.u32(0x150) === MEMORY_64.header ? 64 : 32,
		flags: r.u32(0x04),
		name: nameAt(bytes, 0x17c, NAME),
		box: {
			corners: Array.from({ length: 8 }, (_, i) => r.vec3(0x08 + i * 12)),
			corners2: Array.from({ length: 8 }, (_, i) => r.vec3(0x68 + i * 12)),
			min: r.vec3(0xc8),
			max: r.vec3(0xd4),
			radius: r.f32(0xe0),
			centre: r.vec3(0xe4),
			centre2: r.vec3(0xf0),
		},
		lod: [r.f32(0x100), r.f32(0x104)],
		distance2: r.f32(0x1ec),
		position: r.vec3(0x114),
		meshes,
		faces,
		planes,
		bones,
		materials,
	};
	// (each record kept as stored only where its fields do not make it again)
	const at = places(memory(L, g.bits), g);
	const header = rawUnless(bytes.subarray(4, L.header), headerBytes(L, g, at, undefined));
	if (header) g.header = header;
	let pal = at.palettes;
	meshes.forEach((m, k) => {
		const rec = recs[k] as (typeof recs)[number];
		const place = { firstVertex: rec.fv, firstIndex: rec.fi, palette: pal };
		const raw = rawUnless(bytes.subarray(rec.at, rec.at + L.mesh), meshRecord(L, m, place, undefined));
		if (raw) m.raw = raw;
		pal += m.palette.length;
	});
	return g;
}

export function writeGmt(g: Gmt | GmtEncrypted): Uint8Array {
	if (g.kind === "encrypted") return g.bytes.slice();
	const L = LAYOUTS[g.layout];
	const at = places(memory(L, g.bits), g);
	const parts: Uint8Array[] = [];
	const head = new Uint8Array(4);
	new Bytes(head).setU32(0, places(disk(L), g).materials);
	parts.push(head, headerBytes(L, g, at, g.header));
	let fv = 0;
	let fi = 0;
	let pal = at.palettes;
	for (const m of g.meshes) {
		parts.push(meshRecord(L, m, { firstVertex: fv, firstIndex: fi, palette: pal }, m.raw));
		fv += m.vertices.length;
		fi += m.indices.length;
		pal += m.palette.length;
	}
	const fb = new Bytes(new Uint8Array(g.faces.length * FACE));
	for (const [k, f] of g.faces.entries()) writeFace(fb, FACE * k, f);
	parts.push(fb.b);
	const pb = new Bytes(new Uint8Array(g.planes.length * PLANE));
	g.planes.forEach((q, i) => {
		pb.setFloats(i * PLANE, q.normal);
		pb.setU32(i * PLANE + 12, q.flags);
	});
	parts.push(pb.b);
	for (const b of g.bones) parts.push(boneRecord(b, b.raw));
	const vb = new Bytes(new Uint8Array(fv * L.vertex));
	let v = 0;
	for (const m of g.meshes) for (const x of m.vertices) writeVertex(vb, L.vertex * v++, x, L.uvSets);
	parts.push(vb.b);
	const ib = new Bytes(new Uint8Array(fi * 2));
	let i = 0;
	for (const m of g.meshes)
		for (const x of m.indices) {
			if (x > 0xffff) throw new Error(`index ${x}: past 16 bits`);
			ib.setU16(2 * i++, x);
		}
	parts.push(ib.b);
	for (const m of g.meshes) parts.push(Uint8Array.from(m.palette));
	const count = new Uint8Array(4);
	new Bytes(count).setU32(0, g.materials.length);
	parts.push(count);
	for (const m of g.materials) parts.push(...materialBytes(L, m));
	const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
	let o = 0;
	for (const b of parts) {
		out.set(b, o);
		o += b.length;
	}
	return out;
}

// ---- making a GMT's derived parts -------------------------------------------------------------------------------

/** A float's bits, as a settings word holds it. */
export function floatWord(x: number): number {
	const v = new DataView(new ArrayBuffer(4));
	v.setFloat32(0, x, true);
	return v.getUint32(0, true);
}

/** A settings word read as the float it holds. */
export function wordFloat(w: number): number {
	const v = new DataView(new ArrayBuffer(4));
	v.setUint32(0, w >>> 0, true);
	return v.getFloat32(0, true);
}

const f32v = (v: readonly number[]): Vec3 => [Math.fround(v[0] ?? 0), Math.fround(v[1] ?? 0), Math.fround(v[2] ?? 0)];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** a distance in float32 steps, as the exporter's faces have it */
function dist32(a: Vec3, b: Vec3): number {
	const F = Math.fround;
	const [x, y, z] = [F(a[0] - b[0]), F(a[1] - b[1]), F(a[2] - b[2])];
	return F(Math.sqrt(F(F(F(x * x) + F(y * y)) + F(z * z))));
}

/** The box as the exporter makes it: the vertices' least and most, its 8 corners (x, then y, then z: 000 010 110 100 001 011 111 101, 1 the most), its middle,
 * and the farthest vertex from the middle. */
export function boxOf(meshes: readonly GmtMesh[]): GmtBox {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const m of meshes)
		for (const v of m.vertices)
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i] as number, v.position[i] as number);
				max[i] = Math.max(max[i] as number, v.position[i] as number);
			}
	if (min[0] > max[0]) throw new Error("no vertices to bound");
	const at = (bits: string): Vec3 => f32v([0, 1, 2].map((i) => (bits[i] === "1" ? max[i] : min[i]) as number));
	const corners = ["000", "010", "110", "100", "001", "011", "111", "101"].map(at);
	const centre = f32v([0, 1, 2].map((i) => ((min[i] as number) + (max[i] as number)) / 2));
	let radius = 0;
	for (const m of meshes) for (const v of m.vertices) radius = Math.max(radius, dist(v.position, centre));
	return {
		corners,
		corners2: corners.map((c) => [...c] as Vec3),
		min: f32v(min),
		max: f32v(max),
		radius: Math.fround(radius),
		centre,
		centre2: [...centre],
	};
}

/** The faces and planes as the exporter makes them from the meshes' triangles: a face each, its corners the file's vertex numbers, its middle the corners' mean
 * (the exporter's is near it) and its radius the farthest corner's; its plane's normal (c - a) x (b - a) made whole, shared with the mesh's faces of the same
 * normal, its flags the smoothing groups. */
export function facesOf(meshes: readonly GmtMesh[], smoothing = 1): { faces: GmtFace[]; planes: GmtPlane[] } {
	const faces: GmtFace[] = [];
	const planes: GmtPlane[] = [];
	let first = 0;
	meshes.forEach((m, mesh) => {
		const own = new Map<string, number>();
		for (let i = 0; i + 2 < m.indices.length; i += 3) {
			const ks = [m.indices[i], m.indices[i + 1], m.indices[i + 2]] as [number, number, number];
			const [a, b, c] = ks.map((k) => {
				const v = m.vertices[k];
				if (!v) throw new Error(`mesh ${mesh}: index ${k} past its ${m.vertices.length} vertices`);
				return v.position;
			}) as [Vec3, Vec3, Vec3];
			const centre = f32v([0, 1, 2].map((j) => ((a[j] as number) + (b[j] as number) + (c[j] as number)) / 3));
			const radius = Math.max(dist32(a, centre), dist32(b, centre), dist32(c, centre));
			const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
			const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
			const n = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]] as Vec3;
			const l = Math.hypot(...n) || 1;
			const normal = f32v(n.map((x) => x / l));
			const key = `${normal.join(",")}|${smoothing}`;
			let plane = own.get(key);
			if (plane === undefined) {
				plane = planes.length;
				own.set(key, plane);
				planes.push({ normal, flags: smoothing });
			}
			const big = [0, 1, 2].reduce((best, j) => (Math.abs(normal[j] as number) > Math.abs(normal[best] as number) ? j : best), 0);
			const axis = big * 2 + ((normal[big] as number) < 0 ? 1 : 0);
			faces.push({ mesh, corners: ks.map((k) => first + k) as [number, number, number], axis, plane, centre, radius });
		}
		first += m.vertices.length;
	});
	return { faces, planes };
}
