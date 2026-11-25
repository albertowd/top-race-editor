import type { RubberWear, Wear } from "../domain/types";
import { useEditor, useEditorState } from "../store/EditorContext";
import { NumberField, Row, SelectField } from "./fields";

/** the cars' width where the track does not say (engine/aiclear.ts's AI_WIDTH: a kart's) */
export const AI_WIDTH = 1.4;

const WEAR: readonly (readonly [Wear, string])[] = [
	["new", "New"],
	["almost_new", "Almost new"],
	["used", "Used"],
	["very_used", "Very used"],
];

const RUBBER: readonly (readonly [RubberWear, string])[] = [
	["almost_new", "Almost new"],
	["used", "Used"],
	["very_used", "Very used"],
];

/** How worn the track looks: its paint (every painting: lines, marks, boxes, start lines); how dark new rubber marks are laid (each its own after), and rubber
 * laid along the layout's racing lines; the cars' width the AI lines (and the rubber laid along them) are made for. Saved with the objects. */
export function WearPanel({ part }: Readonly<{ part: "paint" | "rubber" | "lines" }>) {
	const ed = useEditor();
	const objects = useEditorState((s) => s.objects);
	const layout = useEditorState((s) => s.layout);
	if (!objects) return null;
	const wear = objects.wear ?? {};
	const set = (k: "paint" | "rubber", v: Wear) =>
		ed.changeObjects((d) => {
			d.wear = { ...d.wear, [k]: v };
		});
	if (part === "paint")
		return (
			<Row label="Wear">
				<SelectField label="Paint wear" value={wear.paint ?? "new"} options={WEAR} onChange={(v) => set("paint", v)} />
				<span>paint, the asphalt showing through it the more it is used</span>
			</Row>
		);
	if (part === "rubber") {
		const lines = objects.layouts[layout]?.lines;
		const has = !!(lines?.fast?.curve.length || lines?.pit?.curve.length);
		return (
			<>
				<Row label="New rubber">
					<SelectField
						label="New rubber's darkness"
						value={wear.rubber && wear.rubber !== "new" ? wear.rubber : "used"}
						options={RUBBER}
						onChange={(v) => set("rubber", v)}
					/>
					<span>how dark new rubber marks are laid (each can be changed after)</span>
				</Row>
				<div className="actions">
					<button
						type="button"
						disabled={!has}
						title={
							has
								? `Rubber marks of the track's along ${layout}'s fast line and pit lane line (seen in every layout; laid from them before: replaced)`
								: `${layout || "This layout"} has no racing lines (Grid, timing & lines)`
						}
						onClick={() => ed.rubberFromLines()}
					>
						Lay Rubber Along {layout ? `${layout}'s` : "the"} Racing Lines
					</button>
				</div>
			</>
		);
	}
	return (
		<Row label="Cars">
			<NumberField
				label="Cars' width (m)"
				step={0.1}
				value={objects.ai?.width ?? null}
				placeholder={String(AI_WIDTH)}
				onCommit={(v) =>
					ed.changeObjects((d) => {
						if (v == null) delete d.ai;
						else if (v > 0 && v <= 4) d.ai = { width: v };
					})
				}
			/>
			<span>m wide: the AI lines keep half of it and 0.3 m off the edges and the rumbles' concrete</span>
		</Row>
	);
}
