'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
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
    autoHideMenuBar: false,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  buildMenu();
}

function buildMenu() {
  const tpl = [
    {
      label: '任务',
      submenu: [
        { label: '添加 URL', accelerator: 'CmdOrCtrl+N', click: () => send('ui:add') },
        { label: '恢复选中', click: () => send('ui:resume') },
        { label: '暂停选中', click: () => send('ui:pause') },
        { label: '全部暂停', click: () => manager && manager.pauseAll() },
        { type: 'separator' },
        { label: '删除选中', click: () => send('ui:delete') },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '文件',
      submenu: [
        { label: '打开文件', click: () => send('ui:open') },
        { label: '打开文件夹', click: () => send('ui:folder') },
        { type: 'separator' },
        { label: '设置', click: () => send('ui:settings') },
      ],
    },
    {
      label: '下载',
      submenu: [
        { label: '全部开始', click: () => manager && manager.resumeAll() },
        { label: '全部暂停', click: () => manager && manager.pauseAll() },
      ],
    },
    {
      label: '查看',
      submenu: [
        { label: '全部下载', click: () => send('ui:filter', 'all') },
        { label: '正在下载', click: () => send('ui:filter', 'downloading') },
        { label: '已完成', click: () => send('ui:filter', 'completed') },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '浏览器插件说明',
          click: () => send('ui:help'),
        },
        {
          label: '打开插件目录',
          click: () => shell.openPath(path.join(__dirname, '../../../extension')),
        },
        { type: 'separator' },
        { label: '关于 SDL Fast', click: () => send('ui:about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
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
    extensionDir: path.join(__dirname, '../../../extension'),
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
