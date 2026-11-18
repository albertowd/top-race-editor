import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { engine } from './api/client';
import { engineChannel, onEnginePort } from './api/engineport';
import { createEditor } from './store/editor';
import { terrainApi } from './terrain/api';
import { createTerrain } from './terrain/store';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root on the page');

// (the engine window's port, handed over by the desktop app: the engine's calls go there)
onEnginePort((port) => engineChannel.connect(port));

createRoot(root).render(
  <StrictMode>
    <App editor={createEditor(engine)} terrain={createTerrain(terrainApi)} />
  </StrictMode>,
);
