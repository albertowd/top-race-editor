// The terrain's inspector: what is shown, the heights under the mouse, the filters (their rules, the areas drawn), the edits to the ground in their order, the
// brush; saving.

import { useEffect } from "react";
import { Group, NumberField, type Options, Row, Segmented, SelectField, TextField } from "../components/fields";
import type { Vec2 } from "../domain/types";
import { useEditorState } from "../store/EditorContext";
import type { BrushMode } from "./brush";
import { sample } from "./codec";
import { AREA_COLOURS, EDIT_COLOURS } from "./render";
import { ringArea } from "./rings";
import { EDIT_LABELS, type ShownLayer, type TerrainTool, WHY_COLOURS } from "./store";
import { useTerrain, useTerrainShallow, useTerrainState } from "./TerrainContext";
import type { FlatEdit, GridName, TerrainEdit, TerrainFilters } from "./types";

const LAYERS: Options<ShownLayer> = [
	["none", "None"],
	["original", "Original"],
	["filtered", "Filtered"],
	["ground", "Ground"],
	["change", "Edits"],
	["removed", "Taken out"],
];

const LAYER_HINTS: Record<ShownLayer, string> = {
	none: "Only the picture.",
	original: "Every height there is: the tops of trees and roofs too.",
	filtered: "The heights the filters keep as the ground, filled in where they took some out.",
	ground: "The filtered heights with every edit on them: what the track lies on.",
	change: "What the edits change: the ground less the filtered (red up, blue down).",
	removed: "What the filters took out: the original less the filtered (red: higher than the ground).",
};

const CONTOURS: Options<string> = [
	["0", "No contours"],
	["0.25", "Every 0.25 m"],
	["0.5", "Every 0.5 m"],
	["1", "Every 1 m"],
	["2", "Every 2 m"],
	["5", "Every 5 m"],
];

const TOOLS: readonly (readonly [TerrainTool, string, string])[] = [
	["select", "Select", "Pick an area or an edit; drag it, or its points (Shift on a side adds one, Alt on one takes it out)"],
	["ground", "Ground", "Draw an area the filters take as the ground, whatever their rules find"],
	["not_ground", "Not ground", "Draw an area the filters take as not the ground"],
	["flat", "Flat", "Draw a ring the ground is made flat in"],
	["offset", "Raise", "Draw a ring the ground is raised (or lowered) in"],
	["smooth", "Smooth", "Draw a ring the ground is smoothed in"],
	["brush", "Brush", "Paint the ground: raise, lower, smooth or flatten it"],
];

const BRUSH_MODES: Options<BrushMode> = [
	["raise", "Raise"],
	["lower", "Lower"],
	["smooth", "Smooth"],
	["flatten", "Flatten"],
];

const NO_EDITS: readonly TerrainEdit[] = [];
const NO_WHY: Readonly<Record<string, string>> = {};

const fmt = (v: number | undefined, digits = 2) => (v === undefined || Number.isNaN(v) ? "–" : v.toFixed(digits));

/** The terrain's inspector. */
export function TerrainPanel() {
	const t = useTerrain();
	const s = useTerrainShallow((st) => ({ status: st.status, message: st.message, hasDoc: !!st.doc }));
	useEffect(() => {
		if (t.get().status === "idle") void t.load();
	}, [t]);
	if (s.status === "none")
		return <p className="empty-state">This track has no terrain: {s.message}. A new track's wizard makes one from a place's picture and heights.</p>;
	if (!s.hasDoc)
		return (
			<p className="empty-state" role="status">
				{s.status === "error" ? s.message : "Loading the terrain…"}
			</p>
		);
	return (
		<>
			<SaveRow />
			<ToolRow />
			<ShowGroup />
			<MouseGroup />
			<PickedForm />
			<EditsGroup />
			<FiltersGroup />
			<PointsGroup />
		</>
	);
}

function SaveRow() {
	const t = useTerrain();
	const s = useTerrainShallow((st) => ({
		dirty: st.dirty,
		saving: st.saving,
		working: st.working,
		message: st.message,
		undo: st.undo.length,
		redo: st.redo.length,
	}));
	return (
		<>
			<div className="row actions">
				<button type="button" className="small primary" disabled={!s.dirty || s.saving} onClick={() => void t.save()}>
					{s.saving ? "Saving…" : "Save terrain"}
				</button>
				<button type="button" className="small" disabled={!s.undo} onClick={t.undo} title="Undo (Ctrl+Z)">
					Undo
				</button>
				<button type="button" className="small" disabled={!s.redo} onClick={t.redo} title="Redo (Ctrl+Y)">
					Redo
				</button>
			</div>
			<p className="hint terrain-status" role="status">
				{s.working ? "Working it out…" : s.message}
				{s.dirty ? " · not saved" : ""}
			</p>
		</>
	);
}

function ToolRow() {
	const t = useTerrain();
	const tool = useTerrainState((st) => st.tool);
	const drawing = useTerrainState((st) => st.draft?.length ?? 0);
	return (
		<>
			<fieldset className="segmented terrain-tools" aria-label="Terrain tool">
				{TOOLS.map(([v, text, title]) => (
					<button key={v} type="button" aria-pressed={v === tool} title={title} onClick={() => t.setTool(v)}>
						{text}
					</button>
				))}
			</fieldset>
			{tool !== "select" && tool !== "brush" ? (
				<p className="hint">
					Click the ring's points on the map; click its first point again, double-click or press Enter to end it, Esc to drop it.
					{drawing ? ` (${drawing} so far)` : ""}
				</p>
			) : null}
			{tool === "brush" ? <BrushGroup /> : null}
		</>
	);
}

function BrushGroup() {
	const t = useTerrain();
	const b = useTerrainState((st) => st.brush);
	const picked = useTerrainState((st) => (st.pick?.kind === "edit" ? st.doc?.edits[st.pick.i] : undefined));
	return (
		<Group title="Brush">
			<Segmented label="What the brush does" value={b.mode} options={BRUSH_MODES} onChange={(mode) => t.setBrush({ mode })} />
			<Row label="Reach (m)">
				<NumberField label="The brush's reach, metres" value={b.radius} onCommit={(v) => v && v > 0 && t.setBrush({ radius: v })} />
			</Row>
			<Row label="Strength">
				<input
					type="range"
					min={0.02}
					max={1}
					step={0.02}
					value={b.strength}
					aria-label="How much each dab does"
					onChange={(e) => t.setBrush({ strength: Number(e.target.value) })}
				/>
				<span className="dim">{Math.round(b.strength * 100)}%</span>
			</Row>
			{b.mode === "flatten" ? (
				<Row label="To (m)">
					<NumberField label="The height flattening brings the ground to" value={b.target} onCommit={(v) => v !== null && t.setBrush({ target: v })} />
				</Row>
			) : null}
			<p className="hint">
				{picked?.type === "raster"
					? `Painting into “${picked.name}”.`
					: "Painting into a new brushed edit at the end of the list (pick a brushed edit to paint into it)."}{" "}
				Alt-click takes the height under the mouse to flatten to.
			</p>
		</Group>
	);
}

function ShowGroup() {
	const t = useTerrain();
	const show = useTerrainState((st) => st.show);
	const range = useTerrainState((st) => {
		const g = show.layer === "none" || show.layer === "removed" ? null : st.grids[show.layer as GridName];
		return g ? `${fmt(g.lo)} to ${fmt(g.hi)} m` : "";
	});
	return (
		<Group title="Shown">
			<SelectField label="The layer shown" value={show.layer} options={LAYERS} onChange={(layer) => t.setShow({ layer })} />
			<p className="hint">
				{LAYER_HINTS[show.layer]}
				{range ? ` ${range}.` : ""}
			</p>
			<div className="row">
				<label>
					<input type="checkbox" checked={show.relief} onChange={(e) => t.setShow({ relief: e.target.checked })} /> Relief
				</label>
				<label>
					<input type="checkbox" checked={show.colour} onChange={(e) => t.setShow({ colour: e.target.checked })} /> Colour
				</label>
				<label title="The picture of the ground round the track, under the rest">
					<input type="checkbox" checked={show.picture} onChange={(e) => t.setShow({ picture: e.target.checked })} /> Wide picture
				</label>
			</div>
			<Row label="Opacity">
				<input
					type="range"
					min={0}
					max={1}
					step={0.05}
					value={show.opacity}
					aria-label="The layer's opacity"
					onChange={(e) => t.setShow({ opacity: Number(e.target.value) })}
				/>
			</Row>
			<Row label="Relief ×">
				<NumberField
					label="How many times taller the relief makes the ground look"
					value={show.exaggerate}
					onCommit={(v) => v && v > 0 && t.setShow({ exaggerate: v })}
				/>
				<SelectField label="Contour lines" value={String(show.contours)} options={CONTOURS} onChange={(v) => t.setShow({ contours: Number(v) })} />
			</Row>
			<label className="row" title="The terrain under the roads and objects while working on them too">
				<input type="checkbox" checked={show.everywhere} onChange={(e) => t.setShow({ everywhere: e.target.checked })} /> Show in every category
			</label>
		</Group>
	);
}

function MouseGroup() {
	const mouse = useEditorState((s) => s.mouse);
	const grids = useTerrainState((st) => st.grids);
	useTerrainState((st) => st.painted);
	if (!mouse) return null;
	const at = (g: GridName) => {
		const G = grids[g];
		return G ? sample(G, mouse[0], mouse[1]) : Number.NaN;
	};
	const change = at("change");
	return (
		<Group title="At the mouse">
			<table className="kinds terrain-heights">
				<tbody>
					<tr>
						<th scope="row">Original</th>
						<td>{fmt(at("original"))} m</td>
					</tr>
					<tr>
						<th scope="row">Filtered</th>
						<td>{fmt(at("filtered"))} m</td>
					</tr>
					<tr>
						<th scope="row">Ground</th>
						<td>{fmt(at("ground"))} m</td>
					</tr>
					<tr>
						<th scope="row">Edits</th>
						<td>{Number.isNaN(change) ? "0.00" : `${change > 0 ? "+" : ""}${fmt(change)}`} m</td>
					</tr>
				</tbody>
			</table>
		</Group>
	);
}

function FiltersGroup() {
	const t = useTerrain();
	const f = useTerrainState((st) => st.doc?.filters);
	const pick = useTerrainState((st) => st.pick);
	if (!f) return null;
	const num = (k: keyof TerrainFilters, label: string, title: string) => (
		<Row label={label}>
			<NumberField label={title} value={f[k] as number} onCommit={(v) => v !== null && v >= 0 && t.setFilters({ [k]: v } as Partial<TerrainFilters>)} />
		</Row>
	);
	return (
		<Group title="Filters">
			<p className="hint">
				What among the heights is not the ground: the tops of trees and of buildings. Each rule takes out what it finds; the areas drawn say so whatever they
				find.
			</p>
			<h3 className="terrain-sub">Trees in the picture</h3>
			<Row label="Darker than">
				<NumberField
					label="Trees in the picture: darker than"
					value={f.picture_trees.lum}
					onCommit={(v) => v !== null && t.setTreeRule("picture_trees", { lum: v })}
				/>
				<span className="dim">and uneven over</span>
				<NumberField
					label="Trees in the picture: more uneven than"
					value={f.picture_trees.sd}
					onCommit={(v) => v !== null && t.setTreeRule("picture_trees", { sd: v })}
				/>
			</Row>
			<h3 className="terrain-sub">Trees in the photo</h3>
			<Row label="Darker than">
				<NumberField
					label="Trees in the photo: darker than"
					value={f.photo_trees.lum}
					onCommit={(v) => v !== null && t.setTreeRule("photo_trees", { lum: v })}
				/>
				<span className="dim">or uneven over</span>
				<NumberField
					label="Trees in the photo: more uneven than"
					value={f.photo_trees.sd}
					onCommit={(v) => v !== null && t.setTreeRule("photo_trees", { sd: v })}
				/>
			</Row>
			{num("tree_near_m", "Near (m)", "Trees within this many metres count")}
			{num("tree_share", "Tree share", "A height is a tree top where more than this share of the ground near is trees")}
			<h3 className="terrain-sub">Over the ground round it</h3>
			{num("over_m", "Over (m)", "Taken out when this many metres over the lowest round it")}
			{num("opening_m", "Round (m)", "How far round it the lowest is looked for")}
			{num("wide_over_m", "Wide over", "Taken out when this many metres over the lowest of a wider ground round it (woods)")}
			{num("wide_opening_m", "Wide round", "How far round it the lowest of the wide ground is looked for")}
			<h3 className="terrain-sub">Filling in</h3>
			<Row label="Fills (m)">
				<TextField
					label="The distances the heights left are smoothed over, finest first"
					value={f.fills_m.join(", ")}
					onCommit={(v) => {
						const fills = v
							.split(/[\s,]+/)
							.map(Number)
							.filter((n) => n > 0);
						if (fills.length) t.setFilters({ fills_m: fills });
					}}
				/>
			</Row>
			{num("enough_a_cell", "Enough", "Heights a cell enough for a fill to be its own")}
			<h3 className="terrain-sub">Areas drawn</h3>
			{f.areas.length ? (
				<ul className="list" aria-label="Areas">
					{f.areas.map((a, i) => {
						const on = pick?.kind === "area" && pick.i === i;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: areas are kept and edited by their place
							<li key={i} className={on ? "sel" : undefined}>
								<button type="button" className="row-button" aria-current={on} onClick={() => t.pickThing({ kind: "area", i })}>
									<span className="swatch" style={{ background: AREA_COLOURS[a.kind] }} />
									<span className="row-title" title={a.name}>
										{a.name}
									</span>
									<span className="dim">{a.kind === "ground" ? "ground" : "not ground"}</span>
								</button>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="hint">None: choose Ground or Not ground above, then draw one on the map.</p>
			)}
		</Group>
	);
}

const editSummary = (e: TerrainEdit, rasterCells?: number): string => {
	switch (e.type) {
		case "raster":
			return rasterCells ? `${rasterCells.toLocaleString()} cells` : "a raster";
		case "offset":
			return `${e.by > 0 ? "+" : ""}${fmt(e.by)} m`;
		case "flat":
			return e.at ? `at its point ${e.plus ? `${e.plus > 0 ? "+" : ""}${fmt(e.plus)} m` : ""}` : `at ${fmt(e.height)} m`;
		case "smooth":
			return `over ${fmt(e.sigma_m, 1)} m`;
		default:
			return "";
	}
};

function EditsGroup() {
	const t = useTerrain();
	const edits = useTerrainState((st) => st.doc?.edits ?? NO_EDITS);
	const rasters = useTerrainState((st) => st.rasters);
	const pick = useTerrainState((st) => st.pick);
	return (
		<Group title="Edits to the ground">
			<p className="hint">In order: each is made over the ground as those before it left it.</p>
			{edits.length ? (
				<ul className="list" aria-label="Edits">
					{edits.map((e, i) => {
						const on = pick?.kind === "edit" && pick.i === i;
						const r = e.type === "raster" ? rasters[e.file] : undefined;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: edits are kept and edited by their place (their order is theirs)
							<li key={i} className={on ? "sel" : undefined}>
								<div className={e.off ? "terrain-edit-row dim" : "terrain-edit-row"}>
									<input
										type="checkbox"
										checked={!e.off}
										aria-label={`${e.name} on`}
										title="Off: the ground as it is without it"
										onChange={() => t.toggleEdit(i)}
									/>
									<button type="button" className="row-button terrain-edit-pick" aria-current={on} onClick={() => t.pickThing({ kind: "edit", i })}>
										<span className="swatch" style={{ background: EDIT_COLOURS[e.type] }} />
										<span className="row-title" title={e.name}>
											{e.name}
										</span>
										<span className="dim">
											{EDIT_LABELS[e.type]} · {editSummary(e, r ? r.nx * r.nz : undefined)}
										</span>
									</button>
									<button type="button" className="icon-button" aria-label={`Move ${e.name} up`} disabled={i === 0} onClick={() => t.moveEdit(i, -1)}>
										↑
									</button>
									<button
										type="button"
										className="icon-button"
										aria-label={`Move ${e.name} down`}
										disabled={i === edits.length - 1}
										onClick={() => t.moveEdit(i, 1)}
									>
										↓
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			) : (
				<p className="hint">None yet: draw a Flat, Raise or Smooth ring, or paint with the Brush.</p>
			)}
		</Group>
	);
}

/** The area or edit picked: its name and numbers. */
function PickedForm() {
	const t = useTerrain();
	const pick = useTerrainState((st) => st.pick);
	const doc = useTerrainState((st) => st.doc);
	if (!pick || !doc) return null;
	if (pick.kind === "area") {
		const a = doc.filters.areas[pick.i];
		if (!a) return null;
		return (
			<Group
				title={`Area: ${a.name}`}
				actions={
					<button type="button" className="small" onClick={() => t.removeArea(pick.i)}>
						Delete
					</button>
				}
			>
				<Row label="Name">
					<TextField label="The area's name" value={a.name} onCommit={(name) => name && t.setArea(pick.i, { name })} />
				</Row>
				<Segmented
					label="What the area is"
					value={a.kind}
					options={[
						["ground", "Ground"],
						["not_ground", "Not ground"],
					]}
					onChange={(kind) => t.setArea(pick.i, { kind })}
				/>
				<p className="hint">
					{a.ring.length} points, {Math.round(ringArea(a.ring)).toLocaleString()} m². Drag it or its points on the map.
				</p>
			</Group>
		);
	}
	const e = doc.edits[pick.i];
	if (!e) return null;
	const set = (patch: Partial<TerrainEdit>) => t.setEdit(pick.i, patch);
	const n = (label: string, title: string, value: number | undefined, commit: (v: number) => void, min?: number) => (
		<Row label={label}>
			<NumberField label={title} value={value} onCommit={(v) => v !== null && (min === undefined || v >= min) && commit(v)} />
		</Row>
	);
	return (
		<Group
			title={`${EDIT_LABELS[e.type]}: ${e.name}`}
			actions={
				<button type="button" className="small" onClick={() => t.removeEdit(pick.i)}>
					Delete
				</button>
			}
		>
			<Row label="Name">
				<TextField label="The edit's name" value={e.name} onCommit={(name) => name && set({ name })} />
			</Row>
			{e.type === "offset" ? n("By (m)", "Metres the ground is raised by (less than 0: lowered)", e.by, (by) => set({ by })) : null}
			{e.type === "flat" ? <FlatRows e={e} i={pick.i} /> : null}
			{e.type === "smooth" ? n("Over (m)", "Metres the ground is smoothed over (sigma)", e.sigma_m, (sigma_m) => sigma_m > 0 && set({ sigma_m }), 0) : null}
			{e.type !== "raster" ? n("Eases (m)", "Metres out of the ring it eases to nothing over", e.ease_m, (ease_m) => set({ ease_m }), 0) : null}
			{e.type === "raster" ? (
				<p className="hint">Metres added on a grid of its own ({e.file}). Choose the Brush to paint into it.</p>
			) : (
				<p className="hint">{e.ring.length} points. Drag it or its points on the map.</p>
			)}
		</Group>
	);
}

function FlatRows({ e, i }: Readonly<{ e: FlatEdit; i: number }>) {
	const t = useTerrain();
	const set = (patch: Partial<FlatEdit>) => t.setEdit(i, patch);
	const slope: Vec2 = e.slope ?? [0, 0];
	return (
		<>
			<Segmented
				label="How its height is given"
				value={e.at ? "at" : "height"}
				options={[
					["at", "Its point’s height"],
					["height", "A height"],
				]}
				onChange={(how) => t.setFlatHeight(i, how)}
			/>
			{e.at ? (
				<Row label="Plus (m)">
					<NumberField label="Metres over the ground at its point" value={e.plus ?? 0} onCommit={(v) => v !== null && set({ plus: v })} />
				</Row>
			) : (
				<Row label="Height (m)">
					<NumberField label="The track's y it is flat at" value={e.height} onCommit={(v) => v !== null && set({ height: v })} />
				</Row>
			)}
			<Row label="Slope">
				<NumberField label="Slope along x, metres a metre" value={slope[0]} onCommit={(v) => v !== null && set({ slope: [v, slope[1]] })} />
				<NumberField label="Slope along z, metres a metre" value={slope[1]} onCommit={(v) => v !== null && set({ slope: [slope[0], v] })} />
			</Row>
		</>
	);
}

function PointsGroup() {
	const t = useTerrain();
	const s = useTerrainShallow((st) => ({ show: st.show, counts: st.counts, why: st.info?.why ?? NO_WHY }));
	const codes = Object.keys(s.why);
	return (
		<Group title="Heights">
			<label className="row">
				<input type="checkbox" checked={s.show.points} onChange={(e) => t.setShow({ points: e.target.checked })} /> Show each height, coloured by why the
				filters took it out
			</label>
			<table className="kinds terrain-why">
				<tbody>
					{codes.map((k) => (
						<tr key={k}>
							<td>
								<label>
									<input
										type="checkbox"
										checked={s.show.why[k] ?? true}
										aria-label={`Show the heights: ${s.why[k]}`}
										onChange={(e) => t.setShow({ why: { ...s.show.why, [k]: e.target.checked } })}
									/>{" "}
									<span className="swatch" style={{ background: WHY_COLOURS[k] ?? "#fff" }} /> {s.why[k]}
								</label>
							</td>
							<td>{(s.counts[k] ?? 0).toLocaleString()}</td>
						</tr>
					))}
				</tbody>
			</table>
		</Group>
	);
}
