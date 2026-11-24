import type { GroundPictureSource } from '../domain/types';
import { useEditor, useEditorState } from '../store/EditorContext';
import { Row, SelectField } from './fields';

const SOURCES: readonly (readonly [GroundPictureSource, string])[] = [
  ['photo', 'The photo'],
  ['generated', 'Generated from it'],
];

/** The ground's picture in the games: the satellite photo as it is, or one the build generates from what covers the
 * ground where in it (grass, earth, paving), none of the photo's pixels in it (a photo that may not be handed
 * on: Google's). The editor always draws the photo. Saved with the objects. */
export function GroundPicturePanel() {
  const ed = useEditor();
  const objects = useEditorState((s) => s.objects);
  if (!objects) return null;
  const value: GroundPictureSource = objects.ground?.picture ?? 'photo';
  return (
    <section className="ground-picture" aria-label="Ground picture">
      <Row label="Ground">
        <SelectField
          label="Ground picture in the games"
          value={value}
          options={SOURCES}
          onChange={(v) =>
            ed.changeObjects((d) => {
              if (v === 'photo') delete d.ground;
              else d.ground = { picture: v };
            })
          }
        />
      </Row>
      <p className="note">
        {value === 'generated'
          ? 'The build paints the ground from what covers it in the photo (grass, earth, paving), in its colours there, each with a texture of its own: none of the photo’s detail, and no tree shadows. The editor still shows the photo.'
          : 'The games show the satellite photo as it is. Generate the ground instead where the photo may not be handed on (Google’s).'}
      </p>
    </section>
  );
}
