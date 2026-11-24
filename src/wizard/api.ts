// The engine's new-track wizard (under /api/wizard): the engine window's (src/engine/wizard.ts).

import { EngineClient } from "../api/client";
import { engineChannel } from "../api/engineport";

export interface ProviderInfo {
	id: string;
	kind: "image" | "heights";
	label: string;
	about: string;
	attribution: string;
	/** the key it needs (by name), or none */
	key: string | null;
	/** its key is set, or it needs none */
	ready: boolean;
	/** its finest zoom */
	top: number;
}

export interface WizardInfo {
	image: ProviderInfo[];
	heights: ProviderInfo[];
	keys: Record<string, { label: string; set: boolean }>;
	/** where new tracks are made */
	root: string;
	tools: string;
	keys_file: string;
	running: string | null;
	limits: { area: [number, number]; mpp: [number, number]; step: [number, number] };
}

export interface Plan {
	name: string;
	folder?: string;
	lat: number;
	lon: number;
	/** metres across (x) and deep (z), round the origin */
	width: number;
	depth: number;
	image: string;
	/** the picture's metres a pixel */
	mpp: number;
	heights: string;
	/** metres between heights */
	step: number;
	buildings: boolean;
	/** metres: the editor's map picture, square */
	span: number;
}

export interface Estimate {
	image: { zoom: number; requests: number; size: [number, number]; pixels: number; metres_a_pixel: number };
	heights: { points: number; requests: number; apart_m?: number };
	folder: string;
	exists: boolean;
}

export interface Place {
	name: string;
	lat: number;
	lon: number;
	/** south, north, west, east */
	box: [number, number, number, number] | null;
}

export interface JobInfo {
	id: string;
	state: "running" | "done" | "failed" | "stopped";
	step: string;
	steps: string[];
	done: number;
	total: number;
	error: string;
	log: string[];
	folder: string;
	seconds: number;
	/** the command that opens the track made in the editor */
	open: string;
}

export class WizardApi {
	constructor(
		/** the engine's calls, asked of the engine window */
		private readonly engine: Pick<EngineClient, "ask" | "blob">,
	) {}

	private call<T>(path: string, body?: unknown): Promise<T> {
		return this.engine.ask<T>(path, body);
	}

	info(): Promise<WizardInfo> {
		return this.call("/api/wizard");
	}

	/** A key kept on the engine's computer (or forgotten, blank); what is set comes back, never the key. */
	setKey(name: string, value: string): Promise<WizardInfo> {
		return this.call("/api/wizard/keys", { name, value });
	}

	async search(text: string): Promise<Place[]> {
		return (await this.call<{ places: Place[] }>(`/api/wizard/search?q=${encodeURIComponent(text)}`)).places;
	}

	/** A tile's address (the engine's call of it). */
	tileUrl(provider: string, z: number, x: number, y: number): string {
		return `/api/wizard/tile?p=${encodeURIComponent(provider)}&z=${z}&x=${x}&y=${y}`;
	}

	/** What a tile's address is shown from: the engine window's tile, as a blob's URL. */
	tileSrc(url: string): Promise<string> {
		return this.engine.blob(url, "image/jpeg");
	}

	estimate(plan: Plan): Promise<Estimate> {
		return this.call("/api/wizard/estimate", { plan });
	}

	start(plan: Plan): Promise<JobInfo> {
		return this.call("/api/wizard/start", { plan });
	}

	job(id: string): Promise<JobInfo> {
		return this.call(`/api/wizard/job?id=${encodeURIComponent(id)}`);
	}

	cancel(id: string): Promise<JobInfo> {
		return this.call("/api/wizard/cancel", { id });
	}
}

export const wizardApi = new WizardApi(new EngineClient(engineChannel));
