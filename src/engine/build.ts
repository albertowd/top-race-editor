// The track built from the editor, where the engine runs: the track made by the engine (trackbuild.ts: track/models from the source), then the AC track made
// from it (acbuild.ts), installed in the game if asked, the BeamNG level (beamng/level.ts, from the AC track just made), the rFactor 2 location (rf2/build.ts,
// from the track's data: copied into rFactor 2's ModDev if asked) and the AC track packed as release.ps1 packs it (build/dist/<track>_ac.7z, 7-Zip; a .zip
// where there is no 7-Zip).
//
// A job in the background, one at a time; its log as the build says it. How far it is: its stages (the track made, the AC track made, the BeamNG level, the
// packing; each expected to take what it took the last time the editor did it); 7-Zip's percentage while it packs.
//
// One build at a time, whoever starts it: the editor takes build/build.lock ({pid, started, args}) round all it does, and begins none while a living process
// holds it (taken over when its pid is gone).

import { acFolder, buildAc } from "./acbuild";
import { layoutsMissing } from "./exportcheck";
import { writeZip } from "./npz";
import { byCodePoint } from "./order";
import type { HostFiles } from "./placehost";
import { type PyJson, plain } from "./pyjson";
import { buildRf2 } from "./rf2/build";
import type { Rf2PictureHost } from "./rf2/pictures";
import { readPart } from "./trackdoc";
import type { TrackSettings } from "./trackfiles";

/** A process started by the host: its id, its end (its exit code), a way to stop it and the ones it started. */
export interface Proc {
	pid: number;
	done: Promise<number>;
	kill(): void;
}

export interface FileStat {
	size: number;
	/** when last written, ms */
	mtime: number;
	dir: boolean;
}

/** What a build needs of the computer (the engine window's Node). */
export interface SystemHost {
	/** this process's id (the lock's) */
	pid: number;
	env(name: string): string | undefined;
	/** a program run (7-Zip), what it says (out and err together, as it comes) to out */
	spawn(cmd: string, args: string[], opts: { cwd: string; env?: Record<string, string> }, out: (text: string) => void): Proc;
	alive(pid: number): boolean;
	/** a program on the PATH, if there is one */
	which(name: string): string | null;
	/** whether a program of that name is running (acs.exe) */
	running(image: string): Promise<boolean>;
	stat(path: string): Promise<FileStat | null>;
	/** a file copied, its time kept */
	copy(from: string, to: string): Promise<void>;
	/** a file made only if there is none (O_EXCL): whether it was */
	createNew(path: string, text: string): Promise<boolean>;
	/** a file put in another's place */
	move(from: string, to: string): Promise<void>;
	/** a folder made, with those it is in */
	mkdir(path: string): Promise<void>;
	/** an empty folder taken out */
	rmdir(path: string): Promise<void>;
	/** seconds since 1970 */
	now?(): number;
}

export class BuildError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "BuildError";
	}
}

const LOG = 400;
const SEVEN_ZIP = ["C:/Program Files/7-Zip/7z.exe", "C:/Program Files (x86)/7-Zip/7z.exe"];
export const GAMES = { ac: "Assetto Corsa", beamng: "BeamNG.drive", rf2: "rFactor 2" } as const;
export type Game = keyof typeof GAMES;
/** the layout BeamNG starts the level on (every layout is the level's) */
const BEAMNG_LAYOUT = "vp_1500";
const PERCENT = /(\d{1,3})%/g;
const DEFAULT_SECONDS = { track: 120, ac: 60, pack: 120, beamng: 300, rf2: 60 };
/** build/cache: how long the track, the AC track, the BeamNG level, the rFactor 2 location and the packing took the last time */
const TIMES = "editor_build.json";
const DEFAULT_GAME = String.raw`D:\SteamLibrary\steamapps\common\assettocorsa\content\tracks`;

const text = async (files: HostFiles, p: string): Promise<string | null> => {
	try {
		return new TextDecoder().decode(await files.read(p));
	} catch {
		return null;
	}
};

/** A path without the slashes (either way) it ends with. */
function trimSlashes(path: string): string {
	let end = path.length;
	while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end--;
	return path.slice(0, end);
}

/** Where a path with / starts: its drive's root (C:/), the root (/), else nothing (a path from where it is). */
function rootOf(s: string): string {
	if (/^[A-Za-z]:\//.test(s)) return s.slice(0, 3);
	return s.startsWith("/") ? "/" : "";
}

/** A path with / and no . or .. in it. */
export function normalPath(p: string): string {
	const parts: string[] = [];
	const s = p.replaceAll("\\", "/");
	const lead = rootOf(s);
	for (const part of s.slice(lead.length).split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return lead + parts.join("/");
}

/** A track's tools: its project's own, or (a track the wizard made) another project's, as its track file says. */
export function toolsOf(s: TrackSettings): string {
	const project = trimSlashes(s.project);
	const t = s.track.tools;
	if (typeof t !== "string" || !t) return `${project}/tools`;
	return normalPath(/^([A-Za-z]:)?[\\/]/.test(t) ? t : `${project}/${t}`);
}

const stamp = (d = new Date()) => {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

type StageKind = "step" | "ac" | "beamng" | "rf2" | "pack";
type StageState = "waiting" | "running" | "cached" | "done" | "skipped" | "failed" | "stopped";

/** A stage of a build: the track made, the AC track made, the BeamNG level, or the packing. */
export class Stage {
	started = 0;
	seconds: number | null = null;
	constructor(
		readonly name: string,
		readonly kind: StageKind,
		readonly label: string,
		readonly expected: number,
		public state: StageState = "waiting",
	) {}

	begin(now: number): void {
		if (this.state === "waiting") {
			this.state = "running";
			this.started = now;
		}
	}

	end(state: StageState, now: number, seconds?: number): void {
		this.state = state;
		this.seconds = seconds ?? (this.started ? now - this.started : 0);
	}

	page(now: number) {
		return {
			name: this.name,
			kind: this.kind,
			label: this.label,
			state: this.state,
			expected: Math.round(this.expected),
			seconds: round1(this.seconds ?? (this.started ? now - this.started : 0)),
		};
	}
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** How far a running stage is (0 to 1), spent seconds in: the packing's by 7-Zip's percentage where it says one, else by what it took the last time (0.95 at
 * most), else half. */
function runningPart(s: Stage, spent: number, percent: number | null): number {
	if (s.kind === "pack" && percent !== null) return percent / 100;
	return s.expected ? Math.min(spent / s.expected, 0.95) : 0.5;
}

/** What a build that failed says of why: its error's message, else the error as text ("Error" where that says nothing). */
function failure(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)) || "Error";
}

export class BuildJob {
	archives: { game: Game; path: string; size: number }[] = [];
	state: "running" | "done" | "failed" | "stopped" = "running";
	/** models: the track being made; pack: its AC track packed */
	step: "models" | "pack" = "models";
	/** the build's step running */
	now = "";
	log: string[] = [];
	error = "";
	archive = "";
	size = 0;
	/** 7-Zip's, packing */
	percent: number | null = null;
	started: number;
	heard: number;
	ended = 0;
	stop = false;
	proc: Proc | null = null;
	/** the BeamNG level's zip put in BeamNG's mods folder too */
	installBeamng = false;
	/** the rFactor 2 location copied into rFactor 2's ModDev/Locations too (to try in its Mod Mode) */
	installRf2 = false;
	/** the AC track packed (its archive): not where it is only installed */
	packAc = true;
	/** where the build put the games' tracks: [game, folder] */
	installed: [Game, string][] = [];

	constructor(
		readonly id: string,
		readonly install: boolean,
		readonly everything: boolean,
		readonly stages: Stage[],
		private readonly clock: () => number,
		readonly games: Game[] = ["ac"],
	) {
		this.started = clock();
		this.heard = this.started;
	}

	stage(name: string): Stage | undefined {
		return this.stages.find((s) => s.name === name);
	}

	running(): Stage | undefined {
		return this.stages.find((s) => s.state === "running");
	}

	/** The first stage still waiting, begun (the stages run in their order). */
	next(now: number): void {
		if (this.running()) return;
		const nxt = this.stages.find((s) => s.state === "waiting");
		if (nxt) {
			nxt.begin(now);
			if (nxt.kind === "step") this.now = nxt.name;
		}
	}

	/** A line said. */
	say(line: string): void {
		this.log.push(line);
		this.log.splice(0, Math.max(0, this.log.length - LOG));
		this.heard = this.clock();
	}

	beginStage(name: string): void {
		const now = this.clock();
		for (const s of this.stages) if (s.name !== name && s.state === "running") s.end("done", now);
		this.stage(name)?.begin(now);
	}

	endStage(name: string, state: StageState = "done"): void {
		const st = this.stage(name);
		if (st && (st.state === "running" || st.state === "waiting")) st.end(state, this.clock());
	}

	/** What it is doing now: its stage, the last line said and how long ago, whether it is still at work. */
	activity(now: number) {
		const st = this.running();
		return {
			stage: st ? st.label : "",
			line: this.log.at(-1) ?? "",
			quiet: round1(Math.max(0, now - this.heard)),
			alive: this.state === "running",
		};
	}

	/** How far it is (0 to 1) and the seconds it may still take, from what each stage took the last time. */
	estimate(now: number): [number, number] {
		const total = this.stages.filter((s) => s.state !== "skipped").reduce((a, s) => a + s.expected, 0) || 1;
		let done = 0;
		let left = 0;
		for (const s of this.stages) {
			if (s.state === "done" || s.state === "cached" || s.state === "skipped") done += s.state !== "skipped" ? s.expected : 0;
			else if (s.state === "running") {
				const spent = now - s.started;
				const part = runningPart(s, spent, this.percent);
				done += s.expected * part;
				left += Math.max(s.expected - spent, s.expected * (1 - part), 0);
			} else left += s.expected;
		}
		return [Math.min(done / total, 1), left];
	}

	page() {
		const now = this.ended || this.clock();
		let [fraction, left] = this.estimate(now);
		if (this.state === "done") [fraction, left] = [1, 0];
		return {
			id: this.id,
			state: this.state,
			step: this.step,
			steps: ["models", "pack"],
			now: this.now,
			log: [...this.log],
			error: this.error,
			archive: this.archive,
			size: this.size,
			install: this.install,
			installBeamng: this.installBeamng,
			installRf2: this.installRf2,
			/** asked to stop, still at work until its stage says its next line */
			stopping: this.stop && this.state === "running",
			packAc: this.packAc,
			installed: this.installed.map(([game, path]) => ({ game, path })),
			seconds: round1(now - this.started),
			games: [...this.games],
			archives: [...this.archives],
			stages: this.stages.map((s) => s.page(now)),
			fraction: Math.round(fraction * 1e4) / 1e4,
			left: Math.round(left),
			percent: this.percent,
			activity: this.state === "running" ? this.activity(now) : null,
		};
	}
}

export interface BuilderOptions {
	/** the editor's own models (their .glb and catalogue.json), for the AC track's physics objects */
	editorModels?: string;
	/** the track made by the engine (trackbuild.ts: track/models from the source) */
	makeTrack: (log: (line: string) => void) => Promise<void>;
	/** the BeamNG level made by the engine (beamng/level.ts), of a layout, from the AC track made (its AI lines): where it runs with what it needs (the app's
	 * engine window); none, no BeamNG level */
	makeBeamng?: (o: { layout: string; ai: string; log: (line: string) => void }) => Promise<void>;
	/** the AC track's layouts' pictures made in it (layoutmap.ts: each one's photo with its map, its outline), before it is installed or packed: where there is a
	 * canvas to draw them on (the app's engine window); none, the track's pictures as they came */
	makeAcPictures?: (o: { out: string; log: (line: string) => void }) => Promise<void>;
	/** what draws the rFactor 2 location's pictures (its icons, thumbnails, loading screens) and renders the track under some: where there is a canvas (the app's
	 * engine window); none, no pictures */
	rf2Pictures?: Rf2PictureHost;
}

/** The builds of a track (one at a time). */
export class Builder {
	readonly jobs = new Map<string, BuildJob>();
	private readonly clock: () => number;

	constructor(
		readonly files: HostFiles,
		readonly sys: SystemHost,
		readonly settings: TrackSettings,
		readonly opts: BuilderOptions,
	) {
		this.clock = sys.now ?? (() => Date.now() / 1000);
	}

	get project(): string {
		return trimSlashes(this.settings.project);
	}

	/** The build's own cache (what each stage took the last time). */
	get cache(): string {
		return `${this.project}/build/cache`;
	}

	get lockfile(): string {
		return `${this.project}/build/build.lock`;
	}

	/** The track's folder name in the game, made from its name. */
	folderName(): string {
		const name: unknown = this.settings.track.name ?? this.project.split("/").pop() ?? "track";
		return acFolder(String(name));
	}

	/** Why this track cannot be built here ('' if it can): every layout whole (its racing lines, grid, pits, timing and hotlap start). */
	async whyNot(): Promise<string> {
		const objects = await readPart(this.files, this.settings, "objects").catch(() => null);
		const missing = layoutsMissing(objects === null ? null : plain(objects as PyJson));
		return missing.length ? `not ready to build: ${missing.join("; ")}` : "";
	}

	async sevenZip(): Promise<string | null> {
		const w = this.sys.which("7z");
		if (w) return w;
		for (const p of SEVEN_ZIP) if (await this.sys.stat(p)) return p;
		return null;
	}

	async archive(tid: string | null): Promise<string> {
		return `${this.project}/build/dist/${tid}_ac.${(await this.sevenZip()) ? "7z" : "zip"}`;
	}

	beamngArchive(tid: string | null): string {
		return `${this.project}/build/dist/${tid}_beamng.zip`;
	}

	/** The build lock there, if a living process holds it: {pid, started, args}. */
	async lockOf(): Promise<{ pid?: number; started?: string; args?: string[] } | null> {
		const t = await text(this.files, this.lockfile);
		if (t === null) return null;
		try {
			const d = JSON.parse(t);
			if (!d || typeof d !== "object" || Array.isArray(d) || !this.sys.alive(Number(d.pid) || 0)) return null;
			return d;
		} catch {
			return null;
		}
	}

	/** Whether the engine makes a BeamNG level here. */
	beamngAvailable(): boolean {
		return !!this.opts.makeBeamng;
	}

	/** AC's tracks folder: AC_TRACKS, else content/tracks of Assetto Corsa in one of Steam's libraries; null where none is found. */
	async acTracks(): Promise<string | null> {
		const given = this.sys.env("AC_TRACKS");
		if (given) return given;
		for (const lib of await this.steamLibraries()) {
			const p = `${lib}/steamapps/common/assettocorsa/content/tracks`;
			if ((await this.sys.stat(p))?.dir) return p;
		}
		return (await this.sys.stat(DEFAULT_GAME))?.dir ? DEFAULT_GAME : null;
	}

	/** Steam's libraries: where Steam is, and those its libraryfolders.vdf lists. */
	private async steamLibraries(): Promise<string[]> {
		const steam = [
			this.sys.env("ProgramFiles(x86)") && `${this.sys.env("ProgramFiles(x86)")}/Steam`,
			"C:/Program Files (x86)/Steam",
			this.sys.env("ProgramFiles") && `${this.sys.env("ProgramFiles")}/Steam`,
		].filter((p): p is string => !!p);
		const out: string[] = [];
		for (const s of steam) {
			if (!(await this.sys.stat(s))?.dir) continue;
			out.push(s);
			const vdf = await text(this.files, `${s}/steamapps/libraryfolders.vdf`);
			for (const m of vdf?.matchAll(/"path"\s+"([^"]+)"/g) ?? []) out.push((m[1] as string).replaceAll("\\\\", "\\"));
		}
		return [...new Set(out.map((p) => trimSlashes(p)))];
	}

	/** BeamNG's mods folder: BEAMNG_MODS, else its user folder's current one (BeamNG.drive/current/mods), else the newest version's of the older user folder
	 * (BeamNG.drive/<version>/mods); null where none is found. */
	async beamngMods(): Promise<string | null> {
		const given = this.sys.env("BEAMNG_MODS");
		if (given) return given;
		const local = this.sys.env("LOCALAPPDATA");
		if (!local) return null;
		const current = `${local}/BeamNG/BeamNG.drive/current/mods`;
		if ((await this.sys.stat(current))?.dir) return current;
		const old = `${local}/BeamNG.drive`;
		const versions = ((await this.sys.stat(old))?.dir ? await this.files.list(old) : [])
			.filter((v) => /^\d+(\.\d+)*$/.test(v))
			.sort((a, b) => {
				const x = a.split(".").map(Number);
				const y = b.split(".").map(Number);
				for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
				return 0;
			});
		for (const v of versions) if ((await this.sys.stat(`${old}/${v}/mods`))?.dir) return `${old}/${v}/mods`;
		return null;
	}

	/** rFactor 2's folder: RF2_FOLDER, else rFactor 2 in one of Steam's libraries (its ModDev there); null where none is found. */
	async rf2Folder(): Promise<string | null> {
		const given = this.sys.env("RF2_FOLDER");
		if (given) return given;
		for (const lib of await this.steamLibraries()) {
			const p = `${lib}/steamapps/common/rFactor 2`;
			if ((await this.sys.stat(`${p}/ModDev`))?.dir) return p;
		}
		return null;
	}

	/** where the rFactor 2 location is made (rf2/build.ts) */
	rf2Location(): string {
		return `${this.project}/build/rf2/Locations`;
	}

	/** What a build here would be. */
	async info() {
		const why = await this.whyNot();
		const tid = why ? null : this.folderName();
		const running = [...this.jobs.values()].find((j) => j.state === "running")?.id ?? null;
		const archive = tid ? await this.archive(tid) : "";
		return {
			available: !why,
			why,
			track: tid,
			archive,
			packer: (await this.sevenZip()) ? "7-Zip" : "zip",
			game: (await this.acTracks()) ?? "",
			beamngMods: await this.beamngMods(),
			rf2Folder: await this.rf2Folder(),
			locked: !!(await this.lockOf()) && !running,
			running,
			last: this.last(),
			games: [
				{ id: "ac", label: GAMES.ac, archive, available: true },
				{
					id: "beamng",
					label: GAMES.beamng,
					// (one map of every layout, each its activities)
					everyLayout: true,
					archive: tid ? this.beamngArchive(tid) : "",
					available: this.beamngAvailable(),
				},
				// (one location of every layout, its files as they are: tried in rFactor 2's Mod Mode)
				{ id: "rf2", label: GAMES.rf2, everyLayout: true, archive: this.rf2Location(), available: true },
			],
		};
	}

	private last() {
		let last: BuildJob | null = null;
		for (const j of this.jobs.values()) if (!last || j.started >= last.started) last = j;
		return last ? last.page() : null;
	}

	private async times(): Promise<Record<string, number>> {
		const t = await text(this.files, `${this.cache}/${TIMES}`);
		if (t === null) return {};
		try {
			const d = JSON.parse(t) as Record<string, unknown>;
			return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Number(v)]));
		} catch {
			return {};
		}
	}

	async stages(install: boolean, games: Game[] = ["ac"], o: { installBeamng?: boolean; installRf2?: boolean; packAc?: boolean } = {}): Promise<Stage[]> {
		const times = await this.times();
		const out = [new Stage("track", "step", "the track made by the engine", times.track ?? DEFAULT_SECONDS.track)];
		out.push(new Stage("ac", "ac", `the AC track made${install ? ", installed in the game" : ""}`, times.ac ?? DEFAULT_SECONDS.ac));
		if (games.includes("beamng"))
			out.push(
				new Stage(
					"beamng",
					"beamng",
					`the BeamNG level (every layout) made and packed${o.installBeamng ? ", installed in BeamNG" : ""}`,
					times.beamng ?? DEFAULT_SECONDS.beamng,
				),
			);
		if (games.includes("rf2"))
			out.push(
				new Stage(
					"rf2",
					"rf2",
					`the rFactor 2 location (every layout) made${o.installRf2 ? ", copied into rFactor 2's ModDev" : ""}`,
					times.rf2 ?? DEFAULT_SECONDS.rf2,
				),
			);
		if (games.includes("ac") && o.packAc !== false) out.push(new Stage("pack", "pack", "the AC track packed", times.pack ?? DEFAULT_SECONDS.pack));
		return out;
	}

	/** A build begun: installed in AC, every step made again, for the games given. */
	async start(install = false, everything = false, given: unknown = ["ac"], more: { installBeamng?: boolean; installRf2?: boolean; packAc?: boolean } = {}) {
		const why = await this.whyNot();
		if (why) throw new BuildError(why, 400);
		const asked = Array.isArray(given) ? given : [];
		const games = (Object.keys(GAMES) as Game[]).filter((g) => asked.includes(g));
		if (!games.length) throw new BuildError(`no game to build for: ${Object.keys(GAMES).join(", ")}`, 400);
		if (games.includes("beamng") && !this.beamngAvailable()) throw new BuildError("the engine makes no BeamNG level here", 400);
		// (installing in AC: its own; BeamNG's zip in its mods, BeamNG's)
		const inGame = install && games.includes("ac");
		const installBeamng = !!more.installBeamng && games.includes("beamng");
		const installRf2 = !!more.installRf2 && games.includes("rf2");
		await this.gamesFound(inGame, installBeamng, installRf2);
		// (the AC track packed unless only installed: AC reads its folder; BeamNG's level is always a zip)
		const packAc = more.packAc !== false || !inGame;
		if ([...this.jobs.values()].some((j) => j.state === "running")) throw new BuildError("a build is running already", 409);
		const held = await this.lockOf();
		if (held) throw new BuildError(`another build is running (pid ${held.pid}, since ${held.started})`, 409);
		const job = new BuildJob(
			`build${this.jobs.size + 1}`,
			inGame,
			everything,
			await this.stages(inGame, games, { installBeamng, installRf2, packAc }),
			this.clock,
			games,
		);
		job.installBeamng = installBeamng;
		job.installRf2 = installRf2;
		job.packAc = packAc;
		this.jobs.set(job.id, job);
		void this.run(job);
		return job.page();
	}

	/** An error where a game the build is to install in is not found: AC's tracks folder (inGame), BeamNG's mods folder, rFactor 2's. */
	private async gamesFound(inGame: boolean, installBeamng: boolean, installRf2: boolean): Promise<void> {
		if (inGame && !(await this.acTracks())) throw new BuildError("Assetto Corsa's tracks folder is not found (AC_TRACKS names it)", 400);
		if (installBeamng && !(await this.beamngMods())) throw new BuildError("BeamNG's mods folder is not found (BEAMNG_MODS names it)", 400);
		if (installRf2 && !(await this.rf2Folder())) throw new BuildError("rFactor 2's folder (with its ModDev) is not found (RF2_FOLDER names it)", 400);
	}

	/** The job's end, for the tests. */
	readonly ends = new Map<string, Promise<void>>();

	private run(job: BuildJob): Promise<void> {
		const p = this.runJob(job);
		this.ends.set(job.id, p);
		return p;
	}

	private async runJob(job: BuildJob): Promise<void> {
		try {
			const tid = this.folderName();
			await this.gamesClosed(job);
			// (the track's models made by the engine, then the games' tracks of them, the lock taken round all of it)
			await this.locked(async () => {
				job.next(this.clock());
				await this.opts.makeTrack(this.sayer(job));
				job.endStage("track");
				await this.games(job, tid);
			});
			job.state = "done";
			for (const a of job.archives) job.say(`built for ${GAMES[a.game]}: ${a.path} (${(a.size / 1e6).toFixed(1)} MB)`);
			for (const [game, path] of job.installed) job.say(`installed in ${GAMES[game]}: ${path}`);
			await this.keepTimes(job);
		} catch (err) {
			job.state = job.stop ? "stopped" : "failed";
			job.error = job.stop ? "stopped" : failure(err);
			const st = job.running();
			if (st) job.endStage(st.name, job.state);
			job.say(`${job.state}: ${job.error}`);
		} finally {
			job.ended = this.clock();
		}
	}

	/** An error where a game the build installs in is running: it is closed before the build begins. */
	private async gamesClosed(job: BuildJob): Promise<void> {
		if (job.install && (await this.sys.running("acs.exe"))) throw new Error("Assetto Corsa is running: close it before installing.");
		if (job.installBeamng && (await this.sys.running("BeamNG.drive.x64.exe"))) throw new Error("BeamNG.drive is running: close it before installing.");
		if (job.installRf2 && ((await this.sys.running("rFactor2.exe")) || (await this.sys.running("rFactor2 Mod Mode.exe"))))
			throw new Error("rFactor 2 is running: close it before copying the location into its ModDev.");
	}

	private stopped(job: BuildJob): void {
		if (job.stop) throw new Error("stopped");
	}

	/** A stage's log: each line said, then the stage stopped there if the build was asked to stop (a stage says what it does as it goes: it ends at its next
	 * line, not its last). */
	private sayer(job: BuildJob): (line: string) => void {
		return (line) => {
			job.say(line);
			this.stopped(job);
		};
	}

	/** After the track made: the AC track made of it, installed, the BeamNG level, packed. */
	private async games(job: BuildJob, tid: string): Promise<void> {
		this.stopped(job);
		job.beginStage("ac");
		await buildAc(this.files, {
			project: this.project,
			folder: tid,
			everything: job.everything,
			editorModels: this.opts.editorModels,
			aiFromLines: true,
			log: this.sayer(job),
		});
		const out = `${this.project}/build/ac/content/tracks/${tid}`;
		if (this.opts.makeAcPictures) {
			this.stopped(job);
			await this.opts.makeAcPictures({ out, log: this.sayer(job) });
		}
		if (job.install) {
			this.stopped(job);
			const dest = `${trimSlashes((await this.acTracks()) ?? "")}/${tid}`;
			job.say(`AC: ${await this.sync(out, dest)} files updated in ${dest}`);
			job.installed.push(["ac", dest]);
		}
		job.endStage("ac");
		const makeBeamng = this.opts.makeBeamng;
		if (job.games.includes("beamng") && makeBeamng) {
			this.stopped(job);
			job.beginStage("beamng");
			// (the engine's level, from the AC track just made: its layouts' AI lines)
			await makeBeamng({
				layout: BEAMNG_LAYOUT,
				ai: `${this.project}/build/ac/content/tracks/${tid}`,
				log: this.sayer(job),
			});
			job.endStage("beamng");
			await this.beamngMade(job, tid);
		}
		if (job.games.includes("rf2")) {
			this.stopped(job);
			job.beginStage("rf2");
			const rf2 = job.installRf2 ? await this.rf2Folder() : null;
			const made = await buildRf2(this.files, {
				project: this.project,
				out: `${this.project}/build/rf2`,
				install: rf2 ?? undefined,
				editorModels: this.opts.editorModels,
				pictures: this.opts.rf2Pictures,
				acTrack: `${this.project}/build/ac/content/tracks/${tid}`,
				log: this.sayer(job),
			});
			for (const [l, why] of Object.entries(made.skipped)) job.say(`rFactor 2: ${l} left out: ${why}`);
			job.say(`rFactor 2: ${made.location} (${made.layouts.length} layouts, ${made.gmts} GMTs)`);
			if (made.installed) job.installed.push(["rf2", made.installed]);
			job.endStage("rf2");
		}
		if (job.games.includes("ac") && job.packAc) await this.packAc(job);
	}

	/** The BeamNG level's zip made: its archive; put in BeamNG's mods folder too, where asked (a mod BeamNG reads as it is, its zip). */
	private async beamngMade(job: BuildJob, tid: string): Promise<void> {
		const zipped = this.beamngArchive(tid);
		const s = await this.sys.stat(zipped);
		if (!s || s.mtime / 1000 < job.started - 1) throw new Error(`the build made no ${zipped}`);
		job.archives.push({ game: "beamng", path: zipped, size: s.size });
		if (job.installBeamng) {
			const mods = (await this.beamngMods()) as string;
			const dest = `${trimSlashes(mods)}/${zipped.split("/").pop()}`;
			await this.sys.copy(zipped, dest);
			job.say(`BeamNG: ${dest}`);
			job.installed.push(["beamng", dest]);
		}
	}

	private async packAc(job: BuildJob): Promise<void> {
		this.stopped(job);
		job.step = "pack";
		job.beginStage("pack");
		await this.packing(job);
		job.endStage("pack");
		job.archives.unshift({ game: "ac", path: job.archive, size: job.size });
	}

	/** How long the track, the AC track, the BeamNG level and the packing took, for the next build's estimate. */
	private async keepTimes(job: BuildJob): Promise<void> {
		const times = await this.times();
		for (const name of ["track", "ac", "pack", "beamng", "rf2"]) {
			const st = job.stage(name);
			if (st?.seconds) times[name] = round1(st.seconds);
		}
		try {
			await this.files.write(`${this.cache}/${TIMES}`, new TextEncoder().encode(JSON.stringify(times)));
		} catch {
			// (not kept: an estimate, not a need)
		}
	}

	/** fn with the build's lock taken (no other build begins on build/ac meanwhile). */
	private async locked<T>(fn: () => Promise<T>): Promise<T> {
		const body = JSON.stringify({ pid: this.sys.pid, started: stamp(), args: ["the editor: building"] });
		if (!(await this.sys.createNew(this.lockfile, body))) {
			const held = await this.lockOf();
			if (held) throw new Error(`another build began before the editor's (pid ${held.pid})`);
			// (a lock left by a process gone: taken over)
			await this.files.remove?.(this.lockfile);
			if (!(await this.sys.createNew(this.lockfile, body))) throw new Error(`could not take ${this.lockfile}`);
		}
		try {
			return await fn();
		} finally {
			await this.files.remove?.(this.lockfile);
		}
	}

	/** dst made like src: changed files copied (by their size and time), files src lacks taken out, folders left empty too. */
	async sync(src: string, dst: string): Promise<number> {
		let n = 0;
		const walk = async (rel: string): Promise<void> => {
			const here = rel ? `${src}/${rel}` : src;
			for (const name of (await this.files.list(here)).sort(byCodePoint)) {
				const r = rel ? `${rel}/${name}` : name;
				const a = await this.sys.stat(`${src}/${r}`);
				if (!a) continue;
				if (a.dir) {
					await walk(r);
					continue;
				}
				const b = await this.sys.stat(`${dst}/${r}`);
				if (b?.size !== a.size || Math.trunc(b.mtime / 1000) !== Math.trunc(a.mtime / 1000)) {
					await this.sys.copy(`${src}/${r}`, `${dst}/${r}`);
					n++;
				}
			}
		};
		await walk("");
		const prune = async (rel: string): Promise<void> => {
			const here = rel ? `${dst}/${rel}` : dst;
			for (const name of (await this.files.list(here)).sort(byCodePoint)) {
				const r = rel ? `${rel}/${name}` : name;
				const b = await this.sys.stat(`${dst}/${r}`);
				if (!b) continue;
				if (b.dir) {
					await prune(r);
					continue;
				}
				if (!(await this.sys.stat(`${src}/${r}`))) {
					await this.files.remove?.(`${dst}/${r}`);
					n++;
				}
			}
			if (rel && !(await this.files.list(here)).length && !(await this.sys.stat(`${src}/${rel}`))) await this.sys.rmdir(here);
		};
		if (await this.sys.stat(dst)) await prune("");
		return n;
	}

	/** 7-Zip run, its percentage followed (-bsp1: its progress on stdout, written over with backspaces), as base to base + span of the packing's. */
	private async sevenZipRun(job: BuildJob, args: string[], what: string, base: number, span: number): Promise<void> {
		job.percent = base;
		let said = "";
		const proc = this.sys.spawn(args[0] as string, args.slice(1), { cwd: `${this.project}/build/ac` }, (t) => {
			said = (said + t).slice(-2000);
			const got = [...t.matchAll(PERCENT)];
			if (got.length) {
				job.percent = base + Math.floor((span * Math.min(100, Number(got.at(-1)?.[1]))) / 100);
				job.heard = this.clock();
			}
		});
		job.proc = proc;
		if (job.stop) proc.kill();
		const code = await proc.done;
		job.proc = null;
		if (code) throw new Error(job.stop ? "stopped" : `7-Zip failed ${what} (exit ${code}): ${said.slice(-300)}`);
		job.percent = base + span;
	}

	private async packing(job: BuildJob): Promise<void> {
		const tid = this.folderName();
		const built = `${this.project}/build/ac/content/tracks/${tid}`;
		if (!(await this.sys.stat(built))?.dir) throw new Error(`the build made no ${built}`);
		const out = await this.archive(tid);
		const tmp = `${out}.new`;
		await this.files.remove?.(tmp);
		const z = await this.sevenZip();
		job.say(`packing ${out.split("/").pop()} (${z ? "7-Zip" : "zip"})`);
		if (z) {
			// (as release.ps1: the content folder in a 7z, tested, then put in place of the old) (packing: 0 to 90 of its percentage; testing: the rest)
			await this.sys.mkdir(`${this.project}/build/dist`);
			await this.sevenZipRun(job, [z, "a", "-t7z", "-mx=9", "-bsp1", "-bso0", tmp, "content"], "packing", 0, 90);
			job.say("testing the archive");
			await this.sevenZipRun(job, [z, "t", "-bsp1", "-bso0", tmp], "testing the archive", 90, 10);
			await this.sys.move(tmp, out);
		} else {
			const base = `${this.project}/build/ac`;
			const names: string[] = [];
			const walk = async (rel: string): Promise<void> => {
				for (const name of (await this.files.list(`${base}/${rel}`)).sort(byCodePoint)) {
					const r = `${rel}/${name}`;
					if ((await this.sys.stat(`${base}/${r}`))?.dir) await walk(r);
					else names.push(r);
				}
			};
			await walk(`content/tracks/${tid}`);
			names.sort(byCodePoint);
			const got: { name: string; data: Uint8Array }[] = [];
			for (const name of names) {
				got.push({ name, data: await this.files.read(`${base}/${name}`) });
				job.percent = Math.round((100 * got.length) / names.length);
				job.heard = this.clock();
			}
			await this.files.write(out, await writeZip(got));
		}
		job.archive = out;
		job.size = (await this.sys.stat(out))?.size ?? 0;
	}

	async job(id: string) {
		const j = this.jobs.get(id);
		if (!j) throw new BuildError(`no build '${id}'`, 404);
		return j.page();
	}

	async cancel(id: string) {
		const j = this.jobs.get(id);
		if (!j) throw new BuildError(`no build '${id}'`, 404);
		j.stop = true;
		j.proc?.kill();
		return j.page();
	}
}

const builders = new Map<string, Builder>();

/** The builds of a track, kept while the engine runs (a build goes on through a reload of the page). */
export function builderOf(files: HostFiles, sys: SystemHost, settings: TrackSettings, opts: BuilderOptions): Builder {
	const key = trimSlashes(settings.project.replaceAll("\\", "/")).toLowerCase();
	let b = builders.get(key);
	if (b?.files !== files || b.sys !== sys) {
		b = new Builder(files, sys, settings, opts);
		builders.set(key, b);
	}
	return b;
}
