// Starts the desktop app (desktop/main.mjs) in Electron, the arguments given passed on. ELECTRON_RUN_AS_NODE is taken
// out of its environment: set (as in VS Code's terminals), Electron would run main.mjs as plain Node.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const electron = createRequire(import.meta.url)('electron'); // (in Node: the path of Electron's program)
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;

const child = spawn(electron, [join(here, 'main.mjs'), ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
