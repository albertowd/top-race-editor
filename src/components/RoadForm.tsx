import { DEFAULT_MATERIAL } from "../domain/constants";
import type { Road, Side, TextureMap } from "../domain/types";
import { geo, lookup } from "../geometry/roads";
import { useEditor, useEditorShallow, useEditorState } from "../store/EditorContext";
import { ExportName, Group, NumberField, type Options, Row, SelectField } from "./fields";
import { Icon } from "./icons";
import { roadLabel } from "./RoadList";

const SIDES: Options<Side> = [
	["left", "left"],
	["right", "right"],
];
const MAPS: Options<TextureMap> = [
	["along", "along it"],
	["flat", "flat from above"],
];

/** The selected road: its name, material, texture, and what it is made along (a run-off) or joins (a branch). */
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

/** What the check of the road's mesh found (each mesh made is checked): its faces that would be wrong in the game. */
export function MeshCheck({ name }: Readonly<{ name: string }>) {
	const m = useEditorState((s) => s.meshes[name]);
	let text = "its mesh not made yet";
	let bad = false;
	if (m?.state === "loading") text = "checking its mesh…";
	else if (m?.state === "error") text = "its mesh could not be made";
	else if (m?.state === "ready") {
		const faces = (m.F?.length ?? 0) / 3;
		const down = m.wrong?.down.length ?? 0;
		const thin = m.wrong?.thin.length ?? 0;
		bad = down + thin > 0;
		text = bad
			? `${[down ? plural(down, "face facing down", "faces facing down") : "", thin ? plural(thin, "face without area", "faces without area") : ""]
					.filter(Boolean)
					.join(", ")} of ${plural(faces, "face", "faces")} (red on the map): the game's normals go wrong there`
			: `${plural(faces, "face", "faces")}, all facing up, none without area`;
	}
	return (
		<Row label="Mesh">
			<span className={bad ? "mesh-bad" : "hint"} role={bad ? "alert" : undefined}>
				{text}
			</span>
		</Row>
	);
}

export function RoadForm() {
	const ed = useEditor();
	const { roads, r, materials } = useEditorShallow((s) => ({
		roads: s.roads,
		r: s.sel.r,
		materials: s.track?.materials,
	}));
	const road = roads[r];
	if (!road) return null;
	const o = geo(road, lookup(roads));
	// (the other roads by what they are; their names are what is kept)
	const others: Options<string> = roads
		.map((x, i) => [x, i] as const)
		.filter(([x]) => x !== road && !x.along)
		.map(([x, i]) => [x.name, roadLabel(x, i)] as const);
	const set = (fn: (road: Road) => void, shape = false) => ed.change(fn, shape);
	const mats: Options<string> = (materials ?? [DEFAULT_MATERIAL]).map((m) => [m, m] as const);
	const joins = road.joins ?? [];
	const setJoin = (k: 0 | 1, v: string) =>
		set((x) => {
			const j = [x.joins?.[0] ?? null, x.joins?.[1] ?? null];
			j[k] = v || null;
			if (j.some(Boolean)) x.joins = j;
			else delete x.joins;
		}, true);
	const isBranch = !!road.joins?.some(Boolean);

	return (
		<Group
			id="roadprops"
			label="Road"
			title={roadLabel(road, r)}
			actions={
				<button type="button" className="icon-button" title="Delete this road (Shift+Delete)" aria-label="Delete road" onClick={ed.deleteRoad}>
					<Icon name="trash" />
				</button>
			}
		>
			<Row label="Length">
				{o ? o.length.toFixed(1) : "–"} m{road.curve ? `, ${road.curve.length} nodes` : ""}
			</Row>
			<MeshCheck name={road.name} />
			<Row label="Material">
				<SelectField
					label="Material"
					value={road.material ?? DEFAULT_MATERIAL}
					options={mats}
					onChange={(v) =>
						set((x) => {
							x.material = v;
						})
					}
				/>
			</Row>
			<Row label="Texture">
				<SelectField
					label="Texture"
					value={road.map ?? "along"}
					options={MAPS}
					onChange={(v) =>
						set((x) => {
							x.map = v;
						}, true)
					}
				/>
			</Row>
			{road.along ? (
				<RunOffFields road={road} others={others} />
			) : (
				<>
					<Row label="Leaves">
						<SelectField label="Leaves" value={joins[0] ?? ""} options={[["", "—"], ...others]} onChange={(v) => setJoin(0, v)} />
					</Row>
					<Row label="Joins">
						<SelectField label="Joins" value={joins[1] ?? ""} options={[["", "—"], ...others]} onChange={(v) => setJoin(1, v)} />
					</Row>
					<div className="row actions">
						<button type="button" className="small" disabled={!isBranch} onClick={ed.snapEnds}>
							Ends onto Joined Roads
						</button>
						<button type="button" className="small" onClick={() => ed.smooth(-1)}>
							Smooth All
						</button>
						<button type="button" className="small" onClick={ed.reverse}>
							Reverse
						</button>
					</div>
					<Row label="Order">
						{r + 1} of {roads.length}
						<button
							type="button"
							className="small"
							title="Over more roads: built before them, they are cut where they lie under it"
							onClick={() => ed.moveRoad(-1)}
						>
							↑ up
						</button>
						<button type="button" className="small" title="Under more roads" onClick={() => ed.moveRoad(1)}>
							↓ down
						</button>
					</Row>
					<p className="hint">
						A road is cut where it lies under any road above it in the list (but those joined end to end to it), and takes their heights there; rumbles lie over
						them all.
					</p>
					<p className="hint">
						{isBranch
							? "A branch: cut where it lies over the roads it leaves and joins; its lines fork from theirs."
							: "Leaves / joins: the roads this one forks off and merges into (its ends on their centre lines)."}
					</p>
				</>
			)}
			<ExportName value={road.name} onCommit={ed.rename} />
		</Group>
	);
}

function RunOffFields({ road, others }: Readonly<{ road: Road; others: Options<string> }>) {
	const ed = useEditor();
	const al = road.along;
	if (!al) return null;
	const shape = (fn: (r: Road) => void) => ed.change(fn, true);
	const ease = (
		<NumberField
			label="Ease"
			value={road.ease}
			onCommit={(v) =>
				shape((x) => {
					x.ease = v ?? undefined;
				})
			}
		/>
	);
	return (
		<>
			<Row label="Along">
				<SelectField
					label="Along road"
					value={al.road}
					options={others}
					onChange={(v) =>
						shape((x) => {
							if (x.along) x.along.road = v;
						})
					}
				/>
				<SelectField
					label="Along side"
					value={al.side}
					options={SIDES}
					onChange={(v) =>
						shape((x) => {
							if (x.along) x.along.side = v;
						})
					}
				/>
			</Row>
			<Row label="From–to">
				<NumberField
					label="From"
					value={al.from}
					onCommit={(v) =>
						shape((x) => {
							if (x.along && v != null) x.along.from = v;
						})
					}
				/>
				<NumberField
					label="To"
					value={al.to}
					onCommit={(v) =>
						shape((x) => {
							if (x.along && v != null) x.along.to = v;
						})
					}
				/>
			</Row>
			{road.profile?.length ? (
				<Row label="Width">
					varies ({road.profile.length} points)
					<button
						type="button"
						className="small"
						onClick={() =>
							shape((x) => {
								x.width = Math.max(...(x.profile ?? []).map((q) => q[1]));
								delete x.profile;
							})
						}
					>
						One width
					</button>
					ease {ease}
				</Row>
			) : (
				<Row label="Width">
					<NumberField
						label="Width"
						value={road.width}
						onCommit={(v) =>
							shape((x) => {
								x.width = v ?? undefined;
							})
						}
					/>
					ease {ease}
				</Row>
			)}
			<p className="hint">
				A run-off: asphalt along its road's edge. Drag its ends (triangles) along that edge and its width points (diamonds) out and along; A then a click on it:
				a width point more; Delete: the selected one out.
			</p>
		</>
	);
}
