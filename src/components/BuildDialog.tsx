import { useEffect, useRef, useState } from 'react';
import { engineChannel } from '../api/engineport';
import type { BuildJob, BuildStage, GameId } from '../api/types';
import type { EngineInfo } from '../engine/host';
import { useEditor, useEditorState } from '../store/EditorContext';

const minutes = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
/** seconds a build may say nothing before the dialog says why */
const QUIET = 45;

const STAGE_STATES: Record<BuildStage['state'], string> = {
  waiting: 'to do',
  running: 'running',
  cached: 'as before',
  done: 'done',
  skipped: 'left out',
  failed: 'failed',
  stopped: 'stopped',
};

/** What a line of a build's log is, for its colour: an error, a warning, the build's end, or nothing to mark. */
export function logKind(line: string): 'error' | 'warn' | 'done' | null {
  if (/^(failed|stopped):|\b(error|exception|traceback)\b|\bfailed\b/i.test(line)) return 'error';
  if (/\bwarn(ing|s)?\b/i.test(line)) return 'warn';
  if (/^(built for |installed in )/.test(line)) return 'done';
  return null;
}

/** What a stage took, takes, or should take. */
function stageTime(s: BuildStage): string {
  if (s.state === 'running') return `${minutes(s.seconds)} of about ${minutes(s.expected)}`;
  if (s.state === 'done' || s.state === 'failed' || s.state === 'stopped') return minutes(s.seconds);
  if (s.state === 'waiting') return `about ${minutes(s.expected)}`;
  return '';
}

/** How far a build is: one bar for all of it (each stage weighed by what it took the last time) with the time it may
 * still take; what it is doing now, its last line and how long ago, still at work or not (a quiet build is a busy
 * one, or a stuck one: said which); 7-Zip's own percentage packing; every stage, as it went. */
export function BuildProgress({ job }: Readonly<{ job: BuildJob }>) {
  const stages = job.stages ?? [];
  const pct = Math.round((job.fraction ?? 0) * 100);
  const a = job.activity;
  return (
    <div className="build-progress">
      <progress max={100} value={pct} aria-label="How far the build is" />
      <p className="build-line">
        <strong>{pct}%</strong>
        {a?.stage ? ` · ${a.stage}` : ''}
        {job.step === 'pack' && job.percent != null ? ` ${job.percent}%` : ''} · {minutes(job.seconds)} so far
        {job.left ? ` · about ${minutes(job.left)} left` : ''}
      </p>
      {a ? (
        <p className={!a.alive ? 'build-error' : a.quiet > QUIET ? 'build-warn' : 'build-running'}>
          {!a.alive
            ? 'Its process is not running any more.'
            : a.quiet > QUIET
              ? `Nothing said for ${minutes(a.quiet)}: its process is alive, working on a long part.`
              : `Last said ${minutes(a.quiet)} ago:`}{' '}
          {a.line ? <code>{a.line}</code> : null}
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

const GAME_NAMES: Record<GameId, string> = { ac: 'Assetto Corsa', beamng: 'BeamNG', rf2: "rFactor 2's ModDev" };

/** A build done: how long it took, the archives made, where it installed each game's track. */
export function builtLine(job: BuildJob): string {
  const archives = (job.archives ?? (job.archive ? [{ path: job.archive, size: job.size }] : [])).map(
    (a) => `${a.path} (${(a.size / 1e6).toFixed(1)} MB)`,
  );
  const installed = (job.installed ?? []).map((i) => `installed in ${GAME_NAMES[i.game]}: ${i.path}`);
  if (!job.installed && job.install) installed.push('installed in Assetto Corsa');
  return `Built in ${minutes(job.seconds)}: ${[...archives, ...installed].join('; ') || 'nothing packed'}`;
}

/** The track built for the games by the editor's engine; packed as its release is; installed in the game if asked.
 * It goes on with the dialog closed. */
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
  const [games, setGames] = useState<GameId[]>(['ac']);
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
  const running = job?.state === 'running';
  const asked = (info?.games ?? []).length
    ? games.filter((id) => (info?.games ?? []).some((g) => g.id === id && g.available))
    : games;
  const acInstall = install && asked.includes('ac') && !!info?.game;
  const beamngInstall = installBeamng && asked.includes('beamng') && !!info?.beamngMods;
  const rf2Install = installRf2 && asked.includes('rf2') && !!info?.rf2Folder;
  return (
    <dialog id="buildbox" open aria-labelledby="build-title">
      <h2 id="build-title">Build for the Games</h2>
      {!info && !b.error ? <p className="hint">Asking the engine…</p> : null}
      {info && !info.available ? <p className="wizard-failed">This track cannot be built here: {info.why}.</p> : null}
      {info?.available ? (
        <>
          <p>
            The editor's engine makes the track's models again from what is saved, then the AC track{' '}
            <code>{info.track}</code>; each game ticked is packed from it. Only what changed is made again.
          </p>
          {machine ? (
            <p className="hint">
              This computer: {machine.processors} processors, {(machine.memory.free / 2 ** 30).toFixed(1)} GB of{' '}
              {(machine.memory.total / 2 ** 30).toFixed(1)} GB memory free.
            </p>
          ) : null}
          <fieldset className="build-games">
            <legend>For</legend>
            {(
              info.games ?? [{ id: 'ac' as const, label: 'Assetto Corsa', archive: info.archive, available: true }]
            ).map((g) => (
              <div key={g.id} className="build-game">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={games.includes(g.id) && g.available}
                    disabled={running || !g.available}
                    onChange={(e) => pick(g.id, e.target.checked)}
                  />
                  {g.label}
                  {g.everyLayout
                    ? g.id === 'rf2'
                      ? ' (one location, each layout its own)'
                      : ' (one map, each layout its activities)'
                    : ''}
                </label>
                <code className="game-archive">{g.available ? g.archive : "the editor's engine makes none here"}</code>
                {g.id === 'ac' ? (
                  <>
                    <label className="check sub">
                      <input
                        type="checkbox"
                        checked={install && asked.includes('ac') && !!info.game}
                        disabled={running || !asked.includes('ac') || !info.game}
                        onChange={(e) => setInstall(e.target.checked)}
                      />
                      {info.game
                        ? `Install in the game too (${info.game}; Assetto Corsa closed)`
                        : "Install in the game too (Assetto Corsa's tracks folder not found: AC_TRACKS names it)"}
                    </label>
                    <label className="check sub">
                      <input
                        type="checkbox"
                        checked={packAc || !acInstall}
                        disabled={running || !acInstall}
                        onChange={(e) => setPackAc(e.target.checked)}
                      />
                      Make its archive too (slow: only needed to hand the track on)
                    </label>
                  </>
                ) : null}
                {g.id === 'beamng' ? (
                  <label className="check sub">
                    <input
                      type="checkbox"
                      checked={beamngInstall}
                      disabled={running || !asked.includes('beamng') || !info.beamngMods}
                      onChange={(e) => setInstallBeamng(e.target.checked)}
                    />
                    {info.beamngMods
                      ? `Install in BeamNG's mods too (${info.beamngMods}; BeamNG.drive closed)`
                      : "Install in BeamNG's mods too (its mods folder not found: BEAMNG_MODS names it)"}
                  </label>
                ) : null}
                {g.id === 'rf2' ? (
                  <label className="check sub">
                    <input
                      type="checkbox"
                      checked={rf2Install}
                      disabled={running || !asked.includes('rf2') || !info.rf2Folder}
                      onChange={(e) => setInstallRf2(e.target.checked)}
                    />
                    {info.rf2Folder
                      ? `Copy into rFactor 2's ModDev too, to try in its Mod Mode (${info.rf2Folder}; rFactor 2 closed)`
                      : "Copy into rFactor 2's ModDev too (its folder not found: RF2_FOLDER names it)"}
                  </label>
                ) : null}
              </div>
            ))}
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={all} disabled={running} onChange={(e) => setAll(e.target.checked)} />
            Make every step again (slow)
          </label>
          {info.locked && !running ? (
            <p className="wizard-failed">Another build is running (its lock is in the track's build folder).</p>
          ) : null}
          {dirty && !running ? <p className="hint">There are changes not saved: building saves them first.</p> : null}
        </>
      ) : null}
      {b.error ? (
        <p className="wizard-failed" role="alert">
          {b.error}
        </p>
      ) : null}
      {job ? (
        <div className="progress" aria-live="polite">
          {job.state === 'running' ? <BuildProgress job={job} /> : null}
          <p className={`build-state build-${job.state}`}>
            {job.state === 'done' ? builtLine(job) : null}
            {job.state === 'failed' ? `It failed: ${job.error}` : null}
            {job.state === 'stopped' ? 'Stopped.' : null}
          </p>
          <pre ref={log} className="log">
            {job.log.map((line, i) => {
              const kind = logKind(line);
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: a log's lines only grow at its end
                <span key={i} className={kind ? `log-${kind}` : undefined}>
                  {i < job.log.length - 1 ? `${line}\n` : line}
                </span>
              );
            })}
          </pre>
        </div>
      ) : null}
      <div className="sheet-actions">
        {running ? (
          <button type="button" disabled={!!job?.stopping} onClick={() => void ed.cancelBuild()}>
            {job?.stopping ? 'Stopping…' : 'Stop the Build'}
          </button>
        ) : null}
        <button type="button" onClick={ed.closeBuild}>
          {running ? 'Close (it goes on)' : 'Close'}
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
