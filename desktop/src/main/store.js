'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function defaultSettings(downloadsDir) {
  return {
    downloadDir: downloadsDir,
    connections: 16,
    maxActive: 3,
    autoStartCapture: true,
    takeoverConfirm: true,
    hfToken: '',
    ytdlpPath: '',
    ffmpegPath: '',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  };
}

class Store {
  constructor(userData, downloadsDir) {
    this.dir = userData;
    this.settingsFile = path.join(userData, 'settings.json');
    this.tasksFile = path.join(userData, 'tasks.json');
    this.settings = Object.assign(defaultSettings(downloadsDir), readJson(this.settingsFile, {}));
    this.tasks = readJson(this.tasksFile, []);
  }

  saveSettings() {
    writeJson(this.settingsFile, this.settings);
  }

  saveTasks() {
    const slim = this.tasks.map((t) => ({
      id: t.id,
      url: t.url,
      filename: t.filename,
      savePath: t.savePath,
      category: t.category,
      kind: t.kind,
      mime: t.mime,
      size: t.size,
      downloaded: t.downloaded,
      status: t.status === 'downloading' || t.status === 'merging' ? 'paused' : t.status,
      error: t.error || '',
      connections: t.connections,
      headers: t.headers || {},
      createdAt: t.createdAt,
      finishedAt: t.finishedAt || null,
      ranges: t.ranges || null,
    }));
    writeJson(this.tasksFile, slim);
  }
}

module.exports = { Store, defaultSettings };
