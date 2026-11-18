import type { CurveNode, Road } from '../domain/types';
import { setHandleLength } from '../editing/curves';
import { EDGE_MAX, edgeAngle, turnEdge } from '../editing/ends';
import { endOf } from '../editing/joints';
import { useEditor, useEditorShallow } from '../store/EditorContext';
import { Group, NumberField, Row } from './fields';
import { roadLabel } from './RoadList';

/** The selected node: where it is, its widths, its handles, its joint. */
export function NodeForm() {
  const ed = useEditor();
  const { roads, road, n } = useEditorShallow((s) => ({ roads: s.roads, road: s.roads[s.sel.r], n: s.sel.n }));
  const nd = road?.curve && n >= 0 ? road.curve[n] : undefined;
  if (!road?.curve || !nd) return null;
  const count = road.curve.length;
  const set = (fn: (nd: CurveNode) => void, shape = true) =>
    ed.change((r) => {
      const node = r.curve?.[n];
      if (node) fn(node);
    }, shape);
  const num = (fn: (nd: CurveNode, v: number) => void) => (v: number | null) => {
    if (v != null) set((x) => fn(x, v));
  };
  const isEnd = endOf(road, n);
  return (
    <Group id="nodeprops" label="Node" title={`Node ${n + 1} of ${count}`}>
      <Row label="x, z">
        <NumberField
          label="x"
          value={nd.p[0]}
          onCommit={num((x, v) => {
            x.p = [v, x.p[1]];
          })}
        />
        <NumberField
          label="z"
          value={nd.p[1]}
          onCommit={num((x, v) => {
            x.p = [x.p[0], v];
          })}
        />
      </Row>
      <Row label="Widths">
        <span>L</span>
        <NumberField
          label="Left width"
          value={nd.left}
          onCommit={num((x, v) => {
            x.left = v;
          })}
        />
        <span>R</span>
        <NumberField
          label="Right width"
          value={nd.right}
          onCommit={num((x, v) => {
            x.right = v;
          })}
        />
      </Row>
      <Row label="Handles">
        <span>in</span>
        <NumberField
          label="Handle in"
          value={Math.hypot(...nd.in)}
          onCommit={num((x, v) => {
            x.in = setHandleLength(x.in, v);
          })}
        />
        <span>out</span>
        <NumberField
          label="Handle out"
          value={Math.hypot(...nd.out)}
          onCommit={num((x, v) => {
            x.out = setHandleLength(x.out, v);
          })}
        />
      </Row>
      <div className="row">
        <span />
        <label>
          <input
            type="checkbox"
            checked={!!nd.corner}
            onChange={(e) =>
              set((x) => {
                if (e.target.checked) x.corner = true;
                else delete x.corner;
              }, false)
            }
          />
          <span>Corner (handles apart)</span>
        </label>
        <button type="button" className="small" onClick={() => ed.smooth(n)}>
          Smooth
        </button>
      </div>
      {isEnd && <EdgeRow road={road} n={n} />}
      {isEnd && (
        <Row label="Joint">
          {nd.joint ? (
            <>
              <span>
                to {jointLabel(roads, nd.joint.road)}'s {nd.joint.node}
              </span>
              <button type="button" className="small" onClick={() => ed.unjoin(n)}>
                Unjoin
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="small"
                title="Bind this end to the nearest other road's end (J)"
                onClick={() => ed.joinNearest(n)}
              >
                Join to the nearest road's end
              </button>
              <span className="hint">the same point, straight on, as wide: no gap</span>
            </>
          )}
        </Row>
      )}
    </Group>
  );
}

/** An end's edge: square to the road, or turned off it (its handle turns it with it). */
function EdgeRow({ road, n }: Readonly<{ road: Road; n: number }>) {
  const ed = useEditor();
  const joined = !!road.curve?.[n]?.joint;
  const angle = Math.round(edgeAngle(road, n) * 10) / 10;
  const turn = (deg: number | null) =>
    ed.change((r) => {
      turnEdge(r, n, deg);
    }, true);
  if (joined)
    return (
      <Row label="Edge">
        <span className="hint">square, as the road it is joined to; turn its handle to turn both</span>
      </Row>
    );
  return (
    <>
      <Row label="Edge">
        <NumberField
          label={`${n === 0 ? 'Start' : 'End'} edge, degrees off square`}
          step={1}
          value={angle}
          onCommit={(v) => turn(v)}
        />
        <span>° off square</span>
        <button
          type="button"
          className="small"
          disabled={angle === 0}
          title="Make the edge square to the road again"
          onClick={() => turn(null)}
        >
          Square
        </button>
      </Row>
      <p className="hint">
        Drag the end's handle to turn the road and its edge with it. Off square: + turns it clockwise, up to {EDGE_MAX}
        °.
      </p>
    </>
  );
}

/** The road a joint is to, as the list shows it. */
function jointLabel(roads: readonly Road[], name: string): string {
  const i = roads.findIndex((r) => r.name === name);
  return i >= 0 ? roadLabel(roads[i], i) : name;
}
