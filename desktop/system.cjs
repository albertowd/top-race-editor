// The computer as a build needs it (src/engine/build.ts's SystemHost), from Node: programs run (7-Zip), processes
// looked for, files' times and copies. The engine window's preload hands it to the engine; the tests use it too.
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WINDOWS = process.platform === 'win32';

/** A program on the PATH (with Windows' extensions), if there is one. */
function which(name) {
  const exts = WINDOWS ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of [...(WINDOWS && path.extname(name) ? [''] : []), ...exts]) {
      const p = path.join(dir, name + ext);
      try {
        if (fs.statSync(p).isFile()) return p.split(path.sep).join('/');
      } catch {
        // (not there)
      }
    }
  }
  return null;
}

async function stat(p) {
  try {
    const s = await fs.promises.stat(p);
    return { size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() };
  } catch {
    return null;
  }
}

function system() {
  return {
    pid: process.pid,
    env: (name) => process.env[name],
    spawn(cmd, args, opts, out) {
      const p = cp.spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env || {}) },
        windowsHide: true,
        // (its own group elsewhere, to be stopped with the ones it starts)
        detached: !WINDOWS,
      });
      p.stdout.setEncoding('utf8');
      p.stderr.setEncoding('utf8');
      p.stdout.on('data', out);
      p.stderr.on('data', out);
      const done = new Promise((resolve) => {
        p.on('error', (e) => {
          out(`${e.message}\n`);
          resolve(-1);
        });
        p.on('close', (code) => resolve(code ?? -1));
      });
      return {
        pid: p.pid || 0,
        done,
        kill() {
          if (p.exitCode !== null || !p.pid) return;
          if (WINDOWS) cp.spawnSync('taskkill', ['/T', '/F', '/PID', String(p.pid)], { windowsHide: true });
          else {
            try {
              process.kill(-p.pid, 'SIGTERM');
            } catch {
              p.kill('SIGTERM');
            }
          }
        },
      };
    },
    alive(pid) {
      if (!(pid > 0)) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (e) {
        return e.code === 'EPERM';
      }
    },
    which,
    async running(image) {
      if (!WINDOWS) return false;
      const r = cp.spawnSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return (r.stdout || '').toLowerCase().includes(image.toLowerCase());
    },
    stat,
    async copy(from, to) {
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to);
      const s = await fs.promises.stat(from);
      await fs.promises.utimes(to, s.atime, s.mtime);
    },
    async createNew(p, text) {
      await fs.promises.mkdir(path.dirname(p), { recursive: true });
      try {
        await fs.promises.writeFile(p, text, { flag: 'wx' });
        return true;
      } catch (e) {
        if (e.code === 'EEXIST') return false;
        throw e;
      }
    },
    move: (from, to) => fs.promises.rename(from, to),
    mkdir: async (p) => {
      await fs.promises.mkdir(p, { recursive: true });
    },
    rmdir: (p) => fs.promises.rmdir(p),
  };
}

/** the user agent every request names (no user's details) */
const AGENT = 'top-race-editor';
/** ms a request may take */
const TIMEOUT = 30_000;
const RETRIES = 3;
const PASSING = new Set([408, 429, 500, 502, 503, 504]);

/** One request: its answer's bytes, or an error with its status (redirects followed). */
function once(url, data, headers, hops = 5) {
  const { request } = url.startsWith('https:') ? require('node:https') : require('node:http');
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: data ? 'POST' : 'GET',
        headers: {
          'User-Agent': AGENT,
          ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length } : {}),
          ...(headers || {}),
        },
        timeout: TIMEOUT,
      },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location && hops > 0) {
          res.resume();
          resolve(once(new URL(res.headers.location, url).toString(), data, headers, hops - 1));
          return;
        }
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => {
          if (code >= 200 && code < 300) resolve(new Uint8Array(Buffer.concat(parts)));
          else reject(Object.assign(new Error(`HTTP Error ${code}: ${res.statusMessage || ''}`.trim()), { code }));
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { timeout: true })));
    req.on('error', reject);
    if (data) req.write(Buffer.from(data));
    req.end();
  });
}

/** The answer to a request (tried again, a little later each time, on a failure that may pass; not on a timeout,
 * which would only wait as long again). */
async function httpFetch(url, data, headers) {
  let last = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await once(url, data, headers);
    } catch (e) {
      last = e;
      if (e.timeout || (typeof e.code === 'number' && !PASSING.has(e.code))) throw e;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw last || new Error(url);
}

module.exports = { system, which, httpFetch };
