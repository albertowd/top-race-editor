// The editor's window: the port to the engine window handed on to the page, which has no Node of its own.
const { contextBridge, ipcRenderer } = require('electron');

// (the page in the desktop app: its engine window's port is on its way, its calls wait for it)
contextBridge.exposeInMainWorld('topRaceDesktop', true);
ipcRenderer.on('engine-port', (e) => window.postMessage('engine-port', '*', e.ports));
// (closing with changes not saved, "Save and close" chosen: the page saves them, then closes)
ipcRenderer.on('save-and-close', () => window.postMessage('save-and-close', '*'));
