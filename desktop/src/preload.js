'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sdl', {
  list: () => ipcRenderer.invoke('tasks:list'),
  add: (payload) => ipcRenderer.invoke('task:add', payload),
  pause: (id) => ipcRenderer.invoke('task:pause', id),
  resume: (id) => ipcRenderer.invoke('task:resume', id),
  pauseAll: () => ipcRenderer.invoke('task:pauseAll'),
  resumeAll: () => ipcRenderer.invoke('task:resumeAll'),
  remove: (id, deleteFile) => ipcRenderer.invoke('task:remove', { id, deleteFile }),
  openFile: (id) => ipcRenderer.invoke('task:open', id),
  openFolder: (id) => ipcRenderer.invoke('task:folder', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  onTasks: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('tasks:updated', fn);
    return () => ipcRenderer.removeListener('tasks:updated', fn);
  },
  onCapture: (cb) => {
    const fn = (_e, items) => cb(items);
    ipcRenderer.on('capture:items', fn);
    return () => ipcRenderer.removeListener('capture:items', fn);
  },
  onUi: (cb) => {
    const channels = ['ui:add', 'ui:resume', 'ui:pause', 'ui:delete', 'ui:open', 'ui:folder', 'ui:settings', 'ui:help', 'ui:about', 'ui:filter'];
    const handlers = channels.map((ch) => {
      const fn = (_e, data) => cb(ch.replace('ui:', ''), data);
      ipcRenderer.on(ch, fn);
      return [ch, fn];
    });
    return () => handlers.forEach(([ch, fn]) => ipcRenderer.removeListener(ch, fn));
  },
});
