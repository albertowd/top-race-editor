import { type ReactNode, useState } from "react";
import { CATEGORIES, CATEGORY_ORDER, type Category, countIn, type Others, UNCOUNTED } from "../domain/categories";
import { useEditor, useEditorShallow, useEditorState } from "../store/EditorContext";
import { TerrainPanel } from "../terrain/TerrainPanel";
import { BumpsPanel } from "./BumpsPanel";
import { Segmented } from "./fields";
import { GroundPicturePanel } from "./GroundPicturePanel";
import { CATEGORY_ICONS, Icon } from "./icons";
import { LiningPanel } from "./LiningPanel";
import { NodeForm } from "./NodeForm";
import { ObjectFinder, ObjectForm, ObjectsPanel } from "./ObjectsPanel";
import { KerbsForm, LinesForm, PickRoad } from "./PaintForms";
import { RoadForm } from "./RoadForm";
import { RoadList } from "./RoadList";
import { SurfacePanel } from "./SurfacePanel";
import { WearPanel } from "./WearPanel";

const OTHERS: readonly (readonly [Others, string])[] = [
	["show", "Show"],
	["dim", "Dim"],
	["hide", "Hide"],
];

/** The trailing pane: the category worked on, its flow, what is picked in it. */
export function Inspector() {
	const ed = useEditor();
	const { focus, others } = useEditorShallow((s) => ({ focus: s.focus, others: s.others }));
	const cat = CATEGORIES[focus];
	return (
		<aside id="panel" className="glass" aria-label="Inspector">
			<header className="inspector-head">
				<span className={`side-icon side-${focus}`}>
					<Icon name={CATEGORY_ICONS[focus]} />
				</span>
				<div className="inspector-title">
					<h2>{cat.label}</h2>
					<p>{cat.what}</p>
				</div>
			</header>
			{focus === "all" ? null : (
				<div className="others">
					<span aria-hidden="true">Everything else</span>
					<Segmented label="Everything else on the map" value={others} options={OTHERS} onChange={ed.setOthers} />
				</div>
			)}
			<div className="inspector-body">
				<Body focus={focus} />
			</div>
		</aside>
	);
}

function Body({ focus }: Readonly<{ focus: Category }>) {
	switch (focus) {
		case "all":
			return <Overview />;
		case "roads":
			return <RoadsFlow />;
		case "rumbles":
			return <RumblesFlow />;
		case "paint":
			return <PaintFlow />;
		case "terrain":
			return (
				<>
					<GroundPicturePanel />
					<TerrainPanel />
				</>
			);
		case "race":
			return (
				<ObjectsFlow
					kinds={CATEGORIES[focus].kinds}
					extra={
						<>
							<WearPanel part="lines" />
							<LiningPanel />
						</>
					}
				/>
			);
		default:
			return <ObjectsFlow kinds={CATEGORIES[focus].kinds} />;
	}
}

function SurfaceCheck() {
	const ed = useEditor();
	return (
		<button
			type="button"
			className="small"
			title="Build the surface where you look, as the build makes it (roads, rumbles, ground merged), and show any seam problem (C)"
			onClick={() => void ed.checkSurface()}
		>
			<Icon name="surface" size={14} /> Check Surface
		</button>
	);
}

function RoadsFlow() {
	const ed = useEditor();
	return (
		<>
			<div className="row actions">
				<button type="button" className="small" title="Draw a new road: click its nodes, Enter to finish (N)" onClick={() => ed.setMode("new")}>
					<Icon name="new" size={14} /> New Road
				</button>
				<button
					type="button"
					className="small"
					title="Bring a road the track has into the editor: read from its mesh as a curve (B)"
					onClick={() => void ed.openBring()}
				>
					<Icon name="bring" size={14} /> Bring In…
				</button>
				<SurfaceCheck />
			</div>
			<SurfacePanel />
			<BumpsPanel />
			<RoadList />
			<RoadForm />
			<NodeForm />
		</>
	);
}

/** The road picked, if paint or rumbles can go on it (not a run-off). */
function usePaintable() {
	return useEditorState((s) => {
		const r = s.roads[s.sel.r];
		return !!r && !r.along;
	});
}

function RumblesFlow() {
	const paintable = usePaintable();
	return (
		<>
			<div className="row actions">
				<SurfaceCheck />
			</div>
			<RoadList count="kerbs" />
			{paintable ? <KerbsForm /> : <PickRoad what="rumbles" />}
		</>
	);
}

type PaintPart = "lines" | "marks" | "rubber";

function PaintFlow() {
	const paintable = usePaintable();
	const { line, mark } = useEditorShallow((s) => ({
		line: s.sel.line >= 0,
		mark: s.obj?.kind === "marks" || s.obj?.kind === "rubber" ? s.obj.kind : null,
	}));
	const [chosen, setChosen] = useState<PaintPart>("lines");
	// (what is picked on the map shows its own part)
	let part = chosen;
	if (mark) part = mark;
	else if (line) part = "lines";
	const ed = useEditor();
	const onChange = (p: PaintPart) => {
		// (what is picked of another part let go, as it would show its own)
		if (p === "lines" || (mark && mark !== p)) ed.selectObject(null);
		if (p !== "lines") ed.select({ line: -1 });
		setChosen(p);
	};
	let flow: ReactNode;
	if (part === "rubber") flow = <ObjectsFlow kinds={["rubber"]} />;
	else if (part === "lines")
		flow = (
			<>
				<RoadList count="lines" />
				{paintable ? <LinesForm /> : <PickRoad what="lines" />}
			</>
		);
	else
		flow = (
			<ObjectsFlow
				kinds={["marks"]}
				extra={
					<>
						<AcrossRow />
						<LiningPanel paint />
					</>
				}
			/>
		);
	return (
		<>
			<Segmented
				label="Paint"
				value={part}
				options={[
					["lines", "Road Lines"],
					["marks", "Paint Marks"],
					["rubber", "Rubber"],
				]}
				onChange={onChange}
			/>
			{part === "rubber" ? <WearPanel part="rubber" /> : <WearPanel part="paint" />}
			{flow}
		</>
	);
}

/** A line painted across a road, edge to edge (a start line): the next click on a road. */
function AcrossRow() {
	const ed = useEditor();
	const on = useEditorState((s) => s.mode === "place" && s.place === "marks" && s.markAcross);
	return (
		<div className="actions">
			<button
				type="button"
				className={on ? "on" : undefined}
				aria-pressed={on}
				title="Click on a road: a line across it, from edge to edge (a start line)"
				onClick={() => (on ? ed.setMode("select") : ed.paintAcross())}
			>
				{on ? "Click on a Road…" : "Paint a Line Across a Road"}
			</button>
		</div>
	);
}

function ObjectsFlow({ kinds, extra }: Readonly<{ kinds: CategoryKinds; extra?: ReactNode }>) {
	const picked = useEditorState((s) => (s.obj && kinds.includes(s.obj.kind) ? s.obj.kind : null));
	return (
		<>
			<ObjectsPanel kinds={kinds} />
			{extra}
			{picked ? <ObjectForm /> : <p className="empty-state pick-hint">Pick one on the map to see it here, or find it in the list.</p>}
			<ObjectFinder kinds={kinds} />
		</>
	);
}

type CategoryKinds = (typeof CATEGORIES)[Category]["kinds"];

/** Everything: what is picked (any kind), else each category and how many it has. */
function Overview() {
	const ed = useEditor();
	const s = useEditorShallow((st) => ({
		obj: st.obj,
		sel: st.sel,
		road: st.roads[st.sel.r],
		roads: st.roads,
		objects: st.objects,
		layout: st.layout,
		sidebar: st.sidebar,
	}));
	if (s.obj) return <ObjectForm />;
	if (s.road) {
		if (s.sel.line >= 0) return <LinesForm />;
		if (s.sel.kerb >= 0) return <KerbsForm />;
		return (
			<>
				<RoadForm />
				<NodeForm />
				{s.road.along ? null : (
					<div className="row actions">
						<button type="button" className="small" onClick={() => ed.setFocus("rumbles")}>
							Rumbles ({s.road.kerbs?.length ?? 0})
						</button>
						<button type="button" className="small" onClick={() => ed.setFocus("paint")}>
							Lines ({s.road.lines?.length ?? 0})
						</button>
					</div>
				)}
			</>
		);
	}
	return (
		<>
			<p className="empty-state">Pick anything on the map to edit it here, or pick a category to work on one kind of thing at a time.</p>
			{/* (the categories here only with the sidebar hidden: it lists them itself) */}
			{s.sidebar ? null : (
				<ul className="list overview" aria-label="Categories">
					{CATEGORY_ORDER.filter((c) => c !== "all").map((c) => (
						<li key={c}>
							<button type="button" className="row-button" onClick={() => ed.setFocus(c)}>
								<span className={`side-icon side-${c}`}>
									<Icon name={CATEGORY_ICONS[c]} />
								</span>
								<span className="row-title">{CATEGORIES[c].label}</span>
								{UNCOUNTED.has(c) ? null : <span className="badge">{countIn(c, s.roads, s.objects, s.layout)}</span>}
							</button>
						</li>
					))}
				</ul>
			)}
		</>
	);
}
