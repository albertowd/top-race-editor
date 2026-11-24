import { describe, expect, it, vi } from "vitest";
import { ApiError, EngineClient, type LocalEngine } from "./client";

/** An engine window answering roads and meshes of the track it has open. */
function engineWindow(folder = "D:/tracks/a") {
	let open = folder;
	return {
		connected: true,
		project: vi.fn(async () => open),
		call: vi.fn(async (_m: string, p: { folder: string; path: string; body?: unknown }) => {
			if (p.path === "/api/roads") return { roads: [], folder: p.folder };
			if (p.path === "/api/meshes") return { meshes: [{ name: "M" }] };
			if (p.path === "/api/open") {
				open = (p.body as { folder: string }).folder;
				return { ok: true, name: "B", folder: open };
			}
			throw new Error(`the engine has no call GET ${p.path}`);
		}),
	};
}

describe("the engine client", () => {
	it("asks the engine window, of the track it has open, by each call’s path and body", async () => {
		const local = engineWindow();
		const c = new EngineClient(local as unknown as LocalEngine);
		expect(await c.roads()).toEqual({ roads: [], folder: "D:/tracks/a" });
		expect(await c.meshes()).toEqual([{ name: "M" }]);
		expect(local.call).toHaveBeenCalledWith("api", { folder: "D:/tracks/a", path: "/api/roads", body: undefined });
		await c.bring("m.glb", "X").catch(() => {});
		expect(local.call).toHaveBeenLastCalledWith("api", {
			folder: "D:/tracks/a",
			path: "/api/bring",
			body: { model: "m.glb", name: "X" },
		});
		// (the folder asked of it once; again after another track is opened)
		expect(local.project).toHaveBeenCalledTimes(1);
		await c.openTrack("D:/tracks/b");
		expect(await c.roads()).toEqual({ roads: [], folder: "D:/tracks/b" });
		expect(local.project).toHaveBeenCalledTimes(2);
	});

	it("fails with what the engine window said, and with no engine window at all", async () => {
		const local = engineWindow();
		const c = new EngineClient(local as unknown as LocalEngine);
		await expect(c.context()).rejects.toEqual(new ApiError("the engine has no call GET /api/context", 500));
		local.call.mockRejectedValueOnce(new Error("roads.json: not JSON"));
		await expect(c.roads()).rejects.toEqual(new ApiError("roads.json: not JSON", 500));
		// (not in the desktop app: no engine window, said so)
		const alone = new EngineClient({
			connected: false,
			call: local.call,
			whenReady: async () => false,
		} as unknown as LocalEngine);
		await expect(alone.meshes()).rejects.toMatchObject({ status: 503, message: /no engine window/ });
		expect(local.call).toHaveBeenCalledTimes(2);
	});

	it("stops waiting for a call its signal aborts", async () => {
		const local = engineWindow();
		local.call.mockImplementationOnce(() => new Promise(() => {}));
		const c = new EngineClient(local as unknown as LocalEngine);
		const stop = new AbortController();
		const asked = c.mesh({ name: "A" }, [], stop.signal);
		stop.abort();
		await expect(asked).rejects.toMatchObject({ name: "AbortError" });
	});
});
