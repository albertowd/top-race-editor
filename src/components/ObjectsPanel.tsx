import { useState } from 'react';
import { OBJECT_COLOURS } from '../canvas/objects';
import { DASH, GAP } from '../domain/constants';
import type { TrackModel } from '../domain/models';
import { kindIcon, type ModelInfo, modelIcon, modelInfo, modelsOf } from '../domain/models';
import type {
  LayoutKind,
  LineColour,
  LineKind,
  LineStyle,
  ModelKind,
  ObjectCollision,
  ObjectFit,
  ObjectKind,
  ObjectPick,
  PaintMark,
  PlacedObject,
  Point,
  Spot,
  StartLineStyle,
  TrackObjects,
} from '../domain/types';
import { areaOf, BAY } from '../editing/areas';
import { isLineKind, keepPitOn, lineOf } from '../editing/lines';
import { markEnd, moveMarkEnd } from '../editing/marks';
import {
  countOf,
  isCurve,
  isLayoutKind,
  isModelKind,
  OBJECT_KINDS,
  OBJECT_LABELS,
  objectsOf,
  positionOf,
  setLayouts,
  sharing,
  spacingOf,
  spotOf,
  wallStacks,
} from '../editing/objects';
import { wallPath } from '../editing/walls';
import { boardText } from '../engine/boardfaces';
import { lightValues, withLightOption } from '../engine/lightoptions';
import { START_GATE } from '../engine/paint';
import { useEditor, useEditorShallow, useEditorState } from '../store/EditorContext';
import { ExportName, Group, NumberField, type Options, Row, SelectField, TextField } from './fields';
import { type IconOption, IconSelect } from './IconSelect';
import { Icon } from './icons';

const DEG = 180 / Math.PI;
/** objects listed at most (a forest's thousands are picked on the map) */
const LISTED = 300;
const kindOptions = <K extends ObjectKind>(kinds: readonly K[]): IconOption<K>[] =>
  kinds.map((k) => ({ value: k, label: OBJECT_LABELS[k].many, icon: kindIcon(k) }));

const metres = (v: number) => `${Math.round(v * 10) / 10} m`;
const modelOptions = (models: readonly ModelInfo[]): IconOption<string>[] =>
  models.map((m) => ({ value: m.id, label: m.label, icon: modelIcon(m.id), hint: `${metres(m.size[1])} high` }));

/** A kind's picture, beside its name (decoration: the name says what it is). */
function KindIcon({ kind, size = 28 }: Readonly<{ kind: ObjectKind; size?: number }>) {
  // (a racing line: a stroke of its colour on the map)
  if (isLineKind(kind))
    return (
      <span
        className="kind-icon"
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          background: `linear-gradient(135deg, transparent 44%, ${OBJECT_COLOURS[kind]} 44%, ${OBJECT_COLOURS[kind]} 56%, transparent 56%)`,
        }}
      />
    );
  return <img className="kind-icon" src={kindIcon(kind)} alt="" width={size} height={size} />;
}

/** The objects of some kinds (default: all): the layout shown, each kind's count and placing it, their list, a
 * layout's set copied from another's. */
export function ObjectsPanel({ kinds = OBJECT_KINDS }: Readonly<{ kinds?: readonly ObjectKind[] }>) {
  const ed = useEditor();
  const { objects, layout, mode, place, models, together, seeded, shown } = useEditorShallow((s) => ({
    objects: s.objects,
    layout: s.layout,
    mode: s.mode,
    place: s.place,
    models: s.models,
    together: s.together,
    seeded: s.objectsSeeded,
    shown: s.layers.objects,
  }));
  if (!objects) return <p className="empty-state">The track has no objects to edit.</p>;
  const layouts: Options<string> = Object.keys(objects.layouts).map((l) => [l, l] as const);
  const perLayout = kinds.filter(isLayoutKind);
  return (
    <section id="objects" className="group-box" aria-label="Objects">
      {seeded ? <p className="note">Read from the track's models: no objects file yet, saving writes one.</p> : null}
      {perLayout.length ? (
        <Row label="Layout">
          <SelectField label="Layout" value={layout} options={layouts} onChange={ed.setLayout} />
          <LayoutButtons />
          <label title="Also change every other layout whose set of that kind is the same as this one's">
            <input type="checkbox" checked={together} onChange={(e) => ed.setTogether(e.target.checked)} /> with the
            same
          </label>
        </Row>
      ) : null}
      <RoutingBox />
      <table className="items kinds" aria-label="Object kinds">
        <tbody>
          {kinds.map((k) => {
            const on = mode === 'place' && place === k;
            const same = together ? sharing(objects, layout, k) : [];
            const choices = isModelKind(k) ? modelsOf(k) : [];
            return (
              <tr key={k} className={on ? 'sel' : undefined}>
                <td className="icon-cell">
                  <KindIcon kind={k} />
                </td>
                <td className="count">{countOf(objects, layout, k)}</td>
                <td title={OBJECT_LABELS[k].what}>
                  {OBJECT_LABELS[k].many}
                  {isModelKind(k) && kinds.length > 1 ? (
                    <span className="dim">
                      {k === 'cones' || k === 'boards' ? ' · this layout' : ' · every layout'}
                    </span>
                  ) : (
                    ''
                  )}
                </td>
                {isLineKind(k) ? (
                  <td>
                    <button
                      type="button"
                      className="small"
                      title={`Make the ${OBJECT_LABELS[k].one.toLowerCase()} along roads: click them in order`}
                      onClick={() => ed.startRouting(k)}
                    >
                      From roads
                    </button>
                  </td>
                ) : choices.length > 1 && isModelKind(k) ? (
                  <td>
                    <IconSelect
                      label={`${OBJECT_LABELS[k].one} to place`}
                      value={models[k]}
                      options={modelOptions(choices)}
                      onChange={(id) => ed.placeModel(k, id)}
                    />
                  </td>
                ) : (
                  <td className="dim" title={same.join(', ')}>
                    {same.length ? `same in ${same.length}` : ''}
                  </td>
                )}
                <td>
                  <button
                    type="button"
                    className={on ? 'small on' : 'small'}
                    aria-pressed={on}
                    title={`Click on the map to add ${OBJECT_LABELS[k].one.toLowerCase()}s (O)`}
                    onClick={() => (on ? ed.setMode('select') : ed.setPlace(k))}
                  >
                    {on ? 'Placing' : 'Place'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {kinds.includes('grid') && kinds.includes('pits') ? (
        <RaceKarts grid={countOf(objects, layout, 'grid')} pits={countOf(objects, layout, 'pits')} />
      ) : null}
      {/* (the start lines with the paint, as the grid's and pits' paint: every layout's at once) */}
      {kinds.includes('marks') ? <StartLines objects={objects} /> : null}
      {shown ? null : <p className="note">The Objects layer is off (View menu).</p>}
      {perLayout.length ? <CopyRow objects={objects} layout={layout} kinds={perLayout} /> : null}
    </section>
  );
}

/** Every layout's start line, set here with the paint (each is painted on the track, seen in every layout): its
 * style, and where it is painted (along its start and finish gate; without one, ahead of its grid's first slot). */
function StartLines({ objects }: Readonly<{ objects: TrackObjects }>) {
  const ed = useEditor();
  return (
    <table className="items" aria-label="Start lines">
      <caption>Start lines (every layout's, all painted on the track)</caption>
      <tbody>
        {Object.entries(objects.layouts).map(([name, lay]) => {
          const gate = lay.timing?.some((t) => t.name === START_GATE);
          return (
            <tr key={name}>
              <td>{name}</td>
              <td>
                <SelectField
                  label={`Start line of ${name}`}
                  value={lay.start_line ?? 'none'}
                  options={START_LINES}
                  onChange={(v) => ed.setStartLine(v === 'none' ? null : v, name)}
                />
              </td>
              <td className="dim">
                {gate
                  ? `along its gate ${START_GATE}`
                  : lay.grid?.length
                    ? 'ahead of its first grid slot'
                    : 'no gate, no grid'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** a layout's start line, as painted along its start and finish gate */
const START_LINES: Options<StartLineStyle | 'none'> = [
  ['none', 'none'],
  ['checker', 'chequered'],
  ['line', 'a solid white line'],
];

/** How many karts a race of the layout takes in the game: one for each grid slot with a pit box too (the export sets
 * it so). */
function RaceKarts({ grid, pits }: Readonly<{ grid: number; pits: number }>) {
  const karts = Math.min(grid, pits);
  const why =
    grid === pits
      ? ''
      : grid > pits
        ? ` (${grid - pits} grid slots without a pit box)`
        : ` (${pits - grid} pit boxes spare)`;
  return (
    <p className="note">
      A race here takes {karts} karts{why}.
    </p>
  );
}

/** The object picked, if it is one. */
const placedOf = (o: TrackObjects, kind: ObjectKind, i: number): PlacedObject | undefined =>
  isModelKind(kind) ? o.objects[i] : undefined;

/** Its number among its kind in the layout (an object: i is its place in the whole list). */
const numberOf = (o: TrackObjects, layout: string, kind: ObjectKind, i: number) =>
  isModelKind(kind) ? objectsOf(o, layout, kind).indexOf(i) + 1 : i + 1;

/** What an object is called in the list: its kind and number (a board: what it says, as its name tells; the rest:
 * the model it is, where its kind has more than one). */
function itemLabel(o: TrackObjects, layout: string, kind: ObjectKind, i: number): string {
  const one = OBJECT_LABELS[kind].one;
  if (kind === 'hotlap') return one;
  if (isLineKind(kind)) {
    const line = lineOf(o.layouts[layout], kind);
    return line ? `${one} · ${line.curve.length} nodes` : one;
  }
  const n = numberOf(o, layout, kind, i);
  const placed = placedOf(o, kind, i);
  if (placed && kind === 'boards')
    return `${one} ${n} · ${placed.name
      .replace(/^BOARD_/, '')
      .replaceAll('_', ' ')
      .toLowerCase()}`;
  if (placed && isModelKind(kind) && modelsOf(kind).length > 1)
    return `${one} ${n} · ${(modelInfo(placed.model)?.label ?? placed.model).toLowerCase()}`;
  if (placed && isCurve(placed)) return `${one} ${n} · ${placed.curve.length} nodes`;
  return `${one} ${n}`;
}

/** Every object of the kinds (in the layout shown, for a layout's own), to pick one: the map going to it. */
export function ObjectList({ kinds }: Readonly<{ kinds: readonly ObjectKind[] }>) {
  const ed = useEditor();
  const { objects, layout, picked } = useEditorShallow((s) => ({
    objects: s.objects,
    layout: s.layout,
    picked: s.obj,
  }));
  if (!objects) return null;
  const items: { kind: ObjectKind; i: number }[] = kinds.flatMap((kind): { kind: ObjectKind; i: number }[] =>
    isModelKind(kind)
      ? objectsOf(objects, layout, kind).map((i) => ({ kind, i }))
      : Array.from({ length: countOf(objects, layout, kind) }, (_, i) => ({ kind, i })),
  );
  if (!items.length) return <p className="empty-state">None yet: choose Place, then click on the map.</p>;
  // (a forest's thousands not listed: the first LISTED, the rest picked on the map)
  const shown = items.slice(0, LISTED);
  const pick = (kind: ObjectKind, i: number) => {
    const p: ObjectPick = { kind, i, j: -1 };
    ed.selectObject(p);
    const at = positionOf(objects, layout, p);
    if (at) ed.set({ view: { ...ed.get().view, cx: at.x, cz: at.z } });
  };
  return (
    <>
      <ul className="list objects-list" aria-label="Placed">
        {shown.map(({ kind, i }) => {
          const on = picked?.kind === kind && picked.i === i;
          return (
            <li key={`${kind}:${i}`} className={on ? 'sel' : undefined}>
              <button type="button" className="row-button" aria-current={on} onClick={() => pick(kind, i)}>
                <img
                  className="kind-icon"
                  src={modelIconOf(objects, kind, i) ?? kindIcon(kind)}
                  alt=""
                  width={24}
                  height={24}
                  loading="lazy"
                />
                <span className="row-title">{itemLabel(objects, layout, kind, i)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > shown.length ? (
        <p className="note">{items.length - shown.length} more not listed: pick them on the map.</p>
      ) : null}
    </>
  );
}

const modelIconOf = (o: TrackObjects, kind: ObjectKind, i: number): string | undefined => {
  const placed = placedOf(o, kind, i);
  return placed && modelIcon(placed.model);
};

function CopyRow({
  objects,
  layout,
  kinds,
}: Readonly<{ objects: TrackObjects; layout: string; kinds: readonly LayoutKind[] }>) {
  const ed = useEditor();
  const [chosenKind, setKind] = useState<LayoutKind>(kinds[0]);
  const [chosen, setFrom] = useState('');
  const others: Options<string> = Object.keys(objects.layouts)
    .filter((l) => l !== layout)
    .map((l) => [l, l] as const);
  if (!others.length) return null;
  const kind = kinds.includes(chosenKind) ? chosenKind : kinds[0];
  const from = others.some(([l]) => l === chosen) ? chosen : others[0][0];
  return (
    <details className="copy">
      <summary>Copy from another layout</summary>
      <Row label="Kind">
        <IconSelect label="Kind to copy" value={kind} options={kindOptions(kinds)} onChange={setKind} />
      </Row>
      <Row label="From">
        <SelectField label="Layout to copy from" value={from} options={others} onChange={setFrom} />
        <button
          type="button"
          className="small"
          title={`Make ${layout}'s set the same as the other layout's`}
          onClick={() => ed.copyFrom(from, kind)}
        >
          Copy
        </button>
      </Row>
    </details>
  );
}

const ORDERED: readonly ObjectKind[] = ['grid', 'pits', 'timing', 'boards', 'poles', 'tyres', 'marks'];

const SINGLE: readonly ObjectCollision[] = ['none', 'static', 'dynamic', 'model'];
const ALONG: readonly ObjectCollision[] = ['none', 'wall'];
const COLLISION_LABELS: Record<ObjectCollision, string> = {
  none: 'none',
  static: 'a box round it',
  dynamic: 'knocked about (physics)',
  wall: 'a wall along it',
  model: 'its own walls and floors',
};
const FIT_LABELS: Record<ObjectFit, string> = { place: 'upright copies along it', bend: 'bent along it' };

/** The object picked: where it is, the way it looks, its name, its place in its list. */
export function ObjectForm() {
  const ed = useEditor();
  const { objects, layout, obj } = useEditorShallow((s) => ({ objects: s.objects, layout: s.layout, obj: s.obj }));
  if (!objects || !obj) return null;
  const label = OBJECT_LABELS[obj.kind];
  const count = countOf(objects, layout, obj.kind);
  const spot = spotOf(objects, layout, obj);
  const change = (fn: (o: TrackObjects) => void) => ed.changeObjects(fn, obj.kind);
  const same = isLayoutKind(obj.kind) && ed.get().together ? sharing(objects, layout, obj.kind) : [];
  return (
    <Group
      id="objectprops"
      label={label.one}
      title={`${label.one}${obj.kind === 'hotlap' || isLineKind(obj.kind) ? '' : ` ${numberOf(objects, layout, obj.kind, obj.i)} of ${count}`}${isLayoutKind(obj.kind) || isLineKind(obj.kind) ? ` — ${layout}` : ''}`}
      actions={
        <button
          type="button"
          className="icon-button"
          title="Delete it (Delete)"
          aria-label="Delete"
          onClick={() => ed.deleteObject()}
        >
          <Icon name="trash" />
        </button>
      }
    >
      {spot ? <SpotRows spot={spot} pick={obj} change={change} /> : null}
      {isModelKind(obj.kind) ? <ObjectRows objects={objects} layout={layout} pick={obj} change={change} /> : null}
      {obj.kind === 'timing' ? <GateRows objects={objects} layout={layout} pick={obj} change={change} /> : null}
      {obj.kind === 'marks' ? <MarkRows objects={objects} pick={obj} change={change} /> : null}
      {isLineKind(obj.kind) ? <LineRows objects={objects} layout={layout} pick={obj} change={change} /> : null}
      {obj.kind === 'areas' ? <AreaRows objects={objects} layout={layout} pick={obj} change={change} /> : null}
      {ORDERED.includes(obj.kind) ? (
        <Row label="Order">
          <button type="button" className="small" title="Earlier in its list" onClick={() => ed.reorder(-1)}>
            Earlier
          </button>
          <button type="button" className="small" title="Later in its list" onClick={() => ed.reorder(1)}>
            Later
          </button>
        </Row>
      ) : null}
      {same.length ? <p className="note">Changes go to {same.join(', ')} too (the same set).</p> : null}
      {spot || (placedOf(objects, obj.kind, obj.i) && !isCurve(placedOf(objects, obj.kind, obj.i) as PlacedObject)) ? (
        <p className="note">Drag to move it, Shift+drag to move all of them; drag the white handle to turn it.</p>
      ) : null}
    </Group>
  );
}

type Change = (fn: (o: TrackObjects) => void) => void;

/** The model a placed thing is: another of its kind chosen (and placing goes on with it). */
function ModelRow({ kind, model }: Readonly<{ kind: ModelKind; model: string | undefined }>) {
  const ed = useEditor();
  const choices = modelsOf(kind);
  const info = model ? modelInfo(model) : undefined;
  return (
    <>
      <Row label="Model">
        {choices.length > 1 ? (
          <IconSelect label="Model" value={model ?? ''} options={modelOptions(choices)} onChange={ed.setModel} />
        ) : (
          <span>{info?.label ?? model}</span>
        )}
      </Row>
      {info ? (
        <p className="note">
          {metres(info.size[0])} across, {metres(info.size[2])} deep, {metres(info.size[1])} high (models/{info.file})
        </p>
      ) : null}
    </>
  );
}

function PointRows({ label, at, set }: Readonly<{ label: string; at: Point; set: (k: 'x' | 'z', v: number) => void }>) {
  return (
    <Row label={label}>
      <NumberField label={`${label} x`} value={at.x} onCommit={(v) => v != null && set('x', v)} />
      <NumberField label={`${label} z`} value={at.z} onCommit={(v) => v != null && set('z', v)} />
    </Row>
  );
}

function SpotRows({ spot, pick, change }: Readonly<{ spot: Spot; pick: ObjectPick; change: Change }>) {
  const ed = useEditor();
  const layout = ed.get().layout;
  const edit = (fn: (s: Spot) => void) =>
    change((o) => {
      const s = spotOf(o, layout, pick);
      if (s) fn(s);
    });
  const name =
    spot.name === undefined ? null : (
      <ExportName
        value={spot.name}
        onCommit={(v) =>
          v &&
          edit((s) => {
            s.name = v;
          })
        }
      />
    );
  return (
    <>
      <PointRows
        label="x, z"
        at={spot}
        set={(k, v) =>
          edit((s) => {
            s[k] = v;
          })
        }
      />
      <Row label="Heading">
        <NumberField
          label="Heading (degrees)"
          step={1}
          value={Math.round(spot.heading * DEG * 10) / 10}
          onCommit={(v) =>
            v != null &&
            edit((s) => {
              s.heading = Math.atan2(Math.sin(v / DEG), Math.cos(v / DEG));
            })
          }
        />
        <span>° from north (+z), towards +x</span>
      </Row>
      {name}
    </>
  );
}

interface PartProps {
  objects: TrackObjects;
  layout: string;
  pick: ObjectPick;
  change: Change;
}

/** The layout shown: another made from it, it renamed, or it taken away (a name typed in its own field). */
function LayoutButtons() {
  const ed = useEditor();
  const [naming, setNaming] = useState<'new' | 'rename' | null>(null);
  const [error, setError] = useState('');
  const layout = useEditorState((s) => s.layout);
  const done = (name: string) => {
    const bad = naming === 'new' ? ed.newLayout(name.trim()) : ed.renameShownLayout(name.trim());
    if (bad) setError(bad);
    else {
      setNaming(null);
      setError('');
    }
  };
  return (
    <>
      <button type="button" className="small" title="A new layout made as this one is" onClick={() => setNaming('new')}>
        New
      </button>
      <button type="button" className="small" title="Rename this layout" onClick={() => setNaming('rename')}>
        Rename
      </button>
      <button type="button" className="small" title="Take this layout away" onClick={ed.removeShownLayout}>
        Remove
      </button>
      {naming ? (
        <span className="layout-name">
          <TextField
            label={naming === 'new' ? `New layout's name (made as ${layout})` : `${layout}'s new name`}
            value={naming === 'new' ? '' : layout}
            placeholder={naming === 'new' ? `${layout}_2` : undefined}
            onCommit={done}
          />
          <button type="button" className="small" onClick={() => setNaming(null)}>
            Cancel
          </button>
          {error ? <span className="error">{error}</span> : null}
        </span>
      ) : null}
    </>
  );
}

/** A paved area: its material, its corners and size; how it is shaped. */
function AreaRows({ objects, pick, change }: Readonly<PartProps>) {
  const ed = useEditor();
  const materials = useEditorState((s) => s.track?.materials ?? []);
  const [bay, setBay] = useState(BAY[0]);
  const [depth, setDepth] = useState(BAY[1]);
  const a = objects.areas?.[pick.i];
  if (!a) return null;
  const options: Options<string> = [...new Set([a.material, ...materials])].map((m) => [m, m] as const);
  return (
    <>
      <Row label="Material">
        <SelectField
          label="Material"
          value={a.material}
          options={options}
          onChange={(m) =>
            change((o) => {
              const x = o.areas?.[pick.i];
              if (x) x.material = m;
            })
          }
        />
      </Row>
      <Row label="Corners">{a.points.length}</Row>
      <Row label="Size">{Math.round(areaOf(a.points))} m²</Row>
      <Row label="Parking bays">
        <NumberField label="Bay width (m)" value={bay} onCommit={(v) => v && v > 0 && setBay(v)} />
        <NumberField label="Bay depth (m)" value={depth} onCommit={(v) => v && v > 0 && setDepth(v)} />
        <button
          type="button"
          className="small"
          title="Paint a row of parking bays along its longest edge (again: made anew)"
          onClick={() => ed.parkArea(bay, depth)}
        >
          Paint bays
        </button>
      </Row>
      <p className="note">
        Drag a corner, or the whole; with it picked, Add Node (A) or a double click on an edge adds a corner; Delete
        takes the picked corner away. It is laid as a road's asphalt; paint marks (Paint) go on it.
      </p>
    </>
  );
}

/** A racing line being made from roads: the roads clicked, in order; made, or not. */
function RoutingBox() {
  const ed = useEditor();
  const routing = useEditorState((s) => s.routing);
  if (!routing) return null;
  const what = routing.kind === 'fast' ? 'lap' : 'pit lane';
  return (
    <section className="routing" aria-label="Line from roads">
      <p className="note">
        Click the roads the {what} runs on, in order; click the last again to take it off.
        {routing.kind === 'pit' ? ' Its ends fork off and merge into the fast line where they meet it.' : ''}
      </p>
      <p>{routing.roads.length ? routing.roads.join(' → ') : 'No roads yet.'}</p>
      <Row label="">
        <button type="button" className="small primary" disabled={!routing.roads.length} onClick={ed.makeRouted}>
          Make the line
        </button>
        <button type="button" className="small" onClick={ed.cancelRouting}>
          Cancel
        </button>
      </Row>
    </section>
  );
}

/** A racing line: how long, its nodes; the pit line's fork and merge (metres along the fast line), typed or dragged
 * along it. */
function LineRows({ objects, layout, pick, change }: Readonly<PartProps>) {
  const lay = objects.layouts[layout];
  const kind = pick.kind as LineKind;
  const line = lineOf(lay, kind);
  if (!line) return null;
  const length = wallPath(line, 0.5).length;
  const fast = lay?.lines?.fast;
  const lap = fast ? wallPath(fast, 0.5).length : 0;
  const set = (k: 'leaves' | 'joins') => (v: number | null) =>
    change((o) => {
      const lines = o.layouts[layout]?.lines;
      const pit = lines?.pit;
      if (!pit || !lap || v === null) return;
      pit[k] = Math.round((((v % lap) + lap) % lap) * 1000) / 1000;
      keepPitOn(lines);
    });
  return (
    <>
      <Row label="Length">{metres(length)}</Row>
      <Row label="Nodes">{line.curve.length}</Row>
      {kind === 'pit' ? (
        <>
          <Row label="Leaves at">
            <NumberField label="Leaves at (m along the fast line)" value={line.leaves ?? 0} onCommit={set('leaves')} />
          </Row>
          <Row label="Joins at">
            <NumberField label="Joins at (m along the fast line)" value={line.joins ?? 0} onCommit={set('joins')} />
          </Row>
        </>
      ) : null}
      <p className="note">
        {kind === 'fast'
          ? 'Drag a node or its handles; Place adds a node where you click (on the line: there, keeping its shape). Its first node is on the start line.'
          : 'Drag the diamonds along the fast line to move where it leaves and joins it; its nodes between as the fast line’s. Place adds a node.'}
      </p>
    </>
  );
}

function GateRows({ objects, layout, pick, change }: Readonly<PartProps>) {
  const g = objects.layouts[layout]?.timing[pick.i];
  if (!g) return null;
  const set = (side: 'left' | 'right') => (k: 'x' | 'z', v: number) =>
    change((o) => {
      const q = o.layouts[layout]?.timing[pick.i]?.[side];
      if (q) q[k] = v;
    });
  return (
    <>
      <PointRows label="Left" at={g.left} set={set('left')} />
      <PointRows label="Right" at={g.right} set={set('right')} />
      <Row label="Width">{Math.hypot(g.right.x - g.left.x, g.right.z - g.left.z).toFixed(2)} m</Row>
      <details className="export">
        <summary>Export name</summary>
        <p className="hint">AC_TIME_{pick.i}: named by its place (Earlier, Later).</p>
      </details>
    </>
  );
}

/** A light of a model as people read it: which, how far down it looks, and which way (none: all round, a lamp). */
function lightText(l: NonNullable<TrackModel['lights']>[number]): string {
  if (!l.facing) return `${l.series}: all round`;
  const [r, y, f] = l.facing;
  const down = Math.round((Math.asin(Math.max(-1, Math.min(1, -y))) * 180) / Math.PI);
  if (Math.hypot(r, f) < 0.2) return `${l.series}: straight down`;
  const side = Math.round((Math.atan2(r, f) * 180) / Math.PI);
  const way = Math.abs(side) < 5 ? 'along its heading' : `${Math.abs(side)}° to its ${side > 0 ? 'right' : 'left'}`;
  return `${l.series}: ${down}° down, ${way}`;
}

/** An object picked (one of a model, or copies of it along a curve): its model and what the track says of it (its
 * lights), where it is and the way it looks (one) or its curve, what is hit of it, its layouts, its name. */
function ObjectRows({ objects, layout, pick, change }: Readonly<PartProps>) {
  const catalogue = useEditorState((s) => s.catalogue);
  const it = objects.objects[pick.i];
  if (!it || !isModelKind(pick.kind)) return null;
  const kind = pick.kind;
  const edit = (fn: (t: PlacedObject) => void) =>
    change((o) => {
      const t = o.objects[pick.i];
      if (t) fn(t);
    });
  const curve = isCurve(it);
  const track = catalogue?.[it.model];
  // (its own walls and floors only where its catalogue's model has them: a building's)
  const allowed = (curve ? ALONG : SINGLE).filter(
    (c) =>
      c === it.collision ||
      (c === 'model' ? !!track?.collision?.includes('model') : !track?.collision || track.collision.includes(c)),
  );
  const fits = (track?.fits ?? (kind === 'fences' ? ['place', 'bend'] : ['place'])) as ObjectFit[];
  const n = it.curve[0];
  return (
    <>
      <ModelRow kind={kind} model={it.model} />
      {track?.description ? <p className="note">{track.description}</p> : null}
      {kind === 'boards' ? (
        <Row label="Text">
          <TextField
            label="What its card says"
            value={it.text ?? ''}
            placeholder={boardText(it.name) || 'nothing: a blank card'}
            onCommit={(v) =>
              edit((t) => {
                if (v) t.text = v.slice(0, 40);
                else delete t.text;
              })
            }
          />
          <span>drawn as large as fits the card; | breaks a line (none: its name's)</span>
        </Row>
      ) : null}
      {track?.lights?.length ? <LightRows lights={track.lights} it={it} edit={edit} /> : null}
      {!curve && n ? (
        <>
          <PointRows
            label="x, z"
            at={{ x: n.p[0], z: n.p[1] }}
            set={(k, v) =>
              edit((t) => {
                const m = t.curve[0];
                if (m) m.p[k === 'x' ? 0 : 1] = v;
              })
            }
          />
          <Row label="Heading">
            <NumberField
              label="Heading (degrees)"
              step={1}
              value={Math.round((it.heading ?? 0) * DEG * 10) / 10}
              onCommit={(v) =>
                v != null &&
                edit((t) => {
                  t.heading = Math.atan2(Math.sin(v / DEG), Math.cos(v / DEG));
                })
              }
            />
            <span>° from north (+z), towards +x</span>
          </Row>
        </>
      ) : null}
      {curve ? <CurveRows it={it} pick={pick} edit={edit} /> : null}
      <Row label="Hit">
        <SelectField
          label="Collision"
          value={it.collision}
          options={allowed.map((c) => [c, COLLISION_LABELS[c]] as const)}
          onChange={(v) =>
            edit((t) => {
              t.collision = v;
            })
          }
        />
      </Row>
      {curve && fits.length > 1 ? (
        <Row label="Fit">
          <SelectField
            label="Fit"
            value={it.fit ?? 'place'}
            options={fits.map((f) => [f, FIT_LABELS[f]] as const)}
            onChange={(v) =>
              edit((t) => {
                t.fit = v;
              })
            }
          />
        </Row>
      ) : null}
      <Row label="Scale">
        {(['across', 'up', 'deep'] as const).map((axis, k) => (
          <NumberField
            key={axis}
            label={`Scale ${axis}`}
            step={0.05}
            value={it.scale?.[k] ?? 1}
            onCommit={(v) =>
              v != null &&
              v > 0 &&
              edit((t) => {
                const s: [number, number, number] = [...(t.scale ?? [1, 1, 1])];
                s[k] = v;
                if (s.every((x) => x === 1)) delete t.scale;
                else t.scale = s;
              })
            }
          />
        ))}
        <span>across, up, deep (1: as the model is)</span>
      </Row>
      <LayoutRows objects={objects} layout={layout} it={it} edit={edit} />
      <ExportName
        value={it.name}
        onCommit={(v) =>
          v &&
          edit((t) => {
            t.name = v;
          })
        }
      />
    </>
  );
}

const hex2 = (v: number) =>
  Math.round(Math.min(Math.max(v, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');
/** A colour (red, green, blue: 0 to 1) as a colour field has it (#rrggbb), and back (to a thousandth). */
const toHex = (c: readonly number[]) => `#${c.map(hex2).join('')}`;
const fromHex = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => Math.round((Number.parseInt(h.slice(i, i + 2), 16) / 255) * 1000) / 1000) as [
    number,
    number,
    number,
  ];

/** A colour picked: given once picking is done (the field left), only if it is another colour. */
function ColourField({
  label,
  value,
  onCommit,
}: Readonly<{ label: string; value: readonly number[]; onCommit: (c: [number, number, number]) => void }>) {
  const shown = toHex(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const now = editing ? text : shown;
  return (
    <input
      type="color"
      aria-label={label}
      title={label}
      value={now}
      onChange={(e) => {
        setEditing(true);
        setText(e.target.value);
      }}
      onBlur={() => {
        setEditing(false);
        if (text.toLowerCase() !== shown) onCommit(fromHex(text));
      }}
    />
  );
}

/** The lights of the object's model, as the object has them: each lit or not, its strength, reach and colour its
 * series' (the track's source/lights.json) unless changed here; a value emptied: its series' again. Only what is
 * changed is kept on the object. */
function LightRows({
  lights,
  it,
  edit,
}: Readonly<{
  lights: NonNullable<TrackModel['lights']>;
  it: PlacedObject;
  edit: (fn: (t: PlacedObject) => void) => void;
}>) {
  const series = useEditorState((s) => s.lightSeries);
  const set = (k: number, change: Parameters<typeof withLightOption>[2]) =>
    edit((t) => {
      const next = withLightOption(t.lights, k, change, series[lights[k]?.series ?? '']);
      if (next) t.lights = next;
      else delete t.lights;
    });
  return (
    <fieldset className="lights-of">
      <legend>Lights</legend>
      {lights.map((l, k) => {
        const own = it.lights?.[String(k)];
        const v = lightValues(series[l.series], own);
        const name = `Light ${k + 1}`;
        return (
          <div key={`${l.series}:${l.at.join(',')}`} className="light">
            <label title="Lit at night (off: not lit, in every game)">
              <input type="checkbox" checked={v.on} onChange={(e) => set(k, { on: e.target.checked })} /> {lightText(l)}
            </label>
            {v.on ? (
              <Row label="">
                <NumberField
                  label={`${name} strength`}
                  value={v.strength}
                  onCommit={(x) => (x === null || x >= 0) && set(k, { strength: x ?? undefined })}
                />
                <span>strong,</span>
                <NumberField
                  label={`${name} range (m)`}
                  value={v.range}
                  onCommit={(x) => (x === null || x > 0) && set(k, { range: x ?? undefined })}
                />
                <span>m reach,</span>
                <ColourField label={`${name} colour`} value={v.colour} onCommit={(c) => set(k, { colour: c })} />
                {own && (own.strength !== undefined || own.range !== undefined || own.colour) ? (
                  <button
                    type="button"
                    className="small"
                    title="Its strength, reach and colour its series' again"
                    onClick={() => set(k, { strength: undefined, range: undefined, colour: undefined })}
                  >
                    As its series
                  </button>
                ) : null}
              </Row>
            ) : null}
          </div>
        );
      })}
      <p className="note">
        Its lights are part of it: each as its series is (
        {Object.keys(series).length ? 'source/lights.json' : 'none read'}) unless changed here.
      </p>
    </fieldset>
  );
}

/** The layouts an object is in: every one (those made later too), or those ticked (never none: the one shown kept). */
function LayoutRows({
  objects,
  layout,
  it,
  edit,
}: Readonly<{
  objects: TrackObjects;
  layout: string;
  it: PlacedObject;
  edit: (fn: (t: PlacedObject) => void) => void;
}>) {
  const all = Object.keys(objects.layouts);
  const every = !it.layouts;
  const on = (l: string) => every || !!it.layouts?.includes(l);
  return (
    <fieldset className="layouts-of">
      <legend>In</legend>
      <label title="In every layout, those made later too">
        <input
          type="checkbox"
          checked={every}
          onChange={(e) =>
            edit((t) => {
              setLayouts(t, e.target.checked ? null : [layout], all);
            })
          }
        />{' '}
        every layout
      </label>
      {all.map((l) => (
        <label key={l}>
          <input
            type="checkbox"
            checked={on(l)}
            disabled={every || (on(l) && (it.layouts?.length ?? 0) <= 1)}
            onChange={(e) =>
              edit((t) => {
                const now = t.layouts ?? all;
                setLayouts(t, e.target.checked ? [...now, l] : now.filter((x) => x !== l), all);
              })
            }
          />{' '}
          {l}
        </label>
      ))}
    </fieldset>
  );
}

/** A curve of an object's copies: its nodes, the node picked, how far apart and how many rows, closed or not. */
function CurveRows({
  it,
  pick,
  edit,
}: Readonly<{ it: PlacedObject; pick: ObjectPick; edit: (fn: (t: PlacedObject) => void) => void }>) {
  const ed = useEditor();
  const node = it.curve[pick.j];
  const spacing = spacingOf(it);
  return (
    <>
      <Row label="Curve">
        {it.curve.length} nodes, {wallStacks({ ...it, spacing }).length} along it
      </Row>
      {node ? (
        <>
          <PointRows
            label={`Node ${pick.j + 1}`}
            at={{ x: node.p[0], z: node.p[1] }}
            set={(k, v) =>
              edit((t) => {
                const m = t.curve[pick.j];
                if (m) m.p[k === 'x' ? 0 : 1] = v;
              })
            }
          />
          <Row label="">
            <label title="Its handles apart: dragging one leaves the other as it is">
              <input
                type="checkbox"
                checked={!!node.corner}
                onChange={(e) =>
                  edit((t) => {
                    const m = t.curve[pick.j];
                    if (!m) return;
                    if (e.target.checked) m.corner = true;
                    else delete m.corner;
                  })
                }
              />{' '}
              corner
            </label>
          </Row>
        </>
      ) : null}
      <Row label="Copies">
        <NumberField
          label="Spacing (m)"
          value={it.spacing ?? null}
          placeholder={String(Math.round(spacing * 100) / 100)}
          onCommit={(v) =>
            edit((t) => {
              if (v == null) delete t.spacing;
              else if (v > 0) t.spacing = v;
            })
          }
        />
        <span>m apart at most,</span>
        <NumberField
          label="Rows"
          step={1}
          value={it.rows ?? 1}
          onCommit={(v) =>
            v != null &&
            v >= 1 &&
            edit((t) => {
              t.rows = Math.round(v);
            })
          }
        />
        <span>rows deep (to its right)</span>
      </Row>
      <Row label="">
        <label>
          <input
            type="checkbox"
            checked={!!it.closed}
            onChange={(e) =>
              edit((t) => {
                t.closed = e.target.checked;
              })
            }
          />{' '}
          closed (a ring)
        </label>
        <button
          type="button"
          className="small"
          title="Its handles along the way through its neighbours (S): the node picked, or every node"
          onClick={() => ed.smoothPicked()}
        >
          Smooth {node ? 'node' : 'all'}
        </button>
      </Row>
      <p className="note">
        As a road: drag a node (square) to move that part of it, a handle (circle) to bend the curve (Alt: a corner);
        the curve away from its nodes, or Shift and a node, to move the whole of it. Add Node (A) and a click, or a
        double click on it, adds a node: on the curve where clicked, else on past its nearer end.
      </p>
    </>
  );
}

const COLOURS: Options<LineColour> = [
  ['white', 'white'],
  ['yellow', 'yellow'],
];
const STYLES: Options<LineStyle> = [
  ['solid', 'solid'],
  ['dotted', 'dotted'],
];

function MarkRows({ objects, pick, change }: Readonly<Omit<PartProps, 'layout'>>) {
  const m = objects.marks[pick.i];
  if (!m) return null;
  const edit = (fn: (k: PaintMark) => void) =>
    change((o) => {
      const k = o.marks[pick.i];
      if (k) fn(k);
    });
  const num =
    (fn: (k: PaintMark, v: number) => void, min = 0) =>
    (v: number | null) =>
      v != null && v > min && edit((k) => fn(k, v));
  const end = markEnd(m);
  return (
    <>
      <PointRows
        label="Start"
        at={{ x: m.p[0], z: m.p[1] }}
        set={(c, v) =>
          edit((k) => {
            k.p = c === 'x' ? [v, k.p[1]] : [k.p[0], v];
          })
        }
      />
      <PointRows
        label="End"
        at={{ x: end[0], z: end[1] }}
        set={(c, v) => edit((k) => moveMarkEnd(k, 1, c === 'x' ? v : end[0], c === 'z' ? v : end[1]))}
      />
      <Row label="Heading">
        <NumberField
          label="Heading (degrees)"
          step={1}
          value={Math.round(m.heading * DEG * 10) / 10}
          onCommit={(v) =>
            v != null &&
            edit((k) => {
              k.heading = Math.atan2(Math.sin(v / DEG), Math.cos(v / DEG));
            })
          }
        />
        <span>° from north (+z), turned about its start</span>
      </Row>
      <Row label="Size">
        <NumberField
          label="Length (m)"
          value={m.length}
          onCommit={num((k, v) => {
            k.length = v;
          })}
        />
        <span>m long,</span>
        <NumberField
          label="Width (m)"
          value={m.width}
          onCommit={num((k, v) => {
            k.width = v;
          })}
        />
        <span>m wide</span>
      </Row>
      <Row label="Paint">
        <SelectField
          label="Colour"
          value={m.colour}
          options={COLOURS}
          onChange={(v) =>
            edit((k) => {
              k.colour = v;
            })
          }
        />
        <SelectField
          label="Style"
          value={m.style}
          options={STYLES}
          onChange={(v) =>
            edit((k) => {
              k.style = v;
              if (v === 'solid') {
                delete k.dash;
                delete k.gap;
              }
            })
          }
        />
      </Row>
      {m.style === 'dotted' ? (
        <Row label="Dashes">
          <NumberField
            label="Dash (m)"
            value={m.dash ?? DASH}
            onCommit={num((k, v) => {
              k.dash = v;
            })}
          />
          <span>painted,</span>
          <NumberField
            label="Gap (m)"
            value={m.gap ?? GAP}
            onCommit={num((k, v) => {
              k.gap = v;
            })}
          />
          <span>not</span>
        </Row>
      ) : null}
      <p className="note">
        Drag it to move it, an end to stretch and turn it (Shift: its way by 15°). Placing: drag from its start to its
        end.
      </p>
      <ExportName
        value={m.name}
        onCommit={(v) =>
          v &&
          edit((k) => {
            k.name = v;
          })
        }
      />
    </>
  );
}
