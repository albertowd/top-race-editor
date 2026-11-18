import { CATEGORIES, CATEGORY_ORDER, type CategoryInfo, categoryKey, countIn, UNCOUNTED } from '../domain/categories';
import { useEditor, useEditorShallow } from '../store/EditorContext';
import { CATEGORY_ICONS, Icon } from './icons';

const GROUPS: readonly CategoryInfo['group'][] = ['Track', 'Surface', 'Objects', 'Ground'];

/** The categories: one picked is the one worked on (1 to 9, then 0, - and =, on the keyboard). */
export function Sidebar() {
  const ed = useEditor();
  const { focus, roads, objects, layout, open } = useEditorShallow((s) => ({
    focus: s.focus,
    roads: s.roads,
    objects: s.objects,
    layout: s.layout,
    open: s.sidebar,
  }));
  return (
    <nav id="sidebar" className="glass" aria-label="Categories" hidden={!open}>
      {GROUPS.map((group) => (
        <div key={group} className="side-group">
          {group === 'Track' ? null : <h2>{group}</h2>}
          <ul>
            {CATEGORY_ORDER.filter((c) => CATEGORIES[c].group === group).map((c) => {
              const info = CATEGORIES[c];
              const n = UNCOUNTED.has(c) ? null : countIn(c, roads, objects, layout);
              const key = categoryKey(c);
              return (
                <li key={c}>
                  <button
                    type="button"
                    className="side-item"
                    aria-current={focus === c}
                    title={`${info.what} (${key})`}
                    onClick={() => ed.setFocus(c)}
                  >
                    <span className={`side-icon side-${c}`}>
                      <Icon name={CATEGORY_ICONS[c]} />
                    </span>
                    <span className="side-label">{info.label}</span>
                    {n === null ? null : <span className="side-count">{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
