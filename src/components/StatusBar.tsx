import { geo, lookup } from "../geometry/roads";
import { nearestOn } from "../geometry/samples";
import { useEditorState } from "../store/EditorContext";
import type { EditorState } from "../store/state";
import { roadLabel } from "./RoadList";

/** Where the mouse is along the selected road. */
export function alongText(s: EditorState): string {
	const road = s.roads[s.sel.r];
	const o = road && geo(road, lookup(s.roads));
	if (!o || !s.mouse) return "";
	const n = nearestOn(o, s.mouse[0], s.mouse[1]);
	const off = n.d > 0.05 ? `, ${n.d.toFixed(2)} m off its middle` : "";
	return `${roadLabel(road, s.sel.r)}: s ${n.s.toFixed(2)} m of ${o.length.toFixed(1)}${off}`;
}

/** Where the mouse is (in the world, along the selected road) and the zoom: over the map's foot. */
export function StatusBar() {
	const mouse = useEditorState((s) => s.mouse);
	const along = useEditorState(alongText);
	const ppm = useEditorState((s) => s.view.ppm);
	return (
		<div id="status" className="glass">
			<span>{mouse ? `x ${mouse[0].toFixed(2)}, z ${mouse[1].toFixed(2)}` : "x –, z –"}</span>
			{along ? <span>{along}</span> : null}
			<span>{ppm.toFixed(1)} px/m</span>
		</div>
	);
}
