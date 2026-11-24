import type { SurfaceRoughness } from '../domain/types';
import { ROUGH_LEVELS } from '../engine/roughness';
import { useEditor, useEditorState } from '../store/EditorContext';
import { NumberField, Row, SelectField } from './fields';

type Level = 'none' | keyof typeof ROUGH_LEVELS | 'own';
const LEVELS: readonly (readonly [Level, string])[] = [
  ['none', 'None (smooth)'],
  ['light', 'Light'],
  ['medium', 'Medium'],
  ['heavy', 'Heavy'],
  ['own', 'Its own'],
];
const PARTS: readonly (readonly [keyof Omit<SurfaceRoughness, 'seed' | 'map'>, string, string])[] = [
  ['waves', 'Waves (mm)', 'long waves, 8 to 20 m'],
  ['bumps', 'Bumps (mm)', 'bumps, 1.5 to 4 m'],
  ['ripple', 'Ripple (mm)', 'a ripple the kart trembles on'],
  ['camber', 'Bends (mm)', "a tight bend's inside lower by"],
];

/** Which ready-made level the surface is (none, its own where it is none of them). */
function levelOf(s: SurfaceRoughness | undefined): Level {
  if (!s || PARTS.every(([k]) => !s[k])) return 'none';
  for (const [name, l] of Object.entries(ROUGH_LEVELS))
    if (PARTS.every(([k]) => (s[k] ?? 0) === l[k])) return name as Level;
  return 'own';
}

/** The roads' surface made imperfect all over (the build's: engine/roughness.ts): a ready-made level, or its own
 * millimetres of each, and a new pattern of it. Saved with the objects. */
export function SurfacePanel() {
  const ed = useEditor();
  const objects = useEditorState((s) => s.objects);
  if (!objects) return null;
  const s = objects.surface;
  const level = levelOf(s);
  const set = (next: SurfaceRoughness | undefined) =>
    ed.changeObjects((d) => {
      if (next && PARTS.some(([k]) => next[k])) d.surface = next;
      else delete d.surface;
    });
  return (
    <section className="surface" aria-label="Surface">
      <Row label="Surface">
        <SelectField
          label="Surface roughness"
          value={level}
          options={LEVELS}
          onChange={(v) => {
            if (v === 'none') set(undefined);
            else if (v !== 'own') set({ ...ROUGH_LEVELS[v], seed: s?.seed ?? 1, ...(s?.map ? { map: s.map } : {}) });
          }}
        />
        <button
          type="button"
          className="small"
          disabled={level === 'none'}
          title="Another pattern of the same roughness (its noise's seed)"
          onClick={() => set({ ...s, seed: (s?.seed ?? 1) + 1 })}
        >
          New Pattern
        </button>
      </Row>
      {level === 'none'
        ? null
        : PARTS.map(([k, label, what]) => (
            <Row key={k} label="">
              <NumberField
                label={label}
                step={0.5}
                value={s?.[k] ?? 0}
                onCommit={(v) => v != null && v >= 0 && v <= 100 && set({ ...s, [k]: v })}
              />
              <span>mm: {what}</span>
            </Row>
          ))}
      <p className="note">
        The build makes every road imperfect: long waves, bumps, a fine ripple, and bends lower on their inside. It
        eases out a metre past the roads. Hand-made bumps (U) go on top. The map shows it while Bumps is on.
        {s?.map?.length ? ` Rougher or smoother by place as onboard videos measured it (${s.map.length} points).` : ''}
      </p>
    </section>
  );
}
