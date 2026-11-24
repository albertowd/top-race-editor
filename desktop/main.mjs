// The editor as a desktop app (Electron): its page served by the app itself, the engine in a window of its own that is never shown (the engine window: the
// engine's TypeScript, with the computer open to it), the track opened last opened again. Opening another track (the track menu) is the engine window's: it
// keeps the track open, and the page loads again on it.
//
//   npm run desktop [-- --project <folder>]   the page built, then the app (desktop/launch.mjs); that track, else the
//                                             one opened last, else the Velopark next to the editor
//
//   npm run package                           the app packaged (release/: an installer and a zip)
//
//   npm run build-track -- --project <folder> [...]
//                                             a saved track built for the games with no window shown, its log
//                                             printed (desktop/buildcli.mjs: its options); for a CI tool
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, Menu, MessageChannelMain, net, protocol, shell } from "electron";
import { buildArgs, engineCaller, runBuild, USAGE, UsageError } from "./buildcli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
/** the built page: beside the app when packaged, else this folder's */
const DIST = app.isPackaged ? join(process.resourcesPath, "dist") : join(ROOT, "dist");
const BACKGROUND = "#1c1c1e";
/** the app's own pages (the built page), served by the app itself */
const APP = "app://top-race";
const TRACK_FILE = join("tools", "reference", "track.json");

let quitting = false;

/** Where the app keeps what it keeps on this computer (the wizard's keys, the tracks opened before). */
function appData() {
	const keys = process.env.TOP_RACE_KEYS;
	if (keys) return dirname(keys);
	if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "top-race-editor");
	return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "top-race-editor");
}

const isTrack = (f) => !!f && existsSync(join(f, TRACK_FILE));

/** The track opened last (the engine window keeps them, the last first), if it is still there. */
function lastTrack() {
	try {
		const recent = JSON.parse(readFileSync(join(appData(), "recent.json"), "utf-8"));
		return recent.find((f) => typeof f === "string" && isTrack(f)) ?? null;
	} catch {
		return null;
	}
}

/** The arguments given the app (after main.mjs, or the packaged app's own). */
function givenArgs() {
	return app.isPackaged ? process.argv.slice(1) : process.argv.slice(process.argv.findIndex((a) => a.endsWith("main.mjs")) + 1);
}

/** Built from the command line (--build): no window but the engine's. */
const BUILD = givenArgs().includes("--build");

/** The track to open: the one named (--project), else the one opened last, else the Velopark next to the editor. */
function firstTrack() {
	const given = givenArgs();
	const i = given.indexOf("--project");
	const named = i >= 0 ? given[i + 1] : given.find((a) => a.startsWith("--project="))?.slice("--project=".length);
	if (named) return resolve(named);
	const velopark = join(ROOT, "..", "kart-velopark");
	return lastTrack() ?? (isTrack(velopark) ? resolve(velopark) : null);
}

function menu() {
	const mac = process.platform === "darwin";
	// (no Edit menu but on the Mac, where text fields need it: its Ctrl+Z would take the editor's undo)
	return Menu.buildFromTemplate([
		...(mac ? [{ role: "appMenu" }, { role: "editMenu" }] : []),
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{ role: "windowMenu" },
	]);
}

// (the app's own pages served by it, isolated so the engine window's workers may share memory)
protocol.registerSchemesAsPrivileged([
	{
		scheme: "app",
		privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
	},
]);

// (what the app's pages may load: their own files, their WebAssembly compiled (the triangulator, the merge's), their workers, pictures from data and blobs (the
// map's tiles), inline style attributes (React's); nothing from elsewhere: the providers a new track is made from are asked from Node)
const CSP = [
	"default-src 'self'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"worker-src 'self' blob:",
	"img-src 'self' data: blob:",
	"style-src 'self' 'unsafe-inline'",
	"font-src 'self' data:",
	"connect-src 'self' data: blob:",
	"object-src 'none'",
	"base-uri 'none'",
	"frame-ancestors 'none'",
].join("; ");

function serveApp() {
	protocol.handle("app", async (req) => {
		const path = decodeURIComponent(new URL(req.url).pathname);
		const file = normalize(join(DIST, path === "/" ? "index.html" : path));
		if (!file.startsWith(DIST + sep) || !existsSync(file)) return new Response("not found", { status: 404 });
		const res = await net.fetch(pathToFileURL(file).toString());
		const headers = new Headers(res.headers);
		headers.set("Cross-Origin-Opener-Policy", "same-origin");
		headers.set("Cross-Origin-Embedder-Policy", "require-corp");
		headers.set("Content-Security-Policy", CSP);
		return new Response(res.body, { status: res.status, headers });
	});
}

let engineWindow = null;
let engineLoaded = null;

/** The engine window: never shown; the engine's TypeScript, Node's files and the computer open to it; the track open handed to it. Made again if it goes, on
 * the track opened last. */
function startEngineWindow(project) {
	engineWindow = new BrowserWindow({
		show: false,
		webPreferences: {
			preload: join(HERE, "engine-preload.cjs"),
			nodeIntegration: true,
			nodeIntegrationInWorker: true,
			contextIsolation: false,
			sandbox: false,
			backgroundThrottling: false,
			additionalArguments: project ? [`--top-race-project=${project.split(sep).join("/")}`] : [],
		},
	});
	engineWindow.webContents.on("render-process-gone", (_e, d) => {
		// (a build from the command line: failed, not begun again)
		if (BUILD) {
			console.error(`the engine window is gone (${d.reason}): the build failed`);
			app.exit(1);
			return;
		}
		console.log(`[engine window] gone (${d.reason}): opened again`);
		if (!quitting) {
			engineWindow.destroy();
			startEngineWindow(lastTrack() ?? project);
			for (const w of BrowserWindow.getAllWindows()) if (w !== engineWindow) void connectEngine(w);
		}
	});
	engineWindow.webContents.on("console-message", (e) => {
		if (e.level === "warning" || e.level === "error") console.log(`[engine window] ${e.message}`);
	});
	engineLoaded = engineWindow.loadURL(`${APP}/engine.html`).catch((e) => console.log(`[engine window] ${e.message}`));
}

/** A port between a window and the engine window. */
async function connectEngine(win) {
	await engineLoaded;
	if (win.isDestroyed() || !engineWindow || engineWindow.isDestroyed()) return;
	const { port1, port2 } = new MessageChannelMain();
	engineWindow.webContents.postMessage("engine-port", null, [port1]);
	win.webContents.postMessage("engine-port", null, [port2]);
}

/** A saved track built from the command line: the engine window alone, on the track given; the build begun on it as the Build dialog begins it, its log
 * printed; the app's exit code the build's. */
async function buildFromCli() {
	let asked;
	try {
		asked = buildArgs(givenArgs());
	} catch (e) {
		if (!(e instanceof UsageError)) throw e;
		console.error(`${e.message}\n${USAGE}`);
		app.exit(2);
		return;
	}
	const project = resolve(asked.project);
	if (!isTrack(project)) {
		console.error(`${project} is not a track: it has no ${TRACK_FILE}`);
		app.exit(2);
		return;
	}
	serveApp();
	if (!existsSync(join(DIST, "engine.html"))) {
		console.error(`there is no ${join(DIST, "engine.html")}: run npm run build-track (it builds it)`);
		app.exit(2);
		return;
	}
	startEngineWindow(project);
	await engineLoaded;
	const { port1, port2 } = new MessageChannelMain();
	engineWindow.webContents.postMessage("engine-port", null, [port1]);
	let stop = false;
	for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (stop = true));
	console.log(`building ${project} for ${asked.body.games.join(", ")}`);
	const code = await runBuild(engineCaller(port2), project.split(sep).join("/"), asked.body, (l) => console.log(l), {
		stop: () => stop,
	}).catch((e) => {
		console.error(`the build failed: ${e instanceof Error ? e.message : String(e)}`);
		return 1;
	});
	app.exit(code);
}

async function start() {
	if (BUILD) return buildFromCli();
	serveApp();
	Menu.setApplicationMenu(menu());
	if (!existsSync(join(DIST, "index.html"))) {
		dialog.showErrorBox("The page is not built", `There is no ${join(DIST, "index.html")}: run npm run desktop (it builds it).`);
		app.quit();
		return;
	}
	const project = firstTrack();
	startEngineWindow(project);
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 900,
		minHeight: 600,
		title: "Top Race editor",
		backgroundColor: BACKGROUND,
		show: false,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			preload: join(HERE, "preload.cjs"),
		},
	});
	win.once("ready-to-show", () => win.show());
	// (closing the editor's window ends the app, its engine window too)
	win.on("closed", () => app.quit());
	// (the page holds the window while it has changes not saved (beforeunload): Electron asks no one, so asked here: saved first (the page saves, then closes
	// itself), lost, or kept open)
	win.webContents.on("will-prevent-unload", (e) => {
		const choice = dialog.showMessageBoxSync(win, {
			type: "question",
			buttons: ["Save and close", "Close without saving", "Cancel"],
			defaultId: 0,
			cancelId: 2,
			title: "Changes not saved",
			message: "There are changes not saved.",
			detail: "Save them and close, close and lose them, or cancel closing?",
		});
		if (choice === 0) win.webContents.send("save-and-close");
		else if (choice === 1) e.preventDefault();
	});
	// (each time one of its pages loads, a port of its own to the engine window)
	win.webContents.on("did-finish-load", () => {
		if (win.webContents.getURL().startsWith(APP)) void connectEngine(win);
	});
	// (the app's pages in the window; any other address in the browser)
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith(`${APP}/`)) return { action: "allow" };
		void shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (e, url) => {
		if (url.startsWith(`${APP}/`)) return;
		e.preventDefault();
		void shell.openExternal(url);
	});
	// (no track yet: the new-track wizard)
	await win.loadURL(`${APP}/${project ? "index.html" : "wizard.html"}`);
}

// (to drive it from outside, as its tests do: Chromium's debugging port)
if (process.env.TOP_RACE_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.TOP_RACE_DEBUG_PORT);

// (as many apps at a time as are opened. Chromium's data folder is not shared between processes: the first app has the usual one, one opened while it runs a
// folder of its own, removed as far as Chromium lets go of it when the app quits)
if (!app.requestSingleInstanceLock()) {
	const own = mkdtempSync(join(tmpdir(), "top-race-editor-"));
	app.setPath("userData", own);
	app.on("quit", () => {
		try {
			rmSync(own, { recursive: true, force: true, maxRetries: 3 });
		} catch {
			// (what Chromium still holds stays in the temp folder)
		}
	});
}
app.whenReady().then(start);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
	quitting = true;
});
