import { useEffect } from 'react';
import { CATEGORY_ORDER, categoryKey } from '../domain/categories';
import type { Editor } from '../store/editor';
import type { Terrain } from '../terrain/store';

type Key = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

type Act = (ed: Editor, e: Key) => void;

const remove: Act = (ed, e) => {
  if (e.shiftKey) ed.deleteRoad();
  else ed.deleteSelected();
};

/** With Ctrl (or Cmd): undo, redo, save. */
const WITH_CTRL: Record<string, Act> = {
  z: (ed, e) => {
    if (e.shiftKey) ed.redo();
    else ed.undo();
  },
  y: (ed) => ed.redo(),
  s: (ed) => {
    void ed.save();
  },
};

/** By their names (Enter: only while drawing a new road), then by their letters (as the help lists them). */
const KEYS: Record<string, Act> = {
  ' ': (ed) => ed.set({ space: true }),
  Escape: (ed) => ed.escape(),
  Delete: remove,
  Backspace: remove,
  c: (ed) => {
    void ed.checkSurface();
  },
  b: (ed) => {
    void ed.openBring();
  },
  j: (ed) => ed.joinNearest(),
  v: (ed) => ed.setMode('select'),
  a: (ed) => ed.setMode('add'),
  n: (ed) => ed.setMode('new'),
  m: (ed) => ed.setMode(ed.get().mode === 'measure' ? 'select' : 'measure'),
  o: (ed) => ed.setMode(ed.get().mode === 'place' ? 'select' : 'place'),
  s: (ed) => ed.smoothPicked(),
  '?': (ed) => ed.toggleHelp(),
  '\\': (ed) => ed.toggleSidebar(),
  // (1 to 9, then 0, - and =: the categories, in the sidebar's order)
  ...Object.fromEntries(CATEGORY_ORDER.map((c): [string, Act] => [categoryKey(c), (ed) => ed.setFocus(c)])),
};

/** While the terrain is worked on, the keys it has its own way: true if it did something with this one. */
function terrainKey(t: Terrain, e: Key): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const s = t.get();
  if (ctrl && k === 'z') {
    if (e.shiftKey) t.redo();
    else t.undo();
    return true;
  }
  if (ctrl && k === 'y') {
    t.redo();
    return true;
  }
  if (ctrl && k === 's') {
    void t.save();
    return true;
  }
  if (e.key === 'Enter' && s.draft) {
    t.finishDraft();
    return true;
  }
  if (e.key === 'Escape' && (s.draft || s.tool !== 'select')) {
    if (s.draft) t.cancelDraft();
    else t.setTool('select');
    return true;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && s.pick) {
    if (s.pick.kind === 'area') t.removeArea(s.pick.i);
    else t.removeEdit(s.pick.i);
    return true;
  }
  return false;
}

/** What a key does (on the page, not while typing in a field); true if it did something. */
export function handleKey(ed: Editor, e: Key, terrain?: Terrain | null): boolean {
  if (terrain && ed.get().focus === 'terrain' && terrainKey(terrain, e)) return true;
  if (e.key === 'Enter') {
    const drawing = !!ed.get().newRoad;
    if (drawing) ed.finishNewRoad();
    return drawing;
  }
  const act = e.ctrlKey || e.metaKey ? WITH_CTRL[e.key.toLowerCase()] : (KEYS[e.key] ?? KEYS[e.key.toLowerCase()]);
  act?.(ed, e);
  return !!act;
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

/** The editor's keys on the whole page, and the warning on leaving with changes not saved. */
export function useShortcuts(ed: Editor, terrain?: Terrain | null): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (handleKey(ed, e, terrain) && (e.key === ' ' || e.ctrlKey || e.metaKey || e.key === 'b')) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') ed.set({ space: false });
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (ed.get().dirty || terrain?.get().dirty) e.preventDefault();
    };
    // (the desktop app asked to save and close: the changes saved, then closed, if they were)
    const saveAndClose = async (e: MessageEvent) => {
      if (e.data !== 'save-and-close') return;
      if (ed.get().dirty) await ed.save();
      if (terrain?.get().dirty) await terrain.save();
      if (!ed.get().dirty && !terrain?.get().dirty) window.close();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('beforeunload', leave);
    window.addEventListener('message', saveAndClose);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('message', saveAndClose);
    };
  }, [ed, terrain]);
}
