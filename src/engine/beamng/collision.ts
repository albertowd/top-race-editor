// What vehicles hit in the BeamNG level: the solid meshes made coarse and cut in pieces, as BeamNG's own tracks are. BeamNG works out a level's collision as it
// loads it, the slower the more triangles a shape gives it: the floor, fine for its looks (and its bumps), took it a minute. Its own tracks hit meshes of about
// a triangle a square metre, apart from the ones they draw, in shapes of some thousands of triangles each.
//
// 1. Each material's meshes made one, their points welded (the writer's splits and texture seams none of the shape's).
// 2. Each made coarse: a point folded into a neighbour while the planes of the faces it has taken in stay within the material's error of it, summed (each plane
//    counts, not their mean: a bump on a flat stays), no face turning over, no edge longer than LONGEST. The points on a mesh's edge stay: where materials meet
//    nothing opens. No point moves: the collision is on the floor's own points.
// 3. The faces of all of them cut in tiles of at most TILE triangles, each halved across its longer side.
import type { DaeMesh } from "./dae";

/** metres a road's collision may be off its floor (the bumps a kart feels are centimetres) */
export const ROAD_ERROR = 0.002;
/** metres the rest of the ground's may be */
export const GROUND_ERROR = 0.01;
/** metres: the longest edge a point folded away leaves */
export const LONGEST = 10;
/** triangles a collision shape holds at most */
export const TILE = 16384;
/** the least cosine between a face's turn before and after a point is folded away */
const TURN = 0.2;

/** A solid mesh and how far its collision may be off it. */
export interface Solid {
	mesh: DaeMesh;
	error: number;
}

export interface Welded {
	P: Float64Array;
	F: Int32Array;
}

/** Equal points made one (to 10 µm); faces left with two corners the same dropped. */
export function weld(meshes: DaeMesh[]): Welded {
	const at = new Map<string, number>();
	const P: number[] = [];
	const F: number[] = [];
	for (const m of meshes) {
		const map = new Int32Array(m.P.length / 3);
		for (let k = 0; k < map.length; k++) {
			const x = m.P[k * 3] as number;
			const y = m.P[k * 3 + 1] as number;
			const z = m.P[k * 3 + 2] as number;
			const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
			let i = at.get(key);
			if (i === undefined) {
				i = P.length / 3;
				at.set(key, i);
				P.push(x, y, z);
			}
			map[k] = i;
		}
		for (let f = 0; f < m.F.length; f += 3) {
			const a = map[m.F[f] as number] as number;
			const b = map[m.F[f + 1] as number] as number;
			const c = map[m.F[f + 2] as number] as number;
			if (a !== b && b !== c && a !== c) F.push(a, b, c);
		}
	}
	return { P: Float64Array.from(P), F: Int32Array.from(F) };
}

/** A min-heap of points by the cost of folding them. */
class Heap {
	private cost = new Float64Array(1024);
	private who = new Int32Array(1024);
	size = 0;
	push(c: number, u: number) {
		if (this.size === this.cost.length) {
			const cost = new Float64Array(this.cost.length * 2);
			const who = new Int32Array(this.cost.length * 2);
			cost.set(this.cost);
			who.set(this.who);
			this.cost = cost;
			this.who = who;
		}
		let i = this.size++;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if ((this.cost[p] as number) <= c) break;
			this.cost[i] = this.cost[p] as number;
			this.who[i] = this.who[p] as number;
			i = p;
		}
		this.cost[i] = c;
		this.who[i] = u;
	}
	/** the cheapest taken off: its cost and point */
	pop(): [number, number] {
		const top: [number, number] = [this.cost[0] as number, this.who[0] as number];
		const n = --this.size;
		if (n) {
			const c = this.cost[n] as number;
			const u = this.who[n] as number;
			let i = 0;
			for (;;) {
				let s = 2 * i + 1;
				if (s >= n) break;
				if (s + 1 < n && (this.cost[s + 1] as number) < (this.cost[s] as number)) s++;
				if ((this.cost[s] as number) >= c) break;
				this.cost[i] = this.cost[s] as number;
				this.who[i] = this.who[s] as number;
				i = s;
			}
			this.cost[i] = c;
			this.who[i] = u;
		}
		return top;
	}
}

/** A face's unit normal (none: it has no area). */
function normal(P: Float64Array, a: number, b: number, c: number): [number, number, number] | null {
	const ux = (P[b * 3] as number) - (P[a * 3] as number);
	const uy = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
	const uz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
	const vx = (P[c * 3] as number) - (P[a * 3] as number);
	const vy = (P[c * 3 + 1] as number) - (P[a * 3 + 1] as number);
	const vz = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
	const x = uy * vz - uz * vy;
	const y = uz * vx - ux * vz;
	const z = ux * vy - uy * vx;
	const l = Math.hypot(x, y, z);
	return l > 1e-12 ? [x / l, y / l, z / l] : null;
}

/** Each point's faces. */
function pointFaces(F: Int32Array, nv: number): number[][] {
	const nf = F.length / 3;
	const faces: number[][] = Array.from({ length: nv }, () => []);
	for (let f = 0; f < nf; f++) for (let j = 0; j < 3; j++) (faces[F[f * 3 + j] as number] as number[]).push(f);
	return faces;
}

/** The points that stay: a point on an edge of one face, or of more than two (a neighbour in other than two of its faces). */
function lockedPoints(F: Int32Array, faces: number[][], nv: number): Uint8Array {
	const locked = new Uint8Array(nv);
	const count = new Uint32Array(nv);
	for (let u = 0; u < nv; u++) if (stays(F, faces[u] as number[], u, count)) locked[u] = 1;
	return locked;
}

/** Whether point u stays: a neighbour of it in other than two of its faces fs (count: a slot a point, those of u's neighbours used here). */
function stays(F: Int32Array, fs: number[], u: number, count: Uint32Array): boolean {
	for (const f of fs) for (let j = 0; j < 3; j++) count[F[f * 3 + j] as number] = 0;
	for (const f of fs) for (let j = 0; j < 3; j++) count[F[f * 3 + j] as number] = (count[F[f * 3 + j] as number] as number) + 1;
	for (const f of fs)
		for (let j = 0; j < 3; j++) {
			const w = F[f * 3 + j] as number;
			if (w !== u && count[w] !== 2) return true;
		}
	return false;
}

/** Each point's quadric: its faces' planes', the sum of their squared distances to a point. */
function quadrics(P: Float64Array, F: Int32Array, nv: number): Float64Array {
	const nf = F.length / 3;
	const Q = new Float64Array(nv * 10);
	for (let f = 0; f < nf; f++) {
		const a = F[f * 3] as number;
		const b = F[f * 3 + 1] as number;
		const c = F[f * 3 + 2] as number;
		const n = normal(P, a, b, c);
		if (!n) continue;
		const [x, y, z] = n;
		const d = -(x * (P[a * 3] as number) + y * (P[a * 3 + 1] as number) + z * (P[a * 3 + 2] as number));
		const q = [x * x, x * y, x * z, x * d, y * y, y * z, y * d, z * z, z * d, d * d];
		for (const v of [a, b, c]) for (let i = 0; i < 10; i++) Q[v * 10 + i] = (Q[v * 10 + i] as number) + (q[i] as number);
	}
	return Q;
}

/** A welded mesh's points folded away, cheapest first, as long as one folds within the error leaving the mesh whole (step 2): its faces as they are folded,
 * which are alive. */
class Folding {
	readonly alive: Uint8Array;
	private readonly faces: number[][];
	private readonly locked: Uint8Array;
	private readonly Q: Float64Array;
	private readonly mark: Uint32Array;
	private stamp = 0;
	/** u's neighbours as its cheapest fold is looked for, v's, and the faces both have */
	private readonly nu: number[] = [];
	private readonly nw: number[] = [];
	private readonly shared: number[] = [];
	private readonly cand: [number, number][] = [];
	private readonly limit: number;
	private readonly queued: Uint8Array;
	private readonly dead: Uint8Array;
	private readonly heap = new Heap();

	constructor(
		private readonly P: Float64Array,
		private readonly F: Int32Array,
		error: number,
		private readonly longest: number,
	) {
		const nv = P.length / 3;
		this.alive = new Uint8Array(F.length / 3).fill(1);
		this.faces = pointFaces(F, nv);
		this.locked = lockedPoints(F, this.faces, nv);
		this.Q = quadrics(P, F, nv);
		this.mark = new Uint32Array(nv);
		this.limit = error * error;
		this.queued = new Uint8Array(nv);
		this.dead = new Uint8Array(nv);
	}

	/** what folding u into v costs: the squared distances of v to both points' planes */
	private cost(u: number, v: number): number {
		const { P, Q } = this;
		const x = P[v * 3] as number;
		const y = P[v * 3 + 1] as number;
		const z = P[v * 3 + 2] as number;
		const o = u * 10;
		const p = v * 10;
		const q = (i: number) => (Q[o + i] as number) + (Q[p + i] as number);
		return (
			q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9)
		);
	}

	/** a point's neighbours, into a list reused, marked with a stamp of their own */
	private around(u: number, out: number[]): number[] {
		const { F, mark } = this;
		out.length = 0;
		this.stamp++;
		mark[u] = this.stamp;
		for (const f of this.faces[u] as number[])
			for (let j = 0; j < 3; j++) {
				const w = F[f * 3 + j] as number;
				if (mark[w] !== this.stamp) {
					mark[w] = this.stamp;
					out.push(w);
				}
			}
		return out;
	}

	/** Whether u folds into v leaving the mesh whole: the points both are next to only the faces' across their edge, no face turning over or lying flat, no edge
	 * longer than longest (nu: u's neighbours). */
	private folds(u: number, v: number): boolean {
		const { F, shared } = this;
		shared.length = 0;
		for (const f of this.faces[u] as number[]) if (F[f * 3] === v || F[f * 3 + 1] === v || F[f * 3 + 2] === v) shared.push(f);
		if (!shared.length) return false;
		return this.onlySharedCommon(v) && this.withinLongest(v) && this.noneTurns(u, v);
	}

	/** whether the points u (nu) and v are both next to are as many as the faces they share */
	private onlySharedCommon(v: number): boolean {
		this.around(v, this.nw);
		this.stamp++;
		for (const w of this.nw) this.mark[w] = this.stamp;
		let common = 0;
		for (const w of this.nu) if (this.mark[w] === this.stamp) common++;
		return common === this.shared.length;
	}

	/** whether no edge from v to u's other neighbours (nu) is longer than longest */
	private withinLongest(v: number): boolean {
		const { P } = this;
		for (const w of this.nu)
			if (
				w !== v &&
				Math.hypot(
					(P[v * 3] as number) - (P[w * 3] as number),
					(P[v * 3 + 1] as number) - (P[w * 3 + 1] as number),
					(P[v * 3 + 2] as number) - (P[w * 3 + 2] as number),
				) > this.longest
			)
				return false;
		return true;
	}

	/** whether none of u's faces but the shared turns over or lies flat with u at v */
	private noneTurns(u: number, v: number): boolean {
		const { P, F } = this;
		for (const f of this.faces[u] as number[]) {
			if (this.shared.includes(f)) continue;
			const a = F[f * 3] as number;
			const b = F[f * 3 + 1] as number;
			const c = F[f * 3 + 2] as number;
			const before = normal(P, a, b, c);
			const after = normal(P, a === u ? v : a, b === u ? v : b, c === u ? v : c);
			if (!before || !after || before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < TURN) return false;
		}
		return true;
	}

	/** u's cheapest fold within the error that leaves the mesh whole: its cost, the point it folds into */
	private best(u: number): [number, number] | null {
		const { cand } = this;
		this.around(u, this.nu);
		cand.length = 0;
		for (const v of this.nu) {
			const c = this.cost(u, v);
			if (c <= this.limit) cand.push([c, v]);
		}
		cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		for (const c of cand) if (this.folds(u, c[1])) return c;
		return null;
	}

	/** u queued at its cheapest fold's cost (what it would cost at least), if it has one and is not queued already */
	private offer(u: number): void {
		if (this.locked[u] || this.dead[u] || this.queued[u]) return;
		let least = Infinity;
		for (const f of this.faces[u] as number[])
			for (let j = 0; j < 3; j++) {
				const v = this.F[f * 3 + j] as number;
				if (v !== u) least = Math.min(least, this.cost(u, v));
			}
		if (least > this.limit) return;
		this.heap.push(least, u);
		this.queued[u] = 1;
	}

	/** u folded into v: its faces across their edge gone, the rest v's; its neighbours (nu) offered again */
	private fold(u: number, v: number): void {
		const { F, Q, faces, alive } = this;
		const touched = [...this.nu];
		const vf = faces[v] as number[];
		for (const f of faces[u] as number[]) {
			if (this.shared.includes(f)) {
				alive[f] = 0;
				continue;
			}
			for (let j = 0; j < 3; j++) if (F[f * 3 + j] === u) F[f * 3 + j] = v;
			vf.push(f);
		}
		faces[v] = vf.filter((f) => alive[f]);
		faces[u] = [];
		for (let i = 0; i < 10; i++) Q[v * 10 + i] = (Q[v * 10 + i] as number) + (Q[u * 10 + i] as number);
		this.dead[u] = 1;
		for (const w of touched) this.offer(w);
	}

	/** every point offered, then folded cheapest first until none is left to fold */
	run(): void {
		const nv = this.P.length / 3;
		for (let u = 0; u < nv; u++) this.offer(u);
		while (this.heap.size) {
			const [c, u] = this.heap.pop();
			this.queued[u] = 0;
			if (this.dead[u]) continue;
			// (costs only grow as points fold: one queued at less is costed again and waits its turn; one with no fold left queued again when its neighbours change)
			const b = this.best(u);
			if (!b) continue;
			if (b[0] > c) {
				this.heap.push(b[0], u);
				this.queued[u] = 1;
				continue;
			}
			this.fold(u, b[1]);
		}
	}
}

/** A welded mesh made coarse (step 2): its faces, on its own points. */
export function coarsen(mesh: Welded, error: number, longest = LONGEST): Int32Array {
	const F = Int32Array.from(mesh.F);
	const folding = new Folding(mesh.P, F, error, longest);
	folding.run();
	const out: number[] = [];
	for (let f = 0; f < F.length / 3; f++) if (folding.alive[f]) out.push(F[f * 3] as number, F[f * 3 + 1] as number, F[f * 3 + 2] as number);
	return Int32Array.from(out);
}

/** Each point's normal: its faces' summed (by their area). */
function pointNormals(P: Float64Array, F: number[]): Float64Array {
	const N = new Float64Array(P.length);
	for (let f = 0; f < F.length; f += 3) {
		const a = F[f] as number;
		const b = F[f + 1] as number;
		const c = F[f + 2] as number;
		const ux = (P[b * 3] as number) - (P[a * 3] as number);
		const uy = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
		const uz = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
		const vx = (P[c * 3] as number) - (P[a * 3] as number);
		const vy = (P[c * 3 + 1] as number) - (P[a * 3 + 1] as number);
		const vz = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
		const g = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
		for (const v of [a, b, c]) for (let i = 0; i < 3; i++) N[v * 3 + i] = (N[v * 3 + i] as number) + (g[i] as number);
	}
	for (let v = 0; v < N.length; v += 3) {
		const l = Math.hypot(N[v] as number, N[v + 1] as number, N[v + 2] as number) || 1;
		for (let i = 0; i < 3; i++) N[v + i] = (N[v + i] as number) / l;
	}
	return N;
}

/** The solids' collision (see the module's note): tiles of at most `tile` triangles, each its meshes by material. */
export function collisionTiles(solids: Solid[], tile = TILE): DaeMesh[][] {
	const byMaterial = new Map<string, Solid[]>();
	for (const s of solids) {
		const l = byMaterial.get(s.mesh.material);
		if (l) l.push(s);
		else byMaterial.set(s.mesh.material, [s]);
	}
	const parts: { material: string; P: Float64Array; F: Int32Array }[] = [];
	for (const [material, list] of byMaterial) {
		const w = weld(list.map((s) => s.mesh));
		parts.push({ material, P: w.P, F: coarsen(w, Math.min(...list.map((s) => s.error))) });
	}
	// (every face by its part and its place in it, with its middle across the ground)
	const n = parts.reduce((a, p) => a + p.F.length / 3, 0);
	const part = new Int32Array(n);
	const at = new Int32Array(n);
	const mx = new Float64Array(n);
	const my = new Float64Array(n);
	let k = 0;
	parts.forEach((p, i) => {
		for (let f = 0; f < p.F.length / 3; f++, k++) {
			part[k] = i;
			at[k] = f;
			let x = 0;
			let y = 0;
			for (let j = 0; j < 3; j++) {
				x += p.P[(p.F[f * 3 + j] as number) * 3] as number;
				y += p.P[(p.F[f * 3 + j] as number) * 3 + 1] as number;
			}
			mx[k] = x / 3;
			my[k] = y / 3;
		}
	});
	const tiles: Int32Array[] = [];
	const split = (ids: Int32Array) => {
		if (ids.length <= tile) {
			if (ids.length) tiles.push(ids);
			return;
		}
		let x0 = Infinity;
		let x1 = -Infinity;
		let y0 = Infinity;
		let y1 = -Infinity;
		for (const i of ids) {
			x0 = Math.min(x0, mx[i] as number);
			x1 = Math.max(x1, mx[i] as number);
			y0 = Math.min(y0, my[i] as number);
			y1 = Math.max(y1, my[i] as number);
		}
		const m = x1 - x0 >= y1 - y0 ? mx : my;
		ids.sort((a, b) => (m[a] as number) - (m[b] as number) || a - b);
		const h = ids.length >> 1;
		split(ids.subarray(0, h));
		split(ids.subarray(h));
	};
	split(Int32Array.from({ length: n }, (_, i) => i));
	return tiles.map((ids) => {
		const byPart = new Map<number, number[]>();
		for (const i of ids) {
			const l = byPart.get(part[i] as number);
			if (l) l.push(at[i] as number);
			else byPart.set(part[i] as number, [at[i] as number]);
		}
		return [...byPart]
			.sort((a, b) => a[0] - b[0])
			.map(([pi, fs]) => {
				const p = parts[pi] as (typeof parts)[number];
				const map = new Map<number, number>();
				const P: number[] = [];
				const F: number[] = [];
				for (const f of fs.toSorted((a, b) => a - b))
					for (let j = 0; j < 3; j++) {
						const v = p.F[f * 3 + j] as number;
						let i = map.get(v);
						if (i === undefined) {
							i = P.length / 3;
							map.set(v, i);
							P.push(p.P[v * 3] as number, p.P[v * 3 + 1] as number, p.P[v * 3 + 2] as number);
						}
						F.push(i);
					}
				const PP = Float64Array.from(P);
				return {
					name: "collision",
					material: p.material,
					P: PP,
					N: pointNormals(PP, F),
					U: new Float64Array((P.length / 3) * 2),
					F,
				};
			});
	});
}
