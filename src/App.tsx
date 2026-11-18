import { useEffect } from 'react';
import { MapCanvas } from './canvas/MapCanvas';
import { Activity } from './components/Activity';
import { BringDialog } from './components/BringDialog';
import { BuildDialog } from './components/BuildDialog';
import { HelpDialog } from './components/HelpDialog';
import { Inspector } from './components/Inspector';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { useShortcuts } from './hooks/useShortcuts';
import { EditorProvider, useEditorState } from './store/EditorContext';
import type { Editor } from './store/editor';
import type { Terrain } from './terrain/store';
import { TerrainProvider } from './terrain/TerrainContext';

function Title() {
  const name = useEditorState((s) => s.track?.name);
  useEffect(() => {
    document.title = name ? `${name} — Top Race editor` : 'Top Race editor';
  }, [name]);
  return null;
}

export function App({ editor, terrain = null }: Readonly<{ editor: Editor; terrain?: Terrain | null }>) {
  useShortcuts(editor, terrain);
  useEffect(() => {
    void editor.load();
  }, [editor]);
  return (
    <EditorProvider editor={editor}>
      <TerrainProvider terrain={terrain}>
        <Title />
        <div id="app">
          <Toolbar />
          <main>
            <MapCanvas />
            <Sidebar />
            <Inspector />
            <StatusBar />
          </main>
        </div>
        <BringDialog />
        <BuildDialog />
        <HelpDialog />
        <Activity />
      </TerrainProvider>
    </EditorProvider>
  );
}
