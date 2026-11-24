import { useEffect, useRef, useState } from "react";
import { useEditorShallow } from "../store/EditorContext";
import type { Task } from "../store/state";
import { useTerrainMaybe } from "../terrain/TerrainContext";

/** milliseconds a task runs before it is shown (the quick ones never are) */
export const SHOW_AFTER = 400;
/** seconds a wait goes on before the editor says why it may */
const LONG = 5;

/** The time now, ticking while on. */
function useNow(on: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!on) return;
		setNow(Date.now());
		const t = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(t);
	}, [on]);
	return now;
}

const seconds = (ms: number) => `${Math.max(0, Math.floor(ms / 1000))} s`;

/** The terrain editor's waits as tasks (its own store's): loading it, working a change out, saving it. */
function useTerrainTasks(): Task[] {
	const terrain = useTerrainMaybe();
	const [on, setOn] = useState({ loading: false, working: false, saving: false });
	const since = useRef<Record<string, number>>({});
	useEffect(() => {
		if (!terrain) return;
		const pick = () => {
			const s = terrain.store.getState();
			const next = { loading: s.status === "loading", working: s.working, saving: s.saving };
			setOn((was) => (was.loading === next.loading && was.working === next.working && was.saving === next.saving ? was : next));
		};
		pick();
		return terrain.store.subscribe(pick);
	}, [terrain]);
	const out: Task[] = [];
	const add = (key: keyof typeof on, id: number, label: string, blocking: boolean) => {
		if (!on[key]) {
			delete since.current[key];
			return;
		}
		since.current[key] ??= Date.now();
		out.push({ id: -id, label, blocking, since: since.current[key] });
	};
	add("loading", 1, "Loading the terrain", false);
	add("working", 2, "Working out the terrain", false);
	add("saving", 3, "Saving the terrain", true);
	return out;
}

/** What the editor waits on: a loading screen while the window must wait (the track opening, saving, a road brought in, another track opened), a note at the
 * top while it can go on (the track's models read, the surface checked). */
export function Activity() {
	const terrainTasks = useTerrainTasks();
	const { editorTasks, booting, opening, track, build } = useEditorShallow((s) => ({
		editorTasks: s.tasks,
		build: !s.building.open && s.building.job?.state === "running" ? s.building.job : null,
		booting: s.booting,
		opening: s.opening,
		track: s.track?.name,
	}));
	const [openedAt, setOpenedAt] = useState(0);
	useEffect(() => {
		setOpenedAt(opening ? Date.now() : 0);
	}, [opening]);
	// (a build for Assetto Corsa going on, its dialog closed)
	const [buildSince] = useState(() => Date.now());
	const buildTask: Task[] = build
		? [
				{
					id: -10,
					label: `Building for Assetto Corsa: ${Math.round((build.fraction ?? 0) * 100)}%${
						build.activity?.stage ? `, ${build.activity.stage}` : ""
					}${build.left ? `, about ${Math.ceil(build.left / 60)} min left` : ""}`,
					blocking: false,
					since: buildSince - build.seconds * 1000,
				},
			]
		: [];
	const tasks = [...editorTasks, ...terrainTasks, ...buildTask];
	const now = useNow(tasks.length > 0 || booting || !!opening);
	const shown = tasks.filter((t) => now - t.since >= SHOW_AFTER);
	const waiting = shown.find((t) => t.blocking);
	const going = shown.filter((t) => !t.blocking);

	let screen: { title: string; detail: string; since: number } | null = null;
	if (opening)
		screen = {
			title: `Opening ${opening.name}`,
			detail: "The engine opens it; the editor loads again on it.",
			since: openedAt || now,
		};
	else if (booting) {
		const first = tasks.find((t) => t.blocking);
		screen = {
			title: track ? `Opening ${track}` : "Opening the track",
			detail: "Its roads, objects and drawings.",
			since: first?.since ?? now,
		};
	} else if (waiting) screen = { title: `${waiting.label}…`, detail: "", since: waiting.since };

	return (
		<>
			{screen ? (
				<div className="loading" role="status" aria-live="polite">
					<div className="loading-card">
						<span className="spinner" aria-hidden="true" />
						<p className="loading-title">{screen.title}</p>
						{screen.detail ? <p className="hint">{screen.detail}</p> : null}
						<p className="loading-time">{seconds(now - screen.since)}</p>
						{now - screen.since > LONG * 1000 && (booting || opening) ? (
							<p className="hint">The first time after the track's models change, the engine reads them again: that takes a while.</p>
						) : null}
					</div>
				</div>
			) : null}
			{going.length && !screen ? (
				<div className="working" role="status" aria-live="polite">
					<span className="spinner small" aria-hidden="true" />
					{going.map((t) => `${t.label}… ${seconds(now - t.since)}`).join(" · ")}
				</div>
			) : null}
		</>
	);
}
