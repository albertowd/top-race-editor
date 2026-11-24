import { useState } from "react";
import { roadKind } from "../domain/categories";
import { DEFAULT_MATERIAL } from "../domain/constants";
import type { Road } from "../domain/types";
import { useEditor, useEditorShallow } from "../store/EditorContext";
import { Icon } from "./icons";

export const roadTag = (r: Road): string => {
	if (r.along) return "run-off";
	if (r.joins?.some(Boolean)) return "branch";
	return r.fitted ? "fitted" : "curve";
};

/** A road as people see it: what it is and its place in the list (its name is the game's, for the export). */
export const roadLabel = (r: Road, i: number): string => `${roadKind(r)} ${i + 1}`;

/** The roads, to pick one; with what each holds (count: its rumbles or its lines), if asked. */
export function RoadList({ count }: Readonly<{ count?: "kerbs" | "lines" }>) {
	const ed = useEditor();
	const { roads, selected } = useEditorShallow((s) => ({ roads: s.roads, selected: s.sel.r }));
	const [filter, setFilter] = useState("");
	const f = filter.trim().toLowerCase();
	const shown = roads.map((r, i) => ({ r, i })).filter(({ r, i }) => !f || `${roadLabel(r, i)} ${r.name} ${r.material ?? ""}`.toLowerCase().includes(f));
	return (
		<section className="group-box" aria-label="Roads">
			<div className="search">
				<Icon name="search" size={14} />
				<input id="filter" type="search" aria-label="Filter roads" placeholder="Search roads" value={filter} onChange={(e) => setFilter(e.target.value)} />
			</div>
			<ul id="roadlist" className="list" aria-label="Roads">
				{shown.map(({ r, i }) => {
					const n = count ? (r[count]?.length ?? 0) : null;
					return (
						<li key={`${i}:${r.name}`} className={i === selected ? "sel" : undefined}>
							<button type="button" className="row-button" aria-current={i === selected} title={`Exported as ${r.name}`} onClick={() => ed.selectRoad(i, true)}>
								<span className="row-title">
									{roadLabel(r, i)}
									{r.moved ? (
										<span className="edited" title="Changed in shape">
											<span className="sr-only">, changed</span>
										</span>
									) : null}
								</span>
								<span className="row-detail">
									{r.along ? `along ${r.along.side}` : (r.material ?? DEFAULT_MATERIAL)}
									{r.fitted ? " · fitted" : ""}
								</span>
								{n !== null ? <span className="badge">{n}</span> : null}
							</button>
						</li>
					);
				})}
				{shown.length ? null : <li className="empty">No roads match “{filter}”.</li>}
			</ul>
		</section>
	);
}
