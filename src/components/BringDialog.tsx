import { useState } from "react";
import { useEditor, useEditorState } from "../store/EditorContext";

/** Bringing in a road the track has (its mesh, not described yet): read by the engine as a curve. */
export function BringDialog() {
	const ed = useEditor();
	const bring = useEditorState((s) => s.bring);
	const [filter, setFilter] = useState("");
	if (!bring.open) return null;
	const f = filter.trim().toLowerCase();
	const items = bring.meshes.filter((m) => !f || `${m.name} ${m.model}`.toLowerCase().includes(f));
	return (
		<dialog id="bringbox" open aria-labelledby="bring-title">
			<h2 id="bring-title">Bring in a road</h2>
			<p>
				The track's roads not described yet, the biggest first. Click one: it is read from its mesh (by its rows, as a strip, or a ring in two halves joined end
				to end) as a curve to edit; saved with the rest.
			</p>
			<input
				type="search"
				autoFocus
				aria-label="Filter meshes"
				placeholder="Filter"
				value={filter}
				onChange={(e) => setFilter(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") ed.closeBring();
				}}
			/>
			<ul id="bringlist" className="list">
				{bring.loading && <li>Loading…</li>}
				{!bring.loading && !items.length && <li>none left</li>}
				{items.map((m) => (
					<li key={`${m.model}/${m.name}`}>
						<button type="button" className="row-button" onClick={() => void ed.bringIn(m)}>
							<span className="row-title">
								{m.material} · {Math.round(m.area).toLocaleString()} m²
							</span>
							<span className="row-detail">
								{m.name} in {m.model}
							</span>
						</button>
					</li>
				))}
			</ul>
			<div className="sheet-actions">
				<button type="button" onClick={ed.closeBring}>
					Cancel
				</button>
			</div>
		</dialog>
	);
}
