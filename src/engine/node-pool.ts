// The pool on Node: its worker threads and the computer as Node's os module sees it. For the tests and the command line; the engine window has its own (web
// workers).
import { availableParallelism, freemem } from "node:os";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type { Machine, Reply, WorkerLike } from "./pool";

export const nodeMachine: Machine = { processors: availableParallelism, freeMemory: freemem };

/** A Node worker thread as the pool uses one. */
export function nodeWorker(script: string | URL, options?: WorkerOptions): WorkerLike {
	const w = new Worker(script, options);
	return {
		send: (msg, transfer) => w.postMessage(msg, transfer as never),
		onReply: (fn) => w.on("message", (r: Reply) => fn(r)),
		onFail: (fn) => {
			w.on("error", fn);
			w.on("exit", (code) => {
				if (code) fn(new Error(`a worker stopped (exit ${code})`));
			});
		},
		stop: () => void w.terminate(),
	};
}
