// Races for the BeamNG.drive level (the track's beamng_races.py): a time trial mission for each layout, which BeamNG's freeroam shows as a marker at the
// layout's start, and a race against karts from its grid.
//
// Each race is a closed path of checkpoints along the layout's racing line, as BeamNG's own race tracks have: the start and finish where AC times the lap (its
// AC_TIME_0 gate), a split at each of AC's other timing gates, and a checkpoint every CHECKPOINT_STEP metres between them, so a lap cannot be cut short. A
// checkpoint spans the road there. Each has a place to put a car back on the road. The standing start is the grid's first slot (the hotlap's own start for a
// hotlap); the rolling start AC's hotlap start, where a flying lap begins. All in BeamNG's axes.
import { boardsDae } from "./dae";

export const CHECKPOINT_STEP = 40;
export const HALF_ROAD = 6;
export const LAPS = 3;
/** the lap times for one to five stars, from the lap's length: metres a second on average */
export const STAR_SPEEDS = [11, 13, 15, 17, 19];

/** the cones AC knocks about, as cones of BeamNG's cones prop, AC's size, all of a layout's one vehicle */
const CONE_WIDTH = 0.4;
const CONE_HEIGHT = 0.7;
const CONE_MASS = 1.2;
const CONE_FRICTION = 0.7;
const CONE = {
	dataBlock: "default_vehicle",
	jbeam: "cones",
	color: [0.853, 0.388, 0.046, 2],
	colorPalette0: [0.95, 0.95, 0.95, 1],
	colorPalette1: [0.853, 0.388, 0.046, 2],
	metallicPaintData: [[0, 0.344, 0, 0], [1, 0.526, 0, 0], [0, 0.344, 0, 0], null],
	paints:
		'{{["baseColor"]={0.853,0.388,0.046,2},["roughness"]=0.344,["clearcoat"]=0,["metallic"]=0,["clearcoatRoughness"]=0},' +
		'{["baseColor"]={0.95,0.95,0.95,1},["roughness"]=0.526,["clearcoat"]=0,["metallic"]=1,["clearcoatRoughness"]=0},' +
		'{["baseColor"]={0.853,0.388,0.046,2},["roughness"]=0.344,["clearcoat"]=0,["metallic"]=0,["clearcoatRoughness"]=0}}',
	autoEnterVehicle: "false",
};
const CONE_DROP = 0.03;
const BOARD_MASS = 2.5;
/** the AI races: the racers at first, the most the race's settings offer */
const AI_RACERS = 9;
const AI_MAX = 35;

export type V3 = [number, number, number];

/** A distance board as its race places it: its hull's 8 corners, its mesh drawn. */
export interface Board {
	box: V3[];
	P: number[];
	N: number[];
	U: number[];
	F: number[];
}

/** The rotation BeamNG's race start positions take, x y z w: its y facing fwd (BeamNG's quaternions the conjugates of the usual ones: the usual one's x, y, z
 * negated). */
export function quat(fwd: V3, up: V3 = [0, 0, 1]): number[] {
	const n = Math.hypot(...fwd) || 1;
	const y: V3 = [fwd[0] / n, fwd[1] / n, fwd[2] / n];
	let x: V3 = [y[1] * up[2] - y[2] * up[1], y[2] * up[0] - y[0] * up[2], y[0] * up[1] - y[1] * up[0]];
	const nx = Math.hypot(...x) || 1;
	x = [x[0] / nx, x[1] / nx, x[2] / nx];
	const z: V3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
	// (m: x, y, z its columns)
	const m = [
		[x[0], y[0], z[0]],
		[x[1], y[1], z[1]],
		[x[2], y[2], z[2]],
	] as [V3, V3, V3];
	const w = Math.sqrt(Math.max(0, 1 + m[0][0] + m[1][1] + m[2][2])) / 2;
	if (w > 1e-6) return [(m[1][2] - m[2][1]) / (4 * w), (m[2][0] - m[0][2]) / (4 * w), (m[0][1] - m[1][0]) / (4 * w), w];
	const d = [m[0][0], m[1][1], m[2][2]];
	const k = d.indexOf(Math.max(...d));
	return [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, 0];
}

const plus = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export interface RacePath {
	pathnodes: Record<string, unknown>[];
	startPositions: Record<string, unknown>[];
	segments: Record<string, unknown>[];
	startNode: number;
	[k: string]: unknown;
}

/** BeamNG's race path (race.race.json) for a racing line and its sides (left, right half widths; null: none known): gates AC's timing gates (left, right), the
 * first the start and finish; standing, rolling the starts (where, forward); onRoad a point on the road under it. The path and its lap's length. */
export function racePath(
	line: V3[],
	sides: [number, number][] | null,
	gates: [V3, V3][],
	standing: [V3, V3],
	rolling: [V3, V3],
	onRoad: (p: V3) => V3,
	lift: number,
): { path: RacePath; length: number } {
	const n = line.length;
	const s: number[] = [0];
	for (let i = 0; i < n; i++) {
		const a = line[i] as V3;
		const b = line[(i + 1) % n] as V3;
		s.push((s[i] as number) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
	}
	const length = s[n] as number;
	const at = (i: number) => line[((i % n) + n) % n] as V3;
	const along = (i: number): V3 => {
		const a = at(i + 2);
		const b = at(i - 2);
		const d: V3 = [a[0] - b[0], a[1] - b[1], 0];
		const L = Math.hypot(d[0], d[1]) || 1;
		return [d[0] / L, d[1] / L, 0];
	};
	const across = (i: number): [V3, number] => {
		const f = along(i);
		const left: V3 = [-f[1], f[0], 0];
		const [sl, sr] = sides ? (sides[((i % n) + n) % n] as [number, number]).map((v) => Math.min(v, HALF_ROAD)) : [HALF_ROAD / 2, HALF_ROAD / 2];
		const mid = plus(at(i), [(left[0] * ((sl as number) - (sr as number))) / 2, (left[1] * ((sl as number) - (sr as number))) / 2, 0]);
		return [onRoad(mid), ((sl as number) + (sr as number)) / 2];
	};
	const nearest = (p: V3) => {
		let k = 0;
		let bd = Infinity;
		line.forEach((q, i) => {
			const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
			if (d < bd) {
				bd = d;
				k = i;
			}
		});
		return k;
	};
	const searchsorted = (v: number) => {
		let lo = 0;
		let hi = s.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((s[mid] as number) < v) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	};
	// (the gates where the racing line crosses them; the start's first, the line from it on)
	const picks = gates.map(([l, r], g) => {
		const mid: V3 = [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2];
		return { i: nearest(mid), g, half: Math.hypot(l[0] - r[0], l[1] - r[1]) / 2 };
	});
	const first = (picks[0] as { i: number }).i;
	const pos = (i: number) => ((((s[i] as number) - (s[first] as number)) % length) + length) % length;
	const nodes = [...picks].sort((a, b) => pos(a.i) - pos(b.i));
	const full: { i: number; g: number | null; half: number | null }[] = [];
	nodes.forEach((x, k) => {
		full.push(x);
		const a = pos(x.i);
		const b = k + 1 < nodes.length ? pos((nodes[k + 1] as { i: number }).i) : length;
		const extra = Math.ceil((b - a) / CHECKPOINT_STEP) - 1;
		for (let e = 1; e <= extra; e++) {
			const q = ((s[first] as number) + a + ((b - a) * e) / (extra + 1)) % length;
			full.push({ i: searchsorted(q) % n, g: null, half: null });
		}
	});
	let id = 0;
	const next = () => ++id;
	const pathnodes: Record<string, unknown>[] = [];
	const starts: Record<string, unknown>[] = [];
	const segments: Record<string, unknown>[] = [];
	const startPosition = (name: string, group: string, p: V3, fwd: V3) => {
		const sid = next();
		starts.push({ group, name, oldId: sid, pos: plus(onRoad(p), [0, 0, lift]), rot: quat(fwd) });
		return sid;
	};
	full.forEach(({ i, g, half }, k) => {
		const [mid, width] = across(i);
		const radius = (g !== null ? Math.max(width, Math.min(half as number, 2 * HALF_ROAD)) : width) + 1;
		const nid = next();
		const name = k === 0 ? "Start" : g !== null ? `Split ${g}` : `Checkpoint ${k}`;
		const rec = startPosition(`${name} Recovery Forward`, "recovery", at(i - 4), along(i - 4));
		pathnodes.push({
			customFields: { names: {}, tags: {}, types: {}, values: {} },
			mode: "manual",
			name,
			navRadiusScale: 1,
			normal: along(i),
			oldId: nid,
			pos: plus(mid, [0, 0, lift]),
			radius,
			recovery: rec,
			reverseRecovery: -1,
			sidePadding: [1, 1],
			useAsSplit: g !== null,
			visible: true,
		});
	});
	pathnodes.forEach((p, k) => {
		segments.push({
			capsules: {},
			from: p.oldId,
			mode: "waypoint",
			name: `Segment ${k + 1}`,
			oldId: next(),
			to: (pathnodes[(k + 1) % pathnodes.length] as Record<string, unknown>).oldId,
		});
	});
	const standingId = startPosition("Start Position fwd", "start", ...standing);
	const rollingId = startPosition("Start Position fwd roll", "start", ...rolling);
	// (where the car stops after the finish: a little on from the line)
	const after = searchsorted(((s[first] as number) + 30) % length) % n;
	startPosition("finalPosFwd", "start", across(after)[0], along(after));
	const path: RacePath = {
		authors: "",
		classification: { allowRollingStart: true, branching: false, closed: true, reversible: false },
		date: 0,
		defaultLaps: LAPS,
		defaultStartPosition: standingId,
		description: "",
		difficulty: 24,
		endNode: -1,
		forwardPrefabs: {},
		hideMission: false,
		name: "Path",
		pacenotes: {},
		pathnodes,
		prefabs: {},
		reversePrefabs: {},
		reverseStartPosition: -1,
		rollingReverseStartPosition: -1,
		rollingStartPosition: rollingId,
		segments,
		simplifyAiPath: false,
		startNode: (pathnodes[0] as { oldId: number }).oldId,
		startPositions: starts,
	};
	return { path, length };
}

/** The race's path with the grid's slots as the AI race's racers' start positions: Racer Start 1 on. */
export function aiPath(path: RacePath, grid: [V3, V3][]): RacePath {
	const out = JSON.parse(JSON.stringify(path)) as RacePath;
	const sid = Math.max(...[...out.startPositions, ...out.pathnodes].map((p) => p.oldId as number)) + 1;
	grid.forEach(([at, fwd], k) => {
		out.startPositions.push({
			group: "start",
			name: `Racer Start ${k + 1}`,
			oldId: sid + k,
			pos: at,
			rot: quat([fwd[0], fwd[1], 0]),
		});
	});
	return out;
}

/** An AI race's info.json: the layout raced against karts as the player's, on its grid, the player at its back. */
export function aiMission(
	level: string,
	folder: string,
	r: { title: string; description: string; author: string; trigger: [V3, V3] },
	racers: number,
	date: number,
) {
	const most = Math.max(1, Math.min(AI_MAX, racers - 1));
	const [at, fwd] = r.trigger;
	return {
		name: `${r.title} race`,
		description: r.description,
		author: r.author,
		date,
		devMission: false,
		missionType: "aiRace",
		missionTypeData: {
			allowFlip: true,
			allowRecover: true,
			camPathActive: false,
			damageFailActive: false,
			damageFailText: "missions.aiRace.general.damageFail",
			damageLimit: 10000,
			flipLimit: -1,
			goalCollisionsLimit: 1,
			goalCollisionsTarget: 5,
			goalLaps: LAPS,
			goalRecoveries: 0,
			goalTime: 0,
			lapCount: LAPS,
			mapPreviewMode: "navgraph",
			maxRacerCount: most,
			minRacerCount: 1,
			playerStartIndex: 0,
			prefabActive: true,
			raceFile: `/gameplay/missions/${folder}/race.race.json`,
			racerAggression: 1,
			racerAwareness: true,
			racerCount: Math.min(AI_RACERS, most),
			racerRandomnessScale: 1,
			racerRough: false,
			racerRubberbandMode: false,
			racerSkill: 1,
			recoverLimit: -1,
			shuffleGroup: false,
			smartStartPlace: true,
			stoppedLimit: 0,
			startText: `${LAPS} laps against karts like yours, from the back of the grid. Finish in the top three for a star, first for all three.`,
			useGroundmarkers: false,
			vehicleGroupActive: false,
			vehicleGroupByClass: "same",
			vehicleGroupByClassActive: true,
			vehiclePerformanceOffset: 0,
			vehicleFilters: {
				allowAuxiliaryVehicles: false,
				allowLoadedTrailers: false,
				baseFilter: { blackList: [], whiteList: [] },
				manualAdditions: {},
				manualRemovals: {},
				maxVehicles: 0,
				popAttribute: "Population",
				probabilitySettings: {},
			},
		},
		additionalAttributes: { difficulty: "medium" },
		customAdditionalAttributes: {},
		careerSetup: {
			showInCareer: false,
			showInFreeroam: true,
			skill: "(none)",
			starOutroTexts: {},
			starRewards: {},
			defaultStarKeys: ["finishBronze", "finishSilver", "finishGold"],
			starsActive: { finishBronze: true, finishSilver: true, finishGold: true },
		},
		grouping: { id: "", label: "" },
		isAvailableAsScenario: true,
		layers: [
			{ dir: `/gameplay/missions/${folder}/`, fixed: true, isMissionFolderDir: true, isMissionTypeDir: false },
			{ dir: "/gameplay/missionTypes/aiRace/", fixed: true, isMissionFolderDir: false, isMissionTypeDir: true },
		],
		retryBehaviour: "infiniteRetries",
		setupModules: {
			traffic: { enabled: false },
			vehicles: {
				enabled: true,
				includePlayerVehicle: true,
				playerVehicleDiffs: {},
				prioritizePlayerVehicle: true,
				vehicles: {},
			},
		},
		startCondition: { type: "automatic" },
		visibleCondition: { type: "automatic" },
		startTrigger: { type: "coordinates", level, pos: at, radius: 4, rot: quat([fwd[0], fwd[1], 0]) },
	};
}

/** A time trial's info.json. */
export function mission(
	level: string,
	folder: string,
	r: { title: string; description: string; author: string; trigger: [V3, V3]; length: number },
	date: number,
) {
	const times = STAR_SPEEDS.map((v) => Math.round(r.length / v));
	const data: Record<string, unknown> = {
		allowFlip: true,
		allowRecover: true,
		allowRollingStart: true,
		canChangeLapAmount: true,
		closed: true,
		defaultLaps: LAPS,
		reversible: false,
		mapPreviewMode: "navgraph",
		flipLimit: -1,
		flipPenalty: 5,
		recoverLimit: -1,
		recoverPenalty: 5,
		justFinishPenalty: 30,
		startScreenText: `A time trial of ${LAPS} laps, from a standing or a rolling start. The stars are for your best lap.`,
	};
	times.forEach((t, k) => {
		data[`lapTime${k + 1}`] = t;
	});
	for (const [medal, t] of [
		["bronze", times[0]],
		["silver", times[2]],
		["gold", times[4]],
	] as [string, number][]) {
		data[`${medal}Time`] = t * LAPS;
		data[`${medal}TimeTotal`] = t * LAPS;
		data[`${medal}TimePenalty`] = 0;
	}
	return {
		author: r.author,
		date,
		devMission: false,
		name: r.title,
		description: r.description,
		missionType: "timeTrial",
		missionTypeData: data,
		additionalAttributes: { difficulty: "medium" },
		customAdditionalAttributes: {},
		careerSetup: {
			showInFreeroam: true,
			skill: "(none)",
			starOutroTexts: {},
			starRewards: {},
			defaultStarKeys: [1, 2, 3, 4, 5].map((k) => `lapTime${k}`),
			starsActive: { justFinish: false, ...Object.fromEntries([1, 2, 3, 4, 5].map((k) => [`lapTime${k}`, true])) },
		},
		grouping: { id: "", label: "" },
		layers: [
			{ dir: `/gameplay/missions/${folder}/`, fixed: true, isMissionFolderDir: true, isMissionTypeDir: false },
			{ dir: "/gameplay/missionTypes/timeTrial/", fixed: true, isMissionFolderDir: false, isMissionTypeDir: true },
		],
		retryBehaviour: "infiniteRetries",
		setupModules: {
			environment: { enabled: false },
			traffic: { enabled: false },
			vehicles: {
				enabled: true,
				includePlayerVehicle: true,
				playerVehicleDiffs: {},
				prioritizePlayerVehicle: false,
				vehicles: {},
			},
		},
		startCondition: { type: "automatic" },
		startTrigger: { level, type: "coordinates", pos: r.trigger[0], radius: 3, rot: quat(r.trigger[1]) },
		visibleCondition: { type: "always" },
	};
}

/** A set of a layout's loose cones and boards: the vehicle placing them all, and what makes its part. */
export interface ConeSet {
	name: string;
	feet: V3[];
	boards: Board[];
}

/** A prefab of a layout's cones (feet in the level's place) and boards, as one vehicle with its first cone's foot (or board's) where it is placed: an object a
 * line, in the group the last line makes. The set its part is made of. */
export function conePrefab(tag: string, feet: V3[], boards: Board[]): { prefab: string; set: ConeSet } {
	const name = tag
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	let origin: V3;
	if (feet.length) origin = feet[0] as V3;
	else {
		const box = (boards[0] as Board).box;
		const mx = box.reduce((a, p) => a + p[0], 0) / box.length;
		const my = box.reduce((a, p) => a + p[1], 0) / box.length;
		origin = [mx, my, Math.min(...box.map((p) => p[2]))];
	}
	const less = (p: V3): V3 => [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
	const set: ConeSet = {
		name,
		feet: feet.map(less),
		boards: boards.map((b) => {
			const P = b.P.slice();
			for (let i = 0; i < P.length; i += 3) {
				P[i] = (P[i] as number) - origin[0];
				P[i + 1] = (P[i + 1] as number) - origin[1];
				P[i + 2] = (P[i + 2] as number) - origin[2];
			}
			return { ...b, box: b.box.map(less), P };
		}),
	};
	const lines = [
		{
			internalName: "cones",
			class: "BeamNGVehicle",
			persistentId: uuid5(tag),
			__parent: "SimGroup_",
			position: plus(origin, [0, 0, CONE_DROP]),
			rotationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
			...CONE,
			partConfig: `vehicles/cones/${name}.pc`,
		},
		{ name: "SimGroup_", class: "SimGroup", groupPosition: "0 0 0" },
	];
	return { prefab: lines.map((x) => `${JSON.stringify(x)}\n`).join(""), set };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The parts of the cones prop the prefabs' vehicles are, and a config for each (vehicles/cones): in each, a cone at each foot of its set, as BeamNG's own cone
 * is built (four nodes round its foot, one at its top, beams between them, its mesh on them), each its own group; each board a node at each corner of its box,
 * held square, its mesh on them. Its files by name. */
export function coneParts(sets: ConeSet[], boardTexture: Uint8Array | null): Map<string, Uint8Array | string> {
	const files = new Map<string, Uint8Array | string>();
	const w = CONE_WIDTH / 2;
	const corner = (CONE_MASS * 0.85) / 4;
	const scale = { x: CONE_WIDTH / 0.3, y: CONE_WIDTH / 0.3, z: CONE_HEIGHT / 0.47 };
	const parts: Record<string, unknown> = {};
	const meshes: { name: string; P: number[]; N: number[]; U: number[]; F: number[] }[] = [];
	for (const { name, feet, boards } of [...sets].sort((a, b) => (a.name < b.name ? -1 : 1))) {
		const flex: unknown[] = [["mesh", "[group]:"]];
		const nodes: unknown[] = [
			["id", "posX", "posY", "posZ"],
			{ frictionCoef: CONE_FRICTION },
			{ nodeMaterial: "|NM_PLASTIC" },
			{ collision: true },
			{ selfCollision: false },
		];
		const beams: unknown[] = [];
		const limits: unknown[] = [];
		const tris: unknown[] = [];
		feet.forEach((f, k) => {
			const g = `cone${k}`;
			const n = ["1r", "1l", "2r", "2l", "3"].map((x) => `k${k}_${x}`);
			const p: V3[] = (
				[
					[-w, w, 0],
					[w, w, 0],
					[-w, -w, 0],
					[w, -w, 0],
					[0, 0, CONE_HEIGHT],
				] as V3[]
			).map((d) => plus(f, d));
			flex.push({ pos: { x: f[0], y: f[1], z: f[2] } }, ["cone_01a", [g], { scale }]);
			nodes.push({ group: g }, { nodeWeight: corner }, ...[0, 1, 2, 3].map((i) => [n[i], ...(p[i] as V3).map(r4)]));
			nodes.push({ nodeWeight: CONE_MASS * 0.15 }, [n[4], ...(p[4] as V3).map(r4)]);
			for (const [a, b] of [
				[0, 4],
				[1, 4],
				[2, 4],
				[3, 4],
				[0, 1],
				[2, 3],
				[0, 2],
				[1, 3],
				[0, 3],
				[1, 2],
			] as [number, number][])
				beams.push([n[a], n[b]]);
			for (let a = 0; a < 4; a++) limits.push([n[a], n[4]]);
			tris.push(
				{ group: g },
				...(
					[
						[4, 2, 3],
						[4, 0, 2],
						[4, 1, 0],
						[4, 3, 1],
						[1, 3, 2],
						[1, 2, 0],
					] as V3[]
				).map(([a, b, c]) => [n[a], n[b], n[c]]),
			);
		});
		if (boards.length) flex.push({ pos: { x: 0, y: 0, z: 0 } });
		boards.forEach((b, k) => {
			const g = `board${k}`;
			const n = Array.from({ length: 8 }, (_, j) => `b${k}_${j}`);
			const mesh = `tsvp_${name}_board${k}`;
			meshes.push({ name: mesh, P: b.P, N: b.N, U: b.U, F: b.F });
			flex.push([mesh, [g]]);
			nodes.push({ group: g }, { nodeWeight: BOARD_MASS / 8 }, ...b.box.map((c, j) => [n[j], ...c.map(r4)]));
			for (let a = 0; a < 8; a++) for (let c = a + 1; c < 8; c++) beams.push([n[a], n[c]]);
			tris.push(
				{ group: g },
				...(
					[
						[0, 1, 2],
						[2, 3, 0],
						[4, 5, 6],
						[6, 7, 4],
						[0, 3, 5],
						[5, 4, 0],
						[7, 6, 2],
						[2, 1, 7],
						[1, 0, 4],
						[4, 7, 1],
						[3, 2, 6],
						[6, 5, 3],
					] as V3[]
				).map(([a, b2, c]) => [n[a], n[b2], n[c]]),
			);
		});
		nodes.push({ group: "" });
		tris.push({ group: "" });
		parts[`cone_${name}`] = {
			information: { authors: "Techspeed FuelTech Velopark", name: `Techspeed FuelTech Velopark cones (${name})` },
			slotType: "cone",
			flexbodies: flex,
			refNodes: [["ref:", "back:", "left:", "up:"], feet.length ? ["k0_2r", "k0_1r", "k0_2l", "k0_3"] : ["b0_3", "b0_0", "b0_2", "b0_1"]],
			nodes,
			beams: [
				["id1:", "id2:"],
				{ beamPrecompression: 1, beamType: "|NORMAL", beamLongBound: 1, beamShortBound: 1 },
				{ beamSpring: 15000, beamDamp: 60 },
				{ beamDeform: 10000, beamStrength: "FLT_MAX" },
				{ deformLimitExpansion: 1.1 },
				...beams,
				{ beamType: "|BOUNDED", beamLongBound: 0, beamShortBound: 1 },
				{ beamSpring: 0, beamDamp: 0 },
				{ beamLimitSpring: 15000, beamLimitDamp: 60 },
				{ beamDeform: "FLT_MAX", beamStrength: "FLT_MAX" },
				...limits,
				{ beamPrecompression: 1, beamType: "|NORMAL", beamLongBound: 1, beamShortBound: 1 },
			],
			triangles: [["id1:", "id2:", "id3:"], { dragCoef: 50 }, ...tris],
		};
		files.set(
			`vehicles/cones/${name}.pc`,
			JSON.stringify(
				{
					format: 2,
					mainPartName: "cones",
					model: "cones",
					vars: {},
					parts: { cone: `cone_${name}`, paint_design: "cone_skin_single" },
				},
				null,
				1,
			),
		);
	}
	files.set("vehicles/cones/techspeed_fueltech_velopark_cones.jbeam", JSON.stringify(parts, null, 1));
	if (meshes.length && boardTexture) {
		files.set("vehicles/cones/techspeed_fueltech_velopark_boards.dae", boardsDae(meshes));
		files.set("vehicles/cones/techspeed_fueltech_velopark_boards.png", boardTexture);
		files.set(
			"vehicles/cones/techspeed_fueltech_velopark_boards.materials.json",
			JSON.stringify(
				{
					tsvp_marker_boards: {
						name: "tsvp_marker_boards",
						mapTo: "tsvp_marker_boards",
						class: "Material",
						persistentId: uuid5("techspeed_fueltech_velopark/boards"),
						version: 1.5,
						Stages: [
							{
								baseColorMap: "/vehicles/cones/techspeed_fueltech_velopark_boards.png",
								roughnessFactor: 0.8,
								metallicFactor: 0,
							},
							{},
							{},
							{},
						],
					},
				},
				null,
				1,
			),
		);
	}
	return files;
}

/** A name-based id as uuid5 of the URL namespace makes one, near enough: the same name, the same id (a stable id, not the same bytes as Python's: BeamNG only
 * asks that it is unique and keeps). */
export function uuid5(name: string): string {
	// (FNV-1a over the name, four ways seeded, as the 32 hex digits)
	const parts = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((seed) => {
		let h = seed >>> 0;
		for (let i = 0; i < name.length; i++) {
			h ^= name.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		return h.toString(16).padStart(8, "0");
	});
	const hex = parts.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16] as string, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
