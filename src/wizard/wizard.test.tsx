import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type JobInfo, type Plan, WizardApi, type WizardInfo } from "./api";
import { fromPx, latLonOf, metresAPixel, toPx, zoomToShow } from "./geo";
import { slug, Wizard } from "./Wizard";

const INFO: WizardInfo = {
	image: [
		{
			id: "esri",
			kind: "image",
			label: "Esri World Imagery",
			about: "no key",
			attribution: "Esri",
			key: null,
			ready: true,
			top: 19,
		},
		{
			id: "google",
			kind: "image",
			label: "Google Maps",
			about: "Google pictures",
			attribution: "Google",
			key: "google",
			ready: false,
			top: 20,
		},
	],
	heights: [
		{
			id: "terrarium",
			kind: "heights",
			label: "AWS Terrain Tiles",
			about: "no key",
			attribution: "AWS",
			key: null,
			ready: true,
			top: 15,
		},
	],
	keys: { google: { label: "Google Maps API key", set: false } },
	root: "D:/projects",
	tools: "D:/projects/kart-velopark/tools",
	keys_file: "C:/Users/u/AppData/Roaming/top-race-editor/keys.json",
	running: null,
	limits: { area: [100, 8000], mpp: [0.25, 10], step: [2, 200] },
};

const job = (over: Partial<JobInfo>): JobInfo => ({
	id: "job1",
	state: "running",
	step: "picture",
	steps: ["place", "picture", "heights", "buildings", "terrain", "track"],
	done: 3,
	total: 10,
	error: "",
	log: ["the track at -29.8, -51.3"],
	folder: "D:/projects/my-park",
	seconds: 1,
	open: 'npm run desktop -- --project "D:/projects/my-park"',
	...over,
});

/** An engine's wizard answering as asked: each request kept. */
function fakeEngine() {
	const asked: { path: string; body: unknown }[] = [];
	let polls = 0;
	const answer = (path: string, body: unknown): unknown => {
		if (path === "/api/wizard") return INFO;
		if (path.startsWith("/api/wizard/search"))
			return {
				places: [
					{
						name: "Velopark, Nova Santa Rita, Brazil",
						lat: -29.82,
						lon: -51.32,
						box: [-29.83, -29.81, -51.33, -51.31],
					},
				],
			};
		if (path === "/api/wizard/keys") {
			const { name, value } = body as { name: string; value: string };
			return { ...INFO, keys: { [name]: { label: "Google Maps API key", set: !!value } } };
		}
		if (path === "/api/wizard/estimate") {
			const plan = (body as { plan: Plan }).plan;
			if (plan.width > 8000) return { error: "width: 9000 is not within 100 to 8000" };
			return {
				image: {
					zoom: 17,
					requests: 64,
					size: [plan.width / plan.mpp, plan.depth / plan.mpp],
					pixels: 1,
					metres_a_pixel: 1.03,
				},
				heights: { points: 26000, requests: 12, apart_m: 4.1 },
				folder: `D:/projects/${slug(plan.name)}`,
				exists: false,
			};
		}
		if (path === "/api/wizard/start") return job({});
		if (path.startsWith("/api/wizard/job")) {
			polls++;
			return polls < 2 ? job({ step: "terrain", done: 0, total: 0 }) : job({ state: "done", step: "track", log: ["made"] });
		}
		return { error: `no ${path}` };
	};
	const engine = {
		async ask<T>(path: string, body?: unknown): Promise<T> {
			asked.push({ path, body });
			const data = answer(path, body) as { error?: string };
			if (data?.error) throw new Error(data.error);
			return data as T;
		},
		blob: async (path: string) => `blob:${path}`,
	};
	return { api: new WizardApi(engine), asked };
}

describe("the map arithmetic", () => {
	it("turns latitude and longitude to the map and back; a track x west, z north", () => {
		const [px, py] = toPx(-29.82, -51.32, 15);
		const [lat, lon] = fromPx(px, py, 15);
		expect(lat).toBeCloseTo(-29.82, 9);
		expect(lon).toBeCloseTo(-51.32, 9);
		const [la, lo] = latLonOf(-29.82, -51.32, 100, 200);
		expect(lo).toBeLessThan(-51.32);
		expect(la).toBeGreaterThan(-29.82);
		expect(metresAPixel(0, 0)).toBeCloseTo(156543.03, 1);
		expect(zoomToShow(0, 1000, 700)).toBe(16);
		expect(slug("  My Park! ")).toBe("my-park");
	});
});

describe("the wizard", () => {
	it("finds a place, keeps a key, estimates the plan, makes the track and says how to open it", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		const { api, asked } = fakeEngine();
		render(<Wizard api={api} pollMs={5} settleMs={5} />);
		expect(await screen.findByRole("heading", { name: "New Track" })).toBeInTheDocument();
		const make = screen.getByRole("button", { name: "Make the Track" });
		expect(make).toBeDisabled();
		expect(screen.getByText("It needs a place and a name.")).toBeInTheDocument();
		// (a place found by its name: the origin there, the name from it)
		await userEvent.type(screen.getByLabelText("Find a place"), "velopark");
		await userEvent.click(screen.getByRole("button", { name: "Find" }));
		await userEvent.click(await screen.findByRole("button", { name: /Velopark, Nova Santa Rita/ }));
		expect(screen.getByLabelText("Latitude")).toHaveValue(-29.82);
		expect(screen.getByLabelText("The track's name")).toHaveValue("Velopark");
		expect(screen.getByLabelText("Its folder")).toHaveAttribute("placeholder", "velopark");
		// (a provider that needs a key says so; the key kept, never shown again)
		const providers = screen.getByRole("group", { name: "Where the picture comes from" });
		expect(within(providers).getByText("needs a key")).toBeInTheDocument();
		await userEvent.type(screen.getByLabelText("Google Maps API key"), "K3Y");
		await userEvent.click(screen.getByRole("button", { name: "Keep" }));
		expect(asked.find((a) => a.path === "/api/wizard/keys")?.body).toEqual({ name: "google", value: "K3Y" });
		expect(screen.getByLabelText("Google Maps API key")).toHaveValue("");
		expect(screen.getByRole("button", { name: "Forget the Google Maps API key" })).toBeInTheDocument();
		// (what it asks for)
		const est = await screen.findByRole("list", { name: "What it asks for" });
		expect(within(est).getByText(/1500 × 1500 px, from 64 tiles/)).toBeInTheDocument();
		expect(within(est).getByText(/26,000 heights, in 12 requests/)).toBeInTheDocument();
		// (a plan it cannot make: why)
		const width = screen.getByLabelText("Width, metres (x)");
		await userEvent.clear(width);
		await userEvent.type(width, "9000");
		expect(await screen.findByText(/width: 9000 is not within/)).toBeInTheDocument();
		await userEvent.clear(width);
		await userEvent.type(width, "1200");
		await waitFor(() => expect(screen.getByRole("button", { name: "Make the Track" })).toBeEnabled());
		// (made: its steps as it goes, then the command that opens it)
		await userEvent.click(screen.getByRole("button", { name: "Make the Track" }));
		const start = asked.find((a) => a.path === "/api/wizard/start")?.body as { plan: Plan };
		expect(start.plan).toMatchObject({ name: "Velopark", lat: -29.82, lon: -51.32, width: 1200, image: "esri" });
		expect(start.plan.folder).toBeUndefined();
		expect(await screen.findByText(/Made in D:\/projects\/my-park/)).toBeInTheDocument();
		expect(screen.getByText('npm run desktop -- --project "D:/projects/my-park"')).toBeInTheDocument();
	});

	it("says so when the engine has no wizard", async () => {
		const api = new WizardApi({
			ask: () => Promise.reject(new Error("not found")),
			blob: () => Promise.reject(new Error("not found")),
		});
		render(<Wizard api={api} />);
		expect(await screen.findByRole("alert")).toHaveTextContent("The engine's wizard is not there: not found");
	});

	it("puts the origin where the map is clicked, or at its middle with Enter", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		const { api } = fakeEngine();
		render(<Wizard api={api} settleMs={5} />);
		const map = await screen.findByLabelText(/The map: drag to move it/);
		act(() => map.focus());
		await userEvent.keyboard("{Enter}");
		expect(screen.getByLabelText("Latitude")).toHaveValue(0);
		await userEvent.keyboard("{ArrowRight}+");
		await userEvent.keyboard("{Enter}");
		expect(Number((screen.getByLabelText("Longitude") as HTMLInputElement).value)).toBeGreaterThan(0);
	});
});
