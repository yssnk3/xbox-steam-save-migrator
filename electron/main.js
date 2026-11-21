import { app as electronApp, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let server;

// --- Single-instance lock ---
// Without this, double-clicking the exe again spawns a second process that
// fights over port 3001; the second instance's server.listen() fails, so its
// window never opens (the "double-click does nothing" symptom).
const gotLock = electronApp.requestSingleInstanceLock();
if (!gotLock) {
  electronApp.quit();
} else {
  electronApp.on('second-instance', () => {
    // Focus the existing window instead of starting a new one.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  electronApp.whenReady().then(() => {
    startBackendServer();

    electronApp.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        startBackendServer();
      }
    });
  });
}

function startBackendServer() {
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('[Electron] Dev mode detected, skipping embedded server (external server already running)');
    return;
  }

  console.log('[Electron] Starting embedded backend server...');

  // Dynamic import to catch errors in the server module
  import('../server/index.js')
    .then(({ app: serverApp, PORT }) => {
      tryListen(serverApp, PORT, 0);
    })
    .catch(err => {
      console.error('[Electron] Failed to load server module:', err);
      // Still create the window so the user sees something
      createWindow();
    });
}

function tryListen(serverApp, port, attempt) {
  const candidate = serverApp.listen(port, '127.0.0.1', () => {
    server = candidate;
    console.log(`[Electron] Embedded Server running on http://localhost:${port}`);
    createWindow(port);
  });
  candidate.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.warn(`[Electron] Port ${port} is busy, retrying on port ${port + 1}...`);
      tryListen(serverApp, port + 1, attempt + 1);
    } else {
      console.error('[Electron] Server error:', err);
      createWindow();
    }
  });
}

function createWindow(port = 3001) {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    title: 'Steam ↔ Xbox PC 游戏存档移植工具 Pro',
    backgroundColor: '#020617',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Native dialogs: sub-100ms on Windows (uses IFileDialog directly), vs
  // ~1s for the PowerShell + .NET Forms path the browser fallback uses.
  ipcMain.handle('zcode:pick-folder', async (_evt, opts = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || '请选择存档目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: opts.defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  });
  ipcMain.handle('zcode:pick-file', async (_evt, opts = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || '请选择存档文件',
      properties: ['openFile'],
      defaultPath: opts.defaultPath,
      filters: opts.filters,
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  });
  ipcMain.handle('zcode:open-folder', async (_evt, folderPath) => {
    if (!folderPath) return false;
    await shell.openPath(folderPath);
    return true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // The embedded server also serves the built frontend.
    // Give the server a moment to be ready before loading.
    setTimeout(() => {
      mainWindow.loadURL(`http://localhost:${port}`);
    }, 500);
  }
}

electronApp.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') electronApp.quit();
});