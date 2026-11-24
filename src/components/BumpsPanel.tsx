import { type BumpMode, bumpAt, hasBumps } from '../editing/bumps';
import { useEditor, useEditorShallow } from '../store/EditorContext';
import { NumberField, Row, Segmented } from './fields';
import { Icon } from './icons';

const MODES: readonly (readonly [BumpMode, string])[] = [
  ['point', 'Point'],
  ['raise', 'Raise'],
  ['lower', 'Lower'],
  ['smooth', 'Smooth'],
];

const mm = (m: number) => Math.round(m * 10000) / 10;

/** The roads' bumps made by hand (Bumps, U): a point of a road's mesh moved up or down, or a brush that raises,
 * lowers or smooths them; the build moves the floor by them after it is merged. */
export function BumpsPanel() {
  const ed = useEditor();
  const { brush, pick, bumps, mode } = useEditorShallow((s) => ({
    brush: s.bumpBrush,
    pick: s.bumpPick,
    bumps: s.bumps,
    mode: s.mode,
  }));
  if (mode !== 'bumps') return null;
  const here = pick ? bumpAt(bumps, pick[0], pick[1]) : 0;
  return (
    <section className="bumps" aria-label="Bumps">
      <h3>
        <Icon name="bumps" size={14} /> Bumps
      </h3>
      <Row label="Tool">
        <Segmented
          label="Bump tool"
          value={brush.mode}
          options={MODES}
          onChange={(m) => ed.setBumpBrush({ mode: m })}
        />
      </Row>
      {brush.mode === 'point' ? (
        <>
          {pick ? (
            <Row label="Point">
              <span>
                {pick[0].toFixed(2)}, {pick[1].toFixed(2)}:
              </span>
              <NumberField
                label="Bump (mm)"
                step={0.5}
                value={mm(here)}
                onCommit={(v) => v != null && ed.setBumpAtPick(v / 1000)}
              />
              <span>mm</span>
            </Row>
          ) : null}
          <Row label="Reach">
            <NumberField
              label="Reach (m)"
              step={0.05}
              value={brush.reach}
              onCommit={(v) => v != null && v > 0 && ed.setBumpBrush({ reach: v })}
            />
            <span>m round the point, easing to nothing</span>
          </Row>
          <p className="note">
            Pick a road to show its mesh's points (zoomed in), then click one and drag it up or down (Shift: finer), or
            type its bump.
          </p>
        </>
      ) : (
        <>
          <Row label="Brush">
            <NumberField
              label="Radius (m)"
              step={0.1}
              value={brush.radius}
              onCommit={(v) => v != null && v > 0 && ed.setBumpBrush({ radius: v })}
            />
            <span>m,</span>
            <NumberField
              label="Strength (%)"
              step={5}
              value={Math.round(brush.strength * 100)}
              onCommit={(v) => v != null && v > 0 && ed.setBumpBrush({ strength: Math.min(v, 100) / 100 })}
            />
            <span>%</span>
          </Row>
          <p className="note">
            Drag on the road to {brush.mode === 'smooth' ? 'smooth the bumps' : `${brush.mode} it`}; each dab{' '}
            {brush.mode === 'smooth' ? 'evens them out' : `${brush.mode}s it up to 4 mm`} at the middle, less towards
            the edge.
          </p>
        </>
      )}
      <Row label="">
        <button
          type="button"
          className="small"
          disabled={!hasBumps(bumps)}
          title="Take every bump away (Undo brings them back)"
          onClick={() => ed.clearBumps()}
        >
          Clear All Bumps
        </button>
      </Row>
      <p className="note">
        Red is up, blue down. The build moves the merged floor by the bumps after the roads are merged, so the paint,
        rumbles, objects and racing lines follow them. Saved with the track (Ctrl+S).
      </p>
    </section>
  );
}
