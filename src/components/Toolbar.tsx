import { useEffect, useRef, useState } from "react";
import { CATEGORIES } from "../domain/categories";
import type { LayerName, Mode } from "../domain/types";
import { OBJECT_LABELS } from "../editing/objects";
import { useEditor, useEditorShallow } from "../store/EditorContext";
import { Icon, MODE_ICONS } from "./icons";
import { TrackMenu } from "./TrackMenu";

const MODES: readonly { mode: Mode; label: string; key: string; title: string }[] = [
	{ mode: "select", label: "Select", key: "V", title: "Select and drag" },
	{
		mode: "add",
		label: "Add Node",
		key: "A",
		title: "Add a node on the selected road, or past one of its ends; with a tyre wall, fence, area or racing line picked: on it",
	},
	{ mode: "new", label: "New Road", key: "N", title: "Draw a new road: click its nodes, Enter to finish" },
	{ mode: "measure", label: "Measure", key: "M", title: "Measure between two points" },
	{ mode: "place", label: "Place", key: "O", title: "Click on the map to add one" },
	{
		mode: "bumps",
		label: "Bumps",
		key: "U",
		title: "Bump the roads’ surface by hand: a point of a road’s mesh up or down, or a brush that raises, lowers or smooths",
	},
];

export const LAYERS: readonly [LayerName, string][] = [
	["sat", "Satellite"],
	["ctx", "Track now"],
	["draw", "Drawings"],
	["wire", "Wireframe"],
	["lines", "Lines"],
	["kerbs", "Rumbles"],
	["objects", "Objects"],
	["surface", "Surface check"],
	["names", "Road names"],
];

/** The window's toolbar: where one is and whether it is saved; the category's tools; undo, the view, saving. */
export function Toolbar() {
	const ed = useEditor();
	const { mode, dirty, canUndo, canRedo, focus, place, sidebar, track, status } = useEditorShallow((s) => ({
		mode: s.mode,
		dirty: s.dirty,
		canUndo: s.undo.length > 0,
		canRedo: s.redo.length > 0,
		focus: s.focus,
		place: s.place,
		sidebar: s.sidebar,
		track: s.track?.name,
		status: s.status,
	}));
	const cat = CATEGORIES[focus];
	const modes = MODES.filter((m) => cat.modes.includes(m.mode));
	return (
		<header id="bar">
			<div className="bar-lead">
				<button
					type="button"
					className="icon-button"
					aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
					aria-expanded={sidebar}
					aria-controls="sidebar"
					title={`${sidebar ? "Hide" : "Show"} the sidebar (\\)`}
					onClick={() => ed.toggleSidebar()}
				>
					<Icon name="sidebar" />
				</button>
				<div className="title">
					<TrackMenu name={track ?? "Track"} />
					<output id="state" className={dirty ? "dirty" : undefined}>
						{status}
					</output>
				</div>
			</div>
			<div className="segmented tools" role="toolbar" aria-label="Tools">
				{modes.map((m) => {
					const title = m.mode === "place" ? `Place: click on the map to add a ${OBJECT_LABELS[place].one.toLowerCase()}` : m.title;
					return (
						<button
							key={m.mode}
							type="button"
							aria-pressed={mode === m.mode}
							aria-label={m.label}
							title={`${title} (${m.key})`}
							onClick={() => ed.setMode(m.mode)}
						>
							<Icon name={MODE_ICONS[m.mode]} />
							<span className="tool-label">{m.label}</span>
						</button>
					);
				})}
			</div>
			<div className="bar-trail">
				<div className="pair">
					<button type="button" className="icon-button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={ed.undo}>
						<Icon name="undo" />
					</button>
					<button type="button" className="icon-button" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!canRedo} onClick={ed.redo}>
						<Icon name="redo" />
					</button>
				</div>
				<ViewMenu />
				<button
					type="button"
					className="icon-button"
					title="Build the track for the games: Assetto Corsa, BeamNG.drive"
					aria-label="Build for the games"
					onClick={() => void ed.openBuild()}
				>
					<Icon name="package" />
				</button>
				{/* (the new-track wizard: a page of its own) */}
				<a className="icon-button" href="wizard.html" title="Make a new track: its place, picture and heights" aria-label="New Track">
					<Icon name="globe" />
				</a>
				<button type="button" className="icon-button" title="Keys and mouse (?)" aria-label="Help" onClick={() => ed.toggleHelp()}>
					<Icon name="help" />
				</button>
				<button
					type="button"
					className={dirty ? "primary dirty" : "primary"}
					title="Save to the track's roads and objects (Ctrl+S)"
					onClick={() => void ed.save()}
				>
					Save
				</button>
			</div>
		</header>
	);
}

/** What the map shows: its layers, in a popover. */
function ViewMenu() {
	const ed = useEditor();
	const layers = useEditorShallow((s) => s.layers);
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", away);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("mousedown", away);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);
	return (
		<div className="menu" ref={box}>
			<button
				type="button"
				className="icon-button"
				aria-label="View"
				aria-expanded={open}
				aria-controls="viewmenu"
				title="What the map shows"
				onClick={() => setOpen(!open)}
			>
				<Icon name="view" />
			</button>
			{open ? (
				<fieldset id="viewmenu" className="popover" aria-label="Layers">
					<legend>Show on the Map</legend>
					{LAYERS.map(([name, label]) => (
						<label key={name} className="check">
							<input type="checkbox" checked={layers[name]} onChange={(e) => ed.setLayer(name, e.target.checked)} />
							{label}
						</label>
					))}
				</fieldset>
			) : null}
		</div>
	);
}
