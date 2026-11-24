// The roads' bumps as the track keeps them (source/bumps.json, editing/bumps.ts): read for the page and the build, the page's written back (the file before
// kept), and the merged floor moved by them.

import { type Bumps, type BumpsJson, bumpAt, bumpsFrom, bumpsJson, hasBumps, noBumps } from "../editing/bumps";
import type { Mesh } from "./merge";
import type { HostFiles } from "./placehost";
import { backup } from "./trackfiles";

/** The bumps' file, in a track's folder. */
export const bumpsPath = (project: string) => `${project.replace(/[\\/]+$/, "")}/source/bumps.json`;

/** The track's bumps (none: no file). */
export async function loadBumps(files: HostFiles, project: string): Promise<Bumps> {
	const p = bumpsPath(project);
	if (!(await files.exists(p))) return noBumps();
	return bumpsFrom(JSON.parse(new TextDecoder().decode(await files.read(p))));
}

/** The page's bumps written (checked: what is not bumps left out), the file before kept: what was written. */
export async function saveBumps(files: HostFiles, project: string, backups: string, given: unknown): Promise<BumpsJson> {
	const out = bumpsJson(bumpsFrom(given));
	const p = bumpsPath(project);
	await backup(files, p, backups, "bumps");
	await files.write(p, new TextEncoder().encode(JSON.stringify(out)));
	return out;
}

/** The merged floor's meshes moved up (or down) by the bumps where each point is (the hand-made bumps', or any height of where a point is: each mesh given new
 * points, those it had left as they were): the same at a point in every mesh, so no seam opens. How many points were moved. */
export function bumped(meshes: Record<string, Mesh>, b: Bumps | ((x: number, z: number) => number)): number {
	if (typeof b !== "function" && !hasBumps(b)) return 0;
	const at = typeof b === "function" ? b : (x: number, z: number) => bumpAt(b, x, z);
	let n = 0;
	for (const m of Object.values(meshes)) {
		const P = m.P.slice();
		for (let i = 0; i < P.length; i += 3) {
			const dy = at(P[i] as number, P[i + 2] as number);
			if (dy === 0) continue;
			P[i + 1] = (P[i + 1] as number) + dy;
			n++;
		}
		m.P = P;
	}
	return n;
}
