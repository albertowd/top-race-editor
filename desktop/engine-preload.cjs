// The engine window (never shown): what the engine needs of the computer, from Node (its processors and memory, the disk, the engine's own cache folder), and
// each port to an editor's window handed on to it.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ipcRenderer } = require("electron");
const { version } = require("../package.json");
const { httpFetch, system } = require("./system.cjs");

const appData = process.env.TOP_RACE_KEYS
	? path.dirname(process.env.TOP_RACE_KEYS)
	: process.platform === "win32" && process.env.APPDATA
		? path.join(process.env.APPDATA, "top-race-editor")
		: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "top-race-editor");

window.engineEnv = {
	version,
	processors: () => os.availableParallelism(),
	freeMemory: () => os.freemem(),
	totalMemory: () => os.totalmem(),
	cacheDir: path.join(appData, "cache").split(path.sep).join("/"),
	// (the editor's own models, the catalogue's it adds to a track's: beside the app when packaged, else the repo's)
	modelsDir: (fs.existsSync(path.join(process.resourcesPath || "", "models"))
		? path.join(process.resourcesPath, "models")
		: path.join(__dirname, "..", "models")
	)
		.split(path.sep)
		.join("/"),
	files: {
		read: async (p) => new Uint8Array(await fs.promises.readFile(p)),
		list: (dir) => fs.promises.readdir(dir),
		size: async (p) => (await fs.promises.stat(p)).size,
		exists: async (p) => fs.existsSync(p),
		write: async (p, bytes) => {
			await fs.promises.mkdir(path.dirname(p), { recursive: true });
			// (written aside, then put in place: a cache read half written is none)
			await fs.promises.writeFile(`${p}.new`, bytes);
			await fs.promises.rename(`${p}.new`, p);
		},
		remove: async (p) => fs.promises.rm(p, { force: true }),
	},
	// (the builds': 7-Zip run, the game's folder)
	system: system(),
	// (the new-track wizard's: the providers asked from Node, as the editor; its keys kept on this computer)
	fetch: httpFetch,
	keysFile: (process.env.TOP_RACE_KEYS || path.join(appData, "keys.json")).split(path.sep).join("/"),
};
// (the track open: the one the app was started on, then each opened (the page's /api/open))
let project = (process.argv.find((a) => a.startsWith("--top-race-project=")) || "").slice("--top-race-project=".length) || null;
window.engineEnv.project = {
	get: () => project,
	set: (folder) => {
		project = folder;
	},
};
ipcRenderer.on("engine-port", (e) => window.postMessage("engine-port", "*", e.ports));
