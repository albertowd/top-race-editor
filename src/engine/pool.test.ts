// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nodeMachine, nodeWorker } from "./node-pool";
import { type Machine, Pool, type Reply, type Request, type WorkerLike } from "./pool";

/** Workers in this process whose parts end when the test says. */
function fakes() {
	const started: { worker: number; req: Request; done: (output: unknown) => void; fail: (e: string) => void }[] = [];
	let made = 0;
	const spawn = (): WorkerLike => {
		const me = ++made;
		let reply: (r: Reply) => void = () => {};
		return {
			send: (req) => {
				started.push({
					worker: me,
					req,
					done: (output) => reply({ id: req.id, ok: true, output }),
					fail: (error) => reply({ id: req.id, ok: false, error }),
				});
			},
			onReply: (fn) => {
				reply = fn;
			},
			onFail: () => {},
			stop: () => {},
		};
	};
	return { spawn, started, made: () => made };
}

const GB = 2 ** 30;
const machine = (processors: number, free: () => number): Machine => ({
	processors: () => processors,
	freeMemory: free,
});

describe("the worker pool", () => {
	it("runs one part a processor, less one, at a time", async () => {
		const f = fakes();
		const pool = new Pool(
			f.spawn,
			machine(4, () => 16 * GB),
		);
		const out = pool.all(Array.from({ length: 5 }, (_, i) => ({ job: "double", input: i, bytes: 1000 })));
		expect(f.started).toHaveLength(3);
		expect(pool.status()).toMatchObject({ workers: 3, limit: 3, waiting: 2 });
		for (let i = 0; i < 5; i++) f.started[i]?.done((f.started[i]?.req.input as number) * 2);
		expect(await out).toEqual([0, 2, 4, 6, 8]);
		expect(f.made()).toBe(3);
	});

	it("has a worker on a computer of one processor", () => {
		const f = fakes();
		const pool = new Pool(
			f.spawn,
			machine(1, () => 16 * GB),
		);
		void pool.all([
			{ job: "a", input: 0, bytes: 0 },
			{ job: "a", input: 1, bytes: 0 },
		]);
		expect(f.started).toHaveLength(1);
	});

	it("waits for memory before handing out a part that would leave too little", () => {
		const f = fakes();
		let free = 3 * GB;
		const pool = new Pool(
			f.spawn,
			machine(16, () => free),
			{ reserve: GB },
		);
		void pool.all(Array.from({ length: 4 }, (_, i) => ({ job: "big", input: i, bytes: GB })));
		// (one runs whatever; the second fits: 3 GB free, the first's 1 GB and its own 1 GB leave the 1 GB kept)
		expect(f.started).toHaveLength(2);
		free = 1.5 * GB;
		f.started[0]?.done(null);
		// (a part ended, but what is free would not cover another beside the one running)
		expect(f.started).toHaveLength(2);
		free = 4 * GB;
		f.started[1]?.done(null);
		expect(f.started).toHaveLength(4);
	});

	it("fails a part its worker could not do, and goes on", async () => {
		const f = fakes();
		const pool = new Pool(
			f.spawn,
			machine(2, () => 16 * GB),
		);
		const a = pool.run({ job: "x", input: 1, bytes: 0 });
		f.started[0]?.fail("no such road");
		await expect(a).rejects.toThrow("no such road");
		const b = pool.run({ job: "x", input: 2, bytes: 0 });
		f.started[1]?.done("ok");
		expect(await b).toBe("ok");
	});

	it("runs parts on Node’s worker threads, their typed arrays handed back", async () => {
		const code = `
      const { parentPort } = require('node:worker_threads');
      parentPort.on('message', (m) => {
        const out = new Float64Array(m.input.n).map((_, i) => i * m.input.k);
        parentPort.postMessage({ id: m.id, ok: true, output: out }, [out.buffer]);
      });`;
		const pool = new Pool(() => nodeWorker(code, { eval: true }), nodeMachine, { max: 2 });
		try {
			const out = await pool.all<Float64Array>([1, 2, 3].map((k) => ({ job: "scale", input: { n: 4, k }, bytes: 64 })));
			expect(out.map((a) => [...a])).toEqual([
				[0, 1, 2, 3],
				[0, 2, 4, 6],
				[0, 3, 6, 9],
			]);
			expect(pool.status().workers).toBeLessThanOrEqual(2);
		} finally {
			pool.close();
		}
	});
});
