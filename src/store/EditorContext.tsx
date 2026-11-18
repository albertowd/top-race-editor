import { createContext, type ReactNode, useContext } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Editor } from './editor';
import type { EditorState } from './state';

const EditorContext = createContext<Editor | null>(null);

export function EditorProvider({ editor, children }: Readonly<{ editor: Editor; children: ReactNode }>) {
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useEditor: no EditorProvider above');
  return editor;
}

/** A part of the editor's state, the component drawn again when it changes. */
export function useEditorState<T>(select: (s: EditorState) => T): T {
  return useStore(useEditor().store, select);
}

/** Several parts at once (an object or a list), compared one by one. */
export function useEditorShallow<T extends object>(select: (s: EditorState) => T): T {
  return useStore(useEditor().store, useShallow(select));
}
