// What a track must have before it is built for a game (exported): every layout its fast line; its pit lane line, where it has pit boxes; a grid slot at least,
// and as many pit boxes as grid slots; a timing gate (its start line) and its hotlap start. What each layout lacks, said as people read it.

type Lay = {
	grid?: unknown[];
	pits?: unknown[];
	hotlap?: unknown;
	timing?: unknown[];
	lines?: { fast?: { curve?: unknown[] }; pit?: { curve?: unknown[] } };
};

/** What the layouts lack ("vp_1500: no fast line, no hotlap start"), one line each; none if nothing (no layouts: said so). */
export function layoutsMissing(objects: unknown): string[] {
	const layouts = ((objects ?? {}) as { layouts?: Record<string, Lay> }).layouts ?? {};
	const names = Object.keys(layouts);
	if (!names.length) return ["the track has no layouts: add one with its grid, pits and timing"];
	const out: string[] = [];
	for (const name of names) {
		const L = layouts[name] as Lay;
		const grid = L.grid?.length ?? 0;
		const pits = L.pits?.length ?? 0;
		const lacks: string[] = [];
		if ((L.lines?.fast?.curve?.length ?? 0) < 3) lacks.push("no fast line");
		if (pits && (L.lines?.pit?.curve?.length ?? 0) < 2) lacks.push("no pit lane line");
		if (!grid) lacks.push("no grid slot");
		if (pits < grid) lacks.push(pits ? `${pits} pit boxes for ${grid} grid slots` : "no pit boxes");
		if (!L.timing?.length) lacks.push("no timing gate");
		if (!L.hotlap) lacks.push("no hotlap start");
		if (lacks.length) out.push(`${name}: ${lacks.join(", ")}`);
	}
	return out;
}
