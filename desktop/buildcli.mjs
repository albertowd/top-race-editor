// The track built from the command line (desktop/main.mjs --build): a saved track built for the games by the
// editor's engine, as the Build dialog builds it, with no window shown, its log printed as it goes; for a CI tool.
//
//   npm run build-track -- --project <folder> [--games ac,beamng,rf2] [--install] [--install-beamng]
//                          [--install-rf2] [--no-pack] [--all]
//
//   --project <folder>   the track's folder (its tools/reference/track.json): required
//   --games <list>       the games, comma-separated: ac (the default), beamng, rf2
//   --install            the AC track installed in AC's tracks folder too (AC_TRACKS names it where it is not found)
//   --install-beamng     the BeamNG level put in BeamNG's mods too (BEAMNG_MODS)
//   --install-rf2        the rFactor 2 location copied into rFactor 2's ModDev too (RF2_FOLDER)
//   --no-pack            the AC track not packed (only with --install: AC reads its folder)
//   --all                every step made again
//
// Exit codes: 0 built; 1 the build failed or was stopped; 2 the arguments are wrong.

export const GAMES = ['ac', 'beamng', 'rf2'];

export const USAGE = `usage: npm run build-track -- --project <folder> [--games ac,beamng,rf2] [--install]
                       [--install-beamng] [--install-rf2] [--no-pack] [--all]`;

export class UsageError extends Error {}

/** The build asked for by the arguments (those after main.mjs): its track's folder and the body of /api/build. */
export function buildArgs(args) {
  const out = {
    project: null,
    body: { games: ['ac'], install: false, installBeamng: false, installRf2: false, packAc: true, all: false },
  };
  const value = (i, name) => {
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const [flag, inline] =
      a.startsWith('--') && a.includes('=')
        ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
        : [a, undefined];
    switch (flag) {
      case '--build':
        break;
      case '--project':
        out.project = inline ?? value(i++, flag);
        break;
      case '--games': {
        const games = (inline ?? value(i++, flag))
          .split(',')
          .map((g) => g.trim().toLowerCase())
          .filter(Boolean);
        const unknown = games.filter((g) => !GAMES.includes(g));
        if (unknown.length)
          throw new UsageError(`no such game: ${unknown.join(', ')} (the games: ${GAMES.join(', ')})`);
        if (!games.length) throw new UsageError('--games names none');
        out.body.games = [...new Set(games)];
        break;
      }
      case '--install':
        out.body.install = true;
        break;
      case '--install-beamng':
        out.body.installBeamng = true;
        break;
      case '--install-rf2':
        out.body.installRf2 = true;
        break;
      case '--no-pack':
        out.body.packAc = false;
        break;
      case '--all':
        out.body.all = true;
        break;
      default:
        // (Chromium's and Electron's own switches passed through: --no-sandbox, say)
        if (!flag.startsWith('--')) throw new UsageError(`what is ${a}?`);
        if (!/^--(no-sandbox|disable-gpu|headless|enable-logging|v=)/.test(flag))
          throw new UsageError(`no such option ${flag}`);
    }
  }
  if (!out.project) throw new UsageError('--project names the track to build');
  if (out.body.installBeamng && !out.body.games.includes('beamng'))
    throw new UsageError('--install-beamng needs --games with beamng');
  if (out.body.installRf2 && !out.body.games.includes('rf2'))
    throw new UsageError('--install-rf2 needs --games with rf2');
  if (out.body.install && !out.body.games.includes('ac')) throw new UsageError('--install needs --games with ac');
  return out;
}

/** Calls on a port to the engine window (a MessagePortMain, or any port with on('message') and postMessage). */
export function engineCaller(port) {
  let next = 1;
  const pending = new Map();
  port.on('message', (e) => {
    const a = e.data;
    const p = pending.get(a?.id);
    if (!p) return;
    pending.delete(a.id);
    if (a.ok) p.resolve(a.result);
    else p.reject(new Error(a.error));
  });
  port.start?.();
  return (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      port.postMessage({ id, method, params });
    });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** The build run on the engine (call: engineCaller's), its log's new lines said as they come (say), followed every
 * `every` ms until it ends; stop(): whether to ask it to stop (Ctrl+C). Its exit code: 0 built, 1 not. */
export async function runBuild(call, folder, body, say, { every = 1000, stop = () => false } = {}) {
  const api = (path, b) => call('api', { folder, path, body: b });
  let job;
  try {
    job = await api('/api/build', body);
  } catch (e) {
    say(`the build did not start: ${e.message}`);
    return 1;
  }
  let shown = 0;
  let asked = false;
  for (;;) {
    for (const line of job.log.slice(shown)) say(line);
    shown = job.log.length;
    if (job.state !== 'running') break;
    if (!asked && stop()) {
      asked = true;
      say('stopping the build…');
      await api('/api/build/cancel', { id: job.id }).catch(() => {});
    }
    await pause(every);
    job = await api(`/api/build/job?id=${encodeURIComponent(job.id)}`);
  }
  if (job.state === 'done') {
    say(`built in ${Math.round(job.seconds)} s`);
    return 0;
  }
  say(job.state === 'stopped' ? 'the build was stopped' : `the build failed: ${job.error}`);
  return 1;
}
