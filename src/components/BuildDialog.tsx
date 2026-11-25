import { type RefObject, useEffect, useRef, useState } from "react";
import { engineChannel } from "../api/engineport";
import type { BuildActivity, BuildGame, BuildInfo, BuildJob, BuildStage, GameId } from "../api/types";
import type { EngineInfo } from "../engine/host";
import { useEditor, useEditorState } from "../store/EditorContext";

const minutes = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
/** seconds a build may say nothing before the dialog says why */
const QUIET = 45;

const STAGE_STATES: Record<BuildStage["state"], string> = {
	waiting: "to do",
	running: "running",
	cached: "as before",
	done: "done",
	skipped: "left out",
	failed: "failed",
	stopped: "stopped",
};

/** What a line of a build's log is, for its colour: an error, a warning, the build's end, or nothing to mark. */
export function logKind(line: string): "error" | "warn" | "done" | null {
	if (/(^stopped:)|\b(failed|error|exception|traceback)\b/i.test(line)) return "error";
	if (/\bwarn(ing|s)?\b/i.test(line)) return "warn";
	if (/^(built for |installed in )/.test(line)) return "done";
	return null;
}

/** What a stage took, takes, or should take. */
function stageTime(s: BuildStage): string {
	if (s.state === "running") return `${minutes(s.seconds)} of about ${minutes(s.expected)}`;
	if (s.state === "done" || s.state === "failed" || s.state === "stopped") return minutes(s.seconds);
	if (s.state === "waiting") return `about ${minutes(s.expected)}`;
	return "";
}

/** How a build's last word reads, its colour and its line: its process gone, quiet long enough to say why, or when it last said something. */
function quietLine(a: BuildActivity): { className: string; text: string } {
	if (!a.alive) return { className: "build-error", text: "Its process is not running any more." };
	if (a.quiet > QUIET) return { className: "build-warn", text: `Nothing said for ${minutes(a.quiet)}: its process is alive, working on a long part.` };
	return { className: "build-running", text: `Last said ${minutes(a.quiet)} ago:` };
}

/** How far a build is: one bar for all of it (each stage weighed by what it took the last time) with the time it may still take; what it is doing now, its last
 * line and how long ago, still at work or not (a quiet build is a busy one, or a stuck one: said which); 7-Zip's own percentage packing; every stage, as it
 * went. */
export function BuildProgress({ job }: Readonly<{ job: BuildJob }>) {
	const stages = job.stages ?? [];
	const pct = Math.round((job.fraction ?? 0) * 100);
	const a = job.activity;
	const said = a ? quietLine(a) : null;
	return (
		<div className="build-progress">
			<progress max={100} value={pct} aria-label="How far the build is" />
			<p className="build-line">
				<strong>{pct}%</strong>
				{a?.stage ? ` · ${a.stage}` : ""}
				{job.step === "pack" && job.percent != null ? ` ${job.percent}%` : ""} · {minutes(job.seconds)} so far
				{job.left ? ` · about ${minutes(job.left)} left` : ""}
			</p>
			{said ? (
				<p className={said.className}>
					{said.text} {a?.line ? <code>{a.line}</code> : null}
				</p>
			) : null}
			{stages.length ? (
				<ol className="build-stages" aria-label="Its stages">
					{stages.map((s) => (
						<li key={s.name} className={`stage-${s.state}`}>
							<span className="stage-label">{s.label}</span>
							<span className="stage-state">{STAGE_STATES[s.state]}</span>
							<span className="stage-time">{stageTime(s)}</span>
						</li>
					))}
				</ol>
			) : null}
		</div>
	);
}

const GAME_NAMES: Record<GameId, string> = { ac: "Assetto Corsa", beamng: "BeamNG", rf2: "rFactor 2's ModDev" };

/** A build done: how long it took, the archives made, where it installed each game's track. */
export function builtLine(job: BuildJob): string {
	const archives = (job.archives ?? (job.archive ? [{ path: job.archive, size: job.size }] : [])).map((a) => `${a.path} (${(a.size / 1e6).toFixed(1)} MB)`);
	const installed = (job.installed ?? []).map((i) => `installed in ${GAME_NAMES[i.game]}: ${i.path}`);
	if (!job.installed && job.install) installed.push("installed in Assetto Corsa");
	return `Built in ${minutes(job.seconds)}: ${[...archives, ...installed].join("; ") || "nothing packed"}`;
}

/** What a game's line adds when one build makes every layout: rFactor 2's one location, the other games' one map. */
function everyLayoutNote(g: BuildGame): string {
	if (!g.everyLayout) return "";
	return g.id === "rf2" ? " (one location, each layout its own)" : " (one map, each layout its activities)";
}

/** A tick under a game's line, with what it does (or why it cannot be ticked). */
function SubCheck({
	checked,
	disabled,
	onChange,
	children,
}: Readonly<{ checked: boolean; disabled: boolean; onChange: (on: boolean) => void; children: string }>) {
	return (
		<label className="check sub">
			<input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
			{children}
		</label>
	);
}

/** What a build is asked to install and pack, each with what changes it. */
type Installs = Readonly<{
	running: boolean;
	asked: GameId[];
	acInstall: boolean;
	setInstall: (on: boolean) => void;
	packAc: boolean;
	setPackAc: (on: boolean) => void;
	beamngInstall: boolean;
	setInstallBeamng: (on: boolean) => void;
	rf2Install: boolean;
	setInstallRf2: (on: boolean) => void;
}>;

/** The ticks under a game's line: installing it in the game, and for Assetto Corsa its archive made too. */
function InstallChoices({ id, info, x }: Readonly<{ id: GameId; info: BuildInfo; x: Installs }>) {
	const { running, asked } = x;
	if (id === "ac")
		return (
			<>
				<SubCheck checked={x.acInstall} disabled={running || !asked.includes("ac") || !info.game} onChange={x.setInstall}>
					{info.game
						? `Install in the game too (${info.game}; Assetto Corsa closed)`
						: "Install in the game too (Assetto Corsa's tracks folder not found: AC_TRACKS names it)"}
				</SubCheck>
				<SubCheck checked={x.packAc || !x.acInstall} disabled={running || !x.acInstall} onChange={x.setPackAc}>
					Make its archive too (slow: only needed to hand the track on)
				</SubCheck>
			</>
		);
	if (id === "beamng")
		return (
			<SubCheck checked={x.beamngInstall} disabled={running || !asked.includes("beamng") || !info.beamngMods} onChange={x.setInstallBeamng}>
				{info.beamngMods
					? `Install in BeamNG's mods too (${info.beamngMods}; BeamNG.drive closed)`
					: "Install in BeamNG's mods too (its mods folder not found: BEAMNG_MODS names it)"}
			</SubCheck>
		);
	if (id === "rf2")
		return (
			<SubCheck checked={x.rf2Install} disabled={running || !asked.includes("rf2") || !info.rf2Folder} onChange={x.setInstallRf2}>
				{info.rf2Folder
					? `Copy into rFactor 2's ModDev too, to try in its Mod Mode (${info.rf2Folder}; rFactor 2 closed)`
					: "Copy into rFactor 2's ModDev too (its folder not found: RF2_FOLDER names it)"}
			</SubCheck>
		);
	return null;
}

/** What a build is to do, once the engine says whether the track can be built here: the games ticked, what each installs, every step made again or not. */
function BuildSetup({
	info,
	error,
	machine,
	dirty,
	games,
	pick,
	all,
	setAll,
	installs,
}: Readonly<{
	info: BuildInfo | null;
	error: string;
	machine: EngineInfo | null;
	dirty: boolean;
	games: GameId[];
	pick: (g: GameId, on: boolean) => void;
	all: boolean;
	setAll: (on: boolean) => void;
	installs: Installs;
}>) {
	if (!info) return error ? null : <p className="hint">Asking the engine…</p>;
	if (!info.available) return <p className="wizard-failed">This track cannot be built here: {info.why}.</p>;
	const { running } = installs;
	return (
		<>
			<p>
				The editor's engine makes the track's models again from what is saved, then the AC track <code>{info.track}</code>; each game ticked is packed from it.
				Only what changed is made again.
			</p>
			{machine ? (
				<p className="hint">
					This computer: {machine.processors} processors, {(machine.memory.free / 2 ** 30).toFixed(1)} GB of {(machine.memory.total / 2 ** 30).toFixed(1)} GB
					memory free.
				</p>
			) : null}
			<fieldset className="build-games">
				<legend>For</legend>
				{(info.games ?? [{ id: "ac" as const, label: "Assetto Corsa", archive: info.archive, available: true }]).map((g) => (
					<div key={g.id} className="build-game">
						<label className="check">
							<input
								type="checkbox"
								checked={games.includes(g.id) && g.available}
								disabled={running || !g.available}
								onChange={(e) => pick(g.id, e.target.checked)}
							/>
							{g.label}
							{everyLayoutNote(g)}
						</label>
						<code className="game-archive">{g.available ? g.archive : "the editor's engine makes none here"}</code>
						<InstallChoices id={g.id} info={info} x={installs} />
					</div>
				))}
			</fieldset>
			<label className="check">
				<input type="checkbox" checked={all} disabled={running} onChange={(e) => setAll(e.target.checked)} />
				{"Make every step again (slow)"}
			</label>
			{info.locked && !running ? <p className="wizard-failed">Another build is running (its lock is in the track's build folder).</p> : null}
			{dirty && !running ? <p className="hint">There are changes not saved: building saves them first.</p> : null}
		</>
	);
}

/** A build going on or done: how far it is, how it ended, its log (each line coloured by what it is). */
function BuildJobView({ job, logRef }: Readonly<{ job: BuildJob; logRef: RefObject<HTMLPreElement | null> }>) {
	return (
		<div className="progress" aria-live="polite">
			{job.state === "running" ? <BuildProgress job={job} /> : null}
			<p className={`build-state build-${job.state}`}>
				{job.state === "done" ? builtLine(job) : null}
				{job.state === "failed" ? `It failed: ${job.error}` : null}
				{job.state === "stopped" ? "Stopped." : null}
			</p>
			<pre ref={logRef} className="log">
				{job.log.map((line, i) => {
					const kind = logKind(line);
					return (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: a log's lines only grow at its end
							key={i} // NOSONAR: a log's lines only grow at its end
							className={kind ? `log-${kind}` : undefined}
						>
							{i < job.log.length - 1 ? `${line}\n` : line}
						</span>
					);
				})}
			</pre>
		</div>
	);
}

/** The games a build is asked for: the ones ticked that the engine can build here (all the ones ticked while it names none). */
function askedGames(info: BuildInfo | null, games: GameId[]): GameId[] {
	const known = info?.games ?? [];
	return known.length ? games.filter((id) => known.some((g) => g.id === id && g.available)) : games;
}

/** The track built for the games by the editor's engine; packed as its release is; installed in the game if asked. It goes on with the dialog closed. */
export function BuildDialog() {
	const ed = useEditor();
	const b = useEditorState((s) => s.building);
	const dirty = useEditorState((s) => s.dirty);
	const [install, setInstall] = useState(false);
	const [installBeamng, setInstallBeamng] = useState(false);
	const [installRf2, setInstallRf2] = useState(false);
	// (AC's track packed too where it is installed: AC reads its folder, the archive is for handing it on)
	const [packAc, setPackAc] = useState(true);
	const [all, setAll] = useState(false);
	const [games, setGames] = useState<GameId[]>(["ac"]);
	const pick = (g: GameId, on: boolean) => setGames((was) => (on ? [...was, g] : was.filter((x) => x !== g)));
	const log = useRef<HTMLPreElement>(null);
	// (the computer as the engine window sees it, in the desktop app)
	const [machine, setMachine] = useState<EngineInfo | null>(null);
	useEffect(() => {
		if (b.open && engineChannel.connected) engineChannel.info().then(setMachine, () => setMachine(null));
	}, [b.open]);
	// (the log kept at its end as it grows)
	useEffect(() => {
		const el = log.current;
		if (el) el.scrollTop = el.scrollHeight;
	});
	if (!b.open) return null;
	const { info, job } = b;
	const running = job?.state === "running";
	const asked = askedGames(info, games);
	const acInstall = install && asked.includes("ac") && !!info?.game;
	const beamngInstall = installBeamng && asked.includes("beamng") && !!info?.beamngMods;
	const rf2Install = installRf2 && asked.includes("rf2") && !!info?.rf2Folder;
	const installs = { running, asked, acInstall, setInstall, packAc, setPackAc, beamngInstall, setInstallBeamng, rf2Install, setInstallRf2 };
	return (
		<dialog id="buildbox" open aria-labelledby="build-title">
			<h2 id="build-title">Build for the Games</h2>
			<BuildSetup info={info} error={b.error} machine={machine} dirty={dirty} games={games} pick={pick} all={all} setAll={setAll} installs={installs} />
			{b.error ? (
				<p className="wizard-failed" role="alert">
					{b.error}
				</p>
			) : null}
			{job ? <BuildJobView job={job} logRef={log} /> : null}
			<div className="sheet-actions">
				{running ? (
					<button type="button" disabled={!!job?.stopping} onClick={() => void ed.cancelBuild()}>
						{job?.stopping ? "Stopping…" : "Stop the Build"}
					</button>
				) : null}
				<button type="button" onClick={ed.closeBuild}>
					{running ? "Close (it goes on)" : "Close"}
				</button>
				{info?.available ? (
					<button
						type="button"
						className="primary"
						disabled={running || info.locked || !asked.length}
						onClick={() =>
							void ed.startBuild({
								games: asked,
								install: acInstall,
								installBeamng: beamngInstall,
								installRf2: rf2Install,
								packAc: packAc || !acInstall,
								all,
							})
						}
					>
						Build
					</button>
				) : null}
			</div>
		</dialog>
	);
}
