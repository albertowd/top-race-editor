import { useEditor, useEditorState } from "../store/EditorContext";

const KEYS: readonly [string, string][] = [
	[
		"1 to 9, 0, -, =",
		"the categories, in the sidebar’s order: Overview, Roads, Rumbles, Paint, Grid, timing & lines, Light poles, Tyre walls, Cones & boards, Scenery, Buildings, Static objects, Terrain. In one, only its own things can be picked; the rest are shown, dimmed or hidden",
	],
	["\\", "show or hide the sidebar"],
	["Wheel", "zoom at the cursor"],
	["Drag on empty map, right or middle drag, Space + drag", "pan"],
	["Click a road", "select it (its nodes, handles and widths show)"],
	["Drag a node (square)", "move it, its handles with it"],
	[
		"Drag a handle (circle)",
		"turn and stretch the curve; the other handle follows (a smooth node). Alt + drag: a corner. A road's start or end: its edge turns with it",
	],
	["Drag a width diamond (L, R)", "that side's width at the node; Shift: both sides"],
	["Click a line or rumble", "select it (on any road)"],
	["Drag a line or rumble", "slide it along its road, as long as it is"],
	["Drag a line's or rumble's end (triangle)", "where it starts or ends along the road"],
	[
		"A then click on what is picked",
		"a node there (the curve kept); click past an end: it goes on to there. The same for a road, a tyre wall, a fence, a paved area (a corner on its nearest edge) and a racing line",
	],
	["Double click on what is picked", "a node there, as A then click (not on one of its nodes)"],
	["N then click, click…, Enter", "a new road through those points"],
	[
		"J on a road's first or last node",
		"join it to the nearest other road's end (within 20 m): one point, straight on, as wide, no gap between them. Moving either moves both; Unjoin in the node's form",
	],
	["Delete", "the selected node (or line, or rumble), what it is on still selected; Shift+Delete or Delete road: the selected road"],
	["B or Bring in", "a road the track has but the editor not yet, from its mesh"],
	["S", "smooth the selected node's handles (or every node's, with none selected): a road's, a tyre wall's, a fence's, a racing line's"],
	["Dragging a node", "it snaps to another road's end, centre line or edges within 10 pixels (a cyan ring says to what); Ctrl: no snapping"],
	["M then drag", "measure between two points (snapping too)"],
	["C", "check the surface where you look (up to 150 m across): built as the build makes it, every region merged; its seams drawn, any problem ringed red"],
	[
		"Objects (the panel, the Objects layer)",
		"each layout's grid, pit boxes, hotlap start, timing gates, cones and boards, and the track's light poles and tyre walls, saved to the track's objects file for the build to place",
	],
	["Click an object", "pick it (its form shows); drag it to move it, Shift + drag: all of its kind in the layout (a tyre wall: the whole wall)"],
	["Drag the picked object's white handle", "turn it to look that way; Shift: all of its kind turned with it, about it"],
	[
		"O, or Place in the panel, then click",
		"add one of that kind there (a tyre wall picked: a stack at its nearer end); facing as the last of its kind, else along the nearest road",
	],
	[
		"A tyre wall, fence or racing line picked",
		"a curve as a road's: drag its nodes and handles (Alt: a corner), its curve to move it; A or a double click adds a node; S smooths it (or the node picked)",
	],
	[
		"U (Bumps, in Roads)",
		"the roads’ surface bumped by hand: a point of the road picked’s mesh dragged up or down (Shift: finer) or typed, or a brush that raises, lowers or smooths; the build moves the merged floor by them",
	],
	[
		"Marks: O (Marks picked), then drag",
		"a paint mark from where the drag starts to where it ends, then clicks carry it on; its nodes and handles as a tyre wall’s, a node snapping onto another mark’s end (Ctrl: not; Shift: its way by 15°)",
	],
	["Esc", "back to Select, nothing selected"],
	["Ctrl+Z / Ctrl+Y / Ctrl+S", "undo / redo / save"],
];

export function HelpDialog() {
	const ed = useEditor();
	const open = useEditorState((s) => s.helpOpen);
	if (!open) return null;
	return (
		<dialog id="helpbox" open aria-labelledby="help-title">
			<h2 id="help-title">Keys and Mouse</h2>
			<table>
				<tbody>
					{KEYS.map(([what, does]) => (
						<tr key={what}>
							<td>{what}</td>
							<td>{does}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p>
				Left and right are as seen going along the road from its first node. <i>s</i> is how far along the road (metres): lines and rumbles are placed by it. A
				road changed in shape gets its heights again at the next build.
			</p>
			<div className="sheet-actions">
				<button type="button" className="primary" onClick={() => ed.toggleHelp(false)}>
					Done
				</button>
			</div>
		</dialog>
	);
}
