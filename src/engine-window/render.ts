// The track's renders (trackrender.ts's shots), drawn by the GPU (WebGL 2): the AC build's models as AC lights them (each material's colour picture, its
// ambient and diffuse, a little of its specular; the ground's detail layers, the AT materials cut where their pictures are see-through, the blended ones over
// the rest), under a sun with shadows, a sky and haze over the distance, the light made to fit as a camera's would; the grass AC's grass grows near the eye
// (rendergrass.ts), each clump the colour of the ground under it. Each drawn at twice the size and made smaller, for smooth edges.
import { bladesTexture } from "../engine/beamng/grass";
import { convert, isPng, readPng } from "../engine/dds";
import { readDds } from "../engine/ddsread";
import type { Kn5, Kn5Material } from "../engine/kn5tree";
import { VERT, walk } from "../engine/kn5tree";
import { grassAround, type Tris } from "../engine/rendergrass";
import type { Shot, TrackScene, V3 } from "../engine/trackrender";
import { finished } from "./mappreview";

/** drawn this many times larger, then made smaller */
const K = 2;
/** a picture's largest side on the GPU */
const MAX_TEXTURE = 2048;
/** the shadows' map's side */
const SHADOW = 4096;

const SKY_TOP: V3 = [0.24, 0.42, 0.72];
const SKY_LOW: V3 = [0.68, 0.78, 0.88];
const SUN: V3 = [1.0, 0.95, 0.86];
const AMBIENT: V3 = [0.58, 0.66, 0.78];

type GL = WebGL2RenderingContext;

const MAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aTint;
uniform mat4 uModel, uView, uLight;
out vec3 vWorld, vNormal, vTint;
out vec2 vUv;
out vec4 vLight;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vTint = aTint;
  vNormal = mat3(uModel) * aNormal;
  vUv = aUv;
  vLight = uLight * w;
  gl_Position = uView * w;
}`;

const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld, vNormal, vTint;
in vec2 vUv;
in vec4 vLight;
uniform bool uTinted;
uniform sampler2D tDiffuse, tMask, tDetail0, tDetail1, tDetail2, tDetail3;
uniform sampler2DShadow tShadow;
uniform int uDetail; // 0 none, 1 one detail, 2 four by a mask
uniform vec4 uMult;
uniform vec3 uMean0, uMean1, uMean2, uMean3;
uniform float uCut, uBlend, uKa, uKd, uKs, uExp, uHaze, uTexel, uBias;
uniform vec3 uEye, uSun, uSunColour, uAmbient, uSkyLow;
out vec4 colour;

float lit() {
  vec3 p = vLight.xyz / vLight.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++) s += texture(tShadow, vec3(p.xy + vec2(i, j) * uTexel, p.z - uBias));
  return s / 9.0;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec4 d = texture(tDiffuse, vUv);
  if (uCut > 0.0 && d.a < uCut) discard;
  vec3 base = d.rgb;
  // (grass: its blades the colour of the ground under it)
  if (uTinted) base *= vTint;
  if (uDetail == 1) base *= texture(tDetail0, vUv * uMult.x).rgb / uMean0;
  else if (uDetail == 2) {
    vec4 m = texture(tMask, vUv);
    float sum = m.r + m.g + m.b + m.a;
    if (sum > 0.01) {
      vec3 mix4 = m.r * texture(tDetail0, vUv * uMult.x).rgb / uMean0
        + m.g * texture(tDetail1, vUv * uMult.y).rgb / uMean1
        + m.b * texture(tDetail2, vUv * uMult.z).rgb / uMean2
        + m.a * texture(tDetail3, vUv * uMult.w).rgb / uMean3;
      base *= mix4 / sum;
    }
  }
  vec3 v = normalize(uEye - vWorld);
  // (the face's own normal toward the eye; the smooth one turned to agree: leaves and walls lit from either side)
  vec3 g = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(g, v) < 0.0) g = -g;
  vec3 n = normalize(vNormal);
  if (!uTinted && dot(n, g) < 0.0) n = -n;
  float sh = lit();
  float ndl = max(dot(n, uSun), 0.0);
  vec3 light = uAmbient * uKa * (0.75 + 0.25 * n.y) + uSunColour * uKd * ndl * sh;
  vec3 h = normalize(uSun + v);
  vec3 c = base * light + uSunColour * uKs * pow(max(dot(n, h), 0.0), max(uExp, 1.0)) * sh * ndl;
  float far = length(uEye - vWorld);
  c = mix(c, uSkyLow, 1.0 - exp(-far * uHaze));
  colour = vec4(pow(aces(c), vec3(1.0 / 2.2)), uBlend > 0.0 ? d.a : 1.0);
}`;

const SHADOW_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec2 aUv;
uniform mat4 uModel, uLight;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = uLight * uModel * vec4(aPos, 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uCut;
out vec4 colour;
void main() {
  if (uCut > 0.0 && texture(tDiffuse, vUv).a < uCut) discard;
  colour = vec4(1.0);
}`;

const SKY_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vP;
void main() {
  vP = P[gl_VertexID];
  gl_Position = vec4(vP, 0.0, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vP;
uniform mat4 uInverse;
uniform vec3 uTop, uLow;
out vec4 colour;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec4 a = uInverse * vec4(vP, -1.0, 1.0);
  vec4 b = uInverse * vec4(vP, 1.0, 1.0);
  vec3 ray = normalize(b.xyz / b.w - a.xyz / a.w);
  float up = clamp(ray.y, 0.0, 1.0);
  colour = vec4(pow(aces(mix(uLow, uTop, pow(up, 0.6))), vec3(1.0 / 2.2)), 1.0);
}`;

// ---- matrices (column-major, as GL takes them) -------------------------------------------------------------------

type M4 = Float32Array;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
	const l = Math.hypot(...a) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};

function lookAt(eye: V3, target: V3): M4 {
	const f = unit(sub(target, eye));
	const r = unit(cross(f, Math.abs(f[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0]));
	const u = cross(r, f);
	return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1]);
}

function perspective(fov: number, aspect: number, near: number, far: number): M4 {
	const t = 1 / Math.tan((fov * Math.PI) / 360);
	return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

function ortho(r: number, near: number, far: number): M4 {
	return new Float32Array([1 / r, 0, 0, 0, 0, 1 / r, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
}

function times(a: M4, b: M4): M4 {
	const o = new Float32Array(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let s = 0;
			for (let k = 0; k < 4; k++) s += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
			o[c * 4 + r] = s;
		}
	return o;
}

/** A matrix's inverse (Gauss and Jordan's, pivoting). */
function inverse(m: M4): M4 {
	const a = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => (c < 4 ? (m[c * 4 + r] as number) : +(c - 4 === r))));
	for (let c = 0; c < 4; c++) {
		const p = pivotRow(a, c);
		[a[c], a[p]] = [a[p] as number[], a[c] as number[]];
		const row = a[c] as number[];
		const d = (row[c] as number) || 1e-12;
		for (let k = 0; k < 8; k++) row[k] = (row[k] as number) / d;
		eliminate(a, c, row);
	}
	const out = new Float32Array(16);
	for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = (a[r] as number[])[4 + c] as number;
	return out;
}

/** The row, from c down, of the largest value (by its size) in column c: the first of them where two are as large. */
function pivotRow(a: number[][], c: number): number {
	let p = c;
	for (let r = c + 1; r < 4; r++) if (Math.abs((a[r] as number[])[c] as number) > Math.abs((a[p] as number[])[c] as number)) p = r;
	return p;
}

/** Column c of every other row made 0 by taking row c (its value there 1) from it. */
function eliminate(a: number[][], c: number, row: number[]): void {
	for (let r = 0; r < 4; r++) {
		if (r === c) continue;
		const o = a[r] as number[];
		const f = o[c] as number;
		for (let k = 0; k < 8; k++) o[k] = (o[k] as number) - f * (row[k] as number);
	}
}

// ---- the models on the GPU -----------------------------------------------------------------------------------------

interface Texture {
	t: WebGLTexture;
	/** its mean colour (linear), what a detail layer is divided by to keep the colour under it */
	mean: V3;
}

interface Look {
	diffuse: Texture | null;
	detail: 0 | 1 | 2;
	mask: Texture | null;
	details: (Texture | null)[];
	mult: [number, number, number, number];
	ka: number;
	kd: number;
	ks: number;
	exp: number;
	/** alpha below which it is cut (AT materials'), 0 not cut */
	cut: number;
	blend: boolean;
	/** each corner its own tint (the grass's) */
	tinted?: boolean;
}

interface Part {
	vao: WebGLVertexArrayObject;
	buffers: WebGLBuffer[];
	count: number;
	/** its faces' indices 32-bit (the grass's), else 16 */
	wide?: boolean;
	/** what it was made of: its mesh's name, its material's, its corners and faces, its matrix (row vectors), its colour picture's bytes (the grass grows on
	 * some, others keep it off) */
	from?: {
		name: string;
		material: string;
		verts: Float32Array;
		faces: Uint16Array;
		m: Float64Array;
		picture?: Uint8Array;
	};
	model: M4;
	look: Look;
	centre: V3;
	radius: number;
	lod: [number, number];
}

const srgbToLinear = (v: number) => (v / 255) ** 2.2;

/** A picture's pixels (RGBA, no side over MAX_TEXTURE): a DDS or PNG read here (a PNG's colour kept where it is see-through, so its smaller copies keep their
 * colour at its edges), anything else by the browser's decoder. */
async function decode(data: Uint8Array): Promise<{ rgba: Uint8Array; w: number; h: number } | null> {
	const dds = readDds(data, MAX_TEXTURE);
	if (dds) return { rgba: dds.data, w: dds.width, h: dds.height };
	if (isPng(data)) {
		try {
			return await pngPixels(data);
		} catch {
			// (one this reader cannot: the browser's)
		}
	}
	let bmp: ImageBitmap;
	try {
		bmp = await createImageBitmap(new Blob([data as BlobPart]), {
			premultiplyAlpha: "none",
			colorSpaceConversion: "none",
		});
	} catch {
		return null;
	}
	const s = Math.min(1, MAX_TEXTURE / Math.max(bmp.width, bmp.height));
	const w = Math.max(1, Math.round(bmp.width * s));
	const h = Math.max(1, Math.round(bmp.height * s));
	const c = new OffscreenCanvas(w, h);
	const g = c.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
	g.drawImage(bmp, 0, 0, w, h);
	bmp.close();
	return { rgba: new Uint8Array(g.getImageData(0, 0, w, h).data.buffer), w, h };
}

/** A PNG's pixels (RGBA), its colour kept where it is see-through, made half as large until no side is over MAX_TEXTURE. */
async function pngPixels(data: Uint8Array): Promise<{ rgba: Uint8Array; w: number; h: number }> {
	const p = convert(await readPng(data), "RGBA");
	let rgba = p.data;
	let [w, h] = [p.width, p.height];
	while (Math.max(w, h) > MAX_TEXTURE) {
		rgba = halved(rgba, w, h);
		[w, h] = [Math.max(1, w >> 1), Math.max(1, h >> 1)];
	}
	return { rgba, w, h };
}

/** Pixels (RGBA, w by h) half as large each way (a side of one kept), each the mean of the four it covers. */
function halved(rgba: Uint8Array, w: number, h: number): Uint8Array {
	const nw = Math.max(1, w >> 1);
	const nh = Math.max(1, h >> 1);
	const half = new Uint8Array(nw * nh * 4);
	for (let y = 0; y < nh; y++)
		for (let x = 0; x < nw; x++)
			for (let c = 0; c < 4; c++) {
				const at = (yy: number, xx: number) => rgba[(Math.min(yy, h - 1) * w + Math.min(xx, w - 1)) * 4 + c] as number;
				half[(y * nw + x) * 4 + c] = (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1)) >> 2;
			}
	return half;
}

/** A texture of a picture's bytes, and the mean colour of a few of its pixels. */
async function upload(gl: GL, data: Uint8Array, anisotropy: number): Promise<Texture | null> {
	const pic = await decode(data);
	if (!pic) return null;
	const { rgba, w, h } = pic;
	// (made and bound only now, the picture read: others are read at the same time, each bound in turn)
	const t = gl.createTexture();
	if (!t) return null;
	gl.bindTexture(gl.TEXTURE_2D, t);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
	gl.generateMipmap(gl.TEXTURE_2D);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, 0x84fe, anisotropy);
	const mean: V3 = [0, 0, 0];
	const n = w * h;
	const step = Math.max(1, Math.floor(n / 4096));
	let k = 0;
	for (let i = 0; i < n; i += step, k++) for (let c = 0; c < 3; c++) mean[c] = (mean[c] as number) + srgbToLinear(rgba[i * 4 + c] as number);
	return { t, mean: mean.map((v) => Math.max(v / Math.max(k, 1), 0.02)) as V3 };
}

const prop = (m: Kn5Material, name: string, or: number) => m.props.find((p) => p.name === name)?.value ?? or;

/** The GPU's copies of the scene's models (its parts, its textures), made once for every shot. */
async function uploadScene(gl: GL, scene: TrackScene): Promise<{ parts: Map<string, Part[]>; free: () => void }> {
	const anisoExt = gl.getExtension("EXT_texture_filter_anisotropic");
	const anisotropy = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
	const textures: WebGLTexture[] = [];
	const parts = new Map<string, Part[]>();
	for (const [file, kn5] of Object.entries(scene.models)) {
		const own = new Map<string, Promise<Texture | null>>();
		const tex = (name: string | undefined): Promise<Texture | null> => {
			if (!name) return Promise.resolve(null);
			let p = own.get(name);
			if (!p) {
				const data = kn5.textures.find((t) => t.name === name)?.data;
				p = data
					? upload(gl, data, anisotropy).then((t) => {
							if (t) textures.push(t.t);
							return t;
						})
					: Promise.resolve(null);
				own.set(name, p);
			}
			return p;
		};
		const looks = await Promise.all(kn5.materials.map((m) => lookOf(m, tex)));
		parts.set(file, modelParts(gl, kn5, looks));
	}
	return {
		parts,
		free: () => {
			for (const list of parts.values())
				for (const p of list) {
					gl.deleteVertexArray(p.vao);
					for (const b of p.buffers) gl.deleteBuffer(b);
				}
			for (const t of textures) gl.deleteTexture(t);
		},
	};
}

/** A material as it is drawn. */
async function lookOf(m: Kn5Material, tex: (name: string | undefined) => Promise<Texture | null>): Promise<Look> {
	const slot = (s: string) => m.textures.find((t) => t.sampler === s)?.name;
	const diffuse = await tex(slot("txDiffuse"));
	let detail: Look["detail"] = 0;
	let mask: Texture | null = null;
	let details: (Texture | null)[] = [];
	let mult: Look["mult"] = [1, 1, 1, 1];
	if (m.shader.startsWith("ksMultilayer") && slot("txMask")) {
		mask = await tex(slot("txMask"));
		details = await Promise.all(["R", "G", "B", "A"].map((c) => tex(slot(`txDetail${c}`))));
		mult = ["multR", "multG", "multB", "multA"].map((p) => prop(m, p, 1)) as Look["mult"];
		if (mask && details.every(Boolean)) detail = 2;
	} else if (prop(m, "useDetail", 0) > 0 && slot("txDetail")) {
		details = [await tex(slot("txDetail"))];
		mult = [prop(m, "detailUVMultiplier", 1), 1, 1, 1];
		if (details[0]) detail = 1;
	}
	const at = m.alpha_tested > 0 || /AT(_|$)/.test(m.shader);
	return {
		diffuse,
		detail,
		mask,
		details,
		mult,
		// (AC's track materials' 0.2 its plain light; the brighter ones kept from glaring)
		ka: Math.min(prop(m, "ksAmbient", 0.5), 0.45) / 0.2,
		kd: Math.min(prop(m, "ksDiffuse", 0.5), 0.45) / 0.2,
		ks: Math.min(prop(m, "ksSpecular", 0), 0.6) * 0.35,
		exp: prop(m, "ksSpecularEXP", 1),
		cut: at ? 0.5 : 0,
		blend: m.blend === 1,
	};
}

/** Corners (VERT floats each: a kn5's; the fourth three a tint where it has one) and faces on the GPU. */
function arrays(gl: GL, verts: Float32Array, faces: Uint16Array | Uint32Array): Pick<Part, "vao" | "buffers" | "count" | "wide"> | null {
	const vao = gl.createVertexArray();
	const vb = gl.createBuffer();
	const ib = gl.createBuffer();
	if (!vao || !vb || !ib) return null;
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, vb);
	gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
	const stride = VERT * 4;
	for (const [at, n, offset] of [
		[0, 3, 0],
		[1, 3, 12],
		[2, 2, 24],
		[3, 3, 32],
	] as const) {
		gl.enableVertexAttribArray(at);
		gl.vertexAttribPointer(at, n, gl.FLOAT, false, stride, offset);
	}
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, faces, gl.STATIC_DRAW);
	gl.bindVertexArray(null);
	return { vao, buffers: [vb, ib], count: faces.length, wide: faces instanceof Uint32Array };
}

/** A model's meshes as the GPU draws them (those seen), each its vertices and faces, its matrix, its look. */
function modelParts(gl: GL, kn5: Kn5, looks: Look[]): Part[] {
	const parts: Part[] = [];
	for (const [n, m] of walk(kn5.root)) {
		if (n.kind !== 2 || !n.active || !n.visible || !n.renderable || !n.faces.length) continue;
		const look = looks[n.material];
		const material = kn5.materials[n.material];
		if (!look || !material) continue;
		const gpu = arrays(gl, n.verts, n.faces);
		if (!gpu) continue;
		const s = n.sphere;
		const c: V3 = [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0];
		// (its sphere where it stands: row vectors, as the kn5 keeps its matrices)
		const centre: V3 = [0, 1, 2].map((j) => c[0] * (m[j] as number) + c[1] * (m[4 + j] as number) + c[2] * (m[8 + j] as number) + (m[12 + j] as number)) as V3;
		const colour = material.textures.find((t) => t.sampler === "txDiffuse")?.name;
		parts.push({
			...gpu,
			model: new Float32Array(m),
			look,
			centre,
			radius: s[3] ?? 0,
			lod: [n.lod_in, n.lod_out],
			from: {
				name: n.name,
				material: material.name,
				verts: n.verts,
				faces: n.faces,
				m,
				...(colour ? { picture: kn5.textures.find((t) => t.name === colour)?.data } : {}),
			},
		});
	}
	return parts;
}

/** A part's triangles where they stand, those reaching into a square (x0, z0, its side), with their uv (uv: asked). */
function trisOf(p: NonNullable<Part["from"]>, x0: number, z0: number, side: number, uv: boolean): Tris {
	const { verts: v, faces: f, m } = p;
	const P: number[] = [];
	const U: number[] = [];
	const at = (i: number, j: number) =>
		(v[i * VERT] as number) * (m[j] as number) +
		(v[i * VERT + 1] as number) * (m[4 + j] as number) +
		(v[i * VERT + 2] as number) * (m[8 + j] as number) +
		(m[12 + j] as number);
	for (let k = 0; k + 2 < f.length; k += 3) {
		const c = [f[k], f[k + 1], f[k + 2]] as [number, number, number];
		const xs = c.map((i) => at(i, 0));
		const zs = c.map((i) => at(i, 2));
		if (Math.max(...xs) < x0 || Math.min(...xs) > x0 + side || Math.max(...zs) < z0 || Math.min(...zs) > z0 + side) continue;
		c.forEach((i, q) => {
			P.push(xs[q] as number, at(i, 1), zs[q] as number);
			if (uv) U.push(v[i * VERT + 6] as number, v[i * VERT + 7] as number);
		});
	}
	return { P: new Float32Array(P), ...(uv ? { UV: new Float32Array(U) } : {}) };
}

type Pixels = { rgba: Uint8Array; w: number; h: number };

/** The grass of a shot (rendergrass.ts) on the GPU, of the parts it draws: none where it asks for none, the track grows none or none grows there. */
async function grassOf(
	gl: GL,
	scene: TrackScene,
	seen: Part[],
	shot: Shot,
	blades: Texture,
	pictures: Map<Uint8Array, Promise<Pixels | null>>,
): Promise<Part | null> {
	const cfg = scene.grass;
	if (!cfg || !shot.grass) return null;
	const { at, radius } = shot.grass;
	const { ground, over } = await groundOf(cfg, seen, pictures, at, radius);
	if (!ground.length) return null;
	const made = grassAround(ground, over, at, radius);
	if (!made.clumps) return null;
	// (its tint the ground's colour over the blades' own)
	for (let i = 0; i < made.verts.length; i += VERT) for (let c = 0; c < 3; c++) made.verts[i + 8 + c] = (made.verts[i + 8 + c] as number) / blades.mean[c];
	const gpu = arrays(gl, made.verts, made.faces);
	if (!gpu) return null;
	return {
		...gpu,
		model: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
		look: {
			diffuse: blades,
			detail: 0,
			mask: null,
			details: [],
			mult: [1, 1, 1, 1],
			ka: 1,
			kd: 1,
			ks: 0,
			exp: 1,
			cut: 0.5,
			blend: false,
			tinted: true,
		},
		centre: [at[0], 0, at[1]],
		radius,
		lod: [0, 0],
	};
}

/** What the grass of a shot grows on, of the parts it draws near enough (round at, so many metres): the meshes it grows on, each with its colour picture's
 * colour, and those that keep it off. */
async function groundOf(
	cfg: NonNullable<TrackScene["grass"]>,
	seen: Part[],
	pictures: Map<Uint8Array, Promise<Pixels | null>>,
	at: [number, number],
	radius: number,
): Promise<{ ground: { tris: Tris; colourAt: (u: number, v: number) => V3 }[]; over: Tris[] }> {
	const x0 = at[0] - radius;
	const z0 = at[1] - radius;
	const near = (p: Part) => Math.hypot(p.centre[0] - at[0], p.centre[2] - at[1]) < radius + p.radius;
	const ground: { tris: Tris; colourAt: (u: number, v: number) => V3 }[] = [];
	const over: Tris[] = [];
	for (const p of seen) {
		if (!p.from || !near(p)) continue;
		if (cfg.meshes.includes(p.from.name) && p.from.picture) {
			const pic = await pictureOf(pictures, p.from.picture);
			if (!pic) continue;
			ground.push({ tris: trisOf(p.from, x0, z0, 2 * radius, true), colourAt: colourIn(pic) });
		} else if (cfg.occluding.includes(p.from.material)) over.push(trisOf(p.from, x0, z0, 2 * radius, false));
	}
	return { ground, over };
}

/** A picture's pixels, read once for every shot. */
function pictureOf(pictures: Map<Uint8Array, Promise<Pixels | null>>, bytes: Uint8Array): Promise<Pixels | null> | undefined {
	if (!pictures.has(bytes)) pictures.set(bytes, decode(bytes));
	return pictures.get(bytes);
}

/** A picture's colour (linear) at a point of it (u, v), the picture repeated. */
function colourIn(pic: Pixels): (u: number, v: number) => V3 {
	return (u: number, v: number): V3 => {
		const x = Math.min(pic.w - 1, Math.floor((u - Math.floor(u)) * pic.w));
		const y = Math.min(pic.h - 1, Math.floor((v - Math.floor(v)) * pic.h));
		const i = (y * pic.w + x) * 4;
		return [srgbToLinear(pic.rgba[i] as number), srgbToLinear(pic.rgba[i + 1] as number), srgbToLinear(pic.rgba[i + 2] as number)];
	};
}

// ---- drawing -------------------------------------------------------------------------------------------------------

/** A program drawn with from now on (GL's useProgram, which is no React hook). */
function bindProgram(gl: GL, p: WebGLProgram): void {
	// biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
	gl.useProgram(p);
}

function program(gl: GL, vs: string, fs: string): WebGLProgram {
	const p = gl.createProgram() as WebGLProgram;
	for (const [kind, src] of [
		[gl.VERTEX_SHADER, vs],
		[gl.FRAGMENT_SHADER, fs],
	] as const) {
		const s = gl.createShader(kind) as WebGLShader;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`a render's shader: ${gl.getShaderInfoLog(s)}`);
		gl.attachShader(p, s);
	}
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`a render's shaders: ${gl.getProgramInfoLog(p)}`);
	return p;
}

/** What the shots are drawn with: the GL, its programs (the models', the shadows', the sky's), a white picture for a material's missing one, and the shadows'
 * map (depth, compared as it is read) with its framebuffer. */
function drawingOf(gl: GL) {
	const main = program(gl, MAIN_VS, MAIN_FS);
	const shade = program(gl, SHADOW_VS, SHADOW_FS);
	const sky = program(gl, SKY_VS, SKY_FS);
	const white = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, white);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
	// (the shadows' map: depth, compared as it is read)
	const depth = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, depth);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW, SHADOW);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
	const fb = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
	gl.drawBuffers([gl.NONE]);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	return { gl, main, shade, sky, white, depth, fb };
}

type Drawing = ReturnType<typeof drawingOf>;

const loc = (d: Drawing, p: WebGLProgram, n: string) => d.gl.getUniformLocation(p, n);

/** A texture bound to a unit: the white one where there is none. */
function bindTex(d: Drawing, unit: number, t: Texture | null | undefined): void {
	d.gl.activeTexture(d.gl.TEXTURE0 + unit);
	d.gl.bindTexture(d.gl.TEXTURE_2D, t?.t ?? d.white);
}

/** The parts drawn where AC would draw them from this far (from eye), by their distances. */
const seenFrom = (drawn: Part[], eye: V3) =>
	drawn.filter((p) => {
		const d = Math.hypot(...sub(p.centre, eye));
		return d + p.radius >= p.lod[0] && (!p.lod[1] || d - p.radius <= p.lod[1]);
	});

/** The shadows' map of a shot: the solid parts as the sun sees them (light). */
function drawShadows(d: Drawing, seen: Part[], light: M4): void {
	const { gl, shade } = d;
	gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb);
	gl.viewport(0, 0, SHADOW, SHADOW);
	gl.enable(gl.DEPTH_TEST);
	gl.depthMask(true);
	gl.disable(gl.CULL_FACE);
	gl.clear(gl.DEPTH_BUFFER_BIT);
	gl.enable(gl.POLYGON_OFFSET_FILL);
	gl.polygonOffset(1.5, 3);
	bindProgram(gl, shade);
	gl.uniformMatrix4fv(loc(d, shade, "uLight"), false, light);
	gl.uniform1i(loc(d, shade, "tDiffuse"), 0);
	for (const p of seen) {
		if (p.look.blend) continue;
		gl.uniformMatrix4fv(loc(d, shade, "uModel"), false, p.model);
		gl.uniform1f(loc(d, shade, "uCut"), p.look.cut);
		bindTex(d, 0, p.look.diffuse);
		gl.bindVertexArray(p.vao);
		gl.drawElements(gl.TRIANGLES, p.count, p.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
	}
	gl.disable(gl.POLYGON_OFFSET_FILL);
}

/** The sky of a shot, over the whole picture (view its camera's). */
function drawSky(d: Drawing, view: M4): void {
	const { gl, sky } = d;
	gl.disable(gl.DEPTH_TEST);
	bindProgram(gl, sky);
	gl.uniformMatrix4fv(loc(d, sky, "uInverse"), false, inverse(view));
	gl.uniform3fv(loc(d, sky, "uTop"), SKY_TOP);
	gl.uniform3fv(loc(d, sky, "uLow"), SKY_LOW);
	gl.bindVertexArray(null);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** The models' program made ready for a shot: its camera (view), its sun and its shadows' map (light, round the target r metres), its light and haze. */
function readyMain(d: Drawing, shot: Shot, view: M4, light: M4, r: number): void {
	const { gl, main } = d;
	gl.enable(gl.DEPTH_TEST);
	bindProgram(gl, main);
	gl.uniformMatrix4fv(loc(d, main, "uView"), false, view);
	gl.uniformMatrix4fv(loc(d, main, "uLight"), false, light);
	gl.uniform3fv(loc(d, main, "uEye"), shot.eye);
	gl.uniform3fv(loc(d, main, "uSun"), shot.sun);
	gl.uniform3fv(
		loc(d, main, "uSunColour"),
		SUN.map((c) => c * 1.15),
	);
	gl.uniform3fv(
		loc(d, main, "uAmbient"),
		AMBIENT.map((c) => c * 0.3),
	);
	gl.uniform3fv(loc(d, main, "uSkyLow"), SKY_LOW);
	gl.uniform1f(loc(d, main, "uHaze"), 1 / 9000);
	gl.uniform1f(loc(d, main, "uTexel"), 1 / SHADOW);
	// (a texel and a half of the sun's map, in its depth's range)
	gl.uniform1f(loc(d, main, "uBias"), (((2 * r) / SHADOW) * 1.5) / (r * 6 - 1));
	["tDiffuse", "tMask", "tDetail0", "tDetail1", "tDetail2", "tDetail3"].forEach((n, i) => {
		gl.uniform1i(loc(d, main, n), i);
	});
	gl.uniform1i(loc(d, main, "tShadow"), 6);
	gl.activeTexture(gl.TEXTURE6);
	gl.bindTexture(gl.TEXTURE_2D, d.depth);
}

/** A part drawn with the models' program, as its material looks. */
function drawPart(d: Drawing, p: Part): void {
	const { gl, main } = d;
	const l = p.look;
	gl.uniformMatrix4fv(loc(d, main, "uModel"), false, p.model);
	bindTex(d, 0, l.diffuse);
	bindTex(d, 1, l.mask);
	for (let i = 0; i < 4; i++) bindTex(d, 2 + i, l.details[i]);
	gl.uniform1i(loc(d, main, "uDetail"), l.detail);
	gl.uniform4fv(loc(d, main, "uMult"), l.mult);
	for (let i = 0; i < 4; i++) gl.uniform3fv(loc(d, main, `uMean${i}`), l.details[i]?.mean ?? [1, 1, 1]);
	gl.uniform1f(loc(d, main, "uCut"), l.cut);
	gl.uniform1f(loc(d, main, "uBlend"), l.blend ? 1 : 0);
	gl.uniform1f(loc(d, main, "uKa"), l.ka);
	gl.uniform1f(loc(d, main, "uKd"), l.kd);
	gl.uniform1f(loc(d, main, "uKs"), l.ks);
	gl.uniform1f(loc(d, main, "uExp"), l.exp);
	gl.uniform1i(loc(d, main, "uTinted"), l.tinted ? 1 : 0);
	gl.bindVertexArray(p.vao);
	gl.drawElements(gl.TRIANGLES, p.count, p.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
}

/** A shot's grass drawn (where the track grows it, blades its blades' picture), and let go of. */
async function drawGrass(
	d: Drawing,
	scene: TrackScene,
	seen: Part[],
	shot: Shot,
	blades: Texture | null,
	grounds: Map<Uint8Array, Promise<Pixels | null>>,
): Promise<void> {
	const grass = blades ? await grassOf(d.gl, scene, seen, shot, blades, grounds) : null;
	if (!grass) return;
	drawPart(d, grass);
	d.gl.deleteVertexArray(grass.vao);
	for (const b of grass.buffers) d.gl.deleteBuffer(b);
}

/** A shot's blended parts drawn over the rest, far to near. */
function drawBlended(d: Drawing, seen: Part[], eye: V3): void {
	const { gl } = d;
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.depthMask(false);
	gl.enable(gl.POLYGON_OFFSET_FILL);
	gl.polygonOffset(-1, -2);
	const far = (p: Part) => Math.hypot(...sub(p.centre, eye));
	for (const p of seen.filter((q) => q.look.blend).sort((a, b) => far(b) - far(a))) drawPart(d, p);
	gl.disable(gl.POLYGON_OFFSET_FILL);
	gl.depthMask(true);
	gl.disable(gl.BLEND);
	gl.bindVertexArray(null);
}

/** The shots of a scene, each its picture's bytes (PNG or JPEG as it asks). */
export async function render(scene: TrackScene, shots: Shot[]): Promise<Uint8Array[]> {
	if (!shots.length) return [];
	const big = Math.max(...shots.map((s) => Math.max(s.size[0], s.size[1]))) * K;
	const canvas = new OffscreenCanvas(big, big);
	const gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true, alpha: false }) as GL | null;
	if (!gl) throw new Error("no WebGL 2 here to render the track with");
	const d = drawingOf(gl);
	const { parts, free } = await uploadScene(gl, scene);
	// (the grass's blades, the ground's pictures read once for every shot)
	const blades = scene.grass ? await upload(gl, (await bladesTexture()).png, 0) : null;
	const grounds = new Map<Uint8Array, Promise<Pixels | null>>();
	const out: Uint8Array[] = [];
	try {
		for (const shot of shots) {
			const w = shot.size[0] * K;
			const h = shot.size[1] * K;
			const reach = Math.hypot(...sub(shot.target, shot.eye));
			// (each part drawn where AC would draw it from this far)
			const seen = seenFrom(
				shot.models.flatMap((f) => parts.get(f) ?? []),
				shot.eye,
			);
			// (the sun's view of round the target, its shadows' map)
			const r = shot.shadow;
			const sunAt: V3 = [shot.target[0] + shot.sun[0] * r * 3, shot.target[1] + shot.sun[1] * r * 3, shot.target[2] + shot.sun[2] * r * 3];
			const light = times(ortho(r, 1, r * 6), lookAt(sunAt, shot.target));
			drawShadows(d, seen, light);
			// (the picture: the sky, then the solid parts, then the blended ones far to near)
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, w, h);
			gl.clearColor(SKY_LOW[0], SKY_LOW[1], SKY_LOW[2], 1);
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
			const near = Math.max(0.3, reach * 0.02);
			const view = times(perspective(shot.fov, w / h, near, Math.max(8000, reach * 20)), lookAt(shot.eye, shot.target));
			drawSky(d, view);
			readyMain(d, shot, view, light, r);
			gl.disable(gl.BLEND);
			for (const p of seen) if (!p.look.blend) drawPart(d, p);
			await drawGrass(d, scene, seen, shot, blades, grounds);
			drawBlended(d, seen, shot.eye);
			// (the drawn corner of the canvas made the picture's size)
			const cut = new OffscreenCanvas(w, h);
			(cut.getContext("2d") as OffscreenCanvasRenderingContext2D).drawImage(canvas, 0, big - h, w, h, 0, 0, w, h);
			out.push(await finished(cut, shot.size, shot.format));
		}
	} finally {
		free();
		if (blades) gl.deleteTexture(blades.t);
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
	return out;
}
