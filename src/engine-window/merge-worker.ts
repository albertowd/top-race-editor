// A web worker of the engine window serving the merge's jobs (src/engine/merge-worker.ts): Triangle's code fetched from the app's own files the first time a
// job needs it.
import triangleWasm from "triangle-wasm/triangle.out.wasm?url";
import { mergeJobs } from "../engine/merge-worker";
import { type Request, serve } from "../engine/pool";

const scope = self as unknown as {
	onmessage: ((e: MessageEvent<Request>) => void) | null;
	postMessage(m: unknown, transfer: Transferable[]): void;
};

serve(
	mergeJobs(async () => new Uint8Array(await (await fetch(triangleWasm)).arrayBuffer())),
	{
		onMessage: (fn) => {
			scope.onmessage = (e) => fn(e.data);
		},
		post: (r, transfer) => scope.postMessage(r, transfer),
	},
);
