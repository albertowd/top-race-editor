import { useEffect } from "react";
import type { LineColour } from "../domain/types";
import { type BoxPaint, BRACKET_ARM, isPaint, type LineUpKind, PAINT_PREFIX, paintAt } from "../editing/lineup";
import { useEditor, useEditorShallow } from "../store/EditorContext";
import { Group, NumberField, Row, Segmented } from "./fields";

const POSITIONS: readonly (readonly [LineUpKind, string])[] = [
	["grid", "Grid"],
	["pits", "Pit Boxes"],
];
const PAINT: readonly (readonly [LineUpKind, string])[] = [
	["gridPaint", "Grid Paint"],
	["pitPaint", "Pit Box Paint"],
];

const WHAT: Record<LineUpKind, { many: string; one: string }> = {
	grid: { many: "grid slots", one: "grid slot" },
	pits: { many: "pit boxes", one: "pit box" },
	gridPaint: { many: "grid boxes painted", one: "grid box painted" },
	pitPaint: { many: "pit boxes painted", one: "pit box painted" },
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Grid slots and pit boxes (a layout's), or their paint (every layout's), laid out along a line drawn on the map: how many, in one file or in rows, how far
 * apart, the way they face, leaning; put down when asked. */
export function LiningPanel({ paint = false }: Readonly<{ paint?: boolean }>) {
	const ed = useEditor();
	const { lining, layout, objects } = useEditorShallow((s) => ({
		lining: s.lining,
		layout: s.layout,
		objects: s.objects,
	}));
	const kinds = paint ? PAINT : POSITIONS;
	const mine = kinds.some(([k]) => k === lining.kind);
	useEffect(() => {
		if (!mine) ed.setLining(kinds[0][0]);
	}, [mine, ed, kinds]);
	if (!mine) return null;
	const { kind, plans, lines, drawing } = lining;
	const u = plans[kind];
	const set = (patch: Partial<typeof u>) => ed.setLining(kind, patch);
	const num = (key: "count" | "spacing" | "across" | "lean", min?: number) => (v: number | null) => {
		if (v != null && (min === undefined || v >= min)) set({ [key]: key === "count" ? Math.round(v) : v });
	};
	const box = u.box;
	const setBox = (patch: Partial<BoxPaint>) => box && set({ box: { ...box, ...patch } });
	const { a, b } = lines[kind];
	const length = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
	const ready = !!a && !!b && !drawing && length > 0;
	const { spots, marks } = ready ? ed.lined() : { spots: [], marks: [] };
	const own = objects?.layouts[layout]?.[kind === "pitPaint" ? "pits" : "grid"] ?? [];
	const there = (at: readonly { x: number; z: number; heading: number }[]) =>
		isPaint(kind) && box && objects ? paintAt(objects.marks, at, box, PAINT_PREFIX[kind]).length : 0;
	return (
		<Group id={paint ? "paintlining" : "lining"} title="Lay Out Along a Line" label="Lay Out Along a Line">
			<Segmented label="Laid out" value={kind} options={kinds} onChange={(k) => ed.setLining(k)} />
			<Row label="How many">
				<NumberField label="How many" step={1} value={u.count} onCommit={num("count", 1)} />
			</Row>
			<Row label="In">
				<Segmented
					label="Arrangement"
					value={String(u.rows)}
					options={[
						["1", "One Line"],
						["2", "Rows of 2"],
						["3", "Rows of 3"],
					]}
					onChange={(v) => set({ rows: Number(v) })}
				/>
			</Row>
			{u.rows > 1 ? (
				<>
					<Row label="Across">
						<NumberField label="Metres across, side by side" value={u.across} onCommit={num("across", 0)} />
						<span>m</span>
						<label>
							<input type="checkbox" checked={u.stagger} onChange={(e) => set({ stagger: e.target.checked })} />
							<span>Staggered</span>
						</label>
					</Row>
					<Row label="First on">
						<Segmented
							label="The first of a row on"
							value={u.first}
							options={[
								["left", "Left"],
								["right", "Right"],
							]}
							onChange={(first) => set({ first })}
						/>
					</Row>
				</>
			) : null}
			<Row label={u.rows > 1 ? "Row to row" : "Apart"}>
				<NumberField label="Metres apart along the line" value={u.spacing} onCommit={num("spacing", 0.1)} />
				<span>m</span>
				<label title="Spread them from the line's start to its end">
					<input type="checkbox" checked={u.fit} onChange={(e) => set({ fit: e.target.checked })} />
					<span>Fit to the line</span>
				</label>
			</Row>
			<Row label="Facing">
				<Segmented
					label="Facing"
					value={u.facing}
					options={[
						["back", "The Line's Start"],
						["along", "Along the Line"],
					]}
					onChange={(facing) => set({ facing })}
				/>
			</Row>
			<Row label="Lean">
				<NumberField label="Lean, degrees" step={1} value={u.lean} onCommit={num("lean")} />
				<span title="Each turned off the line: boxes set at a slant">° at a slant</span>
			</Row>
			{box ? (
				<>
					<Row label="Paint">
						<Segmented
							label="Painted"
							value={box.shape}
							options={[
								["bracket", "Bracket"],
								["box", "Box"],
								["open", "Open at the Back"],
								["front", "Front Line"],
							]}
							onChange={(shape) => setBox({ shape })}
						/>
					</Row>
					<Row label="Box">
						<NumberField label="Box width" value={box.width} onCommit={(v) => v != null && v > 0 && setBox({ width: v })} />
						<span>×</span>
						<NumberField label="Box length" value={box.length} onCommit={(v) => v != null && v > 0 && setBox({ length: v })} />
						<span>m</span>
					</Row>
					{box.shape === "bracket" ? (
						<Row label="Ends">
							<NumberField
								label="Bracket's ends, metres back from its front"
								value={box.arm ?? BRACKET_ARM}
								onCommit={(v) => v != null && v > 0 && setBox({ arm: v })}
							/>
							<span>m back</span>
						</Row>
					) : null}
					<Row label="Lines">
						<NumberField label="Lines' width" value={box.line} onCommit={(v) => v != null && v > 0 && setBox({ line: v })} />
						<span>m</span>
						<Segmented
							label="Colour"
							value={box.colour}
							options={
								[
									["white", "White"],
									["yellow", "Yellow"],
								] as const satisfies readonly (readonly [LineColour, string])[]
							}
							onChange={(colour) => setBox({ colour })}
						/>
					</Row>
				</>
			) : null}
			<Row label="Line">
				<button type="button" className={drawing ? "small on" : "small"} aria-pressed={drawing} onClick={() => ed.drawLine(!drawing)}>
					{drawing ? "Drawing…" : a ? "Draw Again" : "Draw the Line"}
				</button>
				<span className="hint">
					{drawing ? (a ? "now click the way the rest go" : `click where the first ${WHAT[kind].one} stands`) : a && b ? `${r2(length)} m` : "not drawn yet"}
				</span>
			</Row>
			<div className="actions">
				<button type="button" className="primary" disabled={!ready} onClick={() => ed.placeLining()}>
					{isPaint(kind) ? `Paint ${ready ? spots.length : u.count} Boxes` : `Place ${ready ? spots.length : u.count} ${cap(WHAT[kind].many)}`}
				</button>
				{isPaint(kind) && own.length ? (
					<button type="button" onClick={() => ed.paintRoundSpots()}>
						Paint Round {layout}'s {own.length}
					</button>
				) : null}
			</div>
			<p className="note">
				{isPaint(kind)
					? `For every layout (paint is the track's): replaces the ${kind === "gridPaint" ? "grid" : "pit box"} paint laid out before where these boxes go${ready ? ` (${there(spots)} marks, with ${marks.length})` : ""}${own.length ? `, or round ${layout}'s own (${there(own)} marks)` : ""}; the paint elsewhere is kept. The positions are the layout's own (Grid, timing & lines).`
					: `Replaces ${layout}'s ${WHAT[kind].many} (and those of the layouts with the same set). Their paint is apart (Paint).`}
			</p>
		</Group>
	);
}

const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
