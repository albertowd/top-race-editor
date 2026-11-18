import type { MouseEvent } from 'react';
import {
  BACK,
  BACK_RAMP,
  DASH,
  GAP,
  KERB_COLOURS,
  KERB_END_RISE,
  KERB_KINDS,
  KERB_TAPER,
  KERB_WIDTH,
  kindOf,
  LINE_PAD,
  LINE_WIDTH,
  RAISED,
} from '../domain/constants';
import type { Kerb, KerbEnd, KerbKind, LineColour, LineStyle, PaintLine, Side } from '../domain/types';
import { useEditor, useEditorShallow } from '../store/EditorContext';
import { ExportName, Group, NumberField, type Options, Row, SelectField } from './fields';
import { roadLabel } from './RoadList';

const SIDES: Options<Side> = [
  ['left', 'L'],
  ['right', 'R'],
];
const COLOURS: Options<LineColour> = [
  ['white', 'white'],
  ['yellow', 'yellow'],
];
const STYLES: Options<LineStyle> = [
  ['solid', 'solid'],
  ['dotted', 'dotted'],
];
const ENDS: Options<KerbEnd> = [
  ['square', 'square'],
  ['triangle', 'triangle (tapers in)'],
];
const KINDS: Options<KerbKind> = KERB_KINDS.map((k) => [k.kind, k.label] as const);

/** A rumble kind's look as a swatch's background. */
export function kerbSwatch(kind: KerbKind, stripes = false): string {
  const [a, b] = KERB_COLOURS[kind];
  if (!stripes)
    return kind === 'ramp_concrete'
      ? `linear-gradient(90deg,${KERB_COLOURS.ramp[0]} 60%,${KERB_COLOURS.concrete[0]} 60%)`
      : a;
  const third = kind === 'ramp_concrete' ? KERB_COLOURS.concrete[0] : a;
  return `linear-gradient(90deg,${a} 33%,${b} 33% 66%,${third} 66%)`;
}

/** A click on a row (not on its fields): select it. */
const onRow = (select: () => void) => (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('input, select, button')) return;
  select();
};

function useSelected() {
  return useEditorShallow((s) => ({ road: s.roads[s.sel.r], sel: s.sel }));
}

/** No road picked yet: what to do. */
export function PickRoad({ what }: Readonly<{ what: string }>) {
  return <p className="empty-state">Pick a road on the map or in the list to edit its {what}.</p>;
}

export function LinesForm() {
  const ed = useEditor();
  const { road, sel } = useSelected();
  if (!road || road.along) return null;
  const lines = road.lines ?? [];
  const setLine = (i: number, patch: Partial<PaintLine>) =>
    ed.change((r) => {
      const l = r.lines?.[i];
      if (l) Object.assign(l, patch);
    });
  const ln = sel.line >= 0 ? lines[sel.line] : undefined;
  return (
    <Group id="lineprops" label="Lines" title={`Lines of ${roadLabel(road, sel.r)}`}>
      <table className="items">
        <thead>
          <tr>
            {['', 'side', 'from (m)', 'to (m)', 'colour', 'style', ''].map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed headings
              <th key={i}>{h}</th> // NOSONAR: fixed headings
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are kept and edited by their place
              key={i} // NOSONAR: kept and edited by their place: a key by content would remount a row as it is typed in
              className={sel.line === i ? 'sel' : undefined}
              onClick={onRow(() => ed.selectItem('line', i))}
            >
              <td>{i + 1}</td>
              <td>
                <SelectField
                  label="Line side"
                  value={l.side}
                  options={SIDES}
                  onChange={(v) => setLine(i, { side: v })}
                />
              </td>
              <td>
                <NumberField label="Line from" value={l.from ?? 0} onCommit={(v) => setLine(i, { from: v ?? 0 })} />
              </td>
              <td>
                <NumberField label="Line to" value={l.to} placeholder="end" onCommit={(v) => setLine(i, { to: v })} />
              </td>
              <td>
                <SelectField
                  label="Line colour"
                  value={l.colour ?? 'white'}
                  options={COLOURS}
                  onChange={(v) => setLine(i, { colour: v })}
                />
              </td>
              <td>
                <SelectField
                  label="Line style"
                  value={l.style ?? 'solid'}
                  options={STYLES}
                  onChange={(v) => setLine(i, { style: v })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="small"
                  title="Delete"
                  aria-label={`Delete line ${i + 1}`}
                  onClick={() => ed.removeItem('line', i)}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button type="button" className="small" onClick={() => ed.addLine('left')}>
          Add Left Line
        </button>
        <button type="button" className="small" onClick={() => ed.addLine('right')}>
          Add Right Line
        </button>
      </div>
      {ln && (
        <div className="detail">
          <Row label="In (m)">
            <NumberField
              label="Line in"
              value={ln.pad ?? LINE_PAD}
              onCommit={(v) => setLine(sel.line, { pad: v ?? LINE_PAD })}
            />
            <span className="hint">its middle in from the road's edge</span>
          </Row>
          <Row label="Wide (m)">
            <NumberField
              label="Line width"
              value={ln.w ?? LINE_WIDTH}
              onCommit={(v) => setLine(sel.line, { w: v ?? LINE_WIDTH })}
            />
          </Row>
          {ln.style === 'dotted' && (
            <Row label="Dashes (m)">
              <NumberField
                label="Dashes"
                value={ln.dash ?? DASH}
                onCommit={(v) => setLine(sel.line, { dash: v ?? DASH })}
              />
              gaps
              <NumberField label="Gaps" value={ln.gap ?? GAP} onCommit={(v) => setLine(sel.line, { gap: v ?? GAP })} />
              <span className="hint">counted from its start</span>
            </Row>
          )}
          <ExportName label="Line mesh" value={ln.name ?? ''} onCommit={(v) => setLine(sel.line, { name: v })} />
        </div>
      )}
      <p className="hint">
        From / to: metres along the road from its start (to empty: its end). Click a row to select a line: its ends show
        as triangles on the map, to drag.
      </p>
    </Group>
  );
}

export function KerbsForm() {
  const ed = useEditor();
  const { road, sel } = useSelected();
  if (!road || road.along) return null;
  const kerbs = road.kerbs ?? [];
  const setKerb = (i: number, patch: Partial<Kerb>) =>
    ed.change((r) => {
      const k = r.kerbs?.[i];
      if (k) Object.assign(k, patch);
    });
  const kb = sel.kerb >= 0 ? kerbs[sel.kerb] : undefined;
  const kbKind = kb ? kindOf(kb.kind) : 'ramp';
  const at = sel.kerb;
  return (
    <Group id="kerbprops" label="Rumbles" title={`Rumbles of ${roadLabel(road, sel.r)}`}>
      <table className="items">
        <thead>
          <tr>
            {['', 'side', 'from (m)', 'to (m)', 'kind', ''].map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed headings
              <th key={i}>{h}</th> // NOSONAR: fixed headings
            ))}
          </tr>
        </thead>
        <tbody>
          {kerbs.map((k, i) => (
            <tr
              // biome-ignore lint/suspicious/noArrayIndexKey: rumbles are kept and edited by their place
              key={i} // NOSONAR: kept and edited by their place: a key by content would remount a row as it is typed in
              className={sel.kerb === i ? 'sel' : undefined}
              onClick={onRow(() => ed.selectItem('kerb', i))}
            >
              <td>
                <span className="swatch" style={{ background: kerbSwatch(kindOf(k.kind)) }} />
              </td>
              <td>
                <SelectField
                  label="Rumble side"
                  value={k.side}
                  options={SIDES}
                  onChange={(v) => setKerb(i, { side: v })}
                />
              </td>
              <td>
                <NumberField label="Rumble from" value={k.from ?? 0} onCommit={(v) => setKerb(i, { from: v ?? 0 })} />
              </td>
              <td>
                <NumberField label="Rumble to" value={k.to} placeholder="end" onCommit={(v) => setKerb(i, { to: v })} />
              </td>
              <td>
                <SelectField
                  label="Rumble kind"
                  value={kindOf(k.kind)}
                  options={KINDS}
                  onChange={(v) => setKerb(i, { kind: v })}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="small"
                  title="Delete"
                  aria-label={`Delete rumble ${i + 1}`}
                  onClick={() => ed.removeItem('kerb', i)}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button type="button" className="small" onClick={() => ed.addKerb('left')}>
          Add Left Rumble
        </button>
        <button type="button" className="small" onClick={() => ed.addKerb('right')}>
          Add Right Rumble
        </button>
      </div>
      {kb && (
        <div className="detail">
          <Row label="Wide (m)">
            <NumberField
              label="Rumble width"
              value={kb.width ?? KERB_WIDTH}
              onCommit={(v) => setKerb(at, { width: v ?? KERB_WIDTH })}
            />
            <span className="hint">
              {kbKind === 'ramp_concrete' ? 'its ramp, out from its inner side' : 'out from its inner side'}
            </span>
          </Row>
          {kbKind === 'ramp_concrete' && (
            <Row label="Concrete">
              <NumberField
                label="Concrete"
                value={kb.back ?? BACK}
                onCommit={(v) => setKerb(at, { back: v ?? BACK })}
              />
              <span className="hint">metres of concrete kerb behind the ramp</span>
            </Row>
          )}
          {KERB_END_RISE[kbKind] > RAISED && (
            <Row label="Back ramp">
              <NumberField
                label="Back ramp"
                value={kb.back_ramp ?? BACK_RAMP}
                onCommit={(v) => setKerb(at, { back_ramp: Math.max(v ?? BACK_RAMP, 0) })}
              />
              <span className="hint">metres behind it, ramping down to the road (0: none)</span>
            </Row>
          )}
          <Row label="In (m)">
            <NumberField label="Rumble in" value={kb.inset ?? 0} onCommit={(v) => setKerb(at, { inset: v ?? 0 })} />
            <span className="hint">its inner side in from the road's edge (0: on the edge)</span>
          </Row>
          <Row label="Start">
            <SelectField
              label="Rumble start"
              value={kb.start ?? 'square'}
              options={ENDS}
              onChange={(v) => setKerb(at, { start: v })}
            />
          </Row>
          <Row label="End">
            <SelectField
              label="Rumble end"
              value={kb.end ?? 'square'}
              options={ENDS}
              onChange={(v) => setKerb(at, { end: v })}
            />
          </Row>
          <Row label="Taper (m)">
            <NumberField
              label="Taper"
              value={kb.taper ?? KERB_TAPER}
              onCommit={(v) => setKerb(at, { taper: v ?? KERB_TAPER })}
            />
            <span className="hint">how long a triangle end is</span>
          </Row>
        </div>
      )}
      <details className="legend">
        <summary>Rumble kinds</summary>
        {KERB_KINDS.map((k) => (
          <div className="row" key={k.kind}>
            <span className="swatch" style={{ background: kerbSwatch(k.kind, true) }} />
            <b>{k.label}</b> {k.what}
          </div>
        ))}
      </details>
      <p className="hint">
        A rumble lies outside the road's edge, going outward. Click a row to select it: its ends show as triangles on
        the map, to drag. Kept in the roads file; the build makes the kerbs from it once the kerbs are rebuilt.
      </p>
    </Group>
  );
}
