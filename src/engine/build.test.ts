// @vitest-environment node
// The track built from the editor (build.ts): the track made by the engine, the AC track made of it, installed,
// the BeamNG level, packed, one at a time.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Builder, type BuilderOptions, type SystemHost } from './build';
import type { HostFiles } from './placehost';
import { settingsOf } from './trackfiles';

const { system } = createRequire(import.meta.url)('../../desktop/system.cjs') as { system: () => SystemHost };

const files: HostFiles = {
  read: async (p) => new Uint8Array(readFileSync(p)),
  list: async (d) => readdirSync(d),
  size: async (p) => statSync(p).size,
  exists: async (p) => existsSync(p),
  write: async (p, b) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, b);
  },
  remove: async (p) => rmSync(p, { force: true }),
};

let tmp = '';
let project = '';

function write(rel: string, text: string) {
  const p = join(project, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

/** A track as a build needs it: its track file, its material library, AC's own files, its models' folder, a layout
 * whole. */
function makeProject() {
  write('tools/reference/track.json', JSON.stringify({ name: 'Fake Track', models: 'track/models' }));
  write('source/materials.json', JSON.stringify({ version: 1, materials: {}, textures: {} }));
  write('source/track/extension/ext_config.ini', '[BASIC]\nIGNORE_OTHER_CONFIGS = 0\n');
  write('source/track/ui/ui_track.json', '{}');
  mkdirSync(join(project, 'track', 'models'), { recursive: true });
  // (a layout whole, as a build needs it: its racing lines, grid, pits, timing and hotlap start)
  write('tools/reference/objects.json', JSON.stringify({ version: 3, layouts: { a: WHOLE }, objects: [], marks: [] }));
}

const spot = (x: number) => ({ x, z: 0, heading: 0 });
const node = (x: number, z: number) => ({ p: [x, z], in: [0, 0], out: [0, 0] });
/** a layout with everything a build needs */
const WHOLE = {
  grid: [spot(0)],
  pits: [spot(5)],
  hotlap: spot(1),
  timing: [{ left: { x: 0, z: -4 }, right: { x: 0, z: 4 } }],
  lines: {
    fast: { curve: [node(0, 0), node(50, 50), node(0, 100)], closed: true },
    pit: { curve: [node(0, 0), node(10, 10)], closed: false, leaves: 0, joins: 10 },
  },
};

/** The system, the game's folder where the test says (AC_TRACKS), Assetto Corsa never running, 7-Zip as asked. */
function sys(game: string, sevenZip = true): SystemHost {
  const s = system();
  return {
    ...s,
    env: (n) => (n === 'AC_TRACKS' ? game : s.env(n)),
    running: async () => false,
    which: (n) => (n === '7z' && !sevenZip ? null : s.which(n)),
    stat: (p) => (p.includes('7-Zip') && !sevenZip ? Promise.resolve(null) : s.stat(p)),
  };
}

/** A builder of the track (the engine's track made as given: by default at once). */
async function builder(
  opts: Partial<BuilderOptions> = {},
  host: SystemHost = sys(join(tmp, 'game'), false),
): Promise<Builder> {
  return new Builder(files, host, await settingsOf(files, project.replace(/\\/g, '/')), {
    makeTrack: async () => {},
    ...opts,
  });
}

async function wait(b: Builder, id: string) {
  await b.ends.get(id);
  return b.job(id);
}

/** A zip's files' names (its central directory's). */
function zipNames(b: Uint8Array): string[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = b.length - 22;
  while (v.getUint32(end, true) !== 0x06054b50) end--;
  const n = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = v.getUint16(at + 28, true);
    const extra = v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    out.push(new TextDecoder().decode(b.subarray(at + 46, at + 46 + len)));
    at += 46 + len + extra;
  }
  return out;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'build-test-'));
  project = join(tmp, 'fake');
  makeProject();
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('the track built from the editor', () => {
  it('makes the track by the engine, its lock held, then builds and packs it', async () => {
    let lockHeld = false;
    let aliveSeen: boolean | undefined;
    const b: Builder = await builder(
      {
        makeTrack: async (log) => {
          lockHeld = existsSync(join(project, 'build', 'build.lock'));
          // (the engine making the track: the build alive, though no process of its own runs)
          const id = [...b.jobs.keys()].at(-1) as string;
          aliveSeen = (await b.job(id)).activity?.alive;
          log('the track made');
        },
      },
      sys(join(tmp, 'game')),
    );
    const info = await b.info();
    expect([info.available, info.track, info.last]).toEqual([true, 'fake_track', null]);
    const page = await wait(b, (await b.start()).id);
    expect(page.state, page.log.join('\n')).toBe('done');
    expect(page.stages.map((s) => [s.name, s.state])).toEqual([
      ['track', 'done'],
      ['ac', 'done'],
      ['pack', 'done'],
    ]);
    expect([page.fraction, page.left, page.activity, page.percent]).toEqual([1, 0, null, 100]);
    expect(lockHeld).toBe(true);
    expect(aliveSeen).toBe(true);
    expect(page.log).toContain('the track made');
    expect(
      existsSync(join(project, 'build', 'ac', 'content', 'tracks', 'fake_track', 'extension', 'ext_config.ini')),
    ).toBe(true);
    expect(existsSync(page.archive) && statSync(page.archive).size).toBe(page.size);
    expect(dirname(page.archive)).toBe(`${project.replace(/\\/g, '/')}/build/dist`);
    expect(existsSync(join(project, 'build', 'build.lock'))).toBe(false);
    expect((await b.info()).last?.id).toBe(page.id);
  }, 60_000);

  it('installs the AC track in the game, what it has no more taken out, and packs it (no 7-Zip: a zip)', async () => {
    const game = join(tmp, 'game');
    // (what the game has of the track and the build has no more: taken out)
    mkdirSync(join(game, 'fake_track', 'old'), { recursive: true });
    writeFileSync(join(game, 'fake_track', 'old', 'gone.kn5'), 'x');
    const b = await builder({}, sys(game, false));
    expect((await b.info()).packer).toBe('zip');
    const page = await wait(b, (await b.start(true)).id);
    expect(page.state, page.log.join('\n')).toBe('done');
    expect(page.log.some((l) => /^AC: 0 of 0 models made/.test(l))).toBe(true);
    expect(page.log, page.log.join('\n')).toContain(`AC: 3 files updated in ${game}/fake_track`);
    const built = join(project, 'build', 'ac', 'content', 'tracks', 'fake_track');
    expect(readFileSync(join(game, 'fake_track', 'extension', 'ext_config.ini'))).toEqual(
      readFileSync(join(built, 'extension', 'ext_config.ini')),
    );
    expect(existsSync(join(game, 'fake_track', 'old'))).toBe(false);
    // (the archive: the content folder, as release.ps1 packs it)
    expect(page.archive.endsWith('/build/dist/fake_track_ac.zip')).toBe(true);
    expect(zipNames(readFileSync(page.archive))).toEqual([
      'content/tracks/fake_track/extension/ext_config.ini',
      'content/tracks/fake_track/ui/ui_track.json',
    ]);
    expect(existsSync(join(project, 'build', 'build.lock'))).toBe(false);
    // (installed again with nothing changed: nothing copied)
    const again = await wait(b, (await b.start(true)).id);
    expect(again.log).toContain(`AC: 0 files updated in ${game}/fake_track`);
  }, 60_000);

  it('builds one at a time, respects a lock, and is stopped', async () => {
    let release = () => {};
    // (the build's clock, moved on by the test)
    let now = 1_000;
    const b = await builder(
      {
        makeTrack: (log) => {
          log('making the track');
          return new Promise<void>((r) => {
            release = r;
          });
        },
      },
      { ...sys(join(tmp, 'game'), false), now: () => now },
    );
    const lock = join(project, 'build', 'build.lock');
    mkdirSync(dirname(lock), { recursive: true });
    // (another build's lock: a living process's holds; a gone one's does not)
    writeFileSync(lock, JSON.stringify({ pid: process.pid, started: '2026-11-16 01:02:03', args: [] }));
    expect((await b.info()).locked).toBe(true);
    await expect(b.start()).rejects.toThrow(`another build is running (pid ${process.pid}, since 2026-11-16 01:02:03)`);
    writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, started: 'x', args: [] }));
    expect((await b.info()).locked).toBe(false);
    rmSync(lock);
    const job = await b.start();
    await expect(b.start()).rejects.toThrow('running already');
    let page = await b.job(job.id);
    for (let i = 0; i < 200 && !page.log.includes('making the track'); i++) {
      await new Promise((r) => setTimeout(r, 10));
      page = await b.job(job.id);
    }
    now += 30;
    page = await b.job(job.id);
    // (at work: its stage, its last line, still running; how far, and how long it may still take)
    expect([page.activity?.alive, page.activity?.stage, page.activity?.line]).toEqual([
      true,
      'the track made by the engine',
      'making the track',
    ]);
    expect(page.fraction > 0 && page.fraction < 1 && page.left > 0).toBe(true);
    await b.cancel(job.id);
    release();
    page = await wait(b, job.id);
    expect(page.state).toBe('stopped');
    expect(existsSync(lock)).toBe(false);
    await expect(b.job('nope')).rejects.toThrow('no build');
  }, 60_000);

  it('stops a stage at its next line, not its end, and says it is stopping meanwhile', async () => {
    let said = 0;
    let go: (() => void) | null = null;
    const b = await builder({
      // (a long stage: a line every step, a thousand of them; held before its fourth)
      makeTrack: async (log) => {
        for (let i = 0; i < 1000; i++) {
          if (i === 3)
            await new Promise<void>((r) => {
              go = r;
            });
          log(`step ${i}`);
          said = i;
          await new Promise((r) => setTimeout(r, 1));
        }
      },
    });
    const job = await b.start();
    for (let i = 0; i < 400 && !go; i++) await new Promise((r) => setTimeout(r, 5));
    const asked = await b.cancel(job.id);
    expect(asked.stopping).toBe(true);
    (go as (() => void) | null)?.();
    const page = await wait(b, job.id);
    expect(page.state).toBe('stopped');
    expect(page.stopping).toBe(false);
    // (its next line its last: the stage went no further)
    expect(said).toBe(2);
    expect(page.log).toContain('step 3');
    expect(page.log).not.toContain('step 4');
  }, 60_000);

  it('builds for the games chosen; no BeamNG level where the engine makes none', async () => {
    const plain = await builder();
    const none = await plain.info();
    expect(none.games.map((g) => [g.id, g.available])).toEqual([
      ['ac', true],
      ['beamng', false],
      ['rf2', true],
    ]);
    await expect(plain.start(false, false, [])).rejects.toThrow('no game to build for');
    await expect(plain.start(false, false, ['beamng'])).rejects.toThrow('the engine makes no BeamNG level here');
    const b = await builder({ makeBeamng: async () => write('build/dist/fake_track_beamng.zip', 'a level') });
    // (BeamNG.drive alone: its level, from the AC track made; nothing packed for Assetto Corsa, nothing installed)
    let page = await wait(b, (await b.start(true, false, ['beamng'])).id);
    expect(page.state, page.log.join('\n')).toBe('done');
    expect([page.archives.map((a) => a.game), page.archive]).toEqual([['beamng'], '']);
    expect(Object.fromEntries(page.stages.map((s) => [s.name, s.state])).beamng).toBe('done');
    expect(page.stages.some((s) => s.name === 'pack')).toBe(false);
    // (both: Assetto Corsa's first)
    page = await wait(b, (await b.start(false, false, ['beamng', 'ac'])).id);
    expect(page.archives.map((a) => a.game)).toEqual(['ac', 'beamng']);
    expect(page.stages.map((s) => s.name)).toEqual(['track', 'ac', 'beamng', 'pack']);
  }, 60_000);

  it('makes the BeamNG level from the AC track just made', async () => {
    let asked: { layout: string; ai: string } | null = null;
    let aliveSeen: boolean | undefined;
    const b: Builder = await builder({
      makeBeamng: async ({ layout, ai, log }) => {
        asked = { layout, ai };
        // (the level made in the engine: the build alive, no process of its own running)
        aliveSeen = (await b.job([...b.jobs.keys()].at(-1) as string)).activity?.alive;
        write('build/dist/fake_track_beamng.zip', 'a level');
        log('the level made');
      },
    });
    const info = await b.info();
    expect(info.games?.find((g) => g.id === 'beamng')).toMatchObject({ available: true, everyLayout: true });
    const page = await wait(b, (await b.start(false, false, ['ac', 'beamng'])).id);
    expect(page.state, page.log.join('\n')).toBe('done');
    expect(page.stages.map((s) => s.name)).toEqual(['track', 'ac', 'beamng', 'pack']);
    expect(asked).toEqual({
      layout: 'vp_1500',
      ai: `${project.replace(/\\/g, '/')}/build/ac/content/tracks/fake_track`,
    });
    expect(page.archives.map((a) => a.game).sort()).toEqual(['ac', 'beamng']);
    expect(page.log).toContain('the level made');
    expect(aliveSeen).toBe(true);
  }, 60_000);

  it('installs in both games where they are found, AC’s archive left out where asked, BeamNG’s zip in its mods', async () => {
    const game = join(tmp, 'game').replace(/\\/g, '/');
    const mods = join(tmp, 'mods').replace(/\\/g, '/');
    mkdirSync(mods, { recursive: true });
    const s = sys(game, false);
    let modsGiven: string | undefined = mods;
    const b = await builder(
      { makeBeamng: async () => write('build/dist/fake_track_beamng.zip', 'a level') },
      { ...s, env: (n) => (n === 'BEAMNG_MODS' ? modsGiven : s.env(n)) },
    );
    const info = await b.info();
    expect([info.game, info.beamngMods]).toEqual([game, mods]);
    const page = await wait(
      b,
      (await b.start(true, false, ['ac', 'beamng'], { installBeamng: true, packAc: false })).id,
    );
    expect(page.state, page.log.join('\n')).toBe('done');
    // (no packing: AC reads the track's folder; BeamNG's level its zip, as made)
    expect(page.stages.map((s) => s.name)).toEqual(['track', 'ac', 'beamng']);
    expect(page.archives.map((a) => a.game)).toEqual(['beamng']);
    expect(page.installed).toEqual([
      { game: 'ac', path: `${game}/fake_track` },
      { game: 'beamng', path: `${mods}/fake_track_beamng.zip` },
    ]);
    expect(readFileSync(join(mods, 'fake_track_beamng.zip'), 'utf-8')).toBe('a level');
    expect(existsSync(join(game, 'fake_track', 'extension', 'ext_config.ini'))).toBe(true);
    expect(existsSync(join(project, 'build', 'dist', 'fake_track_ac.zip'))).toBe(false);
    // (not installed in AC: packed whatever is asked, else nothing would come of it)
    const packed = await wait(b, (await b.start(false, false, ['ac'], { packAc: false })).id);
    expect(packed.stages.map((s) => s.name)).toEqual(['track', 'ac', 'pack']);
    // (BeamNG's mods not found: said before building)
    modsGiven = undefined;
    const real = s.env;
    s.env = (n) => (n === 'LOCALAPPDATA' ? undefined : real(n));
    await expect(b.start(false, false, ['beamng'], { installBeamng: true })).rejects.toThrow(
      "BeamNG's mods folder is not found",
    );
  }, 60_000);

  it('has no build of a track whose layouts are not whole', async () => {
    write('tools/reference/objects.json', JSON.stringify({ version: 3, layouts: { a: {} }, objects: [], marks: [] }));
    const b = await builder();
    const info = await b.info();
    expect([info.available, info.track]).toEqual([false, null]);
    expect(info.why).toMatch(/^not ready to build: /);
    await expect(b.start()).rejects.toThrow('not ready to build');
  });
});
