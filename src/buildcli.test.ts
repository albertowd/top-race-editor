// @vitest-environment node
// The track built from the command line (desktop/buildcli.mjs): its arguments read as the Build dialog's choices, wrong ones refused; the build begun on the
// engine, its log said line by line as it comes, its exit code its end's.
import { describe, expect, it } from "vitest";
// @ts-expect-error (the desktop app's plain JavaScript: no types of its own)
import { buildArgs, runBuild, UsageError } from "../desktop/buildcli.mjs";

type Job = { id: string; state: string; log: string[]; error: string; seconds: number };

describe("the track built from the command line", () => {
	it("reads its arguments as the Build dialog's choices", () => {
		expect(buildArgs(["--build", "--project", "D:/tracks/velopark"])).toEqual({
			project: "D:/tracks/velopark",
			body: { games: ["ac"], install: false, installBeamng: false, installRf2: false, packAc: true, all: false },
		});
		const all = buildArgs(["--project=x", "--games", "ac,BeamNG,rf2,ac", "--install", "--install-beamng", "--all"]);
		expect(all.body).toEqual({
			games: ["ac", "beamng", "rf2"],
			install: true,
			installBeamng: true,
			installRf2: false,
			packAc: true,
			all: true,
		});
		expect(buildArgs(["--project", "x", "--install", "--no-pack", "--no-sandbox"]).body.packAc).toBe(false);
	});

	it("refuses arguments it cannot build by", () => {
		for (const bad of [
			[],
			["--project"],
			["--project", "x", "--games", "gt7"],
			["--project", "x", "--install-rf2"],
			["--project", "x", "--games", "beamng", "--install"],
			["--project", "x", "--fast"],
			["--project", "x", "extra"],
		])
			expect(() => buildArgs(bad)).toThrow(UsageError);
	});

	it("says the log as it comes, and ends as the build ends", async () => {
		const said: string[] = [];
		const calls: { path: string; body: unknown }[] = [];
		const states: Job[] = [
			{ id: "build1", state: "running", log: ["the track made"], error: "", seconds: 1 },
			{ id: "build1", state: "running", log: ["the track made", "AC: 3 models"], error: "", seconds: 2 },
			{
				id: "build1",
				state: "done",
				log: ["the track made", "AC: 3 models", "built for Assetto Corsa"],
				error: "",
				seconds: 3,
			},
		];
		const call = async (method: string, p: { folder: string; path: string; body?: unknown }) => {
			expect([method, p.folder]).toEqual(["api", "D:/t"]);
			calls.push({ path: p.path, body: p.body });
			return states.shift();
		};
		const code = await runBuild(call, "D:/t", { games: ["ac"] }, (l: string) => said.push(l), { every: 0 });
		expect(code).toBe(0);
		expect(calls[0]).toEqual({ path: "/api/build", body: { games: ["ac"] } });
		expect(calls[1]?.path).toBe("/api/build/job?id=build1");
		expect(said).toEqual(["the track made", "AC: 3 models", "built for Assetto Corsa", "built in 3 s"]);

		const failed = await runBuild(
			async () => ({ id: "b", state: "failed", log: ["failed: no floor"], error: "no floor", seconds: 1 }),
			"D:/t",
			{},
			() => {},
			{ every: 0 },
		);
		expect(failed).toBe(1);
		const refused = await runBuild(
			async () => {
				throw new Error("a build is running already");
			},
			"D:/t",
			{},
			(l: string) => said.push(l),
		);
		expect(refused).toBe(1);
		expect(said.at(-1)).toBe("the build did not start: a build is running already");
	});

	it("asks the build to stop when it is told to (Ctrl+C), and ends stopped", async () => {
		const paths: string[] = [];
		let n = 0;
		const call = async (_m: string, p: { path: string }) => {
			paths.push(p.path);
			if (p.path === "/api/build/cancel") return {};
			n++;
			return { id: "b", state: n < 3 ? "running" : "stopped", log: [], error: "stopped", seconds: 1 };
		};
		const code = await runBuild(call, "D:/t", {}, () => {}, { every: 0, stop: () => true });
		expect(code).toBe(1);
		expect(paths.filter((p) => p === "/api/build/cancel")).toHaveLength(1);
	});
});
