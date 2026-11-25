// The page's way to the engine window: the port the desktop app hands each window it loads (its preload posts it to the page as an 'engine-port' message).
// Outside the app there is none, and the page has no engine.

import type { AcBuilt } from "../engine/acbuild";
import type { Answer, EngineInfo, PortLike } from "../engine/host";
import type { RoadsMerged } from "../engine/roadshost";

export const PORT_MESSAGE = "engine-port";

/** Calls the port the page was given, if any. */
export class EngineChannel {
	private port: PortLike | null = null;
	private next = 1;
	private waiting: ((ok: boolean) => void)[] = [];

	/** Whether the port is here, once it is (in the desktop app, waited for up to ms: it is handed over as the page loads); at once false outside the app. */
	whenReady(ms = 10_000, desktop = (globalThis as { topRaceDesktop?: boolean }).topRaceDesktop === true): Promise<boolean> {
		if (this.port) return Promise.resolve(true);
		if (!desktop) return Promise.resolve(false);
		return new Promise((resolve) => {
			const t = setTimeout(() => {
				this.waiting = this.waiting.filter((w) => w !== done);
				resolve(false);
			}, ms);
			const done = (ok: boolean) => {
				clearTimeout(t);
				resolve(ok);
			};
			this.waiting.push(done);
		});
	}
	private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

	/** The port to call on (a newer one in place of the last: the window loaded again). */
	connect(port: PortLike): void {
		this.port = port;
		for (const w of this.waiting.splice(0)) w(true);
		port.onmessage = (e) => {
			const a = e.data as Answer;
			const p = this.pending.get(a?.id);
			if (!p) return;
			this.pending.delete(a.id);
			if (a.ok) p.resolve(a.result);
			else p.reject(new Error(a.error));
		};
	}

	get connected(): boolean {
		return this.port !== null;
	}

	call<T>(method: string, params?: unknown): Promise<T> {
		const port = this.port;
		if (!port) return Promise.reject(new Error("no engine window: the editor runs in its desktop app"));
		const id = this.next++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
			port.postMessage({ id, method, params });
		});
	}

	info(): Promise<EngineInfo> {
		return this.call("info");
	}

	/** The track the engine window has open (its folder), null where it keeps none. */
	project(): Promise<string | null> {
		return this.call("project");
	}

	/** A track's roads merged with its ground by the engine window (its folder), proved: what it came to. */
	mergeRoads(project: string): Promise<RoadsMerged> {
		return this.call("roads.merge", { project, check: true });
	}

	/** A track built for AC by the engine window (its folder), as the track's build makes it: what it made. */
	buildAc(project: string): Promise<AcBuilt> {
		return this.call("build.ac", { project });
	}
}

/** The page's channel to the engine window. */
export const engineChannel = new EngineChannel();

/** Each port the window is handed, to fn (the desktop app's preload posts it to the page). */
export function onEnginePort(fn: (port: PortLike) => void, target: Window = window): void {
	target.addEventListener("message", (e: MessageEvent) => {
		// (only the window's own preload's, posted from the page itself: none from another origin or frame)
		if (e.origin !== target.location.origin || e.source !== target) return;
		// (the browser's port, as the engine's code has one: its messages' data, and a way to post)
		if (e.data === PORT_MESSAGE && e.ports[0]) fn(e.ports[0] as unknown as PortLike);
	});
}
