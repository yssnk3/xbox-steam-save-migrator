// Preload bridge. The renderer never touches Node directly (contextIsolation:
// true) — instead, this file exposes a tiny `zcode` object on window that
// resolves to native dialogs without spawning PowerShell + .NET Forms (which
// takes ~1s on every click in older builds). Calls land in the main process,
// which uses `dialog.showOpenDialog` (Windows: native IFileDialog, sub-100ms
// to display).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zcode', {
  pickFolder: (opts = {}) => ipcRenderer.invoke('zcode:pick-folder', opts),
  pickFile: (opts = {}) => ipcRenderer.invoke('zcode:pick-file', opts),
  openFolder: (folderPath) => ipcRenderer.invoke('zcode:open-folder', folderPath),
  isElectron: true,
});
