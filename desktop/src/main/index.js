'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { Manager } = require('./manager');
const { startServer } = require('./server');

const PORT = 18761;
let mainWindow = null;
let manager = null;

function iconPath() {
  const ico = path.join(__dirname, '../../assets/icon.ico');
  const png = path.join(__dirname, '../../assets/icon.png');
  return require('fs').existsSync(ico) ? ico : png;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 860,
    minHeight: 520,
    title: 'SDL Fast',
    backgroundColor: '#f0f0f0',
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.once('did-finish-load', () => {
    if (manager) send('tasks:updated', manager.totals());
  });
  Menu.setApplicationMenu(null);
}

function send(channel, data) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (wc.isLoadingMainFrame()) {
    wc.once('did-finish-load', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
    });
    return;
  }
  wc.send(channel, data);
}

function bindIpc() {
  ipcMain.handle('tasks:list', () => manager.totals());
  ipcMain.handle('task:add', (_e, payload) => {
    const task = manager.add(payload);
    return { ok: true, task };
  });
  ipcMain.handle('task:pause', (_e, id) => { manager.pause(id); return true; });
  ipcMain.handle('task:resume', (_e, id) => { manager.resume(id); return true; });
  ipcMain.handle('task:pauseAll', () => { manager.pauseAll(); return true; });
  ipcMain.handle('task:resumeAll', () => { manager.resumeAll(); return true; });
  ipcMain.handle('task:remove', (_e, { id, deleteFile }) => { manager.remove(id, deleteFile); return true; });
  ipcMain.handle('task:clearAll', (_e, deleteFile) => { manager.clearAll(deleteFile); return true; });
  ipcMain.handle('task:clearCompleted', () => { manager.clearCompleted(); return true; });
  ipcMain.handle('clip:read', () => clipboard.readText());
  ipcMain.handle('clip:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('app:openDownloadDir', () => {
    const dir = manager.settings().downloadDir;
    if (dir) return shell.openPath(dir);
    return '';
  });
  ipcMain.handle('app:quit', () => { app.quit(); });
  ipcMain.handle('task:open', async (_e, id) => {
    const t = manager.get(id);
    if (t && t.savePath) await shell.openPath(t.savePath);
  });
  ipcMain.handle('task:folder', async (_e, id) => {
    const t = manager.get(id);
    if (t && t.savePath) shell.showItemInFolder(t.savePath);
  });
  ipcMain.handle('settings:get', () => manager.settings());
  ipcMain.handle('settings:set', (_e, patch) => {
    Object.assign(manager.store.settings, patch || {});
    manager.store.saveSettings();
    return manager.settings();
  });
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return r.canceled ? '' : r.filePaths[0];
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    port: PORT,
    extensionDir: app.isPackaged
      ? path.join(process.resourcesPath, 'extension')
      : path.join(__dirname, '../../../extension'),
  }));
}

app.on('ready', () => {
  try {
    const store = new Store(app.getPath('userData'), app.getPath('downloads'));
    manager = new Manager(store, app.getPath('userData'));
    manager.on('change', (data) => send('tasks:updated', data));
    bindIpc();
    startServer(PORT, (items) => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
      send('capture:items', items);
    }).catch((err) => {
      console.error('capture server failed', err);
    });
    createWindow();
  } catch (err) {
    console.error(err);
    dialog.showErrorBox('启动失败', String(err && err.stack || err));
  }
});

app.on('window-all-closed', () => {
  if (manager) manager.pauseAll();
  app.quit();
});

app.on('gpu-process-crashed', (_e, killed) => {
  console.error('gpu crashed', killed);
});
